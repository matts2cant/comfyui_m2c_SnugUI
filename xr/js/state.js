// Store: snapshot values, seeds, loras and prompt building.
import { classify } from "./rules.js";

// same pattern and text rewriting as LoRA Manager (web/comfyui/lora_syntax_utils.js)
const LORA_PATTERN = /<lora:([^:]+):([-\d\.]+)(?::([-\d\.]+))?>/g;

const fmt = v => (Number.isFinite(Number(v)) ? Number(v) : 1).toFixed(2);

function includeClip(lora, hadClip) {
    if (lora.clipStrength == null) return Boolean(hadClip);
    const clip = Number(lora.clipStrength);
    const strength = Number(lora.strength);
    if (!Number.isFinite(clip) || !Number.isFinite(strength)) return Boolean(hadClip);
    if (Math.abs(clip - strength) > Number.EPSILON) return true;
    return Boolean(lora.expanded || hadClip);
}

function loraSyntax(name, lora, textStrength, textClip) {
    const strength = fmt(lora.strength != null ? lora.strength : textStrength);
    const clip = fmt(lora.clipStrength != null ? lora.clipStrength : lora.strength != null ? lora.strength : textClip);
    return includeClip(lora, textClip) ? `<lora:${name}:${strength}:${clip}>` : `<lora:${name}:${strength}>`;
}

function cleanupLoraSyntax(text) {
    let cleaned = text.replace(/\s+/g, " ").replace(/,\s*,+/g, ",").replace(/\s*,\s*/g, ",").trim();
    if (cleaned === ",") return "";
    return cleaned.replace(/(^,)|(,$)/g, "").replace(/,\s*/g, ", ").trim();
}

export function applyLorasToText(text, loras) {
    const byName = new Map();
    for (const lora of loras) if (lora && lora.name) byName.set(lora.name, lora);
    const kept = new Set();
    const updated = text.replace(LORA_PATTERN, (match, name, strength, clip) => {
        const lora = byName.get(name);
        if (!lora) return "";
        kept.add(name);
        return loraSyntax(name, lora, strength, clip);
    });
    const cleaned = cleanupLoraSyntax(updated);
    const missing = [...byName].filter(([name]) => !kept.has(name)).map(([name, lora]) => loraSyntax(name, lora));
    return missing.length ? `${cleaned}${cleaned ? " " : ""}${missing.join(" ")}`.trim() : cleaned;
}

const MAX_SEED = Number.MAX_SAFE_INTEGER;
const emit = (target, type, detail) => target.dispatchEvent(new CustomEvent(type, { detail }));

class Store extends EventTarget {
    snapshot = null;
    client = null;
    inputs = [];
    groups = { prompts: [], seeds: [], left: [], lora: [] };
    batchCount = 1;
    #values = new Map();
    #seedModes = new Map();
    #loras = new Map();
    #loraTexts = new Map();

    load(snapshot) {
        this.snapshot = snapshot;
        this.inputs = snapshot.inputs;
        this.groups = classify(snapshot.inputs, snapshot.loraNodes);
        this.#values.clear();
        this.#seedModes.clear();
        this.#loras.clear();
        this.#loraTexts.clear();
        for (const input of this.inputs) {
            this.#values.set(input.key, input.value);
            if (input.control != null) this.#seedModes.set(input.key, input.control);
        }
        for (const node of snapshot.loraNodes) {
            this.#loras.set(node.nodeId, node.loras.map(l => ({ ...l })));
            this.#loraTexts.set(node.nodeId, node.text);
        }
        emit(this, "load");
    }

    get(key) {
        return this.#values.get(key);
    }

    set(key, value) {
        this.#values.set(key, value);
        emit(this, "change", { key });
    }

    seedMode(key) {
        return this.#seedModes.get(key) || "fixed";
    }

    setSeedMode(key, mode) {
        this.#seedModes.set(key, mode);
        emit(this, "change", { key });
    }

    randomizeSeed(key) {
        const input = this.inputs.find(i => i.key === key);
        const min = input.min != null ? input.min : 0;
        const max = Math.min(input.max != null ? input.max : MAX_SEED, MAX_SEED);
        this.set(key, min + Math.floor(Math.random() * (max - min + 1)));
    }

    setBatchCount(n) {
        this.batchCount = Math.min(8, Math.max(1, Math.round(n)));
        emit(this, "change", { key: "batchCount" });
    }

    loras(nodeId) {
        return this.#loras.get(nodeId);
    }

    setLoras(nodeId, list) {
        this.#loras.set(nodeId, list);
        this.#loraTexts.set(nodeId, applyLorasToText(this.#loraTexts.get(nodeId), list));
        emit(this, "change", { key: "lora:" + nodeId });
    }

    buildPrompt() {
        const prompt = JSON.parse(JSON.stringify(this.snapshot.prompt));
        for (const input of this.inputs) {
            const value = this.#values.get(input.key);
            // unsupported widget types are only written back once edited, and only into an input the prompt has
            if (input.type === "UNSUPPORTED" && (value === input.value || !(input.widget in (prompt[input.nodeId]?.inputs ?? {})))) continue;
            prompt[input.nodeId].inputs[input.widget] = value;
        }
        for (const node of this.snapshot.loraNodes) {
            const list = this.#loras.get(node.nodeId).map(l => ({ ...l }));
            const inputs = prompt[node.nodeId].inputs;
            inputs.loras = node.lorasWrapped ? { __value__: list } : list;
            inputs.text = this.#loraTexts.get(node.nodeId);
        }
        return prompt;
    }

    applySeedModes() {
        for (const input of this.groups.seeds) {
            const mode = this.seedMode(input.key);
            const value = this.get(input.key);
            if (mode === "randomize") this.randomizeSeed(input.key);
            else if (mode === "increment") this.set(input.key, input.max != null ? Math.min(value + 1, input.max) : value + 1);
            else if (mode === "decrement") this.set(input.key, input.min != null ? Math.max(value - 1, input.min) : value - 1);
        }
    }

    async generate() {
        emit(this, "generate", { count: this.batchCount });
        try {
            for (let i = 0; i < this.batchCount; i++) {
                this.applySeedModes();
                const { prompt_id } = await this.client.queue(this.buildPrompt());
                emit(this, "queued", { prompt_id });
            }
        } catch (e) {
            emit(this, "error", { message: e.message });
        }
    }
}

export const store = new Store();

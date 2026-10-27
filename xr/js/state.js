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

function applyLorasToText(text, loras) {
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
    outputs = [];
    groups = { prompt: null, negative: null, seed: null, left: [], lora: [] };
    #values = new Map();
    #seedModes = new Map();
    #loras = new Map();
    #loraTexts = new Map();
    #groupStates = new Map();

    load(snapshot) {
        this.snapshot = snapshot;
        this.inputs = snapshot.inputs;
        // snapshots before the output switch list bare node ids: image outputs
        this.outputs = snapshot.outputs.map(o => typeof o === "object" ? o : { nodeId: o, title: snapshot.prompt[o]?._meta?.title ?? o, kind: "image" });
        this.groups = classify(snapshot.inputs, snapshot.loraNodes);
        this.#values.clear();
        this.#seedModes.clear();
        this.#loras.clear();
        this.#loraTexts.clear();
        this.#groupStates = new Map(Object.entries(snapshot.switchGroups ?? {}).map(([id, g]) => [id, g.state]));
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

    loras(nodeId) {
        return this.#loras.get(nodeId);
    }

    setLoras(nodeId, list) {
        this.#loras.set(nodeId, list);
        this.#loraTexts.set(nodeId, applyLorasToText(this.#loraTexts.get(nodeId), list));
        emit(this, "change", { key: "lora:" + nodeId });
    }

    // Pixaroma Group Switch groups: "on" | "mute" | "bypass", shared by every switch listing the group (as on the desktop)
    groupState(id) {
        return this.#groupStates.get(id);
    }

    setGroupStates(states) {
        for (const [id, state] of Object.entries(states)) this.#groupStates.set(id, state);
        emit(this, "change", { key: "switchGroups" });
    }

    // Switched-off groups: drop their nodes, then rewire every input that used one through the diffs' replacements,
    // transitively (a chain of bypassed groups ends at the first surviving node); no replacement drops the input.
    #offDiffs() {
        return [...this.#groupStates].filter(([, state]) => state !== "on").map(([id, state]) => this.snapshot.switchGroups[id].off[state]);
    }

    // API node ids the switched-off groups drop from the prompt
    removedNodes() {
        return new Set(this.#offDiffs().flatMap(d => d.removed));
    }

    // an output node runs when it is in the snapshot prompt (not muted or bypassed on the desktop) and no switched-off
    // group drops it; with no outputs listed, every node is an output
    outputActive(nodeId) {
        return nodeId in this.snapshot.prompt && !this.removedNodes().has(nodeId);
    }

    hasActiveOutput() {
        return !this.outputs.length || this.outputs.some(o => this.outputActive(o.nodeId));
    }

    #applyGroupStates(prompt) {
        const diffs = this.#offDiffs();
        const removed = new Set(diffs.flatMap(d => d.removed));
        const replace = Object.assign({}, ...diffs.map(d => d.replace));
        for (const id of removed) delete prompt[id];
        for (const node of Object.values(prompt)) {
            for (const [name, link] of Object.entries(node.inputs)) {
                let v = link;
                while (Array.isArray(v) && removed.has(v[0])) v = replace[`${v[0]}:${v[1]}`];
                if (v === undefined) delete node.inputs[name];
                else if (v !== link) node.inputs[name] = v;
            }
        }
        for (const d of diffs) {
            for (const [id, inputs] of Object.entries(d.inputs)) {
                if (!prompt[id]) continue;
                for (const [name, v] of Object.entries(inputs)) {
                    if (v === null) delete prompt[id].inputs[name];
                    else prompt[id].inputs[name] = v;
                }
            }
        }
    }

    buildPrompt() {
        const prompt = JSON.parse(JSON.stringify(this.snapshot.prompt));
        this.#applyGroupStates(prompt);
        for (const input of this.inputs) {
            const value = this.#values.get(input.key);
            // unsupported widget types are only written back once edited
            if (input.type === "UNSUPPORTED" && value === input.value) continue;
            for (const target of input.targets) if (prompt[target.nodeId]) prompt[target.nodeId].inputs[target.input] = target.json ? JSON.stringify(value) : value;
        }
        for (const node of this.snapshot.loraNodes) {
            if (!prompt[node.nodeId]) continue;
            const list = this.#loras.get(node.nodeId).map(l => ({ ...l }));
            const inputs = prompt[node.nodeId].inputs;
            inputs.loras = node.lorasWrapped ? { __value__: list } : list;
            inputs.text = this.#loraTexts.get(node.nodeId);
        }
        return prompt;
    }

    applySeedModes() {
        const input = this.groups.seed;
        if (!input) return;
        const mode = this.seedMode(input.key);
        const value = this.get(input.key);
        if (mode === "randomize") this.randomizeSeed(input.key);
        else if (mode === "increment") this.set(input.key, input.max != null ? Math.min(value + 1, input.max) : value + 1);
        else if (mode === "decrement") this.set(input.key, input.min != null ? Math.max(value - 1, input.min) : value - 1);
    }

    async generate() {
        emit(this, "generate");
        try {
            this.applySeedModes();
            const { prompt_id } = await this.client.queue(this.buildPrompt(), this.snapshot.previewMethod);
            emit(this, "queued", { prompt_id });
        } catch (e) {
            emit(this, "error", { message: e.message });
        }
    }
}

export const store = new Store();

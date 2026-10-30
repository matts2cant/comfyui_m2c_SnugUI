import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const WIDGET_ID = /^(?<graphId>[^:]+):(?<nodeId>[^:]+):(?<name>[^:]+)$/u;
const LORA_CLASSES = ["Lora Loader (LoraManager)", "Lora Stacker (LoraManager)", "WanVideo Lora Select (LoraManager)"];

const toast = (severity, summary, detail) =>
    app.extensionManager.toast.add({ severity, summary, detail, life: 4000 });

// linearData entry -> { nodeId, name } (canonical widget id or legacy [nodeId, name])
function parseEntry([id, name]) {
    const m = WIDGET_ID.exec(id);
    if (!m) return { nodeId: String(id), name };
    const { nodeId, name: widgetName } = m.groups;
    return { graphId: m.groups.graphId, nodeId: decodeURIComponent(nodeId), name: decodeURIComponent(widgetName) };
}

function findWidget(node, name) {
    const exact = node.widgets?.find((w) => w.name === name);
    if (exact) return exact;
    const dup = /^(.*)#(\d+)$/u.exec(name);
    return dup && node.widgets?.filter((w) => w.name === dup[1])[Number(dup[2])];
}

// one request per class: the snapshot builds every input and output at once; a failed request is dropped so the next snapshot retries
const defCache = new Map();
function nodeDef(classType) {
    if (!defCache.has(classType)) {
        const def = api.fetchApi(`/object_info/${encodeURIComponent(classType)}`).then((res) => res.json()).then((info) => info[classType]);
        def.catch(() => defCache.delete(classType));
        defCache.set(classType, def);
    }
    return defCache.get(classType);
}

const WIDGET_KINDS = { number: "INT", combo: "COMBO", toggle: "BOOLEAN", boolean: "BOOLEAN", text: "STRING", customtext: "STRING", string: "STRING" };

// input spec (of the first prompt target) -> snapshot type/fields; the App-mode widget only decides when there is no spec
function describeInput(spec, widget) {
    const opts = spec?.[1] ?? {};
    const kind = !spec ? WIDGET_KINDS[widget.type] : Array.isArray(spec[0]) ? "COMBO" : spec[0];
    switch (kind) {
        case "INT":
        case "FLOAT": {
            const type = spec ? kind : widget.options?.precision === 0 ? "INT" : "FLOAT";
            return {
                type,
                min: opts.min ?? widget.options?.min,
                max: opts.max ?? widget.options?.max,
                step: opts.step ?? (type === "INT" ? 1 : 0.01),
                round: opts.round,
            };
        }
        case "COMBO": {
            const values = spec ? (Array.isArray(spec[0]) ? spec[0] : opts.options) : widget.options?.values;
            const options = typeof values === "function" ? values() : values ?? [];
            return { type: opts.image_upload ? "IMAGE" : "COMBO", options };
        }
        case "BOOLEAN":
            return { type: "BOOLEAN" };
        case "STRING":
            return { type: "STRING", multiline: !spec ? widget.type === "customtext" : !!opts.multiline };
        default:
            return { type: "UNSUPPORTED" };
    }
}

// "260:12:5" -> node 5 inside subgraph node 12 inside subgraph node 260
function nodeByExecutionId(id) {
    const [head, ...rest] = id.split(":");
    return rest.reduce((node, part) => node?.subgraph.getNodeById(Number(part)), app.rootGraph.getNodeById(Number(head)));
}

function resolveEntry(entry) {
    const { graphId, nodeId, name } = parseEntry(entry);
    const root = app.rootGraph;
    const node = (!graphId || graphId === root.id) ? root.getNodeById(/^\d+$/u.test(nodeId) ? Number(nodeId) : nodeId) : null;
    return { nodeId, name, node, widget: node && findWidget(node, name) };
}

// An object-valued widget that the node serializes into a JSON-string input of another name (Pixaroma's sizes_ui ->
// hidden SizesState): the string input that parses to an object sharing a key with the widget value.
function jsonTargets(node, widget, output) {
    const { class_type: classType, inputs = {} } = output[node.id] ?? {};
    const keys = typeof widget?.value === "object" && widget.value ? Object.keys(widget.value) : [];
    return Object.entries(inputs).flatMap(([input, v]) => {
        if (typeof v !== "string" || !v.startsWith("{")) return [];
        try {
            const parsed = JSON.parse(v);
            return keys.some((k) => k in parsed) ? [{ nodeId: String(node.id), input, classType, json: true }] : [];
        } catch {
            return [];
        }
    });
}

// Subgraph widgets are not prompt inputs themselves: write a unique value into each and find where it lands in the
// flattened prompt. Plain node widgets map straight to their own prompt input.
async function findTargets(entries) {
    const sentinels = entries.map(({ node, widget }, i) => {
        if (!widget || !node.isSubgraphNode()) return null;
        if (typeof widget.value === "number") return 912345.678 + i;
        return typeof widget.value === "object" ? null : `__appmodexr_${i}__`;
    });
    const originals = entries.map(({ widget }) => widget?.value);
    let output;
    try {
        entries.forEach(({ widget }, i) => { if (sentinels[i] !== null) widget.value = sentinels[i]; });
        ({ output } = await app.graphToPrompt());
    } finally {
        entries.forEach(({ widget }, i) => { if (sentinels[i] !== null) widget.value = originals[i]; });
    }
    return entries.map(({ node, name, widget }, i) => {
        if (!widget) return [];
        const baseName = name.replace(/#\d+$/u, "");
        if (sentinels[i] === null) return baseName in (output[node.id]?.inputs ?? {}) ? [{ nodeId: String(node.id), input: baseName, classType: output[node.id].class_type }] : jsonTargets(node, widget, output);
        return Object.entries(output).flatMap(([nodeId, n]) =>
            Object.entries(n.inputs).filter(([, v]) => v === sentinels[i]).map(([input]) => ({ nodeId, input, classType: n.class_type })));
    });
}

// widgets with their own VR control, keyed by classType:widget
const JSON_WIDGET_TYPES = { "PixaromaSizes:sizes_ui": "PIXAROMA_SIZES" };

// Pixaroma Group Switch: a frontend-only node whose switches mute or bypass whole groups through the
// window.PixaromaPixGroup bridge. Its state (the DOM widget value) -> its groups as the node lists them: names
// numbered when shared (in canvas order), sorted, limited to the picked ones.
const GROUP_SWITCH = "PixaromaGroupSwitch:group_switch_ui";

function switchGroups(bridge, { action, restriction, scope, picked, sort }) {
    const count = {}, seen = {};
    const all = bridge.listGroups();
    for (const g of all) count[g.title] = (count[g.title] ?? 0) + 1;
    let groups = all.map((g) => {
        const num = count[g.title] > 1 ? (seen[g.title] = (seen[g.title] ?? 0) + 1) : 0;
        return { id: g.id, label: num ? `${g.title} ${num}` : g.title, color: g.color };
    });
    if (sort === "name") groups.sort((a, b) => a.label.localeCompare(b.label));
    else if (sort === "color") groups.sort((a, b) => (a.color || "").localeCompare(b.color || "") || a.label.localeCompare(b.label));
    if (scope === "pick") groups = groups.filter((g) => picked.includes(g.id));
    return { action, restriction, groups };
}

const allNodes = (graph) => graph.nodes.flatMap((n) => [n, ...(n.isSubgraphNode() ? allNodes(n.subgraph) : [])]);

// What turning one group off does to the base prompt: the nodes it drops; for each of their outputs that a remaining
// input used, what that input became (bypass: the link or value it was rewired to; mute: absent, the input is dropped);
// any other input change (null = deleted).
function promptDiff(base, off) {
    const removed = Object.keys(base).filter((id) => !(id in off));
    const gone = new Set(removed);
    const replace = {}, inputs = {};
    for (const [id, node] of Object.entries(off)) {
        for (const name of new Set([...Object.keys(base[id].inputs), ...Object.keys(node.inputs)])) {
            const was = base[id].inputs[name], now = node.inputs[name];
            if (JSON.stringify(was) === JSON.stringify(now)) continue;
            if (Array.isArray(was) && gone.has(was[0])) {
                if (now !== undefined) replace[`${was[0]}:${was[1]}`] ??= now;
            } else (inputs[id] ??= {})[name] = now ?? null;
        }
    }
    return { removed, replace, inputs };
}

// Every group of the App-mode switches, keyed by bridge id: its current state ("on" | "mute" | "bypass", as the
// bridge reads it) and the prompt diff of turning it off for each action that applies (its switches' and its current
// one). The base prompt has every switched-off group back on, so applying the current states gives today's prompt.
// Targets are found on the base too, so widgets inside switched-off groups stay editable.
async function switchPrompts(entries, switches) {
    const bridge = window.PixaromaPixGroup;
    const groups = {};
    for (const { action, groups: list } of switches.values()) {
        for (const { id } of list) {
            const s = bridge.getGroupState(id);
            groups[id] ??= { state: s.muted ? "mute" : s.bypassed ? "bypass" : "on", off: {} };
            groups[id].off[action] = null;
        }
    }
    const modes = new Map(allNodes(app.rootGraph).map((n) => [n, n.mode]));
    try {
        for (const [id, g] of Object.entries(groups)) {
            if (g.state === "on") continue;
            g.off[g.state] = null;
            bridge.setGroupSwitch(id, true, g.state);
        }
        const targets = await findTargets(entries);
        const { output } = await app.graphToPrompt();
        const base = new Map(allNodes(app.rootGraph).map((n) => [n, n.mode]));
        for (const [id, g] of Object.entries(groups)) {
            for (const action of Object.keys(g.off)) {
                bridge.setGroupSwitch(id, false, action);
                g.off[action] = promptDiff(output, (await app.graphToPrompt()).output);
                for (const [n, mode] of base) n.mode = mode;
            }
        }
        return { targets, output, groups };
    } finally {
        for (const [n, mode] of modes) n.mode = mode;
        app.graph.setDirtyCanvas(true, true);
    }
}

async function buildInput({ nodeId, name, node, widget }, targets, output, groupSwitch) {
    const baseName = name.replace(/#\d+$/u, "");
    const [first] = targets;
    const base = {
        key: `${nodeId}:${name}`,
        nodeId: first?.nodeId ?? nodeId,
        classType: first?.classType ?? node?.type ?? "",
        nodeTitle: node?.title ?? "",
        widget: first?.input ?? name,
        label: widget?.label || (baseName === "value" && node?.title) || baseName,
        type: "UNSUPPORTED",
        value: widget?.value ?? null,
        control: null,
        targets,
        // muted (2) or bypassed (4) on the desktop outside the App-mode switches, so absent from the prompt
        disabled: !targets.length && [2, 4].includes(node?.mode),
    };
    if (groupSwitch) return { ...base, type: "PIXAROMA_GROUP_SWITCH", label: widget.label || node.title, ...groupSwitch };
    if (!first) return base;
    if (first.json) {
        const type = JSON_WIDGET_TYPES[`${first.classType}:${baseName}`] ?? "UNSUPPORTED";
        return { ...base, type, value: JSON.parse(output[first.nodeId].inputs[first.input]) };
    }

    const def = await nodeDef(first.classType);
    const spec = def?.input?.required?.[first.input] ?? def?.input?.optional?.[first.input];
    // the control widget is the only linked one (core PrimitiveInt names it "fixed", not "control_after_generate");
    // a promoted widget has none of its own, so look at the inner widget behind the first target
    const inner = nodeByExecutionId(first.nodeId)?.widgets?.find((w) => w.name === first.input);
    const control = (widget.linkedWidgets ?? inner?.linkedWidgets)?.[0];
    return { ...base, ...describeInput(spec, widget), control: control?.value ?? null };
}

function buildLoraNode([nodeId, node]) {
    const raw = node.inputs.loras;
    const lorasWrapped = !!raw && !Array.isArray(raw) && "__value__" in raw;
    const list = (lorasWrapped ? raw.__value__ : raw) ?? [];
    return {
        nodeId,
        classType: node.class_type,
        title: node._meta?.title ?? node.class_type,
        text: node.inputs.text ?? "",
        loras: list.map((l) => ({
            name: l.name,
            strength: Number(l.strength),
            clipStrength: Number(l.clipStrength ?? l.strength),
            active: l.active !== false,
        })),
        lorasWrapped,
    };
}

// 3D output nodes (Save 3D Model, Preview 3D...) take a MESH or FILE_3D* input; anything else is shown as images
const MODEL_INPUT = /(^|,)(MESH|FILE_3D)/u;

async function buildOutput(nodeId, output) {
    const node = output[nodeId];
    const def = node && await nodeDef(node.class_type);
    const specs = Object.values({ ...def?.input?.required, ...def?.input?.optional });
    return {
        nodeId,
        title: node?._meta?.title ?? nodeId,
        kind: specs.some(([type]) => typeof type === "string" && MODEL_INPUT.test(type)) ? "3d" : "image",
    };
}

async function buildSnapshot(linearData) {
    const entries = linearData.inputs.map(resolveEntry);
    const switches = new Map(entries.filter(({ node, name, widget }) => widget && `${node.type}:${name}` === GROUP_SWITCH)
        .map((entry) => [entry, switchGroups(window.PixaromaPixGroup, entry.widget.value)]));
    const { targets, output, groups } = await switchPrompts(entries, switches);
    const workflow = app.extensionManager.workflow.activeWorkflow;
    return {
        version: 1,
        workflowName: (workflow?.filename ?? "workflow").replace(/\.json$/iu, ""),
        prompt: output,
        switchGroups: groups,
        previewMethod: app.extensionManager.setting.get("Comfy.Execution.PreviewMethod"),
        inputs: await Promise.all(entries.map((entry, i) => buildInput(entry, targets[i], output, switches.get(entry)))),
        outputs: await Promise.all((linearData.outputs ?? []).map((id) => buildOutput(String(id), output))),
        loraNodes: Object.entries(output).filter(([, n]) => LORA_CLASSES.includes(n.class_type)).map(buildLoraNode),
    };
}

async function openInVR() {
    const linearData = app.rootGraph?.extra?.linearData;
    if (!linearData?.inputs?.length) return toast("warn", "Open in VR", "Configure App mode first");
    // opened before any await so the popup blocker sees the user gesture
    window.open(new URL("/appmode-xr", location.href).href, "appmode-xr");
    try {
        const res = await api.fetchApi("/appmode-xr/snapshot", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(await buildSnapshot(linearData)),
        });
        if (!res.ok) throw new Error(`server returned ${res.status}`);
        toast("success", "Open in VR", "Snapshot sent");
    } catch (err) {
        console.error("[AppModeXR]", err);
        toast("error", "Open in VR failed", err.message);
    }
}

const icon = "icon-[lucide--eye]";

app.registerExtension({
    name: "AppModeXR",
    commands: [{ id: "AppModeXR.Open", label: "Open in VR", icon, function: openInVR }],
    keybindings: [{ combo: { key: "v", alt: true }, commandId: "AppModeXR.Open" }],
    actionBarButtons: [{ icon, label: "Open in VR", tooltip: "Open the App-mode workflow in VR (Alt+V)", onClick: openInVR }],
});

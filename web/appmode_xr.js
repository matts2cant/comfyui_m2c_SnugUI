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

const defCache = new Map();
async function nodeDef(classType) {
    if (!defCache.has(classType)) {
        const res = await api.fetchApi(`/object_info/${encodeURIComponent(classType)}`);
        defCache.set(classType, (await res.json())[classType]);
    }
    return defCache.get(classType);
}

// Widget -> snapshot type/fields, using the node def input spec when there is one
function describeWidget(widget, spec) {
    const opts = spec?.[1] ?? {};
    switch (widget.type) {
        case "number": {
            const type = spec ? spec[0] : widget.options?.precision === 0 ? "INT" : "FLOAT";
            return {
                type,
                min: opts.min ?? widget.options?.min,
                max: opts.max ?? widget.options?.max,
                step: opts.step ?? (type === "INT" ? 1 : 0.01),
                round: opts.round,
            };
        }
        case "combo": {
            const values = widget.options?.values;
            const options = typeof values === "function" ? values() : values ?? (Array.isArray(spec?.[0]) ? spec[0] : opts.options) ?? [];
            return { type: opts.image_upload ? "IMAGE" : "COMBO", options };
        }
        case "toggle":
        case "boolean":
            return { type: "BOOLEAN" };
        case "text":
        case "customtext":
        case "string":
            return { type: "STRING", multiline: widget.type === "customtext" || !!opts.multiline };
        default:
            return { type: "UNSUPPORTED" };
    }
}

async function buildInput(entry, output) {
    const { graphId, nodeId, name } = parseEntry(entry);
    const root = app.rootGraph;
    const node = (!graphId || graphId === root.id) ? root.getNodeById(/^\d+$/u.test(nodeId) ? Number(nodeId) : nodeId) : null;
    const widget = node && findWidget(node, name);
    const baseName = name.replace(/#\d+$/u, "");
    const promptNode = output[String(node?.id)];
    const base = {
        key: `${nodeId}:${name}`,
        nodeId,
        classType: promptNode?.class_type ?? node?.type ?? "",
        nodeTitle: node?.title ?? "",
        widget: name,
        label: widget?.label || (baseName === "value" && node?.title) || baseName,
        type: "UNSUPPORTED",
        value: widget?.value ?? null,
        control: null,
    };
    if (!widget || !promptNode || !(baseName in promptNode.inputs)) return base;

    const def = await nodeDef(promptNode.class_type);
    const spec = def?.input?.required?.[baseName] ?? def?.input?.optional?.[baseName];
    // the control widget is the only linked one (core PrimitiveInt names it "fixed", not "control_after_generate")
    const control = widget.linkedWidgets?.[0];
    return { ...base, ...describeWidget(widget, spec), control: control?.value ?? null };
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

async function buildSnapshot(linearData) {
    const { output } = await app.graphToPrompt();
    const workflow = app.extensionManager.workflow.activeWorkflow;
    return {
        version: 1,
        workflowName: (workflow?.filename ?? "workflow").replace(/\.json$/iu, ""),
        prompt: output,
        inputs: await Promise.all(linearData.inputs.map((entry) => buildInput(entry, output))),
        outputs: (linearData.outputs ?? []).map(String),
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

// Placement rules: first match wins.
const SAMPLER_WIDGETS = ["sampler_name", "scheduler", "steps", "cfg", "denoise", "guidance", "shift"];
const SIZE_WIDGETS = ["width", "height", "batch_size"];

const isLoraManager = input => input.classType.includes("LoraManager");
const isSeed = input => input.type === "INT" && (/seed/i.test(input.widget) || /seed/i.test(input.label) || input.control != null);

function leftGroup(input) {
    if (input.type === "COMBO" && /Loader|Load/.test(input.classType) && !input.classType.includes("LoadImage")) return 0;
    if (SAMPLER_WIDGETS.includes(input.widget)) return 1;
    if (SIZE_WIDGETS.includes(input.widget)) return 2;
    return 3;
}

export function classify(inputs, loraNodes) {
    const groups = { prompts: [], seeds: [], left: [], lora: loraNodes };
    for (const input of inputs) {
        if (isLoraManager(input)) continue;
        // nothing in the prompt to write to: shown read-only in the left panel
        if (!input.targets.length) groups.left.push(input);
        else if (input.type === "STRING" && input.multiline) groups.prompts.push(input);
        else if (isSeed(input)) groups.seeds.push(input);
        else groups.left.push(input);
    }
    // stable sort keeps App-mode order inside each group
    groups.left.sort((a, b) => leftGroup(a) - leftGroup(b));
    return groups;
}

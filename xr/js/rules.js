// Placement rules: first match wins.
const isLoraManager = input => input.classType.includes("LoraManager");
const isSeed = input => input.type === "INT" && (/seed/i.test(input.widget) || /seed/i.test(input.label) || input.control != null);

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
    return groups;
}

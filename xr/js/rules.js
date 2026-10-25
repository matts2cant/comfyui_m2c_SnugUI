// Placement rules: first match wins.
const isLoraManager = input => input.classType.includes("LoraManager");
const isSeed = input => input.type === "INT" && (/seed/i.test(input.widget) || /seed/i.test(input.label) || input.control != null);

// "[Tab] Label" puts the input in the left panel tab "Tab"; the group entries carry the stripped label and `tab`.
const parseName = name => {
    const m = /^\s*\[([^\]]*\S[^\]]*)\]\s*(\S.*)$/.exec(name);
    return m ? { tab: m[1].trim(), label: m[2].trim() } : { tab: "General", label: name };
};

export function classify(inputs, loraNodes) {
    const groups = { prompts: [], seeds: [], left: [], lora: loraNodes };
    for (const original of inputs) {
        const input = { ...original, ...parseName(original.label) };
        if (isLoraManager(input)) continue;
        // nothing in the prompt to write to: shown read-only in the left panel
        if (!input.targets.length) groups.left.push(input);
        else if (input.type === "STRING" && input.multiline) groups.prompts.push(input);
        else if (isSeed(input)) groups.seeds.push(input);
        else groups.left.push(input);
    }
    return groups;
}

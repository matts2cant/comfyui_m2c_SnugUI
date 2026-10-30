// Placement rules.
const isLoraManager = (input) => input.classType.includes("LoraManager");
// The prompt panel only takes inputs with these exact App-mode names (trimmed, no [Tab] prefix stripping) and types.
// The first one of each in App-mode order wins; every other input goes to the Input panel.
const SLOTS = new Map([["_prompt", ["prompt", "STRING"]], ["_negative_prompt", ["negative", "STRING"]], ["_seed", ["seed", "INT"]]]);

// "[Tab] Label" puts the input in the Input panel's tab "Tab"; the group entries carry the stripped label and `tab`.
const parseName = (name) => {
	const m = /^\s*\[([^\]]*\S[^\]]*)\]\s*(\S.*)$/.exec(name);
	return m ? { tab: m[1].trim(), label: m[2].trim() } : { tab: "General", label: name };
};

export function classify(inputs, loraNodes) {
	const groups = { prompt: null, negative: null, seed: null, left: [], lora: loraNodes };
	for (const original of inputs) {
		const input = { ...original, ...parseName(original.label) };
		if (isLoraManager(input)) continue;
		const [slot, type] = SLOTS.get(original.label.trim()) ?? [];
		if (slot && input.type === type && !groups[slot]) groups[slot] = input;
		else groups.left.push(input);
	}
	return groups;
}

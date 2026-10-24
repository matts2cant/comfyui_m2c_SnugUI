// Placeholder: replaced by the bottom panel implementation.
export function createBottomPanel({ THREE, ui, keyboard }) {
	const group = new THREE.Group();
	const panel = new ui.Panel({ name: "bottom", widthM: 1.6, heightM: 0.5 });
	const chips = ["masterpiece", "1girl", "fennec ears", "blonde wavy hair"];
	const w = new ui.Chips({ chips, x: 24, y: 90, w: 1550, onDelete: (i) => { chips.splice(i, 1); w.setChips(chips); }, onAdd: () => keyboard.editText({ initial: "", onDone: (v) => { chips.push(v); w.setChips(chips); } }), onTap: (i) => keyboard.editText({ initial: chips[i], onDone: (v) => { chips[i] = v; w.setChips(chips); } }) });
	panel.add(new ui.Label({ text: "Bottom (placeholder)", size: 40, bold: true, x: 24, y: 20, w: 1000 }));
	panel.add(w);
	panel.add(new ui.Button({ text: "Generate", variant: "accent", x: 24, y: 380, w: 400, h: 90, onClick: () => console.log("generate") }));
	return { group: group.add(panel.mesh), update() {} };
}

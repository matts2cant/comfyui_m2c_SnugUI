// Placeholder: replaced by the left panel implementation.
export function createLeftPanel({ THREE, ui }) {
	const group = new THREE.Group();
	const panel = new ui.Panel({ name: "left", widthM: 0.85, heightM: 1.15 });
	const items = Array.from({ length: 30 }, (_, i) => ({ label: "Option " + i, value: i, sub: i % 3 ? "" : "tag" }));
	const view = new ui.ScrollView({ x: 12, y: 90, w: 826, h: 1048 });
	const list = new ui.List({ items, selected: 2, h: 300 });
	view.setChildren([
		new ui.Slider({ label: "steps", min: 1, max: 50, step: 1, value: 20 }),
		new ui.Slider({ label: "cfg", min: 0, max: 20, step: 0.1, value: 7, bigStep: 1 }),
		new ui.Toggle({ label: "Enable thing", value: true }),
		list,
		new ui.Button({ text: "Button (toggle)", onClick() { this.toggled = !this.toggled; this.invalidate(); } }),
		new ui.Slider({ label: "denoise", min: 0, max: 1, step: 0.01, value: 1 }),
	]);
	ui.stackY(view.children, { w: 790, gap: 14 });
	panel.add(new ui.Label({ text: "Left (placeholder)", size: 40, bold: true, x: 24, y: 24, w: 800 }));
	panel.add(view);
	group.add(panel.mesh);
	return { group, update() {} };
}

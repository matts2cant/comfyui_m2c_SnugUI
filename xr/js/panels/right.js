// Placeholder: replaced by the right panel implementation.
export function createRightPanel({ THREE, ui, keyboard }) {
	const group = new THREE.Group();
	const panel = new ui.Panel({ name: "right", widthM: 0.85, heightM: 1.15 });
	const swatch = (hue) => {
		const c = document.createElement("canvas");
		c.width = c.height = 64;
		const g = c.getContext("2d");
		g.fillStyle = `hsl(${hue} 60% 50%)`;
		g.fillRect(0, 0, 64, 64);
		return c.toDataURL();
	};
	const field = new ui.TextField({ x: 24, y: 90, w: 802, placeholder: "search LoRAs", onClick: () => keyboard.editText({ initial: field.value, onInput: (v) => { field.value = v; field.invalidate(); }, onDone: (v) => { field.value = v; field.invalidate(); } }) });
	const grid = new ui.ImageGrid({ x: 24, y: 180, w: 802, h: 940, cell: 220, items: Array.from({ length: 40 }, (_, i) => ({ url: swatch(i * 9), label: "lora " + i, value: i })) });
	panel.add(new ui.Label({ text: "Right (placeholder)", size: 40, bold: true, x: 24, y: 24, w: 800 }));
	panel.add(field);
	panel.add(grid);
	group.add(panel.mesh);
	return { group, update() {} };
}

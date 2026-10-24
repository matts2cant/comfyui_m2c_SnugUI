// Placeholder: replaced by the center panel implementation.
export function createCenterPanel({ THREE, ui, xr }) {
	const group = new THREE.Group();
	const panel = new ui.Panel({ name: "center", widthM: 1.3, heightM: 0.8 });
	const mode = new ui.Label({ text: "", size: 30, color: ui.theme.muted, x: 24, y: 100, w: 1250 });
	const toggle = new ui.Button({ text: "Toggle AR / VR", x: 24, y: 160, w: 320, onClick: () => { xr.toggleMode(); mode.setText("mode: " + xr.mode()); } });
	for (const w of [new ui.Label({ text: "Center (placeholder)", size: 44, bold: true, x: 24, y: 24, w: 1250 }), mode, toggle]) panel.add(w);
	mode.setText("mode: " + xr.mode());
	group.add(panel.mesh);
	return { group, update() {} };
}

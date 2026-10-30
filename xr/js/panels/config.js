// Configuration panel: settings of this page's own UI, kept in localStorage. Toolbar position: where the Desktop View's deck
// (toolbar, output row, output pop-up) is pinned; the VR lectern ignores it.
import { pref, setPref } from "../prefs.js";

const TOOLBAR_KEY = "appmode-xr.toolbar";
// the grid as on the screen: top row, then bottom row
const POSITIONS = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"];
const M = 24, GAP = 8, BTN_H = 72, GRID_Y = 140, H = GRID_Y + 2 * BTN_H + GAP + M;

// onChange() after the toolbar position changed; toolbarAt() -> "<top|bottom>-<left|center|right>"
export function createConfigPanel({ THREE, ui }, onChange) {
	const panel = new ui.Panel({ name: "config", widthM: 0.85, heightM: H / ui.PX_PER_M });
	const group = new THREE.Group();
	group.add(panel.mesh);
	const title = panel.add(new ui.Label({ text: "Configuration", size: 40, bold: true, x: M, y: M }));
	const caption = panel.add(new ui.Label({ text: "Toolbar position", size: 24, color: ui.theme.muted, x: M, y: 100 }));
	const buttons = POSITIONS.map((at) => panel.add(new ui.Button({
		text: at[0].toUpperCase() + at.slice(1).replace("-", " "), size: 28, h: BTN_H, onClick: () => select(at),
	})));
	// from the panel's width: the Desktop View's window re-flows the grid
	panel.onResize = () => {
		title.w = caption.w = panel.width - 2 * M;
		const bw = (panel.width - 2 * M - 2 * GAP) / 3;
		// narrow (a phone): the labels shrink until the longest fits
		panel.ctx.font = ui.font(28, true);
		const size = Math.min(28, Math.floor(28 * (bw - 24) / Math.max(...buttons.map((b) => panel.ctx.measureText(b.text).width))));
		buttons.forEach((b, i) => Object.assign(b, { size, x: M + (i % 3) * (bw + GAP), y: GRID_Y + Math.floor(i / 3) * (BTN_H + GAP), w: bw }));
	};
	panel.onResize();

	let toolbar = POSITIONS.find((at) => at === pref(TOOLBAR_KEY)) ?? "bottom-right";

	function show() {
		buttons.forEach((b, i) => { b.toggled = POSITIONS[i] === toolbar; });
		panel.invalidate();
	}

	function select(at) {
		toolbar = at;
		setPref(TOOLBAR_KEY, at);
		show();
		onChange();
	}

	show();
	return { group, panel, minHeight: () => H, toolbarAt: () => toolbar };
}

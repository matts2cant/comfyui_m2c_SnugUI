// What the two DOM hosts share (desktop.js: the Desktop View's windows and deck; phone.js: the phone layout): panels' canvases
// placed in the page and their pointer input.
// Units: CSS px (the page), panel px (a panel's layout and its widgets) and canvas px = panel px x panel.scale; a host draws a
// panel at a fixed number of CSS px per panel px (desktop.js SCALE, phone.js PHONE).
import * as ui from "./ui.js";
import * as keyboard from "./keyboard.js";

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// moves the elements into parent, in order, unless they are there already (a move would drop their pointer capture)
export function adopt(parent, ...els) {
	for (const e of els) if (e.parentNode !== parent) parent.append(e);
}

export function el(tag, cls, parent, html = "") {
	const e = document.createElement(tag);
	e.className = cls;
	e.innerHTML = html;
	parent.append(e);
	return e;
}

// the panel re-flowed to w x h panel px, shown at css CSS px per panel px (k: the scale of a CSS transform over it) and drawn at
// the displayed resolution
export function sizePanel(p, w, h, css, k = 1) {
	Object.assign(p.canvas.style, { width: w * css + "px", height: h * css + "px" });
	p.setPx(w, h, css * devicePixelRatio * k);
}

// keeps the edit's focused textarea (or the on-screen keyboard) while pressing the layer
export function keepEdit(layer) {
	layer.addEventListener("mousedown", (e) => { if (keyboard.isEditing()) e.preventDefault(); });
	layer.addEventListener("pointerdown", (e) => { if (keyboard.isEditing() && e.pointerType === "touch") e.preventDefault(); });
	layer.addEventListener("contextmenu", (e) => e.preventDefault());
}

// A press on a TextField keeps the edit; any other press commits it once released. The edit takes keyboard.js's desktop path:
// its textarea is focused by the tap that starts it, which opens a touch device's own keyboard on it (caret, selection, backspace).
export function bindPanel(panel) {
	const c = panel.canvas;
	let outside = false;
	const at = (e) => {
		const r = c.getBoundingClientRect();
		return [(e.clientX - r.left) * panel.width / r.width, (e.clientY - r.top) * panel.height / r.height];
	};
	c.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		c.setPointerCapture(e.pointerId);
		keyboard.setXR(false);
		const [x, y] = at(e), hit = panel.hitTest(x, y);
		outside = keyboard.isEditing() && !(hit instanceof ui.TextField);
		panel.pointer("down", x, y, e.pointerId);
	});
	c.addEventListener("pointermove", (e) => panel.pointer("move", ...at(e), e.pointerId));
	c.addEventListener("pointerup", (e) => {
		panel.pointer("up", ...at(e), e.pointerId);
		if (outside) keyboard.commit();
		outside = false;
	});
	c.addEventListener("pointercancel", (e) => panel.pointer("up", -1e6, -1e6, e.pointerId));
	c.addEventListener("pointerleave", (e) => panel.pointer("leave", 0, 0, e.pointerId));
	c.addEventListener("wheel", (e) => {
		e.preventDefault();
		panel.scroll(e.deltaY, ...at(e));
	}, { passive: false });
}

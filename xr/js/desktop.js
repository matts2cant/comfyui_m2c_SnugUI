// Desktop View windows: the VR panels' own canvases in floating DOM windows over the 3D view. A title bar (icon, name, close)
// moves a window, its corner grip zooms it (aspect locked, the panels scale without re-flow and are drawn at the displayed
// resolution, Panel.setScale), a press raises it. Pointer events go to panel.pointer() in panel px, so the windows take every
// press over them. The dock at the bottom right toggles the windows, then VR mode. Geometry and open state are kept in
// localStorage and pushed back inside the browser window when it is smaller.
import * as ui from "./ui.js";
import * as keyboard from "./keyboard.js";
import { paths } from "./icons.js";

const STORE_KEY = "appmode-xr.windows";
const ZOOM = 0.45, MIN_W = 220, MARGIN = 12, CASCADE = 32, BAR_H = 40; // BAR_H: about the title bar, for first placements

const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name]}"/></svg>`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function el(tag, cls, parent, html = "") {
	const e = document.createElement(tag);
	e.className = cls;
	e.innerHTML = html;
	parent.append(e);
	return e;
}

// press and drag handling for an element: down(e) -> move(dx, dy) on each move, up() on release
function drag(target, down, move, up) {
	let from = null;
	target.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		target.setPointerCapture(e.pointerId);
		from = { x: e.clientX, y: e.clientY, id: e.pointerId };
		down(e);
	});
	target.addEventListener("pointermove", (e) => { if (from?.id === e.pointerId) move(e.clientX - from.x, e.clientY - from.y); });
	const end = (e) => {
		if (from?.id !== e.pointerId) return;
		from = null;
		up();
	};
	target.addEventListener("pointerup", end);
	target.addEventListener("pointercancel", end);
}

// A press on a TextField or its EditBar keeps the edit; any other press commits it once released. A tap with a finger that
// starts an edit opens the on-screen keyboard (keyboard.js's XR path), the press being the user activation it needs.
function bindPanel(panel) {
	const c = panel.canvas;
	let outside = false, field = null;
	const at = (e) => {
		const r = c.getBoundingClientRect();
		return [(e.clientX - r.left) * panel.width / r.width, (e.clientY - r.top) * panel.height / r.height];
	};
	c.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		c.setPointerCapture(e.pointerId);
		keyboard.setXR(e.pointerType === "touch");
		const [x, y] = at(e), hit = panel.hitTest(x, y);
		outside = keyboard.isEditing() && !(hit instanceof ui.TextField || hit instanceof ui.EditBar);
		field = hit instanceof ui.TextField && !hit.ta ? hit : null;
		panel.pointer("down", x, y, e.pointerId);
	});
	c.addEventListener("pointermove", (e) => panel.pointer("move", ...at(e), e.pointerId));
	c.addEventListener("pointerup", (e) => {
		panel.pointer("up", ...at(e), e.pointerId);
		if (outside) keyboard.commit();
		if (e.pointerType === "touch" && field?.ta) keyboard.showKeyboard();
		outside = false;
		field = null;
	});
	c.addEventListener("pointercancel", (e) => panel.pointer("up", -1e6, -1e6, e.pointerId));
	c.addEventListener("pointerleave", (e) => panel.pointer("leave", 0, 0, e.pointerId));
	c.addEventListener("wheel", (e) => {
		e.preventDefault();
		panel.scroll(e.deltaY, ...at(e));
	}, { passive: false });
}

function load() {
	try {
		return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {};
	} catch {
		return {};
	}
}

// specs: [{ name, title, icon, layout() -> [[panel, x, y]] }], x y the panel's top-left in the window's content px; only the
// first one is open on the first visit. onVR: the dock's VR mode button.
export function createDesktop(specs, onVR) {
	const saved = load();
	const root = el("div", "desk", document.body);
	const dock = el("div", "dock", document.body);
	// keep the edit's focused textarea (or the on-screen keyboard) while pressing the windows
	root.addEventListener("mousedown", (e) => { if (keyboard.isEditing()) e.preventDefault(); });
	root.addEventListener("pointerdown", (e) => { if (keyboard.isEditing() && e.pointerType === "touch") e.preventDefault(); });
	root.addEventListener("contextmenu", (e) => e.preventDefault());
	let shown = false, lastNew = null;
	let top = Math.max(0, ...Object.values(saved).map((s) => s.z ?? 0));

	const save = () => {
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(wins.map((w) => [w.spec.name, w.state]))));
		} catch {}
	};

	const wins = specs.map((spec, i) => {
		const box = el("div", "win", root);
		const bar = el("div", "bar", box, `${svg(spec.icon)}<span>${spec.title}</span>`);
		const close = el("button", "", bar, svg("x"));
		const body = el("div", "body", box);
		const grip = el("div", "grip", box);
		const btn = el("button", "", dock, svg(spec.icon));
		btn.title = spec.title;
		close.title = "Close";
		const win = { spec, box, bar, body, panels: new Set(), rect: null, state: saved[spec.name] ?? { open: i === 0 } };

		box.addEventListener("pointerdown", () => raise(win), { capture: true });
		close.addEventListener("pointerdown", (e) => e.stopPropagation());
		close.onclick = () => toggle(win);
		btn.onclick = () => toggle(win);
		let from;
		drag(bar, () => { from = { ...win.rect }; }, (dx, dy) => {
			Object.assign(win.state, { x: from.x + dx, y: from.y + dy });
			render(win);
		}, end);
		// the larger of the two relative changes, so the corner follows the pointer either way
		drag(grip, () => { from = { ...win.rect, h: win.rect.h - bar.offsetHeight }; }, (dx, dy) => {
			Object.assign(win.state, { x: from.x, y: from.y, w: Math.max(MIN_W, from.w * Math.max((from.w + dx) / from.w, (from.h + dy) / from.h)) });
			render(win);
		}, end);
		return win;
	});
	el("div", "sep", dock);
	const vr = el("button", "", dock, svg("rectangle-goggles"));
	vr.title = "VR mode";
	vr.onclick = () => {
		keyboard.commit();
		onVR();
	};

	function end() {
		keyboard.commit();
		save();
	}

	function raise(win) {
		if (win.state.z === top) return;
		win.state.z = ++top;
		win.box.style.zIndex = top;
		save();
	}

	function toggle(win) {
		keyboard.commit();
		win.state.open = !win.state.open;
		if (win.state.open) raise(win);
		render(win);
		save();
	}

	// the content size in panel px
	function content(items) {
		return { cw: Math.max(...items.map(([p, x]) => x + p.width)), ch: Math.max(...items.map(([p, , y]) => y + p.height)) };
	}

	// first opening: the first window centered just above the dock, the others right-aligned with the dock just above it,
	// up and left of the previous new window while that one is still open
	function place(win) {
		const { cw, ch } = content(win.spec.layout()), d = dock.getBoundingClientRect();
		const w = Math.min(cw * ZOOM, innerWidth - 2 * MARGIN), h = ch * w / cw + BAR_H;
		if (win === wins[0]) return Object.assign(win.state, { x: (innerWidth - w) / 2, y: d.top - MARGIN - h, w });
		win.cascade = lastNew?.state.open ? lastNew.cascade + 1 : 0;
		lastNew = win;
		Object.assign(win.state, { x: d.right - w - win.cascade * CASCADE, y: d.top - MARGIN - h - win.cascade * CASCADE, w });
	}

	// the stored geometry as shown: zoomed down and moved to fit the browser window. A page loaded in a hidden tab has no
	// size yet: its windows are placed on the first resize.
	function render(win) {
		const { box, body, state } = win;
		box.hidden = !shown || !state.open || !innerWidth;
		dock.children[wins.indexOf(win)].classList.toggle("on", !!state.open);
		if (box.hidden) {
			for (const p of win.panels) p.setScale(1);
			return;
		}
		if (state.x === undefined) place(win);
		const items = win.spec.layout(), { cw, ch } = content(items), barH = win.bar.offsetHeight;
		const zoom = Math.min(state.w / cw, innerWidth / cw, (innerHeight - barH) / ch);
		const w = cw * zoom, h = ch * zoom + barH;
		win.rect = { x: clamp(state.x, 0, innerWidth - w), y: clamp(state.y, 0, innerHeight - h), w, h };
		Object.assign(box.style, { left: win.rect.x + "px", top: win.rect.y + "px", width: w + "px", zIndex: state.z ?? 0 });
		body.style.height = ch * zoom + "px";
		for (const c of body.children) c.hidden = true;
		for (const [panel, x, y] of items) {
			const c = panel.canvas;
			if (!win.panels.has(panel)) {
				win.panels.add(panel);
				body.append(c);
				bindPanel(panel);
			}
			c.hidden = false;
			Object.assign(c.style, { left: x * zoom + "px", top: y * zoom + "px", width: panel.width * zoom + "px", height: panel.height * zoom + "px" });
			panel.setScale(zoom * devicePixelRatio);
		}
	}

	// on: the Desktop View with its windows shown (not hidden by H); also re-places them when their content changed
	function update(on) {
		shown = on;
		dock.hidden = !on;
		for (const win of wins) render(win);
	}

	addEventListener("resize", () => { for (const win of wins) render(win); });
	return { update };
}

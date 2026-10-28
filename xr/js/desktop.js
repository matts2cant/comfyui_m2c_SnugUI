// Desktop View windows: the VR panels' own canvases in floating DOM windows over the 3D view. A title bar (icon, name, close)
// moves a window, its corner grip resizes it (the panels re-flow to the new size at one fixed text size and are drawn at the
// displayed resolution, Panel.setPx), a press raises it. Pointer events go to panel.pointer() in panel px, so the windows take every
// press over them. The dock at the bottom right toggles the windows, then VR mode. Geometry and open state are kept in
// localStorage and pushed back inside the browser window when it is smaller.
import * as ui from "./ui.js";
import * as keyboard from "./keyboard.js";
import { paths } from "./icons.js";

const STORE_KEY = "appmode-xr.desktop";
const SCALE = 0.45; // CSS px per panel px, in every window
const MARGIN = 12, CASCADE = 32;

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

// specs: [{ name, title, icon, size: [w, h], min: [w, h], layout(w, h) -> [[panel, x, y, w, h]] }] in panel px: size is the
// content on first opening, min the smallest the panels' layouts take, layout places them in a w x h content area. Only the
// first one is open on the first visit. note: a panel shown alone at the center while note.mesh.visible (the stage's
// message). onVR: the dock's VR mode button.
export function createDesktop(specs, note, onVR) {
	const saved = load();
	const root = el("div", "desk", document.body);
	const noteBox = el("div", "note", root);
	noteBox.append(note.canvas);
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
		// the panels re-flow under an open edit's toolbar: commit it first. The size stored is the one shown (minimum, browser window).
		drag(grip, () => {
			keyboard.commit();
			from = { ...win.rect };
		}, (dx, dy) => {
			Object.assign(win.state, { x: from.x, y: from.y, w: from.w + dx, h: from.h + dy });
			render(win);
			Object.assign(win.state, { w: win.rect.w, h: win.rect.h });
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

	// first opening: the first window centered just above the dock, the others right-aligned with the dock just above it,
	// up and left of the previous new window while that one is still open
	function place(win) {
		const [cw, ch] = win.spec.size, d = dock.getBoundingClientRect();
		const w = Math.min(cw * SCALE, innerWidth - 2 * MARGIN), h = ch * SCALE + win.bar.offsetHeight;
		if (win === wins[0]) return Object.assign(win.state, { x: (innerWidth - w) / 2, y: d.top - MARGIN - h, w, h });
		win.cascade = lastNew?.state.open ? lastNew.cascade + 1 : 0;
		lastNew = win;
		Object.assign(win.state, { x: d.right - w - win.cascade * CASCADE, y: d.top - MARGIN - h - win.cascade * CASCADE, w, h });
	}

	// The stored geometry as shown: at least the window's minimum, at most the browser window, moved inside it. The panels take
	// the content area at SCALE, drawn at the displayed resolution; a hidden window's panels go back to their VR size. A page
	// loaded in a hidden tab has no size yet: its windows are placed on the first resize.
	function render(win) {
		const { box, body, state, spec } = win;
		box.hidden = !shown || !state.open || !innerWidth;
		dock.children[wins.indexOf(win)].classList.toggle("on", !!state.open);
		if (box.hidden) {
			for (const p of win.panels) p.setPx();
			return;
		}
		if (state.x === undefined) place(win);
		const barH = win.bar.offsetHeight, [minW, minH] = spec.min;
		const w = Math.max(minW * SCALE, Math.min(state.w, innerWidth)), h = Math.max(minH * SCALE + barH, Math.min(state.h, innerHeight));
		win.rect = { x: clamp(state.x, 0, innerWidth - w), y: clamp(state.y, 0, innerHeight - h), w, h };
		Object.assign(box.style, { left: win.rect.x + "px", top: win.rect.y + "px", width: w + "px", zIndex: state.z ?? 0 });
		body.style.height = h - barH + "px";
		for (const c of body.children) c.hidden = true;
		for (const [panel, x, y, pw, ph] of spec.layout(Math.round(w / SCALE), Math.round((h - barH) / SCALE))) {
			const c = panel.canvas;
			if (!win.panels.has(panel)) {
				win.panels.add(panel);
				body.append(c);
				bindPanel(panel);
			}
			c.hidden = false;
			Object.assign(c.style, { left: x * SCALE + "px", top: y * SCALE + "px", width: pw * SCALE + "px", height: ph * SCALE + "px" });
			panel.setPx(pw, ph, SCALE * devicePixelRatio);
		}
	}

	function renderNote() {
		noteBox.hidden = !shown || !note.mesh.visible;
		if (noteBox.hidden) return;
		note.setPx(note.width, note.height, SCALE * devicePixelRatio);
		Object.assign(note.canvas.style, { width: note.width * SCALE + "px", height: note.height * SCALE + "px" });
	}

	// on: the Desktop View with its windows shown (not hidden by H); also re-places them when their content changed
	function update(on) {
		shown = on;
		dock.hidden = !on;
		for (const win of wins) render(win);
		renderNote();
	}

	addEventListener("resize", () => {
		for (const win of wins) render(win);
		renderNote();
	});
	return { update };
}

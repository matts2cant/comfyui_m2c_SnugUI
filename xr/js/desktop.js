// Desktop View windows: the VR panels' own canvases in floating DOM windows over the 3D view. A title bar (icon, name, close)
// moves a window, its corner grip resizes it (the panel re-flows to the new size at one fixed text size and is drawn at the
// displayed resolution, Panel.setPx), a press raises it. Pointer events go to panel.pointer() in panel px, so the windows take every
// press over them. The deck in the bottom-right corner, above every window, holds the toolbar (whose buttons toggle the
// windows), the output row over it and the output pop-up over the cog, without chrome. Geometry and open state are kept in
// localStorage and pushed back inside the browser window when it is smaller.
import * as ui from "./ui.js";
import * as keyboard from "./keyboard.js";
import { paths } from "./icons.js";

const STORE_KEY = "appmode-xr.desktop";
const SCALE = 0.45; // CSS px per panel px, in every window
const MARGIN = 12, CASCADE = 32, EDGE = 16, DECK_GAP = 8;

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

// specs: [{ name, title, icon, button, panel, minW, minH(w) }]: button is the toolbar's, lit while the window is open; panel its
// content, at its VR size on first opening; minW / minH(w) the smallest its layout takes in panel px (minH at the content width
// w). Only the first one is open on the first visit. note: a panel shown alone at the center while note.mesh.visible (the
// stage's message). deck: { toolbar, row, popup, cog } panels (and the row's cog widget); row.mesh.visible / popup.mesh.visible
// say whether they are shown.
export function createDesktop(specs, note, { toolbar, row, popup, cog }) {
	const saved = load();
	const root = el("div", "desk", document.body);
	const noteBox = el("div", "note", root);
	noteBox.append(note.canvas);
	const deck = el("div", "deck", document.body);
	deck.append(row.canvas, toolbar.canvas, popup.canvas);
	popup.canvas.className = "popup";
	for (const p of [toolbar, row, popup]) bindPanel(p);
	// keep the edit's focused textarea (or the on-screen keyboard) while pressing the windows and the deck
	for (const layer of [root, deck]) {
		layer.addEventListener("mousedown", (e) => { if (keyboard.isEditing()) e.preventDefault(); });
		layer.addEventListener("pointerdown", (e) => { if (keyboard.isEditing() && e.pointerType === "touch") e.preventDefault(); });
		layer.addEventListener("contextmenu", (e) => e.preventDefault());
	}
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
		close.title = "Close";
		body.append(spec.panel.canvas);
		bindPanel(spec.panel);
		const win = { spec, box, bar, body, rect: null, state: saved[spec.name] ?? { open: i === 0 } };

		box.addEventListener("pointerdown", () => raise(win), { capture: true });
		close.addEventListener("pointerdown", (e) => e.stopPropagation());
		close.onclick = () => toggle(win);
		let from;
		drag(bar, () => { from = { ...win.rect }; }, (dx, dy) => {
			Object.assign(win.state, { x: from.x + dx, y: from.y + dy });
			render(win);
		}, end);
		// the panel re-flows under an open edit's toolbar: commit it first. The size stored is the one shown (minimum, browser window).
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

	// first opening: the first window centered just above the deck (the output row, else the toolbar), the others right-aligned
	// with the deck just above it, up and left of the previous new window while that one is still open
	function place(win) {
		const { panel } = win.spec, d = deck.getBoundingClientRect();
		const w = Math.min(panel.width * SCALE, innerWidth - 2 * MARGIN), h = panel.height * SCALE + win.bar.offsetHeight;
		if (win === wins[0]) return Object.assign(win.state, { x: (innerWidth - w) / 2, y: d.top - MARGIN - h, w, h });
		win.cascade = lastNew?.state.open ? lastNew.cascade + 1 : 0;
		lastNew = win;
		Object.assign(win.state, { x: d.right - w - win.cascade * CASCADE, y: d.top - MARGIN - h - win.cascade * CASCADE, w, h });
	}

	// The stored geometry as shown: at least the window's minimum, at most the browser window, moved inside it. The panel takes
	// the content area at SCALE, drawn at the displayed resolution; a hidden window's panel goes back to its VR size. A page
	// loaded in a hidden tab has no size yet: its windows are placed on the first resize.
	function render(win) {
		const { box, body, state, spec } = win;
		box.hidden = !shown || !state.open || !innerWidth;
		if (shown) {
			spec.button.toggled = !!state.open;
			spec.button.invalidate();
		}
		if (box.hidden) return spec.panel.setPx();
		if (state.x === undefined) place(win);
		const barH = win.bar.offsetHeight, w = Math.max(spec.minW * SCALE, Math.min(state.w, innerWidth));
		const h = Math.max(spec.minH(Math.round(w / SCALE)) * SCALE + barH, Math.min(state.h, innerHeight));
		win.rect = { x: clamp(state.x, 0, innerWidth - w), y: clamp(state.y, 0, innerHeight - h), w, h };
		Object.assign(box.style, { left: win.rect.x + "px", top: win.rect.y + "px", width: w + "px", zIndex: state.z ?? 0 });
		body.style.height = h - barH + "px";
		const pw = Math.round(w / SCALE), ph = Math.round((h - barH) / SCALE);
		Object.assign(spec.panel.canvas.style, { width: pw * SCALE + "px", height: ph * SCALE + "px" });
		spec.panel.setPx(pw, ph, SCALE * devicePixelRatio);
	}

	// pinned EDGE px from the bottom-right corner, scaled down as a whole to fit the browser window's width; the pop-up's right
	// edge over the cog's, just above the row. Hidden, they go back to their VR size.
	function renderDeck() {
		deck.hidden = !shown;
		row.canvas.hidden = !row.mesh.visible;
		popup.canvas.hidden = !popup.mesh.visible;
		for (const p of [toolbar, row, popup]) if (deck.hidden || p.canvas.hidden) p.setPx();
		if (deck.hidden) return;
		const k = Math.min(1, (innerWidth - 2 * EDGE) / (toolbar.width * SCALE));
		deck.style.transform = `scale(${k})`;
		for (const p of [toolbar, row, popup]) {
			if (p.canvas.hidden) continue;
			Object.assign(p.canvas.style, { width: p.width * SCALE + "px", height: p.height * SCALE + "px" });
			p.setPx(p.width, p.height, SCALE * devicePixelRatio * k);
		}
		Object.assign(popup.canvas.style, {
			right: (row.width - cog.x - cog.w) * SCALE + "px",
			bottom: (toolbar.height + row.height) * SCALE + 2 * DECK_GAP + "px",
		});
	}

	function renderNote() {
		noteBox.hidden = !shown || !note.mesh.visible;
		if (noteBox.hidden) return;
		note.setPx(note.width, note.height, SCALE * devicePixelRatio);
		Object.assign(note.canvas.style, { width: note.width * SCALE + "px", height: note.height * SCALE + "px" });
	}

	// on: the Desktop View with its windows shown (not hidden by H); also re-places them when their content changed. The deck
	// goes first: the windows' first placement is measured from it.
	function update(on) {
		shown = on;
		renderDeck();
		for (const win of wins) render(win);
		renderNote();
	}

	addEventListener("resize", () => update(shown));
	return { update, toggle: (name) => toggle(wins.find((w) => w.spec.name === name)) };
}

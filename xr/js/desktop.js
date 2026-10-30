// Desktop View windows: the VR panels' own canvases in floating DOM windows over the 3D view. A title bar (icon, name, close)
// moves a window, its corner grip resizes it (the panel re-flows to the new size at one fixed text size and is drawn at the
// displayed resolution, Panel.setPx), a press raises it. Pointer events go to panel.pointer() in panel px, so the windows take every
// press over them. The deck, pinned to a corner or edge (the Configuration panel's toolbar position) above every window, holds
// the toolbar (whose buttons toggle the windows), the output row beside it and the output pop-up by the cog, without chrome.
// Geometry and open state are kept in localStorage and pushed back inside the browser window when it is smaller.
// This module also decides the layout: phones (a narrow window, or a short landscape one) get no windows but phone.js's host.
// EDGE, MARGIN, CASCADE and DECK_GAP are CSS px (dom.js has the units).
import * as ui from "./ui.js";
import * as keyboard from "./keyboard.js";
import { paths } from "./icons.js";
import { adopt, bindPanel, clamp, el, keepEdit, sizePanel } from "./dom.js";
import { createPhone } from "./phone.js";

const STORE_KEY = "appmode-xr.desktop";
const SCALE = 0.45; // CSS px per panel px, in every window
const MARGIN = 12, CASCADE = 32, EDGE = 16, DECK_GAP = 8;
const PHONE_W = 600, LANDSCAPE_H = 500; // phones: portrait under PHONE_W wide, landscape when wider than tall and under LANDSCAPE_H

const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name]}"/></svg>`;

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

function load() {
	try {
		return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {};
	} catch {
		return {};
	}
}

// specs: [{ name, title, icon, button, panel, minW, minH(w) }]: button is the toolbar's, lit while the window is open; panel
// its content, at its VR size on first opening; minW / minH(w) the smallest its layout takes in panel px (minH at the content
// width w). Only the first one is open on the first visit (on phones: at page load). note: a panel shown alone at the center of
// the image while shows.note (the stage's message). deck: { toolbar, shows, row, popup, rowH, cogRect, at, ... }: the toolbar, row
// and pop-up panels; shows: center's { row, popup, note }, what has something to show; rowH: the row's tallest (panel px);
// cogRect(): the cog's box in the row (panel px); at() -> "<top|bottom>-<left|center|right>", where the deck is pinned; the rest
// is for phone.js (createPhone). relayout: main.js's layout pass, which calls update(); the browser window's and the hosts' own
// changes go through it.
export function createDesktop(specs, note, deck, relayout) {
	const { toolbar, shows, row, popup, rowH, cogRect, at } = deck;
	const saved = load();
	const root = el("div", "desk", document.body);
	const noteBox = el("div", "note", root);
	noteBox.append(note.canvas);
	const deckBox = el("div", "deck", document.body);
	deckBox.style.gap = DECK_GAP + "px";
	deckBox.append(row.canvas, toolbar.canvas, popup.canvas);
	popup.canvas.className = "popup";
	const phone = createPhone(specs, deck, relayout);
	const isPhone = () => !!layout;
	for (const p of [toolbar, row, popup]) bindPanel(p, isPhone);
	for (const layer of [root, deckBox]) keepEdit(layer);
	let shown = false, lastNew = null, layout = null; // layout: "portrait" | "landscape" on phones (phone.js), else null
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
		bindPanel(spec.panel, isPhone);
		// radius: the panel's own, which a phone squares while it hosts it
		const win = { spec, box, bar, body, rect: null, radius: spec.panel.radius, state: saved[spec.name] ?? { open: i === 0 } };

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
		if (layout) return phone.toggle(win.spec.name);
		win.state.open = !win.state.open;
		if (win.state.open) raise(win);
		render(win);
		save();
	}

	// first opening: the first window centered just beyond the deck (above it at the bottom, under it at the top), the others
	// aligned with the deck's side just beyond it, CASCADE further from its side and from it than the previous new window while
	// that one is still open (only further from it when centered). At most as tall as the space beyond the deck. The deck is the
	// toolbar plus room for the output row at its tallest (rowH): the row's tiles come with the snapshot, after this.
	function place(win) {
		const { panel } = win.spec, [edge, side] = at().split("-"), t = toolbar.canvas.getBoundingClientRect();
		const room = (rowH * SCALE + DECK_GAP) * t.height / (toolbar.height * SCALE);
		const d = { left: t.left, right: t.right, top: t.top - room, bottom: t.bottom + room };
		const w = Math.min(panel.width * SCALE, innerWidth - 2 * MARGIN);
		const h = Math.min(panel.height * SCALE + win.bar.offsetHeight, (edge === "top" ? innerHeight - d.bottom : d.top) - 2 * MARGIN);
		const y = (c) => edge === "top" ? d.bottom + MARGIN + c : d.top - MARGIN - h - c;
		if (win === wins[0]) return Object.assign(win.state, { x: (innerWidth - w) / 2, y: y(0), w, h });
		win.cascade = lastNew?.state.open ? lastNew.cascade + 1 : 0;
		lastNew = win;
		const c = win.cascade * CASCADE;
		Object.assign(win.state, { x: side === "left" ? d.left + c : side === "right" ? d.right - w - c : (d.left + d.right - w) / 2, y: y(c), w, h });
	}

	// The stored geometry as shown: at least the window's minimum, at most the browser window, moved inside it. The panel takes
	// the content area at SCALE, drawn at the displayed resolution; a hidden window's panel goes back to its VR size. A page
	// loaded in a hidden tab has no size yet: its windows are placed on the first resize.
	function render(win) {
		const { box, body, state, spec } = win;
		box.hidden = !shown || !!layout || !state.open || !innerWidth;
		if (shown && !layout) {
			spec.button.toggled = !!state.open;
			spec.button.invalidate();
		}
		if (layout && spec.name === phone.sheet()) return; // phone.js hosts it
		if (spec.panel.radius !== win.radius) {
			spec.panel.radius = win.radius;
			spec.panel.invalidate();
		}
		adopt(body, spec.panel.canvas);
		if (box.hidden) return spec.panel.setPx();
		if (state.x === undefined) place(win);
		const barH = win.bar.offsetHeight, w = Math.max(spec.minW * SCALE, Math.min(state.w, innerWidth));
		const h = Math.max(spec.minH(Math.round(w / SCALE)) * SCALE + barH, Math.min(state.h, innerHeight));
		win.rect = { x: clamp(state.x, 0, innerWidth - w), y: clamp(state.y, 0, innerHeight - h), w, h };
		Object.assign(box.style, { left: win.rect.x + "px", top: win.rect.y + "px", width: w + "px", zIndex: state.z ?? 0 });
		body.style.height = h - barH + "px";
		sizePanel(spec.panel, Math.round(w / SCALE), Math.round((h - barH) / SCALE), SCALE);
	}

	// pinned EDGE px from at()'s edges (centered: in the middle), scaled down about that point as a whole to fit the browser
	// window's width. The output row is aligned with the toolbar on that side, the pop-up just beyond the row (mirrored at the
	// top), its right edge over the cog's (its left edge on the left). Hidden, they go back to their VR size.
	function renderDeck() {
		deckBox.hidden = !shown || !!layout;
		if (layout) return;
		adopt(deckBox, row.canvas, toolbar.canvas, popup.canvas);
		toolbar.canvas.hidden = false;
		row.canvas.hidden = !shows.row;
		popup.canvas.hidden = !shows.popup;
		for (const p of [toolbar, row, popup]) if (deckBox.hidden || p.canvas.hidden) p.setPx();
		if (deckBox.hidden) return;
		const [edge, side] = at().split("-"), far = edge === "top" ? "bottom" : "top";
		const align = { left: 0, center: 0.5, right: 1 }[side], k = Math.min(1, (innerWidth - 2 * EDGE) / (toolbar.width * SCALE));
		Object.assign(deckBox.style, {
			[edge]: EDGE + "px", [far]: "", left: [EDGE + "px", "50%", ""][align * 2], right: side === "right" ? EDGE + "px" : "",
			flexDirection: edge === "top" ? "column-reverse" : "column", alignItems: ["flex-start", "center", "flex-end"][align * 2],
			transformOrigin: `${side} ${edge}`, transform: `${side === "center" ? "translateX(-50%) " : ""}scale(${k})`,
		});
		for (const p of [toolbar, row, popup]) if (!p.canvas.hidden) sizePanel(p, p.width, p.height, SCALE, k);
		const cog = cogRect(), cogX = (toolbar.width - row.width) * align + cog.x;
		Object.assign(popup.canvas.style, {
			left: (side === "left" ? cogX : cogX + cog.w - popup.width) * SCALE + "px",
			[edge]: (toolbar.height + row.height) * SCALE + 2 * DECK_GAP + "px", [far]: "",
		});
	}

	// the image's box (CSS px): the whole window but on phones
	const stage = () => phone.stage() ?? { x: 0, y: 0, w: innerWidth, h: innerHeight };

	// centered on the image, scaled down to fit it
	function renderNote() {
		noteBox.hidden = !shown || !shows.note;
		if (noteBox.hidden) return;
		const s = stage(), k = Math.min(SCALE, (s.w - 2 * EDGE) / note.width);
		sizePanel(note, note.width, note.height, k);
		Object.assign(noteBox.style, { left: s.x + s.w / 2 + "px", top: s.y + s.h / 2 + "px" });
	}

	// on: the Desktop View with its windows shown (not hidden by H); also re-places them when their content changed. Phones:
	// narrower than PHONE_W (portrait), or wider than tall and shorter than LANDSCAPE_H (landscape), hosted by phone.js, which goes
	// first (it hands the toolbar back when leaving), then the deck: the windows' first placement is measured from it.
	function update(on) {
		shown = on;
		layout = on && (innerWidth < PHONE_W ? "portrait" : innerWidth > innerHeight && innerHeight < LANDSCAPE_H ? "landscape" : null) || null;
		phone.render(layout);
		renderDeck();
		for (const win of wins) render(win);
		renderNote();
	}

	addEventListener("resize", relayout);
	// the phone keyboard comes and goes with the visual viewport
	for (const type of ["resize", "scroll"]) visualViewport.addEventListener(type, () => { if (layout) relayout(); });
	return {
		update, stage, toggle: (name) => toggle(wins.find((w) => w.spec.name === name)),
		closeTray: phone.closeTray, toggleTray: phone.toggleTray, toast: phone.toast,
	};
}

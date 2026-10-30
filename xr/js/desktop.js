// Desktop View windows: the VR panels' own canvases in floating DOM windows over the 3D view. A title bar (icon, name, close)
// moves a window, its corner grip resizes it (the panel re-flows to the new size at one fixed text size and is drawn at the
// displayed resolution, Panel.setPx), a press raises it. Pointer events go to panel.pointer() in panel px, so the windows take every
// press over them. The deck, pinned to a corner or edge (the Configuration panel's toolbar position) above every window, holds
// the toolbar (whose buttons toggle the windows), the output row beside it and the output pop-up by the cog, without chrome.
// Geometry and open state are kept in localStorage and pushed back inside the browser window when it is smaller.
// Phones (a narrow window, or a short landscape one) get no windows: one panel at a time over the image, and a dock.
// Units: CSS px (the page; EDGE, MARGIN, CASCADE, DECK_GAP), panel px (a panel's layout, its widgets, toolbar.js's PM / PB / BAR),
// and canvas px = panel px x panel.scale; SCALE and PHONE are CSS px per panel px.
import * as ui from "./ui.js";
import * as keyboard from "./keyboard.js";
import { paths } from "./icons.js";
import { PB } from "./panels/toolbar.js";
import { TILE_GAP, TILE_R } from "./panels/center.js";

const STORE_KEY = "appmode-xr.desktop";
const SCALE = 0.45; // CSS px per panel px, in every window
const MARGIN = 12, CASCADE = 32, EDGE = 16, DECK_GAP = 8;
const PHONE = 0.6; // phones: CSS px per panel px
const PHONE_W = 600, LANDSCAPE_H = 500; // phones: portrait under PHONE_W wide, landscape when wider than tall and under LANDSCAPE_H
const TOAST_MS = 4000; // phones: error toast

const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name]}"/></svg>`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// moves the elements into parent, in order, unless they are there already (a move would drop their pointer capture)
function adopt(parent, ...els) {
	for (const e of els) if (e.parentNode !== parent) parent.append(e);
}

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
// starts an edit opens the on-screen keyboard (keyboard.js's XR path on tablets, the textarea itself on phones), the press
// being the user activation it needs.
function bindPanel(panel, phone) {
	const c = panel.canvas;
	let outside = false, field = null;
	const at = (e) => {
		const r = c.getBoundingClientRect();
		return [(e.clientX - r.left) * panel.width / r.width, (e.clientY - r.top) * panel.height / r.height];
	};
	c.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		c.setPointerCapture(e.pointerId);
		keyboard.setXR(e.pointerType === "touch" && !phone());
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

// specs: [{ name, title, icon, button, panel, minW, minH(w) }]: button is the toolbar's, lit while the window is open; panel
// its content, at its VR size on first opening; minW / minH(w) the smallest its layout takes in panel px (minH at the content
// width w). Only the first one is open on the first visit (on phones: at page load). note: a panel shown alone at the center of
// the image while shows.note (the stage's message). deck: { toolbar, tabs, phone, shows, row, popup, pick, rowH, rowTile, cogRect,
// closePopup, ringPick, at }: the toolbar, row and pop-up panels; shows: center's { row, popup, note }, what has something to
// show; rowH: the row's tallest (panel px); cogRect(): the cog's box in the row (panel px); at() ->
// "<top|bottom>-<left|center|right>", where the deck is pinned; for phones, the toolbar's tab bar (tabs) and layouts
// (phone(mode, slot)), the output button (pick, ringed by ringPick(on) while the tray is open), the row's tile size and direction
// (rowTile(size, vertical)). relayout: main.js's layout pass, which calls update(); the browser window's and the phones' own
// changes go through it.
export function createDesktop(specs, note, { toolbar, tabs, phone: toolbarPhone, shows, row, popup, pick, rowH, rowTile, cogRect, closePopup, ringPick, at }, relayout) {
	const saved = load();
	const root = el("div", "desk", document.body);
	const noteBox = el("div", "note", root);
	noteBox.append(note.canvas);
	const deck = el("div", "deck", document.body);
	deck.style.gap = DECK_GAP + "px";
	deck.append(row.canvas, toolbar.canvas, popup.canvas);
	popup.canvas.className = "popup";
	pick.canvas.className = "pick";
	const phone = el("div", "phone", document.body), strip = el("div", "strip", phone), pad = el("div", "pad", phone), toast = el("div", "toast", phone);
	toast.hidden = true;
	strip.style.borderRadius = (TILE_R + TILE_GAP) * PHONE + "px"; // around the tiles' corners, the padding further out
	const isPhone = () => !!layout;
	for (const p of [toolbar, tabs, row, popup, pick]) bindPanel(p, isPhone);
	// the tray closes on a press anywhere but on it, its pop-up and the output button
	addEventListener("pointerdown", (e) => { if (![strip, popup.canvas, pick.canvas].some((n) => n.contains(e.target))) closeTray(); }, true);
	let tray = false; // phones: the output row open as the tray
	// keep the edit's focused textarea (or the on-screen keyboard) while pressing the windows, the deck and the phone layout
	for (const layer of [root, deck, phone]) {
		layer.addEventListener("mousedown", (e) => { if (keyboard.isEditing()) e.preventDefault(); });
		layer.addEventListener("pointerdown", (e) => { if (keyboard.isEditing() && e.pointerType === "touch") e.preventDefault(); });
		layer.addEventListener("contextmenu", (e) => e.preventDefault());
	}
	let shown = false, lastNew = null;
	let layout = null, sheet = specs[0].name, bars = null, gap = 0, stage = null, toastTimer = 0; // phones: "portrait" | "landscape", the open panel, the toolbar's sizes, its margin (CSS px), the image's box
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
		// phones: one panel at a time, a tap on the open one closes it (and the tray)
		if (layout) {
			setTray(false);
			sheet = sheet === win.spec.name ? null : win.spec.name;
			return relayout();
		}
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
		if (shown) {
			spec.button.toggled = layout ? spec.name === sheet : !!state.open;
			spec.button.invalidate();
		}
		if (layout && spec.name === sheet) return; // renderPhone hosts it
		spec.panel.radius = ui.theme.radius; // square on phones
		adopt(body, spec.panel.canvas);
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

	// pinned EDGE px from at()'s edges (centered: in the middle), scaled down about that point as a whole to fit the browser
	// window's width. The output row is aligned with the toolbar on that side, the pop-up just beyond the row (mirrored at the
	// top), its right edge over the cog's (its left edge on the left). Hidden, they go back to their VR size.
	function renderDeck() {
		deck.hidden = !shown || !!layout;
		if (layout) return;
		adopt(deck, row.canvas, toolbar.canvas, popup.canvas);
		toolbar.canvas.hidden = false;
		row.canvas.hidden = !shows.row;
		popup.canvas.hidden = !shows.popup;
		for (const p of [toolbar, row, popup]) if (deck.hidden || p.canvas.hidden) p.setPx();
		if (deck.hidden) return;
		const [edge, side] = at().split("-"), far = edge === "top" ? "bottom" : "top";
		const align = { left: 0, center: 0.5, right: 1 }[side], k = Math.min(1, (innerWidth - 2 * EDGE) / (toolbar.width * SCALE));
		Object.assign(deck.style, {
			[edge]: EDGE + "px", [far]: "", left: [EDGE + "px", "50%", ""][align * 2], right: side === "right" ? EDGE + "px" : "",
			flexDirection: edge === "top" ? "column-reverse" : "column", alignItems: ["flex-start", "center", "flex-end"][align * 2],
			transformOrigin: `${side} ${edge}`, transform: `${side === "center" ? "translateX(-50%) " : ""}scale(${k})`,
		});
		for (const p of [toolbar, row, popup]) {
			if (p.canvas.hidden) continue;
			Object.assign(p.canvas.style, { width: p.width * SCALE + "px", height: p.height * SCALE + "px" });
			p.setPx(p.width, p.height, SCALE * devicePixelRatio * k);
		}
		const cog = cogRect(), cogX = (toolbar.width - row.width) * align + cog.x;
		Object.assign(popup.canvas.style, {
			left: (side === "left" ? cogX : cogX + cog.w - popup.width) * SCALE + "px",
			[edge]: (toolbar.height + row.height) * SCALE + 2 * DECK_GAP + "px", [far]: "",
		});
	}

	// a panel at PHONE scale in the CSS px box [x, y, w, h], re-flowed to it; no box: hidden, back to its VR size
	function put(p, box) {
		p.canvas.hidden = !box;
		if (!box) return p.setPx();
		const [x, y, w, h] = box, pw = Math.round(w / PHONE), ph = Math.round(h / PHONE);
		Object.assign(p.canvas.style, { left: x + "px", top: y + "px", width: pw * PHONE + "px", height: ph * PHONE + "px" });
		p.setPx(pw, ph, PHONE * devicePixelRatio);
	}

	const boxStyle = (e, [x, y, w, h]) => Object.assign(e.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });

	// Phones, inside the safe area (the phone layer's padding is env(safe-area-inset-*)). Portrait: the image over the dock (toolbar
	// over the tab bar) pinned to the bottom; the open panel takes all the room above the dock, edge to edge, over the image; with
	// the keyboard up (the visual viewport ends above the window) it ends on it and the dock hides. Landscape: the image left of
	// the dock along the right edge (the toolbar's run column, then the tab rail); the open panel takes all the room left of it;
	// with the keyboard up the whole width above it. The tray (the output row, opened from the output button in the toolbar's
	// slot) sits over the panel or the image just above the dock (portrait, a row scrolling sideways) or left of it (landscape, a
	// column scrolling vertically), its edges and padding the toolbar's margin (gap), so it lines up with the dock's buttons.
	function renderPhone() {
		phone.hidden = !layout;
		stage = null;
		if (!layout) return;
		const cs = getComputedStyle(phone), [t, r, b, l] = ["Top", "Right", "Bottom", "Left"].map((s) => parseFloat(cs["padding" + s]));
		const W = innerWidth, H = innerHeight, vv = visualViewport, end = vv.offsetTop + vv.height;
		const kb = keyboard.isEditing() && H - end > 1, top = kb ? Math.max(t, vv.offsetTop) : t;
		const spec = specs.find((s) => s.name === sheet), th = bars.size * PHONE, bar = bars.bar * PHONE;
		adopt(phone, toolbar.canvas, tabs.canvas, popup.canvas, pick.canvas);
		adopt(strip, row.canvas);
		if (spec) adopt(phone, spec.panel.canvas);
		let sheetBox = null, stripBox = null, toolbarBox = null, tabsBox = null, padBox = null;
		if (layout === "portrait") {
			const w = W - l - r, y = kb ? end : H - b - th - bar, rh = tray && shows.row ? row.height * PHONE + 2 * gap : 0;
			if (spec) sheetBox = [l, top, w, y - top];
			if (!kb) {
				toolbarBox = [l, y, w, th];
				tabsBox = [l, H - b - bar, w, bar];
				padBox = [0, H - b, W, b];
				if (rh) stripBox = [l + gap, y - gap - rh, w - 2 * gap, rh];
			}
			stage = { x: l, y: top, w, h: Math.max(1, y - top) };
		} else {
			const h = H - t - b, x = W - r - th - bar, rw = tray && shows.row ? row.width * PHONE + 2 * gap : 0;
			toolbarBox = [x, t, th, h];
			tabsBox = [x + th, t, bar, h];
			padBox = [x, 0, W - x, H]; // under the dock, over the insets
			if (spec) sheetBox = [l, t, x - l, h];
			if (rw) stripBox = [x - gap - rw, t + gap, rw, h - 2 * gap];
			stage = { x: l, y: t, w: Math.max(1, x - l), h };
			if (kb) {
				sheetBox = [l, top, W - l - r, end - top];
				stripBox = toolbarBox = tabsBox = padBox = null;
			}
		}
		if (spec) {
			spec.panel.radius = 0;
			put(spec.panel, sheetBox);
		}
		put(toolbar, toolbarBox);
		put(tabs, tabsBox);
		const { x, y, s } = bars.slot;
		put(pick, shows.row && toolbarBox && [toolbarBox[0] + x * PHONE, toolbarBox[1] + y * PHONE, s * PHONE, s * PHONE]);
		pad.hidden = !padBox;
		if (padBox) boxStyle(pad, padBox);
		Object.assign(toast.style, { left: stage.x + stage.w / 2 + "px", top: stage.y + stage.h - gap + "px", maxWidth: stage.w - 4 * gap + "px" });
		strip.hidden = !stripBox;
		if (stripBox) {
			boxStyle(strip, stripBox);
			strip.style.borderWidth = gap + "px";
			Object.assign(row.canvas.style, { width: row.width * PHONE + "px", height: row.height * PHONE + "px" });
			row.setPx(row.width, row.height, PHONE * devicePixelRatio);
		} else row.setPx();
		placePopup();
	}

	// Portrait: its right edge over the cog's (inside the window, scaled down when narrower), just over the tray. Landscape: left
	// of the tray (scaled down when narrower), its bottom edge on the cog's (inside the window).
	function placePopup() {
		popup.canvas.hidden = !layout || strip.hidden || !shows.popup;
		if (popup.canvas.hidden) return popup.setPx();
		const s = strip.getBoundingClientRect(), c = row.canvas.getBoundingClientRect(), v = layout === "landscape", cog = cogRect();
		const k = Math.min(PHONE, ((v ? s.left : innerWidth) - 2 * gap) / popup.width), w = popup.width * k, h = popup.height * k;
		boxStyle(popup.canvas, v ? [s.left - gap - w, clamp(c.top + (cog.y + cog.h) * PHONE - h, gap, innerHeight - gap - h), w, h]
			: [clamp(c.left + (cog.x + cog.w) * PHONE - w, gap, innerWidth - gap - w), s.top - gap - h, w, h]);
		popup.setPx(popup.width, popup.height, k * devicePixelRatio);
	}
	strip.addEventListener("scroll", placePopup);

	// Phones: the tray opens and closes from the output button; it also closes on a press elsewhere, Esc (main.js), a tab, and a
	// change of layout (rotation, leaving the phones), always with the pop-up. setTray only sets the state: closeTray / toggleTray
	// also re-place everything (relayout), update() places it in its own pass.
	function setTray(on) {
		tray = on;
		ringPick(on);
		if (!on) closePopup();
	}

	function closeTray() {
		if (!tray) return;
		setTray(false);
		relayout();
	}

	// centered on the image (the whole window but on phones), scaled down to fit it
	function renderNote() {
		noteBox.hidden = !shown || !shows.note;
		if (noteBox.hidden) return;
		const s = stage ?? { x: 0, y: 0, w: innerWidth, h: innerHeight }, k = Math.min(SCALE, (s.w - 2 * EDGE) / note.width);
		note.setPx(note.width, note.height, k * devicePixelRatio);
		Object.assign(note.canvas.style, { width: note.width * k + "px", height: note.height * k + "px" });
		Object.assign(noteBox.style, { left: s.x + s.w / 2 + "px", top: s.y + s.h / 2 + "px" });
	}

	// on: the Desktop View with its windows shown (not hidden by H); also re-places them when their content changed. The deck
	// goes first: the windows' first placement is measured from it. Phones: narrower than 600 px (portrait), or wider than tall
	// and shorter than 500 px (landscape); the output row and the toolbar switch layouts with them, in that order: the toolbar
	// keeps its slot free while the output button shows, which the row's layout decides.
	function update(on) {
		shown = on;
		const mode = on && (innerWidth < PHONE_W ? "portrait" : innerWidth > innerHeight && innerHeight < LANDSCAPE_H ? "landscape" : null) || null;
		const changed = mode !== layout;
		if (changed) {
			layout = mode;
			rowTile(mode && PB, mode === "landscape");
			setTray(false);
			strip.classList.toggle("v", mode === "landscape");
		}
		bars = toolbarPhone(mode, shows.row);
		gap = bars.margin * PHONE;
		if (changed && !mode) toolbar.setPx();
		renderDeck();
		for (const win of wins) render(win);
		renderPhone();
		renderNote();
	}

	addEventListener("resize", relayout);
	// the phone keyboard comes and goes with the visual viewport
	for (const type of ["resize", "scroll"]) visualViewport.addEventListener(type, () => { if (layout) relayout(); });
	return {
		update, toggle: (name) => toggle(wins.find((w) => w.spec.name === name)), closeTray,
		toggleTray: () => {
			setTray(!tray);
			relayout();
		},
		// a message at the foot of the image for TOAST_MS (phones)
		toast: (text) => {
			toast.textContent = text;
			toast.hidden = false;
			clearTimeout(toastTimer);
			toastTimer = setTimeout(() => { toast.hidden = true; }, TOAST_MS);
		},
		// the image's box (CSS px): the whole window but on phones
		stage: () => stage ?? { x: 0, y: 0, w: innerWidth, h: innerHeight },
	};
}

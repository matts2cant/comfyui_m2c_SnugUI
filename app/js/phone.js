// Phone host: on a narrow window, or a short landscape one (desktop.js decides), no windows: one panel at a time over the image,
// and a dock (the toolbar over a tab bar, or its run column beside a rail) holding the output button, which opens the output row
// as a tray.
import * as ui from "./ui.js";
import * as keyboard from "./keyboard.js";
import { adopt, bindPanel, clamp, el, keepEdit, sizePanel } from "./dom.js";
import { TIER_H } from "./panels/toolbar.js";
import { TILE_GAP, TILE_R, COG } from "./panels/center.js";

const PHONE = 0.6; // CSS px per panel px
const TOAST_MS = 4000; // error toast
// the dock's grid is the output row's, so the tray (the row, PM padding) lines up with it: margin PM = the tiles' gap, button PB =
// the cog (the tiles take it too), BAR the tab bar's thickness (and the landscape run column's width); panel px
const PM = TILE_GAP, PB = COG, BAR = PB + 2 * PM;
const gap = PM * PHONE; // every margin, in CSS px

// n buttons along a side len px long, PM from both ends, the rest spread evenly between them (at least PM, the buttons shrink
// below PB when the side is too short for that): the tab bar's columns, the rail's rows and the run column's beside it.
// -> { s: button size, at(i): offset of the i-th }
function spread(len, n) {
	const s = Math.min(PB, (len - (n + 1) * PM) / n), gap = (len - 2 * PM - n * s) / (n - 1);
	return { s, at: (i) => PM + i * (s + gap) };
}

const boxStyle = (e, [x, y, w, h]) => Object.assign(e.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });

// specs: desktop.js's window specs, the panels shown one at a time (`button` lit while open), the first at page load. deck:
// { toolbar, arrange, tabs, shows, row, popup, pick, rowTile, cogRect, closePopup, ringPick }: the toolbar panel and its
// arrange(dock) (the boxes it draws into), main.js's panel buttons (tabs, moved to the tab bar), center's shows ({ row, popup }),
// the row and pop-up panels, the output button (pick, ringed by ringPick(on) while the tray is open), the row's tile size and
// direction (rowTile(size, vertical)), the cog's box in the row (cogRect(), panel px) and closePopup(). relayout: main.js's layout
// pass, which calls desktop.js's update() and so render().
export function createPhone(specs, { toolbar, arrange, tabs, shows, row, popup, pick, rowTile, cogRect, closePopup, ringPick }, relayout) {
	const layer = el("div", "phone", document.body), strip = el("div", "strip", layer), pad = el("div", "pad", layer), toast = el("div", "toast", layer);
	toast.hidden = true;
	strip.style.borderRadius = (TILE_R + PM) * PHONE + "px"; // around the tiles' corners, the padding further out
	pick.canvas.className = "pick";
	// the tab bar (portrait) or rail (landscape) holding main.js's panel buttons, spread along its longer side
	const tabBar = new ui.Panel({ name: "tabs", widthM: BAR / ui.PX_PER_M, heightM: BAR / ui.PX_PER_M, radius: 0 });
	tabBar.onResize = () => {
		const across = tabBar.width >= tabBar.height, { s, at } = spread(across ? tabBar.width : tabBar.height, tabs.length), c = (BAR - s) / 2;
		tabs.forEach((b, i) => Object.assign(b, { x: across ? at(i) : c, y: across ? c : at(i), w: s, h: s }));
	};
	for (const p of [tabBar, pick]) bindPanel(p);
	// the tray closes on a press anywhere but on it, its pop-up and the output button
	addEventListener("pointerdown", (e) => { if (![strip, popup.canvas, pick.canvas].some((n) => n.contains(e.target))) closeTray(); }, true);
	keepEdit(layer);
	// "portrait" | "landscape" | null, the open panel, the output row open as the tray, the image's box (CSS px)
	let mode = null, sheet = specs[0].name, tray = false, stage = null, toastTimer = 0;

	// the boxes (panel px) of the toolbar at w x h on the dock's grid, the output button's slot first in its run row / column while
	// the row has something. Portrait: the status tier PM from every side over the tab bar's columns: Cancel over the first tab (the
	// second, the slot over the first), Generate from the next one to the last. Landscape: on the rail's rows, the status over all
	// but the last three (four with the slot, on the fourth last), Cancel, then Generate over the last two.
	function dock(w, h) {
		const n = tabs.length, i = shows.row ? 1 : 0;
		if (mode === "portrait") {
			const { s, at } = spread(w, n), y = h - PM - s;
			return {
				status: { x: PM, y: PM, w: w - 2 * PM, h: TIER_H }, slot: { x: at(0), y, s },
				cancel: { x: at(i), y, w: s, h: s }, generate: { x: at(i + 1), y, w: at(n - 1) + s - at(i + 1), h: s },
			};
		}
		const { s, at } = spread(h, n), x = (w - s) / 2;
		return {
			vertical: true,
			status: { x: 4, y: PM, w: w - 8, h: at(n - 4 - i) + s - PM }, // the word takes all the width it can
			slot: { x, y: at(n - 4), s }, cancel: { x, y: at(n - 3), w: s, h: s }, generate: { x, y: at(n - 2), w: s, h: at(n - 1) + s - at(n - 2) },
		};
	}

	// a panel at PHONE scale in the CSS px box [x, y, w, h], re-flowed to it; no box: hidden, back to its VR size
	function put(p, box) {
		p.canvas.hidden = !box;
		if (!box) return p.setPx();
		const [x, y, w, h] = box;
		Object.assign(p.canvas.style, { left: x + "px", top: y + "px" });
		sizePanel(p, Math.round(w / PHONE), Math.round(h / PHONE), PHONE);
	}

	// Inside the safe area (the layer's padding is env(safe-area-inset-*)). Portrait: the image over the dock (toolbar over the tab
	// bar) pinned to the bottom; the open panel takes all the room above the dock, edge to edge, over the image; with the keyboard up
	// (the visual viewport ends above the window) it ends on it and the dock hides. Landscape: the image left of the dock along the
	// right edge (the toolbar's run column, then the tab rail); the open panel takes all the room left of it; with the keyboard up
	// the whole width above it. The tray (the output row, opened from the output button in the toolbar's slot) sits over the panel
	// or the image just above the dock (portrait, a row scrolling sideways) or left of it (landscape, a column scrolling
	// vertically), its edges and padding the dock's margin (gap), so it lines up with the dock's buttons.
	function place() {
		const cs = getComputedStyle(layer), [t, r, b, l] = ["Top", "Right", "Bottom", "Left"].map((s) => parseFloat(cs["padding" + s]));
		const W = innerWidth, H = innerHeight, vv = visualViewport, end = vv.offsetTop + vv.height;
		const kb = keyboard.isEditing() && H - end > 1, top = kb ? Math.max(t, vv.offsetTop) : t;
		const spec = specs.find((s) => s.name === sheet), th = (mode === "portrait" ? 3 * PM + TIER_H + PB : BAR) * PHONE, bar = BAR * PHONE;
		adopt(layer, toolbar.canvas, tabBar.canvas, popup.canvas, pick.canvas);
		adopt(strip, row.canvas);
		if (spec) adopt(layer, spec.panel.canvas);
		let sheetBox = null, stripBox = null, toolbarBox = null, tabsBox = null, padBox = null;
		if (mode === "portrait") {
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
			// edge to edge, square (desktop.js's windows round it again)
			if (spec.panel.radius !== 0) {
				spec.panel.radius = 0;
				spec.panel.invalidate();
			}
			put(spec.panel, sheetBox);
		}
		put(toolbar, toolbarBox);
		put(tabBar, tabsBox);
		const slot = toolbarBox && dock(toolbar.width, toolbar.height).slot;
		put(pick, shows.row && slot && [toolbarBox[0] + slot.x * PHONE, toolbarBox[1] + slot.y * PHONE, slot.s * PHONE, slot.s * PHONE]);
		pad.hidden = !padBox;
		if (padBox) boxStyle(pad, padBox);
		Object.assign(toast.style, { left: stage.x + stage.w / 2 + "px", top: stage.y + stage.h - gap + "px", maxWidth: stage.w - 4 * gap + "px" });
		strip.hidden = !stripBox;
		if (stripBox) {
			boxStyle(strip, stripBox);
			strip.style.borderWidth = gap + "px";
			sizePanel(row, row.width, row.height, PHONE);
		} else row.setPx();
		placePopup();
	}

	// Portrait: its right edge over the cog's (inside the window, scaled down when narrower), just over the tray. Landscape: left
	// of the tray (scaled down when narrower), its bottom edge on the cog's (inside the window).
	function placePopup() {
		popup.canvas.hidden = !mode || strip.hidden || !shows.popup;
		if (popup.canvas.hidden) return popup.setPx();
		const s = strip.getBoundingClientRect(), c = row.canvas.getBoundingClientRect(), v = mode === "landscape", cog = cogRect();
		const k = Math.min(PHONE, ((v ? s.left : innerWidth) - 2 * gap) / popup.width), w = popup.width * k, h = popup.height * k;
		const [x, y] = v ? [s.left - gap - w, clamp(c.top + (cog.y + cog.h) * PHONE - h, gap, innerHeight - gap - h)]
			: [clamp(c.left + (cog.x + cog.w) * PHONE - w, gap, innerWidth - gap - w), s.top - gap - h];
		Object.assign(popup.canvas.style, { left: x + "px", top: y + "px" });
		sizePanel(popup, popup.width, popup.height, k);
	}
	strip.addEventListener("scroll", placePopup);

	// The tray opens and closes from the output button; it also closes on a press elsewhere, Esc (main.js), a tab, and a change of
	// layout (rotation, leaving the phones), always with the pop-up. setTray only sets the state: closeTray / toggleTray also
	// re-place everything (relayout), render() places it in its own pass.
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

	// m: "portrait" | "landscape", or null (not a phone: everything back to the Desktop View / VR). A change of layout gives the
	// output row its tiles, moves the panel buttons to the tab bar (and back: arrange(null)) and closes the tray; the toolbar then
	// draws into the dock's boxes, its slot free while the output button shows (the row has something).
	function render(m) {
		const changed = m !== mode;
		if (changed) {
			mode = m;
			rowTile(m && PB, m === "landscape");
			setTray(false);
			strip.classList.toggle("v", m === "landscape");
			if (m) {
				for (const b of tabs) if (b.panel !== tabBar) {
					b.panel.remove(b);
					tabBar.add(b);
				}
				tabBar.onResize();
			}
		}
		arrange(m && dock);
		if (changed && !m) toolbar.setPx();
		layer.hidden = !mode;
		stage = null;
		if (!mode) return;
		for (const s of specs) {
			s.button.toggled = s.name === sheet;
			s.button.invalidate();
		}
		place();
	}

	return {
		render, closeTray,
		toggleTray: () => {
			setTray(!tray);
			relayout();
		},
		// a tap on a panel's button: one panel at a time, a tap on the open one closes it (and the tray)
		toggle: (name) => {
			setTray(false);
			sheet = sheet === name ? null : name;
			relayout();
		},
		sheet: () => sheet,
		// the image's box (CSS px) on a phone, else null
		stage: () => stage,
		// a message at the foot of the image for TOAST_MS
		toast: (text) => {
			toast.textContent = text;
			toast.hidden = false;
			clearTimeout(toastTimer);
			toastTimer = setTimeout(() => { toast.hidden = true; }, TOAST_MS);
		},
	};
}

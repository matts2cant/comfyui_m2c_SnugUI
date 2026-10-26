// Canvas-texture UI toolkit: a Panel is a textured plane, widgets draw into its 2D canvas.
//
// Setup: main.js calls setRenderer(renderer) once, before creating panels, so textures get the
// renderer's max anisotropy (crisp text at grazing angles).
// Coordinates: widget x/y/w/h are canvas px in the parent's space (panel, or a ScrollView's content).
// Widget.draw(ctx) is called with ctx translated to the widget's top-left: draw in local 0..w / 0..h.
// Pointer events carry p = { x, y (panel px), lx, ly (widget-local px), id }.
// Subclasses must not use class fields for options: set defaults via super({ ...defaults, ...opts }).
// A wrapping Label computes its own height in relayout(); stackY() calls it after setting w.
// Option callbacks (onClick, onChange, onSelect...) are plain properties, so `new Button({ onClick })`
// simply replaces the default Widget.onClick(p) method.
import * as THREE from "three";
import { commit, editText, erase, showKeyboard } from "./keyboard.js";
import { icons } from "./icons.js";

let maxAnisotropy = 1;
export function setRenderer(renderer) {
	maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
	for (const p of Panel.all) p.texture.anisotropy = maxAnisotropy;
}

export const theme = {
	bg: "#0b0e13", panel: "#161a22", surface: "#242a35", surfaceHi: "#303846", border: "#323a49",
	fg: "#e8ecf2", muted: "#8c96a8", accent: "#4c8dff", danger: "#e5484d",
	pressed: "rgba(0,0,0,0.28)", hover: "rgba(255,255,255,0.1)", // tints over a control
	font: "system-ui, sans-serif", radius: 18,
};

const font = (size, bold) => `${bold ? "600 " : ""}${size}px ${theme.font}`;
const measure = document.createElement("canvas").getContext("2d");

function ellipsize(ctx, text, maxW) {
	if (ctx.measureText(text).width <= maxW) return text;
	let lo = 0, hi = text.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (ctx.measureText(text.slice(0, mid) + "…").width <= maxW) lo = mid; else hi = mid - 1;
	}
	return text.slice(0, lo) + "…";
}

// word-wrapped lines with the index of their first character in `text`
function wrapLines(ctx, text, maxW) {
	const lines = [];
	let pos = 0;
	for (const para of String(text).split("\n")) {
		let line = "", start = pos;
		for (const word of para.split(" ")) {
			const test = line ? line + " " + word : word;
			if (line && ctx.measureText(test).width > maxW) { lines.push({ text: line, start }); start += line.length + 1; line = word; } else line = test;
		}
		lines.push({ text: line, start });
		pos += para.length + 1;
	}
	return lines;
}

// index of the line holding character index idx
function lineAt(lines, idx) {
	let i = 0;
	while (i + 1 < lines.length && lines[i + 1].start <= idx) i++;
	return i;
}

// character index in `text` nearest to pixel x
function colAt(ctx, text, x) {
	let lo = 0, hi = text.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (ctx.measureText(text.slice(0, mid)).width <= x) lo = mid; else hi = mid - 1;
	}
	if (lo < text.length && x - ctx.measureText(text.slice(0, lo)).width > ctx.measureText(text.slice(0, lo + 1)).width - x) lo++;
	return lo;
}

// square-cropped image filling the s x s box at x, y
function drawCover(ctx, img, x, y, s) {
	const k = Math.min(img.naturalWidth, img.naturalHeight);
	ctx.drawImage(img, (img.naturalWidth - k) / 2, (img.naturalHeight - k) / 2, k, k, x, y, s, s);
}

function rrect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.roundRect(x, y, w, h, r);
}

// hover / pressed tint over the current round-rect shape
function tint(ctx, wd, x, y, w, h, r) {
	if (wd.disabled || !(wd.pressed || wd.hover)) return;
	rrect(ctx, x, y, w, h, r);
	ctx.fillStyle = wd.pressed ? theme.pressed : theme.hover;
	ctx.fill();
}

const imageCache = new Map();
function loadImage(url) {
	let p = imageCache.get(url);
	if (!p) {
		p = new Promise((resolve, reject) => {
			const img = new Image();
			img.crossOrigin = "anonymous";
			img.onload = () => resolve(img);
			img.onerror = () => { imageCache.delete(url); reject(new Error("image load failed: " + url)); };
			img.src = url;
		});
		imageCache.set(url, p);
	}
	return p;
}

export class Widget {
	x = 0; y = 0; w = 0; h = 0; visible = true;
	panel = null; parent = null;
	hover = false; pressed = false; disabled = false;
	dragCapture = false; // true: keeps the pointer on drag instead of handing it to a scrolling ancestor

	constructor(opts = {}) { Object.assign(this, opts); }

	draw(ctx) {}
	onDown(p) {}
	onMove(p) {}
	onUp(p) {}
	onClick(p) {}
	onScroll(dy) { return false; }
	canScroll() { return false; }
	relayout() {}
	setPanel(panel) { this.panel = panel; }
	invalidate() { this.panel?.invalidate(); }
	contains(x, y) { return x >= this.x && y >= this.y && x < this.x + this.w && y < this.y + this.h; }
	hitTest(x, y) { return this.visible && this.contains(x, y) ? this : null; }
	// top-left in panel px
	abs() {
		if (!this.parent) return { x: this.x, y: this.y };
		const o = this.parent.origin();
		return { x: o.x + this.x, y: o.y + this.y };
	}
}

export class Label extends Widget {
	constructor(o) {
		super({ text: "", size: 30, color: theme.fg, align: "left", wrap: false, bold: false, autoH: o.h === undefined, ...o });
		this.relayout();
	}
	lineH() { return Math.round(this.size * 1.3); }
	lines() {
		if (!this.wrap || this.w <= 0) return [String(this.text)];
		measure.font = font(this.size, this.bold);
		return wrapLines(measure, this.text, this.w).map((l) => l.text);
	}
	relayout() { if (this.autoH) this.h = this.lines().length * this.lineH() + (this.wrap ? 0 : Math.round(this.size * 0.1)); }
	setText(text) { this.text = text; this.relayout(); this.invalidate(); }
	draw(ctx) {
		ctx.font = font(this.size, this.bold);
		ctx.fillStyle = this.color;
		ctx.textBaseline = "middle";
		ctx.textAlign = this.align;
		const x = this.align === "center" ? this.w / 2 : this.align === "right" ? this.w : 0;
		const lh = this.lineH();
		const lines = this.lines();
		const top = lines.length === 1 ? (this.h - lh) / 2 : 0;
		lines.forEach((line, i) => ctx.fillText(!this.wrap && this.w > 0 ? ellipsize(ctx, line, this.w) : line, x, top + lh * (i + 0.5)));
	}
}

// Lucide icon (icons.js) in the s x s box at x, y, stroked with the current strokeStyle
function drawIcon(ctx, name, x, y, s) {
	ctx.save();
	ctx.translate(x, y);
	ctx.scale(s / 24, s / 24);
	ctx.lineWidth = 2;
	ctx.lineCap = ctx.lineJoin = "round";
	ctx.stroke(icons[name]);
	ctx.restore();
}

// icon: an icons.js name, centered alone or left of the text; round: a circle (or pill)
export class Button extends Widget {
	constructor(o) { super({ text: "", icon: null, round: false, variant: "default", toggled: false, size: 30, w: 200, h: 72, ...o }); }
	draw(ctx) {
		const { w, h } = this, r = this.round ? Math.min(w, h) / 2 : theme.radius * 0.7;
		rrect(ctx, 0, 0, w, h, r);
		ctx.fillStyle = this.toggled || this.variant === "accent" ? theme.accent : this.variant === "danger" ? theme.danger : theme.surface;
		ctx.fill();
		tint(ctx, this, 0, 0, w, h, r);
		ctx.globalAlpha = this.disabled ? 0.4 : 1;
		ctx.fillStyle = ctx.strokeStyle = theme.fg;
		ctx.font = font(this.size, true);
		ctx.textBaseline = "middle";
		const s = Math.round(h * 0.55);
		if (this.icon) drawIcon(ctx, this.icon, this.text ? 18 : (w - s) / 2, (h - s) / 2, s);
		if (this.icon && this.text) {
			ctx.textAlign = "left";
			ctx.fillText(ellipsize(ctx, this.text, w - s - 50), s + 32, h / 2 + 1);
		} else if (this.text) {
			ctx.textAlign = "center";
			ctx.fillText(ellipsize(ctx, this.text, w - 24), w / 2, h / 2 + 1);
		}
		ctx.globalAlpha = 1;
	}
}

export class Toggle extends Widget {
	constructor(o) { super({ label: "", value: false, size: 30, w: 400, h: 72, ...o }); }
	draw(ctx) {
		const { w, h } = this, r = theme.radius * 0.7;
		rrect(ctx, 0, 0, w, h, r);
		ctx.fillStyle = theme.surface;
		ctx.fill();
		tint(ctx, this, 0, 0, w, h, r);
		ctx.font = font(this.size);
		ctx.fillStyle = theme.fg;
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.fillText(ellipsize(ctx, this.label, w - 160), 24, h / 2 + 1);
		const sw = 92, sh = 44, sx = w - sw - 24, sy = (h - sh) / 2;
		rrect(ctx, sx, sy, sw, sh, sh / 2);
		ctx.fillStyle = this.value ? theme.accent : theme.surfaceHi;
		ctx.fill();
		ctx.beginPath();
		ctx.arc(this.value ? sx + sw - sh / 2 : sx + sh / 2, h / 2, sh / 2 - 6, 0, Math.PI * 2);
		ctx.fillStyle = "#fff";
		ctx.fill();
	}
	onClick(p) {
		this.value = !this.value;
		this.onChange?.(this.value);
		this.invalidate();
	}
}

// The value text at the top right is a TextField: tapping it edits the number in place (accepts "," as decimal separator).
export class Slider extends Widget {
	constructor(o) {
		super({ label: "", min: 0, max: 1, step: 0.01, value: 0, drag: true, size: 28, w: 400, h: 124, ...o });
		this.field = new TextField({
			size: this.size, h: 48, parent: this, compact: true,
			onEdit: () => this.field.selectAll(),
			onDone: (v) => {
				const n = Number(v.trim().replace(",", "."));
				if (v.trim() && Number.isFinite(n)) this.set(n);
			},
		});
		this.relayout();
	}
	relayout() { Object.assign(this.field, { x: this.w - 220, w: 220 }); }
	setPanel(panel) { this.panel = this.field.panel = panel; }
	origin() { return this.abs(); }
	hitTest(x, y) {
		const hit = super.hitTest(x, y);
		return hit && this.field.contains(x - this.x, y - this.y) ? this.field : hit;
	}
	// -/+ buttons (plus -- / ++ when bigStep is set) and the track between them
	parts() {
		const bs = 64, gap = 12, y = this.h - bs - 4, big = this.bigStep;
		const left = big ? [[-big, "−−"], [-this.step, "−"]] : [[-this.step, "−"]];
		const right = big ? [[big, "++"], [this.step, "+"]] : [[this.step, "+"]];
		const btns = [];
		let x = 0;
		for (const [d, t] of left) { btns.push({ x, y, w: bs, h: bs, d, t }); x += bs + gap; }
		let rx = this.w;
		for (const [d, t] of right) { rx -= bs; btns.push({ x: rx, y, w: bs, h: bs, d, t }); rx -= gap; }
		return { btns, x0: x, x1: rx, y };
	}
	btnAt(p, parts) { return parts.btns.find((b) => p.lx >= b.x && p.lx < b.x + b.w && p.ly >= b.y && p.ly < b.y + b.h) ?? null; }
	text() {
		if (this.format) return this.format(this.value);
		const dec = (String(this.step).split(".")[1] ?? "").length;
		return Number(this.value).toFixed(dec);
	}
	set(v) {
		v = Math.min(this.max, Math.max(this.min, Math.round((v - this.min) / this.step) * this.step + this.min));
		v = parseFloat(v.toPrecision(12));
		if (v === this.value) return;
		this.value = v;
		this.onChange?.(v);
		this.invalidate();
	}
	setFromX(p, parts) {
		const tx = parts.x0 + 22, tw = parts.x1 - parts.x0 - 44;
		this.set(this.min + (this.max - this.min) * Math.min(1, Math.max(0, (p.lx - tx) / tw)));
	}
	onDown(p) {
		const parts = this.parts();
		this.downBtn = this.btnAt(p, parts);
		this.dragging = this.drag && !this.downBtn && p.ly > parts.y - 12;
		this.dragCapture = this.dragging;
		if (this.dragging) this.setFromX(p, parts);
	}
	onMove(p) {
		const parts = this.parts();
		if (this.dragging) return this.setFromX(p, parts);
		const b = this.btnAt(p, parts);
		if (b !== this.hotBtn) { this.hotBtn = b; this.invalidate(); }
	}
	onUp() { this.dragging = false; }
	onClick(p) {
		const b = this.btnAt(p, this.parts());
		if (b) this.set(this.value + b.d);
	}
	draw(ctx) {
		const { w, h } = this, parts = this.parts();
		ctx.textBaseline = "middle";
		ctx.font = font(this.size);
		ctx.fillStyle = theme.muted;
		ctx.textAlign = "left";
		ctx.fillText(ellipsize(ctx, this.label, w * 0.6), 4, 22);
		const { field } = this;
		if (!field.ta) field.value = this.text();
		if (field.ta || field.hover) {
			ctx.save();
			ctx.translate(field.x, field.y);
			field.draw(ctx);
			ctx.restore();
		} else {
			ctx.font = font(this.size, true);
			ctx.fillStyle = theme.fg;
			ctx.textAlign = "right";
			ctx.fillText(field.value, w - 4, 22);
		}
		const cy = parts.y + 32;
		if (this.drag) {
			const tx = parts.x0 + 22, tw = parts.x1 - parts.x0 - 44;
			const t = (this.value - this.min) / (this.max - this.min || 1);
			rrect(ctx, tx, cy - 6, tw, 12, 6);
			ctx.fillStyle = theme.surfaceHi;
			ctx.fill();
			rrect(ctx, tx, cy - 6, tw * t, 12, 6);
			ctx.fillStyle = theme.accent;
			ctx.fill();
			ctx.beginPath();
			ctx.arc(tx + tw * t, cy, this.dragging ? 26 : 22, 0, Math.PI * 2);
			ctx.fillStyle = "#fff";
			ctx.fill();
		}
		for (const b of parts.btns) {
			rrect(ctx, b.x, b.y, b.w, b.h, 14);
			ctx.fillStyle = theme.surface;
			ctx.fill();
			if (this.hover && b === this.hotBtn || this.pressed && b === this.downBtn) {
				rrect(ctx, b.x, b.y, b.w, b.h, 14);
				ctx.fillStyle = this.pressed ? theme.pressed : theme.hover;
				ctx.fill();
			}
			ctx.font = font(b.t.length > 1 ? 28 : 38, true);
			ctx.fillStyle = theme.fg;
			ctx.textAlign = "center";
			ctx.fillText(b.t, b.x + b.w / 2, b.y + b.h / 2 + 1);
		}
	}
}

class Scrollable extends Widget {
	scroll = 0;
	imgs = new Map();
	// loaded image for url, or null/false while loading/failed; repaints once it arrives
	image(url) {
		let img = this.imgs.get(url);
		if (img === undefined) {
			this.imgs.set(url, null);
			loadImage(url).then((i) => this.imgs.set(url, i), () => this.imgs.set(url, false)).then(() => this.invalidate());
			img = null;
		}
		return img;
	}
	contentH() { return this.h; }
	maxScroll() { return Math.max(0, this.contentH() - this.h); }
	canScroll() { return this.maxScroll() > 0; }
	onScroll(dy) {
		const s = Math.min(this.maxScroll(), Math.max(0, this.scroll + dy));
		const moved = s !== this.scroll;
		this.scroll = s;
		if (moved) this.invalidate();
		return moved;
	}
	clip(ctx, r) {
		this.scroll = Math.min(this.scroll, this.maxScroll());
		rrect(ctx, 0, 0, this.w, this.h, r);
		ctx.clip();
	}
	drawBar(ctx) {
		const max = this.maxScroll();
		if (!max) return;
		const bh = Math.max(40, this.h * this.h / this.contentH());
		rrect(ctx, this.w - 10, (this.h - bh) * this.scroll / max, 6, bh, 3);
		ctx.fillStyle = "rgba(255,255,255,0.28)";
		ctx.fill();
	}
}

export class List extends Scrollable {
	constructor(o) { super({ items: [], selected: undefined, rowH: 72, size: 30, w: 400, h: 400, ...o }); }
	contentH() { return this.items.length * this.rowH; }
	rowAt(p) {
		const i = Math.floor((p.ly + this.scroll) / this.rowH);
		return i >= 0 && i < this.items.length ? i : -1;
	}
	setItems(items) { this.items = items; this.scroll = 0; this.invalidate(); }
	onMove(p) {
		const i = this.rowAt(p);
		if (i !== this.hotRow) { this.hotRow = i; this.invalidate(); }
	}
	onClick(p) {
		const i = this.rowAt(p);
		if (i < 0) return;
		this.selected = this.items[i].value;
		this.onSelect?.(this.items[i], i);
		this.invalidate();
	}
	draw(ctx) {
		const { w, h, rowH } = this;
		this.clip(ctx, theme.radius * 0.7);
		ctx.fillStyle = theme.bg;
		ctx.fillRect(0, 0, w, h);
		ctx.font = font(this.size);
		ctx.textBaseline = "middle";
		const first = Math.floor(this.scroll / rowH), last = Math.min(this.items.length, Math.ceil((this.scroll + h) / rowH));
		for (let i = first; i < last; i++) {
			const it = this.items[i], y = i * rowH - this.scroll;
			const sel = this.selected !== undefined && it.value === this.selected;
			if (sel || this.hover && i === this.hotRow) {
				ctx.fillStyle = sel ? theme.accent : theme.surfaceHi;
				ctx.fillRect(4, y + 2, w - 8, rowH - 4);
			}
			let textX = 20, textW = w - 40;
			if (it.url) {
				const img = this.image(it.url), s = rowH - 12;
				if (img) drawCover(ctx, img, 14, y + 6, s);
				textX = s + 28;
				textW -= s + 8;
			}
			if (it.sub) {
				ctx.font = font(this.size * 0.8);
				ctx.fillStyle = sel ? theme.fg : theme.muted;
				ctx.textAlign = "right";
				const sub = ellipsize(ctx, it.sub, w * 0.3);
				ctx.fillText(sub, w - 24, y + rowH / 2 + 1);
				textW -= ctx.measureText(sub).width + 16;
				ctx.font = font(this.size);
			}
			ctx.fillStyle = theme.fg;
			ctx.textAlign = "left";
			ctx.fillText(ellipsize(ctx, it.label, textW), textX, y + rowH / 2 + 1);
			if (!sel) {
				ctx.fillStyle = theme.border;
				ctx.fillRect(20, y + rowH - 1, w - 40, 1);
			}
		}
		this.drawBar(ctx);
		if (this.outline) {
			rrect(ctx, 0, 0, w, h, theme.radius * 0.7);
			ctx.strokeStyle = theme.accent;
			ctx.lineWidth = 4;
			ctx.stroke();
		}
	}
}

// The toolbar overlaying the panel next to the field being edited (below it, above when there is no room or the
// field sets barAbove): Keyboard opens the system keyboard, Del / arrows / Select all edit the model, Done commits.
// A compact bar only has Keyboard, Del and Done.
export class EditBar extends Widget {
	constructor({ field, compact }) {
		super({ field, size: 26, h: 68 });
		const caret = (d) => {
			const { selectionStart: s, selectionEnd: e, value } = field.ta;
			field.setCaret(s !== e ? (d < 0 ? s : e) : Math.min(value.length, Math.max(0, s + d)));
		};
		const all = [["Keyboard", showKeyboard], ["Del", () => erase()], ["←", () => caret(-1)], ["→", () => caret(1)], ["Select all", () => field.selectAll()], ["Done", commit]];
		this.btns = (compact ? [all[0], all[1], all[5]] : all).map(([text, run]) => ({ text, run, y: 8, h: this.h - 16 }));
		measure.font = font(this.size, true);
		let x = 8;
		for (const b of this.btns) {
			b.x = x;
			b.w = Math.max(72, Math.ceil(measure.measureText(b.text).width) + 40);
			x += b.w + 8;
		}
		this.w = x;
	}

	place() {
		const { panel, field } = this, a = field.abs(), below = a.y + field.h + 6;
		this.x = Math.max(8, Math.min(a.x, panel.width - this.w - 8));
		this.y = !field.barAbove && below + this.h <= panel.height ? below : Math.max(0, a.y - 6 - this.h);
	}

	btnAt(p) { return this.btns.find((b) => p.lx >= b.x && p.lx < b.x + b.w && p.ly >= b.y && p.ly < b.y + b.h); }
	onDown(p) { this.down = this.btnAt(p); }
	onMove(p) {
		const b = this.btnAt(p);
		if (b !== this.hot) { this.hot = b; this.invalidate(); }
	}
	onClick(p) { this.btnAt(p)?.run(); }

	draw(ctx) {
		rrect(ctx, 0, 0, this.w, this.h, theme.radius);
		ctx.fillStyle = theme.bg;
		ctx.fill();
		ctx.strokeStyle = theme.accent;
		ctx.lineWidth = 3;
		ctx.stroke();
		const lit = this.pressed ? this.down : this.hover ? this.hot : null;
		ctx.font = font(this.size, true);
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		for (const b of this.btns) {
			rrect(ctx, b.x, b.y, b.w, b.h, theme.radius * 0.7);
			ctx.fillStyle = b.text === "Done" ? theme.accent : theme.surface;
			ctx.fill();
			if (b === lit) {
				ctx.fillStyle = this.pressed ? theme.pressed : theme.hover;
				ctx.fill();
			}
			ctx.fillStyle = theme.fg;
			ctx.fillText(b.text, b.x + b.w / 2, b.y + b.h / 2 + 1);
		}
	}
}

// Tapping starts an in-place edit through keyboard.js: the field draws the hidden textarea's live value,
// caret and selection, shows an EditBar, and handles taps (caret), drags (selection) and double taps (word) itself.
// Options: onInput(v) live, onDone(v) on commit, onCancel(), onEdit() when an edit starts, onKey(e), compact and
// barAbove for the toolbar.
export class TextField extends Widget {
	constructor(o) {
		super({ value: "", placeholder: "", size: 30, w: 400, h: 72, ...o });
		this.ta = null;
		this.first = 0;
		this.blink = true;
		this.anchor = null;
		this.tapAt = 0;
		this.bar = new EditBar({ field: this, compact: this.compact });
	}

	edit(p) {
		const initial = this.value;
		this.first = 0;
		this.blink = true;
		this.ta = editText({
			initial, multiline: this.multiline,
			onInput: (v) => { this.value = v; this.onInput?.(v); },
			onKey: this.onKey,
			onSelection: () => { this.blink = true; this.invalidate(); },
			onDone: (v) => { this.stop(); this.value = v; this.onDone?.(v); },
			onCancel: () => { this.stop(); this.onCancel?.(); },
		});
		// the caret goes where the field showed the tap: laid out from the start of the text
		this.ta.setSelectionRange(0, 0);
		this.setCaret(this.indexAt(p));
		this.panel.add(this.bar);
		this.bar.place();
		this.timer = setInterval(() => { this.blink = !this.blink; this.invalidate(); }, 500);
		this.onEdit?.();
		this.invalidate();
	}

	stop() {
		clearInterval(this.timer);
		this.ta = null;
		this.bar.panel?.remove(this.bar);
		this.invalidate();
	}

	setCaret(start, end = start, dir = "none") {
		this.ta.setSelectionRange(start, end, dir);
		this.blink = true;
		this.invalidate();
	}

	// not ta.select(): that focuses the textarea, which would open the keyboard in XR
	selectAll() { this.setCaret(0, this.ta.value.length); }

	// caret = the moving end of the selection
	caret() {
		const { selectionStart: s, selectionEnd: e, selectionDirection: d } = this.ta;
		return d === "backward" ? s : e;
	}

	// lines and the window of them shown while editing; scrolls to keep the caret visible. Shared by draw() and clicks.
	layout() {
		measure.font = font(this.size);
		const text = this.ta.value, inner = this.w - 40, lh = Math.round(this.size * 1.3), caret = this.caret();
		if (!this.multiline) {
			const dx = Math.max(0, measure.measureText(text.slice(0, caret)).width - inner + 2);
			return { lines: [{ text, start: 0 }], first: 0, rows: 1, lh, top: (this.h - lh) / 2 + 1, dx, caret };
		}
		const lines = wrapLines(measure, text, inner);
		const rows = Math.max(1, Math.floor((this.h - 32) / lh));
		const cl = lineAt(lines, caret);
		this.first = Math.max(0, Math.min(Math.max(this.first, cl - rows + 1), cl, lines.length - rows));
		return { lines, first: this.first, rows, lh, top: 16, dx: 0, caret };
	}

	// character index under the point, in the layout of the current caret
	indexAt(p) {
		const { lines, first, rows, lh, top, dx } = this.layout();
		const i = Math.min(lines.length - 1, first + rows - 1, Math.max(first, first + Math.floor((p.ly - top) / lh)));
		return lines[i].start + colAt(measure, lines[i].text, p.lx - 20 + dx);
	}

	// a press while editing sets the caret and anchors a drag selection; a second one close by in time selects the word
	onDown(p) {
		this.dragCapture = this.ta !== null;
		if (!this.ta) return;
		const idx = this.indexAt(p), now = performance.now();
		if (now - this.tapAt < 400 && Math.abs(p.x - this.tapX) < 24) {
			const text = this.ta.value, word = (i) => /[\p{L}\p{N}_]/u.test(text[i]);
			let s = Math.min(idx, text.length - 1), e = s + 1;
			if (s >= 0) {
				while (s > 0 && word(s - 1) === word(s)) s--;
				while (e < text.length && word(e) === word(e - 1)) e++;
				this.setCaret(s, e);
			}
			this.anchor = null;
		} else {
			this.setCaret(idx);
			this.anchor = idx;
		}
		this.tapAt = now;
		this.tapX = p.x;
	}

	onMove(p) {
		if (this.anchor === null || !this.ta) return;
		const idx = this.indexAt(p);
		this.setCaret(Math.min(idx, this.anchor), Math.max(idx, this.anchor), idx < this.anchor ? "backward" : "forward");
	}

	onUp() { this.anchor = null; }

	onClick(p) {
		if (!this.ta) this.edit(p);
	}

	drawEdit(ctx) {
		const { lines, first, rows, lh, top, dx, caret } = this.layout();
		const { selectionStart: s, selectionEnd: e } = this.ta;
		const width = (text) => measure.measureText(text).width;
		ctx.save();
		ctx.beginPath();
		ctx.rect(20, 0, this.w - 40, this.h);
		ctx.clip();
		for (let i = first; i < Math.min(lines.length, first + rows); i++) {
			const { text, start } = lines[i], y = top + lh * (i - first);
			if (e > s && e > start && s <= start + text.length) {
				const x0 = width(text.slice(0, Math.max(0, s - start))), x1 = width(text.slice(0, e - start)) + (e > start + text.length ? 8 : 0);
				ctx.fillStyle = "rgba(76,141,255,0.45)";
				ctx.fillRect(20 - dx + x0, y, x1 - x0, lh);
			}
			ctx.fillStyle = theme.fg;
			ctx.fillText(text, 20 - dx, y + lh / 2);
		}
		if (!this.ta.value) {
			ctx.fillStyle = theme.muted;
			ctx.fillText(this.placeholder, 20, top + lh / 2);
		}
		const ci = lineAt(lines, caret);
		if (this.blink && ci >= first && ci < first + rows) {
			ctx.fillStyle = theme.fg;
			ctx.fillRect(20 - dx + width(lines[ci].text.slice(0, caret - lines[ci].start)) - 1.5, top + lh * (ci - first) + 3, 3, lh - 6);
		}
		ctx.restore();
	}

	draw(ctx) {
		if (this.ta) this.bar.place();
		const { w, h } = this, r = theme.radius * 0.7;
		rrect(ctx, 0, 0, w, h, r);
		ctx.fillStyle = theme.bg;
		ctx.fill();
		ctx.strokeStyle = this.ta || this.hover ? theme.accent : theme.border;
		ctx.lineWidth = this.ta ? 5 : 3;
		ctx.stroke();
		tint(ctx, this, 0, 0, w, h, r);
		ctx.font = font(this.size);
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		if (this.ta) return this.drawEdit(ctx);
		ctx.fillStyle = this.value ? theme.fg : theme.muted;
		if (!this.multiline) { ctx.fillText(ellipsize(ctx, this.value || this.placeholder, w - 40), 20, h / 2 + 1); return; }
		// multiline: word-wrapped from the top, clipped with "…" when it overflows the box
		const lh = Math.round(this.size * 1.3);
		const lines = wrapLines(ctx, this.value || this.placeholder, w - 40).map((l) => l.text);
		const max = Math.max(1, Math.floor((h - 32) / lh));
		if (lines.length > max) { lines.length = max; lines[max - 1] = ellipsize(ctx, lines[max - 1] + "…", w - 40); }
		lines.forEach((line, i) => ctx.fillText(line, 20, 16 + lh * (i + 0.5)));
	}
}

// A TextField over a fixed set of options [{ label, value, url? }]: tapping selects its text and opens a dropdown List
// of the options containing the typed text (case-insensitive), overlaying the panel. Up/Down move the highlight,
// Enter or a tap picks it; text that matches no option reverts. onChange(value) when the selection changes.
export class Combo extends TextField {
	constructor(o) {
		super({ options: [], current: undefined, rows: 8, compact: true, ...o, onInput: (q) => this.filter(q), onKey: (e) => this.key(e), onEdit: () => this.open(), onDone: (v) => this.done(v) });
		this.items = this.options.map((it) => ({ ...it, lc: it.label.toLowerCase() }));
		this.list = new List({ rowH: 56, size: this.size, outline: true, onSelect: (it) => { this.picked = it; commit(); } });
		this.select(this.current);
	}

	select(value) {
		this.current = value;
		this.value = this.items.find((it) => it.value === value)?.label ?? String(value);
		this.invalidate();
	}

	open() {
		this.selectAll();
		this.list.hover = false;
		this.list.selected = this.current;
		this.panel.add(this.list);
		this.filter("");
	}

	stop() {
		super.stop();
		this.list.panel?.remove(this.list);
	}

	filter(q) {
		const { list } = this, s = q.trim().toLowerCase();
		list.setItems(s ? this.items.filter((it) => it.lc.includes(s)) : this.items);
		if (!list.items.some((it) => it.value === list.selected)) list.selected = list.items[0]?.value;
		this.place();
		this.reveal(true);
	}

	// below the toolbar, or above the field when the panel has no room (the toolbar is above the field when it has none below)
	place() {
		const { list, bar } = this, a = this.abs();
		bar.place();
		list.h = Math.min(this.rows, list.items.length) * list.rowH;
		list.w = this.w;
		list.x = a.x;
		const belowBar = bar.y > a.y, y = belowBar ? bar.y + bar.h + 6 : bar.y - 6 - list.h;
		list.y = belowBar && y + list.h > this.panel.height ? Math.max(0, a.y - 6 - list.h) : Math.max(0, y);
		list.visible = list.items.length > 0;
	}

	// scrolls the highlighted row into view, centered when asked
	reveal(center) {
		const { list } = this, top = list.items.findIndex((it) => it.value === list.selected) * list.rowH;
		if (top < 0) return;
		if (center) list.scroll = Math.max(0, top - Math.floor((list.h / list.rowH - 1) / 2) * list.rowH);
		else list.scroll = Math.min(top, Math.max(list.scroll, top + list.rowH - list.h));
		list.invalidate();
	}

	key(e) {
		const { list } = this, i = list.items.findIndex((it) => it.value === list.selected);
		if (e.key === "Enter") this.picked = list.items[i];
		else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			if (!list.items.length) return;
			list.selected = list.items[Math.min(list.items.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))].value;
			this.reveal(false);
		}
	}

	done(v) {
		const it = this.picked ?? this.items.find((o) => o.label === v);
		this.picked = null;
		if (it && it.value !== this.current) this.onChange?.(it.value);
		this.select(it ? it.value : this.current);
	}

	draw(ctx) {
		if (this.ta) this.place();
		super.draw(ctx);
	}
}

export class ImageGrid extends Scrollable {
	constructor(o) {
		super({ items: [], cell: 200, gap: 12, w: 600, h: 600, ...o });
	}
	grid() {
		const cols = Math.max(1, Math.floor((this.w + this.gap) / (this.cell + this.gap)));
		const cw = (this.w - this.gap * (cols - 1)) / cols;
		return { cols, cw, step: cw + this.gap };
	}
	contentH() {
		const g = this.grid();
		return Math.ceil(this.items.length / g.cols) * g.step - this.gap;
	}
	itemAt(p) {
		const g = this.grid();
		const col = Math.floor(p.lx / g.step), row = Math.floor((p.ly + this.scroll) / g.step);
		if (col >= g.cols || p.lx - col * g.step > g.cw || (p.ly + this.scroll) - row * g.step > g.cw) return -1;
		const i = row * g.cols + col;
		return i >= 0 && i < this.items.length ? i : -1;
	}
	setItems(items) { this.items = items; this.scroll = 0; this.invalidate(); }
	onMove(p) {
		const i = this.itemAt(p);
		if (i !== this.hotItem) { this.hotItem = i; this.invalidate(); }
	}
	onClick(p) {
		const i = this.itemAt(p);
		if (i >= 0) this.onSelect?.(this.items[i], i);
	}
	draw(ctx) {
		const g = this.grid(), r = 14;
		this.clip(ctx, theme.radius * 0.7);
		ctx.fillStyle = theme.bg;
		ctx.fillRect(0, 0, this.w, this.h);
		const firstRow = Math.floor(this.scroll / g.step), lastRow = Math.ceil((this.scroll + this.h) / g.step);
		const end = Math.min(this.items.length, (lastRow + 1) * g.cols);
		for (let i = firstRow * g.cols; i < end; i++) {
			const it = this.items[i];
			const x = (i % g.cols) * g.step, y = Math.floor(i / g.cols) * g.step - this.scroll, s = g.cw;
			ctx.save();
			rrect(ctx, x, y, s, s, r);
			ctx.clip();
			ctx.fillStyle = theme.surface;
			ctx.fillRect(x, y, s, s);
			const img = it.url ? this.image(it.url) : null;
			if (img) drawCover(ctx, img, x, y, s);
			if (it.label) {
				ctx.fillStyle = "rgba(0,0,0,0.6)";
				ctx.fillRect(x, y + s - 40, s, 40);
				ctx.font = font(22);
				ctx.fillStyle = theme.fg;
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(ellipsize(ctx, it.label, s - 16), x + s / 2, y + s - 19);
			}
			if (this.hover && i === this.hotItem) {
				ctx.fillStyle = "rgba(255,255,255,0.14)";
				ctx.fillRect(x, y, s, s);
			}
			ctx.restore();
		}
		this.drawBar(ctx);
	}
}

export class ScrollView extends Scrollable {
	constructor(o) {
		super({ children: [], w: 600, h: 600, ...o });
		this.setChildren(this.children);
	}
	contentH() { return this.children.reduce((m, c) => c.visible ? Math.max(m, c.y + c.h) : m, 0) + 12; }
	setChildren(children) {
		for (const c of this.children) c.parent = null;
		this.children = children;
		for (const c of children) { c.parent = this; c.setPanel(this.panel); }
		this.invalidate();
	}
	clear() { this.scroll = 0; this.setChildren([]); }
	setPanel(panel) {
		super.setPanel(panel);
		for (const c of this.children) c.setPanel(panel);
	}
	origin() {
		const o = this.abs();
		return { x: o.x, y: o.y - this.scroll };
	}
	hitTest(x, y) {
		if (!this.visible || !this.contains(x, y)) return null;
		const lx = x - this.x, ly = y - this.y + this.scroll;
		for (let i = this.children.length - 1; i >= 0; i--) {
			const hit = this.children[i].hitTest(lx, ly);
			if (hit) return hit;
		}
		return this;
	}
	draw(ctx) {
		this.clip(ctx, 0);
		for (const c of this.children) {
			if (!c.visible || c.y + c.h < this.scroll || c.y > this.scroll + this.h) continue;
			ctx.save();
			ctx.translate(c.x, c.y - this.scroll);
			c.draw(ctx);
			ctx.restore();
		}
		this.drawBar(ctx);
	}
}

// Places widgets top to bottom (skipping hidden ones); returns the y where the next one would go.
export function stackY(widgets, { x = 0, y = 0, w, gap = 12 } = {}) {
	for (const wd of widgets) {
		if (!wd.visible) continue;
		wd.x = x;
		wd.y = y;
		if (w !== undefined) wd.w = w;
		wd.relayout();
		y += wd.h + gap;
	}
	return y;
}

const scrollerOf = (wd) => {
	for (; wd; wd = wd.parent) if (wd.canScroll()) return wd;
	return null;
};

export class Panel {
	static all = new Set();
	static updateAll() { for (const p of Panel.all) if (p.dirty) p.draw(); }

	constructor({ name = "panel", widthM, heightM, pxPerM = 1000, bg = theme.panel }) {
		this.name = name;
		this.maxPxPerM = pxPerM;
		this.bg = bg;
		this.canvas = document.createElement("canvas");
		this.setSize(widthM, heightM);
		this.ctx = this.canvas.getContext("2d");
		this.texture = new THREE.CanvasTexture(this.canvas);
		this.texture.colorSpace = THREE.SRGBColorSpace;
		this.texture.generateMipmaps = true;
		this.texture.minFilter = THREE.LinearMipmapLinearFilter;
		this.texture.magFilter = THREE.LinearFilter;
		this.texture.anisotropy = maxAnisotropy;
		this.mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(widthM, heightM),
			new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false }),
		);
		this.mesh.name = name;
		this.mesh.userData.panel = this;
		this.widgets = [];
		this.pointers = new Map();
		this.dirty = true;
		Panel.all.add(this);
	}

	setSize(widthM, heightM) {
		this.pxPerM = this.maxPxPerM * Math.min(1, 2048 / (Math.max(widthM, heightM) * this.maxPxPerM));
		this.widthM = widthM;
		this.heightM = heightM;
		this.width = this.canvas.width = Math.round(widthM * this.pxPerM);
		this.height = this.canvas.height = Math.round(heightM * this.pxPerM);
	}

	// new world size at the same canvas density; widgets keep their px positions, the caller relayouts them
	resize(widthM, heightM) {
		this.setSize(widthM, heightM);
		this.texture.dispose();
		this.mesh.geometry.dispose();
		this.mesh.geometry = new THREE.PlaneGeometry(widthM, heightM);
		this.invalidate();
	}

	add(widget) {
		widget.parent = null;
		widget.setPanel(this);
		this.widgets.push(widget);
		this.invalidate();
		return widget;
	}
	remove(widget) {
		const i = this.widgets.indexOf(widget);
		if (i < 0) return;
		this.widgets.splice(i, 1);
		widget.setPanel(null);
		for (const s of this.pointers.values()) {
			if (s.hover === widget) s.hover = null;
			if (s.cap === widget) s.cap = null;
			if (s.drag === widget) s.drag = null;
		}
		this.invalidate();
	}
	clear() {
		for (const w of this.widgets) { w.setPanel(null); w.hover = w.pressed = false; }
		this.widgets = [];
		this.pointers.clear();
		this.invalidate();
	}
	invalidate() { this.dirty = true; }

	draw() {
		const { ctx } = this;
		ctx.clearRect(0, 0, this.width, this.height);
		if (this.bg) {
			rrect(ctx, 0, 0, this.width, this.height, theme.radius);
			ctx.fillStyle = this.bg;
			ctx.fill();
			ctx.strokeStyle = theme.border;
			ctx.lineWidth = 3;
			ctx.stroke();
		}
		for (const w of this.widgets) {
			if (!w.visible) continue;
			ctx.save();
			ctx.translate(w.x, w.y);
			w.draw(ctx);
			ctx.restore();
		}
		this.texture.needsUpdate = true;
		this.dirty = false;
	}

	hitTest(x, y) {
		for (let i = this.widgets.length - 1; i >= 0; i--) {
			const hit = this.widgets[i].hitTest(x, y);
			if (hit) return hit;
		}
		return null;
	}

	setHover(s, w) {
		if (s.hover === w) return;
		if (s.hover) { s.hover.hover = false; s.hover.invalidate(); }
		s.hover = w;
		if (w) { w.hover = true; w.invalidate(); }
	}

	// type: "move" | "down" | "up" | "leave"; x, y in canvas px
	pointer(type, x, y, id = 0) {
		let s = this.pointers.get(id);
		if (!s) this.pointers.set(id, s = { hover: null, cap: null, drag: null, downX: 0, downY: 0, lastY: 0 });
		if (type === "leave") return this.setHover(s, null);
		const hit = this.hitTest(x, y);
		const ev = (w) => { const o = w.abs(); return { x, y, lx: x - o.x, ly: y - o.y, id }; };
		if (type === "down") {
			this.setHover(s, hit);
			if (!hit) return;
			Object.assign(s, { cap: hit, drag: null, downX: x, downY: y, lastY: y });
			hit.pressed = true;
			hit.onDown(ev(hit));
			hit.invalidate();
		} else if (type === "move") {
			if (s.drag) {
				s.drag.onScroll(s.lastY - y);
				s.lastY = y;
			} else if (s.cap) {
				const c = s.cap;
				const scroller = !c.dragCapture && Math.hypot(x - s.downX, y - s.downY) > 16 ? scrollerOf(c) : null;
				if (scroller) {
					c.pressed = false;
					c.invalidate();
					s.cap = null;
					s.drag = scroller;
					scroller.onScroll(s.downY - y);
					s.lastY = y;
				} else c.onMove(ev(c));
			} else {
				this.setHover(s, hit);
				hit?.onMove(ev(hit));
			}
		} else if (type === "up") {
			const c = s.cap;
			s.cap = s.drag = null;
			if (c) {
				c.pressed = false;
				c.onUp(ev(c));
				if (hit === c && !c.disabled && Math.hypot(x - s.downX, y - s.downY) <= 24) c.onClick(ev(c));
				c.invalidate();
			}
			this.setHover(s, hit);
		}
	}

	// dy in canvas px, positive = content moves up (shows later content)
	scroll(dy, x, y) {
		for (let w = this.hitTest(x, y); w; w = w.parent) if (w.onScroll(dy)) return;
	}
}

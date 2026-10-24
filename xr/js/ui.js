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

let maxAnisotropy = 1;
export function setRenderer(renderer) {
	maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
	for (const p of Panel.all) p.texture.anisotropy = maxAnisotropy;
}

export const theme = {
	bg: "#0b0e13", panel: "#161a22", surface: "#242a35", surfaceHi: "#303846", border: "#323a49",
	fg: "#e8ecf2", muted: "#8c96a8", accent: "#4c8dff", danger: "#e5484d",
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

function wrapLines(ctx, text, maxW) {
	const lines = [];
	for (const para of String(text).split("\n")) {
		let line = "";
		for (const word of para.split(" ")) {
			const test = line ? line + " " + word : word;
			if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = word; } else line = test;
		}
		lines.push(line);
	}
	return lines;
}

function rrect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.roundRect(x, y, w, h, r);
}

// hover / pressed tint over the current round-rect shape
function tint(ctx, wd, x, y, w, h, r) {
	if (wd.disabled || !(wd.pressed || wd.hover)) return;
	rrect(ctx, x, y, w, h, r);
	ctx.fillStyle = wd.pressed ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.1)";
	ctx.fill();
}

const imageCache = new Map();
export function loadImage(url) {
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
		return wrapLines(measure, this.text, this.w);
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

export class Button extends Widget {
	constructor(o) { super({ text: "", variant: "default", toggled: false, size: 30, w: 200, h: 72, ...o }); }
	draw(ctx) {
		const { w, h } = this, r = theme.radius * 0.7;
		rrect(ctx, 0, 0, w, h, r);
		ctx.fillStyle = this.toggled || this.variant === "accent" ? theme.accent : this.variant === "danger" ? theme.danger : theme.surface;
		ctx.fill();
		tint(ctx, this, 0, 0, w, h, r);
		ctx.globalAlpha = this.disabled ? 0.4 : 1;
		ctx.font = font(this.size, true);
		ctx.fillStyle = theme.fg;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(ellipsize(ctx, this.text, w - 24), w / 2, h / 2 + 1);
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

export class Slider extends Widget {
	constructor(o) { super({ label: "", min: 0, max: 1, step: 0.01, value: 0, drag: true, size: 28, w: 400, h: 124, ...o }); }
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
		ctx.font = font(this.size, true);
		ctx.fillStyle = theme.fg;
		ctx.textAlign = "right";
		ctx.fillText(this.text(), w - 4, 22);
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
				ctx.fillStyle = this.pressed ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.1)";
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
			let textW = w - 40;
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
			ctx.fillText(ellipsize(ctx, it.label, textW), 20, y + rowH / 2 + 1);
			if (!sel) {
				ctx.fillStyle = theme.border;
				ctx.fillRect(20, y + rowH - 1, w - 40, 1);
			}
		}
		this.drawBar(ctx);
	}
}

export class TextField extends Widget {
	constructor(o) { super({ value: "", placeholder: "", size: 30, w: 400, h: 72, ...o }); }
	draw(ctx) {
		const { w, h } = this, r = theme.radius * 0.7;
		rrect(ctx, 0, 0, w, h, r);
		ctx.fillStyle = theme.bg;
		ctx.fill();
		ctx.strokeStyle = this.hover ? theme.accent : theme.border;
		ctx.lineWidth = 3;
		ctx.stroke();
		tint(ctx, this, 0, 0, w, h, r);
		ctx.font = font(this.size);
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.fillStyle = this.value ? theme.fg : theme.muted;
		if (!this.multiline) { ctx.fillText(ellipsize(ctx, this.value || this.placeholder, w - 40), 20, h / 2 + 1); return; }
		// multiline: word-wrapped from the top, clipped with "…" when it overflows the box
		const lh = Math.round(this.size * 1.3);
		const lines = wrapLines(ctx, this.value || this.placeholder, w - 40);
		const max = Math.max(1, Math.floor((h - 32) / lh));
		if (lines.length > max) { lines.length = max; lines[max - 1] = ellipsize(ctx, lines[max - 1] + "…", w - 40); }
		lines.forEach((line, i) => ctx.fillText(line, 20, 16 + lh * (i + 0.5)));
	}
}

export class ImageGrid extends Scrollable {
	constructor(o) {
		super({ items: [], selected: undefined, cell: 200, gap: 12, w: 600, h: 600, ...o });
		this.imgs = new Map();
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
		if (i < 0) return;
		this.selected = this.items[i].value;
		this.onSelect?.(this.items[i], i);
		this.invalidate();
	}
	image(url) {
		let img = this.imgs.get(url);
		if (img === undefined) {
			this.imgs.set(url, null);
			loadImage(url).then((i) => this.imgs.set(url, i), () => this.imgs.set(url, false)).then(() => this.invalidate());
			img = null;
		}
		return img;
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
			if (img) {
				const k = Math.min(img.naturalWidth, img.naturalHeight);
				ctx.drawImage(img, (img.naturalWidth - k) / 2, (img.naturalHeight - k) / 2, k, k, x, y, s, s);
			}
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
			if (this.selected !== undefined && it.value === this.selected) {
				rrect(ctx, x + 2, y + 2, s - 4, s - 4, r);
				ctx.strokeStyle = theme.accent;
				ctx.lineWidth = 5;
				ctx.stroke();
			}
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
	add(child) { this.setChildren([...this.children, child]); }
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
		const k = Math.min(1, 2048 / (Math.max(widthM, heightM) * pxPerM));
		this.name = name;
		this.pxPerM = pxPerM * k;
		this.widthM = widthM;
		this.heightM = heightM;
		this.bg = bg;
		this.canvas = document.createElement("canvas");
		this.width = this.canvas.width = Math.round(widthM * this.pxPerM);
		this.height = this.canvas.height = Math.round(heightM * this.pxPerM);
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
	dispose() {
		Panel.all.delete(this);
		this.texture.dispose();
		this.mesh.geometry.dispose();
		this.mesh.material.dispose();
	}

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

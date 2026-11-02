// LoRA panel: LoRA stack of the selected LoRA Manager node (tabs when there are several) plus a
// library browser backed by LoRA Manager's HTTP API (/api/lm/loras/list).
import * as THREE from "three";
import * as ui from "../ui.js";
import { store } from "../state.js";

const NO_PREVIEW = "/loras_static/images/no-preview.png";
const STEP = 0.05;
const M = 24;
const CHECK = 60, BTN = 56, VALUE = 120, X_W = 60, G = 8; // a stack row: checkbox, name, −, weight, +, ×
const INFO_W = 600, INFO_PAD = 20, INFO_KEY = 160, INFO_LH = 32; // the info sheet: width, inset, label column, line height
const COPY = 48, COPIED_MS = 1500; // its Copy button, and how long the button shows its check after a press

const previewUrl = (url) => !url || /\.(mp4|webm)$/i.test(url) ? NO_PREVIEW : url;
const round2 = (v) => Number(v.toFixed(2));
const loraPath = (it) => (it.folder ? it.folder + "/" : "") + it.file_name; // relative to the LoRA root, no extension

async function listLoras(params) {
	const res = await fetch("/api/lm/loras/list?" + new URLSearchParams({ sort_by: "name", ...params }));
	if (!res.ok) throw new Error("LoRA Manager: HTTP " + res.status);
	return res.json();
}

// LoRA Manager's search only looks at file and model names, so fetch the whole library (page_size is capped at 100)
// and match the path relative to the LoRA root as well, case-insensitively
async function findLoras(search) {
	const q = search.toLowerCase();
	const first = await listLoras({ page_size: 100, page: 1 });
	const rest = await Promise.all(Array.from({ length: Math.max(0, first.total_pages - 1) }, (_, i) => listLoras({ page_size: 100, page: i + 2 })));
	return [first, ...rest].flatMap((r) => r.items)
		.filter((it) => [loraPath(it), it.model_name].some((s) => s.toLowerCase().includes(q)));
}

// usage_tips is a JSON string; LoRA Manager stores the clip value as clipStrength
function newLora(item) {
	let tips = {};
	try { tips = JSON.parse(item.usage_tips) ?? {}; } catch {}
	const strength = Number(tips.strength ?? 1);
	return { name: item.file_name, strength, clipStrength: Number(tips.clipStrength ?? tips.clip_strength ?? strength), active: true };
}

const { Label, Button, TextField, List, ImageGrid, ScrollView } = ui;

// [label, text, max lines, a Copy button] of a LoRA Manager item's fields that have a value
function infoRows(item) {
	const l = newLora(item);
	return [
		["Base model", item.base_model, 1],
		["Strength", l.strength + (l.clipStrength !== l.strength ? `, clip ${l.clipStrength}` : ""), 1],
		["Trigger words", item.civitai?.trainedWords?.join(", "), 1, true],
		["Tags", item.tags?.join(", "), 2],
		["Size", item.file_size ? (item.file_size / 1048576).toFixed(1) + " MB" : "", 1],
		["Notes", item.notes, 4],
	].filter(([, text]) => text);
}

// navigator.clipboard needs a secure context and SnugUI is mostly served over plain http on the LAN, so a temporary textarea's
// selection is copied, from a press (user activation). Read-only: a touch device opens no keyboard for it. Focusing it commits an
// open edit, as the press's release would.
function copyText(text) {
	const t = document.createElement("textarea");
	t.value = text;
	t.readOnly = true;
	Object.assign(t.style, { position: "fixed", left: "0", top: "0", opacity: "0", pointerEvents: "none" });
	document.body.append(t);
	t.select();
	t.setSelectionRange(0, text.length); // iOS Safari selects nothing of a read-only field on select()
	document.execCommand("copy");
	t.remove();
}

// The info sheet of a library tile: it opens while a pointer is on the tile's info button and stays while one is on the tile or
// on the sheet; else it is the pinned tile's (pinned(): its index or -1). Beside the tile, touching it so the pointer can cross
// over (right of it, left without room; under or above it on a narrow panel), and inside the panel. It sits at 0, 0 and draws in
// panel px; draw() places it (box) for the hit tests that follow. A press on it only works its Copy button (the trigger words).
class InfoSheet extends ui.Widget {
	hitTest(x, y) {
		const b = this.box;
		return b && x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h ? this : null;
	}
	onMove(p) {
		const hot = !!this.copy && ui.inRect(p, this.copy);
		if (hot !== this.hotCopy) { this.hotCopy = hot; this.invalidate(); }
	}
	onDown(p) { this.onMove(p); }
	onClick(p) {
		if (!this.copy || !ui.inRect(p, this.copy)) return;
		copyText(this.words);
		this.copied = this.item;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => { this.copied = null; this.invalidate(); }, COPIED_MS);
	}
	draw(ctx) {
		const { grid, panel } = this, i = this.index;
		this.index = !grid.visible ? -1 : grid.hover && grid.hotCorner >= 0 ? grid.hotCorner
			: i >= 0 && (this.hover || grid.hover && grid.hotItem === i) ? i : this.pinned();
		const it = this.item = grid.items[this.index]?.value;
		this.box = this.copy = null;
		if (!it) return;
		const w = Math.min(INFO_W, panel.width - 2 * M), tw = w - 2 * INFO_PAD, vw = tw - INFO_KEY;
		ctx.font = ui.font(24);
		const rows = infoRows(it).map(([key, text, max, copy]) => {
			const lw = copy ? vw - COPY - G : vw, lines = max > 1 ? ui.wrapLines(ctx, String(text), lw).map((l) => l.text) : [String(text)];
			if (lines.length > max) { lines.length = max; lines[max - 1] += "…"; }
			return { key, text, copy, lines: lines.map((l) => ui.ellipsize(ctx, l, lw)), h: copy ? COPY : lines.length * INFO_LH };
		});
		const head = [[it.model_name, ui.font(28, true), ui.theme.fg, 38], [loraPath(it), ui.font(22), ui.theme.muted, 34]].filter(([t]) => t);
		const h = 2 * INFO_PAD + head.reduce((a, r) => a + r[3], 0) + rows.reduce((a, r) => a + 8 + r.h, 0);
		const g = grid.grid(), tx = grid.x + (this.index % g.cols) * g.step, ty = grid.y + Math.floor(this.index / g.cols) * g.step - grid.scroll;
		let x = tx + g.cw, y = ty;
		if (x + w > panel.width - M) x = tx - w;
		if (x < M) {
			x = tx;
			y = ty + g.cw + h <= panel.height - M ? ty + g.cw : ty - h;
		}
		x = Math.max(M, Math.min(x, panel.width - M - w));
		y = Math.max(M, Math.min(y, panel.height - M - h));
		this.box = { x, y, w, h };
		ctx.beginPath();
		ctx.roundRect(x, y, w, h, ui.theme.radius * 0.7);
		ctx.fillStyle = ui.theme.panel;
		ctx.fill();
		ctx.strokeStyle = ui.theme.border;
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		let cy = y + INFO_PAD;
		for (const [text, f, color, lh] of head) {
			ctx.font = f;
			ctx.fillStyle = color;
			ctx.fillText(ui.ellipsize(ctx, text, tw), x + INFO_PAD, cy + lh / 2);
			cy += lh;
		}
		ctx.font = ui.font(24);
		for (const r of rows) {
			cy += 8;
			const mid = r.copy ? COPY / 2 : INFO_LH / 2;
			ctx.fillStyle = ui.theme.muted;
			ctx.fillText(r.key, x + INFO_PAD, cy + mid);
			ctx.fillStyle = ui.theme.fg;
			r.lines.forEach((l, j) => ctx.fillText(l, x + INFO_PAD + INFO_KEY, cy + mid + INFO_LH * j));
			if (r.copy) {
				const c = this.copy = { x: x + w - INFO_PAD - COPY, y: cy, w: COPY, h: COPY };
				this.words = r.text;
				ctx.beginPath();
				ctx.roundRect(c.x, c.y, COPY, COPY, 12);
				ctx.fillStyle = ui.theme.surface;
				ctx.fill();
				if (this.hover && this.hotCopy) ui.drawTint(ctx, this.pressed, c.x, c.y, COPY, COPY, 12);
				ctx.strokeStyle = ui.theme.fg;
				ui.drawIcon(ctx, this.copied === it ? "check" : "copy", c.x + 12, c.y + 12, COPY - 24);
			}
			cy += r.h;
		}
	}
}

// a stack row's active checkbox
class Check extends ui.Widget {
	draw(ctx) {
		const s = 38, x = (this.w - s) / 2, y = (this.h - s) / 2;
		ui.tint(ctx, this, 0, 0, this.w, this.h, 12);
		ctx.beginPath();
		ctx.roundRect(x, y, s, s, 8);
		ctx.fillStyle = this.checked ? ui.theme.accent : ui.theme.surface;
		ctx.fill();
		ctx.lineWidth = 3;
		ctx.strokeStyle = this.checked ? ui.theme.accent : ui.theme.border;
		ctx.stroke();
		if (!this.checked) return;
		ctx.beginPath();
		ctx.moveTo(x + 9, y + 20);
		ctx.lineTo(x + 16, y + 27);
		ctx.lineTo(x + 29, y + 11);
		ctx.strokeStyle = "#fff";
		ctx.lineWidth = 5;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.stroke();
	}
}

export function createLoraPanel() {
	const group = new THREE.Group();
	const panel = new ui.Panel({ name: "right", widthM: 1.8, heightM: 1.15 });
	group.add(panel.mesh);

	let tab = 0;
	let query = "", page = 1, pages = 1, pageSize = 0, total = 0, editing = false, timer = 0, gridSeq = 0, suggestSeq = 0;
	let found = null; // matches of the current query, shared by the grid pages and the suggestions
	let pinned = -1; // the tile whose info sheet a press on its info button pinned (touch has no hover)

	const title = new Label({ text: "LoRAs", size: 34, bold: true, x: M, y: 14, h: 50 });
	const empty = new Label({ text: "No LoRA Manager loader in this workflow", size: 30, color: ui.theme.muted, wrap: true, x: M, y: 90 });
	const stack = new ScrollView({ x: M });
	const field = new TextField({
		x: M, placeholder: "search LoRAs", barAbove: true,
		onInput: (v) => setQuery(v),
		onDone: (v) => { editing = false; syncVisible(); setQuery(v, true); },
		onCancel: () => { editing = false; syncVisible(); },
		// runs after the field commits a still-open previous edit, whose onDone clears the flag
		onEdit: () => { editing = true; syncVisible(); loadSuggest(); },
	});
	const suggest = new List({ x: M, rowH: 60, size: 28, onSelect: (it) => { suggest.selected = undefined; add(it.value); } });
	const grid = new ImageGrid({
		x: M, cell: 250, corner: "info", cornerLeft: true,
		onCorner: (it, i) => { pinned = pinned === i ? -1 : i; },
		onSelect: (it) => { pinned = -1; add(it.value); },
	});
	const info = new InfoSheet({ grid, pinned: () => pinned });
	const prev = new Button({ text: "‹ Prev", x: M, w: 180, h: 60, onClick: () => goto(page - 1) });
	const next = new Button({ text: "Next ›", w: 180, h: 60, onClick: () => goto(page + 1) });
	const pageLabel = new Label({ text: "", size: 26, color: ui.theme.muted, align: "center", x: M + 190, h: 60 });

	function buildRows(node, W) {
		const list = store.loras(node.nodeId);
		const rw = W - 16, h = 60, pitch = 68;
		// against the current list, by name (unique per node): the weight field commits on a press elsewhere, after that press's
		// own edit (×, or the same row's −, + or checkbox, which replace its entry)
		const edit = (l, patch) => store.setLoras(node.nodeId, store.loras(node.nodeId).map((x) => x.name === l.name ? { ...x, ...patch } : x));
		const rows = [];
		list.forEach((l, i) => {
			const y = i * pitch;
			const setStrength = (v) => edit(l, { strength: v, ...(Number(l.clipStrength) === Number(l.strength) && { clipStrength: v }) });
			const shown = Number(l.strength).toFixed(2);
			const rx = rw - X_W - G - BTN - VALUE - BTN; // left edge of the − button
			// tap to type the weight (accepts "," as decimal separator); anything that isn't a number reverts
			const value = new TextField({
				value: shown, size: 28, compact: true, x: rx + BTN, y, w: VALUE, h,
				onEdit: () => value.selectAll(),
				onDone: (v) => {
					const n = ui.parseNumber(v);
					value.value = shown;
					if (n !== null) setStrength(round2(n));
				},
			});
			rows.push(
				new Check({ checked: l.active, x: 0, y, w: CHECK, h, onClick: () => edit(l, { active: !l.active }) }),
				new Label({ text: l.name, size: 30, color: l.active ? ui.theme.fg : ui.theme.muted, x: CHECK + G, y, w: rx - CHECK - 2 * G, h }),
				new Button({ text: "−", size: 38, x: rx, y, w: BTN, h, onClick: () => setStrength(round2(Number(l.strength) - STEP)) }),
				value,
				new Button({ text: "+", size: 38, x: rx + BTN + VALUE, y, w: BTN, h, onClick: () => setStrength(round2(Number(l.strength) + STEP)) }),
				new Button({ text: "×", size: 34, variant: "danger", x: rw - X_W, y, w: X_W, h, onClick: () => store.setLoras(node.nodeId, list.filter((_, j) => j !== i)) }),
			);
		});
		if (!list.length) rows.push(new Label({ text: "No LoRAs yet, pick one below", size: 28, color: ui.theme.muted, x: 0, y: 20, w: rw, h: 56 }));
		return rows;
	}

	// from the panel's size: the Desktop View's window re-flows it
	function render() {
		const W = panel.width - 2 * M;
		for (const w of [title, empty, stack, field, suggest, grid]) w.w = W;
		empty.relayout();
		next.x = M + W - 180;
		pageLabel.w = W - 380;
		panel.clear();
		panel.add(title);
		const nodes = store.groups.lora;
		if (!nodes.length) { panel.add(empty); return; }
		tab = Math.min(tab, nodes.length - 1);
		let y = 70;
		if (nodes.length > 1) {
			const tw = (W - 8 * (nodes.length - 1)) / nodes.length;
			nodes.forEach((n, i) => panel.add(new Button({
				text: n.title, toggled: i === tab, size: 26, x: M + i * (tw + 8), y, w: tw, h: 56,
				onClick: () => { tab = i; stack.scroll = 0; render(); },
			})));
			y += 70;
		}
		stack.setChildren(buildRows(nodes[tab], W));
		stack.y = y;
		stack.h = Math.min(Math.max(stack.contentH(), 96), Math.round(panel.height * 0.5));
		const top = y + stack.h + 16;
		const areaY = top + 84, pagerY = panel.height - M - 60;
		field.y = top;
		suggest.y = grid.y = areaY;
		suggest.h = grid.h = pagerY - 12 - areaY;
		prev.y = next.y = pageLabel.y = pagerY;
		panel.add(stack);
		panel.add(field);
		panel.add(grid);
		panel.add(suggest);
		panel.add(prev);
		panel.add(pageLabel);
		panel.add(next);
		panel.add(info);
		syncVisible();
		updatePager();
		// a page is what the grid holds (at most LoRA Manager's page_size cap); when that changes (a re-flow, the stack growing)
		// the first tile shown stays on the page
		const size = Math.min(100, grid.pageSize());
		if (size === pageSize) return;
		page = Math.floor((page - 1) * pageSize / size) + 1;
		pageSize = size;
		loadGrid();
	}

	function syncVisible() {
		suggest.visible = editing;
		grid.visible = !editing;
		panel.invalidate();
	}

	function updatePager() {
		prev.disabled = page <= 1;
		next.disabled = page >= pages;
		pageLabel.setText(`${page} / ${pages}  (${total})`);
	}

	// one page of the library, or of the current query's matches
	async function browse(pageSize, p = 1) {
		if (!query) return listLoras({ page_size: pageSize, page: p });
		found ??= findLoras(query);
		const items = await found;
		return { items: items.slice((p - 1) * pageSize, p * pageSize), total: items.length };
	}

	async function loadGrid() {
		const id = ++gridSeq;
		try {
			const res = await browse(pageSize, page);
			if (id !== gridSeq) return;
			pages = Math.max(1, Math.ceil(res.total / pageSize));
			total = res.total;
			pinned = -1;
			grid.setItems(res.items.map((it) => ({ url: previewUrl(it.preview_url), label: it.file_name, value: it })));
			updatePager();
		} catch (e) {
			if (id !== gridSeq) return;
			grid.setItems([]);
			pageLabel.setText(e.message);
		}
	}

	async function loadSuggest() {
		const id = ++suggestSeq;
		try {
			const res = await browse(8);
			if (id === suggestSeq) suggest.setItems(res.items.map((it) => ({ label: it.file_name, sub: it.base_model, value: it })));
		} catch {
			if (id === suggestSeq) suggest.setItems([]);
		}
	}

	function goto(p) {
		page = p;
		loadGrid();
	}

	function setQuery(v, now) {
		if (v !== query) found = null;
		query = v;
		page = 1;
		clearTimeout(timer);
		timer = setTimeout(() => { loadGrid(); if (editing) loadSuggest(); }, now ? 0 : 250);
	}

	function add(item) {
		const node = store.groups.lora[tab];
		const list = store.loras(node.nodeId);
		if (list.some((l) => l.name === item.file_name)) return;
		store.setLoras(node.nodeId, [...list, newLora(item)]);
		stack.scroll = stack.maxScroll();
	}

	panel.onResize = render;
	store.addEventListener("load", () => {
		tab = 0;
		pageSize = 0; // render() sizes the page to the grid and loads it
		render();
	});
	store.addEventListener("change", (e) => { if (e.detail.key.startsWith("lora:")) render(); });
	render();

	return { group, panel };
}

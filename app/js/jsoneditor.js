// JSON prompt editor, the prompt panel's JSON mode: the prompt's fields as rows of chips in one scrolling box of the host panel,
// and sheets over the whole panel: the picker (free text, parts, subject ids), a chip's menu, a subject's menu, new fields, the
// subjects to add, the slots of a library text. The model and its JSON are jsonprompt.js's, the library parts.js's (a sheet showing
// it fetches it again as it opens; the editor's library changes are server edits). The sheet machinery (createSheet, stack,
// button, note, focus, TreeRow, resolve, resolveSaved) is shared with the Prompt panel's own sheets and the Library panel.
import * as ui from "./ui.js";
import { commit } from "./keyboard.js";
import * as fmt from "./jsonprompt.js";
import { edit, events, library, sync } from "./parts.js";

const { theme, measure } = ui;
// panel px: margin, gap, indent per level, row height (headers, chips, buttons), chip text size, its line height and side
// padding, the chevron's room (ui.Header's), the row width from which labels take a column of their own (LABEL_W), the sheets'
// widest, a slot box's height
const M = 20, GAP = 10, IND = 36, ROW = 60, SIZE = 28, LH = 36, PAD = 20, LEAD = 48, WIDE = 1000, LABEL_W = 280, SHEET_W = 1100, SLOT_H = 52;
const R = theme.radius * 0.7, WARN = "#f0a830", WARN_BG = "rgba(240,168,48,0.2)";

// the scrolling column, framed like the text box it replaces
class Box extends ui.ScrollView {
	draw(ctx) {
		ctx.beginPath();
		ctx.roundRect(0, 0, this.w, this.h, R);
		ctx.fillStyle = theme.bg;
		ctx.fill();
		ctx.save();
		super.draw(ctx);
		ctx.restore();
		ctx.beginPath();
		ctx.roundRect(0, 0, this.w, this.h, R);
		ctx.strokeStyle = theme.border;
		ctx.lineWidth = 3;
		ctx.stroke();
	}
}

// a widget made of tappable boxes (parts(): [{ x, y, w, h, run }]), each with its own hover / pressed tint
class Boxes extends ui.Widget {
	at(p) { return this.parts().findIndex((b) => ui.inRect(p, b)); }
	lit(i) { return this.hover && i === this.hot || this.pressed && i === this.down; }
	onDown(p) { this.down = this.at(p); }
	onMove(p) {
		const i = this.at(p);
		if (i !== this.hot) { this.hot = i; this.invalidate(); }
	}
	onClick(p) { this.parts()[this.at(p)]?.run(); }
}

// A chip field: its label, its chips (wrapped, a long one wrapped inside), + after the last one and, with dice (the field has
// parts), the dice after it. On a wide row the labels take a column of their own (lined up across nesting: inset is the row's
// indent), on a narrow one the chips flow after the label. A top-level row's bold label starts where the sections' titles do.
// onChip(chip), onAdd(), onDice(); flag(text): a chip drawn as a warning (it names a deleted subject).
class FieldRow extends Boxes {
	constructor(o) { super({ label: "", node: null, top: false, inset: 0, dice: false, flag: () => false, h: ROW, ...o }); }

	relayout() {
		const lead = this.top ? LEAD : 0, wide = this.w >= WIDE, col = Math.max(LABEL_W / 2, LABEL_W - this.inset), x0 = wide ? col : lead; // x0: where wrapped lines start
		const right = this.w - (this.dice ? 2 : 1) * (ROW + GAP); // the chips' right edge: every line keeps room for + (and the dice)
		measure.font = ui.font(SIZE - 2, this.top);
		this.labelW = wide ? col - lead - 16 : Math.min(measure.measureText(this.label).width, right - lead - 16);
		let x = wide ? col : lead + this.labelW + 16, y = 0, lineH = ROW;
		const place = (w, h, run) => {
			if (x > x0 && x + w > right) { x = x0; y += lineH + GAP; lineH = ROW; }
			const box = { x, y, w, h, run };
			x += w + GAP;
			lineH = Math.max(lineH, h);
			return box;
		};
		measure.font = ui.font(SIZE);
		this.boxes = [];
		for (const chip of this.node.chips) {
			const tw = measure.measureText(chip.text).width + 2 * PAD, run = () => this.onChip(chip);
			const full = right - x0, lines = tw > full ? ui.wrapLines(measure, chip.text, full - 2 * PAD).map((l) => l.text) : [chip.text];
			this.boxes.push({ chip, lines, ...place(Math.min(tw, full), ROW + (lines.length - 1) * LH, run) });
		}
		this.boxes.push({ plus: true, x, y, w: ROW, h: ROW, run: () => this.onAdd() }); // the room was kept on every line
		if (this.dice) this.boxes.push({ dice: true, x: x + ROW + GAP, y, w: ROW, h: ROW, run: () => this.onDice() });
		this.h = y + lineH;
	}

	parts() { return this.boxes; }

	draw(ctx) {
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.font = ui.font(SIZE - 2, this.top);
		ctx.fillStyle = this.top ? theme.fg : theme.muted;
		ctx.fillText(ui.ellipsize(ctx, this.label, this.labelW), this.top ? LEAD : 0, ROW / 2 + 1);
		this.boxes.forEach((b, i) => {
			const r = (ROW - 8) / 2;
			ctx.beginPath();
			ctx.roundRect(b.x, b.y + 4, b.w, b.h - 8, r);
			if (b.plus || b.dice) {
				ctx.fillStyle = theme.surface;
				ctx.fill();
				if (this.lit(i)) ui.drawTint(ctx, this.pressed, b.x, b.y + 4, b.w, b.h - 8, r);
				ctx.fillStyle = ctx.strokeStyle = theme.fg;
				if (b.dice) return ui.drawIcon(ctx, "dices", b.x + (ROW - 30) / 2, b.y + (ROW - 30) / 2, 30);
				ctx.font = ui.font(34, true);
				ctx.textAlign = "center";
				ctx.fillText("+", b.x + ROW / 2, ROW / 2 + b.y + 1);
				ctx.textAlign = "left";
				return;
			}
			const flagged = this.flag(b.chip.text);
			ctx.fillStyle = flagged ? WARN_BG : theme.surfaceHi;
			ctx.fill();
			if (flagged) {
				ctx.strokeStyle = WARN;
				ctx.lineWidth = 3;
				ctx.stroke();
			}
			if (this.lit(i)) ui.drawTint(ctx, this.pressed, b.x, b.y + 4, b.w, b.h - 8, r);
			ctx.font = ui.font(SIZE);
			ctx.fillStyle = b.chip.type ? theme.accent : theme.fg; // a number, boolean, null or JSON value
			b.lines.forEach((line, k) => ctx.fillText(ui.ellipsize(ctx, line, b.w - 2 * PAD), b.x + PAD, b.y + ROW / 2 + k * LH + 1));
		});
	}
}

// The texts of a slot sheet ([[literal string | { name }]], jsonprompt.js segments), word-wrapped, each slot a box holding its
// value or {name}, the current one outlined; a tap on a slot makes it current (onSlot(i), i counted across the texts).
class SlotText extends Boxes {
	constructor(o) { super({ texts: [], values: [], current: 0, ...o }); }
	relayout() {
		measure.font = ui.font(SIZE);
		this.words = [];
		this.boxes = [];
		let y = 0, i = 0;
		for (const text of this.texts) {
			let x = 0;
			const put = (w) => {
				if (x && x + w > this.w) { x = 0; y += SLOT_H + GAP; }
				x += w;
				return { x: x - w, y };
			};
			for (const s of text) {
				if (typeof s === "string") {
					for (const word of s.match(/\S+\s*|\s+/g)) this.words.push({ text: word, ...put(measure.measureText(word).width) });
					continue;
				}
				const k = i++, value = this.values[k], w = measure.measureText(value ?? `{${s.name}}`).width + 2 * 14;
				this.boxes.push({ k, value, name: s.name, w, h: SLOT_H, ...put(w + 6), run: () => this.onSlot(k) });
			}
			y += SLOT_H + 2 * GAP;
		}
		this.h = Math.max(SLOT_H, y - 2 * GAP);
	}
	parts() { return this.boxes; }
	draw(ctx) {
		ctx.font = ui.font(SIZE);
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.fillStyle = theme.fg;
		for (const w of this.words) ctx.fillText(w.text, w.x, w.y + SLOT_H / 2 + 1);
		this.boxes.forEach((b, i) => {
			ctx.beginPath();
			ctx.roundRect(b.x, b.y, b.w, b.h, R);
			ctx.fillStyle = b.value === undefined ? theme.surface : theme.surfaceHi;
			ctx.fill();
			if (b.k === this.current) {
				ctx.strokeStyle = theme.accent;
				ctx.lineWidth = 4;
				ctx.stroke();
			}
			if (this.lit(i)) ui.drawTint(ctx, this.pressed, b.x, b.y, b.w, b.h, R);
			ctx.fillStyle = b.value === undefined ? theme.muted : theme.fg;
			ctx.fillText(b.value ?? `{${b.name}}`, b.x + 14, b.y + SLOT_H / 2 + 1);
		});
	}
}

// A row of a tree or list (a sheet's, the Library panel's): indented by depth, a chevron when it folds (open true / false;
// undefined: none), an icon (icons.js), the label and a muted sub at its end; selected: the accent fill; warn: the warning tint
// and border (a part naming a missing fragment)
export class TreeRow extends ui.Widget {
	constructor(o) { super({ label: "", sub: "", icon: null, depth: 0, open: undefined, selected: false, warn: false, h: ROW, ...o }); }
	draw(ctx) {
		const x = this.depth * IND, w = this.w - x;
		ctx.beginPath();
		ctx.roundRect(x, 0, w, this.h, R);
		ctx.fillStyle = this.selected ? theme.accent : this.warn ? WARN_BG : theme.surface;
		ctx.fill();
		if (this.warn) {
			ctx.strokeStyle = WARN;
			ctx.lineWidth = 3;
			ctx.stroke();
		}
		ui.tint(ctx, this, x, 0, w, this.h, R);
		let tx = x + 16;
		if (this.open !== undefined) {
			ui.drawChevron(ctx, tx + 6, this.h / 2, this.open);
			tx += 28;
		}
		ctx.strokeStyle = ctx.fillStyle = theme.fg;
		if (this.icon) {
			ui.drawIcon(ctx, this.icon, tx, (this.h - 30) / 2, 30);
			tx += 42;
		}
		ctx.textAlign = "right";
		ctx.textBaseline = "middle";
		ctx.font = ui.font(22);
		const sub = ui.ellipsize(ctx, this.sub, w * 0.4), end = this.w - 16 - (sub ? ctx.measureText(sub).width + 16 : 0);
		ctx.fillStyle = this.selected ? theme.fg : theme.muted;
		ctx.fillText(sub, this.w - 16, this.h / 2 + 1);
		ctx.textAlign = "left";
		ctx.font = ui.font(SIZE - 2);
		ctx.fillStyle = theme.fg;
		ctx.fillText(ui.ellipsize(ctx, this.label, end - tx), tx, this.h / 2 + 1);
	}
}

// dims the panel under a sheet and draws the sheet's card and title; a tap outside the card closes it
class Shade extends ui.Widget {
	draw(ctx) {
		ctx.beginPath();
		ctx.roundRect(0, 0, this.w, this.h, this.panel.radius);
		ctx.fillStyle = "rgba(0,0,0,0.55)";
		ctx.fill();
		const { x, y, w, h } = this.card;
		ctx.beginPath();
		ctx.roundRect(x, y, w, h, theme.radius);
		ctx.fillStyle = theme.panel;
		ctx.fill();
		ctx.strokeStyle = theme.border;
		ctx.lineWidth = 3;
		ctx.stroke();
		ctx.font = ui.font(30, true);
		ctx.fillStyle = theme.fg;
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.fillText(ui.ellipsize(ctx, this.title, w - 3 * M - ROW), x + M, y + M + ROW / 2);
	}
	onClick(p) { if (!ui.inRect(p, this.card)) this.onClose(); }
}

export const button = (text, onClick, o) => {
	measure.font = ui.font(24, true);
	return new ui.Button({ text, size: 24, h: ROW, w: Math.ceil(measure.measureText(text).width) + (o?.icon ? 92 : 48), onClick, ...o });
};
export const note = (text, bold = false, color = theme.muted) => new ui.Label({ text, size: 24, bold, color, wrap: true });
const title = (key, top) => {
	const t = key.replaceAll("_", " ");
	return top ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

// starts editing a sheet's field once the press that opened it is over (dom.js commits an edit on a press elsewhere when it ends)
export const focus = (f) => queueMicrotask(() => { if (f.panel && !f.ta) f.edit({ lx: f.w, ly: f.h / 2 }); });

// Lays items out top to bottom in a column w wide (an array is a row of buttons, wrapped, where a field takes the room the buttons
// leave; a field's edit bar goes above it, so it hides no button) -> the widgets, placed
export function stack(items, w) {
	const kids = [];
	let y = 0;
	for (const item of items) {
		if (Array.isArray(item)) {
			const field = item.find((b) => b instanceof ui.TextField);
			if (field) Object.assign(field, { barAbove: true, w: w - item.reduce((s, b) => b === field ? s : s + b.w + GAP, 0) });
			let x = 0;
			for (const b of item) {
				if (x && x + b.w > w) { x = 0; y += ROW + GAP; }
				Object.assign(b, { x, y, w: Math.min(b.w, w) });
				x += b.w + GAP;
			}
			if (item.length) y += ROW + GAP;
			kids.push(...item);
			continue;
		}
		if (item instanceof ui.TextField) item.barAbove = true;
		Object.assign(item, { x: 0, y, w });
		item.relayout();
		y += item.h + GAP;
		kids.push(item);
	}
	return kids;
}

// One sheet at a time over the panel: a card over the dimmed panel, name() as its title, a close button, then content() stacked
// in a scrolling body. refresh() re-runs content() (and re-places the card); fields kept across runs keep their edit.
export function createSheet(panel) {
	let sheet = null;

	function open(name, content) {
		close();
		sheet = { name, content, shade: new Shade({ onClose: close }), body: new ui.ScrollView({}), close: new ui.Button({ icon: "x", round: true, w: ROW, h: ROW, onClick: close }) };
		for (const w of [sheet.shade, sheet.body, sheet.close]) panel.add(w);
		refresh();
	}

	function refresh() {
		if (!sheet) return;
		const { name, content, shade, body } = sheet, W = panel.width, H = panel.height;
		const cw = Math.min(W - 2 * M, SHEET_W), cx = (W - cw) / 2, bw = cw - 2 * M, top = M + ROW + 2 * M;
		body.setChildren(stack(content(), bw));
		Object.assign(body, { x: cx + M, y: top, w: bw, h: Math.min(body.contentH(), H - top - 2 * M) });
		Object.assign(shade, { x: 0, y: 0, w: W, h: H, title: name(), card: { x: cx, y: M, w: cw, h: top + body.h } });
		Object.assign(sheet.close, { x: cx + cw - M - ROW, y: 2 * M });
		panel.invalidate();
	}

	function close() {
		const s = sheet;
		if (!s) return;
		sheet = null;
		commit(); // its field's onDone may still act
		for (const w of [s.shade, s.body, s.close]) panel.remove(w);
	}

	return { open, refresh, close };
}

// Fills the slots of library texts (a part, a preset's strings, a saved prompt) in sheet: without any, onDone(texts) at once;
// else one sheet walking through them: the texts with their slots, a free value and Random (the current slot), Random all and
// `label` (once every slot is filled), then the current slot's fragment values by group (a tap fills it and moves to the next
// empty slot). The library is fetched again as it opens.
export function resolve(sheet, name, texts, label, onDone) {
	const segs = texts.map((t) => fmt.segments(t, library.fragments)), all = segs.flat().filter((s) => typeof s !== "string");
	sheet.close();
	if (!all.length) return onDone(texts);
	sync();
	const values = all.map(() => undefined);
	let current = 0, done = false;
	const set = (k, v) => {
		values[k] = v;
		current = values.map((_, j) => (k + 1 + j) % values.length).find((j) => values[j] === undefined) ?? k;
		sheet.refresh();
	};
	const random = (k) => fmt.randomValue(library.fragments, all[k].name);
	const view = new SlotText({ texts: segs.filter((s) => s.some((x) => typeof x !== "string")), onSlot: (k) => {
		current = k;
		sheet.refresh();
	} });
	const free = new ui.TextField({ placeholder: "Other value…", onDone: (v) => {
		free.value = "";
		if (v.trim()) set(current, v.trim());
	} });
	const finish = () => {
		if (done) return;
		done = true;
		let i = 0;
		const filled = segs.map((s) => s.map((x) => typeof x === "string" ? x : values[i++]).join(""));
		sheet.close();
		onDone(filled);
	};
	sheet.open(() => name, () => {
		Object.assign(view, { values, current });
		const slot = all[current], groups = fmt.parseParts(library.fragments[slot.name] ?? "");
		return [
			view,
			[free, button("Random", () => set(current, random(current)))],
			[button("Random all", () => {
				values.forEach((_, k) => { values[k] = random(k); });
				sheet.refresh();
			}), button(label, finish, { variant: "accent", disabled: values.includes(undefined) })],
			note(`{${slot.name}}`, true),
			...groups.flatMap(({ group, parts }) => [...group ? [note(group)] : [], parts.map((v) => button(v, () => set(current, v)))]),
			...groups.length ? [] : [note(`No values in fragments/${slot.name}.txt`)],
		];
	});
}

// a saved prompt (prompts/<path>) with its slots filled in sheet ("Load"): onDone(text, json), json for a .json holding an object
// (its strings filled), else the text as is
export function resolveSaved(sheet, path, onDone) {
	const text = library.prompts[path], name = path.slice(path.lastIndexOf("/") + 1);
	let obj = null;
	if (path.endsWith(".json")) try { obj = JSON.parse(text); } catch {}
	if (obj && typeof obj === "object" && !Array.isArray(obj)) resolve(sheet, name, fmt.strings(obj), "Load", (t) => onDone(JSON.stringify(fmt.withStrings(obj, t)), true));
	else resolve(sheet, name, [text], "Load", ([t]) => onDone(t, false));
}

// panel: the host; sheet: its createSheet(panel); onChange(text): the prompt's JSON after every edit; onError(text): a library edit
// failed. Hidden until show(), placed by layout(rect).
export function createEditor({ panel, sheet, schema, onChange, onError }) {
	const view = panel.add(new Box({ visible: false }));
	const folded = new WeakSet(), gone = new Set(); // folded nodes; ids of deleted subjects, whose mentions are flagged
	let model = fmt.newPrompt(schema), lines = []; // lines: [{ depth, main, right: [buttons over its end] }]

	const flag = (text) => [...gone].some((id) => fmt.mentions(text, id));
	const texts = (node) => node.kind === "chips" ? node.chips.map((c) => c.text)
		: node.kind === "cards" ? node.items.flatMap(texts) : node.fields.flatMap((f) => texts(f.node));
	const preview = (node) => (node.subjects ? node.items.map((s) => s.sub.id) : texts(node)).filter((t) => t.trim()).join(", ");
	const cardName = (list, item) => item.sub ? [item.sub.id, item.sub.type].filter(Boolean).join(" · ") : `#${list.items.indexOf(item) + 1}`;

	function changed(structure) {
		if (structure) build();
		else restack();
		onChange(fmt.stringify(model));
	}

	function fold(node) {
		if (folded.has(node)) folded.delete(node);
		else folded.add(node);
		build();
	}

	function build() {
		lines = [];
		fields(model, "", 0, true);
		lines.push({ depth: 0, main: addField(model, "the prompt") });
		view.setChildren(lines.flatMap((l) => [l.main, ...l.right ?? []]));
		restack();
	}

	// rows for a group's fields: chip fields, folding groups, card lists (the subjects with their add buttons). prefix: the field
	// key's start ("camera.", "person.")
	function fields(group, prefix, depth, top = false) {
		for (const { key: k, node } of group.fields) {
			const key = prefix + k, name = title(k, top), open = !folded.has(node);
			if (node.kind === "chips") {
				lines.push({ depth, main: new FieldRow({
					label: name, node, top, flag, inset: depth * IND, dice: parts(key).length > 0,
					onChip: (chip) => chipSheet(node, chip, key), onAdd: () => picker(node, key),
					onDice: () => {
						node.chips = [{ text: randomPart(key) }];
						changed(true);
					},
				}) });
				continue;
			}
			const head = new ui.Header({ title: name, open, preview: preview(node), h: ROW, onClick: () => fold(node) });
			if (node.kind === "group") {
				lines.push({ depth, main: head, right: dice(node, key + ".") });
				if (open) {
					fields(node, key + ".", depth + 1);
					lines.push({ depth: depth + 1, main: addField(node, name) });
				}
				continue;
			}
			lines.push({ depth, main: head, right: node.subjects ? subjectButtons(node) : [] });
			if (open) for (const item of node.items) card(node, item, node.subjects ? (item.sub.type ?? "subject") + "." : key + ".", depth + 1);
		}
	}

	function card(list, item, prefix, depth) {
		const open = !folded.has(item), name = cardName(list, item);
		lines.push({ depth, main: new ui.Header({ title: name, open, preview: preview(item), h: ROW, onClick: () => fold(item) }), right: [...dice(item, prefix), button("•••", () => cardMenu(list, item), { w: ROW, size: 18 })] });
		if (!open) return;
		fields(item, prefix, depth + 1);
		lines.push({ depth: depth + 1, main: addField(item, name) });
	}

	const addField = (group, name) => button("+ field", () => newField(group, name));

	// the parts of a field key, and one of them with its slots filled at random
	const parts = (key) => fmt.parseParts(library.values[key] ?? "").flatMap((g) => g.parts);
	const randomPart = (key) => fmt.fillRandom(fmt.randomOf(parts(key)), library.fragments);

	// the chip fields of a group (and of its groups, not its cards): [{ node, key }]
	const chipFields = (group, prefix) => group.fields.flatMap(({ key, node }) => node.kind === "chips" ? [{ node, key: prefix + key }]
		: node.kind === "group" ? chipFields(node, prefix + key + ".") : []);

	// a card's or a group's dice, when one of its fields has parts: one random part in each empty field that has some
	function dice(group, prefix) {
		if (!chipFields(group, prefix).some((f) => parts(f.key).length)) return [];
		return [button("", () => {
			for (const { node, key } of chipFields(group, prefix)) {
				if (parts(key).length && !node.chips.some((c) => c.text.trim())) node.chips = [{ text: randomPart(key) }];
			}
			changed(true);
		}, { icon: "dices", w: ROW })];
	}

	function subjectButtons(list) {
		const type = Object.keys(schema.subjects)[0];
		return [button("+ " + title(type, true), () => addSubject(list, type)), button("▾", () => subjectSheet(list), { w: ROW, size: 34 })];
	}

	function restack() {
		const W = view.w - 2 * M - 12; // room for the scroll bar
		let y = M;
		for (const { depth, main, right = [] } of lines) {
			const x = M + depth * IND;
			let end = M + W;
			for (const b of right.toReversed()) {
				end -= b.w;
				Object.assign(b, { x: end, y: y + (ROW - b.h) / 2 });
				end -= GAP;
			}
			Object.assign(main, { x, y });
			if (!(main instanceof ui.Button)) main.w = M + W - x;
			if (main instanceof ui.Header) main.right = M + W - end;
			main.relayout();
			y += main.h + GAP;
		}
		view.invalidate();
	}

	function addChip(node, text) {
		node.chips.push({ text });
		changed(true);
	}

	// a library edit; a refused one shows its message
	const save = (body) => edit(body).catch((e) => onError(e.message));

	// +: a free-text line (already editing) to add as is or also save as a part, then the field's parts by group (search, tap to
	// add) and the subjects' ids
	function picker(node, key) {
		const search = new ui.TextField({ placeholder: "Search parts…", onInput: sheet.refresh });
		// Add & save runs before its press commits the line, whose onDone then finds it added
		let added = false;
		const add = (v, save) => {
			const text = v.trim();
			if (added || !text) return;
			added = true;
			sheet.close();
			addChip(node, text);
			if (save) savePart(key, text);
		};
		const addSave = button("Add & save", () => add(free.value, true), { disabled: true });
		const free = new ui.TextField({ h: ROW, placeholder: "Add without saving…", onDone: (v) => add(v), onInput: (v) => {
			addSave.disabled = !v.trim();
			addSave.invalidate();
		} });
		const pick = (text) => resolve(sheet, key, [text], "Add chip", ([t]) => addChip(node, t));
		sync();
		sheet.open(() => key, () => {
			const q = search.value.trim().toLowerCase(), ids = fmt.subjectIds(model), items = [[free, addSave], search];
			if (ids.length) items.push(note("→ subject"), ids.map((id) => button(id, () => pick(id))));
			const start = items.length;
			for (const { group, parts } of fmt.parseParts(library.values[key] ?? "")) {
				const shown = parts.filter((text) => text.toLowerCase().includes(q));
				if (!shown.length) continue;
				items.push(note(group || "Ungrouped", true));
				for (const text of shown) items.push(new TreeRow({ label: text, warn: fmt.missing(text, library.fragments), onClick: () => pick(text) }));
			}
			if (items.length === start) items.push(note(q ? "No parts match" : `No parts for ${key} yet`));
			return items;
		});
		focus(free);
	}

	// a tap on a chip: edit its text, move it, save it as a part, delete it, append a subject's id
	function chipSheet(node, chip, key) {
		const drop = () => {
			const i = node.chips.indexOf(chip);
			if (i < 0) return;
			node.chips.splice(i, 1);
			sheet.close();
			changed(true);
		};
		const move = (d) => {
			const i = node.chips.indexOf(chip), j = i + d;
			if (i < 0 || j < 0 || j >= node.chips.length) return;
			node.chips.splice(i, 1);
			node.chips.splice(j, 0, chip);
			changed(true);
		};
		const field = new ui.TextField({
			value: chip.text,
			onInput: (v) => {
				chip.text = v;
				changed(false);
			},
			onDone: (v) => {
				chip.text = v;
				if (v.trim()) changed(false);
				else drop();
			},
		});
		const append = (id) => {
			commit();
			chip.text = `${chip.text.trimEnd()} ${id}`.trim();
			field.value = chip.text;
			changed(false);
		};
		sheet.open(() => key, () => {
			const ids = fmt.subjectIds(model);
			return [
				field,
				[button("← Move left", () => move(-1)), button("Move right →", () => move(1)), button("Save as part", () => savePart(key, chip.text)), button("Delete", drop, { variant: "danger" })],
				...ids.length ? [note("→ subject"), ids.map((id) => button(id, () => append(id)))] : [],
			];
		});
		focus(field);
	}

	// asks for a group (existing or new) and adds the text to the field's parts in it
	function savePart(key, text) {
		text = text.replace(/\s+/g, " ").trim();
		let saved = false;
		const add = (group) => {
			if (saved || !text) return;
			saved = true;
			sheet.close();
			save({ kind: "values", name: key, op: "add", group, text });
		};
		const fresh = new ui.TextField({ placeholder: "New group…", onDone: (v) => { if (v.trim()) add(v.trim()); } });
		const groups = fmt.parseParts(library.values[key] ?? "").map((g) => g.group);
		if (!groups.includes("")) groups.push("");
		sheet.open(() => `Save as a part of ${key}`, () => [note(text, false, theme.fg), note("Group"), groups.map((g) => button(g || "Ungrouped", () => add(g))), fresh]);
	}

	// ⋯ on a card: a subject's id (a rename follows in every text), save it as a preset, delete it; a plain card: delete
	function cardMenu(list, item) {
		const sub = item.sub, error = note("", false, theme.danger);
		const drop = () => {
			const i = list.items.indexOf(item);
			if (i < 0) return;
			list.items.splice(i, 1);
			if (sub) gone.add(sub.id);
			sheet.close();
			changed(true);
		};
		const remove = button("Delete", drop, { variant: "danger" });
		if (!sub) return sheet.open(() => cardName(list, item), () => [[remove]]);
		const id = new ui.TextField({ value: sub.id, onDone: (v) => {
			const to = v.trim();
			const why = to === sub.id ? "" : !fmt.validId(to) ? "An id is lowercase letters, digits and _" : fmt.subjectIds(model).includes(to) ? `${to} is already used` : null;
			if (why === null) {
				fmt.renameSubject(model, item, to);
				gone.delete(to);
				changed(true);
			}
			error.setText(why ?? "");
			id.value = sub.id;
			sheet.refresh();
		} });
		sheet.open(() => cardName(list, item), () => [note("Id"), id, ...error.text ? [error] : [], [button("Save as preset", () => presetSheet(item)), remove]]);
	}

	function presetSheet(item) {
		const type = item.sub.type ?? "subject";
		let saved = false;
		const add = (v) => {
			const key = v.trim();
			if (saved || !key) return;
			saved = true;
			save({ kind: "presets", name: type, op: "set", key, value: fmt.toJSON(item) });
			sheet.close();
		};
		const name = new ui.TextField({ value: item.sub.id, onDone: add });
		sheet.open(() => `Save ${item.sub.id} as a ${type} preset`, () => [note("Preset name"), name, [button("Save", () => {
			commit();
			add(name.value);
		}, { variant: "accent" })]]);
		focus(name);
	}

	// ▾ next to "+ Person": an empty subject of each type, one of its presets, or a random one (its slots filled at random)
	function subjectSheet(list) {
		const add = (type, name, preset = {}) => resolve(sheet, name, fmt.strings(preset), "Add subject", (texts) => addSubject(list, type, fmt.withStrings(preset, texts)));
		const random = (type) => {
			const preset = fmt.randomOf(Object.values(library.presets[type]));
			sheet.close();
			addSubject(list, type, fmt.withStrings(preset, fmt.strings(preset).map((t) => fmt.fillRandom(t, library.fragments))));
		};
		sheet.open(() => "Add a subject", () => Object.keys(schema.subjects).flatMap((type) => {
			const presets = Object.entries(library.presets[type] ?? {});
			return [
				note(title(type, true), true),
				[button(`Empty ${type}`, () => add(type)), ...presets.length ? [button("Random preset", () => random(type), { icon: "dices" })] : [],
					...presets.map(([name, p]) => button(name, () => add(type, name, p)))],
			];
		}));
	}

	function addSubject(list, type, preset) {
		const item = fmt.newSubject(schema, model, type, preset);
		list.items.push(item);
		gone.delete(item.sub.id);
		folded.delete(list);
		changed(true);
	}

	// + field: a key, then an empty chip field in that object
	function newField(group, name) {
		const error = note("", false, theme.danger);
		let added = false;
		const add = (v) => {
			const key = v.trim();
			if (added || !key) return;
			if (group.fields.some((f) => f.key === key) || group.sub && (key === "id" || key === "type")) {
				error.setText(`${key} is already there`);
				return sheet.refresh();
			}
			added = true;
			group.fields.push({ key, node: { kind: "chips", chips: [] } });
			sheet.close();
			changed(true);
		};
		const field = new ui.TextField({ placeholder: "Field name", onDone: add });
		sheet.open(() => `New field in ${name}`, () => [field, ...error.text ? [error] : [], [button("Add", () => {
			commit();
			add(field.value);
		}, { variant: "accent" })]]);
		focus(field);
	}

	events.addEventListener("change", () => { if (view.visible) build(); }); // the dice follow the library

	return {
		// the box's rect in panel px
		layout(rect) {
			Object.assign(view, rect);
			restack();
		},
		show() { view.visible = true; },
		hide() {
			sheet.close();
			view.visible = false;
		},
		load(m) {
			sheet.close();
			model = m;
			gone.clear();
			build();
		},
	};
}

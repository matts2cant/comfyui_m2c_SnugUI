// Input panel: the workflow's inputs, controls for store.groups.left, all edited in place: sliders and text fields take typed values, COMBO / IMAGE inputs drop down a filtered option list.
import { SWITCH_W, Widget, drawSwitch, drawTint, ellipsize, font, inRect, theme } from "../ui.js";
import { pref, setPref } from "../prefs.js";

// Pixaroma "Sizes" state, same math as the node's core.mjs: the stored [a, b] pair is oriented (landscape = wider,
// portrait = taller), snapped, clamped to 64..16384; w/h in the state are what the node outputs.
const orient = ([a, b], orientation) => (orientation === "landscape") === (a >= b) ? [a, b] : [b, a];
const snapDim = (n, step) => Math.max(64, Math.min(16384, step ? Math.round(n / step) * step : Math.round(n)));
const sizeOf = (pair, state) => orient(pair, state.orientation).map((n) => snapDim(n, state.snap));
const sizeText = (pair, state) => sizeOf(pair, state).join(" × ");

// resolution presets as a two-column grid under a W × H title and a portrait / landscape switch
const BTN_H = 64, GAP = 8, ORIENT_Y = 60, SIZES_Y = ORIENT_Y + BTN_H + 14, ROW = BTN_H + GAP;
class SizePicker extends Widget {
	constructor(o) {
		super({ label: "", value: null, ...o });
		this.relayout();
	}
	relayout() {
		this.h = SIZES_Y + Math.ceil(this.value.sizes.length / 2) * ROW;
	}
	parts() {
		const half = (this.w - GAP) / 2, list = [];
		["portrait", "landscape"].forEach((o, i) => list.push({ x: i * (half + GAP), y: ORIENT_Y, w: half, h: BTN_H, orientation: o, text: o === "portrait" ? "Portrait" : "Landscape" }));
		this.value.sizes.forEach((pair, i) => list.push({ x: (i % 2) * (half + GAP), y: SIZES_Y + (i >> 1) * ROW, w: half, h: BTN_H, selected: i, text: sizeText(pair, this.value) }));
		return list.map((b, id) => ({ ...b, id }));
	}
	partAt(p) { return this.parts().find((b) => inRect(p, b)) ?? null; }
	onMove(p) {
		const part = this.partAt(p);
		if (part?.id !== this.hot?.id) { this.hot = part; this.invalidate(); }
	}
	onClick(p) {
		const part = this.partAt(p);
		if (!part) return;
		const state = { ...this.value, orientation: part.orientation ?? this.value.orientation, selected: part.selected ?? this.value.selected };
		[state.w, state.h] = sizeOf(state.sizes[state.selected], state);
		this.onChange?.(state);
	}
	draw(ctx) {
		const { value: state } = this;
		ctx.textBaseline = "middle";
		ctx.font = font(28);
		ctx.fillStyle = theme.muted;
		ctx.textAlign = "left";
		ctx.fillText(this.label, 4, 22);
		ctx.font = font(34, true);
		ctx.fillStyle = theme.fg;
		ctx.textAlign = "right";
		ctx.fillText(`${state.w} × ${state.h}`, this.w - 4, 22);
		ctx.textAlign = "center";
		for (const b of this.parts()) {
			const on = b.orientation ? b.orientation === state.orientation : b.selected === state.selected;
			ctx.beginPath();
			ctx.roundRect(b.x, b.y, b.w, b.h, theme.radius * 0.7);
			ctx.fillStyle = on ? theme.accent : theme.surface;
			ctx.fill();
			if (this.hover && b.id === this.hot?.id) drawTint(ctx, this.pressed, b.x, b.y, b.w, b.h, theme.radius * 0.7);
			ctx.font = font(b.orientation ? 28 : 30, true);
			ctx.fillStyle = theme.fg;
			ctx.fillText(b.text, b.x + b.w / 2, b.y + b.h / 2 + 1);
		}
	}
}

// Pixaroma Group Switch: the label and the Mute / Bypass tag, then one row per group (colour dot, name, switch)
const SW_TOP = 56, SW_ROW = 72;
class GroupSwitch extends Widget {
	constructor(o) {
		super({ label: "", action: "bypass", groups: [], isOn: () => true, ...o });
		this.h = SW_TOP + Math.max(1, this.groups.length) * (SW_ROW + GAP) - GAP;
	}
	rowAt(p) {
		const i = Math.floor((p.ly - SW_TOP) / (SW_ROW + GAP));
		return p.ly - SW_TOP - i * (SW_ROW + GAP) < SW_ROW ? this.groups[i] ?? null : null;
	}
	onMove(p) {
		const row = this.rowAt(p);
		if (row !== this.hot) { this.hot = row; this.invalidate(); }
	}
	onClick(p) {
		const row = this.rowAt(p);
		if (row) this.onToggle(row.id);
	}
	draw(ctx) {
		ctx.textBaseline = "middle";
		ctx.font = font(28);
		ctx.fillStyle = theme.muted;
		ctx.textAlign = "left";
		ctx.fillText(this.label, 4, 22);
		const tag = this.action === "bypass" ? "Bypass" : "Mute";
		ctx.font = font(24, true);
		const tw = ctx.measureText(tag).width + 28;
		ctx.beginPath();
		ctx.roundRect(this.w - tw, 4, tw, 38, 10);
		ctx.fillStyle = theme.surfaceHi;
		ctx.fill();
		ctx.fillStyle = theme.fg;
		ctx.textAlign = "center";
		ctx.fillText(tag, this.w - tw / 2, 24);
		ctx.textAlign = "left";
		if (!this.groups.length) {
			ctx.font = font(26);
			ctx.fillStyle = theme.muted;
			ctx.fillText("No groups in this switch", 4, SW_TOP + SW_ROW / 2);
		}
		this.groups.forEach((g, i) => {
			const y = SW_TOP + i * (SW_ROW + GAP), on = this.isOn(g.id), cy = y + SW_ROW / 2;
			ctx.beginPath();
			ctx.roundRect(0, y, this.w, SW_ROW, theme.radius * 0.7);
			ctx.fillStyle = theme.surface;
			ctx.fill();
			if (this.hover && g === this.hot) drawTint(ctx, this.pressed, 0, y, this.w, SW_ROW, theme.radius * 0.7);
			ctx.beginPath();
			ctx.arc(34, cy, 11, 0, Math.PI * 2);
			ctx.fillStyle = g.color || "#888";
			ctx.fill();
			const sx = this.w - SWITCH_W - 24;
			ctx.font = font(30);
			ctx.fillStyle = on ? theme.fg : theme.muted;
			ctx.fillText(ellipsize(ctx, g.label, sx - 80), 60, cy + 1);
			drawSwitch(ctx, sx, cy, on);
		});
	}
}

export function createLeftPanel({ THREE, store, client, ui }) {
	const { Panel, Label, Button, Toggle, Slider, Combo, TextField, ScrollView, stackY } = ui;
	const group = new THREE.Group();
	const panel = new Panel({ name: "left", widthM: 0.85, heightM: 1.15 });
	group.add(panel.mesh);
	const title = new Label({ text: "Input", size: 40, bold: true, x: 24, y: 24 });

	const decimals = (n) => (String(n).split(".")[1] ?? "").length;
	const caption = (text) => new Label({ text, size: 24, color: theme.muted });
	const show = (v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
	const typed = (text, original) => {
		const t = text.trim();
		if (typeof original === "number") return t && Number.isFinite(Number(t)) ? Number(t) : text;
		if (typeof original === "boolean") return t === "true" ? true : t === "false" ? false : text;
		if (typeof original !== "object") return text;
		try { return JSON.parse(text); } catch { return text; }
	};

	let entries = [];

	// ---- main list ----
	function sliderFor(input, label) {
		const float = input.type === "FLOAT";
		const step = input.step ?? (float ? 0.01 : 1);
		const value = Number(store.get(input.key));
		const min = input.min ?? Math.min(0, value);
		const max = input.max ?? Math.max(100, value * 2);
		const steps = (max - min) / step, drag = steps <= 2000;
		const dec = Math.max(decimals(step), decimals(input.round));
		const slider = new Slider({
			label, min, max, step, value, drag,
			bigStep: drag ? undefined : step * 10 ** Math.max(1, Math.floor(Math.log10(steps) / 2)),
			format: float ? (v) => Number(v).toFixed(dec) : undefined,
			onChange: (v) => store.set(input.key, v),
		});
		return { widgets: [slider], update: () => { slider.value = Number(store.get(input.key)); slider.invalidate(); } };
	}

	function comboFor(input, label) {
		const options = input.options.map((o) => {
			const name = String(o);
			const option = { label: name, value: o };
			if (input.type === "IMAGE") {
				const parts = name.replaceAll("\\", "/").split("/");
				const filename = parts.pop();
				option.url = client.viewUrl({ filename, subfolder: parts.join("/"), type: "input" });
			}
			return option;
		});
		const combo = new Combo({ options, current: store.get(input.key), size: 28, onChange: (v) => store.set(input.key, v) });
		return {
			widgets: [caption(label), combo],
			update: () => combo.select(store.get(input.key)),
		};
	}

	function stringFor(input, label) {
		const field = new TextField({
			value: store.get(input.key), placeholder: "tap to edit",
			onDone: (v) => store.set(input.key, v),
		});
		return {
			widgets: [caption(label), field],
			update: () => { field.value = store.get(input.key); field.invalidate(); },
		};
	}

	function toggleFor(input, label) {
		const toggle = new Toggle({ label, value: Boolean(store.get(input.key)), onChange: (v) => store.set(input.key, v) });
		return { widgets: [toggle], update: () => { toggle.value = Boolean(store.get(input.key)); toggle.invalidate(); } };
	}

	// any other type: edited as text, converted back to the type of the original value on commit
	function textFor(input, label) {
		const field = new TextField({
			value: show(store.get(input.key)),
			onDone: (v) => {
				if (v !== show(store.get(input.key))) store.set(input.key, typed(v, input.value));
			},
		});
		return {
			widgets: [caption(label), field],
			update: () => { field.value = show(store.get(input.key)); field.invalidate(); },
		};
	}

	function sizesFor(input, label) {
		const picker = new SizePicker({ label, value: store.get(input.key), onChange: (v) => store.set(input.key, v) });
		return { widgets: [picker], update: () => { picker.value = store.get(input.key); picker.invalidate(); } };
	}

	// switched like the node: "one" and "always" turn the others off when a group goes on, "always" keeps the last one on.
	// Group states are shared by all switches, so the entry follows "switchGroups" changes.
	function groupSwitchFor(input, label) {
		const isOn = (id) => store.groupState(id) !== input.action;
		const onToggle = (id) => {
			if (input.restriction === "any") store.setGroupStates({ [id]: isOn(id) ? input.action : "on" });
			else if (!isOn(id)) store.setGroupStates(Object.fromEntries(input.groups.map((g) => [g.id, g.id === id ? "on" : input.action])));
			else if (input.restriction === "one" || input.groups.filter((g) => isOn(g.id)).length > 1) store.setGroupStates({ [id]: input.action });
		};
		const widget = new GroupSwitch({ label, action: input.action, groups: input.groups, isOn, onToggle });
		return { key: "switchGroups", widgets: [widget], update: () => widget.invalidate() };
	}

	function readOnlyFor(input, label) {
		const value = show(input.value);
		const text = `${value.length > 120 ? `${value.slice(0, 120)}…` : value}  (edit on desktop)`;
		return { widgets: [caption(label), new Label({ text, size: 26, wrap: true })], update() {} };
	}

	function controlFor(input, label) {
		if (input.type === "PIXAROMA_GROUP_SWITCH") return groupSwitchFor(input, label);
		if (!input.targets.length) return readOnlyFor(input, label);
		switch (input.type) {
			case "INT":
			case "FLOAT": return sliderFor(input, label);
			case "BOOLEAN": return toggleFor(input, label);
			case "STRING": return stringFor(input, label);
			case "PIXAROMA_SIZES": return sizesFor(input, label);
			case "COMBO":
			case "IMAGE": return comboFor(input, label);
			default: return textFor(input, label);
		}
	}

	const tabKey = () => `appmode-xr.tab.${store.snapshot?.workflowName}`;

	// hidden: inputs whose every target node the switched-off groups drop, or that were disabled on the desktop; never a
	// Group Switch, which turns them back on
	const hidden = (input, removed) => input.type !== "PIXAROMA_GROUP_SWITCH"
		&& (input.disabled || input.targets.length > 0 && input.targets.every((t) => removed.has(t.nodeId)));
	const visibleEntries = () => {
		const removed = store.removedNodes();
		return entries.filter((en) => !hidden(en.input, removed));
	};
	let shown = [], current = null, view = null;

	// the list of the active tab; clear() resets the scroll
	function showTab(name) {
		current = name;
		const list = shown.filter((en) => en.tab === name);
		let y = 12;
		for (const en of list) y = stackY(en.widgets, { x: 12, y, w: panel.width - 60, gap: 8 }) + 14;
		view.clear();
		view.setChildren(list.flatMap((en) => en.widgets));
	}

	function rebuild() {
		const inputs = store.groups.left;
		const counts = new Map();
		for (const i of inputs) counts.set(i.tab + i.label, (counts.get(i.tab + i.label) ?? 0) + 1);
		entries = inputs.map((input) => {
			const label = counts.get(input.tab + input.label) > 1 ? `${input.nodeTitle} › ${input.label}` : input.label;
			return { key: input.key, tab: input.tab, input, ...controlFor(input, label) };
		});
		current = null;
		layout();
	}

	// tab row and list of the visible entries, from the panel's size (the Desktop View's window re-flows it); the shown tab
	// stays (with its scroll) while it has visible inputs
	function layout() {
		const W = panel.width, H = panel.height;
		title.w = W - 48;
		shown = visibleEntries();
		for (const en of entries) for (const w of en.widgets) w.hover = w.pressed = false;
		const tabs = [...new Set(shown.map((en) => en.tab))];
		const keep = tabs.includes(current) ? { tab: current, scroll: view.scroll } : null;
		panel.clear();
		panel.add(title);
		if (tabs.length < 2) {
			view = panel.add(new ScrollView({ x: 12, y: 90, w: W - 24, h: H - 102 }));
			if (shown.length) showTab(tabs[0]);
			else view.setChildren([new Label({ text: "No inputs in this workflow", size: 28, color: theme.muted, x: 12, y: 12, w: W - 60 })]);
		} else {
			view = panel.add(new ScrollView({ x: 12, y: 156, w: W - 24, h: H - 168 }));
			const saved = pref(tabKey());
			const select = (name) => {
				buttons.forEach((b, i) => { b.toggled = tabs[i] === name; });
				showTab(name);
			};
			const bw = (W - 24 - GAP * (tabs.length - 1)) / tabs.length;
			const buttons = tabs.map((name, i) => panel.add(new Button({
				text: name, size: 28, x: 12 + i * (bw + GAP), y: 84, w: bw, h: 60,
				onClick: () => {
					setPref(tabKey(), name);
					select(name);
				},
			})));
			select(keep ? keep.tab : tabs.includes(saved) ? saved : tabs[0]);
		}
		if (keep?.tab === current) view.scroll = Math.min(keep.scroll, Math.max(0, view.contentH() - view.h));
	}

	panel.onResize = layout;
	store.addEventListener("load", rebuild);
	store.addEventListener("change", (e) => {
		for (const en of entries) if (en.key === e.detail.key) en.update();
		// after the press that flipped a switch is handled: layout() replaces the panel's widgets
		if (e.detail.key === "switchGroups") queueMicrotask(() => {
			const next = visibleEntries();
			if (next.length !== shown.length || next.some((en, i) => en !== shown[i])) layout();
		});
	});
	rebuild();

	return { group, panel };
}

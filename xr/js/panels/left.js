// Left panel: settings controls for store.groups.left, all edited in place: sliders and text fields take typed values, COMBO / IMAGE inputs drop down a filtered option list.
import { Widget, theme } from "../ui.js";

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
	partAt(p) { return this.parts().find((b) => p.lx >= b.x && p.lx < b.x + b.w && p.ly >= b.y && p.ly < b.y + b.h) ?? null; }
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
		ctx.font = `28px ${theme.font}`;
		ctx.fillStyle = theme.muted;
		ctx.textAlign = "left";
		ctx.fillText(this.label, 4, 22);
		ctx.font = `600 34px ${theme.font}`;
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
			if (this.hover && b.id === this.hot?.id) {
				ctx.fillStyle = this.pressed ? theme.pressed : theme.hover;
				ctx.fill();
			}
			ctx.font = `600 ${b.orientation ? 28 : 30}px ${theme.font}`;
			ctx.fillStyle = theme.fg;
			ctx.fillText(b.text, b.x + b.w / 2, b.y + b.h / 2 + 1);
		}
	}
}

export function createLeftPanel({ THREE, store, client, ui }) {
	const { Panel, Label, Button, Toggle, Slider, Combo, TextField, ScrollView, stackY } = ui;
	const group = new THREE.Group();
	const panel = new Panel({ name: "left", widthM: 0.85, heightM: 1.15 });
	group.add(panel.mesh);
	const W = panel.width, H = panel.height;
	const title = new Label({ text: "Settings", size: 40, bold: true, x: 24, y: 24, w: W - 48 });

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

	function readOnlyFor(input, label) {
		const value = show(input.value);
		const text = `${value.length > 120 ? `${value.slice(0, 120)}…` : value}  (edit on desktop)`;
		return { widgets: [caption(label), new Label({ text, size: 26, wrap: true })], update() {} };
	}

	function controlFor(input, label) {
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

	// the list of the active tab; clear() resets the scroll
	function showTab(view, name) {
		const list = entries.filter((en) => en.tab === name);
		let y = 12;
		for (const en of list) y = stackY(en.widgets, { x: 12, y, w: W - 60, gap: 8 }) + 14;
		view.clear();
		view.setChildren(list.flatMap((en) => en.widgets));
	}

	function rebuild() {
		const inputs = store.groups.left;
		const counts = new Map();
		for (const i of inputs) counts.set(i.tab + i.label, (counts.get(i.tab + i.label) ?? 0) + 1);
		entries = inputs.map((input) => {
			const label = counts.get(input.tab + input.label) > 1 ? `${input.nodeTitle} › ${input.label}` : input.label;
			return { key: input.key, tab: input.tab, ...controlFor(input, label) };
		});
		const tabs = [...new Set(entries.map((en) => en.tab))];
		panel.clear();
		panel.add(title);
		if (tabs.length < 2) {
			const view = panel.add(new ScrollView({ x: 12, y: 90, w: W - 24, h: H - 102 }));
			if (entries.length) showTab(view, tabs[0]);
			else view.setChildren([new Label({ text: "No settings in this workflow", size: 28, color: theme.muted, x: 12, y: 12, w: W - 60 })]);
			return;
		}
		const view = panel.add(new ScrollView({ x: 12, y: 156, w: W - 24, h: H - 168 }));
		let saved = null;
		try { saved = localStorage.getItem(tabKey()); } catch {}
		const select = (name) => {
			buttons.forEach((b, i) => { b.toggled = tabs[i] === name; });
			showTab(view, name);
		};
		const bw = (W - 24 - GAP * (tabs.length - 1)) / tabs.length;
		const buttons = tabs.map((name, i) => panel.add(new Button({
			text: name, size: 28, x: 12 + i * (bw + GAP), y: 84, w: bw, h: 60,
			onClick: () => {
				try { localStorage.setItem(tabKey(), name); } catch {}
				select(name);
			},
		})));
		select(tabs.includes(saved) ? saved : tabs[0]);
	}

	store.addEventListener("load", rebuild);
	store.addEventListener("change", (e) => {
		for (const en of entries) if (en.key === e.detail.key) en.update();
	});
	rebuild();

	return { group, panel };
}

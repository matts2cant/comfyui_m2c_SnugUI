// Prompt panel: the workflow name with the Text / JSON switch at its right, the prompt box (it takes all the extra height) or the
// JSON editor in its place, the negative prompt folded under a one-row header, then the seed controls on a row of their own at the
// bottom. Missing entries leave no empty box.
import * as THREE from "three";
import * as ui from "../ui.js";
import * as fmt from "../jsonprompt.js";
import { commit } from "../keyboard.js";
import { createEditor } from "../jsoneditor.js";
import { store } from "../state.js";
import { pref, setPref } from "../prefs.js";
import schema from "../../prompt/schema.json" with { type: "json" };

const MODES = [["fixed", "lock"], ["increment", "plus"], ["randomize", "shuffle"]];
const M = 20, GAP = 12, TOP = 60, ROW_H = 64, BTN_W = 60, FOLD_H = 52, NEG_H = 140, MIN_BOX = 140, SEED_W = 680, SEG_W = 56, SEG_H = 44;
const NEGATIVE_KEY = "snugui.negative";

const { theme } = ui;

// the JSON prompt's parts library on the server (__init__.py): { values: { <field key>: text }, presets: { <type>: {…} } }
async function fetchParts() {
	const res = await fetch("/snugui/parts");
	if (!res.ok) throw new Error("HTTP " + res.status);
	return res.json();
}

// writes one library file: values/<name>.txt or presets/<name>.json
async function saveParts(kind, name, body) {
	const res = await fetch(`/snugui/parts/${kind}/${encodeURIComponent(name)}`, { method: "POST", body });
	if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "HTTP " + res.status);
}

// the Text / JSON switch: two small muted icons, the current one on a light fill
class ModeSwitch extends ui.Widget {
	constructor(o) { super({ json: false, w: 2 * SEG_W, h: SEG_H, ...o }); }
	seg(p) { return p.lx >= SEG_W ? 1 : 0; }
	onDown(p) { this.onMove(p); }
	onMove(p) {
		if (this.seg(p) !== this.hot) {
			this.hot = this.seg(p);
			this.invalidate();
		}
	}
	onClick(p) { this.onPick(this.seg(p) === 1); }
	draw(ctx) {
		const r = theme.radius * 0.6;
		ctx.beginPath();
		ctx.roundRect(1, 1, this.w - 2, this.h - 2, r);
		ctx.strokeStyle = theme.border;
		ctx.lineWidth = 2;
		ctx.stroke();
		["text-initial", "code"].forEach((icon, i) => {
			const on = i === Number(this.json), x = i * SEG_W;
			if (on) {
				ctx.beginPath();
				ctx.roundRect(x + 4, 4, SEG_W - 8, this.h - 8, r - 4);
				ctx.fillStyle = theme.surface;
				ctx.fill();
			}
			if ((this.hover || this.pressed) && i === this.hot) ui.drawTint(ctx, this.pressed, x + 4, 4, SEG_W - 8, this.h - 8, r - 4);
			ctx.strokeStyle = on ? theme.fg : theme.muted;
			ui.drawIcon(ctx, icon, x + (SEG_W - 26) / 2, (this.h - 26) / 2, 26);
		});
	}
}

export function createPromptPanel() {
	const group = new THREE.Group();
	const panel = new ui.Panel({ name: "prompt", widthM: 1.8, heightM: 1.15 });
	group.add(panel.mesh);

	const name = panel.add(new ui.Label({ text: "", size: 28, bold: true, x: 24, y: 10, h: 42 }));
	const toggle = panel.add(new ModeSwitch({ y: 8, onPick: (on) => {
		commit(); // a text edit lands before the switch reads the text
		setMode(on);
	} }));
	const fold = new ui.Header({ title: "Negative", h: FOLD_H, onClick: () => {
		fold.open = !fold.open;
		setPref(NEGATIVE_KEY, fold.open ? "open" : "closed");
		layout();
	} });
	fold.open = pref(NEGATIVE_KEY) === "open";
	let prompt = null, negative = null; // [input, TextField]
	let seedRow = null;
	let widgets = [];
	let json = false; // the prompt box's mode: the JSON editor in its place
	let error = ""; // shown in red in place of the workflow name until the next prompt edit or mode switch

	const library = { values: {}, presets: {} };
	const editor = createEditor({
		panel, schema, library,
		onChange: (text) => store.set(prompt[0].key, text),
		onLibrary: (kind, file) => {
			const body = kind === "values" ? library.values[file] : JSON.stringify(library.presets[file]);
			saveParts(kind, file, body).catch((e) => setError(`Could not save ${file}: ${e.message}`));
		},
	});
	fetchParts().then((parts) => Object.assign(library, parts), (e) => setError("Could not load the parts: " + e.message));

	function setError(text) {
		error = text;
		name.color = error ? theme.danger : theme.fg;
		name.setText(error || (store.snapshot?.workflowName ?? "No workflow"));
	}

	// Text -> JSON reads the text (plain text becomes the scene, text starting with "{" that does not parse is refused); JSON ->
	// Text shows the generated JSON
	function setMode(on) {
		setError("");
		if (on && !json) {
			const r = fmt.parsePrompt(String(store.get(prompt[0].key) ?? ""), schema);
			if (r.error) return setError("Not valid JSON: " + r.error);
			editor.load(r.model);
			store.set(prompt[0].key, fmt.stringify(r.model));
		}
		json = on;
		if (json) editor.show();
		else editor.hide();
		layout();
	}

	// the empty box shows its name
	function promptBox(input, placeholder) {
		const set = (v) => store.set(input.key, v);
		return [input, new ui.TextField({ multiline: true, size: 28, placeholder, onInput: set, onDone: set })];
	}

	// "Seed", −, value, +, then the mode icons
	function seedRowFor(input) {
		const key = input.key;
		const label = new ui.Label({ text: "Seed", size: 26, color: theme.muted, w: 72, h: ROW_H });
		const value = new ui.TextField({
			size: 24, h: ROW_H,
			onDone: (v) => {
				const n = Number(v.trim());
				if (Number.isInteger(n)) store.set(key, n);
				value.value = String(store.get(key));
			},
		});
		const step = (d) => {
			const next = store.get(key) + d;
			store.set(key, Math.min(Math.max(next, input.min ?? -Infinity), input.max ?? Infinity));
		};
		const minus = new ui.Button({ text: "−", size: 34, w: BTN_W, h: ROW_H, onClick: () => step(-1) });
		const plus = new ui.Button({ text: "+", size: 34, w: BTN_W, h: ROW_H, onClick: () => step(1) });
		const modes = MODES.map(([mode, icon]) => new ui.Button({ icon, w: BTN_W, h: ROW_H, onClick: () => store.setSeedMode(key, mode) }));
		return {
			widgets: [label, minus, value, plus, ...modes],
			refresh() {
				value.value = String(store.get(key));
				MODES.forEach(([mode], i) => { modes[i].toggled = store.seedMode(key) === mode; });
			},
			// narrower than SEED_W (a phone) the label gives its room to the value
			place(x, y, w) {
				const mx = x + w - MODES.length * (BTN_W + 6) + 6;
				for (const wd of [label, minus, value, plus, ...modes]) wd.y = y;
				label.x = x;
				label.visible = w >= SEED_W;
				minus.x = label.visible ? x + 80 : x;
				plus.x = mx - 16 - plus.w;
				value.x = minus.x + minus.w + 6;
				value.w = plus.x - 6 - value.x;
				modes.forEach((b, i) => { b.x = mx + i * (BTN_W + 6); });
			},
		};
	}

	// the smallest height of the layout: name, a few prompt lines, the negative header, the seed row
	const minHeight = () => TOP + (prompt || negative ? MIN_BOX : 0) + (prompt && negative ? GAP + FOLD_H : 0) + 16 + (seedRow ? ROW_H + 16 : 0) + M;

	// from the panel's size: the Desktop View's window re-flows it
	function layout() {
		const W = panel.width, H = panel.height, seedY = H - M - ROW_H;
		toggle.visible = !!prompt;
		toggle.x = W - M - toggle.w;
		toggle.json = json;
		name.w = (prompt ? toggle.x - 16 : W - M) - 24;
		seedRow?.place(M, seedY, Math.min(SEED_W, W - 2 * M));

		// the boxes take what is left above the seed row: the negative one folded under its header, or alone
		const bottom = seedRow ? seedY - 16 : H - M;
		fold.visible = !!(prompt && negative);
		if (negative) negative[1].visible = !fold.visible || fold.open;
		if (fold.visible) {
			const free = bottom - TOP - GAP - FOLD_H - (fold.open ? 6 : 0);
			const negH = fold.open ? Math.min(NEG_H, Math.round(free / 2)) : 0;
			Object.assign(prompt[1], { x: M, y: TOP, w: W - 2 * M, h: free - negH });
			Object.assign(fold, { x: M, y: TOP + free - negH + GAP, w: W - 2 * M });
			Object.assign(negative[1], { x: M, y: bottom - negH, w: W - 2 * M, h: negH });
		} else {
			for (const [, box] of [prompt, negative].filter(Boolean)) Object.assign(box, { x: M, y: TOP, w: W - 2 * M, h: bottom - TOP });
		}
		if (prompt) {
			prompt[1].visible = !json;
			if (json) editor.layout({ x: prompt[1].x, y: prompt[1].y, w: prompt[1].w, h: prompt[1].h });
		}
		panel.invalidate();
	}

	// the store's values; the editor keeps its own model, so its writes leave it (and an open sheet) alone
	function refresh() {
		for (const [input, box] of [prompt, negative].filter(Boolean)) box.value = String(store.get(input.key) ?? "");
		fold.preview = negative?.[1].value.replace(/\s+/g, " ") ?? "";
		seedRow?.refresh();
		panel.invalidate();
	}

	// a load decides the mode: JSON when the prompt text is a JSON object
	function build() {
		const groups = store.groups;
		prompt = groups.prompt && promptBox(groups.prompt, "Prompt…");
		negative = groups.negative && promptBox(groups.negative, "Negative prompt…");
		seedRow = groups.seed && seedRowFor(groups.seed);
		for (const w of widgets) panel.remove(w);
		widgets = [prompt?.[1], prompt && negative && fold, negative?.[1], ...(seedRow?.widgets ?? [])].filter(Boolean);
		for (const w of widgets) panel.add(w);
		const text = prompt ? String(store.get(prompt[0].key) ?? "") : "", r = fmt.parsePrompt(text, schema);
		json = text.trim().startsWith("{") && !r.error;
		if (json) {
			editor.load(r.model);
			editor.show();
		} else editor.hide();
		setError("");
		refresh();
		layout();
	}

	panel.onResize = layout;
	store.addEventListener("load", build);
	store.addEventListener("change", (e) => {
		if (error && e.detail.key === prompt?.[0].key) setError("");
		refresh();
	});
	build();

	return { group, panel, minHeight };
}

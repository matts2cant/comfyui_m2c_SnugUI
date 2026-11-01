// Prompt panel: the workflow name with Save, Load and the Text / JSON switch at its right, the prompt box (it takes all the extra
// height) or the JSON editor in its place, the negative prompt folded under a one-row header, then the seed controls on a row of
// their own at the bottom. Missing entries leave no empty box.
import * as THREE from "three";
import * as ui from "../ui.js";
import * as fmt from "../jsonprompt.js";
import { commit } from "../keyboard.js";
import { button, createEditor, createSheet, focus, note, TreeRow } from "../jsoneditor.js";
import { store } from "../state.js";
import { pref, setPref } from "../prefs.js";
import schema from "../../prompt/schema.json" with { type: "json" };

const MODES = [["fixed", "lock"], ["increment", "plus"], ["randomize", "shuffle"]];
const M = 20, GAP = 12, TOP = 60, ROW_H = 64, BTN_W = 60, FOLD_H = 52, NEG_H = 140, MIN_BOX = 140, SEED_W = 680, SEG_W = 56, SEG_H = 44;
const NEGATIVE_KEY = "snugui.negative";

const { theme } = ui;

// the JSON prompt's parts library on the server (__init__.py): { values: { <field key>: text }, fragments: { <name>: text },
// presets: { <type>: {…} }, prompts: { <folder/…/name.ext>: text }, folders: [<folder/…>], mtimes: { "prompts/<path>": µs } }
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

// One library edit (POST /snugui/parts/edit): the library takes the server's answer, the whole library as it is now; a refused
// edit (409: the file changed on disk, or is already there) reloads it before throwing.
async function editParts(library, body) {
	const res = await fetch("/snugui/parts/edit", { method: "POST", body: JSON.stringify(body) });
	const data = await res.json().catch(() => ({}));
	if (res.status === 409) Object.assign(library, await fetchParts());
	if (!res.ok) throw new Error(data.error ?? "HTTP " + res.status);
	Object.assign(library, data);
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// a small bordered icon button beside the switch, as discreet: Save, Load
class Tool extends ui.Widget {
	constructor(o) { super({ icon: "", w: SEG_W, h: SEG_H, ...o }); }
	draw(ctx) {
		const r = theme.radius * 0.6;
		ctx.beginPath();
		ctx.roundRect(1, 1, this.w - 2, this.h - 2, r);
		ctx.strokeStyle = theme.border;
		ctx.lineWidth = 2;
		ctx.stroke();
		ui.tint(ctx, this, 4, 4, this.w - 8, this.h - 8, r - 4);
		ctx.strokeStyle = this.hover ? theme.fg : theme.muted;
		ui.drawIcon(ctx, this.icon, (this.w - 26) / 2, (this.h - 26) / 2, 26);
	}
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
	const save = panel.add(new Tool({ icon: "save", y: 8, onClick: () => saveSheet() }));
	const load = panel.add(new Tool({ icon: "folder-open", y: 8, onClick: () => loadSheet() }));
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

	const library = { values: {}, fragments: {}, presets: {}, prompts: {}, folders: [], mtimes: {} };
	const sheet = createSheet(panel);
	const editor = createEditor({
		panel, sheet, schema, library,
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

	// a loaded prompt replaces the text, in JSON mode when asked (its text then read as by the switch)
	function setPrompt(text, asJson) {
		store.set(prompt[0].key, text);
		json = false;
		setMode(asJson);
	}

	// Save: a name and a folder (typed, "/" nesting new ones, or picked from the existing ones), as .json in JSON mode, .txt in Text
	// mode; a name already there asks before overwriting (the write then carries the file's mtime)
	function saveSheet() {
		commit();
		const text = String(store.get(prompt[0].key) ?? ""), ext = json ? ".json" : ".txt";
		const nameField = new ui.TextField({ placeholder: "Name", onInput: () => sheet.refresh() });
		const folder = new ui.TextField({ placeholder: "Folder, e.g. portraits/studio", onInput: () => sheet.refresh() });
		const parts = () => [...folder.value.split("/").map((s) => s.trim()).filter(Boolean), nameField.value.trim()];
		let asked = null, error = ""; // asked: the path whose overwrite was asked
		const pick = (dir) => {
			commit();
			folder.value = dir;
			sheet.refresh();
		};
		const write = async (path) => {
			const mtime = library.mtimes["prompts/" + path];
			if (mtime !== undefined && asked !== path) {
				asked = path;
				return sheet.refresh();
			}
			try {
				await editParts(library, { kind: "prompts", name: path, op: "write", text, mtime });
				sheet.close();
			} catch (e) {
				asked = null;
				error = e.message;
				sheet.refresh();
			}
		};
		sheet.open(() => `Save the ${json ? "JSON" : "text"} prompt`, () => {
			const p = parts(), path = p.join("/") + ext, dir = p.slice(0, -1).join("/"), valid = p.every(fmt.validName), ask = asked === path;
			return [
				note("Name"), nameField, note("Folder"), folder,
				...valid || !p.at(-1) ? [] : [note("A name is letters, digits, - and _, words joined by a space or a dot", false, theme.danger)],
				...error ? [note(error, false, theme.danger)] : [],
				...ask ? [note(`${path} is already there: Overwrite replaces it`, false, theme.fg)] : [],
				[button(ask ? "Overwrite" : "Save", () => write(path), { variant: ask ? "danger" : "accent", disabled: !valid })],
				new TreeRow({ label: "No folder", icon: "folder", selected: !dir, onClick: () => pick("") }),
				...library.folders.map((f) => new TreeRow({ label: f.slice(f.lastIndexOf("/") + 1), icon: "folder", depth: f.split("/").length, selected: f === dir, onClick: () => pick(f) })),
			];
		});
		focus(nameField);
	}

	// Load: the saved prompts' folder tree (folders fold) or, while searching, the prompts whose path matches; a tap replaces the
	// prompt, its slots filled first: JSON mode for a .json holding an object, else Text
	function loadSheet() {
		commit();
		const open = new Set(); // unfolded folders
		const search = new ui.TextField({ placeholder: "Search saved prompts…", onInput: () => sheet.refresh() });
		const row = (it, depth, sub = "") => new TreeRow({
			label: it.name, sub, depth, icon: it.folder ? "folder" : it.path.endsWith(".json") ? "file-code" : "file-text",
			open: it.folder ? open.has(it.path) : undefined,
			onClick: () => {
				if (!it.folder) return loadPrompt(it.path);
				if (!open.delete(it.path)) open.add(it.path);
				sheet.refresh();
			},
		});
		const tree = (dir, depth) => fmt.listing(library, dir).flatMap((it) => [row(it, depth), ...it.folder && open.has(it.path) ? tree(it.path, depth + 1) : []]);
		sheet.open(() => "Load a prompt", () => {
			const q = search.value.trim().toLowerCase();
			const rows = q ? Object.keys(library.prompts).filter((p) => p.toLowerCase().includes(q)).sort().map((path) => {
				const at = path.lastIndexOf("/");
				return row({ path, name: path.slice(at + 1), folder: false }, 0, path.slice(0, Math.max(0, at)));
			}) : tree("", 0);
			return [search, ...rows, ...rows.length ? [] : [note(q ? "No saved prompt matches" : "No saved prompts yet")]];
		});
	}

	function loadPrompt(path) {
		const text = library.prompts[path], title = path.slice(path.lastIndexOf("/") + 1);
		let obj = null;
		if (path.endsWith(".json")) try { obj = JSON.parse(text); } catch {}
		if (isObject(obj)) editor.resolve(title, fmt.strings(obj), "Load", (t) => setPrompt(JSON.stringify(fmt.withStrings(obj, t)), true));
		else editor.resolve(title, [text], "Load", ([t]) => setPrompt(t, false));
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
		toggle.visible = save.visible = load.visible = !!prompt;
		toggle.x = W - M - toggle.w;
		load.x = toggle.x - 8 - load.w;
		save.x = load.x - 8 - save.w;
		toggle.json = json;
		name.w = (prompt ? save.x - 16 : W - M) - 24;
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
		sheet.refresh();
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

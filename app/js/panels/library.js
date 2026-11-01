// Library panel: the JSON prompt's library on disk (parts.js) in four tabs, Prompts (the saved prompts' folder tree), Presets (by
// subject type), Parts (the field files, then a file's parts by group) and Fragments (the same for the fragment files). Under the
// tabs a search line, + New and + Group / + Folder; then the list and the selected item's detail and actions, beside the list on a
// wide panel, in its place on a narrow one (with a back row). Every change is a server edit on the file as it is on disk; the panel
// follows the library whenever it is fetched again.
import * as THREE from "three";
import * as ui from "../ui.js";
import * as fmt from "../jsonprompt.js";
import { commit } from "../keyboard.js";
import { button, createSheet, focus, note, resolveSaved, stack, TreeRow } from "../jsoneditor.js";
import { edit, events, library, mtime } from "../parts.js";
import { store } from "../state.js";
import schema from "../../prompt/schema.json" with { type: "json" };

const M = 24, GAP = 10, ROW = 60, TABS_Y = 76, WIDE = 1100, LIST = 0.42; // LIST: the list's share of a wide panel
const TABS = [["prompts", "Prompts"], ["presets", "Presets"], ["parts", "Parts"], ["fragments", "Fragments"]];
const KIND = { parts: "values", fragments: "fragments" }; // the tabs of line files and their library kind
const { theme } = ui;

const leaf = (path) => path.slice(path.lastIndexOf("/") + 1);
const dirOf = (path) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const ext = (path) => path.slice(path.lastIndexOf("."));
const clean = (v) => v.replace(/\s+/g, " ").trim();

// setPrompt(text, json): the Prompt panel's, for "Load into prompt"
export function createLibraryPanel(setPrompt) {
	const group = new THREE.Group();
	const panel = new ui.Panel({ name: "library", widthM: 1.8, heightM: 1.15 });
	group.add(panel.mesh);
	const sheet = createSheet(panel); // the slots of a prompt loaded from here

	const title = panel.add(new ui.Label({ text: "Library", size: 34, bold: true, x: M, y: 14, h: 48 }));
	const message = panel.add(new ui.Label({ text: "", size: 24, color: theme.muted, align: "right", y: 14, h: 48 }));
	const tabs = TABS.map(([name, text]) => panel.add(new ui.Button({ text, size: 26, h: ROW, onClick: () => {
		commit();
		tab = name;
		search.value = "";
		reset();
	} })));
	const search = panel.add(new ui.TextField({ placeholder: "Search…", size: 26, h: ROW, onInput: () => render() }));
	const newBtn = panel.add(button("+ New", () => openForm("new")));
	const folderBtn = panel.add(button("+ Folder", () => openForm("group")));
	const groupBtn = panel.add(button("+ Group", () => openForm("group")));
	const list = panel.add(new ui.ScrollView({}));
	const detail = panel.add(new ui.ScrollView({}));

	let tab = "prompts";
	let file = null; // Parts / Fragments: the file shown (null: the file list)
	let sel = null; // the selected item: { type: "folder" | "prompt", path } | { type: "preset", ptype, key } | { type: "file" } | { type: "group", group } | { type: "line", group, text }
	let form = null; // a form in the detail pane in place of sel's: "new" | "group"
	let confirm = null; // the delete button that asks again
	const open = new Set(); // unfolded prompt folders
	const fields = new Map(); // the detail's text fields by role, kept across renders so an edit survives a library fetch

	const wide = () => panel.width >= WIDE;
	const kind = () => KIND[tab];

	function say(text, error = false) {
		message.color = error ? theme.danger : theme.muted;
		message.setText(text);
	}

	// runs a library edit, then done(); a refused one shows why (a refused whole-file edit drops its field: the newer version shows)
	async function run(body, done) {
		try {
			await edit(body);
			say("");
			done?.();
		} catch (e) {
			if (e.conflict) fields.clear();
			say(e.conflict ? e.message + ": showing the version on disk" : e.message, true);
		}
		render();
	}

	function select(item) {
		commit();
		sel = item;
		form = null;
		confirm = null;
		fields.clear();
		render();
	}

	function reset() {
		file = sel = form = confirm = null;
		fields.clear();
		say("");
		render();
	}

	function openForm(name) {
		commit();
		form = name;
		confirm = null;
		fields.clear();
		render();
		focus(field("form", {}));
	}

	// The detail's field for a role, made once per selection. Until the user types in it, it follows the library: value, and at the
	// mtime of the file it was read from, which a whole-file write sends back.
	function field(role, { value = "", at, ...o }) {
		let f = fields.get(role);
		if (!f) fields.set(role, f = new ui.TextField({ size: 26, h: ROW, ...o, onInput: () => { f.edited = true; } }));
		if (!f.edited) Object.assign(f, { value, at });
		return f;
	}

	// a delete button that asks again (text): the second press runs action
	function remove(id, text, action) {
		const asked = confirm === id;
		return button(asked ? text : "Delete", () => {
			if (!asked) {
				confirm = id;
				return render();
			}
			confirm = null;
			action();
		}, { variant: asked ? "danger" : "default" });
	}

	// ---- the list ----

	// the folder the prompts' actions apply to: the selected folder, or the selected prompt's
	const promptDir = () => sel?.type === "folder" ? sel.path : sel?.type === "prompt" ? dirOf(sel.path) : "";
	// the group a new part goes in: the selected group, or the selected part's
	const partGroup = () => sel?.type === "group" || sel?.type === "line" ? sel.group : "";

	function promptRows(q) {
		const row = (it, depth, sub = "") => new TreeRow({
			label: it.name, sub, depth, icon: it.folder ? "folder" : ext(it.path) === ".json" ? "file-code" : "file-text",
			open: it.folder && !q ? open.has(it.path) : undefined, selected: sel?.path === it.path,
			onClick: () => {
				if (it.folder && !q && (sel?.path === it.path || !open.has(it.path))) {
					if (!open.delete(it.path)) open.add(it.path);
				}
				select({ type: it.folder ? "folder" : "prompt", path: it.path });
			},
		});
		if (q) return [...library.folders.map((path) => ({ path, folder: true })), ...Object.keys(library.prompts).map((path) => ({ path, folder: false }))]
			.filter((it) => it.path.toLowerCase().includes(q)).sort((a, b) => a.path.localeCompare(b.path))
			.map((it) => row({ ...it, name: leaf(it.path) }, 0, dirOf(it.path)));
		const tree = (dir, depth) => fmt.listing(library, dir).flatMap((it) => [row(it, depth), ...it.folder && open.has(it.path) ? tree(it.path, depth + 1) : []]);
		return tree("", 0);
	}

	function presetRows(q) {
		const types = [...new Set([...Object.keys(schema.subjects), ...Object.keys(library.presets)])];
		return types.flatMap((ptype) => {
			const names = Object.keys(library.presets[ptype] ?? {}).filter((k) => k.toLowerCase().includes(q));
			return [note(ptype[0].toUpperCase() + ptype.slice(1), true), ...names.map((key) => new TreeRow({
				label: key, sub: library.presets[ptype][key]?.id ?? "", selected: sel?.ptype === ptype && sel.key === key,
				onClick: () => select({ type: "preset", ptype, key }),
			})), ...names.length ? [] : [note(q ? "No match" : "No presets")]];
		});
	}

	function fileRows(q) {
		const files = library[kind()];
		if (file === null) return Object.keys(files).sort().filter((name) => name.toLowerCase().includes(q)).map((name) => new TreeRow({
			label: name, icon: "file-text", sub: String(fmt.parseParts(files[name]).reduce((n, g) => n + g.parts.length, 0)),
			onClick: () => {
				file = name;
				select({ type: "file" });
			},
		}));
		const rows = [
			new TreeRow({ label: tab === "parts" ? "All fields" : "All fragments", icon: "arrow-left", onClick: () => reset() }),
			new TreeRow({ label: file, icon: "file-text", selected: sel?.type === "file", onClick: () => select({ type: "file" }) }),
		];
		for (const { group: g, parts } of fmt.parseParts(files[file] ?? "")) {
			const shown = parts.filter((t) => t.toLowerCase().includes(q));
			if (q && !shown.length) continue;
			rows.push(new TreeRow({ label: g || "Ungrouped", icon: "folder", sub: String(parts.length), selected: sel?.type === "group" && sel.group === g,
				onClick: () => select({ type: "group", group: g }) }));
			for (const text of shown) rows.push(new TreeRow({
				label: text, depth: 1, warn: fmt.missing(text, library.fragments), selected: sel?.type === "line" && sel.group === g && sel.text === text,
				onClick: () => select({ type: "line", group: g, text }),
			}));
		}
		return rows;
	}

	// ---- the detail ----

	// whether the selection is still in the library (an edit or a fetch may have removed it)
	function present() {
		if (!sel) return true;
		if (sel.type === "prompt") return Object.hasOwn(library.prompts, sel.path);
		if (sel.type === "folder") return library.folders.includes(sel.path);
		if (sel.type === "preset") return Object.hasOwn(library.presets[sel.ptype] ?? {}, sel.key);
		const text = library[kind()][file];
		if (text === undefined) return false;
		const g = fmt.parseParts(text).find((x) => x.group === sel.group);
		return sel.type === "file" || (sel.type === "group" ? !!g || !sel.group : g?.parts.includes(sel.text));
	}

	// a "Move to" list of the prompts' folders ("" first: no folder) but those skipped: tap one to move there
	const folderRows = (skip, onPick) => ["", ...library.folders].filter((f) => !skip(f)).map((f) => new TreeRow({
		label: f ? leaf(f) : "No folder", icon: "folder", depth: f ? f.split("/").length : 0, onClick: () => onPick(f),
	}));

	function promptDetail() {
		const path = sel.path, name = leaf(path), dir = dirOf(path), x = ext(path);
		const rename = field("name", { value: name.slice(0, -x.length), onDone: (v) => {
			const to = clean(v);
			if (to && to + x !== name) run({ kind: "prompts", name: path, op: "rename-file", to: (dir ? dir + "/" : "") + to + x }, () => select({ type: "prompt", path: (dir ? dir + "/" : "") + to + x }));
		} });
		const text = field("text", { value: library.prompts[path], at: mtime("prompts", path), multiline: true, h: 360 });
		const save = () => {
			if (x === ".json") try { JSON.parse(text.value); } catch (e) { return say("Not valid JSON: " + e.message, true); }
			run({ kind: "prompts", name: path, op: "write", text: text.value, mtime: text.at }, () => {
				fields.delete("text");
				say("Saved " + name);
			});
		};
		return [
			note(dir ? `In ${dir}` : "No folder"), note("Name"), rename,
			[button("Load into prompt", () => resolveSaved(sheet, path, (t, json) => {
				setPrompt(t, json);
				say(`Loaded ${name} into the prompt`);
			}), { variant: "accent", disabled: !store.groups?.prompt }), remove("prompt", "Delete " + name + "?", () => run({ kind: "prompts", name: path, op: "delete-file" }))],
			note(x === ".json" ? "JSON" : "Text"), text, [button("Save", save)],
			note("Move to"), ...folderRows((f) => f === dir, (to) => run({ kind: "prompts", name: path, op: "rename-file", to: (to ? to + "/" : "") + name }, () => select({ type: "prompt", path: (to ? to + "/" : "") + name }))),
		];
	}

	function folderDetail() {
		const path = sel.path, name = leaf(path), dir = dirOf(path);
		const inside = Object.keys(library.prompts).filter((p) => p.startsWith(path + "/")).length + library.folders.filter((f) => f.startsWith(path + "/")).length;
		const rename = field("name", { value: name, onDone: (v) => {
			const to = clean(v);
			if (to && to !== name) run({ kind: "prompts", name: path, op: "rename-file", to: (dir ? dir + "/" : "") + to }, () => select({ type: "folder", path: (dir ? dir + "/" : "") + to }));
		} });
		return [
			note(dir ? `In ${dir}` : "No folder"), note("Folder name"), rename,
			[remove("folder", inside ? `Delete it and its ${inside} items?` : "Delete the folder?", () => run({ kind: "prompts", name: path, op: "delete-file", recursive: true }))],
			note("Move to"), ...folderRows((f) => f === dir || f === path || f.startsWith(path + "/"), (to) => run({ kind: "prompts", name: path, op: "rename-file", to: (to ? to + "/" : "") + name }, () => select({ type: "folder", path: (to ? to + "/" : "") + name }))),
		];
	}

	function presetDetail() {
		const { ptype, key } = sel;
		const rename = field("name", { value: key, onDone: (v) => {
			const to = v.trim();
			if (to && to !== key) run({ kind: "presets", name: ptype, op: "rename", key, to }, () => select({ type: "preset", ptype, key: to }));
		} });
		const json = field("json", { value: JSON.stringify(library.presets[ptype][key], null, 2), at: mtime("presets", ptype), multiline: true, h: 420 });
		const save = () => {
			let value;
			try { value = JSON.parse(json.value); } catch (e) { return say("Not valid JSON: " + e.message, true); }
			if (!value || typeof value !== "object" || Array.isArray(value)) return say("A preset is a JSON object", true);
			run({ kind: "presets", name: ptype, op: "set", key, value, mtime: json.at }, () => {
				fields.delete("json");
				say("Saved " + key);
			});
		};
		return [note(`A ${ptype} preset`), note("Name"), rename, note("JSON"), json, [button("Save", save), remove("preset", `Delete ${key}?`, () => run({ kind: "presets", name: ptype, op: "delete", key }))]];
	}

	function fileDetail() {
		const k = kind(), text = library[k][file] ?? "", groups = fmt.parseParts(text);
		if (form === "raw") {
			const raw = field("raw", { value: text, at: mtime(k, file), multiline: true, h: Math.max(300, detail.h - 3 * (ROW + GAP)) });
			return [note(`${k}/${file}.txt`, true), raw, [button("Save", () => run({ kind: k, name: file, op: "write", text: raw.value, mtime: raw.at }, () => {
				form = null;
				fields.clear();
				say("Saved " + file);
			}), { variant: "accent" }), button("Cancel", () => select({ type: "file" }))]];
		}
		const rename = field("name", { value: file, onDone: (v) => {
			const to = v.trim();
			if (to && to !== file) run({ kind: k, name: file, op: "rename-file", to }, () => {
				file = to;
				select({ type: "file" });
			});
		} });
		return [
			note(`${groups.reduce((n, g) => n + g.parts.length, 0)} ${tab === "parts" ? "parts" : "values"} in ${groups.filter((g) => g.group).length} groups`),
			note("File name"), rename,
			[button("Edit file as text", () => {
				form = "raw";
				fields.clear();
				render();
			}), remove("file", `Delete ${file}.txt?`, () => run({ kind: k, name: file, op: "delete-file" }, () => reset()))],
		];
	}

	function groupDetail() {
		const k = kind(), g = sel.group, count = fmt.parseParts(library[k][file] ?? "").find((x) => x.group === g)?.parts.length ?? 0;
		const rename = g && field("name", { value: g, onDone: (v) => {
			const to = clean(v);
			if (to && to !== g) run({ kind: k, name: file, op: "rename-group", group: g, to }, () => select({ type: "group", group: to }));
		} });
		return [
			...g ? [note("Group name"), rename] : [note("Ungrouped: the lines before the first group", true)],
			[button("+ " + (tab === "parts" ? "Part" : "Value"), () => openForm("new")),
				remove("group", count ? `Delete it and its ${count} lines?` : "Delete the group?", () => run({ kind: k, name: file, op: "delete-group", group: g }))],
		];
	}

	function lineDetail() {
		const k = kind(), { group: g, text } = sel;
		const rename = field("name", { value: text, onDone: (v) => {
			const to = clean(v);
			if (to && to !== text) run({ kind: k, name: file, op: "rename", group: g, text, to }, () => select({ type: "line", group: g, text: to }));
		} });
		const others = fmt.parseParts(library[k][file] ?? "").map((x) => x.group).filter((x) => x !== g);
		if (g && !others.includes("")) others.unshift("");
		return [
			note(g ? "In " + g : "Ungrouped"), note("Text"), rename,
			...fmt.missing(text, library.fragments) ? [note("A {placeholder} here names no fragment: it stays as it is", false, "#f0a830")] : [],
			[remove("line", "Delete it?", () => run({ kind: k, name: file, op: "delete", group: g, text }))],
			...others.length ? [note("Move to"), others.map((to) => button(to || "Ungrouped", () => run({ kind: k, name: file, op: "move", group: g, text, to }, () => select({ type: "line", group: to, text }))))] : [],
		];
	}

	// + New / + Group: a name (or a part's text) and Create, for the tab and the selection
	function formDetail() {
		const name = field("form", { placeholder: "Name" });
		const create = (body, then) => {
			const v = clean(name.value);
			if (v) run(body(v), then && (() => then(v)));
		};
		const dir = promptDir(), at = (v) => (dir ? dir + "/" : "") + v, k = kind();
		let title, actions;
		if (tab === "prompts" && form === "new") {
			title = `New prompt in ${dir || "no folder"}`;
			actions = [".txt", ".json"].map((x) => button(x === ".txt" ? "Create text" : "Create JSON", () => create((v) => ({ kind: "prompts", name: at(v) + x, op: "write", text: x === ".json" ? "{}\n" : "" }), (v) => select({ type: "prompt", path: at(v) + x }))));
		} else if (tab === "prompts") {
			title = `New folder in ${dir || "no folder"}`;
			actions = [button("Create", () => create((v) => ({ kind: "prompts", name: at(v), op: "mkdir" }), (v) => {
				open.add(dir);
				select({ type: "folder", path: at(v) });
			}))];
		} else if (tab === "presets") {
			title = "New preset";
			actions = Object.keys(schema.subjects).map((ptype) => button("Create " + ptype, () => create((v) => ({ kind: "presets", name: ptype, op: "set", key: v, value: { type: ptype } }), (v) => select({ type: "preset", ptype, key: v }))));
		} else if (file === null) {
			title = tab === "parts" ? "New field file (its key: lighting, person.tattoo…)" : "New fragment (the name its {placeholder} uses)";
			actions = [button("Create", () => create((v) => ({ kind: k, name: v, op: "write", text: "" }), (v) => {
				file = v;
				select({ type: "file" });
			}))];
		} else if (form === "new") {
			title = `New ${tab === "parts" ? "part" : "value"} in ${partGroup() || "Ungrouped"}`;
			actions = [button("Add", () => create((v) => ({ kind: k, name: file, op: "add", group: partGroup(), text: v }), (v) => select({ type: "line", group: partGroup(), text: v })))];
		} else {
			title = "New group";
			actions = [button("Add", () => create((v) => ({ kind: k, name: file, op: "add-group", group: v }), (v) => select({ type: "group", group: v })))];
		}
		name.placeholder = tab === "parts" && file !== null && form === "new" ? "Part text" : "Name";
		return [note(title, true), name, [...actions.map((b) => Object.assign(b, { variant: "accent" })), button("Cancel", () => {
			form = null;
			fields.clear();
			render();
		})]];
	}

	function detailItems() {
		if (form && form !== "raw") return formDetail();
		if (!sel) return [note(tab === "prompts" ? "Select a prompt or a folder" : tab === "presets" ? "Select a preset" : file === null ? "Select a file" : "Select a line or a group")];
		return { prompt: promptDetail, folder: folderDetail, preset: presetDetail, file: fileDetail, group: groupDetail, line: lineDetail }[sel.type]();
	}

	// ---- layout ----

	function render() {
		if (file !== null && !Object.hasOwn(library[kind()], file)) file = null; // renamed or deleted on disk
		if (!present()) {
			sel = null;
			fields.clear();
		}
		const W = panel.width, H = panel.height, y0 = TABS_Y + 2 * (ROW + GAP) + GAP, h = H - y0 - M;
		const q = search.value.trim().toLowerCase(), split = wide(), showDetail = split || !!(sel || form);
		tabs.forEach((b, i) => { b.toggled = TABS[i][0] === tab; });
		folderBtn.visible = tab === "prompts";
		groupBtn.visible = !!KIND[tab] && file !== null;
		let x = W - M;
		for (const b of [groupBtn, folderBtn, newBtn].filter((b) => b.visible)) {
			x -= b.w;
			Object.assign(b, { x, y: TABS_Y + ROW + GAP });
			x -= GAP;
		}
		Object.assign(search, { x: M, y: TABS_Y + ROW + GAP, w: x - M });

		const lw = split ? Math.round((W - 2 * M - GAP) * LIST) : W - 2 * M;
		list.visible = split || !showDetail;
		detail.visible = showDetail;
		Object.assign(list, { x: M, y: y0, w: lw, h });
		Object.assign(detail, split ? { x: M + lw + 2 * GAP, y: y0, w: W - 2 * M - lw - 2 * GAP, h } : { x: M, y: y0, w: W - 2 * M, h });
		const rows = tab === "prompts" ? promptRows(q) : tab === "presets" ? presetRows(q) : fileRows(q);
		list.setChildren(stack(rows.length ? rows : [note(q ? "Nothing matches" : "Empty")], lw - 14));
		const back = split ? [] : [new TreeRow({ label: "Back", icon: "arrow-left", onClick: () => {
			commit();
			if (form) form = null;
			else sel = null;
			fields.clear();
			render();
		} })];
		detail.setChildren(stack([...back, ...detailItems()], detail.w - 14));
		panel.invalidate();
	}

	function layout() {
		const W = panel.width, tw = (W - 2 * M - 3 * GAP) / 4;
		title.w = 200;
		Object.assign(message, { x: M + 200, w: W - 2 * M - 200 });
		// narrow (a phone): the labels shrink until the longest fits
		ui.measure.font = ui.font(26, true);
		const size = Math.min(26, Math.floor(26 * (tw - 24) / Math.max(...tabs.map((b) => ui.measure.measureText(b.text).width))));
		tabs.forEach((b, i) => Object.assign(b, { size, x: M + i * (tw + GAP), y: TABS_Y, w: tw }));
		render();
		sheet.refresh();
	}

	panel.onResize = layout;
	events.addEventListener("change", () => {
		render();
		sheet.refresh();
	});
	store.addEventListener("load", render); // Load into prompt needs a prompt box
	layout();

	return { group, panel };
}

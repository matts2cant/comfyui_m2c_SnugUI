// JSON prompts: prompt text <-> the editor's model, subject ids and renames, part files. No DOM.
//
// Model nodes:
//   { kind: "group", fields: [{ key, node }], sub? }   an object; a subject carries sub = { id, type } (written first)
//   { kind: "chips", chips: [{ text, type? }] }        a string (one chip) or an array of strings; type: "number" | "boolean" |
//                                                     "null" | "json" (any other array) for values that are not strings
//   { kind: "cards", items: [group], subjects }        an array of objects; subjects: the schema's `subjects`
// Schema (app/prompt/schema.json): { prompt: spec, subjects: { <type>: spec } }, a spec mapping each key to "chips", "subjects" or a
// nested spec (a group).

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const jsonType = (v) => v === null ? "null" : typeof v;

const chips = (list) => ({ kind: "chips", chips: list });
const chip = (v) => typeof v === "string" ? { text: v } : { text: JSON.stringify(v), type: jsonType(v) };

// whether a value has the shape its schema entry asks for
function matches(v, spec) {
	if (spec === "chips") return typeof v === "string" || Array.isArray(v) && v.every((x) => typeof x === "string");
	if (spec === "subjects") return Array.isArray(v) && v.every(isObject);
	return isObject(spec) && isObject(v);
}

function empty(spec) {
	if (spec === "chips") return chips([]);
	if (spec === "subjects") return { kind: "cards", items: [], subjects: true };
	return readGroup({}, spec);
}

// an object's fields in their own order; with a spec, its missing keys as empty fields, each after the schema key before it
function readGroup(obj, spec, schema) {
	const fields = Object.entries(obj).map(([key, v]) => ({ key, node: read(v, spec?.[key], schema) }));
	if (!spec) return { kind: "group", fields };
	const keys = Object.keys(spec);
	keys.forEach((key, i) => {
		if (fields.some((f) => f.key === key)) return;
		let at = 0;
		for (let j = i - 1; j >= 0 && !at; j--) at = fields.findIndex((f) => f.key === keys[j]) + 1;
		fields.splice(at, 0, { key, node: empty(spec[key]) });
	});
	return { kind: "group", fields };
}

// a value the schema describes as spec (undefined: unknown), read as the schema asks when it has that shape, generically otherwise
function read(v, spec, schema) {
	if (spec === "subjects" && matches(v, spec)) return readSubjects(v, schema);
	if (isObject(v)) return readGroup(v, matches(v, spec) ? spec : null, schema);
	if (!Array.isArray(v)) return chips([chip(v)]);
	if (v.length && v.every(isObject)) return { kind: "cards", items: v.map((o) => readGroup(o, null, schema)), subjects: false };
	if (v.every((x) => !x || typeof x !== "object")) return chips(v.map(chip));
	return chips([{ text: JSON.stringify(v), type: "json" }]);
}

function readSubject(o, schema) {
	const { id, type, ...rest } = o;
	const node = readGroup(rest, Object.hasOwn(schema.subjects, type) ? schema.subjects[type] : null, schema);
	node.sub = { id: id === undefined ? undefined : String(id), type: type === undefined ? undefined : String(type) };
	return node;
}

function readSubjects(list, schema) {
	const items = list.map((o) => readSubject(o, schema));
	const ids = items.map((s) => s.sub.id).filter(Boolean);
	for (const s of items) if (!s.sub.id) ids.push(s.sub.id = freeId(s.sub.type ?? "subject", ids));
	return { kind: "cards", items, subjects: true };
}

// The schema's top level applies to an empty object or one with at least one schema key of the right shape; any other
// object (another tool's JSON) opens generically, without the schema's empty rows.
export function readPrompt(obj, schema) {
	const known = Object.entries(obj).length === 0 || Object.entries(obj).some(([k, v]) => matches(v, schema.prompt[k]));
	return readGroup(obj, known ? schema.prompt : null, schema);
}

export const newPrompt = (schema) => readPrompt({}, schema);

// Prompt text -> { model } or { error } (text starting with "{" that does not parse: it stays text). Plain text becomes the scene.
export function parsePrompt(text, schema) {
	const t = text.trim();
	if (!t.startsWith("{")) return { model: readPrompt(t ? { scene: t } : {}, schema) };
	try {
		return { model: readPrompt(JSON.parse(t), schema) };
	} catch (e) {
		return { error: e.message };
	}
}

// a chip's value: its text, or the JSON value it still parses to when it held one of that type
function chipValue({ text, type }) {
	if (!type) return text;
	try {
		const v = JSON.parse(text);
		if (type === "json" || jsonType(v) === type) return v;
	} catch {}
	return text;
}

// a node's JSON value, undefined when empty (blank chips, empty arrays and objects are dropped; a subject is always kept)
export function toJSON(node) {
	if (node.kind === "chips") {
		const v = node.chips.filter((c) => c.text.trim()).map(chipValue);
		return v.length > 1 ? v : v[0];
	}
	if (node.kind === "cards") {
		const v = node.items.map(toJSON).filter((x) => x !== undefined);
		return v.length ? v : undefined;
	}
	const o = {};
	if (node.sub) {
		o.id = node.sub.id;
		if (node.sub.type !== undefined) o.type = node.sub.type;
	}
	for (const f of node.fields) {
		const v = toJSON(f.node);
		if (v !== undefined) o[f.key] = v;
	}
	return node.sub || Object.keys(o).length ? o : undefined;
}

export const stringify = (model) => JSON.stringify(toJSON(model) ?? {}, null, 2);

// the prompt's subjects list (cards node), or undefined
export const subjectList = (model) => model.fields.find((f) => f.node.kind === "cards" && f.node.subjects)?.node;
export const subjectIds = (model) => subjectList(model)?.items.map((s) => s.sub.id) ?? [];

// <type>_<n>, the lowest n not taken
export function freeId(type, ids) {
	for (let n = 1; ; n++) if (!ids.includes(`${type}_${n}`)) return `${type}_${n}`;
}

export const validId = (id) => /^[a-z0-9_]+$/.test(id);

// A new subject of type: empty or a copy of preset (a subject object), with the preset's id when free, else <type>_<n>.
export function newSubject(schema, model, type, preset = {}) {
	const ids = subjectIds(model);
	const id = typeof preset.id === "string" && !ids.includes(preset.id) ? preset.id : freeId(type, ids);
	return readSubject(structuredClone({ ...preset, id, type }), schema);
}

const word = (id) => new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");

// whether text refers to id (as a whole word)
export const mentions = (text, id) => word(id).test(text);

function* allChips(node) {
	if (node.kind === "chips") yield* node.chips;
	else if (node.kind === "cards") for (const item of node.items) yield* allChips(item);
	else for (const f of node.fields) yield* allChips(f.node);
}

// gives the subject a new id and replaces the old one, as a whole word, in every text of the prompt
export function renameSubject(model, subject, id) {
	const re = word(subject.sub.id);
	subject.sub.id = id;
	for (const c of allChips(model)) c.text = c.text.replace(re, id);
}

// Part files: one part per line, "# Group" opens a group, blank lines ignored -> [{ group, parts }] ("" = before any group).
export function parseParts(text) {
	const groups = [];
	let g = null;
	const open = (name) => groups.find((x) => x.group === name) ?? groups[groups.push({ group: name, parts: [] }) - 1];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith("#")) g = open(line.slice(1).trim());
		else if (line) (g ??= open("")).parts.push(line);
	}
	return groups;
}

// Placeholders: a {name} in library text (a part, a preset's strings, a saved prompt) names a fragment, a value list in the
// fragments ({ <name>: file text }, the part file format). A placeholder naming no fragment stays literal text; braces in a
// fragment's values are literal (no nesting).
const PLACEHOLDER = /\{([\w-]+(?:\.[\w-]+)*)\}/g;

export const fragmentValues = (text) => parseParts(text).flatMap((g) => g.parts);

// the text cut into literal strings and its slots ({ name }: a placeholder whose fragment exists), in order
export function segments(text, fragments) {
	const out = [];
	let at = 0;
	for (const m of text.matchAll(PLACEHOLDER)) {
		if (!Object.hasOwn(fragments, m[1])) continue;
		if (m.index > at) out.push(text.slice(at, m.index));
		out.push({ name: m[1] });
		at = m.index + m[0].length;
	}
	if (at < text.length) out.push(text.slice(at));
	return out;
}

export const slots = (text, fragments) => segments(text, fragments).filter((s) => typeof s !== "string");

// whether text has a placeholder naming no fragment
export const missing = (text, fragments) => [...text.matchAll(PLACEHOLDER)].some((m) => !Object.hasOwn(fragments, m[1]));

// text with its slots replaced by values, in order
export function fill(text, fragments, values) {
	let i = 0;
	return segments(text, fragments).map((s) => typeof s === "string" ? s : values[i++]).join("");
}

export const randomOf = (list) => list[Math.floor(Math.random() * list.length)];

// a random value of the fragment, or the placeholder itself when it has none
export const randomValue = (fragments, name) => randomOf(fragmentValues(fragments[name])) ?? `{${name}}`;

// every string of a JSON value in order (a preset, a saved JSON prompt), and the value with them replaced by texts
export const strings = (v) => typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];
export function withStrings(v, texts) {
	let i = 0;
	const map = (x) => typeof x === "string" ? texts[i++] : Array.isArray(x) ? x.map(map)
		: isObject(x) ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, map(y)])) : x;
	return map(v);
}

// the ungrouped parts first; empty groups are dropped
export function stringifyParts(groups) {
	const lines = [];
	for (const g of [...groups].sort((a, b) => !!a.group - !!b.group)) {
		if (!g.parts.length) continue;
		if (g.group) lines.push("# " + g.group);
		lines.push(...g.parts);
	}
	return lines.length ? lines.join("\n") + "\n" : "";
}

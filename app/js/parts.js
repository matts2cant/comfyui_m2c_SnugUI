// The JSON prompt's library on disk (__init__.py's parts folder), shared by the Prompt and Library panels: { values: { <field key>:
// text }, fragments: { <name>: text }, presets: { <type>: { <name>: subject } }, prompts: { <folder/…/name.ext>: text }, folders:
// [<folder/…>], mtimes: { "<kind>/<name>": µs } }. Disk is the source of truth: the library is fetched again whenever a panel or
// sheet showing it opens and when the page becomes visible again, and every change is an edit the server applies to the file as
// it is then, answered with the whole library. "change" on events: the library was replaced.
export const library = { values: {}, fragments: {}, presets: {}, prompts: {}, folders: [], mtimes: {} };
export const events = new EventTarget();

function take(data) {
	Object.assign(library, data);
	events.dispatchEvent(new Event("change"));
}

export async function reload() {
	const res = await fetch("/snugui/parts");
	if (!res.ok) throw new Error("HTTP " + res.status);
	take(await res.json());
}

// a fetch of its own (a panel or sheet opens, the page shows again): the library stays as it was when the server is out of reach
export const sync = () => reload().catch(() => {});

document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(); });

// One edit, { kind, name, op, … } (POST /snugui/parts/edit). A refused one (409: the file changed on disk, is already there, the
// line is gone) reloads the library, then throws its message with conflict set.
export async function edit(body) {
	const res = await fetch("/snugui/parts/edit", { method: "POST", body: JSON.stringify(body) });
	const data = await res.json().catch(() => ({}));
	if (res.ok) return take(data);
	if (res.status === 409) await reload();
	throw Object.assign(new Error(data.error ?? "HTTP " + res.status), { conflict: res.status === 409 });
}

// a file's mtime as last read, for a whole-file write
export const mtime = (kind, name) => library.mtimes[`${kind}/${name}`];

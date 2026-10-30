// The results history, newest first: { filename, subfolder, type, kind ("image" | "3d"), node (the output's id), url }. The last
// HISTORY_MAX are kept in localStorage, but not temp results (Preview Image, Preview 3D (Advanced)): ComfyUI empties its temp
// folder on every start and shutdown. center.js decides which output an entry goes to and what is shown.
import { prefJSON, setPref } from "./prefs.js";

const HISTORY_KEY = "snugui.history", HISTORY_MAX = 50, CHECK_PARALLEL = 4;
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const MODEL_EXT = /\.(glb|gltf)$/i;

// images from ui.images; 3D files from ui["3d"] (Save 3D Model, Preview 3D (Advanced)...) or ui.result[0] (Preview 3D: a
// path under output/). Only formats the page can show.
export function resultFiles({ images = [], result, "3d": saved } = {}) {
	const path = typeof result?.[0] === "string" ? result[0].replaceAll("\\", "/") : null;
	const i = path?.lastIndexOf("/");
	const models = saved ?? (path ? [{ filename: path.slice(i + 1), subfolder: path.slice(0, Math.max(i, 0)), type: "output" }] : []);
	const pick = (kind) => ({ filename, subfolder, type }) => ({ filename, subfolder, type, kind });
	return [...images.filter((f) => IMAGE_EXT.test(f.filename)).map(pick("image")), ...models.filter((f) => MODEL_EXT.test(f.filename)).map(pick("3d"))];
}

// only a 404 means the file is gone; the rest (network, parse) leave the history alone
export const isMissing = (entry) => fetch(entry.url, { method: "HEAD" }).then((r) => r.status === 404, () => false);

// client: viewUrl() for the entries' url
export function createHistory(client) {
	const entries = (prefJSON(HISTORY_KEY) ?? []).filter((e) => e.type !== "temp").map((e) => ({ ...e, url: client.viewUrl(e) }));
	const save = () => setPref(HISTORY_KEY, JSON.stringify(entries.filter((e) => e.type !== "temp").map(({ filename, subfolder, type, kind, node }) => ({ filename, subfolder, type, kind, node }))));
	return {
		entries,
		// the files of one result of the output node (its id), in order -> their entries, now the newest
		add(files, node) {
			const added = files.map((f) => ({ ...f, node, url: client.viewUrl(f) }));
			entries.unshift(...[...added].reverse());
			entries.length = Math.min(entries.length, HISTORY_MAX);
			save();
			return added;
		},
		drop(gone) {
			entries.splice(0, entries.length, ...entries.filter((e) => !gone.includes(e)));
			save();
		},
		// the entries whose file is gone (HEAD requests, CHECK_PARALLEL at a time)
		async missing() {
			const queue = [...entries], gone = [];
			await Promise.all(Array.from({ length: CHECK_PARALLEL }, async () => {
				for (let e; (e = queue.shift());) if (await isMissing(e)) gone.push(e);
			}));
			return gone;
		},
	};
}

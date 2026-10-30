// Center panel: image (mesh or XR quad layer) or 3D model on a stage centered on the group origin, plus the output row (tiles
// and the cog), its output pop-up and the gallery panel. The stage takes the aspect of what it shows at the screen diagonal;
// main.js places everything. Results are kept per App-mode output. The image pans and zooms in the stage plane (`image`).
import { createModelView } from "../model.js";

const TILE = 200, TILE_GAP = 16, TILE_R = 24, COG = 80, SMALL_TILE = 120;
const NOTE_PAD_X = 40, NOTE_PAD_Y = 20;
const ASPECT_EPS = 0.01, EMPTY_ASPECT = 16 / 9;
const HISTORY_KEY = "appmode-xr.history", HISTORY_MAX = 50, CHECK_PARALLEL = 4;
const MISSING = "File no longer exists — removed from the gallery";
const STEREO_KEY = "appmode-xr.stereo";
const OUTPUT_KEY = "appmode-xr.output"; // + .<workflowName>
const STEREO_MODES = [["flat", "Flat"], ["rl", "3D R/L"], ["lr", "3D L/R"]];
const THUMB = 512, LAYER_MAX = 3072;
const IMAGE_ZOOM_MIN = 0.25, IMAGE_ZOOM_MAX = 16;
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const MODEL_EXT = /\.(glb|gltf)$/i;
const FLIP_Y = true; // layer textures follow GL row order, bottom row first

// not ui.js's cached loader: preview blob URLs are one-shot
const loadImg = (url) => new Promise((resolve, reject) => {
	const img = new Image();
	img.onload = () => resolve(img);
	img.onerror = () => reject(new Error("image load failed: " + url));
	img.src = url;
});

function makeThumb(img) {
	const k = Math.min(1, THUMB / Math.max(img.naturalWidth, img.naturalHeight));
	const c = document.createElement("canvas");
	c.width = Math.round(img.naturalWidth * k);
	c.height = Math.round(img.naturalHeight * k);
	const g = c.getContext("2d");
	g.imageSmoothingQuality = "high";
	g.drawImage(img, 0, 0, c.width, c.height);
	return c;
}

function drawFit(ctx, src, x, y, w, h) {
	const k = Math.min(w / src.width, h / src.height);
	ctx.drawImage(src, x + (w - src.width * k) / 2, y + (h - src.height * k) / 2, src.width * k, src.height * k);
}

// temp previews (Preview Image, Preview 3D) do not survive a ComfyUI restart: never persisted
function loadHistory() {
	try {
		return (JSON.parse(localStorage.getItem(HISTORY_KEY)) ?? []).filter((e) => e.type !== "temp");
	} catch {
		return [];
	}
}

function loadStereo() {
	try {
		const mode = localStorage.getItem(STEREO_KEY);
		return STEREO_MODES.some(([m]) => m === mode) ? mode : "flat";
	} catch {
		return "flat";
	}
}

function saveHistory(history) {
	try {
		localStorage.setItem(HISTORY_KEY, JSON.stringify(history.filter((e) => e.type !== "temp").map(({ filename, subfolder, type, kind, node }) => ({ filename, subfolder, type, kind, node }))));
	} catch {}
}

// images from ui.images; 3D files from ui["3d"] (Save 3D Model, Preview 3D (Advanced)...) or ui.result[0] (Preview 3D: a
// path under output/). Only formats the page can show.
function resultFiles({ images = [], result, "3d": saved } = {}) {
	const path = typeof result?.[0] === "string" ? result[0].replaceAll("\\", "/") : null;
	const i = path?.lastIndexOf("/");
	const models = saved ?? (path ? [{ filename: path.slice(i + 1), subfolder: path.slice(0, Math.max(i, 0)), type: "output" }] : []);
	const pick = (kind) => ({ filename, subfolder, type }) => ({ filename, subfolder, type, kind });
	return [...images.filter((f) => IMAGE_EXT.test(f.filename)).map(pick("image")), ...models.filter((f) => MODEL_EXT.test(f.filename)).map(pick("3d"))];
}

// rowW: the output row's widest, the toolbar's width (panel px)
export function createCenterPanel({ THREE, store, client, ui, renderer, xr, screen, desktopView }, rowW) {
	const { theme } = ui;
	const group = new THREE.Group();

	// ---- widgets ----
	// scrollable grid of the selected output's history, the shown entry outlined
	class Gallery extends ui.ImageGrid {
		draw(ctx) {
			const g = this.grid();
			this.clip(ctx, theme.radius * 0.7);
			if (!this.items.length) {
				ctx.font = `30px ${theme.font}`;
				ctx.fillStyle = theme.muted;
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText("No results yet", this.w / 2, 60);
			}
			const first = Math.floor(this.scroll / g.step) * g.cols;
			const end = Math.min(this.items.length, Math.ceil((this.scroll + this.h) / g.step) * g.cols);
			for (let i = first; i < end; i++) {
				const e = this.items[i], s = g.cw;
				const x = (i % g.cols) * g.step, y = Math.floor(i / g.cols) * g.step - this.scroll;
				ctx.beginPath();
				ctx.roundRect(x, y, s, s, 16);
				ctx.fillStyle = theme.surface;
				ctx.fill();
				const thumb = thumbOf(e);
				if (thumb) {
					ctx.save();
					ctx.clip();
					drawFit(ctx, thumb, x, y, s, s);
					ctx.restore();
				}
				if (this.hover && i === this.hotItem) {
					ctx.fillStyle = theme.hover;
					ctx.fill();
				}
				if (e === this.selected) {
					ctx.lineWidth = 7;
					ctx.strokeStyle = theme.accent;
					ctx.stroke();
				}
			}
			this.drawBar(ctx);
		}
	}

	// square output tile: the output's latest result (its kind's icon before the first one, never a live preview), a kind badge
	// and the title along the bottom; the shown output ringed, a switched-off one dimmed, a dot for results not shown yet
	class OutputTile extends ui.Widget {
		draw(ctx) {
			const { w: s, output: o } = this, icon = o.kind === "3d" ? "box" : "image";
			const latest = history.find((e) => ownerOf(e) === o), thumb = latest && thumbOf(latest);
			ctx.globalAlpha = active(o) ? 1 : 0.4;
			ctx.save();
			ctx.beginPath();
			ctx.roundRect(0, 0, s, s, TILE_R);
			ctx.clip();
			ctx.fillStyle = theme.surface;
			ctx.fillRect(0, 0, s, s);
			ctx.strokeStyle = theme.muted;
			if (thumb) ui.drawCover(ctx, thumb, 0, 0, s);
			else ui.drawIcon(ctx, icon, s * 0.32, s * 0.26, s * 0.36);
			if (this.hover || this.pressed) {
				ctx.fillStyle = this.pressed ? theme.pressed : theme.hover;
				ctx.fillRect(0, 0, s, s);
			}
			// a phone's small tiles keep their thumbnail clear: no badge, no title
			if (s >= SMALL_TILE) {
				ctx.fillStyle = "rgba(0,0,0,0.6)";
				ctx.fillRect(0, s - 40, s, 40);
				ctx.beginPath();
				ctx.arc(30, 30, 22, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillStyle = ctx.strokeStyle = theme.fg;
				ui.drawIcon(ctx, icon, 17, 17, 26);
				ctx.font = `22px ${theme.font}`;
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(ui.ellipsize(ctx, o.title, s - 20), s / 2, s - 19);
			}
			ctx.restore();
			ctx.globalAlpha = 1;
			if (this.toggled) {
				ctx.beginPath();
				ctx.roundRect(0, 0, s, s, TILE_R);
				ctx.lineWidth = 7;
				ctx.strokeStyle = theme.accent;
				ctx.stroke();
			}
			if (this.fresh) {
				ctx.beginPath();
				ctx.arc(s - 22, 22, 10, 0, Math.PI * 2);
				ctx.fillStyle = theme.accent;
				ctx.fill();
			}
		}
	}

	// gallery tile of a 3D result: a cube outline over the file name
	function modelThumb(filename) {
		const c = document.createElement("canvas");
		c.width = c.height = 256;
		const g = c.getContext("2d");
		const x = 128, y = 100, r = 64, dx = r * Math.cos(Math.PI / 6), dy = r / 2;
		g.beginPath();
		g.moveTo(x, y - r);
		for (const [px, py] of [[x + dx, y - dy], [x + dx, y + dy], [x, y + r], [x - dx, y + dy], [x - dx, y - dy], [x, y - r]]) g.lineTo(px, py);
		g.moveTo(x - dx, y - dy);
		g.lineTo(x, y);
		g.lineTo(x + dx, y - dy);
		g.moveTo(x, y);
		g.lineTo(x, y + r);
		g.lineWidth = 8;
		g.lineJoin = "round";
		g.strokeStyle = theme.accent;
		g.stroke();
		g.font = `24px ${theme.font}`;
		g.fillStyle = theme.fg;
		g.textAlign = "center";
		g.textBaseline = "middle";
		g.fillText(filename, x, 212, 236);
		return c;
	}

	// ---- panels ----
	const stage = new ui.Panel({ name: "center-stage", widthM: 1, heightM: 1, pxPerM: screen.pxPerM }); // sized by fitStage
	const row = new ui.Panel({ name: "output-row", widthM: COG / 1000, heightM: COG / 1000, bg: null }); // sized by placeRow
	// the output pop-up (cog): the selected output's name over its kind's controls; popup.mesh.visible = open
	const popup = new ui.Panel({ name: "output-popup", widthM: 0.58, heightM: 0.164, radius: 32 });
	popup.mesh.visible = false;
	const galleryPanel = new ui.Panel({ name: "gallery", widthM: 0.85, heightM: 1.15 });
	// the stage's message in the Desktop View, which shows it centered in a panel just around its text (the stage is VR only);
	// note.mesh.visible: a message is up
	const note = new ui.Panel({ name: "center-note", widthM: 1, heightM: 0.1 });
	group.add(stage.mesh);

	const empty = stage.add(new ui.Label({ text: "", size: 44, color: theme.muted, align: "center", h: 72 }));
	const noteText = note.add(new ui.Label({ text: "", size: 44, color: theme.muted, align: "center", x: NOTE_PAD_X, y: NOTE_PAD_Y, h: 72 }));

	const galleryTitle = galleryPanel.add(new ui.Label({ text: "Gallery", size: 34, bold: true, x: 24, y: 14, h: 50 }));
	const gallery = galleryPanel.add(new Gallery({ x: 24, y: 84, cell: 250, onSelect: (e) => showEntry(e) }));
	// from the panel's size: the Desktop View's window re-flows it
	galleryPanel.onResize = () => {
		galleryTitle.w = gallery.w = galleryPanel.width - 48;
		gallery.h = galleryPanel.height - 108;
	};
	galleryPanel.onResize();

	const popupTitle = new ui.Label({ text: "", size: 26, bold: true, x: 24, y: 14, w: 532, h: 44 });
	const modeBtns = STEREO_MODES.map(([m, text], i) => new ui.Button({ text, size: 26, x: [20, 148, 300][i], y: 68, w: [116, 140, 140][i], h: 76, onClick: () => setStereo(m) }));
	const hdBtn = new ui.Button({ text: "HD", size: 30, x: 464, y: 68, w: 96, h: 76, onClick: () => { hd = !hd; } });
	// the pop-up's controls per output kind; none hides the cog
	const kindControls = { image: () => [...modeBtns, hdBtn], "3d": () => [] };
	const cog = new ui.Button({ icon: "settings", round: true, w: COG, h: COG, onClick: () => showPopup(!popup.mesh.visible) });

	const model = createModelView();
	group.add(model.group);

	// ---- image mesh, its hole-punch twin and the right-eye mesh, in `view` ----
	const plane = new THREE.PlaneGeometry(1, 1);
	const imageMat = new THREE.MeshBasicMaterial({ toneMapped: false });
	const imageMesh = new THREE.Mesh(plane, imageMat);
	// writes (0,0,0,0) so the quad layer behind the projection layer shows through
	const holeMesh = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
		blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.ZeroFactor,
	}));
	// stereo modes: imageMesh is the left eye (layer 1 in XR), eyeMesh the right eye (layer 2)
	const eyeMat = new THREE.MeshBasicMaterial({ toneMapped: false });
	const eyeMesh = new THREE.Mesh(plane, eyeMat);
	eyeMesh.layers.set(2);
	imageMesh.visible = holeMesh.visible = eyeMesh.visible = false;
	const view = new THREE.Group(); // the image's pan (position, z = 0) and zoom (uniform scale) in the stage plane
	view.add(imageMesh, holeMesh, eyeMesh);
	group.add(view);

	// ---- state ----
	const history = loadHistory().map((e) => ({ ...e, url: client.viewUrl(e) }));
	// per output: { nodeId (null = any node), title, kind, current (entry on show), fresh (results not shown yet) }
	let outputs = [], out = null, tiles = [];
	let tile = TILE, maxW = rowW, vertical = false; // phones: a fixed tile size and no length limit (desktop.js scrolls the row), a column in landscape
	let shown = null;          // HTMLImageElement on the mesh / layer
	let shownEntry = null;     // history entry of `shown`, null for a preview
	let shownTex = null;
	let modelOn = false, stage3d = false, notice = "", modelToken = 0;
	let placed = null;         // the panels shown around the stage (output row, pop-up, note): main.js places them
	let previewing = false;
	let previewEpoch = 0;      // bumped when a run ends, so a preview still loading is dropped
	let singleOn = false;
	let loadToken = 0;
	let hd = false;            // quad layer, untested on hardware: off until the HD button is pressed
	let stereo = loadStereo(), halves = [];
	let stageAspect = 0;
	// live previews stay flat
	const isSplit = () => stereo !== "flat" && !previewing;

	const thumbOf = (e) => {
		if (e.kind === "3d") return e.thumb ??= modelThumb(e.filename);
		if (e.thumb === undefined) {
			e.thumb = null;
			loadImg(e.url).then((img) => { e.thumb = makeThumb(img); }, () => { e.thumb = false; }).then(() => {
				galleryPanel.invalidate();
				row.invalidate();
			});
		}
		return e.thumb;
	};

	// history entries go to the output that made them; older entries and other workflows' go to the first output of their kind
	const ownerOf = (e) => outputs.find((o) => o.nodeId === e.node) ?? outputs.find((o) => o.kind === (e.kind ?? "image")) ?? outputs[0];
	const outputKey = () => `${OUTPUT_KEY}.${store.snapshot?.workflowName}`;

	// outputs muted or bypassed (on the desktop or by a Group Switch) dim their tile and keep their history and dot
	const active = (o) => o.nodeId === null || store.outputActive(o.nodeId);

	// one tile per output; per-output state survives a snapshot reload
	function loadOutputs() {
		image.reset();
		const list = store.outputs.length ? store.outputs : [{ nodeId: null, title: "", kind: "image" }];
		outputs = list.map((o) => ({ current: null, fresh: false, ...outputs.find((p) => p.nodeId === o.nodeId), ...o }));
		row.clear();
		tiles = outputs.length < 2 ? [] : outputs.map((o) => row.add(new OutputTile({
			output: o,
			onClick: () => {
				try { localStorage.setItem(outputKey(), o.nodeId); } catch {}
				select(o);
			},
		})));
		row.add(cog);
		let saved = null;
		try { saved = localStorage.getItem(outputKey()); } catch {}
		const o = outputs.find((o) => o.nodeId === saved);
		select(o && active(o) ? o : outputs.find(active) ?? outputs[0]);
	}

	// the tiles (only when App mode configures two outputs or more), shrunk so the row stays within maxW, then the cog when any
	// output's kind has settings (disabled while the selected one has none, so the row keeps its shape); the row panel takes their
	// size. vertical: top to bottom, the cog at the foot.
	function placeRow() {
		const n = tiles.length, settings = outputs.some((o) => kindControls[o.kind]().length > 0);
		const s = n && Math.min(tile, Math.floor((maxW - (settings ? COG : -TILE_GAP)) / n) - TILE_GAP);
		const long = n * (s + TILE_GAP) + (settings ? COG : -TILE_GAP), short = Math.max(s, settings ? COG : 0);
		const [w, h] = vertical ? [short, long] : [long, short];
		tiles.forEach((t, i) => Object.assign(t, vertical ? { x: w - s, y: i * (s + TILE_GAP) } : { x: i * (s + TILE_GAP), y: h - s }, { w: s, h: s }));
		Object.assign(cog, { visible: settings, disabled: !kindControls[out.kind]().length, x: w - COG, y: h - COG });
		row.mesh.visible = n > 0 || settings;
		if (row.mesh.visible && (w !== row.width || h !== row.height)) row.resize(w / 1000, h / 1000);
	}

	// phones: tiles of `size` px however many there are, in a column when vertical; null: back to a row of TILE within rowW
	function rowTile(size, v = false) {
		if ((size ?? TILE) === tile && v === vertical) return;
		tile = size ?? TILE;
		maxW = size ? Infinity : rowW;
		vertical = v;
		refresh();
	}

	// stays open while picking options and follows the selected output; main.js closes it on a press elsewhere
	function showPopup(on) {
		popup.mesh.visible = cog.toggled = on;
		refresh();
	}

	function select(o) {
		out = o;
		o.fresh = false;
		o.current ??= history.find((e) => ownerOf(e) === o) ?? null;
		previewing = false;
		gallery.scroll = 0;
		const controls = kindControls[o.kind]();
		popupTitle.setText(o.title || "Output");
		popup.clear();
		for (const c of [popupTitle, ...controls]) popup.add(c);
		if (!controls.length) popup.mesh.visible = cog.toggled = false;
		const { current } = o;
		if (current && current !== (current.kind === "3d" ? model.entry : shownEntry)) return showEntry(current);
		notice = "";
		// an image output without results shows nothing; a 3D one keeps the stage as it is
		if (!current && o.kind === "image") shown = shownEntry = null;
		refresh();
	}

	function refresh() {
		const { current } = out;
		placeRow();
		modelOn = !previewing && current?.kind === "3d";
		stage3d = modelOn || out.kind === "3d";
		singleOn = !modelOn && !!shown;
		model.group.visible = modelOn && model.entry === current;
		note.mesh.visible = !singleOn && !model.group.visible;
		gallery.selected = current;
		gallery.items = history.filter((e) => ownerOf(e) === out);
		galleryTitle.setText(outputs.length > 1 ? `Gallery · ${out.title}` : "Gallery");
		empty.setText(!store.snapshot ? "Send a workflow from ComfyUI (Open in VR / Alt+V)"
			: modelOn ? notice || "Loading 3D model…" : notice || (out.kind === "3d" ? "No 3D models yet" : "No images yet"));
		if (empty.text !== noteText.text) {
			note.ctx.font = `${empty.size}px ${theme.font}`;
			noteText.w = Math.ceil(note.ctx.measureText(empty.text).width) + 2;
			noteText.setText(empty.text);
			note.setPx(noteText.w + 2 * NOTE_PAD_X, noteText.h + 2 * NOTE_PAD_Y, note.scale);
		}
		for (const b of modeBtns) b.disabled = stage3d;
		tiles.forEach((t, i) => {
			t.toggled = outputs[i] === out;
			t.fresh = outputs[i].fresh;
		});
		for (const p of [stage, galleryPanel, row, popup]) p.invalidate();
		fitStage();
		// the panels main.js places around the stage changed: the output row, the pop-up or the note
		const p = [row.mesh.visible, row.width, row.height, popup.mesh.visible, note.mesh.visible && noteText.text].join();
		if (p !== placed) {
			placed = p;
			screen.onResize();
		}
	}

	// stage = screen diagonal at the aspect of the displayed image (half width per eye in stereo); same-aspect previews keep it.
	// 3D keeps the stage as it was, so the panels around it stay put.
	function fitStage() {
		let a = EMPTY_ASPECT;
		if (singleOn) a = shown.naturalWidth / (isSplit() ? 2 : 1) / shown.naturalHeight;
		else if (stage3d) a = stageAspect || EMPTY_ASPECT;
		if (Math.abs(a / stageAspect - 1) < ASPECT_EPS) return;
		stageAspect = a;
		const h = screen.diagonal / Math.hypot(1, a), w = h * a;
		stage.resize(w, h);
		empty.x = 40;
		empty.y = stage.height / 2 - 36;
		empty.w = stage.width - 80;
		imageMesh.scale.set(w, h, 1);
		holeMesh.scale.copy(imageMesh.scale);
		eyeMesh.scale.copy(imageMesh.scale);
		model.setStage(w, h);
		screen.w = w;
		screen.h = h;
		screen.onResize();
	}

	function setShown(img, entry) {
		const tex = new THREE.Texture(img);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
		tex.minFilter = THREE.LinearMipmapLinearFilter;
		tex.needsUpdate = true;
		shownTex?.dispose();
		shownTex = tex;
		shown = img;
		shownEntry = entry;
		layoutImage();
	}

	// maps shownTex whole, or one half per eye in the stereo modes (L/R: left half is the left eye, R/L: crossed)
	function layoutImage() {
		const split = isSplit();
		halves.forEach((t) => t.dispose());
		halves = split ? [0, 0.5].map((x) => {
			const half = shownTex.clone();
			half.repeat.x = 0.5;
			half.offset.x = x;
			half.needsUpdate = true;
			return half;
		}) : [];
		if (stereo === "rl") halves.reverse();
		[imageMat.map, eyeMat.map] = split ? halves : [shownTex, null];
		imageMat.needsUpdate = eyeMat.needsUpdate = true;
	}

	function setStereo(mode) {
		stereo = mode;
		image.reset();
		try {
			localStorage.setItem(STEREO_KEY, mode);
		} catch {}
		if (shown) layoutImage();
		syncModeBtns();
		refresh();
	}

	function syncModeBtns() {
		modeBtns.forEach((b, i) => {
			b.toggled = STEREO_MODES[i][0] === stereo;
			b.invalidate();
		});
	}

	// only a 404 means the file is gone; the rest (network, parse) leave the history alone
	const isMissing = (entry) => fetch(entry.url, { method: "HEAD" }).then((r) => r.status === 404, () => false);

	// removes entries whose file is gone; an output that showed one falls back to its next entry
	function dropEntries(gone) {
		const { current } = out;
		history.splice(0, history.length, ...history.filter((e) => !gone.includes(e)));
		saveHistory(history);
		for (const o of outputs) if (gone.includes(o.current)) o.current = history.find((e) => ownerOf(e) === o) ?? null;
		if (gone.includes(shownEntry) || !out.current && out.kind === "image") shown = shownEntry = null;
		if (!gone.includes(current)) return refresh();
		if (out.current) showEntry(out.current);
		else refresh();
	}

	// the message stays unless a fallback entry took the stage
	function showMissing() {
		notice = MISSING;
		refresh();
	}

	async function pruneMissing(entries) {
		const gone = [];
		await Promise.all(Array.from({ length: CHECK_PARALLEL }, async () => {
			for (let e; (e = entries.shift());) if (await isMissing(e)) gone.push(e);
		}));
		if (gone.length) dropEntries(gone);
	}

	async function showEntry(entry) {
		out.current = entry;
		notice = "";
		const token = ++loadToken;
		if (entry.kind === "3d") return showModel(entry);
		refresh();
		let img;
		try {
			img = await loadImg(entry.url);
		} catch (e) {
			if (await isMissing(entry)) {
				dropEntries([entry]);
				if (token === loadToken) showMissing();
				return;
			}
			return console.warn(e.message);
		}
		if (token !== loadToken) return;
		if (!entry.thumb) entry.thumb = makeThumb(img);
		previewing = false;
		setShown(img, entry);
		refresh();
	}

	async function showModel(entry) {
		const token = ++modelToken;
		refresh();
		if (model.entry === entry) return;
		let loaded;
		try {
			loaded = await model.load(entry.url);
		} catch (e) {
			if (await isMissing(entry)) {
				dropEntries([entry]);
				if (token === modelToken) showMissing();
				return;
			}
			console.warn(e);
			if (token === modelToken) notice = "Could not load " + entry.filename;
			return refresh();
		}
		if (token !== modelToken) return model.discard(loaded);
		model.show(loaded, entry);
		refresh();
	}

	// back from a live preview to the last real image once the run is over
	function endPreview() {
		previewEpoch++;
		if (!previewing) return;
		previewing = false;
		if (out.current) showEntry(out.current);
		else {
			shown = null;
			refresh();
		}
	}

	// ---- events ----
	store.addEventListener("load", loadOutputs);
	// a switched-off group can drop the selected output: show the first active one (no switching back when it returns);
	// with none active the screen keeps the last result
	store.addEventListener("change", ({ detail }) => {
		if (detail.key !== "switchGroups") return;
		const next = active(out) ? null : outputs.find(active);
		if (next) select(next);
		else refresh();
	});

	for (const type of ["done", "interrupted", "error"]) client.addEventListener(type, endPreview);

	// live previews only show while an image output is selected
	client.addEventListener("preview", async ({ detail }) => {
		if (out.kind === "3d") return;
		const token = ++loadToken, epoch = previewEpoch;
		let img;
		try {
			img = await loadImg(detail.url);
		} catch {
			return;
		}
		if (token !== loadToken || epoch !== previewEpoch) return;
		previewing = true;
		setShown(img, null);
		refresh();
	});

	// results of an output that is not on show only mark its tile: the selection never changes on its own
	client.addEventListener("executed", ({ detail }) => {
		const o = outputs.find((o) => o.nodeId === null || o.nodeId === String(detail.node));
		const files = o ? resultFiles(detail.output) : [];
		if (!files.length) return;
		const entries = files.map((f) => ({ ...f, node: o.nodeId, url: client.viewUrl(f) }));
		history.unshift(...[...entries].reverse());
		history.length = Math.min(history.length, HISTORY_MAX);
		saveHistory(history);
		o.current = entries[entries.length - 1];
		if (o !== out) {
			o.fresh = true;
			return refresh();
		}
		gallery.scroll = 0;
		showEntry(o.current);
	});

	// ---- image pan and zoom ----
	// The image moves and scales in the stage plane, never turns, and may cover the panels around the stage. Grab poses are
	// reduced to their point in the stage frame: one moves the image by its in-plane motion, two scale it by their distance and
	// move it with their midpoint (model.js's grab without the turn); `start` is the view when the hands last changed.
	const hands = new Map(), inv = new THREE.Matrix4(), local = new THREE.Ray(), at = new THREE.Vector3(), mid = new THREE.Vector3();
	const stagePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
	const clampZoom = (s) => Math.max(IMAGE_ZOOM_MIN, Math.min(IMAGE_ZOOM_MAX, s));
	let start = null;

	function toStage(world, out) {
		group.updateWorldMatrix(true, false);
		return out.setFromMatrixPosition(world).applyMatrix4(inv.copy(group.matrixWorld).invert());
	}

	// the ray's point on the stage plane (stage frame) in `at`, or null
	function onStage(ray) {
		group.updateWorldMatrix(true, false);
		return local.copy(ray).applyMatrix4(inv.copy(group.matrixWorld).invert()).intersectPlane(stagePlane, at);
	}

	function begin() {
		const [a, b] = hands.values();
		start = { pos: view.position.clone(), scale: view.scale.x, mid: b ? a.clone().add(b).multiplyScalar(0.5) : a?.clone(), dist: b && a.distanceTo(b) };
	}

	const image = {
		// distance along a world ray to the shown image, or null
		hit(ray) {
			if (!singleOn || !onStage(ray)) return null;
			const k = view.scale.x / 2;
			if (Math.abs(at.x - view.position.x) > imageMesh.scale.x * k || Math.abs(at.y - view.position.y) > imageMesh.scale.y * k) return null;
			return at.applyMatrix4(group.matrixWorld).distanceTo(ray.origin);
		},

		// about the ray's point on the image, which stays under the ray
		zoom(k, ray) {
			const s = clampZoom(view.scale.x * k);
			if (onStage(ray)) view.position.sub(at).multiplyScalar(s / view.scale.x).add(at).setZ(0);
			view.scale.setScalar(s);
			if (hands.size) begin();
		},

		// id: the hand; world: its pose (Matrix4), only its position is used
		grab(id, world) {
			hands.set(id, toStage(world, new THREE.Vector3()));
			begin();
		},

		drag(id, world) {
			toStage(world, hands.get(id));
			const [a, b] = hands.values();
			const s = b ? clampZoom(start.scale * a.distanceTo(b) / start.dist) : start.scale;
			if (b) mid.copy(a).add(b).multiplyScalar(0.5);
			else mid.copy(a);
			view.position.copy(start.pos).sub(start.mid).multiplyScalar(s / start.scale).add(mid).setZ(0);
			view.scale.setScalar(s);
		},

		release(id) {
			hands.delete(id);
			begin();
		},

		// fitted to the stage again; a hand still holding carries it on from there
		reset() {
			view.position.set(0, 0, 0);
			view.scale.setScalar(1);
			if (hands.size) begin();
		},
	};

	// ---- XR quad layer (HD) ----
	let hdSupported = false, layerFailed = false;
	let layerSession = null, quad = null, quadW = 0, quadH = 0, inLayers = false, uploaded = null;
	const lastPose = new THREE.Matrix4();
	const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
	const scaler = document.createElement("canvas");

	function applyPose(m) {
		m.decompose(pos, quat, scl);
		quad.width = scl.x / 2;
		quad.height = scl.y / 2;
		quad.transform = new XRRigidTransform(pos, quat);
		lastPose.copy(m);
	}

	function upload(binding, pw, ph) {
		let src = shown;
		if (pw !== shown.naturalWidth) {
			scaler.width = pw;
			scaler.height = ph;
			scaler.getContext("2d").drawImage(shown, 0, 0, pw, ph);
			src = scaler;
		}
		const gl = renderer.getContext();
		const sub = binding.getSubImage(quad, renderer.xr.getFrame());
		renderer.state.bindTexture(gl.TEXTURE_2D, sub.colorTexture);
		gl.getError();
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, FLIP_Y);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		// a rejected upload would leave the hole over an empty layer
		if (gl.getError()) throw new Error("quad layer upload failed");
		uploaded = shown;
	}

	// Mirrors three's webxr_vr_layers example: [quad layer, projection layer] with a transparent hole
	// punched where the image is. Sets imageMesh / holeMesh visibility. Quest Browser takes quad width/height
	// as half extents (three halves them too). Size and pose follow holeMesh's world matrix, so the image's pan and zoom.
	function updateLayer() {
		const session = xr.isPresenting() ? renderer.xr.getSession() : null;
		if (session !== layerSession) {
			layerSession = session;
			quad = uploaded = null;
			inLayers = false;
		}
		const binding = session && !layerFailed ? renderer.xr.getBinding() : null;
		hdSupported = !!binding;
		let hole = false;
		if (binding && hd && singleOn && !previewing && !isSplit()) {
			const k = Math.min(1, LAYER_MAX / Math.max(shown.naturalWidth, shown.naturalHeight));
			const pw = Math.round(shown.naturalWidth * k), ph = Math.round(shown.naturalHeight * k);
			holeMesh.updateWorldMatrix(true, false);
			const m = holeMesh.matrixWorld;
			if (!quad || quadW !== pw || quadH !== ph) {
				quad?.destroy();
				m.decompose(pos, quat, scl);
				quad = binding.createQuadLayer({
					space: renderer.xr.getReferenceSpace(), layout: "mono", viewPixelWidth: pw, viewPixelHeight: ph,
					width: scl.x / 2, height: scl.y / 2, transform: new XRRigidTransform(pos, quat),
				});
				lastPose.copy(m);
				quadW = pw;
				quadH = ph;
				uploaded = null;
				inLayers = false;
			} else if (!lastPose.equals(m)) applyPose(m);
			if (!inLayers) {
				session.updateRenderState({ layers: [quad, renderer.xr.getBaseLayer()] });
				inLayers = true;
			} else {
				if (uploaded !== shown || quad.needsRedraw) upload(binding, pw, ph);
				hole = true;
			}
		} else if (inLayers) {
			inLayers = false;
			session.updateRenderState({ layers: [renderer.xr.getBaseLayer()] });
		}
		holeMesh.visible = hole;
		imageMesh.visible = singleOn && !hole;
	}

	// XR eyes render layers 1 (left) and 2 (right); the desktop camera only sees layer 0, so it shows the left eye there
	function updateEyes() {
		const split = singleOn && isSplit();
		eyeMesh.visible = split;
		imageMesh.layers.set(split && xr.isPresenting() ? 1 : 0);
	}

	function update() {
		try {
			updateLayer();
		} catch (e) {
			console.warn("quad layer disabled", e);
			layerFailed = true;
			quad = null;
			if (inLayers) renderer.xr.getSession().updateRenderState({ layers: [renderer.xr.getBaseLayer()] });
			inLayers = false;
			holeMesh.visible = false;
			imageMesh.visible = singleOn;
		}
		updateEyes();
		stage.mesh.visible = note.mesh.visible && !desktopView();
		const hdUsable = hdSupported && !isSplit() && !stage3d;
		if (hdBtn.toggled !== hd || hdBtn.disabled === hdUsable) {
			hdBtn.toggled = hd;
			hdBtn.disabled = !hdUsable;
			hdBtn.invalidate();
		}
	}

	syncModeBtns();
	loadOutputs();
	pruneMissing([...history]);
	const closePopup = () => { if (popup.mesh.visible) showPopup(false); };
	return { group, update, model, image, row, rowH: TILE, rowTile, cog, popup, closePopup, gallery: galleryPanel, note };
}

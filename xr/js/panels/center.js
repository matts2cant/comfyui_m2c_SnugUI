// Center panel: image (mesh or XR quad layer) or batch grid on a stage centered on the group origin, plus the status bar and
// history strip panels. The stage takes the aspect of what it shows at the screen diagonal; main.js places everything.
// With several App-mode outputs the status bar gets a row of output buttons; results are kept per output.
import { createModelView } from "../model.js";

const BAR_W = 1.6, BAR_H = 0.12, BAR_H_OUTPUTS = 0.21, STRIP_H = 0.2; // BAR_W matches the prompt panel
const ASPECT_EPS = 0.01, EMPTY_ASPECT = 16 / 9;
const HISTORY_KEY = "appmode-xr.history", HISTORY_MAX = 50;
const STEREO_KEY = "appmode-xr.stereo";
const OUTPUT_KEY = "appmode-xr.output"; // + .<workflowName>
const STEREO_MODES = [["flat", "Flat"], ["lr", "3D L/R"], ["rl", "3D R/L"]];
const THUMB = 512, LAYER_MAX = 3072;
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

function loadHistory() {
	try {
		return JSON.parse(localStorage.getItem(HISTORY_KEY)) ?? [];
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
		localStorage.setItem(HISTORY_KEY, JSON.stringify(history.map(({ filename, subfolder, type, kind, node }) => ({ filename, subfolder, type, kind, node }))));
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

export function createCenterPanel({ THREE, store, client, ui, renderer, xr, screen }) {
	const { theme } = ui;
	const group = new THREE.Group();

	// ---- widgets ----
	class ProgressBar extends ui.Widget {
		constructor(o) { super({ value: 0, max: 0, text: "Idle", error: false, ...o }); }
		draw(ctx) {
			const { w, h } = this, bh = 52, y = (h - bh) / 2;
			ctx.save();
			ctx.beginPath();
			ctx.roundRect(0, y, w, bh, bh / 2);
			ctx.fillStyle = theme.surface;
			ctx.fill();
			ctx.clip();
			if (this.max > 0) {
				ctx.fillStyle = theme.accent;
				ctx.fillRect(0, y, w * Math.min(1, this.value / this.max), bh);
			}
			ctx.restore();
			ctx.font = `600 30px ${theme.font}`;
			ctx.fillStyle = this.error ? theme.danger : theme.fg;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(this.max > 0 ? `${this.value}/${this.max}  ${this.text}` : this.text, w / 2, h / 2 + 1, w - 32);
		}
	}

	// horizontal strip of thumbnails; drags and scrolls sideways
	const CELL = 170, STEP = 184, ARROW = 80, PAD = 15;
	class HistoryStrip extends ui.Widget {
		constructor(o) { super({ entries: [], selected: null, offset: 0, dragCapture: true, ...o }); }
		viewW() { return this.w - 2 * (ARROW + 8); }
		maxOffset() { return Math.max(0, this.entries.length * STEP - 10 - this.viewW()); }
		canScroll() { return this.maxOffset() > 0; }
		scrollTo(x) {
			this.offset = Math.min(this.maxOffset(), Math.max(0, x));
			this.invalidate();
		}
		onScroll(dy) {
			const before = this.offset;
			this.scrollTo(before + dy);
			return this.offset !== before;
		}
		onDown(p) { this.grab = { x: p.lx, offset: this.offset }; }
		onMove(p) { if (this.pressed) this.scrollTo(this.grab.offset - (p.lx - this.grab.x)); }
		onClick(p) {
			if (this.canScroll() && p.lx < ARROW) return this.scrollTo(this.offset - 4 * STEP);
			if (this.canScroll() && p.lx > this.w - ARROW) return this.scrollTo(this.offset + 4 * STEP);
			const x = p.lx - (ARROW + 8) + this.offset;
			const i = Math.floor(x / STEP);
			if (x - i * STEP < CELL && this.entries[i]) this.onSelect(this.entries[i]);
		}
		draw(ctx) {
			const { w, h } = this, x0 = ARROW + 8;
			if (!this.entries.length) {
				ctx.font = `38px ${theme.font}`;
				ctx.fillStyle = theme.muted;
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText("History", w / 2, h / 2);
				return;
			}
			ctx.save();
			ctx.beginPath();
			ctx.rect(x0, 0, this.viewW(), h);
			ctx.clip();
			this.entries.forEach((e, i) => {
				const x = x0 + i * STEP - this.offset;
				if (x + CELL < x0 || x > x0 + this.viewW()) return;
				ctx.beginPath();
				ctx.roundRect(x, PAD, CELL, CELL, 16);
				ctx.fillStyle = theme.surface;
				ctx.fill();
				const thumb = this.thumbOf(e);
				if (thumb) {
					ctx.save();
					ctx.clip();
					drawFit(ctx, thumb, x, PAD, CELL, CELL);
					ctx.restore();
				}
				if (e === this.selected) {
					ctx.lineWidth = 7;
					ctx.strokeStyle = theme.accent;
					ctx.stroke();
				}
			});
			ctx.restore();
			if (!this.canScroll()) return;
			ctx.font = `600 56px ${theme.font}`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			for (const [x, t] of [[0, "‹"], [w - ARROW, "›"]]) {
				ctx.beginPath();
				ctx.roundRect(x, PAD, ARROW, CELL, 20);
				ctx.fillStyle = theme.surface;
				ctx.fill();
				ctx.fillStyle = theme.fg;
				ctx.fillText(t, x + ARROW / 2, PAD + CELL / 2);
			}
		}
	}

	// square cells in a near-square cols x rows arrangement; the stage takes that grid's aspect
	const gridDims = (n) => {
		const cols = Math.ceil(Math.sqrt(n));
		return { cols, rows: Math.ceil(n / cols) };
	};

	class BatchGrid extends ui.Widget {
		constructor(o) { super({ items: [], selected: null, gap: 16, ...o }); }
		cells() {
			const { cols, rows } = gridDims(this.items.length), gap = this.gap;
			const s = Math.min((this.w - gap * (cols - 1)) / cols, (this.h - gap * (rows - 1)) / rows);
			const x0 = (this.w - (cols * s + gap * (cols - 1))) / 2, y0 = (this.h - (rows * s + gap * (rows - 1))) / 2;
			return this.items.map((_, i) => ({ x: x0 + (i % cols) * (s + gap), y: y0 + Math.floor(i / cols) * (s + gap), s }));
		}
		onClick(p) {
			const i = this.cells().findIndex((c) => p.lx >= c.x && p.lx < c.x + c.s && p.ly >= c.y && p.ly < c.y + c.s);
			if (i >= 0) this.onSelect(this.items[i]);
		}
		draw(ctx) {
			this.cells().forEach((c, i) => {
				const item = this.items[i];
				ctx.beginPath();
				ctx.roundRect(c.x, c.y, c.s, c.s, 14);
				ctx.fillStyle = theme.surface;
				ctx.fill();
				const thumb = this.thumbOf(item);
				if (thumb) {
					ctx.save();
					ctx.clip();
					drawFit(ctx, thumb, c.x, c.y, c.s, c.s);
					ctx.restore();
				}
				if (item === this.selected) {
					ctx.lineWidth = 6;
					ctx.strokeStyle = theme.accent;
					ctx.stroke();
				}
			});
		}
	}

	// output switch button; a dot marks results that came in since the output was last shown
	class OutputButton extends ui.Button {
		draw(ctx) {
			super.draw(ctx);
			if (!this.fresh) return;
			ctx.beginPath();
			ctx.arc(this.w - 16, 16, 9, 0, Math.PI * 2);
			ctx.fillStyle = theme.accent;
			ctx.fill();
		}
	}

	// history / grid tile of a 3D result: a cube outline over the file name
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
	const status = new ui.Panel({ name: "center-status", widthM: BAR_W, heightM: BAR_H });
	const stage = new ui.Panel({ name: "center-stage", widthM: 1, heightM: 1, pxPerM: screen.pxPerM }); // sized by fitStage
	const stripPanel = new ui.Panel({ name: "center-history", widthM: BAR_W, heightM: STRIP_H });
	group.add(stage.mesh);

	const nameLabel = status.add(new ui.Label({ text: "", size: 34, bold: true, x: 24, y: 0, w: 230, h: 120 }));
	const progress = status.add(new ProgressBar({ x: 262, y: 0, w: 420, h: 120 }));
	const queueLabel = status.add(new ui.Label({ text: "", size: 28, color: theme.muted, align: "center", x: 686, y: 0, w: 104, h: 120 }));
	const modeBtns = STEREO_MODES.map(([m, text], i) => status.add(new ui.Button({ text, size: 26, x: 800 + [0, 112, 232][i], y: 22, w: [104, 112, 112][i], h: 76, onClick: () => setStereo(m) })));
	const gridBtn = status.add(new ui.Button({ text: "Grid", size: 30, x: 1160, y: 22, w: 110, h: 76, onClick: () => { out.view = gridOn ? "single" : "grid"; refresh(); } }));
	const hdBtn = status.add(new ui.Button({ text: "HD", size: 30, x: 1280, y: 22, w: 90, h: 76, onClick: () => { hd = !hd; } }));
	const modeBtn = status.add(new ui.Button({ text: "", size: 30, x: 1380, y: 22, w: 200, h: 76, onClick: () => xr.toggleMode() }));

	const grid = stage.add(new BatchGrid({ onSelect: (e) => { out.view = "single"; showEntry(e); } }));
	const empty = stage.add(new ui.Label({ text: "", size: 44, color: theme.muted, align: "center", h: 72 }));

	const strip = stripPanel.add(new HistoryStrip({ x: 0, y: 0, w: stripPanel.width, h: stripPanel.height, onSelect: (e) => { out.view = "single"; showEntry(e); } }));

	const model = createModelView();
	group.add(model.group);

	// ---- image mesh, its hole-punch twin and the right-eye mesh ----
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
	group.add(imageMesh, holeMesh, eyeMesh);

	// ---- state ----
	const history = loadHistory().map((e) => ({ ...e, url: client.viewUrl(e) }));
	const byPrompt = new Map(); // prompt_id -> Map(output nodeId -> batch)
	let runBatches = new Map();
	// per output: { nodeId (null = any node), title, kind, batch (results of its last run), current (entry on show),
	// view ("single" | "grid"), fresh (results not shown yet) }
	let outputs = [], out = null, outBtns = [];
	let shown = null;          // HTMLImageElement on the mesh / layer
	let shownEntry = null;     // history entry of `shown`, null for a preview
	let shownTex = null;
	let modelOn = false, stage3d = false, modelError = "", modelToken = 0;
	let previewing = false;
	let previewEpoch = 0;      // bumped when a run ends, so a preview still loading is dropped
	let gridOn = false, singleOn = false;
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
			loadImg(e.url).then((img) => { e.thumb = makeThumb(img); }, () => { e.thumb = false; }).then(() => { stage.invalidate(); stripPanel.invalidate(); });
		}
		return e.thumb;
	};
	grid.thumbOf = strip.thumbOf = thumbOf;

	// history entries go to the output that made them; older entries and other workflows' go to the first output of their kind
	const ownerOf = (e) => outputs.find((o) => o.nodeId === e.node) ?? outputs.find((o) => o.kind === (e.kind ?? "image")) ?? outputs[0];
	const outputKey = () => `${OUTPUT_KEY}.${store.snapshot?.workflowName}`;

	// output buttons in a second status bar row, only with two outputs or more; per-output state survives a snapshot reload
	function loadOutputs() {
		const list = store.outputs.length ? store.outputs : [{ nodeId: null, title: "", kind: "image" }];
		outputs = list.map((o) => ({ batch: null, current: null, view: "single", fresh: false, ...outputs.find((p) => p.nodeId === o.nodeId), ...o }));
		for (const b of outBtns) status.remove(b);
		const bw = (status.width - 48 - 12 * (outputs.length - 1)) / outputs.length;
		outBtns = outputs.length < 2 ? [] : outputs.map((o, i) => status.add(new OutputButton({
			text: o.title, size: 26, x: 24 + i * (bw + 12), y: 116, w: bw, h: 76,
			onClick: () => {
				try { localStorage.setItem(outputKey(), o.nodeId); } catch {}
				select(o);
			},
		})));
		status.resize(BAR_W, outBtns.length ? BAR_H_OUTPUTS : BAR_H);
		screen.onResize();
		let saved = null;
		try { saved = localStorage.getItem(outputKey()); } catch {}
		select(outputs.find((o) => o.nodeId === saved) ?? outputs[0]);
	}

	function select(o) {
		out = o;
		o.fresh = false;
		o.current ??= history.find((e) => ownerOf(e) === o) ?? null;
		previewing = false;
		strip.offset = 0;
		const { current } = o;
		if (current && current !== (current.kind === "3d" ? model.entry : shownEntry)) return showEntry(current);
		// an image output without results shows nothing; a 3D one keeps the stage as it is
		if (!current && o.kind === "image") shown = shownEntry = null;
		refresh();
	}

	function refresh() {
		const results = out.batch?.results ?? [];
		const { current } = out;
		gridOn = !previewing && out.view === "grid" && results.length >= 2;
		modelOn = !gridOn && !previewing && current?.kind === "3d";
		stage3d = modelOn || !gridOn && out.kind === "3d";
		singleOn = !gridOn && !modelOn && !!shown;
		model.group.visible = modelOn && model.entry === current;
		stage.mesh.visible = !singleOn && !model.group.visible;
		grid.visible = gridOn;
		grid.items = results;
		grid.selected = strip.selected = current;
		strip.entries = history.filter((e) => ownerOf(e) === out);
		empty.visible = !gridOn && !singleOn && !model.group.visible;
		empty.setText(!store.snapshot ? "Send a workflow from ComfyUI (Open in VR / Alt+V)"
			: modelOn ? modelError || "Loading 3D model…" : out.kind === "3d" ? "No 3D models yet" : "No images yet");
		gridBtn.visible = results.length >= 2;
		gridBtn.toggled = gridOn;
		for (const b of modeBtns) b.disabled = stage3d;
		outBtns.forEach((b, i) => {
			b.toggled = outputs[i] === out;
			b.fresh = outputs[i].fresh;
		});
		for (const p of [stage, stripPanel, status]) p.invalidate();
		fitStage();
	}

	// stage = screen diagonal at the aspect of the grid / displayed image (half width per eye in stereo); same-aspect previews keep it.
	// 3D keeps the stage as it was, so the panels around it stay put.
	function fitStage() {
		let a = EMPTY_ASPECT;
		if (gridOn) {
			const { cols, rows } = gridDims(out.batch.results.length);
			a = cols / rows;
		} else if (singleOn) a = shown.naturalWidth / (isSplit() ? 2 : 1) / shown.naturalHeight;
		else if (stage3d) a = stageAspect || EMPTY_ASPECT;
		if (Math.abs(a / stageAspect - 1) < ASPECT_EPS) return;
		stageAspect = a;
		const h = screen.diagonal / Math.hypot(1, a), w = h * a;
		stage.resize(w, h);
		grid.x = grid.y = 20;
		grid.w = stage.width - 40;
		grid.h = stage.height - 40;
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

	async function showEntry(entry) {
		out.current = entry;
		const token = ++loadToken;
		if (entry.kind === "3d") return showModel(entry);
		refresh();
		let img;
		try {
			img = await loadImg(entry.url);
		} catch (e) {
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
		modelError = "";
		refresh();
		if (model.entry === entry) return;
		let loaded;
		try {
			loaded = await model.load(entry.url);
		} catch (e) {
			console.warn(e);
			if (token === modelToken) modelError = "Could not load " + entry.filename;
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
	const setProgress = (props) => { Object.assign(progress, props); progress.invalidate(); };

	store.addEventListener("load", () => {
		nameLabel.setText(store.snapshot?.workflowName ?? "No workflow");
		loadOutputs();
	});

	// each Generate press starts empty batches; results land in their output's batch of their prompt until it ends
	store.addEventListener("generate", () => {
		runBatches = new Map();
		for (const o of outputs) o.batch = null;
	});

	store.addEventListener("queued", ({ detail }) => {
		byPrompt.set(detail.prompt_id, runBatches);
		setProgress({ error: false, text: "Queued" });
		refresh();
	});

	store.addEventListener("error", ({ detail }) => setProgress({ error: true, max: 0, text: detail.message }));

	client.addEventListener("status", ({ detail }) => queueLabel.setText(detail.queueRemaining ? `Queue ${detail.queueRemaining}` : ""));

	client.addEventListener("executing", ({ detail }) => {
		const node = store.snapshot?.prompt[detail.node];
		setProgress({ error: false, value: 0, max: 0, text: node?._meta?.title ?? node?.class_type ?? "Running" });
	});

	client.addEventListener("progress", ({ detail }) => setProgress({ value: detail.value, max: detail.max }));

	for (const type of ["done", "interrupted"]) {
		client.addEventListener(type, ({ detail }) => {
			byPrompt.delete(detail.prompt_id);
			setProgress({ value: 0, max: 0, text: type === "done" ? "Idle" : "Interrupted" });
			endPreview();
		});
	}

	client.addEventListener("error", ({ detail }) => {
		byPrompt.delete(detail.prompt_id);
		setProgress({ error: true, value: 0, max: 0, text: detail.message });
		endPreview();
	});

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

	// results of an output that is not on show only mark its button: the selection never changes on its own
	client.addEventListener("executed", ({ detail }) => {
		const o = outputs.find((o) => o.nodeId === null || o.nodeId === String(detail.node));
		const files = o ? resultFiles(detail.output) : [];
		if (!files.length) return;
		if (!byPrompt.has(detail.prompt_id)) byPrompt.set(detail.prompt_id, new Map());
		const batches = byPrompt.get(detail.prompt_id);
		if (!batches.has(o.nodeId)) batches.set(o.nodeId, { results: [] });
		const batch = o.batch = batches.get(o.nodeId);
		const entries = files.map((f) => ({ ...f, node: o.nodeId, url: client.viewUrl(f) }));
		batch.results.push(...entries);
		history.unshift(...[...entries].reverse());
		history.length = Math.min(history.length, HISTORY_MAX);
		saveHistory(history);
		o.view = batch.results.length >= 2 ? "grid" : "single";
		o.current = entries[entries.length - 1];
		if (o !== out) {
			o.fresh = true;
			return refresh();
		}
		strip.offset = 0;
		showEntry(o.current);
	});

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
	// as half extents (three halves them too).
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
		const modeText = { desktop: "Enter XR", ar: "To VR", vr: "To AR" }[xr.mode()];
		if (modeBtn.text !== modeText) {
			modeBtn.text = modeText;
			modeBtn.invalidate();
		}
		const hdUsable = hdSupported && !isSplit() && !stage3d;
		if (hdBtn.toggled !== hd || hdBtn.disabled === hdUsable) {
			hdBtn.toggled = hd;
			hdBtn.disabled = !hdUsable;
			hdBtn.invalidate();
		}
	}

	nameLabel.setText(store.snapshot?.workflowName ?? "No workflow");
	syncModeBtns();
	loadOutputs();
	return { group, status, strip: stripPanel, update, model };
}

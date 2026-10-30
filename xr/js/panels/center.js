// Center panel: image (mesh or XR quad layer) or 3D model on a stage centered on the group origin, plus the output row (tiles
// and the cog), its output pop-up, the phones' output button and the gallery panel. The stage takes the aspect of what it shows
// at the screen diagonal; the hosts (main.js, desktop.js, phone.js) place everything from `shows` and call screen.onChange() when it changes. Results are kept per App-mode output. The image pans and zooms in the stage
// plane (`image`).
import * as THREE from "three";
import * as ui from "../ui.js";
import { store } from "../state.js";
import { createModelView } from "../model.js";
import { pref, setPref } from "../prefs.js";
import { createHistory, isMissing, resultFiles } from "../history.js";
import { createQuadLayer } from "../quad.js";

const { theme } = ui;

export const TILE_GAP = 16, TILE_R = 24, COG = 80; // the output row's (the phones' dock grid follows it, toolbar.js)
const TILE = 200, SMALL_TILE = 120, RING = 4;
const NOTE_PAD_X = 40, NOTE_PAD_Y = 20;
const ASPECT_EPS = 0.01, EMPTY_ASPECT = 16 / 9;
const MISSING = "File no longer exists — removed from the gallery";
const STEREO_KEY = "appmode-xr.stereo";
const OUTPUT_KEY = "appmode-xr.output"; // + .<workflowName>
const STEREO_MODES = [["flat", "Flat"], ["rl", "3D R/L"], ["lr", "3D L/R"]];
const THUMB = 512;
const IMAGE_ZOOM_MIN = 0.25, IMAGE_ZOOM_MAX = 16;

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

// the selection ring of a square tile: inside it, its outer edge on the tile's own rounded outline
function ring(ctx, x, y, s, r, color) {
	ctx.beginPath();
	ctx.roundRect(x + RING / 2, y + RING / 2, s - RING, s - RING, r - RING / 2);
	ctx.lineWidth = RING;
	ctx.strokeStyle = color;
	ctx.stroke();
}

function loadStereo() {
	const mode = pref(STEREO_KEY);
	return STEREO_MODES.some(([m]) => m === mode) ? mode : "flat";
}

// rowW: the output row's widest, the toolbar's width (panel px); onPick(): a tap on the phones' output button
export function createCenterPanel({ client, renderer, xr, screen, desktopView }, rowW, onPick) {
	const group = new THREE.Group();

	// ---- widgets ----
	// the grid of the selected output's history (its items are the entries): each thumbnail whole, the shown entry ringed
	class Gallery extends ui.ImageGrid {
		drawTile(ctx, e, i, x, y, s) {
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
			if (this.hover && i === this.hotItem) ui.drawTint(ctx, false, x, y, s, s, 16);
			if (e === this.selected) ring(ctx, x, y, s, 16, theme.accent);
		}
	}

	// square output tile: the output's latest result (its kind's icon before the first one, never a live preview), a kind badge
	// and the title along the bottom; the shown output ringed, a switched-off one dimmed, a dot for results not shown yet
	class OutputTile extends ui.Widget {
		draw(ctx) {
			const { w: s, output: o } = this, icon = o.kind === "3d" ? "box" : "image";
			const latest = history.entries.find((e) => ownerOf(e) === o), thumb = latest && thumbOf(latest);
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
			ui.tint(ctx, this, 0, 0, s, s, 0); // square: clipped to the tile
			// a phone's small tiles keep their thumbnail clear: no badge, no title
			if (s >= SMALL_TILE) {
				ui.drawCaption(ctx, o.title, 0, 0, s, 20);
				ctx.fillStyle = "rgba(0,0,0,0.6)";
				ctx.beginPath();
				ctx.arc(30, 30, 22, 0, Math.PI * 2);
				ctx.fill();
				ctx.strokeStyle = theme.fg;
				ui.drawIcon(ctx, icon, 17, 17, 26);
			}
			ctx.restore();
			ctx.globalAlpha = 1;
			if (this.toggled) ring(ctx, 0, 0, s, TILE_R, theme.accent);
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
		g.font = ui.font(24);
		g.fillStyle = theme.fg;
		g.textAlign = "center";
		g.textBaseline = "middle";
		g.fillText(filename, x, 212, 236);
		return c;
	}

	// ---- panels ----
	const stage = new ui.Panel({ name: "center-stage", widthM: 1, heightM: 1, pxPerM: screen.pxPerM }); // sized by fitStage
	const row = new ui.Panel({ name: "output-row", widthM: COG / ui.PX_PER_M, heightM: COG / ui.PX_PER_M, bg: null }); // sized by placeRow
	// the output pop-up (cog): the selected output's name over its kind's controls
	const popup = new ui.Panel({ name: "output-popup", widthM: 0.58, heightM: 0.164, radius: 32 });
	const galleryPanel = new ui.Panel({ name: "gallery", widthM: 0.85, heightM: 1.15 });
	// the stage's message in the Desktop View, which shows it centered in a panel just around its text (the stage is VR only)
	const note = new ui.Panel({ name: "center-note", widthM: 1, heightM: 0.1 });
	group.add(stage.mesh);

	const empty = stage.add(new ui.Label({ text: "", size: 44, color: theme.muted, align: "center", h: 72 }));
	const noteText = note.add(new ui.Label({ text: "", size: 44, color: theme.muted, align: "center", x: NOTE_PAD_X, y: NOTE_PAD_Y, h: 72 }));

	const galleryTitle = galleryPanel.add(new ui.Label({ text: "Gallery", size: 34, bold: true, x: 24, y: 14, h: 50 }));
	const gallery = galleryPanel.add(new Gallery({ x: 24, y: 84, cell: 250, bg: null, empty: "No results yet", onSelect: (e) => showEntry(e) }));
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
	const cog = new ui.Button({ icon: "settings", round: true, w: COG, h: COG, onClick: () => showPopup(!shows.popup) });
	// phones: the dock's output button (phone.js, while the row has something), the selected output's tile; phone.js opens the
	// row as a tray on a tap (onPick) and rings it while open (ringPick)
	const pick = new ui.Panel({ name: "output-pick", widthM: COG / ui.PX_PER_M, heightM: COG / ui.PX_PER_M, bg: null });
	const pickTile = pick.add(new OutputTile({ w: COG, h: COG, onClick: () => onPick() }));
	pick.onResize = () => { pickTile.w = pickTile.h = pick.width; };

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
	const layer = createQuadLayer({ renderer, xr }, holeMesh);

	// ---- state ----
	const history = createHistory(client);
	// per output: { nodeId (null = any node), title, kind, current (entry on show), fresh (results not shown yet) }
	let outputs = [], out = null, tiles = [];
	let tile = TILE, maxW = rowW, vertical = false; // phones: a fixed tile size and no length limit (phone.js scrolls the row), a column in landscape
	// what the hosts show around the stage: the output row (it has something: several outputs, or a single one with settings), the
	// pop-up (open), the note (a message is up)
	const shows = { row: false, popup: false, note: false };
	let shown = null;          // HTMLImageElement on the mesh / layer
	let shownEntry = null;     // history entry of `shown`, null for a preview
	let shownTex = null;
	let modelOn = false, stage3d = false, notice = "", modelToken = 0;
	let placed = null;         // the stage's size and what the hosts show around it, as last reported
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
				pick.invalidate();
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
				setPref(outputKey(), o.nodeId);
				select(o);
			},
		})));
		row.add(cog);
		const saved = pref(outputKey()), o = outputs.find((o) => o.nodeId === saved);
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
		shows.row = n > 0 || settings;
		if (shows.row && (w !== row.width || h !== row.height)) row.resize(w / ui.PX_PER_M, h / ui.PX_PER_M);
	}

	// phones: tiles of `size` px however many there are, in a column when vertical; null: back to a row of TILE within rowW. Layout
	// only, called by phone.js during its layout pass, which places the row from its new size.
	function rowTile(size, v = false) {
		tile = size ?? TILE;
		maxW = size ? Infinity : rowW;
		vertical = v;
		placeRow();
		row.invalidate();
	}

	// stays open while picking options and follows the selected output; pointers.js closes it on a press elsewhere, phone.js with
	// the phones' tray
	function showPopup(on) {
		shows.popup = cog.toggled = on;
		refresh();
	}

	function select(o) {
		out = o;
		o.fresh = false;
		o.current ??= history.entries.find((e) => ownerOf(e) === o) ?? null;
		previewing = false;
		gallery.scroll = 0;
		const controls = kindControls[o.kind]();
		popupTitle.setText(o.title || "Output");
		popup.clear();
		for (const c of [popupTitle, ...controls]) popup.add(c);
		if (!controls.length) shows.popup = cog.toggled = false;
		const { current } = o;
		if (current && current !== (current.kind === "3d" ? model.entry : shownEntry)) return showEntry(current);
		notice = "";
		// an image output without results shows nothing; a 3D one keeps the stage as it is
		if (!current && o.kind === "image") clearShown();
		refresh();
	}

	function refresh() {
		const { current } = out;
		placeRow();
		modelOn = !previewing && current?.kind === "3d";
		stage3d = modelOn || out.kind === "3d";
		singleOn = !modelOn && !!shown;
		model.group.visible = modelOn && model.entry === current;
		shows.note = !singleOn && !model.group.visible;
		gallery.selected = current;
		gallery.items = history.entries.filter((e) => ownerOf(e) === out);
		galleryTitle.setText(outputs.length > 1 ? `Gallery · ${out.title}` : "Gallery");
		empty.setText(!store.snapshot ? "Send a workflow from ComfyUI (Open in VR / Alt+V)"
			: modelOn ? notice || "Loading 3D model…" : notice || (out.kind === "3d" ? "No 3D models yet" : "No images yet"));
		if (empty.text !== noteText.text) {
			note.ctx.font = ui.font(empty.size);
			noteText.w = Math.ceil(note.ctx.measureText(empty.text).width) + 2;
			noteText.setText(empty.text);
			note.setPx(noteText.w + 2 * NOTE_PAD_X, noteText.h + 2 * NOTE_PAD_Y, note.scale);
		}
		for (const b of modeBtns) b.disabled = stage3d;
		tiles.forEach((t, i) => {
			t.toggled = outputs[i] === out;
			t.fresh = outputs[i].fresh;
		});
		Object.assign(pickTile, { output: out, fresh: outputs.some((o) => o.fresh) });
		for (const p of [stage, galleryPanel, row, popup, pick]) p.invalidate();
		fitStage();
		// the stage or what the hosts place around it changed: the output row, the pop-up or the note
		const p = [screen.w, screen.h, shows.row, row.width, row.height, shows.popup, shows.note && noteText.text].join();
		if (p !== placed) {
			placed = p;
			screen.onChange();
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

	// nothing on the stage: its textures are freed
	function clearShown() {
		shownTex?.dispose();
		halves.forEach((t) => t.dispose());
		shown = shownEntry = shownTex = null;
		halves = [];
		imageMat.map = eyeMat.map = null;
		imageMat.needsUpdate = eyeMat.needsUpdate = true;
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
		setPref(STEREO_KEY, mode);
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

	// removes entries whose file is gone; an output that showed one falls back to its next entry
	function dropEntries(gone) {
		const { current } = out;
		history.drop(gone);
		for (const o of outputs) if (gone.includes(o.current)) o.current = history.entries.find((e) => ownerOf(e) === o) ?? null;
		if (gone.includes(shownEntry) || !out.current && out.kind === "image") clearShown();
		if (!gone.includes(current)) return refresh();
		if (out.current) showEntry(out.current);
		else refresh();
	}

	// the message stays unless a fallback entry took the stage
	function showMissing() {
		notice = MISSING;
		refresh();
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
			clearShown();
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
		const entries = history.add(files, o.nodeId);
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

	function toStage(world, v) {
		group.updateWorldMatrix(true, false);
		return v.setFromMatrixPosition(world).applyMatrix4(inv.copy(group.matrixWorld).invert());
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

	// XR eyes render layers 1 (left) and 2 (right); the desktop camera only sees layer 0, so it shows the left eye there
	function updateEyes() {
		const split = singleOn && isSplit();
		eyeMesh.visible = split;
		imageMesh.layers.set(split && xr.isPresenting() ? 1 : 0);
	}

	function update() {
		imageMesh.visible = singleOn && !layer.update(shown, hd && singleOn && !previewing && !isSplit());
		updateEyes();
		stage.mesh.visible = shows.note && !desktopView();
		const hdUsable = layer.supported() && !isSplit() && !stage3d;
		if (hdBtn.toggled !== hd || hdBtn.disabled === hdUsable) {
			hdBtn.toggled = hd;
			hdBtn.disabled = !hdUsable;
			hdBtn.invalidate();
		}
	}

	syncModeBtns();
	loadOutputs();
	history.missing().then((gone) => { if (gone.length) dropEntries(gone); });
	const closePopup = () => { if (shows.popup) showPopup(false); };
	// the cog's box in the row (panel px), where the pop-up is placed
	const cogRect = () => ({ x: cog.x, y: cog.y, w: cog.w, h: cog.h });
	const ringPick = (on) => {
		pickTile.toggled = on;
		pick.invalidate();
	};
	return { group, update, model, image, shows, row, rowH: TILE, rowTile, cogRect, popup, closePopup, pick, ringPick, gallery: galleryPanel, note };
}

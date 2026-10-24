// Center panel: status bar, image (mesh or XR quad layer), batch grid, history strip.
const STAGE_W = 1.3, STAGE_H = 0.9, STAGE_Y = 0.1;
const BAR_H = 0.1, STRIP_H = 0.14, GAP = 0.03;
const HISTORY_KEY = "appmode-xr.history", HISTORY_MAX = 50;
const THUMB = 512, LAYER_MAX = 3072;
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
// the quad layer path is untested on hardware: flip this to force the plain mesh
const ENABLE_QUAD_LAYER = true;
const FLIP_Y = true;

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

function saveHistory(history) {
	try {
		localStorage.setItem(HISTORY_KEY, JSON.stringify(history.map(({ filename, subfolder, type }) => ({ filename, subfolder, type }))));
	} catch {}
}

export function createCenterPanel({ THREE, store, client, ui, renderer, xr }) {
	const { theme } = ui;
	const group = new THREE.Group();

	// ---- widgets ----
	class ProgressBar extends ui.Widget {
		constructor(o) { super({ value: 0, max: 0, text: "Idle", error: false, ...o }); }
		draw(ctx) {
			const { w, h } = this, bh = 44, y = (h - bh) / 2;
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
			ctx.font = `600 26px ${theme.font}`;
			ctx.fillStyle = this.error ? theme.danger : theme.fg;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(this.max > 0 ? `${this.value}/${this.max}  ${this.text}` : this.text, w / 2, h / 2 + 1, w - 32);
		}
	}

	// horizontal strip of thumbnails; drags and scrolls sideways
	const CELL = 116, STEP = 126, ARROW = 56;
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
				ctx.font = `28px ${theme.font}`;
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
				ctx.roundRect(x, 12, CELL, CELL, 12);
				ctx.fillStyle = theme.surface;
				ctx.fill();
				const thumb = this.thumbOf(e);
				if (thumb) {
					ctx.save();
					ctx.clip();
					drawFit(ctx, thumb, x, 12, CELL, CELL);
					ctx.restore();
				}
				if (e === this.selected) {
					ctx.lineWidth = 5;
					ctx.strokeStyle = theme.accent;
					ctx.stroke();
				}
			});
			ctx.restore();
			if (!this.canScroll()) return;
			ctx.font = `600 40px ${theme.font}`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			for (const [x, t] of [[0, "‹"], [w - ARROW, "›"]]) {
				ctx.beginPath();
				ctx.roundRect(x, 12, ARROW, CELL, 14);
				ctx.fillStyle = theme.surface;
				ctx.fill();
				ctx.fillStyle = theme.fg;
				ctx.fillText(t, x + ARROW / 2, 12 + CELL / 2);
			}
		}
	}

	// square cells in the roomiest rows x cols arrangement
	class BatchGrid extends ui.Widget {
		constructor(o) { super({ items: [], selected: null, gap: 16, ...o }); }
		cells() {
			const n = this.items.length, gap = this.gap;
			let best = { s: 0 };
			for (let cols = 1; cols <= n; cols++) {
				const rows = Math.ceil(n / cols);
				const s = Math.min((this.w - gap * (cols - 1)) / cols, (this.h - gap * (rows - 1)) / rows);
				if (s > best.s) best = { s, cols, rows };
			}
			const { s, cols, rows } = best;
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

	// ---- panels ----
	const status = new ui.Panel({ name: "center-status", widthM: STAGE_W, heightM: BAR_H });
	const stage = new ui.Panel({ name: "center-stage", widthM: STAGE_W, heightM: STAGE_H });
	const stripPanel = new ui.Panel({ name: "center-history", widthM: STAGE_W, heightM: STRIP_H });
	status.mesh.position.y = STAGE_Y + STAGE_H / 2 + GAP + BAR_H / 2;
	stage.mesh.position.y = STAGE_Y;
	stripPanel.mesh.position.y = STAGE_Y - STAGE_H / 2 - GAP - STRIP_H / 2;
	group.add(status.mesh, stage.mesh, stripPanel.mesh);

	const nameLabel = status.add(new ui.Label({ text: "", size: 30, bold: true, x: 24, y: 0, w: 276, h: 100 }));
	const progress = status.add(new ProgressBar({ x: 316, y: 0, w: 460, h: 100 }));
	const queueLabel = status.add(new ui.Label({ text: "", size: 26, color: theme.muted, align: "center", x: 786, y: 0, w: 120, h: 100 }));
	const gridBtn = status.add(new ui.Button({ text: "Grid", size: 26, x: 916, y: 18, w: 110, h: 64, onClick: () => { view = gridOn ? "single" : "grid"; refresh(); } }));
	const hdBtn = status.add(new ui.Button({ text: "HD", size: 26, x: 1036, y: 18, w: 100, h: 64, onClick: () => { hd = !hd; } }));
	const modeBtn = status.add(new ui.Button({ text: "", size: 26, x: 1146, y: 18, w: 130, h: 64, onClick: () => xr.toggleMode() }));

	const grid = stage.add(new BatchGrid({ x: 20, y: 20, w: stage.width - 40, h: stage.height - 40, onSelect: (e) => { view = "single"; showEntry(e); } }));
	const empty = stage.add(new ui.Label({ text: "", size: 36, color: theme.muted, align: "center", x: 40, y: stage.height / 2 - 30, w: stage.width - 80, h: 60 }));

	const strip = stripPanel.add(new HistoryStrip({ x: 0, y: 0, w: stripPanel.width, h: stripPanel.height, onSelect: (e) => { view = "single"; showEntry(e); } }));

	// ---- image mesh and its hole-punch twin ----
	const plane = new THREE.PlaneGeometry(1, 1);
	const imageMat = new THREE.MeshBasicMaterial({ toneMapped: false });
	const imageMesh = new THREE.Mesh(plane, imageMat);
	// writes (0,0,0,0) so the quad layer behind the projection layer shows through
	const holeMesh = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
		blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.ZeroFactor,
	}));
	imageMesh.position.y = holeMesh.position.y = STAGE_Y;
	imageMesh.visible = holeMesh.visible = false;
	group.add(imageMesh, holeMesh);

	// ---- state ----
	const history = loadHistory().map((e) => ({ ...e, url: client.viewUrl(e) }));
	const byPrompt = new Map();
	let batch = null;          // batch the grid shows
	let view = "single";       // "single" | "grid"
	let current = null;        // history entry on show
	let shown = null;          // HTMLImageElement on the mesh / layer
	let shownTex = null;
	let previewing = false;
	let gridOn = false, singleOn = false;
	let loadToken = 0;
	let hd = true;

	const thumbOf = (e) => {
		if (e.thumb === undefined) {
			e.thumb = null;
			loadImg(e.url).then((img) => { e.thumb = makeThumb(img); }, () => { e.thumb = false; }).then(() => { stage.invalidate(); stripPanel.invalidate(); });
		}
		return e.thumb;
	};
	grid.thumbOf = strip.thumbOf = thumbOf;
	strip.entries = history;

	function refresh() {
		const results = batch?.results ?? [];
		gridOn = !previewing && view === "grid" && results.length >= 2;
		singleOn = !gridOn && !!shown;
		stage.mesh.visible = !singleOn;
		grid.visible = gridOn;
		grid.items = results;
		grid.selected = strip.selected = current;
		empty.visible = !gridOn && !shown;
		empty.setText(store.snapshot ? "No images yet" : "Send a workflow from ComfyUI (Open in VR / Alt+V)");
		gridBtn.visible = results.length >= 2;
		gridBtn.toggled = gridOn;
		for (const p of [stage, stripPanel, status]) p.invalidate();
	}

	function setShown(img) {
		const tex = new THREE.Texture(img);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
		tex.minFilter = THREE.LinearMipmapLinearFilter;
		tex.needsUpdate = true;
		const first = !imageMat.map;
		imageMat.map = tex;
		if (first) imageMat.needsUpdate = true;
		shownTex?.dispose();
		shownTex = tex;
		shown = img;
		const k = Math.min(STAGE_W / img.naturalWidth, STAGE_H / img.naturalHeight);
		imageMesh.scale.set(img.naturalWidth * k, img.naturalHeight * k, 1);
		holeMesh.scale.copy(imageMesh.scale);
	}

	async function showEntry(entry) {
		current = entry;
		const token = ++loadToken;
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
		setShown(img);
		refresh();
	}

	// back from a live preview to the last real image once the run is over
	function endPreview() {
		if (!previewing) return;
		previewing = false;
		if (current) showEntry(current);
		else {
			shown = null;
			refresh();
		}
	}

	// ---- events ----
	const setProgress = (props) => { Object.assign(progress, props); progress.invalidate(); };

	store.addEventListener("load", () => {
		nameLabel.setText(store.snapshot?.workflowName ?? "No workflow");
		refresh();
	});

	// each generate() press starts a new batch; its prompts' results land in it
	store.addEventListener("generate", () => {
		batch = { results: [] };
	});

	store.addEventListener("queued", ({ detail }) => {
		byPrompt.set(detail.prompt_id, batch);
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
		client.addEventListener(type, () => {
			setProgress({ value: 0, max: 0, text: type === "done" ? "Idle" : "Interrupted" });
			endPreview();
		});
	}

	client.addEventListener("error", ({ detail }) => {
		setProgress({ error: true, value: 0, max: 0, text: detail.message });
		endPreview();
	});

	client.addEventListener("preview", async ({ detail }) => {
		const token = ++loadToken;
		let img;
		try {
			img = await loadImg(detail.url);
		} catch {
			return;
		}
		if (token !== loadToken) return;
		previewing = true;
		setShown(img);
		refresh();
	});

	client.addEventListener("executed", ({ detail }) => {
		const outputs = store.snapshot?.outputs;
		if (outputs?.length && !outputs.includes(String(detail.node))) return;
		const images = (detail.output?.images ?? []).filter((i) => IMAGE_EXT.test(i.filename));
		if (!images.length) return;
		if (!byPrompt.has(detail.prompt_id)) byPrompt.set(detail.prompt_id, { results: [] });
		batch = byPrompt.get(detail.prompt_id);
		const entries = images.map(({ filename, subfolder, type }) => ({ filename, subfolder, type, url: client.viewUrl({ filename, subfolder, type }) }));
		batch.results.push(...entries);
		history.unshift(...[...entries].reverse());
		history.length = Math.min(history.length, HISTORY_MAX);
		strip.offset = 0;
		saveHistory(history);
		view = batch.results.length >= 2 ? "grid" : "single";
		showEntry(entries[entries.length - 1]);
	});

	// ---- XR quad layer (HD) ----
	let hdSupported = false, layerFailed = false;
	let layerSession = null, quad = null, quadW = 0, quadH = 0, inLayers = false, uploaded = null;
	const lastPose = new THREE.Matrix4();
	const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
	const scaler = document.createElement("canvas");

	function applyPose(m) {
		m.decompose(pos, quat, scl);
		quad.width = scl.x;
		quad.height = scl.y;
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
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, FLIP_Y);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		uploaded = shown;
	}

	// Mirrors three's webxr_vr_layers example: [quad layer, projection layer] with a transparent hole
	// punched where the image is. Sets imageMesh / holeMesh visibility.
	function updateLayer() {
		const session = xr.isPresenting() ? renderer.xr.getSession() : null;
		if (session !== layerSession) {
			layerSession = session;
			quad = uploaded = null;
			inLayers = false;
		}
		const binding = session && ENABLE_QUAD_LAYER && !layerFailed ? renderer.xr.getBinding() : null;
		hdSupported = !!binding;
		let hole = false;
		if (binding && hd && singleOn && !previewing) {
			const k = Math.min(1, LAYER_MAX / Math.max(shown.naturalWidth, shown.naturalHeight));
			const pw = Math.round(shown.naturalWidth * k), ph = Math.round(shown.naturalHeight * k);
			holeMesh.updateWorldMatrix(true, false);
			const m = holeMesh.matrixWorld;
			if (!quad || quadW !== pw || quadH !== ph) {
				quad?.destroy();
				m.decompose(pos, quat, scl);
				quad = binding.createQuadLayer({
					space: renderer.xr.getReferenceSpace(), layout: "mono", viewPixelWidth: pw, viewPixelHeight: ph,
					width: scl.x, height: scl.y, transform: new XRRigidTransform(pos, quat),
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

	function update() {
		try {
			updateLayer();
		} catch (e) {
			console.warn("quad layer disabled", e);
			layerFailed = true;
			quad = null;
			holeMesh.visible = false;
			imageMesh.visible = singleOn;
		}
		const modeText = { desktop: "Enter XR", ar: "To VR", vr: "To AR" }[xr.mode()];
		if (modeBtn.text !== modeText) {
			modeBtn.text = modeText;
			modeBtn.invalidate();
		}
		if (hdBtn.toggled !== hd || hdBtn.disabled === hdSupported) {
			hdBtn.toggled = hd;
			hdBtn.disabled = !hdSupported;
			hdBtn.invalidate();
		}
	}

	nameLabel.setText(store.snapshot?.workflowName ?? "No workflow");
	refresh();
	if (history.length) showEntry(history[0]);
	return { group, update };
}

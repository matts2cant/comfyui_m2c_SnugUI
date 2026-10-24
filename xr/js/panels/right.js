// Right panel: LoRA stack of the selected LoRA Manager node (tabs when there are several) plus a
// library browser backed by LoRA Manager's HTTP API (/api/lm/loras/list).
const NO_PREVIEW = "/loras_static/images/no-preview.png";
const STEP = 0.05;
const M = 24, W = 802;

const previewUrl = (url) => !url || /\.(mp4|webm)$/i.test(url) ? NO_PREVIEW : url;
const round2 = (v) => Number(v.toFixed(2));

async function listLoras(search, pageSize, page = 1) {
	const q = new URLSearchParams({ page_size: pageSize, page, sort_by: "name" });
	if (search) q.set("search", search);
	const res = await fetch("/api/lm/loras/list?" + q);
	if (!res.ok) throw new Error("LoRA Manager: HTTP " + res.status);
	return res.json();
}

// usage_tips is a JSON string; LoRA Manager stores the clip value as clipStrength
function newLora(item) {
	let tips = {};
	try { tips = JSON.parse(item.usage_tips) ?? {}; } catch {}
	const strength = Number(tips.strength ?? 1);
	return { name: item.file_name, strength, clipStrength: Number(tips.clipStrength ?? tips.clip_strength ?? strength), active: true };
}

export function createRightPanel({ THREE, store, ui }) {
	const { Label, Button, TextField, List, ImageGrid, ScrollView } = ui;
	const group = new THREE.Group();
	const panel = new ui.Panel({ name: "right", widthM: 0.85, heightM: 1.15 });
	group.add(panel.mesh);

	let tab = 0;
	let query = "", page = 1, pages = 1, total = 0, editing = false, timer = 0, gridSeq = 0, suggestSeq = 0;

	const title = new Label({ text: "LoRAs", size: 34, bold: true, x: M, y: 14, w: W, h: 50 });
	const empty = new Label({ text: "No LoRA Manager loader in this workflow", size: 30, color: ui.theme.muted, wrap: true, x: M, y: 90, w: W });
	const stack = new ScrollView({ x: M, w: W });
	const field = new TextField({
			x: M, w: W, placeholder: "search LoRAs",
			onInput: (v) => setQuery(v),
			onDone: (v) => { editing = false; syncVisible(); setQuery(v, true); },
			onCancel: () => { editing = false; syncVisible(); },
			// runs after the field commits a still-open previous edit, whose onDone clears the flag
			onEdit: () => { editing = true; syncVisible(); loadSuggest(); },
		});
	const suggest = new List({ x: M, w: W, rowH: 60, size: 28, onSelect: (it) => { suggest.selected = undefined; add(it.value); } });
	const grid = new ImageGrid({ x: M, w: W, cell: 180, onSelect: (it) => { grid.selected = undefined; add(it.value); } });
	const prev = new Button({ text: "‹ Prev", x: M, w: 180, h: 60, onClick: () => goto(page - 1) });
	const next = new Button({ text: "Next ›", x: M + W - 180, w: 180, h: 60, onClick: () => goto(page + 1) });
	const pageLabel = new Label({ text: "", size: 26, color: ui.theme.muted, align: "center", x: M + 190, w: W - 380, h: 60 });

	class Check extends ui.Widget {
		draw(ctx) {
			const s = 38, x = (this.w - s) / 2, y = (this.h - s) / 2;
			if (this.hover || this.pressed) {
				ctx.beginPath();
				ctx.roundRect(0, 0, this.w, this.h, 12);
				ctx.fillStyle = this.pressed ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.1)";
				ctx.fill();
			}
			ctx.beginPath();
			ctx.roundRect(x, y, s, s, 8);
			ctx.fillStyle = this.checked ? ui.theme.accent : ui.theme.surface;
			ctx.fill();
			ctx.lineWidth = 3;
			ctx.strokeStyle = this.checked ? ui.theme.accent : ui.theme.border;
			ctx.stroke();
			if (!this.checked) return;
			ctx.beginPath();
			ctx.moveTo(x + 9, y + 20);
			ctx.lineTo(x + 16, y + 27);
			ctx.lineTo(x + 29, y + 11);
			ctx.strokeStyle = "#fff";
			ctx.lineWidth = 5;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			ctx.stroke();
		}
	}

	function buildRows(node) {
		const list = store.loras(node.nodeId);
		const rw = W - 16, h = 60, pitch = 68;
		const edit = (i, patch) => store.setLoras(node.nodeId, list.map((l, j) => j === i ? { ...l, ...patch } : l));
		const rows = [];
		list.forEach((l, i) => {
			const y = i * pitch;
			const step = (d) => {
				const v = round2(Number(l.strength) + d);
				edit(i, { strength: v, ...(Number(l.clipStrength) === Number(l.strength) && { clipStrength: v }) });
			};
			const rx = rw - 60 - 8 - 56 - 84 - 56; // left edge of the − button
			rows.push(
				new Check({ checked: l.active, x: 0, y, w: 60, h, onClick: () => edit(i, { active: !l.active }) }),
				new Label({ text: l.name, size: 30, color: l.active ? ui.theme.fg : ui.theme.muted, x: 68, y, w: rx - 68 - 8, h }),
				new Button({ text: "−", size: 38, x: rx, y, w: 56, h, onClick: () => step(-STEP) }),
				new Label({ text: Number(l.strength).toFixed(2), size: 30, bold: true, color: l.active ? ui.theme.fg : ui.theme.muted, align: "center", x: rx + 56, y, w: 84, h }),
				new Button({ text: "+", size: 38, x: rx + 140, y, w: 56, h, onClick: () => step(STEP) }),
				new Button({ text: "×", size: 34, variant: "danger", x: rw - 60, y, w: 60, h, onClick: () => store.setLoras(node.nodeId, list.filter((_, j) => j !== i)) }),
			);
		});
		if (!list.length) rows.push(new Label({ text: "No LoRAs yet, pick one below", size: 28, color: ui.theme.muted, x: 0, y: 20, w: rw, h: 56 }));
		return rows;
	}

	function render() {
		panel.clear();
		panel.add(title);
		const nodes = store.groups.lora;
		if (!nodes.length) { panel.add(empty); return; }
		tab = Math.min(tab, nodes.length - 1);
		let y = 70;
		if (nodes.length > 1) {
			const tw = (W - 8 * (nodes.length - 1)) / nodes.length;
			nodes.forEach((n, i) => panel.add(new Button({
				text: n.title, toggled: i === tab, size: 26, x: M + i * (tw + 8), y, w: tw, h: 56,
				onClick: () => { tab = i; stack.scroll = 0; render(); },
			})));
			y += 70;
		}
		stack.w = W;
		stack.setChildren(buildRows(nodes[tab]));
		stack.y = y;
		stack.h = Math.min(Math.max(stack.contentH(), 96), Math.round(panel.height * 0.5));
		const top = y + stack.h + 16;
		const areaY = top + 84, pagerY = panel.height - M - 60;
		field.y = top;
		suggest.y = grid.y = areaY;
		suggest.h = grid.h = pagerY - 12 - areaY;
		prev.y = next.y = pageLabel.y = pagerY;
		panel.add(stack);
		panel.add(field);
		panel.add(grid);
		panel.add(suggest);
		panel.add(prev);
		panel.add(pageLabel);
		panel.add(next);
		syncVisible();
		updatePager();
	}

	function syncVisible() {
		suggest.visible = editing;
		grid.visible = !editing;
		panel.invalidate();
	}

	function updatePager() {
		prev.disabled = page <= 1;
		next.disabled = page >= pages;
		pageLabel.setText(`${page} / ${pages}  (${total})`);
	}

	async function loadGrid() {
		const id = ++gridSeq;
		try {
			const res = await listLoras(query, 12, page);
			if (id !== gridSeq) return;
			pages = Math.max(1, res.total_pages);
			total = res.total;
			grid.setItems(res.items.map((it) => ({ url: previewUrl(it.preview_url), label: it.model_name || it.file_name, value: it })));
			updatePager();
		} catch (e) {
			if (id !== gridSeq) return;
			grid.setItems([]);
			pageLabel.setText(e.message);
		}
	}

	async function loadSuggest() {
		const id = ++suggestSeq;
		try {
			const res = await listLoras(query, 8);
			if (id === suggestSeq) suggest.setItems(res.items.map((it) => ({ label: it.model_name || it.file_name, sub: it.base_model, value: it })));
		} catch (e) {
			if (id === suggestSeq) suggest.setItems([]);
		}
	}

	function goto(p) {
		page = p;
		loadGrid();
	}

	function setQuery(v, now) {
		field.value = v;
		field.invalidate();
		query = v;
		page = 1;
		clearTimeout(timer);
		timer = setTimeout(() => { loadGrid(); if (editing) loadSuggest(); }, now ? 0 : 250);
	}

	function add(item) {
		const node = store.groups.lora[tab];
		const list = store.loras(node.nodeId);
		if (list.some((l) => l.name === item.file_name)) return;
		store.setLoras(node.nodeId, [...list, newLora(item)]);
		stack.scroll = stack.maxScroll();
	}

	store.addEventListener("load", () => {
		tab = 0;
		render();
		if (store.groups.lora.length) loadGrid();
	});
	store.addEventListener("change", (e) => { if (e.detail.key.startsWith("lora:")) render(); });
	render();

	return { group };
}

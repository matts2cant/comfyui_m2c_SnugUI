// LoRA side panel: LoRA stack of the selected LoRA Manager node (tabs when there are several) plus a
// library browser backed by LoRA Manager's HTTP API (/api/lm/loras/list).
const NO_PREVIEW = "/loras_static/images/no-preview.png";
const STEP = 0.05;
const M = 24;

const previewUrl = (url) => !url || /\.(mp4|webm)$/i.test(url) ? NO_PREVIEW : url;
const round2 = (v) => Number(v.toFixed(2));

async function listLoras(params) {
	const res = await fetch("/api/lm/loras/list?" + new URLSearchParams({ sort_by: "name", ...params }));
	if (!res.ok) throw new Error("LoRA Manager: HTTP " + res.status);
	return res.json();
}

// LoRA Manager's search only looks at file and model names, so fetch the whole library (page_size is capped at 100)
// and match the path relative to the LoRA root as well, case-insensitively
async function findLoras(search) {
	const q = search.toLowerCase();
	const first = await listLoras({ page_size: 100, page: 1 });
	const rest = await Promise.all(Array.from({ length: Math.max(0, first.total_pages - 1) }, (_, i) => listLoras({ page_size: 100, page: i + 2 })));
	return [first, ...rest].flatMap((r) => r.items)
		.filter((it) => [(it.folder ? it.folder + "/" : "") + it.file_name, it.model_name].some((s) => s.toLowerCase().includes(q)));
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
	let found = null; // matches of the current query, shared by the grid pages and the suggestions

	const title = new Label({ text: "LoRAs", size: 34, bold: true, x: M, y: 14, h: 50 });
	const empty = new Label({ text: "No LoRA Manager loader in this workflow", size: 30, color: ui.theme.muted, wrap: true, x: M, y: 90 });
	const stack = new ScrollView({ x: M });
	const field = new TextField({
		x: M, placeholder: "search LoRAs", barAbove: true,
		onInput: (v) => setQuery(v),
		onDone: (v) => { editing = false; syncVisible(); setQuery(v, true); },
		onCancel: () => { editing = false; syncVisible(); },
		// runs after the field commits a still-open previous edit, whose onDone clears the flag
		onEdit: () => { editing = true; syncVisible(); loadSuggest(); },
	});
	const suggest = new List({ x: M, rowH: 60, size: 28, onSelect: (it) => { suggest.selected = undefined; add(it.value); } });
	const grid = new ImageGrid({ x: M, cell: 180, onSelect: (it) => add(it.value) });
	const prev = new Button({ text: "‹ Prev", x: M, w: 180, h: 60, onClick: () => goto(page - 1) });
	const next = new Button({ text: "Next ›", w: 180, h: 60, onClick: () => goto(page + 1) });
	const pageLabel = new Label({ text: "", size: 26, color: ui.theme.muted, align: "center", x: M + 190, h: 60 });

	class Check extends ui.Widget {
		draw(ctx) {
			const s = 38, x = (this.w - s) / 2, y = (this.h - s) / 2;
			if (this.hover || this.pressed) {
				ctx.beginPath();
				ctx.roundRect(0, 0, this.w, this.h, 12);
				ctx.fillStyle = this.pressed ? ui.theme.pressed : ui.theme.hover;
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

	function buildRows(node, W) {
		const list = store.loras(node.nodeId);
		const rw = W - 16, h = 60, pitch = 68;
		// against the current list, by name (unique per node): the weight field commits on a press elsewhere, after that press's
		// own edit (×, or the same row's −, + or checkbox, which replace its entry)
		const edit = (l, patch) => store.setLoras(node.nodeId, store.loras(node.nodeId).map((x) => x.name === l.name ? { ...x, ...patch } : x));
		const rows = [];
		list.forEach((l, i) => {
			const y = i * pitch;
			const setStrength = (v) => edit(l, { strength: v, ...(Number(l.clipStrength) === Number(l.strength) && { clipStrength: v }) });
			const shown = Number(l.strength).toFixed(2);
			const rx = rw - 60 - 8 - 56 - 120 - 56; // left edge of the − button
			// tap to type the weight (accepts "," as decimal separator); anything that isn't a number reverts
			const value = new TextField({
				value: shown, size: 28, compact: true, x: rx + 56, y, w: 120, h,
				onEdit: () => value.selectAll(),
				onDone: (v) => {
					const n = Number(v.trim().replace(",", "."));
					value.value = shown;
					if (v.trim() && Number.isFinite(n)) setStrength(round2(n));
				},
			});
			rows.push(
				new Check({ checked: l.active, x: 0, y, w: 60, h, onClick: () => edit(l, { active: !l.active }) }),
				new Label({ text: l.name, size: 30, color: l.active ? ui.theme.fg : ui.theme.muted, x: 68, y, w: rx - 68 - 8, h }),
				new Button({ text: "−", size: 38, x: rx, y, w: 56, h, onClick: () => setStrength(round2(Number(l.strength) - STEP)) }),
				value,
				new Button({ text: "+", size: 38, x: rx + 176, y, w: 56, h, onClick: () => setStrength(round2(Number(l.strength) + STEP)) }),
				new Button({ text: "×", size: 34, variant: "danger", x: rw - 60, y, w: 60, h, onClick: () => store.setLoras(node.nodeId, list.filter((_, j) => j !== i)) }),
			);
		});
		if (!list.length) rows.push(new Label({ text: "No LoRAs yet, pick one below", size: 28, color: ui.theme.muted, x: 0, y: 20, w: rw, h: 56 }));
		return rows;
	}

	// from the panel's size: the Desktop View's window re-flows it
	function render() {
		const W = panel.width - 2 * M;
		for (const w of [title, empty, stack, field, suggest, grid]) w.w = W;
		empty.relayout();
		next.x = M + W - 180;
		pageLabel.w = W - 380;
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
		stack.setChildren(buildRows(nodes[tab], W));
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

	// one page of the library, or of the current query's matches
	async function browse(pageSize, p = 1) {
		if (!query) return listLoras({ page_size: pageSize, page: p });
		found ??= findLoras(query);
		const items = await found;
		return { items: items.slice((p - 1) * pageSize, p * pageSize), total: items.length };
	}

	async function loadGrid() {
		const id = ++gridSeq;
		try {
			const res = await browse(12, page);
			if (id !== gridSeq) return;
			pages = Math.max(1, Math.ceil(res.total / 12));
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
			const res = await browse(8);
			if (id === suggestSeq) suggest.setItems(res.items.map((it) => ({ label: it.model_name || it.file_name, sub: it.base_model, value: it })));
		} catch {
			if (id === suggestSeq) suggest.setItems([]);
		}
	}

	function goto(p) {
		page = p;
		loadGrid();
	}

	function setQuery(v, now) {
		if (v !== query) found = null;
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

	panel.onResize = render;
	store.addEventListener("load", () => {
		tab = 0;
		render();
		if (store.groups.lora.length) loadGrid();
	});
	store.addEventListener("change", (e) => { if (e.detail.key.startsWith("lora:")) render(); });
	render();

	return { group, panel };
}

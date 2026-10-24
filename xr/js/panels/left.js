// Left panel: settings controls for store.groups.left. COMBO / IMAGE inputs open a picker that replaces the list inside the panel.
export function createLeftPanel({ THREE, store, client, ui }) {
	const { Panel, Label, Button, Toggle, Slider, List, TextField, ImageGrid, ScrollView, stackY, theme } = ui;
	const group = new THREE.Group();
	const panel = new Panel({ name: "left", widthM: 0.85, heightM: 1.15 });
	group.add(panel.mesh);
	const W = panel.width, H = panel.height;
	const title = new Label({ text: "Settings", size: 40, bold: true, x: 24, y: 24, w: W - 48 });

	const decimals = (n) => (String(n).split(".")[1] ?? "").length;
	const show = (v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

	let view = null;
	let entries = [];

	// ---- main list ----
	function sliderFor(input, label) {
		const float = input.type === "FLOAT";
		const step = input.step ?? (float ? 0.01 : 1);
		const value = Number(store.get(input.key));
		const min = input.min ?? Math.min(0, value);
		const max = input.max ?? Math.max(100, value * 2);
		const steps = (max - min) / step;
		const dec = Math.max(decimals(step), decimals(input.round));
		const slider = new Slider({
			label, min, max, step, value,
			drag: steps <= 2000,
			bigStep: steps <= 2000 ? undefined : step * 10 ** Math.max(1, Math.floor(Math.log10(steps) / 2)),
			format: float ? (v) => Number(v).toFixed(dec) : undefined,
			onChange: (v) => store.set(input.key, v),
		});
		return { widgets: [slider], update: () => { slider.value = Number(store.get(input.key)); slider.invalidate(); } };
	}

	function comboFor(input, label) {
		const button = new Button({ text: show(store.get(input.key)), size: 28, onClick: () => openPicker(input, label) });
		return {
			widgets: [new Label({ text: label, size: 24, color: theme.muted }), button],
			update: () => { button.text = show(store.get(input.key)); button.invalidate(); },
		};
	}

	function stringFor(input, label) {
		const field = new TextField({
			value: store.get(input.key), placeholder: "tap to edit",
			onDone: (v) => store.set(input.key, v),
		});
		return {
			widgets: [new Label({ text: label, size: 24, color: theme.muted }), field],
			update: () => { field.value = store.get(input.key); field.invalidate(); },
		};
	}

	function toggleFor(input, label) {
		const toggle = new Toggle({ label, value: Boolean(store.get(input.key)), onChange: (v) => store.set(input.key, v) });
		return { widgets: [toggle], update: () => { toggle.value = Boolean(store.get(input.key)); toggle.invalidate(); } };
	}

	function readOnlyFor(input, label) {
		return {
			widgets: [
				new Label({ text: label, size: 24, color: theme.muted }),
				new Label({ text: show(store.get(input.key)), size: 28, wrap: true }),
				new Label({ text: "edit on desktop", size: 24, color: theme.muted }),
			],
			update() {},
		};
	}

	function controlFor(input, label) {
		switch (input.type) {
			case "INT":
			case "FLOAT": return sliderFor(input, label);
			case "BOOLEAN": return toggleFor(input, label);
			case "STRING": return stringFor(input, label);
			case "COMBO":
			case "IMAGE": return comboFor(input, label);
			default: return readOnlyFor(input, label);
		}
	}

	function rebuild() {
		const inputs = store.groups.left;
		const counts = new Map();
		for (const i of inputs) counts.set(i.label, (counts.get(i.label) ?? 0) + 1);
		entries = inputs.map((input) => {
			const label = counts.get(input.label) > 1 ? `${input.nodeTitle} › ${input.label}` : input.label;
			return { key: input.key, ...controlFor(input, label) };
		});
		view = new ScrollView({ x: 12, y: 90, w: W - 24, h: H - 102 });
		let y = 12;
		for (const en of entries) y = stackY(en.widgets, { x: 12, y, w: W - 60, gap: 8 }) + 14;
		view.setChildren(entries.length
			? entries.flatMap((en) => en.widgets)
			: [new Label({ text: "No settings in this workflow", size: 28, color: theme.muted, x: 12, y: 12, w: W - 60 })]);
		showMain();
	}

	function showMain() {
		for (const c of view.children) c.hover = c.pressed = false;
		panel.clear();
		panel.add(title);
		panel.add(view);
	}

	// ---- picker ----
	function openPicker(input, label) {
		// opened from a click handler; swap widgets afterwards so the pointer state is not left on discarded widgets
		queueMicrotask(() => buildPicker(input, label));
	}

	function buildPicker(input, label) {
		const image = input.type === "IMAGE";
		const current = store.get(input.key);
		const all = input.options.map((o) => {
			const name = String(o);
			const item = { label: name, value: o, lc: name.toLowerCase() };
			if (image) {
				const parts = name.replaceAll("\\", "/").split("/");
				const filename = parts.pop();
				item.label = filename;
				item.url = client.viewUrl({ filename, subfolder: parts.join("/"), type: "input" });
			}
			return item;
		});
		const pick = ({ value }) => {
			store.set(input.key, value);
			showMain();
		};

		const top = 200, listW = W - 48;
		const count = new Label({ text: "", size: 26, color: theme.muted, align: "right", x: W - 24 - 200, y: 38, w: 200 });
		const field = new TextField({ placeholder: "Filter", x: 24, y: 112, w: listW, onInput: (q) => apply(q) });
		const results = image
			? new ImageGrid({ x: 24, y: top, w: listW, h: H - top - 24, cell: 190, onSelect: pick })
			: new List({ x: 24, y: top, w: listW, h: H - top - 24, size: 28, onSelect: pick });
		const apply = (q) => {
			const s = q.trim().toLowerCase();
			const items = s ? all.filter((it) => it.lc.includes(s)) : all;
			results.setItems(items);
			results.selected = current;
			count.setText(`${items.length} / ${all.length}`);
			const idx = items.findIndex((it) => it.value === current);
			if (idx >= 0) {
				if (image) { const g = results.grid(); results.scroll = Math.floor(idx / g.cols) * g.step; } else results.scroll = Math.max(0, idx * results.rowH - results.h / 2);
			}
		};

		panel.clear();
		panel.add(new Button({ text: "‹ Back", x: 24, y: 24, w: 150, h: 72, onClick: showMain }));
		panel.add(new Label({ text: label, size: 32, bold: true, x: 192, y: 24, w: W - 192 - 24 - 210, h: 72 }));
		panel.add(count);
		panel.add(field);
		panel.add(results);
		apply("");
	}

	store.addEventListener("load", rebuild);
	store.addEventListener("change", (e) => {
		for (const en of entries) if (en.key === e.detail.key) en.update();
	});
	rebuild();

	return { group };
}

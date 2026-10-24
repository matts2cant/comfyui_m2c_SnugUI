// Left panel: settings controls for store.groups.left, all edited in place: sliders and text fields take typed values, COMBO / IMAGE inputs drop down a filtered option list.
export function createLeftPanel({ THREE, store, client, ui }) {
	const { Panel, Label, Toggle, Slider, Combo, TextField, ScrollView, stackY, theme } = ui;
	const group = new THREE.Group();
	const panel = new Panel({ name: "left", widthM: 0.85, heightM: 1.15 });
	group.add(panel.mesh);
	const W = panel.width, H = panel.height;
	const title = new Label({ text: "Settings", size: 40, bold: true, x: 24, y: 24, w: W - 48 });

	const decimals = (n) => (String(n).split(".")[1] ?? "").length;
	const show = (v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
	const typed = (text, original) => {
		const t = text.trim();
		if (typeof original === "number") return t && Number.isFinite(Number(t)) ? Number(t) : text;
		if (typeof original === "boolean") return t === "true" ? true : t === "false" ? false : text;
		if (typeof original !== "object") return text;
		try { return JSON.parse(text); } catch { return text; }
	};

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
		const options = input.options.map((o) => {
			const name = String(o);
			const option = { label: name, value: o };
			if (input.type === "IMAGE") {
				const parts = name.replaceAll("\\", "/").split("/");
				const filename = parts.pop();
				option.url = client.viewUrl({ filename, subfolder: parts.join("/"), type: "input" });
			}
			return option;
		});
		const combo = new Combo({ options, current: store.get(input.key), size: 28, onChange: (v) => store.set(input.key, v) });
		return {
			widgets: [new Label({ text: label, size: 24, color: theme.muted }), combo],
			update: () => combo.select(store.get(input.key)),
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

	// any other type: edited as text, converted back to the type of the original value on commit
	function textFor(input, label) {
		const field = new TextField({
			value: show(store.get(input.key)),
			onDone: (v) => {
				if (v !== show(store.get(input.key))) store.set(input.key, typed(v, input.value));
			},
		});
		return {
			widgets: [new Label({ text: label, size: 24, color: theme.muted }), field],
			update: () => { field.value = show(store.get(input.key)); field.invalidate(); },
		};
	}

	function readOnlyFor(input, label) {
		const value = show(input.value);
		const text = `${value.length > 120 ? `${value.slice(0, 120)}…` : value}  (edit on desktop)`;
		return { widgets: [new Label({ text: label, size: 24, color: theme.muted }), new Label({ text, size: 26, wrap: true })], update() {} };
	}

	function controlFor(input, label) {
		if (!input.targets.length) return readOnlyFor(input, label);
		switch (input.type) {
			case "INT":
			case "FLOAT": return sliderFor(input, label);
			case "BOOLEAN": return toggleFor(input, label);
			case "STRING": return stringFor(input, label);
			case "COMBO":
			case "IMAGE": return comboFor(input, label);
			default: return textFor(input, label);
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
		panel.clear();
		panel.add(title);
		panel.add(view);
	}

	store.addEventListener("load", rebuild);
	store.addEventListener("change", (e) => {
		for (const en of entries) if (en.key === e.detail.key) en.update();
	});
	rebuild();

	return { group };
}

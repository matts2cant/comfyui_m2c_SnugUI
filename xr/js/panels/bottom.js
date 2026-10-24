// Bottom panel: prompt text boxes, seeds, batch count, generate / cancel and run status.
const MODES = ["fixed", "randomize", "increment"];
const SEED_ROW = 96;

export function createBottomPanel({ THREE, store, client, ui }) {
	const { theme } = ui;
	const group = new THREE.Group();
	const panel = new ui.Panel({ name: "bottom", widthM: 1.6, heightM: 0.5 });
	group.add(panel.mesh);

	const VIEW_W = 1060, W = VIEW_W - 24;
	const view = panel.add(new ui.ScrollView({ x: 20, y: 20, w: VIEW_W, h: 460 }));
	let rows = [];

	// right column
	const RX = 1110, RW = 466;
	const batchN = new ui.Label({ text: "1", size: 36, bold: true, align: "center", x: RX + 264, y: 24, w: 70, h: 72 });
	panel.add(new ui.Label({ text: "Batch", size: 32, color: theme.muted, x: RX, y: 24, w: 150, h: 72 }));
	panel.add(new ui.Button({ text: "−", size: 40, x: RX + 162, y: 24, w: 90, onClick: () => store.setBatchCount(store.batchCount - 1) }));
	panel.add(batchN);
	panel.add(new ui.Button({ text: "+", size: 40, x: RX + 346, y: 24, w: 90, onClick: () => store.setBatchCount(store.batchCount + 1) }));
	panel.add(new ui.Button({ text: "Generate", size: 52, variant: "accent", x: RX, y: 116, w: RW, h: 150, onClick: () => store.generate() }));
	const cancel = panel.add(new ui.Button({ text: "Cancel", variant: "danger", x: RX, y: 278, w: RW, h: 72, onClick: () => client.interrupt() }));
	const status = panel.add(new ui.Label({ text: "", size: 28, wrap: true, x: RX, y: 366, w: RW, h: 110 }));

	// run status
	let remaining = 0, running = false, error = "", errorTime = 0;
	function showStatus() {
		const busy = running || remaining > 0;
		cancel.disabled = !busy;
		status.color = error ? theme.danger : busy ? theme.accent : theme.muted;
		status.setText(error || (busy ? `${running ? "Running" : "Queued"}${remaining > 1 ? `, ${remaining} in queue` : ""}` : "Idle"));
		panel.invalidate();
	}
	function showError(message) {
		error = message;
		errorTime = 8;
		showStatus();
	}
	client.addEventListener("status", (e) => { remaining = e.detail.queueRemaining; showStatus(); });
	client.addEventListener("executing", (e) => { running = e.detail.node != null; showStatus(); });
	client.addEventListener("done", () => { running = false; showStatus(); });
	client.addEventListener("interrupted", () => { running = false; showStatus(); });
	client.addEventListener("error", (e) => { running = false; showError(e.detail.message); });
	store.addEventListener("queued", () => { remaining = Math.max(remaining, 1); showStatus(); });
	store.addEventListener("error", (e) => showError(e.detail.message));

	// prompt / seed rows
	function promptRow(input) {
		const set = (v) => store.set(input.key, v);
		const label = new ui.Label({ text: input.nodeTitle || input.label, size: 28, color: theme.muted, h: 44 });
		const box = new ui.TextField({
			multiline: true, size: 28, placeholder: "Tap to edit prompt",
			onInput: set, onDone: set,
		});
		return {
			widgets: [label, box],
			fill: true,
			refresh: () => { box.value = String(store.get(input.key) ?? ""); },
			place(y, h) {
				label.x = box.x = 0; label.y = y; label.w = box.w = W; box.y = y + 52; box.h = h - 76;
				return y + h;
			},
		};
	}

	function seedRow(input) {
		const key = input.key;
		const label = new ui.Label({ text: input.label, size: 30, color: theme.muted, w: 220, h: 72 });
		const value = new ui.TextField({
			w: 330,
			onDone: (v) => {
				const n = Number(v.trim());
				if (Number.isInteger(n)) store.set(key, n);
				value.value = String(store.get(key));
			},
		});
		const random = new ui.Button({ text: "Random", size: 28, w: 200, onClick: () => store.randomizeSeed(key) });
		const mode = new ui.Button({
			size: 26, w: 250,
			onClick: () => store.setSeedMode(key, MODES[(MODES.indexOf(store.seedMode(key)) + 1) % MODES.length]),
		});
		return {
			widgets: [label, value, random, mode],
			refresh() {
				value.value = String(store.get(key));
				mode.text = "Mode: " + store.seedMode(key);
				mode.toggled = store.seedMode(key) !== "fixed";
			},
			place(y) {
				label.y = value.y = random.y = mode.y = y;
				label.x = 0; value.x = 232; random.x = 574; mode.x = 786;
				return y + SEED_ROW;
			},
		};
	}

	function layout() {
		// prompt boxes share the height the seed rows leave; 12 is the scroll view's bottom pad, 24 the row gap
		const fills = rows.filter((r) => r.fill).length;
		const fillH = Math.floor((view.h + 12 - (rows.length - fills) * SEED_ROW) / fills);
		let y = 0;
		for (const r of rows) y = r.place(y, fillH);
		view.invalidate();
	}

	function refresh() {
		for (const r of rows) r.refresh();
		batchN.setText(String(store.batchCount));
		layout();
	}

	function build() {
		rows = [...store.groups.prompts.map(promptRow), ...store.groups.seeds.map(seedRow)];
		view.clear();
		view.setChildren(rows.flatMap((r) => r.widgets));
		refresh();
	}

	store.addEventListener("load", build);
	store.addEventListener("change", refresh);
	build();
	showStatus();

	return {
		group,
		update(dt) {
			if (errorTime > 0 && (errorTime -= dt) <= 0) { error = ""; showStatus(); }
		},
	};
}

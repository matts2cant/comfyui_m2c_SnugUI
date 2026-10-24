// Bottom panel: prompt text boxes on the left; batch count, seeds, generate / cancel and run status on the right.
const MODES = ["fixed", "randomize", "increment"];
const MODE_LABELS = { fixed: "Fixed", randomize: "Rand", increment: "Incr" };

export function createBottomPanel({ THREE, store, client, ui }) {
	const { theme } = ui;
	const group = new THREE.Group();
	const panel = new ui.Panel({ name: "bottom", widthM: 1.6, heightM: 0.5 });
	group.add(panel.mesh);

	const VIEW_W = 1060, W = VIEW_W - 24;
	const view = panel.add(new ui.ScrollView({ x: 20, y: 20, w: VIEW_W, h: 460 }));
	let rows = [];
	let seedRows = [];

	// right column
	const RX = 1110, RW = 466;
	const batchN = new ui.Label({ text: "1", size: 36, bold: true, align: "center", x: RX + 264, y: 20, w: 70, h: 56 });
	panel.add(new ui.Label({ text: "Batch", size: 30, color: theme.muted, x: RX, y: 20, w: 150, h: 56 }));
	panel.add(new ui.Button({ text: "−", size: 36, x: RX + 162, y: 20, w: 90, h: 56, onClick: () => store.setBatchCount(store.batchCount - 1) }));
	panel.add(batchN);
	panel.add(new ui.Button({ text: "+", size: 36, x: RX + 346, y: 20, w: 90, h: 56, onClick: () => store.setBatchCount(store.batchCount + 1) }));
	const seedView = panel.add(new ui.ScrollView({ x: RX, y: 84, w: RW, h: 0 }));
	const generate = panel.add(new ui.Button({ text: "Generate", size: 48, variant: "accent", x: RX, w: RW, onClick: () => store.generate() }));
	const cancel = panel.add(new ui.Button({ text: "Cancel", size: 28, variant: "danger", x: RX, y: 364, w: RW, h: 48, onClick: () => client.interrupt() }));
	const status = panel.add(new ui.Label({ text: "", size: 24, wrap: true, x: RX, y: 418, w: RW, h: 62 }));

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
		const label = new ui.Label({ text: input.label, size: 26, color: theme.muted, w: 136, h: 48 });
		const value = new ui.TextField({
			size: 26, w: RW - 144, h: 48,
			onDone: (v) => {
				const n = Number(v.trim());
				if (Number.isInteger(n)) store.set(key, n);
				value.value = String(store.get(key));
			},
		});
		const random = new ui.Button({ text: "Random", size: 24, w: 190, h: 48, onClick: () => store.randomizeSeed(key) });
		const mode = new ui.Button({
			size: 24, w: RW - 198, h: 48,
			onClick: () => store.setSeedMode(key, MODES[(MODES.indexOf(store.seedMode(key)) + 1) % MODES.length]),
		});
		return {
			widgets: [label, value, random, mode],
			refresh() {
				value.value = String(store.get(key));
				mode.text = MODE_LABELS[store.seedMode(key)];
				mode.toggled = store.seedMode(key) !== "fixed";
			},
			place(y) {
				label.y = value.y = y; random.y = mode.y = y + 52;
				label.x = random.x = 0; value.x = 144; mode.x = 198;
				return y + 108;
			},
		};
	}

	function layout() {
		// prompt boxes share the full height; 12 is the scroll view's bottom pad, 24 the row gap
		const fillH = Math.floor((view.h + 12) / rows.length);
		let y = 0;
		for (const r of rows) y = r.place(y, fillH);
		view.invalidate();

		y = 0;
		for (const r of seedRows) y = r.place(y);
		seedView.h = Math.min(y + 4, 212);
		generate.y = seedView.y + seedView.h + 6;
		generate.h = cancel.y - 6 - generate.y;
		seedView.invalidate();
	}

	function refresh() {
		for (const r of [...rows, ...seedRows]) r.refresh();
		batchN.setText(String(store.batchCount));
		layout();
	}

	function build() {
		rows = store.groups.prompts.map(promptRow);
		seedRows = store.groups.seeds.map(seedRow);
		view.clear();
		view.setChildren(rows.flatMap((r) => r.widgets));
		seedView.clear();
		seedView.setChildren(seedRows.flatMap((r) => r.widgets));
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

// Bottom panel: prompt chips, seeds, batch count, generate / cancel and run status.
const MODES = ["fixed", "randomize", "increment"];
const segments = (text) => String(text ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function createBottomPanel({ THREE, store, client, ui, keyboard }) {
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
		const commit = (segs) => store.set(input.key, segs.join(", "));
		const label = new ui.Label({ text: input.nodeTitle || input.label, size: 28, color: theme.muted, h: 44 });
		const edit = new ui.Button({
			text: "Edit all", size: 22, w: 160, h: 44,
			onClick: () => keyboard.editText({ initial: store.get(input.key) ?? "", multiline: true, onDone: (v) => store.set(input.key, v) }),
		});
		const chips = new ui.Chips({
			onAdd: () => keyboard.editText({ onDone: (v) => commit([...segments(store.get(input.key)), ...segments(v)]) }),
			onTap: (i) => keyboard.editText({
				initial: segments(store.get(input.key))[i],
				onDone: (v) => { const segs = segments(store.get(input.key)); segs.splice(i, 1, ...segments(v)); commit(segs); },
			}),
			onDelete: (i) => { const segs = segments(store.get(input.key)); segs.splice(i, 1); commit(segs); },
		});
		return {
			widgets: [label, edit, chips],
			refresh: () => chips.setChips(segments(store.get(input.key))),
			place(y) {
				label.x = 0; label.y = edit.y = y; label.w = W - 172; edit.x = W - 160;
				chips.x = 0; chips.y = y + 52; chips.w = W; chips.relayout();
				return chips.y + chips.h + 24;
			},
		};
	}

	function seedRow(input) {
		const key = input.key;
		const label = new ui.Label({ text: input.label, size: 30, color: theme.muted, w: 220, h: 72 });
		const value = new ui.TextField({
			w: 330,
			onClick: () => keyboard.editText({ initial: String(store.get(key)), onDone: (v) => { const n = Number(v.trim()); if (Number.isInteger(n)) store.set(key, n); } }),
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
				return y + 72 + 24;
			},
		};
	}

	function layout() {
		let y = 0;
		for (const r of rows) y = r.place(y);
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

// Prompt panel, the lectern under the screen: workflow name at the top left, prompt boxes on the left; on the right, seed
// rows, the progress bar (run status), Generate and Cancel. Without prompt inputs the right column takes the whole width.
const MODES = [["fixed", "lock"], ["increment", "plus"], ["randomize", "shuffle"]];
const M = 20, TOP = 72, RW = 700, ROW_H = 60, SEED_ROW = 68, BTN_W = 56;

export function createBottomPanel({ THREE, store, client, ui }) {
	const { theme } = ui;
	const group = new THREE.Group();
	const panel = new ui.Panel({ name: "prompt", widthM: 1.8, heightM: 0.6 });
	group.add(panel.mesh);
	const W = panel.width, H = panel.height;

	class ProgressBar extends ui.Widget {
		constructor(o) { super({ value: 0, max: 0, text: "Idle", queue: 0, error: false, ...o }); }
		draw(ctx) {
			const { w, h } = this;
			ctx.save();
			ctx.beginPath();
			ctx.roundRect(0, 0, w, h, h / 2);
			ctx.fillStyle = theme.surface;
			ctx.fill();
			ctx.clip();
			if (this.max > 0) {
				ctx.fillStyle = theme.accent;
				ctx.fillRect(0, 0, w * Math.min(1, this.value / this.max), h);
			}
			ctx.restore();
			ctx.font = `600 28px ${theme.font}`;
			ctx.fillStyle = this.error ? theme.danger : theme.fg;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			const text = (this.max > 0 ? `${this.value}/${this.max}  ` : "") + this.text + (this.queue > 1 ? `  ·  ${this.queue} in queue` : "");
			ctx.fillText(text, w / 2, h / 2 + 1, w - 40);
		}
	}

	const name = panel.add(new ui.Label({ text: "", size: 32, bold: true, x: 24, y: 14, w: W - 48, h: 48 }));
	const view = panel.add(new ui.ScrollView({ x: M, y: TOP, h: H - TOP - M }));
	const seedView = panel.add(new ui.ScrollView({ y: TOP }));
	const progress = panel.add(new ProgressBar({ h: 56 }));
	const generate = panel.add(new ui.Button({ text: "Generate", size: 52, variant: "accent", onClick: () => store.generate() }));
	const cancel = panel.add(new ui.Button({ text: "Cancel", size: 28, variant: "danger", y: H - M - ROW_H, h: ROW_H, onClick: () => client.interrupt() }));
	let rows = [];
	let seedRows = [];

	// run status
	let remaining = 0, running = false;
	function showStatus(props) {
		Object.assign(progress, props, { queue: remaining });
		cancel.disabled = !running && !remaining;
		panel.invalidate();
	}
	const nodeTitle = (id) => {
		const node = store.snapshot?.prompt[id];
		return node?._meta?.title ?? node?.class_type ?? "Running";
	};
	client.addEventListener("status", (e) => { remaining = e.detail.queueRemaining; showStatus(); });
	client.addEventListener("executing", (e) => { running = true; showStatus({ error: false, value: 0, max: 0, text: nodeTitle(e.detail.node) }); });
	client.addEventListener("progress", (e) => showStatus({ value: e.detail.value, max: e.detail.max }));
	client.addEventListener("done", () => { running = false; showStatus({ max: 0, text: "Idle" }); });
	client.addEventListener("interrupted", () => { running = false; showStatus({ max: 0, text: "Interrupted" }); });
	client.addEventListener("error", (e) => { running = false; showStatus({ error: true, max: 0, text: e.detail.message }); });
	store.addEventListener("queued", () => {
		remaining = Math.max(remaining, 1);
		showStatus(running ? {} : { error: false, max: 0, text: "Queued" });
	});
	store.addEventListener("error", (e) => showStatus({ error: true, max: 0, text: e.detail.message }));

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
			refresh: () => { box.value = String(store.get(input.key) ?? ""); },
			place(y, h, w) {
				label.x = box.x = 0; label.y = y; label.w = box.w = w; box.y = y + 52; box.h = h - 76;
				return y + h;
			},
		};
	}

	// label, −, value, +, then the mode icons
	function seedRow(input) {
		const key = input.key;
		const label = new ui.Label({ text: input.label, size: 26, color: theme.muted, w: 96, h: ROW_H });
		const value = new ui.TextField({
			size: 24, h: ROW_H,
			onDone: (v) => {
				const n = Number(v.trim());
				if (Number.isInteger(n)) store.set(key, n);
				value.value = String(store.get(key));
			},
		});
		const step = (d) => {
			const next = store.get(key) + d;
			store.set(key, Math.min(Math.max(next, input.min ?? -Infinity), input.max ?? Infinity));
		};
		const minus = new ui.Button({ text: "−", size: 34, w: BTN_W, h: ROW_H, onClick: () => step(-1) });
		const plus = new ui.Button({ text: "+", size: 34, w: BTN_W, h: ROW_H, onClick: () => step(1) });
		const modes = MODES.map(([mode, icon]) => new ui.Button({ icon, w: BTN_W, h: ROW_H, onClick: () => store.setSeedMode(key, mode) }));
		return {
			widgets: [label, minus, value, plus, ...modes],
			refresh() {
				value.value = String(store.get(key));
				MODES.forEach(([mode], i) => { modes[i].toggled = store.seedMode(key) === mode; });
			},
			place(y, w) {
				const mx = w - MODES.length * (BTN_W + 6) + 6;
				for (const wd of [label, minus, value, plus, ...modes]) wd.y = y;
				label.x = 0;
				minus.x = 104;
				plus.x = mx - 16 - plus.w;
				value.x = minus.x + minus.w + 6;
				value.w = plus.x - 6 - value.x;
				modes.forEach((b, i) => { b.x = mx + i * (BTN_W + 6); });
				return y + SEED_ROW;
			},
		};
	}

	function layout() {
		const rx = rows.length ? W - M - RW : M, rw = W - M - rx;
		view.visible = rows.length > 0;
		view.w = rx - M - 24;
		// prompt boxes share the full height; 12 is the scroll view's bottom pad, 24 the row gap
		const fillH = Math.floor((view.h + 12) / Math.max(1, rows.length));
		let y = 0;
		for (const r of rows) y = r.place(y, fillH, view.w - 24);
		view.invalidate();

		// more than two seeds scroll: leave room for the scroll bar
		y = 0;
		for (const r of seedRows) y = r.place(y, seedRows.length > 2 ? rw - 16 : rw);
		Object.assign(seedView, { x: rx, w: rw, h: Math.min(y, 2 * SEED_ROW) + 4 }); // + the scroll view's bottom pad, less the row gap
		Object.assign(progress, { x: rx, w: rw, y: TOP + seedView.h + (seedRows.length ? 4 : 0) });
		Object.assign(generate, { x: rx, w: rw, y: progress.y + progress.h + 12 });
		generate.h = cancel.y - 12 - generate.y;
		Object.assign(cancel, { x: rx, w: rw });
		seedView.invalidate();
	}

	function refresh() {
		for (const r of [...rows, ...seedRows]) r.refresh();
		layout();
	}

	function build() {
		name.setText(store.snapshot?.workflowName ?? "No workflow");
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

	return { group, panel };
}

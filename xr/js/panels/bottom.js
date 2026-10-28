// Prompt panel, the lectern under the screen: workflow name at the top left, prompt boxes on the left (the positive one alone
// takes the full height, with the negative one below it 2/3 and 1/3); on the right, the seed row, the progress bar (run status),
// Generate and Cancel. Without prompt boxes the right column takes the whole width, without a seed it starts with the progress bar.
const MODES = [["fixed", "lock"], ["increment", "plus"], ["randomize", "shuffle"]];
const M = 20, TOP = 72, RW = 700, ROW_H = 60, GAP = 16, BTN_W = 56;

export function createBottomPanel({ THREE, store, client, ui }) {
	const { theme } = ui;
	const group = new THREE.Group();
	const panel = new ui.Panel({ name: "prompt", widthM: 1.8, heightM: 0.6 });
	group.add(panel.mesh);

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

	const name = panel.add(new ui.Label({ text: "", size: 32, bold: true, x: 24, y: 14, h: 48 }));
	const progress = panel.add(new ProgressBar({ h: 56 }));
	const generate = panel.add(new ui.Button({ text: "Generate", size: 52, variant: "accent", onClick: () => store.generate() }));
	const cancel = panel.add(new ui.Button({ text: "Cancel", size: 28, variant: "danger", h: ROW_H, onClick: () => client.interrupt() }));
	let boxes = [];
	let seedRow = null;
	let widgets = [];

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
	client.addEventListener("done", () => { running = false; showStatus({ max: 0, text: noOutput ? "No active output" : "Idle" }); });
	client.addEventListener("interrupted", () => { running = false; showStatus({ max: 0, text: "Interrupted" }); });
	client.addEventListener("error", (e) => { running = false; showStatus({ error: true, max: 0, text: e.detail.message }); });
	store.addEventListener("queued", () => {
		remaining = Math.max(remaining, 1);
		showStatus(running ? {} : { error: false, max: 0, text: "Queued" });
	});
	store.addEventListener("error", (e) => showStatus({ error: true, max: 0, text: e.detail.message }));

	// every output muted or bypassed (desktop or Group Switch): nothing to run
	let noOutput = false;
	function checkOutputs() {
		const none = !store.hasActiveOutput();
		generate.disabled = none;
		if (none === noOutput) return panel.invalidate();
		noOutput = none;
		showStatus(none ? { error: false, max: 0, text: "No active output" } : running || remaining ? {} : { error: false, max: 0, text: "Idle" });
	}

	// the empty box shows its name
	function promptBox(input, placeholder) {
		const set = (v) => store.set(input.key, v);
		return new ui.TextField({ multiline: true, size: 28, placeholder, onInput: set, onDone: set });
	}

	// "Seed", −, value, +, then the mode icons
	function seedRowFor(input) {
		const key = input.key;
		const label = new ui.Label({ text: "Seed", size: 26, color: theme.muted, w: 96, h: ROW_H });
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
			place(x, y, w) {
				const mx = x + w - MODES.length * (BTN_W + 6) + 6;
				for (const wd of [label, minus, value, plus, ...modes]) wd.y = y;
				label.x = x;
				minus.x = x + 104;
				plus.x = mx - 16 - plus.w;
				value.x = minus.x + minus.w + 6;
				value.w = plus.x - 6 - value.x;
				modes.forEach((b, i) => { b.x = mx + i * (BTN_W + 6); });
			},
		};
	}

	// from the panel's size: the Desktop View's window re-flows it
	function layout() {
		const W = panel.width, H = panel.height;
		const rx = boxes.length ? W - M - RW : M, rw = W - M - rx;
		name.w = W - 48;
		cancel.y = H - M - ROW_H;
		const total = H - TOP - M, first = boxes.length > 1 ? Math.round((total - GAP) * 2 / 3) : total;
		boxes.forEach(([, box], i) => {
			Object.assign(box, { x: M, w: rx - M - 24, y: i ? TOP + first + GAP : TOP, h: i ? total - first - GAP : first });
		});
		seedRow?.place(rx, TOP, rw);
		Object.assign(progress, { x: rx, w: rw, y: seedRow ? TOP + ROW_H + GAP : TOP });
		Object.assign(generate, { x: rx, w: rw, y: progress.y + progress.h + 12 });
		generate.h = cancel.y - 12 - generate.y;
		Object.assign(cancel, { x: rx, w: rw });
		panel.invalidate();
	}

	function refresh() {
		for (const [input, box] of boxes) box.value = String(store.get(input.key) ?? "");
		seedRow?.refresh();
		layout();
	}

	function build() {
		name.setText(store.snapshot?.workflowName ?? "No workflow");
		const { prompt, negative, seed } = store.groups;
		boxes = [prompt && [prompt, promptBox(prompt, "Prompt…")], negative && [negative, promptBox(negative, "Negative prompt…")]].filter(Boolean);
		seedRow = seed && seedRowFor(seed);
		for (const w of widgets) panel.remove(w);
		widgets = [...boxes.map(([, box]) => box), ...(seedRow?.widgets ?? [])];
		for (const w of widgets) panel.add(w);
		refresh();
	}

	panel.onResize = layout;
	store.addEventListener("load", () => { build(); checkOutputs(); });
	store.addEventListener("change", (e) => {
		refresh();
		if (e.detail.key === "switchGroups") checkOutputs();
	});
	build();
	showStatus();

	return { group, panel };
}

// Prompt panel, the lectern under the screen: the workflow name, the prompt box (it takes all the extra height), the negative
// prompt folded under a one-row header, then one action bar (seed controls, run status, Cancel, Generate) and two progress bars
// flush with the bottom edge: the running node's steps over the run's total. Narrower than NARROW (the Desktop View's window) the
// seed controls take their own row above the bar and Cancel is an icon. Missing entries leave no empty box.
const MODES = [["fixed", "lock"], ["increment", "plus"], ["randomize", "shuffle"]];
const M = 20, GAP = 12, TOP = 60, ROW_H = 64, BTN_W = 60, FOLD_H = 52, NEG_H = 140, MIN_BOX = 140;
const SEED_W = 680, GEN_W = 300, CANCEL_W = 170, NARROW = 1500;
const NODE_BAR = 8, TOTAL_BAR = 12, BARS_H = NODE_BAR + 2 + TOTAL_BAR;
const NEGATIVE_KEY = "appmode-xr.negative";

export function createBottomPanel({ THREE, store, client, ui }) {
	const { theme } = ui;
	const group = new THREE.Group();
	const panel = new ui.Panel({ name: "prompt", widthM: 1.8, heightM: 0.6 });
	group.add(panel.mesh);

	// node progress (thin) over total progress, full width, clipped to the panel's rounded corners; empty tracks when idle
	class Bars extends ui.Widget {
		constructor(o) { super({ node: 0, total: 0, ...o }); }
		hitTest() { return null; }
		draw(ctx) {
			const { w } = this;
			ctx.beginPath();
			ctx.roundRect(0, -this.y, w, panel.height, theme.radius);
			ctx.clip();
			[[0, NODE_BAR, this.node, 0.55], [NODE_BAR + 2, TOTAL_BAR, this.total, 1]].forEach(([y, h, t, alpha]) => {
				ctx.fillStyle = theme.surface;
				ctx.fillRect(0, y, w, h);
				ctx.globalAlpha = alpha;
				ctx.fillStyle = theme.accent;
				ctx.fillRect(0, y, w * Math.min(1, t), h);
				ctx.globalAlpha = 1;
			});
		}
	}

	// the negative prompt's header: a chevron, "Negative" and, folded, the start of its text
	class Fold extends ui.Widget {
		constructor(o) { super({ open: false, preview: "", ...o }); }
		draw(ctx) {
			const { w, h } = this;
			if (this.hover || this.pressed) {
				ctx.beginPath();
				ctx.roundRect(0, 0, w, h, theme.radius * 0.7);
				ctx.fillStyle = this.pressed ? theme.pressed : theme.hover;
				ctx.fill();
			}
			ctx.save();
			ctx.translate(24, h / 2);
			if (this.open) ctx.rotate(Math.PI / 2);
			ctx.beginPath();
			ctx.moveTo(-5, -9);
			ctx.lineTo(8, 0);
			ctx.lineTo(-5, 9);
			ctx.restore();
			ctx.fillStyle = theme.fg;
			ctx.fill();
			ctx.font = `600 26px ${theme.font}`;
			ctx.textBaseline = "middle";
			ctx.fillText("Negative", 48, h / 2 + 1);
			if (this.open || !this.preview) return;
			const x = 48 + ctx.measureText("Negative").width + 20;
			ctx.font = `24px ${theme.font}`;
			ctx.fillStyle = theme.muted;
			ctx.fillText(ui.ellipsize(ctx, this.preview, w - x - 16), x, h / 2 + 1);
		}
	}

	const name = panel.add(new ui.Label({ text: "", size: 28, bold: true, x: 24, y: 10, h: 42 }));
	const status = panel.add(new ui.Label({ text: "Idle", size: 26, bold: true, color: theme.muted, h: ROW_H }));
	const cancel = panel.add(new ui.Button({ size: 28, variant: "danger", h: ROW_H, onClick: () => client.interrupt() }));
	const generate = panel.add(new ui.Button({ text: "Generate", size: 34, variant: "accent", w: GEN_W, h: ROW_H, onClick: () => store.generate() }));
	const bars = panel.add(new Bars({ h: BARS_H }));
	const fold = new Fold({ h: FOLD_H, onClick: () => {
		fold.open = !fold.open;
		try { localStorage.setItem(NEGATIVE_KEY, fold.open ? "open" : "closed"); } catch {}
		layout();
	} });
	try { fold.open = localStorage.getItem(NEGATIVE_KEY) === "open"; } catch {}
	let prompt = null, negative = null; // [input, TextField]
	let seedRow = null;
	let widgets = [];

	// run status: the run being executed and the node ids of every prompt queued from here (its node count)
	let remaining = 0, run = null, last = null; // last: { text, error } of the previous run ("Interrupted", an error) until the next one
	let ended = null; // the id of the last run that ended: a fully cached one can end before its "queued"
	const queued = new Map();
	const runOf = (id) => run?.id === id ? run : run = { id, done: new Set(), node: null, value: 0, max: 0 };
	const nodeTitle = (id) => {
		const node = store.snapshot?.prompt[id];
		return node?._meta?.title ?? node?.class_type ?? "Running";
	};
	// the status from the longest text to the shortest: showStatus takes the first that fits
	function statusTexts() {
		const queue = remaining > 1 ? ` · ${remaining} in queue` : "";
		if (run?.node) {
			const title = nodeTitle(run.node), nodes = queued.get(run.id), i = nodes && Math.min(doneCount() + 1, nodes.size);
			const of = nodes ? [` · node ${i} of ${nodes.size}`, ` · node ${i}/${nodes.size}`] : ["", ""];
			if (!run.max) return [title + of[0] + queue, title + of[1], title];
			const steps = `${title} ${run.value}/${run.max}`;
			return [`${title} · step ${run.value} / ${run.max}${of[0]}${queue}`, steps + of[1], steps];
		}
		if (run || remaining) return ["Queued" + queue, "Queued"];
		if (noOutput) return ["No active output"];
		return [last?.text ?? "Idle"];
	}
	const doneCount = () => [...run.done].filter((id) => queued.get(run.id)?.has(id)).length;

	function showStatus() {
		panel.ctx.font = `600 ${status.size}px ${theme.font}`;
		const texts = statusTexts();
		status.text = texts.find((t) => panel.ctx.measureText(t).width <= status.w) ?? texts.at(-1);
		status.color = !run && !remaining && last?.error ? theme.danger : run?.node ? theme.fg : theme.muted;
		const nodes = run && queued.get(run.id);
		bars.node = run?.max ? run.value / run.max : 0;
		bars.total = nodes ? doneCount() / nodes.size : 0;
		cancel.disabled = !run && !remaining;
		panel.invalidate();
	}
	// a run ends with "done", which also follows an error or an interruption: that one keeps their note
	function end(e, note) {
		if (e.detail.prompt_id === ended && !note) return;
		ended = e.detail.prompt_id;
		queued.delete(ended);
		run = null;
		last = note ?? null;
		showStatus();
	}
	client.addEventListener("status", (e) => { remaining = e.detail.queueRemaining; showStatus(); });
	client.addEventListener("cached", (e) => {
		for (const id of e.detail.nodes) runOf(e.detail.prompt_id).done.add(id);
		showStatus();
	});
	client.addEventListener("executing", (e) => {
		const r = runOf(e.detail.prompt_id);
		if (r.node) r.done.add(r.node);
		Object.assign(r, { node: e.detail.node, value: 0, max: 0 });
		showStatus();
	});
	client.addEventListener("progress", (e) => {
		if (run?.id !== e.detail.prompt_id) return;
		Object.assign(run, { value: e.detail.value, max: e.detail.max });
		showStatus();
	});
	client.addEventListener("done", (e) => end(e));
	client.addEventListener("interrupted", (e) => end(e, { text: "Interrupted" }));
	client.addEventListener("error", (e) => end(e, { text: e.detail.message, error: true }));
	store.addEventListener("queued", (e) => {
		if (e.detail.prompt_id === ended) return;
		queued.set(e.detail.prompt_id, new Set(e.detail.nodes));
		remaining = Math.max(remaining, 1);
		last = null;
		showStatus();
	});
	store.addEventListener("error", (e) => {
		last = { text: e.detail.message, error: true };
		showStatus();
	});

	// every output muted or bypassed (desktop or Group Switch): nothing to run
	let noOutput = false;
	function checkOutputs() {
		noOutput = generate.disabled = !store.hasActiveOutput();
		showStatus();
	}

	// the empty box shows its name
	function promptBox(input, placeholder) {
		const set = (v) => store.set(input.key, v);
		return [input, new ui.TextField({ multiline: true, size: 28, placeholder, onInput: set, onDone: set })];
	}

	// "Seed", −, value, +, then the mode icons
	function seedRowFor(input) {
		const key = input.key;
		const label = new ui.Label({ text: "Seed", size: 26, color: theme.muted, w: 72, h: ROW_H });
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
				minus.x = x + 80;
				plus.x = mx - 16 - plus.w;
				value.x = minus.x + minus.w + 6;
				value.w = plus.x - 6 - value.x;
				modes.forEach((b, i) => { b.x = mx + i * (BTN_W + 6); });
			},
		};
	}

	// height of the layout at width w: name, a few prompt lines, the negative header, the seed row when narrow, the bar, progress
	const minHeight = (w) => TOP + (prompt || negative ? MIN_BOX : 0) + (prompt && negative ? GAP + FOLD_H : 0) + 16 + (seedRow && w < NARROW ? ROW_H + GAP : 0) + ROW_H + 16 + BARS_H;

	// from the panel's size: the Desktop View's window re-flows it
	function layout() {
		const W = panel.width, H = panel.height, narrow = W < NARROW;
		name.w = W - 48;
		Object.assign(bars, { x: 0, y: H - BARS_H, w: W });
		const barY = H - BARS_H - 16 - ROW_H;
		Object.assign(generate, { x: W - M - GEN_W, y: barY });
		Object.assign(cancel, { y: barY, w: narrow ? ROW_H : CANCEL_W, text: narrow ? "" : "Cancel", icon: narrow ? "x" : null });
		cancel.x = generate.x - GAP - cancel.w;
		seedRow?.place(M, narrow ? barY - GAP - ROW_H : barY, narrow ? W - 2 * M : SEED_W);
		Object.assign(status, { x: seedRow && !narrow ? M + SEED_W + 24 : M, y: barY });
		status.w = cancel.x - 24 - status.x;

		// the boxes take what is left above the bar (and the seed row): the negative one folded under its header, or alone
		const bottom = (seedRow && narrow ? barY - GAP - ROW_H : barY) - 16;
		fold.visible = !!(prompt && negative);
		if (negative) negative[1].visible = !fold.visible || fold.open;
		if (fold.visible) {
			const free = bottom - TOP - GAP - FOLD_H - (fold.open ? 6 : 0);
			const negH = fold.open ? Math.min(NEG_H, Math.round(free / 2)) : 0;
			Object.assign(prompt[1], { x: M, y: TOP, w: W - 2 * M, h: free - negH });
			Object.assign(fold, { x: M, y: TOP + free - negH + GAP, w: W - 2 * M });
			Object.assign(negative[1], { x: M, y: bottom - negH, w: W - 2 * M, h: negH });
		} else {
			for (const [, box] of [prompt, negative].filter(Boolean)) Object.assign(box, { x: M, y: TOP, w: W - 2 * M, h: bottom - TOP });
		}
		showStatus();
	}

	function refresh() {
		for (const [input, box] of [prompt, negative].filter(Boolean)) box.value = String(store.get(input.key) ?? "");
		fold.preview = negative?.[1].value.replace(/\s+/g, " ") ?? "";
		seedRow?.refresh();
		layout();
	}

	function build() {
		name.setText(store.snapshot?.workflowName ?? "No workflow");
		const groups = store.groups;
		prompt = groups.prompt && promptBox(groups.prompt, "Prompt…");
		negative = groups.negative && promptBox(groups.negative, "Negative prompt…");
		seedRow = groups.seed && seedRowFor(groups.seed);
		for (const w of widgets) panel.remove(w);
		widgets = [prompt?.[1], prompt && negative && fold, negative?.[1], ...(seedRow?.widgets ?? [])].filter(Boolean);
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

	return { group, panel, minHeight };
}

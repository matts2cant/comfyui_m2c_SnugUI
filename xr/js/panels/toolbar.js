// Toolbar: one rounded slab, the same panel in both views (on the lectern in VR, in the Desktop View's deck).
// Top tier: the run status and its timer over the node and total progress bars; bottom row: main.js's round panel buttons
// (`tabs`), a separator and the view button, then Cancel and Generate at the right. Its width follows the icon row, at least
// MIN_ICONS buttons. Phones (phone.js calls arrange(dock)): the panel buttons leave for phone.js's tab bar, the view button
// hides and the toolbar draws the status, Cancel and Generate into the boxes the dock gives it at its size: the status over Cancel
// and Generate (portrait), or the run column (landscape, `vertical`): status, timer, bars, Cancel, then Generate as a tall play pill.
const M = 32, B = 100, GAP = 16, SEP = 18, FLEX = 40, GEN_W = 260, MIN_ICONS = 6, RADIUS = 56;
const STATUS_H = 44, NODE_BAR = 8, TOTAL_BAR = 12;
export const TIER_H = STATUS_H + 10 + NODE_BAR + 6 + TOTAL_BAR; // the status tier: status line, node and total bars

const clock = (ms) => {
	const s = Math.floor(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function createToolbar({ THREE, store, client, ui }, tabs, view, onError) {
	const { theme } = ui;

	// status left, timer right, then node progress (thin) over total progress; reads the run state below at draw time. Landscape
	// phones: the status word (shrunk to the column) over the timer, then the bars side by side filling upward; a tap on "Error"
	// or its timer shows the whole message (onError).
	class Status extends ui.Widget {
		hitTest(x, y) { return vertical && state().error && y < this.y + 2 * STATUS_H ? super.hitTest(x, y) : null; }
		onClick() { onError(state().texts[0]); }
		draw(ctx) {
			const { w } = this, s = state(), v = vertical;
			ctx.textBaseline = "middle";
			ctx.font = `600 28px ui-monospace, Consolas, monospace`;
			ctx.fillStyle = theme.muted;
			ctx.textAlign = v ? "center" : "right";
			this.secs = Math.floor(s.time / 1000);
			const time = clock(s.time);
			ctx.fillText(time, v ? w / 2 : w, v ? STATUS_H * 1.5 : STATUS_H / 2 + 1);
			const free = w - ctx.measureText(time).width - 24;
			ctx.font = ui.font(28, true);
			ctx.fillStyle = s.error ? theme.danger : run ? theme.fg : theme.muted;
			if (v) {
				ctx.font = ui.font(Math.min(28, Math.floor(28 * w / ctx.measureText(s.word).width)), true);
				ctx.fillText(s.word, w / 2, STATUS_H / 2 + 1);
			} else {
				ctx.textAlign = "left";
				ctx.fillText(ui.ellipsize(ctx, s.texts.find((t) => ctx.measureText(t).width <= free) ?? s.texts.at(-1), free), 0, STATUS_H / 2 + 1);
			}
			const y = v ? 2 * STATUS_H + 10 : STATUS_H + 10, x = (w - NODE_BAR - 6 - TOTAL_BAR) / 2, len = v ? this.h - y : w;
			[[0, NODE_BAR, s.node, 0.55], [NODE_BAR + 6, TOTAL_BAR, s.total, 1]].forEach(([o, h, t, alpha]) => {
				const f = Math.min(1, t);
				ctx.beginPath();
				if (v) ctx.roundRect(x + o, y, h, len, h / 2); else ctx.roundRect(0, y + o, len, h, h / 2);
				ctx.fillStyle = theme.surface;
				ctx.fill();
				if (!t) return;
				ctx.beginPath();
				if (v) ctx.roundRect(x + o, y + len * (1 - f), h, len * f, h / 2); else ctx.roundRect(0, y + o, len * f, h, h / 2);
				ctx.globalAlpha = alpha;
				ctx.fillStyle = theme.accent;
				ctx.fill();
				ctx.globalAlpha = 1;
			});
		}
	}

	class Sep extends ui.Widget {
		hitTest() { return null; }
		draw(ctx) {
			ctx.fillStyle = theme.border;
			ctx.fillRect(0, 0, 2, this.h);
		}
	}

	// desk / VR: the icon row from the left, Cancel and Generate placed from the width it gives
	const rowY = M + TIER_H + 22, sepX = M + tabs.length * (B + GAP), viewX = sepX + SEP;
	const W = Math.max(viewX + B + GAP, M + MIN_ICONS * (B + GAP)) + FLEX + B + GAP + GEN_W + M, H = rowY + B + M;
	const group = new THREE.Group();
	const panel = new ui.Panel({ name: "toolbar", widthM: W / ui.PX_PER_M, heightM: H / ui.PX_PER_M, radius: RADIUS });
	group.add(panel.mesh);
	const status = panel.add(new Status());
	const sep = panel.add(new Sep({ x: sepX, y: rowY + 18, w: 2, h: B - 36 }));
	for (const b of [...tabs, view]) panel.add(Object.assign(b, { y: rowY, w: B, h: B }));
	const cancel = panel.add(new ui.Button({ icon: "x", round: true, onClick: () => client.interrupt() }));
	const generate = panel.add(new ui.Button({ text: "Generate", size: 34, variant: "accent", round: true, onClick: () => store.generate() }));
	let dock = null, vertical = false;

	function layout() {
		const boxes = dock?.(panel.width, panel.height);
		vertical = !!boxes?.vertical;
		view.visible = sep.visible = !dock;
		panel.radius = dock ? 0 : RADIUS;
		generate.text = vertical ? "" : "Generate";
		generate.icon = vertical ? "play" : null;
		if (!boxes) {
			tabs.forEach((b, i) => { b.x = M + i * (B + GAP); });
			view.x = viewX;
			Object.assign(status, { x: M + 8, y: M, w: W - 2 * M - 16, h: TIER_H });
			Object.assign(cancel, { x: W - M - GEN_W - GAP - B, y: rowY, w: B, h: B });
			Object.assign(generate, { x: W - M - GEN_W, y: rowY, w: GEN_W, h: B });
		} else {
			Object.assign(status, boxes.status);
			Object.assign(cancel, boxes.cancel);
			Object.assign(generate, boxes.generate);
		}
		panel.invalidate();
	}
	panel.onResize = layout;
	layout();

	// phones: dock(w, h) -> { status, cancel, generate: { x, y, w, h }, vertical }, the boxes at the toolbar's size (panel px), re-read
	// as it re-flows; the panel buttons must be elsewhere (phone.js's tab bar). null: back to the desk / VR row, the panel buttons
	// on it again (phone.js then calls setPx(): the world size).
	function arrange(d) {
		dock = d;
		if (!d) for (const b of tabs) if (b.panel !== panel) {
			b.panel.remove(b);
			panel.add(Object.assign(b, { y: rowY, w: B, h: B }));
		}
		layout();
	}

	// run status: the run being executed (since its first node) and the node ids of every prompt queued from here (its node count)
	let remaining = 0, run = null, last = null; // last: the status a run ended with ("Done in", "Interrupted", an error) until the next one
	let ended = null; // the id of the last run that ended: a fully cached one can end before its "queued"
	let noOutput = false; // every output muted or bypassed (desktop or Group Switch): nothing to run
	const queued = new Map();
	const runOf = (id) => run?.id === id ? run : run = { id, start: performance.now(), done: new Set(), node: null, value: 0, max: 0 };
	const nodeTitle = (id) => {
		const node = store.snapshot?.prompt[id];
		return node?._meta?.title ?? node?.class_type ?? "Running";
	};
	const doneCount = () => [...run.done].filter((id) => queued.get(run.id)?.has(id)).length;
	const progress = () => {
		const nodes = queued.get(run.id);
		return { node: run.max ? run.value / run.max : 0, total: nodes ? doneCount() / nodes.size : 0 };
	};

	// { texts (longest first: the first that fits is shown), word (landscape phones), error, time (ms), node, total }
	function state() {
		const queue = remaining > 1 ? ` · ${remaining} in queue` : "";
		if (run) {
			const title = nodeTitle(run.node), nodes = queued.get(run.id), i = nodes && Math.min(doneCount() + 1, nodes.size);
			const of = nodes ? [` · node ${i} of ${nodes.size}`, ` · node ${i}/${nodes.size}`] : ["", ""];
			const steps = `${title} ${run.value}/${run.max}`;
			const texts = run.max ? [`${title} · step ${run.value} / ${run.max}${of[0]}${queue}`, steps + of[1], steps] : [title + of[0] + queue, title + of[1], title];
			return { texts, word: "Running", time: performance.now() - run.start, ...progress() };
		}
		const ahead = queued.size ? remaining - queued.size : 0;
		if (remaining) return { texts: [ahead > 0 ? `Queued · ${ahead} ahead` : "Queued"], word: "Queued", time: 0, node: 0, total: 0 };
		if (noOutput) return { time: 0, node: 0, total: 0, ...last, texts: ["No active output"], word: "Inactive", error: false };
		return last ?? { texts: ["Ready"], word: "Ready", time: 0, node: 0, total: 0 };
	}

	function showStatus() {
		cancel.disabled = !run && !remaining;
		cancel.variant = cancel.disabled ? "default" : "danger";
		panel.invalidate();
	}
	// the timer ticks while a run executes
	setInterval(() => { if (run && Math.floor((performance.now() - run.start) / 1000) !== status.secs) status.invalidate(); }, 200);

	// a run ends with "done", which also follows an error or an interruption: that one keeps their note, the timer and bars stop
	function end(e, note) {
		if (e.detail.prompt_id === ended && !note) return;
		ended = e.detail.prompt_id;
		queued.delete(ended);
		const time = run ? performance.now() - run.start : 0;
		last = note ? { texts: [note.text], word: note.error ? "Error" : note.text, error: note.error, time, ...(run ? progress() : { node: 0, total: 0 }) }
			: { texts: ["Done in " + clock(time)], word: "Done", time, node: 1, total: 1 };
		run = null;
		remaining = Math.max(0, remaining - 1); // it left the queue; the next "status" says so too
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
		last = { texts: [e.detail.message], word: "Error", error: true, time: 0, node: 0, total: 0 };
		showStatus();
	});

	function checkOutputs() {
		noOutput = generate.disabled = !store.hasActiveOutput();
		showStatus();
	}
	store.addEventListener("load", checkOutputs);
	store.addEventListener("change", (e) => { if (e.detail.key === "switchGroups") checkOutputs(); });
	showStatus();

	return { group, panel, arrange };
}

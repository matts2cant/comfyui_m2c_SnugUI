// Toolbar: one rounded slab, the same panel in both views (on the lectern in VR, in the Desktop View's deck).
// Top tier: the run status and its timer over the node and total progress bars; bottom row: main.js's round panel buttons
// (`tabs`), a separator and the view button, then Cancel and Generate at the right. Its width follows the icon row, at least
// MIN_ICONS buttons. Phones (desktop.js calls phone(mode)): the panel buttons move to the `tabs` panel, the tab bar or rail, the
// view button hides and the toolbar re-flows to the width it is given: the status over Cancel and Generate (portrait) or beside them.
const M = 32, B = 100, GAP = 16, SEP = 18, FLEX = 40, GEN_W = 260, MIN_ICONS = 6, RADIUS = 56;
const STATUS_H = 44, NODE_BAR = 8, TOTAL_BAR = 12, TIER_H = STATUS_H + 10 + NODE_BAR + 6 + TOTAL_BAR;
const PM = 16, PB = 80, PGEN_W = 164, BAR = PB + 2 * PM; // phones: margin, button, landscape Generate width, tab bar thickness

const clock = (ms) => {
	const s = Math.floor(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function createToolbar({ THREE, store, client, ui }, tabs, view) {
	const { theme } = ui;

	// status left, timer right, then node progress (thin) over total progress; reads the run state below at draw time
	class Status extends ui.Widget {
		hitTest() { return null; }
		draw(ctx) {
			const { w } = this, s = state();
			ctx.textBaseline = "middle";
			ctx.font = `600 28px ui-monospace, Consolas, monospace`;
			ctx.fillStyle = theme.muted;
			ctx.textAlign = "right";
			this.secs = Math.floor(s.time / 1000);
			const time = clock(s.time);
			ctx.fillText(time, w, STATUS_H / 2 + 1);
			const free = w - ctx.measureText(time).width - 24;
			ctx.font = `600 28px ${theme.font}`;
			ctx.fillStyle = s.error ? theme.danger : run ? theme.fg : theme.muted;
			ctx.textAlign = "left";
			ctx.fillText(ui.ellipsize(ctx, s.texts.find((t) => ctx.measureText(t).width <= free) ?? s.texts.at(-1), free), 0, STATUS_H / 2 + 1);
			[[STATUS_H + 10, NODE_BAR, s.node, 0.55], [STATUS_H + 10 + NODE_BAR + 6, TOTAL_BAR, s.total, 1]].forEach(([y, h, t, alpha]) => {
				ctx.beginPath();
				ctx.roundRect(0, y, w, h, h / 2);
				ctx.fillStyle = theme.surface;
				ctx.fill();
				if (!t) return;
				ctx.beginPath();
				ctx.roundRect(0, y, w * Math.min(1, t), h, h / 2);
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
	const panel = new ui.Panel({ name: "toolbar", widthM: W / 1000, heightM: H / 1000, radius: RADIUS });
	group.add(panel.mesh);
	const bar = new ui.Panel({ name: "tabs", widthM: BAR / 1000, heightM: BAR / 1000, radius: 0 });
	const status = panel.add(new Status({ h: TIER_H }));
	const sep = panel.add(new Sep({ x: sepX, y: rowY + 18, w: 2, h: B - 36 }));
	for (const b of [...tabs, view]) panel.add(Object.assign(b, { y: rowY, w: B, h: B }));
	const cancel = panel.add(new ui.Button({ icon: "x", round: true, onClick: () => client.interrupt() }));
	const generate = panel.add(new ui.Button({ text: "Generate", size: 34, variant: "accent", round: true, onClick: () => store.generate() }));
	let mode = null;

	function layout() {
		const w = panel.width, h = panel.height;
		view.visible = sep.visible = !mode;
		panel.radius = mode === "portrait" ? 0 : RADIUS;
		generate.size = mode === "landscape" ? 30 : 34; // room for "Done in m:ss" beside it
		if (!mode) {
			tabs.forEach((b, i) => { b.x = M + i * (B + GAP); });
			view.x = viewX;
			Object.assign(status, { x: M + 8, y: M, w: W - 2 * M - 16 });
			Object.assign(cancel, { x: W - M - GEN_W - GAP - B, y: rowY, w: B, h: B });
			Object.assign(generate, { x: W - M - GEN_W, y: rowY, w: GEN_W, h: B });
		} else if (mode === "portrait") {
			Object.assign(status, { x: PM + 8, y: PM, w: w - 2 * PM - 16 });
			Object.assign(cancel, { x: PM, y: h - PM - PB, w: PB, h: PB });
			Object.assign(generate, { x: PM + PB + GAP, y: h - PM - PB, w: w - 2 * PM - PB - GAP, h: PB });
		} else {
			Object.assign(generate, { x: w - PM - PGEN_W, y: PM, w: PGEN_W, h: PB });
			Object.assign(cancel, { x: generate.x - GAP - PB, y: PM, w: PB, h: PB });
			Object.assign(status, { x: PM + 8, y: PM, w: cancel.x - GAP - PM - 8 });
		}
		panel.invalidate();
	}
	panel.onResize = layout;
	layout();

	// the panel buttons spread along the longer side: a tab bar, or a rail when taller than wide
	bar.onResize = () => {
		const across = bar.width >= bar.height, step = (across ? bar.width : bar.height) / tabs.length;
		tabs.forEach((b, i) => Object.assign(b, { x: across ? i * step + (step - PB) / 2 : PM, y: across ? PM : i * step + (step - PB) / 2, w: PB, h: PB }));
	};

	// mode: "portrait" | "landscape" (phones) | null (desk / VR, back at its world size through setPx()). Returns the toolbar's
	// phone height and the tab bar's thickness (panel px).
	function phone(m) {
		mode = m;
		const host = m ? bar : panel;
		for (const b of tabs) {
			if (b.panel === host) continue;
			b.panel.remove(b);
			host.add(Object.assign(b, { y: rowY, w: B, h: B }));
		}
		if (m) bar.onResize();
		layout();
		return { h: m === "portrait" ? 3 * PM + TIER_H + PB : 2 * PM + PB, bar: BAR };
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

	// { texts (longest first: the first that fits is shown), error, time (ms), node, total }
	function state() {
		const queue = remaining > 1 ? ` · ${remaining} in queue` : "";
		if (run) {
			const title = nodeTitle(run.node), nodes = queued.get(run.id), i = nodes && Math.min(doneCount() + 1, nodes.size);
			const of = nodes ? [` · node ${i} of ${nodes.size}`, ` · node ${i}/${nodes.size}`] : ["", ""];
			const steps = `${title} ${run.value}/${run.max}`;
			const texts = run.max ? [`${title} · step ${run.value} / ${run.max}${of[0]}${queue}`, steps + of[1], steps] : [title + of[0] + queue, title + of[1], title];
			return { texts, time: performance.now() - run.start, ...progress() };
		}
		const ahead = queued.size ? remaining - queued.size : 0;
		if (remaining) return { texts: [ahead > 0 ? `Queued · ${ahead} ahead` : "Queued"], time: 0, node: 0, total: 0 };
		if (noOutput) return { time: 0, node: 0, total: 0, ...last, texts: ["No active output"], error: false };
		return last ?? { texts: ["Ready"], time: 0, node: 0, total: 0 };
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
		last = note ? { texts: [note.text], error: note.error, time, ...(run ? progress() : { node: 0, total: 0 }) } : { texts: ["Done in " + clock(time)], time, node: 1, total: 1 };
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
		last = { texts: [e.detail.message], error: true, time: 0, node: 0, total: 0 };
		showStatus();
	});

	function checkOutputs() {
		noOutput = generate.disabled = !store.hasActiveOutput();
		showStatus();
	}
	store.addEventListener("load", checkOutputs);
	store.addEventListener("change", (e) => { if (e.detail.key === "switchGroups") checkOutputs(); });
	showStatus();

	return { group, panel, tabs: bar, phone };
}

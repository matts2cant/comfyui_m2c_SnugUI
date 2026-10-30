// Toolbar: one rounded slab, the same panel in both views (on the lectern in VR, in the Desktop View's deck).
// Top tier: the run status and its timer over the node and total progress bars; bottom row: main.js's round panel buttons
// (`tabs`), a separator and the view button, then Cancel and Generate at the right. Its width follows the icon row, at least
// MIN_ICONS buttons. Phones (desktop.js calls phone(mode)): the panel buttons move to the `tabs` panel, the tab bar or rail, the
// view button hides and the toolbar re-flows to the box it is given: the status over Cancel and Generate (portrait), or the run
// column (landscape): status, timer, bars, Cancel, then Generate as a tall play pill. phone(mode, true) keeps the first place of
// the run row / column free for a button of the caller's (desktop.js puts the output button there).
import { TILE_GAP, COG } from "./center.js";

const M = 32, B = 100, GAP = 16, SEP = 18, FLEX = 40, GEN_W = 260, MIN_ICONS = 6, RADIUS = 56;
const STATUS_H = 44, NODE_BAR = 8, TOTAL_BAR = 12, TIER_H = STATUS_H + 10 + NODE_BAR + 6 + TOTAL_BAR;
// phones: one grid with the output row, so the tray (the row, PM padding) lines up with the dock: margin PM = the tiles' gap, button
// PB = the cog (desktop.js gives it to the tiles too), BAR the tab bar's thickness (and the landscape run column's width)
export const PM = TILE_GAP, PB = COG, BAR = PB + 2 * PM;

const clock = (ms) => {
	const s = Math.floor(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// phones: n buttons along a side len px long, PM from both ends, the rest spread evenly between them (at least PM, the buttons
// shrink below PB when the side is too short for that): the tab bar's columns, the rail's rows and the run column's beside it.
// -> { s: button size, at(i): offset of the i-th }
function spread(len, n) {
	const s = Math.min(PB, (len - (n + 1) * PM) / n), gap = (len - 2 * PM - n * s) / (n - 1);
	return { s, at: (i) => PM + i * (s + gap) };
}

export function createToolbar({ THREE, store, client, ui }, tabs, view, onError) {
	const { theme } = ui;

	// status left, timer right, then node progress (thin) over total progress; reads the run state below at draw time. Landscape
	// phones: the status word (shrunk to the column) over the timer, then the bars side by side filling upward; a tap on "Error"
	// or its timer shows the whole message (onError).
	class Status extends ui.Widget {
		hitTest(x, y) { return mode === "landscape" && state().error && y < this.y + 2 * STATUS_H ? super.hitTest(x, y) : null; }
		onClick() { onError(state().texts[0]); }
		draw(ctx) {
			const { w } = this, s = state(), v = mode === "landscape";
			ctx.textBaseline = "middle";
			ctx.font = `600 28px ui-monospace, Consolas, monospace`;
			ctx.fillStyle = theme.muted;
			ctx.textAlign = v ? "center" : "right";
			this.secs = Math.floor(s.time / 1000);
			const time = clock(s.time);
			ctx.fillText(time, v ? w / 2 : w, v ? STATUS_H * 1.5 : STATUS_H / 2 + 1);
			const free = w - ctx.measureText(time).width - 24;
			ctx.font = `600 28px ${theme.font}`;
			ctx.fillStyle = s.error ? theme.danger : run ? theme.fg : theme.muted;
			if (v) {
				ctx.font = `600 ${Math.min(28, Math.floor(28 * w / ctx.measureText(s.word).width))}px ${theme.font}`;
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
	const bar = new ui.Panel({ name: "tabs", widthM: BAR / ui.PX_PER_M, heightM: BAR / ui.PX_PER_M, radius: 0 });
	const status = panel.add(new Status());
	const sep = panel.add(new Sep({ x: sepX, y: rowY + 18, w: 2, h: B - 36 }));
	for (const b of [...tabs, view]) panel.add(Object.assign(b, { y: rowY, w: B, h: B }));
	const cancel = panel.add(new ui.Button({ icon: "x", round: true, onClick: () => client.interrupt() }));
	const generate = panel.add(new ui.Button({ text: "Generate", size: 34, variant: "accent", round: true, onClick: () => store.generate() }));
	let mode = null, slotted = false;
	const slot = { x: 0, y: 0, s: 0 }; // phones: the free place, in panel px

	function layout() {
		const w = panel.width, h = panel.height;
		view.visible = sep.visible = !mode;
		panel.radius = mode ? 0 : RADIUS;
		generate.text = mode === "landscape" ? "" : "Generate";
		generate.icon = mode === "landscape" ? "play" : null;
		if (!mode) {
			tabs.forEach((b, i) => { b.x = M + i * (B + GAP); });
			view.x = viewX;
			Object.assign(status, { x: M + 8, y: M, w: W - 2 * M - 16, h: TIER_H });
			Object.assign(cancel, { x: W - M - GEN_W - GAP - B, y: rowY, w: B, h: B });
			Object.assign(generate, { x: W - M - GEN_W, y: rowY, w: GEN_W, h: B });
		} else if (mode === "portrait") {
			// on the tab bar's columns: Cancel over the first tab (the second, the slot over the first), Generate from the next one
			// to the last
			const n = tabs.length, { s, at } = spread(w, n), y = h - PM - s, i = slotted ? 1 : 0;
			Object.assign(status, { x: PM, y: PM, w: w - 2 * PM, h: TIER_H });
			Object.assign(slot, { x: at(0), y, s });
			Object.assign(cancel, { x: at(i), y, w: s, h: s });
			Object.assign(generate, { x: at(i + 1), y, w: at(n - 1) + s - at(i + 1), h: s });
		} else {
			// on the rail's rows: the status over all but the last three (four with the slot, on the fourth last), Cancel, then
			// Generate over the last two
			const n = tabs.length, { s, at } = spread(h, n), x = (w - s) / 2, i = slotted ? 1 : 0;
			Object.assign(status, { x: 4, y: PM, w: w - 8, h: at(n - 4 - i) + s - PM }); // the word takes all the width it can
			Object.assign(slot, { x, y: at(n - 4), s });
			Object.assign(cancel, { x, y: at(n - 3), w: s, h: s });
			Object.assign(generate, { x, y: at(n - 2), w: s, h: at(n - 1) + s - at(n - 2) });
		}
		panel.invalidate();
	}
	panel.onResize = layout;
	layout();

	// the panel buttons spread along the longer side: a tab bar, or a rail when taller than wide
	bar.onResize = () => {
		const across = bar.width >= bar.height, { s, at } = spread(across ? bar.width : bar.height, tabs.length), c = (BAR - s) / 2;
		tabs.forEach((b, i) => Object.assign(b, { x: across ? at(i) : c, y: across ? c : at(i), w: s, h: s }));
	};

	// mode: "portrait" | "landscape" (phones) | null (desk / VR, back at its world size through setPx()); withSlot: keep the slot
	// free. Returns the toolbar's thickness across the dock (portrait: height, landscape: width), the tab bar's, the margin (panel
	// px) and the slot ({ x, y, s }, panel px, kept up to date as the toolbar re-flows).
	function phone(m, withSlot = false) {
		mode = m;
		slotted = withSlot;
		const host = m ? bar : panel;
		for (const b of tabs) {
			if (b.panel === host) continue;
			b.panel.remove(b);
			host.add(Object.assign(b, { y: rowY, w: B, h: B }));
		}
		if (m) bar.onResize();
		layout();
		return { size: m === "portrait" ? 3 * PM + TIER_H + PB : BAR, bar: BAR, margin: PM, slot };
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

	return { group, panel, tabs: bar, phone };
}

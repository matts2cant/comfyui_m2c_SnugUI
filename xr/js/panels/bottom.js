// Prompt panel: the workflow name, the prompt box (it takes all the extra height), the negative prompt folded under a one-row
// header, then the seed controls on a row of their own at the bottom. Missing entries leave no empty box.
const MODES = [["fixed", "lock"], ["increment", "plus"], ["randomize", "shuffle"]];
const M = 20, GAP = 12, TOP = 60, ROW_H = 64, BTN_W = 60, FOLD_H = 52, NEG_H = 140, MIN_BOX = 140, SEED_W = 680;
const NEGATIVE_KEY = "appmode-xr.negative";

export function createBottomPanel({ THREE, store, ui }) {
	const { theme } = ui;
	const group = new THREE.Group();
	const panel = new ui.Panel({ name: "prompt", widthM: 1.8, heightM: 0.52 });
	group.add(panel.mesh);

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
	const fold = new Fold({ h: FOLD_H, onClick: () => {
		fold.open = !fold.open;
		try { localStorage.setItem(NEGATIVE_KEY, fold.open ? "open" : "closed"); } catch {}
		layout();
	} });
	try { fold.open = localStorage.getItem(NEGATIVE_KEY) === "open"; } catch {}
	let prompt = null, negative = null; // [input, TextField]
	let seedRow = null;
	let widgets = [];

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

	// the smallest height of the layout: name, a few prompt lines, the negative header, the seed row
	const minHeight = () => TOP + (prompt || negative ? MIN_BOX : 0) + (prompt && negative ? GAP + FOLD_H : 0) + 16 + (seedRow ? ROW_H + 16 : 0) + M;

	// from the panel's size: the Desktop View's window re-flows it
	function layout() {
		const W = panel.width, H = panel.height, seedY = H - M - ROW_H;
		name.w = W - 48;
		seedRow?.place(M, seedY, Math.min(SEED_W, W - 2 * M));

		// the boxes take what is left above the seed row: the negative one folded under its header, or alone
		const bottom = seedRow ? seedY - 16 : H - M;
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
		panel.invalidate();
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
	store.addEventListener("load", build);
	store.addEventListener("change", refresh);
	build();

	return { group, panel, minHeight };
}

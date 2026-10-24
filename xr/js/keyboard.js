// Text entry for in-canvas editing. One hidden, focusable textarea carries the edit: focusing it opens the
// Quest system keyboard in XR and receives physical keys on desktop. The edited TextField draws the live
// value and selection itself.

let hidden = null;
let active = null;

export const isEditing = () => active !== null;

// commit an open edit (session start/end, a press outside the edited field)
export function commit() {
	active?.finish(true);
}

// TODO: remove after keyboard experiment (kb*, kbDebug and the kbDebug label in panels/center.js)
// URL switches: kb=input|textarea, kbvis=1, kbsel=end|none|all, kbdelay=1
const query = new URLSearchParams(location.search);
const kb = { el: query.get("kb") === "input" ? "input" : "textarea", vis: query.get("kbvis") === "1", sel: query.get("kbsel") ?? "end", delay: query.get("kbdelay") === "1" };
export const kbDebug = [...query.keys()].some((k) => k.startsWith("kb")) ? { text: `kb=${kb.el} vis=${+kb.vis} sel=${kb.sel} delay=${+kb.delay}`, onChange: null } : null;
function kbReport(ta, event) {
	kbDebug.text = `kb=${kb.el} vis=${+kb.vis} sel=${kb.sel} delay=${+kb.delay} | ${event} len=${ta.value.length} sel=${ta.selectionStart}-${ta.selectionEnd}`;
	kbDebug.onChange?.();
}
const kbSelect = (ta, len) => {
	if (kb.sel === "end") ta.setSelectionRange(len, len);
	else if (kb.sel === "all") ta.select();
};

function textarea() {
	if (!hidden) {
		hidden = document.createElement(kb.el);
		if (kb.el === "input") hidden.type = "text";
		Object.assign(hidden.style, { position: "fixed", left: "0", top: "0", width: "1px", height: "1px", padding: "0", border: "0", opacity: "0.01", fontSize: "16px", pointerEvents: "none" });
		if (kb.vis) Object.assign(hidden.style, { left: "20%", top: "40%", width: "60%", height: "auto", border: "2px solid #888", background: "#fff", color: "#000", opacity: "1", fontSize: "40px" });
		// keys typed while editing must not reach page shortcuts
		for (const type of ["keydown", "keyup", "keypress"]) hidden.addEventListener(type, (e) => e.stopPropagation());
		document.body.append(hidden);
	}
	return hidden;
}

// Starts editing `initial` and returns the textarea (live value and selection). Call it from a user gesture.
// onInput(v) on every change, onSelection() when the caret or selection may have moved,
// onKey(e) before the key is handled, onDone(v) on commit (blur, Enter in a single-line field),
// onCancel() on Escape after onInput(initial) reverted the live changes.
export function editText({ initial = "", multiline = false, onInput, onSelection, onKey, onDone, onCancel }) {
	active?.finish(true);
	const ta = textarea();
	const edit = new AbortController();
	const { signal } = edit;
	let ended = false;
	const finish = (ok) => {
		if (ended) return;
		ended = true;
		active = null;
		edit.abort();
		const value = ta.value;
		ta.blur();
		if (ok) onDone?.(value);
		else {
			if (value !== initial) onInput?.(initial);
			onCancel?.();
		}
	};
	active = { finish };

	ta.value = initial;
	ta.addEventListener("input", () => { onInput?.(ta.value); onSelection(); }, { signal });
	ta.addEventListener("keyup", onSelection, { signal });
	document.addEventListener("selectionchange", onSelection, { signal });
	ta.addEventListener("keydown", (e) => {
		onKey?.(e);
		if (e.key === "Escape") finish(false);
		else if (e.key === "Enter" && (!multiline || e.ctrlKey)) { e.preventDefault(); finish(true); }
	}, { signal });
	ta.addEventListener("blur", () => finish(true), { signal });

	ta.focus();
	kbSelect(ta, initial.length);
	if (kb.delay) requestAnimationFrame(() => { if (active?.finish !== finish) return; ta.value = initial; kbSelect(ta, initial.length); kbDebug && kbReport(ta, "raf"); });
	if (kbDebug) {
		kbReport(ta, "focus");
		for (const type of ["input", "keyup"]) ta.addEventListener(type, () => kbReport(ta, type), { signal });
		document.addEventListener("selectionchange", () => kbReport(ta, "selchange"), { signal });
	}
	return ta;
}

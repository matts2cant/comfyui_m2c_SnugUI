// Text entry for in-canvas editing. A hidden textarea `ta` is the edit model: its value and selection are what the
// edited TextField draws and what clicks move. On desktop it is focused and receives physical keys.
// In XR the Quest system keyboard can only insert (it starts empty on every open and cannot delete existing text),
// so `ta` is never focused there: a second, always-empty hidden element `kb` is focused to open the keyboard and
// whatever it holds is spliced into `ta` at the caret that was set when it opened. `kb` is an <input> for single-line
// fields and a <textarea> (kbMulti) for multi-line ones, whose keyboard should offer a return key that types "\n".

let ta = null;
let kbLine = null, kbMulti = null;
let kb = null; // the one of them in use by the active edit
let active = null;
let xr = false;
let before = "", after = ""; // model text around the caret (or selection) when the keyboard opened

export const setXR = (v) => { xr = v; };

export const isEditing = () => active !== null;

// commit an open edit (session start/end, a press outside the edited field)
export function commit() {
	active?.finish(true);
}

function hiddenInput(el) {
	Object.assign(el.style, { position: "fixed", left: "0", top: "0", width: "1px", height: "1px", padding: "0", border: "0", opacity: "0.01", fontSize: "16px", pointerEvents: "none" });
	// keys typed while editing must not reach page shortcuts
	for (const type of ["keydown", "keyup", "keypress"]) el.addEventListener(type, (e) => e.stopPropagation());
	document.body.append(el);
	return el;
}

function init() {
	if (ta) return;
	ta = hiddenInput(document.createElement("textarea"));
	kbLine = hiddenInput(document.createElement("input"));
	kbLine.type = "text";
	kbMulti = hiddenInput(document.createElement("textarea"));
	for (const el of [kbLine, kbMulti]) {
		el.autocomplete = "off";
		el.addEventListener("focus", () => { el.value = ""; rebase(); });
		el.addEventListener("input", () => { if (active) splice(); });
		el.addEventListener("beforeinput", (e) => {
			if (active && !el.value && (e.inputType === "deleteContentBackward" || e.inputType === "deleteContentForward")) {
				e.preventDefault();
				erase(e.inputType === "deleteContentBackward" ? -1 : 1);
			}
		});
	}
}

function rebase() {
	before = ta.value.slice(0, ta.selectionStart);
	after = ta.value.slice(ta.selectionEnd);
}

// model = text around the caret + what the keyboard holds, caret after it
function splice() {
	const caret = before.length + kb.value.length;
	ta.value = before + kb.value + after;
	ta.setSelectionRange(caret, caret);
	ta.dispatchEvent(new Event("input"));
}

function replace(s, e, text) {
	ta.setRangeText(text, s, e, "end");
	ta.dispatchEvent(new Event("input"));
	rebase();
}

// Deletes the selection, or the character before (dir < 0) / after the caret, in the edit model.
export function erase(dir = -1) {
	if (!active) return;
	let s = ta.selectionStart, e = ta.selectionEnd;
	if (s === e) { if (dir < 0) s = Math.max(0, s - 1); else e = Math.min(ta.value.length, e + 1); }
	replace(s, e, "");
}

// Replaces the selection with a line break in the edit model (the toolbar's New line button).
export function newline() {
	if (active) replace(ta.selectionStart, ta.selectionEnd, "\n");
}

// Opens the system keyboard in XR (call it from the select handler: it needs user activation), focuses the textarea on desktop.
export function showKeyboard() {
	if (active) (xr ? kb : ta).focus();
}

// Starts editing `initial` and returns the textarea (live value and selection). Call it from a user gesture.
// onInput(v) on every change, onSelection() when the caret or selection may have moved,
// onKey(e) before the key is handled, onDone(v) on commit (desktop blur, Enter in a single-line field, commit()),
// onCancel() on Escape after onInput(initial) reverted the live changes.
export function editText({ initial = "", multiline = false, onInput, onSelection, onKey, onDone, onCancel }) {
	init();
	active?.finish(true);
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
		kb.blur();
		if (ok) onDone?.(value);
		else {
			if (value !== initial) onInput?.(initial);
			onCancel?.();
		}
	};
	active = { finish };
	kb = multiline ? kbMulti : kbLine;

	ta.value = initial;
	ta.addEventListener("input", () => { onInput?.(ta.value); onSelection(); }, { signal });
	ta.addEventListener("keyup", onSelection, { signal });
	document.addEventListener("selectionchange", onSelection, { signal });
	const keydown = (e) => {
		onKey?.(e);
		if (e.key === "Escape") finish(false);
		else if (e.key === "Enter" && (!multiline || e.ctrlKey)) { e.preventDefault(); finish(true); }
	};
	ta.addEventListener("keydown", keydown, { signal });
	// the keyboard's blur only means it was dismissed: the field stays in edit mode
	kb.addEventListener("keydown", keydown, { signal });
	ta.addEventListener("blur", () => finish(true), { signal });

	if (!xr) ta.focus();
	ta.setSelectionRange(initial.length, initial.length);
	return ta;
}

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

function textarea() {
	if (!hidden) {
		hidden = document.createElement("textarea");
		Object.assign(hidden.style, { position: "fixed", left: "0", top: "0", width: "1px", height: "1px", padding: "0", border: "0", opacity: "0.01", fontSize: "16px", pointerEvents: "none" });
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
	ta.setSelectionRange(initial.length, initial.length);
	return ta;
}

// Text entry. In an XR session with a system keyboard, a hidden DOM textarea gets focus so the Quest
// keyboard opens (the first key press replaces the text because it starts selected). Outside XR a
// centered overlay with OK / Cancel is shown. main.js calls setXRSession() on session start/end.

let session = null;
let active = null;

export function setXRSession(s) { session = s; }

function el(tag, css, parent) {
	const e = document.createElement(tag);
	Object.assign(e.style, css);
	parent?.append(e);
	return e;
}

export function editText({ initial = "", multiline = false, placeholder = "", onInput, onDone, onCancel }) {
	active?.finish(false);
	const hidden = session?.isSystemKeyboardSupported;
	let backdrop = null, ta;
	if (hidden) {
		ta = el("textarea", { position: "fixed", left: "0", top: "0", width: "1px", height: "1px", opacity: "0.01" }, document.body);
	} else {
		backdrop = el("div", { position: "fixed", inset: "0", background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }, document.body);
		const box = el("div", { background: "#161a22", border: "1px solid #323a49", borderRadius: "14px", padding: "18px", width: "min(640px, 92vw)", font: "16px system-ui, sans-serif", color: "#e8ecf2" }, backdrop);
		ta = el("textarea", { width: "100%", boxSizing: "border-box", height: multiline ? "180px" : "44px", resize: "none", background: "#0b0e13", color: "#e8ecf2", border: "1px solid #323a49", borderRadius: "8px", padding: "10px", font: "inherit" }, box);
		const row = el("div", { display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "12px" }, box);
		for (const [label, ok] of [["Cancel", false], ["OK", true]]) {
			const b = el("button", { padding: "8px 22px", border: "0", borderRadius: "8px", font: "inherit", color: "#fff", background: ok ? "#4c8dff" : "#303846", cursor: "pointer" }, row);
			b.textContent = label;
			b.onclick = () => finish(ok);
		}
	}
	ta.value = initial;
	ta.placeholder = placeholder;

	let ended = false;
	const finish = (ok) => {
		if (ended) return;
		ended = true;
		active = null;
		const value = ta.value;
		(backdrop ?? ta).remove();
		if (ok) onDone?.(value); else onCancel?.();
	};
	active = { finish };

	ta.addEventListener("input", () => onInput?.(ta.value));
	ta.addEventListener("keydown", (e) => {
		if (e.key === "Escape") finish(false);
		else if (e.key === "Enter" && (!multiline || e.ctrlKey)) { e.preventDefault(); finish(true); }
	});
	if (hidden) ta.addEventListener("blur", () => finish(true));

	ta.focus();
	ta.select();
}

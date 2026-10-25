// DOM help overlay shown when WebXR is unavailable (insecure http origin on Quest Browser, or no navigator.xr).

function el(tag, css, parent, text) {
	const e = document.createElement(tag);
	Object.assign(e.style, css);
	if (text) e.textContent = text;
	parent?.append(e);
	return e;
}

function copyText(text) {
	if (navigator.clipboard) return navigator.clipboard.writeText(text);
	const ta = el("textarea", { position: "fixed", opacity: "0" }, document.body);
	ta.value = text;
	ta.select();
	document.execCommand("copy");
	ta.remove();
}

// insecure: page is not a secure context (the common Quest case); otherwise navigator.xr is just missing
export function showHelp({ insecure }) {
	const origin = location.origin;
	const backdrop = el("div", { position: "fixed", inset: "0", background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 900, overflow: "auto" }, document.body);
	const box = el("div", { background: "#161a22", border: "1px solid #323a49", borderRadius: "16px", padding: "24px 28px", margin: "16px", width: "min(680px, 94vw)", font: "17px/1.5 system-ui, sans-serif", color: "#e8ecf2" }, backdrop);
	el("h2", { margin: "0 0 6px", fontSize: "24px" }, box, insecure ? "One-time setup for VR / AR" : "WebXR not available");
	if (!insecure) {
		el("p", { margin: "8px 0", color: "#8c96a8" }, box, "This browser does not expose WebXR. Open this page in Meta Quest Browser. You can still use the desktop preview below.");
	} else {
		el("p", { margin: "8px 0", color: "#8c96a8" }, box, "WebXR only works on secure pages, and this ComfyUI address is plain http. Tell Quest Browser to trust it once:");
		const steps = el("ol", { margin: "12px 0", paddingLeft: "24px" }, box);
		const step = (text) => el("li", { margin: "6px 0" }, steps, text);
		step("Open a new tab in Quest Browser and go to chrome://flags");
		step("Search for \"Insecure origins treated as secure\" and switch it to Enabled.");
		const li = step("Paste this address into the text box under it (use the button to copy it):");
		const row = el("div", { display: "flex", gap: "10px", margin: "8px 0 2px" }, li);
		const input = el("input", { flex: "1", minWidth: "0", background: "#0b0e13", color: "#e8ecf2", border: "1px solid #323a49", borderRadius: "8px", padding: "10px", font: "16px ui-monospace, monospace" }, row);
		input.value = origin;
		input.readOnly = true;
		input.onfocus = () => input.select();
		const copy = el("button", { padding: "8px 18px", border: "0", borderRadius: "8px", background: "#4c8dff", color: "#fff", font: "inherit", cursor: "pointer" }, row, "Copy");
		copy.onclick = async () => {
			await copyText(origin);
			copy.textContent = "Copied";
			setTimeout(() => (copy.textContent = "Copy"), 1500);
		};
		step("Tap Relaunch at the bottom of the flags page, then open this address again.");
		el("p", { margin: "8px 0", color: "#8c96a8", fontSize: "15px" }, box, "If the page does not load at all: ComfyUI must listen on the network (--listen 0.0.0.0) and the Windows firewall must allow its port.");
	}
	const close = el("button", { marginTop: "10px", padding: "10px 22px", border: "0", borderRadius: "8px", background: "#303846", color: "#e8ecf2", font: "inherit", cursor: "pointer" }, box, "Continue to desktop preview");
	close.onclick = () => backdrop.remove();
}

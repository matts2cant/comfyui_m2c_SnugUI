// ComfyUI client: websocket events, prompt queueing, previews.
const PREVIEW_IMAGE = 1;
const PREVIEW_IMAGE_WITH_METADATA = 4;
// the server only sends previews when the run asks for a method; "default"/"none" in the desktop setting still get "auto" here
const PREVIEW_METHODS = ["auto", "latent2rgb", "taesd"];

function uuid() {
	const b = crypto.getRandomValues(new Uint8Array(16));
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function errorMessage(body, fallback) {
	const err = body.error;
	let message = (typeof err === "string" ? err : err && err.message) || fallback;
	for (const [id, node] of Object.entries(body.node_errors || {})) {
		const first = node.errors && node.errors[0];
		if (!first) continue;
		message += ` - ${node.class_type} #${id}: ${first.message}`;
		if (first.details) message += ` (${first.details})`;
		break;
	}
	return message;
}

export class ComfyClient extends EventTarget {
	clientId = uuid();
	#retry = 0;
	#opened = false;
	#previewUrl = null;
	#lastDone = null;
	#queued = new Set();

	#emit(type, detail) {
		this.dispatchEvent(new CustomEvent(type, { detail }));
	}

	connect() {
		const proto = location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(`${proto}//${location.host}/ws?clientId=${this.clientId}`);
		ws.binaryType = "arraybuffer";
		ws.onopen = () => {
			this.#retry = 0;
			ws.send(JSON.stringify({ type: "feature_flags", data: { supports_preview_metadata: true } }));
			if (this.#opened) this.#emit("reconnected");
			this.#opened = true;
		};
		ws.onmessage = (e) => {
			if (typeof e.data === "string") this.#onMessage(JSON.parse(e.data));
			else this.#onBinary(e.data);
		};
		ws.onclose = () => setTimeout(() => this.connect(), Math.min(500 * 2 ** this.#retry++, 10000));
	}

	#onMessage({ type, data }) {
		switch (type) {
			case "appmode_xr_snapshot":
				this.#emit("snapshot", { id: data.id });
				break;
			case "status":
				this.#emit("status", { queueRemaining: data.status.exec_info.queue_remaining });
				break;
			case "execution_cached":
				this.#emit("cached", { nodes: data.nodes, prompt_id: data.prompt_id });
				break;
			case "executing":
				if (data.node === null) this.#done(data.prompt_id);
				else this.#emit("executing", { node: data.node, prompt_id: data.prompt_id });
				break;
			case "progress":
				this.#emit("progress", { value: data.value, max: data.max, node: data.node, prompt_id: data.prompt_id });
				break;
			case "executed":
				this.#emit("executed", { node: data.node, output: data.output, prompt_id: data.prompt_id });
				break;
			case "execution_success":
				this.#done(data.prompt_id);
				break;
			case "execution_error":
				this.#emit("error", { prompt_id: data.prompt_id, message: `${data.node_type}: ${data.exception_message}` });
				break;
			case "execution_interrupted":
				this.#emit("interrupted", { prompt_id: data.prompt_id });
				break;
		}
	}

	// the server sends both "executing" (node null) and "execution_success" at the end of a prompt; "executing" also follows an
	// error or an interruption
	#done(prompt_id) {
		if (prompt_id === this.#lastDone) return;
		this.#lastDone = prompt_id;
		this.#queued.delete(prompt_id);
		this.#emit("done", { prompt_id });
	}

	#onBinary(buf) {
		const view = new DataView(buf);
		const event = view.getUint32(0);
		let mime, bytes, prompt_id;
		if (event === PREVIEW_IMAGE) {
			mime = view.getUint32(4) === 2 ? "image/png" : "image/jpeg";
			bytes = buf.slice(8);
		} else if (event === PREVIEW_IMAGE_WITH_METADATA) {
			const metaLength = view.getUint32(4);
			const meta = JSON.parse(new TextDecoder().decode(buf.slice(8, 8 + metaLength)));
			mime = meta.image_type;
			prompt_id = meta.prompt_id;
			if (!this.#queued.has(prompt_id)) return;
			bytes = buf.slice(8 + metaLength);
		} else {
			return;
		}
		if (this.#previewUrl) URL.revokeObjectURL(this.#previewUrl);
		this.#previewUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
		this.#emit("preview", { url: this.#previewUrl, prompt_id });
	}

	async getSnapshot() {
		const res = await fetch("/appmode-xr/snapshot");
		return res.ok ? res.json() : null;
	}

	async queue(prompt, previewMethod) {
		const res = await fetch("/prompt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				prompt,
				client_id: this.clientId,
				extra_data: { preview_method: PREVIEW_METHODS.includes(previewMethod) ? previewMethod : "auto" },
			}),
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(errorMessage(body, `Queue failed (${res.status})`));
		this.#queued.add(body.prompt_id);
		return body;
	}

	interrupt() {
		return fetch("/interrupt", { method: "POST" });
	}

	viewUrl({ filename, subfolder = "", type = "output" }) {
		return `/view?${new URLSearchParams({ filename, subfolder, type })}`;
	}
}

# Agent guide

SnugUI, a personal ComfyUI custom-node package: a page served by ComfyUI to run an App-mode workflow from a phone, a desktop browser or
a Meta Quest. Follow the style rules in the ComfyUI root [AGENTS.md](../../AGENTS.md): small direct changes, hand-written
look, no new dependencies, no internet requests.

Edit only inside this package folder. Never modify the ComfyUI installation, other custom nodes, the venv or Comfy Desktop's
config.

## Layout

```
__init__.py        package entry and server: the page's routes and the snapshot store; no nodes (empty mappings), WEB_DIRECTORY = "./web"
web/snugui.js      the ComfyUI frontend extension (ComfyUI loads every .js under web/ into its UI: nothing else goes there)
xr/                the page: index.html, js/ (plain ES modules, no build step), vendor/ (three.js)
```

## Docs

- [DESIGN.md](DESIGN.md) is the source-of-truth spec: update it in the same commit as every change.
- [README.md](README.md) is the user guide: keep it in sync with user-facing behaviour, in the same commit.
- No CDN or internet at runtime: libraries are vendored in `xr/vendor/`. No dependency on other custom nodes (LoRA Manager and
  the Pixaroma Group Switch are used when present).

## Testing

NEVER use or restart the owner's running ComfyUI (Comfy Desktop, port 8000). Test in a sandbox instance started from the
ComfyUI root:

```
.venv\Scripts\python.exe main.py --port 8189 --listen 127.0.0.1 --cpu --disable-all-custom-nodes --whitelist-custom-nodes comfyui_m2c_SnugUI --user-directory <scratch>\user --output-directory <scratch>\out --input-directory <scratch>\in
```

- The snapshot lives in the ComfyUI user directory, so a sandbox with its own `--user-directory` can't touch the owner's.
- Stop only the sandbox process you started, by PID.
- Drive the page with a headless browser on a fresh profile (screenshots, `window.__snugui`); close every browser you start. Never
  screenshot the LoRA panel with the owner's LoRA library.
- Node.js for syntax checks and quick script tests: Comfy Desktop's Electron exe
  `%LOCALAPPDATA%\Programs\@comfyorgcomfyui-electron\ComfyUI.exe` run with env `ELECTRON_RUN_AS_NODE=1`. Without that variable
  it launches the Desktop app, so never run it without it.
- Headset-only behaviour (Quest Browser system keyboard, quad layers, hand tracking, grabbing) cannot be tested by agents; say so
  in reports.

## Commits

Local only, never push. Subjects like `Add ...`, `Fix ...`, `Make ...`.

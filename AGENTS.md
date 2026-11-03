# Agent guide

SnugUI, a personal ComfyUI custom-node package: a page served by ComfyUI (`/snugui`) to tweak and run an App-mode workflow from a
phone, a desktop browser or tablet (the Desktop View) or a Meta Quest 3 (WebXR). It adds no nodes.

This file is how to work on it. [DESIGN.md](DESIGN.md) is what it is: the source-of-truth spec (server routes, the snapshot
schema, the page's architecture and shared contracts, every panel's behaviour). [README.md](README.md) is the user guide. Read
this file, then the DESIGN.md sections your change touches, before writing code.

## Rules

- Follow the ComfyUI root [AGENTS.md](../../AGENTS.md) style: small direct changes, code that looks hand-written for this
  repository, sparse useful comments, no defensive boilerplate.
- Create and change files only inside this package folder. Never touch ComfyUI core, other custom nodes, the venv (no pip
  installs) or Comfy Desktop's config.
- No internet at runtime: no CDN, libraries are vendored in `app/vendor/`. No downloads.
- The page is plain ES modules: no build step, no npm, no runtime dependencies. Modern JS (Quest Browser is a recent Chromium).
- No dependency on other custom nodes: LoRA Manager and Pixaroma's Group Switch are used when the workflow has them.
- ComfyUI loads every `.js` under `web/` into its own UI: only `web/snugui.js` goes there.
- Update DESIGN.md (the spec) and README.md (user-facing behaviour) in the same commit as the change they describe.

## Layout

```
__init__.py                 package entry and server: the page's routes, the snapshot store, the parts library; no nodes, WEB_DIRECTORY = "./web"
web/snugui.js               the ComfyUI frontend extension: the SnugUI button, Alt+S, the snapshot builder
app/                        the page: index.html, js/ (hosts, panels, the ui.js canvas toolkit), prompt/ (JSON prompt schema, starter
                            parts library), vendor/ (three.js)
.claude/skills/snugui-test/ the sandbox and browser test tooling (below)
```

DESIGN.md's "File layout & ownership" says what each module owns. Where to read for a change:

- Server routes, the parts library on disk: "Server".
- What the desktop sends: "Snapshot schema", "Desktop extension".
- Any page code: "Shared contracts" first (Panel / Widget, hosts and panels, what is shared), then the host you touch: "main.js"
  (VR and the VR-like view), "Desktop View", "Phones"; "Scene layout" for VR placement; "Toolbar and icons".
- A panel: "Panels (behavior)"; the JSON prompt editor and the Library: "JSON prompt".
- ui.js helpers and conventions: "Implementation notes".

## Environment

- The owner runs ComfyUI through Comfy Desktop on port 8000, listening on the LAN, and it serves this checkout directly: page
  edits show on the owner's devices at the next reload, server edits after a ComfyUI restart (which only the owner does).
- The ComfyUI frontend is the `comfyui_frontend_package` in the venv: minified bundles in its `static/assets/` (the extension
  APIs, `settingStore-*.js`, `GraphView-*.js`, `api-*.js`). Read versions from the installation when they matter; don't pin them
  in the docs.
- LoRA Manager is `custom_nodes/comfyui-lora-manager` (routes under `/api/lm/`, same origin).
- Node.js = Comfy Desktop's Electron, `%LOCALAPPDATA%\Programs\@comfyorgcomfyui-electron\ComfyUI.exe`, always with
  `ELECTRON_RUN_AS_NODE=1`: without it, it starts the Desktop app.
- Windows, PowerShell 5.1 and Git Bash. The venv's Python is `.venv\Scripts\python.exe` in the ComfyUI root.

## Process

Features go through these steps; small fixes skip 1 and 2.

1. Grill the request with the owner until every decision is settled.
2. UI work: wireframes first, approved by the owner before any code.
3. Write a spec; implement it (or brief a sub-agent with it and review its work against the spec and DESIGN.md).
4. Test in the sandbox with the `snugui-test` skill: syntax checks, the affected views, screenshots you have looked at, no page
   errors.
5. Report what changed, what was tested and what was not (headset, real phones), and let the owner try it on the devices.
6. Commit only on the owner's OK.

## Testing

Use the `snugui-test` skill (`.claude/skills/snugui-test/SKILL.md`): a sandbox ComfyUI with every writable folder in your
scratchpad, headless Edge over CDP with phone, desktop and VR-like views, fixtures and a LoRA Manager mock. Whatever you run:

- Never use, restart or point a browser at the owner's ComfyUI on port 8000.
- A sandbox writes only to scratch: its user, output, input, models (the parts library) and temp folders. Check the parts path the
  sandbox prints before testing the Library.
- Never enable LoRA Manager in a sandbox, and never capture the owner's LoRA library or its thumbnails: they are private. The mock
  is the only LoRA source in tests.
- Stop only the processes you started, by PID; close every browser you start.
- Headset and real-phone behaviour (WebXR, controllers, hands, the Quest and iOS keyboards) is tested by the owner: say what your
  change touches there.

## Commits

- Only the session working with the owner commits, and only on the owner's OK; a sub-agent never commits.
- Local only, never push. The repository's own git identity, ending with the trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Short subjects like the history: `Add ...`, `Fix ...`, `Make ...`, `Remove ...`. One behavioural change per commit, its
  DESIGN.md and README.md updates included.
- A feature of several commits goes on a branch, merged into master on the owner's OK. Paused work stays on a named branch.
- This checkout is live on the owner's devices: edit it in place only for what the owner will test right away; otherwise work in a
  git worktree.
- Never commit screenshots, test data or scratch files.
- Pass the message as a file (`git commit -F <file>`): PowerShell splits quoted multi-line arguments.

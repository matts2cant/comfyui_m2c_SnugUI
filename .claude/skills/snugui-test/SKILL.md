---
name: snugui-test
description: Test a SnugUI change without touching the owner's ComfyUI - a sandbox ComfyUI on 127.0.0.1:8189 with every writable folder in scratch, headless Edge driven over CDP (phone, landscape, desktop and VR-like views, screenshots, taps, typing, page errors), fixture snapshots, a LoRA Manager mock and syntax checks. Use it to check any change to the SnugUI page or its server before reporting it done.
---

# Testing SnugUI

Everything runs with the ComfyUI venv's Python, from any folder. Below, `<scripts>` is this skill's `scripts/` folder and
`<scratch>` your scratchpad; the sandbox keeps everything under `<scratch>/snugui-sandbox/`.

```
H:\ComfyUI\Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe <scripts>\check.py <scratch>
H:\ComfyUI\Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe <scripts>\sandbox.py start <scratch>
H:\ComfyUI\Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe <scripts>\sandbox.py snapshot <scratch> basic
... your test script (below) ...
H:\ComfyUI\Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe <scripts>\sandbox.py stop <scratch>
```

1. `check.py`: syntax of every page module and `web/snugui.js` (Node = Comfy Desktop's Electron with `ELECTRON_RUN_AS_NODE=1`,
   set by the script), `__init__.py` and the JSON under `app/`. Run it after every edit; it needs no sandbox.
2. `sandbox.py start`: ComfyUI on port 8189 (`--port` for another; 8000 is refused), CPU only, SnugUI the only custom node, user /
   output / input / models / temp folders in scratch. It prints the parts library path: it must be under `<scratch>`. Server
   changes (`__init__.py`) need `stop` + `start`; page changes only a reload (`page.goto()`).
3. `sandbox.py snapshot <scratch> <fixture>` posts `fixtures/<fixture>.json` as the snapshot. Post it before opening pages.
   - `basic`: runs on CPU in a second (EmptyImage, ImageBlend, SaveImage + PreviewImage: two image outputs); `_prompt`,
     `_negative_prompt`, `_seed` (random) and Input tabs `Image A`, `Image B`, `Blend` (INT, FLOAT, COMBO) and `General`.
   - `lora`: a LoRA Manager node with one LoRA, for the LoRA panel; Generate fails (LoRA Manager is not loaded in the sandbox).
   Write another fixture in scratch when a test needs one (the snapshot schema is in DESIGN.md) and post it the same way.
4. Drive the page with `browser.py` from your own script in scratch (see its docstring). `Browser(scratch)` starts headless Edge
   on a fresh profile and kills it on exit; `await b.open(view)` opens a tab (`desktop` 1600x1000, `phone` 390x844 touch,
   `landscape` 844x390 touch, `vr` the VR-like view), waits for the page and installs `window.__t`. Tabs of one Browser share
   localStorage (the history, window positions); a new Browser starts clean.
5. `sandbox.py stop`, and check nothing you started is left running.

## Page API (`Page`)

- `js(expr)`: evaluate in the page (awaits promises, returns JSON values). `wait(expr)`: until it is truthy.
- `shot(name)` -> the PNG's path. Look at your screenshots: a passing script with a blank or broken screen is a failure.
- `click(x, y)`, `hover`, `tap` (touch views), `drag(x0, y0, x1, y1, touch=False)`, `wheel(x, y, dy)`, `type(text)` (into the
  focused field), `key("Enter" | "Escape" | ..., modifiers)`.
- `errors`: uncaught exceptions and `console.error` lines. Assert it is empty: an exception in a panel's draw stops the frame
  loop and the page freezes without any other sign.
- `lora_requests`: how many `/api/lm/loras/list` calls the mock answered (30 generic LoRAs, 3 pages of 12 at the default size).

`window.__t`: `panel(name)` (`prompt`, `library`, `gallery`, `right` = LoRA, `lights`, `left` = Input, `config`, `toolbar`, `tabs`
= the phone's tab bar, `center-stage`, `output-row`...), `widgets(panel)`, `find(predicate)` (the first widget of any panel),
`at(panel, x, y)` and `center(widget)` (page coordinates for `click` / `tap`, null when not shown), `tab(icon)` (the panel buttons:
`pencil`, `library-big`, `images`, `layers`, `sun`, `sliders-horizontal`, `settings`), `ui`, `store`. `window.__snugui` is the
page's ctx (`camera`, `scene`, `client`...). Examples:

```python
await page.tap(*await page.js("__t.tab('layers')"))                                         # open the LoRA panel
await page.click(*await page.js("__t.center(__t.find((w) => w.variant === 'accent' && w.round))"))  # Generate
await page.wait("__t.find((w) => w.corner === 'info')?.items.length > 0")                    # the LoRA grid has loaded
```

Generated files land in `<scratch>/snugui-sandbox/output`. In the `vr` view the camera looks at the screen and the lectern is below
it: drag vertically on an empty spot to look down at it (`key("r")` recenters).

## What this cannot test

Quest hardware (WebXR sessions, controllers, hands, grabbing, the quad layer, the Quest Browser keyboard) and real phones (iOS
Safari's keyboard and viewport, touch feel). Say which of these your change touches and leave them to the owner.

## Rules

- Never use, restart or screenshot the owner's ComfyUI on port 8000, and never point the browser at it.
- Keep LoRA Manager out of the sandbox: it would read the owner's LoRA library. The mock is the only LoRA source.
- Screenshots stay in scratch and are never committed. Send one to the owner only for a visual change they will want to see.
- Stop only the processes you started (the scripts do it by PID).

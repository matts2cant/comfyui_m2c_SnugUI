# comfyui-appmode-xr — design spec (source of truth for all agents)

Personal-use ComfyUI extension: an "Open in VR" button snapshots the current App-mode workflow; a WebXR page
served by ComfyUI (`/appmode-xr`) lets the user tweak inputs and generate from a Meta Quest 3 (standalone Quest Browser).

## Hard rules
- Only create/modify files inside `custom_nodes/comfyui-appmode-xr/`. Never touch ComfyUI core, other custom nodes,
  the venv (no pip installs), Comfy Desktop config, or `%APPDATA%`.
- No CDN / internet at runtime. Libraries are vendored in `xr/vendor/`.
- Plain ES modules, no build step, no npm deps at runtime. Modern JS (Quest Browser = recent Chromium).
- Match a hand-written style: small direct code, sparse useful comments, no defensive boilerplate.
- Only `web/appmode_xr.js` may live under `web/` (ComfyUI auto-loads EVERY .js under WEB_DIRECTORY into the main UI).
- No git commits unless your task says so.

## Environment facts
- ComfyUI v0.42.4, frontend `comfyui_frontend_package` 1.55.18 (minified bundles in
  `.venv/Lib/site-packages/comfyui_frontend_package/static/assets/`, logic in `settingStore-*.js`, `GraphView-*.js`, `api-*.js`).
- User runs ComfyUI via Comfy Desktop on port 8000 (`--listen 0.0.0.0` set by the user). Quest reaches `http://<pc-ip>:8000`.
- LoRA Manager 1.1.7 installed at `custom_nodes/comfyui-lora-manager` (routes on the same origin under `/api/lm/...`).

## File layout & ownership
```
__init__.py              server: routes + snapshot store (WEB_DIRECTORY="./web", NODE_CLASS_MAPPINGS={})
web/appmode_xr.js        desktop extension: button, Alt+V, snapshot builder
data/                    runtime data (snapshot.json) — gitignored
xr/index.html            VR page shell
xr/vendor/               three.module.js (+ three.core.js if the version splits it) — vendored three.js r17x
xr/js/main.js            bootstrap, renderer, scene, XR session (AR/VR), desktop fallback, input, layout, recenter
xr/js/ui.js              canvas-texture UI toolkit (Panel + widgets)
xr/js/keyboard.js        native-keyboard bridge (editText)
xr/js/help.js            insecure-context help screen (DOM)
xr/js/comfy.js           ComfyClient: ws, queue, interrupt, previews, snapshot fetch
xr/js/state.js           store: snapshot model, values, seeds, loras, buildPrompt, generate
xr/js/rules.js           placement rule table
xr/js/panels/center.js   image display, progress, batch grid, history strip, top status bar
xr/js/panels/bottom.js   prompt chips, seed, generate/cancel
xr/js/panels/left.js     settings controls
xr/js/panels/right.js    LoRA panel(s) + LoRA Manager API client
```

## Server (`__init__.py`)
- `GET /appmode-xr` → `xr/index.html` (Cache-Control: no-cache). `GET /appmode-xr/static/{path}` → files under `xr/`
  (no-cache, correct JS MIME `text/javascript`, path containment enforced).
- `POST /appmode-xr/snapshot` body = Snapshot JSON (object). Server adds `id` (uuid4 hex) and `created` (ms), writes
  `data/snapshot.json`, keeps it in memory, broadcasts `PromptServer.instance.send_sync("appmode_xr_snapshot", {"id": id})`
  (no sid → all sockets). Returns `{"id": id}`.
- `GET /appmode-xr/snapshot` → current snapshot JSON or 404 `{"error": "no snapshot"}`. Loaded from disk at import if present.
- Routes registered with `PromptServer.instance.routes` at import time. Security = ComfyUI's own (same origin).

## Snapshot schema (built by `web/appmode_xr.js`)
```js
{
  version: 1, id, created,            // id/created set by server
  workflowName: "my_app",              // activeWorkflow filename without extension
  prompt: { "<nodeId>": { class_type, inputs: {...}, _meta } },   // app.graphToPrompt().output
  inputs: [ {                          // one per extra.linearData.inputs entry, in App-mode order
    key: "<nodeId>:<widgetName>",      // App-mode widget: nodeId = node id in the root graph (a subgraph node for promoted widgets)
    nodeId: "5", classType: "KSampler", nodeTitle: "KSampler",   // nodeId/classType/widget = FIRST target (the host node if none)
    widget: "seed", label: "seed",     // widget = prompt input name; label = App-mode widget label/name
    targets: [ {nodeId: "260:310", input: "seed", classType: "KSampler"} ],  // every prompt input the widget feeds
    type: "INT"|"FLOAT"|"BOOLEAN"|"STRING"|"COMBO"|"IMAGE"|"PIXAROMA_SIZES"|"UNSUPPORTED",   // from the first target's /object_info spec; IMAGE = combo with image_upload (LoadImage); PIXAROMA_SIZES = Pixaroma Sizes state object
    multiline: false,                  // STRING only
    options: [...],                    // COMBO/IMAGE values
    min, max, step, round,             // numbers (from /object_info input spec or widget.options)
    value,                             // current value
    control: "fixed"|"randomize"|"increment"|"decrement"|null   // linked control_after_generate value, if any
  } ],
  outputs: ["9"],                      // extra.linearData.outputs as API node ids
  loraNodes: [ {                       // every LoRA Manager node with LoRA support in the prompt:
    nodeId, classType, title,          // "Lora Loader (LoraManager)", "Lora Stacker (LoraManager)", "WanVideo Lora Select (LoraManager)"
    text: "<lora:a:0.6>",              // prompt[nodeId].inputs.text
    loras: [ {name, strength, clipStrength, active} ],  // from prompt inputs.loras (either {__value__:[..]} or list)
    lorasWrapped: true                 // whether inputs.loras was {__value__: ...}
  } ]
}
```
App mode facts: `app.rootGraph.extra.linearData = {inputs: [[widgetId, widgetName, {height?}?]...], outputs: [nodeId...]}`.
Canonical widgetId = `${rootGraph.id}:${encodeURIComponent(nodeId)}:${encodeURIComponent(widgetName)}`, legacy form
`[nodeId, widgetName]`; duplicate names get `#1` suffix.
Subgraphs: the API prompt is flattened (ids like `260:12`, nested `a:b:c`), so widgets on a subgraph node are resolved empirically: the
builder sets a unique sentinel on each, calls `graphToPrompt()` once, scans the prompt for it (`targets`, one widget may feed several
inner nodes), then restores every value. Plain node widgets map straight to their own prompt input. An input with no targets is type
UNSUPPORTED and read-only (left panel shows "edit on desktop"); `buildPrompt` writes each value to all of its targets.
An object widget whose node serializes it elsewhere (Pixaroma `sizes_ui` -> hidden JSON-string input `SizesState`, injected by the node's
own graphToPrompt hook) resolves to the string input that parses to an object sharing a key with the widget value: the target gets
`json: true`, the snapshot value is that parsed object, and `buildPrompt` writes `JSON.stringify(value)` back. Only `PixaromaSizes:sizes_ui`
gets a dedicated type (`PIXAROMA_SIZES`: left-panel size picker, in the size group); other JSON widgets are UNSUPPORTED text edits.

## Desktop extension (`web/appmode_xr.js`)
- `app.registerExtension({ name: "AppModeXR", commands: [{id:"AppModeXR.Open", label:"Open in VR", icon, function}],
  keybindings: [{combo:{key:"v", alt:true}, commandId:"AppModeXR.Open"}], actionBarButtons: [{icon, label:"Open in VR", tooltip, onClick}] })`.
- On run: if workflow has no `extra.linearData.inputs` → toast "Configure App mode first". Else build snapshot, POST, then
  `window.open("/appmode-xr", "appmode-xr")`. Toast success/error via `app.extensionManager.toast`.

## VR page architecture
### Shared contracts (implement exactly; panels depend on them)
`ui.js`:
```js
export const theme = { bg, panel, fg, muted, accent, danger, font: "system-ui, sans-serif", radius: 18 }
export class Panel {                // a canvas-textured plane
  constructor({ name, widthM, heightM, pxPerM = 1000 })   // canvas = round(widthM*pxPerM) x round(heightM*pxPerM), max 2048
  mesh                              // THREE.Mesh, add to scene/group; mesh.userData.panel = this
  canvas; ctx; width; height        // canvas px
  add(widget) / remove(widget) / clear()
  invalidate()                      // redraw before next frame (Panel.updateAll() called by main each frame)
  pointer(type, x, y, pointerId)    // type: "move"|"down"|"up"|"leave"; x,y canvas px; routed to widgets (capture on down)
  scroll(dy, x, y)                  // thumbstick/wheel; routed to the scrollable widget under (x,y)
}
export class Widget { x=0; y=0; w=0; h=0; visible=true; panel; draw(ctx){}; contains(x,y);
  onDown(p){}; onMove(p){}; onUp(p){}; onClick(p){}; onScroll(dy){ return false } ; invalidate() }
// Built-ins (constructor takes one options object; all have x,y,w,h):
Label{text, size, color, align, wrap}, Button{text, onClick, variant:"default"|"accent"|"danger", toggled},
Toggle{label, value, onChange}, Slider{label, min, max, step, value, onChange, format} (drag + −/+ buttons; tapping the value edits it in place via an embedded TextField, "," ok, clamped + rounded to step),
List{items:[{label, value, sub?}], selected, onSelect, rowH} (scrollable),
TextField{value, placeholder, multiline, onInput, onDone, onCancel, onEdit, onKey},
Combo{options:[{label, value, url?}], current, rows, onChange} (TextField + dropdown List), ImageGrid{items:[{url, label, value}], onSelect, cell} (scrollable, cached image loading),
ScrollView{children} (vertical scroll container), helper `stackY(widgets, {x, y, w, gap}) -> nextY`.
export function loadImage(url) -> Promise<HTMLImageElement>  // cached
```
`keyboard.js`: `export function editText({ initial, multiline, onInput(v), onSelection(), onDone(v), onCancel() }) -> textarea`,
plus `commit()` and `isEditing()`. Editing is always in place: one hidden, focusable in-DOM `<textarea>` (Quest system keyboard in
XR, physical keys on desktop) is focused synchronously from the click; the caret starts at the end. A TextField tap calls editText and
draws the textarea's live value, blinking caret and selection itself (auto-scrolled to the caret); a tap inside it moves the caret.
`input` → onInput; commit (onDone) on blur, Enter in a single-line field, `commit()`; Escape reverts (onInput(initial), onCancel).
main.js commits when a press lands away from every TextField (on release) and keeps the textarea focused on canvas mousedown.
Only one edit at a time.

`comfy.js`:
```js
export class ComfyClient extends EventTarget {
  clientId                          // random uuid, used for /ws?clientId= and prompt client_id
  connect()                         // reconnects with backoff
  getSnapshot() -> snapshot|null    // GET /appmode-xr/snapshot
  queue(prompt) -> {prompt_id, node_errors}   // POST /prompt {prompt, client_id}; throws Error(message) on 4xx with node_errors summary
  interrupt()                       // POST /interrupt
  viewUrl({filename, subfolder, type})
  objectInfo(classType)             // cached GET /object_info/{class}
  // events (CustomEvent detail): "snapshot" {id} | "status" {queueRemaining} | "executing" {node, prompt_id}
  // | "progress" {value, max, node, prompt_id} | "preview" {url (blob URL), prompt_id?} | "executed" {node, output, prompt_id}
  // | "done" {prompt_id} (executing with node null / execution_success) | "error" {prompt_id, message} | "interrupted" {prompt_id}
}
```
Binary ws frames: uint32 BE event type; 1 = PREVIEW_IMAGE (next uint32 BE image type 1=jpeg 2=png, then bytes);
4 = PREVIEW_IMAGE_WITH_METADATA (uint32 BE metadata length, JSON metadata incl. prompt_id, then image bytes). See `server.py`/`protocol.py`.

`state.js`:
```js
export const store  // EventTarget-based singleton
store.snapshot; store.client         // set by main
store.load(snapshot)                 // resets values from snapshot, seeds, loras; dispatches "load"
store.inputs                         // snapshot.inputs
store.get(key) / store.set(key, v)   // dispatches "change" {key}
store.seedMode(key) / setSeedMode(key, "fixed"|"randomize"|"increment")
store.randomizeSeed(key)
store.loras(nodeId) -> [{name,strength,clipStrength,active}] / setLoras(nodeId, list)  // "change" {key:"lora:"+nodeId}
store.buildPrompt() -> deep-cloned API prompt with all values + lora text/loras applied
store.generate()                     // dispatches "generate"; apply seed modes BEFORE queue (randomize: random int in [min, min(max, 2^53-1)];
                                     // increment: +1), dispatch "change", queue(buildPrompt()); dispatches "queued" {prompt_id}; "error" {message}
store.groups                         // from rules.js classify(): { prompts: [input], seeds: [input], left: [input], lora: [loraNode] }
```
LoRA write-back must mirror LoRA Manager: `inputs.loras` = list (wrapped as `{__value__: list}` if lorasWrapped) and
`inputs.text` regenerated the way `web/comfyui/lora_syntax_utils.js` (`applyLoraValuesToText`) does in comfyui-lora-manager.

`rules.js` — `classify(inputs, loraNodes)`, ordered rules, first match wins:
1. input on a LoRA Manager node (classType contains "LoraManager") → hidden (handled by right panel via loraNodes)
2. STRING && multiline → prompts (bottom)
3. INT && (widget is "seed"/"noise_seed" or contains "seed" or control != null) → seeds (bottom)
4. everything else → left, in App-mode order (no re-sorting; left.js renders store.groups.left as given).

### Scene layout (meters, relative to the `ui` group, which recenter() places at head position + yaw, y = head height)
- center image: 1.3 m wide (aspect from image), at (0, 0.05, -1.7); top status bar just above it; history strip just below it.
- bottom panel: 1.6 x 0.5 m at (0, -0.55, -1.2), tilted back ~30° to face the eye.
- left panel: 0.85 x 1.15 m, at distance 1.4 m, yaw +40° (to the left), facing user.
- right panel: 0.85 x 1.15 m, at distance 1.4 m, yaw -40°, facing user.
Each panel module exports `export function createXPanel(ctx) -> { group: THREE.Object3D, update(dt) }` where
`ctx = { THREE, store, client, ui, scene, renderer, xr: { isPresenting(), mode() /* "ar"|"vr"|"desktop" */, toggleMode() } }`.
main.js positions the returned group per the layout above (panel modules build their content at the group origin, facing +z).

### main.js
- On load: if `!window.isSecureContext || !navigator.xr` (and not desktop dev) → still render the desktop 3D view but show help.js overlay
  explaining how to enable WebXR on Quest Browser: `chrome://flags` → "Insecure origins treated as secure" → add
  `http://<location.host>` (prefilled, copyable) → Enabled → Relaunch; plus reminder that ComfyUI must listen on the LAN.
  Only show the help on Quest/XR-capable UA or when navigator.xr is missing; dismissible.
- Buttons (DOM, 2D): "Enter AR" (passthrough, default when `isSessionSupported('immersive-ar')`) and "Enter VR".
  requestSession inside the click handler; optionalFeatures: ['local-floor', 'hand-tracking', 'layers']. In AR clear alpha 0;
  in VR show a dark room (simple floor grid + dim gradient). An in-XR toggle (center status bar) ends the session and
  starts the other mode (needs a user gesture: trigger select counts).
- `renderer.xr.setFramebufferScaleFactor(1.5)`, `setFoveation(0)`, antialias on.
- Input: for each XR input source (controllers and hands via targetRaySpace), draw a thin ray + cursor dot; raycast panel meshes;
  convert uv → canvas px → `panel.pointer(...)`. select start/end = down/up. Thumbstick Y → `panel.scroll`. Squeeze on left hand
  (grip) → recenter(). Request 'hand-tracking' so hands appear as input sources (pinch = select).
- Desktop fallback (no XR session): same scene, mouse drag to look around (yaw/pitch), wheel = scroll on hovered panel,
  mouse click = pointer events. This is the dev/test mode.
- Each frame: `Panel.updateAll()`, panels' `update(dt)`.
- Snapshot: on start `client.getSnapshot()` → `store.load()`; if none, show "Send a workflow from ComfyUI (Open in VR / Alt+V)"
  in the center. On client "snapshot" event → fetch + `store.load()` (image history is kept).

### Panels (behavior)
- center: shows the latest image (fit, keep aspect) — XR quad layer for crispness when `layers` granted (hole-punch so the
  projection layer doesn't cover it; toggle "HD layer" in status bar to fall back to a mesh), mesh texture otherwise. Live
  previews from "preview" events while running; progress bar (value/max) + queue remaining in the status bar; batch results
  as a grid; history strip (session list, also persisted to localStorage, last 50) — tap thumbnail to show it.
  Status bar: workflow name, progress, AR/VR toggle, HD toggle. Only images from `executed` events whose node is in
  snapshot.outputs (or any node if outputs is empty) and whose items are images (png/jpg/jpeg/webp).
- bottom: one row per prompt input: label + a plain multi-line TextField box (full prompt, word-wrapped, clipped with "…";
  placeholder "Tap to edit prompt"); tap edits in place (multiline TextField, live onInput) and store.set the whole text.
  Seed row per seed input: value, 🎲 randomize-now, mode toggle fixed/randomize/increment. Big Generate button,
  Cancel (interrupt) button, queued/running indicator.
- left: scrollable list of controls from store.groups.left: COMBO / IMAGE → Combo (in-place text edit with a filtered dropdown List over the
  panel; IMAGE rows carry thumbnails from `/view?filename=..&type=input&subfolder=..` – option strings may contain "subfolder/name");
  INT/FLOAT → Slider (respect min/max/step; when the range is huge use −/+ only with fine/coarse steps); BOOLEAN → Toggle;
  STRING single-line → TextField; UNSUPPORTED type with targets → TextField on the value as text (JSON for objects), converted back to the
  original value's type on commit; state.js writes such a value into the prompt only after it was edited. Inputs without targets are read-only.
- right: one section per loraNode (tabs if more than one). Stack list: name, active toggle, strength −/+ (step 0.05), expandable
  clip strength, remove ×. Library: search TextField (live onInput → debounced 250 ms autocomplete suggestions from
  `GET /api/lm/loras/list?search=<q>&page_size=8&sort_by=name`) + ImageGrid of results (page_size 12, paging buttons, thumbnails from
  item.preview_url; videos → use no-preview `/loras_static/images/no-preview.png`). Selecting adds `{name: item.file_name,
  strength: usage_tips.strength ?? 1, clipStrength: usage_tips.clip_strength ?? strength, active: true}` (dedupe by name).

## Implementation notes (wave 1, binding for wave 2)
- ui.js: `Widget.draw(ctx)` is called with ctx translated to the widget's top-left → draw in local coords. Wrapping
  Labels compute their own `h` in `relayout()` (stackY calls it after setting w). `stackY` returns next y incl. trailing gap.
  Subclasses set option defaults via `super({...defaults, ...opts})`, not class fields. Extras: Button `disabled`, Slider
  `drag:false`/`bigStep`, Panel `bg:null`, `Label.setText`, `List/ImageGrid.setItems`, `setRenderer`.
- ctx also has `camera`; `window.__xr = ctx` for debugging. main calls `keyboard.commit()` on XR session start/end.
- comfy.js: `objectInfo(class)` resolves to the class entry; client sends feature_flags supports_preview_metadata (previews carry prompt_id).
- state.js: exports `applyLorasToText`; `setSeedMode` also accepts "decrement". LoRA names are written as stored (no basename rewrite).
- Desktop snapshot POST goes to `/api/appmode-xr/snapshot` (ComfyUI mirrors routes under /api).
- Wave-2 panel agents: edit ONLY your panel file. Need a new widget? Define it in your panel file. Found a bug in a shared
  file? Don't fix it — report it (file, line, fix) in your final report.

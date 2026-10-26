# AppMode XR — design spec (source of truth for all agents)

Personal-use ComfyUI extension: an "Open in VR" button snapshots the current App-mode workflow; a WebXR page
served by ComfyUI (`/appmode-xr`) lets the user tweak inputs and generate from a Meta Quest 3 (standalone Quest Browser).

## Hard rules
- Only create/modify files inside `custom_nodes/ComfyUI_matts2cant/`. Never touch ComfyUI core, other custom nodes,
  the venv (no pip installs), Comfy Desktop config, or `%APPDATA%`.
- No CDN / internet at runtime. Libraries are vendored in `xr/vendor/`.
- Plain ES modules, no build step, no npm deps at runtime. Modern JS (Quest Browser = recent Chromium).
- Match a hand-written style: small direct code, sparse useful comments, no defensive boilerplate.
- Only `../web/appmode_xr.js` (package-level `web/`) may hold this feature's frontend code (ComfyUI auto-loads EVERY .js under WEB_DIRECTORY into the main UI).
- No git commits unless your task says so.

## Environment facts
- ComfyUI v0.42.4, frontend `comfyui_frontend_package` 1.55.18 (minified bundles in
  `.venv/Lib/site-packages/comfyui_frontend_package/static/assets/`, logic in `settingStore-*.js`, `GraphView-*.js`, `api-*.js`).
- User runs ComfyUI via Comfy Desktop on port 8000 (`--listen 0.0.0.0` set by the user). Quest reaches `http://<pc-ip>:8000`.
- LoRA Manager 1.1.7 installed at `custom_nodes/comfyui-lora-manager` (routes on the same origin under `/api/lm/...`).

## File layout & ownership
```
__init__.py              server: routes + snapshot store (NODE_CLASS_MAPPINGS={}); paths below are relative to `appmode_xr/`
../web/appmode_xr.js     desktop extension (package-level web/): button, Alt+V, snapshot builder
xr/index.html            VR page shell
xr/vendor/               three.module.js — vendored three.js r170; GLTFLoader.js — its examples/jsm GLTFLoader (esm.sh build of
                         three@0.170.0 with BufferGeometryUtils inlined, copied from ComfyUI-Pixaroma, imports rewritten to "three"); both under three.LICENSE (MIT)
xr/js/main.js            bootstrap, renderer, scene, VR session, desktop fallback, input, layout, recenter
xr/js/ui.js              canvas-texture UI toolkit (Panel + widgets)
xr/js/icons.js           Lucide icons (ISC licence in its header) as Path2D, keyed by Lucide name
xr/js/model.js           3D model on the stage: GLB/glTF loading, fit + placement, lights, turn / zoom / grab, disposal
xr/js/keyboard.js        text-edit model + Quest system keyboard bridge (editText)
xr/js/help.js            insecure-context help screen (DOM)
xr/js/comfy.js           ComfyClient: ws, queue, interrupt, previews, snapshot fetch
xr/js/state.js           store: snapshot model, values, seeds, loras, buildPrompt, generate
xr/js/rules.js           placement rule table
xr/js/panels/center.js   image / 3D model display, output tiles, output-type panel, gallery side panel
xr/js/panels/bottom.js   prompt panel: workflow name, prompt / negative prompt boxes, seed row, progress bar (run status), generate/cancel
xr/js/panels/left.js     Configuration side panel: settings controls
xr/js/panels/right.js    LoRA side panel(s) + LoRA Manager API client
xr/js/panels/lights.js   Light side panel: presets for the model's lights, PMREM environments, the room (grid + gradient sphere)
```

## Server (`__init__.py`)
- `GET /appmode-xr` → `xr/index.html` (Cache-Control: no-cache). `GET /appmode-xr/static/{path}` → files under `xr/`
  (no-cache, correct JS MIME `text/javascript`, path containment enforced).
- `POST /appmode-xr/snapshot` body = Snapshot JSON (object). Server adds `id` (uuid4 hex) and `created` (ms), writes
  `<ComfyUI user directory>/appmode_xr/snapshot.json` (a sandbox with its own `--user-directory` never touches the real one), keeps it in memory, broadcasts `PromptServer.instance.send_sync("appmode_xr_snapshot", {"id": id})`
  (no sid → all sockets). Returns `{"id": id}`.
- `GET /appmode-xr/snapshot` → current snapshot JSON or 404 `{"error": "no snapshot"}`. Loaded from disk at import if present.
- Routes registered with `PromptServer.instance.routes` at import time. Security = ComfyUI's own (same origin).

## Snapshot schema (built by `../web/appmode_xr.js`)
```js
{
  version: 1, id, created,            // id/created set by server
  workflowName: "my_app",              // activeWorkflow filename without extension
  prompt: { "<nodeId>": { class_type, inputs: {...}, _meta } },   // app.graphToPrompt().output
  previewMethod: "default",            // setting "Comfy.Execution.PreviewMethod": default|none|auto|latent2rgb|taesd
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
  outputs: [ {                         // one per extra.linearData.outputs entry
    nodeId: "9", title: "Save Image",  // API node id, prompt _meta.title
    kind: "image"|"3d"                 // "3d" when the node's class has a MESH / FILE_3D* input (Save 3D Model, Preview 3D...)
  } ],                                 // older snapshots hold bare id strings: state.js reads them as image outputs
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
UNSUPPORTED and read-only (the Configuration panel shows "edit on desktop"), as is an entry whose widget is not found on its node; `buildPrompt` writes each value to all of its targets.
An object widget whose node serializes it elsewhere (Pixaroma `sizes_ui` -> hidden JSON-string input `SizesState`, injected by the node's
own graphToPrompt hook) resolves to the string input that parses to an object sharing a key with the widget value: the target gets
`json: true`, the snapshot value is that parsed object, and `buildPrompt` writes `JSON.stringify(value)` back. Only `PixaromaSizes:sizes_ui`
gets a dedicated type (`PIXAROMA_SIZES`: left-panel size picker, in the size group); other JSON widgets are UNSUPPORTED text edits.

## Desktop extension (`../web/appmode_xr.js`)
- `app.registerExtension({ name: "AppModeXR", commands: [{id:"AppModeXR.Open", label:"Open in VR", icon, function}],
  keybindings: [{combo:{key:"v", alt:true}, commandId:"AppModeXR.Open"}], actionBarButtons: [{icon, label:"Open in VR", tooltip, onClick}] })`.
- On run: if workflow has no `extra.linearData.inputs` → toast "Configure App mode first". Else `window.open("/appmode-xr",
  "appmode-xr")` first (before any await, for the popup blocker), then build the snapshot and POST it. Toast success/error via `app.extensionManager.toast`.

## VR page architecture
### Shared contracts (implement exactly; panels depend on them)
`ui.js`:
```js
export const theme = { bg, panel, surface, surfaceHi, border, fg, muted, accent, danger, pressed, hover, font: "system-ui, sans-serif", radius: 18 }
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
Label{text, size, color, align, wrap}, Button{text, icon, round, onClick, variant:"default"|"accent"|"danger", toggled} (icon: an icons.js
  name, centered alone or left of the text, stroked in the text colour; round: circle / pill),
Toggle{label, value, onChange}, Slider{label, min, max, step, value, onChange, format} (drag + −/+ buttons; tapping the value edits it in place via an embedded TextField, "," ok, clamped + rounded to step),
List{items:[{label, value, sub?}], selected, onSelect, rowH} (scrollable),
TextField{value, placeholder, multiline, onInput, onDone, onCancel, onEdit, onKey, compact, barAbove} (+ EditBar, its edit toolbar),
Combo{options:[{label, value, url?}], current, rows, onChange} (TextField + dropdown List), ImageGrid{items:[{url, label, value}], onSelect, cell} (scrollable),
ScrollView{children} (vertical scroll container), helper `stackY(widgets, {x, y, w, gap}) -> nextY`.
List/ImageGrid thumbnails (`url`) load through a module-level image cache.
```
`keyboard.js`: `export function editText({ initial, multiline, onInput(v), onSelection(), onKey(e), onDone(v), onCancel() }) -> textarea`,
plus `commit()`, `isEditing()`, `setXR(bool)`, `showKeyboard()` and `erase(dir)`. A hidden in-DOM `<textarea>` `ta` is the edit MODEL: its value and
selection are what the TextField draws and what taps move (selection APIs work on an unfocused textarea; never use `ta.select()`, it focuses).
Desktop (`setXR(false)`): `ta` is focused at edit start and takes physical keys; blur, Enter in a single-line field and `commit()` commit
(onDone), Escape reverts (onInput(initial), onCancel).
XR (main.js calls `setXR` on session start/end): the Quest system keyboard can only insert (each open starts an empty session whose first
key overwrites the focused element's value, existing text is not shown, backspace cannot delete existing text, and while it is up the
session is `visible-blurred` with no controller input). So `ta` is never focused; a second always-empty hidden `<input>` `kb` is focused by
`showKeyboard()` (the toolbar's Keyboard button, from its select handler for user activation). On kb focus the model text around the caret
or selection is captured (before/after); each kb `input` sets `ta.value = before + kb.value + after` with the caret after the typed text and
fires onInput. A kb `beforeinput` delete with an empty kb is applied to the model by `erase` (selection, or one character) and cancelled.
kb blur (keyboard dismissed) does not commit: the field stays in edit mode. Enter on kb commits single-line fields (a multiline field gets a
newline); the Quest keyboard's confirm key is assumed to arrive as keydown Enter (unverified).
TextField edit UX: the first tap enters edit mode with the caret at the tap (no keyboard yet); taps move the caret, dragging selects
(down anchors, move extends), a second tap within 400 ms selects the word. While editing, an `EditBar` overlays the panel below the field
(above when there is no room or `barAbove`): Keyboard, Del, <-, ->, Select all, Done; `compact` (Slider value, Combo filter) is Keyboard,
Del, Done. A Combo's dropdown goes below its bar (above the field when it does not fit). main.js commits when a press lands away from every
TextField and EditBar (on release). Only one edit at a time.

`comfy.js`:
```js
export class ComfyClient extends EventTarget {
  clientId                          // random uuid, used for /ws?clientId= and prompt client_id
  connect()                         // reconnects with backoff
  getSnapshot() -> snapshot|null    // GET /appmode-xr/snapshot
  queue(prompt, previewMethod) -> {prompt_id, node_errors}   // POST /prompt {prompt, client_id, extra_data: {preview_method}}; throws Error(message) on 4xx with node_errors summary
  interrupt()                       // POST /interrupt
  viewUrl({filename, subfolder, type})
  // events (CustomEvent detail): "snapshot" {id} | "status" {queueRemaining} | "executing" {node, prompt_id}
  // | "progress" {value, max, node, prompt_id} | "preview" {url (blob URL), prompt_id?} | "executed" {node, output, prompt_id}
  // | "done" {prompt_id} (executing with node null / execution_success) | "error" {prompt_id, message} | "interrupted" {prompt_id}
}
```
Binary ws frames: uint32 BE event type; 1 = PREVIEW_IMAGE (next uint32 BE image type 1=jpeg 2=png, then bytes);
4 = PREVIEW_IMAGE_WITH_METADATA (uint32 BE metadata length, JSON metadata incl. prompt_id and image_type (mime), then image bytes). See `server.py`/`protocol.py`.
Live previews: the server only sends them when the run's `extra_data.preview_method` names a method (execution.py `set_preview_method`; the
server default here is none). `queue()` sends the snapshot's `previewMethod` when it is auto/latent2rgb/taesd, otherwise "auto" (previews are
always wanted in VR). Previews are sent to the queueing client's socket only; the client drops type 4 frames whose prompt_id it did not queue.
Type 2 (UNENCODED_PREVIEW_IMAGE) is encoded server-side into type 1 and type 1 is only sent to clients without `supports_preview_metadata`
(this client sets it), so in practice only type 4 arrives; type 1 is still parsed (no prompt_id).

`state.js`:
```js
export const store  // EventTarget-based singleton
store.snapshot; store.client         // set by main
store.load(snapshot)                 // resets values from snapshot, seeds, loras; dispatches "load"
store.inputs                         // snapshot.inputs
store.outputs                        // snapshot.outputs as {nodeId, title, kind} (bare ids -> kind "image", title from the prompt)
store.get(key) / store.set(key, v)   // dispatches "change" {key}
store.seedMode(key) / setSeedMode(key, "fixed"|"randomize"|"increment")
store.randomizeSeed(key)
store.loras(nodeId) -> [{name,strength,clipStrength,active}] / setLoras(nodeId, list)  // "change" {key:"lora:"+nodeId}
store.buildPrompt() -> deep-cloned API prompt with all values + lora text/loras applied
store.generate()                     // dispatches "generate"; apply seed modes BEFORE queue (randomize: random int in [min, min(max, 2^53-1)];
                                     // increment: +1), dispatch "change", queue(buildPrompt()); dispatches "queued" {prompt_id}; "error" {message}
store.groups                         // from rules.js classify(): { prompt: input|null, negative: input|null, seed: input|null, left: [input], lora: [loraNode] }
```
LoRA write-back must mirror LoRA Manager: `inputs.loras` = list (wrapped as `{__value__: list}` if lorasWrapped) and
`inputs.text` regenerated the way `web/comfyui/lora_syntax_utils.js` (`applyLoraValuesToText`) does in comfyui-lora-manager.

`rules.js` — `classify(inputs, loraNodes)`, ordered rules, first match wins:
1. input on a LoRA Manager node (classType contains "LoraManager") → hidden (handled by the LoRA panel via loraNodes)
2. the prompt panel takes only these exact App-mode names and types, one of each; if a name appears twice the first in App-mode order
   wins and the others go to the left panel:
   - `_prompt` with type STRING → `prompt`
   - `_negative_prompt` with type STRING → `negative`
   - `_seed` with type INT → `seed`
3. everything else → left, in App-mode order (no re-sorting; left.js renders store.groups.left as given). This includes multiline
   STRINGs and seed-like INTs with other names, and a `_prompt` / `_negative_prompt` / `_seed` of the wrong type.

The name is the App-mode label compared after trimming, exactly (case-sensitive). A leading `[Tab]` prefix is NOT stripped for this
match, so `[Tab] _prompt` is just an input called `_prompt` in the left panel's tab `Tab`. Nothing else decides the placement: not the
widget name, the multiline flag, the node title or `control`. Existing workflows need these names set in App mode.

Each input is also copied with its name parsed: a leading `[Tab] Label` (whitespace trimmed, both parts non-empty) gives
`tab: "Tab"` and the bracket-free `label`; any other name gets `tab: "General"`. The groups hold these copies, so the left panel shows
stripped labels (the snapshot and `store.inputs` keep the raw name; `key` is unchanged).

### Scene layout (meters, relative to the `ui` group, which recenter() places at head position + yaw, y = head height)
- Screen: on the vertical plane z = -0.5 (`SCREEN_DISTANCE`, eye at the origin), 32" diagonal at the aspect of what it shows (image;
  half width per eye in stereo; 16:9 when empty), centered at eye level; it resizes only when that aspect changes (center.js ->
  `screen.onResize`). A 3D output keeps the last size.
- Lectern (a group in main.js): its top edge centered under the screen, `GAP_SCREEN` 0.012 below the screen's bottom edge on the screen
  plane, tilted `LECTERN_TILT` 45° back about that edge (rotation.x = -45°: the surface faces up and toward the eyes, the near edge comes
  down toward the viewer). Laid out in its own plane, from its top edge down the slope:
  - a band (`BAND_H` 0.1 panel units + `GAP` 0.006 m), only when the output tiles or the output-type panel is shown: the tiles panel
    (1.2 wide, no background) at the left, the output-type panel (0.56 wide) at the right, both flush with the prompt panel's edges;
  - the prompt panel (1.8 x 0.6), centered;
  - the toggle column (0.14 x 0.6, no background) right of the prompt panel with `GAP`, top aligned with it.
- Side slot: one side panel at a time, all 0.85 x 1.15 at `SIDE_SCALE` = 1.5 x 0.35 (same canvas px, 1.5x larger in the world, so the
  controls are 1.5x larger to hit). Upright, its bottom edge level with the prompt panel's back (top) edge, its inner edge at
  `max(prompt right edge + GAP + toggle column width, screen half width) + GAP_SIDE` (0.02) and that edge's depth, turned `SIDE_YAW` 28°
  toward the viewer about its inner edge.
- every other panel group has scale 0.35 (`PANEL_SCALE`); main.js `layout()` is the single place that positions them and sets the side
  panels' visibility (center calls `screen.onResize()` when the stage changes size or when the band appears / disappears: center sets
  `tiles.mesh.visible` and `kind.mesh.visible`, layout reads them).
Each panel module exports `export function createXPanel(ctx) -> { group: THREE.Object3D, ... }` (plus `update(dt)` for center;
main.js also reads `panel`, and center's `tiles` / `kind` / `gallery` panels and `model`; the lighting panel is
`createLightsPanel(ctx, center.model) -> { group, panel, room }`, main.js adds `room` to the scene) where
`ctx = { THREE, store, client, ui, scene, renderer, camera, screen, xr: { isPresenting() } }`.
main.js positions the returned group per the layout above (panel modules build their content at the group origin, facing +z).

### Toggle column and icons
Round icon `Button`s (main.js), top to bottom: Gallery, LoRA, Light, Configuration, Exit. The first four work like tabs: pressing one opens its
side panel in the slot and closes the other, pressing the open one closes it; the open one is `toggled`. Nothing is open at page load or at the
start of an XR session, and the open panel is not persisted. Exit ends the XR session (`session.end()`); on the desktop it is disabled (a
no-op). Icons are Lucide (ISC), copied into `icons.js` from the Lucide SVGs in the frontend's `main-*.css` (`lucide--<name>`); to swap one,
copy another Lucide icon's path data under its name and change the name where it is used:

| Use | Lucide icon | Where |
|---|---|---|
| Gallery | `images` | main.js `SIDES` |
| LoRA | `layers` | main.js `SIDES` |
| Light | `sun` (no `lightbulb` in the frontend's set) | main.js `SIDES` |
| Configuration | `settings` | main.js `SIDES` |
| Exit | `x` | main.js |
| Image output tile | `image` | center.js `loadOutputs` |
| Mesh output tile | `box` | center.js `loadOutputs` |
| Seed: Fixed / Increment / Random | `lock` / `plus` / `shuffle` | bottom.js `MODES` |

### main.js
- On load: if `!window.isSecureContext || !navigator.xr` (and not desktop dev) → still render the desktop 3D view but show help.js overlay
  explaining how to enable WebXR on Quest Browser: `chrome://flags` → "Insecure origins treated as secure" → add
  `http://<location.host>` (prefilled, copyable) → Enabled → Relaunch; plus reminder that ComfyUI must listen on the LAN.
  Only show the help on Quest/XR-capable UA or when navigator.xr is missing; dismissible.
- VR only (`immersive-vr`, no AR / passthrough). DOM button "Enter VR", shown when `isSessionSupported('immersive-vr')`;
  requestSession inside the click handler; optionalFeatures: ['local-floor', 'hand-tracking', 'layers']. The scene has a room
  (floor grid + gradient sphere, from lights.js) in VR and on the desktop. No tone mapping (renderer default).
- `renderer.xr.setFramebufferScaleFactor(1.5)`, `setFoveation(0)`, antialias on.
- Input: for each XR input source (controllers and hands via targetRaySpace), draw a thin ray + cursor dot; raycast panel meshes;
  convert uv → canvas px → `panel.pointer(...)`. select start/end = down/up. Thumbstick Y → `panel.scroll`. Squeeze (grip) on the
  3D model grabs it (below); a left squeeze elsewhere → recenter(), a right one does nothing. Request 'hand-tracking' so hands
  appear as input sources (pinch = select). three's hand input sources only give select for a pinch; a squeeze from a hand
  (if Quest Browser sends one) grabs like a controller's, otherwise hands can turn and zoom the model but not grab it.
- Desktop fallback (no XR session): same scene, mouse drag to look around (yaw/pitch), wheel = scroll on hovered panel,
  mouse click = pointer events. This is the dev/test mode.
- 3D model (center's `model`): the model is "hit" when the ray reaches its box (`model.hit(ray)` -> distance) before any panel
  (main.js `modelHit`). A press on it turns it: while held, the
  change of the ray's yaw / pitch in the ui frame times 3 turns it (yaw around the vertical, then pitch, clamped to ±90°). Thumbstick Y
  (XR) or the wheel (desktop) over the model zooms it (0.25x..4x). The cursor dot also lands on the model's box.
  Grab (`model.grab(id, worldMatrix)` / `drag` each frame / `release`): one squeezing controller carries the model rigidly
  (target-ray pose, offset kept from the grab); with two the distance between them scales it (same 0.25x..4x), the vector
  between them turns it (shortest rotation, no twist about that axis) and their midpoint moves it. A grab bakes the turn into a
  held rotation that later turns apply on top of, and frees the model from the behind-the-screen push: it may come closer.
  Desktop: shift- or right-drag on the model slides it in the plane facing the camera (a grab with a translation pose).
  recenter() resets position, turn and zoom; a hand still holding carries it on from the reset pose.
- Each frame: `Panel.updateAll()`, panels' `update(dt)`.
- Snapshot: on start `client.getSnapshot()` → `store.load()`; if none, show "Send a workflow from ComfyUI (Open in VR / Alt+V)"
  in the center. On client "snapshot" event → fetch + `store.load()` (image history is kept).

### Panels (behavior)
- center: shows the latest image (fit, keep aspect) — XR quad layer for crispness when `layers` granted (hole-punch so the
  projection layer doesn't cover it; the HD button falls back to a mesh), mesh texture otherwise. Live previews from "preview" events
  while running; a batch shows its last image (all of them are in the gallery).
  Gallery side panel: a scrollable `ImageGrid` of the history (session list, also persisted to localStorage, last 50) of the selected
  output, newest first, the shown entry outlined; tap a thumbnail to show it. Its title names the output when there are several.
  Output tiles (tiles panel): with two outputs or more, one `OutputTile` per output (an `image` / `box` icon and the title, ellipsized, at
  most 380 px wide), the shown one `toggled`; none with a single output. Selection is manual only and kept in localStorage
  `appmode-xr.output.<workflowName>` (try/catch, falls back to the first output). With no outputs one catch-all output takes every node.
  Output-type panel: the controls of the selected output's kind, `kindControls[kind]()`; an empty list hides the panel. Image: Flat /
  3D R/L / 3D L/R (side-by-side image, one half per eye on XR layers 1/2, persisted in `appmode-xr.stereo`; previews stay flat), HD
  (disabled in stereo, on the desktop and while a 3D result is on show). Mesh: none yet.
  Results come from `executed` events whose node is an output: images from `ui.images` (png/jpg/jpeg/webp) and 3D files (glb/gltf) from
  `ui["3d"]` = [{filename, subfolder, type}] (Save 3D Model, Save 3D / Preview 3D (Advanced), type temp for previews) or
  `ui.result[0]` = a path under output/ (deprecated Preview 3D); the same shapes the frontend's readModel3DOutput reads. Each output keeps
  its own current entry; a result for an output not on show only sets a dot on its tile.
  History entries carry `node` (output id) and `kind`; the gallery shows the selected output's entries; entries whose node is not an
  output (older entries, other workflows) go to the first output of their kind, else the first output. 3D gallery tiles are a cube outline
  + file name.
  3D: when the shown entry is a model (or the selected output is 3D) the stage keeps its last size so no panel moves, the image mesh /
  quad layer are off, and live previews are ignored while a 3D output is selected. The stage panel shows
  "Loading 3D model…" / the load error until the model is ready, then hides. model.js loads with GLTFLoader (materials as in the file),
  fits the scene's box into the stage width and height, centers it on the stage center (eye level) and pushes it back so the turned box's
  front stays 1 cm behind the screen plane (until grabbed); key / fill / rim directional lights and a hemisphere in its group, set by the
  lighting preset (`model.light(preset)`), light only it (the UI is unlit). The directional lights aim at the group (stage center), so
  their directions stay put while the model is moved. A replaced
  or stale model's geometries, materials and textures are disposed.
- bottom (prompt panel, 1800 x 600 px): the workflow name at the top left. Left, under it, the prompt boxes of `store.groups.prompt` and
  `.negative`, plain multi-line TextFields without a label (full prompt, word-wrapped, clipped with "…"); an empty box shows its name as a muted
  placeholder, "Prompt…" / "Negative prompt…" (gone as soon as there is text, back when it is emptied, also while editing); tap edits in place
  (live onInput) and store.set the whole text. Only the positive one: full height. Both: positive 2/3, negative 1/3 (16 px gap). Only the
  negative one (not in the owner's spec): alone, full height, same placeholder. No prompt boxes: the right column takes the whole width.
  Right column (700 px), top to bottom: the seed row of `store.groups.seed` if any ("Seed", −, value field, +, then the mode icons `lock` =
  fixed, `plus` = increment, `shuffle` = randomize, the current one `toggled`; it ends flush with the column edge, nothing clips it; without a
  seed the column starts with the progress bar), the progress bar, the Generate button (fills the rest), Cancel
  (interrupt, enabled while running or queued). Progress bar = run status: `value/max` fill and step, the running node's title, "Queued",
  "Idle", "Interrupted" or the error (red, until the next run), plus "· N in queue" when more than one prompt is queued.
- left (Configuration side panel): scrollable list of controls from store.groups.left: COMBO / IMAGE → Combo (in-place text edit with a filtered dropdown List over the
  panel; IMAGE rows carry thumbnails from `/view?filename=..&type=input&subfolder=..` – option strings may contain "subfolder/name");
  INT/FLOAT → Slider (respect min/max/step; when the range is huge use −/+ only with fine/coarse steps); BOOLEAN → Toggle;
  STRING single-line → TextField; UNSUPPORTED type with targets → TextField on the value as text (JSON for objects), converted back to the
  original value's type on commit; state.js writes such a value into the prompt only after it was edited. Inputs without targets are read-only.
  Tabs: the left inputs are grouped by `tab` in order of first appearance (App-mode order kept inside each tab). With one tab there is no
  tab row, just the list. Otherwise a row of `Button`s (active one `toggled`) sits under the title; switching re-stacks that tab's controls
  and resets the scroll. The selected tab is kept in localStorage `appmode-xr.tab.<workflowName>` (try/catch) and falls back to the first tab
  when missing. Duplicate labels get the `nodeTitle ›` prefix only within the same tab.
- right (LoRA side panel): one section per loraNode (tabs if more than one). Stack list: name, active toggle, strength −/+ (step 0.05; clip
  strength follows while equal), remove ×. Library: search TextField (live onInput → debounced 250 ms autocomplete suggestions from
  `GET /api/lm/loras/list?search=<q>&page_size=8&sort_by=name`) + ImageGrid of results (page_size 12, paging buttons, thumbnails from
  item.preview_url; videos → use no-preview `/loras_static/images/no-preview.png`). Selecting adds `{name: item.file_name,
  strength: usage_tips.strength ?? 1, clipStrength: usage_tips.clipStrength ?? clip_strength ?? strength, active: true}` (dedupe by name).
- lights: title + 7 preset `Button`s (the current one `toggled`), applied instantly, no sliders, whatever output is shown: Neutral studio (default), High-key studio,
  Dramatic rim, Warm dark, Daylight outdoor, Overcast, Golden hour. The choice is kept in localStorage `appmode-xr.lighting` (try/catch).
  Each preset (table in lights.js) gives key / fill / rim `[color, intensity, x, y, z]` (x y z towards the light in the stage frame,
  +z towards the viewer), the hemisphere `[sky, ground, intensity]`, a 3-stop sky gradient (top, horizon, bottom) and `env`
  `[panel side, radiance gain]`. The room's sphere is painted with the preset gradient and `scene.environment` is the preset's PMREM:
  `PMREMGenerator.fromScene` of a small scene (the same gradient on a sphere plus one emissive square per light, in its direction and
  color), generated on first use and cached per preset (one generator kept). Images stay unlit.
  `scene.environmentRotation.y` follows the ui yaw on recenter so reflections turn with the lights. Only the model's
  MeshStandardMaterial reads the environment and the lights; panels and images are MeshBasicMaterial with `toneMapped: false`.
  At most 3 directional lights, no shadows.

## Implementation notes
- ui.js: `Widget.draw(ctx)` is called with ctx translated to the widget's top-left → draw in local coords. Wrapping
  Labels compute their own `h` in `relayout()` (stackY calls it after setting w). `stackY` returns next y incl. trailing gap.
  Subclasses set option defaults via `super({...defaults, ...opts})`, not class fields. Extras: Button `disabled`, Slider
  `drag:false`/`bigStep`, Panel `bg:null`, `Label.setText`, `List/ImageGrid.setItems`, `setRenderer`.
- `window.__xr = ctx` for debugging. main calls `keyboard.commit()` on XR session start/end.
- comfy.js: client sends feature_flags supports_preview_metadata (previews carry prompt_id).
- state.js: `setSeedMode` also accepts "decrement". LoRA names are written as stored (no basename rewrite).
- Desktop snapshot POST goes to `/api/appmode-xr/snapshot` (ComfyUI mirrors routes under /api).

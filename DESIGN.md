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
xr/js/main.js            bootstrap, renderer, scene, views (Desktop View, VR session, VR-like view), input, layout, recenter
xr/js/desktop.js         Desktop View windows (the panels' canvases in DOM windows), the deck (toolbar, output row, output pop-up), persistence,
                         the phone layouts
xr/js/ui.js              canvas-texture UI toolkit (Panel + widgets)
xr/js/icons.js           Lucide icons (ISC licence in its header): path data (`paths`) and Path2D (`icons`), keyed by Lucide name
xr/js/model.js           3D model on the stage: GLB/glTF loading, fit + placement, lights, turn / zoom / grab, disposal
xr/js/keyboard.js        text-edit model + Quest system keyboard bridge (editText)
xr/js/help.js            insecure-context help screen (DOM)
xr/js/comfy.js           ComfyClient: ws, queue, interrupt, previews, snapshot fetch
xr/js/state.js           store: snapshot model, values, seeds, loras, buildPrompt, generate
xr/js/rules.js           placement rule table
xr/js/panels/toolbar.js  toolbar: run status, timer, node / total progress bars, main.js's icon buttons, Cancel, Generate; the phones' tab bar
xr/js/panels/center.js   image / 3D model display, output row (tiles + cog), output pop-up, the phones' output button, gallery panel
xr/js/panels/bottom.js   prompt panel: workflow name, prompt box, folding negative prompt, seed row
xr/js/panels/left.js     Input panel: the workflow's inputs (everything the prompt and LoRA panels do not take)
xr/js/panels/config.js   Configuration panel: settings of the page's own UI (toolbar position)
xr/js/panels/right.js    LoRA panel(s) + LoRA Manager API client
xr/js/panels/lights.js   Light panel: presets for the model's lights, PMREM environments, the room (grid + gradient sphere),
                         the Desktop View background
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
  prompt: { "<nodeId>": { class_type, inputs: {...}, _meta } },   // app.graphToPrompt().output, with every switched-off Group Switch group back on
  switchGroups: {                      // one per group listed by an App-mode Group Switch, keyed by bridge id ("pg_…" Pixaroma, "ng:<id>" native)
    "<groupId>": {
      state: "on"|"mute"|"bypass",     // as the bridge reads it now (every member muted / bypassed, else on)
      off: { mute?, bypass?: {         // the prompt diff of turning only this group off, per action of its switches (+ its current one)
        removed: ["<nodeId>"],         // API nodes it drops
        replace: { "<nodeId>:<outIdx>": ["<nodeId>", outIdx] | value },  // what a remaining input using that output became (bypass rewiring);
                                       // absent = the input is dropped (mute, or no matching bypass input)
        inputs: { "<nodeId>": { "<input>": value | null } }  // any other changed input (null = deleted)
      } }
    }
  },
  previewMethod: "default",            // setting "Comfy.Execution.PreviewMethod": default|none|auto|latent2rgb|taesd
  inputs: [ {                          // one per extra.linearData.inputs entry, in App-mode order
    key: "<nodeId>:<widgetName>",      // App-mode widget: nodeId = node id in the root graph (a subgraph node for promoted widgets)
    nodeId: "5", classType: "KSampler", nodeTitle: "KSampler",   // nodeId/classType/widget = FIRST target (the host node if none)
    widget: "seed", label: "seed",     // widget = prompt input name; label = App-mode widget label/name
    targets: [ {nodeId: "260:310", input: "seed", classType: "KSampler"} ],  // every prompt input the widget feeds
    type: "INT"|"FLOAT"|"BOOLEAN"|"STRING"|"COMBO"|"IMAGE"|"PIXAROMA_SIZES"|"PIXAROMA_GROUP_SWITCH"|"UNSUPPORTED",   // from the first target's /object_info spec; IMAGE = combo with image_upload (LoadImage); PIXAROMA_SIZES = Pixaroma Sizes state object
    disabled: false,                   // no targets and the host node is muted (2) or bypassed (4) on the desktop: hidden in VR
    action, restriction, groups,       // PIXAROMA_GROUP_SWITCH only: "mute"|"bypass", "any"|"one"|"always", [{id, label, color}] (see below)
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
UNSUPPORTED and read-only (the Input panel shows "edit on desktop"), as is an entry whose widget is not found on its node; `buildPrompt` writes each value to all of its targets.
An object widget whose node serializes it elsewhere (Pixaroma `sizes_ui` -> hidden JSON-string input `SizesState`, injected by the node's
own graphToPrompt hook) resolves to the string input that parses to an object sharing a key with the widget value: the target gets
`json: true`, the snapshot value is that parsed object, and `buildPrompt` writes `JSON.stringify(value)` back. Only `PixaromaSizes:sizes_ui`
gets a dedicated type (`PIXAROMA_SIZES`: left-panel size picker, in the size group); other JSON widgets are UNSUPPORTED text edits.

Pixaroma Group Switch (`PixaromaGroupSwitch:group_switch_ui`, a DOM widget with `serialize: false`; the node is in the API prompt with no
inputs but never runs) mutes or bypasses whole groups through `window.PixaromaPixGroup` (`listGroups`, `getGroupState`, `setGroupSwitch`).
Muting drops nodes from the prompt and bypassing also rewires their consumers, and the VR page has no graph, so the switches become prompt
edits. The builder (`switchPrompts`) records every node's mode (root and subgraphs), turns the switched-off groups of the App-mode switches
back on, runs the sentinel pass and `graphToPrompt` on that base (so widgets in switched-off groups get targets), then for each group and
action turns that group alone off, runs `graphToPrompt` and stores the diff against the base, restoring the base modes after each; a
`finally` puts every mode back as it was. The input carries the switch's `action`, `restriction` and `groups` as the node lists them (its
widget value: `scope` / `picked`, names numbered in canvas order when shared, `sort` by position / name / color); `label` = App-mode label or
node title. A group's state is shared by every switch listing it, as on the desktop: a mute switch shows a group on unless it is muted, a
bypass switch unless it is bypassed; two switches with different actions on one group therefore read it differently, and turning it off in
one replaces the other's state. Only the bridge's groups of the graph shown on the canvas are listed (Pixaroma and native groups).
`buildPrompt` starts from the base: the diffs of the groups not "on" give the removed nodes (union) and the replacements (merged; the last
diff wins on a clash, possible only with overlapping groups); removed nodes are deleted; every remaining input that points at a removed node
follows the replacements transitively (a chain of bypassed groups ends at the first surviving node, a mute or a missing replacement drops
the input); then the diffs' other input changes; then values, skipping targets and LoRA nodes that were removed. Turning a group back on
gives the base, where a group that was on keeps its members' own modes (the desktop's "on" sets them all to 0).

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
  constructor({ name, widthM, heightM, pxPerM = 1000, bg = theme.panel, radius = theme.radius })   // canvas = round(widthM*pxPerM) x
                                    // round(heightM*pxPerM), max 2048; bg null = no slab
  mesh                              // THREE.Mesh, add to scene/group; mesh.userData.panel = this
  canvas; ctx; width; height        // canvas px
  add(widget) / remove(widget) / clear()
  invalidate()                      // redraw before next frame (Panel.updateAll() called by main each frame)
  pointer(type, x, y, pointerId)    // type: "move"|"down"|"up"|"leave"; x,y canvas px; routed to widgets (capture on down)
  scroll(dy, x, y)                  // thumbstick/wheel; routed to the scrollable widget under (x,y)
  setPx(w, h, scale)                // Desktop View: w x h px (any size) drawn at scale canvas px per px; no arguments = the world
                                    // size at scale 1 (VR). A size change calls panel.onResize(), the module's re-flow
}
export class Widget { x=0; y=0; w=0; h=0; visible=true; panel; draw(ctx){}; contains(x,y);
  onDown(p){}; onMove(p){}; onUp(p){}; onClick(p){}; onScroll(dy){ return false } ; invalidate() }
// Built-ins (constructor takes one options object; all have x,y,w,h):
Label{text, size, color, align, wrap}, Button{text, icon, round, onClick, variant:"default"|"accent"|"danger", toggled} (icon: an icons.js
  name, centered alone or left of the text, stroked in the text colour; round: circle / pill),
Toggle{label, value, onChange}, Slider{label, min, max, step, value, onChange, format} (drag + −/+ buttons; tapping the value edits it in place via an embedded TextField, "," ok, clamped + rounded to step),
List{items:[{label, value, sub?}], selected, onSelect, rowH} (scrollable),
TextField{value, placeholder, multiline, onInput, onDone, onCancel, onEdit, onKey, compact, barAbove} (+ EditBar, its edit toolbar),
Combo{options:[{label, value, url?}], current, rows, onChange} (TextField + dropdown List), ImageGrid{items:[{url | image (a canvas), label, value}], selected, onSelect, cell} (scrollable, the
  `selected` value's tile outlined),
ScrollView{children} (vertical scroll container), helper `stackY(widgets, {x, y, w, gap}) -> nextY`.
List/ImageGrid thumbnails (`url`) load through a module-level image cache.
```
`keyboard.js`: `export function editText({ initial, multiline, onInput(v), onSelection(), onKey(e), onDone(v), onCancel() }) -> textarea`,
plus `commit()`, `isEditing()`, `setXR(bool)`, `showKeyboard()`, `erase(dir)` and `newline()`. A hidden in-DOM `<textarea>` `ta` is the edit MODEL: its value and
selection are what the TextField draws and what taps move (selection APIs work on an unfocused textarea; never use `ta.select()`, it focuses).
Desktop (`setXR(false)`, a mouse press in the Desktop View or the VR-like view): `ta` is focused at edit start and takes physical keys; blur, Enter in a single-line field and `commit()` commit
(onDone), Escape reverts (onInput(initial), onCancel).
XR (main.js calls `setXR` on session start/end; a finger press in the Desktop View or on the 3D view sets it too, so tablets
use the same path): the Quest system keyboard can only insert (each open starts an empty session whose first
key overwrites the focused element's value, existing text is not shown, backspace cannot delete existing text, and while it is up the
session is `visible-blurred` with no controller input). So `ta` is never focused; a second always-empty hidden element `kb` (an `<input>` for single-line fields, a `<textarea>` for multiline ones) is focused by
`showKeyboard()` (the toolbar's Keyboard button, from its select handler for user activation). On kb focus the model text around the caret
or selection is captured (before/after); each kb `input` sets `ta.value = before + kb.value + after` with the caret after the typed text and
fires onInput. A kb `beforeinput` delete with an empty kb is applied to the model by `erase` (selection, or one character) and cancelled.
Dismissing the keyboard does not commit: the field stays in edit mode. It may leave kb focused (no blur), and focus() on the focused
element does not reopen the keyboard, so `showKeyboard()` blurs kb before focusing it: every Keyboard press reopens it (and recaptures before/after). Enter on the single-line `<input>` commits; in the multiline
`<textarea>` it types "\n", which the splice copies into the model like any other character (Ctrl+Enter commits, as on `ta`).
EXPERIMENTAL and unverified on the headset: whether the Quest keyboard shows a return key for a textarea and types "\n". The toolbar's
New line button (multiline fields only: `newline()` replaces the selection with "\n" in the model, same path as `erase`, in XR and on
desktop) is the reliable way to break a line.
TextField edit UX: the first tap enters edit mode with the caret at the tap (no keyboard yet); taps move the caret, dragging selects
(down anchors, move extends), a second tap within 400 ms selects the word. While editing, an `EditBar` overlays the panel below the field
(above when there is no room or `barAbove`): Keyboard, New line (icon, multiline fields only), Del, <-, ->, Select all, Done; `compact` (Slider value, Combo filter) is Keyboard,
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
  // events (CustomEvent detail): "snapshot" {id} | "status" {queueRemaining} | "cached" {nodes, prompt_id} | "executing" {node, prompt_id}
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
                                     // increment: +1), dispatch "change", queue(buildPrompt()); dispatches "queued" {prompt_id, nodes (the prompt's node ids)}; "error" {message}
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
  down toward the viewer). Laid out in its own plane, from its top edge down the slope, all centered, `GAP` 0.006 m apart:
  - the output row (center's `row`), only while `row.mesh.visible`;
  - the toolbar; it only moves when the output row comes or goes (up to the lectern's top edge without a row);
  - the one open panel of Prompt (1.8 x 0.52), Gallery, LoRA, Light, Input (0.85 x 1.15 each), Configuration (0.85 wide, as tall as
    its content), unfolding toward the viewer.
- Output pop-up: upright (not tilted) in front of the screen's bottom edge, its bottom edge on it, its right edge over the cog's right
  edge, `POPUP_Z` 0.02 toward the viewer (no z-fighting with the screen).
- Every panel group has scale 0.35 (`PANEL_SCALE`); main.js `layout()` is the single place that positions them and sets the open
  panel's visibility (center calls `screen.onResize()` when the stage changes size or when the output row, the pop-up or the note
  change: center sets `row.mesh.visible`, `popup.mesh.visible` and `note.mesh.visible`, layout and the Desktop View read them).
Each panel module exports `export function createXPanel(ctx) -> { group: THREE.Object3D, ... }` (plus `update(dt)` for center;
main.js also reads `panel`, bottom's `minHeight()` (its layout's smallest height), center's `row` / `cog` / `popup` / `closePopup()` /
`pick` / `closeTray()` / `gallery` / `note` and `model`; the lighting panel is `createLightsPanel(ctx, center.model) -> { group, panel, room, background }`, main.js
adds `room` to the scene; the Configuration panel is `createConfigPanel(ctx, onChange) -> { group, panel, minHeight(), toolbarAt() }`
(main.js passes `relayout`, called after a change, and hands `toolbarAt` to the deck); the toolbar is
`createToolbar(ctx, tabs, view, onError) -> { group, panel, tabs, phone(mode, slot) }` (main.js's panel buttons and view button, and
`onError(text)`, desktop.js `toast`; `tabs` the phones' tab bar panel); center is `createCenterPanel(ctx, rowW)`, rowW the toolbar's
width, which also returns `rowTile(size, vertical)`) where `ctx = { THREE, store, client, ui, scene, renderer, camera, screen, xr: { isPresenting() }, desktopView() }`.
main.js positions the returned group per the layout above (panel modules build their content at the group origin, facing +z).

### Toolbar and icons
One canvas panel (`toolbar.js`, "toolbar"), the same object in both views: on the lectern in VR, in the Desktop View's deck. A rounded slab
(`radius` 56 px) that never collapses. Top tier: the run status at the left and its timer at the right (monospace), then the node progress
bar (8 px, accent at 55 %) over the total progress bar (12 px). Bottom row: main.js's round icon buttons (100 px) Prompt, Gallery, LoRA,
Light, Input, Configuration (main.js `PANELS`), a separator, the view button; then a flexible gap, Cancel (round, `x`,
`danger`; the plain grey `default` look and disabled when nothing runs or is queued) and Generate (pill, `accent`, 260 px; disabled
with no active output). The width follows the icon row (at least `MIN_ICONS` 6 buttons): more buttons, a wider toolbar.
- Phones (`phone(mode, slot)`, desktop.js): one grid, margin `PM` 16, button `PB` 80. The panel buttons move to the `tabs` panel (radius 0,
  `BAR` 112 px thick), laid out along its longer side (a tab bar, or a rail when taller than wide) by `spread`: `PM` from both ends,
  the leftover spread evenly as the gaps between them; when the side is too short for gaps of at least `PM` the gaps stay `PM` and
  the buttons shrink below `PB` (a landscape window under 355 CSS px tall, a portrait one under 355 px wide). The view button and
  separator hide; the toolbar re-flows to the box it is given (`setPx`), radius 0: portrait (208 px tall) the status tier (`PM` from
  every side) over Cancel and Generate on the tab bar's columns: Cancel over the first tab, Generate from the second tab's left edge to
  the last one's right edge; landscape (`BAR` wide, full height: the dock is two equal halves) the run column on the rail's rows (the
  same `spread`): rows 1–3 one status word (Ready, Queued, Running, Done, Interrupted, Error in red, Inactive for "No active output";
  28 px, shrunk to the column's width), the timer, then the node and total bars side by side, vertical, filling bottom-up to the
  bottom of row 3; Cancel on row 4 (level with Light); Generate a play pill from the top of row 5 to the bottom of row 6 (`play` icon,
  no text; a round button's icon follows its shorter side). With `slot` true the first place of the run row / column is left free
  for a button of the caller's (desktop.js puts center's output button there): portrait, the slot over the first tab, Cancel over
  the second, Generate from the third tab's left edge to the last one's right edge; landscape, the status on rows 1–2 (its bars end
  at the bottom of row 2), the slot on row 3, Cancel and Generate as before. The toolbar knows nothing about outputs. A tap on
  "Error" or its timer calls `onError(message)`. `phone(mode, slot)` returns `{ size, bar, margin, button, slot }` (panel px; `slot`
  is `{ x, y, s }`, the free square, kept up to date as the toolbar re-flows). `phone(null)` puts the buttons back; desktop.js then
  calls `setPx()` (world size, desk layout).
- The panel buttons are lit (`toggled`) while their panel is open: in VR they work like tabs (pressing one opens its panel on the lectern
  and closes the other, pressing the open one closes it; the open one is main.js `open`, "prompt" at page load and at the start of every
  XR session, not persisted); in the Desktop View they toggle the windows (desktop.js lights them from the windows' open state).
- View button: `rectangle-goggles` in the Desktop View (enters the VR view: requestSession inside its click handler where
  `isSessionSupported('immersive-vr')`, else the VR-like view), `monitor` in the VR view (back to the Desktop View: in an XR session it
  ends the session, `session.end()`, the session end does the rest; in the VR-like view it switches directly). A click that switches
  the view leaves no hover behind on the shared toolbar (main.js `pointerUp`).
- Status (bold, one line, first form that fits, then ellipsized): "Ready" (muted, empty bars, 0:00) before any run; "Queued" (+ " · N
  ahead" when prompts from here wait and other prompts are before them: queue remaining minus the prompts queued from here) until the
  run starts executing, timer 0:00; running (fg): the node's title (prompt `_meta.title`, else its class type) "· step v / max" (when it
  sends progress) "· node i of n" (+ "· N in queue" when more than one prompt is queued), falling back to "title v/max · node i/n", then
  "title v/max". After a run: "Done in m:ss" with both bars full; "Interrupted", or the error (red); both freeze the timer and the bars
  where they were; they stay until the next run is queued. A queueing error (store "error") shows in red with 0:00. "No active output"
  while every output is switched off and nothing runs.
- Timer: m:ss since the run started executing (its first `cached` or `executing` event), not since the click; it ticks while the run
  executes (a 200 ms check repaints on the second's change), then freezes.
- Bars: node progress = the running node's `progress` value / max (empty for nodes without progress events); total = nodes done / the
  queued prompt's node count. A node is done when it is reported cached (`execution_cached`, as ComfyUI's frontend counts them) or when the
  next node starts; "node i" = done + 1. Runs are matched by prompt_id: the node ids come with the store's "queued" event, and a fully
  cached run that ends before its "queued" arrives is not counted as queued again; the "done" that follows an error or an interruption
  keeps its note. A run's end takes it out of the queue count until the next `status` says so too.

Icons are Lucide (ISC), copied into `icons.js` from the Lucide SVGs in the frontend's `main-*.css` (`lucide--<name>`); to swap one, copy
another Lucide icon's path data under its name and change the name where it is used. `icons` (Path2D) is drawn on the panels (`ui.drawIcon`),
`paths` (the path data) in the Desktop View's window title bars:

| Use | Lucide icon | Where |
|---|---|---|
| Prompt | `pencil` | main.js `PANELS` |
| Gallery | `images` | main.js `PANELS` |
| LoRA | `layers` | main.js `PANELS` |
| Light | `sun` (no `lightbulb` in the frontend's set) | main.js `PANELS` |
| Input | `sliders-horizontal` | main.js `PANELS` |
| Configuration | `settings` | main.js `PANELS` |
| View button: VR / Desktop View | `rectangle-goggles` / `monitor` (not in the frontend's set; path data from Lucide) | main.js `layout` |
| Cancel | `x` | toolbar.js |
| Window close (Desktop View) | `x` | desktop.js |
| Image output tile (placeholder, badge) | `image` | center.js `OutputTile` |
| Mesh output tile (placeholder, badge) | `box` | center.js `OutputTile` |
| Output pop-up cog | `settings` | center.js |
| Seed: Fixed / Increment / Random | `lock` / `plus` / `shuffle` | bottom.js `MODES` |
| New line (edit toolbar) | `corner-down-left` (not in the frontend's set; path data from Lucide) | ui.js `EditBar` |

### main.js
- Views: the page opens in the Desktop View (below) when no XR session runs. The VR view is the XR session, or on a browser
  without `immersive-vr` the VR-like view: the same scene and panels as in the headset, seen from a desktop camera with mouse
  look. The toolbar's view button enters it and goes back, as does the end of an XR session. `?view=vr` opens the
  VR-like view directly (the dev / test entry). `setView(desk)` releases every pointer, shows the room (VR) or the flat background
  (Desktop View), resets the look, closes the output pop-up, resets the fov (70°) and the hint (VR-like view only), then
  `relayout()`: `layout()` and the windows (with the deck).
- On load: if `!window.isSecureContext || !navigator.xr` on Quest Browser (UA `OculusBrowser`), or with `?help`, show the help.js
  overlay explaining how to enable WebXR: `chrome://flags` → "Insecure origins treated as secure" → add `http://<location.host>`
  (prefilled, copyable) → Enabled → Relaunch; plus reminder that ComfyUI must listen on the LAN. Dismissible. Tablets and desktops
  reach the page over plain http too, so it is not shown there.
- VR only (`immersive-vr`, no AR / passthrough). optionalFeatures: ['local-floor', 'hand-tracking', 'layers']. The scene has a room
  (floor grid + gradient sphere, from lights.js) in VR and in the VR-like view. No tone mapping (renderer default).
- `renderer.xr.setFramebufferScaleFactor(1.5)`, `setFoveation(0)`, antialias on.
- Input: for each XR input source (controllers and hands via targetRaySpace), draw a thin ray + cursor dot; raycast panel meshes;
  convert uv → canvas px → `panel.pointer(...)`. select start/end = down/up. Thumbstick Y → `panel.scroll`. Squeeze (grip) on the
  3D model or the image grabs it (below); a left squeeze elsewhere → recenter(), a right one does nothing. Request 'hand-tracking' so
  hands appear as input sources (pinch = select). three's hand input sources only give select for a pinch; a squeeze from a hand
  (if Quest Browser sends one) grabs like a controller's, otherwise hands can turn and zoom the model (pan and zoom the image) but
  not grab it.
- Hide UI: B on the right controller (polled each frame: `gamepad.buttons[5].pressed` of the right-handed source, toggled on the
  press edge; index 5 is B in the WebXR input profile of the Quest Touch controllers, xr-standard itself only fixes 0–3) or H on
  the desktop → `toggleUI()`: commits an open text edit, closes the output pop-up, drops every pointer's hover / press / pan
  (`releasePointer`), flips `uiShown` and re-runs `relayout()` (in the Desktop View it hides the windows and the deck), whose
  `layout()` hides the lectern (output row, toolbar, the open panel, any edit toolbar on them). The stage (and its empty / loading
  message), the image or 3D model, the room and the rays stay. Hidden panels are not raycast (main.js only collects visible panel
  meshes), so the image / model take every ray. Showing again restores the same open panel; panels keep their own state (scroll,
  tab). Hands have no B button.
- Output pop-up: closes on a press anywhere but on it and on the output row (VR: `pointerDown` with the panel hit, or nothing; Desktop
  View and phones: a capturing window `pointerdown` whose target is not the pop-up's or the row's canvas), on its cog, on Esc, on H, on a view
  switch, with the phones' tray and on a change of phone layout. A press on a tile keeps it open (it follows the new output).
- Mouse and touch on the 3D view (no XR session, main.js): mouse click = pointer events, wheel = scroll on the hovered panel, R =
  recenter (the Desktop View: resets the image / model view), H = hide UI, Esc = close the output pop-up (and the phones' tray). A drag off the image, the model and the panels looks
  around (yaw / pitch) in the VR-like view only. Each finger is a pointer of its own (`fingers`, keyed by pointerId, dropped on
  release). A second finger while another holds the image or the model pinches it: both slide it in one plane (`slide`, so the
  image's or the model's two-hand grab: their distance zooms it, their midpoint moves it); a finger turning the model first
  becomes a slide in the plane facing the camera at its press depth (the turn grab keeps `view` and `dist` for that), and the
  finger left after a pinch on the model turns it again. A third finger does nothing.
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
- Image (center's `image`, same interface as `model`: `hit` / `zoom(k, ray)` / `grab` / `drag` / `release` / `reset`; `model.zoom`
  ignores the ray): pans and zooms in the stage plane, never turns or changes depth. The image meshes (and the hole mesh) sit in a
  `view` group whose position (z = 0) and uniform scale are the pan and zoom (0.25x..16x, no other clamping: it may grow past the
  screen frame and behind the panels). main.js `viewHit` returns whichever of model / image the ray reaches before any panel (the
  model's rule), so panels in front of a grown image keep their rays and clicks; the cursor dot lands on the image.
  A press (trigger, pinch, mouse) on it pans: a grab whose pose is the ray's point on the image plane (`slide`, the same path as
  the desktop model slide), so the grabbed point stays under the ray. Thumbstick Y (XR) / wheel (desktop) over it zooms about the
  ray's point, which stays under the ray. Grip: grab poses are reduced to their point in the stage frame; one hand moves the image
  by its in-plane motion only, two scale it by their distance ratio and move it with their midpoint (no turn). Two pans (both
  triggers) pinch-zoom the same way. Slides are keyed by the pointer object and grips by its id, so one controller can do both.
  A zoom during a grab rebases the grab. Desktop: drag on the image pans, wheel zooms about the cursor; drag off it still looks
  around in the VR-like view.
  Reset (pan 0, zoom 1): on recenter() (also the R key), on a snapshot load, and on a Flat / 3D mode change (the stage changes
  size). New images (live previews, results, gallery picks, fallbacks) and output tile switches keep the view; it is relative to
  the stage fit, so an image of another aspect keeps the same relative zoom. A hand still holding carries it on from the reset
  view. Both stereo eyes are in `view`, so they share the transform. HD: the quad layer takes width / height / transform from
  holeMesh's world matrix each frame (`applyPose` when it changed), so it follows the pan and zoom, and the hole mesh is in
  `view` with the image.
- Each frame: `Panel.updateAll()`, panels' `update(dt)`; in the Desktop View `fitCamera()`.
- Snapshot: on start `client.getSnapshot()` → `store.load()`; if none, show "Send a workflow from ComfyUI (Open in VR / Alt+V)"
  in the center. On client "snapshot" event → fetch + `store.load()` (image history is kept).

### Desktop View (desktop.js, main.js)
- Viewport: the whole window, a fixed camera at the eye looking straight at the stage (no look around), its vertical fov fitted each
  frame so the stage fills the image's box, desktop.js `stage()` (the window, or what a phone layout leaves; contain: `max(screen.h,
  screen.w / aspect)` at `SCREEN_DISTANCE`, aspect the box's), with `camera.setViewOffset(box.w, box.h, -box.x, -box.y, innerWidth,
  innerHeight)` moving the projection's center to the box's (rays from the whole canvas stay right; `setView` clears it for the VR
  views). The image or 3D model is therefore fitted to its box. When there is neither, the stage's message (no workflow, no images / 3D models yet,
  loading, missing file, load error: every text of center's `empty` label) is not shown on the 16:9 stage frame, which center
  hides in the Desktop View (`ctx.desktopView()`, each frame in `update()`), but in center's `note` panel: the same text, its
  width measured, 40 / 20 px padding, shown by desktop.js alone at the image box's center (scaled down to fit it; no chrome, clicks pass through) while
  `note.mesh.visible` (the message is up). A changed text re-places it through `screen.onResize`. `scene.background` is lights.js's
  `background`, a `THREE.Color` set to the lighting preset's horizon colour (`sky[1]`), so it follows the Light window; the room is
  hidden. The lights still light the model. Input on the 3D view as above: drag pans the image / turns the model, the wheel zooms
  about the cursor, shift- or right-drag moves the model; one finger pans / turns, two pinch-zoom and move.
- Windows: Prompt, Gallery, LoRA, Light, Input, Configuration, one panel each. They host the same Panel objects as VR: each panel's own canvas
  is placed in a DOM window (`main.js` passes `createDesktop` one spec per window, `{ name, title, icon, button, panel, minW, minH(w) }`
  in panel px: `button` the toolbar's, lit while the window is open; the first size is the panel's VR size; `minW` / `minH(w)` the smallest
  its layout takes, the height at content width w (Prompt 560 wide, its height from bottom's `minHeight()`; Gallery 500 x 500, LoRA 560 x
  700, Light 420 x 500, Input 560 x 500, Configuration 560 x its content's height, config's `minHeight()`). A snapshot load re-places the
  windows (the prompt panel's entries change its minimum).
  At 560 px (the phones' narrowest) the seed row drops its "Seed" label (narrower than `SEED_W`), the Configuration grid's labels
  shrink until the longest fits, and an edit toolbar wider than its panel drops Keyboard and the arrows.
  `layout()` hides the lectern and the pop-up in the Desktop View; the meshes are not rendered. `screen.onResize` (stage size, output
  row, pop-up or note change) re-places the windows and the deck too. Stored window sizes (the Prompt window held the output band before) are not migrated.
- A window: a title bar (icon, title, close button; drag to move), the panels, a corner grip (drag to resize; 40 px on coarse
  pointers, as is a 44 px bar). Width and height are free; every window draws its panel at one fixed `SCALE` (0.45 CSS px per
  panel px, so the text has one size everywhere) and the panel RE-FLOWS to the content area: `panel.setPx(w, h, SCALE *
  devicePixelRatio)` (sharp at any DPI) calls the panel module's `onResize`, which re-runs its own layout from `panel.width` /
  `height` (the same code VR runs at the world size): the prompt box grows, the Input / LoRA / Gallery lists
  show more rows (their scrolling covers the rest), the Light grid takes more columns. A grip press
  commits an open edit first (a re-flow rebuilds some panels' widgets). A hidden window's panel and every panel outside the
  Desktop View go back to their world size at scale 1 (`setPx()`), so VR keeps its layout.
- Several windows may be open; a press on one raises it (z-index, kept). Windows sit above the 3D view, so pointer input over a
  window always goes to it. Canvas pointer events map to `panel.pointer(type, x, y, pointerId)` in panel px (pointer capture on
  press, wheel = `panel.scroll`; a drag in a panel scrolls it as in VR). A press on a TextField or EditBar keeps an edit, any other
  window press commits it on release; moving, resizing, closing, a toolbar button do too. The window layer keeps the focused textarea
  (mousedown, and touch pointerdown, prevented while editing). A finger tap that starts an edit opens the on-screen keyboard
  (`showKeyboard()`, keyboard.js's XR path; the tap is its user activation; on phones the desktop path: `ta` itself is focused, so the
  system keyboard edits it with its own caret, selection and backspace).
  A re-flow during an edit (a rotation, the phone keyboard) keeps it: a TextField whose panel was rebuilt (left / right `panel.clear()`)
  adds its EditBar back when drawn, a Combo its bar and list.
- Deck (`.deck`, fixed, above every window), placed by `renderDeck` from the Configuration panel's toolbar position (`at()`,
  `<top|bottom>-<left|center|right>`, default bottom-right): `EDGE` 16 px from the chosen edges, horizontally centered for center.
  The output row (while `row.mesh.visible`) sits `DECK_GAP` 8 px over the toolbar at the bottom, under it at the top (the deck
  mirrors vertically, flex `column-reverse`), aligned with the toolbar on the deck's side (left / center / right); both are
  chrome-less canvases at `SCALE`. The output pop-up (while `popup.mesh.visible`) is absolutely placed `DECK_GAP` beyond the row
  (above it at the bottom, under it at the top), its right edge over the cog's (its left edge on the cog's for left positions).
  Narrower than the toolbar plus 16 px margins, the whole deck is scaled down about its pinned point (`transform: scale(k)`, with
  `translateX(-50%)` when centered; `transform-origin` = the position; drawn at `SCALE * devicePixelRatio * k`; no re-flow). A change
  of the setting re-renders it at once (main.js `relayout`); windows keep their geometry. The same pointer binding and edit-keeping
  as the windows. Hidden in the VR view and by H (its panels go back to their world size). The VR lectern ignores the setting.
- Persistence: localStorage `appmode-xr.desktop` = `{ <name>: { x, y, w, h, open, z } }` (CSS px, w / h = the window's size
  with its title bar; try/catch, the page works without it; the zoom version's `appmode-xr.windows` is ignored; geometry stored
  under `config` when that window held the workflow's inputs is not migrated: the Configuration window takes it), saved after a move,
  resize, open, close or raise; a resize stores the size as shown. Shown geometry is clamped: at least the window's minimum, at
  most the browser window, the position pushed inside it, without changing what is stored (rotating a tablet back restores it).
- Canvases move between hosts (window body, deck, phone layer) only when they are elsewhere (`adopt`: a move drops pointer capture).
- Placement on first opening (no stored x), following the deck (rendered before the windows): the first window (Prompt) centered
  horizontally just beyond the deck (`MARGIN` 12 px above it for bottom positions, below it for top ones; the deck's box is the
  toolbar plus room for the output row at its tallest, center's `rowH`, since its tiles come with the snapshot after the first
  placement); the others aligned with the deck's side (right, left or centered on it) just beyond it, `CASCADE`
  32 px further from the deck and from its side (only from the deck when centered) than the previous new window while that one is
  still open. First size: the panel's VR size at `SCALE`, the width at most the browser window minus margins, the height at most the
  space beyond the deck minus margins. Stored geometry is not moved when the setting changes. First visit: only Prompt is open.
  A page loaded without a size (hidden tab) places its windows on the first resize.
- Keys: H hides every window and the deck (and shows them again); the image / model keep their fit. R resets the image / model.
  Esc closes the output pop-up (and the phones' tray).
  Physical keys edit text through `ta` as before.
- Tablets: the same layout in landscape and portrait. Quest's 2D browser before entering VR: the controller pointer acts as a mouse.

### Phones (desktop.js `renderPhone`, main.js)
- When: narrower than 600 CSS px = portrait; wider than tall and shorter than 500 px = landscape; else the Desktop View. Re-evaluated
  in `update()` (window resize, rotation, relayout) and on `visualViewport` resize / scroll; switching keeps the open panel, its
  scroll, the selected output and an open edit. Hidden (H) or in VR the layout is off (toolbar, row and panels back to VR geometry).
  Windows are hidden and their stored geometry untouched (it comes back on a wide window). The toolbar position setting and the
  view button do not apply.
- A `.phone` layer (fixed, z 6, clicks pass through but on its children) with `env(safe-area-inset-*)` padding, read back for
  the insets (`viewport-fit=cover`); its children are placed absolutely in CSS px. Panels are drawn at `PHONE` 0.6 CSS px per panel
  px and re-flow to their box (`put`: `setPx(w / PHONE, h / PHONE, PHONE * devicePixelRatio)`). No window chrome. Every margin and
  gap is the toolbar's `PM` (`gap` = 9.6 CSS px), so the tray's edges line up with the dock's buttons. The tray, the output button,
  the pop-up and the toast sit over the open panel (z-index 1).
- One panel at a time, `sheet` (Prompt at page load, not persisted): its toolbar button toggles it, the open one is lit. It takes all
  the room the dock leaves inside the safe area, edge to edge (no margin, radius 0: desktop.js sets the panel's `radius` to 0 while it
  hosts it and back to `theme.radius` otherwise), over the image, which is not resized for it; every panel, Prompt and Configuration
  too, fills that room. Closing it shows the image again.
- Output button (center's `pick`, a panel with one `OutputTile`, the selected output's: its latest result or its kind's icon, dimmed
  when inactive, the dot while another output has results not shown yet, the selection `ring` while the tray is open): whenever the
  row has something (`pick.mesh.visible`: several outputs, or a single one with settings, whose tray holds the cog alone; otherwise
  the dock keeps its plain layout and there is no tray). desktop.js passes
  `pick.mesh.visible` to the toolbar's `phone(mode, slot)` on every `update()` and puts the button over the toolbar's free square
  (`slot`), at its size (`PB` 80 px, 48 CSS px, like the tiles).
- Tray: tapping the button opens the output row (center's `tray`: on phones `row.mesh.visible` only while it is open; null off phones,
  where the row shows as before) in `.strip`, a box in the panel colour with a 1 px border colour ring and 24 px corners (the tiles'
  `TILE_R` 14.4 CSS px plus the margin), its border the margin wide in the panel colour (desktop.js sets the width to `gap`), so the
  tiles scroll inside the padding. `rowTile(button, landscape)` = tiles of the toolbar's button size `PB` 80 px (`TILE_GAP` 16 = `PM`
  apart, the cog `COG` 80 too) with no length limit (center `placeRow`; tiles under `SMALL_TILE` 120 px draw no badge and no title),
  the cog last, start-aligned. Portrait: a row `gap` above the dock, left and right edges `gap` from the window's (inside the safe
  area), as tall as the tiles plus the padding, scrolling sideways (the canvas `touch-action: pan-x`, so a swipe scrolls and cancels
  the press). Landscape: a column (`.strip.v`) `gap` left of the dock, top and bottom `gap` from the window's, scrolling vertically
  (`pan-y`). It sits over the image or the open panel (the Gallery follows the selected output). A tile switches the output and keeps
  the tray open. It closes (center `closeTray()`, which also closes the pop-up) on the button again, on a press anywhere but on the
  tray, its pop-up and the button (desktop.js, a capturing window `pointerdown`), on Esc (main.js), when a tab opens or closes a panel
  (desktop.js `toggle`), and on a change of layout (rotation, leaving the phone layout: `rowTile` resets it). It always starts closed.
  Pop-up, re-placed on tray scroll: portrait, its right edge over the cog's on screen (clamped inside the window, scaled down when the
  window is narrower than it), `gap` above the tray; landscape, `gap` left of the tray (scaled down to fit there), its bottom edge on
  the cog's (clamped inside the window).
- Portrait: the dock pinned to the bottom, full width: toolbar over the tab bar, a `.pad` in the panel colour under it over the bottom
  inset. The image (`stage`) and the open panel take everything above the dock, from the top inset. Keyboard up (an edit open and
  the visual viewport ending above the window): the dock (and the tray) hide, the panel ends on `visualViewport.offsetTop + height`.
- Landscape: the dock against the right edge, full height: the toolbar's run column then the tab rail, a `.pad` in the panel
  colour under both, over the right inset and the top / bottom ones. The image (`stage`) and the open panel take everything left of
  it, from the left inset, full height inside the safe area. Keyboard up: the panel takes the whole width from the top to the
  keyboard; everything else hides until it closes. Error toast (desktop.js `toast(text)`): the whole message in a `.toast` centered
  at the foot of the image box (red text, no pointer events) for `TOAST_MS` 4 s.
- Touch on the image: the Desktop View's (one finger pans / turns, two pinch-zoom and move).

### Panels (behavior)
- center: shows the latest image (fit, keep aspect, then the user's pan / zoom) — XR quad layer for crispness when `layers` granted (hole-punch so the
  projection layer doesn't cover it; the HD button falls back to a mesh), mesh texture otherwise. Live previews from "preview" events
  while running; a batch shows its last image (all of them are in the gallery).
  Gallery panel: a scrollable `ImageGrid` of the history (session list, also persisted to localStorage, last 50) of the selected
  output, newest first, the shown entry outlined; tap a thumbnail to show it. Its title names the output when there are several.
  Output row (center's `row`, no background): when App mode configures two outputs or more, one square `OutputTile` per output
  (`TILE` 200 px, rounded): the output's latest result from the history (image: its thumbnail, cover-cropped; 3D: `modelThumb`), its
  kind's `image` / `box` icon as a placeholder before the first result (never a live preview), a kind badge (top left), the title along
  the bottom (ellipsized), a dot (top right) for results that came in since the output was last shown; the selected one has a thin accent
  ring drawn just inside its rounded edge (`ring`, also the gallery's shown entry); an inactive output (switched off by App mode, Group Switch) is dimmed but still selectable. No tiles with a single output. Then
  the cog (`settings`, round, 80 px, bottom-aligned) at the row's end, shown when `kindControls[kind]()` of any output is not empty and
  disabled while the selected output's is, so switching tiles never moves them; a single output with settings shows the cog alone;
  with neither the row is hidden. The tiles shrink so the row stays within
  the toolbar's width (`rowW`); the row panel is resized to its content (`placeRow`), centered over the toolbar in VR and aligned
  with it on the deck's side in the Desktop View; on phones it is the tray (see Phones).
  Selection is manual only and kept in localStorage `appmode-xr.output.<workflowName>` (try/catch, falls back to the first active
  output; an inactive saved one is not restored). With no outputs one catch-all output takes every node.
  Active output (`store.outputActive`): in the snapshot prompt (not muted / bypassed on the desktop) and not in `store.removedNodes()`.
  On a `"switchGroups"` change, if the selected output went inactive the first active one is selected (screen, gallery and pop-up
  follow; no switching back when it returns). With none active the selection and the screen stay as they are, Generate is disabled and
  the toolbar's status says "No active output". Inactive outputs keep their history, current entry and dot.
  Output pop-up (center's `popup`, 580 x 164 px card, radius 32, no title bar; open = `popup.mesh.visible`, the cog `toggled` while
  open): the selected output's name, then the controls of its kind, `kindControls[kind]()`. Image: Flat / 3D R/L / 3D L/R (side-by-side
  image, one half per eye on XR layers 1/2, persisted in `appmode-xr.stereo`; previews stay flat), HD (disabled in stereo, on the
  desktop and while a 3D result is on show). Mesh: none yet (the cog is disabled). Picking an option keeps it open; nothing about it is remembered
  (it always opens at the cog). When the selection changes it follows the new output, closing when that one has no controls.
  Results come from `executed` events whose node is an output: images from `ui.images` (png/jpg/jpeg/webp) and 3D files (glb/gltf) from
  `ui["3d"]` = [{filename, subfolder, type}] (Save 3D Model, Save 3D / Preview 3D (Advanced), type temp for previews) or
  `ui.result[0]` = a path under output/ (deprecated Preview 3D); the same shapes the frontend's readModel3DOutput reads. Each output keeps
  its own current entry; a result for an output not on show only sets a dot on its tile.
  History persistence (localStorage `appmode-xr.history`, last 50 of `{filename, subfolder, type, kind, node}`): entries of `type` temp
  (Preview Image, Preview 3D (Advanced); ComfyUI deletes its temp folder on every start and shutdown) are shown for the page session only,
  never saved, and dropped if found in storage. At start every saved entry gets a `HEAD` request on its `/view` URL (4 in parallel, not
  blocking); the 404s leave the history and the gallery and the history is saved. Showing an entry whose image or GLB fails to load does the
  same `HEAD` check: a 404 removes the entry, saves, and the stage says "File no longer exists — removed from the gallery"; any other failure
  (network, parse) keeps the entry. An output whose current entry was removed falls back to its next entry, else shows the empty screen.
  History entries carry `node` (output id) and `kind`; the gallery (titled "Gallery · <output>" with several outputs) shows the selected output's entries; entries whose node is not an
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
- bottom (prompt panel, 1800 x 520 px in VR, any size in the Desktop View): top to bottom, the workflow name (28 px, top left);
  the prompt box of `store.groups.prompt`, full width, taking all the extra height; the negative prompt of `.negative`; the seed row.
  Prompt boxes are plain multi-line TextFields without a label (full prompt, word-wrapped, clipped with "…");
  an empty box shows its name as a muted placeholder, "Prompt…" / "Negative prompt…" (gone as soon as there is text, back when it is
  emptied, also while editing); tap edits in place (live onInput) and store.set the whole text.
  Negative prompt: a header row (`Fold`: a chevron, "Negative" and, folded, the start of its text in muted, ellipsized) that folds
  and unfolds it on a tap; unfolded, its box (140 px, at most half the space the two boxes share) sits under the header and the
  prompt box shrinks. Folded by default; the state is kept in localStorage `appmode-xr.negative` (`open` / `closed`, try/catch).
  Missing entries leave no empty box: only the negative one (not in the owner's spec) is a plain box, alone, full height, with no
  header; neither leaves the space empty.
  Seed row (64 px, at the bottom, `SEED_W` 680 px wide at most, left-aligned) for `store.groups.seed` if any: "Seed", −, value field,
  +, then the mode icons `lock` = fixed, `plus` = increment, `shuffle` = randomize, the current one `toggled`. Without a seed the boxes
  take its place. Run status, progress, Cancel and Generate are on the toolbar. `minHeight()`: name + 3 prompt lines (with a box) + the
  negative header + the seed row (unfolding the negative prompt at that height shares the space).
- left (Input panel, titled "Input"; "No inputs in this workflow" when empty): scrollable list of controls from
  store.groups.left: PIXAROMA_GROUP_SWITCH → the label and a Mute / Bypass tag, then one row per group (colour dot, label, switch),
  switched like the node: any; one = turning a group on turns the switch's other groups off; always = the same, and the last group on cannot be turned off; it updates on `"switchGroups"` changes (all
  switches share the group states, `store.groupState(id)` / `setGroupStates({id: state})`). No sync back to the desktop.
  Visibility: an input is hidden while every one of its targets is in `store.removedNodes()` (dropped by the switched-off groups; a widget
  feeding several subgraph nodes stays until all are dropped) or when it is `disabled`; never a Group Switch. Hidden inputs keep their
  values. Tabs with no visible input are hidden; the shown tab stays while it has visible inputs (with its scroll), else the saved tab,
  else the first; one visible tab = no tab row. The re-layout runs after the press that flipped the switch (microtask), only when the
  visible set changed. Prompt-panel inputs (`_prompt`, `_negative_prompt`, `_seed`) are never hidden; their value is just not written
  when their node is dropped.
  Other types: COMBO / IMAGE → Combo (in-place text edit with a filtered dropdown List over the
  panel; IMAGE rows carry thumbnails from `/view?filename=..&type=input&subfolder=..` – option strings may contain "subfolder/name");
  INT/FLOAT → Slider (respect min/max/step; when the range is huge use −/+ only with fine/coarse steps); BOOLEAN → Toggle;
  STRING single-line → TextField; UNSUPPORTED type with targets → TextField on the value as text (JSON for objects), converted back to the
  original value's type on commit; state.js writes such a value into the prompt only after it was edited. Inputs without targets are read-only.
  Tabs: the left inputs are grouped by `tab` in order of first appearance (App-mode order kept inside each tab). With one tab there is no
  tab row, just the list. Otherwise a row of `Button`s (active one `toggled`) sits under the title; switching re-stacks that tab's controls
  and resets the scroll. The selected tab is kept in localStorage `appmode-xr.tab.<workflowName>` (try/catch) and falls back to the first tab
  when missing. Duplicate labels get the `nodeTitle ›` prefix only within the same tab.
- right (LoRA panel): one section per loraNode (tabs if more than one). Stack list: name, active toggle, strength −/value/+ (step 0.05;
  the value is a compact TextField like the Slider's: tapping selects it to type a number, "," accepted as decimal separator, stored
  rounded to 2 decimals, not clamped, anything else reverts; clip strength follows while equal), remove ×. Row edits apply to the store's
  current list (matched by entry identity): the weight field commits only after a press elsewhere has run (× on another row).
  Library: search TextField (live onInput → debounced 250 ms autocomplete suggestions, 8) + ImageGrid of results (12 per page, paging
  buttons, thumbnails from item.preview_url; videos → use no-preview `/loras_static/images/no-preview.png`). No query:
  `GET /api/lm/loras/list?sort_by=name&page_size=<n>&page=<p>`. With a query: LoRA Manager's `search` only matches file_name and
  model_name (tags / creator are opt-in; `folder` / `folder_include` are prefix filters ANDed with it), so every page of the list is
  fetched (page_size 100, its cap) and filtered here, case-insensitively, on the path relative to the LoRA root
  (`item.folder + "/" + item.file_name`, no extension) or model_name, keeping LoRA Manager's name order. The matches are kept for the
  current query (paging and suggestions reuse them, a changed query refetches) and paged locally. Selecting adds `{name: item.file_name,
  strength: usage_tips.strength ?? 1, clipStrength: usage_tips.clipStrength ?? clip_strength ?? strength, active: true}` (dedupe by name).
- lights: title + an `ImageGrid` of 7 square preset tiles as wide as the panel (cell 250: 3 columns in VR; the Desktop View's
  window re-flows it), each the preset's sky gradient (`skyCanvas`, the colours `paintSky` gives the room) with the preset name as
  its label, drawn like the LoRA library tiles; the current one outlined (`selected`, as the gallery outlines the shown entry). Applied instantly, no sliders, whatever output is shown: Neutral studio (default), High-key studio,
  Dramatic rim, Warm dark, Daylight outdoor, Overcast, Golden hour. The choice is kept in localStorage `appmode-xr.lighting` (try/catch).
  Each preset (table in lights.js) gives key / fill / rim `[color, intensity, x, y, z]` (x y z towards the light in the stage frame,
  +z towards the viewer), the hemisphere `[sky, ground, intensity]`, a 3-stop sky gradient (top, horizon, bottom) and `env`
  `[panel side, radiance gain]`. The room's sphere is painted with the preset gradient and `scene.environment` is the preset's PMREM:
  `PMREMGenerator.fromScene` of a small scene (the same gradient on a sphere plus one emissive square per light, in its direction and
  color), generated on first use and cached per preset (one generator kept). Images stay unlit.
  `scene.environmentRotation.y` follows the ui yaw on recenter so reflections turn with the lights. The panel also returns
  `background` (the horizon colour), the Desktop View's `scene.background`. Only the model's
  MeshStandardMaterial reads the environment and the lights; panels and images are MeshBasicMaterial with `toneMapped: false`.
  At most 3 directional lights, no shadows.
- config (Configuration panel, 0.85 m wide, as tall as its content): settings of the page's own UI, not of the workflow. Title, then
  "Toolbar position": a 3 x 2 grid of buttons laid out like the screen (top row Top left / Top center / Top right, bottom row Bottom
  left / Bottom center / Bottom right), the current one `toggled`; the grid re-flows to the panel's width. Kept in localStorage
  `appmode-xr.toolbar` (try/catch, default `bottom-right`). It places the Desktop View's deck only; shown and editable in VR too.

## Implementation notes
- ui.js: `Widget.draw(ctx)` is called with ctx translated to the widget's top-left → draw in local coords. Wrapping
  Labels compute their own `h` in `relayout()` (stackY calls it after setting w). `stackY` returns next y incl. trailing gap.
  Subclasses set option defaults via `super({...defaults, ...opts})`, not class fields. Extras: Button `disabled`, Slider
  `drag:false`/`bigStep`, Panel `bg:null` / `radius`, `Label.setText`, `List/ImageGrid.setItems`, `setRenderer`, `ellipsize(ctx, text, maxW)`,
  `drawIcon(ctx, name, x, y, s)` (stroked in the current strokeStyle), `drawCover(ctx, img, x, y, s)`.
- `window.__xr = ctx` for debugging. main calls `keyboard.commit()` on XR session start/end.
- comfy.js: client sends feature_flags supports_preview_metadata (previews carry prompt_id).
- state.js: `setSeedMode` also accepts "decrement". LoRA names are written as stored (no basename rewrite).
- Desktop snapshot POST goes to `/api/appmode-xr/snapshot` (ComfyUI mirrors routes under /api).

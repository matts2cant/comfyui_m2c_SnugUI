# SnugUI — design spec (source of truth for all agents)

Personal-use ComfyUI custom-node package: a "SnugUI" button snapshots the current App-mode workflow; a page served by ComfyUI
(`/snugui`) lets the user tweak inputs and generate from a phone (portrait and landscape), a desktop browser or tablet (the
Desktop View) or a Meta Quest 3 (standalone Quest Browser, WebXR).

## Hard rules
- Its own custom-node package, `custom_nodes/comfyui_m2c_SnugUI/` (no nodes, no dependency on other custom nodes). Only create/modify
  files inside it. Never touch ComfyUI core, other custom nodes, the venv (no pip installs), Comfy Desktop config, or `%APPDATA%`.
- No CDN / internet at runtime. Libraries are vendored in `app/vendor/`.
- Plain ES modules, no build step, no npm deps at runtime. Modern JS (Quest Browser = recent Chromium).
- Match a hand-written style: small direct code, sparse useful comments, no defensive boilerplate.
- Only `web/snugui.js` may hold frontend extension code (ComfyUI auto-loads EVERY .js under WEB_DIRECTORY into the main UI).
- No git commits unless your task says so.

## Environment facts
- ComfyUI v0.42.4, frontend `comfyui_frontend_package` 1.55.18 (minified bundles in
  `.venv/Lib/site-packages/comfyui_frontend_package/static/assets/`, logic in `settingStore-*.js`, `GraphView-*.js`, `api-*.js`).
- User runs ComfyUI via Comfy Desktop on port 8000 (`--listen 0.0.0.0` set by the user). Quest reaches `http://<pc-ip>:8000`.
- LoRA Manager 1.1.7 installed at `custom_nodes/comfyui-lora-manager` (routes on the same origin under `/api/lm/...`).

## File layout & ownership
```
__init__.py              package entry and server: routes + snapshot store; empty NODE_CLASS_MAPPINGS / NODE_DISPLAY_NAME_MAPPINGS,
                         WEB_DIRECTORY = "./web"
web/snugui.js            desktop extension: button, Alt+S, snapshot builder
app/index.html           page shell
app/vendor/              three.module.js — vendored three.js r170; GLTFLoader.js — its examples/jsm GLTFLoader (esm.sh build of
                         three@0.170.0 with BufferGeometryUtils inlined, copied from ComfyUI-Pixaroma, imports rewritten to "three"); both under three.LICENSE (MIT)
app/js/main.js           bootstrap and the VR host: renderer, scene, views (Desktop View, VR session, VR-like view), the panels, their
                         layout on the lectern (layout, relayout), setView, recenter, toggleUI, page keys, the frame loop
app/js/pointers.js       pointer input on the 3D view: XR controllers and hands (rays, cursor dots, B), the mouse and fingers (pinch),
                         the wheel, the VR-like view's look around; createPointers(...) -> { update(dt), releaseAll(), resetLook() }
app/js/desktop.js        Desktop View host: windows (the panels' canvases in DOM windows), the deck (toolbar, output row, output pop-up),
                         persistence, the note; decides the layout (Desktop View or phone) and hands the panels to phone.js on phones
app/js/phone.js          phone host: one panel at a time, the dock (its grid, the tab bar, the toolbar's boxes), the output button and tray, the toast
app/js/dom.js            what both DOM hosts share: adopt, el, clamp, sizePanel, keepEdit, bindPanel (pointer input, edit keeping)
app/js/prefs.js          the page's settings in localStorage: pref, prefJSON, setPref (storage that throws reads as empty, writes are dropped)
app/js/history.js        the results history (center's): entries, add, drop, missing() (the HEAD check), its localStorage; resultFiles, isMissing
app/js/quad.js           the image's XR quad layer (HD): createQuadLayer(ctx, holeMesh) -> { update(shown, enabled), supported() }
app/js/ui.js             canvas-texture UI toolkit (Panel + widgets)
app/js/icons.js          Lucide icons (ISC licence in its header): path data (`paths`) and Path2D (`icons`), keyed by Lucide name
app/js/model.js          3D model on the stage: GLB/glTF loading, fit + placement, lights, turn / zoom / grab, disposal
app/js/keyboard.js       text-edit model + Quest system keyboard bridge (editText)
app/js/help.js           insecure-context help screen (DOM)
app/js/comfy.js          ComfyClient: ws, queue, interrupt, previews, snapshot fetch
app/js/state.js          store: snapshot model, values, seeds, loras, buildPrompt, generate
app/js/rules.js          placement rule table
app/js/jsonprompt.js     JSON prompts without DOM: prompt text <-> the editor's model, subject ids and renames, part files,
                         placeholders, the saved prompts' folders
app/js/jsoneditor.js     the JSON prompt editor, a region of the Prompt panel (createEditor), and its sheets; the sheet machinery
                         the Prompt and Library panels share (createSheet, stack, button, note, focus, TreeRow, resolve, resolveSaved)
app/js/parts.js          the JSON prompt's library client: the library (GET /snugui/parts), reload / sync, edit, mtime, "change" events
app/prompt/schema.json   the JSON prompt schema
app/prompt/parts/        the starter parts library, copied into the parts folder (below)
app/js/panels/toolbar.js toolbar: run status, timer, node / total progress bars, main.js's icon buttons, Cancel, Generate
app/js/panels/center.js  image / 3D model display, output row (tiles + cog), output pop-up, the phones' output button, gallery panel
                         (the results in history.js, the HD layer in quad.js)
app/js/panels/prompt.js  Prompt panel: workflow name, Save / Load, Text / JSON switch, prompt box or JSON editor, folding negative
                         prompt, seed row
app/js/panels/library.js Library panel: the library on disk (saved prompts, presets, parts, fragments), browsed and edited
app/js/panels/input.js   Input panel: the workflow's inputs (everything the prompt and LoRA panels do not take)
app/js/panels/config.js  Configuration panel: settings of the page's own UI (toolbar position)
app/js/panels/lora.js    LoRA panel(s) + LoRA Manager API client
app/js/panels/lights.js  Light panel: presets for the model's lights, PMREM environments, the room (grid + gradient sphere),
                         the Desktop View background
```

## Server (`__init__.py`)
- `GET /snugui` → `app/index.html` (Cache-Control: no-cache, no-store, must-revalidate). `GET /snugui/static/{path}` → files
  under `app/` (the same Cache-Control, correct JS MIME `text/javascript`, path containment enforced).
- `POST /snugui/snapshot` body = Snapshot JSON (object). Server adds `id` (uuid4 hex) and `created` (ms), writes
  `<ComfyUI user directory>/snugui/snapshot.json` (a sandbox with its own `--user-directory` never touches the real one), keeps it in memory, broadcasts `PromptServer.instance.send_sync("snugui_snapshot", {"id": id})`
  (no sid → all sockets). Returns `{"id": id}`.
- `GET /snugui/snapshot` → current snapshot JSON or 404 `{"error": "no snapshot"}`. Loaded from disk at import if present (an unreadable file is
  ignored with a `logging` warning).
- Parts folder (the JSON prompt's library): folder key `snugui_parts`, registered with `folder_paths.add_model_folder_path` (appended,
  not default) as `<base>/snugui/parts`, `<base>` = the first `download_model_base` path when that key exists (Comfy Desktop sets it
  in its extra models config, with `is_default`), else `folder_paths.models_dir`. The library is
  `get_folder_paths("snugui_parts")[0]`, so a `snugui_parts:` line in the user's extra_model_paths YAML (loaded before custom
  nodes) wins. At every start each file of `app/prompt/parts/` missing from it is copied in (folders created); an existing file is
  never overwritten or changed, so a deleted starter file comes back on the next start.
- `GET /snugui/parts` → the library, `{ values: { "<field key>": text }, fragments: { "<name>": text }, presets: { "<type>": {
  "<name>": subject } }, prompts: { "<folder/…/name.ext>": text }, folders: ["<folder/…>"], mtimes: { "<kind>/<name>": µs } }`
  from `values/*.txt`, `fragments/*.txt`, `presets/*.json` and `prompts/` (every `.json` / `.txt` at any depth whose path matches
  `PROMPT_PATH`, every folder matching `PROMPT_FOLDER`, empty ones too; an unreadable preset or prompt file is skipped with a
  `logging` warning). `mtimes`: every file's `st_mtime_ns // 1000` (exact in a JS number), keyed `values/<key>`,
  `fragments/<name>`, `presets/<type>`, `prompts/<path>`.
- `POST /snugui/parts/edit` body `{ kind, name, op, … }`: one edit, applied to the file as it is on disk at that moment (read,
  change, write in one handler, no await between), answered with the library as above. `name`: a field key, fragment name or
  subject type (`PARTS_NAME` `[\w-]+(\.[\w-]+)*`) for `values` / `fragments` / `presets`; a saved prompt's path or a folder for
  `prompts` (`PROMPT_FOLDER`: names of words of `\w` and `-` joined by single spaces or dots, `/` between them; a prompt file also
  `PROMPT_PATH`, ending in `.json` or `.txt`). The path is resolved and must stay inside its kind's folder and not be it (the static
  route's `resolve().is_relative_to()` guard): nothing outside the parts folder is ever written, moved or deleted. Any edit may
  carry `mtime`: it is refused (409 `<name> changed on disk`) unless the file is there with that mtime.

  | kind | op | arguments: what it does |
  |---|---|---|
  | values, fragments, prompts | `write` | `text`, `mtime`?: the whole file; without `mtime` only a new file (409 `already exists`) |
  | values, fragments, prompts | `rename-file` | `to` (a name of the same kind; a prompt file keeps a `PROMPT_PATH`): rename or move a file or a prompts folder (409 when `to` exists or `name` is gone; 400 into itself) |
  | values, fragments, prompts | `delete-file` | `recursive`?: a file, or a prompts folder (409 `not empty` without `recursive`) |
  | prompts | `mkdir` | a folder, with its parents (409 when it exists) |
  | values, fragments | `add` | `group`, `text`: the part after its group's last line; a missing group is added at the end with it |
  | values, fragments | `add-group` | `group`: a `# group` line at the end, unless it is there |
  | values, fragments | `rename` / `delete` / `move` | `group`, `text`, `to` (the new text / the group to move it to): the first line of that group that is `text` |
  | values, fragments | `rename-group` / `delete-group` | `group`, `to`: its `#` line / it and its lines (`""`: the lines before the first group) |
  | presets | `set` / `rename` / `delete` | `key` (the preset name), `value` (an object) / `to`: add or replace / rename (409 when `to` exists) / delete |

  Lines are edited as they are in the file (other lines, their order and blank lines are kept); a group's lines run from its `#`
  line to the next one. A part or a group name must be one trimmed line, not starting with `#` (400). A line or group to change
  that is not there any more is 409 (`… is not there any more`). 400 for an unknown kind, op or bad arguments.
- Routes registered with `PromptServer.instance.routes` at import time. Security = ComfyUI's own (same origin).

## Snapshot schema (built by `web/snugui.js`)
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
    disabled: false,                   // no targets and the host node is muted (2) or bypassed (4) on the desktop: hidden on the page
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
gets a dedicated type (`PIXAROMA_SIZES`: the Input panel's size picker, in the size group); other JSON widgets are UNSUPPORTED text edits.

Pixaroma Group Switch (`PixaromaGroupSwitch:group_switch_ui`, a DOM widget with `serialize: false`; the node is in the API prompt with no
inputs but never runs) mutes or bypasses whole groups through `window.PixaromaPixGroup` (`listGroups`, `getGroupState`, `setGroupSwitch`).
Muting drops nodes from the prompt and bypassing also rewires their consumers, and the page has no graph, so the switches become prompt
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

## Desktop extension (`web/snugui.js`)
- `app.registerExtension({ name: "SnugUI", commands: [{id:"SnugUI.Open", label:"SnugUI", icon, function}],
  keybindings: [{combo:{key:"s", alt:true}, commandId:"SnugUI.Open"}], actionBarButtons: [{icon, label:"SnugUI", tooltip, onClick}] })`;
  the tooltip is "Send the App-mode workflow to SnugUI and open it (Alt+S)".
- On run: if workflow has no `extra.linearData.inputs` → toast "Configure App mode first". Else `window.open("/snugui",
  "snugui")` first (before any await, for the popup blocker), then build the snapshot and POST it. Toast success/error via `app.extensionManager.toast`, titled "SnugUI".
- Node definitions come from `GET /object_info/<class>`, one request per class for the page's lifetime (`nodeDef` caches the promise,
  so the inputs and outputs built in parallel share it; a failed request is dropped and retried by the next snapshot).

## Page architecture
### Shared contracts (implement exactly; panels depend on them)
`ui.js`:
```js
export const theme = { bg, panel, surface, surfaceHi, border, fg, muted, accent, danger, pressed, hover, font: "system-ui, sans-serif", radius: 18 }
                                    // bg, panel, surfaceHi, border, fg, muted, accent, danger: index.html's :root --bg, --panel,
                                    // --surface-hi, --border, --fg, --muted, --accent, --danger, which its CSS and help.js use too
export class Panel {                // a canvas-textured plane
  constructor({ name, widthM, heightM, pxPerM = PX_PER_M, bg = theme.panel, radius = theme.radius })   // export PX_PER_M = 1000   // canvas = round(widthM*pxPerM) x
                                    // round(heightM*pxPerM), max 2048; bg null = no slab
  mesh                              // THREE.Mesh, add to scene/group; mesh.userData.panel = this
  canvas; ctx; width; height        // canvas px
  add(widget) / remove(widget) / clear()
  invalidate()                      // redraw before next frame (Panel.updateAll() called by main each frame)
  pointer(type, x, y, pointerId)    // type: "move"|"down"|"up"|"leave"; x,y canvas px; routed to widgets (capture on down)
  hitTest(x, y) -> widget|null      // the topmost widget under (x,y)
  scroll(dy, x, y)                  // thumbstick/wheel; routed to the scrollable widget under (x,y)
  setPx(w, h, scale)                // Desktop View: w x h px (any size) drawn at scale canvas px per px; no arguments = the world
                                    // size at scale 1 (VR). A size change calls panel.onResize(), the module's re-flow
  resize(widthM, heightM)           // new world size at the same density; widgets keep their px positions, the caller re-flows them
}
export class Widget { x=0; y=0; w=0; h=0; visible=true; panel; parent (its ScrollView or Slider, null on the panel);
  hover; pressed; disabled; dragCapture=false (true: keeps the pointer on drag instead of handing it to a scrolling ancestor);
  draw(ctx){}; contains(x,y); hitTest(x,y) -> this|child|null; abs() -> {x, y} (top-left in panel px); relayout(){};
  onDown(p){}; onMove(p){}; onUp(p){}; onClick(p){}; onScroll(dy){ return false }; canScroll(){ return false }; invalidate() }
// Built-ins (constructor takes one options object; all have x,y,w,h):
Label{text, size, color, align, wrap}, Button{text, icon, round, onClick, variant:"default"|"accent"|"danger", toggled} (icon: an icons.js
  name, centered alone or left of the text, stroked in the text colour; round: circle / pill),
Toggle{label, value, onChange}, Slider{label, min, max, step, value, onChange, format} (drag + −/+ buttons; tapping the value edits it in place via an embedded TextField, "," ok, clamped + rounded to step),
List{items:[{label, value, sub?}], selected, onSelect, rowH, outline} (scrollable; outline: an accent border, Combo's dropdown),
TextField{value, placeholder, multiline, onInput, onDone, onCancel, onEdit, onKey, compact, barAbove} (+ EditBar, its edit toolbar, shown
  only while `setEditBar(true)`: main.js `setView` turns it on for the VR views, off for the Desktop View and phones; off by default),
Combo{options:[{label, value, url?}], current, rows, onChange} (TextField + dropdown List), ImageGrid{items:[{url | image (a canvas), label, value}], selected, onSelect, cell, bg, empty, corner, cornerLeft, onCorner} (scrollable, the
  `selected` value's tile outlined; `bg` the colour behind the tiles, null for none; `empty` the text shown without items; `corner` an
  icons.js name for a round button on every tile, `CORNER` 64 px inset `CORNER_PAD` 12 px from its top right corner (top left with
  `cornerLeft`): the badge's dark fill and the icon, tinted instead of the tile while hovered; a press on it (the button or its inset,
  `cornerAt(p)` -> index or -1) calls `onCorner(item, i)` instead of `onSelect`; `hotItem` / `hotCorner` are the indexes under the last
  move or press (-1: none), read with `hover`; a subclass draws its own tiles with `drawTile(ctx, item, i, x, y, s)` and calls
  `drawCorner(ctx, i, x, y, s)`, as center's Gallery does),
ScrollView{children} (vertical scroll container), Header{title, preview, open, right, h} (a folding section's row: chevron, bold title
  and, folded, a muted ellipsized preview; `right` px at its end left to buttons placed over it; the negative prompt's and the JSON
  editor's), helper `stackY(widgets, {x, y, w, gap}) -> nextY`.
List/ImageGrid thumbnails (`url`) load through a module-level cache of the 100 used last; `setItems` drops the widget's images of
the items gone.
```
`keyboard.js`: `export function editText({ initial, multiline, onInput(v), onSelection(), onKey(e), onDone(v), onCancel() }) -> textarea`,
plus `commit()`, `isEditing()`, `setXR(bool)`, `showKeyboard()`, `erase(dir)` and `newline()`. A hidden in-DOM `<textarea>` `ta` is the edit MODEL: its value and
selection are what the TextField draws and what taps move (selection APIs work on an unfocused textarea; never use `ta.select()`, it focuses).
Desktop (`setXR(false)`: a mouse press on the 3D view, and every press in the DOM hosts, dom.js `bindPanel`, so tablets and phones
type with their own keyboard, its caret, selection and backspace): `ta` is focused at edit start and takes the keys; blur, Enter in a
single-line field, Ctrl+Enter and `commit()` commit (onDone), Escape reverts (onInput(initial), onCancel).
XR (main.js calls `setXR` on session start/end; a finger press on the 3D view sets it too, so a touch screen in the VR-like view
uses the same path): the Quest system keyboard can only insert (each open starts an empty session whose first
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
(down anchors, move extends), a second tap within 400 ms selects the word. While editing in the VR views (XR session, VR-like view), an
`EditBar` overlays the panel below the field (above when there is no room or `barAbove`): Keyboard, New line (icon, multiline fields
only), Del, <-, ->, Select all, Done; `compact` (Slider value, Combo filter) is Keyboard, Del, Done. The Desktop View and phones have
no bar: the system keyboard edits `ta` itself, and a press away from the field finishes the edit (the only way for a multiline one on a
touch screen). A Combo's dropdown goes below the field, under its bar in VR (above the field when it does not fit). pointers.js commits
when a press lands away from every TextField and EditBar (on release). Only one edit at a time.

`comfy.js`:
```js
export class ComfyClient extends EventTarget {
  clientId                          // random uuid, used for /ws?clientId= and prompt client_id
  connect()                         // reconnects with backoff; "reconnected" when a socket that was open opens again
  getSnapshot() -> snapshot|null    // GET /snugui/snapshot
  queue(prompt, previewMethod) -> {prompt_id, node_errors}   // POST /prompt {prompt, client_id, extra_data: {preview_method}}; throws Error(message) on 4xx with node_errors summary
  interrupt()                       // POST /interrupt
  viewUrl({filename, subfolder, type})
  // events (CustomEvent detail): "snapshot" {id} | "status" {queueRemaining} | "cached" {nodes, prompt_id} | "executing" {node, prompt_id}
  // | "progress" {value, max, node, prompt_id} | "preview" {url (blob URL), prompt_id?} | "executed" {node, output, prompt_id}
  // | "done" {prompt_id} (executing with node null / execution_success) | "error" {prompt_id, message} | "interrupted" {prompt_id}
  // | "reconnected"
}
```
Binary ws frames: uint32 BE event type; 1 = PREVIEW_IMAGE (next uint32 BE image type 1=jpeg 2=png, then bytes);
4 = PREVIEW_IMAGE_WITH_METADATA (uint32 BE metadata length, JSON metadata incl. prompt_id and image_type (mime), then image bytes). See `server.py`/`protocol.py`.
Live previews: the server only sends them when the run's `extra_data.preview_method` names a method (execution.py `set_preview_method`; the
server default here is none). `queue()` sends the snapshot's `previewMethod` when it is auto/latent2rgb/taesd, otherwise "auto" (previews are
always wanted on the page). Previews are sent to the queueing client's socket only; the client drops type 4 frames whose prompt_id it did not queue
(or that is done: "done" drops it from the queued set).
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
store.groupState(id) / setGroupStates({id: state})   // "change" {key:"switchGroups"}
store.removedNodes() -> Set          // node ids the switched-off groups drop, kept by the store and recomputed by load / setGroupStates
store.outputActive(nodeId) / hasActiveOutput()
store.groups                         // from rules.js classify(): { prompt: input|null, negative: input|null, seed: input|null, left: [input], lora: [loraNode] }
```
LoRA write-back must mirror LoRA Manager: `inputs.loras` = list (wrapped as `{__value__: list}` if lorasWrapped) and
`inputs.text` regenerated the way `web/comfyui/lora_syntax_utils.js` (`applyLoraValuesToText`) does in comfyui-lora-manager.

`rules.js` — `classify(inputs, loraNodes)`, ordered rules, first match wins:
1. input on a LoRA Manager node (classType contains "LoraManager") → hidden (handled by the LoRA panel via loraNodes)
2. the prompt panel takes only these exact App-mode names and types, one of each; if a name appears twice the first in App-mode order
   wins and the others go to the Input panel:
   - `_prompt` with type STRING → `prompt`
   - `_negative_prompt` with type STRING → `negative`
   - `_seed` with type INT → `seed`
3. everything else → left, in App-mode order (no re-sorting; input.js renders store.groups.left as given). This includes multiline
   STRINGs and seed-like INTs with other names, and a `_prompt` / `_negative_prompt` / `_seed` of the wrong type.

The name is the App-mode label compared after trimming, exactly (case-sensitive). A leading `[Tab]` prefix is NOT stripped for this
match, so `[Tab] _prompt` is just an input called `_prompt` in the Input panel's tab `Tab`. Nothing else decides the placement: not the
widget name, the multiline flag, the node title or `control`. Existing workflows need these names set in App mode.

Each input is also copied with its name parsed: a leading `[Tab] Label` (whitespace trimmed, both parts non-empty) gives
`tab: "Tab"` and the bracket-free `label`; any other name gets `tab: "General"`. The groups hold these copies, so the Input panel shows
stripped labels (the snapshot and `store.inputs` keep the raw name; `key` is unchanged).

### Scene layout (meters, relative to the `ui` group, which recenter() places at head position + yaw, y = head height)
- Screen: on the vertical plane z = -0.5 (`SCREEN_DISTANCE`, eye at the origin), 32" diagonal at the aspect of what it shows (image;
  half width per eye in stereo; 16:9 when empty), centered at eye level; it resizes only when that aspect changes (center.js ->
  `screen.onChange`). A 3D output keeps the last size.
- Lectern (a group in main.js): its top edge centered under the screen, `GAP_SCREEN` 0.012 below the screen's bottom edge on the screen
  plane, tilted `LECTERN_TILT` 45° back about that edge (rotation.x = -45°: the surface faces up and toward the eyes, the near edge comes
  down toward the viewer). Laid out in its own plane, from its top edge down the slope, all centered, `GAP` 0.006 m apart:
  - the output row (center's `row`), only while `center.shows.row` (main.js sets its group's visibility);
  - the toolbar; it only moves when the output row comes or goes (up to the lectern's top edge without a row);
  - the one open panel of Prompt, Library, Gallery, LoRA, Light, Input, Configuration (1.8 x 1.15 each), unfolding toward the viewer.
- Output pop-up: upright (not tilted) in front of the screen's bottom edge, its bottom edge on it, its right edge over the cog's right
  edge, `POPUP_Z` 0.02 toward the viewer (no z-fighting with the screen).
- Every panel group has scale 0.35 (`PANEL_SCALE`); main.js `layout()` is the single place that positions them and sets the open
  panel's, the row's and the pop-up's visibility. Panels own their content and report what they need to show as plain values;
  the hosts (main.js for VR, desktop.js for the Desktop View, phone.js for phones) own placement and every host-specific mode. center reports
  `shows = { row, popup, note }` (the row has something: several outputs, or a single one with settings; the pop-up is open; a
  message is up) and `cogRect()` (the cog's box in the row, panel px), and calls `screen.onChange()` (main.js `relayout`) once when
  the stage's size or any of these changed. No host reads center's `mesh.visible` or its cog widget.
Each panel module exports `export function createXPanel(...) -> { group: THREE.Object3D, ... }` (plus `update(dt)` for center;
main.js also reads `panel`, the Prompt panel's `minHeight()` (its layout's smallest height) and `setPrompt(text, json)` (for the Library panel), center's `shows` / `row` / `cogRect()` / `popup` /
`closePopup()` / `pick` / `ringPick(on)` / `gallery` / `note` / `rowH` (the tile size, for the deck) and `model` / `image`; the lighting panel is `createLightsPanel(ctx, center.model) -> { group, panel, room, background }`, main.js
adds `room` to the scene; the Configuration panel is `createConfigPanel(onChange) -> { group, panel, minHeight(), toolbarAt() }`
(main.js passes `relayout`, called after a change, and hands `toolbarAt` to the deck); the toolbar is
`createToolbar(ctx, tabs, view, onError) -> { group, panel, arrange(dock) }` (main.js's panel buttons and view button, and
`onError(text)`, phone.js `toast`; `arrange` the phones' layout, below); center is `createCenterPanel(ctx, rowW, onPick)`, rowW the toolbar's
width, onPick() a tap on the phones' output button (phone.js `toggleTray`), which also returns `rowTile(size, vertical)`, layout only); the Input panel is `createInputPanel(ctx)`, the Prompt and LoRA panels (`createPromptPanel()`, `createLoraPanel()`) take nothing, the Library panel is `createLibraryPanel(setPrompt)`. The panels import three,
ui.js and state.js (the `store`) themselves; `ctx` only holds the page's objects, `{ scene, renderer, camera, screen, client, xr: {
isPresenting() }, desktopView() }`, and main.js gives the store its client (`store.client`).
main.js positions the returned group per the layout above (panel modules build their content at the group origin, facing +z).

### Toolbar and icons
One canvas panel (`toolbar.js`, "toolbar"), the same object in both views: on the lectern in VR, in the Desktop View's deck. A rounded slab
(`radius` 56 px) that never collapses. Top tier: the run status at the left and its timer at the right (monospace), then the node progress
bar (8 px, accent at 55 %) over the total progress bar (12 px). Bottom row: main.js's round icon buttons (100 px) Prompt, Library, Gallery,
LoRA, Light, Input, Configuration (main.js `PANELS`), a separator, the view button; then a flexible gap, Cancel (round, `x`,
`danger`; the plain grey `default` look and disabled when nothing runs or is queued) and Generate (pill, `accent`, 260 px; disabled
with no active output). The width follows the icon row (at least `MIN_ICONS` 6 buttons): more buttons, a wider toolbar.
- Phones: phone.js (the phone host) owns the dock: one grid, margin `PM` 16, button `PB` 80, the output row's own `TILE_GAP` and
  `COG` (center.js exports them), `BAR`, `spread`, the output button's slot and the `tabs` panel. The panel buttons move to that
  panel (radius 0, `BAR` 112 px thick), laid out along its longer side (a tab bar, or a rail when taller than wide) by `spread`: `PM` from both ends,
  the leftover spread evenly as the gaps between them; when the side is too short for gaps of at least `PM` the gaps stay `PM` and
  the buttons shrink below `PB` (a landscape window under 355 CSS px tall, a portrait one under 355 px wide), never below 0 (the
  hidden tab bar, back at `BAR` x `BAR` while the keyboard is up: a negative size would give a round button a negative radius,
  which throws and stops the frame loop). The view button and
  separator hide; the toolbar re-flows to the box it is given (`setPx`), radius 0, and draws into the boxes phone.js's
  `dock(w, h)` gives at its size (`arrange(dock)`: `{ status, cancel, generate, vertical }`, panel px; it only draws the status,
  timer, bars and the play pill itself): portrait (208 px tall: `3 * PM + TIER_H + PB`, toolbar.js exports `TIER_H`) the status tier (`PM` from
  every side) over Cancel and Generate on the tab bar's columns: Cancel over the first tab, Generate from the second tab's left edge to
  the last one's right edge; landscape (`BAR` wide, full height: the dock is two equal halves) the run column on the rail's rows (the
  same `spread`): rows 1–4 one status word (Ready, Queued, Running, Done, Interrupted, Error in red, Inactive for "No active output";
  28 px, shrunk to the column's width), the timer, then the node and total bars side by side, vertical, filling bottom-up to the
  bottom of row 4; Cancel on row 5 (level with Light); Generate a play pill from the top of row 6 to the bottom of row 7 (`play` icon,
  no text; a round button's icon follows its shorter side). While the row has something (`shows.row`) the first place of the run
  row / column is left free for center's output button (the dock's `slot`): portrait, the slot over the first tab, Cancel over
  the second, Generate from the third tab's left edge to the last one's right edge; landscape, the status on rows 1–3 (its bars end
  at the bottom of row 3), the slot on row 4, Cancel and Generate as before. The toolbar knows nothing about outputs or the dock's
  grid. A tap on "Error" or its timer calls `onError(message)`. `arrange(null)` puts the panel buttons back on the toolbar; phone.js
  then calls `setPx()` (world size, desk layout).
- The panel buttons are lit (`toggled`) while their panel is open: in VR they work like tabs (pressing one opens its panel on the lectern
  and closes the other, pressing the open one closes it; the open one is main.js `open`, "prompt" at page load and at the start of every
  XR session, not persisted); in the Desktop View they toggle the windows (desktop.js lights them from the windows' open state).
- View button: `rectangle-goggles` in the Desktop View (enters the VR view: requestSession inside its click handler where
  `isSessionSupported('immersive-vr')`, else the VR-like view), `monitor` in the VR view (back to the Desktop View: in an XR session it
  ends the session, `session.end()`, the session end does the rest; in the VR-like view it switches directly). A click that switches
  the view leaves no hover behind on the shared toolbar (pointers.js `pointerUp`).
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
| Library | `library-big` (not in the frontend's set; path data from Lucide) | main.js `PANELS` |
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
| Gallery thumbnail download button | `download` | center.js `Gallery` |
| LoRA library tile info button | `info` | lora.js |
| LoRA info sheet: copy the trigger words, copied | `copy` / `check` | lora.js `InfoSheet` |
| Seed: Fixed / Increment / Random | `lock` / `plus` / `shuffle` | prompt.js `MODES` |
| Prompt mode: Text / JSON | `text-initial` / `code` (not in the frontend's set; path data from Lucide) | prompt.js `ModeSwitch` |
| Save / Load a prompt | `save` / `folder-open` (the second not in the frontend's set) | prompt.js `Tool` |
| Saved prompts' tree: folder, JSON prompt, text prompt | `folder` / `file-code` / `file-text` (the last not in the frontend's set) | prompt.js sheets, library.js |
| Library: a part or fragment file, a group; back | `file-text`, `folder`; `arrow-left` | library.js |
| Dice (a random part, a random preset) | `dices` (not in the frontend's set; path data from Lucide) | jsoneditor.js |
| New line (edit toolbar) | `corner-down-left` (not in the frontend's set; path data from Lucide) | ui.js `EditBar` |

### main.js
- Views: the page opens in the Desktop View (below) when no XR session runs. The VR view is the XR session, or on a browser
  without `immersive-vr` the VR-like view: the same scene and panels as in the headset, seen from a desktop camera with mouse
  look. The toolbar's view button enters it and goes back, as does the end of an XR session. `?view=vr` opens the
  VR-like view directly (the dev / test entry). `setView(desk)` releases every pointer, shows the room (VR) or the flat background
  (Desktop View), resets the look, closes the output pop-up, resets the fov (70°) and the hint (VR-like view only), then
  `relayout()`: `layout()` and the windows (with the deck). `relayout()` is the one layout pass: the DOM hosts' own triggers (window
  resize, the visual viewport, a phone tab, the tray) call it too, and a change reported while it runs (center's `screen.onChange`, e.g. when
  a phone layout change closes the output pop-up) runs another pass after it instead of nesting one.
- On load: if `!window.isSecureContext || !navigator.xr` on Quest Browser (UA `OculusBrowser`), or with `?help`, show the help.js
  overlay explaining how to enable WebXR: `chrome://flags` → "Insecure origins treated as secure" → add `http://<location.host>`
  (prefilled, copyable) → Enabled → Relaunch; plus reminder that ComfyUI must listen on the LAN. Dismissible. Tablets and desktops
  reach the page over plain http too, so it is not shown there.
- VR only (`immersive-vr`, no AR / passthrough). optionalFeatures: ['local-floor', 'hand-tracking', 'layers']. The scene has a room
  (floor grid + gradient sphere, from lights.js) in VR and in the VR-like view. No tone mapping (renderer default).
- `renderer.xr.setFramebufferScaleFactor(1.5)`, `setFoveation(0)`, antialias on.
- Input (pointers.js, which main.js creates once the panels and the windows exist): for each XR input source (controllers and hands via targetRaySpace), draw a thin ray + cursor dot; raycast panel meshes;
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
  message), the image or 3D model, the room and the rays stay. Hidden panels are not raycast (pointers.js only collects visible panel
  meshes), so the image / model take every ray. Showing again restores the same open panel; panels keep their own state (scroll,
  tab). Hands have no B button.
- Output pop-up: closes on a press anywhere but on it and on the output row (VR: `pointerDown` with the panel hit, or nothing; Desktop
  View and phones: a capturing window `pointerdown` whose target is not the pop-up's or the row's canvas), on its cog, on Esc, on H, on a view
  switch, with the phones' tray and on a change of phone layout. A press on a tile keeps it open (it follows the new output).
- Mouse and touch on the 3D view (no XR session, pointers.js; the keys are main.js's): mouse click = pointer events, wheel = scroll on the hovered panel, R =
  recenter (the Desktop View: resets the image / model view), H = hide UI, Esc = close the output pop-up (and the phones' tray); the keys
  are ignored with Ctrl, Meta or Alt and in a DOM input or textarea (the help overlay's address). A drag off the image, the model and the panels looks
  around (yaw / pitch) in the VR-like view only. Each finger is a pointer of its own (`fingers`, keyed by pointerId, dropped on
  release). A second finger while another holds the image or the model pinches it: both slide it in one plane (`slide`, so the
  image's or the model's two-hand grab: their distance zooms it, their midpoint moves it); a finger turning the model first
  becomes a slide in the plane facing the camera at its press depth (the turn grab keeps `view` and `dist` for that), and the
  finger left after a pinch on the model turns it again. A third finger does nothing.
- 3D model (center's `model`): the model is "hit" when the ray reaches its box (`model.hit(ray)` -> distance) before any panel
  (pointers.js `viewHit`). A press on it turns it: while held, the
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
  screen frame and behind the panels). pointers.js `viewHit` returns whichever of model / image the ray reaches before any panel (the
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
  view. Both stereo eyes are in `view`, so they share the transform. HD: the quad layer (quad.js) takes width / height / transform from
  holeMesh's world matrix each frame (`applyPose` when it changed), so it follows the pan and zoom, and the hole mesh is in
  `view` with the image.
- Each frame: in the Desktop View `fitCamera()`; the pointers' `update(dt)` (the VR-like view's look, the panel meshes to raycast, the
  controllers); center's `update(dt)`; `Panel.updateAll()`.
- Snapshot: on start `client.getSnapshot()` → `store.load()`; if none, show "Send a workflow from ComfyUI (SnugUI / Alt+S)"
  in the center. On client "snapshot" event → fetch + `store.load()` (image history is kept). On client "reconnected" (a ComfyUI
  restart, a Quest sleep) → fetch, and `store.load()` only when its `id` differs from the loaded one, so the user's edits survive.

### Desktop View (desktop.js, main.js)
- Viewport: the whole window, a fixed camera at the eye looking straight at the stage (no look around), its vertical fov fitted each
  frame so the stage fills the image's box, desktop.js `stage()` (the window, or what a phone layout leaves; contain: `max(screen.h,
  screen.w / aspect)` at `SCREEN_DISTANCE`, aspect the box's), with `camera.setViewOffset(box.w, box.h, -box.x, -box.y, innerWidth,
  innerHeight)` moving the projection's center to the box's (rays from the whole canvas stay right; `setView` clears it for the VR
  views). The image or 3D model is therefore fitted to its box. When there is neither, the stage's message (no workflow, no images / 3D models yet,
  loading, missing file, load error: every text of center's `empty` label) is not shown on the 16:9 stage frame, which center
  hides in the Desktop View (`ctx.desktopView()`, each frame in `update()`), but in center's `note` panel: the same text, its
  width measured, 40 / 20 px padding, shown by desktop.js alone at the image box's center (scaled down to fit it; no chrome, clicks pass through) while
  `shows.note` (the message is up). A changed text re-places it through `screen.onChange`. `scene.background` is lights.js's
  `background`, a `THREE.Color` set to the lighting preset's horizon colour (`sky[1]`), so it follows the Light window; the room is
  hidden. The lights still light the model. Input on the 3D view as above: drag pans the image / turns the model, the wheel zooms
  about the cursor, shift- or right-drag moves the model; one finger pans / turns, two pinch-zoom and move.
- Windows: Prompt, Library, Gallery, LoRA, Light, Input, Configuration, one panel each. They host the same Panel objects as VR: each panel's own canvas
  is placed in a DOM window (`main.js` passes `createDesktop` one spec per window, `{ name, title, icon, button, panel, minW, minH(w) }`
  in panel px: `button` the toolbar's, lit while the window is open; the first size is the panel's VR size (1800 x 1150 for every
  window); `minW` / `minH(w)` the smallest
  its layout takes, the height at content width w (Prompt 560 wide, its height from prompt.js's `minHeight()`; Library 560 x 600; Gallery 500 x 500, LoRA 560 x
  700, Light 420 x 500, Input 560 x 500, Configuration 560 x its content's height, config's `minHeight()`). A snapshot load re-places the
  windows (the prompt panel's entries change its minimum).
  At 560 px (the phones' narrowest) the seed row drops its "Seed" label (narrower than `SEED_W`), the Configuration grid's labels
  shrink until the longest fits.
  `layout()` hides the lectern and the pop-up in the Desktop View; the meshes are not rendered. `screen.onChange` (stage size, output
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
  press, wheel = `panel.scroll`; a drag in a panel scrolls it as in VR). A press on a TextField keeps an edit, any other
  window press commits it on release; moving, resizing, closing, a toolbar button do too. The window layer keeps the focused textarea
  (mousedown, and touch pointerdown, prevented while editing). No edit toolbar: a finger tap that starts an edit focuses `ta` (the
  desktop path; the tap is its user activation), which opens the on-screen keyboard, and the system keyboard edits it with its own
  caret, selection and backspace.
  A re-flow during an edit (a rotation, the phone keyboard) keeps it: a Combo whose panel was rebuilt (Input / LoRA `panel.clear()`)
  adds its list back when drawn (in VR a TextField its EditBar too).
- Deck (`.deck`, fixed, above every window), placed by `renderDeck` from the Configuration panel's toolbar position (`at()`,
  `<top|bottom>-<left|center|right>`, default bottom-right): `EDGE` 16 px from the chosen edges, horizontally centered for center.
  The output row (while `shows.row`) sits `DECK_GAP` 8 px over the toolbar (desktop.js sets it as the deck's flex `gap`) at the bottom, under it at the top (the deck
  mirrors vertically, flex `column-reverse`), aligned with the toolbar on the deck's side (left / center / right); both are
  chrome-less canvases at `SCALE`. The output pop-up (while `shows.popup`) is absolutely placed `DECK_GAP` beyond the row
  (above it at the bottom, under it at the top), its right edge over the cog's (its left edge on the cog's for left positions).
  Narrower than the toolbar plus 16 px margins, the whole deck is scaled down about its pinned point (`transform: scale(k)`, with
  `translateX(-50%)` when centered; `transform-origin` = the position; drawn at `SCALE * devicePixelRatio * k`; no re-flow). A change
  of the setting re-renders it at once (main.js `relayout`); windows keep their geometry. The same pointer binding and edit-keeping
  as the windows. Hidden in the VR view and by H (its panels go back to their world size). The VR lectern ignores the setting.
- Persistence: localStorage `snugui.desktop` = `{ <name>: { x, y, w, h, open, z } }` (CSS px, w / h = the window's size
  with its title bar; prefs.js, the page works without it; the zoom version's `snugui.windows` is ignored; geometry stored
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
  Esc closes the output pop-up (and the phones' tray). Not with Ctrl, Meta or Alt, nor in a DOM input or textarea.
  Physical keys edit text through `ta` as before.
- Tablets: the same layout in landscape and portrait. Quest's 2D browser before entering VR: the controller pointer acts as a mouse.

### Phones (phone.js, desktop.js `update`, main.js)
- When: narrower than `PHONE_W` 600 CSS px = portrait; wider than tall and shorter than `LANDSCAPE_H` 500 px = landscape; else the Desktop View. Re-evaluated
  in desktop.js `update()` (window resize, rotation, relayout) and on `visualViewport` resize / scroll, which hands the layout to
  phone.js `render(mode)` first (null: not a phone; it gives the toolbar back before the deck takes it); the output row takes its
  phone tiles (`rowTile`) before the toolbar its layout, which keeps the slot free while the row has something; switching keeps the open panel, its
  scroll, the selected output and an open edit. Hidden (H) or in VR the layout is off (toolbar, row and panels back to VR geometry).
  Windows are hidden and their stored geometry untouched (it comes back on a wide window). The toolbar position setting and the
  view button do not apply.
- Units (dom.js): CSS px (the page; `EDGE`, `MARGIN`, `CASCADE`, `DECK_GAP`), panel px (layouts, widgets, `PM` / `PB` / `BAR`),
  canvas px = panel px x `panel.scale`; `SCALE` (desktop.js) and `PHONE` (phone.js) are CSS px per panel px; dom.js `sizePanel`
  sizes a canvas and its panel from them. A panel's world size is its px at `ui.PX_PER_M`
  1000 px per meter (unless it sets `pxPerM`).
- A `.phone` layer (fixed, z 6, clicks pass through but on its children) with `env(safe-area-inset-*)` padding, read back for
  the insets (`viewport-fit=cover`); its children are placed absolutely in CSS px. Panels are drawn at `PHONE` 0.6 CSS px per panel
  px and re-flow to their box (`put`: `setPx(w / PHONE, h / PHONE, PHONE * devicePixelRatio)`). No window chrome. Every margin and
  gap is the dock's `PM` (`gap` = 9.6 CSS px), so the tray's edges line up with the dock's buttons. The tray, the output button,
  the pop-up and the toast sit over the open panel (z-index 1).
- One panel at a time, `sheet` (Prompt at page load, not persisted): its toolbar button toggles it, the open one is lit. It takes all
  the room the dock leaves inside the safe area, edge to edge (no margin, radius 0: phone.js sets the panel's `radius` to 0 while it
  hosts it, desktop.js back to the panel's own when a window takes it), over the image, which is not resized for it; every panel, Prompt and Configuration
  too, fills that room. Closing it shows the image again.
- Output button (center's `pick`, a panel with one `OutputTile`, the selected output's: its latest result or its kind's icon, dimmed
  when inactive, the dot while another output has results not shown yet, the selection `ring` while the tray is open, set by
  phone.js through `ringPick(on)`; a tap calls center's `onPick`, phone.js `toggleTray`): whenever the row has something
  (`shows.row`: several outputs, or a single one with settings, whose tray holds the cog alone; otherwise the dock keeps its plain
  layout and there is no tray). phone.js passes
  the toolbar its boxes (`arrange(dock)`) on every `update()`, the slot free while `shows.row`, and puts the button over that square
  (`slot`), at its size (`PB` 80 px, 48 CSS px, like the tiles).
- Tray: tapping the button opens the output row (phone.js `tray`, the phone host's state; off phones the row shows whenever
  `shows.row`) in `.strip`, a box in the panel colour with a 1 px border colour ring and 24 px corners (phone.js sets
  them: the tiles' `TILE_R` plus `TILE_GAP`, the padding, at `PHONE`), its border the margin wide in the panel colour (phone.js sets the width to `gap`), so the
  tiles scroll inside the padding. `rowTile(button, landscape)` = tiles of the dock's button size `PB` 80 px (`TILE_GAP` 16 = `PM`
  apart, the cog `COG` 80 = `PB` too) with no length limit (center `placeRow`; tiles under `SMALL_TILE` 120 px draw no badge and no title),
  the cog last, start-aligned. Portrait: a row `gap` above the dock, left and right edges `gap` from the window's (inside the safe
  area), as tall as the tiles plus the padding, scrolling sideways (the canvas `touch-action: pan-x`, so a swipe scrolls and cancels
  the press). Landscape: a column (`.strip.v`) `gap` left of the dock, top and bottom `gap` from the window's, scrolling vertically
  (`pan-y`). It sits over the image or the open panel (the Gallery follows the selected output). A tile switches the output and keeps
  the tray open. It closes (phone.js `setTray(false)`, which also closes the pop-up through center's `closePopup()`) on the button again,
  on a press anywhere but on the tray, its pop-up and the button (phone.js, a capturing window `pointerdown`), on Esc (main.js calls
  `closeTray()`), when a tab opens or closes a panel (phone.js `toggle`), and on a change of layout (rotation, leaving the phone
  layout: `render(mode)`). It always starts closed.
  Pop-up, re-placed on tray scroll: portrait, its right edge over the cog's on screen (clamped inside the window, scaled down when the
  window is narrower than it), `gap` above the tray; landscape, `gap` left of the tray (scaled down to fit there), its bottom edge on
  the cog's (clamped inside the window).
- Portrait: the dock pinned to the bottom, full width: toolbar over the tab bar, a `.pad` in the panel colour under it over the bottom
  inset. The image (`stage`) and the open panel take everything above the dock, from the top inset. Keyboard up (an edit open and
  the visual viewport ending above the window): the dock (and the tray) hide, the panel ends on `visualViewport.offsetTop + height`.
- Landscape: the dock against the right edge, full height: the toolbar's run column then the tab rail, a `.pad` in the panel
  colour under both, over the right inset and the top / bottom ones. The image (`stage`) and the open panel take everything left of
  it, from the left inset, full height inside the safe area. Keyboard up: the panel takes the whole width from the top to the
  keyboard; everything else hides until it closes. Error toast (phone.js `toast(text)`): the whole message in a `.toast` centered
  at the foot of the image box (red text, no pointer events) for `TOAST_MS` 4 s.
- Touch on the image: the Desktop View's (one finger pans / turns, two pinch-zoom and move).

### Panels (behavior)
- center: shows the latest image (fit, keep aspect, then the user's pan / zoom) — XR quad layer for crispness when `layers` granted (hole-punch so the
  projection layer doesn't cover it; the HD button falls back to a mesh), mesh texture otherwise. Live previews from "preview" events
  while running; a batch shows its last image (all of them are in the gallery). An empty stage frees the image's textures.
  Gallery panel: a scrollable `ImageGrid` of the history (session list, also persisted to localStorage, last 50) of the selected
  output, newest first, the shown entry outlined; tap a thumbnail to show it. Its title names the output when there are several.
  Each thumbnail has a round download button (the ImageGrid's `corner: "download"` in its top right corner; hovering it tints the
  button instead of the tile); a press on it (the button or its inset, `onCorner`) does not show the entry: an image opens its `/view` URL in a new tab (`window.open`), a 3D model downloads through a same-origin `<a href download>`
  named after the file (center.js `saveEntry`). Both run in the press's pointer up (the user activation; in an XR session the
  `selectend`), so the popup blocker lets the tab through. In an immersive session the new tab may pause VR on the Quest (untested).
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
  Selection is manual only and kept in localStorage `snugui.output.<workflowName>` (falls back to the first active
  output; an inactive saved one is not restored). With no outputs one catch-all output takes every node.
  Active output (`store.outputActive`): in the snapshot prompt (not muted / bypassed on the desktop) and not in `store.removedNodes()`.
  On a `"switchGroups"` change, if the selected output went inactive the first active one is selected (screen, gallery and pop-up
  follow; no switching back when it returns). With none active the selection and the screen stay as they are, Generate is disabled and
  the toolbar's status says "No active output". Inactive outputs keep their history, current entry and dot.
  Output pop-up (center's `popup`, 580 x 164 px card, radius 32, no title bar; open = `shows.popup`, the cog `toggled` while
  open): the selected output's name, then the controls of its kind, `kindControls[kind]()`. Image: Flat / 3D R/L / 3D L/R (side-by-side
  image, one half per eye on XR layers 1/2, persisted in `snugui.stereo`; previews stay flat), HD (disabled in stereo, on the
  desktop and while a 3D result is on show). Mesh: none yet (the cog is disabled). Picking an option keeps it open; nothing about it is remembered
  (it always opens at the cog). When the selection changes it follows the new output, closing when that one has no controls.
  Results come from `executed` events whose node is an output: images from `ui.images` (png/jpg/jpeg/webp) and 3D files (glb/gltf) from
  `ui["3d"]` = [{filename, subfolder, type}] (Save 3D Model, Save 3D / Preview 3D (Advanced), type temp for previews) or
  `ui.result[0]` = a path under output/ (deprecated Preview 3D); the same shapes the frontend's readModel3DOutput reads. Each output keeps
  its own current entry; a result for an output not on show only sets a dot on its tile.
  History persistence (history.js; localStorage `snugui.history`, last 50 of `{filename, subfolder, type, kind, node}`): entries of `type` temp
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
- prompt (Prompt panel, 1800 x 1150 px in VR, any size in the Desktop View): top to bottom, the workflow name (28 px, top left)
  with Save, Load and the Text / JSON switch at the right end of its row (over the prompt box's right edge; only with a prompt box); the prompt
  box of `store.groups.prompt`, full width, taking all the extra height, or the JSON editor in its place (JSON prompt, below); the
  negative prompt of `.negative`; the seed row.
  Prompt boxes are plain multi-line TextFields without a label (full prompt, word-wrapped, clipped with "…");
  an empty box shows its name as a muted placeholder, "Prompt…" / "Negative prompt…" (gone as soon as there is text, back when it is
  emptied, also while editing); tap edits in place (live onInput) and store.set the whole text.
  Negative prompt: a header row (`ui.Header`: a chevron, "Negative" and, folded, the start of its text in muted, ellipsized) that folds
  and unfolds it on a tap; unfolded, its box (140 px, at most half the space the two boxes share) sits under the header and the
  prompt box shrinks. Folded by default; the state is kept in localStorage `snugui.negative` (`open` / `closed`).
  Missing entries leave no empty box: only the negative one (not in the owner's spec) is a plain box, alone, full height, with no
  header; neither leaves the space empty.
  Seed row (64 px, at the bottom, `SEED_W` 680 px wide at most, left-aligned) for `store.groups.seed` if any: "Seed", −, value field,
  +, then the mode icons `lock` = fixed, `plus` = increment, `shuffle` = randomize, the current one `toggled`. Without a seed the boxes
  take its place. Run status, progress, Cancel and Generate are on the toolbar. `minHeight()`: name + 3 prompt lines (with a box) + the
  negative header + the seed row (unfolding the negative prompt at that height shares the space).
- input (Input panel, titled "Input"; "No inputs in this workflow" when empty): scrollable list of controls from
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
  and resets the scroll. The selected tab is kept in localStorage `snugui.tab.<workflowName>` and falls back to the first tab
  when missing. Duplicate labels get the `nodeTitle ›` prefix only within the same tab.
- lora (LoRA panel): one section per loraNode (tabs if more than one). Stack list: name, active toggle, strength −/value/+ (step 0.05;
  the value is a compact TextField like the Slider's: tapping selects it to type a number, "," accepted as decimal separator, stored
  rounded to 2 decimals, not clamped, anything else reverts; clip strength follows while equal), remove ×. Row edits apply to the store's
  current list, matched by name (unique per node): the weight field commits only after a press elsewhere has run (× on another row,
  or the same row's −, + or checkbox, which replace its entry; the typed weight then lands on the new entry).
  Library: search TextField (live onInput → debounced 250 ms autocomplete suggestions, 8) + ImageGrid of results (cell 250 like the gallery and lights; a page is what the
  grid holds without scrolling, `ImageGrid.pageSize()`, at most 100; re-sized on a re-flow or the stack growing, keeping the first
  tile shown on the page; paging buttons, thumbnails from item.preview_url, labelled and suggested by item.file_name; videos → use
  no-preview `/loras_static/images/no-preview.png`). No query:
  `GET /api/lm/loras/list?sort_by=name&page_size=<n>&page=<p>`. With a query: LoRA Manager's `search` only matches file_name and
  model_name (tags / creator are opt-in; `folder` / `folder_include` are prefix filters ANDed with it), so every page of the list is
  fetched (page_size 100, its cap) and filtered here, case-insensitively, on the path relative to the LoRA root
  (`item.folder + "/" + item.file_name`, no extension) or model_name, keeping LoRA Manager's name order. The matches are kept for the
  current query (paging and suggestions reuse them, a changed query refetches) and paged locally. Selecting adds `{name: item.file_name,
  strength: usage_tips.strength ?? 1, clipStrength: usage_tips.clipStrength ?? clip_strength ?? strength, active: true}` (dedupe by name).
  Each library tile has an info button in its top left corner (`corner: "info"`, `cornerLeft`). Info sheet (`InfoSheet`, added last so
  it is over the panel; it sits at 0, 0, draws in panel px and `draw()` places its box for the hit tests): opens while a pointer (mouse,
  VR ray) is on a tile's info button and stays while one is on that tile or on the sheet, else it closes; touch has no hover, so a
  press on the info button pins the tile's sheet (again: unpins; a tile press, a new page or query unpin it too) and a hovered sheet
  wins over the pinned one. `INFO_W` 600 px wide (the panel's width less the margins when narrower), its height from its content;
  touching the tile so the pointer can cross onto it: right of it, left without room, else (a phone) under it or above it, top aligned,
  clamped inside the panel; `theme.panel` fill, `theme.border` hairline. Content, only the lines that have a value: bold model_name,
  muted `folder/file_name`, then label / value rows: Base model (base_model), Strength (newLora's strength, "clip" when it differs; 1
  without usage_tips), Trigger words (civitai.trainedWords joined with ", ", one line, ellipsized) with a Copy button (`COPY` 48 px,
  `copy` icon, `check` for `COPIED_MS` 1.5 s after a press), Tags (2 lines), Size (file_size in MB, one decimal), Notes (4 lines),
  wrapped rows ellipsized. Copy copies the whole joined text through a temporary read-only textarea's selection and
  `document.execCommand("copy")` from the press (`navigator.clipboard` needs a secure context, and SnugUI is mostly served over plain
  http on the LAN); focusing it commits an open edit, as the press's release would. A press anywhere else on the sheet does nothing
  and does not reach the tiles under it.
- lights: title + an `ImageGrid` of 7 square preset tiles as wide as the panel (cell 250: 6 columns in VR; the Desktop View's
  window re-flows it), each the preset's sky gradient (`skyCanvas`, the colours `paintSky` gives the room) with the preset name as
  its label, drawn like the LoRA library tiles; the current one outlined (`selected`, as the gallery outlines the shown entry). Applied instantly, no sliders, whatever output is shown: Neutral studio (default), High-key studio,
  Dramatic rim, Warm dark, Daylight outdoor, Overcast, Golden hour. The choice is kept in localStorage `snugui.lighting`.
  Each preset (table in lights.js) gives key / fill / rim `[color, intensity, x, y, z]` (x y z towards the light in the stage frame,
  +z towards the viewer), the hemisphere `[sky, ground, intensity]`, a 3-stop sky gradient (top, horizon, bottom) and `env`
  `[panel side, radiance gain]`. The room's sphere is painted with the preset gradient and `scene.environment` is the preset's PMREM:
  `PMREMGenerator.fromScene` of a small scene (the same gradient on a sphere plus one emissive square per light, in its direction and
  color), generated on first use and cached per preset (one generator kept). Images stay unlit.
  `scene.environmentRotation.y` follows the ui yaw on recenter so reflections turn with the lights. The panel also returns
  `background` (the horizon colour), the Desktop View's `scene.background`. Only the model's
  MeshStandardMaterial reads the environment and the lights; panels and images are MeshBasicMaterial with `toneMapped: false`.
  At most 3 directional lights, no shadows.
- library (Library panel, 1.8 x 1.15 m in VR, `createLibraryPanel(setPrompt)`, setPrompt the Prompt panel's): the library on disk
  (parts.js). Top to bottom: "Library" (34 px bold) with the last message at the right of its row (muted, red for an error); a tab
  row Prompts, Presets, Parts, Fragments (`toggled`; on a narrow panel the labels shrink until the longest fits); a search line
  (substring, case-insensitive) with "+ New" and "+ Folder" (Prompts) or "+ Group" (Parts / Fragments inside a file) at its right;
  then the list (`TreeRow`s in a ScrollView) and the detail of the selection (a ScrollView of `stack()`ed items). Panels at least
  `WIDE` 1100 px wide put the detail right of the list (the list 42 %); narrower ones (phones, a narrow window) show the list, and
  the detail in its place once something is selected or a form is open, with a "Back" row at its top. A tab switch clears the
  search and the selection.
  - Prompts: the saved prompts' tree (folders fold; a tap on a folder selects it and opens it, a second tap on the selected one
    folds it); with a query, the folders and prompts whose path matches, flat, their folder as the sub. A prompt: its folder, its
    name (commit renames it, extension kept), "Load into prompt" (accent; the slot sheet over this panel when it has slots, then the
    Prompt panel's `setPrompt`; disabled without a prompt box), Delete, its text (JSON for a `.json`, which must parse; Save writes
    it with the mtime it was read at), "Move to" the other folders ("No folder" first). A folder: its name (commit renames it),
    Delete (asks again; a folder with content says how many items go with it, then deletes recursively), "Move to" (not into
    itself). "+ New": a name, then "Create text" (`.txt`, empty) or "Create JSON" (`.json`, `{}`), in the selected folder or the
    selected prompt's; "+ Folder": a name, Create (`mkdir`).
  - Presets: by subject type (the schema's, then any other presets file), each preset with its id as the sub. A preset: its name
    (commit renames it), its JSON (an object; Save writes it with `set` and the file's mtime), Delete. "+ New": a name, then
    "Create <type>" for each schema type (`{ type }`).
  - Parts / Fragments: the files (`values/` / `fragments/`), their line count as the sub; a tap opens one: "All fields" / "All
    fragments" (back), the file, then its groups (count as sub) each followed by its lines (indented; a line naming a missing
    fragment has the warning tint). The file: its line and group counts, its name (commit renames the file), "Edit file as text"
    (the whole file in one multiline field, Save writes it with the mtime it was read at, Cancel), Delete. A group: its name
    (commit renames it; "Ungrouped" has none), "+ Part" / "+ Value", Delete (asks again with its line count; the lines go too). A
    line: its group, its text (commit renames it), Delete, "Move to" the other groups. "+ New" in the file list: a new empty file
    (a field key, a fragment name); inside a file: a part / value added to the selected group (or the selected line's, else
    Ungrouped); "+ Group": a new `# group` line.
  Every action is one `edit` (parts.js); success clears the message (or says "Saved …" / "Loaded … into the prompt"), a refused
  one says why in red (409: "… changed on disk: showing the version on disk", the detail's fields reset to the library as it is
  now). Delete buttons are plain until pressed, then ask again in `danger`. The detail's text fields are kept across re-renders and
  follow the library until the user types in them (each remembers the mtime it was read at); a selection the library no longer
  has is dropped. The panel re-renders on every library "change".
- config (Configuration panel, 1.8 x 1.15 m in VR; its window's minimum height is its content's): settings of the page's own UI, not of the workflow. Title, then
  "Toolbar position": a 3 x 2 grid of buttons laid out like the screen (top row Top left / Top center / Top right, bottom row Bottom
  left / Bottom center / Bottom right), the current one `toggled`; the grid re-flows to the panel's width. Kept in localStorage
  `snugui.toolbar` (default `bottom-right`). It places the Desktop View's deck only; shown and editable in VR too.

### JSON prompt (jsonprompt.js, jsoneditor.js, prompt.js)
A structured editor for JSON prompts (FLUX.2, Qwen-Image, Z-Image, Krea2, HiDream… read them) with a library of reusable parts, in
the Prompt panel of every view. No drag-and-drop, no hover-only affordance: everything works with a tap or a VR pointer.

Format: one schema of our own, sent as is to every model. The prompt text is the only state (no sidecar).
```json
{
  "scene": "a smuggler waiting in a cantina",
  "subjects": [
    { "id": "han", "type": "person", "appearance": ["short dark hair", "stubble"], "pose": "leaning on a crate, arms crossed",
      "action": "watching leia across the room" },
    { "id": "leia", "type": "person", "expression": "amused smirk" }
  ],
  "lighting": "warm practical lights, smoky haze",
  "camera": { "shot": "medium shot", "lens": "35mm" }
}
```
- Pretty-printed (`JSON.stringify(v, null, 2)`); empty strings, arrays and objects are dropped, a subject is always kept. A field
  holds chips: one chip is a string, two or more an array of strings (read back the same way). Keys in schema order, custom keys
  after them in the order they were added; JSON read from text keeps its own key order.
- Schema (`app/prompt/schema.json`, changed in the repo): `{ "prompt": spec, "subjects": { "<type>": spec } }`, a spec mapping each
  key, in order, to `"chips"`, `"subjects"` or a nested spec (a group). Top level: `scene`, `subjects`, `background`, `style`,
  `lighting`, `composition`, `mood`, `color_palette`, `text` (text in the image), `camera` (`shot`, `angle`, `lens`, `focus`).
  Subject types: `person` (`gender`, `age`, `appearance`, `clothing`, `pose`, `expression`, `action`, `position`), `animal`
  (`species`, `appearance`, `pose`, `action`, `position`), `object` (`description`, `material`, `position`). Any object takes custom
  chip fields (a key typed by the user).
- Subjects: `id` and `type` first. Ids are lowercase letters, digits and `_`, unique in the prompt; new subjects (and subjects read
  without one) get `<type>_<n>`, the lowest free n. A subject is referred to by its bare id in any text; renaming replaces the old id
  as a whole word (`\b`) in every string; deleting flags (warning tint) the chips still naming it until the prompt is reloaded or a
  subject takes that id again.
- JSON the schema does not know: the schema applies to an empty object or one with at least one schema key of the schema's shape;
  its missing fields then show as empty rows, each after the schema key before it. Any other object opens without loss,
  generically: a nested object is a folding group, an array of strings chips, an array of objects cards `#1`, `#2`… (`⋯` only
  deletes), a number / boolean / null a chip in the accent colour written back with its JSON type while its text still parses as
  one, any other array one chip holding its JSON. A generic field's key drops the array index (`objects.description`).

Prompt panel:
- The switch (`ModeSwitch`, 2 x 56 x 44 px): a bordered pair of small muted icons, `text-initial` (Text) and `code` (JSON), the current
  one on a `surface` fill with its icon in `fg`. Text mode: the TextField as before. JSON mode: the editor takes the prompt box's
  rect; the negative prompt (plain text) and the seed row are unchanged.
- Save and Load (`Tool`, 56 x 44 px each, 8 px apart, left of the switch): bordered like it, a muted `save` / `folder-open` icon (fg
  on hover). Both work in Text and JSON mode and open the panel's sheet (the editor's sheet machinery, over the whole panel):
  - Save: "Name" (already editing), "Folder" (typed, `portraits/studio` nests new folders; or a tap on the folder list below: "No
    folder", then every folder indented by depth, the current one selected), then Save (accent; disabled while a name is not
    `validName`, with a red note). JSON mode saves the generated JSON as `<folder>/<name>.json`, Text mode the text as `.txt`. A
    path already in the library first turns the button into Overwrite (danger) with a note; Overwrite writes with the file's mtime.
    A refused write (409) reloads the library and shows the error in the sheet; a write closes it.
  - Load: a search line, then the saved prompts' tree (`TreeRow`s: folders first, by name, folded, a tap folds / unfolds them;
    prompts with `file-code` (.json) or `file-text` (.txt)); with a query, the prompts whose path contains it, their folder as the
    sub. A tap replaces the prompt: its slots are resolved first (the slot sheet, "Load"; a JSON prompt over all its strings),
    then JSON mode for a `.json` that parses as an object (its text read as by the switch), else Text with the text as is.
- Every snapshot load decides the mode: JSON when the `_prompt` text parses as a JSON object (starts with `{`), else Text, and closes
  any sheet. The switch overrides it until the next load; nothing is remembered. A press on it first commits an open text edit.
- Text → JSON: the text is read (a JSON object as above; plain text becomes a new prompt with the text as `scene`; empty, a new prompt
  showing every top-level schema section as an empty row) and the generated JSON is stored. Text starting with `{` that does not
  parse refuses the switch and shows "Not valid JSON: …" in `theme.danger` in place of the workflow name until the next prompt edit
  or mode switch (the same place shows a library load or save error). JSON → Text: the box shows the stored JSON (the generated
  JSON after an edit).
- The editor writes the generated JSON with `store.set(prompt key, text)` after every edit. prompt.js `refresh()` (every store
  `change`) only copies values and repaints; the editor keeps its own model and an open sheet. `layout()` (load, resize, fold,
  mode switch) gives the editor its rect and re-places an open sheet (`sheet.refresh()`).
- Library client (parts.js, shared with the Library panel): `library` (GET's shape), `reload()` (GET), `sync()` (a reload whose
  failure keeps the library as it was), `edit(body)` (POST /snugui/parts/edit; its answer replaces the library; a 409 reloads it,
  then throws the server's message with `conflict` set), `mtime(kind, name)`; `events` dispatches "change" whenever the library is
  replaced. Disk is the source of truth, with no sync button: the library is fetched at page load (prompt.js; a failure shows in
  place of the workflow name), when the Library panel's toolbar button is pressed (main.js), when a picker, slot or Load sheet opens,
  and on `visibilitychange` to visible. Line, part and preset changes are edits the server applies to the file as it is (edits
  made on the side are kept); whole-file writes carry the mtime the page read and are refused when the file changed since. An
  open sheet re-runs its content on every "change" (prompt.js, library.js). The editor's library changes: "Add & save" / "Save as
  part" = `add`, "Save as preset" = presets `set` (the same name replaces it); a refused one shows in place of the workflow name.

Library (the parts folder, Server above):
```
parts/
  values/<field key>.txt      lighting.txt, person.pose.txt, camera.angle.txt, person.tattoo.txt
  fragments/<name>.txt        color.txt, fabric.txt: the values a {name} placeholder takes
  presets/<type>.json         person.json: { "Han Solo": { "id": "han", "type": "person", … } }
  prompts/<folder>/…/<name>.json | .txt   saved prompts, in nested folders of any depth
```
- Field key: the field's path with the subject's type in place of `subjects[i]` (`lighting`, `camera.angle`, `person.pose`). Person
  `pose` and animal `pose` are separate libraries. A custom field's file is created the first time a part is saved to it.
- Value file: one part per line, `# Group` opens a group, blank lines ignored; the text is its label. A new part's whitespace is
  collapsed; the server edits lines in place (other lines, blank lines and the order are kept; an empty group stays as its `#`
  line); a part may not start with `#`.
- Preset: a whole subject saved under a name (the same name overwrites); adding one gives it the preset's id when free, else
  `<type>_<n>`. Placed parts are copies: editing the library never changes a prompt.
- Fragment: a named value list, `fragments/<name>.txt`, in the value file format (names: the field keys' characters,
  `[\w-]+(\.[\w-]+)*`). A `{name}` placeholder in library text (a part, a preset's string values, a saved prompt) is a slot that takes one of its
  values; braces in a fragment's values stay literal (no nesting); a placeholder naming no fragment stays literal text (its part
  is flagged in the picker: warning tint and border). Text the user types is never resolved, its braces stay literal.
  Resolution happens when a library text is placed (jsonprompt.js `segments`, `fill`, `fillRandom`, `strings` / `withStrings` for a preset's
  strings): the chip or subject then holds plain text.
- Saved prompt: one file per prompt, a JSON mode one as `.json` (the generated JSON), a Text mode one as `.txt`; only saved prompts
  use folders (parts and fragments keep `# Group` lines, presets one file per type).
- Starter set (`app/prompt/parts/`): a value file for every chip field of the schema (10–20 parts for the common ones, 5–15 for the
  rarer, a few with placeholders: `{color} t-shirt`, `a quiet street at {time_of_day}`), fragments `color`, `fabric`,
  `hair_color`, `material`, `time_of_day` (9–14 values), `presets/person.json` (Hiker, Barista, Painter; Hiker with placeholders),
  empty `animal.json` / `object.json`.

Editor (`createEditor({ panel, sheet, schema, onChange(text), onError(text) })` -> `{ layout(rect), show(), hide(), load(model) }`;
`sheet` the panel's `createSheet(panel)` -> `{ open(name, content), refresh(), close() }`, one sheet at a time; hidden until
`show()`, `hide()` and `load()` close the sheet; `resolve(sheet, title, texts, label, onDone)` and `resolveSaved(sheet, path,
onDone(text, json))` fill slots in any panel's sheet):
```
▾ Scene        (a smuggler waiting in a cantina) [+][dice]
▾ Subjects                                 [+ Person][▾]
   ▾ han · person                            [dice][⋯]
       appearance  (short dark hair) (stubble) [+][dice]
       pose        (leaning on a crate) [+][dice]
       [+ field]
▸ Lighting   (golden hour rim light) [+][dice]
▸ Camera                                       [dice]
[+ field]
```
- One scrolling column in a box framed like the text box. Sections and cards fold (`ui.Header`; folded, a muted preview of their
  texts, the subjects' ids for `Subjects`); chip fields never fold (no chevron), a top-level one's bold label lined up with the
  sections' titles. Fold state
  is the editor's, not saved. Rows at least 1000 panel px wide put the labels in a column (lined up across nesting), narrower ones
  flow the chips after the label; top-level labels are capitalized, `_` shows as a space. Chips wrap to the next line, a chip longer
  than the row wraps its text (`ui.wrapLines` with `ui.measure`); every line keeps room for `+` (and the dice).
- Dice (`dices`; the editor rebuilds its rows on every library "change", so they follow the library): after `+` on a chip field
  whose field key has parts (none without), it replaces the field's chips with one random part, its slots filled at random
  (`fmt.fillRandom`). On a subject card's header (left of `⋯`) and a group's (`camera`), when one of its chip fields (its groups'
  too, not cards) has parts: one random part in each EMPTY such field, the others kept. None on the whole prompt or `Subjects`.
- Sheets (picker, slot sheet, chip sheet, save as part, subject menu, preset name, add a subject, new field): a card (at most 1100 px wide) with a
  title and a close button over the whole Prompt panel, dimmed; its content scrolls; a tap outside the card closes it (committing an
  open edit). A text field's edit bar goes above it, so it never hides the sheet's buttons; a field in a row of buttons takes the room
  they leave.
- Picker (`+`): first the free-text line, already editing, "Add without saving…" (commit adds the chip) and "Add & save" beside it
  (disabled while empty: adds the chip, then the save-as-part sheet); then the search line (substring filter), "→ subject" (the
  prompt's subject ids, tap to add one as a chip), the field's parts by group (`TreeRow`s, tap to add; a part naming a missing
  fragment is flagged). Renaming and deleting parts is the Library panel's. Adding anything closes it; a part with slots opens the
  slot sheet.
- Slot sheet (a picked part with slots, a preset with slots; `resolve(title, texts, label, onDone)`): the texts with their slots
  (`SlotText`: word-wrapped, each slot a box holding its value or `{name}`, the current one outlined in the accent colour, a tap
  makes it current), then a free line "Other value…" (commit fills the current slot) with Random (a random value for it), "Random
  all" (every slot) and the accent `label` ("Add chip", "Add subject"; disabled until every slot is filled), then the current
  slot's fragment values by group (a tap fills it and moves to the next empty slot). Without slots it is skipped.
- Chip sheet (tap a chip): its text already editing (live), move left / right, save as part, delete, "→ subject" (appends the id).
  Emptying the text deletes the chip. Save as part asks for a group (existing, "Ungrouped" or a new one typed).
- Subject menu `⋯`: rename the id (an invalid or taken id is refused with a message), save as preset (a name, the id by default),
  delete. `+ Person` adds an empty subject of the schema's first type; `▾` lists an empty subject of each type, "Random preset"
  (`dices` icon; only for a type with presets: one of them at random, its slots filled at random) and their presets (one with slots
  opens the slot sheet over all its strings).
  `+ field`: a key (refused when the object has it, or `id` / `type` in a subject), then an empty chip field at its end.

## Implementation notes
- ui.js: `Widget.draw(ctx)` is called with ctx translated to the widget's top-left → draw in local coords. Wrapping
  Labels compute their own `h` in `relayout()` (stackY calls it after setting w). `stackY` returns next y incl. trailing gap.
  Subclasses set option defaults via `super({...defaults, ...opts})`, not class fields. Extras: Button `disabled`, Slider
  `drag:false`/`bigStep`, Panel `bg:null` / `radius`, `Label.setText`, `List/ImageGrid.setItems`, `setRenderer`, `ellipsize(ctx, text, maxW)`,
  `wrapLines(ctx, text, maxW)` (word-wrapped `{ text, start }` lines, leading spaces kept), `measure` (a 2D context to measure text
  outside `draw()`), `drawChevron(ctx, x, y, open)`,
  `drawIcon(ctx, name, x, y, s)` (stroked in the current strokeStyle), `drawCover(ctx, img, x, y, s)`, and the drawing helpers the
  panels' own widgets share: `font(size, bold)`, `tint(ctx, widget, x, y, w, h, r)` (a widget's hover / pressed tint, none when
  disabled) and `drawTint(ctx, pressed, x, y, w, h, r)` (a part's: one of its buttons, rows or tiles), `inRect(p, r)` (a pointer
  event's local point in a part's box), `parseNumber(text)` (a typed number, "," accepted, or null: the Slider's value and the
  LoRA weight), `drawCaption(ctx, text, x, y, s, pad)` (a tile's caption strip: ImageGrid, the output tiles) and
  `drawSwitch(ctx, x, cy, on)` (`SWITCH_W` wide: Toggle, the Group Switch rows).
- localStorage only through prefs.js (`pref(key)`, `prefJSON(key)` -> string / parsed value or null, `setPref(key, value)`): storage that
  throws (disabled, some private windows) reads as empty and drops writes, so the page works without it. Callers keep their key
  names and their own validation.
- main.js builds in order: renderer and scene, ctx, the panels, the windows (createDesktop), then `screen.onChange = relayout`
  (a no-op until then: center reports its first state while it is created), the snapshot, the pointers, `setView`.
- `window.__snugui = ctx` for debugging (the page's objects; the modules are the page's own instances through
  `await import("/snugui/static/js/ui.js")`, `state.js`...). main calls `keyboard.commit()` on XR session start/end.
- comfy.js: client sends feature_flags supports_preview_metadata (previews carry prompt_id).
- state.js: `setSeedMode` also accepts "decrement". LoRA names are written as stored (no basename rewrite).
- Desktop snapshot POST goes to `/api/snugui/snapshot` (ComfyUI mirrors routes under /api).

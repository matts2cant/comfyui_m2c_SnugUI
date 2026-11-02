# SnugUI

Personal ComfyUI custom-node package (`comfyui_m2c_SnugUI`): one interface to tweak an App-mode workflow and generate from a
phone (portrait and landscape), a desktop browser or tablet (the Desktop View) or a Meta Quest 3 (Quest Browser, WebXR).
A "SnugUI" button in ComfyUI snapshots the current App-mode workflow; ComfyUI serves the page at `/snugui`, with the result
image or 3D model in the middle and the workflow's inputs in panels around it. It adds no nodes. No internet or CDN at runtime
(three.js is vendored in `app/vendor/`).

## Install

Put this folder in `ComfyUI/custom_nodes/` and restart ComfyUI. It needs nothing beyond ComfyUI itself; the LoRA panel uses
LoRA Manager and the Input panel shows Pixaroma's Group Switch when the workflow has them. The Sapiens2 nodes that used to ship
with this code are now in their own package, `comfyui_m2c_sapiens2_tools`; SnugUI shows their GLBs like any other 3D output.

## Setup

1. On the desktop, configure App mode for your workflow (choose the inputs and outputs).
2. In graph mode click "SnugUI" in the toolbar (or press Alt+S). This sends a snapshot to the server and opens `/snugui` in a
   browser tab. Sending again replaces the snapshot on every open page. A page that lost its connection (ComfyUI restarted, the
   phone or headset slept) loads a snapshot sent meanwhile when it reconnects, and keeps your edits if the snapshot is unchanged.
3. To use a phone, a tablet or the Quest, ComfyUI must be reachable from it. In Comfy Desktop: Settings -> Server Config ->
   listen address `0.0.0.0`, then restart ComfyUI. Allow the port (default 8000) through the Windows firewall if asked.
   Find the PC's LAN IP (`ipconfig`, the IPv4 address of your Wi-Fi/Ethernet adapter) and open `http://<pc-ip>:<port>/snugui`
   on the device.
4. Quest only: WebXR needs a secure origin and ComfyUI is plain http, so tell Quest Browser to trust it once:
   open `chrome://flags`, search "Insecure origins treated as secure", add `http://<pc-ip>:<port>`
   (for example `http://192.168.1.20:8000`), set it to Enabled, tap Relaunch.
   If Quest Browser opens the page without WebXR, it shows the same instructions with your address prefilled.

## Views

The page picks its layout from the window: the phone layout on a phone, the Desktop View on a wider window; the goggles button
on the toolbar enters VR. Every view has the same panels, Prompt, Library (saved prompts, presets, parts and fragments), Gallery,
LoRA, Light, Input (the workflow's inputs) and Configuration (settings of this page), and the same toolbar: the run status, a timer, two progress bars, Cancel and Generate.

### Phones

On a phone (a window narrower than 600 px, or a landscape one shorter than 500 px) the page uses a phone layout instead of
windows. Portrait: the image above a dock with the run status, Cancel and Generate (lined up over the first tab and the other
six) and a tab bar of the seven panels (tap one to open it, tap it again to close it). Landscape: the image at the left and a dock
along the right edge: a run column (one-word status, timer, upright progress bars, Cancel, a play button for Generate; tap a red
"Error" to read the whole message) and the tabs, on the same rows: Cancel level with the fifth tab, Generate with the last two.
An open panel takes all the room left by the dock, edge to edge, over the image; closing it brings the image back.
With several outputs (or a single image output, for its settings) the dock gets an output button showing the selected output (portrait: over the first tab, Cancel moves over
the second; landscape: level with the third tab), with a dot when another output has new results. Tap it to open the output tiles
in a small tray just above (portrait) or left of (landscape) the dock: tap a tile to switch outputs (the tray stays open; swipe
it when the tiles do not fit), or the cog for the output's settings. Tap the button again, anywhere else, a tab, or press Esc to
close it. Tapping a text field opens the phone's own keyboard (normal caret, selection and backspace); the open panel moves above
it (portrait: the dock hides; landscape: the panel takes the whole width) until you tap outside the field, which applies the
text. Pinch and drag the image to zoom and pan. Turning the phone keeps the open panel and any edit. The toolbar position setting and the VR button do not apply on
phones; a wider window brings the Desktop View back with its windows as you left them.

### Desktop View

Without a VR session a window wider than a phone's opens in the Desktop View, for a desktop browser or a tablet: the image or 3D model fills the
window over a flat background in the colour of the lighting preset, and the panels float in windows on top of it: Prompt,
Library, Gallery, LoRA, Light, Input, Configuration. With no image or model yet, the message ("No images yet"...) shows in a small box in
the middle. The toolbar sits in the bottom-right corner with the output tiles above it, both always on top of the windows (scaled
down to fit a narrow window). Configuration > Toolbar position moves them to another corner or to the middle of the top or
bottom edge (at the top the tiles go under the toolbar); it only applies to the Desktop View and is remembered. The toolbar's
round buttons open and close the windows; several can be open at once. Drag a title bar to move a window, its corner to resize
it freely (the text keeps its size, the content re-flows: a bigger prompt box, more rows in the lists), the X to close it; a click brings a window to the front. Positions, sizes and open windows are remembered (and pushed
back inside a smaller window). The first time only Prompt is open.

- Image: drag pans, the wheel zooms about the cursor. 3D model: drag turns it, the wheel zooms, shift- or right-drag moves it.
- Touch: one finger pans the image (turns the model), two fingers pinch to zoom and move it. Tapping a text field opens the
  on-screen keyboard.
- Text fields edit in place with the system keyboard: Enter (single-line fields), Ctrl+Enter or a click / tap outside the field
  applies the text, Escape reverts it.
- H hides the windows and the toolbar (H again shows them), R resets the image / model, Esc closes the output pop-up (not with
  Ctrl, Alt or Cmd held, nor while typing in a page field).
- The goggles button enters VR on the Quest. In a desktop browser it shows the VR layout instead (the VR-like view): drag to
  look, wheel to scroll, click to press, R recenters, H hides the panels; the monitor button in the same place comes back.
  `/snugui?view=vr` opens it directly.

### VR

On the Quest open `http://<pc-ip>:<port>/snugui` and press the VR button (goggles icon) on the toolbar, bottom right.
Layout: the image in the middle; under it a tilted lectern with, from the top: the output tiles (several outputs only), the
toolbar, then one open panel. The toolbar's round panel buttons each open their panel on the lectern and close the other;
press the open one again to close it. Then come Desktop View (monitor icon, leaves VR), Cancel and Generate. Prompt is open
when VR starts. Text fields have an edit toolbar with a Quest keyboard button. The controllers and hands are under Controls
below.

## Input tabs

Name an input in App mode as `[KSampler] Scheduler` to show it as `Scheduler` in a tab called `KSampler` on the Input panel.
Inputs without a bracket prefix go in `General`. Tabs follow the order of their first input; with a single tab no tab row is shown.
The selected tab is remembered per workflow.

## LoRA panel

Lists the LoRAs of the selected LoRA Manager node. Tap a weight to type it ("," works as decimal point); − / + step by 0.05.
The clip strength follows while it equals the weight. The search matches the LoRA's path under its LoRA folder (so `character` finds
everything inside a `Character` folder, at any depth) and its model name, ignoring case. The library shows LoRAs by file name, as many
per page as the panel holds.
The "i" in a tile's top-left corner shows the LoRA's info sheet (model name, path, base model, strength, trigger words, tags, size,
notes) while the pointer is on it; the sheet stays open while the pointer is on the tile or on the sheet. On a touch screen, tap the
"i" to keep the sheet open, and tap it again (or any tile) to close it. The copy button next to the trigger words copies all of them.

## Prompt panel inputs

The prompt panel only takes inputs with these exact App-mode names (trimmed, case-sensitive, and the type must match):

| Name | Type | Shown as |
| --- | --- | --- |
| `_prompt` | text (STRING) | "Prompt" box |
| `_negative_prompt` | text (STRING) | "Negative prompt" box |
| `_seed` | integer (INT) | "Seed" row (fixed / increment / random) |

Existing workflows need these names set on their inputs in App mode, or the inputs show up in the Input panel instead
(a prompt with another name, a seed called `seed`, a `_seed` of the wrong type). There is no `[Tab]` handling here:
`[Tab] _prompt` is an Input panel input. Only one of each; if a name is used twice, the first in App-mode order wins. The prompt box takes all the
height; the negative prompt is folded under a "▸ Negative" row showing the start of its text (tap it to open or fold it; remembered).
Without `_prompt` a lone `_negative_prompt` gets the whole area. Without `_seed` there are no seed controls (otherwise they sit
on a row of their own at the bottom). Empty boxes show "Prompt…" / "Negative prompt…" as a hint.

## JSON prompts

Models such as FLUX.2, Qwen-Image or Z-Image read structured JSON prompts. The small switch at the right of the workflow name,
above the prompt box, toggles the box between Text (the plain text box) and JSON (an editor that builds the JSON for you). The
prompt opens in JSON when its text is a JSON object, in Text otherwise. Switching to JSON turns plain text into the `scene` of a new
JSON prompt; text that starts with `{` but is not valid JSON stays text and the error shows in red in place of the workflow name.
Switching back to Text shows the generated JSON, which is also what Generate sends. The negative prompt stays plain text.

In the editor every field is a row of chips:

- `+` after a field opens the picker: type a free text at the top and press Enter to add it as is, or "Add & save" to also keep it
  in the parts library (it asks for a group). Below are the saved parts of that field by group: tap one to add it (rename and
  delete them in the Library panel). "→ subject" adds a subject's id, to refer to another subject in a text.
- A part can hold placeholders such as `{color} t-shirt` or `{color} {fabric} jacket`: picking it opens a sheet where you fill
  each `{…}` from that fragment's values (or type one, or Random; "Random all" fills them all), then "Add chip". Presets with
  placeholders work the same way.
- Tap a chip to edit its text, move it, save it as a part, delete it or append a subject's id.
- "+ Person" adds a subject; "▾" next to it adds an empty animal or object, or a saved preset. A subject's "⋯" renames its id (the
  texts naming it follow), saves it as a preset or deletes it. "+ field" adds a field of your own.
- The dice after a field's `+` (only on fields with saved parts) replaces its chips with one random part, placeholders filled at
  random. The dice on a subject or on Camera fills only its empty fields that have parts. "▾" also offers "Random preset" for the
  types that have presets.
- Headers fold their section; a folded one shows a preview of its content.

JSON from other tools opens as it is (nested groups, lists, numbers), without the schema's empty rows.

The two small buttons left of the switch save and load whole prompts, in Text and JSON mode. Save asks for a name and a folder:
pick one from the list or type a new one (`portraits/studio` makes nested folders); a JSON prompt is saved as `.json`, a text one
as `.txt`, and saving onto an existing name asks before overwriting. Load shows the folders (tap to open them) and a search line;
tapping a prompt replaces the current one and switches to JSON or Text to match. Placeholders in a saved prompt are filled first,
as for parts.

The parts library lives in `models/snugui/parts/` (Comfy Desktop: the `snugui/parts` folder of its models directory), one text file
per field in `values/` (`person.pose.txt`: one part per line, `# Group` lines start a group), one JSON file of presets per
subject type in `presets/`, the fragments in `fragments/` (`color.txt`, same format as the value files: the values `{color}` takes)
and the saved prompts in `prompts/`. A placeholder naming a fragment that does not exist stays as typed (the picker shows its part in
orange); braces you type yourself are never replaced. The files on disk are what counts: you can edit them by hand at any time, and
the page reads them again when the Library panel or a picker opens and when you come back to the tab; edits from the page change
only the line or entry they touch, so changes made on the side are kept. If a file you were editing as a whole changed on disk
meanwhile, saving is refused and the newer version shows. A starter set is copied in at every
ComfyUI start for the files that are missing; existing files are never overwritten (delete one to get the starter version back). To
keep the library elsewhere, add a `snugui_parts` line to your `extra_model_paths.yaml` (Comfy Desktop: its extra models config):

```yaml
snugui:
  snugui_parts: D:/prompt-parts
```

## Library panel

The Library panel (the books button, after Prompt) manages everything the prompt editor saves, in four tabs: Prompts (the saved
prompts' folders), Presets (by subject type), Parts (one file per field, then its parts by group) and Fragments (the same for
the placeholder value lists). Each has a search line, "+ New" and "+ Folder" / "+ Group". Pick an item to rename it (edit its name
and press Enter), move it to another folder or group, delete it (press Delete twice) or edit it: a part's text, a preset's JSON,
a prompt's text. A part or fragment file can also be edited as a whole ("Edit file as text"), and a saved prompt loaded into the
Prompt panel ("Load into prompt"). On a wide panel the details show beside the list; on a phone they replace it, with a Back row.

## Run status

The toolbar shows the run status: "Ready", "Queued · 2 ahead", the running node with its steps and the node count
("KSampler · step 5 / 8 · node 4 of 9", shortened when it does not fit), then "Done in 1:12", "Interrupted" or the error (red)
until the next run. The timer counts from the moment the run starts executing (not from the click) and stops with it. The thin
bar is the running node's steps, the thick one the whole run (nodes done, cached ones included).

## Group switches

A Pixaroma "Group Switch" added to App mode shows in the Input panel as a list of switches, one per group (colour dot, name, Mute or
Bypass tag), following the switch's rule (any number on, only one on, always keep one on). Switching a group off in SnugUI mutes or
bypasses its nodes in the prompts sent from SnugUI only; the desktop graph is not changed. Settings whose nodes are all switched off (or
already muted or bypassed on the desktop) are hidden, with their tab when it empties, and come back with their values when the group is
turned back on. Output tiles of switched-off outputs are dimmed; if every output is off, Generate is disabled ("No active output").

## Several outputs and 3D models

If App mode marks several output nodes, a row of square tiles above the toolbar (each output's latest result, its type and title)
picks which one the screen shows (remembered per workflow). A dot marks an output with new results; the view never switches on its
own. The Gallery follows the selected output. A workflow with a single output in App mode has no tiles. On phones the tiles are
in a tray opened from the dock's output button (see Phones).
The cog at the end of the row opens a small pop-up with the selected output's display settings (images: Flat / 3D R/L / 3D L/R and HD;
3D outputs have none yet, so the cog is greyed out while one is selected). It stays open while you pick, follows the selected tile, and closes on a press anywhere else, on the
cog or on Esc.
Outputs that save or preview a 3D model (Save 3D Model, Preview 3D...) show the GLB in front of you at the screen's size, just behind it.
Trigger-drag (or mouse-drag) on the model turns it, thumbstick up/down (or the wheel) while pointing at it zooms.
Squeeze the grip while pointing at it to grab it: it follows the controller until you let go. Grab it with both grips to
scale it (move the hands apart or together), turn it and move it. Recenter puts it back behind the screen at its first size.

Images zoom and move the same way, but only within their own plane and without turning: trigger-drag (or mouse-drag) pans it
(the point you grabbed stays under the ray), thumbstick up/down (or the wheel) zooms about the point you aim at, one grip drags
it sideways / up / down with the controller, both grips (or both triggers) pinch-zoom and move it. It can grow past the screen
and behind the panels (0.25x to 16x); panels in front of it still take your clicks. New images (previews, results, gallery picks,
output tiles) keep the zoom; it resets on recenter, on a Flat / 3D switch and when another workflow is loaded. In HD the
sharp layer follows the zoom.

The Light button opens lighting presets, shown as tiles of their sky colours (Neutral studio, High-key studio, Dramatic rim, Warm dark, Daylight outdoor, Overcast,
Golden hour) that change the 3D model's lights, its reflections and the room around you, also while an image is shown. The
choice is remembered. Panels and images are not lit.

## Controls

- Trigger or hand pinch: click. Drag on sliders and lists.
- Thumbstick up/down: scroll the list or panel under the ray; on the image or 3D model, zoom it.
- Trigger-drag on the image: pan it. On the 3D model: turn it.
- Grip (squeeze) on the image or 3D model: grab it. Left grip elsewhere (point away from the image): recenter the panels in front
  of you and reset the image / model.
- B (right controller): hide or show every panel, leaving the image or model; the same panels come back. Hands have no B button.
  Desktop: H.
- Desktop View (monitor icon on the toolbar): leave VR for the Desktop View.
- Gallery: the results of the selected output; tap one to show it. The download button in a thumbnail's top-right corner opens an
  image in a new browser tab and downloads a 3D model (in the headset, a new tab may pause VR).
- Cog at the end of the output row (image outputs only): Flat / 3D R/L / 3D L/R (side-by-side 3D images), HD (see below).
- Seed row: −, the value (tap to type), +, then the mode: lock = fixed, plus = increment, shuffle = random.
- HD: shows the image on a native XR quad layer for full sharpness. It is off by default and
  experimental; if the layer breaks the image falls back to the normal mesh on its own.
- Text fields edit in place: tap one to get a caret and, in VR only, a small toolbar (Keyboard, New line in multi-line fields, Del, arrows, Select all, Done). Tap to move
  the caret, drag to select, double-tap for a word. Keyboard opens the Quest keyboard, which only inserts text at the caret
  (use Del and the arrows for the rest). Done, tapping elsewhere or Enter (single-line fields) applies the text; Escape reverts it.

## Limits

- Images and GLB/glTF models only: video, audio and other 3D formats (OBJ, STL, FBX, splats...) are ignored.
- Large models (1M triangles, tens of MB) are untested on the Quest.
- Only widgets of the root graph that App mode exposes are applied; widgets of unknown type are edited as text.
- Changes made in SnugUI are not written back to the desktop workflow; they only affect the prompts sent
  from SnugUI.
- Quest-only paths (quad layer, system keyboard, hands, grabbing, the B button) are untested on hardware. Hands pinch to click and
  turn; grabbing with a hand only works if Quest Browser reports a hand squeeze.

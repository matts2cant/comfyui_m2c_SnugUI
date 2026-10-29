# AppMode XR

Part of the `ComfyUI_matts2cant` package. Personal ComfyUI extension: tweak an App-mode workflow and generate from a Meta Quest 3 (Quest Browser, WebXR).
An "Open in VR" button snapshots the current App-mode workflow; ComfyUI serves a WebXR page at `/appmode-xr`
with the inputs on floating panels and the result image in the middle. No internet or CDN at runtime
(three.js is vendored in `xr/vendor/`).

## Setup

1. ComfyUI must be reachable from the Quest. In Comfy Desktop: Settings -> Server Config -> listen address
   `0.0.0.0`, then restart ComfyUI. Allow the port (default 8000) through the Windows firewall if asked.
2. Find the PC's LAN IP (`ipconfig`, the IPv4 address of your Wi-Fi/Ethernet adapter).
3. WebXR needs a secure origin and ComfyUI is plain http, so tell Quest Browser to trust it once:
   open `chrome://flags`, search "Insecure origins treated as secure", add `http://<pc-ip>:<port>`
   (for example `http://192.168.1.20:8000`), set it to Enabled, tap Relaunch.

If Quest Browser opens the page without WebXR, it shows the same instructions with your address prefilled.

## Usage

1. On the desktop, configure App mode for your workflow (choose the inputs and outputs).
2. In graph mode click "Open in VR" in the toolbar (or press Alt+V). This sends a snapshot to the server.
   Sending again replaces the snapshot on every open VR page.
3. On the Quest open `http://<pc-ip>:<port>/appmode-xr` and press the VR button (goggles icon) on the toolbar, bottom right.
4. Layout: the image in the middle; under it a tilted lectern with, from the top: the output tiles (several outputs only), the
   toolbar, then one open panel. The toolbar shows the run status, a timer and two progress bars over round buttons: Prompt,
   Gallery, LoRA, Light, Input (the workflow's inputs), Configuration (settings of this page) (each opens its panel on the lectern
   and closes the other; press the open one again to close it), Desktop View (monitor icon, leaves VR), then Cancel and Generate.
   Prompt is open when VR starts. Text fields have an edit toolbar with a Quest keyboard button.

## Desktop View

Without a VR session the page opens in the Desktop View, for a desktop browser or a tablet: the image or 3D model fills the
window over a flat background in the colour of the lighting preset, and the panels float in windows on top of it: Prompt,
Gallery, LoRA, Light, Input, Configuration. With no image or model yet, the message ("No images yet"...) shows in a small box in
the middle. The toolbar sits in the bottom-right corner with the output tiles above it, both always on top of the windows (scaled
down to fit a narrow window). Configuration > Toolbar position moves them to another corner or to the middle of the top or
bottom edge (at the top the tiles go under the toolbar); it only applies to the Desktop View and is remembered. The toolbar's
round buttons open and close the windows; several can be open at once. Drag a title bar to move a window, its corner to resize
it freely (the text keeps its size, the content re-flows: a bigger prompt box, more rows in the lists), the X to close it; a click brings a window to the front. Positions, sizes and open windows are remembered (and pushed
back inside a smaller window). The first time only Prompt is open.

- Image: drag pans, the wheel zooms about the cursor. 3D model: drag turns it, the wheel zooms, shift- or right-drag moves it.
- Touch: one finger pans the image (turns the model), two fingers pinch to zoom and move it. Tapping a text field opens the
  on-screen keyboard; use the edit toolbar to delete and move the caret.
- H hides the windows and the toolbar (H again shows them), R resets the image / model, Esc closes the output pop-up.
- The goggles button enters VR on the Quest. In a desktop browser it shows the VR layout instead: drag to look, wheel to
  scroll, click to press, R recenters, H hides the panels; the monitor button in the same place comes back.
  `/appmode-xr?view=vr` opens it directly.

## Input tabs

Name an input in App mode as `[KSampler] Scheduler` to show it as `Scheduler` in a tab called `KSampler` on the Input panel.
Inputs without a bracket prefix go in `General`. Tabs follow the order of their first input; with a single tab no tab row is shown.
The selected tab is remembered per workflow.

## LoRA panel

Lists the LoRAs of the selected LoRA Manager node. Tap a weight to type it ("," works as decimal point); − / + step by 0.05.
The clip strength follows while it equals the weight. The search matches the LoRA's path under its LoRA folder (so `character` finds
everything inside a `Character` folder, at any depth) and its model name, ignoring case.

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

## Run status

The toolbar shows the run status: "Ready", "Queued · 2 ahead", the running node with its steps and the node count
("KSampler · step 5 / 8 · node 4 of 9", shortened when it does not fit), then "Done in 1:12", "Interrupted" or the error (red)
until the next run. The timer counts from the moment the run starts executing (not from the click) and stops with it. The thin
bar is the running node's steps, the thick one the whole run (nodes done, cached ones included).

## Group switches

A Pixaroma "Group Switch" added to App mode shows in the Input panel as a list of switches, one per group (colour dot, name, Mute or
Bypass tag), following the switch's rule (any number on, only one on, always keep one on). Switching a group off in VR mutes or
bypasses its nodes in the prompts sent from VR only; the desktop graph is not changed. Settings whose nodes are all switched off (or
already muted or bypassed on the desktop) are hidden, with their tab when it empties, and come back with their values when the group is
turned back on. Output tiles of switched-off outputs are dimmed; if every output is off, Generate is disabled ("No active output").

## Several outputs and 3D models

If App mode marks several output nodes, a row of square tiles above the toolbar (each output's latest result, its type and title)
picks which one the screen shows (remembered per workflow). A dot marks an output with new results; the view never switches on its
own. The Gallery follows the selected output. A workflow with a single output in App mode has no tiles.
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
- Gallery: the results of the selected output; tap one to show it.
- Cog at the end of the output row (image outputs only): Flat / 3D R/L / 3D L/R (side-by-side 3D images), HD (see below).
- Seed row: −, the value (tap to type), +, then the mode: lock = fixed, plus = increment, shuffle = random.
- HD: shows the image on a native XR quad layer for full sharpness. It is off by default and
  experimental; if the layer breaks the image falls back to the normal mesh on its own.
- Text fields edit in place: tap one to get a caret and a small toolbar (Keyboard, Del, arrows, Select all, Done). Tap to move
  the caret, drag to select, double-tap for a word. Keyboard opens the Quest keyboard, which only inserts text at the caret
  (use Del and the arrows for the rest). Done, tapping elsewhere or Enter (single-line fields) applies the text; Escape reverts it.

## Limits

- Images and GLB/glTF models only: video, audio and other 3D formats (OBJ, STL, FBX, splats...) are ignored.
- Large models (1M triangles, tens of MB) are untested on the Quest.
- Only widgets of the root graph that App mode exposes are applied; widgets of unknown type are edited as text.
- Changes made in VR are not written back to the desktop workflow; they only affect the prompts sent
  from VR.
- Quest-only paths (quad layer, system keyboard, hands, grabbing, the B button) are untested on hardware. Hands pinch to click and
  turn; grabbing with a hand only works if Quest Browser reports a hand squeeze.

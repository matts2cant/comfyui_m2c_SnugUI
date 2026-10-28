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

If the page opens without WebXR, it shows the same instructions with your address prefilled.

## Usage

1. On the desktop, configure App mode for your workflow (choose the inputs and outputs).
2. In graph mode click "Open in VR" in the toolbar (or press Alt+V). This sends a snapshot to the server.
   Sending again replaces the snapshot on every open VR page.
3. On the Quest open `http://<pc-ip>:<port>/appmode-xr` and press Enter VR.
4. Layout: the image in the middle; under it a tilted prompt panel like a lectern (workflow name, prompts, seed, progress,
   Generate, Cancel). A column of round buttons right of it opens one side panel at a time beside the screen: Gallery,
   LoRA, Light, Configuration (press the open one again to close it); the last button, X, leaves VR. Side panels start
   closed. Text fields have an edit toolbar with a Quest keyboard button.

The same page works in a desktop browser (`/appmode-xr`): drag to look, wheel to scroll, click to press, R recenters,
shift- or right-drag moves the 3D model. The X button does nothing there.

## Settings tabs

Name an input in App mode as `[KSampler] Scheduler` to show it as `Scheduler` in a tab called `KSampler` on the Configuration panel.
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

Existing workflows need these names set on their inputs in App mode, or the inputs show up in Configuration instead (a prompt
with another name, a seed called `seed`, a `_seed` of the wrong type). There is no `[Tab]` handling here: `[Tab] _prompt` is a
Configuration input. Only one of each; if a name is used twice, the first in App-mode order wins. Both prompts: the positive box takes
2/3 of the height and the negative one 1/3. Without `_prompt` a lone `_negative_prompt` gets the whole area. Without `_seed` there is
no seed row. Empty boxes show "Prompt…" / "Negative prompt…" as a hint.

## Group switches

A Pixaroma "Group Switch" added to App mode shows in Configuration as a list of switches, one per group (colour dot, name, Mute or
Bypass tag), following the switch's rule (any number on, only one on, always keep one on). Switching a group off in VR mutes or
bypasses its nodes in the prompts sent from VR only; the desktop graph is not changed. Settings whose nodes are all switched off (or
already muted or bypassed on the desktop) are hidden, with their tab when it empties, and come back with their values when the group is
turned back on. Output tiles do the same; if every output is off, Generate is disabled ("No active output").

## Several outputs and 3D models

If App mode marks several output nodes, a row of tiles above the prompt panel (image or cube icon and the node title) picks which one
the screen shows (remembered per workflow). A dot marks an output with new results; the view never switches on its own. The Gallery
follows the selected output. A workflow with a single output in App mode has no tiles; with several, the tiles of the
outputs still on stay visible even when only one is left.
Outputs that save or preview a 3D model (Save 3D Model, Preview 3D...) show the GLB in front of you at the screen's size, just behind it.
Trigger-drag (or mouse-drag) on the model turns it, thumbstick up/down (or the wheel) while pointing at it zooms.
Squeeze the grip while pointing at it to grab it: it follows the controller until you let go. Grab it with both grips to
scale it (move the hands apart or together), turn it and move it. Recenter puts it back behind the screen at its first size.

The Light button opens lighting presets (Neutral studio, High-key studio, Dramatic rim, Warm dark, Daylight outdoor, Overcast,
Golden hour) that change the 3D model's lights, its reflections and the room around you, also while an image is shown. The
choice is remembered. Panels and images are not lit.

## Controls

- Trigger or hand pinch: click. Drag on sliders and lists.
- Thumbstick up/down: scroll the list or panel under the ray.
- Grip (squeeze) on the 3D model: grab it. Left grip elsewhere: recenter the panels in front of you.
- Gallery: the results of the selected output; tap one to show it.
- Small panel above the prompt panel, right (image outputs only): Flat / 3D R/L / 3D L/R (side-by-side 3D images), HD (see below).
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
- Quest-only paths (quad layer, system keyboard, hands, grabbing) are untested on hardware. Hands pinch to click and
  turn; grabbing with a hand only works if Quest Browser reports a hand squeeze.

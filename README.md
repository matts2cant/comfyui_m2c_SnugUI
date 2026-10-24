# comfyui-appmode-xr

Personal ComfyUI extension: tweak an App-mode workflow and generate from a Meta Quest 3 (Quest Browser, WebXR).
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
3. On the Quest open `http://<pc-ip>:<port>/appmode-xr` and press Enter AR (passthrough) or Enter VR.
4. Layout: image and history in the middle, prompt/seed/Generate at the bottom, settings on the left,
   LoRAs on the right. Text fields open the Quest keyboard.

The same page works in a desktop browser (`/appmode-xr`): drag to look, wheel to scroll, click to press, R recenters.

## Controls

- Trigger or hand pinch: click. Drag on sliders and lists.
- Thumbstick up/down: scroll the list or panel under the ray.
- Left grip (squeeze): recenter the panels in front of you.
- Status bar above the image: Grid (batch view), HD (see below), To VR / To AR (switches mode).
- HD: shows the image on a native XR quad layer for full sharpness. It is off by default and
  experimental; if the layer breaks the image falls back to the normal mesh on its own.
- Text fields edit in place: tap one to get a caret (and the Quest keyboard), tap inside it to move the caret.
  Closing the keyboard, tapping elsewhere or Enter (single-line fields) applies the text; Escape reverts it.

## Limits

- Images only: output nodes that produce video or audio are ignored.
- Only widgets of the root graph that App mode exposes are applied; widgets of unknown type are edited as text.
- Changes made in VR are not written back to the desktop workflow; they only affect the prompts sent
  from VR.
- Switching AR/VR inside the headset ends the session and requests a new one; if Quest Browser refuses
  without a fresh click, press Enter AR / Enter VR again.
- Quest-only paths (quad layer, system keyboard, hands) are untested on hardware.

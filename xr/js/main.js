// Bootstrap and the VR host: renderer, scene, views (Desktop View, VR session, VR-like desktop view), the panels and their layout
// (the lectern), recenter, hiding the UI, the frame loop. pointers.js handles the pointer input.
import * as THREE from "three";
import * as ui from "./ui.js";
import * as keyboard from "./keyboard.js";
import { showHelp } from "./help.js";
import { createDesktop } from "./desktop.js";
import { createPointers } from "./pointers.js";
import { ComfyClient } from "./comfy.js";
import { store } from "./state.js";
import { createCenterPanel } from "./panels/center.js";
import { createPromptPanel } from "./panels/prompt.js";
import { createInputPanel } from "./panels/input.js";
import { createLoraPanel } from "./panels/lora.js";
import { createLightsPanel } from "./panels/lights.js";
import { createConfigPanel } from "./panels/config.js";
import { createToolbar } from "./panels/toolbar.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setClearColor(0x06080c);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setFramebufferScaleFactor(1.5);
renderer.xr.setFoveation(0);
document.body.prepend(renderer.domElement);
ui.setRenderer(renderer);

const scene = new THREE.Scene();
const FOV = 70; // VR-like view; the Desktop View fits it to the stage (fitCamera)
const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.05, 100);
camera.rotation.order = "YXZ";
const DESKTOP_EYE_HEIGHT = 1.6; // no XR session; XR recenters on the head pose
camera.position.set(0, DESKTOP_EYE_HEIGHT, 0);
const uiGroup = new THREE.Group(); // origin = eye, -z = viewing direction
uiGroup.position.y = DESKTOP_EYE_HEIGHT;
scene.add(uiGroup);

// ---- views ----
// Desktop View (the default without an XR session): fixed camera, flat background, the panels in DOM windows (desktop.js).
// VR view: an XR session, or its VR-like look-around on the desktop (?view=vr, the dev / test entry). The toolbar's view
// button enters it (goggles) and leaves it (monitor).
let deskView = params.get("view") !== "vr";
let xrSupported = false, needRecenter = false;

async function enter() {
	const session = await navigator.xr.requestSession("immersive-vr", {
		optionalFeatures: ["local-floor", "hand-tracking", "layers"],
	});
	session.addEventListener("end", onSessionEnd, { once: true });
	try {
		renderer.xr.setReferenceSpaceType(session.enabledFeatures.includes("local-floor") ? "local-floor" : "local");
		await renderer.xr.setSession(session);
	} catch (e) {
		session.end();
		throw e;
	}
	keyboard.setXR(true);
	keyboard.commit();
	needRecenter = true;
	open = "prompt"; // each session starts with the prompt panel
	setView(false);
}

function onSessionEnd() {
	keyboard.setXR(false);
	keyboard.commit();
	input.releaseAll();
	// three overwrites the camera pose while presenting
	camera.position.set(0, DESKTOP_EYE_HEIGHT, 0);
	uiGroup.position.set(0, DESKTOP_EYE_HEIGHT, 0);
	uiGroup.rotation.y = scene.environmentRotation.y = 0;
	setView(true);
}

// the toolbar's view button: in the Desktop View, an XR session where immersive-vr is supported, else the VR-like view; in the
// VR view, back to the Desktop View (ending the XR session, onSessionEnd)
function switchView() {
	keyboard.commit();
	if (!deskView) {
		const session = renderer.xr.getSession();
		return session ? session.end() : setView(true);
	}
	if (!xrSupported) return setView(false);
	enter().catch((e) => {
		$("hint").textContent = "Could not start VR session: " + e.message;
		$("hint").hidden = false;
		console.error(e);
	});
}
navigator.xr?.isSessionSupported("immersive-vr").catch(() => false).then((ok) => { xrSupported = ok; });

// the WebXR setup help only concerns Quest Browser (tablets and desktops reach the page over plain http too)
const needHelp = !window.isSecureContext || !navigator.xr;
if (params.has("help") || needHelp && /OculusBrowser/.test(navigator.userAgent)) showHelp({ insecure: !window.isSecureContext });

// ---- panels ----
// The screen is SCREEN_DIAGONAL_IN inches at the aspect of what it shows, on the vertical plane z = -SCREEN_DISTANCE (eye at the
// origin). Under it the lectern, tilted LECTERN_TILT back about its top edge, from the top down its slope: the output row when
// shown, the toolbar, then the one open panel (Prompt, Gallery, LoRA, Light, Input or Configuration), all centered. The output pop-up
// stands upright in front of the screen's bottom edge, above the cog. Every panel group has PANEL_SCALE, so px density and
// fonts match.
const SCREEN_DIAGONAL_IN = 32, SCREEN_DISTANCE = 0.5;
const PANEL_SCALE = 0.35, LECTERN_TILT = Math.PI / 4;
const GAP_SCREEN = 0.012, GAP = 0.006, POPUP_Z = 0.02;

// size of the screen, filled in by the center panel whenever the displayed aspect changes; onChange(): the screen's size or what
// center shows around it (center.shows) changed. Construction order: onChange stays a no-op while the panels and the windows are
// built (center reports its first state as it is created) and becomes relayout once createDesktop returned; the callbacks into
// `windows` (the panel buttons, the toolbar's onError, center's onPick) only run on later input.
const screen = { diagonal: SCREEN_DIAGONAL_IN * 0.0254, pxPerM: ui.PX_PER_M / PANEL_SCALE, w: 0, h: 0, onChange() {} };
// the page's objects, for the panels that need them (they import three, ui.js and state.js themselves)
const ctx = {
	scene, renderer, camera, screen,
	client: new ComfyClient(),
	xr: { isPresenting: () => renderer.xr.isPresenting },
	desktopView: () => deskView,
};
window.__xr = ctx;

function panelGroup(panel) {
	const group = new THREE.Group();
	group.add(panel.mesh);
	return group;
}

// the toolbar's panel buttons, in order: [name, icon, title (Desktop View window)]; then the view button (none on phones)
const PANELS = [["prompt", "pencil", "Prompt"], ["gallery", "images", "Gallery"], ["lora", "layers", "LoRA"], ["light", "sun", "Light"], ["input", "sliders-horizontal", "Input"],
	["config", "settings", "Configuration"]];
let open = "prompt"; // the panel on the lectern (one at a time, pressing it again closes it); every session starts with Prompt
let uiShown = true; // false: every panel hidden (toggleUI), the stage and what it shows stay
const tabs = PANELS.map(([name, icon]) => new ui.Button({ icon, round: true, onClick: () => {
	if (deskView) return windows.toggle(name);
	open = open === name ? null : name;
	layout();
} }));
const viewBtn = new ui.Button({ round: true, onClick: switchView });
const toolbar = createToolbar(ctx, tabs, viewBtn, (text) => windows.toast(text)); // the whole error, from a landscape phone's status

const center = createCenterPanel(ctx, toolbar.panel.width, () => windows.toggleTray());
const prompt = createPromptPanel();
const inputs = createInputPanel(ctx);
const loras = createLoraPanel();
const lights = createLightsPanel(ctx, center.model);
const config = createConfigPanel(relayout); // the toolbar position moves the Desktop View's deck
scene.add(lights.room);
const hosts = { prompt, gallery: { group: panelGroup(center.gallery), panel: center.gallery }, lora: loras, light: lights, input: inputs, config };

const lectern = new THREE.Group();
lectern.rotation.x = -LECTERN_TILT;
const rowGroup = panelGroup(center.row), popupGroup = panelGroup(center.popup);
const onLectern = [rowGroup, toolbar.group, ...PANELS.map(([name]) => hosts[name].group)];
lectern.add(...onLectern);
uiGroup.add(center.group, lectern, popupGroup);
for (const g of [...onLectern, popupGroup]) g.scale.setScalar(PANEL_SCALE);

function layout() {
	const { h } = screen;
	const size = (panel) => [panel.widthM * PANEL_SCALE, panel.heightM * PANEL_SCALE];
	center.group.position.set(0, 0, -SCREEN_DISTANCE);

	// lectern frame: origin at the middle of its top edge, x right, y up the slope; panels are placed by their top edge.
	// The toolbar only moves when the output row comes or goes.
	lectern.position.set(0, -h / 2 - GAP_SCREEN, -SCREEN_DISTANCE);
	lectern.visible = uiShown && !deskView;
	const at = (group, panel, top) => group.position.set(0, -top - size(panel)[1] / 2, 0);
	const rowH = center.shows.row ? size(center.row)[1] + GAP : 0, panelTop = rowH + size(toolbar.panel)[1] + GAP;
	rowGroup.visible = center.shows.row;
	at(rowGroup, center.row, 0);
	at(toolbar.group, toolbar.panel, rowH);
	for (const [name] of PANELS) {
		const { group, panel } = hosts[name];
		group.visible = name === open;
		at(group, panel, panelTop);
	}
	// the Desktop View lights the buttons of its open windows (desktop.js)
	if (!deskView) tabs.forEach((b, i) => { b.toggled = PANELS[i][0] === open; });
	viewBtn.icon = deskView ? "rectangle-goggles" : "monitor";
	toolbar.panel.invalidate();

	// the pop-up's bottom edge on the screen's, its right edge over the cog's, a little toward the viewer
	const { row, popup } = center, cog = center.cogRect(), [pw, ph] = size(popup);
	popupGroup.visible = uiShown && !deskView && center.shows.popup;
	popupGroup.position.set(((cog.x + cog.w) / row.width - 0.5) * size(row)[0] - pw / 2, -h / 2 + ph / 2, -SCREEN_DISTANCE + POPUP_Z);
}

// Desktop View windows: the same panels, sized to the window (panel px; first size = the VR size, min = what their layouts take).
// Phones show one at a time, taking all the room the dock leaves.
const MIN = { prompt: [560, prompt.minHeight], gallery: [500, () => 500], lora: [560, () => 700], light: [420, () => 500], input: [560, () => 500], config: [560, config.minHeight] };
const windows = createDesktop(PANELS.map(([name, icon, title], i) => (
	{ name, title, icon, button: tabs[i], panel: hosts[name].panel, minW: MIN[name][0], minH: MIN[name][1] }
)), center.note, {
	toolbar: toolbar.panel, arrange: toolbar.arrange, tabs, shows: center.shows, row: center.row, popup: center.popup, pick: center.pick,
	rowH: center.rowH, rowTile: center.rowTile, cogRect: center.cogRect, closePopup: center.closePopup, ringPick: center.ringPick, at: config.toolbarAt,
}, relayout);
screen.onChange = relayout;

// One pass at a time: a change reported during a pass (center's screen.onChange, e.g. when a phone layout change closes the output
// pop-up) runs another pass after it instead of nesting.
let laying = false, again = false;
function relayout() {
	if (laying) {
		again = true;
		return;
	}
	laying = true;
	do {
		again = false;
		layout();
		windows.update(deskView && uiShown);
	} while (again);
	laying = false;
}

function setView(desk) {
	deskView = desk;
	input.releaseAll();
	lights.room.visible = !desk;
	scene.background = desk ? lights.background : null;
	input.resetLook();
	center.closePopup();
	camera.clearViewOffset();
	camera.fov = FOV;
	camera.updateProjectionMatrix();
	$("hint").hidden = desk || renderer.xr.isPresenting;
	relayout();
}

// Desktop View: the eye looks straight at the stage, which fills the image's box (contain): the window, or its part left by a
// phone layout, where the view offset moves the projection's center
function fitCamera() {
	const r = windows.stage();
	camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(screen.h, screen.w / (r.w / r.h)) / 2 / SCREEN_DISTANCE));
	camera.setViewOffset(r.w, r.h, -r.x, -r.y, innerWidth, innerHeight);
}

// ---- snapshot ----
async function loadSnapshot() {
	try {
		const snapshot = await ctx.client.getSnapshot();
		if (snapshot) store.load(snapshot);
	} catch (e) {
		console.warn("snapshot load failed", e);
	}
}
store.client = ctx.client; // the store queues through the page's client
store.addEventListener("load", relayout); // the prompt window's minimum follows the prompt panel's entries
ctx.client.addEventListener("snapshot", loadSnapshot);
ctx.client.connect();
loadSnapshot();

// ---- pointer input (pointers.js): XR controllers and hands, the mouse and fingers on the 3D view ----
const input = createPointers({ renderer, camera, scene, uiGroup, center, isDesk: () => deskView, onRecenter: recenter, onToggleUI: toggleUI });

// hides or shows every panel; an open edit is committed and pointers drop their presses, so hidden panels catch nothing.
// Showing them again brings back the same open panel and state (not the pop-up).
function toggleUI() {
	keyboard.commit();
	center.closePopup();
	uiShown = !uiShown;
	input.releaseAll();
	relayout();
}

function recenter() {
	if (renderer.xr.isPresenting) {
		// the XR camera's matrixWorld is only refreshed inside render(), so read the eye poses three decomposed this frame
		const cam = renderer.xr.getCamera();
		const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
		uiGroup.position.set(0, 0, 0);
		for (const eye of cam.cameras) uiGroup.position.add(eye.position);
		uiGroup.position.divideScalar(cam.cameras.length);
		uiGroup.rotation.y = Math.atan2(-dir.x, -dir.z);
	} else {
		uiGroup.position.set(0, DESKTOP_EYE_HEIGHT, 0);
		uiGroup.rotation.y = 0;
		input.resetLook();
	}
	scene.environmentRotation.y = uiGroup.rotation.y; // the model's reflections turn with its lights
	center.model.reset();
	center.image.reset();
}

// page keys: R recenters (the Desktop View: resets the image / model), H hides the UI, Esc closes the output pop-up and the phones' tray
addEventListener("keydown", (e) => {
	if (e.key === "r") recenter();
	else if (e.key === "h") toggleUI();
	else if (e.key === "Escape") {
		center.closePopup();
		windows.closeTray();
	}
});
addEventListener("resize", () => {
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
});

setView(deskView);

// ---- frame loop ----
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
	const dt = Math.min(clock.getDelta(), 0.1);
	if (needRecenter && renderer.xr.isPresenting && renderer.xr.getFrame().getViewerPose(renderer.xr.getReferenceSpace())) { recenter(); needRecenter = false; }
	if (!renderer.xr.isPresenting && deskView) fitCamera();
	input.update(dt);
	center.update(dt);
	ui.Panel.updateAll();
	renderer.render(scene, camera);
});

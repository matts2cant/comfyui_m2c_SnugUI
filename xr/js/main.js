// Bootstrap: renderer, scene, views (Desktop View, VR session, VR-like desktop view), pointer input, panel layout.
import * as THREE from "three";
import * as ui from "./ui.js";
import * as keyboard from "./keyboard.js";
import { showHelp } from "./help.js";
import { createDesktop } from "./desktop.js";
import { ComfyClient } from "./comfy.js";
import { store } from "./state.js";
import { createCenterPanel } from "./panels/center.js";
import { createBottomPanel } from "./panels/bottom.js";
import { createLeftPanel } from "./panels/left.js";
import { createRightPanel } from "./panels/right.js";
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
	for (const ptr of pointers) releasePointer(ptr);
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

// size of the screen, filled in by the center panel whenever the displayed aspect changes
const screen = { diagonal: SCREEN_DIAGONAL_IN * 0.0254, pxPerM: 1000 / PANEL_SCALE, w: 0, h: 0, onResize() {} };
const ctx = {
	THREE, store, ui, scene, renderer, camera, screen,
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
const toolbar = createToolbar(ctx, tabs, viewBtn);

const center = createCenterPanel(ctx, toolbar.panel.width);
const bottom = createBottomPanel(ctx);
const inputs = createLeftPanel(ctx);
const loras = createRightPanel(ctx);
const lights = createLightsPanel(ctx, center.model);
const config = createConfigPanel(ctx, relayout); // the toolbar position moves the Desktop View's deck
scene.add(lights.room);
const hosts = { prompt: bottom, gallery: { group: panelGroup(center.gallery), panel: center.gallery }, lora: loras, light: lights, input: inputs, config };

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
	const rowH = center.row.mesh.visible ? size(center.row)[1] + GAP : 0, panelTop = rowH + size(toolbar.panel)[1] + GAP;
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
	const { row, cog, popup } = center, [pw, ph] = size(popup);
	popupGroup.visible = uiShown && !deskView;
	popupGroup.position.set(((cog.x + cog.w) / row.width - 0.5) * size(row)[0] - pw / 2, -h / 2 + ph / 2, -SCREEN_DISTANCE + POPUP_Z);
}

// Desktop View windows: the same panels, sized to the window (panel px; first size = the VR size, min = what their layouts take).
// Phones show one at a time: Prompt and Configuration as tall as their content (fit), the others as tall as there is room.
const MIN = { prompt: [560, bottom.minHeight], gallery: [500, () => 500], lora: [560, () => 700], light: [420, () => 500], input: [560, () => 500], config: [560, config.minHeight] };
const windows = createDesktop(PANELS.map(([name, icon, title], i) => (
	{ name, title, icon, button: tabs[i], panel: hosts[name].panel, minW: MIN[name][0], minH: MIN[name][1], fit: name === "prompt" || name === "config" }
)), center.note, {
	toolbar: toolbar.panel, tabs: toolbar.tabs, phone: toolbar.phone, row: center.row, popup: center.popup, cog: center.cog, rowH: center.rowH,
	rowTile: center.rowTile, at: config.toolbarAt,
});

function relayout() {
	layout();
	windows.update(deskView && uiShown);
}

function setView(desk) {
	deskView = desk;
	for (const ptr of pointers) releasePointer(ptr);
	lights.room.visible = !desk;
	scene.background = desk ? lights.background : null;
	yaw = pitch = 0;
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

screen.onResize = relayout;

// ---- snapshot ----
async function loadSnapshot() {
	try {
		const snapshot = await ctx.client.getSnapshot();
		if (snapshot) store.load(snapshot);
	} catch (e) {
		console.warn("snapshot load failed", e);
	}
}
store.client = ctx.client;
store.addEventListener("load", relayout); // the prompt window's minimum follows the prompt panel's entries
// the output pop-up closes on a press anywhere but on it and on the output row (whose cog toggles it)
const keepsPopup = (panel) => panel === center.popup || panel === center.row;
addEventListener("pointerdown", (e) => { if (deskView && ![center.popup, center.row].some((p) => p.canvas === e.target)) center.closePopup(); }, true);
ctx.client.addEventListener("snapshot", loadSnapshot);
ctx.client.connect();
loadSnapshot();

// ---- pointer input (shared by XR controllers and the mouse) ----
const raycaster = new THREE.Raycaster();
raycaster.far = 8;
const plane = new THREE.Plane();
const tmp = new THREE.Vector3();
let meshes = [];
const pointers = [];
const newPointer = (id) => { const p = { id, panel: null, cap: null, hit: null, outside: false, grab: null }; pointers.push(p); return p; };

function pick(ray) {
	raycaster.ray.copy(ray);
	const hit = raycaster.intersectObjects(meshes, false)[0];
	if (!hit) return null;
	const panel = hit.object.userData.panel;
	return { panel, x: hit.uv.x * panel.width, y: (1 - hit.uv.y) * panel.height, dist: hit.distance };
}

// ray vs the plane of a panel; used while a press is held so drags continue off the panel
function project(panel, ray) {
	const m = panel.mesh;
	m.updateWorldMatrix(true, false);
	plane.setFromNormalAndCoplanarPoint(tmp.set(0, 0, 1).transformDirection(m.matrixWorld), new THREE.Vector3().setFromMatrixPosition(m.matrixWorld));
	const pt = ray.intersectPlane(plane, new THREE.Vector3());
	if (!pt) return null;
	const dist = ray.origin.distanceTo(pt);
	m.worldToLocal(pt);
	return { panel, x: (pt.x / panel.widthM + 0.5) * panel.width, y: (0.5 - pt.y / panel.heightM) * panel.height, dist };
}

// the 3D model or the image (center's `model` / `image`, never both shown) when the ray reaches it before the panel it hits:
// { view, dist }, else null. Panels in front of a zoomed image keep their rays.
function viewHit(ray, hit) {
	for (const view of [center.model, center.image]) {
		const dist = view.hit(ray);
		if (dist !== null) return hit && hit.dist < dist ? null : { view, dist };
	}
	return null;
}

// grabs the view with a translation pose that follows the ray's point on the plane through the hit point: the image pans in its
// own plane, the desktop's shift- / right-drag slides the model in the plane facing the camera. Keyed by the pointer object,
// apart from the grips (pointer ids), so a controller can do both.
const slidePose = new THREE.Matrix4();
function slide(ptr, view, normal, ray, dist) {
	const at = ray.at(dist, new THREE.Vector3());
	ptr.grab = { view, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, at) };
	view.grab(ptr, slidePose.makeTranslation(at));
}

// a drag on the 3D model turns it by MODEL_TURN times the change of the ray's yaw / pitch in the ui frame
const MODEL_TURN = 3, UP = new THREE.Vector3(0, 1, 0), aimDir = new THREE.Vector3();
function aimAngles(ray) {
	const d = aimDir.copy(ray.direction).applyAxisAngle(UP, -uiGroup.rotation.y);
	return { yaw: Math.atan2(d.x, -d.z), pitch: Math.asin(d.y) };
}
// dist: along the ray to the model, where a second finger's pinch holds it (see pinch)
const turnGrab = (ray, dist) => ({ view: center.model, dist, ...aimAngles(ray) });

function updatePointer(ptr, ray) {
	if (ptr.grab?.plane) {
		if (ray.intersectPlane(ptr.grab.plane, tmp)) ptr.grab.view.drag(ptr, slidePose.makeTranslation(tmp));
		return ptr.hit = null;
	}
	if (ptr.grab) {
		const a = aimAngles(ray);
		center.model.turn((a.yaw - ptr.grab.yaw) * MODEL_TURN, (ptr.grab.pitch - a.pitch) * MODEL_TURN);
		Object.assign(ptr.grab, a);
		return ptr.hit = null;
	}
	if (ptr.cap) {
		const q = project(ptr.cap, ray);
		if (q) ptr.cap.pointer("move", q.x, q.y, ptr.id);
		return ptr.hit = q;
	}
	const hit = pick(ray);
	if (hit?.panel !== ptr.panel) ptr.panel?.pointer("leave", 0, 0, ptr.id);
	ptr.panel = hit?.panel ?? null;
	hit?.panel.pointer("move", hit.x, hit.y, ptr.id);
	return ptr.hit = hit;
}

// a press away from any text field and its toolbar commits the open edit once released, so a click on e.g. a suggestion still lands
function pointerDown(ptr, ray) {
	const hit = updatePointer(ptr, ray);
	if (!keepsPopup(hit?.panel)) center.closePopup();
	const target = hit?.panel.hitTest(hit.x, hit.y);
	ptr.outside = keyboard.isEditing() && !(target instanceof ui.TextField || target instanceof ui.EditBar);
	const v = viewHit(ray, hit);
	if (v?.view === center.model) ptr.grab = turnGrab(ray, v.dist);
	else if (v) slide(ptr, v.view, center.group.getWorldDirection(new THREE.Vector3()), ray, v.dist);
	if (v) return true;
	if (!hit) return false;
	ptr.cap = hit.panel;
	hit.panel.pointer("down", hit.x, hit.y, ptr.id);
	return true;
}

// drop hover and any held press without clicking (controller lost, session ended)
function releasePointer(ptr) {
	if (ptr.grab?.plane) ptr.grab.view.release(ptr);
	ptr.cap?.pointer("up", -1e6, -1e6, ptr.id);
	ptr.panel?.pointer("leave", 0, 0, ptr.id);
	ptr.panel = ptr.cap = ptr.grab = null;
}

function pointerUp(ptr, ray) {
	const panel = ptr.cap, q = panel && project(panel, ray);
	if (ptr.grab?.plane) ptr.grab.view.release(ptr);
	ptr.cap = ptr.grab = null;
	if (q) panel.pointer("up", q.x, q.y, ptr.id);
	// the click released the pointer (the toolbar's view button): no hover left behind on the shared toolbar
	if (q && ptr.panel !== panel) panel.pointer("leave", 0, 0, ptr.id);
	if (ptr.outside) keyboard.commit();
	ptr.outside = false;
}

// ---- XR controllers / hands: ray + cursor dot, select = press (turns the 3D model, pans the image), thumbstick = scroll
// (zoom on the 3D model or the image), squeeze on either = grab it, left squeeze elsewhere = recenter ----
const controllers = [0, 1].map((i) => {
	const ptr = newPointer(i + 1);
	const target = renderer.xr.getController(i);
	const ray = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.003, 1).translate(0, 0, -0.5), new THREE.MeshBasicMaterial({ color: 0x8fb4ff }));
	const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
	dot.renderOrder = 10;
	ray.visible = dot.visible = false;
	target.add(ray);
	scene.add(target, dot);
	const worldRay = new THREE.Ray();
	const aim = () => {
		target.updateWorldMatrix(true, false);
		worldRay.origin.setFromMatrixPosition(target.matrixWorld);
		worldRay.direction.set(0, 0, -1).transformDirection(target.matrixWorld);
		return worldRay;
	};
	const c = { ptr, target, ray, dot, aim, source: null, holding: null, b: false }; // holding: the view the grip holds; b: B was down
	const drop = () => {
		c.holding?.release(ptr.id);
		c.holding = null;
	};
	target.addEventListener("connected", (e) => { c.source = e.data; ray.visible = e.data.targetRayMode !== "gaze"; });
	target.addEventListener("disconnected", () => { c.source = null; ray.visible = dot.visible = false; releasePointer(ptr); drop(); });
	target.addEventListener("selectstart", () => pointerDown(ptr, aim()));
	target.addEventListener("selectend", () => pointerUp(ptr, aim()));
	target.addEventListener("squeezestart", () => {
		const r = aim(), v = viewHit(r, pick(r));
		if (v) {
			c.holding = v.view;
			v.view.grab(ptr.id, target.matrixWorld);
		} else if (c.source?.handedness === "left") recenter();
	});
	target.addEventListener("squeezeend", drop);
	return c;
});

function updateControllers(dt) {
	for (const c of controllers) {
		if (!c.source) continue;
		// B: xr-standard button 5 of the right Quest Touch controller (WebXR input profile oculus-touch); hands have none
		const b = c.source.handedness === "right" && !!c.source.gamepad?.buttons[5]?.pressed;
		if (b && !c.b) toggleUI();
		c.b = b;
		if (!c.target.visible) {
			c.dot.visible = false;
			if (!c.ptr.cap) releasePointer(c.ptr);
			continue;
		}
		const hit = updatePointer(c.ptr, c.aim());
		c.holding?.drag(c.ptr.id, c.target.matrixWorld);
		const v = viewHit(c.aim(), hit);
		const d = v?.dist ?? hit?.dist ?? 1.5;
		c.ray.scale.z = d;
		c.dot.visible = !!hit || !!v;
		if (c.dot.visible) c.dot.position.copy(worldPoint(c.aim(), d));
		const stick = c.source.gamepad?.axes[3] ?? 0;
		if (Math.abs(stick) <= 0.15) continue;
		if (v) v.view.zoom(Math.exp(-stick * 1.5 * dt), c.aim()); // the image zooms about the ray's point
		else if (hit && c.ptr.panel) c.ptr.panel.scroll(stick * 900 * dt, hit.x, hit.y);
	}
}
const worldPoint = (ray, d) => ray.at(d, tmp.clone());

// hides or shows every panel; an open edit is committed and pointers drop their presses, so hidden panels catch nothing.
// Showing them again brings back the same open panel and state (not the pop-up).
function toggleUI() {
	keyboard.commit();
	center.closePopup();
	uiShown = !uiShown;
	for (const ptr of pointers) releasePointer(ptr);
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
		yaw = pitch = 0;
	}
	scene.environmentRotation.y = uiGroup.rotation.y; // the model's reflections turn with its lights
	center.model.reset();
	center.image.reset();
}

// ---- mouse and touch on the 3D view (no XR session): a press on the image pans it, on the 3D model turns it, on a panel
// clicks it, elsewhere looks around (VR-like view only); the wheel scrolls the panel (or zooms the model / the image about
// the cursor); shift- or right-drag slides the model in the plane facing the camera. Each finger is a pointer (pinch). ----
let yaw = 0, pitch = 0, look = null; // look: { id, x, y } of the pointer turning the view
const mouse = newPointer(0), fingers = new Map(); // pointerId -> pointer
const el = renderer.domElement;
const ndc = new THREE.Vector2();
const camDir = () => camera.getWorldDirection(new THREE.Vector3());
const ptrOf = (e) => e.pointerType === "touch" ? fingers.get(e.pointerId) : mouse;
function mouseRay(e) {
	ndc.set(e.offsetX / el.clientWidth * 2 - 1, -(e.offsetY / el.clientHeight) * 2 + 1);
	camera.updateMatrixWorld();
	raycaster.setFromCamera(ndc, camera);
	return raycaster.ray.clone();
}

// a second finger while one holds the image or the model: both slide it in one plane (the view's two-hand grab), so a pinch
// zooms it and moving them moves it; the model stops turning meanwhile. More fingers do nothing.
function pinch(ptr, other) {
	const { view } = other.grab;
	if (!other.grab.plane) slide(other, view, camDir(), other.ray, other.grab.dist);
	else if ([...fingers.values()].filter((p) => p.grab).length > 1) return;
	const dist = ptr.ray.distanceToPlane(other.grab.plane);
	if (dist !== null) slide(ptr, view, other.grab.plane.normal, ptr.ray, dist);
}

el.addEventListener("mousedown", (e) => { if (keyboard.isEditing()) e.preventDefault(); }); // keep the textarea focused
el.addEventListener("pointerdown", (e) => {
	if (renderer.xr.isPresenting) return;
	const ray = mouseRay(e), touch = e.pointerType === "touch";
	const other = touch && [...fingers.values()].find((p) => p.grab);
	const ptr = touch ? newPointer("touch" + e.pointerId) : mouse;
	if (touch) fingers.set(e.pointerId, ptr);
	ptr.ray = ray;
	keyboard.setXR(touch);
	el.setPointerCapture(e.pointerId);
	if (other) return pinch(ptr, other);
	const v = viewHit(ray, pick(ray));
	if ((e.button === 2 || e.button === 0 && e.shiftKey) && v?.view === center.model) return slide(ptr, v.view, camDir(), ray, v.dist);
	if (e.button === 0 && !pointerDown(ptr, ray) && !deskView) look = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
el.addEventListener("pointermove", (e) => {
	if (renderer.xr.isPresenting) return;
	if (look?.id === e.pointerId) {
		yaw -= (e.clientX - look.x) * 0.004;
		pitch = Math.max(-1.2, Math.min(1.2, pitch - (e.clientY - look.y) * 0.004));
		look.x = e.clientX;
		look.y = e.clientY;
		return;
	}
	const ptr = ptrOf(e);
	if (ptr) updatePointer(ptr, ptr.ray = mouseRay(e));
});
function release(e) {
	if (look?.id === e.pointerId) look = null;
	const ptr = ptrOf(e);
	if (!ptr) return;
	pointerUp(ptr, mouseRay(e));
	if (ptr === mouse) return;
	fingers.delete(e.pointerId);
	pointers.splice(pointers.indexOf(ptr), 1);
	// the finger left of a pinch on the model turns it again
	for (const p of fingers.values()) {
		if (p.grab?.view !== center.model || !p.grab.plane) continue;
		const dist = p.ray.distanceToPlane(p.grab.plane);
		center.model.release(p);
		p.grab = turnGrab(p.ray, dist);
	}
}
el.addEventListener("pointerup", release);
el.addEventListener("pointercancel", release);
el.addEventListener("contextmenu", (e) => e.preventDefault());
el.addEventListener("pointerleave", () => {
	if (mouse.cap) return;
	mouse.panel?.pointer("leave", 0, 0, mouse.id);
	mouse.panel = null;
});
el.addEventListener("wheel", (e) => {
	e.preventDefault();
	const ray = mouseRay(e), hit = updatePointer(mouse, ray), v = viewHit(ray, hit);
	if (v) v.view.zoom(Math.exp(-e.deltaY * 0.001), ray);
	else if (hit) hit.panel.scroll(e.deltaY, hit.x, hit.y);
}, { passive: false });
addEventListener("keydown", (e) => {
	if (e.key === "r") recenter();
	else if (e.key === "h") toggleUI();
	else if (e.key === "Escape") center.closePopup();
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
	if (!renderer.xr.isPresenting) {
		camera.rotation.set(pitch, yaw, 0);
		if (deskView) fitCamera();
	}
	meshes = [];
	uiGroup.traverseVisible((o) => { if (o.userData.panel) meshes.push(o); });
	updateControllers(dt);
	center.update(dt);
	ui.Panel.updateAll();
	renderer.render(scene, camera);
});

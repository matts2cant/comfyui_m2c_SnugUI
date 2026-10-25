// Bootstrap: renderer, scene, VR session, desktop fallback, pointer input, panel layout.
import * as THREE from "three";
import * as ui from "./ui.js";
import * as keyboard from "./keyboard.js";
import { showHelp } from "./help.js";
import { ComfyClient } from "./comfy.js";
import { store } from "./state.js";
import { createCenterPanel } from "./panels/center.js";
import { createBottomPanel } from "./panels/bottom.js";
import { createLeftPanel } from "./panels/left.js";
import { createRightPanel } from "./panels/right.js";
import { createLightsPanel } from "./panels/lights.js";

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
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 100);
camera.rotation.order = "YXZ";
const DESKTOP_EYE_HEIGHT = 1.6; // desktop fallback only; XR recenters on the head pose
camera.position.set(0, DESKTOP_EYE_HEIGHT, 0);
const uiGroup = new THREE.Group(); // origin = eye, -z = viewing direction
uiGroup.position.y = DESKTOP_EYE_HEIGHT;
scene.add(uiGroup);

// ---- XR session ----
let needRecenter = false;

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
	$("enter-vr").hidden = $("hint").hidden = true;
}

function onSessionEnd() {
	keyboard.setXR(false);
	keyboard.commit();
	for (const ptr of pointers) releasePointer(ptr);
	// three overwrites the camera pose while presenting
	camera.position.set(0, DESKTOP_EYE_HEIGHT, 0);
	uiGroup.position.set(0, DESKTOP_EYE_HEIGHT, 0);
	uiGroup.rotation.y = scene.environmentRotation.y = yaw = pitch = 0;
	$("enter-vr").hidden = $("hint").hidden = false;
}

$("enter-vr").onclick = () => enter().catch((e) => {
	$("hint").textContent = "Could not start VR session: " + e.message;
	console.error(e);
});
navigator.xr?.isSessionSupported("immersive-vr").catch(() => false).then((ok) => { $("enter-vr").hidden = !ok; });

const needHelp = !window.isSecureContext || !navigator.xr;
if (params.has("help") || needHelp && !params.has("dev")) showHelp({ insecure: !window.isSecureContext });

// ---- panels ----
// Everything sits on the vertical plane z = -SCREEN_DISTANCE (eye at the origin). The screen is SCREEN_DIAGONAL_IN inches at the
// aspect of what it shows; top to bottom under it: history strip, status bar, prompt panel (toggle buttons at its edges, the
// lighting one only while a 3D output is shown). Side panels sit beside the screen, yawed at the eye, the lighting panel right
// of the LoRA panel. Every panel group has PANEL_SCALE, so px density and fonts match.
const SCREEN_DIAGONAL_IN = 32, SCREEN_DISTANCE = 0.5;
const PANEL_SCALE = 0.35;
const GAP_SCREEN_STRIP = 0.012, GAP_STRIP_STATUS = 0.012, GAP_STATUS_PROMPT = 0.003, GAP_TOGGLE = 0.003, GAP_SIDE = 0.02;
const SIDES_KEY = "appmode-xr.sides";

// size of the screen, filled in by the center panel whenever the displayed aspect changes
const screen = { diagonal: SCREEN_DIAGONAL_IN * 0.0254, pxPerM: 1000 / PANEL_SCALE, w: 0, h: 0, onResize() {} };
const ctx = {
	THREE, store, ui, scene, renderer, camera, screen,
	client: new ComfyClient(),
	xr: { isPresenting: () => renderer.xr.isPresenting },
};
window.__xr = ctx;

const sides = { left: true, right: true, lights: false };
try {
	Object.assign(sides, JSON.parse(localStorage.getItem(SIDES_KEY)));
} catch {}

function panelGroup(panel) {
	const group = new THREE.Group();
	group.add(panel.mesh);
	return group;
}

// button panel on the prompt panel's edge that shows / hides a side panel
function sideToggle(name, text) {
	const panel = new ui.Panel({ name: "toggle-" + name, widthM: 0.18, heightM: 0.5 });
	const button = panel.add(new ui.Button({ text, size: 28, x: 12, y: 12, w: panel.width - 24, h: panel.height - 24, toggled: sides[name] }));
	button.onClick = () => {
		sides[name] = button.toggled = !sides[name];
		try {
			localStorage.setItem(SIDES_KEY, JSON.stringify(sides));
		} catch {}
		layout();
	};
	return { group: panelGroup(panel), panel };
}

const center = createCenterPanel(ctx);
const bottom = createBottomPanel(ctx);
const settings = createLeftPanel(ctx);
const loras = createRightPanel(ctx);
const lights = createLightsPanel(ctx, center.model);
scene.add(lights.room);
const toggles = { left: sideToggle("left", "Settings"), right: sideToggle("right", "LoRAs"), lights: sideToggle("lights", "Lighting") };
const stripGroup = panelGroup(center.strip), statusGroup = panelGroup(center.status);
const promptGroup = bottom.group;
const animated = [center, bottom];
const scaled = [stripGroup, statusGroup, promptGroup, settings.group, loras.group, lights.group, ...Object.values(toggles).map((t) => t.group)];
for (const g of [center.group, ...scaled]) uiGroup.add(g);
for (const g of scaled) g.scale.setScalar(PANEL_SCALE);

// side panel with its inner edge at (|x|, -z) = (innerX, innerZ), yawed so its center faces the eye; returns the next panel's inner edge
function placeSide(group, panel, dir, innerX, innerZ, y) {
	const half = panel.widthM * PANEL_SCALE / 2;
	let a = 0;
	for (let i = 0; i < 4; i++) a = Math.atan2(innerX + half * Math.cos(a), innerZ - half * Math.sin(a));
	group.rotation.y = a * dir;
	group.position.set(-dir * (innerX + half * Math.cos(a)), y, -(innerZ - half * Math.sin(a)));
	return [innerX + (2 * half + GAP_SIDE) * Math.cos(a), innerZ - (2 * half + GAP_SIDE) * Math.sin(a)];
}

function layout() {
	const { w, h } = screen;
	const at = (group, x, y) => group.position.set(x, y, -SCREEN_DISTANCE);
	const sizeOf = (panel) => [panel.widthM * PANEL_SCALE, panel.heightM * PANEL_SCALE];
	at(center.group, 0, 0);

	let y = -h / 2 - GAP_SCREEN_STRIP;
	const [, stripH] = sizeOf(center.strip);
	at(stripGroup, 0, y - stripH / 2);
	y -= stripH + GAP_STRIP_STATUS;
	const [, statusH] = sizeOf(center.status);
	at(statusGroup, 0, y - statusH / 2);
	y -= statusH + GAP_STATUS_PROMPT;
	const [promptW, promptH] = sizeOf(bottom.panel);
	at(promptGroup, 0, y - promptH / 2);

	const [toggleW] = sizeOf(toggles.left.panel), toggleX = promptW / 2 + GAP_TOGGLE + toggleW / 2, toggleY = y - promptH / 2;
	at(toggles.left.group, -toggleX, toggleY);
	at(toggles.right.group, toggleX, toggleY);
	at(toggles.lights.group, toggleX + toggleW + GAP_TOGGLE, toggleY);

	// side panels top aligned with the screen, centered at eye level when taller
	const top = (panel) => Math.max(0, h / 2 - panel.heightM * PANEL_SCALE / 2);
	const is3d = center.is3d();
	settings.group.visible = sides.left;
	loras.group.visible = sides.right;
	toggles.lights.group.visible = is3d;
	lights.group.visible = is3d && sides.lights;
	lights.setActive(is3d);
	placeSide(settings.group, settings.panel, 1, w / 2 + GAP_SIDE, SCREEN_DISTANCE, top(settings.panel));
	const next = placeSide(loras.group, loras.panel, -1, w / 2 + GAP_SIDE, SCREEN_DISTANCE, top(loras.panel));
	placeSide(lights.group, lights.panel, -1, ...(sides.right ? next : [w / 2 + GAP_SIDE, SCREEN_DISTANCE]), top(lights.panel));
}

screen.onResize = layout;
layout();

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

// distance to the 3D model when the ray reaches it before the panel it hits, else null
function modelHit(ray, hit) {
	const d = center.model.hit(ray);
	return d !== null && !(hit && hit.dist < d) ? d : null;
}

// a drag on the 3D model turns it by MODEL_TURN times the change of the ray's yaw / pitch in the ui frame
const MODEL_TURN = 3, UP = new THREE.Vector3(0, 1, 0), aimDir = new THREE.Vector3();
function aimAngles(ray) {
	const d = aimDir.copy(ray.direction).applyAxisAngle(UP, -uiGroup.rotation.y);
	return { yaw: Math.atan2(d.x, -d.z), pitch: Math.asin(d.y) };
}

function updatePointer(ptr, ray) {
	if (ptr.grab) {
		const a = aimAngles(ray);
		center.model.turn((a.yaw - ptr.grab.yaw) * MODEL_TURN, (ptr.grab.pitch - a.pitch) * MODEL_TURN);
		ptr.grab = a;
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
	const target = hit?.panel.hitTest(hit.x, hit.y);
	ptr.outside = keyboard.isEditing() && !(target instanceof ui.TextField || target instanceof ui.EditBar);
	if (modelHit(ray, hit) !== null) {
		ptr.grab = aimAngles(ray);
		return true;
	}
	if (!hit) return false;
	ptr.cap = hit.panel;
	hit.panel.pointer("down", hit.x, hit.y, ptr.id);
	return true;
}

// drop hover and any held press without clicking (controller lost, session ended)
function releasePointer(ptr) {
	ptr.cap?.pointer("up", -1e6, -1e6, ptr.id);
	ptr.panel?.pointer("leave", 0, 0, ptr.id);
	ptr.panel = ptr.cap = ptr.grab = null;
}

function pointerUp(ptr, ray) {
	const panel = ptr.cap, q = panel && project(panel, ray);
	ptr.cap = ptr.grab = null;
	if (q) panel.pointer("up", q.x, q.y, ptr.id);
	if (ptr.outside) keyboard.commit();
	ptr.outside = false;
}

// ---- XR controllers / hands: ray + cursor dot, select = press, thumbstick = scroll (zoom on the 3D model),
// squeeze on the 3D model = grab it, left squeeze elsewhere = recenter ----
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
	const c = { ptr, target, ray, dot, aim, source: null, holding: false };
	const drop = () => {
		if (c.holding) center.model.release(ptr.id);
		c.holding = false;
	};
	target.addEventListener("connected", (e) => { c.source = e.data; ray.visible = e.data.targetRayMode !== "gaze"; });
	target.addEventListener("disconnected", () => { c.source = null; ray.visible = dot.visible = false; releasePointer(ptr); drop(); });
	target.addEventListener("selectstart", () => pointerDown(ptr, aim()));
	target.addEventListener("selectend", () => pointerUp(ptr, aim()));
	target.addEventListener("squeezestart", () => {
		const r = aim();
		if (modelHit(r, pick(r)) !== null) {
			c.holding = true;
			center.model.grab(ptr.id, target.matrixWorld);
		} else if (c.source?.handedness === "left") recenter();
	});
	target.addEventListener("squeezeend", drop);
	return c;
});

function updateControllers(dt) {
	for (const c of controllers) {
		if (!c.source) continue;
		if (!c.target.visible) {
			c.dot.visible = false;
			if (!c.ptr.cap) releasePointer(c.ptr);
			continue;
		}
		const hit = updatePointer(c.ptr, c.aim());
		if (c.holding) center.model.drag(c.ptr.id, c.target.matrixWorld);
		const modelDist = modelHit(c.aim(), hit);
		const d = modelDist ?? hit?.dist ?? 1.5;
		c.ray.scale.z = d;
		c.dot.visible = !!hit || modelDist !== null;
		if (c.dot.visible) c.dot.position.copy(worldPoint(c.aim(), d));
		const stick = c.source.gamepad?.axes[3] ?? 0;
		if (Math.abs(stick) <= 0.15) continue;
		if (modelDist !== null) center.model.zoom(Math.exp(-stick * 1.5 * dt));
		else if (hit && c.ptr.panel) c.ptr.panel.scroll(stick * 900 * dt, hit.x, hit.y);
	}
}
const worldPoint = (ray, d) => ray.at(d, tmp.clone());

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
}

// ---- desktop fallback: drag to look (or turn the 3D model), click panels, wheel scrolls (or zooms the model),
// shift- or right-drag slides the model in the plane facing the camera through the point it was grabbed at ----
let yaw = 0, pitch = 0, look = null, slide = null;
const slidePose = new THREE.Matrix4();
function slideTo(ray) {
	if (ray.intersectPlane(slide, tmp)) slidePose.makeTranslation(tmp);
	return slidePose;
}
const mouse = newPointer(0);
const el = renderer.domElement;
const ndc = new THREE.Vector2();
function mouseRay(e) {
	ndc.set(e.offsetX / el.clientWidth * 2 - 1, -(e.offsetY / el.clientHeight) * 2 + 1);
	camera.updateMatrixWorld();
	raycaster.setFromCamera(ndc, camera);
	return raycaster.ray.clone();
}
el.addEventListener("mousedown", (e) => { if (keyboard.isEditing()) e.preventDefault(); }); // keep the textarea focused
el.addEventListener("pointerdown", (e) => {
	if (renderer.xr.isPresenting) return;
	const ray = mouseRay(e), d = modelHit(ray, pick(ray));
	if ((e.button === 2 || e.button === 0 && e.shiftKey) && d !== null) {
		el.setPointerCapture(e.pointerId);
		slide = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), ray.at(d, new THREE.Vector3()));
		center.model.grab(mouse.id, slideTo(ray));
		return;
	}
	if (e.button !== 0) return;
	el.setPointerCapture(e.pointerId);
	if (!pointerDown(mouse, ray)) look = { x: e.clientX, y: e.clientY };
});
el.addEventListener("pointermove", (e) => {
	if (renderer.xr.isPresenting) return;
	if (slide) center.model.drag(mouse.id, slideTo(mouseRay(e)));
	else if (look) {
		yaw -= (e.clientX - look.x) * 0.004;
		pitch = Math.max(-1.2, Math.min(1.2, pitch - (e.clientY - look.y) * 0.004));
		look.x = e.clientX;
		look.y = e.clientY;
	} else updatePointer(mouse, mouseRay(e));
});
el.addEventListener("pointerup", (e) => {
	look = null;
	if (slide) center.model.release(mouse.id);
	slide = null;
	pointerUp(mouse, mouseRay(e));
});
el.addEventListener("contextmenu", (e) => e.preventDefault());
el.addEventListener("pointerleave", () => {
	if (mouse.cap) return;
	mouse.panel?.pointer("leave", 0, 0, mouse.id);
	mouse.panel = null;
});
el.addEventListener("wheel", (e) => {
	e.preventDefault();
	const ray = mouseRay(e), hit = updatePointer(mouse, ray);
	if (modelHit(ray, hit) !== null) center.model.zoom(Math.exp(-e.deltaY * 0.001));
	else if (hit) hit.panel.scroll(e.deltaY, hit.x, hit.y);
}, { passive: false });
addEventListener("keydown", (e) => { if (e.key === "r") recenter(); });
addEventListener("resize", () => {
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
});

// ---- frame loop ----
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
	const dt = Math.min(clock.getDelta(), 0.1);
	if (needRecenter && renderer.xr.isPresenting && renderer.xr.getFrame().getViewerPose(renderer.xr.getReferenceSpace())) { recenter(); needRecenter = false; }
	if (!renderer.xr.isPresenting) camera.rotation.set(pitch, yaw, 0);
	meshes = [];
	uiGroup.traverseVisible((o) => { if (o.userData.panel) meshes.push(o); });
	updateControllers(dt);
	for (const p of animated) p.update(dt);
	ui.Panel.updateAll();
	renderer.render(scene, camera);
});

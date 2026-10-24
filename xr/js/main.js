// Bootstrap: renderer, scene, XR sessions (AR/VR), desktop fallback, pointer input, panel layout.
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

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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
const EYE_HEIGHT = 1.6;
camera.position.set(0, EYE_HEIGHT, 0);
const uiGroup = new THREE.Group();
uiGroup.position.y = EYE_HEIGHT;
scene.add(uiGroup);

// dim room for VR / desktop; hidden in AR so passthrough shows
const room = new THREE.Group();
room.add(new THREE.GridHelper(12, 24, 0x2a3446, 0x1a2230));
{
	const c = document.createElement("canvas");
	c.width = 2;
	c.height = 256;
	const g = c.getContext("2d");
	const grad = g.createLinearGradient(0, 0, 0, 256);
	grad.addColorStop(0, "#0f1626");
	grad.addColorStop(1, "#06080c");
	g.fillStyle = grad;
	g.fillRect(0, 0, 2, 256);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	room.add(new THREE.Mesh(new THREE.SphereGeometry(40, 24, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false })));
}
scene.add(room);

let mode = "desktop";
const support = { ar: false, vr: false };
function applyMode() {
	room.visible = mode !== "ar";
	renderer.setClearColor(0x06080c, mode === "ar" ? 0 : 1);
}
applyMode();

// ---- XR session ----
let needRecenter = false;

async function enter(m) {
	const session = await navigator.xr.requestSession(m === "ar" ? "immersive-ar" : "immersive-vr", {
		optionalFeatures: ["local-floor", "hand-tracking", "layers"],
	});
	session.addEventListener("end", onSessionEnd, { once: true });
	try {
		renderer.xr.setReferenceSpaceType(session.enabledFeatures.includes("local-floor") ? "local-floor" : "local");
		mode = m;
		applyMode();
		await renderer.xr.setSession(session);
	} catch (e) {
		session.end();
		throw e;
	}
	keyboard.setXRSession(session);
	needRecenter = true;
	$("overlay").hidden = $("hint").hidden = true;
}

function onSessionEnd() {
	mode = "desktop";
	applyMode();
	keyboard.setXRSession(null);
	for (const ptr of pointers) releasePointer(ptr);
	// three overwrites the camera pose while presenting
	camera.position.set(0, EYE_HEIGHT, 0);
	uiGroup.position.set(0, EYE_HEIGHT, 0);
	uiGroup.rotation.y = yaw = pitch = 0;
	$("overlay").hidden = $("hint").hidden = false;
}

const reportError = (e) => { $("hint").textContent = "Could not start XR session: " + e.message; console.error(e); };

function toggleMode() {
	const session = renderer.xr.getSession();
	if (!session) return enter(support.ar ? "ar" : "vr").catch(reportError);
	const target = mode === "ar" ? "vr" : "ar";
	if (!support[target]) return;
	// only one immersive session can exist, so the new one is requested from the end event (the select's transient user activation)
	session.addEventListener("end", () => enter(target).catch(reportError), { once: true });
	session.end();
}

for (const m of ["ar", "vr"]) $("enter-" + m).onclick = () => enter(m).catch(reportError);

for (const m of ["ar", "vr"]) {
	navigator.xr?.isSessionSupported("immersive-" + m).catch(() => false).then((ok) => {
		support[m] = ok;
		$("enter-" + m).hidden = !ok;
		if (m === "ar") $("enter-vr").classList.toggle("secondary", ok);
	});
}

const needHelp = !window.isSecureContext || !navigator.xr;
if (params.has("help") || needHelp && !params.has("dev")) showHelp({ insecure: !window.isSecureContext });

// ---- panels ----
// layout in meters / degrees, eye at the origin
const CENTER_POS = [0, 0, -2.0];
const BOTTOM_POS = [0, -0.8, -1.05], BOTTOM_TILT = -40;
const SIDE_DIST = 1.4, SIDE_YAW = 50, SIDE_Y = 0.05;
const ctx = {
	THREE, store, ui, keyboard, scene, renderer, camera,
	client: new ComfyClient(),
	xr: { isPresenting: () => renderer.xr.isPresenting, mode: () => mode, toggleMode },
};
window.__xr = ctx;

function side(group, dir) {
	const a = THREE.MathUtils.degToRad(SIDE_YAW) * dir;
	group.position.set(-Math.sin(a) * SIDE_DIST, SIDE_Y, -Math.cos(a) * SIDE_DIST);
	group.rotation.y = a;
}

const panels = [
	[createCenterPanel, (g) => g.position.set(...CENTER_POS)],
	[createBottomPanel, (g) => { g.position.set(...BOTTOM_POS); g.rotation.x = THREE.MathUtils.degToRad(BOTTOM_TILT); }],
	[createLeftPanel, (g) => side(g, 1)],
	[createRightPanel, (g) => side(g, -1)],
].map(([create, place]) => {
	const p = create(ctx);
	place(p.group);
	uiGroup.add(p.group);
	return p;
});

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
try { ctx.client.connect(); } catch (e) { console.warn("comfy connect failed", e); }
loadSnapshot();

// ---- pointer input (shared by XR controllers and the mouse) ----
const raycaster = new THREE.Raycaster();
raycaster.far = 8;
const plane = new THREE.Plane();
const tmp = new THREE.Vector3();
let meshes = [];
const pointers = [];
const newPointer = (id) => { const p = { id, panel: null, cap: null, hit: null }; pointers.push(p); return p; };

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

function updatePointer(ptr, ray) {
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

function pointerDown(ptr, ray) {
	const hit = updatePointer(ptr, ray);
	if (!hit) return false;
	ptr.cap = hit.panel;
	hit.panel.pointer("down", hit.x, hit.y, ptr.id);
	return true;
}

// drop hover and any held press without clicking (controller lost, session ended)
function releasePointer(ptr) {
	ptr.cap?.pointer("up", -1e6, -1e6, ptr.id);
	ptr.panel?.pointer("leave", 0, 0, ptr.id);
	ptr.panel = ptr.cap = null;
}

function pointerUp(ptr, ray) {
	if (!ptr.cap) return;
	const panel = ptr.cap, q = project(panel, ray);
	ptr.cap = null;
	if (q) panel.pointer("up", q.x, q.y, ptr.id);
}

// ---- XR controllers / hands: ray + cursor dot, select = press, thumbstick = scroll, left squeeze = recenter ----
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
	const c = { ptr, target, ray, dot, aim, source: null };
	target.addEventListener("connected", (e) => { c.source = e.data; ray.visible = e.data.targetRayMode !== "gaze"; });
	target.addEventListener("disconnected", () => { c.source = null; ray.visible = dot.visible = false; releasePointer(ptr); });
	target.addEventListener("selectstart", () => pointerDown(ptr, aim()));
	target.addEventListener("selectend", () => pointerUp(ptr, aim()));
	target.addEventListener("squeezestart", () => { if (c.source?.handedness === "left") recenter(); });
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
		const d = hit ? hit.dist : 1.5;
		c.ray.scale.z = d;
		c.dot.visible = !!hit;
		if (hit) c.dot.position.copy(worldPoint(c.aim(), d));
		const stick = c.source.gamepad?.axes[3] ?? 0;
		if (hit && c.ptr.panel && Math.abs(stick) > 0.15) c.ptr.panel.scroll(stick * 900 * dt, hit.x, hit.y);
	}
}
const worldPoint = (ray, d) => ray.at(d, tmp.clone());

function recenter() {
	if (renderer.xr.isPresenting) {
		// the XR camera's matrixWorld is only refreshed inside render(), so read the pose three decomposed this frame
		const cam = renderer.xr.getCamera();
		const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
		uiGroup.position.copy(cam.position);
		uiGroup.rotation.y = Math.atan2(-dir.x, -dir.z);
	} else {
		uiGroup.position.set(0, EYE_HEIGHT, 0);
		uiGroup.rotation.y = 0;
		yaw = pitch = 0;
	}
}

// ---- desktop fallback: drag to look, click panels, wheel scrolls ----
let yaw = 0, pitch = 0, look = null;
const mouse = newPointer(0);
const el = renderer.domElement;
const ndc = new THREE.Vector2();
function mouseRay(e) {
	ndc.set(e.offsetX / el.clientWidth * 2 - 1, -(e.offsetY / el.clientHeight) * 2 + 1);
	camera.updateMatrixWorld();
	raycaster.setFromCamera(ndc, camera);
	return raycaster.ray.clone();
}
el.addEventListener("pointerdown", (e) => {
	if (e.button !== 0 || renderer.xr.isPresenting) return;
	el.setPointerCapture(e.pointerId);
	if (!pointerDown(mouse, mouseRay(e))) look = { x: e.clientX, y: e.clientY };
});
el.addEventListener("pointermove", (e) => {
	if (renderer.xr.isPresenting) return;
	if (look) {
		yaw -= (e.clientX - look.x) * 0.004;
		pitch = Math.max(-1.2, Math.min(1.2, pitch - (e.clientY - look.y) * 0.004));
		look.x = e.clientX;
		look.y = e.clientY;
	} else updatePointer(mouse, mouseRay(e));
});
el.addEventListener("pointerup", (e) => {
	look = null;
	pointerUp(mouse, mouseRay(e));
});
el.addEventListener("pointerleave", () => {
	if (mouse.cap) return;
	mouse.panel?.pointer("leave", 0, 0, mouse.id);
	mouse.panel = null;
});
el.addEventListener("wheel", (e) => {
	e.preventDefault();
	const hit = updatePointer(mouse, mouseRay(e));
	hit?.panel.scroll(e.deltaY, hit.x, hit.y);
}, { passive: false });
addEventListener("keydown", (e) => { if (e.key === "r" && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) recenter(); });
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
	for (const p of panels) p.update?.(dt);
	ui.Panel.updateAll();
	renderer.render(scene, camera);
});

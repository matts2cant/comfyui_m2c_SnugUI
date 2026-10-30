// Pointer input on the 3D view: XR controllers and hands (a ray and a cursor dot each; select = press, squeeze = grab, thumbstick =
// scroll / zoom, B = hide the UI) and, without an XR session, the mouse and each finger, the wheel and the VR-like view's look
// around. Rays go to the visible panels (panel.pointer() in panel px), center's 3D model and its image.
import * as THREE from "three";
import * as ui from "./ui.js";
import * as keyboard from "./keyboard.js";

// scene: where the controllers go; uiGroup: the frame of the panels and the stage, its visible panels take the rays; center: its
// model, image, stage group and output pop-up; isDesk(): the Desktop View (no look around); onRecenter(): a left squeeze away
// from the model and the image; onToggleUI(): B. -> { update(dt) each frame (the look, the controllers), releaseAll() (every
// pointer's hover, press and grab dropped without a click), resetLook() }
export function createPointers({ renderer, camera, scene, uiGroup, center, isDesk, onRecenter, onToggleUI }) {
	// the output pop-up closes on a press anywhere but on it and on the output row (whose cog toggles it)
	const keepsPopup = (panel) => panel === center.popup || panel === center.row;
	addEventListener("pointerdown", (e) => { if (isDesk() && ![center.popup, center.row].some((p) => p.canvas === e.target)) center.closePopup(); }, true);

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
			} else if (c.source?.handedness === "left") onRecenter();
		});
		target.addEventListener("squeezeend", drop);
		return c;
	});

	function updateControllers(dt) {
		for (const c of controllers) {
			if (!c.source) continue;
			// B: xr-standard button 5 of the right Quest Touch controller (WebXR input profile oculus-touch); hands have none
			const b = c.source.handedness === "right" && !!c.source.gamepad?.buttons[5]?.pressed;
			if (b && !c.b) onToggleUI();
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
		if (e.button === 0 && !pointerDown(ptr, ray) && !isDesk()) look = { id: e.pointerId, x: e.clientX, y: e.clientY };
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

	return {
		update(dt) {
			if (!renderer.xr.isPresenting) camera.rotation.set(pitch, yaw, 0);
			meshes = [];
			uiGroup.traverseVisible((o) => { if (o.userData.panel) meshes.push(o); });
			updateControllers(dt);
		},
		releaseAll: () => { for (const ptr of pointers) releasePointer(ptr); },
		resetLook: () => { yaw = pitch = 0; },
	};
}

// 3D model on the stage: a glTF / GLB fitted into the stage's width and height, centered on it and kept behind the screen
// plane until the hands move it, lit by its own hemisphere + directional light (the UI is unlit). The center panel adds
// `group` at the stage center.
import * as THREE from "three";
import { GLTFLoader } from "../vendor/GLTFLoader.js";

const ZOOM_MIN = 0.25, ZOOM_MAX = 4, PITCH_MAX = Math.PI / 2;
const BEHIND = 0.01; // gap between the model's front and the screen plane

function dispose(root) {
	root.traverse((o) => {
		o.geometry?.dispose();
		for (const m of [o.material ?? []].flat()) {
			for (const v of Object.values(m)) {
				if (!v?.isTexture) continue;
				if (v.source.data instanceof ImageBitmap) v.source.data.close();
				v.dispose();
			}
			m.dispose();
		}
	});
}

export function createModelView() {
	const loader = new GLTFLoader();
	const group = new THREE.Group();
	const pivot = new THREE.Group(); // turn and zoom around the model's box center
	const sun = new THREE.DirectionalLight(0xffffff, 2.5);
	sun.position.set(0.4, 1, 1);
	sun.target = pivot;
	group.add(pivot, sun, new THREE.HemisphereLight(0xffffff, 0x445066, 2));
	group.visible = false;

	const box = new THREE.Box3(), size = new THREE.Vector3();
	const inv = new THREE.Matrix4(), local = new THREE.Ray(), pt = new THREE.Vector3();
	const euler = new THREE.Euler(), held = new THREE.Quaternion(); // turns apply on top of the rotation the hands left
	let root = null, scale = 1, yaw = 0, pitch = 0, stageW = 1, stageH = 1;
	let moved = false; // the hands placed it: no longer pushed behind the screen plane

	// fit the box into the stage, then push the pivot back until the turned box's front is behind the screen plane
	function place() {
		if (!root) return;
		const fit = Math.min(stageW / size.x, stageH / size.y);
		pivot.quaternion.setFromEuler(euler.set(pitch, yaw, 0)).multiply(held);
		pivot.scale.setScalar(fit * scale);
		if (moved) return;
		pivot.updateMatrix();
		const e = pivot.matrix.elements;
		pivot.position.z = -(Math.abs(e[2]) * size.x + Math.abs(e[6]) * size.y + Math.abs(e[10]) * size.z) / 2 - BEHIND;
	}

	// Grab: one hand carries the model rigidly; two scale it by their distance, turn it by the vector between them and move it
	// with their midpoint. Hand poses are world matrices, kept in the group's frame; `start` is the pose when the hands last changed.
	const hands = new Map(), turnBy = new THREE.Quaternion(), dir = new THREE.Vector3(), mid = new THREE.Vector3();
	const pa = new THREE.Vector3(), pb = new THREE.Vector3(), rigid = new THREE.Matrix4(), unit = new THREE.Vector3(1, 1, 1);
	let start = null;

	function toGroup(world, out) {
		group.updateWorldMatrix(true, false);
		return out.copy(group.matrixWorld).invert().multiply(world);
	}

	function begin() {
		held.copy(pivot.quaternion);
		yaw = pitch = 0;
		moved = true;
		const [a, b] = hands.values();
		start = { pos: pivot.position.clone(), quat: held.clone(), scale };
		if (b) {
			pa.setFromMatrixPosition(a);
			pb.setFromMatrixPosition(b);
			start.mid = pa.clone().add(pb).multiplyScalar(0.5);
			start.dist = pa.distanceTo(pb);
			start.dir = pb.sub(pa).normalize().clone();
		} else if (a) start.offset = a.clone().invert().multiply(rigid.compose(pivot.position, held, unit));
	}

	function follow() {
		const [a, b] = hands.values();
		if (b) {
			pa.setFromMatrixPosition(a);
			pb.setFromMatrixPosition(b);
			mid.copy(pa).add(pb).multiplyScalar(0.5);
			scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, start.scale * pa.distanceTo(pb) / start.dist));
			turnBy.setFromUnitVectors(start.dir, dir.copy(pb).sub(pa).normalize());
			held.copy(turnBy).multiply(start.quat);
			pivot.position.copy(start.pos).sub(start.mid).applyQuaternion(turnBy).multiplyScalar(scale / start.scale).add(mid);
		} else rigid.multiplyMatrices(a, start.offset).decompose(pivot.position, held, pa);
		place();
	}

	return {
		group,
		entry: null, // history entry of the loaded model

		// { scene, box }: box is measured in the scene's own frame
		async load(url) {
			const { scene } = await loader.loadAsync(url);
			scene.updateMatrixWorld(true);
			return { scene, box: new THREE.Box3().setFromObject(scene) };
		},

		discard({ scene }) {
			dispose(scene);
		},

		show(loaded, entry) {
			if (root) {
				pivot.remove(root);
				dispose(root);
			}
			root = loaded.scene;
			box.copy(loaded.box);
			box.getSize(size).max(new THREE.Vector3(1e-6, 1e-6, 1e-6));
			box.getCenter(root.position).negate();
			pivot.add(root);
			this.entry = entry;
			this.reset();
		},

		setStage(w, h) {
			stageW = w;
			stageH = h;
			place();
		},

		// distance along a world ray to the model's box, or null
		hit(ray) {
			if (!root || !group.visible) return null;
			root.updateWorldMatrix(true, false);
			local.copy(ray).applyMatrix4(inv.copy(root.matrixWorld).invert());
			if (!local.intersectBox(box, pt)) return null;
			return pt.applyMatrix4(root.matrixWorld).distanceTo(ray.origin);
		},

		turn(dYaw, dPitch) {
			yaw += dYaw;
			pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, pitch + dPitch));
			place();
		},

		zoom(k) {
			scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale * k));
			place();
		},

		// id: the hand; world: its pose (Matrix4), followed rigidly
		grab(id, world) {
			hands.set(id, toGroup(world, new THREE.Matrix4()));
			begin();
		},

		drag(id, world) {
			toGroup(world, hands.get(id));
			follow();
		},

		release(id) {
			hands.delete(id);
			begin();
		},

		// back to the automatic placement; a hand still holding carries it on from there
		reset() {
			yaw = pitch = 0;
			held.identity();
			scale = 1;
			moved = false;
			pivot.position.set(0, 0, 0);
			place();
			if (hands.size) begin();
		},
	};
}

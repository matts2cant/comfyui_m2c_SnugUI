// 3D model on the stage: a glTF / GLB fitted into the stage's width and height, centered on it and kept behind the screen
// plane, lit by its own hemisphere + directional light (the UI is unlit). The center panel adds `group` at the stage center.
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
	let root = null, scale = 1, yaw = 0, pitch = 0, stageW = 1, stageH = 1;

	// fit the box into the stage, then push the pivot back until the turned box's front is behind the screen plane
	function place() {
		if (!root) return;
		const fit = Math.min(stageW / size.x, stageH / size.y);
		pivot.rotation.set(pitch, yaw, 0);
		pivot.scale.setScalar(fit * scale);
		pivot.updateMatrix();
		const e = pivot.matrix.elements;
		pivot.position.z = -(Math.abs(e[2]) * size.x + Math.abs(e[6]) * size.y + Math.abs(e[10]) * size.z) / 2 - BEHIND;
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

		reset() {
			yaw = pitch = 0;
			scale = 1;
			place();
		},
	};
}

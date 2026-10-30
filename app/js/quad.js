// XR quad layer (HD): the image in a WebXR quad layer, sharper than the mesh texture. Untested on the headset: off until the
// pop-up's HD button is pressed.
import * as THREE from "three";

const LAYER_MAX = 3072;
const FLIP_Y = true; // layer textures follow GL row order, bottom row first

// holeMesh: center's hole-punch twin of the image (its world matrix gives the layer's size and pose). update(shown, enabled) each
// frame, shown the image on the stage: the layer shows it while enabled -> whether it does (the hole is punched, the image mesh
// is not needed); supported(): an XR session that takes layers (the HD button).
export function createQuadLayer({ renderer, xr }, holeMesh) {
	let hdSupported = false, layerFailed = false;
	let layerSession = null, quad = null, quadW = 0, quadH = 0, inLayers = false, uploaded = null;
	let shown = null; // the image on show (center's)
	const lastPose = new THREE.Matrix4();
	const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
	const scaler = document.createElement("canvas");

	function applyPose(m) {
		m.decompose(pos, quat, scl);
		quad.width = scl.x / 2;
		quad.height = scl.y / 2;
		quad.transform = new XRRigidTransform(pos, quat);
		lastPose.copy(m);
	}

	function upload(binding, pw, ph) {
		let src = shown;
		if (pw !== shown.naturalWidth) {
			scaler.width = pw;
			scaler.height = ph;
			scaler.getContext("2d").drawImage(shown, 0, 0, pw, ph);
			src = scaler;
		}
		const gl = renderer.getContext();
		const sub = binding.getSubImage(quad, renderer.xr.getFrame());
		renderer.state.bindTexture(gl.TEXTURE_2D, sub.colorTexture);
		gl.getError();
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, FLIP_Y);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		// a rejected upload would leave the hole over an empty layer
		if (gl.getError()) throw new Error("quad layer upload failed");
		uploaded = shown;
	}

	// Mirrors three's webxr_vr_layers example: [quad layer, projection layer] with a transparent hole
	// punched where the image is. Sets holeMesh's visibility and returns it. Quest Browser takes quad width/height
	// as half extents (three halves them too). Size and pose follow holeMesh's world matrix, so the image's pan and zoom.
	function updateLayer(enabled) {
		const session = xr.isPresenting() ? renderer.xr.getSession() : null;
		if (session !== layerSession) {
			layerSession = session;
			quad = uploaded = null;
			inLayers = false;
		}
		const binding = session && !layerFailed ? renderer.xr.getBinding() : null;
		hdSupported = !!binding;
		let hole = false;
		if (binding && enabled) {
			const k = Math.min(1, LAYER_MAX / Math.max(shown.naturalWidth, shown.naturalHeight));
			const pw = Math.round(shown.naturalWidth * k), ph = Math.round(shown.naturalHeight * k);
			holeMesh.updateWorldMatrix(true, false);
			const m = holeMesh.matrixWorld;
			if (!quad || quadW !== pw || quadH !== ph) {
				quad?.destroy();
				m.decompose(pos, quat, scl);
				quad = binding.createQuadLayer({
					space: renderer.xr.getReferenceSpace(), layout: "mono", viewPixelWidth: pw, viewPixelHeight: ph,
					width: scl.x / 2, height: scl.y / 2, transform: new XRRigidTransform(pos, quat),
				});
				lastPose.copy(m);
				quadW = pw;
				quadH = ph;
				uploaded = null;
				inLayers = false;
			} else if (!lastPose.equals(m)) applyPose(m);
			if (!inLayers) {
				session.updateRenderState({ layers: [quad, renderer.xr.getBaseLayer()] });
				inLayers = true;
			} else {
				if (uploaded !== shown || quad.needsRedraw) upload(binding, pw, ph);
				hole = true;
			}
		} else if (inLayers) {
			inLayers = false;
			session.updateRenderState({ layers: [renderer.xr.getBaseLayer()] });
		}
		holeMesh.visible = hole;
		return hole;
	}

	return {
		supported: () => hdSupported,
		update(img, enabled) {
			shown = img;
			try {
				return updateLayer(enabled);
			} catch (e) {
				console.warn("quad layer disabled", e);
				layerFailed = true;
				quad = null;
				if (inLayers) renderer.xr.getSession().updateRenderState({ layers: [renderer.xr.getBaseLayer()] });
				inLayers = false;
				holeMesh.visible = false;
				return false;
			}
		},
	};
}

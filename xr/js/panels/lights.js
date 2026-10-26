// Lighting panel: preset buttons for the 3D model's look. A preset sets the model's key / fill / rim lights and hemisphere
// (model.light), an environment map for its reflections (PMREM of a small scene: the preset's gradient sky plus one emissive
// panel per light, built once per preset) and the room's gradient, whatever the output on show. Panels and images use unlit,
// non tone mapped materials, so none of this changes them.
import * as THREE from "three";

const PRESET_KEY = "appmode-xr.lighting";
const ENV_DIST = 5;

// key / fill / rim: [color, intensity, x, y, z], x y z pointing at the light in the stage frame (+y up, +z towards the viewer);
// hemi: [sky, ground, intensity]; sky: gradient top, horizon, bottom (background and environment);
// env: [side of each light's panel at ENV_DIST, panel radiance per unit of light intensity]
const PRESETS = [
	{
		name: "Neutral studio",
		key: [0xffffff, 2.2, 1, 1.2, 1.4], fill: [0xf2f4f8, 0.7, -1.4, 0.4, 1], rim: [0xffffff, 1.4, -0.4, 1, -1.4],
		hemi: [0xffffff, 0x3a3a3a, 0.5], sky: ["#4a4d52", "#2e3034", "#1a1b1d"], env: [2.6, 0.6],
	},
	{
		name: "High-key studio",
		key: [0xffffff, 1.8, 0.7, 1.2, 1.4], fill: [0xffffff, 1.1, -1.2, 0.4, 1.2], rim: [0xffffff, 1, 0, 1, -1.5],
		hemi: [0xffffff, 0xcfd2d6, 0.8], sky: ["#f5f6f8", "#e4e6ea", "#c4c7cc"], env: [3.2, 0.5],
	},
	{
		name: "Dramatic rim",
		key: [0xffffff, 0.5, 1.2, 0.8, 1], fill: [0x9fbaff, 3, -1.5, 0.5, -1.1], rim: [0xffffff, 3.5, 1.5, 0.7, -1.1],
		hemi: [0x1c2030, 0x000000, 0.2], sky: ["#0b0c10", "#060608", "#020203"], env: [1.4, 1.2],
	},
	{
		name: "Warm dark",
		key: [0xffa860, 2.2, 1, 0.8, 1.2], fill: [0x8a4a22, 0.5, -1.3, 0.3, 1], rim: [0xffd0a0, 1.2, -0.6, 1.2, -1.4],
		hemi: [0x5a3820, 0x0c0603, 0.4], sky: ["#2c1d14", "#1a110b", "#0a0604"], env: [1.8, 0.6],
	},
	{
		name: "Daylight outdoor",
		key: [0xfff2dc, 3, 0.8, 2, 0.9], fill: [0xa8c8ff, 0.4, -1, 0.6, 0.7], rim: [0xffffff, 0.5, -0.4, 1, -1.5],
		hemi: [0x9ec5ff, 0x6b5f4a, 0.8], sky: ["#3f7fd6", "#bcd8f2", "#7a7363"], env: [0.5, 8],
	},
	{
		name: "Overcast",
		key: [0xf2f5ff, 0.8, 0.3, 2, 0.5], fill: [0xe2e8f0, 0.4, -1, 0.5, 1], rim: [0xffffff, 0.3, 0, 1, -1.5],
		hemi: [0xdfe4ea, 0x4c4c46, 1], sky: ["#d0d5db", "#b2b7bd", "#5a5a55"], env: [4, 0.4],
	},
	{
		name: "Golden hour",
		key: [0xff9a48, 3, 1.6, 0.35, 0.6], fill: [0x6a86c8, 0.5, -1.2, 0.6, 0.8], rim: [0xffc07a, 1.6, -1, 0.4, -1.2],
		hemi: [0x8a90c0, 0x4a3020, 0.5], sky: ["#34436e", "#f0a258", "#4a3828"], env: [0.8, 5],
	},
];

function paintSky(canvas, stops) {
	const g = canvas.getContext("2d");
	const grad = g.createLinearGradient(0, 0, 0, canvas.height);
	stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
	g.fillStyle = grad;
	g.fillRect(0, 0, canvas.width, canvas.height);
}

function skyTexture(stops) {
	const c = document.createElement("canvas");
	c.width = 2;
	c.height = 256;
	paintSky(c, stops);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

function buildEnvironment(pmrem, { sky, env: [side, gain], key, fill, rim }) {
	const scene = new THREE.Scene();
	scene.add(new THREE.Mesh(new THREE.SphereGeometry(ENV_DIST * 2, 32, 16), new THREE.MeshBasicMaterial({ map: skyTexture(sky), side: THREE.BackSide })));
	const quad = new THREE.PlaneGeometry(side, side);
	for (const [color, intensity, x, y, z] of [key, fill, rim]) {
		const panel = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity * gain) }));
		panel.position.set(x, y, z).setLength(ENV_DIST);
		panel.lookAt(0, 0, 0);
		scene.add(panel);
	}
	const texture = pmrem.fromScene(scene, 0.02).texture;
	scene.traverse((o) => {
		o.geometry?.dispose();
		o.material?.map?.dispose();
		o.material?.dispose();
	});
	return texture;
}

export function createLightsPanel({ ui, scene, renderer }, model) {
	const panel = new ui.Panel({ name: "lights", widthM: 0.85, heightM: 1.15 });
	const group = new THREE.Group();
	group.add(panel.mesh);
	panel.add(new ui.Label({ text: "Lighting", size: 34, bold: true, x: 24, y: 14, w: panel.width - 48, h: 50 }));
	const buttons = PRESETS.map((p, i) => panel.add(new ui.Button({ text: p.name, size: 32, x: 24, y: 84 + i * 124, w: panel.width - 48, h: 104, onClick: () => select(p) })));

	// room around the panels: floor grid and a sphere with the preset's gradient
	const room = new THREE.Group();
	const sky = skyTexture(PRESETS[0].sky);
	room.add(new THREE.GridHelper(12, 24, 0x2a3446, 0x1a2230));
	room.add(new THREE.Mesh(new THREE.SphereGeometry(40, 24, 16), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, depthWrite: false })));

	const envs = new Map();
	let pmrem = null, preset = PRESETS[0];
	try {
		preset = PRESETS.find((p) => p.name === localStorage.getItem(PRESET_KEY)) ?? preset;
	} catch {}

	function apply() {
		buttons.forEach((b, i) => { b.toggled = PRESETS[i] === preset; });
		panel.invalidate();
		model.light(preset);
		paintSky(sky.image, preset.sky);
		sky.needsUpdate = true;
		if (!envs.has(preset)) {
			pmrem ??= new THREE.PMREMGenerator(renderer);
			envs.set(preset, buildEnvironment(pmrem, preset));
		}
		scene.environment = envs.get(preset);
	}

	function select(p) {
		preset = p;
		try {
			localStorage.setItem(PRESET_KEY, p.name);
		} catch {}
		apply();
	}

	apply();
	return { group, panel, room };
}

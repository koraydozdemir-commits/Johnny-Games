/**
 * Planet surfaces for 3D globes: an equirectangular map (oceans, land coloured by height and climate,
 * polar ice) and a cloud map, both from the planet's surface seed, so a world always looks the same.
 * Noise is sampled on the sphere (not the flat map), so there is no seam and no pinching at the poles.
 */
import * as THREE from "three";
import { rng32 } from "./names.js";

const LAND = {
  terrestrial: [[0.18, "#c9b27a"], [0.35, "#5c9a48"], [0.62, "#3f7a3a"], [0.85, "#7a6a55"], [1, "#e8e8e8"]],
  jungle: [[0.15, "#d9c58a"], [0.4, "#2f8a3e"], [0.7, "#1f5f32"], [0.9, "#4a6a3a"], [1, "#9aa58a"]],
  oceanic: [[0.2, "#e0d0a0"], [0.5, "#6fbf5a"], [0.8, "#3f8a4a"], [1, "#8a8a7a"]],
  swamp: [[0.2, "#7a7a4a"], [0.5, "#5d6b33"], [0.8, "#3c4a2a"], [1, "#6a6a5a"]],
  tundra: [[0.2, "#9aa08a"], [0.5, "#5f7a5a"], [0.75, "#8f9a8f"], [1, "#f2f4f6"]],
  desert: [[0.3, "#e0b070"], [0.6, "#c98a4a"], [0.85, "#a8643a"], [1, "#f2d9a0"]],
};
const SEA = { terrestrial: ["#1d4f8f", "#2f7cc4"], jungle: ["#155a7a", "#2f9ab0"], oceanic: ["#123f80", "#2f86c9"], swamp: ["#2f4a3a", "#4a6a4a"], tundra: ["#2a4a6a", "#4a7a9a"], desert: ["#2a5a7a", "#4a8aa0"] };

/** Smooth 3D value noise with a seeded lattice. */
function makeNoise(seed) {
  const r = rng32(seed);
  const perm = new Uint8Array(512),
    vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) (perm[i] = i), (vals[i] = r());
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const h = (x, y, z) => vals[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
  const f = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const n = (x, y, z) => {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      zi = Math.floor(z);
    const xf = f(x - xi),
      yf = f(y - yi),
      zf = f(z - zi);
    return lerp(
      lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), xf), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf), yf),
      lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf), yf),
      zf,
    );
  };
  return (x, y, z, oct = 5) => {
    let a = 0,
      amp = 0.5,
      fr = 1;
    for (let o = 0; o < oct; o++) (a += n(x * fr, y * fr, z * fr) * amp), (amp *= 0.5), (fr *= 2.03);
    return a / 0.97;
  };
}
const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
function ramp(stops, t) {
  for (let i = 0; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      if (i === 0) return rgb(stops[0][1]);
      const [t0, c0] = stops[i - 1],
        [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0),
        a = rgb(c0),
        b = rgb(c1);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  return rgb(stops[stops.length - 1][1]);
}

/**
 * Surface and cloud textures for a planet.
 * @param {object} planet  from galaxy/gen.js
 * @param {number} [w]     map width in pixels (height is half)
 */
export function planetTextures(planet, w = 256) {
  const h = w / 2;
  const noise = makeNoise(planet.surfaceSeed || 1);
  const cloudNoise = makeNoise((planet.surfaceSeed || 1) ^ 0x5bd1e995);
  const type = LAND[planet.type] ? planet.type : "terrestrial";
  const sea = SEA[type].map(rgb);
  const water = Math.max(0.05, Math.min(0.9, planet.water ?? 0.5));
  const cold = planet.temp < 5 ? 0.62 : planet.temp < 18 ? 0.78 : 0.88; // latitude where ice begins
  const surf = document.createElement("canvas");
  surf.width = w;
  surf.height = h;
  const clouds = document.createElement("canvas");
  clouds.width = w;
  clouds.height = h;
  const sctx = surf.getContext("2d"),
    cctx = clouds.getContext("2d");
  const sImg = sctx.createImageData(w, h),
    cImg = cctx.createImageData(w, h);
  // Sea level: the height below which `water` of the surface lies (noise is roughly centred on 0.5).
  const level = 0.5 + (water - 0.5) * 0.36;
  const cover = planet.clouds ?? 0.4;
  for (let y = 0; y < h; y++) {
    const lat = (y / h - 0.5) * Math.PI;
    const cl = Math.cos(lat),
      sl = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = (x / w) * Math.PI * 2;
      const px = cl * Math.cos(lon) * 1.6,
        py = sl * 1.6,
        pz = cl * Math.sin(lon) * 1.6;
      const e = noise(px + 7, py + 3, pz + 11);
      const i = (y * w + x) * 4;
      let c;
      const polar = Math.abs(sl) + (noise(px * 3, py * 3, pz * 3, 3) - 0.5) * 0.25;
      if (polar > cold) c = [236, 242, 248];
      else if (e < level) {
        const d = Math.max(0, Math.min(1, (level - e) / 0.18));
        c = [sea[1][0] + (sea[0][0] - sea[1][0]) * d, sea[1][1] + (sea[0][1] - sea[1][1]) * d, sea[1][2] + (sea[0][2] - sea[1][2]) * d];
      } else {
        const t = Math.min(1, (e - level) / Math.max(0.05, 1 - level - 0.15));
        c = ramp(LAND[type], t);
        const grain = (noise(px * 9, py * 9, pz * 9, 2) - 0.5) * 22;
        c = [c[0] + grain, c[1] + grain, c[2] + grain];
      }
      sImg.data[i] = c[0];
      sImg.data[i + 1] = c[1];
      sImg.data[i + 2] = c[2];
      sImg.data[i + 3] = 255;
      // Clouds: streaky along latitude bands.
      const cn = cloudNoise(px * 1.4, py * 2.6, pz * 1.4);
      const a = Math.max(0, Math.min(0.85, (cn - (0.56 - cover * 0.16)) * 2.6));
      cImg.data[i] = cImg.data[i + 1] = cImg.data[i + 2] = 255;
      cImg.data[i + 3] = a * 235;
    }
  }
  sctx.putImageData(sImg, 0, 0);
  cctx.putImageData(cImg, 0, 0);
  const surface = new THREE.CanvasTexture(surf);
  surface.colorSpace = THREE.SRGBColorSpace;
  const cloudTex = new THREE.CanvasTexture(clouds);
  cloudTex.colorSpace = THREE.SRGBColorSpace;
  return { surface, clouds: cloudTex, seaColor: SEA[type][1] };
}

/** A planet globe: surface, clouds and a soft atmosphere rim. */
export function makePlanetGlobe(planet, { size = 256, radius = 1, textures = null } = {}) {
  // Two globes of one world (say a scene and a preview) can share one set of textures.
  const tex = textures || planetTextures(planet, size);
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(radius, 48, 32);
  const mat = new THREE.MeshStandardMaterial({ map: tex.surface, roughness: 0.85, metalness: 0 });
  const globe = new THREE.Mesh(geo, mat);
  const cloudGeo = new THREE.SphereGeometry(radius * 1.015, 48, 32);
  const cloudMat = new THREE.MeshStandardMaterial({ map: tex.clouds, transparent: true, depthWrite: false, roughness: 1 });
  const cloud = new THREE.Mesh(cloudGeo, cloudMat);
  // Atmosphere: a back-facing shell, brightest at the rim.
  const atmoGeo = new THREE.SphereGeometry(radius * 1.12, 40, 28);
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(planet.atmosphere === "Breathable" ? 0x7fc4ff : 0xd9c08a) } },
    vertexShader: "varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }",
    fragmentShader: "uniform vec3 color; varying vec3 vN; varying vec3 vV; void main(){ float r = pow(1. - abs(dot(vN, vV)), 2.4); gl_FragColor = vec4(color, r*0.9); }",
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const atmo = new THREE.Mesh(atmoGeo, atmoMat);
  group.add(globe, cloud, atmo);
  return {
    group,
    globe,
    cloud,
    update(dt) {
      globe.rotation.y += dt * 0.12;
      cloud.rotation.y += dt * 0.16;
    },
    dispose() {
      [geo, cloudGeo, atmoGeo].forEach((g) => g.dispose());
      [mat, cloudMat, atmoMat].forEach((m) => m.dispose());
      if (!textures) {
        tex.surface.dispose();
        tex.clouds.dispose();
      }
      group.removeFromParent();
    },
  };
}

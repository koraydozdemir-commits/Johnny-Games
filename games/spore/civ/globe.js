/**
 * The planet, drawn: terrain on a subdivided icosphere coloured by biome (in the homeworld's own
 * palette), the sea, an atmosphere that glows at the limb, drifting clouds, forests, stars, and a sun
 * that goes round for day and night. Also the helpers everything else uses to stand on the surface:
 * a matrix for a direction (and a heading), and picking a surface point under the pointer.
 */
import * as THREE from "three";
import { R, icosphere } from "./planet.js";

const TAU = Math.PI * 2;
/** How tall the terrain is drawn (heights are real world units already; this just exaggerates relief). */
export const RELIEF = 1;
/** One full day (seconds). */
export const DAY = 420;

/**
 * @param {THREE.Scene} scene
 * @param {object} planet       from createPlanet
 * @param {object} o
 * @param {object} o.colors      ground palette (grassLight, grassDark, dirt, rock, cliff, snow, sand, seabed, leaf, trunk)
 * @param {number} [o.water]     sea colour
 * @param {number} [o.sky]       atmosphere colour
 * @param {string} [o.quality]   "low" | "medium" | "high"
 */
export function createGlobe(scene, planet, o) {
  const disposables = [];
  const keep = (x) => (disposables.push(x), x);
  const col = o.colors;
  const C = (hex) => new THREE.Color(hex);
  const PAL = {
    deep: C(col.seabed).multiplyScalar(0.45),
    sea: C(col.seabed).multiplyScalar(0.7),
    shallows: C(col.seabed),
    beach: C(col.sand),
    grass: C(col.grassLight),
    forest: C(col.grassDark),
    desert: C(col.sand).lerp(C(col.dirt), 0.35),
    tundra: C(col.dirt).lerp(C(col.snow), 0.35),
    rock: C(col.rock),
    snow: C(col.snow),
  };

  /* ---- terrain --------------------------------------------------------------------------------- */
  const detail = o.quality === "low" ? 5 : 6;
  const ico = icosphere(detail);
  const n = ico.count;
  const pos = new Float32Array(n * 3),
    colors = new Float32Array(n * 3);
  const biomes = new Array(n);
  const tmpC = new THREE.Color();
  const shade = planet.height; // flattened around cities once they are placed (see rebuild())
  function fill() {
    for (let i = 0; i < n; i++) {
      const d = { x: ico.points[i * 3], y: ico.points[i * 3 + 1], z: ico.points[i * 3 + 2] };
      const h = shade(d);
      const r = R + h * RELIEF;
      pos[i * 3] = d.x * r;
      pos[i * 3 + 1] = d.y * r;
      pos[i * 3 + 2] = d.z * r;
      const b = planet.biome(d, h);
      biomes[i] = b;
      tmpC.copy(PAL[b]);
      // A little variation so the land isn't a flat poster.
      const v = 0.93 + ((i * 2654435761) >>> 0) / 4294967296 * 0.12;
      tmpC.multiplyScalar(v);
      colors[i * 3] = tmpC.r;
      colors[i * 3 + 1] = tmpC.g;
      colors[i * 3 + 2] = tmpC.b;
    }
  }
  fill();
  const geo = keep(new THREE.BufferGeometry());
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(ico.faces, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const ground = new THREE.Mesh(geo, keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true })));
  scene.add(ground);
  /** Re-shape the ground after cities flatten their sites. */
  function rebuild() {
    fill();
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
    placeTrees();
  }

  /* ---- sea ------------------------------------------------------------------------------------- */
  const seaGeo = keep(new THREE.IcosahedronGeometry(R, 5));
  const seaMat = keep(new THREE.MeshStandardMaterial({ color: o.water ?? 0x2f78b8, roughness: 0.28, metalness: 0.15, transparent: true, opacity: 0.86 }));
  const seaMesh = new THREE.Mesh(seaGeo, seaMat);
  scene.add(seaMesh);

  /* ---- forests: low-poly trees on wooded ground (only drawn from close enough to see them) ------- */
  const treeGeo = keep(new THREE.ConeGeometry(1.1, 3.4, 6).translate(0, 2.3, 0));
  const trunkGeo = keep(new THREE.CylinderGeometry(0.22, 0.3, 1, 5).translate(0, 0.5, 0));
  const maxTrees = o.quality === "low" ? 1500 : 3500;
  const leafMat = keep(new THREE.MeshStandardMaterial({ color: col.leaf ?? 0x3f8a3a, roughness: 0.9, flatShading: true }));
  const trunkMat = keep(new THREE.MeshStandardMaterial({ color: col.trunk ?? 0x6f5236, roughness: 1, flatShading: true }));
  const trees = new THREE.InstancedMesh(treeGeo, leafMat, maxTrees);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, maxTrees);
  trees.frustumCulled = trunks.frustumCulled = false;
  scene.add(trees, trunks);
  /** Spots kept clear of trees (cities, spice). */
  const clear = [];
  function placeTrees() {
    const m = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < n && k < maxTrees; i++) {
      const b = biomes[i];
      const r = ((i * 2246822519) >>> 0) / 4294967296;
      if (!(b === "forest" ? r < 0.5 : b === "grass" ? r < 0.05 : b === "tundra" ? r < 0.08 : false)) continue;
      const d = { x: ico.points[i * 3], y: ico.points[i * 3 + 1], z: ico.points[i * 3 + 2] };
      if (clear.some((c) => d.x * c.d.x + d.y * c.d.y + d.z * c.d.z > c.cos)) continue;
      surfaceMatrix(d, null, 0, m, 0.7 + r * 1.2, r * 40);
      trees.setMatrixAt(k, m);
      trunks.setMatrixAt(k, m);
      k++;
    }
    trees.count = trunks.count = k;
    trees.instanceMatrix.needsUpdate = trunks.instanceMatrix.needsUpdate = true;
  }

  /* ---- atmosphere: a glow at the limb, brighter on the day side ---------------------------------- */
  const sunDir = new THREE.Vector3(1, 0.3, 0.2).normalize();
  const atmoMat = keep(
    new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(o.sky ?? 0x8cc8ff) }, sun: { value: sunDir } },
      vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 color; uniform vec3 sun; varying vec3 vN; varying vec3 vW;
        void main(){ vec3 v = normalize(cameraPosition - vW); float rim = 1.0 - abs(dot(v, vN)); float day = smoothstep(-0.35, 0.5, dot(normalize(vW), sun));
        float a = pow(rim, 2.6) * (0.25 + 0.85 * day); gl_FragColor = vec4(color * (0.55 + 0.6 * day), a); }`,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const atmo = new THREE.Mesh(keep(new THREE.SphereGeometry(R * 1.1, 64, 32)), atmoMat);
  scene.add(atmo);

  /* ---- clouds: a soft layer above the ground, fading away as you come down through it ------------ */
  const cloudTex = (() => {
    const w = 384,
      h = 192;
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const g = cv.getContext("2d");
    const img = g.createImageData(w, h);
    // Seeded value noise on the sphere (wraps seamlessly round the equator).
    let s = (planet.seed ^ 0xc10d) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const grid = Array.from({ length: 4 }, (_, o2) => {
      const N = 6 << o2;
      return { N, v: Array.from({ length: (N + 1) * (N + 1) * (N + 1) }, rnd) };
    });
    const vn = (gr, x, y, z) => {
      const N = gr.N;
      const fx = ((x + 1) / 2) * (N - 1e-6),
        fy = ((y + 1) / 2) * (N - 1e-6),
        fz = ((z + 1) / 2) * (N - 1e-6);
      const i = Math.floor(fx),
        j = Math.floor(fy),
        k = Math.floor(fz);
      const tx = fx - i,
        ty = fy - j,
        tz = fz - k;
      const at = (a, b, c) => gr.v[(a * (N + 1) + b) * (N + 1) + c];
      const l = (a, b, t) => a + (b - a) * (t * t * (3 - 2 * t));
      return l(l(l(at(i, j, k), at(i + 1, j, k), tx), l(at(i, j + 1, k), at(i + 1, j + 1, k), tx), ty), l(l(at(i, j, k + 1), at(i + 1, j, k + 1), tx), l(at(i, j + 1, k + 1), at(i + 1, j + 1, k + 1), tx), ty), tz);
    };
    for (let y = 0; y < h; y++) {
      const lat = (0.5 - (y + 0.5) / h) * Math.PI;
      for (let x = 0; x < w; x++) {
        const lon = ((x + 0.5) / w) * TAU;
        const dx = Math.cos(lat) * Math.cos(lon),
          dy = Math.sin(lat),
          dz = Math.cos(lat) * Math.sin(lon);
        let v = 0,
          a = 0.55;
        for (const gr of grid) (v += vn(gr, dx, dy, dz) * a), (a *= 0.5);
        const c = Math.max(0, Math.min(1, (v - 0.52) * 3.2));
        const p = (y * w + x) * 4;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = 255;
        img.data[p + 3] = Math.round(c * 230);
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return keep(t);
  })();
  const cloudMat = keep(new THREE.MeshLambertMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.85 }));
  const clouds = new THREE.Mesh(keep(new THREE.SphereGeometry(R + 26, 64, 32)), cloudMat);
  scene.add(clouds);

  /* ---- stars ---------------------------------------------------------------------------------------- */
  const starGeo = keep(new THREE.BufferGeometry());
  {
    const pts = new Float32Array(1600 * 3);
    let s = 99;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 1600; i++) {
      const u = rnd() * 2 - 1,
        a = rnd() * TAU,
        r = Math.sqrt(1 - u * u);
      pts.set([Math.cos(a) * r * 3000, u * 3000, Math.sin(a) * r * 3000], i * 3);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
  }
  const stars = new THREE.Points(starGeo, keep(new THREE.PointsMaterial({ color: 0xdfe8ff, size: 2.2, sizeAttenuation: false })));
  scene.add(stars);
  scene.background = new THREE.Color(0x040812);

  /* ---- light: the sun goes round for day and night ------------------------------------------------- */
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.1);
  const fill2 = new THREE.HemisphereLight(0x9cc4ff, 0x20242c, 0.35);
  const ambient = new THREE.AmbientLight(0x30406a, 0.35);
  scene.add(sun, sun.target, fill2, ambient);
  let clock = DAY * 0.12;

  /* ---- helpers -------------------------------------------------------------------------------------- */
  const _u = new THREE.Vector3(),
    _e = new THREE.Vector3(),
    _n = new THREE.Vector3(),
    _p = new THREE.Vector3();
  /**
   * A matrix standing something on the surface at direction `d`, facing `fwd` (a tangent; null for a
   * fixed spin `spin`), raised `lift` above the ground (or above the sea, for boats), scaled `s`.
   */
  function surfaceMatrix(d, fwd, lift = 0, m = new THREE.Matrix4(), s = 1, spin = 0, onWater = false) {
    _u.set(d.x, d.y, d.z).normalize();
    if (fwd) _n.set(fwd.x, fwd.y, fwd.z);
    else {
      const ref = Math.abs(_u.y) > 0.995 ? _e.set(1, 0, 0) : _e.set(0, 1, 0);
      _n.crossVectors(_u, _e.crossVectors(ref, _u).normalize());
      if (spin) _n.applyAxisAngle(_u, spin);
    }
    // Keep the heading tangent, then build east = up × forward (so +z is forward, +y is up).
    _n.addScaledVector(_u, -_n.dot(_u)).normalize();
    _e.crossVectors(_u, _n);
    const h = planet.height(d);
    const r = R + (onWater ? Math.max(0, h) : h) * RELIEF + lift;
    _p.copy(_u).multiplyScalar(r);
    m.makeBasis(_e, _u, _n);
    m.scale(_p.set(s, s, s));
    m.setPosition(_u.x * r, _u.y * r, _u.z * r);
    return m;
  }
  /** The surface point (as a direction) under a ray, or null if it misses the planet. */
  function pick(ray) {
    const o2 = ray.origin,
      dir = ray.direction;
    // March from where the ray enters the highest the ground goes, down to where it meets the ground (or the sea).
    const top = R + 22;
    const b = o2.dot(dir),
      c = o2.lengthSq() - top * top,
      disc = b * b - c;
    if (disc < 0) return null;
    let t = Math.max(0, -b - Math.sqrt(disc));
    const tEnd = -b + Math.sqrt(disc);
    const p = new THREE.Vector3();
    let prev = t;
    for (; t < tEnd; t += 0.8) {
      p.copy(o2).addScaledVector(dir, t);
      const l = p.length();
      const d = { x: p.x / l, y: p.y / l, z: p.z / l };
      if (l <= R + Math.max(0, planet.height(d)) * RELIEF) {
        // Refine between the last two steps.
        let lo = prev,
          hi = t;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          p.copy(o2).addScaledVector(dir, mid);
          const lm = p.length();
          if (lm <= R + Math.max(0, planet.height({ x: p.x / lm, y: p.y / lm, z: p.z / lm })) * RELIEF) hi = mid;
          else lo = mid;
        }
        p.copy(o2).addScaledVector(dir, hi).normalize();
        return { x: p.x, y: p.y, z: p.z };
      }
      prev = t;
    }
    return null;
  }
  /** The world position of the ground (or sea surface) at a direction, raised by `lift`. */
  function surfacePoint(d, lift = 0, out = new THREE.Vector3()) {
    const h = Math.max(0, planet.height(d));
    return out.set(d.x, d.y, d.z).multiplyScalar(R + h * RELIEF + lift);
  }

  return {
    ground,
    sea: seaMesh,
    clouds,
    sunDir,
    rebuild,
    surfaceMatrix,
    surfacePoint,
    pick,
    /** Keep trees off a spot (radius in world units). */
    clearTrees(d, radius) {
      clear.push({ d, cos: Math.cos(radius / R) });
    },
    placeTrees,
    /** 0 midnight … 0.5 noon, for a direction: how much daylight falls there right now. */
    daylight(d) {
      return Math.max(0, Math.min(1, (d.x * sunDir.x + d.y * sunDir.y + d.z * sunDir.z) * 2.2 + 0.35));
    },
    get time() {
      return clock;
    },
    set time(t) {
      clock = t;
    },
    /**
     * @param {number} dt
     * @param {THREE.Camera} camera
     * @param {number} altitude  the camera's height above the ground (for fading clouds and showing trees)
     */
    update(dt, camera, altitude) {
      clock += dt;
      const a = (clock / DAY) * TAU;
      sunDir.set(Math.cos(a), 0.28, Math.sin(a)).normalize();
      sun.position.copy(sunDir).multiplyScalar(R * 4);
      sun.target.position.set(0, 0, 0);
      fill2.position.copy(sunDir);
      clouds.rotation.y += dt * 0.006;
      // Clouds thin out as you come down to city height, so they never hide what you are doing.
      const k = Math.max(0, Math.min(1, (altitude - 70) / 140));
      cloudMat.opacity = 0.85 * k;
      clouds.visible = k > 0.02;
      // Trees only once you are close enough to see them (and the city layer needs the draw calls).
      trees.visible = trunks.visible = altitude < 260;
      stars.position.copy(camera.position);
    },
    dispose() {
      scene.remove(ground, seaMesh, trees, trunks, atmo, clouds, stars, sun, sun.target, fill2, ambient);
      disposables.forEach((x) => x.dispose());
    },
  };
}

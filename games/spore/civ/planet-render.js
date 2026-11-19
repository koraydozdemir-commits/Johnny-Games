/**
 * The planet in 3D: a sphere of terrain chunks with their own level of detail, the sea with its own
 * material, an atmosphere shell, a star field and the lights. Terrain is built lazily from the planet map
 * (civ/planet-map.js) in small time slices, so opening the stage is quick and a tablet is never asked to
 * hold the whole planet at close-up resolution.
 *
 * Chunks: the sphere is cut into 18 x 9 patches of 20 degrees. Each patch has four resolutions (10, 20,
 * 32 and 44 cells a side); the camera's distance picks one, and a patch keeps showing its old resolution
 * until the new one is built, so nothing flickers. Patches on the far side of the planet are not drawn,
 * and a low skirt under every patch edge hides the cracks between neighbours of different detail.
 */
import * as THREE from "three";
import { PLANET, mapToLonLat, unitVector } from "./planet-map.js";

const { R } = PLANET;
const LON_N = 18,
  LAT_N = 9;
const LEVELS = [10, 20, 32, 44];
/** Camera distances (to a patch) under which each level is wanted: level 3 below 150, 2 below 260, 1 below 460. */
const LEVEL_AT = [Infinity, 460, 260, 150];
const SKIRT = 5;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

/* -------------------------------------------------------------------------------- placing things */
/**
 * Where things stand: a point on the planet with the local frame (x east, y up, z south), the same
 * handedness as the flat world every model and design is authored in, so they drop straight in.
 */
export function surfaceFrame(map, x, z, h = 0, out = {}) {
  const { lon, lat } = mapToLonLat(x, z);
  const cl = Math.cos(lat),
    sl = Math.sin(lat),
    co = Math.cos(lon),
    so = Math.sin(lon);
  out.up = (out.up || new THREE.Vector3()).set(cl * co, sl, -cl * so);
  out.east = (out.east || new THREE.Vector3()).set(-so, 0, -co);
  out.south = (out.south || new THREE.Vector3()).crossVectors(out.east, out.up);
  out.pos = (out.pos || new THREE.Vector3()).copy(out.up).multiplyScalar(R + h);
  return out;
}
const _frame = {};
const _qy = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);
/** Stand an object at a map point, `h` above the sea, turned by `heading` (radians, 0 faces south) about the local up. */
export function placeOnPlanet(map, obj, x, z, h = 0, heading = 0) {
  surfaceFrame(map, x, z, h, _frame);
  _m.makeBasis(_frame.east, _frame.up, _frame.south);
  obj.position.copy(_frame.pos);
  obj.quaternion.setFromRotationMatrix(_m);
  if (heading) obj.quaternion.multiply(_qy.setFromAxisAngle(_Y, heading));
  return obj;
}
/** Write a quaternion for the local frame at a map point into `q`. */
export function frameQuat(map, x, z, q = new THREE.Quaternion()) {
  surfaceFrame(map, x, z, 0, _frame);
  _m.makeBasis(_frame.east, _frame.up, _frame.south);
  return q.setFromRotationMatrix(_m);
}
/** World position of a map point at height h above the sea. */
export function worldAt(map, x, z, h = 0, out = new THREE.Vector3()) {
  surfaceFrame(map, x, z, h, _frame);
  return out.copy(_frame.pos);
}

/* ---------------------------------------------------------------------------------- terrain chunks */
function buildChunkGeometry(map, chunk, n) {
  const { lon0, lon1, lat0, lat1 } = chunk;
  const W = n + 3; // sample one extra ring all round, so normals at the edges use real neighbours
  const heights = new Float32Array(W * W);
  const lons = new Float32Array(W),
    lats = new Float32Array(W);
  for (let i = 0; i < W; i++) lons[i] = lon0 + ((i - 1) / n) * (lon1 - lon0);
  for (let j = 0; j < W; j++) lats[j] = clamp(lat0 + ((j - 1) / n) * (lat1 - lat0), -Math.PI / 2 + 1e-4, Math.PI / 2 - 1e-4);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) heights[j * W + i] = map.heightLL(lons[i], lats[j]);
  const pos = new Float32Array(W * W * 3);
  const u = [0, 0, 0];
  for (let j = 0; j < W; j++)
    for (let i = 0; i < W; i++) {
      const h = heights[j * W + i];
      unitVector(lons[i], lats[j], u);
      const r = R + Math.max(0, h);
      const k = (j * W + i) * 3;
      pos[k] = u[0] * r;
      pos[k + 1] = u[1] * r;
      pos[k + 2] = u[2] * r;
    }
  const side = n + 1;
  const verts = side * side;
  const total = verts + (side * 4 - 4);
  const P = new Float32Array(total * 3),
    Nrm = new Float32Array(total * 3),
    C = new Float32Array(total * 3);
  const col = new THREE.Color();
  const at = (i, j) => ((j + 1) * W + (i + 1)) * 3;
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const k = j * side + i;
      const pk = at(i, j);
      P[k * 3] = pos[pk];
      P[k * 3 + 1] = pos[pk + 1];
      P[k * 3 + 2] = pos[pk + 2];
      // Normal from the neighbours: east tangent x north tangent points up and out.
      const ex = pos[at(i + 1, j)] - pos[at(i - 1, j)],
        ey = pos[at(i + 1, j) + 1] - pos[at(i - 1, j) + 1],
        ez = pos[at(i + 1, j) + 2] - pos[at(i - 1, j) + 2];
      const nx = pos[at(i, j + 1)] - pos[at(i, j - 1)],
        ny = pos[at(i, j + 1) + 1] - pos[at(i, j - 1) + 1],
        nz = pos[at(i, j + 1) + 2] - pos[at(i, j - 1) + 2];
      let cx = ey * nz - ez * ny,
        cy = ez * nx - ex * nz,
        cz = ex * ny - ey * nx;
      let l = Math.hypot(cx, cy, cz);
      const rl = Math.hypot(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]) || 1;
      const rx = P[k * 3] / rl,
        ry = P[k * 3 + 1] / rl,
        rz = P[k * 3 + 2] / rl;
      if (l < 1e-6) (cx = rx), (cy = ry), (cz = rz), (l = 1);
      else (cx /= l), (cy /= l), (cz /= l);
      if (cx * rx + cy * ry + cz * rz < 0) (cx = -cx), (cy = -cy), (cz = -cz);
      Nrm[k * 3] = cx;
      Nrm[k * 3 + 1] = cy;
      Nrm[k * 3 + 2] = cz;
      const h = heights[(j + 1) * W + (i + 1)];
      const slope = Math.sqrt(Math.max(0, 1 - Math.min(1, cx * rx + cy * ry + cz * rz) ** 2)) / Math.max(0.2, cx * rx + cy * ry + cz * rz);
      col.setHex(map.colorLL(lons[i + 1], lats[j + 1], h, slope));
      C[k * 3] = col.r;
      C[k * 3 + 1] = col.g;
      C[k * 3 + 2] = col.b;
    }
  // Skirts: the edge vertices again, sunk towards the planet's centre.
  let s = verts;
  const skirtOf = new Int32Array(side * side).fill(-1);
  const edge = (i, j) => i === 0 || j === 0 || i === n || j === n;
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      if (!edge(i, j)) continue;
      const k = j * side + i;
      skirtOf[k] = s;
      const l = Math.hypot(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]) || 1;
      const f = (l - SKIRT) / l;
      P[s * 3] = P[k * 3] * f;
      P[s * 3 + 1] = P[k * 3 + 1] * f;
      P[s * 3 + 2] = P[k * 3 + 2] * f;
      Nrm.set([Nrm[k * 3], Nrm[k * 3 + 1], Nrm[k * 3 + 2]], s * 3);
      C.set([C[k * 3], C[k * 3 + 1], C[k * 3 + 2]], s * 3);
      s++;
    }
  // Indices: sea quads first, then land quads, then skirts (land material).
  const seaIdx = [],
    landIdx = [];
  const hAt = (i, j) => heights[(j + 1) * W + (i + 1)];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * side + i,
        b = a + 1,
        c = a + side,
        d = c + 1;
      const sea = Math.max(hAt(i, j), hAt(i + 1, j), hAt(i, j + 1), hAt(i + 1, j + 1)) <= 0.001;
      (sea ? seaIdx : landIdx).push(a, b, d, a, d, c);
    }
  const skirtIdx = [];
  const ring = [];
  for (let i = 0; i < n; i++) ring.push([i, 0, i + 1, 0]);
  for (let j = 0; j < n; j++) ring.push([n, j, n, j + 1]);
  for (let i = n; i > 0; i--) ring.push([i, n, i - 1, n]);
  for (let j = n; j > 0; j--) ring.push([0, j, 0, j - 1]);
  for (const [i0, j0, i1, j1] of ring) {
    const a = j0 * side + i0,
      b = j1 * side + i1;
    const sa = skirtOf[a],
      sb = skirtOf[b];
    skirtIdx.push(a, b, sb, a, sb, sa, a, sb, b, a, sa, sb);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(Nrm, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(C, 3));
  const all = seaIdx.concat(landIdx, skirtIdx);
  geo.setIndex(new THREE.BufferAttribute(total > 65535 ? new Uint32Array(all) : new Uint16Array(all), 1));
  geo.addGroup(0, seaIdx.length, 0);
  geo.addGroup(seaIdx.length, landIdx.length + skirtIdx.length, 1);
  geo.computeBoundingSphere();
  geo.userData.tris = all.length / 3;
  geo.userData.verts = total;
  return geo;
}

/* ---------------------------------------------------------------------------------- the planet view */
/**
 * @param {THREE.Scene} scene
 * @param {object} map from createPlanetMap
 * @param {{ quality?: string }} [opts]
 */
export function createPlanetView(scene, map, { quality = "medium" } = {}) {
  const profile = map.profile;
  const group = new THREE.Group();
  group.name = "planet";
  scene.add(group);
  const landMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  const seaMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.06 });
  const materials = [seaMat, landMat];

  /* chunks */
  const chunks = [];
  for (let b = 0; b < LAT_N; b++)
    for (let a = 0; a < LON_N; a++) {
      const lon0 = -Math.PI + (a / LON_N) * Math.PI * 2,
        lon1 = -Math.PI + ((a + 1) / LON_N) * Math.PI * 2;
      const lat0 = -Math.PI / 2 + (b / LAT_N) * Math.PI,
        lat1 = -Math.PI / 2 + ((b + 1) / LAT_N) * Math.PI;
      const centre = new THREE.Vector3(...unitVector((lon0 + lon1) / 2, (lat0 + lat1) / 2));
      // Angular radius of the patch: from its centre to a corner.
      const corner = new THREE.Vector3(...unitVector(lon0, Math.abs(lat0) > Math.abs(lat1) ? lat0 : lat1));
      chunks.push({ lon0, lon1, lat0, lat1, centre, ang: Math.acos(clamp(centre.dot(corner), -1, 1)), levels: [null, null, null, null], shown: -1, used: 0, meshes: [null, null, null, null] });
    }
  let verts = 0,
    frame = 0,
    builds = 0;
  const stats = { chunksVisible: 0, tris: 0, verts: 0, builds: 0, built: [0, 0, 0, 0] };
  const BUDGET = quality === "low" ? 90000 : quality === "high" ? 260000 : 160000;

  function build(chunk, level) {
    if (chunk.levels[level]) return;
    const geo = buildChunkGeometry(map, chunk, LEVELS[level]);
    const mesh = new THREE.Mesh(geo, materials);
    mesh.visible = false;
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    chunk.levels[level] = geo;
    chunk.meshes[level] = mesh;
    verts += geo.userData.verts;
    builds++;
  }
  function evict() {
    // Drop the oldest unused high-detail meshes when the vertex budget is exceeded.
    if (verts <= BUDGET) return;
    const cand = [];
    for (const c of chunks) for (let l = 1; l < 4; l++) if (c.levels[l] && c.shown !== l) cand.push([c, l]);
    cand.sort((a, b) => a[0].used - b[0].used);
    for (const [c, l] of cand) {
      if (verts <= BUDGET * 0.8) break;
      group.remove(c.meshes[l]);
      verts -= c.levels[l].userData.verts;
      c.levels[l].dispose();
      c.levels[l] = c.meshes[l] = null;
    }
  }
  // Every patch starts at the coarsest level, so the whole globe is there from the first frame.
  for (const c of chunks) build(c, 0);

  /* atmosphere shell */
  const atm = profile.atmosphere;
  const atmColor = new THREE.Color(atm.day);
  const atmDensity = clamp(atm.density ?? 1, 0, 2);
  const atmMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: atmColor }, uSun: { value: new THREE.Vector3(1, 0.3, 0.2) }, uPower: { value: 2.6 }, uK: { value: 0.35 + atmDensity * 0.55 } },
    vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uSun; uniform float uPower; uniform float uK; varying vec3 vN; varying vec3 vP;
      void main(){ vec3 V = normalize(cameraPosition - vP); float rim = pow(clamp(1.0 - dot(vN, V), 0.0, 1.0), uPower); float lit = clamp(dot(vN, normalize(uSun)) * 0.8 + 0.45, 0.0, 1.0); gl_FragColor = vec4(uColor * rim * uK * (0.35 + lit), rim * uK * lit); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(R + 26, 64, 32), atmMat);
  shell.renderOrder = 2;
  group.add(shell);

  /* stars */
  const starGeo = (() => {
    const n = quality === "low" ? 600 : 1400;
    const p = new Float32Array(n * 3);
    let s = 7;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1,
        a = rnd() * Math.PI * 2,
        r = Math.sqrt(1 - u * u);
      p[i * 3] = Math.cos(a) * r * 2600;
      p[i * 3 + 1] = u * 2600;
      p[i * 3 + 2] = Math.sin(a) * r * 2600;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  })();
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: atm.kind === "none" ? 1 : 0.7, depthWrite: false, fog: false }));
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  scene.add(stars);

  /* lights: the star, and the sky light from the planet's own atmosphere */
  const L = profile.lighting;
  const sun = new THREE.DirectionalLight(L.sun, 2.1 * L.sunIntensity);
  const hemi = new THREE.HemisphereLight(L.hemi, L.ground, 0.85);
  scene.add(sun, hemi, sun.target);
  scene.background = new THREE.Color(0x03050c);

  const camDir = new THREE.Vector3();
  return {
    group,
    stats,
    /** Where the star is, as a unit vector from the planet's centre. */
    setSun(dir) {
      sun.position.copy(dir).multiplyScalar(R * 3);
      atmMat.uniforms.uSun.value.copy(dir);
    },
    /**
     * Choose each patch's level of detail and visibility for this camera, and build what is wanted
     * (a little each frame). Call every frame.
     */
    update(camera, { budgetMs = 7 } = {}) {
      frame++;
      const cp = camera.position;
      stars.position.copy(cp);
      const camLen = cp.length();
      camDir.copy(cp).divideScalar(camLen || 1);
      const horizon = Math.acos(clamp(R / camLen, 0, 1));
      const want = [];
      let tris = 0,
        vis = 0;
      for (const c of chunks) {
        const angle = Math.acos(clamp(camDir.dot(c.centre), -1, 1));
        const visible = angle < horizon + c.ang + 0.07;
        if (!visible) {
          if (c.shown >= 0) c.meshes[c.shown].visible = false;
          c.shown = -1;
          continue;
        }
        _v.copy(c.centre).multiplyScalar(R);
        const d = _v.distanceTo(cp);
        // The nearest edge of the patch is what matters, not its centre.
        const edgeD = Math.max(0, d - c.ang * R);
        let level = 0;
        for (let l = 3; l >= 1; l--)
          if (edgeD < LEVEL_AT[l] * (c.shown >= l ? 1.12 : 1)) {
            level = l;
            break;
          }
        c.used = frame;
        want.push([c, level, edgeD]);
      }
      // Build the nearest missing levels first, within a time slice.
      const t0 = performance.now();
      want.sort((a, b) => a[2] - b[2]);
      for (const [c, level] of want) {
        if (c.levels[level]) continue;
        if (performance.now() - t0 > budgetMs && level > 0) break;
        build(c, level);
        if (level > 1) break; // at most one big patch a frame
      }
      for (const [c, level] of want) {
        // Show the wanted level if it exists, otherwise the nearest one built.
        let use = -1;
        for (let k = 0; k < 4 && use < 0; k++) {
          if (level + k < 4 && c.levels[level + k]) use = level + k;
          else if (level - k >= 0 && c.levels[level - k]) use = level - k;
        }
        if (c.shown !== use) {
          if (c.shown >= 0) c.meshes[c.shown].visible = false;
          c.shown = use;
        }
        const m = c.meshes[use];
        m.visible = true;
        m.updateMatrix();
        tris += c.levels[use].userData.tris;
        vis++;
      }
      evict();
      stats.chunksVisible = vis;
      stats.tris = tris;
      stats.verts = verts;
      stats.builds = builds;
      stats.built = [0, 1, 2, 3].map((l) => chunks.filter((c) => c.levels[l]).length);
    },
    dispose() {
      for (const c of chunks) c.levels.forEach((g) => g?.dispose());
      group.removeFromParent();
      landMat.dispose();
      seaMat.dispose();
      atmMat.dispose();
      shell.geometry.dispose();
      starGeo.dispose();
      stars.material.dispose();
      scene.remove(stars, sun, hemi, sun.target);
    },
  };
}

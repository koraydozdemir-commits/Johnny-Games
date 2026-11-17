/**
 * The cell body builder. Given a saved cell record (see ../cell-format.js) it produces a complete
 * 3D organism: a smooth membrane skinned around the spine, a merged interior, attached parts and a
 * soft shadow, plus a `rig` that animates all of it. The player, every NPC species, the mate and
 * (later) the creature stage's starting body use this one function.
 */
import * as THREE from "three";
import { matrixOf, mergePieces } from "./geom-utils.js";
import { createMembraneMaterial, getInteriorMaterial, getMembraneTexture, getShadowMaterial, wobbleAt } from "./materials.js";
import { createPartModel } from "./part-models.js";
import { partDef } from "../part-defs.js";

export const QUALITY_PRESETS = {
  low: { rings: 30, around: 10, texture: 256, interior: false, partQuality: "low", pixelRatio: 1 },
  medium: { rings: 44, around: 14, texture: 512, interior: true, partQuality: "medium", pixelRatio: 1.5 },
  high: { rings: 64, around: 20, texture: 1024, interior: true, partQuality: "high", pixelRatio: 2 },
};
let currentQuality = "high";
export const getQuality = () => currentQuality;
export function setQuality(name) {
  if (QUALITY_PRESETS[name]) currentQuality = name;
  return currentQuality;
}

let shadowGeometry = null;
function getShadowGeometry() {
  if (!shadowGeometry) {
    shadowGeometry = new THREE.PlaneGeometry(1, 1);
    shadowGeometry.userData.shared = true;
  }
  return shadowGeometry;
}

const MEMBRANE_OPACITY = 0.86;
const DEPTH_RATIO = 0.6;

/* ---- spine and hull --------------------------------------------------------------------- */

/** Points, tangents and radii along the spine (centripetal Catmull-Rom through the nodes). */
export function spineSamples(nodes, amount = 48) {
  const curve = new THREE.CatmullRomCurve3(
    nodes.map((n) => new THREE.Vector3(n.x, n.y, 0)),
    false,
    "centripetal",
  );
  const out = [];
  for (let i = 0; i <= amount; i++) {
    const t = i / amount;
    out.push({ p: curve.getPoint(t), tan: curve.getTangent(t).normalize(), r: smoothRadius(nodes, t), u: t });
  }
  return out;
}

/** Radius along the spine: a C1 Catmull-Rom through the node radii, so the silhouette has no kinks. */
function smoothRadius(nodes, t) {
  const n = nodes.length,
    idx = t * (n - 1),
    i = Math.min(n - 2, Math.floor(idx)),
    f = idx - i;
  const p0 = nodes[Math.max(0, i - 1)].r,
    p1 = nodes[i].r,
    p2 = nodes[i + 1].r,
    p3 = nodes[Math.min(n - 1, i + 2)].r;
  const r = 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
  return Math.max(0.05, r);
}

/**
 * Build the membrane: a half-ellipse cross-section swept along the spine with rounded end caps.
 * Returns the geometry (planar UVs in body space), the 2D outline polygon and its bounding box.
 */
export function buildHull(nodes, { rings, around, capRings = 6, capLength = 0.95 }) {
  const samples = spineSamples(nodes, rings);
  const list = [];
  const phi = (i) => (i / capRings) * (Math.PI / 2) * 0.985;
  const first = samples[0],
    last = samples[samples.length - 1];
  for (let i = capRings; i >= 1; i--) list.push({ c: first.p.clone().addScaledVector(first.tan, -first.r * capLength * Math.sin(phi(i))), tan: first.tan, a: first.r * Math.cos(phi(i)) });
  for (const s of samples) list.push({ c: s.p, tan: s.tan, a: s.r });
  for (let i = 1; i <= capRings; i++) list.push({ c: last.p.clone().addScaledVector(last.tan, last.r * capLength * Math.sin(phi(i))), tan: last.tan, a: last.r * Math.cos(phi(i)) });

  const R = list.length,
    C = around + 1;
  const position = new Float32Array(R * C * 3),
    normal = new Float32Array(R * C * 3),
    uv = new Float32Array(R * C * 2);
  const ringN = list.map((ring) => new THREE.Vector3(-ring.tan.y, ring.tan.x, 0).normalize());
  const depth = (a) => a * DEPTH_RATIO + 0.012;
  for (let i = 0; i < R; i++) {
    const ring = list[i],
      N = ringN[i],
      a = ring.a,
      b = depth(a);
    for (let j = 0; j < C; j++) {
      const th = (j / around) * Math.PI,
        cs = Math.cos(th),
        sn = Math.sin(th),
        k = (i * C + j) * 3;
      position[k] = ring.c.x + N.x * a * cs;
      position[k + 1] = ring.c.y + N.y * a * cs;
      position[k + 2] = b * sn;
    }
  }
  const P = (i, j) => new THREE.Vector3(position[(i * C + j) * 3], position[(i * C + j) * 3 + 1], position[(i * C + j) * 3 + 2]);
  const dS = new THREE.Vector3(),
    dT = new THREE.Vector3(),
    out = new THREE.Vector3(),
    nrm = new THREE.Vector3();
  for (let i = 0; i < R; i++) {
    const ring = list[i],
      N = ringN[i],
      a = ring.a,
      b = depth(a);
    for (let j = 0; j < C; j++) {
      const th = (j / around) * Math.PI,
        cs = Math.cos(th),
        sn = Math.sin(th);
      dS.copy(P(Math.min(R - 1, i + 1), j)).sub(P(Math.max(0, i - 1), j));
      dT.set(-N.x * a * sn, -N.y * a * sn, b * cs);
      out.set(N.x * cs * b, N.y * cs * b, sn * a);
      nrm.crossVectors(dS, dT);
      if (nrm.lengthSq() < 1e-10) nrm.copy(out.lengthSq() > 1e-8 ? out : new THREE.Vector3(i < R / 2 ? -ring.tan.x : ring.tan.x, i < R / 2 ? -ring.tan.y : ring.tan.y, 0.2));
      if (nrm.dot(out) < 0 && out.lengthSq() > 1e-8) nrm.negate();
      nrm.normalize();
      const k = (i * C + j) * 3;
      normal[k] = nrm.x;
      normal[k + 1] = nrm.y;
      normal[k + 2] = nrm.z;
    }
  }
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (let v = 0; v < R * C; v++) {
    const x = position[v * 3],
      y = position[v * 3 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const extent = { minX, minY, width: Math.max(0.01, maxX - minX), height: Math.max(0.01, maxY - minY) };
  for (let v = 0; v < R * C; v++) {
    uv[v * 2] = (position[v * 3] - extent.minX) / extent.width;
    uv[v * 2 + 1] = (position[v * 3 + 1] - extent.minY) / extent.height;
  }
  const index = [];
  for (let i = 0; i < R - 1; i++)
    for (let j = 0; j < around; j++) {
      const a = i * C + j,
        b = a + 1,
        c = a + C,
        d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  // Make sure the triangles face outwards (check one mid-body triangle against its analytic normal).
  {
    const mid = (R >> 1) * C + (around >> 1);
    const va = P(mid / C | 0, mid % C),
      vb = P((mid + 1) / C | 0, (mid + 1) % C),
      vc = P((mid + C) / C | 0, (mid + C) % C);
    const face = new THREE.Vector3().crossVectors(vb.clone().sub(va), vc.clone().sub(va));
    const analytic = new THREE.Vector3(normal[mid * 3], normal[mid * 3 + 1], normal[mid * 3 + 2]);
    if (face.dot(analytic) < 0) for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();

  const left = [],
    right = [];
  list.forEach((ring, i) => {
    left.push(new THREE.Vector2(ring.c.x + ringN[i].x * ring.a, ring.c.y + ringN[i].y * ring.a));
    right.push(new THREE.Vector2(ring.c.x - ringN[i].x * ring.a, ring.c.y - ringN[i].y * ring.a));
  });
  const outline = [...left, ...right.reverse()];
  return { geometry, outline, extent, rings: list };
}

/* ---- outline helpers used by the editor ------------------------------------------------- */

export function pointInPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Nearest outline point to (x, y) plus the outward normal angle there. */
export function surfacePoint(poly, x, y) {
  let best = 0,
    bestD = Infinity;
  poly.forEach((p, i) => {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  const prev = poly[(best - 3 + poly.length) % poly.length],
    next = poly[(best + 3) % poly.length],
    here = poly[best];
  let nx = next.y - prev.y,
    ny = -(next.x - prev.x);
  // Point the normal away from the polygon's centroid.
  let cx = 0,
    cy = 0;
  poly.forEach((p) => {
    cx += p.x / poly.length;
    cy += p.y / poly.length;
  });
  if (nx * (here.x - cx) + ny * (here.y - cy) < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: here.x, y: here.y, angle: Math.atan2(ny, nx) };
}

/**
 * Re-seat a record's parts on the membrane. Used for the starter cell, legacy saves and mutated mates,
 * where the body changed after the parts were placed. `faceOutward` also aims every part along the
 * surface normal (legacy saves used a different part orientation).
 */
export function snapPartsToSurface(record, { faceOutward = false } = {}) {
  const hull = buildHull(record.body.nodes, { rings: 40, around: 8 });
  const parts = record.parts.map((p) => {
    const hit = surfacePoint(hull.outline, p.x, p.y);
    return { ...p, x: hit.x, y: hit.y, rotation: faceOutward ? hit.angle : p.rotation };
  });
  return { ...record, parts };
}

/* ---- interior --------------------------------------------------------------------------- */

const sphereGeo = new THREE.SphereGeometry(1, 12, 9);
const ball = (color, x, y, z, sx, sy = sx, sz = sx, rz = 0) => ({ geometry: sphereGeo, color, matrix: matrixOf({ x, y, z, sx, sy, sz, rz }) });

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildInterior(hull, nodes, colors, seed) {
  const rand = seeded(seed * 7919 + 13);
  const widest = nodes.reduce((best, n, i) => (n.r > nodes[best].r ? i : best), 0);
  const w = nodes[widest];
  const nucleusColor = new THREE.Color(colors.base).lerp(new THREE.Color(0x4a2a88), 0.7).getHex();
  const pieces = [
    ball(nucleusColor, w.x - 0.06, w.y, 0.16 * w.r + 0.06, w.r * 0.36, w.r * 0.3, w.r * 0.2),
    ball(0xe8b4ff, w.x - 0.02, w.y + w.r * 0.04, 0.16 * w.r + 0.15, w.r * 0.11, w.r * 0.11, w.r * 0.08),
  ];
  const palette = [colors.accent, colors.pattern, 0x86f2e7, 0xf5a0cc];
  const samples = spineSamples(nodes, 40);
  for (let i = 0; i < 7; i++) {
    const s = samples[Math.round((0.1 + rand() * 0.8) * 40)];
    const off = (rand() - 0.5) * s.r * 1.1,
      r = 0.035 + rand() * 0.045;
    const nx = -s.tan.y,
      ny = s.tan.x;
    const x = s.p.x + nx * off,
      y = s.p.y + ny * off;
    if (Math.hypot(x - w.x, y - w.y) < w.r * 0.42) continue;
    pieces.push(ball(palette[i % palette.length], x, y, 0.12 * s.r + 0.05, r * 1.5, r, r * 0.8, rand() * 3));
  }
  void hull;
  return mergePieces(pieces);
}

/* ---- the builder ------------------------------------------------------------------------ */

const lighten = (c, t) => new THREE.Color(c).lerp(new THREE.Color(0xffffff), t).getHex();
/** Push a colour towards a richer, more saturated version of itself so cells never look washed out. */
export function vivid(color, saturation = 1.18, lightness = 0.9) {
  const c = new THREE.Color(color),
    hsl = {};
  c.getHSL(hsl);
  return c.setHSL(hsl.h, Math.min(1, hsl.s * saturation), Math.min(0.62, hsl.l * lightness)).getHex();
}

/**
 * @param {import('../cell-format.js').CellRecord} record saved cell record (or any object with the same shape)
 * @param {{ role?: 'player'|'npc'|'mate'|'editor', quality?: string, seed?: number, rimColor?: number, eyeColor?: number, shadow?: boolean }} opts
 */
export function buildCellBody(record, opts = {}) {
  const role = opts.role || "npc";
  const preset = QUALITY_PRESETS[opts.quality || currentQuality];
  const big = role !== "npc";
  const nodes = record.body.nodes;
  const colors = record.colors;
  const hull = buildHull(nodes, { rings: big ? preset.rings : Math.round(preset.rings * 0.62), around: big ? preset.around : Math.max(8, preset.around - 4) });

  const tailX = Math.min(...nodes.map((n) => n.x)),
    headX = Math.max(...nodes.map((n) => n.x)) + nodes[nodes.length - 1].r * 0.9;
  const length = Math.max(0.6, headX - tailX);
  const body = { headX, length, amp: 0, freq: (Math.PI * 2) / (length * 0.95), speed: 5.2, phase: (opts.seed || 1) * 1.7 };

  const texture = getMembraneTexture({
    base: vivid(colors.base),
    pattern: colors.pattern,
    accent: colors.accent,
    kind: record.body.pattern,
    strokes: record.body.paintStrokes || [],
    extent: hull.extent,
    size: big ? preset.texture : Math.max(256, preset.texture / 2),
    seed: opts.seed || 1,
  });
  const membraneMaterial = createMembraneMaterial({ color: 0xffffff, map: texture, rimColor: opts.rimColor ?? lighten(vivid(colors.base), 0.3), opacity: MEMBRANE_OPACITY, body });
  const membrane = new THREE.Mesh(hull.geometry, membraneMaterial);
  membrane.frustumCulled = false;
  membrane.renderOrder = 2;

  const root = new THREE.Group();
  root.userData.cellBody = true;

  if (opts.shadow !== false) {
    const shadow = new THREE.Mesh(getShadowGeometry(), getShadowMaterial());
    shadow.scale.set(hull.extent.width * 1.4 + 0.5, hull.extent.height * 1.55 + 0.5, 1);
    shadow.position.set(hull.extent.minX + hull.extent.width / 2 + 0.12, hull.extent.minY + hull.extent.height / 2 - 0.16, -0.3);
    shadow.renderOrder = 0;
    root.add(shadow);
  }

  let interior = null;
  // Other cells only get an interior on high quality: on phones it is the first thing to go.
  if (big || (preset.interior && currentQuality === "high")) {
    interior = new THREE.Mesh(buildInterior(hull, nodes, colors, opts.seed || 1), getInteriorMaterial());
    interior.frustumCulled = false;
    interior.renderOrder = 1;
    root.add(interior);
  }
  root.add(membrane);

  /* Parts */
  const partsGroup = new THREE.Group();
  root.add(partsGroup);
  const partObjects = [];
  (record.parts || []).forEach((p, index) => {
    const def = partDef(p.id);
    if (!def) return;
    const model = createPartModel(p.id, { bodyColor: colors.base, eyeColor: opts.eyeColor, quality: preset.partQuality });
    const g = model.group;
    g.position.set(p.x, p.y, 0);
    g.rotation.z = p.rotation || 0;
    g.scale.setScalar(p.scale || 1);
    g.userData.partIndex = index;
    partsGroup.add(g);
    partObjects.push({ def, model, group: g, x: p.x, y: p.y, rotation: p.rotation || 0, scale: p.scale || 1, phase: Math.random() * 6, openT: 0, index });
  });

  const rig = createRig({ root, membrane, membraneMaterial, interior, body, partObjects, hull });
  return { root, membrane, outline: hull.outline, extent: hull.extent, rig, partObjects, hull, body };
}

/* ---- rig -------------------------------------------------------------------------------- */

function createRig({ root, membraneMaterial, interior, body, partObjects, hull }) {
  const u = membraneMaterial.userData.uniforms;
  const s = { eat: 0, hit: 0, dead: -1, amp: 0, blink: 0, nextBlink: 2 + Math.random() * 3, frozen: false, lod: 1, swim: 0 };
  const flashRed = new THREE.Color(1, 0.35, 0.3),
    flashWhite = new THREE.Color(1, 1, 1);

  return {
    body,
    partObjects,
    outline: hull.outline,
    /** Editor mode freezes the wobble so handles line up with the surface. */
    setFrozen(value) {
      s.frozen = value;
    },
    /** 0 = far away (cheap), 1 = full detail. */
    setDetail(level) {
      if (level === s.lod) return;
      s.lod = level;
      if (interior) interior.visible = level > 0;
    },
    eat() {
      s.eat = 1;
    },
    hit(strength = 1) {
      s.hit = Math.max(s.hit, strength);
    },
    die() {
      if (s.dead < 0) s.dead = 0;
    },
    get dying() {
      return s.dead >= 0;
    },
    /** 0..1 progress of the death animation (1 = finished and invisible). */
    get deathProgress() {
      return s.dead < 0 ? 0 : Math.min(1, s.dead / 0.55);
    },
    update(dt, time, { speed = 0 } = {}) {
      const swim = Math.min(1, speed / 2.2);
      s.swim += (swim - s.swim) * (1 - Math.exp(-dt * 4));
      const targetAmp = s.frozen ? 0 : s.lod === 0 ? 0.018 : 0.02 + s.swim * 0.055;
      s.amp += (targetAmp - s.amp) * (1 - Math.exp(-dt * 5));
      body.amp = s.amp;
      body.speed = 5 + s.swim * 4;
      u.uAmp.value = s.amp;
      u.uSpeed.value = body.speed;

      s.eat = Math.max(0, s.eat - dt * 2.4);
      s.hit = Math.max(0, s.hit - dt * 3);
      const eatPulse = Math.sin((1 - s.eat) * Math.PI) * (s.eat > 0 ? 1 : 0);
      u.uPulse.value = eatPulse * 0.32;
      if (s.dead >= 0) {
        s.dead += dt;
        const p = Math.min(1, s.dead / 0.55);
        root.scale.setScalar(Math.max(0.001, 1 - p * p) * (1 + Math.sin(p * 12) * 0.05));
        u.uFlash.value = Math.min(1, 0.35 + p * 0.6);
        u.uFlashColor.value.copy(flashWhite);
        u.uFade.value = 1 - p;
        root.rotation.z = p * 1.2;
      } else if (s.hit > 0) {
        u.uFlash.value = s.hit * 0.55;
        u.uFlashColor.value.copy(flashRed);
      } else u.uFlash.value = 0;

      if (s.lod === 0 && !s.frozen) return;
      s.nextBlink -= dt;
      if (s.nextBlink <= 0) {
        s.blink = 0.14;
        s.nextBlink = 2.5 + Math.random() * 4;
      }
      s.blink = Math.max(0, s.blink - dt);
      for (const po of partObjects) {
        const g = po.group;
        const wob = s.frozen ? 0 : wobbleAt(po.x, body, time);
        const slope = s.frozen ? 0 : (wobbleAt(po.x + 0.05, body, time) - wob) / 0.05;
        g.position.y = po.y + wob;
        g.rotation.z = po.rotation + slope * 0.6;
        const isMouth = po.def.cat === "Mouths";
        const mouthEat = isMouth ? eatPulse : 0;
        if (po.model.jaws) {
          const open = Math.max(0, Math.sin(time * 2.6 + po.phase)) * 0.1 + mouthEat * 0.55 + s.hit * 0.1;
          po.model.jaws[0].rotation.z = open;
          if (po.model.jaws[1]) po.model.jaws[1].rotation.z = -open;
        }
        if (po.model.pulse) g.scale.setScalar(po.scale * (1 + Math.sin(time * 4.5 + po.phase) * 0.06));
        else if (isMouth) g.scale.setScalar(po.scale * (1 + mouthEat * 0.28));
        if (po.model.eye) {
          const ball = po.model.meshes[1];
          if (ball) ball.scale.y = s.blink > 0 ? 0.12 : 1;
        }
      }
    },
    dispose() {
      hull.geometry.dispose();
      membraneMaterial.dispose();
      if (interior) interior.geometry.dispose();
    },
  };
}

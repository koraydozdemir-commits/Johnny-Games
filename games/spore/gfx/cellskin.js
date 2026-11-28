/**
 * The cell's look in play: a see-through jelly skin with an inked cartoon edge and glossy highlights, a
 * soft bioluminescent glow around it, and real 3D organelles inside (nucleus, vacuoles, mitochondria, a
 * Golgi stack, ribosomes) that drift and ripple with the swimming wobble.
 *
 * Geometries and materials are cached and shared between cells, so a crowd costs draw calls, not memory.
 */
import * as THREE from "three";
import { pointInPolygon } from "./body.js";
import { getInteriorMaterial, wobbleAt } from "./materials.js";
import { radialGlowTexture } from "./soft-textures.js";

const shared = (o) => ((o.userData.shared = true), o);
const cache = new Map();
const memo = (key, make) => {
  if (!cache.has(key)) cache.set(key, shared(make()));
  return cache.get(key);
};
const hex = (c) => new THREE.Color(c).getHexString();
const solid = (color, emissiveIntensity = 0.22) =>
  memo("s" + hex(color) + emissiveIntensity, () => new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0, emissive: color, emissiveIntensity }));
const clear = (color, opacity) =>
  memo(
    "t" + hex(color) + opacity,
    () => new THREE.MeshStandardMaterial({ color, roughness: 0.12, metalness: 0, transparent: true, opacity, depthWrite: false, emissive: color, emissiveIntensity: 0.18 }),
  );
const geo = {
  sphere: () => memo("g-sphere", () => new THREE.SphereGeometry(1, 16, 12)),
  lump: () =>
    memo("g-lump", () => {
      const g = new THREE.IcosahedronGeometry(1, 2),
        p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 1 + 0.07 * Math.sin(p.getX(i) * 14 + p.getY(i) * 9) * Math.cos(p.getZ(i) * 11);
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k * 0.8);
      }
      g.computeVertexNormals();
      return g;
    }),
  capsule: () => memo("g-capsule", () => new THREE.CapsuleGeometry(1, 2.6, 5, 10)),
  ring: () => memo("g-ring", () => new THREE.TorusGeometry(0.98, 0.1, 5, 14)),
  disc: (k) => memo("g-disc" + k, () => new THREE.TorusGeometry(0.1 - k * 0.012, 0.022, 7, 18, Math.PI)),
  dot: () => memo("g-dot", () => new THREE.SphereGeometry(0.02, 6, 5)),
};
let auraTex = null;
const auraTexture = () =>
  (auraTex ||= shared(
    radialGlowTexture(128, [
      [0, "rgba(255,255,255,1)"],
      [0.25, "rgba(255,255,255,0.55)"],
      [1, "rgba(255,255,255,0)"],
    ]),
  ));

/** Make the membrane see-through with an inked rim. Returns the uniforms the rig can flip. */
function reskinMembrane(body, color) {
  const mat = body.membrane.material,
    original = mat.onBeforeCompile;
  const U = { uToon: { value: 1 }, uCore: { value: 0.55 }, uInk: { value: new THREE.Color(color).multiplyScalar(0.28) } };
  mat.transparent = true;
  mat.depthWrite = false;
  mat.opacity = 1;
  mat.roughness = 0.2;
  mat.onBeforeCompile = (shader) => {
    original(shader);
    Object.assign(shader.uniforms, U);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uToon; uniform float uCore; uniform vec3 uInk;")
      .replace(
        "outgoingLight = mix(outgoingLight, uFlashColor, uFlash);",
        `outgoingLight = mix(outgoingLight, uFlashColor, uFlash);
        float fr = pow(1.0 - clamp(abs(normal.z), 0.0, 1.0), 1.5);
        vec2 n2 = normal.xy;
        float hl1 = smoothstep(0.30, 0.20, length(n2 - vec2(-0.38, 0.46)));
        float hl2 = smoothstep(0.10, 0.06, length(n2 - vec2(-0.62, 0.18)));
        float bounce = smoothstep(0.55, 0.0, length(n2 - vec2(0.3, -0.7))) * 0.25;
        outgoingLight += uToon * (vec3(1.0) * (hl1 * 0.4 + hl2 * 0.8) + uRimColor * bounce);
        float ink = smoothstep(0.76, 0.9, fr);
        float band = smoothstep(0.55, 0.7, fr) * (1.0 - ink);
        outgoingLight = mix(outgoingLight, outgoingLight * 1.18 + uRimColor * 0.25, band * 0.6 * uToon);
        outgoingLight = mix(outgoingLight, uInk, ink * 0.9 * uToon);`,
      )
      .replace("gl_FragColor.a *= uFade;", "gl_FragColor.a *= uFade * mix(0.93, mix(uCore, 1.0, smoothstep(0.1, 0.8, fr)), uToon);");
  };
  mat.customProgramCacheKey = () => "spore-membrane-toon";
  mat.needsUpdate = true;
  return U;
}

function nearestEdge(poly, x, y) {
  let d = 1e9;
  for (let i = 0; i < poly.length; i += 2) d = Math.min(d, Math.hypot(poly[i].x - x, poly[i].y - y));
  return d;
}

/**
 * @param body result of buildCellBody
 * @param {{ color?: number, seed?: number, lite?: boolean }} opts `lite` keeps only a nucleus, a vacuole and a mitochondrion (other cells)
 */
export function skinCell(body, { color = 0x7ff0e8, seed = 1, lite = false } = {}) {
  const U = reskinMembrane(body, color);
  const inter = body.root.children.find((c) => c.isMesh && c.material === getInteriorMaterial());
  if (inter) inter.visible = false;
  const e = body.extent,
    poly = body.outline,
    group = new THREE.Group(),
    things = [];
  let s = seed * 7919 + 17;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const base = new THREE.Color(color),
    hsl = {};
  base.getHSL(hsl);
  const tone = (dh, l) => new THREE.Color().setHSL((hsl.h + dh + 1) % 1, Math.min(1, hsl.s * 0.9 + 0.1), l).getHex();
  const place = (minClear) => {
    for (let t = 0; t < 60; t++) {
      const x = e.minX + rnd() * e.width,
        y = e.minY + rnd() * e.height;
      if (!pointInPolygon(poly, x, y)) continue;
      const d = nearestEdge(poly, x, y);
      if (d >= minClear) return { x, y, d };
    }
    return null;
  };
  const sizeBase = Math.min(e.height * 0.5, 0.5);
  const put = (obj, spot, extra = {}) => {
    obj.position.set(spot.x, spot.y, Math.min(0.32, spot.d * 0.35));
    obj.renderOrder = 1;
    group.add(obj);
    things.push({ obj, x: spot.x, y: spot.y, z: obj.position.z, a: rnd() * 6, f: 0.25 + rnd() * 0.5, r: Math.min(0.05 + rnd() * 0.06, spot.d * 0.2), ...extra });
  };
  const part = (geometry, material, scale = 1) => {
    const m = new THREE.Mesh(geometry, material);
    m.scale.setScalar(scale);
    m.renderOrder = 1;
    return m;
  };

  // Glow around the cell, seen through the skin as well.
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: auraTexture(), color, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
  aura.scale.set(e.width * 1.9 + 0.8, e.height * 2.3 + 0.8, 1);
  aura.position.set(e.minX + e.width / 2, e.minY + e.height / 2, -0.4);
  group.add(aura);

  // Nucleus: lumpy ball in a clear envelope, with a bright nucleolus.
  const nSpot = place(sizeBase * 0.5) || place(0.05);
  if (nSpot) {
    const R = Math.min(sizeBase * 0.62, nSpot.d * 0.8),
      n = new THREE.Group();
    n.add(part(geo.lump(), solid(tone(0.72, 0.42), 0.28), R));
    const nuc = part(geo.sphere(), solid(0xffd6f4, 0.55), R * 0.36);
    nuc.position.set(R * 0.2, R * 0.12, R * 0.5);
    n.add(nuc);
    const env = part(geo.sphere(), clear(0xf0e0ff, 0.2), R * 1.22);
    env.scale.z *= 0.8;
    n.add(env);
    put(n, nSpot, { nuc: true, r: 0.03 });
  }
  // Vacuoles: clear bubbles with a shine.
  const shineMat = memo("shine", () => new THREE.MeshBasicMaterial({ color: 0xffffff }));
  for (let i = 0; i < (lite ? 1 : 2); i++) {
    const sp = place(0.2);
    if (!sp) continue;
    const R = Math.min(0.1 + rnd() * 0.1, sp.d * 0.55),
      v = new THREE.Group();
    v.add(part(geo.sphere(), clear(tone(0.05, 0.75), 0.5), R));
    const sh = part(geo.sphere(), shineMat, R * 0.22);
    sh.position.set(-R * 0.4, R * 0.45, R * 0.7);
    v.add(sh);
    put(v, sp);
  }
  // Mitochondria: stubby capsules with banded cristae.
  for (let i = 0; i < (lite ? 1 : 2); i++) {
    const sp = place(0.16);
    if (!sp) continue;
    const R = Math.min(0.065 + rnd() * 0.02, sp.d * 0.4),
      m = new THREE.Group();
    m.add(part(geo.capsule(), solid(0xff9a5c, 0.3), R));
    for (let k = -1; k <= 1; k++) {
      const t = part(geo.ring(), solid(0xc2502d, 0.1), R);
      t.rotation.x = Math.PI / 2;
      t.position.y = k * R * 2.6 * 0.34 * 1.0;
      m.add(t);
    }
    m.rotation.z = rnd() * 3.14;
    put(m, sp, { rot: m.rotation.z });
  }
  let dots = null,
    dotSpots = [];
  const m4 = new THREE.Matrix4();
  if (!lite) {
    // Golgi: a stack of curved discs.
    const gs = place(0.22);
    if (gs) {
      const G = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const d = part(geo.disc(k), solid(tone(0.12, 0.62), 0.3));
        d.position.set(0, (k - 1.5) * 0.05, 0);
        G.add(d);
      }
      G.rotation.z = rnd() * 6;
      put(G, gs, { rot: G.rotation.z });
    }
    // Ribosomes: little bright dots, one draw call.
    dots = new THREE.InstancedMesh(geo.dot(), memo("dotm" + hex(tone(0.02, 0.85)), () => new THREE.MeshBasicMaterial({ color: tone(0.02, 0.85) })), 18);
    for (let i = 0; i < 18; i++) {
      const sp = place(0.07);
      dotSpots.push(sp && { x: sp.x, y: sp.y, z: Math.min(0.28, sp.d * 0.3), a: rnd() * 6, f: 0.3 + rnd() });
    }
    dots.renderOrder = 1;
    dots.frustumCulled = false;
    group.add(dots);
  }
  body.root.add(group);

  let time = 0;
  const update = (t) => {
    time = t;
    if (!group.visible) return;
    aura.material.opacity = 0.45 + 0.08 * Math.sin(t * 1.3 + seed);
    const bd = body.body;
    for (const o of things) {
      o.obj.position.x = o.x + Math.cos(t * o.f + o.a) * o.r;
      o.obj.position.y = o.y + Math.sin(t * o.f * 1.3 + o.a) * o.r + wobbleAt(o.x, bd, t);
      o.obj.position.z = o.z + Math.sin(t * o.f * 0.8 + o.a) * 0.02;
      if (o.rot !== undefined) o.obj.rotation.z = o.rot + Math.sin(t * o.f + o.a) * 0.4;
      if (o.nuc) {
        const k = 1 + 0.03 * Math.sin(t * 1.4);
        o.obj.scale.set(k, 1 / k, 1);
      }
    }
    if (dots) {
      dotSpots.forEach((d, i) => {
        if (!d) m4.makeScale(0, 0, 0);
        else m4.makeTranslation(d.x + Math.cos(t * d.f + d.a) * 0.05, d.y + Math.sin(t * d.f * 1.2 + d.a) * 0.05 + wobbleAt(d.x, bd, t), d.z);
        dots.setMatrixAt(i, m4);
      });
      dots.instanceMatrix.needsUpdate = true;
    }
  };

  // Hook into the rig: animate with it, hide the insides when the cell is far away, and tidy up.
  const rig = body.rig,
    rigUpdate = rig.update,
    rigDetail = rig.setDetail,
    rigDispose = rig.dispose;
  rig.update = (dt, t, o) => {
    rigUpdate(dt, t, o);
    update(t);
  };
  rig.setDetail = (level) => {
    rigDetail(level);
    group.visible = level > 0;
  };
  rig.dispose = () => {
    rigDispose();
    dots?.dispose();
    aura.material.dispose();
  };
  update(time);
  return { group, uniforms: U };
}

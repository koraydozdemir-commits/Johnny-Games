/**
 * Scenery for the infinite soup: inedible debris (pebbles, shell shards, twigs, broken cell walls)
 * and edible plant colonies (a branching frond whose tips carry algae buds the player can bite off).
 * Every model is one merged, vertex-coloured mesh from a small pool of shared variants, so a screen
 * full of scenery costs one draw call per object and no per-object geometry.
 */
import * as THREE from "three";
import { matrixOf, mergePieces, taperedTube } from "./geom-utils.js";

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function lumpy(radius, detail, rand, squash = 0.6) {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position;
  const k = [rand() * 6, rand() * 6, rand() * 6];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const bump = 1 + 0.22 * Math.sin(x * 5 + k[0]) * Math.cos(y * 4 + k[1]) + 0.12 * Math.sin(z * 6 + k[2]);
    pos.setXYZ(i, x * bump, y * bump, z * bump * squash);
  }
  geo.computeVertexNormals();
  return geo;
}

/*
 * Tide-pool debris. Pretty, quiet things that belong in shallow water: glassy diatoms (round and
 * pennate), smooth speckled pebbles, pearly shell shards, clusters of bubbles and loose kelp ribbons.
 * Colours are softer than food and cells so they never read as something to eat or fear.
 */
const DEBRIS_KINDS = [
  ["diatom", 0.2],
  ["pennate", 0.17],
  ["pebbles", 0.2],
  ["shell", 0.15],
  ["bubbles", 0.14],
  ["kelp", 0.14],
];
const VARIANTS_PER_KIND = 3;
const GLASSY = new Set(["diatom", "pennate", "bubbles"]);

const col = (hex) => new THREE.Color(hex);

function buildDebris(kind, seed) {
  const rand = seeded(seed * 7919 + 13);
  const pieces = [];
  if (kind === "diatom") {
    // A round "petri dish" diatom: a ribbed glass disc with a raised rim and a central boss.
    const r = 0.3 + rand() * 0.12,
      ribs = 16 + Math.floor(rand() * 10);
    const glass = col([0xd8c48a, 0xc9dca0, 0xb9d6d8][Math.floor(rand() * 3)]),
      light = glass.clone().lerp(col(0xffffff), 0.55);
    const disc = new THREE.CylinderGeometry(r, r * 0.96, 0.05, ribs * 4, 1).rotateX(Math.PI / 2);
    pieces.push({
      geometry: disc,
      colorAt: (x, y) => {
        const a = Math.atan2(y, x),
          d = Math.hypot(x, y) / r;
        const rib = Math.abs(Math.sin(a * ribs * 0.5)) > 0.6 ? 1 : 0;
        return glass.clone().lerp(light, rib * 0.6 * d + (d > 0.9 ? 0.4 : 0));
      },
    });
    pieces.push({ geometry: new THREE.TorusGeometry(r * 0.98, 0.022, 6, 48), color: light.getHex(), matrix: matrixOf({ z: 0.03 }) });
    pieces.push({ geometry: new THREE.TorusGeometry(r * 0.45, 0.012, 5, 32), color: light.getHex(), matrix: matrixOf({ z: 0.03 }) });
    pieces.push({ geometry: new THREE.SphereGeometry(r * 0.16, 12, 8), color: light.getHex(), matrix: matrixOf({ z: 0.03, sz: 0.5 }) });
  } else if (kind === "pennate") {
    // A boat-shaped diatom with fine cross striations and a centre line.
    const len = 0.7 + rand() * 0.4;
    const glass = col([0xc8d98c, 0xd9c98a, 0xa9d8c0][Math.floor(rand() * 3)]),
      dark = glass.clone().multiplyScalar(0.72);
    const hull = new THREE.SphereGeometry(1, 28, 10);
    pieces.push({
      geometry: hull,
      matrix: matrixOf({ sx: len / 2, sy: 0.11, sz: 0.05 }),
      colorAt: (x) => (Math.abs(Math.sin(x * 34)) > 0.75 ? dark : glass),
    });
    pieces.push({ geometry: new THREE.BoxGeometry(len * 0.8, 0.012, 0.012), color: dark.getHex(), matrix: matrixOf({ z: 0.05 }) });
    pieces.push({ geometry: new THREE.SphereGeometry(0.035, 8, 6), color: 0xffffff, matrix: matrixOf({ z: 0.05 }) });
  } else if (kind === "pebbles") {
    const n = 1 + Math.floor(rand() * 3);
    const tones = [0x8fa3ad, 0xb7a58a, 0x9aa89a, 0xa9a2b8];
    for (let i = 0; i < n; i++) {
      const r = 0.1 + rand() * 0.14,
        tone = col(tones[Math.floor(rand() * tones.length)]);
      const geo = lumpy(r, 2, rand, 0.55);
      pieces.push({
        geometry: geo,
        matrix: matrixOf({ x: (rand() - 0.5) * 0.45, y: (rand() - 0.5) * 0.3, rz: rand() * 6 }),
        // Speckles and a lighter, sun-washed top.
        colorAt: (x, y, z) => {
          const speck = Math.sin(x * 91.7 + y * 47.3) * Math.cos(y * 63.1 - z * 29.9) > 0.86 ? -0.25 : 0;
          return tone.clone().multiplyScalar(0.82 + Math.max(0, z / r) * 0.3 + speck);
        },
      });
    }
  } else if (kind === "shell") {
    // A pearly shell fragment with concentric growth lines.
    const r = 0.32 + rand() * 0.16,
      span = 1.3 + rand() * 1.1;
    const base = col([0xf0d2c8, 0xf3e1c2, 0xe6d0e8][Math.floor(rand() * 3)]),
      line = base.clone().multiplyScalar(0.78),
      pearl = base.clone().lerp(col(0xbfe8f0), 0.35);
    const geo = new THREE.SphereGeometry(r, 24, 12, 0, span, 0.15, 1.15);
    pieces.push({
      geometry: geo,
      matrix: matrixOf({ rx: Math.PI / 2, sz: 0.45 }),
      colorAt: (x, y, z) => {
        const d = Math.hypot(x, z);
        return Math.abs(Math.sin(d * 46)) > 0.82 ? line : base.clone().lerp(pearl, Math.max(0, y / r));
      },
    });
  } else if (kind === "bubbles") {
    const n = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const r = 0.05 + rand() * 0.11;
      pieces.push({ geometry: new THREE.SphereGeometry(r, 14, 10), color: 0xd8f6ff, matrix: matrixOf({ x: (rand() - 0.5) * 0.4, y: (rand() - 0.5) * 0.4, z: 0.1 }) });
      // A bright highlight sells the glass.
      pieces.push({ geometry: new THREE.SphereGeometry(r * 0.28, 8, 6), color: 0xffffff, matrix: matrixOf({ x: 0, y: 0, z: 0.1 + r * 0.8 }).premultiply(matrixOf({ x: (rand() - 0.5) * 0.4, y: (rand() - 0.5) * 0.4 })) });
    }
  } else {
    // A loose kelp ribbon that sways.
    const len = 1.0 + rand() * 0.7;
    const pts = [];
    for (let i = 0; i < 6; i++) pts.push(new THREE.Vector3((i / 5 - 0.5) * len, Math.sin(i * 1.3 + rand()) * 0.12, 0));
    const tube = taperedTube(pts, (t) => 0.07 * (1 - t * 0.5), { radial: 6, segments: 18, swayAmp: 1 });
    pieces.push({ geometry: tube, matrix: matrixOf({ sz: 0.25 }), color: 0x5f8f45, colorTip: 0xa8cf6a, swayMax: 1 });
  }
  const g = mergePieces(pieces);
  g.userData.shared = true;
  return g;
}

/* Materials: soft fresnel rim light, gentle sway for ribbons; glass is translucent and brighter at the edge. */
function debrisMaterialFor(glassy, timeUniform) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: glassy ? 0.18 : 0.6,
    metalness: 0,
    transparent: true,
    opacity: glassy ? 0.62 : 0.92,
    depthWrite: !glassy,
  });
  m.userData.shared = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aSway;\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nfloat ph = modelMatrix[3].x * 0.9 + modelMatrix[3].y * 0.6;\ntransformed.y += sin(uTime * 1.4 + ph + transformed.x * 3.0) * aSway * 0.09;",
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\nvec3 vdir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);\nfloat fres = pow(1.0 - abs(dot(normalize(normal), vdir)), 2.2);\ntotalEmissiveRadiance += vec3(0.55, 0.85, 1.0) * fres * " +
        (glassy ? "0.75" : "0.28") +
        ";",
    );
  };
  m.customProgramCacheKey = () => "spore-debris-" + (glassy ? "glass" : "solid");
  return m;
}
const debrisMaterials = {};
function getDebrisMaterial(glassy, timeUniform) {
  const key = glassy ? "glass" : "solid";
  if (!debrisMaterials[key]) debrisMaterials[key] = debrisMaterialFor(glassy, timeUniform);
  return debrisMaterials[key];
}

const debrisCache = new Map();
/** One piece of drifting, inedible debris. */
export function createDebris(rng = Math.random, timeUniform = { value: 0 }) {
  let roll = rng(),
    kind = DEBRIS_KINDS[0][0];
  for (const [k, w] of DEBRIS_KINDS) {
    if ((roll -= w) <= 0) {
      kind = k;
      break;
    }
  }
  const variant = Math.floor(rng() * VARIANTS_PER_KIND);
  const key = kind + variant;
  if (!debrisCache.has(key)) debrisCache.set(key, buildDebris(kind, variant + 1 + DEBRIS_KINDS.findIndex(([k]) => k === kind) * 10));
  const mesh = new THREE.Mesh(debrisCache.get(key), getDebrisMaterial(GLASSY.has(kind), timeUniform));
  mesh.rotation.z = rng() * Math.PI * 2;
  const s = 0.85 + rng() * 0.6;
  mesh.scale.set(s, s, s);
  mesh.position.z = -0.25;
  mesh.renderOrder = GLASSY.has(kind) ? 3 : 0;
  mesh.userData = { kind, spin: (rng() - 0.5) * (kind === "bubbles" ? 0.05 : 0.25), phase: rng() * 6, radius: 0.45 * s, rise: kind === "bubbles" ? 0.12 + rng() * 0.1 : 0 };
  return mesh;
}

/* ---- Plant colonies -------------------------------------------------- */

const COLONY_VARIANTS = 4;
const colonyCache = new Map();

/** Returns { geometry, tips: [{x, y}] } for a branching frond rooted at the origin. */
function buildColony(seed) {
  const rand = seeded(seed * 104729 + 7);
  const pieces = [],
    tips = [];
  const trunkColor = 0x2f8a63,
    tipColor = 0x6fe08e;
  const branches = 4 + Math.floor(rand() * 3);
  for (let b = 0; b < branches; b++) {
    const heading = (b / branches) * Math.PI * 2 + (rand() - 0.5) * 0.6;
    const len = 0.9 + rand() * 0.8;
    const bend = (rand() - 0.5) * 1.2;
    const pts = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4,
        a = heading + bend * t;
      pts.push(new THREE.Vector3(Math.cos(a) * len * t, Math.sin(a) * len * t, -0.05 + t * 0.04));
    }
    pieces.push({
      geometry: taperedTube(pts, (t) => 0.085 * (1 - t * 0.6), { radial: 6, segments: 12, swayAmp: 1 }),
      color: trunkColor,
      colorTip: tipColor,
      swayMax: 1,
    });
    const end = pts[pts.length - 1];
    tips.push({ x: end.x, y: end.y });
    // A side shoot with its own bud on longer branches.
    if (len > 1.2) {
      const mid = pts[2],
        a = heading + bend * 0.5 + (rand() < 0.5 ? 0.9 : -0.9);
      const shoot = [
        mid.clone(),
        mid.clone().add(new THREE.Vector3(Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0.01)),
        mid.clone().add(new THREE.Vector3(Math.cos(a) * 0.45, Math.sin(a) * 0.45, 0.02)),
      ];
      pieces.push({
        geometry: taperedTube(shoot, (t) => 0.05 * (1 - t * 0.6), { radial: 5, segments: 6, swayAmp: 1 }),
        color: trunkColor,
        colorTip: tipColor,
        swayMax: 1,
      });
      tips.push({ x: shoot[2].x, y: shoot[2].y });
    }
    // Flat leaves along the branch.
    for (let k = 1; k <= 2; k++) {
      const p = pts[k + 1],
        a = heading + bend * ((k + 1) / 4) + (k % 2 ? 0.8 : -0.8);
      pieces.push({
        geometry: new THREE.SphereGeometry(1, 8, 6),
        color: k % 2 ? 0x3fae73 : 0x4cbf7e,
        matrix: matrixOf({ x: p.x + Math.cos(a) * 0.12, y: p.y + Math.sin(a) * 0.12, z: -0.02, sx: 0.16, sy: 0.07, sz: 0.03, rz: a }),
      });
    }
  }
  // Holdfast at the root.
  pieces.push({
    geometry: new THREE.SphereGeometry(1, 12, 8),
    color: 0x25704f,
    matrix: matrixOf({ z: -0.06, sx: 0.26, sy: 0.24, sz: 0.1 }),
  });
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2;
    pieces.push({
      geometry: new THREE.SphereGeometry(1, 8, 6),
      color: 0x1f6145,
      matrix: matrixOf({ x: Math.cos(a) * 0.2, y: Math.sin(a) * 0.2, z: -0.08, sx: 0.1, sy: 0.08, sz: 0.05 }),
    });
  }
  const geometry = mergePieces(pieces);
  geometry.userData.shared = true;
  return { geometry, tips };
}

let colonyMaterial = null;
function getColonyMaterial(timeUniform) {
  if (colonyMaterial) return colonyMaterial;
  colonyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
  colonyMaterial.userData.shared = true;
  colonyMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aSway;\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        // Fronds wave gently; the phase comes from the object's world position so neighbours differ.
        "#include <begin_vertex>\nfloat ph = modelMatrix[3].x * 0.7 + modelMatrix[3].y * 0.5;\ntransformed.x += sin(uTime * 1.3 + ph + transformed.y * 2.0) * aSway * 0.07;\ntransformed.y += cos(uTime * 1.1 + ph + transformed.x * 2.0) * aSway * 0.07;",
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * 0.18;",
    );
  };
  colonyMaterial.customProgramCacheKey = () => "spore-colony";
  return colonyMaterial;
}

/**
 * An edible plant colony. The returned mesh is the frond; `tips` are local bud positions the game
 * fills with ordinary plant food so eating, AI foraging and regrowth reuse the food system.
 */
export function createPlantColony(rng, timeUniform) {
  const variant = Math.floor(rng() * COLONY_VARIANTS);
  if (!colonyCache.has(variant)) colonyCache.set(variant, buildColony(variant + 1));
  const { geometry, tips } = colonyCache.get(variant);
  const mesh = new THREE.Mesh(geometry, getColonyMaterial(timeUniform));
  const s = 1 + rng() * 0.45;
  const rot = rng() * Math.PI * 2;
  mesh.scale.setScalar(s);
  mesh.rotation.z = rot;
  mesh.position.z = -0.12;
  const c = Math.cos(rot),
    sn = Math.sin(rot);
  return { mesh, tips: tips.map((t) => ({ x: (t.x * c - t.y * sn) * s, y: (t.x * sn + t.y * c) * s })) };
}

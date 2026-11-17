/**
 * Original 3D food: an algae bud for plants and a marbled meat nugget / chunk for meat.
 * One shared material and a handful of shared geometries serve every piece of food in the world.
 */
import * as THREE from "three";
import { matrixOf, mergePieces } from "./geom-utils.js";

const sphere = new THREE.SphereGeometry(1, 10, 8);
const pieceSphere = (color, x, y, z, sx, sy = sx, sz = sx, rz = 0, rx = 0) => ({ geometry: sphere, color, matrix: matrixOf({ x, y, z, sx, sy, sz, rz, rx }) });

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function algaeBud(scale) {
  const pieces = [pieceSphere(0x7df59a, 0, 0, 0.02, 0.085 * scale, 0.085 * scale, 0.07 * scale)];
  const petals = 5;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const shade = i % 2 ? 0x45d27c : 0x59e68b;
    pieces.push(pieceSphere(shade, Math.cos(a) * 0.115 * scale, Math.sin(a) * 0.115 * scale, 0.0, 0.085 * scale, 0.045 * scale, 0.03 * scale, a));
    pieces.push(pieceSphere(0xc8ffd2, Math.cos(a) * 0.15 * scale, Math.sin(a) * 0.15 * scale, 0.025, 0.02 * scale));
  }
  pieces.push(pieceSphere(0xfff6a8, 0, 0, 0.08 * scale, 0.032 * scale));
  return mergePieces(pieces);
}

function meatNugget(scale, withBone, seed) {
  const rand = seeded(seed);
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.attributes.position,
    colors = new Float32Array(pos.count * 3);
  const meat = new THREE.Color(0xe0584f),
    deep = new THREE.Color(0xa93036),
    fat = new THREE.Color(0xffd9c8),
    c = new THREE.Color();
  const lump = [rand() * 6, rand() * 6, rand() * 6];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const bump = 1 + 0.18 * Math.sin(x * 3.1 + lump[0]) * Math.cos(y * 2.7 + lump[1]) + 0.1 * Math.sin(z * 4 + lump[2]);
    pos.setXYZ(i, x * bump, y * bump, z * bump * 0.8);
    const marble = Math.sin(x * 7 + lump[0]) * Math.sin(y * 6 + lump[1]) + Math.sin(z * 5);
    c.copy(marble > 0.9 ? fat : meat).lerp(deep, Math.max(0, -y) * 0.35);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.scale(scale * 1.15, scale * 0.85, scale * 0.8);
  const pieces = [{ geometry: toIndexed(geo), color: 0xffffff, vertexColors: true, matrix: new THREE.Matrix4() }];
  if (withBone) {
    pieces.push(pieceSphere(0xfff3dc, scale * 1.15, scale * 0.35, 0.02, scale * 0.28, scale * 0.28, scale * 0.24));
    pieces.push(pieceSphere(0xfff3dc, scale * 1.35, scale * 0.15, 0.02, scale * 0.24, scale * 0.24, scale * 0.2));
  }
  return mergePiecesKeepingColor(pieces);
}

function toIndexed(geo) {
  if (geo.index) return geo;
  const g = geo.clone();
  const n = g.attributes.position.count;
  g.setIndex([...Array(n).keys()]);
  return g;
}

/** mergePieces overrides colour from `piece.color`; this variant keeps a geometry's own `color` attribute. */
function mergePiecesKeepingColor(pieces) {
  const own = pieces.filter((p) => p.vertexColors);
  const merged = mergePieces(pieces.map((p) => (p.vertexColors ? { ...p, color: 0xffffff } : p)));
  // Re-apply the nugget's own vertex colours to its slice of the merged colour buffer.
  let offset = 0;
  const colorAttr = merged.attributes.color;
  for (const p of pieces) {
    const count = p.geometry.attributes.position.count;
    if (p.vertexColors && p.geometry.attributes.color) for (let i = 0; i < count; i++) colorAttr.setXYZ(offset + i, p.geometry.attributes.color.getX(i), p.geometry.attributes.color.getY(i), p.geometry.attributes.color.getZ(i));
    offset += count;
  }
  void own;
  colorAttr.needsUpdate = true;
  return merged;
}

const geometries = {};
function geometryFor(type, kind) {
  const key = type + ":" + kind;
  if (!geometries[key]) {
    const g =
      type === "plant"
        ? algaeBud(kind === "chunk" ? 2.1 : 1.15)
        : kind === "chunk"
          ? meatNugget(0.17, true, 11)
          : meatNugget(0.095, false, 5);
    g.userData.shared = true;
    geometries[key] = g;
  }
  return geometries[key];
}

let material = null;
function foodMaterial() {
  if (material) return material;
  material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0 });
  material.userData.shared = true;
  material.onBeforeCompile = (shader) => {
    // Food glows softly in its own colour so it reads against the dark water.
    shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * 0.38;");
  };
  material.customProgramCacheKey = () => "spore-food";
  return material;
}

/**
 * A food item is a plain Group the game moves, rotates and hides; it holds no mesh of its own.
 * `createFoodBatch` draws every visible item of each kind with one InstancedMesh, so a soup full
 * of food costs four draw calls instead of one per piece.
 */
export function createFoodModel(type, kind) {
  const group = new THREE.Group();
  group.userData.renderKey = type + ":" + kind;
  return group;
}

const KEYS = ["plant:particle", "plant:chunk", "meat:particle", "meat:chunk"];

export function createFoodBatch(parent) {
  const batches = new Map();
  const ensure = (key, needed) => {
    let b = batches.get(key);
    if (b && b.capacity >= needed) return b;
    const capacity = Math.max(64, Math.ceil(needed * 1.5));
    if (b) {
      parent.remove(b.mesh);
      b.mesh.dispose();
    }
    const [type, kind] = key.split(":");
    const mesh = new THREE.InstancedMesh(geometryFor(type, kind), foodMaterial(), capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.userData.shared = true;
    parent.add(mesh);
    b = { mesh, capacity };
    batches.set(key, b);
    return b;
  };
  const matrix = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    axis = new THREE.Vector3(0, 0, 1),
    scale = new THREE.Vector3(1, 1, 1);
  return {
    /** Write the transforms of every visible, living food item. Call once per frame. */
    sync(foodList) {
      const counts = {};
      KEYS.forEach((k) => (counts[k] = 0));
      for (const f of foodList) if (f.visible && f.userData.alive) counts[f.userData.renderKey]++;
      KEYS.forEach((k) => ensure(k, counts[k]).mesh && (batches.get(k).mesh.count = 0));
      for (const f of foodList) {
        if (!f.visible || !f.userData.alive) continue;
        const mesh = batches.get(f.userData.renderKey).mesh;
        q.setFromAxisAngle(axis, f.rotation.z);
        scale.setScalar(f.scale.x);
        matrix.compose(f.position, q, scale);
        mesh.setMatrixAt(mesh.count++, matrix);
      }
      batches.forEach((b) => (b.mesh.instanceMatrix.needsUpdate = true));
    },
    setVisible(on) {
      batches.forEach((b) => (b.mesh.visible = on));
    },
  };
}

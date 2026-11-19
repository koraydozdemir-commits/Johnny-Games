/**
 * Turns catalogue records into renderable models.
 *
 * - Models are built on demand, never all at once, and cached with a triangle budget: when it is
 *   exceeded the least-recently-used models that nothing is drawing are disposed (and simply rebuilt
 *   if asked for again, since every shape is deterministic from the asset id and variant).
 * - Each asset has three levels of detail: 0 full, 1 reduced segment counts, 2 a tiny proxy solid.
 * - Every model is normalised so its longest dimension equals the asset's catalogued mid size and it
 *   stands on y = 0, so the metadata is truthful and instances scale as (wanted size / mid size).
 * - Fauna are not geometry here: they are creature records made by the existing species generator.
 */
import * as THREE from "three";
import { mergePieces } from "../gfx/geom-utils.js";
import { generateSpecies } from "../creature/species.js";
import { validateCreature } from "../creature/format.js";
import { creaturePart } from "../creature/parts.js";
import { ctxOf } from "./gen-util.js";
import { PLANT_GENERATORS, TREE_GENERATORS } from "./gen-flora.js";
import { AQUATIC_GENERATORS, FUNGUS_GENERATORS, GEO_GENERATORS, PROP_GENERATORS } from "./gen-nature.js";
import { assetById } from "./catalog.js";
import { variantSeed } from "./schema.js";

const FAMILIES = { tree: TREE_GENERATORS, plant: PLANT_GENERATORS, fungus: FUNGUS_GENERATORS, aquatic: AQUATIC_GENERATORS, geo: GEO_GENERATORS, prop: PROP_GENERATORS };
export const LOD_LEVELS = 3;
/** Triangle budget for cached models (about a few MB of vertex data). */
const DEFAULT_BUDGET = 600000;

/** The generator function for an asset's `gen` ("family.name"), or null. */
export function generatorOf(asset) {
  const [family, name] = asset.gen.split(".");
  return FAMILIES[family]?.[name] || null;
}
export const isFauna = (asset) => asset.kind === "fauna";

export const triangleCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Pieces for an asset variant at a level of detail (0 or 1). */
function pieces(asset, variant, lod) {
  const gen = generatorOf(asset);
  if (!gen) throw new Error("no generator for " + asset.id + " (" + asset.gen + ")");
  const c = ctxOf(variantSeed(asset.id, variant), lod);
  return gen(asset.params, c).flat(Infinity).filter(Boolean);
}

/** Scale to the catalogued size and stand on the ground. */
function normalise(geo, asset) {
  geo.computeBoundingBox();
  const size = geo.boundingBox.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z, 1e-4);
  const k = ((asset.size.min + asset.size.max) / 2) / longest;
  geo.scale(k, k, k);
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y, 0);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.userData.mid = (asset.size.min + asset.size.max) / 2;
  return geo;
}

/** A few-triangle stand-in for far-away instances: a pyramid for tall shapes, a low blob otherwise. */
function proxyOf(reduced) {
  const bb = reduced.boundingBox;
  const size = bb.getSize(new THREE.Vector3()),
    centre = bb.getCenter(new THREE.Vector3());
  const col = reduced.attributes.color;
  const avg = new THREE.Color(0, 0, 0);
  // Weight towards the upper half, where foliage and caps are, rather than trunks and stalks.
  let n = 0;
  const pos = reduced.attributes.position;
  for (let i = 0; i < pos.count; i += 3) {
    if (pos.getY(i) < bb.min.y + size.y * 0.35) continue;
    avg.r += col.getX(i);
    avg.g += col.getY(i);
    avg.b += col.getZ(i);
    n++;
  }
  if (n) avg.multiplyScalar(1 / n);
  else avg.setRGB(0.5, 0.5, 0.5);
  const tall = size.y > 1.6 * Math.max(size.x, size.z);
  const g = tall ? new THREE.ConeGeometry(0.5, 1, 5, 1).translate(0, 0.5, 0) : new THREE.IcosahedronGeometry(0.5, 0);
  if (!tall) g.translate(0, 0.5, 0).scale(1, 0.8, 1);
  g.scale(Math.max(size.x, 0.05), size.y, Math.max(size.z, 0.05));
  g.translate(centre.x, 0, centre.z);
  const g2 = g.index ? g.toNonIndexed() : g;
  const colors = new Float32Array(g2.attributes.position.count * 3);
  for (let i = 0; i < g2.attributes.position.count; i++) colors.set([avg.r, avg.g, avg.b], i * 3);
  g2.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g2.computeBoundingBox();
  g2.translate(0, -g2.boundingBox.min.y, 0); // an icosahedron has no vertex at its pole: stand it on the ground
  g2.computeVertexNormals();
  g2.computeBoundingBox();
  g2.computeBoundingSphere();
  return g2;
}

/** Build one model (uncached). lod 0, 1 or 2. */
export function buildModel(asset, variant = 0, lod = 0) {
  if (isFauna(asset)) throw new Error(asset.id + " is a creature: use faunaRecord()");
  if (lod >= 2) {
    const reduced = normalise(mergePieces(pieces(asset, variant, 1)), asset);
    const p = proxyOf(reduced);
    reduced.dispose();
    p.userData.mid = (asset.size.min + asset.size.max) / 2;
    p.userData.shared = true;
    return p;
  }
  const g = normalise(mergePieces(pieces(asset, variant, lod)), asset);
  g.userData.shared = true;
  return g;
}

/** A shared material for every library model: vertex colours, double sided for blades and fronds. */
let sharedMaterial = null;
export function libraryMaterial() {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    sharedMaterial.userData.shared = true;
  }
  return sharedMaterial;
}

/**
 * The model cache. `get(id, variant, lod)` builds on first use. Models in use by an instancer are
 * pinned with retain/release so they are never evicted from under it.
 */
export function createLibrary({ budget = DEFAULT_BUDGET } = {}) {
  const cache = new Map();
  let tick = 0,
    tris = 0;
  const key = (id, v, l) => id + ":" + v + ":" + l;
  const evict = () => {
    if (tris <= budget) return;
    const order = [...cache.entries()].filter(([, e]) => e.refs === 0).sort((a, b) => a[1].used - b[1].used);
    for (const [k, e] of order) {
      if (tris <= budget * 0.8) break;
      e.geometry.dispose();
      tris -= e.tris;
      cache.delete(k);
    }
  };
  return {
    /** Geometry for an asset variant at a level of detail, built and cached on demand. */
    get(id, variant = 0, lod = 0) {
      const asset = assetById(id);
      if (!asset) throw new Error("unknown asset " + id);
      const k = key(id, variant, lod);
      let e = cache.get(k);
      if (!e) {
        const geometry = buildModel(asset, variant % asset.variants, lod);
        e = { geometry, tris: triangleCount(geometry), used: 0, refs: 0 };
        cache.set(k, e);
        tris += e.tris;
        evict();
      }
      e.used = ++tick;
      return e.geometry;
    },
    retain(id, variant, lod) {
      const e = cache.get(key(id, variant, lod));
      if (e) e.refs++;
    },
    release(id, variant, lod) {
      const e = cache.get(key(id, variant, lod));
      if (e && e.refs > 0) e.refs--;
    },
    has: (id, variant = 0, lod = 0) => cache.has(key(id, variant, lod)),
    stats: () => ({ models: cache.size, triangles: tris, budget }),
    clear() {
      for (const e of cache.values()) e.geometry.dispose();
      cache.clear();
      tris = 0;
    },
  };
}

/* ---- fauna: built from the existing creature generator ---------------------------- */

/**
 * The creature record for a fauna asset. Deterministic: the same asset gives the same animal in every
 * universe. Uses generateSpecies, then applies the asset's name, scale and extra parts.
 */
export function faunaSpecies(asset) {
  const p = asset.params;
  const sp = generateSpecies(p.seed, p.diet, p.level || 2);
  const record = JSON.parse(JSON.stringify(sp.record));
  record.name = asset.name;
  if (p.foot) record.foot = p.foot;
  for (const [id, t, angle] of p.add || []) {
    if (record.parts.some((x) => x.id === id)) continue;
    // A creature has one mouth (and one tail): an added one replaces what it had.
    const slot = creaturePart(id)?.slot;
    if (slot === "mouth" || slot === "tail") record.parts = record.parts.filter((x) => creaturePart(x.id)?.slot !== slot);
    record.parts.push({ id, t, angle, scale: 1 });
  }
  return { ...sp, id: "lib_" + asset.id, name: asset.name, record: validateCreature(record), libraryId: asset.id, habitat: p.habitat, archetype: p.archetype, sizeScale: p.scale };
}
export const faunaRecord = (asset) => faunaSpecies(asset).record;

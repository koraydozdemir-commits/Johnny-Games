/**
 * Draws many library assets cheaply. Placements are grouped by (asset, variant, level of detail) into
 * InstancedMeshes, so a forest of hundreds of trees is a handful of draw calls. Distance picks the
 * level of detail, far instances are culled, and the grouping is only redone when the camera has
 * moved enough or the placements change, which keeps it light enough for tablets.
 *
 * A placement is { id, x, y, z, yaw, size, variant, tint }: `size` is the wanted longest dimension in
 * metres (default: the asset's catalogued mid size), `tint` an optional multiplier colour (e.g. a
 * planet's vegetation palette) applied over the model's own colours.
 */
import * as THREE from "three";
import { assetById } from "./catalog.js";
import { libraryMaterial, paletteKey, takesPalette } from "./library.js";

const dummy = new THREE.Object3D();
const tintTmp = new THREE.Color();
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();
const sphere = new THREE.Sphere();

/**
 * @param {THREE.Object3D} parent where the instanced meshes are added
 * @param {ReturnType<import("./library.js").createLibrary>} library
 * @param {{ lodNear?: number, lodFar?: number, cullDistance?: number, moveThreshold?: number, material?: THREE.Material }} [opts]
 */
export function createEcoInstancer(parent, library, opts = {}) {
  const { lodNear = 45, lodFar = 120, cullDistance = 280, moveThreshold = 3, spherical = false } = opts;
  const material = opts.material || libraryMaterial();
  const group = new THREE.Group();
  group.name = "ecoInstances";
  parent.add(group);
  /** @type {Array<object>} */
  let placements = [];
  const batches = new Map();
  const lastCam = new THREE.Vector3(Infinity, 0, 0);
  let dirty = true;
  const stats = { placements: 0, drawn: 0, culled: 0, drawCalls: 0, byLod: [0, 0, 0] };

  const batchFor = (id, variant, lod, need, pk, palette) => {
    const k = id + ":" + variant + ":" + lod + ":" + pk;
    let b = batches.get(k);
    if (!b || b.capacity < need) {
      if (b) {
        group.remove(b.mesh);
        b.mesh.dispose();
      }
      const capacity = Math.max(8, need * 2);
      const mesh = new THREE.InstancedMesh(library.get(id, variant, lod, palette), material, capacity);
      if (!b) library.retain(id, variant, lod, pk);
      mesh.frustumCulled = false; // we cull per instance
      mesh.userData.assetId = id;
      group.add(mesh);
      b = { mesh, capacity, id, variant, lod, pk };
      batches.set(k, b);
    }
    return b;
  };

  /** Bucket placements by (asset, variant, palette, level of detail) and write the instance matrices. */
  function regroup(cx, cy, cz, view) {
    dirty = false;
    const buckets = new Map();
    stats.culled = 0;
    stats.byLod = [0, 0, 0];
    for (const p of placements) {
      // On a planet the placements are in world space (x, y, z): distance is in 3D, and `q` stands them on the ground.
      const dist = spherical ? Math.hypot(p.x - cx, p.y - cy, p.z - cz) : Math.hypot(p.x - cx, p.z - cz);
      if (dist > cullDistance) {
        stats.culled++;
        continue;
      }
      if (view) {
        sphere.center.set(p.x, p.y + p.radius * 0.5, p.z);
        sphere.radius = p.radius;
        if (!view.intersectsSphere(sphere)) {
          stats.culled++;
          continue;
        }
      }
      const lod = dist < lodNear ? 0 : dist < lodFar ? 1 : 2;
      // Far away every variant looks the same, so they share one proxy (fewer draw calls).
      const k = p.id + ":" + (lod === 2 ? 0 : p.variant) + ":" + lod + ":" + p.pk;
      let list = buckets.get(k);
      if (!list) buckets.set(k, (list = []));
      list.lod = lod;
      list.push(p);
      stats.byLod[lod]++;
    }
    let drawn = 0;
    for (const b of batches.values()) b.mesh.count = 0;
    for (const [, list] of buckets) {
      const f = list[0];
      const lod = list.lod;
      const b = batchFor(f.id, lod === 2 ? 0 : f.variant, lod, list.length, f.pk, f.palette);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        dummy.position.set(p.x, p.y, p.z);
        if (p.q) dummy.quaternion.copy(p.q);
        else dummy.rotation.set(0, p.yaw || 0, 0);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        b.mesh.setMatrixAt(i, dummy.matrix);
        if (p.tint !== undefined) {
          tintTmp.set(p.tint);
          if (p.shade) tintTmp.multiplyScalar(p.shade);
        } else tintTmp.setRGB(p.shade || 1, p.shade || 1, p.shade || 1);
        b.mesh.setColorAt(i, tintTmp);
      }
      b.mesh.count = list.length;
      b.mesh.instanceMatrix.needsUpdate = true;
      if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
      drawn += list.length;
    }
    let calls = 0;
    for (const b of batches.values()) {
      b.mesh.visible = b.mesh.count > 0;
      if (b.mesh.visible) calls++;
    }
    stats.placements = placements.length;
    stats.drawn = drawn;
    stats.drawCalls = calls;
    return stats;
  }

  return {
    /** Replace every placement. */
    set(list) {
      placements = list
        .map((p) => {
          const asset = assetById(p.id);
          if (!asset) return null;
          const mid = (asset.size.min + asset.size.max) / 2;
          // A palette only matters to foliage; everything else shares one model whatever the planet.
          const palette = p.palette && takesPalette(asset) ? p.palette : null;
          return { ...p, variant: (p.variant || 0) % asset.variants, scale: (p.size || mid) / mid, radius: ((p.size || mid) * 0.75), palette, pk: paletteKey(palette) };
        })
        .filter(Boolean);
      dirty = true;
    },
    add(list) {
      this.set([...placements, ...list]);
    },
    get count() {
      return placements.length;
    },
    /** Regroup by distance and view if the camera has moved. Call every frame; it does work only when needed. */
    update(camera, { force = false } = {}) {
      if (!force && !dirty && lastCam.distanceTo(camera.position) < moveThreshold) return stats;
      lastCam.copy(camera.position);
      camera.updateMatrixWorld();
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      return regroup(camera.position.x, camera.position.y, camera.position.z, frustum);
    },
    /**
     * Like update() for views that are not a perspective camera (the top-down Tribal and Civilization
     * stages): level of detail and culling by distance from a point only.
     */
    updateFocus(x, z, { force = false } = {}) {
      if (!force && !dirty && Math.hypot(lastCam.x - x, lastCam.z - z) < moveThreshold) return stats;
      lastCam.set(x, 0, z);
      return regroup(x, 0, z, null);
    },
    stats: () => stats,
    dispose() {
      for (const b of batches.values()) {
        group.remove(b.mesh);
        b.mesh.dispose();
        library.release(b.id, b.variant, b.lod, b.pk);
      }
      batches.clear();
      parent.remove(group);
      placements = [];
    },
  };
}

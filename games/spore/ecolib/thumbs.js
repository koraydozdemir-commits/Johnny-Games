/**
 * Asset thumbnails: one lit, antialiased picture per asset, rendered with the game's renderer into a
 * small render target and cached as a PNG data URL. Flora and environment assets render their model;
 * fauna render the actual creature built from its record, so the picture matches what the game spawns.
 */
import * as THREE from "three";
import { buildCreatureBody } from "../creature/body3d.js";
import { faunaRecord, isFauna, libraryMaterial } from "./library.js";

const cache = new Map();
const key = (id, variant, size) => id + ":" + variant + ":" + size;
export const cachedAssetThumb = (id, variant = 0, size = 160) => cache.get(key(id, variant, size)) || null;

let rig = null;
function rigFor(size) {
  if (rig && rig.size === size) return rig;
  rig?.target.dispose();
  let target;
  try {
    target = new THREE.WebGLRenderTarget(size, size, { samples: 2 });
  } catch (err) {
    target = new THREE.WebGLRenderTarget(size, size);
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xf2f8ff, 0x706050, 2.4));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x9fd6ff, 1);
  rim.position.set(-4, 2, -3);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 500);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  rig = { size, target, scene, camera, canvas, ctx: canvas.getContext("2d"), pixels: new Uint8Array(size * size * 4) };
  return rig;
}

/** Draw `object` (already positioned with its base on y = 0) into the rig and return a PNG data URL. */
function snap(renderer, object, size, yaw = -0.7) {
  const r = rigFor(size);
  const g = new THREE.Group();
  g.add(object);
  g.rotation.y = yaw;
  r.scene.add(g);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const dims = box.getSize(new THREE.Vector3()),
    centre = box.getCenter(new THREE.Vector3());
  // Fit the box (not its bounding sphere) so tall thin shapes fill the frame.
  const half = Math.tan(THREE.MathUtils.degToRad(r.camera.fov / 2));
  const span = Math.max(dims.y, Math.hypot(dims.x, dims.z) * 0.9);
  const dist = (span * 0.62) / half + Math.hypot(dims.x, dims.z) * 0.5;
  // Low, wide things (grass, ferns, patches) are seen from higher up, so they read as shapes, not slivers.
  const flat = Math.max(0, Math.hypot(dims.x, dims.z) - dims.y * 1.2) / Math.max(0.01, Math.hypot(dims.x, dims.z));
  r.camera.position.set(centre.x, centre.y + dims.y * 0.12 + dist * 0.55 * flat, centre.z + dist);
  r.camera.lookAt(centre);
  r.camera.near = Math.max(0.01, dist - span * 2);
  r.camera.far = dist + span * 3;
  r.camera.updateProjectionMatrix();
  const prevTarget = renderer.getRenderTarget(),
    prevClear = renderer.getClearColor(new THREE.Color()),
    prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(r.target);
  renderer.clear();
  renderer.render(r.scene, r.camera);
  renderer.readRenderTargetPixels(r.target, 0, 0, size, size, r.pixels);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  r.scene.remove(g);
  const img = r.ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) img.data.set(r.pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
  r.ctx.clearRect(0, 0, size, size);
  r.ctx.putImageData(img, 0, 0);
  return r.canvas.toDataURL("image/png");
}

/**
 * A thumbnail for one asset (baked on first request, then cached).
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} asset catalogue record
 * @param {import("./library.js").createLibrary} library
 */
export function assetThumb(renderer, asset, library, { variant = 0, size = 160 } = {}) {
  const k = key(asset.id, variant, size);
  if (cache.has(k)) return cache.get(k);
  let url = null;
  try {
    if (isFauna(asset)) {
      const body = buildCreatureBody(faunaRecord(asset), { quality: "medium" });
      body.update(0, 0);
      body.root.updateMatrixWorld(true);
      url = snap(renderer, body.root, size, -0.9);
      body.dispose();
    } else {
      const mesh = new THREE.Mesh(library.get(asset.id, variant, 0), libraryMaterial());
      url = snap(renderer, mesh, size);
    }
  } catch (err) {
    url = null; // thumbnails are decoration: the card still works without one
  }
  cache.set(k, url);
  return url;
}

export function disposeThumbRig() {
  rig?.target.dispose();
  rig = null;
}

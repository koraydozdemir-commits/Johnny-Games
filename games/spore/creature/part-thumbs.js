/**
 * Part thumbnails: one lit, antialiased picture per part, rendered from the real part models.
 *
 * Used by the creature editor's catalogue and by unlock notifications, so a part looks the same
 * everywhere. Results are cached per (part, body colour, size); the geometry itself is shared and
 * cached by parts.js, so baking never allocates models of its own.
 */
import * as THREE from "three";
import { CREATURE_PARTS, partGeometry } from "./parts.js";

const cache = new Map();
const key = (id, color, size) => id + ":" + color + ":" + size;
/** Ids that have a model but are not catalogue parts (the leg and arm pair cards). */
export const EXTRA_THUMBS = ["__leg", "__arm"];

/** A cached thumbnail, or null if it has not been baked. */
export const cachedThumb = (id, color = 0x7fb0d0, size = 128) => cache.get(key(id, color, size)) || null;

/**
 * Bake thumbnails for `ids` (default: every part and the limb cards) as PNG data URLs.
 * Safe to call again: parts already baked are skipped. Throws if WebGL rendering fails, so callers
 * can fall back to a tile without a picture.
 * @returns {Map<string,string>} id → data URL for everything baked at this colour and size
 */
export function bakePartThumbs(renderer, { ids = [...CREATURE_PARTS.map((p) => p.id), ...EXTRA_THUMBS], color = 0x7fb0d0, size = 128 } = {}) {
  const todo = ids.filter((id) => !cache.has(key(id, color, size)));
  if (todo.length) {
    const r = renderer;
    let target;
    try {
      target = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
    } catch (err) {
      target = new THREE.WebGLRenderTarget(size, size);
    }
    const scene = new THREE.Scene();
    // Key from above-front, a cool fill from below, and a rim from behind so silhouettes read on dark tiles.
    scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x4a4036, 1.1));
    const keyLight = new THREE.DirectionalLight(0xfff2dc, 2.1);
    keyLight.position.set(2.5, 3.2, 4);
    scene.add(keyLight);
    const rim = new THREE.DirectionalLight(0x9fd6ff, 1.2);
    rim.position.set(-3, 1.5, -3);
    scene.add(rim);
    const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 20);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const pixels = new Uint8Array(size * size * 4);
    const img = ctx.createImageData(size, size);
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.02 });
    try {
      for (const id of todo) {
        const geometry = partGeometry(id, color);
        geometry.computeBoundingSphere();
        const bs = geometry.boundingSphere;
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.position.copy(bs.center).negate();
        const g = new THREE.Group();
        g.add(mesh);
        g.rotation.set(0.32, -0.72, 0);
        scene.add(g);
        cam.position.set(0, 0, bs.radius * 3.5 + 0.01);
        cam.lookAt(0, 0, 0);
        r.setRenderTarget(target);
        r.clear();
        r.render(scene, cam);
        r.readRenderTargetPixels(target, 0, 0, size, size, pixels);
        // WebGL reads bottom-up: flip rows into the 2D canvas.
        for (let y = 0; y < size; y++) img.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
        ctx.clearRect(0, 0, size, size);
        ctx.putImageData(img, 0, 0);
        cache.set(key(id, color, size), canvas.toDataURL("image/png"));
        scene.remove(g);
      }
    } finally {
      r.setRenderTarget(prevTarget);
      r.setClearColor(prevClear, prevAlpha);
      mat.dispose(); // the geometry is shared and cached by parts.js
      target.dispose();
    }
  }
  const out = new Map();
  for (const id of ids) out.set(id, cache.get(key(id, color, size)));
  return out;
}

/** One part's thumbnail (baking it if needed), or null if rendering is unavailable. */
export function partThumb(renderer, id, color = 0x7fb0d0, size = 128) {
  try {
    return bakePartThumbs(renderer, { ids: [id], color, size }).get(id) || null;
  } catch (err) {
    return null;
  }
}

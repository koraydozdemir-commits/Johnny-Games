/**
 * Civilization Stage — little pictures of your own designs, for the interface.
 *
 * The production queue, the vehicle row, the selection card, the building cards and the designs sheet
 * all show the real models you made (not a generic icon). Each design is rendered once, off screen, at
 * a three-quarter angle on a transparent background, and kept as an image URL until the design changes.
 *
 * Rendering is lazy and rationed: `get()` returns a cached picture straight away, or null and queues the
 * design; `pump()` (called once a frame by the stage) renders at most a couple of queued designs, so
 * opening a sheet full of designs never stalls the game.
 */
import * as THREE from "three";
import { buildDesignMesh } from "../creations/mesh.js";

const SIZE = 128;
const MAX_CACHED = 120;

export function createThumbs(renderer) {
  const cache = new Map(); // key -> data URL
  const queue = new Map(); // key -> design
  const listeners = new Set();
  let scene = null,
    cam = null,
    target = null,
    cv = null,
    ctx = null,
    img = null,
    pixels = null;
  const keyOf = (design) => {
    try {
      return JSON.stringify([design.kind, design.colors, design.parts]);
    } catch {
      return null;
    }
  };
  function setup() {
    if (scene) return;
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff6e3, 0x5a6a50, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(3, 5, 4);
    scene.add(sun);
    cam = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
    target = new THREE.WebGLRenderTarget(SIZE, SIZE);
    cv = document.createElement("canvas");
    cv.width = cv.height = SIZE;
    ctx = cv.getContext("2d");
    img = ctx.createImageData(SIZE, SIZE);
    pixels = new Uint8Array(SIZE * SIZE * 4);
  }
  function render(design) {
    setup();
    const model = buildDesignMesh(design);
    const box = new THREE.Box3().setFromObject(model.root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    model.root.position.copy(sphere.center).negate();
    const g = new THREE.Group();
    g.add(model.root);
    g.rotation.set(0.42, -0.75, 0);
    scene.add(g);
    cam.position.set(0, 0, Math.max(0.5, sphere.radius) * 3.9);
    cam.lookAt(0, 0, 0);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color()),
      prevAlpha = renderer.getClearAlpha();
    try {
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
      for (let y = 0; y < SIZE; y++) img.data.set(pixels.subarray((SIZE - 1 - y) * SIZE * 4, (SIZE - y) * SIZE * 4), y * SIZE * 4);
      ctx.putImageData(img, 0, 0);
      return cv.toDataURL();
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(prevClear, prevAlpha);
      scene.remove(g);
      model.dispose();
    }
  }
  return {
    /** The picture of a design, or null while it waits its turn (it's queued). */
    get(design) {
      if (!design?.parts?.length) return null;
      const key = keyOf(design);
      if (!key) return null;
      if (cache.has(key)) return cache.get(key);
      if (!queue.has(key)) queue.set(key, design);
      return null;
    },
    /** Render a few queued designs now; tells listeners when any finished. */
    pump(budget = 2) {
      if (!queue.size) return 0;
      let done = 0;
      for (const [key, design] of queue) {
        queue.delete(key);
        try {
          cache.set(key, render(design));
        } catch {
          cache.set(key, ""); // a design that won't draw keeps its icon
        }
        if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
        if (++done >= budget) break;
      }
      listeners.forEach((fn) => fn());
      return done;
    },
    onReady(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get pending() {
      return queue.size;
    },
    dispose() {
      target?.dispose();
      cache.clear();
      queue.clear();
      listeners.clear();
    },
  };
}

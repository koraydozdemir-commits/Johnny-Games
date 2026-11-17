/**
 * Renders each part's own 3D model to a small image for the editor catalogue, so the icons always
 * match what you see on the cell. Uses the game's renderer and a render target (no extra GL context).
 */
import * as THREE from "three";
import { createPartModel } from "./part-models.js";

const WIDTH = 192,
  HEIGHT = 144;

/** @returns {Map<string,string>} part id -> PNG data URL */
export function renderPartThumbnails(renderer, partIds, { bodyColor = 0x3be0d8 } = {}) {
  const urls = new Map();
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-0.95, 0.95, 0.71, -0.71, 0.1, 20);
  camera.position.set(0, 0, 8);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5f88, 2.4));
  const key = new THREE.DirectionalLight(0xfff0d8, 3);
  key.position.set(-3, 4, 6);
  scene.add(key);
  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, { samples: 4 });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  const previous = { target: renderer.getRenderTarget(), clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha() };
  renderer.setClearColor(0x000000, 0);

  for (const id of partIds) {
    const model = createPartModel(id, { bodyColor, quality: "high" });
    const box = new THREE.Box3().setFromObject(model.group);
    // Parts are modelled with +x outward; tilt a little so the volume reads.
    model.group.rotation.set(0, 0, 0.35);
    box.setFromObject(model.group);
    const size = box.getSize(new THREE.Vector3()),
      centre = box.getCenter(new THREE.Vector3());
    const fit = Math.min(1.7 / Math.max(size.x, 0.2), 1.3 / Math.max(size.y, 0.2));
    model.group.scale.setScalar(fit);
    model.group.position.set(-centre.x * fit, -centre.y * fit, 0);
    scene.add(model.group);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels);
    const image = ctx.createImageData(WIDTH, HEIGHT);
    for (let y = 0; y < HEIGHT; y++) image.data.set(pixels.subarray((HEIGHT - 1 - y) * WIDTH * 4, (HEIGHT - y) * WIDTH * 4), y * WIDTH * 4);
    ctx.putImageData(image, 0, 0);
    urls.set(id, canvas.toDataURL("image/png"));
    scene.remove(model.group);
  }
  renderer.setRenderTarget(previous.target);
  renderer.setClearColor(previous.clear, previous.alpha);
  target.dispose();
  return urls;
}

/**
 * A small portrait of a whole cell for the species history: built from its record, lit like the
 * part icons and rendered to an image. Returns a data URL (WebP where supported).
 * @param {(record) => { root: THREE.Object3D, extent: object, rig?: { dispose(): void } }} build
 */
export function renderCellSnapshot(renderer, record, build, { width = 240, height = 150 } = {}) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5f88, 2.2));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.6);
  key.position.set(-3, 4, 6);
  scene.add(key);
  const body = build(record);
  scene.add(body.root);
  const box = new THREE.Box3().setFromObject(body.root);
  const size = box.getSize(new THREE.Vector3()),
    centre = box.getCenter(new THREE.Vector3());
  const aspect = width / height;
  const half = Math.max(size.x / 2 / aspect, size.y / 2) * 1.12 + 0.05;
  const camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, 40);
  camera.position.set(centre.x, centre.y, 12);
  const target = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const previous = { target: renderer.getRenderTarget(), clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha() };
  renderer.setClearColor(0x0d2a40, 1);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  const pixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  renderer.setRenderTarget(previous.target);
  renderer.setClearColor(previous.clear, previous.alpha);
  target.dispose();
  scene.remove(body.root);
  body.rig?.dispose?.();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) image.data.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
  ctx.putImageData(image, 0, 0);
  const webp = canvas.toDataURL("image/webp", 0.82);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.82);
}

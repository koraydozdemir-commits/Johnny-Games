/**
 * A turntable for one creature: the real 3D body built from its saved design, turning slowly; drag
 * to spin it. Uses its own small renderer, created when an entry opens and disposed when it closes.
 */
import * as THREE from "three";
import { buildCreatureBody } from "../creature/body3d.js";

export function creatureTurntable(host, record, { reducedMotion = false } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch (e) {
    return null; // no WebGL here: the caller shows the still portrait instead
  }
  const w = host.clientWidth || 300,
    h = host.clientHeight || 220;
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.setSize(w, h);
  renderer.domElement.className = "pdTurn";
  renderer.domElement.setAttribute("aria-label", "3D view: drag to turn the creature");
  renderer.domElement.setAttribute("role", "img");
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x403020, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const body = buildCreatureBody(record, { quality: "medium" });
  body.update(0, 0);
  const pivot = new THREE.Group();
  pivot.add(body.root);
  scene.add(pivot);
  const box = new THREE.Box3().setFromObject(body.root);
  const size = box.getSize(new THREE.Vector3()),
    centre = box.getCenter(new THREE.Vector3());
  body.root.position.sub(centre);
  const span = Math.max(size.x, size.y * 1.4, size.z);
  camera.position.set(0, span * 0.35, span * 2.3);
  camera.lookAt(0, 0, 0);
  let yaw = -0.6,
    spin = reducedMotion ? 0 : 0.35,
    dragging = null,
    raf = 0,
    last = performance.now();
  const cv = renderer.domElement;
  cv.style.touchAction = "none";
  cv.addEventListener("pointerdown", (e) => {
    dragging = { x: e.clientX };
    spin = 0;
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    yaw += (e.clientX - dragging.x) * 0.012;
    dragging.x = e.clientX;
  });
  const end = () => (dragging = null);
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
  function loop(t) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    yaw += spin * dt;
    pivot.rotation.y = yaw;
    body.update(dt, 0);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);
  return {
    dispose() {
      cancelAnimationFrame(raf);
      body.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      cv.remove();
    },
  };
}

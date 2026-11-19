/**
 * A small 3D turntable for one library asset at a time. It owns one low-power WebGL renderer (the same
 * approach the Sporepedia uses for creatures) and swaps the shown model without recreating it, so
 * flicking through the library never piles up GL contexts. Drag to turn; pinch/scroll are left alone.
 * If WebGL is unavailable it returns null and the caller shows the still thumbnail instead.
 */
import * as THREE from "three";
import { buildCreatureBody } from "../creature/body3d.js";
import { faunaRecord, isFauna, libraryMaterial } from "./library.js";

export function createAssetPreview(host, library, { reducedMotion = false } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch (err) {
    return null;
  }
  const cv = renderer.domElement;
  cv.className = "eclTurn";
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", "3D view of the selected asset. Drag to turn it.");
  cv.style.touchAction = "none";
  host.appendChild(cv);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xf2f8ff, 0x706050, 2.2));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x9fd6ff, 1);
  rim.position.set(-4, 2, -3);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 1000);
  // A ground disc gives scale and a place to stand.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x35505e, roughness: 1 }));
  scene.add(ground);
  const pivot = new THREE.Group();
  scene.add(pivot);

  let current = null,
    body = null,
    yaw = -0.6,
    spin = reducedMotion ? 0 : 0.35,
    dragging = null,
    raf = 0,
    last = performance.now(),
    wasRunning = true;

  const clear = () => {
    if (body) {
      body.dispose();
      body = null;
    }
    if (current) {
      pivot.remove(current);
      current = null;
    }
  };
  const size = () => {
    const w = host.clientWidth || 320,
      h = host.clientHeight || 240;
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const frame = () => {
    pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(pivot);
    const dims = box.getSize(new THREE.Vector3()),
      centre = box.getCenter(new THREE.Vector3());
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const span = Math.max(dims.y * 1.1, Math.hypot(dims.x, dims.z) * 0.85 / camera.aspect, 0.1);
    const dist = span / 2 / half + Math.hypot(dims.x, dims.z) * 0.5;
    camera.position.set(0, centre.y + dims.y * 0.2 + dist * 0.12, dist);
    camera.lookAt(0, centre.y, 0);
    camera.near = Math.max(0.01, dist * 0.05);
    camera.far = dist * 6;
    camera.updateProjectionMatrix();
    ground.scale.setScalar(Math.max(dims.x, dims.z, 0.3) * 0.7);
    ground.position.y = -0.005 * dist;
  };

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
    if (t - last < 30) return; // about 30 frames a second is plenty for a turntable
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    yaw += spin * dt;
    pivot.rotation.y = yaw;
    body?.update(dt, 0);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);
  const onResize = () => {
    size();
    if (current) frame();
  };
  window.addEventListener("resize", onResize);
  size();

  return {
    /** Show an asset (and variant). Fauna are built from their creature record. */
    show(asset, variant = 0) {
      clear();
      if (isFauna(asset)) {
        body = buildCreatureBody(faunaRecord(asset), { quality: "medium" });
        body.update(0, 0);
        current = body.root;
        const box = new THREE.Box3().setFromObject(current);
        current.position.y -= box.min.y;
      } else {
        current = new THREE.Mesh(library.get(asset.id, variant, 0), libraryMaterial());
      }
      pivot.add(current);
      size();
      frame();
    },
    setPaused(p) {
      if (p && wasRunning) {
        cancelAnimationFrame(raf);
        renderer.render(scene, camera); // leave the last frame on screen
        wasRunning = false;
      } else if (!p && !wasRunning) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
        wasRunning = true;
      }
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      clear();
      ground.geometry.dispose();
      ground.material.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      cv.remove();
    },
  };
}

/**
 * The water behind the gameplay layer. Deliberately quiet: a soft vertical gradient, a few huge
 * out-of-focus light pools for depth and a sparse drift of marine snow. No rings, no algae, no
 * ghost cells, so food, cells and hazards read clearly on top of it.
 */
import * as THREE from "three";

function oceanTexture() {
  const w = 1024,
    h = 683;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const x = cv.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#1b5a93");
  g.addColorStop(0.45, "#154779");
  g.addColorStop(1, "#0b2a55");
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  const vignette = x.createRadialGradient(w * 0.5, h * 0.46, h * 0.18, w * 0.5, h * 0.5, h * 0.9);
  vignette.addColorStop(0, "rgba(8,24,52,0)");
  vignette.addColorStop(1, "rgba(4,14,34,0.55)");
  x.fillStyle = vignette;
  x.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function softDotTexture(size = 64, inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const x = cv.getContext("2d");
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

const COUNTS = { low: { snow: 70, pools: 0 }, medium: { snow: 130, pools: 3 }, high: { snow: 190, pools: 4 } };

export function createBackground(scene, quality = "high") {
  const root = new THREE.Group();
  scene.add(root);

  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(180, 120), new THREE.MeshBasicMaterial({ map: oceanTexture(), depthWrite: false, toneMapped: false }));
  backdrop.position.z = -24;
  backdrop.renderOrder = -100;
  root.add(backdrop);

  const glowTexture = softDotTexture(128, "rgba(255,255,255,0.7)", "rgba(110,190,255,0)");
  const poolTexture = softDotTexture(256, "rgba(120,200,255,0.5)", "rgba(80,150,255,0)");
  const snowTexture = softDotTexture(32, "rgba(220,245,255,0.9)", "rgba(220,245,255,0)");

  let snow = null,
    pools = [];
  function populate(q) {
    const counts = COUNTS[q] || COUNTS.high;
    if (snow) {
      root.remove(snow);
      snow.geometry.dispose();
      snow.material.dispose();
    }
    pools.forEach((p) => {
      root.remove(p);
      p.material.dispose();
    });
    pools = [];
    const positions = new Float32Array(counts.snow * 3);
    for (let i = 0; i < counts.snow; i++) positions.set([(Math.random() - 0.5) * 200, (Math.random() - 0.5) * 130, -8 - Math.random() * 6], i * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    snow = new THREE.Points(geometry, new THREE.PointsMaterial({ map: snowTexture, size: 7, sizeAttenuation: false, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false }));
    snow.frustumCulled = false;
    root.add(snow);
    for (let i = 0; i < counts.pools; i++) {
      const pool = new THREE.Sprite(new THREE.SpriteMaterial({ map: poolTexture, transparent: true, opacity: 0.1 + Math.random() * 0.06, depthWrite: false, toneMapped: false }));
      const s = 22 + Math.random() * 20;
      pool.scale.set(s, s * 0.7, 1);
      pool.position.set((Math.random() - 0.5) * 120, (Math.random() - 0.5) * 70, -14);
      pool.userData = { phase: Math.random() * 6, drift: 0.05 + Math.random() * 0.08 };
      pools.push(pool);
      root.add(pool);
    }
  }
  populate(quality);

  return {
    glowTexture,
    setQuality: populate,
    /** Call every frame with the camera position so the layers drift at different speeds (parallax). */
    update(time, dt, camera) {
      backdrop.position.x = camera.position.x * 0.16;
      backdrop.position.y = camera.position.y * 0.16;
      snow.position.x = camera.position.x * 0.45;
      snow.position.y = camera.position.y * 0.45 + Math.sin(time * 0.15) * 0.6;
      snow.rotation.z += dt * 0.0015;
      pools.forEach((p) => {
        p.position.x += Math.sin(time * p.userData.drift + p.userData.phase) * dt * 0.25;
        p.position.y += Math.cos(time * p.userData.drift * 0.8 + p.userData.phase) * dt * 0.18;
      });
    },
  };
}

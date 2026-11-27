// A live 3D portrait of an alien species for the comm screen. Uses the real creature builder from the game,
// so each empire's people are an actual species, and talks (nods, gestures, bobs) while a line is spoken.
import * as THREE from "three";
import { generateSpecies } from "../creature/species.js";
import { buildCreatureBody } from "../creature/body3d.js";

const DIET = { Warrior: "meat", Knight: "meat", Zealot: "meat", Ecologist: "plant", Shaman: "plant", Bard: "plant", Diplomat: "plant" };
export const speciesFor = (emp) => generateSpecies((emp.seed >>> 0) || 1, DIET[emp.archetype] || "omni", 4);

export function createPortrait(host) {
  const cv = document.createElement("canvas");
  cv.className = "cmFace";
  host.appendChild(cv);
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  r.setClearColor(0x000000, 0);
  r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x203040, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2, 3, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6fd0ff, 1.6);
  rim.position.set(-3, 1, -2);
  scene.add(rim);
  let rig = null, pivot = null, talk = 0, t = 0, raf = 0, running = false, amp = 0;
  const size = () => {
    const w = host.clientWidth || 200, h = host.clientHeight || 200, d = Math.min(devicePixelRatio || 1, 2);
    r.setPixelRatio(d);
    r.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  };
  function clear() {
    if (!pivot) return;
    scene.remove(pivot);
    rig?.dispose?.();
    rig = pivot = null;
  }
  function show(emp) {
    clear();
    size();
    if (emp.keis) { pivot = keisMask(); scene.add(pivot); cam.position.set(0, 0.1, 5.2); cam.lookAt(0, 0, 0); return; }
    const sp = emp.record ? { record: emp.record } : speciesFor(emp); // your own people are your own species
    rig = buildCreatureBody(sp.record, { quality: "medium", seed: emp.seed % 97 });
    pivot = new THREE.Group();
    pivot.add(rig.root);
    scene.add(pivot);
    // Frame the head: the creature faces +x. Turn it three-quarters towards us and aim at the head end.
    const L = rig.length, head = new THREE.Vector3(rig.extent.maxX * 0.55, rig.height * 0.62, 0);
    rig.root.rotation.y = -0.85;
    pivot.userData.look = head.clone().applyEuler(new THREE.Euler(0, -0.85, 0));
    const dist = Math.max(2.8, L * 1.15 + 1.1);
    cam.position.set(pivot.userData.look.x * 0.6 + 0.4, pivot.userData.look.y + 0.05, pivot.userData.look.z + dist);
    cam.lookAt(pivot.userData.look);
    rig.update(0.016);
  }
  function keisMask() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.3, 32, 24), new THREE.MeshStandardMaterial({ color: 0x1a1d24, metalness: 0.7, roughness: 0.35 }));
    m.scale.set(0.85, 1.1, 0.8);
    g.add(m);
    const y = new THREE.MeshStandardMaterial({ color: 0xffc21a, emissive: 0xffa800, emissiveIntensity: 0.9 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.08, 12, 28), y);
    ring.position.set(0, 0.45, 1.0);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.95, 0.12), y);
    shaft.position.set(0, -0.2, 1.02);
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.12), y);
    t1.position.set(0.17, -0.38, 1.02);
    const t2 = t1.clone();
    t2.position.set(0.14, -0.6, 1.02);
    g.add(ring, shaft, t1, t2);
    return g;
  }
  let last = 0, nextGesture = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    t += dt;
    if (!pivot) { r.render(scene, cam); return; }
    if (rig) {
      // While speaking, keep gesturing and nodding to the rhythm of the voice.
      if (talk > 0 && t > nextGesture) { rig.playAbility("talk"); nextGesture = t + 1.7; }
      rig.update(dt, 0, 0);
      const k = talk > 0 ? 1 : 0;
      amp += (k * (0.5 + 0.5 * Math.sin(t * 17) * Math.sin(t * 5.3 + 1)) - amp) * Math.min(1, dt * 18);
      rig.root.scale.set(1 + amp * 0.025, 1 - amp * 0.045, 1);
      pivot.rotation.y = Math.sin(t * 0.5) * 0.12;
      if (talk > 0) talk -= dt;
    } else {
      pivot.rotation.y = Math.sin(t * 0.6) * 0.35;
      pivot.scale.setScalar(1 + (talk > 0 ? Math.sin(t * 22) * 0.012 : 0));
      if (talk > 0) talk -= dt;
    }
    r.render(scene, cam);
  }
  function snapshot(emp) {
    r.setPixelRatio(1); r.setSize(180, 162, false); cam.aspect = 180 / 162; cam.updateProjectionMatrix();
    show(emp); if (rig) rig.update(0.016);
    r.render(scene, cam);
    const url = r.domElement.toDataURL("image/png");
    clear();
    return url;
  }
  return {
    snapshot,
    canvas: cv,
    show,
    resize: size,
    /** Talk for `sec` seconds. */
    speak(sec) { talk = sec; },
    stop() { talk = 0; },
    start() { if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } },
    pause() { running = false; cancelAnimationFrame(raf); },
  };
}

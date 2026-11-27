// Domed cities sitting on the planet's land, and the little creatures the beam lifts.
import * as THREE from "three";

const glass = new THREE.MeshStandardMaterial({ color: 0xbdf3ff, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.2, emissive: 0x0d4a5c, depthWrite: false });
const wall = new THREE.MeshStandardMaterial({ color: 0xf0e6d2, roughness: 0.6, metalness: 0.2 });
const roof = new THREE.MeshStandardMaterial({ color: 0x12b5c9, roughness: 0.4, metalness: 0.4 });
const pad = new THREE.MeshStandardMaterial({ color: 0x59636f, roughness: 0.8 });
const lit = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.0, 0.4) });

function makeCity(scale) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.35, 24), pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.03, 8, 32).rotateX(Math.PI / 2), lit);
  ring.position.y = 0.19;
  g.add(base, ring);
  for (let i = 0; i < 13; i++) {
    const a = i * 2.4, r = i === 0 ? 0 : 0.28 + (i / 13) * 0.75, h = i === 0 ? 1.15 : 0.35 + Math.random() * 0.65;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, h, 8), wall);
    t.position.set(Math.cos(a) * r, 0.17 + h / 2, Math.sin(a) * r);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), roof);
    cap.position.set(t.position.x, 0.17 + h, t.position.z);
    const win = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.05, 8), lit);
    win.position.set(t.position.x, 0.17 + h * 0.65, t.position.z);
    g.add(t, cap, win);
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.32, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.95, 1), glass);
  dome.position.y = 0.17;
  dome.renderOrder = 2;
  g.add(dome);
  g.scale.setScalar(scale);
  return g;
}

/** Put cities on well-separated land points. The first is the capital, near `prefer`. */
export function addCities(planet, count, prefer) {
  const dirs = [], d = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const land = (v) => {
    const h = planet.heightAt(v);
    if (h < 0.02 || h > 0.16 || Math.abs(v.y) > 0.65) return false;
    // Not right on a shore.
    const e = new THREE.Vector3().crossVectors(up, v).normalize(), n = new THREE.Vector3().crossVectors(v, e);
    return [e, n, e.clone().negate(), n.clone().negate()].every((t) => planet.heightAt(v.clone().addScaledVector(t, 0.035).normalize()) > 0);
  };
  let best = null, bd = -2;
  for (let i = 0; i < 4000; i++) {
    d.randomDirection();
    if (land(d) && d.dot(prefer) > bd) (bd = d.dot(prefer)), (best = d.clone());
  }
  if (best) dirs.push(best);
  for (let i = 0; i < 6000 && dirs.length < count; i++) {
    d.randomDirection();
    if (land(d) && dirs.every((o) => o.angleTo(d) > 0.55)) dirs.push(d.clone());
  }
  dirs.forEach((dir, i) => {
    const c = makeCity(i === 0 ? 2.1 : 1.4);
    const h = Math.max(0, planet.heightAt(dir));
    c.position.copy(dir).multiplyScalar(planet.radius + h * planet.relief + 0.05);
    c.quaternion.setFromUnitVectors(up, dir);
    planet.surface.add(c);
    planet.cityDirs[i].copy(dir);
  });
  planet.surface.material.uniforms.uCityCount.value = dirs.length;
  return dirs;
}

export function makeCritter(hue) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.65, 0.55), roughness: 0.6, emissive: new THREE.Color().setHSL(hue, 0.6, 0.08) });
  const belly = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.4, 0.78), roughness: 0.7 });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff }), black = new THREE.MeshBasicMaterial({ color: 0x101018 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14).scale(1, 0.85, 1.2), skin);
  const tum = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 10).scale(1, 0.75, 1.15), belly);
  tum.position.y = -0.14;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), skin);
  head.position.set(0, 0.32, 0.55);
  g.add(body, tum, head);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), white);
    e.position.set(s * 0.15, 0.44, 0.82);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), black);
    p.position.set(s * 0.15, 0.44, 0.92);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 8), belly);
    horn.position.set(s * 0.17, 0.68, 0.45);
    horn.rotation.z = -s * 0.4;
    g.add(e, p, horn);
    for (const z of [-0.3, 0.3]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.32, 4, 8), skin);
      leg.position.set(s * 0.32, -0.46, z);
      g.add(leg);
    }
  }
  return g;
}

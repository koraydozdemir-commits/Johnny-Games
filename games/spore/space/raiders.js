// Hostile ships: pirates in empty space and the warships of anyone you are at war with. They close in, circle and shoot.
// Your laser bolts hit them (see hitTest); their bolts cost you hull. Kept self-contained so main.js only wires it up.
import * as THREE from "three";
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export function createRaiders({ scene, S, explode, sound, toast, onKill, onWreck }) {
  const ships = [], shots = [];
  const boltGeo = new THREE.CylinderGeometry(0.12, 0.12, 5, 6).rotateX(Math.PI / 2);
  const hullGeo = new THREE.ConeGeometry(2.4, 9, 5).rotateX(Math.PI / 2);
  const wingGeo = new THREE.BoxGeometry(9, 0.3, 3.2);
  function make(color) {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x20232b, metalness: 0.8, roughness: 0.35 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3) });
    g.add(new THREE.Mesh(hullGeo, dark));
    const w = new THREE.Mesh(wingGeo, dark);
    w.position.z = -1.6;
    g.add(w);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), glow); e.position.set(s * 4.4, 0, -2.6); g.add(e); }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), glow);
    eye.position.set(0, 0.5, 2.2);
    g.add(eye);
    return g;
  }
  function spawn(n, color = 0xff4a3a, around = S.pos) {
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 - S.yaw + (Math.random() - 0.5) * 1.6, mesh = make(color); // ahead of you, so you see them come
      mesh.position.copy(around).add(V(Math.cos(a) * 520, (Math.random() - 0.5) * 120, Math.sin(a) * 520));
      scene.add(mesh);
      ships.push({ mesh, hp: 3, v: V(), cool: 2 + Math.random() * 2, orbit: Math.random() * 6.28, dir: Math.random() < 0.5 ? 1 : -1, color });
    }
    toast(n > 1 ? "Hostile ships detected" : "A hostile ship is closing in", 3);
    sound?.tone(200, 90, 0.5, "sawtooth", 0.1);
  }
  const tmp = V(), aim = V();
  function update(dt) {
    for (const r of ships) {
      // Close to about 140 units, then circle.
      tmp.subVectors(S.pos, r.mesh.position);
      const d = tmp.length();
      tmp.divideScalar(d || 1);
      const want = d > 170 ? 1 : d < 110 ? -0.6 : 0;
      r.orbit += dt * 0.5 * r.dir;
      aim.set(-tmp.z * r.dir, Math.sin(r.orbit) * 0.15, tmp.x * r.dir);
      const sp = 60 + (d > 300 ? 60 : 0);
      r.v.lerp(tmp.clone().multiplyScalar(want * sp).addScaledVector(aim, 34), Math.min(1, dt * 1.6));
      r.mesh.position.addScaledVector(r.v, dt);
      r.mesh.lookAt(S.pos);
      r.cool -= dt;
      if (r.cool <= 0 && d < 330) {
        r.cool = 1.5 + Math.random() * 1.2;
        const from = r.mesh.position.clone(), dir = S.pos.clone().addScaledVector(V().randomDirection(), 9).sub(from).normalize();
        const m = new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(r.color).multiplyScalar(3) }));
        m.position.copy(from);
        m.lookAt(from.clone().add(dir));
        scene.add(m);
        shots.push({ m, v: dir.multiplyScalar(190), life: 2.2 });
      }
    }
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.m.position.addScaledVector(s.v, dt);
      s.life -= dt;
      if (s.m.position.distanceTo(S.pos) < 7) {
        S.hull = Math.max(0, S.hull - 6);
        explode(s.m.position, 0.5, 0xff5a3a);
        sound?.boom(0.25);
        s.life = 0;
        if (S.hull <= 0) { onWreck(); return; }
      }
      if (s.life <= 0) { scene.remove(s.m); s.m.material.dispose(); shots.splice(i, 1); }
    }
  }
  /** A player bolt moving prev → next: true if it struck a ship. */
  const seg = new THREE.Line3(), near = V();
  function hitTest(prev, next) {
    seg.set(prev, next);
    for (let i = ships.length - 1; i >= 0; i--) {
      const r = ships[i];
      seg.closestPointToPoint(r.mesh.position, true, near);
      if (near.distanceTo(r.mesh.position) < 6) {
        r.hp--;
        explode(near, 0.5);
        if (r.hp <= 0) {
          explode(r.mesh.position, 2.2, 0xff7a3a);
          sound?.boom(0.55);
          scene.remove(r.mesh);
          ships.splice(i, 1);
          onKill(ships.length);
        }
        return true;
      }
    }
    return false;
  }
  function clear() {
    for (const r of ships.splice(0)) scene.remove(r.mesh);
    for (const s of shots.splice(0)) (scene.remove(s.m), s.m.material.dispose());
  }
  return { positions: () => ships.map((r) => r.mesh.position), spawn, update, hitTest, clear, get count() { return ships.length; } };
}

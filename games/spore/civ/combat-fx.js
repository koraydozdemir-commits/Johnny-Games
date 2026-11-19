/**
 * Visible combat: projectiles that fly from a weapon to its target (bullets, shells that arc, missiles that
 * home), muzzle flashes and explosions. Damage is applied when a projectile arrives, so a fast vehicle can
 * outrun a slow shell and a battle is seen happening. Pooled meshes, a hard cap on how many are live.
 */
import * as THREE from "three";
import { PROJECTILE, flightTime } from "./rts.js";

const MAX_LIVE = 56;
const up = new THREE.Vector3();
const dir = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);

/**
 * @param {THREE.Scene} scene
 */
export function createCombatFx(scene) {
  const geo = {
    bullet: new THREE.CylinderGeometry(0.1, 0.1, 1.3, 5).rotateX(Math.PI / 2),
    shell: new THREE.SphereGeometry(0.42, 8, 6),
    missile: new THREE.ConeGeometry(0.26, 1.5, 6).rotateX(-Math.PI / 2),
    flash: new THREE.SphereGeometry(1, 8, 6),
    ring: new THREE.RingGeometry(0.7, 1, 24),
  };
  const mat = {
    bullet: new THREE.MeshBasicMaterial({ color: 0xfff1a8 }),
    shell: new THREE.MeshBasicMaterial({ color: 0xffb04a }),
    missile: new THREE.MeshBasicMaterial({ color: 0xff7b5c }),
  };
  const live = [];
  const idle = { bullet: [], shell: [], missile: [] };
  const blasts = [];
  const blastPool = [];

  function grab(kind) {
    const m = idle[kind].pop() || new THREE.Mesh(geo[kind], mat[kind]);
    m.frustumCulled = false;
    scene.add(m);
    return m;
  }
  function release(p) {
    scene.remove(p.mesh);
    idle[p.kind].push(p.mesh);
  }
  function blast(at, size, color, life = 0.45, ring = false) {
    const m = blastPool.pop() || {
      mesh: new THREE.Mesh(geo.flash, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })),
      ringMesh: new THREE.Mesh(geo.ring, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })),
    };
    for (const part of ring ? [m.mesh, m.ringMesh] : [m.mesh]) {
      part.material.color.setHex(color);
      part.position.copy(at);
      part.frustumCulled = false;
      part.renderOrder = 6;
      scene.add(part);
    }
    // The ring lies flat on the ground: face it along the local up.
    up.copy(at).normalize();
    m.ringMesh.quaternion.setFromUnitVectors(Z, up);
    blasts.push({ m, t: 0, life, size, ring });
  }

  return {
    /**
     * Fire a projectile.
     * @param {THREE.Vector3} from  world position of the muzzle
     * @param {() => THREE.Vector3} to  where the target is now (called every frame: it can move)
     * @param {"bullet"|"shell"|"missile"} kind
     * @param {() => void} onHit  called on arrival
     * @param {{ miss?: boolean }} [o] a miss flies on to a spot beside the target and does nothing
     */
    fire(from, to, kind, onHit, { miss = false } = {}) {
      if (live.length >= MAX_LIVE) {
        const old = live.shift();
        release(old);
        old.onHit();
      }
      const start = from.clone();
      const end = to();
      const dist = start.distanceTo(end);
      const off = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(miss ? 9 : 0);
      live.push({ kind, mesh: grab(kind), from: start, to, off, t: 0, dur: Math.max(0.08, flightTime(dist, kind)), arc: PROJECTILE[kind].arc, onHit: miss ? () => {} : onHit, last: start.clone(), dist });
      blast(start, 0.7, 0xfff1a8, 0.1);
    },
    explode(at, size = 2.4, color = 0xffa14a) {
      blast(at, size, color, 0.55, true);
      blast(at, size * 0.55, 0xfff1a8, 0.25);
    },
    get live() {
      return live.length;
    },
    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        p.t += dt;
        const k = Math.min(1, p.t / p.dur);
        const end = p.to();
        // Missiles keep tracking; shells and bullets fly to where the target was a moment ago.
        _p.copy(p.from).lerp(end, k).add(p.off.clone().multiplyScalar(k));
        up.copy(_p).normalize();
        _p.addScaledVector(up, Math.sin(Math.PI * k) * p.arc * p.dist);
        dir.copy(_p).sub(p.last);
        p.mesh.position.copy(_p);
        if (dir.lengthSq() > 1e-6) {
          dir.normalize();
          _q.setFromUnitVectors(Z, dir);
          p.mesh.quaternion.copy(_q);
        }
        p.last.copy(_p);
        if (k >= 1) {
          live.splice(i, 1);
          release(p);
          p.onHit();
          blast(_p.clone(), p.kind === "bullet" ? 0.5 : p.kind === "shell" ? 1.4 : 1.8, p.kind === "bullet" ? 0xfff1a8 : 0xffa14a, 0.3);
        }
      }
      for (let i = blasts.length - 1; i >= 0; i--) {
        const b = blasts[i];
        b.t += dt;
        const k = b.t / b.life;
        if (k >= 1) {
          scene.remove(b.m.mesh, b.m.ringMesh);
          blastPool.push(b.m);
          blasts.splice(i, 1);
          continue;
        }
        b.m.mesh.scale.setScalar(b.size * (0.35 + k * 0.9));
        b.m.mesh.material.opacity = 0.85 * (1 - k);
        if (b.ring) {
          b.m.ringMesh.scale.setScalar(b.size * (0.5 + k * 2.2));
          b.m.ringMesh.material.opacity = 0.6 * (1 - k);
        }
      }
    },
    dispose() {
      for (const p of live) scene.remove(p.mesh);
      live.length = 0;
      for (const b of blasts) {
        scene.remove(b.m.mesh, b.m.ringMesh);
        b.m.mesh.material.dispose();
        b.m.ringMesh.material.dispose();
      }
      blasts.length = 0;
      Object.values(geo).forEach((g) => g.dispose());
      Object.values(mat).forEach((m) => m.dispose());
      for (const m of blastPool) {
        m.mesh.material.dispose();
        m.ringMesh.material.dispose();
      }
    },
  };
}

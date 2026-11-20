/**
 * Civilization Stage — projectiles. Every shot in a fight is a thing that flies: cannon shells, tracers,
 * artillery shells on a high arc, missiles trailing smoke, bombs falling from aircraft, torpedoes running
 * along the water and the flak and shells of city turrets. Damage lands when (and where) a shot hits, so a
 * target that dies first takes no more, and a shot already in the air still lands.
 *
 * Shots home in on a moving target (a vehicle drives away under fire and the shell still finds it), which
 * keeps hits reliable at the planet's scale without simulating ballistics.
 */
import * as THREE from "three";

/** How each weapon looks and flies. speed: world units a second; arc: height of the flight path per unit
 * of distance; size: of the glowing shell; trail: puffs a second; blast: size of the explosion on impact. */
export const WEAPONS = {
  shell: { speed: 95, arc: 0.12, size: 0.9, color: 0xffe08a, trail: 0, blast: 3.2 },
  tracer: { speed: 150, arc: 0.02, size: 0.6, color: 0xfff6c8, trail: 0, blast: 2.2 },
  flak: { speed: 140, arc: 0.04, size: 0.7, color: 0xbfe3ff, trail: 0, blast: 3.4, burst: true },
  artillery: { speed: 48, arc: 0.45, size: 1.4, color: 0xffc070, trail: 14, blast: 6.5 },
  missile: { speed: 70, arc: 0.18, size: 1, color: 0xff9a5a, trail: 30, blast: 5 },
  bomb: { speed: 34, arc: -0.02, size: 1.2, color: 0x3a3a3a, trail: 0, blast: 7.5, drop: true },
  torpedo: { speed: 40, arc: 0, size: 0.9, color: 0xd8f6ff, trail: 22, blast: 5.5, water: true },
  turret: { speed: 110, arc: 0.1, size: 1, color: 0xffb37a, trail: 0, blast: 3.6 },
};

export function createProjectiles(scene, { glowTex, onBlast }) {
  const flying = [];
  const puffs = [];
  const mats = new Map();
  const matFor = (color) => {
    if (!mats.has(color)) mats.set(color, new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    return mats.get(color);
  };
  const smokeMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x9a9a9a, transparent: true, depthWrite: false, opacity: 0.5 });
  const pos = new THREE.Vector3(),
    up = new THREE.Vector3();

  /**
   * Fire a shot.
   * @param {string} kind     a key of WEAPONS
   * @param {THREE.Vector3} from
   * @param {() => THREE.Vector3|null} target  where the target is now (null: it's gone; the shot lands where it last was)
   * @param {() => void} [onHit] damage, applied on impact
   */
  function fire(kind, from, target, onHit) {
    const w = WEAPONS[kind] || WEAPONS.shell;
    const sprite = new THREE.Sprite(matFor(w.color));
    sprite.scale.setScalar(w.size);
    sprite.position.copy(from);
    scene.add(sprite);
    const start = from.clone();
    const last = (target() || from).clone();
    const dist = Math.max(1, start.distanceTo(last));
    flying.push({ w, sprite, start, last, target, onHit, t: 0, dur: Math.max(0.12, dist / w.speed), dist, puff: 0 });
  }
  function puff(p, size, life, color = null) {
    const s = new THREE.Sprite(color ? matFor(color) : smokeMat);
    s.position.copy(p);
    s.scale.setScalar(size);
    scene.add(s);
    puffs.push({ s, t: 0, life, size });
  }
  function update(dt) {
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i];
      f.t += dt;
      const now = f.target();
      if (now) f.last.copy(now);
      const k = Math.min(1, f.t / f.dur);
      // Along the straight line to the target, lifted into an arc (a bomb falls instead: it starts at the
      // aircraft and drops onto the target).
      pos.lerpVectors(f.start, f.last, f.w.drop ? k * k : k);
      up.copy(pos).normalize();
      if (!f.w.water) pos.addScaledVector(up, f.dist * f.w.arc * 4 * k * (1 - k));
      f.sprite.position.copy(pos);
      if (f.w.trail && (f.puff -= dt) <= 0) {
        f.puff = 1 / f.w.trail;
        puff(pos, f.w.water ? 1.2 : f.w.size * 1.2, f.w.water ? 0.9 : 0.6, f.w.water ? 0xdff6ff : null);
      }
      if (k < 1) continue;
      scene.remove(f.sprite);
      flying.splice(i, 1);
      onBlast?.(f.last, f.w.blast, f.w.burst);
      f.onHit?.();
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.t += dt / p.life;
      // (Materials are shared, so a puff fades by shrinking away rather than by its opacity.)
      p.s.scale.setScalar(Math.max(0.01, p.size * (1 + p.t * 1.5) * (1 - p.t * p.t)));
      if (p.t >= 1) {
        scene.remove(p.s);
        puffs.splice(i, 1);
      }
    }
  }
  return {
    fire,
    update,
    get count() {
      return flying.length;
    },
    dispose() {
      flying.forEach((f) => scene.remove(f.sprite));
      puffs.forEach((p) => scene.remove(p.s));
      flying.length = puffs.length = 0;
      mats.forEach((m) => m.dispose());
      smokeMat.dispose();
    },
  };
}

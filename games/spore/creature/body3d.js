/**
 * Builds a land creature from a creature record: a round body swept along a side-profile spine,
 * legs whose feet always reach the ground, and parts oriented to the surface. Returns a small rig
 * that walks, bobs, performs abilities, flinches and dies.
 *
 * Local frame: +x is forward (head), +y is up, +z is the creature's left. Ground is y = 0.
 */
import * as THREE from "three";
import { getMembraneTexture, getPartMaterial } from "../gfx/materials.js";
import { spineSamples, vivid } from "../gfx/body.js";
import { creaturePart, partGeometry } from "./parts.js";

const UP = new THREE.Vector3(0, 1, 0);

/** Sweep the spine as a round body. Also returns a surface lookup used to seat legs and parts. */
function sweepBody(spine, rings, around) {
  const samples = spineSamples(
    spine.map((n) => ({ x: n.x, y: n.y, r: n.r })),
    rings,
  ).map((s) => ({ p: new THREE.Vector3(s.p.x, s.p.y, 0), tan: new THREE.Vector3(s.tan.x, s.tan.y, 0).normalize(), r: s.r }));
  const head = samples.at(-1),
    tail = samples.at(0);
  const caps = 6,
    profile = [];
  for (let i = caps; i > 0; i--) {
    const k = i / caps;
    profile.push({ p: tail.p.clone().addScaledVector(tail.tan, -tail.r * 0.9 * k), tan: tail.tan, r: tail.r * Math.sqrt(1 - k * k) + 0.002 });
  }
  profile.push(...samples);
  for (let i = 1; i <= caps; i++) {
    const k = i / caps;
    profile.push({ p: head.p.clone().addScaledVector(head.tan, head.r * 0.9 * k), tan: head.tan, r: head.r * Math.sqrt(1 - k * k) + 0.002 });
  }
  const minX = profile[0].p.x,
    maxX = profile.at(-1).p.x,
    maxR = Math.max(...profile.map((p) => p.r));
  const pos = [],
    uv = [],
    belly = [],
    idx = [];
  const n = new THREE.Vector3(),
    v = new THREE.Vector3();
  profile.forEach((s) => {
    n.set(-s.tan.y, s.tan.x, 0).normalize(); // "up" across the spine
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * Math.PI * 2;
      v.copy(s.p).addScaledVector(n, Math.cos(a) * s.r * 0.9);
      v.z += Math.sin(a) * s.r;
      pos.push(v.x, v.y, v.z);
      uv.push((v.x - minX) / (maxX - minX), 0.5 + v.z / (2 * maxR));
      // 0 on the back and flanks, rising to 1 on the underside.
      const c = Math.cos(a);
      belly.push(Math.min(1, Math.max(0, (-c - 0.05) / 0.6)) ** 1.3);
    }
  });
  for (let i = 0; i < profile.length - 1; i++)
    for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j,
        b = a + around + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute("aBelly", new THREE.Float32BufferAttribute(belly, 1));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();

  /** Point and outward normal on the body at spine fraction t (0 tail .. 1 head) and angle (0 top, +PI/2 left). */
  const surface = (t, angle) => {
    const f = Math.min(samples.length - 1.001, Math.max(0, t * (samples.length - 1)));
    const i = Math.floor(f),
      k = f - i;
    const a = samples[i],
      b = samples[i + 1];
    const p = a.p.clone().lerp(b.p, k),
      tan = a.tan.clone().lerp(b.tan, k).normalize(),
      r = a.r + (b.r - a.r) * k;
    const up = new THREE.Vector3(-tan.y, tan.x, 0).normalize();
    const normal = up.clone().multiplyScalar(Math.cos(angle)).add(new THREE.Vector3(0, 0, Math.sin(angle))).normalize();
    const point = p.clone().addScaledVector(up, Math.cos(angle) * r * 0.9);
    point.z += Math.sin(angle) * r;
    return { point, normal, tan, r };
  };
  return { geometry, surface, head, tail, minX, maxX, maxR };
}

/** Orient a part so its +x points along `outward`, keeping it as upright as possible. */
function orient(obj, outward, fallbackUp) {
  const x = outward.clone().normalize();
  let y = UP.clone().addScaledVector(x, -UP.dot(x));
  if (y.lengthSq() < 1e-4) y = fallbackUp.clone().addScaledVector(x, -fallbackUp.dot(x));
  y.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** How long each move's animation lasts, in seconds. Social moves are little performances. */
export const ABILITY_TIME = { bite: 0.6, strike: 0.6, charge: 0.6, spit: 0.6, sing: 1.5, dance: 1.7, charm: 1.5, pose: 1.4 };

/**
 * @param {object} record creature record
 * @param {{ quality?: string, seed?: number }} opts
 */
export function buildCreatureBody(record, opts = {}) {
  const quality = opts.quality || "medium";
  const detail = quality === "low" ? [22, 10] : quality === "medium" ? [32, 14] : [44, 18];
  const sweep = sweepBody(record.spine, detail[0], detail[1]);
  const length = sweep.maxX - sweep.minX;
  const colors = record.colors;
  const texture = getMembraneTexture({
    base: vivid(colors.base),
    pattern: colors.pattern,
    accent: colors.accent,
    kind: record.pattern,
    strokes: [],
    extent: { minX: sweep.minX, maxX: sweep.maxX, minY: -sweep.maxR, maxY: sweep.maxR, width: length, height: 2 * sweep.maxR },
    size: quality === "low" ? 256 : 512,
    seed: opts.seed || 3,
  });
  const skin = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55, metalness: 0.02, emissive: 0x000000 });
  // Belly colour: blended in by how far round the underside each point of the body is.
  const bellyUniform = { value: new THREE.Color(vivid(colors.belly ?? colors.base)) };
  skin.onBeforeCompile = (shader) => {
    shader.uniforms.uBelly = bellyUniform;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute float aBelly;\nvarying float vBelly;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvBelly = aBelly;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uBelly;\nvarying float vBelly;")
      .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uBelly * (0.82 + 0.18 * diffuseColor.rgb / max(max(diffuseColor.r, diffuseColor.g), max(diffuseColor.b, 0.001))), vBelly * 0.92);")
      // The underside faces away from the sky; a little bounce light keeps the belly colour readable.
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += uBelly * vBelly * 0.3;");
  };
  skin.customProgramCacheKey = () => "creature-skin-belly2";
  const limbMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(vivid(colors.base)).multiplyScalar(0.72), roughness: 0.6, emissive: 0x000000 });

  const root = new THREE.Group(); // placed in the world
  const body = new THREE.Group(); // bobs, leans and plays abilities
  root.add(body);
  const torso = new THREE.Mesh(sweep.geometry, skin);
  torso.castShadow = false;
  body.add(torso);

  /* Legs. Feet reach a common ground plane; longer legs lift the whole body. */
  const legPairs = record.legs || [];
  const hipAngle = 2.15; // lower flank
  const hips = legPairs.map((l) => ({ l, left: sweep.surface(l.t, hipAngle), right: sweep.surface(l.t, -hipAngle) }));
  let lift;
  if (hips.length) lift = Math.max(...hips.map((h) => h.l.length * 0.95 - h.left.point.y));
  else lift = Math.max(...record.spine.map((n) => n.r * 0.9 - n.y)); // no legs: the belly rests on the ground
  body.position.y = lift;
  const disposables = [sweep.geometry, skin, limbMat];
  const legs = [];
  const footId = record.foot || "pads";
  /*
   * Three bones (thigh, shin, ankle) with rounded joints, like Spore's limbs. Each pair has a rest
   * pose set by its bend (knees forward or back); bone lengths are solved so that in the rest pose the
   * foot lands exactly on the ground. Crouching and jumping layer extra bend on top of the rest pose.
   */
  const restPose = (bend, crouch = 0) => ({ u: 0.18 + bend * 0.4 + crouch * 0.35, k: -0.42 - bend * 0.7 - crouch * 0.75, a: 0.24 + bend * 0.3 + crouch * 0.4 });
  const reachOf = (pose) => 1.05 * Math.cos(pose.u) + Math.cos(pose.u + pose.k) + 0.55 * Math.cos(pose.u + pose.k + pose.a);
  hips.forEach((h, pair) => {
    const bend = h.l.bend || 0;
    const rest = restPose(bend);
    for (const [side, s] of [
      [1, h.left],
      [-1, h.right],
    ]) {
      const hipY = s.point.y + lift; // height of the hip above ground
      const seg = Math.max(0.12, (hipY - 0.04) / reachOf(rest));
      const thick = 0.07 + h.l.length * 0.04;
      const bone = (r0, r1, len) => {
        const g = new THREE.CylinderGeometry(r1, r0, len, 10).translate(0, -len / 2, 0);
        disposables.push(g);
        return new THREE.Mesh(g, limbMat);
      };
      const jointGeo = new THREE.SphereGeometry(thick * 1.12, 10, 8);
      disposables.push(jointGeo);
      const hip = new THREE.Group();
      hip.position.set(s.point.x, s.point.y, s.point.z + side * 0.04);
      hip.add(new THREE.Mesh(jointGeo, limbMat));
      const upper = bone(thick, thick * 0.85, seg * 1.05);
      const knee = new THREE.Group();
      knee.position.y = -seg * 1.05;
      const kneeBall = new THREE.Mesh(jointGeo, limbMat);
      kneeBall.scale.setScalar(0.85);
      knee.add(kneeBall);
      const lower = bone(thick * 0.85, thick * 0.65, seg);
      const ankle = new THREE.Group();
      ankle.position.y = -seg;
      const ankleBall = new THREE.Mesh(jointGeo, limbMat);
      ankleBall.scale.setScalar(0.65);
      ankle.add(ankleBall);
      const shank = bone(thick * 0.65, thick * 0.55, seg * 0.55);
      const foot = new THREE.Mesh(partGeometry(footId, colors.base), getPartMaterial());
      foot.position.y = -seg * 0.55;
      ankle.add(shank, foot);
      lower.add(ankle);
      knee.add(lower);
      upper.add(knee);
      hip.add(upper);
      hip.rotation.x = side * 0.12;
      body.add(hip);
      legs.push({ pair, side, hip, upper, knee, ankle, foot, seg, bend, phase: pair * Math.PI * 0.5 + (side > 0 ? 0 : Math.PI) });
    }
  });
  // How far the body drops in a full crouch, so the feet stay planted.
  const crouchDrop = legs.length ? legs.reduce((sum, l) => sum + l.seg * (reachOf(restPose(l.bend)) - reachOf(restPose(l.bend, 1))), 0) / legs.length : 0;

  /* Parts */
  const partMeshes = [];
  let mouth = new THREE.Vector3(sweep.maxX, sweep.head.p.y, 0);
  const place = (id, point, outward, scale, index, mirror = false, roll = 0, bend = 0) => {
    const mesh = new THREE.Mesh(partGeometry(id, colors.base, bend), getPartMaterial());
    mesh.userData.partIndex = index;
    mesh.userData.partId = id;
    mesh.position.copy(point);
    orient(mesh, outward, new THREE.Vector3(1, 0, 0));
    if (roll) mesh.rotateX(roll); // turn about its own outward axis
    mesh.scale.setScalar(scale);
    mesh.userData.baseQuat = mesh.quaternion.clone();
    mesh.userData.glider = (creaturePart(id)?.abilities.glide || 0) > 0;
    if (mirror) {
      // A true mirror image of the other side, not a rotated copy (three.js flips the winding for us).
      const holder = new THREE.Group();
      holder.scale.z = -1;
      holder.add(mesh);
      body.add(holder);
    } else body.add(mesh);
    partMeshes.push(mesh);
    return mesh;
  };
  /** Where a part sits and which way it faces. Near the head tip parts face forward, near the tail backward. */
  const mount = (def, t, angle) => {
    if (def.slot === "mouth" && t >= 0.97) return { point: sweep.head.p.clone().addScaledVector(sweep.head.tan, sweep.head.r * 0.75), out: sweep.head.tan.clone(), tip: true };
    if (def.slot === "tail" && t <= 0.03) return { point: sweep.tail.p.clone().addScaledVector(sweep.tail.tan, -sweep.tail.r * 0.8), out: sweep.tail.tan.clone().negate(), tip: true };
    const s = sweep.surface(t, angle);
    const out = s.normal.clone();
    if (def.slot === "eye" || def.slot === "mouth") out.addScaledVector(s.tan, def.slot === "eye" ? 0.8 : 1.2);
    if (t > 0.88) out.addScaledVector(sweep.head.tan, (t - 0.88) * 6);
    if (t < 0.12) out.addScaledVector(sweep.tail.tan, -(0.12 - t) * 6);
    return { point: s.point, out: out.normalize(), tip: false };
  };
  (record.parts || []).forEach((p, index) => {
    const def = creaturePart(p.id);
    if (!def) return;
    let scale = p.scale || 1;
    const m = mount(def, p.t, p.angle);
    if (def.slot === "mouth" && m.tip) scale *= Math.max(0.8, sweep.head.r * 2.2);
    place(p.id, m.point, m.out, scale, index, false, p.roll || 0, p.bend || 0);
    if (def.slot === "mouth") mouth = m.point.clone().addScaledVector(m.out, 0.35);
    // Anything off the midline gets its mirror twin on the other flank.
    if (!m.tip && Math.abs(p.angle) > 0.15 && Math.abs(p.angle) < Math.PI - 0.15) place(p.id, m.point, m.out, scale, index, true, p.roll || 0, p.bend || 0);
  });
  mouth.y += lift;

  /* Rig */
  const anim = { phase: 0, ability: null, abilityT: 0, hit: 0, dead: -1, lod: 1, crouch: 0, crouchTarget: 0, air: null, airK: 0 };
  // Sneaking turns the creature see-through; parts get their own translucent copy of the shared material.
  let ghostParts = null;
  const flapAxis = new THREE.Vector3(0, 0, 1),
    flapQuat = new THREE.Quaternion();
  const red = new THREE.Color(0.6, 0.05, 0.05);
  return {
    root,
    body,
    length,
    height: lift + sweep.maxR,
    radius: Math.max(sweep.maxR, length / 2),
    /** Mouth position in the creature's local frame, for eating and biting. */
    mouthLocal: mouth,
    legCount: legs.length,
    /** For the editor: the torso and part meshes to hit-test, and the surface lookup (body-local). */
    torso,
    partMeshes,
    surface: sweep.surface,
    extent: { minX: sweep.minX, maxX: sweep.maxX, lift },
    update(dt, speed = 0) {
      if (anim.dead >= 0) {
        anim.dead = Math.min(1, anim.dead + dt * 1.4);
        root.rotation.z = anim.dead * 1.4;
        root.position.y -= dt * 0.4 * anim.dead;
        return;
      }
      anim.crouch += (anim.crouchTarget - anim.crouch) * Math.min(1, dt * 8);
      anim.airK += ((anim.air ? 1 : 0) - anim.airK) * Math.min(1, dt * 10);
      const inAir = anim.airK > 0.05;
      // Dancing kicks the legs as if running on the spot.
      const dancing = anim.ability === "dance" ? Math.sin(Math.min(1, anim.abilityT / ABILITY_TIME.dance) * Math.PI) : 0;
      const moving = inAir ? 0 : Math.max(Math.min(1, speed / 3), dancing);
      // Sneaking creatures take shorter, slower steps.
      anim.phase += dt * ((2.5 + speed * 2.2) * (1 - anim.crouch * 0.35) + dancing * 9);
      if (anim.lod > 0)
        legs.forEach((leg) => {
          const s = Math.sin(anim.phase + leg.phase);
          const lift = Math.max(0, Math.cos(anim.phase + leg.phase));
          const rest = restPose(leg.bend, anim.crouch);
          // In the air the legs tuck up (jump) or trail behind (glide).
          const tuck = anim.airK * (anim.air === "glide" ? -0.9 : 0.6);
          leg.upper.rotation.z = s * 0.55 * moving + rest.u + tuck;
          leg.knee.rotation.z = -lift * 0.9 * moving + rest.k - anim.airK * 0.5;
          leg.ankle.rotation.z = lift * 0.5 * moving + rest.a;
        });
      // Gliders spread and beat their wings.
      if (anim.lod > 0)
        partMeshes.forEach((m) => {
          if (!m.userData.glider) return;
          const flap = anim.air === "glide" ? Math.sin(anim.phase * 2.2) * 0.35 * anim.airK - 0.2 * anim.airK : 0;
          m.quaternion.copy(m.userData.baseQuat).multiply(flapQuat.setFromAxisAngle(flapAxis, flap));
        });
      let bob = (Math.abs(Math.sin(anim.phase)) * 0.08 * moving + Math.sin(anim.phase * 0.35) * 0.02) * (1 - anim.airK) - anim.crouch * crouchDrop;
      let lean = Math.sin(anim.phase) * 0.03 * moving,
        lunge = 0,
        spin = 0,
        roll = 0,
        pulse = 1;
      if (anim.ability) {
        anim.abilityT += dt;
        const k = Math.min(1, anim.abilityT / (ABILITY_TIME[anim.ability] || 0.6)),
          swell = Math.sin(k * Math.PI),
          // Eases in, holds, eases out: for moves that strike a pose.
          hold = Math.min(1, k * 5, (1 - k) * 4),
          held = hold * hold * (3 - 2 * hold);
        if (anim.ability === "bite" || anim.ability === "strike") lunge = swell * 0.45;
        else if (anim.ability === "charge") lunge = swell * 0.8;
        else if (anim.ability === "spit") (lean = swell * 0.25), (pulse = 1 + swell * 0.08);
        else if (anim.ability === "sing") {
          // Head thrown back, swaying from side to side, chest swelling on each note.
          lean = held * 0.42;
          roll = held * Math.sin(k * Math.PI * 4) * 0.16;
          pulse = 1 + held * (0.05 + 0.06 * Math.abs(Math.sin(k * Math.PI * 6)));
          bob += held * 0.12;
        } else if (anim.ability === "dance") {
          // Three bouncing hops rocking side to side, the last one a full twirl.
          bob += Math.abs(Math.sin(k * Math.PI * 3)) * 0.55 * Math.min(1, (1 - k) * 6);
          roll = Math.sin(k * Math.PI * 3) * 0.3 * (1 - k);
          const twirl = Math.max(0, (k - 0.55) / 0.45);
          spin = twirl * twirl * (3 - 2 * twirl) * Math.PI * 2 + Math.sin(k * Math.PI * 6) * 0.25 * (1 - twirl);
        } else if (anim.ability === "charm") {
          // A coy bow, a wiggle of the whole body, then a happy little hop.
          lean = -held * 0.22 + Math.max(0, Math.sin((k - 0.72) * Math.PI * 3.5)) * 0.2 * (k > 0.72 ? 1 : 0);
          spin = held * Math.sin(k * Math.PI * 7) * 0.32;
          roll = held * Math.sin(k * Math.PI * 3.5) * 0.12;
          if (k > 0.72) bob += Math.sin(((k - 0.72) / 0.28) * Math.PI) * 0.4;
          pulse = 1 + held * 0.04;
        } else if (anim.ability === "pose") {
          // Rear up tall, puff out and hold it with a proud shiver.
          lean = held * 0.62;
          bob += held * 0.35;
          pulse = 1 + held * 0.13;
          roll = held * Math.sin(k * Math.PI * 14) * 0.035;
        }
        if (k >= 1) anim.ability = null;
      }
      if (anim.air === "glide") lean += -0.12 * anim.airK + Math.sin(anim.phase * 0.7) * 0.04;
      lean += anim.crouch * 0.06; // head low when stalking
      body.position.set(lunge, lift + bob, 0);
      body.rotation.set(roll, spin, lean);
      body.scale.setScalar(pulse);
      if (anim.hit > 0) {
        anim.hit = Math.max(0, anim.hit - dt * 4);
        skin.emissive.copy(red).multiplyScalar(anim.hit);
      } else if (skin.emissive.r) skin.emissive.setRGB(0, 0, 0);
    },
    playAbility(kind) {
      anim.ability = kind;
      anim.abilityT = 0;
    },
    hit() {
      anim.hit = 1;
    },
    die() {
      if (anim.dead < 0) anim.dead = 0;
    },
    get dead() {
      return anim.dead >= 1;
    },
    /** Sneaking pose: 0 standing, 1 full crouch. Eases in over a few frames. */
    setCrouch(v) {
      anim.crouchTarget = v;
    },
    /** "jump", "glide" or null while on the ground. */
    setAir(mode) {
      anim.air = mode;
    },
    /** See-through while sneaking. */
    setGhost(on) {
      const opacity = on ? 0.42 : 1;
      for (const mat of [skin, limbMat]) {
        mat.transparent = on;
        mat.opacity = opacity;
        mat.needsUpdate = true;
      }
      if (on && !ghostParts) {
        const shared = getPartMaterial();
        ghostParts = shared.clone();
        ghostParts.onBeforeCompile = shared.onBeforeCompile;
        ghostParts.customProgramCacheKey = () => "spore-part-ghost";
        ghostParts.transparent = true;
        ghostParts.opacity = 0.42;
        disposables.push(ghostParts);
      }
      const partMat = on ? ghostParts : getPartMaterial();
      partMeshes.forEach((m) => (m.material = partMat));
      legs.forEach((l) => (l.foot.material = partMat));
    },
    /**
     * World positions of every leg joint (for the editor's joint handles).
     * @returns {{pair:number, side:number, hip:THREE.Vector3, knee:THREE.Vector3, foot:THREE.Vector3}[]}
     */
    joints() {
      root.updateMatrixWorld(true);
      return legs.map((l) => ({
        pair: l.pair,
        side: l.side,
        hip: l.hip.getWorldPosition(new THREE.Vector3()),
        knee: l.knee.getWorldPosition(new THREE.Vector3()),
        foot: l.foot.getWorldPosition(new THREE.Vector3()),
      }));
    },
    /** 0 = far: hide small parts and freeze legs. */
    setLOD(level) {
      if (level === anim.lod) return;
      anim.lod = level;
      partMeshes.forEach((m) => (m.visible = level > 0));
    },
    dispose() {
      root.removeFromParent();
      disposables.forEach((d) => d.dispose());
    },
  };
}

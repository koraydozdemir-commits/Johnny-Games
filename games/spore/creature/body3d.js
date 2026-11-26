/**
 * Builds a land creature from a creature record: a round body swept along a side-profile spine,
 * legs whose feet always reach the ground, jointed arms with hands, eyes that blink and look about,
 * and parts oriented to the surface. Returns a small rig that walks, bobs, performs abilities,
 * flinches and dies.
 *
 * Local frame: +x is forward (head), +y is up, +z is the creature's left. Ground is y = 0.
 */
import * as THREE from "three";
import { getMembraneTexture, getPartMaterial } from "../gfx/materials.js";
import { spineSamples, vivid } from "../gfx/body.js";
import { creaturePart, partGeometry } from "./parts.js";
import { EYE_SPECS, buildEye } from "./eyes.js";

const UP = new THREE.Vector3(0, 1, 0);
/** Translucent copies of shared materials, for sneaking (made once, on first use). */
const ghostCopies = new WeakMap();
function ghostOf(mat) {
  if (!ghostCopies.has(mat)) {
    const g = mat.clone();
    g.transparent = true;
    g.opacity = 0.42;
    ghostCopies.set(mat, g);
  }
  return ghostCopies.get(mat);
}

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

/** Parts this far off the spine's top or belly line have a mirror twin (see format.js). */
export const offMidline = (angle) => Math.abs(angle) > 0.15 && Math.abs(angle) < Math.PI - 0.15;

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
export const ABILITY_TIME = { bite: 0.6, strike: 0.6, charge: 0.6, spit: 0.6, sing: 1.5, dance: 1.7, charm: 1.5, pose: 1.4, talk: 1.6, eat: 1.4, dig: 1.2, wave: 1.1 };

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
  // Limbs are close to the body's own colour so they read as part of it, a touch darker like shaded skin.
  const limbMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(vivid(colors.base)).multiplyScalar(0.86), roughness: 0.58, emissive: 0x000000 });
  /**
   * A limb segment hanging down from y = 0: a smooth taper from r0 to r1 with a gentle muscle swell and
   * rounded ends, so one segment melts into the next at a knee or elbow without a ball joint between.
   */
  const limbBone = (r0, r1, len, bulge = 0.14) => {
    const pts = [];
    const cap = Math.min(r1, len * 0.3);
    pts.push(new THREE.Vector2(0.001, -len - cap * 0.95));
    for (let i = 1; i <= 3; i++) {
      const a = (i / 3) * (Math.PI / 2);
      pts.push(new THREE.Vector2(r1 * Math.sin(a), -len - cap * 0.95 * Math.cos(a)));
    }
    const n = 8;
    for (let i = n - 1; i >= 0; i--) {
      const t = i / n; // 0 at the top
      const r = (r0 + (r1 - r0) * t) * (1 + bulge * Math.sin(Math.PI * Math.min(1, t * 1.25)) * (1 - t * 0.4));
      pts.push(new THREE.Vector2(r, -len * t));
    }
    const topCap = r0 * 0.9;
    for (let i = 1; i <= 3; i++) {
      const a = (i / 3) * (Math.PI / 2);
      pts.push(new THREE.Vector2(r0 * Math.cos(a), topCap * Math.sin(a)));
    }
    return new THREE.LatheGeometry(pts, 12);
  };

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
      // Thickness follows the body it hangs from and the length of the limb: a bulky creature gets sturdy legs.
      const thick = Math.min(0.2, Math.max(0.06, 0.04 + h.l.length * 0.025 + (s.r || 0.4) * 0.11));
      const bone = (r0, r1, len, bulge) => {
        const g = limbBone(r0, r1, len, bulge);
        disposables.push(g);
        return new THREE.Mesh(g, limbMat);
      };
      const hip = new THREE.Group();
      hip.position.set(s.point.x, s.point.y, s.point.z + side * 0.04);
      // The haunch: a mass sunk into the flank so the leg grows out of the body instead of being stuck on.
      const massGeo = new THREE.SphereGeometry(thick * 1.55, 12, 9);
      disposables.push(massGeo);
      const mass = new THREE.Mesh(massGeo, limbMat);
      mass.scale.set(1, 1.2, 0.85);
      mass.position.set(0, thick * 0.15, -side * thick * 0.55);
      hip.add(mass);
      const upper = bone(thick * 1.02, thick * 0.74, seg * 1.08, 0.2);
      const knee = new THREE.Group();
      knee.position.y = -seg * 1.05;
      const lower = bone(thick * 0.72, thick * 0.5, seg * 1.02, 0.1);
      const ankle = new THREE.Group();
      ankle.position.y = -seg;
      const shank = bone(thick * 0.5, thick * 0.42, seg * 0.55, 0.02);
      const foot = new THREE.Mesh(partGeometry(footId, colors.base), getPartMaterial());
      foot.position.y = -seg * 0.55;
      foot.scale.setScalar(Math.min(1.5, Math.max(0.8, thick / 0.1))); // feet that suit the leg
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
  // Long-legged bodies stride slower and swing less; short-legged ones patter quickly (so legs never over-reach).
  const avgSeg = legs.length ? legs.reduce((sum, l) => sum + l.seg, 0) / legs.length : 0.6;
  const strideK = Math.min(1.35, Math.max(0.6, Math.sqrt(0.6 / Math.max(0.15, avgSeg))));
  // How far the body drops in a full crouch, so the feet stay planted.
  const crouchDrop = legs.length ? legs.reduce((sum, l) => sum + l.seg * (reachOf(restPose(l.bend)) - reachOf(restPose(l.bend, 1))), 0) / legs.length : 0;

  /*
   * Arms: the same three-bone chain as a leg (upper arm, forearm, wrist) hung from a shoulder on the
   * flank, with the arm pair's hand (a grasper, or a foot) on the end. bend raises the arm and folds
   * the elbow. Arms are free: they never take the body's weight.
   */
  const arms = [];
  const handMeshes = [];
  const armRest = (bend) => ({ u: 0.3 + bend * 0.45, k: 0.95 + bend * 0.55, a: 0.15 + bend * 0.15, splay: 0.32 });
  (record.arms || []).forEach((a, pair) => {
    for (const side of [1, -1]) {
      const s = sweep.surface(a.t, side * a.angle);
      const len = a.length;
      const thick = Math.min(0.14, Math.max(0.045, 0.035 + len * 0.022 + (s.r || 0.4) * 0.07));
      const bone = (r0, r1, l, bulge) => {
        const g = limbBone(r0, r1, l, bulge);
        disposables.push(g);
        return new THREE.Mesh(g, limbMat);
      };
      const shoulder = new THREE.Group();
      shoulder.position.copy(s.point).addScaledVector(s.normal, -thick * 0.4);
      // A rounded shoulder that merges into the chest.
      const shoulderGeo = new THREE.SphereGeometry(thick * 1.4, 12, 9);
      disposables.push(shoulderGeo);
      const shoulderMass = new THREE.Mesh(shoulderGeo, limbMat);
      shoulderMass.scale.set(1, 1.1, 0.9);
      shoulder.add(shoulderMass);
      const upper = bone(thick * 1.02, thick * 0.78, len * 0.52, 0.18);
      const elbow = new THREE.Group();
      elbow.position.y = -len * 0.5;
      const fore = bone(thick * 0.76, thick * 0.56, len * 0.44, 0.1);
      const wrist = new THREE.Group();
      wrist.position.y = -len * 0.42;
      let hand = null;
      if (a.hand) {
        const def = creaturePart(a.hand);
        hand = new THREE.Mesh(partGeometry(a.hand, colors.base), getPartMaterial());
        // Hands are modelled along +x from the wrist, palm down: turn them to hang along the arm.
        // A foot on an arm is worn like a foot, sole toward the ground at rest.
        if (def?.slot === "hand") hand.rotation.z = -Math.PI / 2;
        else {
          // Undo the arm's rest angles so the sole faces the ground, like a forefoot.
          const r = armRest(a.bend || 0);
          hand.rotation.z = -(r.u + r.k + r.a);
          hand.position.y = -thick * 0.4;
        }
        hand.scale.setScalar(0.75 + len * 0.25);
        if (side < 0) {
          // The far side's hand is a true mirror image.
          const holder = new THREE.Group();
          holder.scale.z = -1;
          holder.add(hand);
          wrist.add(holder);
        } else wrist.add(hand);
        handMeshes.push(hand);
      }
      fore.add(wrist);
      elbow.add(fore);
      upper.add(elbow);
      shoulder.add(upper);
      body.add(shoulder);
      arms.push({ pair, side, shoulder, upper, elbow, fore, wrist, hand, bend: a.bend || 0, phase: pair * 0.6 + (side > 0 ? Math.PI : 0) });
    }
  });
  /** Pose every arm: walking swing, a pose for each ability, and the rest pose from the design. */
  function poseArms(moving, k, held, swell, ability) {
    for (const arm of arms) {
      const rest = armRest(arm.bend);
      let u = rest.u + Math.sin(anim.phase + arm.phase) * 0.4 * moving,
        kk = rest.k,
        w = rest.a,
        splay = rest.splay;
      const s = arm.side;
      if (ability === "strike") {
        // Wind up, then a raking slash forward and down.
        const swing = k < 0.35 ? -k / 0.35 : Math.sin(((k - 0.35) / 0.65) * Math.PI);
        u += swing * 1.6;
        kk -= Math.max(0, swing) * 0.8;
      } else if (ability === "bite" || ability === "charge") {
        u -= swell * 0.5; // arms tucked back out of the way
      } else if (ability === "sing") {
        // Arms spread wide, swaying with the song.
        u += held * 0.9;
        kk -= held * 0.6;
        splay += held * (0.9 + Math.sin(k * Math.PI * 4 + s) * 0.15);
      } else if (ability === "dance") {
        // Alternating waves overhead.
        u += swell * (1.7 + Math.sin(k * Math.PI * 6 + (s > 0 ? 0 : Math.PI)) * 0.6);
        kk -= swell * 0.4;
        splay += swell * 0.4;
      } else if (ability === "charm") {
        // Hands brought together under the chin, a shy little wave.
        u += held * 1.2;
        kk += held * 0.5;
        splay -= held * 0.25;
        w += held * Math.sin(k * Math.PI * 8) * 0.4;
      } else if (ability === "pose") {
        // Both arms flung up high.
        u += held * 2.6;
        kk -= held * 0.85;
        splay += held * 0.35;
      } else if (ability === "spit") {
        u += swell * 0.4;
      } else if (ability === "talk") {
        // One hand gestures while it speaks.
        if (s > 0) (u += held * (0.9 + Math.sin(k * Math.PI * 5) * 0.35)), (kk -= held * 0.5);
      } else if (ability === "eat") {
        // Food brought up to the mouth, again and again.
        u += held * (1 + Math.max(0, Math.sin(k * Math.PI * 6)) * 0.5);
        kk += held * 0.9;
      } else if (ability === "dig") {
        // Paws scrabbling at the ground, left and right in turn.
        u -= held * 0.2;
        u += Math.sin(k * Math.PI * 8 + (s > 0 ? 0 : Math.PI)) * 0.5 * held;
      } else if (ability === "wave") {
        // One arm up and waving.
        if (s > 0) (u += held * 2.3), (kk -= held * 0.3), (w += held * Math.sin(k * Math.PI * 6) * 0.6);
      }
      // While sneaking the arms stay drawn in; in the air they spread for balance.
      u -= anim.crouch * 0.25;
      splay += anim.airK * 0.5;
      arm.upper.rotation.z = u;
      arm.elbow.rotation.z = kk;
      arm.wrist.rotation.z = w;
      arm.shoulder.rotation.x = -s * splay;
    }
  }

  /*
   * Eyes: little rigs (see eyes.js). They sit forward-facing in the skin, blink now and then and look
   * at whatever the creature is interested in.
   */
  const eyes = [];
  const lidMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(vivid(colors.base)).multiplyScalar(0.92), roughness: 0.55, side: THREE.DoubleSide });
  const stalkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(vivid(colors.base)).multiplyScalar(0.85), roughness: 0.6 });
  disposables.push(lidMat, stalkMat);
  const eyeMats = { lidMat, stalkMat, compound: partGeometry("bugEyes", colors.base), compoundMat: getPartMaterial() };
  const look = { target: null, yaw: 0, pitch: 0, toYaw: 0, toPitch: 0, wander: 1, blink: 0, nextBlink: 1 + Math.random() * 3, double: false, sleep: 0, sleepTarget: 0 };

  const tmpV = new THREE.Vector3();
  /** Blinking, and turning the eyes toward the target (or glancing about when there is none). */
  function updateEyes(dt) {
    if (!eyes.length) return;
    // Blink every few seconds, sometimes twice; a closed eye takes about a tenth of a second.
    look.nextBlink -= dt;
    if (look.nextBlink <= 0 && look.blink === 0) look.blink = 0.001;
    if (look.blink > 0) {
      look.blink += dt / 0.16;
      if (look.blink >= 1) {
        look.blink = 0;
        look.double = !look.double && Math.random() < 0.25;
        look.nextBlink = look.double ? 0.12 : 2 + Math.random() * 4;
      }
    }
    // Asleep, the lids close slowly and stay shut.
    look.sleep += (look.sleepTarget - look.sleep) * Math.min(1, dt * 2.5);
    const lid = Math.max(look.sleep, look.blink > 0 ? Math.sin(look.blink * Math.PI) : 0);
    // Where to look: at the target if there is one, otherwise a new idle glance every second or two.
    if (look.target) {
      root.updateMatrixWorld();
      tmpV.copy(look.target);
      body.worldToLocal(tmpV);
      tmpV.sub(gazeFrom);
      look.toYaw = THREE.MathUtils.clamp(Math.atan2(tmpV.z, tmpV.x), -0.75, 0.75);
      look.toPitch = THREE.MathUtils.clamp(Math.atan2(tmpV.y, Math.hypot(tmpV.x, tmpV.z)), -0.45, 0.45);
    } else if ((look.wander -= dt) <= 0) {
      look.wander = 0.8 + Math.random() * 2.2;
      look.toYaw = (Math.random() - 0.5) * 0.9;
      look.toPitch = (Math.random() - 0.5) * 0.35;
    }
    // Eyes snap to a new point quickly, the way real eyes do.
    const ease = Math.min(1, dt * 14);
    look.yaw += (look.toYaw - look.yaw) * ease;
    look.pitch += (look.toPitch - look.pitch) * ease;
    for (const e of eyes) {
      e.rig.setBlink(lid);
      // A mirrored eye sees the world flipped left to right.
      e.rig.setGaze(e.mirror ? -look.yaw : look.yaw, look.pitch);
    }
  }

  /* Parts */
  const partMeshes = [];
  let mouth = new THREE.Vector3(sweep.maxX, sweep.head.p.y, 0);
  const place = (id, point, outward, scale, index, mirror = false, roll = 0) => {
    const mesh = new THREE.Mesh(partGeometry(id, colors.base), getPartMaterial());
    mesh.userData.partIndex = index;
    mesh.userData.partId = id;
    mesh.position.copy(point);
    orient(mesh, outward, new THREE.Vector3(1, 0, 0));
    if (roll) mesh.rotateX(roll); // turn about its own outward axis
    mesh.scale.setScalar(scale);
    mesh.userData.baseQuat = mesh.quaternion.clone();
    mesh.userData.glider = (creaturePart(id)?.abilities.glide || 0) > 0;
    mesh.userData.mirror = mirror;
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
  /** An eye rig at a mount point, looking forward along the body (a little outward), upright. */
  const placeEye = (id, point, normal, scale, index, mirror) => {
    const spec = EYE_SPECS[id];
    const rig = buildEye(id, eyeMats);
    const g = rig.group;
    g.scale.setScalar(scale);
    // Seated part-way into the skin so it bulges out like an eye, not stuck on like a marble.
    g.position.copy(point).addScaledVector(normal, spec.stalk ? -0.02 : spec.r * scale * 0.5);
    const fwd = new THREE.Vector3(1, 0, 0).addScaledVector(normal, 0.45);
    fwd.y = Math.max(fwd.y * 0.4, -0.1);
    fwd.normalize();
    // Basis: +x = look direction, +y = as close to world-up as possible.
    const zAxis = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, fwd).normalize();
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fwd, yAxis, zAxis));
    rig.meshes.forEach((m) => {
      m.userData.partIndex = index;
      m.userData.partId = id;
      m.userData.eye = true;
      m.userData.mirror = mirror;
      partMeshes.push(m);
    });
    if (mirror) {
      const holder = new THREE.Group();
      holder.scale.z = -1;
      holder.add(g);
      body.add(holder);
    } else body.add(g);
    eyes.push({ rig, mirror });
  };
  (record.parts || []).forEach((p, index) => {
    const def = creaturePart(p.id);
    if (!def) return;
    let scale = p.scale || 1;
    if (EYE_SPECS[p.id]) {
      const s = sweep.surface(p.t, p.angle);
      placeEye(p.id, s.point, s.normal, scale, index, false);
      if (!p.solo && offMidline(p.angle)) placeEye(p.id, s.point, s.normal, scale, index, true);
      return;
    }
    const m = mount(def, p.t, p.angle);
    if (def.slot === "mouth" && m.tip) scale *= Math.max(0.8, sweep.head.r * 2.2);
    place(p.id, m.point, m.out, scale, index, false, p.roll || 0);
    if (def.slot === "mouth") mouth = m.point.clone().addScaledVector(m.out, 0.35);
    // Anything off the midline gets its mirror twin on the other flank, unless it was made one-sided.
    if (!m.tip && !p.solo && offMidline(p.angle)) place(p.id, m.point, m.out, scale, index, true, p.roll || 0);
  });
  mouth.y += lift;
  // Eyes judge directions from the head.
  const gazeFrom = new THREE.Vector3(sweep.head.p.x, sweep.head.p.y, 0);

  /* Rig */
  const anim = { t: 0, turn: 0, phase: 0, ability: null, abilityT: 0, hit: 0, dead: -1, lod: 1, crouch: 0, crouchTarget: 0, air: null, airK: 0 };
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
    /** @param {number} dt @param {number} [speed] metres/second @param {number} [turn] turn rate, rad/second (leans into turns) */
    update(dt, speed = 0, turn = 0) {
      anim.t += dt;
      anim.turn += (Math.max(-3, Math.min(3, turn)) - anim.turn) * Math.min(1, dt * 6);
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
      anim.phase += dt * (((2.5 + speed * 2.2) * (1 - anim.crouch * 0.35)) / strideK + dancing * 9);
      if (anim.lod > 0)
        legs.forEach((leg) => {
          const s = Math.sin(anim.phase + leg.phase);
          const lift = Math.max(0, Math.cos(anim.phase + leg.phase));
          const rest = restPose(leg.bend, anim.crouch);
          // In the air the legs tuck up (jump) or trail behind (glide).
          const tuck = anim.airK * (anim.air === "glide" ? -0.9 : 0.6);
          const swing = 0.55 * strideK;
          leg.upper.rotation.z = s * swing * moving + rest.u + tuck;
          // The knee folds as the foot comes forward and the ankle follows through, so the foot lifts clear.
          leg.knee.rotation.z = -lift * 0.9 * strideK * moving + rest.k - anim.airK * 0.5;
          leg.ankle.rotation.z = lift * 0.5 * moving + rest.a - s * 0.12 * moving;
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
      let armK = 0,
        armHeld = 0,
        armSwell = 0,
        armAbility = null;
      if (anim.ability) {
        anim.abilityT += dt;
        const k = Math.min(1, anim.abilityT / (ABILITY_TIME[anim.ability] || 0.6)),
          swell = Math.sin(k * Math.PI),
          // Eases in, holds, eases out: for moves that strike a pose.
          hold = Math.min(1, k * 5, (1 - k) * 4),
          held = hold * hold * (3 - 2 * hold);
        // Bites and strikes rear back first, then snap forward: a readable wind-up.
        if (anim.ability === "bite" || anim.ability === "strike") (lunge = swell * 0.5 - 0.16 * Math.max(0, 1 - k * 4)), (lean = -0.12 * Math.max(0, 1 - k * 4) + swell * 0.1);
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
        } else if (anim.ability === "talk") {
          // Little nods and tilts of the head.
          lean = held * (0.08 + Math.sin(k * Math.PI * 6) * 0.06);
          roll = held * Math.sin(k * Math.PI * 2) * 0.06;
        } else if (anim.ability === "eat") {
          // Head dips to the food in quick bites.
          lean = -held * (0.12 + Math.max(0, Math.sin(k * Math.PI * 6)) * 0.12);
        } else if (anim.ability === "dig") {
          // Nose down, rocking as it digs.
          lean = -held * 0.3;
          lunge = held * 0.12;
          roll = held * Math.sin(k * Math.PI * 8) * 0.07;
          bob -= held * 0.06;
        } else if (anim.ability === "wave") {
          lean = held * 0.12;
          roll = held * Math.sin(k * Math.PI * 3) * 0.05;
        } else if (anim.ability === "pose") {
          // Rear up tall, puff out and hold it with a proud shiver.
          lean = held * 0.62;
          bob += held * 0.35;
          pulse = 1 + held * 0.13;
          roll = held * Math.sin(k * Math.PI * 14) * 0.035;
        }
        armK = k;
        armHeld = held;
        armSwell = swell;
        armAbility = anim.ability;
        if (k >= 1) anim.ability = null;
      }
      if (anim.lod > 0) {
        poseArms(moving, armK, armHeld, armSwell, armAbility);
        updateEyes(dt);
      }
      if (anim.air === "glide") lean += -0.12 * anim.airK + Math.sin(anim.phase * 0.7) * 0.04;
      // Standing still it breathes and shifts its weight; running it leans into turns.
      const idle = 1 - moving;
      pulse += Math.sin(anim.t * 1.8) * 0.012 * idle;
      lean += Math.sin(anim.t * 0.6) * 0.012 * idle;
      roll += -anim.turn * 0.045 * Math.min(1, 0.3 + speed / 5) * (1 - anim.airK);
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
    /** Something to look at (a world position), or null to glance about. */
    lookAt(worldPos) {
      look.target = worldPos ? (look.target || new THREE.Vector3()).copy(worldPos) : null;
    },
    /** The near-side hand (or wrist), for holding things; null with no arms. */
    handAnchor() {
      const arm = arms.find((a) => a.side > 0);
      return arm ? arm.wrist : null;
    },
    armCount: (record.arms || []).length,
    /** Sneaking pose: 0 standing, 1 full crouch. Eases in over a few frames. */
    /** Asleep: eyes shut and the body settles low. Pass false to wake. */
    setSleep(on) {
      look.sleepTarget = on ? 1 : 0;
      anim.crouchTarget = on ? 1 : 0;
    },
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
      partMeshes.forEach((m) => {
        if (!m.userData.eye) return (m.material = partMat);
        // Eye pieces have their own materials; swap each for its see-through twin.
        m.userData.solidMat ||= m.material;
        m.material = on ? ghostOf(m.userData.solidMat) : m.userData.solidMat;
      });
      legs.forEach((l) => (l.foot.material = partMat));
      handMeshes.forEach((h) => (h.material = partMat));
    },
    /**
     * World positions of every limb joint (for the editor's joint handles).
     * @returns {{kind:"leg"|"arm", pair:number, side:number, hip:THREE.Vector3, knee:THREE.Vector3, foot:THREE.Vector3}[]}
     */
    joints() {
      root.updateMatrixWorld(true);
      const at = (o) => o.getWorldPosition(new THREE.Vector3());
      return [
        ...legs.map((l) => ({ kind: "leg", pair: l.pair, side: l.side, hip: at(l.hip), knee: at(l.knee), foot: at(l.foot) })),
        // For arms: hip = shoulder, knee = elbow, foot = the hand's end.
        ...arms.map((a) => ({ kind: "arm", pair: a.pair, side: a.side, hip: at(a.shoulder), knee: at(a.elbow), foot: at(a.hand || a.wrist) })),
      ];
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

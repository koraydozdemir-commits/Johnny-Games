/**
 * Living eyes for land creatures. Each eye is a small rig rather than a baked mesh, so it can look
 * around and blink: a glossy white ball with a coloured iris and a pupil, a fixed highlight, and an
 * upper and lower lid in the body's own colour. Eyes look forward along the body (not straight out of
 * the skin), which is what makes Spore's creatures read as looking at something.
 *
 * Local frame of an eye: it looks along +x, up is +y.
 */
import * as THREE from "three";

/** How each eye part is drawn. r = ball radius; stalk = height of the stalk, if any. */
export const EYE_SPECS = {
  eyes: { r: 0.16, iris: 0x5f9a3c, lids: true },
  doeEyes: { r: 0.2, iris: 0x8a5a2a, lids: true, lashes: true },
  stalkEyes: { r: 0.14, iris: 0xd2a020, lids: true, stalk: 0.42 },
  bugEyes: { r: 0.17, compound: true },
};
export const isEyeRig = (id) => !!EYE_SPECS[id];

/** One iris texture per colour: rings, flecks and a soft dark edge. Drawn once, shared. */
const irisTextures = new Map();
function irisTexture(color) {
  if (irisTextures.has(color)) return irisTextures.get(color);
  const size = 128,
    c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const base = new THREE.Color(color);
  const css = (col, a = 1) => `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
  const dark = base.clone().multiplyScalar(0.35),
    light = base.clone().lerp(new THREE.Color(0xffffff), 0.35);
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, css(light));
  grad.addColorStop(0.55, css(base));
  grad.addColorStop(0.9, css(dark));
  grad.addColorStop(1, css(dark.clone().multiplyScalar(0.6)));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  // Fine radial streaks give the iris some depth.
  g.globalAlpha = 0.22;
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2;
    g.strokeStyle = i % 2 ? css(light) : css(dark);
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * 18, 64 + Math.sin(a) * 18);
    g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  irisTextures.set(color, t);
  return t;
}

/* Shared geometry: unit-radius pieces, scaled per eye. */
const ballGeo = new THREE.SphereGeometry(1, 24, 18);
// The iris and pupil are caps on the front of the ball (+x), a hair proud of the white.
const capGeo = (angle) => {
  const g = new THREE.SphereGeometry(1.012, 24, 8, 0, Math.PI * 2, 0, angle);
  g.rotateZ(-Math.PI / 2); // the cap's pole (+y) turned to face +x
  // Planar UVs across the cap so a round texture lands centred on it.
  const pos = g.attributes.position,
    uv = g.attributes.uv,
    s = Math.sin(angle);
  for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getZ(i) / (2 * s), 0.5 + pos.getY(i) / (2 * s));
  return g;
};
const irisGeo = capGeo(0.62);
const pupilGeo = new THREE.SphereGeometry(1.018, 20, 6, 0, Math.PI * 2, 0, 0.27).rotateZ(-Math.PI / 2);
const glintGeo = new THREE.SphereGeometry(1, 10, 8);
// Lids: hemisphere shells a little larger than the ball. The upper one covers y >= 0, the lower y <= 0.
const upperLidGeo = new THREE.SphereGeometry(1.1, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2);
const lowerLidGeo = new THREE.SphereGeometry(1.1, 22, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
const lashGeo = new THREE.ConeGeometry(0.05, 0.42, 4);
const scleraMat = new THREE.MeshStandardMaterial({ color: 0xfbfaf4, roughness: 0.22, metalness: 0 });
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x08080b, roughness: 0.15 });
const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const lashMat = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.8 });
const irisMats = new Map();
const irisMat = (color) => {
  if (!irisMats.has(color)) irisMats.set(color, new THREE.MeshStandardMaterial({ map: irisTexture(color), roughness: 0.25 }));
  return irisMats.get(color);
};

/* How open the lids sit (radians a lid is rolled back from closed). */
const UPPER_OPEN = 0.62,
  LOWER_OPEN = 0.5;

/**
 * Build one eye.
 * @param {string} id  an EYE_SPECS key
 * @param {{ lidMat: THREE.Material, stalkMat: THREE.Material, compound?: THREE.BufferGeometry, compoundMat?: THREE.Material }} mats
 * @returns {{ group: THREE.Group, setBlink(k:number): void, setGaze(yaw:number, pitch:number): void, meshes: THREE.Mesh[] }}
 */
export function buildEye(id, mats) {
  const spec = EYE_SPECS[id];
  const group = new THREE.Group();
  const meshes = [];
  let head = group;
  if (spec.stalk) {
    // A tapering stalk up from the body, with the eye on top.
    const stalkGeo = new THREE.CylinderGeometry(0.03, 0.055, spec.stalk, 10).translate(0, spec.stalk / 2, 0);
    const stalk = new THREE.Mesh(stalkGeo, mats.stalkMat);
    stalk.userData.ownGeometry = true;
    group.add(stalk);
    meshes.push(stalk);
    head = new THREE.Group();
    head.position.y = spec.stalk + spec.r * 0.6;
    group.add(head);
  }
  if (spec.compound) {
    const m = new THREE.Mesh(mats.compound, mats.compoundMat);
    m.scale.setScalar(spec.r / 0.17);
    head.add(m);
    meshes.push(m);
    return { group, meshes, setBlink() {}, setGaze() {} };
  }
  const eye = new THREE.Group();
  eye.scale.setScalar(spec.r);
  head.add(eye);
  // The ball turns to look; the highlight stays put (it is a reflection of the sky).
  const ball = new THREE.Group();
  eye.add(ball);
  const add = (geo, mat, parent) => {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    meshes.push(m);
    return m;
  };
  add(ballGeo, scleraMat, ball);
  add(irisGeo, irisMat(spec.iris), ball);
  add(pupilGeo, pupilMat, ball);
  const glint = add(glintGeo, glintMat, eye);
  glint.scale.setScalar(0.16);
  glint.position.set(0.86, 0.36, 0.3).normalize().multiplyScalar(1.04);
  const glint2 = add(glintGeo, glintMat, eye);
  glint2.scale.setScalar(0.07);
  glint2.position.set(0.95, -0.12, -0.25).normalize().multiplyScalar(1.03);
  let upper = null,
    lower = null;
  if (spec.lids) {
    upper = add(upperLidGeo, mats.lidMat, eye);
    lower = add(lowerLidGeo, mats.lidMat, eye);
    if (spec.lashes)
      for (let i = -2; i <= 2; i++) {
        const lash = new THREE.Mesh(lashGeo, lashMat);
        // On the rim of the upper lid, splayed outward.
        const a = (i / 2) * 0.9;
        lash.position.set(Math.cos(a) * 1.08, 0.05, Math.sin(a) * 1.08);
        lash.rotation.set(0, -a, -1.1);
        lash.position.y += 0.15;
        upper.add(lash);
        meshes.push(lash);
      }
  }
  let blink = 0;
  const apply = () => {
    if (!upper) return;
    // Rolled back = open; at 0 both lids meet across the middle of the eye.
    upper.rotation.z = UPPER_OPEN * (1 - blink);
    lower.rotation.z = -LOWER_OPEN * (1 - blink);
  };
  apply();
  return {
    group,
    meshes,
    /** 0 open .. 1 shut */
    setBlink(k) {
      blink = k;
      apply();
    },
    /** Turn the ball: yaw left/right (+ toward +z), pitch up/down, in radians. */
    setGaze(yaw, pitch) {
      ball.rotation.set(0, -yaw, pitch);
    },
  };
}

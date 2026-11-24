/**
 * The galaxy start screen: the game opens on its galaxy. A luminous spiral (a white-gold core, violet
 * and blue arms of stars and nebulae, dark dust lanes) that you can pan, pinch and zoom, with ten
 * starting systems in the middle and outer arms. Pick one, inspect its T3 homeworld (a turnable
 * globe), confirm, and the camera dives to the star and onto the planet before the Cell Stage begins.
 *
 * Uses the game's renderer (no second WebGL context) and is driven by the game's frame loop; dispose()
 * frees every GPU resource it made. Galaxy data (stars, starting systems, homeworlds) comes from
 * gen.js, so what you see is the universe you will play.
 */
import * as THREE from "three";
import { GALAXY_LY, STAR_KINDS, findHomeWorld, makeGalaxy, makeSystem, terraformLevel } from "./gen.js";
import { hashSeed, rng32 } from "./names.js";
import { makePlanetGlobe, planetTextures } from "./planet-tex.js";

const R = 100; // galaxy radius in world units
const TAU = Math.PI * 2;
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const COUNTS = {
  low: { arm: 15000, core: 4500, field: 2500, nebula: 230, dust: 110, sky: 1200 },
  medium: { arm: 26000, core: 7500, field: 4000, nebula: 380, dust: 170, sky: 1800 },
  high: { arm: 40000, core: 11000, field: 6000, nebula: 560, dust: 240, sky: 2600 },
};
const TYPE_NAMES = { terrestrial: "Terrestrial", jungle: "Jungle", oceanic: "Oceanic", swamp: "Wetland", tundra: "Boreal" };

/* ---- shaders ---------------------------------------------------------------------------------- */
const STAR_VS = `
attribute float size; attribute float phase; attribute vec3 color;
uniform float uTime; uniform float uScale; uniform float uBoost; uniform float uMax;
varying vec3 vColor; varying float vAlpha;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float speed = 0.9 + fract(phase * 7.13) * 2.2;
  float tw = 0.72 + 0.28 * sin(uTime * speed + phase * 6.2831);
  vAlpha = size < 0.55 ? tw : 0.92 + 0.08 * tw;
  vColor = color;
  float ps = size * uBoost * uScale / max(0.1, -mv.z);
  vAlpha *= clamp(ps / 1.6, 0.12, 1.0);
  // Stars right beside the camera fade out instead of filling the view.
  vAlpha *= smoothstep(0.6, 4.0, -mv.z);
  gl_PointSize = clamp(ps, 1.0, uMax);
  gl_Position = projectionMatrix * mv;
}`;
const STAR_FS = `
varying vec3 vColor; varying float vAlpha;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float d = dot(p, p) * 4.0;
  if (d > 1.0) discard;
  float a = exp(-d * 5.0) + 0.25 * exp(-d * 1.4);
  gl_FragColor = vec4(vColor, a * vAlpha);
}`;
const CLOUD_VS = `
attribute vec3 offset; attribute float scale; attribute vec4 tint; attribute float rot;
uniform float uFade;
varying vec2 vUv; varying vec4 vTint;
void main(){
  vUv = uv; vTint = tint;
  vec4 mv = modelViewMatrix * vec4(offset, 1.0);
  float c = cos(rot), s = sin(rot);
  mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * scale;
  // Clouds thin out as the camera comes close, so a star system is never lost in fog.
  vTint.a *= smoothstep(scale * 0.25, scale * 1.4, -mv.z) * uFade;
  gl_Position = projectionMatrix * mv;
}`;
const CLOUD_FS = `
uniform sampler2D map; varying vec2 vUv; varying vec4 vTint;
void main(){
  float a = texture2D(map, vUv).a * vTint.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vTint.rgb, a);
}`;

/* ---- textures made on the fly ------------------------------------------------------------------- */
function cloudTexture(seed) {
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  const r = rng32(seed);
  // Many soft blobs inside a round mask: a fluffy, irregular puff.
  for (let i = 0; i < 46; i++) {
    const a = r() * TAU,
      d = Math.pow(r(), 0.7) * size * 0.3;
    const x = size / 2 + Math.cos(a) * d,
      y = size / 2 + Math.sin(a) * d,
      rad = size * (0.08 + r() * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, "rgba(255,255,255,0.3)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.globalCompositeOperation = "destination-in";
  const m = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size / 2);
  m.addColorStop(0, "rgba(0,0,0,1)");
  m.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = m;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  return t;
}
function glowTexture() {
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.55)");
  g.addColorStop(0.45, "rgba(255,255,255,0.14)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}
function ringTexture() {
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.4, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.47, 0, TAU);
  ctx.stroke();
  return new THREE.CanvasTexture(cv);
}

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {number} o.seed                 the galaxy shown first (the universe in play)
 * @param {string} [o.quality]            low | medium | high
 * @param {{ species:string, stage:string, home:string|null }|null} o.save   what Continue resumes, if anything
 * @param {number|null} [o.homeStarId]    the universe in play's home star, marked on the map
 * @param {() => number} o.newSeed        a fresh galaxy for a new game when one is already in progress
 * @param {(kind:string, opts?:object) => void} [o.sfx]
 * @param {object[]} [o.species]   every saved species (main.js speciesSaves): chosen right here in the galaxy
 * @param {(id:string) => void} [o.onSwitch]  continue a species that isn't the one in play
 * @param {() => void} o.onContinue
 * @param {() => void} o.onLoad
 * @param {() => void} o.onSettings
 * @param {(choice:{seed:number, starId:number, planetId:string, star:object, planet:object}) => void} o.onBegin
 */
export function createGalaxyStart(o) {
  const renderer = o.renderer;
  const canvas = renderer.domElement;
  const counts = COUNTS[o.quality] || COUNTS.medium;
  const sfx = o.sfx || (() => {});
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02030a);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 3000);
  const ambient = new THREE.AmbientLight(0x8890b0, 0.35);
  const starLight = new THREE.PointLight(0xffffff, 0, 60, 1.2);
  scene.add(ambient, starLight);
  const time = { value: 0 };
  const scale = { value: 1 };
  const disposables = [];
  const keep = (x) => (disposables.push(x), x);
  const tex = { cloud: keep(cloudTexture(77)), glow: keep(glowTexture()), ring: keep(ringTexture()) };
  // Saved species (each its own universe and galaxy), and the ring colour of each stage.
  const speciesList = (o.species || []).map((x) => ({ ...x }));
  const STAGE_COLORS = { Cell: 0x5fc8ff, Creature: 0x6fe08a, Tribal: 0xffc35a, Civilization: 0xd59bff };

  /* ---- the galaxy's look -------------------------------------------------------------------- */
  let G = null; // the built galaxy: { seed, galaxy, group, starWorld(id), ... }
  const starMaterial = (boost = 1) =>
    new THREE.ShaderMaterial({
      uniforms: { uTime: time, uScale: scale, uBoost: { value: boost }, uMax: { value: boost > 1 ? 26 : 12 } },
      vertexShader: STAR_VS,
      fragmentShader: STAR_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  const cloudMaterial = (map, additive) =>
    new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, uFade: { value: 1 } },
      vertexShader: CLOUD_VS,
      fragmentShader: CLOUD_FS,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
  function pointsGeometry(list) {
    const n = list.length;
    const pos = new Float32Array(n * 3),
      col = new Float32Array(n * 3),
      size = new Float32Array(n),
      phase = new Float32Array(n);
    list.forEach((p, i) => {
      pos.set(p.pos, i * 3);
      col.set(p.color, i * 3);
      size[i] = p.size;
      phase[i] = p.phase;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("size", new THREE.BufferAttribute(size, 1));
    g.setAttribute("phase", new THREE.BufferAttribute(phase, 1));
    return g;
  }
  function cloudsGeometry(list) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute("position", base.getAttribute("position"));
    g.setAttribute("uv", base.getAttribute("uv"));
    const n = list.length;
    const off = new Float32Array(n * 3),
      sc = new Float32Array(n),
      tint = new Float32Array(n * 4),
      rot = new Float32Array(n);
    list.forEach((c, i) => {
      off.set(c.pos, i * 3);
      sc[i] = c.scale;
      tint.set([...c.color, c.alpha], i * 4);
      rot[i] = c.rot;
    });
    g.setAttribute("offset", new THREE.InstancedBufferAttribute(off, 3));
    g.setAttribute("scale", new THREE.InstancedBufferAttribute(sc, 1));
    g.setAttribute("tint", new THREE.InstancedBufferAttribute(tint, 4));
    g.setAttribute("rot", new THREE.InstancedBufferAttribute(rot, 1));
    g.instanceCount = n;
    return g;
  }
  const C = (hex) => {
    const c = new THREE.Color(hex);
    return [c.r, c.g, c.b];
  };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const PAL = {
    core: C("#fff1d6"),
    gold: C("#ffcf7a"),
    warm: C("#ffb070"),
    white: C("#f2f4ff"),
    blue: C("#9fb8ff"),
    violet: C("#c4a6ff"),
    pink: C("#ffb3e6"),
    nebViolet: C("#6a3cff"),
    nebIndigo: C("#3a2ad0"),
    nebBlue: C("#2f6bff"),
    nebLav: C("#b48cff"),
    nebWarm: C("#ffbf73"),
    dust: C("#07040e"),
  };

  function buildGalaxy(seed) {
    const galaxy = makeGalaxy(seed);
    const { twist, spin, arms } = galaxy.shape;
    const r = rng32(hashSeed("look", seed));
    const gauss = () => (r() + r() + r() + r() - 2) / 1.15;
    const group = new THREE.Group();
    const parts = [];
    const armAngle = (k, d) => spin + (k / arms) * TAU + d * twist;
    const toWorld = (x, z, h = 0) => [x * R, h, z * R];

    // Stars along the arms: blue-white and violet, denser inward, with a scatter of bright giants.
    const stars = [];
    for (let i = 0; i < counts.arm; i++) {
      const k = i % arms;
      const d = 0.1 + Math.pow(r(), 1.25) * 0.95;
      const spread = 0.36 * (1 - d) + 0.15;
      const a = armAngle(k, d) + gauss() * spread;
      const x = Math.cos(a) * d + gauss() * 0.035,
        z = Math.sin(a) * d + gauss() * 0.035;
      const roll = r();
      let color = roll < 0.42 ? PAL.blue : roll < 0.68 ? PAL.violet : roll < 0.84 ? PAL.white : roll < 0.93 ? PAL.gold : PAL.pink;
      if (d < 0.3) color = mix(PAL.core, color, smooth(0.1, 0.3, d));
      const bright = r() < 0.025;
      stars.push({ pos: toWorld(x, z, gauss() * (3.2 * (1 - d) + 0.8)), color, size: bright ? 1.1 + r() * 0.9 : 0.22 + r() * 0.42, phase: r() });
    }
    // The core: a dense, warm bulge.
    for (let i = 0; i < counts.core; i++) {
      const d = Math.abs(gauss()) * 0.11;
      const a = r() * TAU;
      stars.push({ pos: toWorld(Math.cos(a) * d, Math.sin(a) * d * 0.9, gauss() * 4 * (1 - d / 0.3)), color: r() < 0.5 ? PAL.core : r() < 0.6 ? PAL.gold : PAL.warm, size: 0.3 + r() * 0.6, phase: r() });
    }
    // Loose stars between the arms and in the halo.
    for (let i = 0; i < counts.field; i++) {
      const d = 0.15 + Math.sqrt(r()) * 1.05;
      const a = r() * TAU;
      stars.push({ pos: toWorld(Math.cos(a) * d, Math.sin(a) * d, gauss() * 4), color: r() < 0.5 ? PAL.white : r() < 0.5 ? PAL.gold : PAL.blue, size: 0.18 + r() * 0.3, phase: r() });
    }
    const starPoints = new THREE.Points(pointsGeometry(stars), keepLocal(starMaterial(1)));
    starPoints.renderOrder = 3;
    parts.push(starPoints);

    // Nebulae: glowing violet, indigo and blue clouds along the arms, warm ones toward the core.
    const clouds = [];
    for (let i = 0; i < counts.nebula; i++) {
      const k = i % arms;
      const d = 0.08 + Math.pow(r(), 0.85) * 0.98;
      const a = armAngle(k, d) + gauss() * (0.22 * (1 - d) + 0.08);
      const x = Math.cos(a) * d,
        z = Math.sin(a) * d;
      const pick = r();
      let color = pick < 0.34 ? PAL.nebViolet : pick < 0.6 ? PAL.nebBlue : pick < 0.82 ? PAL.nebIndigo : PAL.nebLav;
      if (d < 0.32) color = mix(PAL.nebWarm, color, smooth(0.08, 0.32, d));
      clouds.push({ pos: toWorld(x, z, gauss() * 1.5), color, alpha: (0.07 + r() * 0.09) * (d < 0.3 ? 1.3 : 1), scale: (12 + r() * 20) * (0.7 + d * 0.8), rot: r() * TAU });
    }
    // A brighter, tighter band along each arm's spine: the glowing ribbon of the arm itself.
    for (let i = 0; i < counts.nebula * 0.7; i++) {
      const k = i % arms;
      const d = 0.12 + Math.pow(r(), 0.8) * 0.9;
      const a = armAngle(k, d) + gauss() * 0.045;
      const pick = r();
      let color = pick < 0.4 ? PAL.nebLav : pick < 0.7 ? PAL.nebViolet : PAL.nebBlue;
      if (d < 0.35) color = mix(PAL.core, color, smooth(0.12, 0.35, d));
      clouds.push({ pos: toWorld(Math.cos(a) * d, Math.sin(a) * d, gauss() * 0.8), color, alpha: 0.1 + r() * 0.12, scale: 4 + r() * 7, rot: r() * TAU });
    }
    // The core's glow: layered warm-white light, the brightest thing in the sky.
    clouds.push({ pos: [0, 0, 0], color: PAL.core, alpha: 1, scale: 46, rot: 0 }, { pos: [0, 0, 0], color: PAL.gold, alpha: 0.6, scale: 90, rot: 0 }, { pos: [0, 0, 0], color: PAL.warm, alpha: 0.28, scale: 130, rot: 0 }, { pos: [0, 0, 0], color: C("#9a6cff"), alpha: 0.12, scale: 230, rot: 0 });
    const nebMat = keepLocal(cloudMaterial(tex.cloud, true));
    const glowMat = keepLocal(cloudMaterial(tex.glow, true));
    const nebula = new THREE.Mesh(cloudsGeometry(clouds.slice(0, -4)), nebMat);
    nebula.frustumCulled = false;
    nebula.renderOrder = 1;
    const coreGlow = new THREE.Mesh(cloudsGeometry(clouds.slice(-4)), glowMat);
    coreGlow.frustumCulled = false;
    coreGlow.renderOrder = 4;
    parts.push(nebula, coreGlow);

    // Dust: dark lanes on the inner edge of each arm, the gaps that make the spiral read.
    const dust = [];
    for (let i = 0; i < counts.dust; i++) {
      const k = i % arms;
      const d = 0.14 + Math.pow(r(), 0.9) * 0.75;
      const a = armAngle(k, d) - 0.3 + gauss() * 0.06;
      dust.push({ pos: toWorld(Math.cos(a) * d, Math.sin(a) * d, gauss() * 0.6), color: PAL.dust, alpha: 0.22 + r() * 0.2, scale: 6 + r() * 9, rot: r() * TAU });
    }
    const dustMat = keepLocal(cloudMaterial(tex.cloud, false));
    const dustMesh = new THREE.Mesh(cloudsGeometry(dust), dustMat);
    dustMesh.frustumCulled = false;
    dustMesh.renderOrder = 2;
    parts.push(dustMesh);

    // The real stars: every one of them a system you can visit later. Starting systems stand out a little.
    const real = [],
      starts = [];
    const heightOf = (s) => (((hashSeed("h", s.id) % 1000) / 1000) - 0.5) * 2.4;
    for (const s of galaxy.stars) {
      const kind = STAR_KINDS[s.kind];
      const p = { pos: toWorld(s.x, s.y, heightOf(s)), color: C(kind.color), size: (0.55 + s.mag * 0.4) * kind.size, phase: (s.id * 0.618) % 1 };
      (s.start ? starts : real).push(p);
    }
    const realPoints = new THREE.Points(pointsGeometry(real), keepLocal(starMaterial(1)));
    realPoints.renderOrder = 5;
    const startMat = keepLocal(starMaterial(1.9));
    const startPoints = new THREE.Points(pointsGeometry(starts.map((p) => ({ ...p, size: 1.1 }))), startMat);
    startPoints.renderOrder = 6;
    parts.push(realPoints, startPoints);

    // A faint halo ring around each starting system: easy to find, never loud.
    const halos = galaxy.starts.map((id) => {
      const s = galaxy.stars[id];
      const sp = new THREE.Sprite(keepLocal(new THREE.SpriteMaterial({ map: tex.ring, color: new THREE.Color(STAR_KINDS[s.kind].color), transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending })));
      sp.position.set(...toWorld(s.x, s.y, heightOf(s)));
      sp.renderOrder = 7;
      sp.userData.starId = id;
      return sp;
    });
    parts.push(...halos);
    // The home star of the universe in play, if any, wears a gold ring.
    let homeMark = null;
    if (o.homeStarId != null && galaxy.stars[o.homeStarId] && seed === o.seed && !speciesList.some((x) => x.active && x.stage !== "New")) {
      const s = galaxy.stars[o.homeStarId];
      homeMark = new THREE.Sprite(keepLocal(new THREE.SpriteMaterial({ map: tex.ring, color: 0xffd36a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending })));
      homeMark.position.set(...toWorld(s.x, s.y, heightOf(s)));
      parts.push(homeMark);
    }
    // Every saved species living in this galaxy marks its home star: a ring in its stage's colour.
    const speciesMarks = [];
    for (const sp of speciesList) {
      if (sp.seed !== seed || sp.stage === "New") continue;
      let starId = sp.homeStarId;
      if (starId == null || !galaxy.stars[starId]) starId = (findHomeWorld(galaxy) || {}).starId;
      const s = galaxy.stars[starId];
      if (!s) continue;
      sp.starId = starId;
      const m = new THREE.Sprite(keepLocal(new THREE.SpriteMaterial({ map: tex.ring, color: STAGE_COLORS[sp.stage] || 0xffd36a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })));
      m.position.set(...toWorld(s.x, s.y, heightOf(s)));
      m.renderOrder = 8;
      m.userData = { speciesId: sp.id, starId };
      speciesMarks.push(m);
      parts.push(m);
    }
    group.add(...parts);
    scene.add(group);
    return {
      seed,
      galaxy,
      group,
      halos,
      homeMark,
      speciesMarks,
      startMat,
      nebMat,
      glowMat,
      dustMat,
      local: localDisposables.splice(0),
      geos: parts.filter((p) => p.geometry && !p.isSprite).map((p) => p.geometry),
      local3: (s) => new THREE.Vector3(...toWorld(s.x, s.y, heightOf(s))),
    };
  }
  const localDisposables = [];
  function keepLocal(x) {
    localDisposables.push(x);
    return x;
  }
  function disposeGalaxy() {
    if (!G) return;
    scene.remove(G.group);
    G.geos.forEach((g) => g.dispose());
    G.local.forEach((m) => m.dispose());
    G = null;
  }

  // Distant stars all around, fixed in the sky (they don't turn with the galaxy).
  {
    const r = rng32(991);
    const sky = [];
    for (let i = 0; i < counts.sky; i++) {
      const v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize().multiplyScalar(1400);
      sky.push({ pos: [v.x, v.y, v.z], color: r() < 0.7 ? PAL.white : r() < 0.5 ? PAL.blue : PAL.gold, size: 2 + r() * 4, phase: r() });
    }
    const pts = new THREE.Points(keep(pointsGeometry(sky)), keep(starMaterial(1)));
    scene.add(pts);
  }

  /* ---- camera rig ---------------------------------------------------------------------------- */
  const wideDist = () => (innerWidth > innerHeight ? 185 : 260);
  const cam = { tx: 0, tz: 18, dist: wideDist(), yaw: 0.35, goal: { tx: 0, tz: 18, dist: wideDist() }, fly: 0 };
  const pitchFor = (d) => 0.46 + 0.3 * smooth(8, 260, d);
  let turning = 1;
  let viewLift = 0; // the galaxy's slow spin, eased off while a system is open
  function placeCamera(dt) {
    if (!cinema) {
      const k = 1 - Math.exp(-dt * (cam.fly > 0 ? 3.2 : 9));
      cam.fly = Math.max(0, cam.fly - dt);
      cam.tx += (cam.goal.tx - cam.tx) * k;
      cam.tz += (cam.goal.tz - cam.tz) * k;
      cam.dist += (cam.goal.dist - cam.dist) * k;
    }
    const pitch = cam.pitch ?? pitchFor(cam.dist);
    camera.position.set(cam.tx + Math.sin(cam.yaw) * Math.cos(pitch) * cam.dist, (cam.ty || 0) + Math.sin(pitch) * cam.dist, cam.tz + Math.cos(cam.yaw) * Math.cos(pitch) * cam.dist);
    camera.lookAt(cam.tx, cam.ty || 0, cam.tz);
  }
  function clampGoal() {
    const d = Math.hypot(cam.goal.tx, cam.goal.tz);
    if (d > R * 1.15) {
      cam.goal.tx *= (R * 1.15) / d;
      cam.goal.tz *= (R * 1.15) / d;
    }
    cam.goal.dist = Math.max(6, Math.min(320, cam.goal.dist));
  }
  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    scale.value = (innerHeight * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }
  resize();

  /* ---- DOM ------------------------------------------------------------------------------------ */
  const el = document.createElement("div");
  el.className = "gs";
  el.innerHTML = `
    <div class="gsLogo" aria-hidden="true"><b>JOHNNY</b><span>SPORE</span></div>
    <h1 class="srOnly">Johnny Spore: choose where life begins</h1>
    <button class="gsGear" id="gsSettings" aria-label="Settings">⚙</button>
    <nav class="gsMenu" id="gsMenu" aria-label="Main menu">
      <div class="gsSave" id="gsSave" hidden></div>
      <button class="gsBtn primary" id="gsContinue" hidden>Continue</button>
      <button class="gsBtn" id="gsNew">New Species</button>
      <button class="gsBtn gsSmall" id="gsLoad">Manage universes</button>
    </nav>
    <section class="gsSpecies" id="gsSpecies" aria-label="Your species" hidden>
      <h2>Your species</h2>
      <div class="gsSpList" id="gsSpList" role="list"></div>
    </section>
    <div class="gsChoose" id="gsChoose" hidden>
      <p class="gsHint" id="gsHint" role="status" aria-live="polite">Choose a star where life will begin</p>
      <div class="gsCycle" role="group" aria-label="Starting systems">
        <button class="gsRound" id="gsPrev" aria-label="Previous starting system">◀</button>
        <span id="gsCount">10 starting systems</span>
        <button class="gsRound" id="gsNext" aria-label="Next starting system">▶</button>
      </div>
    </div>
    <button class="gsRound gsBack" id="gsBack" aria-label="Back to the menu" hidden>✕</button>
    <div class="gsZoom" role="group" aria-label="Zoom">
      <button class="gsRound" id="gsIn" aria-label="Zoom in">+</button>
      <button class="gsRound" id="gsOut" aria-label="Zoom out">−</button>
      <button class="gsRound" id="gsAll" aria-label="Show the whole galaxy">⤢</button>
    </div>
    <section class="gsPanel" id="gsPanel" hidden aria-live="polite"></section>
    <div class="gsModal" id="gsConfirm" hidden></div>
    <div class="gsToast" id="gsToast" role="status" aria-live="polite"></div>
    <div class="gsFade" id="gsFade"><p id="gsFadeName"></p></div>`;
  document.body.appendChild(el);
  const $ = (q) => el.querySelector(q);
  let toastT = 0;
  function toast(text, s = 3.2) {
    $("#gsToast").textContent = text;
    $("#gsToast").classList.add("show");
    toastT = s;
  }
  if (o.save) {
    $("#gsContinue").hidden = false;
    $("#gsSave").hidden = false;
    $("#gsSave").innerHTML = `<b>${esc(o.save.species)}</b><span>${esc(o.save.stage)}${o.save.home ? " · " + esc(o.save.home) : ""}</span>`;
  }

  /* ---- saved species, chosen in the galaxy -------------------------------------------------------- */
  const evolved = speciesList.filter((x) => x.stage !== "New");
  const STAGE_ICON = { Cell: "◉", Creature: "🦎", Tribal: "⛺", Civilization: "🏛" };
  const ago = (t) => {
    if (!t) return "";
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 2) return "just now";
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + " h ago";
    const d = Math.round(h / 24);
    return d < 30 ? d + " day" + (d === 1 ? "" : "s") + " ago" : new Date(t).toLocaleDateString();
  };
  const hours = (s) => (s >= 3600 ? Math.floor(s / 3600) + " h " + Math.round((s % 3600) / 60) + " min" : Math.max(1, Math.round(s / 60)) + " min");
  function renderSpeciesStrip() {
    const box = $("#gsSpList");
    box.innerHTML =
      evolved
        .map(
          (x) => `<button class="gsSp${x.active ? " active" : ""}${chosenSpecies?.id === x.id ? " sel" : ""}" role="listitem" data-sp="${esc(x.id)}" style="--sc:#${(STAGE_COLORS[x.stage] || 0xffd36a).toString(16).padStart(6, "0")}" aria-label="${esc(x.species)}, ${esc(x.stage)} Stage">
            <span class="gsSpPic">${x.thumb ? `<img src="${x.thumb}" alt="">` : `<i aria-hidden="true">${STAGE_ICON[x.stage] || "✦"}</i>`}</span>
            <b>${esc(x.species)}</b><small>${STAGE_ICON[x.stage] || ""} ${esc(x.stage)}</small></button>`,
        )
        .join("") + `<button class="gsSp gsSpNew" role="listitem" id="gsSpNew" aria-label="Start a new species"><span class="gsSpPic"><i aria-hidden="true">＋</i></span><b>New species</b><small>Choose a star</small></button>`;
    box.querySelectorAll("[data-sp]").forEach((b) => (b.onclick = () => chooseSpecies(b.dataset.sp)));
    $("#gsSpNew").onclick = () => $("#gsNew").click();
  }
  let chosenSpecies = null;
  /** Fly to a species' home star (switching galaxy if it lives in another) and show what it has become. */
  function chooseSpecies(id) {
    const sp = speciesList.find((x) => x.id === id);
    if (!sp || cinema) return;
    sfx("click");
    if (selected) deselect();
    if (G.seed !== sp.seed) rebuild(sp.seed);
    chosenSpecies = sp;
    setMode("species");
    const star = sp.starId != null ? G.galaxy.stars[sp.starId] : null;
    if (star) {
      const at = starWorld(star);
      cam.goal = { tx: at.x, tz: at.z, dist: 26 };
      cam.ty = 0;
      cam.fly = 2;
      turning = 0.2;
    }
    renderSpeciesPanel(sp, star);
    renderSpeciesStrip();
  }
  function renderSpeciesPanel(sp, star) {
    const p = $("#gsPanel");
    p.hidden = false;
    p.classList.add("species");
    const pct = Math.round(Math.max(0, Math.min(1, sp.progress || 0)) * 100);
    p.innerHTML = `
      <div class="gsHead">
        <div class="gsSpBig" style="--sc:#${(STAGE_COLORS[sp.stage] || 0xffd36a).toString(16).padStart(6, "0")}">${sp.thumb ? `<img src="${sp.thumb}" alt="">` : `<i aria-hidden="true">${STAGE_ICON[sp.stage] || "✦"}</i>`}</div>
        <div><small>${sp.active ? "PLAYING NOW" : "SAVED SPECIES"}</small><h2>${esc(sp.species)}</h2>
        <p>${STAGE_ICON[sp.stage] || ""} ${esc(sp.stage)} Stage · ${esc(sp.detail || "")}</p></div>
        <button class="gsRound" id="gsClose" aria-label="Back to the galaxy">✕</button>
      </div>
      <div class="gsProg" role="img" aria-label="Evolution ${pct}% of the way to the stars"><i style="width:${pct}%"></i><span>Cell</span><span>Creature</span><span>Tribal</span><span>Civ</span></div>
      ${sp.tags?.length ? `<div class="gsTags">${sp.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
      <dl class="gsSpFacts">
        ${sp.home ? `<div><dt>Homeworld</dt><dd>${esc(sp.home.planet)} · ${esc(sp.home.star)}</dd></div>` : star ? `<div><dt>Home star</dt><dd>${esc(star.name)}</dd></div>` : ""}
        <div><dt>Universe</dt><dd>${esc(sp.universe)}</dd></div>
        ${sp.lastPlayed ? `<div><dt>Last played</dt><dd>${ago(sp.lastPlayed)}</dd></div>` : ""}
        ${sp.playtime > 30 ? `<div><dt>Played</dt><dd>${hours(sp.playtime)}</dd></div>` : ""}
      </dl>
      <div class="gsBtns"><button class="gsBtn primary" id="gsSpGo">Continue ${esc(sp.species)}</button></div>`;
    $("#gsClose").onclick = () => setMode("title");
    $("#gsSpGo").onclick = () => {
      $("#gsSpGo").disabled = true;
      $("#gsSpGo").textContent = "Loading…";
      if (sp.active) o.onContinue();
      else o.onSwitch?.(sp.id);
    };
    $("#gsSpGo").focus({ preventScroll: true });
  }
  function leaveSpecies() {
    if (!chosenSpecies) return;
    chosenSpecies = null;
    const p = $("#gsPanel");
    p.classList.remove("species");
    p.hidden = true;
    cam.goal = { tx: cam.goal.tx * 0.5, tz: cam.goal.tz * 0.5, dist: wideDist() };
    cam.fly = 2;
    turning = 1;
    renderSpeciesStrip();
  }

  /* ---- modes and selection ------------------------------------------------------------------------ */
  let mode = "title"; // title | choose | species
  let selected = null; // { star, planet, system, index }
  let sys = null; // the open system's 3D bits
  let cinema = null;
  const startIndex = (id) => G.galaxy.starts.indexOf(id);
  function setMode(m) {
    mode = m;
    $("#gsMenu").hidden = m !== "title";
    $("#gsChoose").hidden = m !== "choose";
    $("#gsSpecies").hidden = !(m === "title" || m === "species") || !evolved.length;
    $("#gsBack").hidden = m === "title";
    $("#gsCount").textContent = G.galaxy.starts.length + " starting systems";
    el.classList.toggle("spMode", m === "species");
    if (m !== "species") leaveSpecies();
    if (m === "title") deselect();
  }
  function starWorld(star) {
    G.group.updateMatrixWorld(true);
    return G.local3(star).applyMatrix4(G.group.matrixWorld);
  }
  function select(starId) {
    const star = G.galaxy.stars[starId];
    if (!star?.start) return;
    $("#gsPanel").classList.remove("species");
    if (mode !== "choose") setMode("choose");
    clearSystem();
    const system = makeSystem(G.seed, star);
    const planet = system.planets.find((p) => p.homeworld);
    selected = { star, planet, system, index: startIndex(starId) };
    const at = starWorld(star);
    cam.goal = { tx: at.x, tz: at.z, dist: 9 };
    cam.ty = 0;
    cam.fly = 2;
    turning = 0;
    openSystem(at, star, planet);
    renderPanel();
    sfx("click");
    $("#gsHint").textContent = `${star.name}: a T3 world awaits`;
  }
  function deselect() {
    if (!selected) return;
    selected = null;
    clearSystem();
    $("#gsPanel").hidden = true;
    $("#gsConfirm").hidden = true;
    cam.goal = { tx: cam.goal.tx * 0.5, tz: cam.goal.tz * 0.5, dist: 170 };
    cam.fly = 2;
    turning = 1;
    $("#gsHint").textContent = "Choose a star where life will begin";
  }

  /* ---- an open star system: the star, its light, the T3 world on its orbit ------------------------- */
  let textures = null;
  function openSystem(at, star, planet) {
    const color = new THREE.Color(STAR_KINDS[star.kind].color);
    const glowMat = new THREE.SpriteMaterial({ map: tex.glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const glow = new THREE.Sprite(glowMat);
    glow.position.copy(at);
    glow.scale.setScalar(2.4 * STAR_KINDS[star.kind].size);
    const coreMat = new THREE.SpriteMaterial({ map: tex.glow, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const core = new THREE.Sprite(coreMat);
    core.position.copy(at);
    core.scale.setScalar(0.9 * STAR_KINDS[star.kind].size);
    starLight.position.copy(at);
    starLight.color.copy(color).lerp(new THREE.Color(0xffffff), 0.5);
    starLight.intensity = 60;
    textures = planetTextures(planet, o.quality === "low" ? 192 : 256);
    const globe = makePlanetGlobe(planet, { radius: 0.32, textures });
    const orbitR = 2.1;
    const orbitGeo = new THREE.RingGeometry(orbitR - 0.012, orbitR + 0.012, 96).rotateX(-Math.PI / 2);
    const orbitMat = new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const orbit = new THREE.Mesh(orbitGeo, orbitMat);
    orbit.position.copy(at);
    // Other planets of the system, as small dim dots on their own orbits.
    scene.add(glow, core, orbit, globe.group);
    // The planet starts on the camera's side of the star, a little off-centre, so it shows its day side.
    sys = { at, glow, core, glowMat, coreMat, globe, orbit, orbitGeo, orbitMat, orbitR, angle: Math.PI / 2 - (cam.yaw + 0.75), preview: makePreview(planet) };
    placePlanet(0);
  }
  function placePlanet(dt) {
    if (!sys) return;
    sys.angle += dt * 0.05;
    sys.globe.group.position.set(sys.at.x + Math.cos(sys.angle) * sys.orbitR, sys.at.y, sys.at.z + Math.sin(sys.angle) * sys.orbitR);
    sys.globe.update(dt);
  }
  function clearSystem() {
    if (!sys) return;
    [sys.glow, sys.core, sys.orbit].forEach((m) => scene.remove(m));
    sys.glowMat.dispose();
    sys.coreMat.dispose();
    sys.orbitGeo.dispose();
    sys.orbitMat.dispose();
    sys.globe.dispose();
    sys.preview.dispose();
    textures?.surface.dispose();
    textures?.clouds.dispose();
    textures = null;
    starLight.intensity = 0;
    sys = null;
  }

  /* ---- the planet preview: its own little scene, drawn into the panel's canvas ---------------------- */
  function makePreview(planet) {
    const size = 256;
    const target = new THREE.WebGLRenderTarget(size, size);
    const pScene = new THREE.Scene();
    const pCam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    pCam.position.set(0, 0, 4.4);
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-3, 1.5, 3);
    pScene.add(key, new THREE.AmbientLight(0x9aa8c8, 0.45));
    const globe = makePlanetGlobe(planet, { radius: 1, textures });
    globe.group.rotation.x = 0.35;
    pScene.add(globe.group);
    const pixels = new Uint8Array(size * size * 4);
    let ctx = null,
      img = null,
      spin = 0.25;
    const drag = { on: false, x: 0, y: 0 };
    return {
      bind(cv) {
        ctx = cv.getContext("2d");
        img = ctx.createImageData(size, size);
        cv.onpointerdown = (e) => {
          drag.on = true;
          drag.x = e.clientX;
          drag.y = e.clientY;
          cv.setPointerCapture?.(e.pointerId);
          e.stopPropagation();
        };
        cv.onpointermove = (e) => {
          if (!drag.on) return;
          globe.globe.rotation.y += (e.clientX - drag.x) * 0.012;
          globe.cloud.rotation.y += (e.clientX - drag.x) * 0.012;
          globe.group.rotation.x = Math.max(-1, Math.min(1, globe.group.rotation.x + (e.clientY - drag.y) * 0.008));
          drag.x = e.clientX;
          drag.y = e.clientY;
          spin = 0;
        };
        cv.onpointerup = cv.onpointercancel = () => {
          drag.on = false;
          setTimeout(() => (spin = 0.25), 2500);
        };
        cv.onkeydown = (e) => {
          const step = { ArrowLeft: -0.2, ArrowRight: 0.2 }[e.key];
          if (step) {
            globe.globe.rotation.y += step;
            e.preventDefault();
          }
        };
      },
      draw(dt) {
        if (!ctx) return;
        globe.globe.rotation.y += dt * spin;
        globe.cloud.rotation.y += dt * (spin + 0.04);
        const prev = renderer.getRenderTarget();
        const clear = renderer.getClearColor(new THREE.Color()),
          alpha = renderer.getClearAlpha();
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(pScene, pCam);
        renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
        renderer.setRenderTarget(prev);
        renderer.setClearColor(clear, alpha);
        for (let y = 0; y < size; y++) img.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
        ctx.putImageData(img, 0, 0);
      },
      dispose() {
        globe.dispose();
        target.dispose();
        key.dispose?.();
      },
    };
  }

  /* ---- panel and confirmation -------------------------------------------------------------------- */
  const ly = (s) => Math.round(Math.hypot(s.x, s.y) * GALAXY_LY).toLocaleString("en");
  function renderPanel() {
    const { star, planet, index } = selected;
    const kind = STAR_KINDS[star.kind];
    const t = terraformLevel(planet);
    const p = $("#gsPanel");
    p.hidden = false;
    p.innerHTML = `
      <div class="gsHead">
        <div><small>Starting system ${index + 1} of ${G.galaxy.starts.length}</small><h2>${esc(star.name)}</h2>
        <p><i class="gsDot" style="background:${kind.color}"></i>${kind.name} · ${esc(star.sector)} · ${ly(star)} light years from the core</p></div>
        <button class="gsRound" id="gsClose" aria-label="Back to the galaxy">✕</button>
      </div>
      <div class="gsWorld">
        <canvas class="gsPreview" width="256" height="256" tabindex="0" role="img" aria-label="${esc(planet.name)}, turning. Drag it, or use the arrow keys, to turn it."></canvas>
        <div class="gsFacts">
          <span class="gsT" title="Terraforming level">T${t}</span>
          <h3>${esc(planet.name)}</h3>
          <dl>
            <div><dt>Type</dt><dd>${TYPE_NAMES[planet.type] || planet.type}</dd></div>
            <div><dt>Climate</dt><dd>${esc(planet.climate || "Temperate")} · ${planet.temp} °C</dd></div>
            <div><dt>Atmosphere</dt><dd>${esc(planet.atmosphere)}</dd></div>
            <div><dt>Moons</dt><dd>${planet.moons || "None"}</dd></div>
            <div><dt>Oceans</dt><dd>${Math.round(planet.water * 100)}% of the surface</dd></div>
            <div><dt>Life</dt><dd>${planet.biodiversity > 0.8 ? "Teeming" : "Rich"} · stable ecosystem</dd></div>
          </dl>
        </div>
      </div>
      <p class="gsDesc">${esc(planet.description || "")}</p>
      <div class="gsBtns"><button class="gsBtn primary" id="gsPick">Begin life on ${esc(planet.name)}</button><button class="gsBtn" id="gsOther">Look at another star</button></div>`;
    sys.preview.bind(p.querySelector(".gsPreview"));
    $("#gsClose").onclick = deselect;
    $("#gsOther").onclick = () => cycle(1);
    $("#gsPick").onclick = openConfirm;
  }
  function openConfirm() {
    const { star, planet } = selected;
    const m = $("#gsConfirm");
    m.hidden = false;
    m.innerHTML = `<div class="gsCard" role="dialog" aria-modal="true" aria-labelledby="gsConfTitle">
      <small>NEW CIVILIZATION</small>
      <h2 id="gsConfTitle">Begin evolution?</h2>
      <dl><div><dt>Star</dt><dd>${esc(star.name)}</dd></div><div><dt>Homeworld</dt><dd>${esc(planet.name)}</dd></div><div><dt>Terraforming</dt><dd><span class="gsT">T3</span></dd></div></dl>
      <p>Your species' whole history starts here: a new universe is created and saved${o.save ? ". Your current game stays safe in Load Game" : ""}.</p>
      <div class="gsBtns"><button class="gsBtn primary" id="gsGo">Begin Evolution</button><button class="gsBtn" id="gsNo">Not yet</button></div></div>`;
    $("#gsGo").focus();
    $("#gsNo").onclick = () => {
      m.hidden = true;
      $("#gsPick")?.focus();
    };
    $("#gsGo").onclick = begin;
  }

  /* ---- the dive into the homeworld ---------------------------------------------------------------- */
  function begin() {
    if (cinema) return;
    $("#gsConfirm").hidden = true;
    $("#gsPanel").hidden = true;
    $("#gsChoose").hidden = true;
    $("#gsBack").hidden = true;
    el.classList.add("cinema");
    sfx("hatch");
    const p0 = camera.position.clone();
    cinema = { t: 0, p0, look0: new THREE.Vector3(cam.tx, cam.ty || 0, cam.tz), done: false };
    $("#gsFade").style.background = textures?.seaColor || "#0b1f3a";
    $("#gsFadeName").innerHTML = `<small>HOMEWORLD</small>${esc(selected.planet.name)}`;
  }
  function updateCinema(dt) {
    const c = cinema;
    c.t += dt;
    const star = sys.at;
    const planet = sys.globe.group.position;
    sys.angle -= dt * 0.05; // hold the planet still while we fly to it
    // 0–1.6 s: in to the star, which flares. 1.4–3.4 s: across to the planet until it fills the view.
    const a = ease(Math.min(1, c.t / 1.6));
    const b = ease(Math.max(0, Math.min(1, (c.t - 1.4) / 2)));
    const starView = new THREE.Vector3(star.x + 2.6, star.y + 1.4, star.z + 3.4);
    const toPlanet = new THREE.Vector3().subVectors(planet, star).normalize();
    const planetView = planet.clone().addScaledVector(toPlanet, -0.75).add(new THREE.Vector3(0, 0.12, 0));
    const pos = c.p0.clone().lerp(starView, a).lerp(planetView, b);
    const look = c.look0.clone().lerp(star, a).lerp(planet, b);
    camera.position.copy(pos);
    camera.lookAt(look);
    sys.glow.scale.setScalar(2.4 * (1 + 1.8 * Math.sin(Math.min(1, c.t / 1.9) * Math.PI)));
    sys.core.scale.setScalar(0.9 * (1 + 1.2 * Math.sin(Math.min(1, c.t / 1.9) * Math.PI)));
    const fade = Math.max(0, Math.min(1, (c.t - 3.1) / 0.7));
    const f = $("#gsFade");
    f.style.opacity = String(fade);
    if (c.t > 2.6) $("#gsFadeName").classList.add("show");
    if (c.t > 4 && !c.done) {
      c.done = true;
      o.onBegin({ seed: G.seed, starId: selected.star.id, planetId: selected.planet.id, star: selected.star, planet: selected.planet });
    }
  }

  /* ---- input ----------------------------------------------------------------------------------------- */
  const pointers = new Map();
  let gesture = null;
  const wpp = () => (2 * cam.dist * Math.tan((camera.fov * Math.PI) / 360)) / innerHeight;
  const onDown = (e) => {
    if (cinema || e.target !== canvas) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (pointers.size === 1) gesture = { moved: false, button: e.button };
    else if (pointers.size === 2 && gesture) {
      const [a, b] = [...pointers.values()];
      gesture.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.angle = Math.atan2(b.y - a.y, b.x - a.x);
      gesture.moved = true;
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* gone */
    }
  };
  const onMove = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || !gesture) return;
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y),
        ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (gesture.pinch) cam.goal.dist *= gesture.pinch / Math.max(10, d);
      if (gesture.angle != null) cam.yaw -= ang - gesture.angle;
      gesture.pinch = d;
      gesture.angle = ang;
      clampGoal();
      cam.dist = cam.goal.dist;
      return;
    }
    if (!gesture.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 8) return;
    gesture.moved = true;
    if (gesture.button === 2 || e.shiftKey) {
      cam.yaw -= dx * 0.006;
      return;
    }
    const k = wpp();
    const pitch = pitchFor(cam.dist);
    const rx = Math.cos(cam.yaw),
      rz = -Math.sin(cam.yaw);
    const fx = -Math.sin(cam.yaw),
      fz = -Math.cos(cam.yaw);
    cam.goal.tx -= rx * dx * k - (fx * dy * k) / Math.max(0.4, Math.sin(pitch));
    cam.goal.tz -= rz * dx * k - (fz * dy * k) / Math.max(0.4, Math.sin(pitch));
    clampGoal();
    cam.tx = cam.goal.tx;
    cam.tz = cam.goal.tz;
  };
  const onUp = (e) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (!p || !gesture) return;
    if (!pointers.size) {
      if (!gesture.moved && e.type === "pointerup") tap(e.clientX, e.clientY);
      gesture = null;
    }
  };
  const onWheel = (e) => {
    if (cinema || e.target !== canvas) return;
    e.preventDefault();
    cam.goal.dist *= Math.exp(e.deltaY * 0.0012);
    clampGoal();
  };
  const onKey = (e) => {
    if (cinema || e.target?.tagName === "INPUT") return;
    if (e.key === "Escape") {
      if (!$("#gsConfirm").hidden) $("#gsConfirm").hidden = true;
      else if (selected) deselect();
      else if (mode === "choose" || mode === "species") setMode("title");
      return;
    }
    if (e.target !== document.body && e.target !== canvas) return;
    const step = cam.dist * 0.08;
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (moves[e.key]) {
      const [mx, mz] = moves[e.key];
      cam.goal.tx += (Math.cos(cam.yaw) * mx + Math.sin(cam.yaw) * mz) * step;
      cam.goal.tz += (-Math.sin(cam.yaw) * mx + Math.cos(cam.yaw) * mz) * step;
      clampGoal();
      e.preventDefault();
    } else if (e.key === "+" || e.key === "=") (cam.goal.dist *= 0.8), clampGoal();
    else if (e.key === "-") (cam.goal.dist *= 1.25), clampGoal();
  };
  const onContext = (e) => e.target === canvas && e.preventDefault();
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKey);
  window.addEventListener("contextmenu", onContext);

  const v = new THREE.Vector3();
  const screenOf = (world) => {
    v.copy(world).project(camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, on: v.z > -1 && v.z < 1 };
  };
  /** Starting systems win taps within a generous radius; other stars answer with what they are. */
  function pick(sx, sy) {
    G.group.updateMatrixWorld(true);
    let best = null,
      bd = 46;
    for (const id of G.galaxy.starts) {
      const p = screenOf(starWorld(G.galaxy.stars[id]));
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (p.on && d < bd) (bd = d), (best = { start: true, id });
    }
    if (best) return best;
    bd = 20;
    for (const s of G.galaxy.stars) {
      const p = screenOf(G.local3(s).applyMatrix4(G.group.matrixWorld));
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (p.on && d < bd) (bd = d), (best = { start: false, id: s.id });
    }
    return best;
  }
  const ray = new THREE.Raycaster();
  function tap(sx, sy) {
    // A saved species' home star: choose that species.
    if (mode !== "choose" && G.speciesMarks.length) {
      G.group.updateMatrixWorld(true);
      let hit = null,
        bd = 40;
      for (const m of G.speciesMarks) {
        const p = screenOf(m.position.clone().applyMatrix4(G.group.matrixWorld));
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (p.on && d < bd) (bd = d), (hit = m);
      }
      if (hit) return chooseSpecies(hit.userData.speciesId);
    }
    if (selected && !$("#gsPanel").hidden && sys) {
      // In a system: a tap elsewhere goes back out to the galaxy, unless it's on another starting star.
      const hit = pick(sx, sy);
      if (hit?.start && hit.id !== selected.star.id) return select(hit.id);
      return;
    }
    const hit = pick(sx, sy);
    if (hit?.start) return select(hit.id);
    if (hit) {
      const s = G.galaxy.stars[hit.id];
      return toast(`${s.name} · ${STAR_KINDS[s.kind].name}. ${G.galaxy.core.systems.includes(s.id) ? "Deep in the core: no one starts here." : "Not a starting system: no world there is ready for life yet."}`);
    }
    // The core itself.
    ray.setFromCamera(new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1), camera);
    const g = new THREE.Vector3();
    if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), g) && Math.hypot(g.x, g.z) < G.galaxy.core.radius * R) toast("The galactic core: unexplored. Long-range scans return only static, and something old seems to listen.", 4.5);
  }
  function cycle(dir) {
    const list = G.galaxy.starts;
    const i = selected ? list.indexOf(selected.star.id) : dir > 0 ? -1 : 0;
    select(list[(i + dir + list.length) % list.length]);
  }

  /* ---- buttons --------------------------------------------------------------------------------------- */
  $("#gsContinue").onclick = () => o.onContinue();
  $("#gsLoad").onclick = () => o.onLoad();
  $("#gsSettings").onclick = () => o.onSettings();
  $("#gsNew").onclick = () => {
    // A game in progress keeps its galaxy: a new species gets a galaxy (a universe) of its own, so
    // no existing species is ever overwritten.
    if (evolved.some((x) => x.seed === G.seed) || (o.save && G.seed === o.seed)) rebuild(o.newSeed());
    setMode("choose");
    cam.goal = { tx: 0, tz: 6, dist: 230 };
    cam.fly = 1.5;
    toast("Ten stars in the outer arms have worlds ready for life. Tap one, or use ◀ ▶.", 4.5);
  };
  $("#gsBack").onclick = () => {
    if (selected) deselect();
    else setMode("title");
  };
  renderSpeciesStrip();
  $("#gsPrev").onclick = () => cycle(-1);
  $("#gsNext").onclick = () => cycle(1);
  $("#gsIn").onclick = () => ((cam.goal.dist *= 0.65), clampGoal());
  $("#gsOut").onclick = () => ((cam.goal.dist *= 1.5), clampGoal());
  $("#gsAll").onclick = () => {
    if (selected) deselect();
    cam.goal = { tx: 0, tz: 18, dist: wideDist() };
    cam.fly = 1.5;
  };
  function rebuild(seed) {
    deselect();
    disposeGalaxy();
    G = buildGalaxy(seed);
  }

  /* ---- start ----------------------------------------------------------------------------------------- */
  G = buildGalaxy(o.seed);
  setMode("title");
  requestAnimationFrame(() => el.classList.add("show"));

  return {
    get mode() {
      return mode;
    },
    resize,
    toast,
    update(dt) {
      time.value += dt;
      if (toastT > 0 && (toastT -= dt) <= 0) $("#gsToast").classList.remove("show");
      // The galaxy turns, very slowly.
      if (!cinema) G.group.rotation.y += dt * 0.006 * turning;
      // Clouds give way as you zoom into a cluster or a system.
      const fade = smooth(5, 70, cam.dist);
      G.nebMat.uniforms.uFade.value = 0.25 + 0.75 * fade;
      G.dustMat.uniforms.uFade.value = 0.2 + 0.8 * fade;
      G.glowMat.uniforms.uFade.value = 1;
      G.startMat.uniforms.uBoost.value = mode === "choose" ? 2.1 + 0.35 * Math.sin(time.value * 2.4) : 1.7;
      for (const h of G.halos) {
        const s = h.position.distanceTo(camera.position) * 0.028;
        h.scale.setScalar(s);
        h.material.opacity = mode === "choose" ? 0.42 + 0.18 * Math.sin(time.value * 2 + h.userData.starId) : 0.22;
        if (selected) h.material.opacity *= h.userData.starId === selected.star.id ? 1.6 : 0.4;
      }
      if (G.homeMark) G.homeMark.scale.setScalar(G.homeMark.position.distanceTo(camera.position) * 0.034);
      for (const m of G.speciesMarks) {
        const on = chosenSpecies?.id === m.userData.speciesId;
        m.scale.setScalar(m.position.distanceTo(camera.position) * (on ? 0.05 + 0.006 * Math.sin(time.value * 3) : 0.038));
        m.material.opacity = mode === "choose" ? 0.25 : on ? 1 : 0.7;
      }
      // On a phone the panel covers the lower screen: keep the open system in the space above it.
      const panel = $("#gsPanel");
      const lift = !cinema && !panel.hidden && innerWidth < 860 ? panel.getBoundingClientRect().height / 2 : 0;
      viewLift += (lift - viewLift) * Math.min(1, dt * 6);
      if (viewLift > 0.5) camera.setViewOffset(innerWidth, innerHeight, 0, viewLift, innerWidth, innerHeight);
      else camera.clearViewOffset();
      if (cinema) updateCinema(dt);
      else {
        placeCamera(dt);
        placePlanet(dt);
      }
      if (sys) {
        sys.glow.material.rotation += dt * 0.05;
        if (!$("#gsPanel").hidden) sys.preview.draw(dt);
      }
    },
    render() {
      renderer.render(scene, camera);
    },
    dispose() {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onContext);
      clearSystem();
      disposeGalaxy();
      disposables.forEach((d) => d.dispose());
      el.remove();
    },
    debug: {
      get G() {
        return G;
      },
      cam,
      select,
      deselect,
      setMode,
      begin,
      openConfirm,
      cycle,
      chooseSpecies,
      get species() {
        return speciesList;
      },
      screenOf,
      starWorld,
      get selected() {
        return selected;
      },
      get cinema() {
        return cinema;
      },
    },
  };
}

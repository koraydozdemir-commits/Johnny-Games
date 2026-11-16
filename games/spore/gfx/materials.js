/**
 * Materials and textures for cell bodies.
 *
 * Body wobble and the part sway run in the vertex shader, so a whole cell animates without
 * rebuilding any geometry. The same wobble function exists in JS (`wobbleAt`) so attached parts
 * can follow the membrane exactly.
 */
import * as THREE from "three";

/** One clock shared by every cell material. Update `timeUniform.value` once per frame. */
export const timeUniform = { value: 0 };

/** Wobble: a travelling wave along the spine whose amplitude grows towards the tail. */
export function wobbleAt(x, body, time) {
  const t = THREE.MathUtils.clamp((body.headX - x) / body.length, 0, 1);
  const envelope = t * t * (3 - 2 * t);
  return body.amp * Math.sin(x * body.freq - time * body.speed + body.phase) * envelope;
}

const BODY_VERTEX_PARS = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
uniform float uSpeed;
uniform float uPhase;
uniform float uHeadX;
uniform float uLength;
uniform float uPulse;
`;

const BODY_VERTEX_MAIN = /* glsl */ `
float bodyT = clamp((uHeadX - position.x) / uLength, 0.0, 1.0);
float bodyEnv = bodyT * bodyT * (3.0 - 2.0 * bodyT);
transformed.y += uAmp * sin(position.x * uFreq - uTime * uSpeed + uPhase) * bodyEnv;
transformed.xy *= 1.0 + uPulse * 0.12;
transformed.z *= 1.0 + uPulse * 0.2;
`;

const BODY_FRAGMENT_PARS = /* glsl */ `
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uRimPower;
uniform vec3 uFlashColor;
uniform float uFlash;
uniform float uFade;
`;

const BODY_FRAGMENT_MAIN = /* glsl */ `
float rim = pow(1.0 - clamp(abs(normal.z), 0.0, 1.0), uRimPower);
outgoingLight += uRimColor * rim * uRimStrength;
outgoingLight = mix(outgoingLight, uFlashColor, uFlash);
`;

/**
 * Membrane material. `body` describes the wobble: { headX, length, amp, freq, speed, phase }.
 * The returned material exposes `userData.uniforms` so a rig can animate it.
 */
export function createMembraneMaterial({ color, map = null, rimColor, opacity = 0.93, body }) {
  const uniforms = {
    uTime: timeUniform,
    uAmp: { value: 0 },
    uFreq: { value: body.freq },
    uSpeed: { value: body.speed },
    uPhase: { value: body.phase },
    uHeadX: { value: body.headX },
    uLength: { value: body.length },
    uPulse: { value: 0 },
    uRimColor: { value: new THREE.Color(rimColor) },
    uRimStrength: { value: 0.4 },
    uRimPower: { value: 2.4 },
    uFlashColor: { value: new THREE.Color(0xffffff) },
    uFlash: { value: 0 },
    uFade: { value: 1 },
  };
  const material = new THREE.MeshStandardMaterial({
    color,
    map,
    roughness: 0.42,
    metalness: 0.02,
    transparent: opacity < 1,
    opacity,
    side: THREE.FrontSide,
  });
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + BODY_VERTEX_PARS)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + BODY_VERTEX_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + BODY_FRAGMENT_PARS)
      .replace("#include <opaque_fragment>", BODY_FRAGMENT_MAIN + "\n#include <opaque_fragment>")
      .replace("#include <dithering_fragment>", "gl_FragColor.a *= uFade;\n#include <dithering_fragment>");
  };
  material.customProgramCacheKey = () => "spore-membrane";
  return material;
}

const PART_VERTEX_PARS = /* glsl */ `
attribute float aSway;
uniform float uTime;
uniform float uSwayFreq;
`;
const PART_VERTEX_MAIN = /* glsl */ `
transformed.y += aSway * sin(uTime * uSwayFreq - abs(aSway) * 6.0 + position.x * 2.0);
transformed.z += aSway * 0.35 * cos(uTime * uSwayFreq * 0.8 - abs(aSway) * 5.0);
`;

let sharedPartMaterial = null,
  sharedInteriorMaterial = null;

/** Vertex-coloured material shared by every part in the game (organs differ only by vertex colour). */
export function getPartMaterial() {
  if (sharedPartMaterial) return sharedPartMaterial;
  const uniforms = { uTime: timeUniform, uSwayFreq: { value: 7.5 } };
  sharedPartMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.04 });
  sharedPartMaterial.userData.shared = true;
  sharedPartMaterial.userData.uniforms = uniforms;
  sharedPartMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + PART_VERTEX_PARS)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + PART_VERTEX_MAIN);
  };
  sharedPartMaterial.customProgramCacheKey = () => "spore-part";
  return sharedPartMaterial;
}

/** Interior organelles seen through the membrane: lit, vertex-coloured, slightly glossy. */
export function getInteriorMaterial() {
  if (sharedInteriorMaterial) return sharedInteriorMaterial;
  sharedInteriorMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0, emissive: 0x201030, emissiveIntensity: 0.35 });
  sharedInteriorMaterial.userData.shared = true;
  return sharedInteriorMaterial;
}

let sharedShadow = null;
/** One soft radial shadow texture + material shared by every cell. */
export function getShadowMaterial() {
  if (sharedShadow) return sharedShadow;
  const size = 128,
    canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(3,12,30,0.55)");
  g.addColorStop(0.45, "rgba(3,12,30,0.3)");
  g.addColorStop(0.8, "rgba(3,12,30,0.08)");
  g.addColorStop(1, "rgba(3,12,30,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.userData.shared = true;
  sharedShadow = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  sharedShadow.userData.shared = true;
  return sharedShadow;
}

/* ---- membrane textures ------------------------------------------------------------------ */

const textureCache = new Map();
const MAX_CACHED_TEXTURES = 40;

const hex = (c) => "#" + c.toString(16).padStart(6, "0");
const mix = (a, b, t) => {
  const ca = new THREE.Color(a),
    cb = new THREE.Color(b);
  return "#" + ca.lerp(cb, t).getHexString();
};

function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Paint the membrane albedo in top-down body space. u runs tail to head, v runs across the body.
 * `extent` is the world-space box the texture covers: { minX, minY, width, height }.
 * Paint strokes from the editor are drawn straight into the texture, so they cost no geometry.
 */
export function getMembraneTexture({ base, pattern, accent, kind, strokes = [], extent, size = 512, seed = 1 }) {
  const strokeKey = strokes.map((s) => [s.x, s.y, s.color, s.size].join(",")).join(";");
  const key = [base, pattern, accent, kind, size, seed, extent.width.toFixed(2), extent.height.toFixed(2), strokeKey].join("|");
  const hit = textureCache.get(key);
  if (hit) {
    textureCache.delete(key);
    textureCache.set(key, hit);
    return hit;
  }
  const aspect = extent.height / extent.width;
  const w = size,
    h = Math.max(64, Math.min(size, Math.round(size * aspect)));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const rand = seededRandom(seed * 2654435761);
  const px = (x) => ((x - extent.minX) / extent.width) * w;
  const py = (y) => (1 - (y - extent.minY) / extent.height) * h;
  const unit = w / extent.width;

  // Base: saturated colour, lighter in the middle and darker towards the edge, for volume.
  const body = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.62);
  body.addColorStop(0, mix(base, 0xffffff, 0.06));
  body.addColorStop(0.6, hex(base));
  body.addColorStop(1, mix(base, 0x06122e, 0.42));
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, w, h);

  // Fine veins: thin dark wandering lines give the membrane a living, organic texture.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = mix(base, 0x06122e, 0.55);
  ctx.lineWidth = Math.max(1, w / 256);
  for (let i = 0; i < 10; i++) {
    let x = rand() * w,
      y = rand() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      x += (rand() - 0.5) * w * 0.22;
      y += (rand() - 0.5) * h * 0.4;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  const patternColor = hex(pattern),
    accentColor = hex(accent);
  if (kind === "stripes") {
    ctx.strokeStyle = patternColor;
    ctx.lineWidth = Math.max(4, w * 0.045);
    ctx.globalAlpha = 0.85;
    for (let x = -w * 0.2; x < w * 1.1; x += w * 0.14) {
      ctx.beginPath();
      ctx.moveTo(x, -4);
      ctx.bezierCurveTo(x + w * 0.07, h * 0.3, x - w * 0.06, h * 0.65, x + w * 0.03, h + 4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (kind === "spots") {
    for (let i = 0; i < 46; i++) {
      const x = rand() * w,
        y = rand() * h,
        r = (0.025 + rand() * 0.04) * Math.max(w, h) * 0.6;
      ctx.fillStyle = mix(base, 0x06122e, 0.35);
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.22, r * 1.12, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = patternColor;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.9, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "gradient") {
    const grad = ctx.createLinearGradient(w, 0, 0, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.5, patternColor);
    grad.addColorStop(1, mix(pattern, 0x06122e, 0.55));
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  } else if (kind === "glow") {
    for (let i = 0; i < 20; i++) {
      const x = rand() * w,
        y = rand() * h,
        r = (0.03 + rand() * 0.07) * Math.max(w, h);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, patternColor);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  } else {
    for (let i = 0; i < 260; i++) {
      ctx.globalAlpha = 0.25 + rand() * 0.6;
      ctx.fillStyle = i % 5 ? patternColor : accentColor;
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, 1 + rand() * w * 0.007, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Grain: tiny light and dark flecks so the surface never looks flat.
  for (let i = 0; i < w * 1.2; i++) {
    ctx.globalAlpha = 0.05 + rand() * 0.08;
    ctx.fillStyle = rand() > 0.5 ? "#ffffff" : "#04102a";
    ctx.fillRect(rand() * w, rand() * h, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;

  for (const s of strokes) {
    const r = Math.max(2, (s.size || 0.075) * unit * 1.6);
    const g = ctx.createRadialGradient(px(s.x), py(s.y), 0, px(s.x), py(s.y), r);
    g.addColorStop(0, hex(s.color));
    g.addColorStop(0.7, hex(s.color));
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px(s.x), py(s.y), r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.userData.shared = true;
  if (textureCache.size >= MAX_CACHED_TEXTURES) {
    const oldestKey = textureCache.keys().next().value;
    textureCache.get(oldestKey).dispose();
    textureCache.delete(oldestKey);
  }
  textureCache.set(key, texture);
  return texture;
}

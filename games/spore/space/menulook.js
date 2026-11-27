// The main-menu galaxy of the full build, ported: tens of thousands of arm, core and field stars, drifting
// nebulae and dust lanes, all along the same arms as the real systems. `k` scales the menu's 100-unit galaxy.
import * as THREE from "three";
import { rng32 } from "../galaxy/names.js";
import { armHalf, softClamp } from "./galaxy/armshape.js";
import { STAR_KINDS } from "./galaxy/gen.js";

const TAU = Math.PI * 2;
export const QUALITY = {
  low: { arm: 15000, core: 4500, field: 2500, nebula: 230, dust: 110 },
  medium: { arm: 26000, core: 7500, field: 4000, nebula: 380, dust: 170 },
  high: { arm: 40000, core: 11000, field: 6000, nebula: 560, dust: 240 },
};
const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const col = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const C = {
  core: col("#fff1d6"), gold: col("#ffcf7a"), warm: col("#ffb070"), white: col("#f2f4ff"), blue: col("#9fb8ff"),
  violet: col("#c4a6ff"), pink: col("#ffb3e6"), nebViolet: col("#6a3cff"), nebIndigo: col("#3a2ad0"),
  nebBlue: col("#2f6bff"), nebLav: col("#b48cff"), nebWarm: col("#ffbf73"), dust: col("#07040e"),
};

const pointVert = (k) => `
attribute float size; attribute float phase; attribute vec3 color; attribute float reach;
uniform float uTime; uniform float uScale; uniform float uBoost; uniform float uMax; uniform float uPx;
varying vec3 vColor; varying float vAlpha; varying float vReach;
void main(){
  vReach = reach;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float speed = 0.9 + fract(phase * 7.13) * 2.2;
  float tw = 0.72 + 0.28 * sin(uTime * speed + phase * 6.2831);
  vAlpha = size < ${(0.55 * k).toFixed(2)} ? tw : 0.92 + 0.08 * tw;
  vColor = color;
  float ps = size * uBoost * uScale / max(0.1, -mv.z);
  vAlpha *= clamp(ps / 1.6, 0.12, 1.0);
  vAlpha *= smoothstep(${(0.6 * k).toFixed(1)}, ${(4 * k).toFixed(1)}, -mv.z);
  if (reach > 0.5) { ps = max(ps, 4.0 * uPx); vAlpha = 1.0; }
  gl_PointSize = clamp(ps, 1.0, max(uMax, 6.0 * uPx));
  gl_Position = projectionMatrix * mv;
}`;
const pointFrag = `
uniform float uGain; varying vec3 vColor; varying float vAlpha; varying float vReach;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float d = dot(p, p) * 4.0;
  if (d > 1.0) discard;
  float a = exp(-d * 5.0) + 0.25 * exp(-d * 1.4);
  vec3 c = vColor * uGain;
  if (vReach > 0.5) { c = mix(c, vec3(.55,.92,1.), .55) * 1.6; a = max(a, exp(-d * 2.5)); }
  gl_FragColor = vec4(c, a * vAlpha);
}`;
const cloudVert = `
attribute vec3 offset; attribute float scale; attribute vec4 tint; attribute float rot;
uniform float uFade;
varying vec2 vUv; varying vec4 vTint;
void main(){
  vUv = uv; vTint = tint;
  vec4 mv = modelViewMatrix * vec4(offset, 1.0);
  float c = cos(rot), s = sin(rot);
  mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * scale;
  vTint.a *= smoothstep(scale * 0.25, scale * 1.4, -mv.z) * uFade;
  gl_Position = projectionMatrix * mv;
}`;
const cloudFrag = `
uniform sampler2D map; uniform float uGain; varying vec2 vUv; varying vec4 vTint;
void main(){
  float a = texture2D(map, vUv).a * vTint.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vTint.rgb * uGain, a);
}`;

function cloudTexture(seed) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const x = cv.getContext("2d");
  const r = rng32(seed);
  for (let i = 0; i < 46; i++) {
    const d = r() * TAU, h = Math.pow(r(), 0.7) * 128 * 0.3;
    const cx = 64 + Math.cos(d) * h, cy = 64 + Math.sin(d) * h, g = 128 * (0.08 + r() * 0.2);
    const gr = x.createRadialGradient(cx, cy, 0, cx, cy, g);
    gr.addColorStop(0, "rgba(255,255,255,0.3)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = gr;
    x.fillRect(0, 0, 128, 128);
  }
  x.globalCompositeOperation = "destination-in";
  const m = x.createRadialGradient(64, 64, 12.8, 64, 64, 64);
  m.addColorStop(0, "rgba(0,0,0,1)");
  m.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = m;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

export function createMenuLook(galaxy, k, quality = "medium") {
  const reachAttr = new Float32Array(galaxy.backdrop ? galaxy.backdrop.count : 0);
  const q = QUALITY[quality] || QUALITY.medium;
  const { twist, spin, arms } = galaxy.shape;
  const r = galaxy.backdrop.rng;
  const ce = () => (r() + r() + r() + r() - 2) / 1.15;
  const arm = (i, d) => spin + (i / arms) * TAU + d * twist;
  const ve = (x, z, y = 0) => [x * k * 100, y * k, z * k * 100];
  const group = new THREE.Group();
  const uTime = { value: 0 }, uScale = { value: 800 };
  let ratioNow = 1;

  /* stars: the backdrop systems themselves, tinted a little by their kind */
  const bd = galaxy.backdrop;
  const extra = galaxy.stars.slice(bd.first, bd.first + bd.count);
  const st = extra.map((s) => {
    const kc = col(STAR_KINDS[s.kind].color);
    return { pos: ve(s.x, s.y, s.h), color: mix(s.tint, kc, 0.55), size: s.size * (0.8 + STAR_KINDS[s.kind].size * 0.25), phase: s.phase };
  });
  const n = st.length, P = new Float32Array(n * 3), Co = new Float32Array(n * 3), S = new Float32Array(n), Ph = new Float32Array(n);
  st.forEach((s, i) => { P.set(s.pos, i * 3); Co.set(s.color, i * 3); S[i] = s.size * k; Ph[i] = s.phase; });
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(P, 3));
  sg.setAttribute("color", new THREE.BufferAttribute(Co, 3));
  sg.setAttribute("size", new THREE.BufferAttribute(S, 1));
  sg.setAttribute("phase", new THREE.BufferAttribute(Ph, 1));
  sg.setAttribute("reach", new THREE.BufferAttribute(reachAttr, 1));
  const pm = new THREE.ShaderMaterial({
    uniforms: { uTime, uScale, uBoost: { value: 1 }, uMax: { value: 12 }, uGain: { value: 1 }, uPx: { value: 1 } },
    vertexShader: pointVert(k), fragmentShader: pointFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(sg, pm);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  group.add(pts);

  /* clouds */
  const cloud = cloudTexture(77);
  const cloudMat = (map, add) => new THREE.ShaderMaterial({ uniforms: { map: { value: map }, uFade: { value: 1 }, uGain: { value: 1 } }, vertexShader: cloudVert, fragmentShader: cloudFrag, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
  const quads = (list) => {
    const base = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute("position", base.getAttribute("position"));
    g.setAttribute("uv", base.getAttribute("uv"));
    const N = list.length, off = new Float32Array(N * 3), sc = new Float32Array(N), tint = new Float32Array(N * 4), rot = new Float32Array(N);
    list.forEach((b, i) => { off.set(b.pos, i * 3); sc[i] = b.scale * k; tint.set([...b.color, b.alpha], i * 4); rot[i] = b.rot; });
    g.setAttribute("offset", new THREE.InstancedBufferAttribute(off, 3));
    g.setAttribute("scale", new THREE.InstancedBufferAttribute(sc, 1));
    g.setAttribute("tint", new THREE.InstancedBufferAttribute(tint, 4));
    g.setAttribute("rot", new THREE.InstancedBufferAttribute(rot, 1));
    g.instanceCount = N;
    return g;
  };
  const neb = [];
  for (let i = 0; i < q.nebula; i++) {
    const a = i % arms, d = 0.08 + Math.pow(r(), 0.85) * 0.98;
    const ang = arm(a, d) + softClamp(ce() * (0.22 * (1 - d) + 0.08), armHalf(d, twist) * 0.8);
    const t = r();
    let c = t < 0.34 ? C.nebViolet : t < 0.6 ? C.nebBlue : t < 0.82 ? C.nebIndigo : C.nebLav;
    if (d < 0.32) c = mix(C.nebWarm, c, smooth(0.08, 0.32, d));
    neb.push({ pos: ve(Math.cos(ang) * d, Math.sin(ang) * d, ce() * 1.5), color: c, alpha: (0.07 + r() * 0.09) * (d < 0.3 ? 1.3 : 1), scale: (12 + r() * 20) * (0.7 + d * 0.8), rot: r() * TAU });
  }
  for (let i = 0; i < q.nebula * 0.7; i++) {
    const a = i % arms, d = 0.12 + Math.pow(r(), 0.8) * 0.9, ang = arm(a, d) + ce() * 0.045, t = r();
    let c = t < 0.4 ? C.nebLav : t < 0.7 ? C.nebViolet : C.nebBlue;
    if (d < 0.35) c = mix(C.core, c, smooth(0.12, 0.35, d));
    neb.push({ pos: ve(Math.cos(ang) * d, Math.sin(ang) * d, ce() * 0.8), color: c, alpha: 0.1 + r() * 0.12, scale: 4 + r() * 7, rot: r() * TAU });
  }
  const cm = new THREE.Mesh(quads(neb), cloudMat(cloud, true));
  cm.frustumCulled = false;
  cm.renderOrder = 1;
  // The bright heart, drawn by shader so it stays perfectly round at any zoom.
  const gm = new THREE.Mesh(new THREE.PlaneGeometry(2 * 12 * k, 2 * 12 * k), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vP; void main(){ vP=position.xy; vec4 c=modelViewMatrix*vec4(0.,0.,0.,1.); c.xy+=position.xy; gl_Position=projectionMatrix*c; }`,
    fragmentShader: `varying vec2 vP; void main(){ float r=length(vP)/${(12 * k).toFixed(1)};
      vec3 c=vec3(3.,2.4,1.4)*exp(-r*9.)*.4+vec3(1.6,1.2,.7)*exp(-r*2.6)*.25+vec3(.6,.4,1.)*exp(-r*1.4)*.1;
      gl_FragColor=vec4(c*smoothstep(1.,.6,r),1.); }`,
  }));
  gm.frustumCulled = false;
  gm.renderOrder = 4;
  const dust = [];
  for (let i = 0; i < q.dust; i++) {
    const a = i % arms, d = 0.14 + Math.pow(r(), 0.9) * 0.75, ang = arm(a, d) - 0.3 + ce() * 0.06;
    dust.push({ pos: ve(Math.cos(ang) * d, Math.sin(ang) * d, ce() * 0.6), color: C.dust, alpha: 0.22 + r() * 0.2, scale: 6 + r() * 9, rot: r() * TAU });
  }
  const dm = new THREE.Mesh(quads(dust), cloudMat(cloud, false));
  dm.frustumCulled = false;
  dm.renderOrder = 2;
  group.add(cm, gm, dm);

  return {
    group,
    reachAttr: sg.getAttribute("reach"),
    /** `dist` is how far the camera is: close in, the backdrop stars quieten so your own systems stand out. */
    update(t, dist = 1e5) {
      uTime.value = t;
      const f = smooth(2000 * (k / 90), 9000 * (k / 90), dist);
      pm.uniforms.uGain.value = 0.22 + 0.78 * f;
      pm.uniforms.uMax.value = (3 + 9 * f) * Math.max(1, ratioNow * 0.7);
    },
    resize(h, ratio, fov) { ratioNow = ratio; pm.uniforms.uPx.value = ratio; uScale.value = (h * ratio) / (2 * Math.tan((fov * Math.PI) / 360)); },
  };
}

/**
 * Emotes: the notes, hearts and sparkles that float up from a creature while it performs. They are
 * sprites in the world (not HUD pops), so they stay with the creature as the camera moves.
 */
import * as THREE from "three";
import { ABILITY_TIME } from "./body3d.js";

const GLYPHS = {
  sing: [
    ["♪", "#ffe27a"],
    ["♫", "#9ff0ff"],
    ["♬", "#ffb3e6"],
  ],
  dance: [
    ["✦", "#ffd25e"],
    ["♪", "#b4ff9f"],
    ["✦", "#ff9fd6"],
  ],
  charm: [
    ["♥", "#ff6f9f"],
    ["♥", "#ffa3c4"],
  ],
  pose: [
    ["✦", "#fff3a8"],
    ["★", "#ffd25e"],
  ],
};
const COUNT = { sing: 5, dance: 5, charm: 4, pose: 6 };

/** One texture per glyph and colour, drawn once. */
const textures = new Map();
function glyphTexture(glyph, color) {
  const key = glyph + color;
  if (textures.has(key)) return textures.get(key);
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d");
  g.font = "bold 72px Georgia, 'Segoe UI Symbol', serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = 9;
  g.strokeStyle = "rgba(10,28,40,.85)";
  g.strokeText(glyph, 48, 52);
  g.fillStyle = color;
  g.fillText(glyph, 48, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, t);
  return t;
}

/**
 * @param {THREE.Scene} scene
 * @returns {{ emit(kind:string, where:() => THREE.Vector3|null, size?:number): void, update(dt:number): void, dispose(): void }}
 */
export function createEmotes(scene) {
  const live = [];
  const queue = [];
  let clock = 0;
  function spawn(q) {
    const at = q.where();
    if (!at) return;
    const [glyph, color] = q.set[q.i % q.set.length];
    const mat = new THREE.SpriteMaterial({ map: glyphTexture(glyph, color), transparent: true, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    const side = (q.i % 2 ? 1 : -1) * (0.25 + Math.random() * 0.5) * q.size;
    sp.position.copy(at);
    sp.position.x += side * 0.6;
    sp.position.z += (Math.random() - 0.5) * 0.6 * q.size;
    sp.scale.setScalar(0.01);
    scene.add(sp);
    live.push({ sp, mat, t: 0, life: 1.25, size: 0.75 * q.size, drift: side, burst: q.kind === "pose" });
  }
  return {
    /** Start a little stream of emotes for a move; `where` is read as each one appears. */
    emit(kind, where, size = 1) {
      const set = GLYPHS[kind];
      if (!set) return;
      const n = COUNT[kind],
        dur = (ABILITY_TIME[kind] || 1) * 0.8;
      for (let i = 0; i < n; i++) queue.push({ at: clock + 0.15 + (kind === "pose" ? 0.35 + i * 0.04 : (i / n) * dur), kind, set, i, where, size });
    },
    update(dt) {
      clock += dt;
      for (let i = queue.length - 1; i >= 0; i--)
        if (queue[i].at <= clock) {
          spawn(queue[i]);
          queue.splice(i, 1);
        }
      for (let i = live.length - 1; i >= 0; i--) {
        const e = live[i];
        e.t += dt;
        const k = e.t / e.life;
        if (k >= 1) {
          scene.remove(e.sp);
          e.mat.dispose();
          live.splice(i, 1);
          continue;
        }
        // Pop in, float up with a gentle sway (or burst outwards for a pose), fade out.
        e.sp.position.y += dt * (e.burst ? 0.9 : 1.5) * e.size * 1.3;
        e.sp.position.x += dt * (e.burst ? e.drift * 2.2 : Math.sin(e.t * 6 + e.drift * 9) * 0.5);
        e.sp.scale.setScalar(e.size * Math.min(1, k * 6) * (1 + 0.15 * Math.sin(e.t * 10)));
        e.mat.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
        e.mat.rotation = Math.sin(e.t * 5 + e.drift * 4) * 0.3;
      }
    },
    dispose() {
      live.forEach((e) => {
        scene.remove(e.sp);
        e.mat.dispose();
      });
      live.length = 0;
      queue.length = 0;
    },
  };
}

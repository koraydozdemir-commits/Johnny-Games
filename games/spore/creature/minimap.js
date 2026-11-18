/**
 * Spore's minimap: a round map in the corner that turns with the camera, showing the land around you,
 * nests by how they feel about you, your nest, fossils and anything hunting you. Tap it for a map of
 * the whole island. Drawing is plain 2D canvas over a relief picture of the island made once.
 */
import * as THREE from "three";
import { ISLAND, REGION, groundColor, heightAt, poolAt } from "./world.js";

const WORLD = ISLAND.size / 2; // the picture covers -WORLD..WORLD on both axes

/** Colours for what can appear on a map. */
export const MAP_COLORS = {
  neutral: "#f3efe2",
  wary: "#ffb35c",
  angry: "#ff4f4a",
  allied: "#4fdc84",
  extinct: "#7d7f84",
  home: "#ffd36b",
  fossil: "#f6e7b8",
  pack: "#8fd8ff",
  hunter: "#ff4f4a",
  danger: "#ff6a3d",
};

const pictures = new Map();
/** A north-up relief picture of the island, `size` pixels square. Made once (the island never changes). */
export function islandPicture(size = 320) {
  const key = REGION.id + ":" + size; // one picture per region
  if (!pictures.has(key)) pictures.set(key, drawIsland(size));
  return pictures.get(key);
}
function drawIsland(size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const step = (WORLD * 2) / size;
  const col = new THREE.Color();
  const hs = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) hs[j * size + i] = heightAt(-WORLD + (i + 0.5) * step, -WORLD + (j + 0.5) * step);
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = -WORLD + (i + 0.5) * step,
        z = -WORLD + (j + 0.5) * step,
        h = hs[j * size + i],
        d = Math.hypot(x, z);
      let c;
      const pool = poolAt(x, z);
      if (d > ISLAND.shore + 1 || (h < 0.2 && !pool)) {
        // Sea: lighter in the shallows.
        const deep = Math.min(1, Math.max(0, d - ISLAND.shore) / 40);
        c = [56 - deep * 22, 150 - deep * 40, 196 - deep * 26];
      } else if (pool && Math.hypot(x - pool.x, z - pool.z) < pool.r * 0.85) {
        c = pool.kind === "lava" ? [255, 110, 30] : [80, 104, 74];
      } else {
        groundColor(x, z, col);
        c = [col.r * 255, col.g * 255, col.b * 255];
        // Hill shading: lit from the north-west.
        const west = hs[j * size + Math.max(0, i - 1)],
          north = hs[Math.max(0, j - 1) * size + i];
        const light = Math.max(-0.35, Math.min(0.35, (west - h + (north - h)) * 0.12));
        c = c.map((v) => v * (1 + light));
      }
      const k = (j * size + i) * 4;
      img.data[k] = c[0];
      img.data[k + 1] = c[1];
      img.data[k + 2] = c[2];
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Draw one marker glyph at (x, y) in pixels. `r` is the base radius. */
function glyph(ctx, m, x, y, r, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = Math.max(1.2, r * 0.35);
  ctx.strokeStyle = "#10202bcc";
  switch (m.kind) {
    case "nest": {
      const col = MAP_COLORS[m.state] || MAP_COLORS.neutral;
      const pulse = m.state === "angry" ? 1 + 0.18 * Math.sin(t * 8) : 1;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.15 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = m.known || m.state === "extinct" ? col : "#00000055";
      ctx.fill();
      ctx.lineWidth = m.known ? ctx.lineWidth : r * 0.4;
      ctx.strokeStyle = m.known || m.state === "extinct" ? "#10202bcc" : col;
      ctx.stroke();
      if (m.state === "extinct") {
        ctx.strokeStyle = "#1b1d22";
        ctx.lineWidth = r * 0.32;
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, -r * 0.5);
        ctx.lineTo(r * 0.5, r * 0.5);
        ctx.moveTo(r * 0.5, -r * 0.5);
        ctx.lineTo(-r * 0.5, r * 0.5);
        ctx.stroke();
      } else if (!m.known) {
        ctx.fillStyle = col;
        ctx.font = `800 ${r * 1.5}px system-ui,sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", 0, r * 0.1);
      }
      break;
    }
    case "home": {
      // A little house.
      const s = r * 1.25;
      ctx.beginPath();
      ctx.moveTo(-s, -s * 0.1);
      ctx.lineTo(0, -s * 1.05);
      ctx.lineTo(s, -s * 0.1);
      ctx.lineTo(s * 0.72, -s * 0.1);
      ctx.lineTo(s * 0.72, s * 0.85);
      ctx.lineTo(-s * 0.72, s * 0.85);
      ctx.lineTo(-s * 0.72, -s * 0.1);
      ctx.closePath();
      ctx.fillStyle = MAP_COLORS.home;
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "migrate": {
      const k = 1 + 0.25 * Math.sin(t * 4);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.7 * k, 0, Math.PI * 2);
      ctx.strokeStyle = MAP_COLORS.home;
      ctx.lineWidth = r * 0.45;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = MAP_COLORS.home;
      ctx.fill();
      break;
    }
    case "fossil": {
      ctx.rotate(0.6);
      ctx.fillStyle = MAP_COLORS.fossil;
      ctx.beginPath();
      ctx.roundRect(-r * 0.9, -r * 0.28, r * 1.8, r * 0.56, r * 0.28);
      ctx.fill();
      for (const sx of [-1, 1])
        for (const sy of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(sx * r * 0.9, sy * r * 0.3, r * 0.34, 0, Math.PI * 2);
          ctx.fill();
        }
      break;
    }
    case "danger": {
      // Epic or rogue: a warning triangle.
      const s = r * 1.4;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.95, s * 0.7);
      ctx.lineTo(-s * 0.95, s * 0.7);
      ctx.closePath();
      ctx.fillStyle = MAP_COLORS.danger;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#2a0d05";
      ctx.font = `900 ${s}px system-ui,sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", 0, s * 0.18);
      break;
    }
    default: {
      // Creatures: pack (blue) or something hunting you (red).
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = MAP_COLORS[m.kind] || "#fff";
      ctx.fill();
      ctx.lineWidth = r * 0.25;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Your creature: an arrow pointing the way you face. */
function arrow(ctx, x, y, angle, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.3);
  ctx.lineTo(r * 0.9, r);
  ctx.lineTo(0, r * 0.45);
  ctx.lineTo(-r * 0.9, r);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = r * 0.35;
  ctx.strokeStyle = "#10202b";
  ctx.stroke();
  ctx.restore();
}

/**
 * The corner minimap.
 * @param {HTMLElement} host   where to put it
 * @param {object} o
 * @param {() => void} o.onOpen   tap: open the island map
 */
export function createMinimap(host, o) {
  const button = document.createElement("button");
  button.className = "chMini";
  button.type = "button";
  button.setAttribute("aria-label", "Map: open the island map");
  button.title = "Island map (M)";
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  const north = document.createElement("span");
  north.className = "chMiniN";
  north.textContent = "N";
  north.setAttribute("aria-hidden", "true");
  button.append(canvas, north);
  button.addEventListener("click", () => o.onOpen());
  host.appendChild(button);
  let picture = null,
    size = 0;

  return {
    element: button,
    /** Give it the island picture (made once by the stage). */
    setPicture(p) {
      picture = p;
    },
    /**
     * @param {{x:number,z:number,yaw:number,heading:number,time:number,markers:object[]}} v
     *   yaw: the camera's (forward is up on the map); heading: your creature's facing
     */
    draw(v) {
      const css = button.clientWidth;
      if (!css) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      if (size !== Math.round(css * dpr)) {
        size = Math.round(css * dpr);
        canvas.width = canvas.height = size;
      }
      const ctx = canvas.getContext("2d");
      const c = size / 2,
        k = c / (v.range || 80); // pixels per metre (sharper eyes see further)
      const sin = Math.sin(v.yaw),
        cos = Math.cos(v.yaw);
      // World to map, so that the camera's forward is up: X = dx·sin + dz·cos, Y = dz·sin − dx·cos.
      const toMap = (x, z) => {
        const dx = x - v.x,
          dz = z - v.z;
        return [c + (dx * sin + dz * cos) * k, c + (dz * sin - dx * cos) * k];
      };
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, c, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#2a6f99";
      ctx.fillRect(0, 0, size, size);
      if (picture) {
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(v.yaw - Math.PI / 2);
        ctx.scale(k, k);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(picture, -WORLD - v.x, -WORLD - v.z, WORLD * 2, WORLD * 2);
        ctx.restore();
      }
      const r = Math.max(3, size * 0.034);
      // Things off the edge of the map sit on its rim so you know which way they are.
      for (const m of v.markers) {
        let [mx, my] = toMap(m.x, m.z);
        const dx = mx - c,
          dy = my - c,
          d = Math.hypot(dx, dy),
          rim = c - r * 1.9;
        if (d > rim) {
          if (!m.edge) continue;
          mx = c + (dx / d) * rim;
          my = c + (dy / d) * rim;
        }
        glyph(ctx, m, mx, my, r, v.time);
      }
      arrow(ctx, c, c, v.yaw - v.heading, r * 1.25);
      ctx.restore();
      // North (−z) on the rim: on the map it lies along (−cos yaw, −sin yaw).
      north.style.left = 50 - cos * 43 + "%";
      north.style.top = 50 - sin * 43 + "%";
    },
  };
}

/**
 * The full island map: north up, everything you know about, with a legend. Pauses nothing itself.
 * @param {object} o
 * @param {HTMLCanvasElement} o.picture
 * @param {object[]} o.markers   as for the minimap, plus an optional label
 * @param {{x:number,z:number,heading:number}} o.you
 * @param {() => void} o.onClose
 */
export function openIslandMap(host, o) {
  const wrap = document.createElement("div");
  wrap.className = "chMap";
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-label", "Island map");
  wrap.innerHTML = `
    <div class="chMapCard">
      <div class="chMapHead"><b>${o.title || "Island map"}</b><button class="chMapClose" aria-label="Close map">✕</button></div>
      <canvas class="chMapCanvas" role="img" aria-label="Map of the island with nests, your nest and fossils"></canvas>
      <ul class="chMapKey">
        <li><i style="--c:${MAP_COLORS.home}" class="house"></i>Your nest</li>
        <li><i style="--c:${MAP_COLORS.neutral}"></i>Nest</li>
        <li><i style="--c:${MAP_COLORS.wary}"></i>Hostile nest</li>
        <li><i style="--c:${MAP_COLORS.allied}"></i>Allied</li>
        <li><i style="--c:${MAP_COLORS.extinct}"></i>Extinct</li>
        <li><i style="--c:${MAP_COLORS.fossil}" class="bone"></i>Fossil</li>
        <li><i style="--c:${MAP_COLORS.danger}" class="tri"></i>Epic or rogue</li>
      </ul>
      ${
        o.regions
          ? `<div class="chRegions" role="group" aria-label="Regions">${o.regions
              .map(
                (r, i) =>
                  `${i ? '<i aria-hidden="true">›</i>' : ""}<button data-region="${r.id}" ${r.here || !r.open ? "disabled" : ""} class="${r.here ? "here" : r.open ? "open" : "locked"}" aria-label="${r.name}${r.here ? ", you are here" : r.open ? ", travel here" : ", not reached yet"}">${r.open ? "" : "🔒 "}${r.home ? "🏠 " : ""}${r.name}${r.here ? " <small>here</small>" : ""}</button>`,
              )
              .join("")}</div><p class="chRegionsNote">Each migration takes your species on to the next region. Tap one you've lived in to travel back.</p>`
          : ""
      }
    </div>`;
  host.appendChild(wrap);
  wrap.querySelectorAll("[data-region]").forEach((b) => b.addEventListener("click", () => o.onTravel?.(b.dataset.region)));
  const canvas = wrap.querySelector("canvas");
  const close = () => {
    window.removeEventListener("keydown", onKey, true);
    wrap.remove();
    o.onClose();
  };
  const onKey = (e) => {
    if (e.key === "Escape" || e.key === "m" || e.key === "M") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener("keydown", onKey, true);
  wrap.querySelector(".chMapClose").addEventListener("click", close);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  wrap.querySelector(".chMapClose").focus();

  const css = canvas.clientWidth;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const size = Math.round(css * dpr);
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  // Zoom to the island itself (a little sea round the edge).
  const span = ISLAND.shore + 14,
    k = size / (span * 2);
  const toMap = (x, z) => [size / 2 + x * k, size / 2 + z * k];
  ctx.fillStyle = "#24668e";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(o.picture, size / 2 - WORLD * k, size / 2 - WORLD * k, WORLD * 2 * k, WORLD * 2 * k);
  const r = Math.max(4, size * 0.016);
  const labels = [];
  for (const m of o.markers) {
    const [x, y] = toMap(m.x, m.z);
    glyph(ctx, m, x, y, r, 0);
    if (m.label) labels.push({ x, y: y + r * 2.6, text: m.label });
  }
  ctx.font = `700 ${Math.round(r * 2.1)}px "Trebuchet MS",system-ui,sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  for (const l of labels) {
    ctx.lineWidth = r * 0.7;
    ctx.strokeStyle = "#0b1a24d0";
    ctx.strokeText(l.text, l.x, l.y);
    ctx.fillStyle = "#fffbea";
    ctx.fillText(l.text, l.x, l.y);
  }
  const [yx, yy] = toMap(o.you.x, o.you.z);
  // North is up: a heading of 0 faces east (+x), π/2 faces north.
  arrow(ctx, yx, yy, Math.PI / 2 - o.you.heading, r * 1.5);
  // Compass.
  ctx.font = `900 ${Math.round(r * 2.6)}px system-ui,sans-serif`;
  ctx.textBaseline = "top";
  ctx.lineWidth = r * 0.6;
  ctx.strokeText("N", size / 2, r);
  ctx.fillStyle = "#fff";
  ctx.fillText("N", size / 2, r);
  return { close };
}

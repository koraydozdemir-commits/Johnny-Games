/**
 * Planet portraits: a lit sphere painted pixel by pixel from the planet's own seed, so a planet
 * always looks the same. Continents, oceans, ice caps, bands for gas giants, cloud cover, an
 * atmosphere glow and rings. Results are cached by planet and size; this is the "planet view" level
 * of detail (the galaxy map only ever draws star points).
 */
import { PLANET_TYPES } from "./gen.js";
import { rng32 } from "./names.js";

const cache = new Map();
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Seeded 3D value noise, smooth and cheap. */
function makeNoise(seed) {
  const r = rng32(seed);
  const perm = new Uint8Array(512),
    vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) (perm[i] = i), (vals[i] = r());
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const fade = (t) => t * t * (3 - 2 * t);
  const v = (x, y, z) => vals[perm[(perm[(perm[x & 255] + y) & 255] + z) & 255]];
  const n3 = (x, y, z) => {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      zi = Math.floor(z);
    const xf = fade(x - xi),
      yf = fade(y - yi),
      zf = fade(z - zi);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(v(xi, yi, zi), v(xi + 1, yi, zi), xf), l(v(xi, yi + 1, zi), v(xi + 1, yi + 1, zi), xf), yf),
      l(l(v(xi, yi, zi + 1), v(xi + 1, yi, zi + 1), xf), l(v(xi, yi + 1, zi + 1), v(xi + 1, yi + 1, zi + 1), xf), yf),
      zf,
    );
  };
  return (x, y, z, oct = 4) => {
    let s = 0,
      a = 0.5,
      f = 1;
    for (let i = 0; i < oct; i++) (s += n3(x * f, y * f, z * f) * a), (a *= 0.5), (f *= 2.03);
    return s / (1 - Math.pow(0.5, oct));
  };
}

/**
 * Draw a planet. Returns a canvas (cached).
 * @param {object} planet  from makeSystem().planets
 * @param {number} size    pixels across
 */
export function planetCanvas(planet, size = 160) {
  const key = planet.id + "@" + planet.surfaceSeed + "@" + size;
  if (cache.has(key)) return cache.get(key);
  const pad = planet.rings ? Math.round(size * 0.32) : Math.round(size * 0.06);
  const W = size + pad * 2;
  const cv = document.createElement("canvas");
  cv.width = cv.height = W;
  const ctx = cv.getContext("2d");
  const R = size / 2,
    cx = W / 2,
    cy = W / 2;
  const noise = makeNoise(planet.surfaceSeed);
  const cloudNoise = makeNoise(planet.surfaceSeed ^ 0x5bd1e995);
  const pal = PLANET_TYPES[planet.type].colors.map(hex);
  const sea = planet.water;
  const cold = planet.temp < -5;
  const img = ctx.createImageData(size, size);
  const light = [-0.55, -0.45, 0.7];
  const ll = Math.hypot(...light);
  light.forEach((v, i) => (light[i] = v / ll));
  const tilt = (planet.surfaceSeed % 100) / 100 - 0.5;
  // Rings behind the planet.
  const drawRings = (front) => {
    if (!planet.rings) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.35 + tilt * 0.4);
    ctx.scale(1, 0.28);
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.lineWidth = R * (0.07 + i * 0.015);
      ctx.strokeStyle = `rgba(${pal[(i + 1) % 4].map(Math.round).join(",")},${0.32 - i * 0.05})`;
      if (front) ctx.arc(0, 0, R * (1.32 + i * 0.13), 0, Math.PI);
      else ctx.arc(0, 0, R * (1.32 + i * 0.13), Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  };
  drawRings(false);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px - R + 0.5) / R,
        y = (py - R + 0.5) / R;
      const d2 = x * x + y * y;
      if (d2 > 1) continue;
      const z = Math.sqrt(1 - d2);
      // Rotate the sample point a little for variety.
      const sx = x * Math.cos(tilt) - z * Math.sin(tilt),
        sz = x * Math.sin(tilt) + z * Math.cos(tilt);
      let col;
      if (planet.type === "gas") {
        const band = Math.sin((y + noise(sx * 2, y * 6, sz * 2, 3) * 0.35) * 9 + planet.surfaceSeed);
        col = mix(pal[0], pal[1], band * 0.5 + 0.5);
        col = mix(col, pal[2], Math.max(0, noise(sx * 5, y * 14, sz * 5, 2) - 0.55) * 1.6);
      } else {
        const h = noise(sx * 1.8 + 3, y * 1.8, sz * 1.8, 5);
        if (sea > 0.02 && h < sea * 0.62 + 0.18) {
          // Ocean: deeper further from the coast.
          const depth = Math.min(1, (sea * 0.62 + 0.18 - h) * 4);
          col = mix(pal[3] && planet.type !== "oceanic" ? [70, 130, 200] : pal[1], pal[0], depth);
          if (planet.type === "toxic") col = mix([140, 160, 40], [70, 90, 20], depth);
          if (planet.type === "volcanic") col = mix([255, 120, 40], [120, 30, 10], depth);
        } else {
          const t = Math.min(1, Math.max(0, (h - 0.35) * 2.2));
          col = t < 0.5 ? mix(pal[1], pal[2], t * 2) : mix(pal[2], pal[3], (t - 0.5) * 2);
          if (planet.type === "volcanic" && noise(sx * 8, y * 8, sz * 8, 2) > 0.68) col = [255, 110, 40];
        }
        // Ice caps: larger on cold worlds.
        const cap = cold ? 0.45 : planet.temp < 25 ? 0.82 : 0.95;
        if (Math.abs(y) + noise(sx * 4, y * 4, sz * 4, 2) * 0.12 > cap) col = mix(col, [240, 246, 252], 0.9);
      }
      // Clouds.
      if (planet.clouds > 0) {
        const c = cloudNoise(sx * 2.6, y * (planet.type === "gas" ? 7 : 2.6), sz * 2.6, 4);
        const k = Math.max(0, (c - (1 - planet.clouds * 0.75)) * 3);
        if (k > 0) col = mix(col, [250, 250, 255], Math.min(0.85, k));
      }
      // Lighting, with a soft terminator and a little ambient.
      const lambert = Math.max(0, x * light[0] + y * light[1] + z * light[2]);
      const shade = 0.18 + 0.92 * Math.pow(lambert, 0.85);
      const i4 = (py * size + px) * 4;
      img.data[i4] = Math.min(255, col[0] * shade);
      img.data[i4 + 1] = Math.min(255, col[1] * shade);
      img.data[i4 + 2] = Math.min(255, col[2] * shade);
      // Antialiased edge.
      img.data[i4 + 3] = Math.max(0, Math.min(255, (1 - Math.sqrt(d2)) * R * 255));
    }
  }
  const tmp = document.createElement("canvas");
  tmp.width = tmp.height = size;
  tmp.getContext("2d").putImageData(img, 0, 0);
  ctx.drawImage(tmp, pad, pad);
  // Atmosphere glow.
  if (planet.atmosphere !== "None") {
    const glow = planet.type === "toxic" ? "170,220,80" : planet.type === "volcanic" ? "255,140,80" : planet.type === "gas" ? "240,220,180" : "140,190,255";
    const g = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.12);
    g.addColorStop(0, `rgba(${glow},0.45)`);
    g.addColorStop(1, `rgba(${glow},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
    ctx.fill();
  }
  drawRings(true);
  cv.dataset.pad = String(pad);
  if (cache.size > 120) cache.delete(cache.keys().next().value);
  cache.set(key, cv);
  return cv;
}
/** A planet portrait as an image URL, for <img> tags in lists. */
const urlCache = new Map();
export function planetImage(planet, size = 96) {
  const key = planet.id + "@" + size;
  if (!urlCache.has(key)) urlCache.set(key, planetCanvas(planet, size).toDataURL("image/png"));
  return urlCache.get(key);
}

/** A plant portrait: a small stylised drawing from its type and colours. */
export function plantImage(plant, size = 96) {
  const key = plant.id + "@" + size;
  if (urlCache.has(key)) return urlCache.get(key);
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d");
  const s = size / 100;
  c.scale(s, s);
  const t = plant.type.toLowerCase();
  c.fillStyle = "#3a2a1c";
  c.strokeStyle = plant.color;
  c.lineCap = "round";
  if (/tree|conifer|mangrove/.test(t)) {
    c.fillRect(46, 55, 8, 38);
    c.fillStyle = plant.color;
    if (/conifer/.test(t)) for (let i = 0; i < 3; i++) (c.beginPath(), c.moveTo(50, 10 + i * 15), c.lineTo(22 + i * 3, 50 + i * 12), c.lineTo(78 - i * 3, 50 + i * 12), c.fill());
    else for (const [x, y, r] of [[50, 35, 24], [32, 48, 16], [68, 48, 16]]) (c.beginPath(), c.arc(x, y, r, 0, Math.PI * 2), c.fill());
  } else if (/cactus|succulent/.test(t)) {
    c.fillStyle = plant.color;
    c.fillRect(42, 25, 16, 70);
    c.fillRect(25, 45, 10, 25);
    c.fillRect(65, 38, 10, 25);
    c.fillRect(25, 62, 20, 8);
    c.fillRect(55, 55, 20, 8);
  } else if (/fung|cap|spore|bladder/.test(t)) {
    c.fillStyle = "#e9e0c9";
    c.fillRect(44, 50, 12, 42);
    c.fillStyle = plant.color;
    c.beginPath();
    c.ellipse(50, 50, 32, 20, 0, Math.PI, 0);
    c.fill();
  } else if (/kelp|reed|grass|vine|seagrass/.test(t)) {
    c.lineWidth = 6;
    for (let i = 0; i < 5; i++) (c.beginPath(), c.moveTo(25 + i * 12, 95), c.quadraticCurveTo(15 + i * 14, 50, 30 + i * 10, 12 + (i % 2) * 12), c.stroke());
  } else if (/crystal|glass|prism|geode/.test(t)) {
    c.fillStyle = plant.color;
    for (const [x, h] of [[35, 55], [50, 75], [65, 45]]) (c.beginPath(), c.moveTo(x - 8, 95), c.lineTo(x, 95 - h), c.lineTo(x + 8, 95), c.fill());
  } else {
    c.fillStyle = plant.color;
    for (let i = 0; i < 6; i++) (c.beginPath(), c.ellipse(50, 60, 30, 10, (i / 6) * Math.PI, 0, Math.PI * 2), c.fill());
  }
  if (plant.fruit !== "None") {
    c.fillStyle = plant.accent;
    for (const [x, y] of [[38, 40], [60, 34], [52, 56]]) (c.beginPath(), c.arc(x, y, 5, 0, Math.PI * 2), c.fill());
  }
  urlCache.set(key, cv.toDataURL("image/png"));
  return urlCache.get(key);
}

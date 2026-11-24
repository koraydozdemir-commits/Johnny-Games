/**
 * The planet minimap: the Civilization Stage's world as a small globe that turns with the camera.
 * An orthographic view of the hemisphere you are looking at (so it is the sphere, not a flat map):
 * land and sea, every city in its owner's colour with its territory, armies on the move, spice
 * derricks, and cities under attack. Tap it to fly the camera there; the far side comes round as you go.
 *
 * The projection is pure and tested; drawing uses a 2D canvas, redrawn a few times a second.
 */

/** Unit-vector helpers (plain {x,y,z}, so this works with or without three.js vectors). */
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/**
 * The view basis for a camera looking down at direction f with "up" n: east, north and out.
 * @returns {{ e:object, n:object, f:object }}
 */
export function viewBasis(f, n) {
  const F = norm(f);
  // North, made exactly perpendicular to the view direction.
  const k = dot(n, F);
  let N = { x: n.x - F.x * k, y: n.y - F.y * k, z: n.z - F.z * k };
  if (Math.hypot(N.x, N.y, N.z) < 1e-6) N = Math.abs(F.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  N = norm(N);
  const E = norm(cross(N, F));
  return { e: E, n: N, f: F };
}
/** A direction on the planet to minimap coordinates (-1..1, y up); `front` is false on the far side. */
export function project(d, B) {
  const D = norm(d);
  return { x: dot(D, B.e), y: dot(D, B.n), front: dot(D, B.f) > 0 };
}
/** Minimap coordinates (inside the unit disc) back to a direction on the planet. */
export function unproject(x, y, B) {
  const r2 = x * x + y * y;
  const s = r2 > 1 ? 1 / Math.sqrt(r2) : 1;
  const X = x * s,
    Y = y * s;
  const Z = Math.sqrt(Math.max(0, 1 - X * X - Y * Y));
  return norm({ x: B.e.x * X + B.n.x * Y + B.f.x * Z, y: B.e.y * X + B.n.y * Y + B.f.y * Z, z: B.e.z * X + B.n.z * Y + B.f.z * Z });
}
/** Evenly spread directions over the sphere (a Fibonacci lattice), for sampling land and sea. */
export function sphereSamples(count) {
  const out = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    out.push({ x: Math.cos(i * g) * r, y, z: Math.sin(i * g) * r });
  }
  return out;
}

const hex = (c) => "#" + (c >>> 0).toString(16).padStart(6, "0").slice(-6);

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {(d:object) => boolean} o.isLand
 * @param {() => {f:object, n:object}} o.view            the camera's look direction and up
 * @param {() => object} o.world   { cities:[{d, owner, color, yours, capital, attacked}], vehicles:[{d, color, military}], geysers:[{d, color}], events:[{d, color}] }
 * @param {(d:object) => void} o.onPick
 * @param {{ sea:number, land:number, edge:number }} [o.colors]
 */
export function createMinimap(o) {
  const cv = o.canvas;
  const ctx = cv.getContext("2d");
  const samples = sphereSamples(1400).map((d) => ({ d, land: !!o.isLand(d) }));
  const colors = { sea: "#2f78b8", land: "#7fbf6a", edge: "#f5e9c8", ...(o.colors || {}) };
  let t = 0;
  function draw(dt = 0.25) {
    t += dt;
    const W = cv.width,
      H = cv.height,
      R = Math.min(W, H) / 2 - 3,
      cx = W / 2,
      cy = H / 2;
    const v = o.view();
    const B = viewBasis(v.f, v.n);
    ctx.clearRect(0, 0, W, H);
    // The sea, shaded as a globe.
    const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R);
    g.addColorStop(0, colors.sea);
    g.addColorStop(1, "#0d2c4d");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    // Land: sampled dots, dimmer toward the rim.
    const dotR = Math.max(1.6, R * 0.07);
    for (const s of samples) {
      if (!s.land) continue;
      const p = project(s.d, B);
      if (!p.front) continue;
      const z = Math.sqrt(Math.max(0, 1 - p.x * p.x - p.y * p.y));
      ctx.globalAlpha = 0.45 + 0.55 * z;
      ctx.fillStyle = colors.land;
      ctx.beginPath();
      ctx.arc(cx + p.x * R, cy - p.y * R, dotR * (0.55 + 0.45 * z), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const w = o.world();
    const at = (d) => {
      const p = project(d, B);
      return { x: cx + p.x * R, y: cy - p.y * R, front: p.front };
    };
    // Territory: a soft disc of the owner's colour round each city.
    for (const c of w.cities) {
      const p = at(c.d);
      if (!p.front || c.color == null) continue;
      ctx.fillStyle = hex(c.color);
      ctx.globalAlpha = 0.28;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // World events with a place: a slow ring.
    for (const e of w.events || []) {
      const p = at(e.d);
      if (!p.front) continue;
      ctx.strokeStyle = hex(e.color ?? 0xffd36a);
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 3);
      ctx.beginPath();
      ctx.arc(p.x, p.y, R * (0.12 + 0.05 * Math.sin(t * 2)), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Derricks.
    for (const gz of w.geysers) {
      const p = at(gz.d);
      if (!p.front) continue;
      ctx.fillStyle = gz.color == null ? "#c9a46a" : hex(gz.color);
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    // Vehicles: military ones a little bigger.
    for (const u of w.vehicles) {
      const p = at(u.d);
      if (!p.front) continue;
      ctx.fillStyle = hex(u.color);
      ctx.beginPath();
      ctx.arc(p.x, p.y, u.military ? 1.9 : 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Cities on top: white rim for yours, a star for your capital, a red pulse when attacked.
    for (const c of w.cities) {
      const p = at(c.d);
      if (!p.front) continue;
      const r = c.capital ? 4.2 : 3.4;
      if (c.attacked) {
        ctx.strokeStyle = "#ff4b48";
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 8);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 3.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = c.color == null ? "#d8d2c0" : hex(c.color);
      ctx.strokeStyle = c.yours ? "#ffffff" : "#2a1d12";
      ctx.lineWidth = c.yours ? 1.6 : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // The rim and a centre cross where the camera looks.
    ctx.strokeStyle = colors.edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#ffffffaa";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy);
    ctx.lineTo(cx + 5, cy);
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx, cy + 5);
    ctx.stroke();
  }
  const onTap = (e) => {
    const r = cv.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const v = o.view();
    o.onPick(unproject(x * 1.04, y * 1.04, viewBasis(v.f, v.n)));
  };
  cv.addEventListener("click", onTap);
  return {
    draw,
    dispose() {
      cv.removeEventListener("click", onTap);
    },
  };
}

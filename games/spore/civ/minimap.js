/**
 * The planet map: a flat chart of the whole world (continents, oceans, cities, spice, your view) that
 * doubles as navigation: tap or drag on it and the camera flies there. Drawn from the same planet data as
 * the 3D view, in slices so opening the stage is never held up.
 */
import { PLANET, inBounds } from "./planet-map.js";

const { R, LAT_MAX } = PLANET;
const HALF_W = Math.PI * R,
  Z_MAX = R * LAT_MAX;

/**
 * @param {object} map
 * @param {{ width?: number, onPick?: (x:number, z:number) => void }} o
 */
export function createMinimap(map, { width = 168, onPick = () => {} } = {}) {
  const height = Math.round((width * (2 * Z_MAX)) / (2 * HALF_W));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const el = document.createElement("div");
  el.className = "cvMini";
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", "Planet map. Tap a place to move the camera there.");
  const base = document.createElement("canvas"),
    top = document.createElement("canvas");
  for (const c of [base, top]) {
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    c.style.width = width + "px";
    c.style.height = height + "px";
  }
  top.style.position = "absolute";
  top.style.left = "0";
  top.style.top = "0";
  el.style.width = width + "px";
  el.style.height = height + "px";
  el.append(base, top);
  const bctx = base.getContext("2d"),
    tctx = top.getContext("2d");
  const toPx = (x, z) => [((x + HALF_W) / (2 * HALF_W)) * base.width, ((z + Z_MAX) / (2 * Z_MAX)) * base.height];
  const fromPx = (px, py) => [(px / base.width) * 2 * HALF_W - HALF_W, (py / base.height) * 2 * Z_MAX - Z_MAX];

  // Paint the terrain a few rows at a time.
  const img = bctx.createImageData(base.width, base.height);
  let row = 0,
    timer = 0,
    disposed = false;
  const paint = () => {
    if (disposed) return;
    const t0 = performance.now();
    while (row < base.height && performance.now() - t0 < 6) {
      for (let px = 0; px < base.width; px++) {
        const [x, z] = fromPx(px + 0.5, row + 0.5);
        const o = (row * base.width + px) * 4;
        if (!inBounds(x, z, 0)) {
          img.data[o + 3] = 0;
          continue;
        }
        const { lon, lat } = { lon: x / (R * Math.cos(-z / R)), lat: -z / R };
        const h = map.heightLL(lon, lat);
        const c = map.colorLL(lon, lat, h, 0);
        img.data[o] = (c >> 16) & 255;
        img.data[o + 1] = (c >> 8) & 255;
        img.data[o + 2] = c & 255;
        img.data[o + 3] = 255;
      }
      row++;
    }
    bctx.putImageData(img, 0, 0);
    if (row < base.height) timer = setTimeout(paint, 0);
  };
  paint();

  let dragging = false;
  const pick = (e) => {
    const r = el.getBoundingClientRect();
    const [x, z] = fromPx(((e.clientX - r.left) / r.width) * base.width, ((e.clientY - r.top) / r.height) * base.height);
    if (inBounds(x, z, 0)) onPick(x, z);
  };
  el.addEventListener("pointerdown", (e) => {
    dragging = true;
    el.setPointerCapture?.(e.pointerId);
    e.stopPropagation();
    pick(e);
  });
  el.addEventListener("pointermove", (e) => dragging && pick(e));
  const end = () => (dragging = false);
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick(map.citySites[0].x, map.citySites[0].z);
    }
  });

  return {
    el,
    /**
     * Draw the live layer.
     * @param {{cities:Array<{x:number,z:number,color:string}>, spice:Array<{x:number,z:number,color:string|null}>, units:Array<{x:number,z:number,color:string}>, view:{x:number,z:number,r:number}}} s
     */
    draw(s) {
      const w = top.width,
        h = top.height,
        k = dpr;
      tctx.clearRect(0, 0, w, h);
      for (const g of s.spice) {
        const [x, y] = toPx(g.x, g.z);
        tctx.fillStyle = g.color || "#ffa14a";
        tctx.strokeStyle = "#0008";
        tctx.lineWidth = k;
        tctx.beginPath();
        tctx.moveTo(x, y - 3.2 * k);
        tctx.lineTo(x + 2.8 * k, y);
        tctx.lineTo(x, y + 3.2 * k);
        tctx.lineTo(x - 2.8 * k, y);
        tctx.closePath();
        tctx.fill();
        tctx.stroke();
      }
      for (const c of s.cities) {
        const [x, y] = toPx(c.x, c.z);
        tctx.fillStyle = c.color;
        tctx.strokeStyle = "#fff";
        tctx.lineWidth = 1.2 * k;
        tctx.beginPath();
        tctx.arc(x, y, 3.4 * k, 0, 6.2832);
        tctx.fill();
        tctx.stroke();
      }
      for (const u of s.units) {
        const [x, y] = toPx(u.x, u.z);
        tctx.fillStyle = u.color;
        tctx.fillRect(x - 1 * k, y - 1 * k, 2 * k, 2 * k);
      }
      const [vx, vy] = toPx(s.view.x, s.view.z);
      tctx.strokeStyle = "#fff";
      tctx.lineWidth = 1.5 * k;
      tctx.beginPath();
      tctx.arc(vx, vy, Math.max(4 * k, (s.view.r / (2 * HALF_W)) * w), 0, 6.2832);
      tctx.stroke();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      el.remove();
    },
  };
}

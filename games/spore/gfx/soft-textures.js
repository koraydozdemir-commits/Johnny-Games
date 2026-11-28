/**
 * Soft glow textures built from numbers rather than a 2D canvas.
 *
 * iPhones and iPads keep canvas colour premultiplied by alpha, so the faint edge of a soft gradient
 * comes back as speckles of random colour (pink, green, blue) once it is un-premultiplied. A
 * DataTexture holds exactly the values we write, so glows stay clean.
 */
import * as THREE from "three";

/** "rgba(255,200,100,0.5)" -> [r, g, b, a] (0..255, a 0..1). */
export function parseRgba(css) {
  const m = /rgba?\(([^)]+)\)/.exec(css);
  if (!m) return [255, 255, 255, 1];
  const p = m[1].split(",").map((v) => parseFloat(v));
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

/**
 * A round glow. `stops` are [position 0..1 from centre, "rgba(...)"] pairs, as with canvas gradients.
 * Colour and alpha are interpolated separately (never premultiplied).
 */
export function radialGlowTexture(size, stops) {
  const parsed = stops.map(([t, css]) => [t, parseRgba(css)]);
  const data = new Uint8Array(size * size * 4);
  const at = (t) => {
    if (t <= parsed[0][0]) return parsed[0][1];
    for (let i = 1; i < parsed.length; i++) {
      const [t1, c1] = parsed[i];
      if (t <= t1) {
        const [t0, c0] = parsed[i - 1];
        const k = (t - t0) / Math.max(1e-6, t1 - t0);
        return c0.map((v, j) => v + (c1[j] - v) * k);
      }
    }
    return parsed[parsed.length - 1][1];
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const t = Math.min(1, Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2));
      const c = at(t),
        i = (y * size + x) * 4;
      data[i] = Math.round(c[0]);
      data[i + 1] = Math.round(c[1]);
      data[i + 2] = Math.round(c[2]);
      data[i + 3] = Math.round(c[3] * 255);
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

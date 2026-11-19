/**
 * The tide pool around the gameplay layer.
 *
 *  - Floor: a sandy, weedy pool bed drawn by one shader in world space (with a little parallax, as it
 *    lies deeper than the cells), lit by animated caustics, with soft shafts of sunlight from above.
 *  - Shimmer: a faint additive caustic layer over everything, so light ripples across the cells too.
 *  - Marine snow: slow drifting specks for depth.
 *  - Water pass (createWaterFx): an optional full-screen pass that gently wobbles the picture, as if
 *    seen through moving water. It also applies tone mapping, since the scene is rendered into a
 *    texture first.
 *
 * Everything is endless: the shaders sample world coordinates and the snow wraps around the view.
 */
import * as THREE from "three";

const BED_SIZE = 96; // world units per tile of the baked bed
const NOISE = /* glsl */ `
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  float hash1(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash1(i), hash1(i + vec2(1, 0)), u.x), mix(hash1(i + vec2(0, 1)), hash1(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }
  // Caustics from a moving cellular pattern: light gathers where two cells meet, giving the bright
  // wandering web seen on the floor of shallow water.
  float causticLayer(vec2 p, float t) {
    p += 0.18 * vec2(sin(p.y * 1.7 + t * 0.8), cos(p.x * 1.5 - t * 0.7));
    vec2 g = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 h = hash2(g + o);
        h = 0.5 + 0.42 * sin(t * 0.75 + 6.2831 * h);
        float d = length(o + h - f);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
      }
    return 1.0 - smoothstep(0.0, 0.07, d2 - d1);
  }
  float caustics(vec2 p, float t, float detail) {
    float c = pow(causticLayer(p, t), 1.6);
    if (detail > 0.5) c = c * 0.7 + pow(causticLayer(p * 1.55 + 3.7, t * 1.25), 1.6) * 0.45;
    return c;
  }
`;

const FLOOR_FRAG = /* glsl */ `
  uniform vec2 uCam;
  uniform vec2 uHalf;
  uniform float uTime;
  uniform float uDetail;
  uniform sampler2D uBed;
  uniform vec3 uWater;
  uniform vec3 uTint;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    // The bed lies deeper than the cells, so it slides past a little slower (parallax 0.82).
    vec2 wp = uCam * 0.82 + (vUv - 0.5) * 2.0 * uHalf;
    vec4 bed = texture2D(uBed, wp / BED_SIZE);
    vec3 col = bed.rgb * 0.25;
    // Caustics, brightest on the shallow sandy patches.
    float sandy = smoothstep(0.08, 0.17, col.g);
    float c = caustics(wp * 0.55 + vec2(uTime * 0.02, -uTime * 0.015), uTime, uDetail);
    col += uWater * c * (0.06 + 0.08 * sandy);
    // Sun shafts: soft diagonal bands from the top of the screen that sway slowly.
    float shafts = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float band = vUv.x + (1.0 - vUv.y) * 0.38 + sin(uTime * 0.13 + fi * 2.1) * 0.06;
      shafts += smoothstep(0.07, 0.0, abs(fract(band * 1.6 + fi * 0.37) - 0.5) - 0.02) * (0.5 + 0.5 * sin(uTime * 0.21 + fi));
    }
    col += uWater * 0.85 * shafts * 0.035 * smoothstep(0.0, 1.0, vUv.y);
    vec2 q = vUv - 0.5;
    col *= uTint;
    col *= 1.0 - dot(q, q) * 0.55;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`.replace("BED_SIZE", BED_SIZE.toFixed(1));

const SHIMMER_FRAG = /* glsl */ `
  uniform vec2 uCam;
  uniform vec2 uHalf;
  uniform float uTime;
  uniform float uStrength;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    vec2 wp = uCam + (vUv - 0.5) * 2.0 * uHalf;
    float c = pow(causticLayer(wp * 0.3 + vec2(-uTime * 0.03, uTime * 0.02), uTime * 0.9), 2.0);
    gl_FragColor = vec4(vec3(0.55, 0.9, 1.0) * c * uStrength, 1.0);
    #include <colorspace_fragment>
  }
`;

/* ---- Baked pool bed ------------------------------------------------------
   The sand, weed patches and ripples never move, so they are drawn once into a seamlessly tiling
   texture (periodic value noise) instead of being recomputed per pixel every frame. Colours are linear. */
function periodicNoise(period, seed) {
  const grid = new Float32Array(period * period);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < grid.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    grid[i] = s / 4294967296;
  }
  const at = (x, y) => grid[(((y % period) + period) % period) * period + (((x % period) + period) % period)];
  return (x, y) => {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      fx = x - xi,
      fy = y - yi;
    const u = fx * fx * (3 - 2 * fx),
      v = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi),
      b = at(xi + 1, yi),
      c = at(xi, yi + 1),
      d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
function bakeBed(size) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(size, size);
  const n4 = periodicNoise(4, 7),
    n8 = periodicNoise(8, 19),
    n16 = periodicNoise(16, 31),
    n32 = periodicNoise(32, 43),
    n64 = periodicNoise(64, 59),
    w4 = periodicNoise(4, 71),
    w8 = periodicNoise(8, 83);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const deep = [0.012, 0.07, 0.13],
    sand = [0.06, 0.17, 0.21],
    weed = [0.02, 0.11, 0.1];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      const broad = n4(u * 4, v * 4) * 0.55 + n8(u * 8, v * 8) * 0.3 + n16(u * 16, v * 16) * 0.15;
      const fine = n32(u * 32, v * 32) * 0.6 + n64(u * 64, v * 64) * 0.4;
      const weedy = smooth(0.55, 0.85, w4(u * 4, v * 4) * 0.65 + w8(u * 8, v * 8) * 0.35) * 0.55;
      const sandy = smooth(0.25, 0.75, broad);
      const ripple = Math.sin((u * 0.8 + v * 0.45) * Math.PI * 2 * 9 + fine * 5) * 0.5 + 0.5;
      const shade = (0.9 + ripple * 0.12 + (fine - 0.5) * 0.18) * (0.94 + n64(u * 64 + 3, v * 64 + 5) * 0.12);
      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) {
        const c = lerp(lerp(deep[k], sand[k], sandy), weed[k], weedy) * shade;
        img.data[i + k] = Math.min(255, Math.round(c * 4 * 255)); // stored x4 for precision, undone in the shader
      }
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.premultiplyAlpha = false;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

const SCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const PLANE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

function softDotTexture(size = 64, inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const x = cv.getContext("2d");
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

const SNOW_W = 200,
  SNOW_H = 130,
  SNOW_PARALLAX = 0.45;
/** Keep `v` within half a tile of `centre` by whole-tile steps. */
const wrap = (v, centre, span) => v - Math.round((v - centre) / span) * span;

const SETTINGS = {
  low: { snow: 60, detail: 0, shimmer: 0 },
  medium: { snow: 110, detail: 0, shimmer: 0.035 },
  high: { snow: 170, detail: 1, shimmer: 0.045 },
};

export function createBackground(scene, quality = "high") {
  const root = new THREE.Group();
  scene.add(root);

  const shared = { uCam: { value: new THREE.Vector2() }, uHalf: { value: new THREE.Vector2(10, 6) }, uTime: { value: 0 } };
  const floorMat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uDetail: { value: 1 }, uBed: { value: bakeBed(512) }, uWater: { value: new THREE.Vector3(0.3, 0.62, 0.72) }, uTint: { value: new THREE.Vector3(1, 1, 1) } },
    vertexShader: PLANE_VERT,
    fragmentShader: FLOOR_FRAG,
    depthWrite: false,
  });
  // A unit plane scaled to the view each frame; it sits far behind everything.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), floorMat);
  floor.position.z = -24;
  floor.renderOrder = -100;
  floor.frustumCulled = false;
  root.add(floor);

  const shimmerMat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uStrength: { value: 0.1 } },
    vertexShader: PLANE_VERT,
    fragmentShader: SHIMMER_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const shimmer = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shimmerMat);
  shimmer.position.z = 8;
  shimmer.renderOrder = 900;
  shimmer.frustumCulled = false;
  root.add(shimmer);

  const glowTexture = softDotTexture(128, "rgba(255,255,255,0.7)", "rgba(110,190,255,0)");
  const snowTexture = softDotTexture(32, "rgba(220,245,255,0.9)", "rgba(220,245,255,0)");

  let snow = null,
    wrapTimer = 0;
  function populate(q) {
    const settings = SETTINGS[q] || SETTINGS.high;
    floorMat.uniforms.uDetail.value = settings.detail;
    shimmerMat.uniforms.uStrength.value = settings.shimmer;
    shimmer.visible = settings.shimmer > 0;
    if (snow) {
      root.remove(snow);
      snow.geometry.dispose();
      snow.material.dispose();
    }
    const pts = [];
    for (let i = 0; i < settings.snow; i++) pts.push((Math.random() - 0.5) * SNOW_W, (Math.random() - 0.5) * SNOW_H, -8 - Math.random() * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    snow = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 3.2, sizeAttenuation: false, map: snowTexture, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    snow.renderOrder = -90;
    root.add(snow);
  }
  populate(quality);

  return {
    glowTexture,
    setQuality: populate,
    /**
     * Make the soup the homeworld's own water: its colour lights the caustics and sun shafts and tints the
     * sea bed; the deep colour behind everything follows it. Passing null restores the default.
     */
    setPlanet(profile) {
      const w = profile ? new THREE.Color(profile.water.color) : null;
      const ref = [0.3, 0.62, 0.72];
      if (!w) {
        floorMat.uniforms.uWater.value.set(...ref);
        floorMat.uniforms.uTint.value.set(1, 1, 1);
        scene.background = new THREE.Color("#12396a");
        return;
      }
      const m = Math.max(w.r, w.g, w.b, 0.01);
      const lit = [w.r / m, w.g / m, w.b / m].map((v) => 0.12 + v * 0.62);
      floorMat.uniforms.uWater.value.set(...lit);
      // Tint the bed gently towards the water: half way between untinted and the water's own ratio to the default.
      floorMat.uniforms.uTint.value.set(...lit.map((v, i) => 0.5 + 0.5 * Math.min(1.6, Math.max(0.55, v / ref[i]))));
      scene.background = new THREE.Color("#12396a").lerp(w.clone().multiplyScalar(0.35), 0.75);
    },
    update(time, dt, camera) {
      const cx = camera.position.x,
        cy = camera.position.y;
      const halfW = (camera.right - camera.left) / 2 / camera.zoom,
        halfH = (camera.top - camera.bottom) / 2 / camera.zoom;
      shared.uCam.value.set(cx, cy);
      shared.uHalf.value.set(halfW, halfH);
      shared.uTime.value = time;
      floor.position.set(cx, cy, -24);
      floor.scale.set(halfW, halfH, 1);
      shimmer.position.set(cx, cy, 8);
      shimmer.scale.set(halfW, halfH, 1);
      snow.position.x = cx * SNOW_PARALLAX;
      snow.position.y = cy * SNOW_PARALLAX + Math.sin(time * 0.15) * 0.6;
      // Every half second, move snow that fell a full tile behind the view to the far side; it is
      // always off screen when it jumps, so the drift looks endless.
      wrapTimer -= dt;
      if (wrapTimer > 0) return;
      wrapTimer = 0.5;
      const pos = snow.geometry.attributes.position;
      const ox = cx * (1 - SNOW_PARALLAX),
        oy = cy * (1 - SNOW_PARALLAX);
      let moved = false;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i),
          y = pos.getY(i);
        const nx = wrap(x, ox, SNOW_W),
          ny = wrap(y, oy, SNOW_H);
        if (nx !== x || ny !== y) {
          pos.setXY(i, nx, ny);
          moved = true;
        }
      }
      if (moved) pos.needsUpdate = true;
    },
  };
}

/* ---- Water pass ---------------------------------------------------------- */

const WATER_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform float uAmp;
  uniform float uAspect;
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv;
    // Two slow swells and a finer ripple, at most a few pixels, so play stays readable.
    float a = uAmp;
    uv.x += sin(uv.y * 9.0 + uTime * 0.9) * a + sin((uv.y + uv.x * 0.3) * 23.0 - uTime * 1.7) * a * 0.45;
    uv.y += cos(uv.x * uAspect * 8.0 - uTime * 0.8) * a * 0.8 + sin((uv.x - uv.y * 0.4) * 27.0 + uTime * 1.5) * a * 0.35;
    gl_FragColor = texture2D(tDiffuse, clamp(uv, 0.001, 0.999));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Renders the scene into a texture and draws it back with a gentle underwater wobble.
 * When disabled it is a plain renderer.render(scene, camera).
 */
export function createWaterFx(renderer) {
  const caps = renderer.capabilities;
  const canHalf = caps.isWebGL2 && (renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float"));
  const size = new THREE.Vector2();
  let target = null,
    enabled = false,
    samples = 0;
  const material = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmp: { value: 0.0016 }, uAspect: { value: 1 } },
    vertexShader: SCREEN_VERT,
    fragmentShader: WATER_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const ensureTarget = () => {
    renderer.getDrawingBufferSize(size);
    if (target && target.width === size.x && target.height === size.y && target.samples === samples) return;
    target?.dispose();
    target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples: caps.isWebGL2 ? samples : 0,
      depthBuffer: true,
    });
    material.uniforms.tDiffuse.value = target.texture;
  };

  return {
    /** quality: "low" turns the pass off; "medium" and "high" keep it, with less anti-aliasing on medium. */
    setQuality(q) {
      enabled = q !== "low";
      samples = q === "high" ? 4 : 2;
      if (!enabled && target) {
        target.dispose();
        target = null;
      }
    },
    render(scene, camera, time, active = true) {
      if (!enabled || !active) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }
      ensureTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      material.uniforms.uTime.value = time;
      material.uniforms.uAspect.value = size.x / Math.max(1, size.y);
      renderer.render(quadScene, quadCamera);
    },
  };
}

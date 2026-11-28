/**
 * Original 3D models for every cell part.
 *
 * Conventions: the part's origin sits on the membrane, +x points straight out of the cell and
 * +z is towards the camera. Each model is merged into as few meshes as possible (usually one)
 * using vertex colours and the shared part material, so a part costs one draw call.
 * Geometry is cached per part / tint / detail, so a hundred cells share the same buffers.
 */
import * as THREE from "three";
import { matrixOf, mergePieces, taperedTube } from "./geom-utils.js";
import { getPartMaterial } from "./materials.js";
import { partDef } from "../part-defs.js";

const sphereCache = new Map();
function unitSphere(detail) {
  if (!sphereCache.has(detail)) sphereCache.set(detail, new THREE.SphereGeometry(1, detail * 2, detail + 2));
  return sphereCache.get(detail);
}

const tint = (color, other, t) => new THREE.Color(color).lerp(new THREE.Color(other), t).getHex();
const lighten = (c, t = 0.4) => tint(c, 0xffffff, t);
const darken = (c, t = 0.45) => tint(c, 0x0a1230, t);

/** Piece factories (all in part space, +x outward). */
const blob = (detail, color, x, y, z, sx, sy = sx, sz = sx) => ({ geometry: unitSphere(detail), color, matrix: matrixOf({ x, y, z, sx, sy, sz }) });
function coneAlong(len, radius, color, { x = 0, y = 0, z = 0, angle = 0, seg = 8 } = {}) {
  const g = new THREE.ConeGeometry(radius, len, seg);
  g.translate(0, len / 2, 0);
  return { geometry: g, color, matrix: matrixOf({ x, y, z, rz: angle - Math.PI / 2 }) };
}
function ringFacingX(radius, tube, color, { x = 0, y = 0, z = 0, seg = 18, sy = 1, sz = 1 } = {}) {
  return { geometry: new THREE.TorusGeometry(radius, tube, 7, seg), color, matrix: matrixOf({ x, y, z, ry: Math.PI / 2, sx: 1, sy, sz }) };
}
const hose = (pts, radius, color, { swayAmp = 0, radial = 7, segments = 16, colorTip } = {}) => ({
  geometry: taperedTube(
    pts.map((p) => new THREE.Vector3(...p)),
    typeof radius === "number" ? () => radius : radius,
    { radial, segments, swayAmp },
  ),
  color,
  colorTip,
  swayMax: Math.abs(swayAmp) || 1,
});
function funnel(profile, color, { x = 0, sides = 14 } = {}) {
  // profile: [[radius, distanceAlongX], ...]; lathe axis is Y, rotated onto +x.
  const g = new THREE.LatheGeometry(
    profile.map(([r, h]) => new THREE.Vector2(r, h)),
    sides,
  );
  return { geometry: g, color, matrix: matrixOf({ x, rz: -Math.PI / 2 }) };
}

/** Per-part builders. `c` is the part colour (already tinted towards the body). Return pieces or groups. */
const BUILDERS = {
  filter(c, o) {
    const outer = funnel([[0.1, 0], [0.16, 0.1], [0.27, 0.3], [0.3, 0.34]], c, { sides: o.sides });
    const inner = funnel([[0.0, 0.05], [0.12, 0.14], [0.23, 0.31]], darken(c, 0.6), { sides: o.sides });
    const pieces = [outer, inner, ringFacingX(0.285, 0.03, lighten(c, 0.5), { x: 0.34, seg: o.sides * 2 })];
    const hairs = o.detail > 0 ? 8 : 5;
    for (let i = 0; i < hairs; i++) {
      const a = (i / hairs) * Math.PI * 2;
      const y = Math.cos(a) * 0.27,
        z = Math.sin(a) * 0.27;
      pieces.push(hose([[0.34, y, z], [0.46, y * 1.15, z * 1.15], [0.58, y * 1.5, z * 1.5]], (t) => 0.02 * (1 - t * 0.7), lighten(c, 0.55), { swayAmp: 0.05, radial: 4, segments: 6 }));
    }
    return { pieces: [pieces] };
  },
  jaw(c, o) {
    const tooth = lighten(c, 0.8);
    const build = (side) => {
      const arc = [[0, side * 0.13, 0], [0.2, side * 0.3, 0], [0.42, side * 0.26, 0], [0.56, side * 0.07, 0]];
      const curve = new THREE.CatmullRomCurve3(arc.map((p) => new THREE.Vector3(...p)), false, "centripetal");
      const pieces = [
        hose(arc, (t) => 0.085 * (1 - t * 0.78), c, { radial: o.detail ? 8 : 6, segments: 14 }),
        blob(o.detail ? 4 : 3, darken(c, 0.25), 0.04, side * 0.12, 0, 0.12, 0.11, 0.13),
      ];
      for (const u of [0.38, 0.52, 0.66, 0.8]) {
        const p = curve.getPointAt(u),
          tan = curve.getTangentAt(u);
        // Teeth point inwards (towards the mouth axis) and slightly forward.
        const angle = Math.atan2(-side * 1, 0.5) + Math.atan2(tan.y, tan.x) * 0;
        pieces.push(coneAlong(0.11, 0.03, tooth, { x: p.x, y: p.y - side * 0.05, z: 0.02, angle, seg: 5 }));
      }
      return pieces;
    };
    return { pieces: [build(1), build(-1)], jaws: true };
  },
  proboscis(c, o) {
    const pieces = [
      hose([[-0.02, 0, 0], [0.22, 0.09, 0.02], [0.45, -0.07, 0.03], [0.68, 0.04, 0.04]], (t) => 0.1 - t * 0.045, c, { swayAmp: 0.1, radial: o.detail ? 9 : 6, segments: 20, colorTip: lighten(c, 0.35) }),
      blob(o.detail ? 5 : 3, lighten(c, 0.3), 0.7, 0.04, 0.04, 0.095, 0.095, 0.09),
    ];
    const bumps = o.detail ? 6 : 3;
    for (let i = 0; i < bumps; i++) {
      const a = (i / bumps) * Math.PI * 2;
      pieces.push(blob(2, darken(c, 0.25), 0.74, 0.04 + Math.cos(a) * 0.075, 0.04 + Math.sin(a) * 0.075, 0.028));
    }
    return { pieces: [pieces] };
  },
  cilia(c, o) {
    const pieces = [{ ...blob(3, darken(c, 0.35), 0.02, 0, 0, 0.07, 0.3, 0.07) }];
    const hairs = o.detail ? 9 : 6;
    for (let i = 0; i < hairs; i++) {
      const spread = (i / (hairs - 1) - 0.5) * 2,
        y = spread * 0.26;
      const len = 0.36 + (1 - Math.abs(spread)) * 0.14;
      pieces.push(hose([[0, y, 0], [len * 0.5, y + spread * 0.12, 0.02], [len, y + spread * 0.3, 0.04]], (t) => 0.026 * (1 - t * 0.75), c, { swayAmp: 0.11, radial: 4, segments: 8, colorTip: lighten(c, 0.5) }));
    }
    return { pieces: [pieces] };
  },
  flagellum(c, o) {
    const pieces = [
      hose([[-0.02, 0, 0], [0.16, 0.012, 0.01], [0.33, -0.016, 0.02], [0.5, 0.012, 0.03], [0.66, -0.01, 0.04]], (t) => 0.042 * (1 - t * 0.85) + 0.005, c, { swayAmp: 0.17, radial: o.detail ? 8 : 5, segments: 26, colorTip: lighten(c, 0.45) }),
      blob(o.detail ? 4 : 3, darken(c, 0.2), 0.02, 0, 0, 0.07, 0.06, 0.055),
    ];
    return { pieces: [pieces] };
  },
  jet(c, o) {
    const nozzle = funnel([[0.14, 0], [0.18, 0.1], [0.14, 0.26], [0.17, 0.3]], c, { sides: o.sides });
    const core = blob(o.detail ? 4 : 3, 0xfff1c3, 0.2, 0, 0, 0.1);
    return { pieces: [[nozzle, core, ringFacingX(0.17, 0.03, lighten(c, 0.5), { x: 0.3, seg: o.sides * 2 }), blob(3, darken(c, 0.3), -0.02, 0, 0, 0.16, 0.18, 0.14)]], pulse: true };
  },
  spike(c) {
    return {
      pieces: [[coneAlong(0.62, 0.15, c, { seg: 10 }), coneAlong(0.2, 0.06, lighten(c, 0.4), { x: 0.05, y: 0.12, z: 0, angle: 0.9, seg: 6 }), coneAlong(0.2, 0.06, lighten(c, 0.4), { x: 0.05, y: -0.12, z: 0, angle: -0.9, seg: 6 }), blob(4, darken(c, 0.2), 0, 0, 0, 0.15, 0.17, 0.13)]],
    };
  },
  poison(c, o) {
    const dark = darken(c, 0.4);
    const pieces = [blob(o.detail ? 5 : 3, c, 0.14, 0, 0, 0.2, 0.2, 0.18), blob(3, lighten(c, 0.55), 0.18, 0.06, 0.1, 0.07), blob(3, dark, 0.02, 0, 0, 0.1, 0.12, 0.1)];
    for (let i = 0; i < 4; i++) pieces.push(blob(2, lighten(c, 0.35), 0.3 + i * 0.03, (i % 2 ? 1 : -1) * 0.1 * i * 0.5, 0.04, 0.04 + (i % 2) * 0.02));
    pieces.push(coneAlong(0.16, 0.06, dark, { x: 0.3, angle: 0, seg: 6 }));
    return { pieces: [pieces], pulse: true };
  },
  electric(c, o) {
    const glow = 0xdfe6ff;
    const pieces = [blob(o.detail ? 5 : 3, glow, 0.16, 0, 0, 0.1)];
    for (let i = 0; i < 3; i++) {
      const a = -0.9 + i * 0.9;
      pieces.push(hose([[0.04, 0, 0], [0.18 + Math.cos(a) * 0.12, Math.sin(a) * 0.25, 0.04], [0.34, Math.sin(a) * 0.36, 0.02]], (t) => 0.03 * (1 - t * 0.5), c, { radial: 5, segments: 8 }));
      pieces.push(blob(2, lighten(c, 0.5), 0.34, Math.sin(a) * 0.36, 0.02, 0.045));
    }
    pieces.push(ringFacingX(0.2, 0.025, c, { x: 0.12, seg: o.sides * 2 }), blob(3, darken(c, 0.35), 0.0, 0, 0, 0.12, 0.14, 0.11));
    return { pieces: [pieces], pulse: true };
  },
  eye(c, o) {
    const iris = o.eyeColor ?? 0x4b9fc0;
    const stalk = hose([[-0.02, 0, 0], [0.08, 0.02, 0.03], [0.17, 0, 0.05]], 0.05, darken(o.bodyColor ?? c, 0.1), { radial: 6, segments: 6 });
    const ball = [
      blob(o.detail ? 5 : 4, 0xfff3d9, 0.2, 0, 0.05, 0.15, 0.15, 0.14),
      blob(o.detail ? 4 : 3, iris, 0.22, 0, 0.14, 0.095, 0.095, 0.05),
      blob(3, 0x081420, 0.235, 0, 0.175, 0.05, 0.05, 0.03),
      blob(2, 0xffffff, 0.205, -0.03, 0.2, 0.02),
    ];
    return { pieces: [[stalk], ball], eye: true };
  },
  mito(c) {
    const pieces = [blob(5, c, 0.1, 0, 0, 0.26, 0.15, 0.12)];
    for (let i = 0; i < 4; i++) pieces.push(blob(3, darken(c, 0.35), -0.04 + i * 0.1, 0, 0.1, 0.025, 0.12, 0.05));
    pieces.push(blob(3, lighten(c, 0.5), 0.2, 0.05, 0.1, 0.05));
    return { pieces: [pieces], pulse: true };
  },
  armour(c) {
    const edge = lighten(c, 0.5);
    const plate = (x, y, s, rot) => ({ geometry: new THREE.IcosahedronGeometry(0.2, 0), color: tint(c, edge, 0.15 + Math.abs(y)), matrix: matrixOf({ x, y, z: 0.04, rz: rot, sx: s * 1.15, sy: s * 0.95, sz: s * 0.4 }) });
    return { pieces: [[plate(0.05, 0, 1.1, 0), plate(0.18, 0.2, 0.85, 0.5), plate(0.18, -0.2, 0.85, -0.5), plate(0.3, 0, 0.62, 0), ringFacingX(0.2, 0.02, edge, { x: 0.02, seg: 12, sy: 1, sz: 1 })]] };
  },
};

const modelCache = new Map();
const MAX_MODELS = 96;

/**
 * Build (or reuse) a part model.
 * @param {string} id part id
 * @param {{ bodyColor?: number, eyeColor?: number, quality?: 'low'|'medium'|'high' }} opts
 * @returns {{ group: THREE.Group, jaws: THREE.Object3D[]|null, pulse: boolean, eye: boolean }}
 */
export function createPartModel(id, opts = {}) {
  const def = partDef(id);
  const builder = BUILDERS[id];
  if (!def || !builder) throw new Error("Unknown part: " + id);
  const quality = opts.quality || "high";
  const colour = tint(def.col, opts.bodyColor ?? def.col, opts.bodyColor === undefined ? 0 : 0.12);
  const key = [id, colour, opts.eyeColor ?? "", quality].join(":");
  let entry = modelCache.get(key);
  if (!entry) {
    const detail = quality === "low" ? 0 : 1;
    const result = builder(colour, { detail, sides: quality === "low" ? 8 : 14, eyeColor: opts.eyeColor, bodyColor: opts.bodyColor });
    // Every part gets a soft collar so it reads as grown out of the membrane rather than glued on.
    const collarColour = darken(opts.bodyColor ?? colour, 0.18);
    if (!result.jaws) result.pieces[0].push(blob(3, collarColour, -0.015, 0, 0, 0.085, 0.17, 0.12));
    entry = { geometries: result.pieces.map((pieces) => mergePieces(pieces)), jaws: !!result.jaws, pulse: !!result.pulse, eye: !!result.eye };
    entry.geometries.forEach((g) => (g.userData.shared = true));
    if (modelCache.size >= MAX_MODELS) {
      const oldest = modelCache.keys().next().value;
      modelCache.get(oldest).geometries.forEach((g) => g.dispose());
      modelCache.delete(oldest);
    }
    modelCache.set(key, entry);
  }
  const group = new THREE.Group();
  group.userData.type = id;
  const material = getPartMaterial();
  const meshes = entry.geometries.map((geometry) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  });
  return { group, meshes, jaws: entry.jaws ? meshes : null, pulse: entry.pulse, eye: entry.eye };
}

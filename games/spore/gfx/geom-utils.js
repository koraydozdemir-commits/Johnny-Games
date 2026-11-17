/**
 * Small geometry helpers for building one merged, vertex-coloured mesh out of many primitives.
 * Merging is what keeps a whole organ (or a whole cell interior) down to a single draw call.
 */
import * as THREE from "three";

const tmpNormalMatrix = new THREE.Matrix3();
const tmpColor = new THREE.Color();

/**
 * @typedef {{ geometry: THREE.BufferGeometry, color?: number, matrix?: THREE.Matrix4,
 *             sway?: number, colorTip?: number }} Piece
 * `sway` is a per-piece vertex-shader bend amplitude (0 = rigid). For pieces that carry their own
 * `aSway` attribute (tubes) it is ignored. `colorTip` blends towards a second colour along `aSway`.
 */

/** Merge pieces into one indexed BufferGeometry with position, normal, color and aSway attributes. */
export function mergePieces(pieces) {
  let vertexCount = 0,
    indexCount = 0;
  const prepared = pieces.map((piece) => {
    const g = piece.geometry;
    const count = g.attributes.position.count;
    const index = g.index ? g.index.array : null;
    vertexCount += count;
    indexCount += index ? index.length : count;
    return { piece, count, index };
  });
  const position = new Float32Array(vertexCount * 3),
    normal = new Float32Array(vertexCount * 3),
    color = new Float32Array(vertexCount * 3),
    sway = new Float32Array(vertexCount),
    indices = new Uint32Array(indexCount);
  let v = 0,
    i = 0;
  const p = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (const { piece, count, index } of prepared) {
    const g = piece.geometry,
      pos = g.attributes.position,
      nor = g.attributes.normal,
      own = g.attributes.aSway;
    const m = piece.matrix || null;
    if (m) tmpNormalMatrix.getNormalMatrix(m);
    const base = tmpColor.setHex(piece.color ?? 0xffffff).clone();
    const tip = piece.colorTip !== undefined ? new THREE.Color(piece.colorTip) : null;
    for (let k = 0; k < count; k++) {
      p.fromBufferAttribute(pos, k);
      // Optional per-vertex pattern, evaluated in the piece's own space (ribs, stripes, growth lines).
      const patterned = piece.colorAt ? piece.colorAt(p.x, p.y, p.z, k) : null;
      if (m) p.applyMatrix4(m);
      position.set([p.x, p.y, p.z], (v + k) * 3);
      if (nor) {
        n.fromBufferAttribute(nor, k);
        if (m) n.applyMatrix3(tmpNormalMatrix).normalize();
        normal.set([n.x, n.y, n.z], (v + k) * 3);
      }
      const s = own ? own.getX(k) : piece.sway ?? 0;
      sway[v + k] = s;
      if (patterned) color.set([patterned.r, patterned.g, patterned.b], (v + k) * 3);
      else if (tip && own) {
        const t = Math.min(1, Math.abs(own.getX(k)) / (piece.swayMax || 1));
        tmpColor.copy(base).lerp(tip, t);
        color.set([tmpColor.r, tmpColor.g, tmpColor.b], (v + k) * 3);
      } else color.set([base.r, base.g, base.b], (v + k) * 3);
    }
    if (index) for (let k = 0; k < index.length; k++) indices[i++] = index[k] + v;
    else for (let k = 0; k < count; k++) indices[i++] = v + k;
    v += count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(position, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  merged.setAttribute("color", new THREE.BufferAttribute(color, 3));
  merged.setAttribute("aSway", new THREE.BufferAttribute(sway, 1));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

export const matrixOf = ({ x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx } = {}) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

/**
 * Tapered tube along a Catmull-Rom curve. `radius(t)` gives the radius at t in [0, 1].
 * The `aSway` attribute holds `t * swayAmp`, which the part material turns into a travelling wave.
 */
export function taperedTube(points, radius, { radial = 7, segments = 18, swayAmp = 0, capEnd = true } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const frames = curve.computeFrenetFrames(segments, false);
  const positions = [],
    normals = [],
    sways = [],
    indices = [];
  const centre = new THREE.Vector3(),
    dir = new THREE.Vector3();
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    curve.getPointAt(t, centre);
    const r = radius(t),
      nrm = frames.normals[s],
      bin = frames.binormals[s];
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      dir.set(0, 0, 0).addScaledVector(nrm, Math.cos(a)).addScaledVector(bin, Math.sin(a));
      positions.push(centre.x + dir.x * r, centre.y + dir.y * r, centre.z + dir.z * r);
      normals.push(dir.x, dir.y, dir.z);
      sways.push(t * swayAmp);
    }
  }
  for (let s = 0; s < segments; s++)
    for (let k = 0; k < radial; k++) {
      const a = s * radial + k,
        b = s * radial + ((k + 1) % radial),
        c = (s + 1) * radial + k,
        d = (s + 1) * radial + ((k + 1) % radial);
      indices.push(a, c, b, b, c, d);
    }
  if (capEnd) {
    const tipIndex = positions.length / 3;
    curve.getPointAt(1, centre);
    positions.push(centre.x, centre.y, centre.z);
    curve.getTangentAt(1, dir);
    normals.push(dir.x, dir.y, dir.z);
    sways.push(swayAmp);
    const last = segments * radial;
    for (let k = 0; k < radial; k++) indices.push(last + k, tipIndex, last + ((k + 1) % radial));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute("aSway", new THREE.Float32BufferAttribute(sways, 1));
  g.setIndex(indices);
  return g;
}

/** Dispose a geometry/material unless it is flagged as shared (cached textures, shared materials). */
export function disposeUnlessShared(resource) {
  if (resource && !resource.userData?.shared && typeof resource.dispose === "function") resource.dispose();
}

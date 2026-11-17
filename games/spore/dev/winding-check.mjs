import * as THREE from "three";
import { PART_MODELS } from "../creature/parts.js";
const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), c = new THREE.Vector3(), cr = new THREE.Vector3();
function signedVolume(geo, matrix) {
  const g = (geo.index ? geo.toNonIndexed() : geo.clone());
  if (matrix) g.applyMatrix4(matrix);
  g.computeBoundingBox(); g.boundingBox.getCenter(c);
  const p = g.attributes.position; let vol = 0;
  for (let i = 0; i < p.count; i += 3) {
    v0.fromBufferAttribute(p, i).sub(c); v1.fromBufferAttribute(p, i + 1).sub(c); v2.fromBufferAttribute(p, i + 2).sub(c);
    vol += v0.dot(cr.crossVectors(v1, v2)) / 6;
  }
  // normal check: do stored normals agree with the winding?
  let agree = 0, disagree = 0;
  if (g.attributes.normal) {
    const n = g.attributes.normal, fn = new THREE.Vector3(), nn = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      v0.fromBufferAttribute(p, i); v1.fromBufferAttribute(p, i + 1); v2.fromBufferAttribute(p, i + 2);
      fn.subVectors(v1, v0).cross(cr.subVectors(v2, v0));
      if (fn.lengthSq() < 1e-14) continue;
      nn.fromBufferAttribute(n, i);
      if (fn.dot(nn) >= 0) agree++; else disagree++;
    }
  }
  return { vol, agree, disagree };
}
const bad = [];
for (const [id, build] of Object.entries(PART_MODELS)) {
  const pieces = [build(0x7fb0d0, 0)].flat(2);
  pieces.forEach((pc, i) => {
    if (!pc || !pc.geometry) return;
    const { vol, agree, disagree } = signedVolume(pc.geometry, pc.matrix);
    const kind = pc.geometry.type;
    if (vol < -1e-7 || disagree > agree * 0.1) bad.push(`${id}[${i}] ${kind} vol=${vol.toExponential(2)} normals agree=${agree} disagree=${disagree}`);
  });
}
console.log(bad.length ? bad.join("\n") : "no inverted pieces");

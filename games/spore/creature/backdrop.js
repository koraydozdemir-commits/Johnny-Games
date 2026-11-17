/**
 * The creature editor's set: a sunny forest clearing instead of a black void, so you design your
 * creature in the world it will live in. Grass with gentle hills, a ring of trees, bushes, rocks,
 * flowers and a mossy stone platform in the middle. Built once per editor session and disposed after.
 */
import * as THREE from "three";
import { makeRng } from "../cell-format.js";

const TAU = Math.PI * 2;

/** Rolling ground: flat in the middle where the creature stands, rising into hills at the edge. */
function groundHeight(x, z) {
  const d = Math.hypot(x, z);
  const hills = Math.max(0, d - 16) ** 1.35 * 0.05;
  return hills + Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.35 * Math.min(1, d / 10);
}

/**
 * @param {THREE.Scene} scene
 * @param {string} quality low | medium | high
 * @returns {{ group: THREE.Group, floorY: number, dispose(): void }}
 */
export function createEditorBackdrop(scene, quality = "medium") {
  const rng = makeRng(424242);
  const group = new THREE.Group();
  scene.add(group);
  const disposables = [];
  const keep = (...items) => (disposables.push(...items), items[0]);
  const detail = quality === "low" ? 0.55 : quality === "medium" ? 0.8 : 1;

  // Sky and haze.
  const sky = new THREE.Color(0xa9dcf2);
  scene.background = sky;
  scene.fog = new THREE.Fog(0xbfe4f2, 34, 95);

  // Ground: a big disc with vertex-coloured grass, lighter in sunlit patches, earthy toward the hills.
  const ground = keep(new THREE.CircleGeometry(130, 96, 0, TAU));
  ground.rotateX(-Math.PI / 2);
  {
    const pos = ground.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color(),
      grass = new THREE.Color(0x5fae4e),
      light = new THREE.Color(0x8fcf63),
      earth = new THREE.Color(0x7a8a4a);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        z = pos.getZ(i);
      pos.setY(i, groundHeight(x, z));
      const n = 0.5 + 0.5 * Math.sin(x * 0.37 + Math.cos(z * 0.29) * 2) * Math.cos(z * 0.41);
      c.copy(grass).lerp(light, n * 0.6).lerp(earth, Math.min(1, Math.max(0, (Math.hypot(x, z) - 22) / 30)));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    ground.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    ground.computeVertexNormals();
  }
  group.add(new THREE.Mesh(ground, keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }))));

  // Mossy stone platform under the creature.
  const plinth = keep(new THREE.CylinderGeometry(4.2, 4.6, 0.35, 40));
  const plinthMat = keep(new THREE.MeshStandardMaterial({ color: 0x9a9483, roughness: 0.9 }));
  const plinthMesh = new THREE.Mesh(plinth, plinthMat);
  plinthMesh.position.y = 0.05;
  group.add(plinthMesh);
  const moss = keep(new THREE.RingGeometry(3.3, 4.25, 40).rotateX(-Math.PI / 2));
  const mossMesh = new THREE.Mesh(moss, keep(new THREE.MeshStandardMaterial({ color: 0x6fae54, roughness: 1 })));
  mossMesh.position.y = 0.235;
  group.add(mossMesh);

  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    p = new THREE.Vector3(),
    s = new THREE.Vector3(),
    up = new THREE.Vector3(0, 1, 0);
  const instanced = (geometry, material, list, place) => {
    const mesh = new THREE.InstancedMesh(keep(geometry), keep(material), list.length);
    list.forEach((o, i) => {
      place(o);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    return mesh;
  };
  const ring = (count, minR, maxR) =>
    Array.from({ length: Math.round(count * detail) }, () => {
      const a = rng() * TAU,
        r = minR + rng() * (maxR - minR);
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, s: 0.7 + rng() * 0.7, r: rng() * TAU, k: rng() };
    });

  // Trees: a forest edge all round, thicker further out.
  const trees = [...ring(30, 21, 28), ...ring(44, 28, 48)];
  instanced(new THREE.CylinderGeometry(0.3, 0.5, 4.5, 7).translate(0, 2.25, 0), new THREE.MeshStandardMaterial({ color: 0x6f5236, roughness: 0.9 }), trees, (o) => {
    p.set(o.x, groundHeight(o.x, o.z) - 0.2, o.z);
    q.setFromAxisAngle(up, o.r);
    s.setScalar(o.s);
  });
  const crowns = instanced(new THREE.IcosahedronGeometry(2.5, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.8 }), trees, (o) => {
    p.set(o.x, groundHeight(o.x, o.z) + 5 * o.s, o.z);
    q.setFromAxisAngle(up, o.r);
    s.set(o.s, o.s * 0.9, o.s);
  });
  const leaf = new THREE.Color();
  trees.forEach((o, i) => crowns.setColorAt(i, leaf.setHSL(0.27 + o.k * 0.08, 0.45, 0.32 + o.k * 0.12)));
  crowns.instanceColor.needsUpdate = true;

  // Bushes with berries, rocks, and flowers scattered across the clearing.
  const bushes = ring(22, 19, 27);
  instanced(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x3f8f52, flatShading: true }), bushes, (o) => {
    p.set(o.x, groundHeight(o.x, o.z) + 0.5 * o.s, o.z);
    q.setFromAxisAngle(up, o.r);
    s.set(o.s * 1.2, o.s * 0.85, o.s * 1.2);
  });
  const berries = bushes.flatMap((b) => [0, 1, 2].map((k) => ({ x: b.x + Math.cos(b.r + k * 2.1) * b.s * 0.9, z: b.z + Math.sin(b.r + k * 2.1) * b.s * 0.9, y: groundHeight(b.x, b.z) + 0.75 * b.s })));
  instanced(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff5a7a, roughness: 0.35, emissive: 0x401020 }), berries, (o) => {
    p.set(o.x, o.y, o.z);
    q.identity();
    s.setScalar(1);
  });
  const rocks = ring(16, 6, 13);
  instanced(new THREE.DodecahedronGeometry(0.7, 0), new THREE.MeshStandardMaterial({ color: 0x8b8679, flatShading: true }), rocks, (o) => {
    p.set(o.x, groundHeight(o.x, o.z) + 0.15, o.z);
    q.setFromEuler(new THREE.Euler(o.r, o.r * 2, 0));
    s.set(o.s, o.s * 0.6, o.s);
  });
  const flowers = ring(90, 4.8, 14);
  const petals = instanced(new THREE.IcosahedronGeometry(0.13, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), flowers, (o) => {
    p.set(o.x, groundHeight(o.x, o.z) + 0.18, o.z);
    q.identity();
    s.setScalar(o.s);
  });
  const palette = [0xffe36a, 0xff8fb1, 0xffffff, 0xb9a2ff, 0xff9a5a];
  flowers.forEach((o, i) => petals.setColorAt(i, leaf.set(palette[Math.floor(o.k * palette.length)])));
  petals.instanceColor.needsUpdate = true;
  // Grass tufts: thin cones that sway as a group.
  const tufts = ring(160, 4.6, 20);
  instanced(new THREE.ConeGeometry(0.06, 0.55, 3).translate(0, 0.27, 0), new THREE.MeshStandardMaterial({ color: 0x4f9a40, roughness: 0.9 }), tufts, (o) => {
    p.set(o.x, groundHeight(o.x, o.z), o.z);
    q.setFromEuler(new THREE.Euler((o.k - 0.5) * 0.4, o.r, (o.k - 0.5) * 0.3));
    s.set(1, o.s, 1);
  });

  // Distant hills ring the horizon.
  const hills = ring(9, 55, 62);
  instanced(new THREE.SphereGeometry(10, 16, 10, 0, TAU, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6aa86a, roughness: 1 }), hills, (o) => {
    p.set(o.x, -1, o.z);
    q.identity();
    s.set(1.4 * o.s, 0.6 * o.s, 1.4 * o.s);
  });

  // Sunlight from the side, so the creature reads with clear shading.
  const hemi = new THREE.HemisphereLight(0xe6f6ff, 0x5a6a3a, 1.15);
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.7);
  sun.position.set(6, 12, 8);
  const rim = new THREE.DirectionalLight(0xbfe4ff, 0.6);
  rim.position.set(-8, 5, -6);
  scene.add(hemi, sun, rim);

  return {
    group,
    /** Height of the platform the creature stands on. */
    floorY: 0.23,
    dispose() {
      scene.remove(group, hemi, sun, rim);
      disposables.forEach((d) => d.dispose());
      scene.fog = null;
    },
  };
}

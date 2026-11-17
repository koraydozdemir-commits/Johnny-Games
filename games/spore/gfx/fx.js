/**
 * Pooled particles: every burst speck and wake bubble in the game lives in one of two instanced
 * meshes, so effects cost two draw calls in total and never allocate geometry or materials while
 * playing (the old effects created a mesh, geometry and material per speck).
 */
import * as THREE from "three";

export function createFxPool(scene, capacity = 600) {
  const make = (geometry, material) => {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = 25;
    scene.add(mesh);
    return mesh;
  };
  const specks = make(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92, depthWrite: false }));
  const bubbles = make(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }));

  // Structure-of-arrays particle store per mesh.
  const store = (mesh) => ({
    mesh,
    n: 0,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    z: new Float32Array(capacity),
    vx: new Float32Array(capacity),
    vy: new Float32Array(capacity),
    vz: new Float32Array(capacity),
    life: new Float32Array(capacity),
    max: new Float32Array(capacity),
    size: new Float32Array(capacity),
    rot: new Float32Array(capacity),
    spin: new Float32Array(capacity),
    color: new Float32Array(capacity * 3),
  });
  const pools = [store(specks), store(bubbles)];
  const tmpColor = new THREE.Color();
  const add = (pool, x, y, z, vx, vy, vz, life, size, color, spin) => {
    // When full, recycle the oldest slot (index 0 is the oldest after compaction).
    let i = pool.n < capacity ? pool.n++ : 0;
    pool.x[i] = x;
    pool.y[i] = y;
    pool.z[i] = z;
    pool.vx[i] = vx;
    pool.vy[i] = vy;
    pool.vz[i] = vz;
    pool.life[i] = pool.max[i] = life;
    pool.size[i] = size;
    pool.rot[i] = Math.random() * 6.28;
    pool.spin[i] = spin;
    tmpColor.set(color);
    pool.color.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
  };

  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    p = new THREE.Vector3(),
    s = new THREE.Vector3();
  return {
    burst(x, y, color = 0xffe5a1, count = 10) {
      for (let k = 0; k < count; k++)
        add(
          pools[0],
          x + (Math.random() - 0.5) * 0.18,
          y + (Math.random() - 0.5) * 0.18,
          0.65 + Math.random() * 0.2,
          (Math.random() - 0.5) * 2.5,
          (Math.random() - 0.5) * 2.5,
          0.2 + Math.random() * 0.8,
          0.38 + Math.random() * 0.5,
          0.025 + Math.random() * 0.04,
          color,
          (Math.random() - 0.5) * 5,
        );
    },
    bubble(x, y, vx, vy, color = 0xb8f5f0) {
      add(pools[1], x, y, 0.3, vx, vy, 0.25, 0.45 + Math.random() * 0.35, 0.045 + Math.random() * 0.055, color, 0);
    },
    update(dt) {
      for (const pool of pools) {
        let w = 0;
        for (let i = 0; i < pool.n; i++) {
          const life = pool.life[i] - dt;
          if (life <= 0) continue;
          // Compact live particles to the front so the instance count stays tight.
          if (w !== i) {
            for (const key of ["x", "y", "z", "vx", "vy", "vz", "max", "size", "rot", "spin"]) pool[key][w] = pool[key][i];
            pool.color.copyWithin(w * 3, i * 3, i * 3 + 3);
          }
          pool.life[w] = life;
          pool.x[w] += pool.vx[w] * dt;
          pool.y[w] += pool.vy[w] * dt;
          pool.z[w] += pool.vz[w] * dt;
          pool.rot[w] += pool.spin[w] * dt;
          const fade = life / pool.max[w];
          const size = pool.size[w] * (0.35 + 0.65 * fade);
          e.set(pool.rot[w], pool.rot[w], 0);
          m.compose(p.set(pool.x[w], pool.y[w], pool.z[w]), q.setFromEuler(e), s.set(size, size, size));
          pool.mesh.setMatrixAt(w, m);
          pool.mesh.instanceColor.setXYZ(w, pool.color[w * 3] * fade + 0.02, pool.color[w * 3 + 1] * fade + 0.02, pool.color[w * 3 + 2] * fade + 0.02);
          w++;
        }
        pool.n = w;
        pool.mesh.count = w;
        pool.mesh.instanceMatrix.needsUpdate = true;
        pool.mesh.instanceColor.needsUpdate = true;
      }
    },
    setVisible(on) {
      specks.visible = bubbles.visible = on;
    },
  };
}

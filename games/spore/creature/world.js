/**
 * The Creature Stage island. One round island with rings of biomes: beach (your nest) on the
 * outside, then grassland, forest, rocky highlands and a volcano in the middle. Danger rises
 * towards the centre. Props are instanced (a few draw calls for hundreds of trees), collisions
 * use a coarse grid, and a day/night cycle moves the sun.
 */
import * as THREE from "three";
import { makeRng } from "../cell-format.js";

export const ISLAND = { shore: 205, size: 480, nest: { x: 0, z: 178 } };
export const RING_NAMES = ["", "Beach", "Grassland", "Forest", "Highlands", "Volcano"];

/** Ring 1 (beach) .. 5 (volcano) by distance from the centre. */
export function ringAt(x, z) {
  const d = Math.hypot(x, z);
  return d > 150 ? 1 : d > 110 ? 2 : d > 70 ? 3 : d > 34 ? 4 : 5;
}

export function heightAt(x, z) {
  const d = Math.hypot(x, z);
  const noise = Math.sin(x * 0.045) * 1.6 + Math.cos(z * 0.05 + 1.3) * 1.3 + Math.sin((x + z) * 0.09) * 0.6 + Math.cos(x * 0.13 - z * 0.07) * 0.35;
  if (d > ISLAND.shore) return 1.2 - (d - ISLAND.shore) * 0.12 + noise * 0.2; // slopes into the sea
  const inland = 1 - d / ISLAND.shore;
  let h = 1.2 + Math.pow(inland, 1.4) * 13 + noise * (0.4 + inland);
  if (d < 34) h += (1 - d / 34) * 9 - (d < 10 ? (1 - d / 10) * 6 : 0); // volcano cone and crater
  return h;
}

const TAU = Math.PI * 2;

function terrainMesh(segments) {
  const geo = new THREE.PlaneGeometry(ISLAND.size, ISLAND.size, segments, segments).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position,
    colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xe3cf95),
    grass = new THREE.Color(0x77b552),
    forest = new THREE.Color(0x3c7a3a),
    rock = new THREE.Color(0x8a8576),
    basalt = new THREE.Color(0x4a3f3c),
    lava = new THREE.Color(0xd8572a),
    seabed = new THREE.Color(0xc9b98a),
    c = new THREE.Color(),
    t = new THREE.Color();
  const band = (d, a, b) => THREE.MathUtils.smoothstep(d, a, b);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      z = pos.getZ(i),
      y = heightAt(x, z),
      d = Math.hypot(x, z);
    pos.setY(i, y);
    c.copy(basalt);
    c.lerp(rock, band(d, 30, 40));
    c.lerp(forest, band(d, 68, 78));
    c.lerp(grass, band(d, 108, 118));
    c.lerp(sand, band(d, 175, 190));
    if (d > ISLAND.shore) c.copy(seabed);
    if (d < 12) c.lerp(lava, 1 - d / 12);
    const n = Math.sin(x * 1.3) * Math.cos(z * 1.1) * 0.05 + Math.sin(x * 0.31 + z * 0.27) * 0.04;
    t.copy(c).offsetHSL(0, 0, n);
    colors.set([t.r, t.g, t.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
}

/** Coarse grid of round obstacles for cheap collision tests. */
function obstacleGrid() {
  const cells = new Map(),
    size = 12;
  const key = (x, z) => Math.floor(x / size) + "," + Math.floor(z / size);
  return {
    add(o) {
      const k = key(o.x, o.z);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(o);
    },
    /** Push a circle (x, z, r) out of any obstacle it overlaps. Returns the corrected position. */
    resolve(x, z, r) {
      const cx = Math.floor(x / size),
        cz = Math.floor(z / size);
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          const list = cells.get(cx + i + "," + (cz + j));
          if (!list) continue;
          for (const o of list) {
            const dx = x - o.x,
              dz = z - o.z,
              d = Math.hypot(dx, dz),
              min = o.r + r;
            if (d < min && d > 1e-4) {
              x = o.x + (dx / d) * min;
              z = o.z + (dz / d) * min;
            }
          }
        }
      return { x, z };
    },
  };
}

export function createIsland(scene, quality = "medium") {
  const rng = makeRng(20261116);
  const group = new THREE.Group();
  scene.add(group);
  const terrain = terrainMesh(quality === "low" ? 96 : quality === "medium" ? 128 : 170);
  group.add(terrain);
  const sea = new THREE.Mesh(new THREE.CircleGeometry(700, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2f8fc0, transparent: true, opacity: 0.85, roughness: 0.15, metalness: 0.1 }));
  sea.position.y = 0.2;
  group.add(sea);

  const grid = obstacleGrid();
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    p = new THREE.Vector3(),
    s = new THREE.Vector3(),
    yAxis = new THREE.Vector3(0, 1, 0);
  const nest = ISLAND.nest;
  const spot = (minD, maxD, clearOfNest = 10) => {
    for (let tries = 0; tries < 50; tries++) {
      const a = rng() * TAU,
        d = minD + rng() * (maxD - minD);
      const x = Math.cos(a) * d,
        z = Math.sin(a) * d;
      if (Math.hypot(x - nest.x, z - nest.z) > clearOfNest) return { x, z };
    }
    return { x: 0, z: 0 };
  };
  const scaleQ = quality === "low" ? 0.6 : quality === "medium" ? 0.8 : 1;
  const instanced = (geometry, material, list, place) => {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((o, i) => {
      place(o);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    return mesh;
  };

  // Forest and grassland trees: trunk + round crown.
  const trees = [];
  for (let i = 0; i < Math.round(170 * scaleQ); i++) trees.push({ ...spot(72, 112), s: 0.9 + rng() * 0.7, r: rng() * TAU });
  for (let i = 0; i < Math.round(40 * scaleQ); i++) trees.push({ ...spot(112, 150), s: 0.8 + rng() * 0.5, r: rng() * TAU });
  for (let i = 0; i < Math.round(25 * scaleQ); i++) trees.push({ ...spot(38, 70), s: 0.7 + rng() * 0.4, r: rng() * TAU });
  instanced(new THREE.CylinderGeometry(0.35, 0.55, 5, 7).translate(0, 2.5, 0), new THREE.MeshStandardMaterial({ color: 0x6f5236 }), trees, (o) => {
    p.set(o.x, heightAt(o.x, o.z) - 0.2, o.z);
    q.setFromAxisAngle(yAxis, o.r);
    s.setScalar(o.s);
  });
  instanced(new THREE.IcosahedronGeometry(2.8, 1), new THREE.MeshStandardMaterial({ color: 0x3f8f45, flatShading: true }), trees, (o) => {
    p.set(o.x, heightAt(o.x, o.z) + 5.6 * o.s, o.z);
    q.setFromAxisAngle(yAxis, o.r);
    s.set(o.s, o.s * 0.85, o.s);
  });
  trees.forEach((o) => grid.add({ x: o.x, z: o.z, r: 0.8 * o.s }));

  // Beach palms.
  const palms = [];
  for (let i = 0; i < Math.round(45 * scaleQ); i++) palms.push({ ...spot(158, 198, 14), s: 0.8 + rng() * 0.5, r: rng() * TAU });
  instanced(new THREE.CylinderGeometry(0.22, 0.38, 6, 6).translate(0, 3, 0), new THREE.MeshStandardMaterial({ color: 0x9a7a52 }), palms, (o) => {
    p.set(o.x, heightAt(o.x, o.z) - 0.2, o.z);
    q.setFromEuler(new THREE.Euler(0.12, o.r, 0.1));
    s.setScalar(o.s);
  });
  instanced(new THREE.ConeGeometry(2.6, 1.2, 7), new THREE.MeshStandardMaterial({ color: 0x4fa64a, flatShading: true }), palms, (o) => {
    p.set(o.x + 0.4 * o.s, heightAt(o.x, o.z) + 6.1 * o.s, o.z);
    q.setFromAxisAngle(yAxis, o.r);
    s.set(o.s, o.s, o.s);
  });
  palms.forEach((o) => grid.add({ x: o.x, z: o.z, r: 0.5 * o.s }));

  // Rocks: highlands and volcano, a few elsewhere.
  const rocks = [];
  for (let i = 0; i < Math.round(90 * scaleQ); i++) rocks.push({ ...spot(30, 72), s: 0.8 + rng() * 1.8, r: rng() * TAU, dark: false });
  for (let i = 0; i < Math.round(30 * scaleQ); i++) rocks.push({ ...spot(12, 34), s: 1 + rng() * 2, r: rng() * TAU, dark: true });
  for (let i = 0; i < Math.round(30 * scaleQ); i++) rocks.push({ ...spot(110, 190, 14), s: 0.5 + rng() * 0.8, r: rng() * TAU, dark: false });
  instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x8b8679, flatShading: true }), rocks.filter((r) => !r.dark), (o) => {
    p.set(o.x, heightAt(o.x, o.z) + o.s * 0.3, o.z);
    q.setFromEuler(new THREE.Euler(o.r, o.r * 2, 0));
    s.set(o.s, o.s * 0.7, o.s);
  });
  instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x3d3533, flatShading: true }), rocks.filter((r) => r.dark), (o) => {
    p.set(o.x, heightAt(o.x, o.z) + o.s * 0.3, o.z);
    q.setFromEuler(new THREE.Euler(o.r, o.r * 2, 0));
    s.set(o.s, o.s * 0.8, o.s);
  });
  rocks.forEach((o) => grid.add({ x: o.x, z: o.z, r: o.s * 0.9 }));

  // Fruit bushes: food for plant eaters. Fruit regrows.
  const bushes = [];
  for (let i = 0; i < Math.round(70 * scaleQ); i++) bushes.push(spot(100, 196, 6));
  for (let i = 0; i < Math.round(45 * scaleQ); i++) bushes.push(spot(60, 110));
  for (let i = 0; i < Math.round(15 * scaleQ); i++) bushes.push(spot(36, 60));
  // Two right next to your nest so the first meal is easy to find.
  bushes.push({ x: nest.x + 7, z: nest.z - 5 }, { x: nest.x - 8, z: nest.z - 3 });
  instanced(new THREE.IcosahedronGeometry(1.2, 1), new THREE.MeshStandardMaterial({ color: 0x3f8f52, flatShading: true }), bushes, (o) => {
    p.set(o.x, heightAt(o.x, o.z) + 0.6, o.z);
    q.identity();
    s.set(1.2, 0.9, 1.2);
  });
  const fruits = [];
  bushes.forEach((b) => {
    for (let f = 0; f < 3; f++) {
      const a = (f / 3) * TAU + rng();
      const x = b.x + Math.cos(a) * 1.1,
        z = b.z + Math.sin(a) * 1.1;
      fruits.push({ x, z, y: heightAt(b.x, b.z) + 0.9 + rng() * 0.5, alive: true, regrow: 0 });
    }
  });
  const fruitMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff5a7a, roughness: 0.35, emissive: 0x401020 }), fruits.length);
  group.add(fruitMesh);
  const syncFruit = () => {
    fruits.forEach((f, i) => {
      const sc = f.alive ? 1 : 0.0001;
      m.compose(p.set(f.x, f.y, f.z), q.identity(), s.set(sc, sc, sc));
      fruitMesh.setMatrixAt(i, m);
    });
    fruitMesh.instanceMatrix.needsUpdate = true;
  };
  syncFruit();

  /* Nest sites: 3 / 3 / 3 / 2 / 1 from beach to volcano, spread around each ring. */
  const nestSites = [];
  const perRing = [0, 3, 3, 3, 2, 1],
    ringBand = [null, [158, 192], [118, 146], [80, 104], [42, 64], [18, 26]];
  for (let ring = 1; ring <= 5; ring++)
    for (let k = 0; k < perRing[ring]; k++) {
      const base = (k / perRing[ring]) * TAU + ring * 0.9;
      let x = 0,
        z = 0;
      for (let tries = 0; tries < 30; tries++) {
        const a = base + (rng() - 0.5) * 0.5,
          [d0, d1] = ringBand[ring],
          d = d0 + rng() * (d1 - d0);
        x = Math.cos(a) * d;
        z = Math.sin(a) * d;
        if (Math.hypot(x - nest.x, z - nest.z) > 35) break;
      }
      nestSites.push({ x, z, ring });
    }

  /* Nest visuals: a twig ring with eggs. */
  const nestGeo = (() => {
    const g = new THREE.TorusGeometry(2.4, 0.45, 6, 18).rotateX(Math.PI / 2);
    return g;
  })();
  const nestMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1 });
  const eggGeo = new THREE.SphereGeometry(0.45, 10, 8).scale(1, 1.25, 1);
  const makeNestMesh = (x, z, eggColor) => {
    const g = new THREE.Group();
    g.position.set(x, heightAt(x, z) + 0.2, z);
    g.add(new THREE.Mesh(nestGeo, nestMat));
    const eggMat = new THREE.MeshStandardMaterial({ color: eggColor, roughness: 0.4 });
    for (let i = 0; i < 3; i++) {
      const e = new THREE.Mesh(eggGeo, eggMat);
      e.position.set(Math.cos(i * 2.1) * 0.7, 0.4, Math.sin(i * 2.1) * 0.7);
      g.add(e);
    }
    group.add(g);
    return g;
  };

  /* Fossils: half-buried skeletons in sandy mounds. Stand on one to dig up a creature part. */
  const bonePiles = [];
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xefe3c4, roughness: 0.7 });
  const moundMat = new THREE.MeshStandardMaterial({ color: 0xc9b07c, roughness: 1, flatShading: true });
  const dugMat = new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 1 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffe69a, transparent: true, opacity: 0.85 });
  const moundGeo = new THREE.IcosahedronGeometry(1.6, 1).scale(1.3, 0.38, 1.1);
  const ribGeo = new THREE.TorusGeometry(0.55, 0.06, 6, 14, Math.PI);
  const spineGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.2, 8).rotateZ(Math.PI / 2);
  const skullGeo = new THREE.SphereGeometry(0.42, 14, 10).scale(1.25, 0.85, 0.9);
  const socketGeo = new THREE.SphereGeometry(0.1, 8, 6);
  const glintGeo = new THREE.OctahedronGeometry(0.22, 0);
  const holeGeo = new THREE.CircleGeometry(1.5, 20).rotateX(-Math.PI / 2);
  const boneSpots = [
    ...[0, 1, 2, 3].map(() => spot(150, 190, 20)),
    ...[0, 1, 2, 3].map(() => spot(112, 146)),
    ...[0, 1, 2].map(() => spot(76, 106)),
    ...[0, 1, 2].map(() => spot(42, 66)),
    spot(18, 30),
  ];
  // And two or three more near every nest and around your own, so there is always one close by.
  // (Their own random stream, and added after the originals, so older saves keep their dug fossils.)
  const fossilRng = makeRng(77123);
  [{ x: nest.x, z: nest.z }, ...nestSites].forEach((site) => {
    const count = 2 + (fossilRng() < 0.5 ? 1 : 0);
    for (let k = 0; k < count; k++)
      for (let tries = 0; tries < 24; tries++) {
        const a = fossilRng() * TAU,
          d = 11 + fossilRng() * 13;
        const x = site.x + Math.cos(a) * d,
          z = site.z + Math.sin(a) * d;
        const dry = heightAt(x, z) > 0.5 && Math.hypot(x, z) < ISLAND.shore - 8;
        if (dry && boneSpots.every((b) => Math.hypot(b.x - x, b.z - z) > 7)) {
          boneSpots.push({ x, z });
          break;
        }
      }
  });
  boneSpots.forEach((b, i) => {
    const g = new THREE.Group();
    g.position.set(b.x, heightAt(b.x, b.z), b.z);
    g.rotation.y = rng() * TAU;
    const mound = new THREE.Mesh(moundGeo, moundMat);
    mound.position.y = 0.05;
    g.add(mound);
    // The skeleton pokes out of the sand: a row of ribs, a spine and a skull.
    const bones = new THREE.Group();
    const spineMesh = new THREE.Mesh(spineGeo, boneMat);
    spineMesh.position.set(0, 0.45, 0);
    bones.add(spineMesh);
    for (let k = 0; k < 4; k++) {
      const rib = new THREE.Mesh(ribGeo, boneMat);
      rib.position.set(-0.6 + k * 0.38, 0.1, 0);
      rib.rotation.y = Math.PI / 2;
      rib.scale.setScalar(1 - Math.abs(k - 1.5) * 0.15);
      bones.add(rib);
    }
    const skull = new THREE.Mesh(skullGeo, boneMat);
    skull.position.set(1.25, 0.3, 0);
    skull.rotation.z = -0.3 + (i % 3) * 0.15;
    bones.add(skull);
    for (const z of [-0.16, 0.16]) {
      const eye = new THREE.Mesh(socketGeo, dugMat);
      eye.position.set(1.55, 0.42, z);
      bones.add(eye);
    }
    g.add(bones);
    // A slow golden glint marks an undug fossil from a distance.
    const glint = new THREE.Mesh(glintGeo, glintMat);
    glint.position.y = 2.3;
    g.add(glint);
    const hole = new THREE.Mesh(holeGeo, dugMat);
    hole.position.y = 0.06;
    hole.visible = false;
    g.add(hole);
    group.add(g);
    bonePiles.push({ x: b.x, z: b.z, ring: ringAt(b.x, b.z), mesh: g, mound, bones, glint, hole, taken: false, dig: 0 });
  });
  /** Mark a fossil as dug: the mound is gone, a dark hole is left. */
  const markDug = (b) => {
    b.taken = true;
    b.mound.visible = false;
    b.bones.visible = false;
    b.glint.visible = false;
    b.hole.visible = true;
  };

  /* Lighting and day/night. */
  const hemi = new THREE.HemisphereLight(0xdff4ff, 0x6b5a3a, 1.05);
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  scene.add(hemi, sun);
  const skyDay = new THREE.Color(0x9fd6ee),
    skyDusk = new THREE.Color(0xf0a274),
    skyNight = new THREE.Color(0x10203a);
  scene.background = skyDay.clone();
  scene.fog = new THREE.Fog(skyDay.clone(), 70, 190);
  const DAY_LENGTH = 300; // seconds for a full day
  let clock = DAY_LENGTH * 0.3;

  return {
    group,
    fruits,
    nestSites,
    bonePiles,
    markDug,
    makeNestMesh,
    resolve: (x, z, r) => grid.resolve(x, z, r),
    syncFruit,
    /** 0..1 through the day; night when > 0.62. */
    get timeOfDay() {
      return (clock % DAY_LENGTH) / DAY_LENGTH;
    },
    get isNight() {
      const t = (clock % DAY_LENGTH) / DAY_LENGTH;
      return t > 0.62 && t < 0.97;
    },
    update(dt, focus) {
      clock += dt;
      const t = (clock % DAY_LENGTH) / DAY_LENGTH; // 0 dawn, 0.25 noon, 0.62 dusk, 0.8 midnight
      const sunHeight = Math.sin(t * TAU * 0.8 + 0.1);
      const daylight = THREE.MathUtils.clamp(sunHeight * 1.6 + 0.2, 0.08, 1);
      sun.position.set(focus.x + Math.cos(t * TAU) * 60, Math.max(8, sunHeight * 80), focus.z + 30);
      sun.target.position.set(focus.x, 0, focus.z);
      sun.target.updateMatrixWorld();
      sun.intensity = 0.25 + daylight * 1.4;
      hemi.intensity = 0.35 + daylight * 0.75;
      const sky = scene.background;
      if (daylight > 0.6) sky.copy(skyDay);
      else if (daylight > 0.25) sky.copy(skyDusk).lerp(skyDay, (daylight - 0.25) / 0.35);
      else sky.copy(skyNight).lerp(skyDusk, daylight / 0.25);
      scene.fog.color.copy(sky);
      let regrew = false;
      fruits.forEach((f) => {
        if (!f.alive && (f.regrow -= dt) <= 0) regrew = f.alive = true;
      });
      if (regrew) syncFruit();
      bonePiles.forEach((b) => {
        if (b.taken) return;
        b.glint.rotation.y += dt * 1.6;
        b.glint.position.y = 2.3 + Math.sin(clock * 2 + b.x) * 0.2;
        b.glint.scale.setScalar(0.8 + 0.25 * Math.sin(clock * 3.1 + b.z));
      });
    },
    dispose() {
      scene.remove(group, hemi, sun);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose?.();
      });
      scene.fog = null;
    },
  };
}

/**
 * The village itself (Tribes and Tribulations): everything the tribe builds for itself as it grows,
 * in the style of the species that lives there, plus the food store, forage patches, campfire seats
 * and the loads members carry. tribe/life.js decides what should exist; this module makes it visible
 * and keeps the list of solid things members walk around.
 */
import * as THREE from "three";
import { FORAGE, forageKinds, villagePlan } from "./life.js";

const TAU = Math.PI * 2;
const mixHex = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

/**
 * @param {object} c
 * @param {THREE.Scene} c.scene
 * @param {(x:number,z:number)=>number} c.heightAt
 * @param {(color:number, extra?:object)=>THREE.Material} c.mat   cached, disposed by the stage
 * @param {(g:THREE.BufferGeometry)=>THREE.BufferGeometry} c.geo
 * @param {object} c.world
 * @param {{x:number,z:number}} c.HOME
 * @param {{x:number,z:number}} c.FIRE
 * @param {{x:number,z:number}} c.PILE
 * @param {object} c.style         from life.speciesStyle()
 * @param {string} c.diet
 * @param {() => {x:number,z:number,r:number}[]} c.taken   spots already used (hut, shacks, player buildings)
 * @param {(tool:string, tier:number)=>THREE.Object3D} c.toolMesh
 * @param {string} c.regionId
 */
export function createVillage(c) {
  const { scene, heightAt, mat, geo, HOME, FIRE, PILE, style } = c;
  const S = style.scale;
  const col = style.colors;
  // The tribe's materials: wood, the species' own colours, and what it builds with.
  const wood = mat(0x6b4a2c),
    darkWood = mat(0x4a321f),
    bone = mat(0xeee3c8, { flatShading: false, roughness: 0.6 }),
    stone = mat(0x8f949a),
    earth = mat(mixHex(0x7a5a3a, col.main, 0.12)),
    dark = mat(0x1f1712),
    hide = mat(mixHex(col.belly, 0xc79a68, 0.55), { side: THREE.DoubleSide }),
    hide2 = mat(mixHex(col.main, 0xb08050, 0.45), { side: THREE.DoubleSide }),
    leaf = mat(mixHex(0x4f8f3a, col.main, 0.18)),
    leaf2 = mat(mixHex(0x6fae4a, col.trim, 0.15)),
    thatch = mat(mixHex(0xc9a35a, col.main, 0.15)),
    paint = mat(col.paint, { flatShading: false }),
    main = mat(col.main),
    trim = mat(col.trim),
    straw = mat(0xd9b96a),
    soil = mat(0x4a3324),
    glow = new THREE.MeshStandardMaterial({ color: col.paint, emissive: col.paint, emissiveIntensity: 0.25, roughness: 0.4 });
  const disposeLater = [glow];
  const G = {
    post: geo(new THREE.CylinderGeometry(0.08, 0.1, 1, 6).translate(0, 0.5, 0)),
    log: geo(new THREE.CylinderGeometry(0.22, 0.24, 1.6, 7).rotateZ(Math.PI / 2)),
    cone: geo(new THREE.ConeGeometry(1, 1, 8, 1, true).translate(0, 0.5, 0)),
    dome: geo(new THREE.SphereGeometry(1, 12, 7, 0, TAU, 0, Math.PI / 2)),
    ball: geo(new THREE.SphereGeometry(1, 9, 7)),
    box: geo(new THREE.BoxGeometry(1, 1, 1)),
    prism: geo(new THREE.CylinderGeometry(1, 1, 1, 3).rotateZ(Math.PI / 2)),
    disk: geo(new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2)),
    ring: geo(new THREE.TorusGeometry(1, 0.08, 5, 18).rotateX(Math.PI / 2)),
    basket: geo(new THREE.CylinderGeometry(0.5, 0.36, 0.5, 9, 1, true).translate(0, 0.25, 0)),
    basketBase: geo(new THREE.CircleGeometry(0.36, 9).rotateX(-Math.PI / 2).translate(0, 0.02, 0)),
    horn: geo(new THREE.ConeGeometry(0.1, 0.55, 6).translate(0, 0.27, 0)),
    stake: geo(new THREE.ConeGeometry(0.12, 1.6, 5).translate(0, 0.8, 0)),
    rib: geo(new THREE.TorusGeometry(0.35, 0.05, 4, 10, Math.PI)),
    ribbon: geo(new THREE.PlaneGeometry(0.22, 1.1).translate(0, -0.55, 0)),
    capsule: geo(new THREE.CapsuleGeometry(0.09, 0.22, 3, 6).rotateZ(Math.PI / 2)),
    leafBlade: geo(new THREE.ConeGeometry(0.14, 0.6, 4).translate(0, 0.3, 0)),
    fish: geo(new THREE.SphereGeometry(0.22, 8, 6).scale(1.8, 0.8, 0.5)),
    meat: geo(new THREE.DodecahedronGeometry(0.22, 0).scale(1.3, 0.9, 1)),
    small: geo(new THREE.SphereGeometry(0.2, 8, 6)),
  };
  const groupAt = (x, z, rotY = 0) => {
    const g = new THREE.Group();
    g.position.set(x, heightAt(x, z), z);
    g.rotation.y = rotY;
    return g;
  };
  const add = (g, geometry, material, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    g.add(m);
    return m;
  };
  /**
   * One draw call per material instead of one per part: every part of a building that never moves
   * is baked into a merged mesh. Parts marked userData.dyn (and everything under them) are left alone.
   */
  const _inv = new THREE.Matrix4(),
    _m = new THREE.Matrix4();
  function mergeStatic(root) {
    root.updateMatrixWorld(true);
    _inv.copy(root.matrixWorld).invert();
    const byMat = new Map();
    const take = [];
    const visit = (o) => {
      if (o.userData.dyn) return;
      if (o.isMesh && o.visible) take.push(o);
      o.children.forEach(visit);
    };
    root.children.forEach(visit);
    if (take.length < 2) return [];
    for (const m of take) {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
      g.applyMatrix4(_m.multiplyMatrices(_inv, m.matrixWorld));
      if (!byMat.has(m.material)) byMat.set(m.material, []);
      byMat.get(m.material).push(g);
      m.removeFromParent();
    }
    const made = [];
    for (const [material, list] of byMat) {
      let n = 0;
      list.forEach((g) => (n += g.attributes.position.count));
      const pos = new Float32Array(n * 3),
        nor = new Float32Array(n * 3);
      let at = 0;
      for (const g of list) {
        pos.set(g.attributes.position.array, at * 3);
        nor.set(g.attributes.normal.array, at * 3);
        at += g.attributes.position.count;
        g.dispose();
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geom.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      geom.computeBoundingSphere();
      const mesh = new THREE.Mesh(geom, material);
      root.add(mesh);
      made.push(geom);
    }
    return made;
  }
  /** Bake a piece's static parts, keeping the merged geometry to free when it's rebuilt. */
  function bake(p) {
    (p.baked || []).forEach((g) => g.dispose());
    p.baked = mergeStatic(p.mesh);
  }
  function unbuild(p) {
    scene.remove(p.mesh);
    (p.baked || []).forEach((g) => g.dispose());
    p.baked = null;
  }
  /** Face a point (the fire, usually): the group's +x looks at it. */
  const facing = (x, z, tx, tz) => Math.atan2(-(tz - z), tx - x);

  /* ---- food items: one look per kind of food, for loads and the store ---------------------- */
  const FOOD_LOOK = {
    fruit: [G.small, mat(0xff5a7a, { flatShading: false, roughness: 0.4 })],
    fish: [G.fish, mat(0xb9d8e8, { flatShading: false, roughness: 0.3 })],
    meat: [G.meat, mat(0xb3473a, { flatShading: false, roughness: 0.6 })],
    mushroom: [G.dome, mat(0xd8644a, { flatShading: false })],
    roots: [G.horn, mat(0xe58a3a)],
    nuts: [G.small, mat(0x8a5a2e)],
    herbs: [G.leafBlade, leaf2],
    grubs: [G.capsule, mat(0xf2e3c0, { flatShading: false })],
    eggs: [G.ball, mat(0xfff4dc, { flatShading: false, roughness: 0.35 })],
    loot: [G.small, mat(0xf2b75a, { flatShading: false })],
    supplies: [G.log, wood],
  };
  const ITEM_SCALE = { mushroom: 0.22, eggs: 0.16, supplies: 0.45, roots: 1, herbs: 0.9 };
  function foodItem(kind) {
    const [g, m] = FOOD_LOOK[kind] || FOOD_LOOK.loot;
    const mesh = new THREE.Mesh(g, m);
    mesh.scale.setScalar(ITEM_SCALE[kind] ?? 1);
    if (kind === "roots") mesh.rotation.z = Math.PI;
    return mesh;
  }
  /** A bundle of food on a member's back, one piece per food (up to four shown). */
  function carryBundle(kind, n) {
    const g = new THREE.Group();
    const k = Math.max(1, Math.min(4, n));
    for (let i = 0; i < k; i++) {
      const m = foodItem(kind);
      m.position.set((i % 2 ? 0.16 : -0.16) * (k > 1 ? 1 : 0), Math.floor(i / 2) * 0.22, (i % 3) * 0.06 - 0.06);
      m.rotation.y = i * 1.3;
      g.add(m);
    }
    return g;
  }

  /* ---- the solid things: members walk around these ----------------------------------------- */
  const obstacles = [];
  const fixed = [];
  /** Re-collect the solid things (static ones plus anything the stage reports). */
  function setFixed(list) {
    fixed.length = 0;
    fixed.push(...list);
    obstacles.length = 0;
    obstacles.push(...fixed, ...pieces.flatMap((p) => p.solid || []));
  }

  /* ---- automatic pieces ------------------------------------------------------------------- */
  /** Everything the village has built for itself: { id, x, z, k (variant), mesh, solid, spots } */
  const pieces = [];
  const takenNow = () => [...c.taken(), ...pieces.map((p) => ({ x: p.x, z: p.z, r: p.r || 2 }))];
  const clearAt = (x, z, r) => {
    if (heightAt(x, z) < 0.35) return false;
    const p = c.world.resolve(x, z, r);
    if (Math.hypot(p.x - x, p.z - z) > 0.05) return false;
    return takenNow().every((t) => Math.hypot(t.x - x, t.z - z) >= t.r + r);
  };
  // Inland, away from the beach: the side of the village facing the island's middle.
  const inland = Math.atan2(-HOME.z, -HOME.x);
  /**
   * The first clear spot in a zone: rings out from a centre, sweeping round from a preferred angle.
   * Deterministic, so a village laid out the same way grows the same way.
   */
  function findSpot(cx, cz, r0, r1, r, aim = inland, spread = Math.PI) {
    const sp = style.spacing;
    for (let rr = r0 * sp; rr <= r1 * sp; rr += 1.3) {
      const steps = Math.max(8, Math.round((rr * spread * 2) / 2.2));
      for (let i = 0; i <= steps; i++) {
        // Alternate either side of the aim: 0, +1, -1, +2, -2 …
        const j = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
        const a = aim + (j / steps) * spread * 2;
        const x = cx + Math.cos(a) * rr,
          z = cz + Math.sin(a) * rr;
        if (clearAt(x, z, r)) return { x, z };
      }
    }
    return null;
  }

  function buildShelter(p) {
    const tier = p.k || 1;
    const sh = style.shelter;
    const g = groupAt(p.x, p.z, facing(p.x, p.z, FIRE.x, FIRE.z));
    const h = style.height;
    if (sh === "tent") {
      add(g, G.cone, hide, 0, 0, 0, 1.45, 2.5 * h, 1.45);
      add(g, G.cone, hide2, 0, 1.2 * h, 0, 0.9, 1.5 * h, 0.9);
      for (let i = 0; i < 3; i++) {
        const pole = add(g, G.post, wood, Math.cos(i * 2.1) * 0.12, 1.9 * h, Math.sin(i * 2.1) * 0.12, 1, 1.3, 1);
        pole.rotation.set(Math.sin(i * 2.1) * 0.35, 0, Math.cos(i * 2.1) * 0.35);
      }
      add(g, G.ring, paint, 0, 0.9 * h, 0, 1.05, 1, 1.05);
      add(g, G.disk, dark, 1.1, 0.5, 0, 0.45, 1, 0.38).rotation.set(0, 0, Math.PI / 2 - 0.42);
      if (tier >= 2) {
        // A skull over the door, a stone ring at the foot.
        add(g, G.ball, bone, 1.0, 1.55 * h, 0, 0.22, 0.18, 0.2);
        add(g, G.horn, bone, 1.0, 1.65 * h, 0.16, 1).rotation.x = -0.6;
        add(g, G.horn, bone, 1.0, 1.65 * h, -0.16, 1).rotation.x = 0.6;
      }
      if (tier >= 3) for (let i = 0; i < 9; i++) add(g, G.ball, stone, Math.cos((i / 9) * TAU) * 1.55, 0.1, Math.sin((i / 9) * TAU) * 1.55, 0.24);
    } else if (sh === "leaf") {
      add(g, G.dome, leaf, 0, 0, 0, 1.5, 1.5 * h, 1.5);
      add(g, G.dome, leaf2, 0, 0.55 * h, 0, 1.05, 1.15 * h, 1.05);
      for (let i = 0; i < 7; i++) {
        const b = add(g, G.leafBlade, i % 2 ? leaf : leaf2, Math.cos(i) * 0.5, 1.45 * h, Math.sin(i) * 0.5, 1.4);
        b.rotation.set(Math.sin(i) * 0.7, 0, Math.cos(i) * 0.7);
      }
      add(g, G.disk, dark, 1.38, 0.45, 0, 0.42, 1, 0.36).rotation.set(0, 0, Math.PI / 2 - 0.15);
      if (tier >= 2) for (let i = 0; i < 5; i++) add(g, G.small, i % 2 ? paint : trim, Math.cos(i * 1.3) * 1.1, 1.0 * h, Math.sin(i * 1.3) * 1.1, 0.6);
      if (tier >= 3) add(g, G.ring, thatch, 0, 0.15, 0, 1.55, 2, 1.55);
    } else if (sh === "mound") {
      add(g, G.ball, earth, 0, 0, 0, 1.55, 1.05 * h, 1.4);
      // Plant eaters grow turf and shoots over their dens.
      if (style.herbivore) {
        add(g, G.dome, leaf, 0, 0.35 * h, 0, 1.4, 0.75 * h, 1.25);
        for (let i = 0; i < 6; i++) add(g, G.leafBlade, leaf2, Math.cos(i * 1.1) * 0.6, 0.95 * h, Math.sin(i * 1.1) * 0.55, 1.3).rotation.set(Math.sin(i) * 0.5, 0, Math.cos(i) * 0.5);
      }
      add(g, G.disk, dark, 1.32, 0.42, 0, 0.5, 1, 0.42).rotation.set(0, 0, Math.PI / 2 - 0.3);
      for (let i = 0; i < 5; i++) add(g, G.ball, stone, 1.35 + Math.sin(i) * 0.2, 0.08, -0.6 + i * 0.3, 0.16);
      if (tier >= 2) for (let i = 0; i < 4; i++) add(g, G.ball, paint, Math.cos(i * 1.6 + 1) * 0.9, 0.85 * h, Math.sin(i * 1.6 + 1) * 0.9, 0.18, 0.08, 0.18);
      // Hunters mark their dens with the skulls of what they've brought down.
      if (style.predatory) {
        add(g, G.ball, bone, 1.25, 0.95 * h, 0.55, 0.2, 0.17, 0.19);
        for (const s2 of [-1, 1]) add(g, G.horn, bone, 1.25, 1.05 * h, 0.55 + s2 * 0.15, 0.9).rotation.x = -s2 * 0.7;
      }
      if (tier >= 3) add(g, G.ball, earth, -1.1, 0, 0.9, 0.9, 0.7 * h, 0.9);
    } else {
      // A timber lodge with a gabled roof in the species' colour.
      add(g, G.box, thatch, 0, 0.6 * h, 0, 2.3, 1.2 * h, 1.7);
      const roof = add(g, G.prism, main, 0, 1.45 * h, 0, 1.2, 2.5, 1.2);
      roof.scale.set(1.25, 2.5, 0.75 * h + 0.25);
      add(g, G.box, dark, 1.16, 0.5 * h, 0, 0.05, 0.95 * h, 0.6);
      for (const zz of [-0.85, 0.85]) add(g, G.post, wood, 1.15, 0, zz, 1, 1.35 * h, 1);
      if (tier >= 2) add(g, G.box, stone, 0, 0.12, 0, 2.5, 0.24, 1.9);
      if (tier >= 3) for (const zz of [-0.85, 0.85]) add(g, G.box, paint, 1.18, 1.1 * h, zz, 0.06, 0.25, 0.12);
    }
    g.scale.setScalar(S);
    scene.add(g);
    p.mesh = g;
    p.r = 1.7 * S;
    p.solid = [{ x: p.x, z: p.z, r: 1.45 * S }];
    // Two or three places to sleep at the door.
    const door = facing(p.x, p.z, FIRE.x, FIRE.z);
    const fx = Math.cos(door),
      fz = -Math.sin(door);
    p.spots = [-1, 0, 1].slice(0, style.size === "small" ? 3 : 2).map((s) => ({ x: p.x + fx * (1.9 * S) - fz * s * 0.95 * S, z: p.z + fz * (1.9 * S) + fx * s * 0.95 * S, by: null }));
  }

  function buildStorage(p) {
    const tier = p.k || 1;
    const g = groupAt(p.x, p.z);
    const baskets = [];
    const n = [3, 5, 7][tier - 1];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.4,
        r = 1.55 + (i % 2) * 0.25;
      const b = new THREE.Group();
      b.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      add(b, G.basket, straw);
      add(b, G.basketBase, darkWood);
      b.userData.a = a;
      b.userData.dyn = true; // tipped over when the store is bare
      g.add(b);
      baskets.push(b);
    }
    if (tier >= 2) {
      // A drying rack: two posts and a bar hung with food.
      const rack = new THREE.Group();
      rack.position.set(-2.6, 0, 0.4);
      rack.rotation.y = 0.4;
      for (const zz of [-1, 1]) add(rack, G.post, wood, 0, 0, zz, 1, 1.9, 1);
      add(rack, G.log, wood, 0, 1.85, 0, 1.3, 0.25, 0.25).rotation.y = Math.PI / 2;
      const hang = [];
      rack.userData.dyn = true;
      for (let i = 0; i < 5; i++) {
        const it = foodItem(style.predatory ? (i % 2 ? "meat" : "fish") : style.herbivore ? (i % 2 ? "roots" : "herbs") : i % 2 ? "fish" : "fruit");
        it.position.set(0, 1.45, -0.8 + i * 0.4);
        it.rotation.x = Math.PI / 2;
        rack.add(it);
        hang.push(it);
      }
      g.add(rack);
      p.hang = hang;
    }
    if (tier >= 3) {
      // A raised granary on stilts.
      const gr = new THREE.Group();
      gr.position.set(2.5, 0, -1.4);
      for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) add(gr, G.post, wood, x, 0, z, 1, 1.1, 1);
      add(gr, G.box, thatch, 0, 1.5, 0, 1.5, 0.8, 1.5);
      add(gr, G.cone, style.herbivore ? leaf : main, 0, 1.9, 0, 1.25, 0.9, 1.25);
      g.add(gr);
    }
    g.scale.setScalar(Math.max(0.85, S));
    scene.add(g);
    p.mesh = g;
    p.baskets = baskets;
    p.r = 2.6;
    p.solid = [];
  }

  function buildRack(p) {
    const g = groupAt(p.x, p.z, facing(p.x, p.z, FIRE.x, FIRE.z) + Math.PI / 2);
    for (const x of [-0.9, 0.9]) {
      const a = add(g, G.post, wood, x, 0, 0, 1, 1.7, 1);
      a.rotation.x = 0.2;
    }
    add(g, G.log, wood, 0, 1.45, 0, 1.25, 0.22, 0.22);
    p.mesh = g;
    p.solid = [{ x: p.x, z: p.z, r: 0.9 }];
    p.r = 1.6;
    fillRack(p);
    scene.add(g);
  }
  /** The rack shows the tribe's actual weapons. */
  function fillRack(p) {
    if (!p.mesh) return;
    p.mesh.children.filter((m) => m.userData.weapon).forEach((m) => p.mesh.remove(m));
    const list = c.weapons();
    list.slice(0, 4).forEach((w, i) => {
      const t = c.toolMesh(w.id, w.tier);
      t.position.set(-0.75 + i * 0.5, 0.05, 0.12);
      t.rotation.z = -0.15;
      t.userData.weapon = true;
      p.mesh.add(t);
    });
  }
  function buildCraft(p) {
    const g = groupAt(p.x, p.z, facing(p.x, p.z, FIRE.x, FIRE.z));
    add(g, G.box, darkWood, 0, 0.35, 0, 1.4, 0.18, 0.7);
    for (const x of [-0.55, 0.55]) add(g, G.box, wood, x, 0, 0, 0.18, 0.7, 0.6).position.y = 0.17;
    add(g, G.ball, stone, 0.3, 0.55, 0, 0.18, 0.12, 0.16);
    add(g, G.ball, stone, -0.35, 0.5, 0.15, 0.1);
    add(g, G.log, wood, -1.3, 0.22, 0.5, 0.6, 1, 1).rotation.y = 0.5;
    add(g, G.log, wood, -1.25, 0.22, -0.3, 0.6, 1, 1).rotation.y = -0.3;
    add(g, G.disk, mat(0xc9a878), 0, 0.03, 0, 1.4, 1, 1);
    g.scale.setScalar(Math.max(0.85, S));
    scene.add(g);
    p.mesh = g;
    p.r = 2;
    p.solid = [{ x: p.x, z: p.z, r: 0.85 }];
    p.spots = [{ x: p.x + Math.cos(g.rotation.y) * 1.3, z: p.z - Math.sin(g.rotation.y) * 1.3, by: null }];
  }
  function buildTraining(p) {
    const g = groupAt(p.x, p.z);
    for (let i = 0; i < 14; i++) add(g, G.ball, stone, Math.cos((i / 14) * TAU) * 3.4, 0.06, Math.sin((i / 14) * TAU) * 3.4, 0.2, 0.12, 0.2);
    p.dummies = [];
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI + 0.6;
      const d = new THREE.Group();
      d.position.set(Math.cos(a) * 1.9, 0, Math.sin(a) * 1.9);
      add(d, G.post, wood, 0, 0, 0, 1.3, 1.5, 1.3);
      add(d, G.ball, straw, 0, 1.2, 0, 0.32, 0.42, 0.28);
      add(d, G.ball, style.predatory ? hide : straw, 0, 1.75, 0, 0.2);
      add(d, G.log, wood, 0, 1.3, 0, 0.45, 0.4, 0.4).rotation.y = Math.PI / 2;
      d.userData.dyn = true; // wobbles when struck
      g.add(d);
      p.dummies.push({ x: p.x + Math.cos(a) * 1.9, z: p.z + Math.sin(a) * 1.9, mesh: d, by: null });
    }
    scene.add(g);
    p.mesh = g;
    p.r = 3.6;
    p.solid = p.dummies.map((d) => ({ x: d.x, z: d.z, r: 0.35 }));
    p.spar = [-1, 1].map((s) => ({ x: p.x + s * 0.9, z: p.z - 1.3, by: null }));
  }
  function buildFence(p) {
    // A short run of fence (its own angle k) with posts the tribe walks round. Gaps between runs.
    const a0 = p.a,
      R = p.R,
      run = 5.5 / R;
    const g = new THREE.Group();
    const solid = [];
    const posts = 6;
    let prev = null;
    for (let i = 0; i <= posts; i++) {
      const a = a0 - run / 2 + (i / posts) * run;
      const x = HOME.x + Math.cos(a) * R,
        z = HOME.z + Math.sin(a) * R;
      const y = heightAt(x, z);
      if (style.spiky || style.predatory) {
        const s = add(g, G.stake, wood, x, y - 0.1, z);
        s.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      } else if (style.herbivore) add(g, G.ball, leaf, x, y + 0.45, z, 0.75, 0.6, 0.75);
      else add(g, G.post, wood, x, y, z, 1.2, 1.4, 1.2);
      if (prev && !style.herbivore) {
        const mx = (x + prev.x) / 2,
          mz = (z + prev.z) / 2;
        const len = Math.hypot(x - prev.x, z - prev.z);
        for (const hh of [0.55, 1.05]) {
          const rail = add(g, G.box, wood, mx, (y + prev.y) / 2 + hh, mz, len, 0.09, 0.09);
          rail.rotation.y = -Math.atan2(z - prev.z, x - prev.x);
        }
      }
      solid.push({ x, z, r: 0.55 });
      prev = { x, z, y };
    }
    scene.add(g);
    p.mesh = g;
    p.solid = solid;
    p.r = 0.6;
  }
  function buildTrophy(p) {
    const g = groupAt(p.x, p.z, facing(p.x, p.z, FIRE.x, FIRE.z));
    add(g, G.post, wood, 0, 0, 0, 1.2, 2.3, 1.2);
    if (style.herbivore && !style.predatory) {
      // Shed antlers and a woven wreath.
      add(g, G.ring, leaf2, 0, 2.1, 0, 0.4, 1, 0.4).rotation.x = Math.PI / 2;
      for (const s of [-1, 1]) add(g, G.horn, bone, 0, 2.4, s * 0.2, 1.4).rotation.x = -s * 0.5;
    } else {
      add(g, G.ball, bone, 0, 2.35, 0, 0.32, 0.28, 0.3);
      add(g, G.ball, dark, 0.27, 2.38, 0.11, 0.06);
      add(g, G.ball, dark, 0.27, 2.38, -0.11, 0.06);
      for (const s of [-1, 1]) add(g, G.horn, bone, 0, 2.5, s * 0.22, 1.5).rotation.x = -s * 0.8;
      if ((p.k || 0) % 2) for (let i = 0; i < 3; i++) add(g, G.rib, bone, 0, 0.9 + i * 0.32, 0, 0.8).rotation.y = Math.PI / 2;
    }
    add(g, G.ribbon, paint, 0.12, 2.0, 0, 1, 0.8, 1);
    scene.add(g);
    p.mesh = g;
    p.solid = [{ x: p.x, z: p.z, r: 0.35 }];
    p.r = 0.9;
  }
  function buildGarden(p) {
    const g = groupAt(p.x, p.z, facing(p.x, p.z, HOME.x, HOME.z));
    add(g, G.box, soil, 0, 0.04, 0, 3.2, 0.12, 2.2);
    const crop = [];
    for (let i = 0; i < 12; i++) {
      const x = -1.25 + (i % 4) * 0.83,
        z = -0.7 + Math.floor(i / 4) * 0.7;
      const pl = new THREE.Group();
      pl.position.set(x, 0.1, z);
      for (let j = 0; j < 3; j++) add(pl, G.leafBlade, j % 2 ? leaf : leaf2, Math.cos(j * 2.1) * 0.08, 0, Math.sin(j * 2.1) * 0.08, 0.9).rotation.set(Math.sin(j * 2.1) * 0.4, 0, Math.cos(j * 2.1) * 0.4);
      if (i % 3 === 0) add(pl, G.small, i % 2 ? paint : FOOD_LOOK.roots[1], 0, 0.42, 0, 0.6);
      pl.userData.dyn = true; // harvested and regrown
      g.add(pl);
      crop.push(pl);
    }
    // A low woven edge.
    for (const s of [-1, 1]) add(g, G.box, wood, 0, 0.18, s * 1.15, 3.3, 0.14, 0.1);
    scene.add(g);
    p.mesh = g;
    p.r = 2.3;
    p.solid = [];
    p.crop = crop;
  }
  function buildRing(p) {
    // An open gathering place: log seats in a circle and streamer poles in the tribe's colours.
    const g = groupAt(p.x, p.z);
    p.spots = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const lg = add(g, G.log, wood, Math.cos(a) * 2.6, 0.2, Math.sin(a) * 2.6, 0.75, 1, 1);
      lg.rotation.y = -a + Math.PI / 2;
      p.spots.push({ x: p.x + Math.cos(a) * 2.0, z: p.z + Math.sin(a) * 2.0, by: null });
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.5;
      const pole = new THREE.Group();
      pole.position.set(Math.cos(a) * 3.4, 0, Math.sin(a) * 3.4);
      add(pole, G.post, wood, 0, 0, 0, 1, 2.6, 1);
      for (let j = 0; j < 3; j++) {
        const rb = add(pole, G.ribbon, [paint, trim, main][j], 0.05, 2.5, 0, 1, 0.8 + j * 0.2, 1);
        rb.rotation.y = j * 1.1;
        rb.userData.flutter = j + i;
        rb.userData.dyn = true;
      }
      g.add(pole);
    }
    scene.add(g);
    p.mesh = g;
    p.r = 3.6;
    p.solid = [];
  }
  /** One decoration, chosen from the species' own set (and its leaning). */
  function buildDecor(p) {
    const kinds = p.kinds || style.decor;
    const kind = kinds[(p.k || 0) % kinds.length];
    p.kind = kind;
    const g = groupAt(p.x, p.z, (p.k || 0) * 1.7);
    if (kind === "bones") {
      for (let i = 0; i < 4; i++) add(g, G.rib, bone, Math.cos(i * 1.7) * 0.3, 0.18, Math.sin(i * 1.7) * 0.3, 0.8).rotation.set(Math.PI / 2, 0, i);
      add(g, G.ball, bone, 0, 0.25, 0, 0.26, 0.22, 0.24);
    } else if (kind === "skulls") {
      for (let i = 0; i < 3; i++) {
        add(g, G.post, wood, i * 0.6 - 0.6, 0, 0, 1, 1.4 + i * 0.15, 1);
        add(g, G.ball, bone, i * 0.6 - 0.6, 1.5 + i * 0.15, 0, 0.2, 0.17, 0.19);
      }
    } else if (kind === "hides") {
      for (const x of [-0.8, 0.8]) add(g, G.post, wood, x, 0, 0, 1, 1.7, 1);
      add(g, G.box, hide, 0, 1.0, 0, 1.5, 1.1, 0.04);
      add(g, G.box, paint, 0, 1.0, 0.03, 0.5, 0.5, 0.02);
    } else if (kind === "garden") {
      add(g, G.basket, earth, 0, 0, 0, 1.6, 0.8, 1.6);
      for (let i = 0; i < 5; i++) add(g, G.leafBlade, i % 2 ? leaf : leaf2, Math.cos(i * 1.3) * 0.3, 0.35, Math.sin(i * 1.3) * 0.3, 1.2);
    } else if (kind === "vines") {
      for (const x of [-0.9, 0.9]) add(g, G.post, wood, x, 0, 0, 1, 2, 1);
      add(g, G.ring, leaf, 0, 2, 0, 0.9, 2.5, 0.9).rotation.x = Math.PI / 2;
      for (let i = 0; i < 6; i++) add(g, G.small, i % 2 ? paint : trim, -0.8 + i * 0.32, 2.1 + Math.sin(i) * 0.3, 0, 0.45);
    } else if (kind === "blooms") {
      for (let i = 0; i < 7; i++) {
        add(g, G.post, leaf, Math.cos(i) * 0.5, 0, Math.sin(i) * 0.5, 0.3, 0.5, 0.3);
        add(g, G.small, [paint, trim, main][i % 3], Math.cos(i) * 0.5, 0.55, Math.sin(i) * 0.5, 0.75);
      }
    } else if (kind === "streamers") {
      add(g, G.post, wood, 0, 0, 0, 1, 3, 1);
      for (let j = 0; j < 4; j++) {
        const rb = add(g, G.ribbon, [paint, trim, main, paint][j], 0.05, 2.9, 0, 1, 0.9 + j * 0.15, 1);
        rb.rotation.y = j * 1.6;
        rb.userData.flutter = j + (p.k || 0);
        rb.userData.dyn = true;
      }
    } else if (kind === "drums") {
      for (let i = 0; i < 2; i++) {
        add(g, G.basket, hide2, i * 0.8 - 0.4, 0, 0, 0.9, 1.3, 0.9);
        add(g, G.basketBase, hide, i * 0.8 - 0.4, 0.62, 0, 1.3);
      }
    } else if (kind === "lanterns") {
      add(g, G.post, wood, 0, 0, 0, 1, 2.2, 1);
      const orb = add(g, G.ball, glow, 0.25, 2.0, 0, 0.2);
      p.glow = orb;
    } else if (kind === "thorns") {
      for (let i = 0; i < 6; i++) add(g, G.stake, darkWood, Math.cos(i) * 0.4, -0.1, Math.sin(i) * 0.4, 0.6, 0.6, 0.6).rotation.set(Math.sin(i) * 0.6, 0, Math.cos(i) * 0.6);
    } else {
      // A painted cairn.
      for (let i = 0; i < 4; i++) add(g, G.ball, i % 2 ? paint : stone, 0, 0.18 + i * 0.3, 0, 0.42 - i * 0.07, 0.2, 0.38 - i * 0.06);
    }
    g.scale.setScalar(Math.max(0.8, S * 0.95));
    scene.add(g);
    p.mesh = g;
    p.solid = kind === "garden" || kind === "blooms" ? [] : [{ x: p.x, z: p.z, r: 0.45 }];
    p.r = 1.2;
  }
  function buildSeat(p) {
    const g = groupAt(p.x, p.z, -p.a + Math.PI / 2);
    add(g, G.log, wood, 0, 0.18, 0, 0.6, 0.85, 0.85);
    scene.add(g);
    p.mesh = g;
    p.r = 0.6;
    p.solid = [];
    // Sit just inside the log, facing the fire.
    p.spots = [{ x: FIRE.x + Math.cos(p.a) * (p.R - 0.55), z: FIRE.z + Math.sin(p.a) * (p.R - 0.55), by: null }];
  }
  const BUILD = { shelter: buildShelter, storage: buildStorage, rack: buildRack, craft: buildCraft, training: buildTraining, fence: buildFence, trophy: buildTrophy, garden: buildGarden, ring: buildRing, decor: buildDecor, seat: buildSeat };

  function place(id, x, z, k = 0, extra = {}) {
    const p = { id, x, z, k, ...extra };
    BUILD[id](p);
    bake(p);
    pieces.push(p);
    if (id === "garden") addGardenNode(p);
    setFixed(fixed);
    return p;
  }
  function removePiece(p) {
    unbuild(p);
    pieces.splice(pieces.indexOf(p), 1);
    setFixed(fixed);
  }
  const count = (id) => pieces.filter((p) => p.id === id).length;

  /** Seats round the campfire at fixed angles (always clear of the fire's own stones). */
  function seatSpot(i) {
    const a = 0.3 + i * (TAU / 10) + (i % 2) * 0.12;
    // Far enough out that a ring of these creatures, heads to the fire, doesn't overlap.
    const R = Math.max(3.1 * Math.max(0.85, S), (c.bodyLength || 3) * 0.75 + 1.6);
    return { a, R, x: FIRE.x + Math.cos(a) * R, z: FIRE.z + Math.sin(a) * R };
  }
  /** Fence runs sit on a ring outside the village, on the land side, with gaps to walk through. */
  function fenceSpot(i) {
    const R = 21 * style.spacing + 2;
    const order = [0, 1, -1, 2, -2, 3, -3];
    const a = inland + order[i % order.length] * (8.6 / R);
    return { a, R, x: HOME.x + Math.cos(a) * R, z: HOME.z + Math.sin(a) * R };
  }

  /**
   * Bring the village up to its plan: add what is missing, improve what has grown (storage, shelters).
   * Nothing is torn down when the tribe shrinks: an empty shelter is still a shelter.
   * @returns {string[]} ids of new pieces (for the stage's reactions)
   */
  function grow(pop, o) {
    const plan = villagePlan(pop, { ...o, style });
    const made = [];
    const make = (id, at, k, extra) => {
      if (!at) return null;
      const p = place(id, at.x, at.z, k, extra);
      made.push(id);
      return p;
    };
    // Storage first, where the old food pile stood; improved in place.
    let store = pieces.find((p) => p.id === "storage");
    if (!store) store = make("storage", PILE, plan.storage);
    else if (store.k < plan.storage) {
      unbuild(store);
      store.k = plan.storage;
      buildStorage(store);
      bake(store);
      made.push("storage+");
    }
    // Shelters, upgraded with the hut.
    for (let i = count("shelter"); i < plan.shelters; i++) if (!make("shelter", findSpot(HOME.x, HOME.z, 8.5, 22, 2 * S, inland, Math.PI * 0.75), plan.shelterTier)) break;
    for (const p of pieces.filter((x) => x.id === "shelter" && x.k < plan.shelterTier)) {
      unbuild(p);
      p.k = plan.shelterTier;
      buildShelter(p);
      bake(p);
    }
    for (let i = count("seat"); i < plan.seats; i++) {
      const s = seatSpot(i);
      make("seat", s, i, { a: s.a, R: s.R });
    }
    if (plan.rack && !count("rack")) make("rack", findSpot(FIRE.x, FIRE.z, 5, 12, 1.2, Math.atan2(HOME.z - FIRE.z, HOME.x - FIRE.x) + 1.2, Math.PI * 0.6));
    if (plan.craft && !count("craft")) make("craft", findSpot(HOME.x, HOME.z, 7, 16, 1.6, inland - 1.3, Math.PI * 0.7));
    if (plan.training && !count("training")) make("training", findSpot(HOME.x, HOME.z, 13, 24, 3.8, inland + 1.2, Math.PI * 0.8));
    for (let i = count("fence"); i < plan.fence * 2; i++) {
      const f = fenceSpot(i);
      if (heightAt(f.x, f.z) < 0.3) continue;
      make("fence", f, i, { a: f.a, R: f.R });
    }
    for (let i = count("trophy"); i < plan.trophies; i++) if (!make("trophy", findSpot(HOME.x, HOME.z, 4.5, 12, 0.8, Math.atan2(FIRE.z - HOME.z, FIRE.x - HOME.x) + 0.9, Math.PI * 0.5), i)) break;
    for (let i = count("garden"); i < plan.garden; i++) if (!make("garden", findSpot(HOME.x, HOME.z, 10, 22, 2.4, inland - 0.6, Math.PI * 0.6), i)) break;
    if (plan.ring && !count("ring")) make("ring", findSpot(FIRE.x, FIRE.z, 8, 16, 3.8, Math.atan2(FIRE.z - HOME.z, FIRE.x - HOME.x), Math.PI * 0.6));
    for (let i = count("decor"); i < plan.decor; i++) if (!make("decor", findSpot(HOME.x, HOME.z, 6, 19, 0.9, inland + i * 0.9, Math.PI), i, { kinds: o.decorKinds })) break;
    if (made.length) fillAllRacks();
    return made;
  }
  const fillAllRacks = () => pieces.filter((p) => p.id === "rack").forEach(fillRack);

  /* ---- the food store: what's in it shows how much there is, and what it is --------------- */
  const recent = []; // the kinds of food brought in lately
  let shownFood = -1,
    shownKinds = "";
  const storeItems = [];
  function syncStore(food) {
    const store = pieces.find((p) => p.id === "storage");
    if (!store) return;
    const per = 5;
    const cap = [16, 26, 38][store.k - 1];
    const n = Math.min(cap, Math.ceil(food / per));
    const kinds = recent.join(",");
    if (n === shownFood && kinds === shownKinds && store.mesh === storeItems.owner) return;
    shownFood = n;
    shownKinds = kinds;
    storeItems.forEach((m) => m.removeFromParent());
    storeItems.length = 0;
    storeItems.owner = store.mesh;
    (storeItems.baked || []).forEach((g) => g.dispose());
    if (storeItems.holder) storeItems.holder.removeFromParent();
    // All the food in one group, baked into a few meshes (it only changes when the stock does).
    const holder = new THREE.Group();
    store.mesh.add(holder);
    storeItems.holder = holder;
    // Fill the baskets first, then heap the rest in the middle.
    const bs = store.baskets;
    for (let i = 0; i < n; i++) {
      const kind = recent.length ? recent[(recent.length - 1 - (i % recent.length) + recent.length) % recent.length] : "fruit";
      const m = foodItem(kind);
      if (i < bs.length * 3) {
        const b = bs[i % bs.length];
        const layer = Math.floor(i / bs.length);
        m.position.set(b.position.x + Math.cos(i * 2.4) * 0.16 * (layer ? 0.6 : 1), 0.38 + layer * 0.16, b.position.z + Math.sin(i * 2.4) * 0.16 * (layer ? 0.6 : 1));
      } else {
        const j = i - bs.length * 3,
          layer = j < 9 ? 0 : j < 15 ? 1 : 2,
          ring = [9, 6, 99][layer],
          a = ((j - [0, 9, 15][layer]) / ring) * TAU + layer;
        const r = [0.8, 0.45, 0.15][layer];
        m.position.set(Math.cos(a) * r, 0.2 + layer * 0.34, Math.sin(a) * r);
      }
      m.rotation.y = i * 0.7;
      holder.add(m);
    }
    storeItems.baked = mergeStatic(holder);
    // Empty stores look it: baskets knocked over, the rack bare.
    const bare = food < 4;
    bs.forEach((b, i) => (b.rotation.x = bare && i % 2 === 0 ? 1.3 : 0));
    store.hang?.forEach((h, i) => (h.visible = food > 20 + i * 8));
  }
  /** A load brought home: remember what it was. */
  function delivered(kind) {
    if (!FOOD_LOOK[kind] || kind === "supplies") kind = "loot";
    recent.push(kind);
    if (recent.length > 12) recent.shift();
  }

  /* ---- forage patches ----------------------------------------------------------------------- */
  const nodes = [];
  const forageMeshes = {
    mushroom(g) {
      const capM = FOOD_LOOK.mushroom[1],
        stem = mat(0xf2ead8);
      const items = [];
      for (let i = 0; i < 5; i++) {
        const it = new THREE.Group();
        it.position.set(Math.cos(i * 2.4) * 0.45, 0, Math.sin(i * 2.4) * 0.45);
        add(it, G.post, stem, 0, 0, 0, 0.8, 0.28 + (i % 2) * 0.1, 0.8);
        add(it, G.dome, capM, 0, 0.26 + (i % 2) * 0.1, 0, 0.24, 0.18, 0.24);
        g.add(it);
        items.push(it);
      }
      return items;
    },
    roots(g) {
      const items = [];
      for (let i = 0; i < 5; i++) {
        const it = new THREE.Group();
        it.position.set(Math.cos(i * 2.4) * 0.5, 0, Math.sin(i * 2.4) * 0.5);
        for (let j = 0; j < 3; j++) add(it, G.leafBlade, leaf2, 0, 0.05, 0, 0.8).rotation.set(Math.cos(j * 2) * 0.5, 0, Math.sin(j * 2) * 0.5);
        add(it, G.horn, FOOD_LOOK.roots[1], 0, 0.06, 0, 1.1).rotation.z = Math.PI;
        g.add(it);
        items.push(it);
      }
      add(g, G.disk, soil, 0, 0.02, 0, 0.9);
      return items;
    },
    nuts(g) {
      add(g, G.ball, leaf, 0, 0.6, 0, 0.9, 0.7, 0.9);
      const items = [];
      for (let i = 0; i < 6; i++) items.push(add(g, G.small, FOOD_LOOK.nuts[1], Math.cos(i * 1.1) * 0.8, 0.45 + (i % 3) * 0.25, Math.sin(i * 1.1) * 0.8, 0.55));
      return items;
    },
    herbs(g) {
      const items = [];
      for (let i = 0; i < 5; i++) {
        const it = new THREE.Group();
        it.position.set(Math.cos(i * 2.4) * 0.5, 0, Math.sin(i * 2.4) * 0.5);
        for (let j = 0; j < 4; j++) add(it, G.leafBlade, j % 2 ? leaf : leaf2, 0, 0, 0, 1.1).rotation.set(Math.cos(j * 1.6) * 0.6, 0, Math.sin(j * 1.6) * 0.6);
        add(it, G.small, paint, 0, 0.6, 0, 0.35);
        g.add(it);
        items.push(it);
      }
      return items;
    },
    grubs(g) {
      add(g, G.ball, earth, 0, 0, 0, 0.9, 0.38, 0.9);
      add(g, G.log, darkWood, 0.6, 0.2, 0.3, 0.7, 0.9, 0.9).rotation.y = 0.6;
      const items = [];
      for (let i = 0; i < 5; i++) items.push(add(g, G.capsule, FOOD_LOOK.grubs[1], Math.cos(i * 1.3) * 0.55, 0.3, Math.sin(i * 1.3) * 0.55, 1.2));
      return items;
    },
    eggs(g) {
      add(g, G.ring, thatch, 0, 0.12, 0, 0.55, 3, 0.55);
      const items = [];
      for (let i = 0; i < 4; i++) items.push(add(g, G.ball, FOOD_LOOK.eggs[1], Math.cos(i * 1.6) * 0.22, 0.18, Math.sin(i * 1.6) * 0.22, 0.15, 0.2, 0.15));
      return items;
    },
  };
  function makeNode(x, z, kind, far) {
    const g = groupAt(x, z, Math.random() * TAU);
    const items = forageMeshes[kind](g);
    const baked = [];
    for (const it of items) if (it.isGroup) baked.push(...mergeStatic(it));
    items.forEach((it) => (it.userData.dyn = true));
    baked.push(...mergeStatic(g));
    scene.add(g);
    const f = FORAGE[kind];
    const node = { x, z, kind, stock: f.stock, max: f.stock, regrow: f.regrow, t: 0, items, mesh: g, far, claim: 0, baked };
    nodes.push(node);
    syncNode(node);
    return node;
  }
  function addGardenNode(p) {
    const kind = c.diet === "meat" ? "grubs" : "herbs";
    const node = { x: p.x, z: p.z, kind, stock: 6, max: 6, regrow: 25, t: 0, items: p.crop, mesh: p.mesh, far: false, claim: 0, garden: true };
    nodes.push(node);
    p.node = node;
  }
  function syncNode(node) {
    const k = node.items.length;
    const show = Math.ceil((node.stock / node.max) * k);
    node.items.forEach((m, i) => (m.visible = i < show));
  }
  /** Patches near the village, and a richer grove further out that is worth a trip together. */
  function scatterNodes() {
    const kinds = forageKinds(c.diet);
    let seed = 0;
    for (const ch of String(c.regionId)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let made = 0;
    for (let tries = 0; tries < 400 && made < 9; tries++) {
      const a = inland + (rand() - 0.5) * Math.PI * 1.7,
        r = 16 + rand() * 30;
      const x = HOME.x + Math.cos(a) * r,
        z = HOME.z + Math.sin(a) * r;
      if (!clearAt(x, z, 1.3) || nodes.some((n) => Math.hypot(n.x - x, n.z - z) < 7)) continue;
      makeNode(x, z, kinds[made % kinds.length], false);
      made++;
    }
    // The grove: a cluster well inland.
    for (let tries = 0; tries < 200; tries++) {
      const a = inland + (rand() - 0.5) * 1.6,
        r = 62 + rand() * 18;
      const gx = HOME.x + Math.cos(a) * r,
        gz = HOME.z + Math.sin(a) * r;
      if (heightAt(gx, gz) < 0.6) continue;
      let n = 0;
      for (let k = 0; k < 30 && n < 5; k++) {
        const x = gx + (rand() - 0.5) * 12,
          z = gz + (rand() - 0.5) * 12;
        if (!clearAt(x, z, 1.2) || nodes.some((q) => Math.hypot(q.x - x, q.z - z) < 3.2)) continue;
        makeNode(x, z, kinds[(n + 1) % kinds.length], true);
        n++;
      }
      if (n >= 3) {
        grove.x = gx;
        grove.z = gz;
        break;
      }
    }
  }
  const grove = { x: null, z: null };
  function updateNodes(dt) {
    for (const n of nodes) {
      if (n.stock >= n.max) continue;
      n.t += dt;
      if (n.t >= n.regrow) {
        n.t = 0;
        n.stock++;
        syncNode(n);
      }
    }
  }

  /* ---- sleeping, sitting and working places ------------------------------------------------ */
  function sleepSpots() {
    const out = [];
    for (const p of pieces) if (p.id === "shelter") out.push(...p.spots);
    return out;
  }
  /** Ribbons flutter, lanterns glow at night. */
  let clock = 0;
  function animate(dt, night) {
    clock += dt;
    for (const p of pieces) {
      if (p.glow) p.glow.material.emissiveIntensity = night ? 1.4 : 0.25;
      if ((p.id === "ring" || p.kind === "streamers") && p.mesh)
        p.mesh.traverse((m) => {
          if (m.userData.flutter !== undefined) m.rotation.z = Math.sin(clock * 3 + m.userData.flutter) * 0.25;
        });
    }
  }

  return {
    style,
    pieces,
    obstacles,
    nodes,
    grove,
    setFixed,
    place,
    removePiece,
    grow,
    fillAllRacks,
    syncStore,
    delivered,
    /** Portions of food shown in the store right now. */
    get storeShown() {
      return shownFood;
    },
    carryBundle,
    foodItem,
    scatterNodes,
    updateNodes,
    syncNode,
    sleepSpots,
    animate,
    findSpot,
    /** Save form: where each self-built piece stands. */
    save: () => pieces.filter((p) => p.id !== "seat").map((p) => ({ id: p.id, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, k: p.k || 0 })),
    /** Rebuild a saved village exactly where it stood. */
    load(list) {
      for (const a of list) {
        if (a.id === "fence") {
          const f = fenceSpot(a.k);
          place("fence", f.x, f.z, a.k, { a: f.a, R: f.R });
        } else place(a.id, a.x, a.z, a.k);
      }
    },
    /** A player-built garden is a forage patch too. */
    gardenNodeFor: addGardenNode,
    dispose() {
      pieces.forEach(unbuild);
      nodes.forEach((n) => {
        if (n.garden) return;
        scene.remove(n.mesh);
        (n.baked || []).forEach((g) => g.dispose());
      });
      disposeLater.forEach((d) => d.dispose());
    },
  };
}

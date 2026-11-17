/* global Buffer, process */
// Top-down map of the creature island as a PPM image: terrain height and colour, nests, fossils, start.
// Usage: node games/spore/dev/island-map.mjs out.ppm
import * as THREE from "three";
import { writeFileSync } from "node:fs";
import { ISLAND, PEAKS, createIsland, heightAt, areaAt } from "../creature/world.js";

const scene = new THREE.Scene();
const world = createIsland(scene, "medium");
const N = 480, half = 240;
const img = Buffer.alloc(N * N * 3);
const put = (x, z, rgb, rad = 0) => {
  for (let i = -rad; i <= rad; i++) for (let j = -rad; j <= rad; j++) {
    const px = Math.round(x + half) + i, pz = Math.round(z + half) + j;
    if (px < 0 || pz < 0 || px >= N || pz >= N) continue;
    img.set(rgb, (pz * N + px) * 3);
  }
};
for (let pz = 0; pz < N; pz++) for (let px = 0; px < N; px++) {
  const x = px - half, z = pz - half, h = heightAt(x, z), a = areaAt(x, z);
  const shade = Math.max(0, Math.min(1, 0.55 + (heightAt(x + 1, z) - h) * 0.6));
  let c = Math.hypot(x, z) > ISLAND.shore ? [47, 143, 192] : a === "Beach" ? [227, 207, 149] : a === "Mountains" ? [120, 115, 105] : a === "Foothills" ? [150, 150, 95] : [110, 180, 80];
  c = c.map((v) => Math.round(v * (0.7 + shade * 0.5)));
  img.set(c, (pz * N + px) * 3);
}
world.nestSites.forEach((n) => put(n.x, n.z, [220, 40, 40], 3));
world.bonePiles.forEach((b) => put(b.x, b.z, [255, 240, 160], 1));
put(ISLAND.nest.x, ISLAND.nest.z, [40, 40, 255], 4);
PEAKS.forEach((p) => { for (let a = 0; a < 6.28; a += 0.02) put(p.x + Math.cos(a) * p.solid, p.z + Math.sin(a) * p.solid, [60, 20, 20]); });
writeFileSync(process.argv[2], Buffer.concat([Buffer.from(`P6 ${N} ${N} 255\n`), img]));
console.log("nests", world.nestSites.length, "fossils", world.bonePiles.length, "fruit", world.fruits.length);
console.log(world.nestSites.map((n) => `${n.rank}:${Math.round(n.x)},${Math.round(n.z)}`).join(" "));

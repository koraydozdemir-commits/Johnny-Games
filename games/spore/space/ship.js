// The ship is built from the spaceship editor's own parts, then given better materials and engines.
import * as THREE from "three";
import { buildDesignMesh } from "../creations/mesh.js";
import { glowSprite } from "./space.js";

export const DESIGN = {
  kind: "ship", v: 1, name: "Wanderer", role: "explorer", colors: { base: 0xdfe7ee, accent: 0x12b5c9, trim: 0x25303f },
  parts: [
    { id: "shipHull", x: 0, y: 0, z: 0.1 },
    { id: "saucer", x: 0, y: -0.08, z: -0.55, s: 0.78 },
    { id: "cockpit", x: 0, y: 0.52, z: 0.85, s: 0.95 },
    { id: "shipWing", x: 1.75, y: -0.12, z: -0.95, ry: 0.42, mirror: true, s: 0.85 },
    { id: "engine", x: 0.62, y: -0.05, z: -1.95, mirror: true, s: 1.05 },
    { id: "engine", x: 3.0, y: -0.12, z: -1.45, mirror: true, s: 0.62 },
    { id: "laser", x: 3.0, y: -0.12, z: -0.35, mirror: true, s: 0.9 },
    { id: "finS", x: 0.55, y: 0.72, z: -1.5, mirror: true },
    { id: "lightS", x: 3.05, y: 0.18, z: -1.4, mirror: true, s: 0.55, paint: "accent" },
    { id: "pod", x: 0, y: -0.5, z: 0.5, s: 0.42, paint: "trim" },
  ],
};
// Engine nozzles (design space): [x, y, z, size]
const NOZZLES = [[0.62, -0.05, -2.85, 1], [-0.62, -0.05, -2.85, 1], [3.0, -0.12, -1.98, 0.55], [-3.0, -0.12, -1.98, 0.55]];
export const MUZZLES = [new THREE.Vector3(3.0, -0.12, 0.45), new THREE.Vector3(-3.0, -0.12, 0.45)];

export function makeShip() {
  const mats = {
    base: new THREE.MeshStandardMaterial({ color: DESIGN.colors.base, roughness: 0.32, metalness: 0.55 }),
    accent: new THREE.MeshStandardMaterial({ color: DESIGN.colors.accent, roughness: 0.28, metalness: 0.45, emissive: 0x033038 }),
    trim: new THREE.MeshStandardMaterial({ color: DESIGN.colors.trim, roughness: 0.45, metalness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x7fe6ff, roughness: 0.05, metalness: 0.9, emissive: 0x0b4a66 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8d98a6, roughness: 0.25, metalness: 0.9 }),
  };
  const model = buildDesignMesh(DESIGN, { materials: mats }).root;
  const group = new THREE.Group(); // position and heading
  const body = new THREE.Group(); // banking
  group.add(body);
  body.add(model);
  const flames = [];
  const flameMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 }, uPower: { value: 0.3 } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float uTime,uPower; varying vec2 vUv; void main(){ float t=clamp(vUv.y,0.,1.); float f=.82+.18*sin(vUv.x*40.+uTime*38.-t*18.); vec3 c=mix(vec3(.05,.24,1.2),vec3(.7,1.25,1.7),pow(t,3.)); gl_FragColor=vec4(c*pow(t,1.7)*f*(.3+uPower*.45),1.); }`,
  });
  for (const [x, y, z, s] of NOZZLES) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.34 * s, 2.4 * s, 20, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -1.2 * s), flameMat);
    cone.position.set(x, y, z);
    const glow = glowSprite(0x3aa8ff, 1.4 * s, 0.4);
    glow.position.set(x, y, z);
    body.add(cone, glow);
    flames.push({ cone, glow, s });
  }
  const nav = [glowSprite(0xff3b4a, 0.9), glowSprite(0x43ff8a, 0.9)];
  nav[0].position.set(3.35, 0.2, -1.4);
  nav[1].position.set(-3.35, 0.2, -1.4);
  body.add(...nav);
  group.scale.setScalar(0.62);
  return {
    group, body,
    update(t, power) {
      flameMat.uniforms.uTime.value = t;
      flameMat.uniforms.uPower.value = power;
      for (const f of flames) {
        f.cone.scale.set(1, 1, 0.3 + power * 1.25);
        f.glow.scale.setScalar(f.s * (1.0 + power * 0.6 + Math.sin(t * 40) * 0.08));
      }
      const on = t % 1.2 < 0.12;
      nav[0].visible = nav[1].visible = on;
    },
    nozzles: NOZZLES.slice(0, 2).map((n) => new THREE.Vector3(n[0], n[1], n[2])),
  };
}

/** A ribbon left behind an engine. */
export class Trail {
  constructor(color, width = 0.22, len = 36, maxRun = 11) {
    this.maxRun = maxRun;
    this.len = len;
    this.width = width;
    this.pts = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(len * 9);
    this.col = new Float32Array(len * 9);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    const idx = [];
    // Three points across: bright down the middle, fading to nothing at both edges.
    for (let i = 0; i < len - 1; i++)
      for (const j of [0, 1]) {
        const a = i * 3 + j, b = a + 3;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    g.setIndex(idx);
    this.color = new THREE.Color(color);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
  }
  clear() {
    this.pts.length = 0;
  }
  push(p, camera, power) {
    this.pts.unshift(p.clone());
    if (this.pts.length > this.len) this.pts.pop();
    let run = 0; // cap the ribbon's length however fast we go
    for (let i = 1; i < this.pts.length; i++) {
      run += this.pts[i].distanceTo(this.pts[i - 1]);
      if (run > this.maxRun) {
        this.pts.length = i;
        break;
      }
    }
    const side = new THREE.Vector3(), dir = new THREE.Vector3(), view = new THREE.Vector3();
    for (let i = 0; i < this.len; i++) {
      const a = this.pts[Math.min(i, this.pts.length - 1)], b = this.pts[Math.min(i + 1, this.pts.length - 1)];
      dir.subVectors(a, b);
      view.subVectors(camera.position, a);
      side.crossVectors(dir, view).normalize();
      const k = 1 - i / (this.len - 1);
      side.multiplyScalar(this.width * k);
      this.pos.set([a.x + side.x, a.y + side.y, a.z + side.z, a.x, a.y, a.z, a.x - side.x, a.y - side.y, a.z - side.z], i * 9);
      const f = k * k * power * 1.4;
      this.col.set([0, 0, 0, this.color.r * f, this.color.g * f, this.color.b * f, 0, 0, 0], i * 9);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

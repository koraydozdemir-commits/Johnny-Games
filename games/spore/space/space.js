// The sun, the sky, rocks, the comet and particle effects.
import * as THREE from "three";
import { NOISE } from "./glsl.js";
import { bake } from "./planets.js";

export function makeSky(renderer, quality) {
  const rt = bake(renderer, 2048 * quality, 1024 * quality, /* glsl */ `
    void main(){
      vec3 d=dirFromUv(vUv);
      vec3 w=vec3(fbm(d*2.,5),fbm(d*2.+11.,5),fbm(d*2.+23.,5));
      // The arm: a bright band of cloud with dark dust lanes.
      float band=exp(-pow((d.y+.22*d.x+w.y*.18)*3.1,2.));
      float n=fbm(d*2.6+w*1.8,7), n2=fbm(d*4.1-w*2.2+31.,7);
      vec3 col=vec3(.0025,.0035,.012);
      col+=vec3(.015,.075,.095)*pow(max(n+.28,0.),2.)*(band*1.5+.14);   // teal gas (Verdant Arm)
      col+=vec3(.11,.025,.13)*pow(max(n2+.2,0.),2.4)*(band*1.4+.18);     // violet
      col+=vec3(.20,.10,.035)*pow(max(fbm(d*6.+w*3.,6),0.),2.)*band*1.6; // warm knots
      col*=1.-smoothstep(.0,.42,fbm(d*5.5+w*2.4+57.,6))*band*.85;        // dust
      col+=vec3(.025,.03,.045)*band*(.6+n);
      col=mix(vec3(.0025,.0035,.012),col,.28+.72*band);   // quiet away from the arm
      gl_FragColor=vec4(sqrt(max(col,0.)),1.);
    }`);
  const group = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(9000, 64, 40), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: { uMap: { value: rt.texture } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform sampler2D uMap; varying vec2 vUv; void main(){vec3 c=texture2D(uMap,vUv).rgb; float n=fract(sin(dot(gl_FragCoord.xy,vec2(12.9,78.2)))*43758.5); gl_FragColor=vec4(c*c+(n-.5)*.0015,1.);}`,
  }));
  dome.renderOrder = -2;
  group.add(dome);
  // Stars, denser along the arm.
  const N = 7000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
  const v = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    v.randomDirection();
    if (i % 2) v.y = v.y * 0.22 - 0.22 * v.x + (Math.random() - 0.5) * 0.14;
    v.normalize().multiplyScalar(8500);
    v.toArray(pos, i * 3);
    c.setHSL([0.6, 0.62, 0.12, 0.08, 0.0][i % 5], 0.55, 0.78);
    const big = Math.random() < 0.025;
    const k = big ? 1.25 : 0.25 + Math.random() * 0.7;
    c.multiplyScalar(k).toArray(col, i * 3);
    size[i] = big ? 3.4 : 1 + Math.random() * 1.6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("size", new THREE.BufferAttribute(size, 1));
  const stars = new THREE.Points(g, new THREE.ShaderMaterial({
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPx: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute float size; uniform float uPx; varying vec3 vC; void main(){vC=color; gl_PointSize=size*uPx; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 vC; void main(){float d=length(gl_PointCoord-.5); gl_FragColor=vec4(vC*smoothstep(.5,.1,d),1.);}`,
  }));
  stars.renderOrder = -1;
  group.add(stars);
  return group;
}

// Colour shifts from the approved orange sun, per star kind.
export const SUN_TINT = { orange: [1, 1, 1], yellow: [1, 1.12, 1.35], white: [0.95, 1.2, 1.9], blue: [0.62, 0.95, 2.4], red: [1.0, 0.5, 0.38], binary: [1, 1.05, 1.2] };
export function makeSun(radius, kind = "orange") {
  const group = new THREE.Group();
  const time = { value: 0 };
  const tint = { value: new THREE.Vector3(...(SUN_TINT[kind] || SUN_TINT.orange)) };
  const body = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), new THREE.ShaderMaterial({
    uniforms: { uTime: time, uTint: tint },
    vertexShader: `varying vec3 vO,vN,vW; void main(){vO=normalize(position); vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader: NOISE + `uniform float uTime; uniform vec3 uTint; varying vec3 vO,vN,vW;
      void main(){ float a=fbm(vO*5.+vec3(0.,uTime*.06,0.),4); float b=fbm(vO*14.-uTime*.12+a*2.,3);
        float spot=smoothstep(.34,.55,fbm(vO*2.4+7.,4));
        vec3 c=mix(vec3(1.35,.34,.02),vec3(2.3,1.25,.28),clamp(a*1.4+b*.9+.45,0.,1.));
        c=mix(c,vec3(.7,.12,.01),spot*.75);
        float mu=max(dot(normalize(vN),normalize(cameraPosition-vW)),0.);
        c*=.55+.65*pow(mu,.55); c+=vec3(2.4,.7,.08)*pow(clamp(1.-mu,0.,1.),2.2);
        gl_FragColor=vec4(c*uTint,1.); }`,
  }));
  group.add(body);
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(radius * 8, radius * 8), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: time, uTint: tint },
    vertexShader: `varying vec2 vP; void main(){vP=position.xy/${(radius * 1).toFixed(1)}; vec4 c=modelViewMatrix*vec4(0.,0.,0.,1.); c.xy+=position.xy; gl_Position=projectionMatrix*c;}`,
    fragmentShader: NOISE + `uniform float uTime; uniform vec3 uTint; varying vec2 vP;
      void main(){ float r=length(vP); if(r<.96) discard; float an=atan(vP.y,vP.x);
        vec3 q=vec3(cos(an),sin(an),0.);
        float ray=fbm(q*4.+vec3(0.,0.,r*.7-uTime*.12),4)*.9+fbm(q*13.+vec3(0.,0.,r*1.6-uTime*.3),3)*.5;
        float g=exp(-(r-1.)*2.6)*(1.+ray*1.3)*.42+exp(-(r-1.)*14.)*.6+exp(-(r-1.)*.9)*.035;
        g*=smoothstep(4.,2.2,r);
        gl_FragColor=vec4(vec3(1.5,.62,.17)*uTint*max(g,0.),1.); }`,
  }));
  corona.frustumCulled = false;
  group.add(corona);
  return { group, update: (t) => (time.value = t), radius };
}

/** A lumpy rock. */
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position, v = new THREE.Vector3(), col = new Float32Array(p.count * 3);
  let s = seed;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const bumps = Array.from({ length: 14 }, () => ({ d: new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize(), a: rand() * 0.55 - 0.28, w: 2 + rand() * 7 }));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let r = 1;
    for (const b of bumps) r += b.a * Math.exp((v.dot(b.d) - 1) * b.w);
    r += 0.045 * Math.sin(v.x * 13 + seed) * Math.sin(v.y * 11) * Math.sin(v.z * 12);
    const shade = THREE.MathUtils.clamp(0.35 + (r - 0.9) * 1.6, 0.15, 1);
    col.set([shade, shade * 0.93, shade * 0.86], i * 3);
    v.multiplyScalar(r);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
export const rockGeos = [rockGeometry(11), rockGeometry(97), rockGeometry(53)];
export const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xb59a80, roughness: 0.95, metalness: 0.05, flatShading: true });

export function makeBelt(radius, width, count) {
  const group = new THREE.Group(), o = new THREE.Object3D();
  for (let k = 0; k < 3; k++) {
    const m = new THREE.InstancedMesh(rockGeos[k], rockMat, count / 3);
    for (let i = 0; i < count / 3; i++) {
      const a = Math.random() * Math.PI * 2, r = radius + (Math.random() - 0.5) * width * (0.4 + Math.random());
      o.position.set(Math.cos(a) * r, (Math.random() - 0.5) * 55 * Math.random(), Math.sin(a) * r);
      o.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      o.scale.setScalar(0.8 + Math.pow(Math.random(), 5) * 11);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.frustumCulled = false;
    group.add(m);
  }
  return group;
}

let dot = null;
export function dotTexture() {
  if (dot) return dot;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return (dot = new THREE.CanvasTexture(c));
}
export function glowSprite(color, size, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size);
  return s;
}

/** One pool of glowing particles for explosions, exhaust sparks and the like. */
export class Particles {
  constructor(max = 2500) {
    this.max = max;
    this.i = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.p = Array.from({ length: max }, () => ({ v: new THREE.Vector3(), life: 0, max: 1, size: 1, c: new THREE.Color(), grow: 0 }));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    g.setAttribute("size", new THREE.BufferAttribute(this.size, 1));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uMap: { value: dotTexture() }, uH: { value: 800 } },
      vertexShader: `attribute float size; uniform float uH; varying vec3 vC; void main(){vC=color; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=min(size*uH/max(-mv.z,1.),220.); gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform sampler2D uMap; varying vec3 vC; void main(){gl_FragColor=vec4(vC*texture2D(uMap,gl_PointCoord).a,1.);}`,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }
  spawn(pos, vel, color, size, life, grow = 0) {
    const i = this.i++ % this.max, p = this.p[i];
    pos.toArray(this.pos, i * 3);
    p.v.copy(vel);
    p.c.set(color);
    p.size = size;
    p.life = p.max = life;
    p.grow = grow;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) {
        this.size[i] = 0;
        continue;
      }
      p.life -= dt;
      const k = Math.max(0, p.life / p.max);
      this.pos[i * 3] += p.v.x * dt;
      this.pos[i * 3 + 1] += p.v.y * dt;
      this.pos[i * 3 + 2] += p.v.z * dt;
      p.v.multiplyScalar(1 - 0.9 * dt);
      this.col[i * 3] = p.c.r * k * 2;
      this.col[i * 3 + 1] = p.c.g * k * 2;
      this.col[i * 3 + 2] = p.c.b * k * 2;
      this.size[i] = p.size * (1 + p.grow * (1 - k));
    }
    for (const n of ["position", "color", "size"]) this.points.geometry.attributes[n].needsUpdate = true;
  }
}

export function makeComet(position, sunPos) {
  const group = new THREE.Group();
  group.position.copy(position);
  const head = new THREE.Mesh(rockGeos[1], new THREE.MeshStandardMaterial({ color: 0xcfeaff, emissive: 0x3a7fb0, roughness: 0.5, flatShading: true }));
  head.scale.setScalar(5);
  group.add(head, glowSprite(0x8fd8ff, 30, 0.45));
  const away = position.clone().sub(sunPos).normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(away).normalize();
  const tail = (n, len, spread, curve, color, size) => {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color(color), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const t = Math.pow(Math.random(), 1.5);
      v.copy(away).multiplyScalar(t * len).addScaledVector(side, curve * t * t * len);
      v.add(new THREE.Vector3().randomDirection().multiplyScalar(Math.random() * (2 + t * spread)));
      v.toArray(pos, i * 3);
      c.set(color).multiplyScalar((1 - t) * (1 - t) * 0.26).toArray(col, i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ size, map: dotTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  };
  group.add(tail(2600, 260, 22, 0, 0x6fc8ff, 7), tail(1800, 190, 34, 0.35, 0xffe2b8, 9));
  return group;
}

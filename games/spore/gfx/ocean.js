/**
 * The cell-stage water: a depth gradient with slanted light shafts, faint caustics, hazy out-of-focus
 * cells in the distance and glowing plankton at three depths. Everything is one full-screen shader plus
 * one points object, and it is endless: both work in world coordinates around the camera.
 */
import * as THREE from "three";

const VERT = `varying vec2 vP; uniform vec2 uCam; uniform vec2 uHalf;
void main(){ vP = uCam + position.xy * uHalf; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;

const FRAG = `
precision highp float;
varying vec2 vP; uniform float uTime; uniform vec2 uCam; uniform vec2 uHalf; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uRay;
float h1(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
vec2 h2(vec2 p){ p = vec2(dot(p, vec2(127.1,311.7)), dot(p, vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f); return mix(mix(h1(i),h1(i+vec2(1,0)),u.x), mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vn(p); p=p*2.03+11.7; a*=.5;} return s; }
// hazy distant cells: soft voronoi rings that sit in the fog
float farCells(vec2 p, float t, out float body){
  vec2 g=floor(p), f=fract(p); float ring=0.; body=0.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 o=vec2(float(x),float(y)); vec2 h=h2(g+o);
    vec2 c=o+0.5+0.32*sin(t*0.25+6.2831*h)-f; float r=0.16+0.2*h.x; float d=length(c)-r;
    ring=max(ring, smoothstep(0.07,0.0,abs(d))*h.y);
    body=max(body, smoothstep(0.0,-0.18,d)*(0.4+0.6*h.y));
  }
  return ring;
}
float caust(vec2 p,float t){
  p += .18*vec2(sin(p.y*1.7+t*.8), cos(p.x*1.5-t*.7));
  vec2 g=floor(p), f=fract(p); float d1=8.,d2=8.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 o=vec2(float(x),float(y)); vec2 h=h2(g+o); h=.5+.42*sin(t*.75+6.2831*h);
    float d=length(o+h-f); if(d<d1){d2=d1;d1=d;} else if(d<d2){d2=d;} }
  return pow(1.-smoothstep(0.,.3,d2-d1),2.2);
}
void main(){
  vec2 sp = (vP - uCam) / uHalf;                 // -1..1 screen
  float v = sp.y*.5+.5;
  // water column: bright above, deep below, with big slow colour drift
  float drift = fbm(vP*0.035 + vec2(uTime*0.01, 0.));
  vec3 col = mix(uDeep, uShallow, smoothstep(-.1,1.05, v*0.85 + drift*0.45 - 0.1));
  col *= 0.8 + 0.35*drift;
  // far layers (parallax) — big out-of-focus cells drifting in the haze
  float b1, b2;
  float r1 = farCells((vP - uCam*0.55)*0.11 + 3.1, uTime, b1);
  float r2 = farCells((vP - uCam*0.8)*0.2 + 9.7, uTime*1.3, b2);
  col += uShallow*0.55*(b1*0.12 + r1*0.12);
  col += uShallow*0.7*(b2*0.09 + r2*0.14);
  // god rays: slanted shafts breathing with noise, strongest at the top, drifting with the camera a little
  vec2 q = vP - uCam*0.3;
  float ang = q.x*0.9 + q.y*0.55;
  float shaft = fbm(vec2(ang*0.55 + uTime*0.03, uTime*0.05));
  shaft = smoothstep(0.38,0.85,shaft) * (0.55+0.45*sin(ang*1.7 + uTime*0.4));
  float fall = smoothstep(-0.9,1.0,v) ;
  col += uRay * shaft * fall * 0.55;
  // caustics on the pool floor, faint, deepest layer
  float c = caust((vP - uCam*0.12)*0.42, uTime);
  col += uRay * c * 0.06 * (0.4+0.6*fall);
  // depth haze: vignette of murk to the edges to push the playfield forward
  float edge = smoothstep(0.5,1.5,length(sp*vec2(.9,1.)));
  col = mix(col, uDeep*0.55, edge*0.5);
  gl_FragColor = vec4(col,1.);
}`;

const PVERT = `
attribute vec4 aS; // x,y base, z depth(0 far..1 near), w seed
uniform vec2 uCam; uniform vec2 uHalf; uniform float uTime; uniform float uPx;
varying float vA; varying float vTw;
void main(){
  float par = mix(0.35, 1.18, aS.z);
  vec2 span = uHalf * 2.4;
  vec2 p = aS.xy * span + vec2(sin(uTime*0.2+aS.w*40.)*0.25, uTime*0.06*(0.4+aS.z) + cos(uTime*0.17+aS.w*30.)*0.2);
  vec2 w = uCam*par;
  p = mod(p - w + span*0.5, span) - span*0.5;
  vec2 world = uCam + p;
  vTw = 0.55 + 0.45*sin(uTime*(0.6+aS.w*1.4)+aS.w*50.);
  float s = mix(2.0, 7.5, aS.z*aS.z) * (0.6+aS.w*0.8);
  vA = mix(0.18, 0.75, aS.z) * smoothstep(0.0, 0.08, 1.0 - abs(p.x)/(span.x*0.5)) ;
  gl_PointSize = s * uPx;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, -6.0 + aS.z*4.0, 1.0);
}`;
const PFRAG = `
precision highp float; varying float vA; varying float vTw; uniform vec3 uColor;
void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d)*2.; float a = smoothstep(1.,0.,r); a*=a; gl_FragColor=vec4(uColor*(1.+a), a*vA*vTw); }`;

export function createOcean(scene) {
  const root = new THREE.Group();
  scene.add(root);
  const shared = {
    uCam: { value: new THREE.Vector2() }, uHalf: { value: new THREE.Vector2(10, 6) }, uTime: { value: 0 },
    uDeep: { value: new THREE.Color(0x021a36) }, uShallow: { value: new THREE.Color(0x1d8fb0) }, uRay: { value: new THREE.Color(0x9fe8ff) },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: shared, vertexShader: VERT, fragmentShader: FRAG, depthWrite: false, depthTest: false });
  mat.toneMapped = false;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false; quad.renderOrder = -100; root.add(quad);

  const N = 420, arr = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { arr[i * 4] = Math.random(); arr[i * 4 + 1] = Math.random(); arr[i * 4 + 2] = Math.pow(Math.random(), 1.6); arr[i * 4 + 3] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute("aS", new THREE.BufferAttribute(arr, 4));
  const pm = new THREE.ShaderMaterial({ uniforms: { ...shared, uPx: { value: 1 }, uColor: { value: new THREE.Color(0xb8f4ff) } }, vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  pm.toneMapped = false;
  const pts = new THREE.Points(g, pm); pts.frustumCulled = false; pts.renderOrder = -50; root.add(pts);

  return {
    setParticles(v) { pts.visible = v; },
    setVisible(v) { root.visible = v; },
    setPixelRatio(r) { pm.uniforms.uPx.value = r; },
    update(time, camera) {
      const hw = (camera.right - camera.left) / 2 / camera.zoom, hh = (camera.top - camera.bottom) / 2 / camera.zoom;
      shared.uCam.value.set(camera.position.x, camera.position.y); shared.uHalf.value.set(hw, hh); shared.uTime.value = time;
    },
    /** Tint the water with a homeworld's own water colour (null restores the default blue-teal). */
    setPlanet(profile) {
      if (!profile) {
        shared.uDeep.value.set(0x021a36);
        shared.uShallow.value.set(0x1d8fb0);
        shared.uRay.value.set(0x9fe8ff);
        return;
      }
      const w = new THREE.Color(profile.water.color),
        m = Math.max(w.r, w.g, w.b, 0.01);
      const lit = new THREE.Color(w.r / m, w.g / m, w.b / m);
      shared.uShallow.value.copy(lit).multiplyScalar(0.62).lerp(new THREE.Color(0x1d8fb0), 0.25);
      shared.uDeep.value.copy(w).multiplyScalar(0.12).lerp(new THREE.Color(0x021a36), 0.4);
      shared.uRay.value.copy(lit).lerp(new THREE.Color(0xffffff), 0.5);
    },
    setZone(deep, shallow, ray) { shared.uDeep.value.set(deep); shared.uShallow.value.set(shallow); shared.uRay.value.set(ray); },
  };
}

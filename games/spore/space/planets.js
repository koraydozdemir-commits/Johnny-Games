import * as THREE from "three";
import { NOISE, VERT_UV } from "./glsl.js";

const lin = (hex) => new THREE.Color(hex); // three converts hex to linear for us

/** Draw a fragment shader once into a texture. */
export const bakeLog = { list: null };
export function bake(renderer, w, h, frag, uniforms = {}) {
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, anisotropy: 8 });
  const scene = new THREE.Scene(), cam = new THREE.Camera();
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT_UV, fragmentShader: "varying vec2 vUv;\n" + NOISE + frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  // In strips, so a slow phone GPU never gets one enormous job (and drops the page).
  const strips = Math.max(1, Math.ceil(h / 128));
  rt.scissorTest = true;
  for (let i = 0; i < strips; i++) {
    rt.scissor.set(0, Math.floor((i * h) / strips), w, Math.ceil(h / strips));
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.getContext().flush();
  }
  rt.scissorTest = false;
  renderer.setRenderTarget(null);
  bakeLog.list?.push(rt);
  mat.dispose();
  quad.geometry.dispose();
  return rt;
}

/* Colour is stored gamma-encoded (sqrt) so dark tones don't band; height goes in alpha (sea = 0.5). */
const TERRAIN = /* glsl */ `
uniform vec3 uDeep,uShallow,uBeach,uLow,uMid,uHigh,uSnow; uniform float uSeed,uSea,uIce,uCrater,uLava,uFreq;
float craters(vec3 p){
  float h=0.; for(int k=0;k<3;k++){ float f=3.5*pow(2.1,float(k)); vec3 q=p*f; vec3 c=floor(q);
    for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){ vec3 o=c+vec3(x,y,z);
      vec3 r=fract(sin(vec3(dot(o,vec3(127.1,311.7,74.7)),dot(o,vec3(269.5,183.3,246.1)),dot(o,vec3(113.5,271.9,124.6))))*43758.5453);
      float d=length(q-(o+r))/(.22+.3*r.x); if(d<1.4) h+=(smoothstep(.75,1.,d)*(1.-smoothstep(1.,1.4,d))*.5-(1.-smoothstep(.0,.95,d))*.35)/float(k+1); } }
  return h;
}
void main(){
  vec3 d=dirFromUv(vUv); vec3 p=d*uFreq+uSeed;
  vec3 w=vec3(fbm(p*1.3,4),fbm(p*1.3+19.,4),fbm(p*1.3+41.,4));
  float cont=fbm(p+w*.75,7);
  float mount=ridged(p*2.4+w*.5);
  float land=smoothstep(uSea-.02,uSea+.18,cont);
  float h=cont-uSea + land*pow(mount,2.2)*.55;
  if(uCrater>0.) h=mix(h, fbm(p*2.,6)*.35+craters(d+uSeed*.01)*.6, uCrater);
  float detail=fbm(d*34.+uSeed,4);
  vec3 col;
  if(h<0.){ col=mix(uShallow,uDeep,smoothstep(0.,.22,-h+detail*.02)); }
  else {
    float moist=fbm(p*2.2+7.,5);
    col=mix(uLow,uMid,smoothstep(-.12,.2,moist+detail*.15));
    col=mix(uBeach,col,smoothstep(.004,.028,h));
    col=mix(col,uHigh,smoothstep(.14,.34,h+detail*.06));
    col=mix(col,uSnow,smoothstep(.40,.52,h+detail*.08));
    col*=.86+.28*smoothstep(-.4,.5,detail+moist*.5);
  }
  float polar=smoothstep(1.-uIce,1.-uIce+.07,abs(d.y)+fbm(d*7.+3.,4)*.09);
  col=mix(col,uSnow,polar); if(polar>.5) h=max(h,.01);
  if(uLava>0.){ float crack=1.-smoothstep(.0,.06,abs(snoise(p*3.+w))); col=mix(col,vec3(1.,.25,.02),crack*uLava*(1.-smoothstep(.0,.2,h))); }
  gl_FragColor=vec4(sqrt(col), clamp(h*.8+.5,0.,1.));
}`;

const CLOUDS = /* glsl */ `
uniform float uSeed,uCover;
void main(){
  vec3 d=dirFromUv(vUv);
  // Stretch along latitude and swirl, so clouds read as weather rather than static.
  vec3 q=d*vec3(2.2,4.2,2.2)+uSeed;
  vec3 w=vec3(fbm(q,4),fbm(q+5.2,4),fbm(q+9.7,4));
  float c=fbm(q+w*1.6,7);
  float a=smoothstep(.05-uCover*.4,.55-uCover*.3,c)*(0.75+.25*snoise(d*26.));
  gl_FragColor=vec4(vec3(clamp(a,0.,1.)),1.);
}`;

const GAS = /* glsl */ `
uniform vec3 uA,uB,uC,uD; uniform float uSeed;
void main(){
  vec3 d=dirFromUv(vUv);
  vec3 w=vec3(fbm(d*3.+uSeed,5),fbm(d*3.+uSeed+8.,5),fbm(d*3.+uSeed+15.,5));
  float y=d.y+w.y*.09+fbm(d*vec3(5.,22.,5.)+w*2.,5)*.035;
  float b=sin(y*19.+uSeed)*.5+.5, b2=sin(y*43.+uSeed*3.)*.5+.5;
  vec3 col=mix(uA,uB,smoothstep(.2,.8,b)); col=mix(col,uC,smoothstep(.55,.95,b2)*.65);
  col*=.9+.25*fbm(d*vec3(8.,30.,8.)+w*3.,5);
  // A great storm.
  vec3 s=normalize(vec3(.7,-.32,.62)); vec3 q=(d-s)*vec3(1.,2.1,1.); float r=length(q)/.24;
  if(r<1.){ float sw=sin(r*14.-atan(q.y,q.x)*2.+snoise(d*18.)*2.); col=mix(col,mix(uD,uA,sw*.35+.35),smoothstep(1.,.55,r)); }
  gl_FragColor=vec4(sqrt(max(col,0.)),1.);
}`;

const PLANET_VERT = /* glsl */ `
uniform sampler2D uMap; uniform float uRelief; varying vec2 vUv; varying vec3 vN,vW,vO;
void main(){ vUv=uv; vec3 n=normalize(position); vO=n;
  float h=max(texture2D(uMap,uv).a-.5,0.); vec3 pos=position+n*h*uRelief;
  vN=normalize(mat3(modelMatrix)*n); vec4 w=modelMatrix*vec4(pos,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;

const PLANET_FRAG = NOISE + /* glsl */ `
uniform sampler2D uMap,uCloud; uniform float uGain,uWater,uBump,uCloudShift,uCloudAmt; uniform vec3 uSun,uAtmo; uniform vec3 uCities[8]; uniform int uCityCount;
uniform mat4 modelMatrix; varying vec2 vUv; varying vec3 vN,vW,vO;
void main(){
  vec4 t=texture2D(uMap,vUv); vec3 col=t.rgb*t.rgb; float h=t.a-.5;
  vec2 e=vec2(1./2048.,0.), f=vec2(0.,1./1024.);
  float hx=max(texture2D(uMap,vUv+e).a-.5,0.)-max(texture2D(uMap,vUv-e).a-.5,0.);
  float hy=max(texture2D(uMap,vUv+f).a-.5,0.)-max(texture2D(uMap,vUv-f).a-.5,0.);
  vec3 o=normalize(vO); vec3 east=normalize(cross(vec3(0.,1.,0.),o)+vec3(1e-5)); vec3 north=cross(o,east);
  vec3 no=normalize(o-(east*hx+north*hy)*uBump);
  vec3 N=normalize(mat3(modelMatrix)*no);
  vec3 L=normalize(uSun-vW), V=normalize(cameraPosition-vW), G=normalize(vN);
  float water=(h<0.?1.:0.)*uWater;
  float day=smoothstep(-.12,.28,dot(G,L));
  float diff=max(dot(N,L),0.)*day;
  float shadow=1.-texture2D(uCloud,vUv+vec2(uCloudShift+.004,-.003)).r*.45*uCloudAmt;
  vec3 c=col*(vec3(1.55,1.45,1.32)*uGain*diff*shadow+vec3(.016,.022,.04));
  vec3 H=normalize(L+V);
  c+=water*vec3(1.,.86,.62)*(pow(max(dot(G,H),0.),180.)*2.2+pow(max(dot(G,H),0.),24.)*.12)*day*shadow;
  // Warm light along the day/night line.
  float term=smoothstep(.35,0.,abs(dot(G,L)-.06)); c+=col*vec3(.9,.28,.05)*term*.35;
  // City lights on the night side.
  float lights=0.; for(int i=0;i<8;i++){ if(i>=uCityCount)break; float d=length(o-uCities[i]);
    float spread=smoothstep(.17,0.,d); if(spread>0.){ lights+=spread*smoothstep(.5,.85,snoise(o*130.))*(h<0.?0.:1.); } lights+=smoothstep(.06,0.,d)*.35; }
  c+=vec3(1.,.68,.28)*lights*pow(clamp(1.-day,0.,1.),3.)*1.8;
  float rim=pow(clamp(1.-dot(G,V),0.,1.),3.); c+=uAtmo*rim*(day*.9+.04);
  gl_FragColor=vec4(c,1.);
}`;

const CLOUD_FRAG = /* glsl */ `
uniform sampler2D uCloud; uniform vec3 uSun,uTint; uniform float uShift,uAmt; varying vec2 vUv; varying vec3 vN,vW;
void main(){ vec2 uv=vUv+vec2(uShift,0.); float a=texture2D(uCloud,uv).r; float a2=texture2D(uCloud,uv+vec2(.003,.002)).r;
  vec3 G=normalize(vN), L=normalize(uSun-vW); float day=smoothstep(-.15,.45,dot(G,L));
  vec3 c=uTint*(vec3(1.1,1.07,1.02)*day*(1.-max(a2-a,0.)*1.6)+vec3(.012,.018,.035));
  c=mix(c,c*vec3(1.2,.7,.45),smoothstep(.4,0.,abs(dot(G,L))));
  gl_FragColor=vec4(c,a*uAmt); }`;
const CLOUD_VERT = `varying vec2 vUv; varying vec3 vN,vW; void main(){vUv=uv; vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;}`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 uSun,uColor,uCenter; uniform float uR,uAR; varying vec3 vW;
void main(){
  vec3 ro=cameraPosition-uCenter, rd=normalize(vW-cameraPosition);
  float b=dot(ro,rd); float closest=length(ro-rd*b);
  // Thickest just above the limb, fading to nothing at the shell's edge.
  float x=(closest-uR)/(uAR-uR); float glow= x<0. ? .55*exp(x*7.) : pow(clamp(1.-x,0.,1.),2.4);
  vec3 p=normalize(ro-rd*b); vec3 L=normalize(uSun-uCenter);
  float day=smoothstep(-.35,.55,dot(p,L));
  float forward=pow(max(dot(rd,normalize(uSun-cameraPosition)),0.),12.);
  vec3 c=uColor*(day*1.5+.03)+vec3(1.,.45,.15)*forward*smoothstep(.5,-.2,dot(p,L))*1.2;
  gl_FragColor=vec4(c*glow,1.);
}`;
const WORLD_VERT = `varying vec3 vW; void main(){vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;}`;

export function atmosphere(radius, color, center, thick = 0.14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius * (1 + thick), 96, 64), new THREE.ShaderMaterial({
    vertexShader: WORLD_VERT, fragmentShader: ATMO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { uSun: { value: new THREE.Vector3() }, uColor: { value: lin(color) }, uCenter: { value: center.clone() }, uR: { value: radius }, uAR: { value: radius * (1 + thick) } },
  }));
  m.renderOrder = 3;
  // Seen from inside the shell, draw its far side instead.
  m.onBeforeRender = (r, s, cam) => (m.material.side = cam.position.distanceTo(m.position) < radius * (1 + thick) ? THREE.BackSide : THREE.FrontSide);
  m.position.copy(center);
  return m;
}

export const PALETTES = {
  terrestrial: { deep: "#04245c", shallow: "#0f86a8", beach: "#e8d29a", low: "#4f9a35", mid: "#1f6b34", high: "#7a6247", snow: "#f4f8ff", sea: 0.03, ice: 0.16, crater: 0, lava: 0, cover: 0.12, clouds: 1, atmo: "#3f8cff", water: 1 },
  tundra: { deep: "#0a2c4a", shallow: "#3a7f92", beach: "#a9a592", low: "#6d7a55", mid: "#4c6258", high: "#8a8478", snow: "#eef4fa", sea: -0.08, ice: 0.46, crater: 0, lava: 0, cover: 0.2, clouds: 0.85, atmo: "#7fb4ff", water: 1 },
  frozen: { deep: "#5b93c4", shallow: "#a9d6ec", beach: "#d5ecf7", low: "#e6f2fb", mid: "#bcd8ee", high: "#8fb2d6", snow: "#ffffff", sea: -0.05, ice: 0.6, crater: 0.15, lava: 0, cover: 0.02, clouds: 0.5, atmo: "#9fdcff", water: 0.6 },
  barren: { deep: "#3a302a", shallow: "#4a3e36", beach: "#6e6058", low: "#8a7a6c", mid: "#6a5c52", high: "#a39384", snow: "#c8bcae", sea: -0.6, ice: 0, crater: 1, lava: 0, cover: 0, clouds: 0, atmo: "#4a3a30", water: 0 },
  lava: { deep: "#1a0806", shallow: "#2a0e08", beach: "#241512", low: "#2e201c", mid: "#1c1412", high: "#4a342c", snow: "#6a5048", sea: -0.3, ice: 0, crater: 0.3, lava: 1, cover: 0.0, clouds: 0, atmo: "#ff5a20", water: 0 },
  moon: { deep: "#444448", shallow: "#55555a", beach: "#77767a", low: "#98969a", mid: "#706e74", high: "#b4b2b6", snow: "#d8d6da", sea: -0.7, ice: 0, crater: 1, lava: 0, cover: 0, clouds: 0, atmo: "#20242c", water: 0 },
  oceanic: { deep: "#032a66", shallow: "#1593b8", beach: "#e6d7a6", low: "#5aa040", mid: "#2e7a3a", high: "#7b6a52", snow: "#f4f8ff", sea: 0.2, ice: 0.12, crater: 0, lava: 0, cover: 0.2, clouds: 1, atmo: "#4f9cff", water: 1 },
  jungle: { deep: "#06305a", shallow: "#127f8a", beach: "#d9c98a", low: "#2f8f2a", mid: "#165c24", high: "#4f6a3a", snow: "#e8f0e0", sea: -0.02, ice: 0.05, crater: 0, lava: 0, cover: 0.3, clouds: 1, atmo: "#5fd0a0", water: 1 },
  swamp: { deep: "#1f3a2a", shallow: "#3f5a3a", beach: "#6a6a3a", low: "#5d6b33", mid: "#3c4a2a", high: "#6a6a52", snow: "#c8d0b8", sea: 0.0, ice: 0.04, crater: 0, lava: 0, cover: 0.35, clouds: 0.9, atmo: "#9ab070", water: 0.8, cloudTint: "#dfe8c8" },
  desert: { deep: "#6a4a2a", shallow: "#8a6a3a", beach: "#f2d9a0", low: "#e0b070", mid: "#c98a4a", high: "#a8643a", snow: "#f6e8cc", sea: -0.45, ice: 0.05, crater: 0.15, lava: 0, cover: 0.03, clouds: 0.4, atmo: "#ffc890", water: 0 },
  ice: { deep: "#3f78b0", shallow: "#8fc4e6", beach: "#d8eef8", low: "#eaf6fc", mid: "#c4def0", high: "#9cc0dc", snow: "#ffffff", sea: -0.02, ice: 0.5, crater: 0, lava: 0, cover: 0.1, clouds: 0.7, atmo: "#aee4ff", water: 0.8 },
  toxic: { deep: "#3a4a10", shallow: "#8aa020", beach: "#b8c050", low: "#6a7a2a", mid: "#4a5a2a", high: "#8a8a4a", snow: "#d9e870", sea: 0.0, ice: 0, crater: 0, lava: 0, cover: 0.5, clouds: 1, atmo: "#c9e050", water: 0.7, cloudTint: "#e4f08a" },
  rocky: { deep: "#4a3a2a", shallow: "#5a4a3a", beach: "#7a6a5a", low: "#9a8a7a", mid: "#7a6a5a", high: "#b8a898", snow: "#d0c4b4", sea: -0.6, ice: 0, crater: 0.6, lava: 0, cover: 0, clouds: 0, atmo: "#6a5a4a", water: 0 },
  crystal: { deep: "#2a1a6a", shallow: "#5a3ab0", beach: "#b89af2", low: "#7a5ad0", mid: "#4a3a9a", high: "#b89af2", snow: "#e6dcff", sea: -0.1, ice: 0, crater: 0.1, lava: 0, cover: 0.05, clouds: 0.3, atmo: "#b090ff", water: 0.6 },
  gas: { a: "#e8c48c", b: "#a5603a", c: "#f6e8cc", d: "#c24a28", atmo: "#ffb877" },
  gasBlue: { a: "#7fc4e0", b: "#2f5f9e", c: "#d6f0f4", d: "#e8f4ff", atmo: "#6fc8ff" },
};

/**
 * A planet: terrain sphere, cloud layer and atmosphere.
 * Returns { group, surface, radius, heightAt(dir) } with dir in the surface's own frame.
 */
export function makePlanet(renderer, { type, radius, seed, position, cities = 0, quality = 1, atmoThick = 0.14, hero = cities > 0 }) {
  const P = PALETTES[type];
  const group = new THREE.Group();
  group.position.copy(position);
  const gas = type.startsWith("gas");
  const w = gas ? 1024 : hero ? 2048 * quality : 1024 * quality, h = w / 2;
  const map = gas
    ? bake(renderer, w, h, GAS, { uA: { value: lin(P.a) }, uB: { value: lin(P.b) }, uC: { value: lin(P.c) }, uD: { value: lin(P.d) }, uSeed: { value: seed } })
    : bake(renderer, w, h, TERRAIN, {
        uDeep: { value: lin(P.deep) }, uShallow: { value: lin(P.shallow) }, uBeach: { value: lin(P.beach) }, uLow: { value: lin(P.low) }, uMid: { value: lin(P.mid) }, uHigh: { value: lin(P.high) }, uSnow: { value: lin(P.snow) },
        uSeed: { value: seed }, uSea: { value: P.sea }, uIce: { value: P.ice }, uCrater: { value: P.crater }, uLava: { value: P.lava }, uFreq: { value: 1.35 },
      });
  const cloud = bake(renderer, gas || !P.clouds ? 4 : w / 2, gas || !P.clouds ? 2 : h / 2, CLOUDS, { uSeed: { value: seed * 1.7 + 3 }, uCover: { value: P.cover || 0 } });

  // Read the heights back once, to put cities on land.
  const pixels = new Uint8Array(w * h * 4);
  if (hero) renderer.readRenderTargetPixels(map, 0, 0, w, h, pixels);
  const heightAt = (d) => {
    let ph = Math.atan2(d.z, -d.x);
    if (ph < 0) ph += Math.PI * 2;
    const u = ph / (Math.PI * 2), v = 1 - Math.acos(THREE.MathUtils.clamp(d.y, -1, 1)) / Math.PI;
    const i = (Math.min(h - 1, Math.floor(v * h)) * w + Math.min(w - 1, Math.floor(u * w))) * 4;
    return pixels[i + 3] / 255 - 0.5;
  };

  const relief = gas ? 0 : radius * (type === "barren" || type === "moon" ? 0.09 : 0.07);
  const cityDirs = Array.from({ length: 8 }, () => new THREE.Vector3(0, 9, 0));
  const mat = new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG,
    uniforms: {
      uMap: { value: map.texture }, uCloud: { value: cloud.texture }, uWater: { value: gas ? 0 : P.water }, uGain: { value: gas ? 0.68 : 1 }, uBump: { value: gas ? 0 : 5.5 }, uRelief: { value: relief },
      uCloudShift: { value: 0 }, uCloudAmt: { value: gas ? 0 : P.clouds }, uSun: { value: new THREE.Vector3() }, uAtmo: { value: lin(P.atmo).multiplyScalar(0.55) },
      uCities: { value: cityDirs }, uCityCount: { value: 0 },
    },
  });
  // Gas giants keep height out of the vertex shader (their alpha is 1).
  const surface = new THREE.Mesh(new THREE.SphereGeometry(radius, hero ? 256 : 128, hero ? 192 : 96), mat);
  group.add(surface);
  let clouds = null;
  if (!gas && P.clouds) {
    clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.028, 128, 96), new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
      uniforms: { uCloud: { value: cloud.texture }, uSun: { value: new THREE.Vector3() }, uTint: { value: new THREE.Color(P.cloudTint || 0xffffff) }, uShift: { value: 0 }, uAmt: { value: P.clouds * 0.95 } },
    }));
    clouds.renderOrder = 2;
    group.add(clouds);
  }
  const atmo = atmosphere(radius, P.atmo, position, atmoThick);
  return { group, surface, clouds, atmo, radius, heightAt, relief, cityDirs, type };
}

/** Saturn-style rings with the planet's shadow across them. */
export function makeRings(planet, inner, outer) {
  const g = new THREE.RingGeometry(inner, outer, 180, 8);
  const m = new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
    uniforms: { uSun: { value: new THREE.Vector3() }, uCenter: { value: planet.group.position.clone() }, uR: { value: planet.radius }, uIn: { value: inner }, uOut: { value: outer } },
    vertexShader: `varying vec3 vW; varying float vR; void main(){vR=length(position.xy); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader: NOISE + `uniform vec3 uSun,uCenter; uniform float uR,uIn,uOut; varying vec3 vW; varying float vR;
      void main(){ float x=clamp((vR-uIn)/(uOut-uIn),0.,1.);
        float band=.55+.45*snoise(vec3(x*38.,0.,0.))+.25*snoise(vec3(x*140.,3.,0.));
        float gap=smoothstep(.0,.015,abs(x-.62))*smoothstep(0.,.008,abs(x-.84));
        float a=clamp(band,0.,1.)*gap*smoothstep(0.,.08,x)*smoothstep(1.,.9,x);
        vec3 L=normalize(uSun-vW); vec3 oc=vW-uCenter; float b=dot(oc,L); float d=length(oc-L*b);
        float sh=(b<0.&&d<uR)?smoothstep(uR*.94,uR,d)*.9+.1:1.;
        vec3 c=mix(vec3(.42,.30,.2),vec3(.9,.76,.55),snoise(vec3(x*9.,7.,0.))*.5+.5);
        gl_FragColor=vec4(c*1.2*sh,a*.85); }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.copy(planet.group.position);
  mesh.rotation.set(-Math.PI / 2 + 0.28, 0.16, 0);
  mesh.renderOrder = 4;
  return mesh;
}

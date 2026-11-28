/**
 * Whole-screen look for the cell stage: soft bloom, a little depth of field and colour split towards the
 * edges, a teal-shadow / warm-highlight grade, a vignette, a faint water wobble and film grain.
 * The scene is rendered into a half-float target and tone mapped at the end by OutputPass.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;

// Keeps bright additive glow finite before bloom: half-float overflow or NaN would smear into the blur.
const SafeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `precision highp float; uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec3 r = texture2D(tDiffuse, vUv).rgb; if (!(r.r==r.r) || !(r.g==r.g) || !(r.b==r.b)) r = vec3(0.); gl_FragColor = vec4(clamp(r, 0., 4.), 1.); }`,
};

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAspect: { value: 1 }, uPulse: { value: 0 }, uHurt: { value: 0 } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    precision highp float; uniform sampler2D tDiffuse; uniform float uTime, uAspect, uPulse, uHurt; varying vec2 vUv;
    float h(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(0.06711056,0.00583715)))); }
    void main(){
      vec2 uv = vUv; vec2 c = uv-0.5; float r = length(c*vec2(uAspect,1.));
      uv.x += sin(uv.y*9.+uTime*.9)*.0014 + sin((uv.y+uv.x*.3)*23.-uTime*1.7)*.0006;
      uv.y += cos(uv.x*uAspect*8.-uTime*.8)*.0011;
      float ed = smoothstep(.45,1.05,r);
      vec2 dir = normalize(c+1e-4);
      vec3 col = vec3(0.); float wsum=0.;
      for(int i=-3;i<=3;i++){ float f=float(i)/3.; float w=1.-abs(f)*.55;
        vec2 o = dir*f*ed*.006;
        col += vec3(texture2D(tDiffuse,uv+o*1.15).r, texture2D(tDiffuse,uv+o).g, texture2D(tDiffuse,uv+o*.85).b)*w; wsum+=w; }
      col/=wsum;
      float l = dot(col, vec3(.299,.587,.114));
      col = mix(vec3(l), col, 1.18);
      col += vec3(-.004,.012,.02)*(1.-smoothstep(0.,.5,l));
      col *= mix(vec3(1.), vec3(1.05,1.0,.93), smoothstep(.5,1.4,l));
      col *= 1.0 - ed*.55;
      col = mix(col, vec3(col.r*1.1+.06, col.g*.6, col.b*.6), uHurt*smoothstep(.3,.9,r)*.8);
      col += uPulse*vec3(.05,.09,.07)*(1.-ed);
      col += (h(floor(vUv*vec2(1731.,1137.))+floor(fract(uTime)*60.))-.5)*.014;
      gl_FragColor = vec4(col,1.);
    }`,
};

/** @param {THREE.WebGLRenderer} renderer */
export function createPost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? 4 : 0 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass(SafeShader));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.62, 0.8, 0.7);
  composer.addPass(bloomPass);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return {
    grade,
    bloomPass,
    /** quality "medium" trades MSAA for speed; call after a quality change. */
    setQuality(q) {
      const samples = renderer.capabilities.isWebGL2 ? (q === "high" ? 4 : 2) : 0;
      for (const t of [composer.renderTarget1, composer.renderTarget2]) if (t.samples !== samples) (t.samples = samples), t.dispose();
      bloomPass.strength = q === "high" ? 0.62 : 0.5;
    },
    setSize(w, h, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
    },
    render(time, dt) {
      grade.uniforms.uTime.value = time;
      grade.uniforms.uAspect.value = renderer.domElement.width / Math.max(1, renderer.domElement.height);
      composer.render(dt);
    },
  };
}

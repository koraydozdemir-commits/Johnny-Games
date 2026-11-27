// Star view: the galaxy in 3D, for flying from system to system. Tap a star to see it, tap Travel to go.
import * as THREE from "three";
import { STAR_KINDS, GALAXY_LY, PLANET_TYPES, makeSystem } from "./galaxy/gen.js";
import { makeShip, Trail } from "./ship.js";
import { createMenuLook } from "./menulook.js";
import { addBackdrop } from "./backdrop.js";
import { TERRITORY } from "./empires.js";

export const G = 22000; // scene units per galaxy radius (the galaxy is spread wide; star counts are unchanged)
const SC = G / 9000;
export const RANGE_LY = 4500; // the starting drive
export const KEIS_RADIUS = 0.12; // galaxy units: the Keis hold the core around The Lock
const RANGE = RANGE_LY / GALAXY_LY; // in galaxy units
const MIN_DIST = 160, MAX_DIST = 32000 * SC;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
const hash = (i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A flat circle drawn with a crisp edge of constant pixel width, at any zoom. */
function edgeDisc(radius, color, { fill = 0.05, dash = 0, width = 1.6 } = {}) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.04, 256).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uR: { value: radius }, uFill: { value: fill }, uDash: { value: dash }, uW: { value: width }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vP; void main(){ vP=position.xz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uR,uFill,uDash,uW,uTime; varying vec2 vP;
      void main(){ float r=length(vP)/uR; float w=fwidth(r);
        float edge=1.-smoothstep(w*uW*.5,w*uW*1.5,abs(r-1.));
        if(uDash>0.) edge*=step(.0,sin(atan(vP.y,vP.x)*uDash+uTime));
        float fill=uFill*smoothstep(1.,.2,r)*step(r,1.);
        gl_FragColor=vec4(uColor*(edge+fill),1.); }`,
  }));
  m.renderOrder = 2;
  return m;
}


export function createStarView({ renderer, galaxy, sky, environment, homeId, onArrive, onEnter, toast, sound, S }) {
  const scene = new THREE.Scene();
  scene.environment = environment;
  scene.environmentIntensity = 0.7;
  const camera = new THREE.PerspectiveCamera(55, 1, 2, 160000);
  const backdrop = sky.clone();
  scene.add(backdrop);
  scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x2a1a3a, 1.4));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
  key.position.set(1, 2, 1.5);
  scene.add(key);

  /* ---------- the stars ---------- */
  // Every star in the galaxy, the main menu's glitter included, is a system you can fly to.
  const colArr = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
  const bd = addBackdrop(galaxy, colArr);
  const stars = galaxy.stars;
  const n = stars.length;
  const R = bd.first; // the first R stars are drawn here with their own markers; the rest by the galaxy's own layer
  const pos = stars.map((s) => {
    if (s.backdrop) return V(s.x * G, s.h * (G / 100), s.y * G);
    const d = Math.hypot(s.x, s.y);
    return V(s.x * G, (hash(s.id) - 0.5) * 2 * (60 + 380 * Math.max(0, 1 - d * 1.4)), s.y * G);
  });
  const aPos = new Float32Array(R * 3), aCol = new Float32Array(R * 3), aSize = new Float32Array(R), aReach = new Float32Array(R);
  for (let i = 0; i < R; i++) {
    const s = stars[i];
    pos[i].toArray(aPos, i * 3);
    new THREE.Color(STAR_KINDS[s.kind].color).multiplyScalar(0.7 + s.mag * 0.6).toArray(aCol, i * 3);
    aSize[i] = STAR_KINDS[s.kind].size * (0.8 + s.mag * 0.4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(aPos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(aCol, 3));
  geo.setAttribute("size", new THREE.BufferAttribute(aSize, 1));
  geo.setAttribute("reach", new THREE.BufferAttribute(aReach, 1));
  const starMat = new THREE.ShaderMaterial({
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uH: { value: 800 }, uPx: { value: 1 }, uTime: { value: 0 } },
    vertexShader: `attribute float size; attribute float reach; uniform float uH,uPx; varying vec3 vC; varying float vR;
      void main(){ vC=color; vR=reach; vec4 mv=modelViewMatrix*vec4(position,1.);
        float s=size*40.*uH/max(-mv.z,1.);
        gl_PointSize=clamp(s,2.6*uPx,54.*uPx)*(1.+step(.5,reach)*.35);
        gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float uTime; varying vec3 vC; varying float vR;
      void main(){ float d=length(gl_PointCoord-.5)*2.;
        float core=exp(-d*d*40.)*2., halo=exp(-d*5.5)*.3;
        float spike=(exp(-abs(gl_PointCoord.x-.5)*60.)+exp(-abs(gl_PointCoord.y-.5)*60.))*exp(-d*2.5)*.35;
        float ring=step(.5,vR)*(1.-smoothstep(.0,.07,abs(d-.86)))*(.55+.25*sin(uTime*3.));
        float here=step(1.5,vR)*(1.-smoothstep(.0,.07,abs(d-.86)));
        gl_FragColor=vec4(vC*(core+halo+spike)+vec3(.3,.85,1.)*ring+vec3(1.,.85,.4)*here*1.4,1.); }`,
  });
  const points = new THREE.Points(geo, starMat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  scene.add(points);

  // The main menu's galaxy: the same arms, dust lanes and tens of thousands of stars as the real systems sit in.
  const look = createMenuLook(galaxy, G / 100, window.__lookQuality || "medium");
  scene.add(look.group);

  /* ---------- The Lock and the Keis ---------- */

  /* ---------- your ship, range and route ---------- */
  const ship = makeShip();
  scene.add(ship.group);
  const trail = new Trail(0x3aa8ff, 5, 60, 900);
  scene.add(trail.mesh);
  const range = edgeDisc(RANGE * G, 0x4fd8ff, { fill: 0.06, width: 2 });
  scene.add(range);
  const routeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: new THREE.Color(0.5, 1.6, 2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  routeLine.frustumCulled = false;
  scene.add(routeLine);

  /* ---------- routes ---------- */
  // Who can reach whom in one jump: a grid over the galaxy, so any of the ~39,000 stars can be asked at once.
  const RANGE_MULT = [1, 1.5, 2.1, 3]; // drive levels
  let rangeMult = 1;
  const rangeNow = () => RANGE * rangeMult;
  const CELL = RANGE * 3, GN = Math.ceil(3.2 / CELL);
  const cellOf = (x, y) => Math.min(GN - 1, Math.max(0, Math.floor((x + 1.6) / CELL))) * GN + Math.min(GN - 1, Math.max(0, Math.floor((y + 1.6) / CELL)));
  const grid = Array.from({ length: GN * GN }, () => []);
  for (let i = 0; i < n; i++) grid[cellOf(stars[i].x, stars[i].y)].push(i);
  const nearOf = (i) => {
    const out = [], s = stars[i];
    const cx = Math.floor((s.x + 1.6) / CELL), cy = Math.floor((s.y + 1.6) / CELL);
    for (let ax = Math.max(0, cx - 1); ax <= Math.min(GN - 1, cx + 1); ax++)
      for (let ay = Math.max(0, cy - 1); ay <= Math.min(GN - 1, cy + 1); ay++)
        for (const j of grid[ax * GN + ay]) {
          if (j === i) continue;
          const d = Math.hypot(s.x - stars[j].x, s.y - stars[j].y);
          if (d <= rangeNow()) out.push([j, d]);
        }
    return out;
  };
  const HOP = 0.012; // each jump costs a little, so routes use few, long hops
  function route(from, to) {
    const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
    // a small binary heap of [cost, star]
    const heap = [];
    const push = (c, v) => {
      heap.push([c, v]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    // A* with a straight-line guess (a little eager, so dense star fields don't make it wander).
    const tx = stars[to].x, ty = stars[to].y;
    const guess = (v) => 1.35 * Math.hypot(stars[v].x - tx, stars[v].y - ty);
    dist[from] = 0;
    push(guess(from), from);
    while (heap.length) {
      const [f, u] = pop();
      const c = dist[u];
      if (f > c + guess(u) + 1e-9) continue;
      if (u === to) break;
      for (const [v, d] of nearOf(u)) {
        const nd = c + d + HOP;
        if (nd < dist[v]) (dist[v] = nd), (prev[v] = u), push(nd + guess(v), v);
      }
    }
    if (!isFinite(dist[to])) return null;
    const path = [to];
    while (path[0] !== from) path.unshift(prev[path[0]]);
    return path;
  }
  const ly = (a, b) => Math.round(Math.hypot(stars[a].x - stars[b].x, stars[a].y - stars[b].y) * GALAXY_LY);

  /* ---------- state ---------- */
  const st = { cool: 0, current: homeId, selected: null, route: null, travel: null, visited: new Set([homeId]) };
  const cam = { target: pos[homeId].clone(), want: pos[homeId].clone(), dist: 1400, wantDist: 1400, yaw: 0.6, tilt: 0.75, push: 0 };
  function markReach() {
    aReach.fill(0);
    look.reachAttr.array.fill(0);
    for (const [j] of nearOf(st.current)) (j < R ? aReach : look.reachAttr.array)[j < R ? j : j - R] = 1;
    if (st.current < R) aReach[st.current] = 2;
    else look.reachAttr.array[st.current - R] = 1;
    geo.attributes.reach.needsUpdate = true;
    look.reachAttr.needsUpdate = true;
    range.position.set(pos[st.current].x, pos[st.current].y - 2, pos[st.current].z);
  }
  function setCurrent(id) {
    st.current = id;
    st.visited.add(id);
    markReach();
    ship.group.position.copy(pos[id]).add(V(0, 26, 0));
    trail.clear();
  }

  /* ---------- labels and the star card ---------- */
  const box = document.getElementById("slabels");
  const label = (text, color, onTap) => {
    const el = document.createElement("button");
    el.className = "label";
    el.innerHTML = `<i style="border-color:${color}"></i><b></b><small></small>`;
    el.querySelector("b").textContent = text;
    el.onclick = onTap;
    box.appendChild(el);
    return el;
  };
  const starLabels = new Map();
  const starLabel = (id) => {
    if (!starLabels.has(id)) starLabels.set(id, label(stars[id].name, STAR_KINDS[stars[id].kind].color, () => select(id)));
    return starLabels.get(id);
  };
  const fixed = [];
  // Empires you have met: their territory on the map, and their name at home.
  const empireMarks = new Map();
  // A signal marks every system where someone lives: three arcs either side of the star, pulsing.
  const sigTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const x = cv.getContext("2d");
    x.strokeStyle = "#fff";
    x.lineCap = "round";
    for (const [r, w, a] of [[20, 6, 1], [34, 5, 0.8], [48, 4, 0.6]]) {
      x.lineWidth = w;
      x.globalAlpha = a;
      for (const ang of [0, Math.PI]) {
        x.beginPath();
        x.arc(64, 64, r, ang - 0.65, ang + 0.65);
        x.stroke();
      }
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const signals = new Map();
  // Only the signals close to your ship, or the one you have your finger on, are shown.
  const signalNear = (sp) => {
    const h = sp.userData.home;
    return h === st.selected || h === st.current || ship.group.position.distanceTo(pos[h]) < RANGE * G * 2.6;
  };
  function addSignals(list) {
    for (const e of list) {
      if (e.home < 0 || signals.has(e.id)) continue;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sigTex, color: 0x8fe8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
      sp.position.copy(pos[e.home]);
      sp.renderOrder = 7;
      sp.userData.phase = (e.home % 17) / 17;
      sp.userData.home = e.home;
      scene.add(sp);
      signals.set(e.id, sp);
    }
  }
  function addEmpire(e) {
    if (empireMarks.has(e.id) || e.home < 0) return;
    const disc = edgeDisc(TERRITORY * G, e.color, { fill: 0.07, dash: 0, width: 1.6 });
    disc.position.set(pos[e.home].x, pos[e.home].y - 2, pos[e.home].z);
    scene.add(disc);
    fixed.push({ el: label(e.name, e.color, () => toast(e.name + ": " + e.archetype)), at: pos[e.home].clone().add(V(0, 160, 0)), far: false });
    empireMarks.set(e.id, disc);
    signals.get(e.id)?.material.color.set(e.color);
  }

  const card = document.getElementById("starCard");
  const summary = (id) => {
    const sys = makeSystem(galaxy.seed, stars[id]);
    const counts = {};
    for (const p of sys.planets) counts[p.type] = (counts[p.type] || 0) + 1;
    const parts = Object.entries(counts).map(([t, c]) => `${c} ${PLANET_TYPES[t]?.name.toLowerCase() || t}`);
    const life = sys.planets.filter((p) => p.biodiversity > 0).length;
    return { sys, text: `${sys.planets.length} planet${sys.planets.length === 1 ? "" : "s"}: ${parts.join(", ")}`, life };
  };
    function select(id) {
    if (st.travel) return;
    if (id !== st.current && Math.hypot(stars[id].x - stars[st.current].x, stars[id].y - stars[st.current].y) > rangeNow()) return toast?.("Outside your drive range", 2);
    if (st.selected === id && id !== st.current && st.route) return travel();
    st.selected = id;
    const s = stars[id];
    st.route = id === st.current ? null : [st.current, id]; // one jump at a time
    const { text, life } = summary(id);
    card.querySelector("h2").textContent = s.name;
    card.querySelector(".kind").textContent = `${STAR_KINDS[s.kind].name} · ${s.sector}`;
    card.querySelector(".kind").style.color = STAR_KINDS[s.kind].color;
    card.querySelector(".planets").textContent = text;
    const facts = [];
    if (id === homeId) facts.push("Your home system");
    else if (s.start) facts.push("Home of another species");
    if (life) facts.push(`${life} world${life === 1 ? "" : "s"} with life`);
    if (st.visited.has(id) && id !== homeId) facts.push("Visited");
    card.querySelector(".facts").textContent = facts.join(" · ");
    const go = card.querySelector("#starGo");
    const info = card.querySelector(".route");
    if (id === st.current) {
      info.textContent = "You are here.";
      go.textContent = "Enter system";
      go.disabled = false;
    } else if (!st.route) {
      info.textContent = "No route: the gap is too wide for your drive.";
      go.textContent = "Out of reach";
      go.disabled = true;
    } else {
      const total = st.route.slice(1).reduce((a, v, i) => a + ly(st.route[i], v), 0);
      const jumps = st.route.length - 1;
      info.textContent = `${total.toLocaleString()} light years · ${jumps} jump${jumps === 1 ? "" : "s"}`;
      go.textContent = "Travel";
      go.disabled = false;
    }
    card.hidden = false;
    drawRoute();
    sound?.tone(500, 760, 0.1, "sine", 0.08);
  }
  function deselect() {
    st.selected = null;
    st.route = null;
    card.hidden = true;
    drawRoute();
  }
  card.querySelector("#starGo").onclick = () => (st.selected === st.current ? onEnter() : travel());
  card.querySelector("#starClose").onclick = deselect;
  function drawRoute() {
    const pts = (st.route || []).map((i) => pos[i].clone().add(V(0, 4, 0)));
    routeLine.geometry.setFromPoints(pts.length > 1 ? pts : [V(), V()]);
    routeLine.visible = pts.length > 1;
  }

  /* ---------- travel ---------- */
  function travel() {
    if (!st.route || st.travel || time < st.cool) return; // a short, unannounced pause after each trip
    // A jump costs charge: more for a longer one.
    const cost = Math.round(4 + 8 * (ly(st.route[0], st.route[1]) / RANGE_LY));
    if (S && S.charge < cost) return toast?.(`Not enough charge (${cost}% needed). Recharge at an empire or at home.`, 3);
    if (S) S.charge -= cost;
    card.hidden = true;
    st.travel = { route: st.route, hop: 0, t: 0 };
    cam.wantDist = Math.min(cam.wantDist, 2600 * SC);
    sound?.tone(220, 660, 0.5, "sawtooth", 0.06);
  }
  const shipDir = V(0, 0, 1);
  function updateTravel(dt) {
    const T = st.travel;
    if (!T) return;
    const a = T.route[T.hop], b = T.route[T.hop + 1];
    const A = pos[a].clone().add(V(0, 26, 0)), B = pos[b].clone().add(V(0, 26, 0));
    const dur = 2 + A.distanceTo(B) / (330 * SC);
    T.t += dt / dur;
    const k = Math.min(1, T.t), e = k * k * (3 - 2 * k);
    const at = A.clone().lerp(B, e);
    at.y += Math.sin(k * Math.PI) * 60 * SC;
    shipDir.copy(B).sub(A).normalize();
    ship.group.position.copy(at);
    cam.want.copy(at);
    if (k >= 1) {
      st.current = b;
      st.visited.add(b);
      markReach();
      T.hop++;
      T.t = 0;
      if (T.hop >= T.route.length - 1) {
        st.travel = null;
        st.cool = time + 4;
        st.selected = null;
        st.route = null;
        drawRoute();
        // You stop over the star. Zoom in (or tap System) to enter it.
        cam.wantDist = Math.min(cam.wantDist, 1500 * SC);
        toast?.("Over " + stars[b].name + ". Zoom in to enter.", 3);
        sound?.tone(660, 990, 0.3, "sine", 0.1);
      } else sound?.tone(440, 880, 0.15, "sine", 0.07);
    }
  }

  /* ---------- input ---------- */
  const pointers = new Map();
  let pinch = 0, down = null;
  const canvas = renderer.domElement;
  const on = (type, fn, opts) => canvas.addEventListener(type, (e) => api.active && fn(e), opts);
  on("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, rotate: e.button === 2 });
    down = pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  on("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size >= 2) {
      cam.yaw -= dx * 0.004;
      cam.tilt = clamp(cam.tilt + dy * 0.003, 0.15, 1.45);
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) zoom(pinch / d);
      pinch = d;
    } else {
      // The map stays anchored to your ship: dragging turns your view around it, it never slides away.
      cam.yaw -= dx * 0.006;
      cam.tilt = clamp(cam.tilt + dy * 0.004, 0.15, 1.45);
    }
  });
  const up = (e) => {
    const was = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (was && down && !pointers.size && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10 && performance.now() - down.t < 400) tap(e.clientX, e.clientY);
    if (!pointers.size) (down = null), (cam.push = 0);
  };
  on("pointerup", up);
  on("pointercancel", (e) => pointers.delete(e.pointerId));
  on("wheel", (e) => {
    e.preventDefault();
    zoom(e.deltaY > 0 ? 1.12 : 0.89);
  }, { passive: false });
  function zoom(f) {
    const want = cam.wantDist * f;
    // Pushing in past the closest zoom over your own star takes you into the system.
    if (want < MIN_DIST && cam.want.distanceTo(pos[st.current]) < 250 && !st.travel) {
      cam.push += Math.log(1 / f);
      if (cam.push > 0.35) {
        cam.push = 0;
        onEnter();
      }
    }
    cam.wantDist = clamp(want, MIN_DIST, MAX_DIST);
  }
  const proj = V();
  function tap(x, y) {
    let best = -1, bd = 30;
    camera.updateMatrixWorld();
    for (let i = 0; i < n; i++) {
      proj.copy(pos[i]).project(camera);
      if (proj.z > 1) continue;
      const d = Math.hypot(((proj.x + 1) / 2) * innerWidth - x, ((1 - proj.y) / 2) * innerHeight - y);
      if (d < bd) (bd = d), (best = i);
    }
    if (best >= 0) select(best);
    else if (!card.hidden) deselect();
  }

  /* ---------- per frame ---------- */
  let time = 0;
  function update(dt) {
    time += dt;
    starMat.uniforms.uTime.value = time;
    look.update(time, cam.dist);
    for (const sp of signals.values()) {
      const pulse = 1 + 0.12 * Math.sin(time * 2.2 + sp.userData.phase * 6.28);
      sp.visible = signalNear(sp);
      sp.scale.setScalar(clamp(cam.dist * 0.09, 140, 3200 * SC) * pulse);
      sp.material.opacity = 0.55 + 0.4 * Math.sin(time * 2.2 + sp.userData.phase * 6.28 + 1.2) ** 2;
    }
    updateTravel(dt);
    if (!st.travel) cam.want.copy(pos[st.current]);
    cam.target.lerp(cam.want, Math.min(1, dt * 5));
    cam.dist += (cam.wantDist - cam.dist) * Math.min(1, dt * 6);
    const c = Math.cos(cam.tilt);
    camera.position.set(cam.target.x + Math.sin(cam.yaw) * c * cam.dist, cam.target.y + Math.sin(cam.tilt) * cam.dist, cam.target.z + Math.cos(cam.yaw) * c * cam.dist);
    camera.lookAt(cam.target);
    camera.updateMatrixWorld();
    backdrop.position.copy(camera.position);
    // The ship: big enough to see at any zoom, and pointing where it goes.
    ship.group.scale.setScalar(clamp(cam.dist * 0.0105, 1.2, 140));
    if (!st.travel) {
      ship.group.position.y = pos[st.current].y + 26 + Math.sin(time * 1.4) * 2;
      shipDir.set(Math.sin(time * 0.15), 0, Math.cos(time * 0.15));
    }
    ship.group.lookAt(ship.group.position.clone().add(shipDir));
    ship.update(time, st.travel ? 1.2 : 0.25);
    trail.width = clamp(cam.dist * 0.004, 1, 60);
    trail.push(ship.group.position, camera, st.travel ? 0.9 : 0);
    range.visible = !st.travel;
    // Labels: your star, the one you picked, the ones in range, and the landmarks.
    const show = new Set([st.current]);
    if (st.selected != null) show.add(st.selected);
    if (cam.dist < 4200) {
      // Label the named systems in range, and the closest few of the rest.
      const inRange = nearOf(st.current).sort((p, q) => p[1] - q[1]);
      let extras = 0;
      for (const [j] of inRange) if (j < R) show.add(j); else if (extras++ < 8) show.add(j);
    }
    for (const id of starLabels.keys()) if (!show.has(id)) starLabels.get(id).style.display = "none";
    const placed = [];
    const put = (el, p, extra) => {
      proj.copy(p).project(camera);
      const x = ((proj.x + 1) / 2) * innerWidth, y = ((1 - proj.y) / 2) * innerHeight;
      let ok = proj.z < 1 && proj.x > -0.95 && proj.x < 0.95 && proj.y < 0.8 && proj.y > -0.7;
      if (ok && placed.some(([a, b]) => Math.abs(a - x) < 90 && Math.abs(b - y) < 34)) ok = false;
      el.style.display = ok ? "" : "none";
      if (ok) {
        placed.push([x, y]);
        el.style.transform = `translate(${x}px,${y}px)`;
        if (extra != null) el.querySelector("small").textContent = extra;
      }
    };
    put(starLabel(st.current), pos[st.current], "you are here");
    if (st.selected != null && st.selected !== st.current) put(starLabel(st.selected), pos[st.selected], `${ly(st.current, st.selected).toLocaleString()} ly`);
    for (const id of show) if (id !== st.current && id !== st.selected) put(starLabel(id), pos[id], `${ly(st.current, id).toLocaleString()} ly`);
    for (const f of fixed) {
      if (cam.dist < 2500 * SC && f.far) {
        f.el.style.display = "none";
        continue;
      }
      put(f.el, f.at, null);
    }
  }

  function resize(ratio) {
    camera.aspect = innerWidth / innerHeight;
    camera.fov = camera.aspect < 0.8 ? 68 : 55;
    camera.updateProjectionMatrix();
    starMat.uniforms.uH.value = (innerHeight * ratio) / (2 * Math.tan(camera.fov / 114.6));
    starMat.uniforms.uPx.value = ratio;
    look.resize(innerHeight, ratio, camera.fov);
    backdrop.children[1].material.uniforms.uPx.value = ratio;
  }
  /** Open the map over the star you're at. */
  function show() {
    cam.want.copy(pos[st.current]);
    cam.target.copy(pos[st.current]);
    cam.dist = MIN_DIST * 1.1;
    cam.wantDist = 1500;
    cam.push = 0;
    deselect();
  }

  markReach();
  setCurrent(homeId);
  function setDrive(level) {
    rangeMult = RANGE_MULT[Math.max(0, Math.min(3, level))];
    range.scale.setScalar(rangeMult);
    markReach();
    deselect();
  }
  const api = { setDrive, rangeNow, addEmpire, addSignals, active: false, scene, camera, update, resize, show, setCurrent, select, state: st, cam, pos, route, travel };
  return api;
}

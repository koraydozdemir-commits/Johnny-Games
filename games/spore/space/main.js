import { startMusic } from "./voice.js";
import { createRaiders } from "./raiders.js";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { makeGalaxy, makeSystem, STAR_KINDS } from "./galaxy/gen.js";
import { makePlanet, makeRings, bakeLog, PALETTES } from "./planets.js";
import { createStarView } from "./starview.js";
import { createComms } from "./comms.js";
import { makeSky, makeSun, makeBelt, makeComet, Particles, glowSprite, rockGeos, rockMat } from "./space.js";
import { makeShip, Trail, MUZZLES } from "./ship.js";
import { addCities, makeCritter } from "./cities.js";
import { sound } from "./sound.js";

const $ = (id) => document.getElementById(id);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
const params = new URLSearchParams(location.search);
const nextFrame = () => new Promise((r) => setTimeout(r, 30));

async function boot() {
  const canvas = $("view");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: !!window.__manual });
  const quality = params.has("lq") ? 0.5 : renderer.capabilities.maxTextureSize >= 4096 && (navigator.deviceMemory || 8) >= 4 ? 1 : 0.5;
  let ratio = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 20000);
  const step = async (text, pct) => {
    $("loadText").textContent = text;
    $("loadBar").style.width = pct + "%";
    await nextFrame();
  };

  await step("Charting the galaxy", 4);
  const galaxy = makeGalaxy(77);
  const HOME = 1046; // Peis, your home system
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("johnny-spore-space-test") || "null");
  } catch {}
  const startStar = galaxy.stars[saved?.star ?? HOME] || galaxy.stars[HOME];

  await step("Painting the galaxy", 12);
  const sky = makeSky(renderer, quality);
  scene.add(sky);

  const sunLight = new THREE.PointLight(0xfff0dd, 3.2, 0, 0);
  scene.add(sunLight, new THREE.HemisphereLight(0x5f86c0, 0x1c1226, 0.55));

  // Reflections for hull metal and domes.
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x0a1020);
  for (const [c, x, y, z, s] of [[0xfff0d0, 8, 6, 3, 3], [0x2a9fd0, -9, 1, -4, 4], [0x7a3a9a, 2, -8, 6, 4], [0x9fc8ff, 0, 10, -2, 2.5]]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(s, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2) }));
    m.position.set(x, y, z);
    envScene.add(m);
  }
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0.7;

  /* ---------- a star system, built on demand ---------- */
  const LABEL = (type) => (PALETTES[type]?.atmo && !type.startsWith("gas") ? PALETTES[type].atmo : PALETTES[type]?.a || "#ccc");
  const TYPE_OF = (info, i, star) => {
    if (info.type === "gas") return (star.id === HOME ? i === 3 : hash01(star.id * 31 + i) < 0.4) ? "gasBlue" : "gas";
    if (info.type === "volcanic") return "lava";
    return PALETTES[info.type] ? info.type : "barren";
  };
  const hash01 = (k) => {
    const x = Math.sin(k * 91.17 + 7.3) * 43758.5453;
    return x - Math.floor(x);
  };
  const polar = (r, a, y = 0) => V(Math.cos(a) * r, y, Math.sin(a) * r);
  const keep = new Set([...rockGeos, rockMat]);

  /** Everything in one system. Peis keeps the layout that was approved; others are laid out from their orbits. */
  async function buildSystem(star, say = step) {
    const system = makeSystem(galaxy.seed, star);
    const pl = system.planets;
    const rts = [];
    bakeLog.list = rts;
    const group = new THREE.Group();
    const sun = makeSun(Math.round(140 * STAR_KINDS[star.kind].size), star.kind);
    group.add(sun.group);
    let companion = null;
    if (system.companion) {
      companion = makeSun(70, "red");
      companion.group.position.set(-3400, 420, 2600);
      group.add(companion.group);
    }
    sunLight.color.set(new THREE.Color(STAR_KINDS[star.kind].color).lerp(new THREE.Color(0xffffff), 0.55));

    // Which world you arrive at: a homeworld, else the liveliest, else the biggest rock.
    let heroIdx = pl.findIndex((p) => p.homeworld);
    if (heroIdx < 0) {
      const score = (p) => (p.type === "gas" ? -1 : (p.habit || 0) * 3 + (p.biodiversity || 0) + p.radius * 0.1);
      heroIdx = pl.reduce((b, p, i) => (score(p) > score(pl[b]) ? i : b), 0);
    }
    const orbitDist = (o) => 380 + 1100 * Math.log2(1 + o);
    const heroD = orbitDist(pl[heroIdx].orbit);
    const SPOT = V(heroD, 0, 0);
    const toSun = SPOT.clone().negate().normalize();
    const viewFromPlanet = toSun.clone().multiplyScalar(0.57).add(V(0, 1, 0).cross(toSun).multiplyScalar(0.8)).add(V(0, 0.22, 0)).normalize();
    const fwd0 = viewFromPlanet.clone().negate();
    const right0 = fwd0.clone().cross(V(0, 1, 0)).normalize();
    const up0 = right0.clone().cross(fwd0);
    const sizeOf = (p) => (p.type === "gas" ? 120 + p.radius * 9 : clamp(22 + p.radius * 32, 24, 95));
    const heroR = star.id === HOME ? 60 : sizeOf(pl[heroIdx]);
    const inView = (rightDeg, upDeg, dist) => SPOT.clone().addScaledVector(viewFromPlanet, heroR * 3.33).addScaledVector(fwd0.clone().addScaledVector(right0, Math.tan(rightDeg / 57.3)).addScaledVector(up0, Math.tan(upDeg / 57.3)).normalize(), dist);
    const layout = star.id === HOME
      ? [{ radius: 60, position: SPOT, atmo: 0.15 }, { radius: 72, position: polar(1350, 2.3, 20) }, { radius: 40, position: polar(2300, 3.9, -30) }, { radius: 170, position: polar(3100, 1.7, 40) }, { radius: 150, position: inView(9, 23, 2300) }, { radius: 26, position: polar(4800, 5.2, 60) }]
      : pl.map((p, i) => (i === heroIdx ? { radius: heroR, position: SPOT, atmo: 0.15 } : { radius: sizeOf(p), position: polar(orbitDist(p.orbit), 0.9 + hash01(star.id * 7 + i) * 4.6, (hash01(i * 3 + star.id) - 0.5) * 120) }));
    // The ringed giant gets a place in your first view if there is one.
    if (star.id !== HOME) {
      const ringed = pl.findIndex((p, i) => p.rings && i !== heroIdx);
      if (ringed >= 0) layout[ringed].position = inView(9, 23, Math.max(1800, layout[ringed].position.distanceTo(SPOT) * 0.8));
    }

    const bodies = [];
    for (let i = 0; i < pl.length; i++) {
      const info = pl[i], L = layout[i];
      await say("Growing " + info.name, 20 + (i / pl.length) * 55);
      const type = TYPE_OF(info, i, star);
      const hero = i === heroIdx;
      const p = makePlanet(renderer, { type, radius: L.radius, seed: (info.surfaceSeed % 97) + 0.37, position: L.position, cities: info.homeworld ? 6 : 0, hero, quality: hero ? quality : quality, atmoThick: L.atmo });
      p.name = info.name;
      p.info = info;
      p.living = (info.biodiversity || 0) > 0;
      p.hero = hero;
      group.add(p.group, p.atmo);
      p.ringed = info.rings;
      if (info.rings) group.add(makeRings(p, L.radius * 1.35, L.radius * 2.4));
      bodies.push(p);
    }
    const home = bodies[heroIdx];
    home.group.updateMatrixWorld(true);
    let cityDirs = [];
    if (pl[heroIdx].homeworld) {
      await say("Founding cities", 78);
      cityDirs = addCities(home, 6, star.id === HOME ? V(-0.42, 0.12, 0.9).normalize() : viewFromPlanet.clone().lerp(toSun, 0.3).normalize());
    }

    await say("Scattering moons and rocks", 84);
    const moonProto = makePlanet(renderer, { type: "moon", radius: 1, seed: star.id === HOME ? 4.2 : 4.2 + (star.id % 7), position: V(), quality: 0.5 });
    const moons = [];
    bodies.forEach((p, i) => {
      const count = Math.min(pl[i].moons, 4);
      for (let k = 0; k < count; k++) {
        const r = p.radius * (0.09 + ((k * 37 + i * 11) % 10) * 0.012);
        const m = moonProto.surface.clone();
        m.scale.setScalar(r);
        group.add(m);
        moons.push({ mesh: m, parent: p, r, dist: p.radius * (2.7 + k * 0.85), a: k * 2.3 + i + 3.6, speed: 0.025 / (k + 1), tilt: 0.12 + k * 0.17 });
      }
    });

    // An asteroid belt in the widest gap past your world.
    const dists = layout.map((L) => Math.hypot(L.position.x, L.position.z)).sort((a, b) => a - b);
    let beltR = star.id === HOME ? 1830 : dists.at(-1) + 700;
    if (star.id !== HOME)
      for (let i = 0; i < dists.length - 1; i++)
        if (dists[i] >= heroD && dists[i + 1] - dists[i] > 900) {
          beltR = (dists[i] + dists[i + 1]) / 2;
          break;
        }
    const belt = makeBelt(beltR, 240, 1800);
    group.add(belt);
    // A loose cluster of rocks beside the arrival point, close enough to shoot.
    const clusterCentre = SPOT.clone().addScaledVector(viewFromPlanet, heroR * 2.25).addScaledVector(right0, 62).addScaledVector(up0, -8);
    const cluster = new THREE.InstancedMesh(rockGeos[0], rockMat, 46);
    const rocks = [];
    for (let i = 0; i < 46; i++) {
      const p = clusterCentre.clone().add(V().randomDirection().multiplyScalar(6 + Math.random() * 30));
      const s = 0.5 + Math.pow(Math.random(), 3) * 3.2;
      rocks.push({ p, s, alive: true, rot: V(Math.random() * 6, Math.random() * 6, 0), spin: (Math.random() - 0.5) * 0.6, i });
    }
    cluster.frustumCulled = false;
    group.add(cluster);
    const beltRocks = [];
    const mm = new THREE.Matrix4(), sc = V(), q = new THREE.Quaternion();
    for (const mesh of belt.children)
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, mm);
        const p = V();
        mm.decompose(p, q, sc);
        beltRocks.push({ p, s: sc.x, alive: true, mesh, i });
      }
    const comet = makeComet(inView(-12, 31, 760), V());
    group.add(comet);
    bakeLog.list = null;

    const targets = [
      ...bodies.map((b) => ({ name: b.name, obj: b.group, radius: b.radius, body: b, stand: b.type.startsWith("gas") ? (b.ringed ? 4.6 : 3.3) : 3.1, color: LABEL(b.type) })),
      { name: star.name, obj: sun.group, radius: sun.radius, stand: 5, color: STAR_KINDS[star.kind].color },
      { name: "Comet", obj: comet, radius: 14, stand: 15, side: comet.position.clone().normalize(), color: "#8fe0ff" },
    ];
    for (const t of targets) {
      const el = document.createElement("button");
      el.className = "label";
      el.innerHTML = `<i style="border-color:${t.color}"></i><b></b><small></small>`;
      el.querySelector("b").textContent = t.name;
      el.onclick = () => flyTo(t);
      $("labels").appendChild(el);
      t.el = el;
      t.dist = el.querySelector("small");
    }
    const start = SPOT.clone().addScaledVector(viewFromPlanet, heroR * 3.2).addScaledVector(up0, -8);
    const mapR = Math.max(...layout.map((L) => Math.hypot(L.position.x, L.position.z)), beltR) + 400;
    return { mapR, star, system, group, sun, companion, bodies, home, cityDirs, moons, rocks, cluster, beltRocks, comet, targets, rts, start, SPOT };
  }

  function disposeSystem(sys) {
    scene.remove(sys.group);
    sys.group.traverse((o) => {
      if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) if (!keep.has(m)) m.dispose();
    });
    for (const rt of sys.rts) rt.dispose();
    for (const t of sys.targets) t.el.remove();
  }

  await step("Charting " + startStar.name, 10);
  let sys = await buildSystem(startStar);
  scene.add(sys.group);

  /* ---------- ship ---------- */
  const ship = makeShip();
  scene.add(ship.group);
  const trails = [new Trail(0x2a9fff, 0.22), new Trail(0x2a9fff, 0.22)];
  trails.forEach((t) => scene.add(t.mesh));
  const particles = new Particles();
  scene.add(particles.points);
  const flash = new THREE.PointLight(0xffa860, 0, 160, 1.2);
  scene.add(flash);

  const S = {
    pos: sys.start.clone(),
    yaw: 0, pitch: 0, speed: 6, bank: 0, auto: null, idle: 9, orbiting: null,
    ore: saved?.ore || 0, specimens: saved?.specimens || 0, beam: false, fire: false, boost: false, cool: 0,
  };
  const o = new THREE.Object3D();
  const dirOf = (yaw, pitch) => V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const aimAt = (d) => ({ yaw: Math.atan2(d.x, d.z), pitch: Math.asin(clamp(d.y, -1, 1)) });
  function placeShip() {
    S.pos.copy(sys.start);
    const a = aimAt(sys.SPOT.clone().sub(S.pos).normalize());
    S.yaw = a.yaw;
    S.pitch = a.pitch - (innerWidth > innerHeight ? 0.08 : 0.19);
    S.speed = 0;
    S.auto = S.orbiting = null;
    S.idle = 9;
    S.hover = 0;
    camReady = false;
  }
  const look = { yaw: 0, pitch: 0, zoom: 1 };
  const camPos = V(), camAim = V(), camUp = V(0, 1, 0);
  let camReady = false;
  placeShip();

  function steer(yaw, pitch, rate, dt) {
    let dy = yaw - S.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const turn = clamp(dy * 3, -rate, rate) * dt;
    S.yaw += turn;
    S.pitch += clamp((clamp(pitch, -1.3, 1.3) - S.pitch) * 3, -rate, rate) * dt;
    return turn / Math.max(dt, 1e-4);
  }

  const nearest = () => {
    let best = null, alt = 1e9;
    for (const b of sys.bodies) {
      const a = S.pos.distanceTo(b.group.position) - b.radius;
      if (a < alt) (alt = a), (best = b);
    }
    return { body: best, alt };
  };

  /* ---------- input ---------- */
  const pointers = new Map();
  let pinch = 0, keys = new Set();
  let mode = "close";
  let comms = null;
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (mode !== "close") return;
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, look: e.button === 2 });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || mode !== "close") return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size >= 2) {
      look.yaw -= dx * 0.004;
      look.pitch = clamp(look.pitch + dy * 0.003, -1, 1.1);
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) zoomClose(1 + (pinch / d - 1) * 0.5);
      pinch = d;
    } else if (p.look) {
      look.yaw -= dx * 0.008;
      look.pitch = clamp(look.pitch + dy * 0.006, -1, 1.1);
    }
  });
  let gesture = false; // a two-finger gesture suppresses steering until all fingers lift
  let outPush = 0;
  // Pulling out past the widest zoom opens the star map.
  function zoomClose(f) {
    if (look.zoom * f > 4 && f > 1 && !S.auto) {
      outPush += Math.log(f);
      if (outPush > 0.4) (outPush = 0), openStars();
    }
    look.zoom = clamp(look.zoom * f, 0.55, 4);
  }
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (!pointers.size) (gesture = false), (outPush = 0);
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (mode === "close") zoomClose(e.deltaY > 0 ? 1.1 : 0.9);
  }, { passive: false });
  // Labels sit over the view: scrolling on one still zooms.
  for (const id of ["labels", "slabels"]) $(id).addEventListener("wheel", (e) => canvas.dispatchEvent(new WheelEvent("wheel", e)), { passive: true });
  addEventListener("keydown", (e) => keys.add(e.code));
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => (keys.clear(), pointers.clear(), (S.fire = S.beam = S.boost = false)));

  const holdButton = (id, key) => {
    const b = $(id);
    const set = (v) => (e) => {
      e.preventDefault();
      S[key] = v;
      b.classList.toggle("on", v);
    };
    b.addEventListener("pointerdown", (e) => (b.setPointerCapture?.(e.pointerId), set(true)(e)));
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(ev, set(false));
    b.addEventListener("contextmenu", (e) => e.preventDefault());
  };
  holdButton("bBeam", "beam");
  holdButton("bFire", "fire");
  holdButton("bBoost", "boost");
  $("bMute").onclick = () => {
    sound.mute(!sound.muted);
    $("bMute").classList.toggle("off", sound.muted);
  };
  $("bPhoto").onclick = () => document.body.classList.toggle("photo");

  /* ---------- labels and map ---------- */
  let toastTimer = 0;
  function toast(text, secs = 2.6) {
    $("toast").textContent = text;
    $("toast").classList.add("show");
    toastTimer = secs;
  }
  function flyTo(t) {
    // Choose the arrival point once: a little above the target, on the side we come from.
    const away = S.pos.clone().sub(t.obj.position).normalize();
    if (t.side) away.projectOnPlane(t.side).normalize(); // see the comet's tail side on
    away.y += t.body?.ringed ? 0.45 : 0.12;
    away.normalize();
    t.arrive = t.obj.position.clone().addScaledVector(away, t.radius * t.stand);
    S.auto = t;
    S.orbiting = null;
    look.yaw = look.pitch = 0;
    toast("Autopilot: " + t.name);
    sound.tone(420, 880, 0.18, "sine", 0.12);
  }

  const map = $("map"), mx = map.getContext("2d");
  const mapPoint = (p) => {
    const r = Math.hypot(p.x, p.z), a = Math.atan2(p.z, p.x), k = Math.sqrt(r / sys.mapR) * 90;
    return [100 + Math.cos(a) * k, 100 + Math.sin(a) * k];
  };
  map.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const b = map.getBoundingClientRect();
    const x = ((e.clientX - b.left) / b.width) * 200, y = ((e.clientY - b.top) / b.height) * 200;
    let best = null, d = 30;
    for (const t of sys.targets) {
      const [px, py] = mapPoint(t.obj.position);
      const dd = Math.hypot(px - x, py - y);
      if (dd < d) (d = dd), (best = t);
    }
    if (best) flyTo(best);
  });
  map.addEventListener("dblclick", openStars);
  function drawMap() {
    mx.clearRect(0, 0, 200, 200);
    mx.lineWidth = 1;
    for (const t of sys.targets) {
      if (!t.body) continue;
      mx.strokeStyle = "rgba(120,220,255,.18)";
      mx.beginPath();
      mx.arc(100, 100, Math.sqrt(Math.hypot(t.obj.position.x, t.obj.position.z) / sys.mapR) * 90, 0, 7);
      mx.stroke();
    }
    for (const t of sys.targets) {
      const [x, y] = mapPoint(t.obj.position);
      mx.fillStyle = t.color;
      mx.beginPath();
      mx.arc(x, y, t.obj === sys.sun.group ? 9 : t.radius > 100 ? 7 : 5, 0, 7);
      mx.fill();
      if (S.auto === t) (mx.strokeStyle = "#fff"), mx.beginPath(), mx.arc(x, y, 11, 0, 7), mx.stroke();
    }
    for (const p of raiders.positions()) {
      const [rx, ry] = mapPoint(p);
      mx.fillStyle = "#ff4a3a";
      mx.fillRect(rx - 3, ry - 3, 6, 6);
    }
    const [x, y] = mapPoint(S.pos);
    const a = Math.atan2(dirOf(S.yaw, 0).z, dirOf(S.yaw, 0).x);
    mx.save();
    mx.translate(x, y);
    mx.rotate(a);
    mx.fillStyle = "#fff";
    mx.beginPath();
    mx.moveTo(11, 0);
    mx.lineTo(-7, 7);
    mx.lineTo(-3, 0);
    mx.lineTo(-7, -7);
    mx.fill();
    mx.restore();
  }

  /* ---------- weapons and beam ---------- */
  const bolts = [];
  let hudT = 0;
  const boltGeo = new THREE.CylinderGeometry(0.09, 0.09, 4.5, 6).rotateX(Math.PI / 2);
  const boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.7, 1.6) });
  function fire() {
    const f = dirOf(S.yaw, S.pitch);
    // Aim assist: the closest rock inside a narrow cone.
    let target = null, best = 190;
    const to = V();
    for (const r of sys.rocks.concat(sys.beltRocks)) {
      if (!r.alive) continue;
      to.subVectors(r.p, S.pos);
      const d = to.length();
      if (d < best && to.divideScalar(d).dot(f) > 0.94) (best = d), (target = r);
    }
    for (const m of MUZZLES) {
      const from = ship.body.localToWorld(m.clone());
      const dir = target ? target.p.clone().sub(from).normalize() : f.clone();
      const mesh = new THREE.Mesh(boltGeo, boltMat);
      mesh.position.copy(from);
      mesh.lookAt(from.clone().add(dir));
      scene.add(mesh);
      bolts.push({ mesh, v: dir.multiplyScalar(240 + S.speed), life: 1.4 });
    }
    sound.tone(1300, 180, 0.14, "sawtooth", 0.07);
  }
  function explode(p, size, color = 0xff9a3a) {
    const v = V();
    for (let i = 0; i < 70; i++) {
      v.randomDirection().multiplyScalar((4 + Math.random() * 26) * Math.sqrt(size));
      particles.spawn(p, v, i % 3 ? color : 0xffe9b0, (0.35 + Math.random() * 0.9) * size, 0.4 + Math.random() * 0.9);
    }
    for (let i = 0; i < 18; i++) {
      v.randomDirection().multiplyScalar(5 * size);
      particles.spawn(p, v, 0x4a2c1c, size * 2.4, 1.2 + Math.random(), 1.6);
    }
    flash.position.copy(p);
    flash.intensity = 60 * size;
  }
  function setRock(r) {
    if (!r.mesh) return;
    o.position.set(0, 0, 0);
    o.scale.setScalar(0);
    o.updateMatrix();
    r.mesh.setMatrixAt(r.i, o.matrix);
    r.mesh.instanceMatrix.needsUpdate = true;
  }
  function updateBolts(dt) {
    const prev = V(), seg = new THREE.Line3(), near = V();
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      prev.copy(b.mesh.position);
      b.mesh.position.addScaledVector(b.v, dt);
      b.life -= dt;
      seg.set(prev, b.mesh.position);
      let hit = false;
      for (const r of sys.rocks.concat(sys.beltRocks)) {
        if (!r.alive) continue;
        if (Math.abs(r.p.x - prev.x) > 40 || Math.abs(r.p.z - prev.z) > 40) continue;
        seg.closestPointToPoint(r.p, true, near);
        if (near.distanceTo(r.p) < r.s + 0.6) {
          r.alive = false;
          setRock(r);
          explode(r.p, clamp(r.s * 0.55, 0.7, 3));
          const ore = Math.ceil(r.s * 3);
          S.ore += ore;
          toast("+" + ore + " ore");
          sound.boom(clamp(0.25 + r.s * 0.08, 0.25, 0.6));
          hit = true;
          break;
        }
      }
      if (!hit && raiders.hitTest(prev, b.mesh.position)) hit = true;
      if (!hit)
        for (const p of sys.bodies)
          if (b.mesh.position.distanceTo(p.group.position) < p.radius * 1.02) {
            explode(b.mesh.position, 0.6);
            hit = true;
            break;
          }
      if (hit || b.life <= 0) {
        scene.remove(b.mesh);
        bolts.splice(i, 1);
      }
    }
  }

  /* ---------- hostile ships ---------- */
  S.cleared = new Set();
  const wreck = () => {
    raiders.clear();
    S.hull = 40;
    S.credits = Math.round((S.credits || 0) * 0.85);
    toast("Your ship was disabled. Your people towed you home.", 5);
    starView.setCurrent(HOME);
    arrive(galaxy.stars[HOME]);
  };
  const raiders = createRaiders({
    scene, S, explode, sound, toast, onWreck: wreck,
    onKill: (left) => {
      comms?.onKill();
      if (left === 0) { S.cleared.add(sys.star.id); S.credits += 40; comms?.showCredits(); toast("Skies clear. +40 credits bounty", 4); }
    },
  });
  function scheduleRaid(star) {
    if (star.id === HOME || S.cleared.has(star.id) || !comms) return;
    const owner = comms.world.of(star.id);
    let n = 0, color = 0xff4a3a;
    if (owner && !owner.keis) { if (comms.rels[owner.id].war) (n = 3), (color = new THREE.Color(owner.color).getHex()); }
    else if (!owner && ((star.id * 2654435761) >>> 0) % 100 < 32) n = 2 + (((star.id * 40503) >>> 0) % 2);
    if (!n) return;
    setTimeout(() => { if (sys.star.id === star.id && !warping && !raiders.count) raiders.spawn(n, color); }, 7000);
  }

  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; void main(){ float rings=pow(.5+.5*sin(vUv.y*38.-uTime*11.),4.); float a=.07+rings*.3+.05*sin(vUv.x*50.+uTime*3.); gl_FragColor=vec4(vec3(.2,1.2,1.0)*a*(.7-.35*smoothstep(.75,1.,vUv.y)),1.); }`,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 3.4, 1, 32, 1, true).translate(0, -0.5, 0), beamMat);
  const beamSpot = glowSprite(0x4affd0, 9, 0.7);
  beam.visible = beamSpot.visible = false;
  scene.add(beam, beamSpot);
  const lifting = [];
  let spawnT = 0, beamSaid = 0;
  function updateBeam(dt, t) {
    const { body, alt } = nearest();
    const want = S.beam || keys.has("KeyB");
    let on = false;
    if (want) {
      if (alt > body.radius * 0.9 || body.type.startsWith("gas")) {
        if (t > beamSaid) toast(body.type.startsWith("gas") && alt < body.radius ? "No solid ground to beam from" : "Fly closer to a planet to use the beam"), (beamSaid = t + 3);
      } else on = true;
    }
    beam.visible = beamSpot.visible = on;
    sound.beam(on);
    if (on) {
      const down = body.group.position.clone().sub(S.pos).normalize();
      const local = body.surface.worldToLocal(S.pos.clone()).normalize();
      const h = body.hero ? body.heightAt(local) : body.type === "oceanic" ? -0.1 : 0.05;
      const ground = body.group.position.clone().addScaledVector(down, -(body.radius + Math.max(0, h) * body.relief));
      const len = S.pos.distanceTo(ground);
      beam.position.copy(S.pos).addScaledVector(down, 0.6);
      beam.quaternion.setFromUnitVectors(V(0, -1, 0), down);
      beam.scale.set(1, len, 1);
      beamSpot.position.copy(ground).addScaledVector(down, -0.6);
      beamMat.uniforms.uTime.value = t;
      spawnT -= dt;
      const living = body.living;
      if (spawnT <= 0 && living && h > 0) {
        spawnT = 1.1;
        const c = makeCritter(body.info.homeworld ? [0.08, 0.78, 0.93, 0.14][Math.floor(Math.random() * 4)] : hash01(body.info.surfaceSeed % 1000) * 0.9);
        c.scale.setScalar(clamp(len / 22, 0.55, 1.5));
        scene.add(c);
        lifting.push({ c, body, from: ground.clone(), k: 0, wob: Math.random() * 6, dur: 2.2 });
        sound.tone(300 + Math.random() * 200, 900, 0.3, "sine", 0.08);
      } else if (spawnT <= 0 && t > beamSaid) {
        toast(!living ? "Nothing living down there" : "Only ocean below");
        beamSaid = t + 3;
        spawnT = 1;
      }
      if (Math.random() < dt * 40) particles.spawn(ground.clone().add(V().randomDirection().multiplyScalar(2.5)), down.clone().multiplyScalar(-8), 0x5affd8, 0.5, 1.1);
    }
    for (let i = lifting.length - 1; i >= 0; i--) {
      const l = lifting[i];
      l.k += (dt / l.dur) * (on ? 1 : -1.6);
      if (l.k >= 1) {
        scene.remove(l.c);
        lifting.splice(i, 1);
        S.specimens++;
        toast("Specimen aboard");
        sound.tone(700, 1400, 0.2, "triangle", 0.12);
        continue;
      }
      if (l.k <= 0) {
        scene.remove(l.c);
        lifting.splice(i, 1);
        continue;
      }
      l.c.position.lerpVectors(l.from, S.pos, l.k * l.k * 0.6 + l.k * 0.4);
      l.c.rotation.set(Math.sin(t * 2 + l.wob) * 0.5, t * 1.4 + l.wob, Math.cos(t * 1.7 + l.wob) * 0.4);
    }
  }

  /* ---------- post ---------- */
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.45, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  /* ---------- star view and moving between the views ---------- */
  const renderPass = composer.passes[0];
  const starView = createStarView({ renderer, galaxy, sky, environment: scene.environment, homeId: HOME, onArrive: (star) => arrive(star), onEnter: () => closeStars(), toast, sound, S });
  starView.setCurrent(startStar.id);
  comms = createComms({ galaxy, S, homeId: HOME, toast, sound, starView, retreat: (id) => { starView.setCurrent(id); arrive(galaxy.stars[id]); } });
  comms.refresh(startStar.id, "close");
  starView.addSignals(comms.world.empires);
  const save = () => {
    try {
      localStorage.setItem("johnny-spore-space-test", JSON.stringify({ star: sys.star.id, ore: S.ore, specimens: S.specimens }));
    } catch {}
  };
  function setMode(m) {
    mode = m;
    if (comms) comms.refresh(starView.state.current, m);
    starView.active = m === "stars";
    bloom.threshold = m === "stars" ? 1.3 : 1.0;
    bloom.strength = m === "stars" ? 0.3 : 0.55;
    renderPass.scene = m === "stars" ? starView.scene : scene;
    renderPass.camera = m === "stars" ? starView.camera : camera;
    document.body.classList.toggle("stars", m === "stars");
    pointers.clear();
    S.beam = S.fire = S.boost = false;
    for (const id of ["bBeam", "bFire", "bBoost"]) $(id).classList.remove("on");
    sound.engine(0);
    sound.beam(false);
    $("place").querySelector("b").textContent = m === "stars" ? "Star map" : sys.star.name + " system";
    if (m === "stars") $("where").textContent = sys.star.name + " · " + sys.star.sector;
    $("bStars").querySelector("span").textContent = m === "stars" ? "System" : "Star map";
  }
  let seenStars = false;
  function openStars() {
    if (mode === "stars" || warping) return;
    starView.show();
    setMode("stars");
    sound.tone(330, 160, 0.4, "sine", 0.1);
    if (!seenStars) toast("Tap a star to see it. Tap Travel to go there.", 4.5), (seenStars = true);
  }
  function closeStars() {
    if (mode !== "stars" || warping) return;
    if (starView.state.current !== sys.star.id) return arrive(galaxy.stars[starView.state.current]);
    setMode("close");
    camReady = false;
    look.zoom = 1.6;
    sound.tone(160, 420, 0.4, "sine", 0.1);
  }
  setMode("close");
  $("bStars").onclick = () => (mode === "stars" ? closeStars() : openStars());
  let warping = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Drop out of the jump beside a new sun: the warp screen covers building the system. */
  async function arrive(star) {
    if (warping) return;
    warping = true;
    $("warpName").textContent = star.name;
    $("warpBar").style.width = "0%";
    $("warp").hidden = false;
    document.body.classList.add("warping");
    sound.tone(120, 900, 1.2, "sawtooth", 0.08);
    await wait(700);
    disposeSystem(sys);
    for (const b of bolts.splice(0)) scene.remove(b.mesh);
    raiders.clear();
    for (const l of lifting.splice(0)) scene.remove(l.c);
    sys = await buildSystem(star, async (text, pct) => {
      $("warpText").textContent = text;
      $("warpBar").style.width = pct + "%";
      await nextFrame();
    });
    scene.add(sys.group);
    $("warpBar").style.width = "100%";
    placeShip();
    trails.forEach((tr) => tr.clear());
    setMode("close");
    update(0.016);
    save();
    document.body.classList.remove("warping");
    $("warp").classList.add("out");
    await wait(900);
    $("warp").hidden = true;
    $("warp").classList.remove("out");
    warping = false;
    toast("Arrived at " + star.name, 3);
    sound.tone(660, 990, 0.35, "sine", 0.12);
    comms?.onArrive(star, "close");
    scheduleRaid(star);
  }

  function resize() {
    starView.resize(ratio);
    renderer.setPixelRatio(ratio);
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setPixelRatio(ratio);
    composer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.fov = camera.aspect < 0.8 ? 68 : 55;
    camera.updateProjectionMatrix();
    particles.points.material.uniforms.uH.value = (innerHeight * ratio) / (2 * Math.tan(camera.fov / 114.6));
    sky.children[1].material.uniforms.uPx.value = ratio;
  }
  addEventListener("resize", resize);
  resize();
  canvas.addEventListener("webglcontextlost", (e) => (e.preventDefault(), ($("lost").hidden = false)));

  /* ---------- loop ---------- */
  let t = 0, last = performance.now(), frames = 0, fpsT = 0, mapT = 0, slow = 0;
  const proj = V();

  function update(dt) {
    t += dt;
    sys.sun.update(t);
    sys.companion?.update(t);
    for (const b of sys.bodies) {
      b.surface.rotation.y += dt * (b === sys.home ? 0.004 : 0.012);
      const shift = t * 0.0009;
      if (b.clouds) {
        b.clouds.rotation.y = b.surface.rotation.y;
        b.clouds.material.uniforms.uShift.value = shift;
        b.surface.material.uniforms.uCloudShift.value = shift;
      }
    }
    for (const m of sys.moons) {
      m.a += dt * m.speed;
      m.mesh.position.set(Math.cos(m.a) * m.dist, Math.sin(m.a) * m.dist * m.tilt, Math.sin(m.a) * m.dist).add(m.parent.group.position);
      m.mesh.rotation.y += dt * 0.03;
    }
    for (const r of sys.rocks) {
      r.rot.y += r.spin * dt;
      o.position.copy(r.p);
      o.rotation.set(r.rot.x, r.rot.y, 0);
      o.scale.setScalar(r.alive ? r.s : 0);
      o.updateMatrix();
      sys.cluster.setMatrixAt(r.i, o.matrix);
    }
    sys.cluster.instanceMatrix.needsUpdate = true;

    /* flying */
    const p = pointers.size === 1 && !gesture ? [...pointers.values()][0] : null;
    if (pointers.size >= 2) gesture = true;
    const kx = (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) - (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0);
    const ky = (keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0);
    const thrust = keys.has("KeyW");
    const boost = S.boost || keys.has("Space") || keys.has("ShiftLeft");
    const manual = (p && !p.look) || kx || ky || thrust || boost;
    if (manual) (S.auto = null), (S.orbiting = null), (S.idle = 0);
    else S.idle += dt;
    const { body, alt } = nearest();
    const sunAlt = S.pos.length() - sys.sun.radius;
    const room = Math.max(0, Math.min(alt, sunAlt));
    let target = 0, yawRate = 0;
    if (p && !p.look) {
      const ndc = V((p.x / innerWidth) * 2 - 1, -(p.y / innerHeight) * 2 + 1, 0.5);
      const ray = ndc.unproject(camera).sub(camera.position).normalize();
      const aim = camera.position.clone().addScaledVector(ray, 90).sub(S.pos).normalize();
      const a = aimAt(aim);
      yawRate = steer(a.yaw, a.pitch, 1.5, dt);
      target = 70;
      // Looking around is undone while you fly.
      look.yaw *= 1 - dt * 2;
      look.pitch *= 1 - dt * 2;
    }
    if (kx || ky) yawRate = steer(S.yaw + kx * 0.6, S.pitch + ky * 0.4, 1.5, dt);
    if (thrust) target = 70;
    if (boost) target = 460;
    target = Math.min(target, 14 + room * (boost ? 2.2 : 0.8));
    if (S.auto) {
      const goal = S.auto.obj.position;
      const to = S.auto.arrive.clone().sub(S.pos);
      const d = to.length();
      to.divideScalar(d || 1);
      const near = d < Math.max(10, S.auto.radius * 0.3);
      const facing = aimAt(goal.clone().sub(S.pos).normalize());
      const way = aimAt(to);
      // Far out, point the way we're going; on arrival, swing round to face the sight.
      const c = near ? { yaw: facing.yaw, pitch: facing.pitch - 0.19 } : way;
      yawRate = steer(c.yaw, c.pitch, 2.4, dt);
      const lined = Math.max(0, dirOf(S.yaw, S.pitch).dot(to));
      target = near ? 0 : Math.min(600, 10 + d * 1.1) * Math.max(0.04, lined ** 6);
      // Slide round anything in the way.
      for (const o2 of sys.bodies.map((b) => [b.group.position, b.radius]).concat([[sys.sun.group.position, sys.sun.radius * 1.5]])) {
        const rel = S.pos.clone().sub(o2[0]);
        if (rel.length() < o2[1] * 1.6 && !near) S.pos.addScaledVector(rel.normalize(), dt * Math.max(60, S.speed * 0.8));
      }
      const aligned = Math.abs(Math.atan2(Math.sin(c.yaw - S.yaw), Math.cos(c.yaw - S.yaw))) < 0.08 && Math.abs(c.pitch - S.pitch) < 0.08;
      if (near && aligned) {
        toast(S.auto.body ? "Orbiting " + S.auto.name : "Arrived at " + S.auto.name);
        sound.tone(660, 990, 0.35, "sine", 0.12);
        S.auto = null;
        S.idle = 9;
      }
    }
    // Left alone near a planet, the ship settles into orbit.
    S.orbiting = !manual && !S.auto && S.idle > 1.5 && alt < body.radius * (body.ringed ? 3.8 : 2.6) && !pointers.size ? body : null;
    const k = target > S.speed ? 1.6 : 2.6;
    S.speed += (target - S.speed) * Math.min(1, dt * k);
    S.pos.addScaledVector(dirOf(S.yaw, S.pitch), S.speed * dt);
    // Close in, autopilot eases the last stretch so it can't circle the spot.
    if (S.auto && S.pos.distanceTo(S.auto.arrive) < 60) S.pos.lerp(S.auto.arrive, Math.min(1, dt * 1.4));
    if (S.orbiting && !S.beam) {
      const rel = S.pos.clone().sub(body.group.position);
      rel.applyAxisAngle(V(0, 1, 0), dt * 0.018);
      S.pos.copy(body.group.position).add(rel);
      S.yaw += dt * 0.018;
    }
    for (const b of sys.bodies.concat([{ group: sys.sun.group, radius: sys.sun.radius * 1.45 }])) {
      const rel = S.pos.clone().sub(b.group.position);
      const min = b.radius * 1.13 + 1.5;
      if (rel.length() < min) S.pos.copy(b.group.position).add(rel.setLength(min));
    }

    /* ship model */
    const hb = nearest();
    const hoverOn = (S.beam || keys.has("KeyB")) && hb.alt < hb.body.radius * 0.9 && !hb.body.type.startsWith("gas");
    S.hover = (S.hover || 0) + ((hoverOn ? 1 : 0) - (S.hover || 0)) * Math.min(1, dt * 3.5);
    const normal = S.pos.clone().sub(hb.body.group.position).normalize();
    const level = dirOf(S.yaw, S.pitch).projectOnPlane(normal);
    if (level.lengthSq() < 1e-4) level.set(0, 1, 0).projectOnPlane(normal);
    level.normalize();
    if (hoverOn) target = 0, S.speed *= Math.max(0, 1 - dt * 5);
    S.bank += (clamp(-yawRate * 0.55, -0.75, 0.75) - S.bank) * Math.min(1, dt * 4);
    ship.group.position.copy(S.pos);
    ship.group.rotation.set(-S.pitch, S.yaw, 0, "YXZ");
    if (S.hover > 0.001) {
      const basis = new THREE.Matrix4().makeBasis(normal.clone().cross(level), normal, level);
      ship.group.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(basis), S.hover);
    }
    ship.body.rotation.z = S.bank + Math.sin(t * 0.8) * 0.025;
    ship.body.position.y = Math.sin(t * 1.3) * 0.12;
    const power = clamp(Math.sqrt(S.speed / 90), 0.12, 1.5) * (1 - S.hover * 0.8);
    ship.update(t, power);
    sound.engine(clamp(S.speed / 200, 0, 1));
    ship.group.updateMatrixWorld(true);

    /* camera */
    const portrait = Math.max(1, 0.85 / camera.aspect);
    const dist = 12 * portrait * look.zoom * (1 + clamp(S.speed - 90, 0, 400) / 2200);
    const cy = S.yaw + look.yaw, cp = clamp(S.pitch - 0.3 - look.pitch, -1.45, 1.45);
    const back = dirOf(cy, cp);
    const wantPos = back.clone().multiplyScalar(-dist);
    const wantAim = dirOf(cy, clamp(cp + 0.3, -1.45, 1.45)).multiplyScalar(8 * Math.max(0, 1 - Math.abs(look.yaw)));
    if (!camReady) camPos.copy(wantPos), camAim.copy(wantAim), (camReady = true);
    camPos.lerp(wantPos, Math.min(1, dt * 5));
    camAim.lerp(wantAim, Math.min(1, dt * 6));
    camera.position.copy(S.pos).add(camPos);
    camera.up.copy(camUp);
    const aimPoint = proj.copy(S.pos).add(camAim);
    if (S.hover > 0.001) {
      const d = dist * Math.max(0.8, look.zoom);
      camera.position.lerp(S.pos.clone().addScaledVector(normal, d * 0.75).addScaledVector(level, -d * 0.95), S.hover);
      aimPoint.lerp(S.pos.clone().addScaledVector(normal, -Math.min(10, hb.alt * 0.45)).addScaledVector(level, 3), S.hover);
      camera.up.lerp(normal, S.hover).normalize();
    }
    camera.lookAt(aimPoint);
    sky.position.copy(camera.position);
    for (const c of sys.sun.group.children) c.updateMatrixWorld();

    /* effects */
    S.cool -= dt;
    if ((S.fire || keys.has("KeyF")) && S.cool <= 0) fire(), (S.cool = 0.19);
    updateBolts(dt);
    raiders.update(dt);
    if (mode === "close") S.charge = Math.min(100, S.charge + 0.1 * dt); // a slow trickle from the star
    if ((hudT += dt) > 0.5) (hudT = 0), comms?.showCredits();
    updateBeam(dt, t);
    ship.nozzles.forEach((n, i) => {
      const w = ship.body.localToWorld(n.clone());
      if (S.speed > 160) trails[i].clear();
      trails[i].push(w, camera, clamp((S.speed - 8) / 120, 0, 0.4) * (1 - S.hover));
      trails[i].mesh.visible = S.speed <= 160;
    });
    if (S.speed > 120) {
      const f = dirOf(S.yaw, S.pitch);
      for (let i = 0; i < 3; i++) {
        const at = S.pos.clone().addScaledVector(f, 40 + Math.random() * 90).add(V().randomDirection().multiplyScalar(6 + Math.random() * 40));
        particles.spawn(at, f.clone().multiplyScalar(-S.speed * 0.6), 0x6f98c8, 0.5, 0.45);
      }
    }
    particles.update(dt);
    flash.intensity *= Math.max(0, 1 - dt * 6);

    /* interface */
    toastTimer -= dt;
    if (toastTimer <= 0) $("toast").classList.remove("show");
    const here = nearest();
    $("where").textContent = S.auto ? "Autopilot to " + S.auto.name : S.orbiting ? "Orbiting " + here.body.name : here.alt < here.body.radius * 2 ? "Near " + here.body.name : S.pos.length() < sys.sun.radius * 6 ? "Close to the star" : "Deep space";
    $("speed").textContent = Math.round(S.speed);
    $("ore").textContent = S.ore;
    $("spec").textContent = S.specimens;
    camera.updateMatrixWorld();
    const placed = [];
    for (const tg of sys.targets) {
      proj.copy(tg.obj.position).project(camera);
      const d = S.pos.distanceTo(tg.obj.position);
      let show = proj.z < 1 && Math.abs(proj.x) < 0.92 && proj.y < 0.78 && proj.y > -0.6 && d > tg.radius * 4.5 && S.auto !== undefined;
      const x = ((proj.x + 1) / 2) * innerWidth, y = ((1 - proj.y) / 2) * innerHeight;
      if (show && placed.some(([px, py]) => Math.abs(px - x) < 80 && Math.abs(py - y) < 40)) show = false;
      tg.el.style.display = show ? "" : "none";
      if (show) {
        placed.push([x, y]);
        tg.el.style.transform = `translate(${x}px,${y}px)`;
        tg.dist.textContent = Math.round(d - tg.radius);
      }
    }
    mapT -= dt;
    if (mapT <= 0) drawMap(), (mapT = 0.1);
  }

  function frame(now) {
    const raw = (now - last) / 1000;
    last = now;
    if (mode === "stars") {
      starView.update(Math.min(raw, 0.05));
      const cur = galaxy.stars[starView.state.current];
      $("where").textContent = starView.state.travel ? "Travelling" : cur.name + " · " + cur.sector;
      toastTimer -= raw;
      if (toastTimer <= 0) $("toast").classList.remove("show");
    } else update(Math.min(raw, 0.05));
    composer.render();
    frames++;
    fpsT += raw;
    if (fpsT >= 2) {
      const fps = frames / fpsT;
      $("fps").textContent = Math.round(fps) + " fps";
      // Trade sharpness first, then glow, to stay smooth.
      if (fps < 40 && !document.hidden && t > 4) slow++;
      else slow = 0;
      if (slow >= 2 && !params.has("fixed")) {
        if (ratio > 1) (ratio = Math.max(1, ratio - 0.25)), resize();
        else if (fps < 28) bloom.enabled = false;
        slow = 0;
      }
      frames = 0;
      fpsT = 0;
    }
    requestAnimationFrame(frame);
  }

  await step("Warming up the engines", 94);
  update(0.016);
  composer.render();
  await step("Ready", 100);
  $("loading").classList.add("done");
  $("launch").hidden = false;
  $("launch").onclick = () => {
    sound.start(); startMusic();
    $("title").classList.add("gone");
    document.body.classList.add("live");
    setTimeout(() => $("hint").classList.add("gone"), 9000);
  };
  if (!window.__manual) requestAnimationFrame(frame); // tests step the loop by hand
  addEventListener("visibilitychange", () => (last = performance.now()));
  window.__look = { get raiders() { return raiders; },
    S, bloom, scene, look, flyTo, camera, renderer, starView, galaxy, openStars, closeStars, arrive, get comms() { return comms; },
    get sys() { return sys; }, get mode() { return mode; }, get warping() { return warping; },
    get bodies() { return sys.bodies; }, get targets() { return sys.targets; }, get home() { return sys.home; }, get cityDirs() { return sys.cityDirs; }, get rocks() { return sys.rocks; },
    step: (n, dt = 1 / 30) => {
      for (let i = 0; i < n; i++) mode === "stars" ? starView.update(dt) : update(dt);
      composer.render();
    },
  };
}

boot().catch((e) => {
  console.error(e);
  $("loadText").textContent = "This device couldn't start the 3D view: " + e.message;
});

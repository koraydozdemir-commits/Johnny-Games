/**
 * Weather on the creature island, drawn and timed: rain and storms (falling streaks, closer fog,
 * lightning flashes), heat haze, meteor showers (streaks across the night sky, then one meteorite
 * that lands near you) and volcanic eruptions (lava bombs that show a warning ring before they land).
 * The stage asks this module how events change play (notice, hunger) and is told when a meteorite lands
 * or a bomb goes off.
 */
import * as THREE from "three";
import { EVENTS, bombDamage, eventLength, nextEventIn, pickEvent } from "./events.js";
import { heightAt } from "./world.js";

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {HTMLElement} o.hud
 * @param {string} o.region
 * @param {(kind:string, opts?:object) => void} o.sfx
 * @param {(text:string, secs?:number) => void} o.toast
 * @param {(x:number, z:number) => void} o.onMeteorite   a meteorite has landed here
 * @param {(dmg:number) => void} o.onBomb                 a lava bomb hit you
 * @param {boolean} [o.reducedMotion]
 */
export function createWeather(o) {
  const disposables = [];
  const fog = o.scene.fog;
  const baseFog = fog ? { near: fog.near, far: fog.far } : null;
  let ev = null; // { id, t }
  let clock = nextEventIn() * 0.6;
  let fogK = 1;

  // The chip that names the weather.
  const chip = document.createElement("div");
  chip.className = "chWeather";
  chip.setAttribute("role", "status");
  chip.setAttribute("aria-live", "polite");
  chip.hidden = true;
  o.hud.appendChild(chip);
  const tint = document.createElement("div");
  tint.className = "chWeatherTint";
  tint.setAttribute("aria-hidden", "true");
  o.hud.appendChild(tint);

  // Rain: streaks in a box that follows you.
  const RAIN = 700;
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN * 6);
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0xbfd8ea, transparent: true, opacity: 0.45, depthWrite: false });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.visible = false;
  o.scene.add(rain);
  disposables.push(rainGeo, rainMat);
  const drops = [...Array(RAIN)].map(() => ({ x: (Math.random() - 0.5) * 60, y: Math.random() * 30, z: (Math.random() - 0.5) * 60, v: 26 + Math.random() * 10 }));

  // Meteor streaks and the meteorite itself.
  const streakMat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9 });
  disposables.push(streakMat);
  const streaks = [];
  let meteoriteDue = 0;
  const rockGeo = new THREE.DodecahedronGeometry(0.9, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x3a2f3f, emissive: 0xff7a2a, emissiveIntensity: 0.9, roughness: 0.6, flatShading: true });
  disposables.push(rockGeo, rockMat);

  // Lava bombs: a warning ring, then the hit.
  const ringGeo = new THREE.RingGeometry(1.1, 1.6, 28).rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, opacity: 0.8, depthWrite: false });
  const blastMat = new THREE.MeshBasicMaterial({ color: 0xff8a30, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  const blastGeo = new THREE.SphereGeometry(1, 12, 8);
  disposables.push(ringGeo, ringMat, blastMat, blastGeo);
  const bombs = [];
  let bombClock = 2;

  let flash = 0,
    flashClock = 5;
  const api = {
    get id() {
      return ev?.id || null;
    },
    /** How far away others notice you (×) and how fast you get hungry (×) right now. */
    get notice() {
      return ev ? EVENTS[ev.id].notice : 1;
    },
    get hunger() {
      return ev ? EVENTS[ev.id].hunger : 1;
    },
    meteorite: null, // { x, z, mesh } once one has landed
    start(id, P) {
      if (!EVENTS[id] || ev?.id === id) return;
      if (ev) api.stop(true);
      const e = EVENTS[id];
      ev = { id, t: eventLength(id) };
      chip.hidden = false;
      chip.innerHTML = `<span aria-hidden="true">${e.icon}</span>${e.name}`;
      tint.className = "chWeatherTint " + id;
      rain.visible = id === "rain" || id === "storm";
      if (e.meteorite) meteoriteDue = 12 + Math.random() * 10;
      flashClock = 3 + Math.random() * 4;
      o.toast(e.icon + " " + e.tip, 5);
      if (P) for (const d of drops) (d.x = P.pos.x + (Math.random() - 0.5) * 60), (d.z = P.pos.z + (Math.random() - 0.5) * 60);
    },
    stop(quiet = false) {
      if (!ev) return;
      const e = EVENTS[ev.id];
      ev = null;
      chip.hidden = true;
      tint.className = "chWeatherTint";
      rain.visible = false;
      streaks.splice(0).forEach((s) => (o.scene.remove(s.line), s.geo.dispose()));
      bombs.splice(0).forEach((b) => o.scene.remove(b.ring, b.blast));
      if (!quiet) o.toast(e.icon + " The " + e.name.toLowerCase() + " has passed.", 2.5);
      clock = nextEventIn();
    },
    /** Pick up the meteorite (the stage calls this when you reach it). */
    takeMeteorite() {
      if (!api.meteorite) return;
      o.scene.remove(api.meteorite.mesh);
      api.meteorite = null;
    },
    update(dt, P, isNight) {
      // Schedule.
      if (!ev) {
        if ((clock -= dt) <= 0) {
          const id = pickEvent(o.region, isNight);
          if (id) api.start(id, P);
          else clock = nextEventIn();
        }
      } else if ((ev.t -= dt) <= 0 || (EVENTS[ev.id].nightOnly && !isNight) || (EVENTS[ev.id].dayOnly && isNight)) api.stop();
      // Fog eases towards the event's.
      const want = ev ? EVENTS[ev.id].fog : 1;
      fogK += (want - fogK) * Math.min(1, dt * 0.6);
      if (baseFog && fog) {
        fog.near = baseFog.near * fogK;
        fog.far = baseFog.far * fogK;
      }
      if (rain.visible) {
        const pos = rainGeo.attributes.position.array;
        const slant = ev?.id === "storm" ? 0.3 : 0.08;
        drops.forEach((d, i) => {
          d.y -= d.v * dt;
          if (d.y < -2 || Math.abs(d.x - P.pos.x) > 32 || Math.abs(d.z - P.pos.z) > 32) {
            d.x = P.pos.x + (Math.random() - 0.5) * 60;
            d.z = P.pos.z + (Math.random() - 0.5) * 60;
            d.y = 18 + Math.random() * 14;
          }
          const k = i * 6,
            y = P.pos.y + d.y;
          pos[k] = d.x;
          pos[k + 1] = y;
          pos[k + 2] = d.z;
          pos[k + 3] = d.x - slant;
          pos[k + 4] = y - 1.1;
          pos[k + 5] = d.z;
        });
        rainGeo.attributes.position.needsUpdate = true;
      }
      // Lightning.
      if (ev?.id === "storm" && (flashClock -= dt) <= 0) {
        flashClock = 6 + Math.random() * 8;
        if (!o.reducedMotion) flash = 0.22;
        setTimeout(() => o.sfx("roar", { pitch: 0.35, gain: 0.35 }), 500 + Math.random() * 900);
      }
      flash = Math.max(0, flash - dt);
      tint.classList.toggle("flash", flash > 0);
      // Meteor streaks, and the one that lands.
      if (ev?.id === "meteors") {
        if (Math.random() < dt * 2.2) {
          const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(-6, -2.2, 3)]);
          const line = new THREE.Line(geo, streakMat);
          const a = Math.random() * Math.PI * 2;
          line.position.set(P.pos.x + Math.cos(a) * 60, P.pos.y + 55 + Math.random() * 20, P.pos.z + Math.sin(a) * 60);
          o.scene.add(line);
          streaks.push({ line, geo, t: 1.4, v: new THREE.Vector3(-40, -15, 20) });
        }
        if (meteoriteDue > 0 && (meteoriteDue -= dt) <= 0 && !api.meteorite) {
          const a = Math.random() * Math.PI * 2,
            r = 18 + Math.random() * 14;
          const x = P.pos.x + Math.cos(a) * r,
            z = P.pos.z + Math.sin(a) * r;
          const mesh = new THREE.Mesh(rockGeo, rockMat);
          mesh.position.set(x, heightAt(x, z) + 0.5, z);
          o.scene.add(mesh);
          api.meteorite = { x, z, mesh };
          o.sfx("charge", { pitch: 0.5 });
          o.toast("☄ A meteorite crashed nearby! Find the glowing rock to dig out what it holds.", 5);
          o.onMeteorite(x, z);
        }
      }
      for (let i = streaks.length - 1; i >= 0; i--) {
        const s = streaks[i];
        s.line.position.addScaledVector(s.v, dt);
        if ((s.t -= dt) <= 0) {
          o.scene.remove(s.line);
          s.geo.dispose();
          streaks.splice(i, 1);
        }
      }
      if (api.meteorite) api.meteorite.mesh.rotation.y += dt * 0.6;
      // Lava bombs.
      if (ev?.id === "eruption" && (bombClock -= dt) <= 0) {
        bombClock = 1.6 + Math.random() * 1.6;
        const a = Math.random() * Math.PI * 2,
          r = Math.random() * 11;
        const x = P.pos.x + Math.cos(a) * r,
          z = P.pos.z + Math.sin(a) * r;
        const ring = new THREE.Mesh(ringGeo, ringMat.clone());
        ring.position.set(x, heightAt(x, z) + 0.12, z);
        const blast = new THREE.Mesh(blastGeo, blastMat.clone());
        blast.position.copy(ring.position);
        blast.visible = false;
        o.scene.add(ring, blast);
        bombs.push({ x, z, ring, blast, t: 1.5, boom: 0 });
      }
      for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        if (b.t > 0) {
          b.t -= dt;
          b.ring.material.opacity = 0.4 + 0.5 * Math.abs(Math.sin(b.t * 9));
          if (b.t <= 0) {
            b.blast.visible = true;
            b.ring.visible = false;
            b.boom = 0.5;
            const dmg = bombDamage(Math.hypot(P.pos.x - b.x, P.pos.z - b.z));
            if (dmg) o.onBomb(dmg);
            o.sfx("damage", { gain: 0.5, pitch: 0.6 });
          }
        } else if ((b.boom -= dt) > 0) {
          b.blast.scale.setScalar(0.8 + (0.5 - b.boom) * 2.6);
          b.blast.material.opacity = b.boom * 1.2;
        } else {
          o.scene.remove(b.ring, b.blast);
          b.ring.material.dispose();
          b.blast.material.dispose();
          bombs.splice(i, 1);
        }
      }
    },
    dispose() {
      api.stop(true);
      if (api.meteorite) api.takeMeteorite();
      o.scene.remove(rain);
      disposables.forEach((d) => d.dispose());
      chip.remove();
      tint.remove();
    },
  };
  return api;
}

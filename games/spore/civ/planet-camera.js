/**
 * The planet camera: orbit, pan, rotate and zoom on a sphere without ever losing which way is up.
 *
 * The view is a point on the planet (the focus) and a heading. Both live in one quaternion, the local
 * frame at the focus: east, up, south. Panning rotates that frame about the planet's centre (so the
 * heading is carried along like a car on a globe, with no poles to trip over), rotating spins it about
 * the focus, and zooming changes the distance. Every control only moves a *target*; the camera eases
 * toward it, so no input ever jerks the view.
 *
 * Zoomed in, the camera looks at the ground at an angle, like an RTS; zoomed out, it rises and tilts
 * straight down until the whole planet fits, turning it into a globe you can spin.
 */
import * as THREE from "three";
import { PLANET, mapToLonLat, lonLatToMap, unitVector } from "./planet-map.js";

const { R } = PLANET;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export const ZOOM = { min: 38, max: 600, city: 70, region: 200, globe: 580 };
const MAX_PITCH = (50 * Math.PI) / 180;

const X = new THREE.Vector3(1, 0, 0),
  Y = new THREE.Vector3(0, 1, 0),
  Zv = new THREE.Vector3(0, 0, 1);
const tmpA = new THREE.Vector3(),
  tmpB = new THREE.Vector3(),
  tmpC = new THREE.Vector3(),
  tmpQ = new THREE.Quaternion(),
  tmpM = new THREE.Matrix4();

/** The local frame (east, up, south) at a map point as a quaternion. */
function frameAt(map, x, z, q = new THREE.Quaternion()) {
  const { lon, lat } = mapToLonLat(x, z);
  const cl = Math.cos(lat),
    sl = Math.sin(lat),
    co = Math.cos(lon),
    so = Math.sin(lon);
  const up = tmpA.set(cl * co, sl, -cl * so);
  const east = tmpB.set(-so, 0, -co);
  const south = tmpC.crossVectors(east, up);
  return q.setFromRotationMatrix(tmpM.makeBasis(east, up, south));
}

/**
 * @param {THREE.PerspectiveCamera} camera
 * @param {object} map from createPlanetMap
 * @param {{ x:number, z:number, dist?:number }} start where to look first
 */
export function createPlanetCamera(camera, map, start) {
  const target = { q: frameAt(map, start.x, start.z), dist: start.dist ?? 120 };
  const cur = { q: target.q.clone(), dist: target.dist, h: 0 };
  const vel = new THREE.Vector3(); // pan inertia, as angular velocity (radians a second, world axes)
  let ground = 0;
  const hiddenTest = new THREE.Vector3();

  const focusDir = (q, out) => out.copy(Y).applyQuaternion(q);
  const pitchFor = (dist) => MAX_PITCH * (1 - smooth(110, 430, dist));

  /** Rotate the frame about the planet's centre (world axis) by an angle. */
  function rotateWorld(axis, angle, q) {
    if (Math.abs(angle) < 1e-9) return;
    tmpQ.setFromAxisAngle(axis, angle);
    q.premultiply(tmpQ).normalize();
  }

  const api = {
    /** True while a finger or button is down: no inertia then. */
    holding: false,
    target,
    cur,
    get distance() {
      return cur.dist;
    },
    get pitch() {
      return pitchFor(cur.dist);
    },
    /** The map point under the camera's focus. */
    focusMap() {
      const f = focusDir(cur.q, tmpA);
      const lat = Math.asin(clamp(f.y, -1, 1));
      const lon = Math.atan2(-f.z, f.x);
      return lonLatToMap(lon, lat);
    },
    /** The focus direction (a unit vector). */
    focusVec(out = new THREE.Vector3()) {
      return focusDir(cur.q, out);
    },
    /** Heading of "up the screen" relative to north, radians (0 when north is up). */
    heading() {
      const f = focusDir(cur.q, tmpA);
      // Screen-up is -z in the frame; true north at f is (-sinφ cosλ, cosφ, sinφ sinλ).
      const up = tmpB.set(0, 0, -1).applyQuaternion(cur.q);
      const lat = Math.asin(clamp(f.y, -1, 1)),
        lon = Math.atan2(-f.z, f.x);
      const north = tmpC.set(-Math.sin(lat) * Math.cos(lon), Math.cos(lat), Math.sin(lat) * Math.sin(lon));
      const east = tmpA.set(-Math.sin(lon), 0, -Math.cos(lon));
      return Math.atan2(up.dot(east), up.dot(north));
    },
    /** Slide the view over the surface by pixels of drag (the ground follows the finger). */
    pan(dxPx, dyPx, viewH) {
      const wpp = (2 * cur.dist * Math.tan((camera.fov * Math.PI) / 360)) / viewH;
      const cosP = Math.max(0.55, Math.cos(pitchFor(cur.dist)));
      this.panMetres(-dxPx * wpp, (dyPx * wpp) / cosP);
    },
    /** Slide the view by metres: +x east on the screen, +y towards the top of the screen. */
    panMetres(right, ahead) {
      // Angular move on the surface; clamped so a flick can't throw the planet round.
      const ang = Math.hypot(right, ahead) / (R + 4);
      if (ang < 1e-9) return;
      const limit = 0.5;
      const k = ang > limit ? limit / ang : 1;
      const r = tmpA.set(1, 0, 0).applyQuaternion(target.q);
      const u = tmpB.set(0, 0, -1).applyQuaternion(target.q);
      const f = tmpC.copy(Y).applyQuaternion(target.q);
      const dir = r.multiplyScalar(right * k).addScaledVector(u, ahead * k); // tangent movement
      const axis = new THREE.Vector3().crossVectors(f, dir);
      if (axis.lengthSq() < 1e-14) return;
      axis.normalize();
      rotateWorld(axis, ang * k, target.q);
      vel.copy(axis).multiplyScalar((ang * k) / 0.016);
    },
    /** Spin the view about the focus (positive turns the map clockwise as seen). */
    rotate(angle) {
      const f = focusDir(target.q, tmpA);
      rotateWorld(f.clone(), angle, target.q);
    },
    /** Zoom by a factor (below 1 zooms in); the focus drifts toward `towards` (a unit vector) when zooming in. */
    zoom(factor, towards = null) {
      const before = target.dist;
      target.dist = clamp(target.dist * factor, ZOOM.min, ZOOM.max);
      if (towards && target.dist < before) {
        const f = focusDir(target.q, tmpA);
        const ang = Math.acos(clamp(f.dot(towards), -1, 1));
        if (ang > 1e-4) {
          const axis = new THREE.Vector3().crossVectors(f, towards).normalize();
          rotateWorld(axis, ang * clamp(1 - target.dist / before, 0, 0.5) * 0.9, target.q);
        }
      }
    },
    setDistance(d) {
      target.dist = clamp(d, ZOOM.min, ZOOM.max);
    },
    /** Fly to a map point (keeping the heading), optionally at a zoom level. */
    flyTo(x, z, dist = null) {
      const { lon, lat } = mapToLonLat(x, z);
      const to = new THREE.Vector3(...unitVector(lon, lat));
      const f = focusDir(target.q, tmpA);
      const ang = Math.acos(clamp(f.dot(to), -1, 1));
      if (ang > 1e-6) {
        const axis = new THREE.Vector3().crossVectors(f, to);
        if (axis.lengthSq() > 1e-12) rotateWorld(axis.normalize(), ang, target.q);
      }
      if (dist != null) target.dist = clamp(dist, ZOOM.min, ZOOM.max);
      vel.set(0, 0, 0);
    },
    /** Jump without easing (the first frame). */
    snap() {
      cur.q.copy(target.q);
      cur.dist = target.dist;
    },
    /** Turn north back to the top of the screen. */
    north() {
      const f = focusDir(target.q, tmpA);
      const lat = Math.asin(clamp(f.y, -1, 1)),
        lon = Math.atan2(-f.z, f.x);
      const m = lonLatToMap(lon, lat);
      frameAt(map, m.x, m.z, target.q);
    },
    /** Zoom out to the whole planet. */
    globe() {
      target.dist = ZOOM.globe;
    },
    /** Ease toward the target and place the camera. Call every frame. */
    update(dt) {
      const k = 1 - Math.exp(-dt * 9);
      cur.q.slerp(target.q, k);
      cur.dist += (target.dist - cur.dist) * (1 - Math.exp(-dt * 8));
      // Inertia after a drag: keep gliding a little in the direction last moved, then settle.
      if (!api.holding && vel.lengthSq() > 1e-8) {
        const ang = vel.length() * dt;
        if (ang > 1e-5) rotateWorld(vel.clone().normalize(), ang * 0.35, target.q);
        vel.multiplyScalar(Math.exp(-dt * 7));
      }
      // Never fall out of sync by more than a turn of the planet.
      const f = focusDir(cur.q, tmpA);
      const lat = Math.asin(clamp(f.y, -1, 1)),
        lon = Math.atan2(-f.z, f.x);
      const m = lonLatToMap(lon, lat);
      const gh = Math.max(0, map.heightAt(m.x, m.z));
      ground += (gh - ground) * (1 - Math.exp(-dt * 6));
      cur.h = ground;
      const pitch = pitchFor(cur.dist);
      const focus = tmpB.copy(f).multiplyScalar(R + ground);
      const u = tmpC.set(0, 0, -1).applyQuaternion(cur.q);
      const pos = camera.position.copy(focus).addScaledVector(f, Math.cos(pitch) * cur.dist).addScaledVector(u, -Math.sin(pitch) * cur.dist);
      camera.up.copy(u);
      camera.lookAt(focus);
      // Near and far follow the zoom: close in we need fine depth, far out the whole planet and its sky.
      camera.near = clamp(cur.dist * 0.03, 0.5, 14);
      camera.far = 3600;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      return pos;
    },
    /**
     * The map point under a screen pixel, or null for sky. Intersects the sphere at sea level, then
     * refines against the terrain (mountains stand well above it).
     */
    groundAt(px, py, viewW, viewH, out = {}) {
      const ndc = tmpA.set((px / viewW) * 2 - 1, -(py / viewH) * 2 + 1, 0.5).unproject(camera);
      const dir = ndc.sub(camera.position).normalize();
      const o = camera.position;
      let r = R,
        hit = null;
      for (let it = 0; it < 4; it++) {
        const b = o.dot(dir);
        const c = o.lengthSq() - r * r;
        const disc = b * b - c;
        if (disc < 0) return null;
        const t = -b - Math.sqrt(disc);
        if (t < 0) return null;
        hit = tmpB.copy(dir).multiplyScalar(t).add(o);
        const lat = Math.asin(clamp(hit.y / hit.length(), -1, 1)),
          lon = Math.atan2(-hit.z, hit.x);
        const m = lonLatToMap(lon, lat);
        r = R + Math.max(0, map.heightAt(m.x, m.z));
        out.x = m.x;
        out.z = m.z;
      }
      out.lon = mapToLonLat(out.x, out.z).lon;
      return out;
    },
    /**
     * Screen position of a world point, and whether it is on screen and on the near side of the planet.
     * @returns {{x:number,y:number,on:boolean}}
     */
    project(world, viewW, viewH, out = {}) {
      tmpA.copy(world).project(camera);
      out.x = ((tmpA.x + 1) / 2) * viewW;
      out.y = ((1 - tmpA.y) / 2) * viewH;
      // Behind the horizon: the line from the camera to the point must not pass through the planet.
      const o = camera.position;
      const d = tmpB.copy(world).sub(o);
      const len = d.length();
      d.divideScalar(len);
      const b = o.dot(d);
      const closest = o.lengthSq() - b * b; // squared distance of the line from the centre
      const hidden = closest < (R - 1) * (R - 1) && -b > 0 && -b < len - 1;
      out.on = tmpA.z < 1 && tmpA.x > -1.1 && tmpA.x < 1.1 && tmpA.y > -1.1 && tmpA.y < 1.1 && !hidden;
      return out;
    },
    /** Is a world point hidden behind the planet's limb? */
    occluded(world) {
      const o = camera.position;
      const d = hiddenTest.copy(world).sub(o);
      const len = d.length();
      d.divideScalar(len || 1);
      const b = o.dot(d);
      const closest = o.lengthSq() - b * b;
      return closest < (R - 1) * (R - 1) && -b > 0 && -b < len - 1;
    },
    /** A direction for the star: over the viewer's shoulder, so the area in view is always lit. */
    sunDir(out = new THREE.Vector3()) {
      const f = focusDir(cur.q, tmpA);
      const r = tmpB.copy(X).applyQuaternion(cur.q);
      const u = tmpC.copy(Zv).applyQuaternion(cur.q).negate();
      return out.copy(f).addScaledVector(r, -0.55).addScaledVector(u, -0.25).normalize();
    },
  };
  return api;
}

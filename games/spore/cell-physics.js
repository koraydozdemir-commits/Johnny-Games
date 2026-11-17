/**
 * Cell Stage physics: circle collisions between cells and heading-based steering.
 *
 * Pure math on plain {x, y} objects, so it is testable in Node and has no THREE dependency.
 * Cells are approximated as circles; mass grows with area, so a big cell shoulders a small one aside.
 */

const TAU = Math.PI * 2;
export const wrapAngle = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

/**
 * Push overlapping circles apart and exchange momentum along the contact normal.
 * @param {Array<{pos:{x:number,y:number}, vel:{x:number,y:number}, r:number, mass:number, fixed?:boolean, onHit?:(other:object, speed:number)=>void}>} bodies
 * @param {number} restitution 0 = cells stop dead on contact, 1 = perfectly bouncy
 * @returns {number} contacts resolved
 */
export function resolveCollisions(bodies, restitution = 0.25) {
  if (bodies.length < 2) return 0;
  // Spatial hash keyed by cell size of the biggest diameter keeps this near O(n).
  let maxR = 0;
  for (const b of bodies) maxR = Math.max(maxR, b.r + (b.half || 0));
  const cell = Math.max(0.5, maxR * 2);
  const grid = new Map();
  bodies.forEach((b, i) => {
    const key = Math.floor(b.pos.x / cell) + "," + Math.floor(b.pos.y / cell);
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push(i);
  });
  let contacts = 0;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    const cx = Math.floor(a.pos.x / cell),
      cy = Math.floor(a.pos.y / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const list = grid.get(gx + "," + gy);
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const b = bodies[j];
          if (a.fixed && b.fixed) continue;
          // Capsule bodies collide along their whole length, not just at their centres.
          let dx, dy;
          if (a.half || b.half) {
            const [a0x, a0y, a1x, a1y] = capsuleEnds(a),
              [b0x, b0y, b1x, b1y] = capsuleEnds(b);
            const [pax, pay, pbx, pby] = closestSegSeg(a0x, a0y, a1x, a1y, b0x, b0y, b1x, b1y);
            dx = pbx - pax;
            dy = pby - pay;
          } else {
            dx = b.pos.x - a.pos.x;
            dy = b.pos.y - a.pos.y;
          }
          const minD = a.r + b.r;
          let d2 = dx * dx + dy * dy;
          if (d2 >= minD * minD) continue;
          if (d2 < 1e-8) {
            // Exactly on top of each other: separate along an arbitrary but stable direction.
            dx = Math.cos(i * 2.399);
            dy = Math.sin(i * 2.399);
            d2 = 1;
          }
          const d = Math.sqrt(d2),
            nx = dx / d,
            ny = dy / d,
            overlap = minD - Math.min(d, minD);
          const ia = a.fixed ? 0 : 1 / a.mass,
            ib = b.fixed ? 0 : 1 / b.mass,
            total = ia + ib;
          if (!total) continue;
          // Positional correction, shared by inverse mass.
          a.pos.x -= nx * overlap * (ia / total);
          a.pos.y -= ny * overlap * (ia / total);
          b.pos.x += nx * overlap * (ib / total);
          b.pos.y += ny * overlap * (ib / total);
          // Velocity impulse only if they are moving into each other.
          const rel = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny;
          if (rel < 0) {
            const jImpulse = (-(1 + restitution) * rel) / total;
            a.vel.x -= jImpulse * ia * nx;
            a.vel.y -= jImpulse * ia * ny;
            b.vel.x += jImpulse * ib * nx;
            b.vel.y += jImpulse * ib * ny;
            const speed = -rel;
            a.onHit?.(b, speed);
            b.onHit?.(a, speed);
          }
          contacts++;
        }
      }
  }
  return contacts;
}

/**
 * Turn toward a desired acceleration and thrust along the heading, like a swimming cell: it cannot
 * strafe, so changes of direction are arcs and a cell facing away has to turn before it accelerates.
 * @param {{x:number,y:number}} vel  velocity, updated in place
 * @param {number} heading current facing (radians)
 * @param {number} ax desired acceleration x (units/s²)
 * @param {number} ay desired acceleration y
 * @param {number} dt
 * @param {{turnRate:number, stroke?:number, lateral?:number}} o  stroke scales thrust for burst-and-glide
 * @returns {number} the new heading
 */
export function steerHeading(vel, heading, ax, ay, dt, o) {
  const want = Math.hypot(ax, ay);
  if (want < 1e-5) return heading;
  const delta = wrapAngle(Math.atan2(ay, ax) - heading);
  const turn = Math.max(-o.turnRate * dt, Math.min(o.turnRate * dt, delta));
  const h = heading + turn;
  const facing = Math.max(0, Math.cos(delta - turn));
  const thrust = want * (0.2 + 0.8 * facing) * (o.stroke ?? 1);
  vel.x += Math.cos(h) * thrust * dt + ax * (o.lateral ?? 0.12) * dt;
  vel.y += Math.sin(h) * thrust * dt + ay * (o.lateral ?? 0.12) * dt;
  return h;
}

/** Burst-and-glide flagellum stroke: a smooth pulse averaging about 1. */
export const strokePulse = (phase) => 0.45 + 1.1 * Math.pow(Math.max(0, Math.sin(phase)), 2);

/** Where to aim to intercept a moving target (simple lead, capped so it never overshoots wildly). */
export function leadTarget(from, target, targetVel, ownSpeed, maxLead = 1.2) {
  const d = Math.hypot(target.x - from.x, target.y - from.y);
  const t = Math.min(maxLead, d / Math.max(0.5, ownSpeed));
  return { x: target.x + targetVel.x * t, y: target.y + targetVel.y * t };
}

/* ---- Capsule hitboxes ---------------------------------------------------------
   Cells are long ovals, so a circle at the centre misses their ends. A capsule (a segment along the
   body with a radius) covers the whole cell: half = half the segment length, r = the cell's half-width. */

/** Ends of a capsule's core segment. */
export function capsuleEnds(c) {
  const cos = Math.cos(c.angle || 0),
    sin = Math.sin(c.angle || 0),
    off = c.off || 0, // the body's centre may sit ahead of or behind its origin
    h = c.half || 0;
  const cx = c.pos.x + cos * off,
    cy = c.pos.y + sin * off;
  return [cx - cos * h, cy - sin * h, cx + cos * h, cy + sin * h];
}

/** Closest points between segments p1-q1 and p2-q2 (2D). Returns the two points. */
export function closestSegSeg(p1x, p1y, q1x, q1y, p2x, p2y, q2x, q2y) {
  const d1x = q1x - p1x,
    d1y = q1y - p1y,
    d2x = q2x - p2x,
    d2y = q2y - p2y,
    rx = p1x - p2x,
    ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y,
    e = d2x * d2x + d2y * d2y,
    f = d2x * rx + d2y * ry;
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) {
    s = t = 0;
  } else if (a <= 1e-9) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= 1e-9) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1x * d2x + d1y * d2y,
        denom = a * e - b * b;
      s = denom > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  return [p1x + d1x * s, p1y + d1y * s, p2x + d2x * t, p2y + d2y * t];
}

/** Gap between two capsules' surfaces: negative when they overlap. */
export function capsuleGap(A, B) {
  const [a0x, a0y, a1x, a1y] = capsuleEnds(A),
    [b0x, b0y, b1x, b1y] = capsuleEnds(B);
  const [pax, pay, pbx, pby] = closestSegSeg(a0x, a0y, a1x, a1y, b0x, b0y, b1x, b1y);
  return Math.hypot(pbx - pax, pby - pay) - A.r - B.r;
}

/** Gap between a point and a capsule's surface: negative when the point is inside the cell. */
export function pointCapsuleGap(px, py, C) {
  const [ax, ay, bx, by] = capsuleEnds(C);
  const dx = bx - ax,
    dy = by - ay,
    len2 = dx * dx + dy * dy;
  const t = len2 > 1e-9 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) - C.r;
}

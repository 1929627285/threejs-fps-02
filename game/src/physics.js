// Shared movement and visibility math: one axis-separated box mover used by the
// player and every bot, and a segment-vs-box test for line of sight. No
// allocations in the hot path: the probes are module-level scratch objects.
import * as THREE from 'three';

const probe = new THREE.Box3();
const EPS = 0.001;

function overlapsBox(x, y, z, radius, height, lift, colliders) {
  probe.min.set(x - radius, y + lift, z - radius);
  probe.max.set(x + radius, y + height - lift, z + radius);
  for (let i = 0; i < colliders.length; i += 1) {
    if (probe.intersectsBox(colliders[i])) return colliders[i];
  }
  return null;
}

// Moves a feet-anchored box: X, then Z, then Y with ground snap. Mutates pos
// and vel in place and returns whether the body is grounded. Walls stop one
// axis without swallowing the body, so sliding along a wall works.
export function moveBody(pos, vel, radius, height, colliders, dt) {
  let hitWall = false;
  const nextX = pos.x + vel.x * dt;
  if (!overlapsBox(nextX, pos.y, pos.z, radius, height, 0.04, colliders)) {
    pos.x = nextX;
  } else {
    vel.x = 0;
    hitWall = true;
  }
  const nextZ = pos.z + vel.z * dt;
  if (!overlapsBox(pos.x, pos.y, nextZ, radius, height, 0.04, colliders)) {
    pos.z = nextZ;
  } else {
    vel.z = 0;
    hitWall = true;
  }
  pos.y += vel.y * dt;
  let onGround = false;
  const hit = overlapsBox(pos.x, pos.y, pos.z, radius, height, 0, colliders);
  if (hit) {
    if (vel.y <= 0) {
      pos.y = hit.max.y;
      vel.y = 0;
      onGround = true;
    } else {
      pos.y = hit.min.y - height;
      vel.y = 0;
    }
  }
  if (pos.y <= 0) {
    pos.y = 0;
    vel.y = 0;
    onGround = true;
  }
  return { onGround, hitWall };
}

// True when the segment from a to b crosses any collider: the line-of-sight
// test for bot vision and grenade damage. Slab method, no raycaster.
export function segmentBlocked(a, b, colliders) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  for (let i = 0; i < colliders.length; i += 1) {
    const box = colliders[i];
    let tmin = 0;
    let tmax = 1;
    let ok = true;
    if (Math.abs(dx) < EPS) {
      if (a.x < box.min.x || a.x > box.max.x) ok = false;
    } else {
      let t1 = (box.min.x - a.x) / dx;
      let t2 = (box.max.x - a.x) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) ok = false;
    }
    if (ok) {
      if (Math.abs(dy) < EPS) {
        if (a.y < box.min.y || a.y > box.max.y) ok = false;
      } else {
        let t1 = (box.min.y - a.y) / dy;
        let t2 = (box.max.y - a.y) / dy;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) ok = false;
      }
    }
    if (ok) {
      if (Math.abs(dz) < EPS) {
        if (a.z < box.min.z || a.z > box.max.z) ok = false;
      } else {
        let t1 = (box.min.z - a.z) / dz;
        let t2 = (box.max.z - a.z) / dz;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) ok = false;
      }
    }
    if (ok) return true;
  }
  return false;
}

// Point-in-expanded-box test for grenade bounces: returns the axis of the
// shallowest penetration, or null when the point is clear.
export function pointBoxAxis(p, radius, colliders) {
  for (let i = 0; i < colliders.length; i += 1) {
    const box = colliders[i];
    if (
      p.x > box.min.x - radius && p.x < box.max.x + radius &&
      p.y > box.min.y - radius && p.y < box.max.y + radius &&
      p.z > box.min.z - radius && p.z < box.max.z + radius
    ) {
      const dxl = p.x - (box.min.x - radius);
      const dxr = (box.max.x + radius) - p.x;
      const dyl = p.y - (box.min.y - radius);
      const dyr = (box.max.y + radius) - p.y;
      const dzl = p.z - (box.min.z - radius);
      const dzr = (box.max.z + radius) - p.z;
      const m = Math.min(dxl, dxr, dyl, dyr, dzl, dzr);
      if (m === dxl || m === dxr) return { axis: 'x', box, push: m === dxl ? -1 : 1 };
      if (m === dyl || m === dyr) return { axis: 'y', box, push: m === dyl ? -1 : 1 };
      return { axis: 'z', box, push: m === dzl ? -1 : 1 };
    }
  }
  return null;
}

export function boxCollider(cx, cz, w, d, h, y0 = 0) {
  return new THREE.Box3(
    new THREE.Vector3(cx - w / 2, y0, cz - d / 2),
    new THREE.Vector3(cx + w / 2, y0 + h, cz + d / 2),
  );
}

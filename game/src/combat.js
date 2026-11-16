// Hitscan resolution, shared by the player and the bots: one raycast against
// the world and every actor's part meshes, damage falloff with distance,
// headshot multipliers, armor, tracers, impacts and the events the HUD and
// the bots' hearing consume. The raycaster and its scratch vectors are reused.
import * as THREE from 'three';

const raycaster = new THREE.Raycaster();
const muzzle = new THREE.Vector3();
const right = new THREE.Vector3();
const endPoint = new THREE.Vector3();

export function fireHitscan(ctx, shooter, origin, dir, shot) {
  const def = shot;
  raycaster.set(origin, dir);
  raycaster.far = def.range;
  const hits = raycaster.intersectObjects(ctx.hitTargets, false);
  let hit = null;
  for (const candidate of hits) {
    const actor = candidate.object.userData.actor;
    if (actor) {
      if (actor === shooter || !actor.alive) continue;
      hit = candidate;
      break;
    }
    hit = candidate;
    break;
  }
  // Muzzle point for the tracer: just ahead of and below the shooter's eye.
  right.set(Math.cos(shooter.yaw), 0, -Math.sin(shooter.yaw));
  muzzle.copy(origin).addScaledVector(dir, 0.6).addScaledVector(right, 0.14);
  muzzle.y -= 0.12;
  if (hit) {
    endPoint.copy(hit.point);
    ctx.effects.spawnTracer(muzzle, endPoint, shooter.isPlayer);
    const actor = hit.object.userData.actor;
    if (actor) {
      const dist = hit.distance;
      const falloff = 1 - 0.35 * Math.max(0, Math.min(1, (dist - 12) / def.range));
      let damage = def.damage * falloff;
      const isHead = hit.object.userData.part === 'head';
      if (isHead) damage *= def.headMult;
      // Armor is applied once, in match.damageActor, for every damage source.
      ctx.effects.blood(hit.point);
      ctx.damageActor(actor, Math.round(damage), isHead ? 'head' : hit.object.userData.part, shooter);
      if (shooter.isPlayer) ctx.events.push({ kind: 'hitmark', kill: !actor.alive });
    } else {
      ctx.effects.impact(hit.point, hit.face ? hit.face.normal : null);
    }
  } else {
    endPoint.copy(origin).addScaledVector(dir, def.range);
    ctx.effects.spawnTracer(muzzle, endPoint, shooter.isPlayer);
  }
  ctx.events.push({ kind: 'gunshot', pos: origin, shooter, loud: def.damage >= 100 });
  return hit;
}

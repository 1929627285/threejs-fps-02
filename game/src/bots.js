// Bot intelligence: waypoint routes, vision cones, hearing, and a small state
// machine (advance, hold, engage, plant, defuse, hunt). Bots use the same
// weapons, physics and damage as the player, with reaction times and aim
// error scaled by skill, so stopping to aim beats them and rushing does not.
import * as THREE from 'three';
import { WAYPOINTS, ADJACENT, HOLD_SPOTS, SITES } from './map.js';
import { moveBody, segmentBlocked } from './physics.js';
import { eyeOf, syncActor, ACTOR_RADIUS, STAND_HEIGHT, CROUCH_HEIGHT } from './actors.js';
import { fireHitscan } from './combat.js';
import { range, chance, shuffle } from './rng.js';

const _eye = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _prev = new Int32Array(WAYPOINTS.length);
const _queue = new Int32Array(WAYPOINTS.length);

export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    const dx = WAYPOINTS[i][0] - x;
    const dz = WAYPOINTS[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Breadth-first path over the waypoint graph. Writes node indices into out.
export function findPath(from, to, out) {
  out.length = 0;
  if (from === to) return out;
  _prev.fill(-1);
  let head = 0;
  let tail = 0;
  _queue[tail] = from;
  tail += 1;
  _prev[from] = from;
  while (head < tail) {
    const node = _queue[head];
    head += 1;
    if (node === to) break;
    const next = ADJACENT[node];
    for (let i = 0; i < next.length; i += 1) {
      if (_prev[next[i]] === -1) {
        _prev[next[i]] = node;
        _queue[tail] = next[i];
        tail += 1;
      }
    }
  }
  if (_prev[to] === -1) return out;
  let node = to;
  const rev = [];
  while (node !== from) {
    rev.push(node);
    node = _prev[node];
  }
  for (let i = rev.length - 1; i >= 0; i -= 1) out.push(rev[i]);
  return out;
}

export function createBot(actor, skill) {
  actor.bot = {
    skill,
    role: actor.team === 'atk' ? 'attack' : 'defend',
    site: null,
    holdIndex: -1,
    state: 'wait',
    path: [],
    pathIndex: 0,
    target: null,
    lastKnown: new THREE.Vector3(),
    lastKnownAt: -99,
    seenAt: -99,
    reactionAt: 0,
    burstLeft: 0,
    nextBurstAt: 0,
    strafeDir: 1,
    strafeUntil: 0,
    perceiveAt: 0,
    repathAt: 0,
    stuckSince: 0,
    stuckPos: new THREE.Vector3(),
    scanPhase: range(0, Math.PI * 2),
    planting: false,
    defusing: false,
    thrownGrenade: false,
    lookUntil: 0,
  };
  return actor.bot;
}

// Round-start assignments: attackers split 3/2 across the sites, defenders
// take the five hold spots. Shuffled, so no two rounds play the same.
export function assignRoles(actors) {
  const attackers = actors.filter((a) => a.team === 'atk' && !a.isPlayer);
  const defenders = actors.filter((a) => a.team === 'def');
  shuffle(attackers);
  const mainSite = chance(0.5) ? 'A' : 'B';
  attackers.forEach((actor, i) => {
    actor.bot.site = i < 3 ? mainSite : mainSite === 'A' ? 'B' : 'A';
    actor.bot.state = 'wait';
  });
  shuffle(defenders);
  defenders.forEach((actor, i) => {
    actor.bot.holdIndex = i % HOLD_SPOTS.length;
    actor.bot.site = i < 2 ? 'A' : i < 4 ? 'B' : null;
    actor.bot.state = 'wait';
  });
}

function setDestination(bot, actor, node) {
  const from = nearestNode(actor.pos.x, actor.pos.z);
  findPath(from, node, bot.path);
  bot.pathIndex = 0;
}

function destinationFor(bot) {
  if (bot.role === 'attack') {
    const site = SITES[bot.site ?? 'A'];
    return nearestNode(site.x, site.z);
  }
  return HOLD_SPOTS[bot.holdIndex].node;
}

function canSee(actor, enemy, colliders) {
  eyeOf(actor, _eye);
  _chest.set(enemy.pos.x, enemy.pos.y + 1.2, enemy.pos.z);
  _to.subVectors(_chest, _eye);
  const dist = _to.length();
  // Vision ends at 32 m: beyond that the cross-map lanes would open duels
  // neither side can win, and the round would stall on pot-shots.
  if (dist > 32) return false;
  if (dist > 5) {
    _to.normalize();
    const fx = -Math.sin(actor.yaw);
    const fz = -Math.cos(actor.yaw);
    if (fx * _to.x + fz * _to.z < 0.45) return false;
  }
  return !segmentBlocked(_eye, _chest, colliders);
}

function perceive(bot, actor, ctx) {
  const now = ctx.now;
  if (now < bot.perceiveAt) return;
  bot.perceiveAt = now + 0.12 + (actor.id % 5) * 0.02;
  let best = null;
  let bestD = Infinity;
  for (const enemy of ctx.actors) {
    if (enemy.team === actor.team || !enemy.alive) continue;
    const d = enemy.pos.distanceToSquared(actor.pos);
    if (d < bestD && canSee(actor, enemy, ctx.colliders)) {
      best = enemy;
      bestD = d;
    }
  }
  if (best) {
    if (bot.target !== best) {
      bot.reactionAt = now + (0.55 - bot.skill * 0.3) + range(0, 0.15);
      bot.seenAt = now;
    }
    bot.target = best;
    bot.lastKnown.copy(best.pos);
    bot.lastKnownAt = now;
    if (bot.state !== 'engage' && bot.state !== 'plant' && bot.state !== 'defuse') bot.state = 'engage';
  } else if (bot.target && now - bot.lastKnownAt > 2.5) {
    bot.target = null;
  }
  // Hearing: a nearby enemy gunshot gives a position to investigate.
  for (const evt of ctx.events) {
    if (evt.kind !== 'gunshot' || evt.shooter.team === actor.team) continue;
    if (evt.pos.distanceToSquared(actor.pos) > 26 * 26) continue;
    if (!bot.target) {
      bot.lastKnown.copy(evt.pos);
      bot.lastKnownAt = now;
      if (bot.state === 'hold') bot.state = 'hunt';
    }
  }
}

function turnToward(actor, yawTarget, pitchTarget, maxRate, dt) {
  let dyaw = yawTarget - actor.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  const step = Math.max(-maxRate * dt, Math.min(maxRate * dt, dyaw));
  actor.yaw += step;
  const dpitch = pitchTarget - actor.pitch;
  actor.pitch += Math.max(-maxRate * dt, Math.min(maxRate * dt, dpitch));
  return Math.abs(dyaw) + Math.abs(dpitch);
}

function moveToward(actor, x, z, speed, dt, ctx, faceYaw) {
  const dx = x - actor.pos.x;
  const dz = z - actor.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.01) return 0;
  const wishX = (dx / dist) * speed;
  const wishZ = (dz / dist) * speed;
  const blend = Math.min(1, 10 * dt);
  actor.vel.x += (wishX - actor.vel.x) * blend;
  actor.vel.z += (wishZ - actor.vel.z) * blend;
  actor.vel.y -= 20 * dt;
  const ground = moveBody(actor.pos, actor.vel, ACTOR_RADIUS, actor.height, ctx.colliders, dt);
  actor.onGround = ground.onGround;
  if (faceYaw === undefined) {
    turnToward(actor, Math.atan2(-dx, -dz), 0, 6, dt);
  }
  return dist;
}

function stopMoving(actor, dt, ctx) {
  const damp = Math.max(0, 1 - 9 * dt);
  actor.vel.x *= damp;
  actor.vel.z *= damp;
  actor.vel.y -= 20 * dt;
  const ground = moveBody(actor.pos, actor.vel, ACTOR_RADIUS, actor.height, ctx.colliders, dt);
  actor.onGround = ground.onGround;
}

function aimErrorFor(bot, actor) {
  const speed = Math.hypot(actor.vel.x, actor.vel.z);
  return 0.012 + (1 - bot.skill) * 0.045 + Math.min(0.03, speed * 0.005);
}

function shootAt(bot, actor, ctx) {
  const now = ctx.now;
  const target = bot.target;
  if (!target || now < bot.reactionAt) return;
  if (bot.burstLeft <= 0) {
    if (now < bot.nextBurstAt) return;
    bot.burstLeft = 3 + Math.floor(bot.skill * 3);
  }
  const loadout = actor.loadout;
  const speed = Math.hypot(actor.vel.x, actor.vel.z);
  // Every bot shot is a fresh trigger pull: semi-auto weapons (the sidearm,
  // the marksman rifle) refuse to fire twice without a release, and a bot
  // that never releases would fire exactly once and stay disarmed.
  loadout.releaseTrigger();
  const shot = loadout.pull(now, speed, actor.crouching, false);
  if (!shot) {
    if (loadout.state.mag[loadout.state.current] === 0) loadout.startReload(now);
    return;
  }
  if (shot.dry) return;
  bot.burstLeft -= 1;
  if (bot.burstLeft <= 0) bot.nextBurstAt = now + range(0.35, 0.7) - bot.skill * 0.15;
  eyeOf(actor, _eye);
  _chest.set(target.pos.x, target.pos.y + (chance(0.3) ? 1.55 : 1.2), target.pos.z);
  _dir.subVectors(_chest, _eye).normalize();
  const err = aimErrorFor(bot, actor);
  _dir.x += range(-err, err);
  _dir.y += range(-err, err);
  _dir.z += range(-err, err);
  _dir.normalize();
  fireHitscan(ctx, actor, _eye, _dir, shot);
}

function followPath(bot, actor, dt, ctx, speed) {
  if (bot.pathIndex >= bot.path.length) return true;
  const node = WAYPOINTS[bot.path[bot.pathIndex]];
  const dist = moveToward(actor, node[0], node[1], speed, dt, ctx);
  if (dist < 1.3) bot.pathIndex += 1;
  // Stuck: no progress for a while means the route is blocked; skip ahead.
  if (actor.pos.distanceToSquared(bot.stuckPos) > 0.09) {
    bot.stuckPos.copy(actor.pos);
    bot.stuckSince = ctx.now;
  } else if (ctx.now - bot.stuckSince > 1.4) {
    bot.pathIndex += 1;
    bot.stuckSince = ctx.now;
    bot.stuckPos.copy(actor.pos);
  }
  return bot.pathIndex >= bot.path.length;
}

export function stepBot(bot, actor, dt, ctx) {
  if (!actor.alive) return;
  const now = ctx.now;
  const match = ctx.match;
  actor.loadout.step(now, dt, Math.hypot(actor.vel.x, actor.vel.z) > 0.5);
  perceive(bot, actor, ctx);
  bot.planting = false;
  bot.defusing = false;

  if (match.phase !== 'live') {
    stopMoving(actor, dt, ctx);
    return;
  }

  // The bomb rewrites defender priorities: race the plant, defuse when close.
  if (bot.role === 'defend' && match.bomb.state === 'planted' && bot.state !== 'engage') {
    const bombNode = nearestNode(match.bomb.pos.x, match.bomb.pos.z);
    if (bot.state !== 'defuse' && bot.state !== 'hunt') {
      setDestination(bot, actor, bombNode);
      bot.state = 'hunt';
    }
    if (bot.state === 'hunt' && actor.pos.distanceTo(match.bomb.pos) < 2.2) bot.state = 'defuse';
  }

  switch (bot.state) {
    case 'wait': {
      setDestination(bot, actor, destinationFor(bot));
      bot.state = bot.role === 'attack' ? 'advance' : 'advance';
      break;
    }
    case 'advance': {
      const arrived = followPath(bot, actor, dt, ctx, 4.6);
      // Lob a grenade at the site as the push closes in.
      if (!bot.thrownGrenade && actor.grenades > 0 && bot.role === 'attack') {
        const site = SITES[bot.site ?? 'A'];
        if (Math.hypot(site.x - actor.pos.x, site.z - actor.pos.z) < 16) {
          bot.thrownGrenade = true;
          ctx.throwGrenade(actor, site);
        }
      }
      if (arrived) {
        if (bot.role === 'defend') {
          bot.state = 'hold';
        } else if (actor.hasBomb && match.bomb.state === 'carried') {
          bot.state = 'plant';
        } else {
          bot.state = 'hold';
        }
      }
      break;
    }
    case 'hold': {
      stopMoving(actor, dt, ctx);
      const spot = bot.role === 'defend' ? HOLD_SPOTS[bot.holdIndex] : null;
      const baseYaw = spot ? spot.yaw : actor.yaw;
      const scan = Math.sin(now * 0.5 + bot.scanPhase) * 0.6;
      turnToward(actor, baseYaw + scan, 0, 2.5, dt);
      actor.crouching = !!(spot && spot.crouch);
      actor.height = actor.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
      if (bot.role === 'attack' && actor.hasBomb && match.bomb.state === 'carried') bot.state = 'plant';
      break;
    }
    case 'engage': {
      const target = bot.target;
      if (!target || !target.alive) {
        bot.target = null;
        bot.state = 'hunt';
        bot.lookUntil = 0;
        setDestination(bot, actor, nearestNode(bot.lastKnown.x, bot.lastKnown.z));
        break;
      }
      eyeOf(actor, _eye);
      _chest.set(target.pos.x, target.pos.y + 1.2, target.pos.z);
      _to.subVectors(_chest, _eye);
      const dist = _to.length();
      // The carrier's job is the plant: break off a long-range duel and run
      // the objective instead of trading pot-shots across the map.
      if (actor.hasBomb && match.bomb.state === 'carried' && dist > 25) {
        bot.target = null;
        setDestination(bot, actor, destinationFor(bot));
        bot.state = 'advance';
        break;
      }
      const yawT = Math.atan2(-_to.x, -_to.z);
      const pitchT = Math.atan2(_to.y, Math.hypot(_to.x, _to.z));
      // Strafe timing is shared by both ranges.
      if (now > bot.strafeUntil) {
        bot.strafeDir = chance(0.5) ? 1 : -1;
        bot.strafeUntil = now + range(0.7, 1.4);
      }
      actor.crouching = false;
      actor.height = STAND_HEIGHT;
      if (dist > 20) {
        // Too far to land shots reliably: close the distance along the
        // waypoint graph, gun up. Beelining would pin the bot against the
        // first container between it and the target; the graph routes
        // around cover, and the facing below keeps the body on the threat.
        const goalNode = nearestNode(bot.lastKnown.x, bot.lastKnown.z);
        if (bot.path.length === 0 || bot.path[bot.path.length - 1] !== goalNode || now > bot.repathAt) {
          setDestination(bot, actor, goalNode);
          bot.repathAt = now + 0.8;
        }
        followPath(bot, actor, dt, ctx, 4.2);
      } else {
        // Close fight: strafe to stay a hard target.
        const sx = Math.cos(actor.yaw) * bot.strafeDir;
        const sz = -Math.sin(actor.yaw) * bot.strafeDir;
        actor.vel.x += (sx * 1.9 - actor.vel.x) * Math.min(1, 8 * dt);
        actor.vel.z += (sz * 1.9 - actor.vel.z) * Math.min(1, 8 * dt);
        actor.vel.y -= 20 * dt;
        const ground = moveBody(actor.pos, actor.vel, ACTOR_RADIUS, actor.height, ctx.colliders, dt);
        actor.onGround = ground.onGround;
      }
      const err = turnToward(actor, yawT, pitchT, 3.2 + bot.skill * 1.6, dt);
      if (err < 0.09) shootAt(bot, actor, ctx);
      if (now - bot.lastKnownAt > 2.5) {
        bot.target = null;
        bot.state = 'hunt';
        bot.lookUntil = 0;
        setDestination(bot, actor, nearestNode(bot.lastKnown.x, bot.lastKnown.z));
      }
      break;
    }
    case 'plant': {
      stopMoving(actor, dt, ctx);
      // Only a close threat interrupts the plant; distant fire is worth
      // planting through.
      if (bot.target && bot.target.alive && now - bot.lastKnownAt < 1.2 && bot.target.pos.distanceTo(actor.pos) < 20) {
        bot.state = 'engage';
        break;
      }
      bot.planting = true;
      break;
    }
    case 'defuse': {
      stopMoving(actor, dt, ctx);
      if (bot.target && bot.target.alive && match.bomb.fuse > 10 && bot.target.pos.distanceTo(actor.pos) < 20) {
        bot.state = 'engage';
        break;
      }
      bot.defusing = true;
      turnToward(actor, Math.atan2(-(match.bomb.pos.x - actor.pos.x), -(match.bomb.pos.z - actor.pos.z)), -0.4, 4, dt);
      break;
    }
    case 'hunt': {
      const arrived = followPath(bot, actor, dt, ctx, 4.9);
      if (arrived) {
        // Look around once, then give up and return to the objective. The
        // timer is armed once on arrival: re-arming it every tick would wait
        // forever.
        if (bot.lookUntil === 0) bot.lookUntil = now + 1.2;
        turnToward(actor, actor.yaw + 1.2, 0, 3, dt);
        if (now > bot.lookUntil) {
          bot.lookUntil = 0;
          setDestination(bot, actor, destinationFor(bot));
          bot.state = 'advance';
        }
      }
      break;
    }
    default:
      bot.state = 'advance';
  }
  // Keep the mesh on the simulated body every step: hit tests raycast the
  // meshes, and at a low frame rate a render-only sync would leave them
  // seconds behind the bodies they belong to.
  syncActor(actor);
}

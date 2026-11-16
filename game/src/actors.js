// Actors: the player and the bots share one body. A humanoid built from boxes
// with separate head, torso and limb meshes, so hits test against real parts
// and headshots pay. Meshes share geometries and materials; the group is the
// actor, the meshes carry userData back to it.
import * as THREE from 'three';

export const ACTOR_RADIUS = 0.35;
export const STAND_HEIGHT = 1.75;
export const CROUCH_HEIGHT = 1.15;
export const STAND_EYE = 1.6;
export const CROUCH_EYE = 1.0;

const geos = {};
function box(w, h, d) {
  const key = `${w}|${h}|${d}`;
  if (!geos[key]) geos[key] = new THREE.BoxGeometry(w, h, d);
  return geos[key];
}

function buildBody(team, palette) {
  const { materials } = palette;
  const cloth = team === 'atk' ? materials.atkCloth : materials.defCloth;
  const gear = team === 'atk' ? materials.atkGear : materials.defGear;
  const group = new THREE.Group();
  const parts = {};

  const torso = new THREE.Mesh(box(0.52, 0.62, 0.3), cloth);
  torso.position.y = 1.16;
  torso.castShadow = true;
  group.add(torso);
  parts.torso = torso;

  const vest = new THREE.Mesh(box(0.54, 0.4, 0.34), gear);
  vest.position.y = 1.2;
  group.add(vest);
  parts.vest = vest;

  const head = new THREE.Mesh(box(0.3, 0.32, 0.3), materials.skin);
  head.position.y = 1.62;
  head.castShadow = true;
  group.add(head);
  parts.head = head;

  const helmet = new THREE.Mesh(box(0.34, 0.14, 0.34), gear);
  helmet.position.y = 1.76;
  group.add(helmet);
  parts.helmet = helmet;

  const legL = new THREE.Mesh(box(0.2, 0.82, 0.22), cloth);
  legL.position.set(-0.14, 0.41, 0);
  group.add(legL);
  const legR = new THREE.Mesh(box(0.2, 0.82, 0.22), cloth);
  legR.position.set(0.14, 0.41, 0);
  group.add(legR);
  parts.legL = legL;
  parts.legR = legR;

  const armL = new THREE.Mesh(box(0.14, 0.6, 0.16), cloth);
  armL.position.set(-0.34, 1.2, -0.12);
  armL.rotation.x = -1.1;
  group.add(armL);
  const armR = new THREE.Mesh(box(0.14, 0.6, 0.16), cloth);
  armR.position.set(0.34, 1.2, -0.12);
  armR.rotation.x = -1.1;
  group.add(armR);
  parts.armL = armL;
  parts.armR = armR;

  const gun = new THREE.Mesh(box(0.08, 0.1, 0.7), materials.gunmetal);
  gun.position.set(0.18, 1.32, -0.42);
  group.add(gun);
  parts.gun = gun;

  return { group, parts };
}

export function createActor(scene, palette, opts) {
  const { group, parts } = buildBody(opts.team, palette);
  scene.add(group);
  const actor = {
    id: opts.id,
    name: opts.name,
    team: opts.team,
    isPlayer: !!opts.isPlayer,
    group,
    parts,
    pos: new THREE.Vector3(opts.spawn[0], 0, opts.spawn[1]),
    vel: new THREE.Vector3(),
    yaw: opts.yaw ?? 0,
    pitch: 0,
    eye: STAND_EYE,
    height: STAND_HEIGHT,
    onGround: true,
    crouching: false,
    hp: 100,
    armor: 0,
    alive: true,
    kills: 0,
    deaths: 0,
    money: 800,
    grenades: 0,
    hasBomb: false,
    hitFlash: 0,
    deathAt: 0,
    walkPhase: 0,
    loadout: opts.loadout,
    bot: null,
  };
  // Hit meshes: head pays the headshot multiplier, torso and limbs the rest.
  const hitMeshes = [];
  for (const [name, mesh] of Object.entries(parts)) {
    const part = name === 'head' || name === 'helmet' ? 'head' : name === 'torso' || name === 'vest' ? 'torso' : 'limb';
    mesh.userData.actor = actor;
    mesh.userData.part = part;
    hitMeshes.push(mesh);
  }
  actor.hitMeshes = hitMeshes;
  if (actor.isPlayer) group.visible = false;
  syncActor(actor);
  return actor;
}

export function syncActor(actor) {
  actor.group.position.copy(actor.pos);
  actor.group.rotation.y = actor.yaw;
  const targetEye = actor.crouching ? CROUCH_EYE : STAND_EYE;
  actor.eye += (targetEye - actor.eye) * 0.4;
  const squash = actor.crouching ? 0.72 : 1;
  actor.group.scale.y = squash;
}

// Death animation and walk cycle, visual only: the dead fall to their side
// over half a second, the living swing arms and legs with their speed.
export function stepActorVisual(actor, dt, now) {
  if (!actor.alive) {
    const t = Math.min(1, (now - actor.deathAt) / 0.5);
    actor.group.rotation.z = t * (Math.PI / 2) * 0.94;
    actor.group.position.y = actor.pos.y + 0.12 * t;
    return;
  }
  const speed = Math.hypot(actor.vel.x, actor.vel.z);
  actor.walkPhase += dt * (2 + speed * 1.6);
  const swing = Math.min(0.5, speed * 0.09) * Math.sin(actor.walkPhase);
  actor.parts.legL.rotation.x = swing;
  actor.parts.legR.rotation.x = -swing;
  actor.parts.armL.rotation.x = -1.1 - swing * 0.4;
  actor.parts.armR.rotation.x = -1.1 + swing * 0.4;
  if (actor.hitFlash > 0) {
    actor.hitFlash = Math.max(0, actor.hitFlash - dt * 6);
    const s = 1 + actor.hitFlash * 0.06;
    actor.parts.torso.scale.set(s, s, s);
  }
}

export function resetActor(actor, spawn, yaw) {
  actor.pos.set(spawn[0], 0, spawn[1]);
  actor.vel.set(0, 0, 0);
  actor.yaw = yaw;
  actor.pitch = 0;
  actor.hp = 100;
  actor.alive = true;
  actor.crouching = false;
  actor.height = STAND_HEIGHT;
  actor.hitFlash = 0;
  actor.group.rotation.z = 0;
  actor.group.position.y = 0;
  actor.group.scale.y = 1;
  if (!actor.isPlayer) actor.group.visible = true;
  syncActor(actor);
}

// Eye position for aiming and hearing checks. Writes into out, no allocation.
export function eyeOf(actor, out) {
  out.set(actor.pos.x, actor.pos.y + actor.eye, actor.pos.z);
  return out;
}

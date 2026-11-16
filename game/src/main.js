// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. This module owns the renderer, the camera and the player's
// controls; the rules live in match.js, the opponents in bots.js, and every
// shot resolves in combat.js. ?shot=start|play|buy|end with &seed=N stages a
// deterministic frame, renders it twice, then freezes it for capture.
import * as THREE from 'three';
import { seedRandom, random } from './rng.js';
import { PALETTE, createPalette, createSkyDome } from './palette.js';
import { createWorld, SPAWNS } from './map.js';
import { moveBody } from './physics.js';
import { createInput } from './input.js';
import { createLoadout, createViewModel, WEAPONS } from './weapons.js';
import { createActor, syncActor, stepActorVisual, eyeOf, ACTOR_RADIUS, STAND_HEIGHT, CROUCH_HEIGHT } from './actors.js';
import { createEffects } from './projectiles.js';
import { createAudio } from './audio.js';
import { createBot, stepBot } from './bots.js';
import { createMatch, PLANT_TIME, DEFUSE_TIME } from './match.js';
import { createHud } from './hud.js';
import { fireHitscan } from './combat.js';
import { setupShot } from './shots.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shotMode = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
seedRandom(shotMode ? seed : (Date.now() % 2147483647) || 1);

const palette = createPalette();
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.fog);
scene.fog = new THREE.Fog(PALETTE.fog, 30, 95);
scene.add(createSkyDome());
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 400);
scene.add(camera);
// A soft fill light riding with the camera, so the view-model gun reads even
// when the player faces away from the sun.
const fill = new THREE.PointLight(0xffe0b0, 2.5, 4, 1.5);
fill.position.set(0.3, 0.3, -0.4);
camera.add(fill);

const hemi = new THREE.HemisphereLight(0x8a7bb8, 0x3a3230, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xff9a52, 2.4);
sun.position.set(-34, 30, -18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -38;
sun.shadow.camera.right = 38;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
sun.shadow.camera.far = 110;
sun.shadow.bias = -0.0006;
scene.add(sun);
for (const [x, z] of [[0, 0], [-18, -15], [17, 14.5]]) {
  const lamp = new THREE.PointLight(PALETTE.lampWarm, 36, 26, 1.8);
  lamp.position.set(x, 4.8, z);
  scene.add(lamp);
}

const world = createWorld(scene, palette);
const audio = createAudio();

// The two teams: the player leads four Vanguard bots against five Sentinels.
const BOT_NAMES = {
  atk: ['Rook', 'Havoc', 'Mira', 'Sable'],
  def: ['Bastion', 'Warden', 'Kestrel', 'Onyx', 'Fable'],
};
const actors = [];
function addActor(team, name, isPlayer, spawn, skill) {
  const actor = createActor(scene, palette, {
    id: actors.length,
    name,
    team,
    isPlayer,
    spawn,
    yaw: team === 'atk' ? -Math.PI / 2 : Math.PI / 2,
    loadout: createLoadout(),
  });
  if (!isPlayer) createBot(actor, skill);
  actors.push(actor);
  return actor;
}
const player = addActor('atk', 'You', true, SPAWNS.atk[0], 0);
BOT_NAMES.atk.forEach((name, i) => addActor('atk', name, false, SPAWNS.atk[i + 1], 0.4 + i * 0.11));
BOT_NAMES.def.forEach((name, i) => addActor('def', name, false, SPAWNS.def[i], 0.35 + i * 0.1));

const match = createMatch(actors, SPAWNS);
const state = match.state;
const effects = createEffects(scene, world.colliders);
const hitTargets = world.shootables.concat(actors.flatMap((a) => a.hitMeshes));
const viewModel = createViewModel(camera, palette);
viewModel.setWeapon(WEAPONS.sidearm);

// The charge: a world prop for dropped/planted states, plus a small pack on
// the carrier's back. Synced from match state every frame.
const bombProp = new THREE.Group();
const bombBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.36), palette.materials.metalDark);
bombBox.position.y = 0.15;
bombProp.add(bombBox);
const bombBlink = new THREE.Mesh(
  new THREE.SphereGeometry(0.06, 8, 6),
  new THREE.MeshBasicMaterial({ color: 0xff4030 }),
);
bombBlink.position.set(0.18, 0.34, 0);
bombProp.add(bombBlink);
const bombLight = new THREE.PointLight(0xff4030, 0, 8, 1.8);
bombLight.position.y = 0.5;
bombProp.add(bombLight);
bombProp.visible = false;
scene.add(bombProp);
for (const actor of actors) {
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.16), palette.materials.metalDark);
  pack.position.set(0, 1.32, 0.26);
  pack.visible = false;
  actor.group.add(pack);
  actor.bombPack = pack;
}

const ctx = {
  actors,
  colliders: world.colliders,
  hitTargets,
  effects,
  events: state.events,
  match: state,
  now: 0,
  damageActor: (victim, amount, part, attacker) => match.damageActor(victim, amount, part, attacker),
  throwGrenade(actor, site) {
    eyeOf(actor, _eye);
    _dir.set(site.x - _eye.x, 3.5, site.z - _eye.z);
    const dist = Math.hypot(site.x - _eye.x, site.z - _eye.z);
    _dir.normalize();
    if (effects.throwGrenade(actor, _eye, _dir, Math.max(10, Math.min(18, dist * 0.9)))) {
      actor.grenades -= 1;
    }
  },
};
const ruleCtx = {
  isPlanting(actor) {
    if (actor.isPlayer) return input.state.keys.has('KeyE') && state.phase === 'live';
    return !!(actor.bot && actor.bot.planting);
  },
  isDefusing(actor) {
    if (actor.isPlayer) return input.state.keys.has('KeyE') && state.phase === 'live';
    return !!(actor.bot && actor.bot.defusing);
  },
};

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _origin = new THREE.Vector3();
let recoilPitch = 0;
let recoilYaw = 0;
let shake = 0;
let bobPhase = 0;
let stepAcc = 0;
let spectateNoted = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();

const hud = createHud({
  onPlay() {
    if (shotMode) return;
    audio.ensure();
    if (state.phase === 'menu' || state.phase === 'matchEnd') match.startMatch();
    spectateNoted = false;
    input.requestLock();
  },
  onBuy(id) {
    buyItem(id);
  },
  onBuyClose() {
    closeBuy();
  },
});
hud.initMinimap(world);
hud.showOverlay('start');

const input = createInput(renderer.domElement, (locked) => {
  if (shotMode) return;
  if (locked) {
    hud.hideOverlay();
  } else if (hud.isBuyOpen()) {
    // The buy menu owns the mouse; closing it re-locks.
  } else if (state.phase === 'matchEnd') {
    hud.showOverlay('end', { winner: state.matchWinner, wins: state.wins });
  } else if (state.phase !== 'menu') {
    hud.showOverlay('paused');
  }
});

function buyItem(id) {
  if (!match.buy(player, id)) {
    audio.denied();
    return;
  }
  audio.buy();
  if (WEAPONS[id]) viewModel.setWeapon(WEAPONS[id]);
  hud.renderBuy(player, state.phase === 'buy');
}

function openBuy() {
  if (state.phase !== 'buy') return;
  hud.renderBuy(player, true);
  hud.openBuy();
  input.exitLock();
}

function closeBuy() {
  hud.closeBuy();
  if (!shotMode) input.requestLock();
}

function syncCamera() {
  let yaw = player.yaw;
  let pitch = player.pitch;
  if (!player.alive) {
    const mate = actors.find((a) => a.team === 'atk' && a.alive && !a.isPlayer);
    if (mate) {
      yaw = mate.yaw;
      pitch = mate.pitch;
      camera.position.set(mate.pos.x, mate.pos.y + mate.eye, mate.pos.z);
    }
  } else {
    const bob = Math.sin(bobPhase) * 0.014 * Math.min(1, Math.hypot(player.vel.x, player.vel.z) / 5);
    camera.position.set(player.pos.x, player.pos.y + player.eye + bob, player.pos.z);
  }
  const shX = (random() - 0.5) * shake;
  const shY = (random() - 0.5) * shake;
  camera.rotation.set(pitch + recoilPitch + shY, yaw + recoilYaw + shX, 0, 'YXZ');
}

function aimAt(point) {
  eyeOf(player, _eye);
  _to.subVectors(point, _eye);
  const len = _to.length() || 1;
  player.yaw = Math.atan2(-_to.x, -_to.z);
  player.pitch = Math.asin(Math.max(-1, Math.min(1, _to.y / len)));
  syncCamera();
}

function shootPlayer(spreadOverride) {
  const loadout = player.loadout;
  const speed = Math.hypot(player.vel.x, player.vel.z);
  const aiming = input.state.aiming;
  const shot = loadout.pull(state.time, speed, player.crouching, aiming);
  if (!shot) return;
  if (shot.dry) {
    audio.dry();
    return;
  }
  camera.getWorldDirection(_dir);
  const spread = spreadOverride ?? shot.spread;
  _dir.x += (random() * 2 - 1) * spread;
  _dir.y += (random() * 2 - 1) * spread;
  _dir.z += (random() * 2 - 1) * spread;
  _dir.normalize();
  scene.updateMatrixWorld(true);
  fireHitscan(ctx, player, camera.position, _dir, shot);
  recoilPitch += shot.recoilPitch;
  recoilYaw += shot.recoilYaw;
  viewModel.onShot(state.time);
  audio.shoot(loadout.def().id, 0);
}

function throwPlayerGrenade() {
  if (player.grenades <= 0 || state.phase !== 'live') return;
  eyeOf(player, _eye);
  camera.getWorldDirection(_dir);
  _origin.copy(_eye).addScaledVector(_dir, 0.5);
  if (effects.throwGrenade(player, _origin, _dir, 15)) {
    player.grenades -= 1;
    audio.throwWhoosh();
  }
}

function stepPlayer(dt) {
  const keys = input.state.keys;
  const crouchKey = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
  if (crouchKey && !player.crouching) {
    player.crouching = true;
    player.height = CROUCH_HEIGHT;
  } else if (!crouchKey && player.crouching) {
    player.crouching = false;
    player.height = STAND_HEIGHT;
  }
  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  _dir.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe);
  if (_dir.lengthSq() > 0) _dir.normalize();
  const speed = player.crouching ? 2.4 : 5.2;
  const blend = Math.min(1, (player.onGround ? 42 : 9) * dt / speed);
  player.vel.x += (_dir.x * speed - player.vel.x) * blend;
  player.vel.z += (_dir.z * speed - player.vel.z) * blend;
  if (player.onGround && !_dir.lengthSq()) {
    const damp = Math.max(0, 1 - 9 * dt);
    player.vel.x *= damp;
    player.vel.z *= damp;
  }
  if (keys.has('Space') && player.onGround) {
    player.vel.y = 6.2;
    player.onGround = false;
  }
  player.vel.y -= 20 * dt;
  const ground = moveBody(player.pos, player.vel, ACTOR_RADIUS, player.height, world.colliders, dt);
  player.onGround = ground.onGround;
  player.vel.y = Math.max(-30, player.vel.y);
  const groundSpeed = Math.hypot(player.vel.x, player.vel.z);
  bobPhase += dt * groundSpeed * 1.7;
  if (player.onGround && groundSpeed > 1) {
    stepAcc += groundSpeed * dt;
    if (stepAcc > 2.4) {
      stepAcc = 0;
      audio.step();
    }
  }
  syncActor(player);
}

function drainEvents() {
  for (const evt of state.events) {
    switch (evt.kind) {
      case 'gunshot': {
        window.__breakwater.stats.shots += 1;
        if (evt.shooter !== player) {
          const dist = evt.pos.distanceTo(camera.position);
          audio.shoot(evt.shooter.loadout.def().id, dist);
        }
        break;
      }
      case 'hitmark':
        window.__breakwater.stats.hits += 1;
        hud.hitMarker(evt.kill, shotMode ? 4000 : 110);
        audio.hit(evt.kill);
        break;
      case 'playerHurt': {
        audio.hurt();
        shake = Math.min(0.06, shake + 0.03);
        if (evt.from) {
          const worldAngle = Math.atan2(-(evt.from.x - player.pos.x), -(evt.from.z - player.pos.z));
          hud.damageFrom(((worldAngle - player.yaw) * 180) / Math.PI);
        } else {
          hud.damageFrom(0);
        }
        break;
      }
      case 'kill': {
        hud.killfeedAdd({ killer: evt.killer, victim: evt.victim, part: evt.part });
        if (evt.victim === player && !spectateNoted) {
          spectateNoted = true;
          hud.toast('You were eliminated — spectating a teammate');
        }
        break;
      }
      case 'roundStart':
        if (!shotMode) hud.banner(`ROUND ${evt.round}`, 'Buy phase — press B for the buy menu', 2400);
        break;
      case 'roundLive':
        if (!shotMode) hud.toast('Round live — good luck');
        break;
      case 'roundEnd': {
        const won = evt.winner === 'atk';
        const reason = { elimination: 'Enemy team eliminated', bomb: 'The charge detonated', defuse: 'Charge defused', time: 'Time expired' }[evt.reason];
        hud.banner(won ? 'ROUND WON' : 'ROUND LOST', `${reason} · ${evt.wins.atk} – ${evt.wins.def}`, 3400);
        audio.roundWin(won);
        break;
      }
      case 'matchEnd': {
        input.exitLock();
        hud.showOverlay('end', { winner: evt.winner, wins: state.wins });
        break;
      }
      case 'bombPlanted':
        hud.banner('CHARGE PLANTED', `Site ${evt.site} — defend it`, 2600);
        hud.toast('The charge is ticking');
        break;
      case 'bombDefused':
        hud.toast(`${evt.actor.name} defused the charge`);
        break;
      case 'bombDropped':
        hud.toast('The charge was dropped');
        break;
      case 'bombPickup':
        hud.toast(`${evt.actor.name} picked up the charge`);
        break;
      case 'bombBeep':
        audio.beep(evt.urgent ? 1800 : 1200);
        break;
      case 'bombExploded': {
        audio.explosion(evt.pos.distanceTo(camera.position));
        shake = 0.12;
        break;
      }
      case 'explosion': {
        const dist = evt.pos.distanceTo(camera.position);
        audio.explosion(dist);
        if (dist < 12) shake = Math.min(0.1, shake + 0.08 * (1 - dist / 12));
        break;
      }
      case 'grenadeBeep':
        audio.beep(2000);
        break;
      default:
        break;
    }
  }
  state.events.length = 0;
}

function step(dt) {
  ctx.now = state.time;
  match.update(dt, ruleCtx);
  ctx.now = state.time;
  if (player.alive && (state.phase === 'buy' || state.phase === 'live' || state.phase === 'roundEnd')) {
    stepPlayer(dt);
  }
  player.loadout.step(state.time, dt, Math.hypot(player.vel.x, player.vel.z) > 0.5);
  // Sync every mesh to its simulated body and refresh world matrices before
  // the bots shoot: their raycasts read matrixWorld, which the renderer only
  // refreshes once a frame.
  for (const actor of actors) syncActor(actor);
  scene.updateMatrixWorld(true);
  for (const actor of actors) {
    if (actor.bot) stepBot(actor.bot, actor, dt, ctx);
  }
  effects.step(dt, ctx);
}

function syncBombProp() {
  const bomb = state.bomb;
  bombProp.visible = bomb.state === 'dropped' || bomb.state === 'planted';
  if (bombProp.visible) {
    bombProp.position.copy(bomb.pos);
    const urgent = bomb.state === 'planted' && bomb.fuse <= 10;
    const on = Math.sin(state.time * (urgent ? 14 : 6)) > 0;
    bombBlink.material.color.setHex(on ? 0xff4030 : 0x501010);
    bombLight.intensity = bomb.state === 'planted' && on ? 6 : 0;
  }
  for (const actor of actors) actor.bombPack.visible = actor.hasBomb;
}

function updateInteract() {
  if (!player.alive || state.phase !== 'live') {
    hud.setInteract(null, 0);
    return;
  }
  const bomb = state.bomb;
  if (player.hasBomb && match.siteAt(player.pos)) {
    hud.setInteract(bomb.planter === player ? 'PLANTING THE CHARGE' : 'Hold E to plant the charge', bomb.plant / PLANT_TIME);
  } else if (bomb.state === 'planted' && Math.hypot(player.pos.x - bomb.pos.x, player.pos.z - bomb.pos.z) < 2.2) {
    hud.setInteract(bomb.defuser === player ? 'DEFUSING' : 'Hold E to defuse', bomb.defuse / DEFUSE_TIME);
  } else {
    hud.setInteract(null, 0);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (frozen) {
    renderer.render(scene, camera);
    return;
  }
  const look = input.takeLook();
  const aiming = input.state.aiming && player.alive;
  const sens = aiming ? 0.0011 : 0.0022;
  if (player.alive) {
    player.yaw -= look.x * sens;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - look.y * sens));
  }
  const buyOpen = hud.isBuyOpen();
  const wheel = input.takeWheel();
  if (input.wasPressed('KeyB')) {
    if (buyOpen) closeBuy();
    else if (state.phase === 'buy' && player.alive) openBuy();
  }
  if (buyOpen) {
    const buyKeys = { Digit1: 'rifle', Digit2: 'smg', Digit3: 'marksman', Digit4: 'armor', Digit5: 'grenade' };
    for (const code of Object.keys(buyKeys)) {
      if (input.wasPressed(code)) buyItem(buyKeys[code]);
    }
    if (input.wasPressed('Escape')) closeBuy();
  } else {
    if (input.wasPressed('Digit1') && player.loadout.state.primary) {
      if (player.loadout.switchTo(player.loadout.state.primary, state.time)) viewModel.setWeapon(player.loadout.def());
    }
    if (input.wasPressed('Digit2')) {
      if (player.loadout.switchTo('sidearm', state.time)) viewModel.setWeapon(player.loadout.def());
    }
    if (input.wasPressed('KeyQ')) {
      player.loadout.cycle(state.time);
      viewModel.setWeapon(player.loadout.def());
    }
    const wheelDelta = wheel;
    if (wheelDelta !== 0) {
      player.loadout.cycle(state.time);
      viewModel.setWeapon(player.loadout.def());
    }
    if (input.wasPressed('KeyR') && player.alive) {
      if (player.loadout.startReload(state.time)) {
        viewModel.onReload();
        audio.reload();
      }
    }
    if (input.wasPressed('KeyG')) throwPlayerGrenade();
  }
  if (input.wasPressed('KeyM')) audio.toggleMute();
  if (input.wasPressed('Tab')) hud.showScoreboard(actors, state.wins);
  if (!input.state.keys.has('Tab') && hud.isScoreOpen()) hud.hideScoreboard();
  if (input.state.firing && player.alive && state.phase === 'live' && !buyOpen && input.state.locked) {
    shootPlayer();
  }
  if (!input.state.firing) player.loadout.releaseTrigger();

  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    step(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (accumulator > FIXED_STEP * 5) accumulator = 0;
  drainEvents();

  // Recoil recovery, camera shake decay, aim zoom.
  recoilPitch *= Math.max(0, 1 - 6 * dt);
  recoilYaw *= Math.max(0, 1 - 6 * dt);
  shake = Math.max(0, shake - dt * 0.25);
  const def = player.loadout.def();
  const targetFov = aiming ? (def.zoom > 1 ? 74 / def.zoom : 58) : 74;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();
  hud.setScope(aiming && def.zoom > 1);
  const speed = Math.hypot(player.vel.x, player.vel.z);
  const spreadPx = 5 + (def.spread + def.moveSpread * Math.min(1, speed / 5.2) + player.loadout.state.bloom) * 700 + speed * 1.5;
  hud.setCrosshair(spreadPx);

  for (const actor of actors) {
    stepActorVisual(actor, dt, state.time);
    if (!actor.isPlayer) syncActor(actor);
  }
  syncBombProp();
  updateInteract();
  syncCamera();
  viewModel.step(state.time, dt, aiming);
  hud.update(state, player, actors, performance.now());
  input.endFrame();
  renderer.render(scene, camera);
}

// --- Screenshot facade: the setups in shots.js drive the real game. ---
function settle(steps) {
  for (let i = 0; i < steps; i += 1) {
    step(FIXED_STEP);
    for (const actor of actors) {
      if (!actor.isPlayer) syncActor(actor);
      stepActorVisual(actor, FIXED_STEP, state.time);
    }
    syncBombProp();
  }
  drainEvents();
}

const game = {
  match: state,
  player,
  actors,
  camera,
  hud,
  world,
  renderer,
  scene,
  settle,
  placePlayer(x, z, yaw, pitch) {
    player.pos.set(x, 0, z);
    player.vel.set(0, 0, 0);
    player.yaw = yaw;
    player.pitch = pitch;
    syncActor(player);
    syncCamera();
  },
  placeActor(actor, x, z, yaw) {
    actor.pos.set(x, 0, z);
    actor.vel.set(0, 0, 0);
    actor.yaw = yaw;
    actor.pitch = 0;
    syncActor(actor);
  },
  aimAt,
  playerShoot() {
    shootPlayer(0);
  },
  startMatch() {
    match.startMatch();
    hud.hideOverlay();
  },
  skipBuy() {
    state.phase = 'live';
    state.phaseTime = 80;
  },
  openBuy,
  armPlayer(id) {
    player.loadout.give(id);
    viewModel.setWeapon(WEAPONS[id]);
  },
  stageRoundWin() {
    state.wins.atk = 5;
    state.wins.def = 2;
    state.roundHistory.push('atk', 'def', 'atk', 'atk', 'def', 'atk', 'atk');
    state.round = 7;
    state.phase = 'roundEnd';
    state.phaseTime = 4;
    state.bomb.state = 'planted';
    state.bomb.site = 'A';
    state.bomb.fuse = 20;
    state.bomb.pos.set(-18, 0, -15);
    const fallen = actors.filter((a) => a.team === 'def').slice(0, 3);
    const spots = [[-16, -13], [-20, -16.5], [-14.5, -17]];
    fallen.forEach((actor, i) => {
      actor.alive = false;
      actor.hp = 0;
      actor.deathAt = state.time - 0.6;
      actor.pos.set(spots[i][0], 0, spots[i][1]);
      actor.yaw = i * 1.1;
      syncActor(actor);
    });
    const mates = actors.filter((a) => a.team === 'atk' && !a.isPlayer);
    game.placeActor(mates[0], -19.5, -12, -Math.PI / 2);
    game.placeActor(mates[1], -16, -18, Math.PI);
  },
  finishShot() {
    drainEvents();
    hud.update(state, player, actors, performance.now());
    let painted = 0;
    const paint = () => {
      requestAnimationFrame(paint);
      syncCamera();
      syncBombProp();
      renderer.render(scene, camera);
      painted += 1;
      if (painted === 2) {
        window.__shotReady = true;
        frozen = true;
      }
    };
    requestAnimationFrame(paint);
  },
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Menu vista: the camera rests just past the spawn wall, looking down mid.
player.pos.set(-21, 0, 0);
player.yaw = -Math.PI / 2;
syncCamera();
window.__breakwater = { state, player, actors, match, stats: { shots: 0, hits: 0 } };

if (shotMode) {
  setupShot(shotMode, game);
} else {
  requestAnimationFrame(frame);
}

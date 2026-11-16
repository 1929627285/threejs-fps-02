// Weapons: one table of definitions, one state machine per holder. Spread is a
// cone in radians: a base value, a movement penalty, and bloom that grows with
// every shot and decays when the trigger is released, so stopping to aim pays.
// Recoil kicks the aim up and drifts it sideways; crouching steadies both.
import * as THREE from 'three';
import { range } from './rng.js';

export const WEAPONS = {
  sidearm: {
    id: 'sidearm', name: 'P9 Sidearm', slot: 2, price: 0, damage: 26, headMult: 2.5,
    rpm: 320, mag: 12, reserve: 48, reload: 1.4, spread: 0.011, moveSpread: 0.02,
    bloom: 0.006, bloomDecay: 0.05, recoil: 0.011, yawRecoil: 0.003, range: 45,
    auto: false, pellets: 1, zoom: 1,
  },
  rifle: {
    id: 'rifle', name: 'VK-7 Rifle', slot: 1, price: 2700, damage: 33, headMult: 3,
    rpm: 600, mag: 30, reserve: 90, reload: 2.2, spread: 0.008, moveSpread: 0.03,
    bloom: 0.004, bloomDecay: 0.04, recoil: 0.009, yawRecoil: 0.003, range: 60,
    auto: true, pellets: 1, zoom: 1,
  },
  smg: {
    id: 'smg', name: 'KX-9 SMG', slot: 1, price: 1500, damage: 24, headMult: 2.5,
    rpm: 800, mag: 32, reserve: 96, reload: 1.9, spread: 0.014, moveSpread: 0.026,
    bloom: 0.0035, bloomDecay: 0.05, recoil: 0.007, yawRecoil: 0.003, range: 35,
    auto: true, pellets: 1, zoom: 1,
  },
  marksman: {
    id: 'marksman', name: 'LR-90 Marksman', slot: 1, price: 4750, damage: 110, headMult: 2,
    rpm: 55, mag: 5, reserve: 15, reload: 3.1, spread: 0.001, moveSpread: 0.05,
    bloom: 0.03, bloomDecay: 0.03, recoil: 0.035, yawRecoil: 0.006, range: 90,
    auto: false, pellets: 1, zoom: 2.2,
  },
};

export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;

// A holder's weapons: primary + sidearm, each with its own magazine and
// reserve, plus the shared fire/reload/switch timing. Bots use the same state.
export function createLoadout() {
  const state = {
    primary: null,
    secondary: 'sidearm',
    current: 'sidearm',
    mag: { sidearm: 12 },
    reserve: { sidearm: 48 },
    reloadingUntil: 0,
    switchUntil: 0,
    nextShotAt: 0,
    bloom: 0,
    triggerHeld: false,
  };
  return {
    state,
    def() {
      return WEAPONS[state.current];
    },
    give(id) {
      const def = WEAPONS[id];
      if (def.slot === 1) state.primary = id;
      else state.secondary = id;
      state.mag[id] = def.mag;
      state.reserve[id] = def.reserve;
      state.current = id;
      state.reloadingUntil = 0;
    },
    has(id) {
      return state.primary === id || state.secondary === id;
    },
    switchTo(id, now) {
      if (!this.has(id) || state.current === id) return false;
      if (now < state.switchUntil || now < state.reloadingUntil) return false;
      state.current = id;
      state.switchUntil = now + 0.35;
      state.reloadingUntil = 0;
      return true;
    },
    cycle(now) {
      if (state.primary) this.switchTo(state.current === state.primary ? state.secondary : state.primary, now);
    },
    startReload(now) {
      const def = WEAPONS[state.current];
      if (state.mag[state.current] >= def.mag || state.reserve[state.current] <= 0) return false;
      if (now < state.reloadingUntil || now < state.switchUntil) return false;
      state.reloadingUntil = now + def.reload;
      return true;
    },
    step(now, dt, moving) {
      if (state.reloadingUntil && now >= state.reloadingUntil) {
        const def = WEAPONS[state.current];
        const need = def.mag - state.mag[state.current];
        const take = Math.min(need, state.reserve[state.current]);
        state.mag[state.current] += take;
        state.reserve[state.current] -= take;
        state.reloadingUntil = 0;
      }
      const def = WEAPONS[state.current];
      state.bloom = Math.max(0, state.bloom - def.bloomDecay * dt * (moving ? 0.5 : 1));
    },
    ready(now) {
      return now >= state.switchUntil && now >= state.reloadingUntil && now >= state.nextShotAt;
    },
    reloading() {
      return state.reloadingUntil > 0;
    },
    // Fires one trigger pull: consumes a round and returns the shot's spread
    // and recoil, or null when the weapon cannot fire. now is sim time.
    pull(now, speed, crouching, aiming) {
      const def = WEAPONS[state.current];
      if (!this.ready(now)) return null;
      if (state.mag[state.current] <= 0) {
        state.nextShotAt = now + 0.25;
        return { dry: true };
      }
      if (!def.auto && state.triggerHeld) return null;
      state.triggerHeld = true;
      state.mag[state.current] -= 1;
      state.nextShotAt = now + 60 / def.rpm;
      const movePenalty = def.moveSpread * Math.min(1, speed / 5.2);
      const spread = (def.spread + movePenalty + state.bloom) * (crouching ? 0.7 : 1) * (aiming ? 0.55 : 1);
      state.bloom = Math.min(0.06, state.bloom + def.bloom);
      return {
        spread,
        recoilPitch: def.recoil * range(0.8, 1.2),
        recoilYaw: def.yawRecoil * range(-1, 1),
        pellets: def.pellets,
        damage: def.damage,
        headMult: def.headMult,
        range: def.range,
        zoom: def.zoom,
      };
    },
    releaseTrigger() {
      state.triggerHeld = false;
    },
  };
}

// The first-person view model: a small gun built from boxes, parented to the
// camera, with recoil kick, reload dip and a muzzle flash quad. One per weapon
// shape, swapped on switch.
export function createViewModel(camera, palette) {
  const { materials } = palette;
  const group = new THREE.Group();
  group.position.set(0.26, -0.24, -0.55);
  camera.add(group);
  const flashLight = new THREE.PointLight(0xffc37a, 0, 7, 1.8);
  flashLight.position.set(0.2, -0.1, -1.2);
  camera.add(flashLight);
  // Muzzle flash: a soft radial glow sprite at the barrel tip, not a card.
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 64;
  flashCanvas.height = 64;
  const flashCtx = flashCanvas.getContext('2d');
  const grad = flashCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255, 240, 200, 1)');
  grad.addColorStop(0.35, 'rgba(255, 200, 110, 0.9)');
  grad.addColorStop(1, 'rgba(255, 140, 40, 0)');
  flashCtx.fillStyle = grad;
  flashCtx.fillRect(0, 0, 64, 64);
  const flashTex = new THREE.CanvasTexture(flashCanvas);
  const flashMat = new THREE.SpriteMaterial({ map: flashTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const flash = new THREE.Sprite(flashMat);
  flash.scale.set(0.34, 0.34, 1);
  flash.position.set(0, 0.02, -0.5);
  let current = null;
  let kick = 0;
  let dip = 0;
  let flashUntil = 0;

  function buildGun(def) {
    const gun = new THREE.Group();
    const bodyLen = def.id === 'marksman' ? 0.78 : def.id === 'sidearm' ? 0.3 : 0.62;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, bodyLen), materials.gunmetal);
    gun.add(body);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.08), materials.grip);
    grip.position.set(0, -0.09, bodyLen * 0.28);
    grip.rotation.x = 0.25;
    gun.add(grip);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.07), materials.metalDark);
    mag.position.set(0, -0.08, -0.02);
    mag.rotation.x = 0.12;
    gun.add(mag);
    if (def.id !== 'sidearm') {
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.2), materials.grip);
      stock.position.set(0, -0.01, bodyLen / 2 + 0.08);
      gun.add(stock);
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.1), materials.dark);
      sight.position.set(0, 0.065, 0.05);
      gun.add(sight);
    }
    if (def.id === 'marksman') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10), materials.dark);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.08, 0.02);
      gun.add(scope);
    }
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), materials.gunmetal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.01, -bodyLen / 2 - 0.06);
    gun.add(barrel);
    return gun;
  }

  return {
    group,
    setWeapon(def) {
      if (current) group.remove(current);
      current = buildGun(def);
      current.add(flash);
      group.add(current);
      kick = 0;
      dip = 0;
    },
    onShot(now) {
      kick = Math.min(0.09, kick + 0.045);
      flashUntil = now + 0.05;
      flashMat.opacity = 0.95;
      flashLight.intensity = 14;
    },
    onReload() {
      dip = 1;
    },
    step(now, dt, aiming) {
      kick = Math.max(0, kick - dt * 0.35);
      dip = Math.max(0, dip - dt * 1.6);
      const aimX = aiming ? 0 : 0.26;
      const aimY = aiming ? -0.148 : -0.24;
      group.position.x += (aimX - group.position.x) * Math.min(1, dt * 14);
      group.position.y += (aimY - group.position.y) * Math.min(1, dt * 14);
      group.position.z = -0.55 + kick + dip * 0.12;
      group.rotation.x = kick * 1.6 + dip * 0.5;
      if (now > flashUntil && flashMat.opacity > 0) {
        flashMat.opacity = 0;
        flashLight.intensity = 0;
      }
    },
  };
}

// The match: the one place that owns game state and rules. Rounds, phases,
// the bomb, money and win conditions live here; the renderer, HUD and bots
// read this state and never keep their own copy of it.
import * as THREE from 'three';
import { SITES } from './map.js';
import { resetActor } from './actors.js';
import { createLoadout, WEAPONS, GRENADE_PRICE, ARMOR_PRICE } from './weapons.js';
import { assignRoles } from './bots.js';
import { pick, chance } from './rng.js';

export const BUY_TIME = 12;
export const ROUND_TIME = 100;
export const ROUND_END_TIME = 4.5;
export const BOMB_FUSE = 35;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 4;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 1400;
export const BOMB_WIN_REWARD = 1600;
export const LOSS_REWARD = 1000;

export function createMatch(actors, spawns) {
  const state = {
    phase: 'menu',
    phaseTime: 0,
    round: 0,
    wins: { atk: 0, def: 0 },
    roundHistory: [],
    bomb: {
      state: 'carried',
      carrier: null,
      pos: new THREE.Vector3(),
      site: null,
      fuse: 0,
      plant: 0,
      defuse: 0,
      planter: null,
      defuser: null,
    },
    events: [],
    killfeed: [],
    roundReason: '',
    matchWinner: null,
    lossStreak: { atk: 0, def: 0 },
    time: 0,
    beepAt: 0,
  };

  function aliveOf(team) {
    return actors.filter((a) => a.team === team && a.alive);
  }

  function siteAt(pos) {
    for (const key of Object.keys(SITES)) {
      const site = SITES[key];
      if (Math.abs(pos.x - site.x) <= site.halfX && Math.abs(pos.z - site.z) <= site.halfZ) return key;
    }
    return null;
  }

  function botBuy(actor) {
    const money = actor.money;
    if (money >= WEAPONS.marksman.price && actor.team === 'def' && chance(0.3)) {
      actor.money -= WEAPONS.marksman.price;
      actor.loadout.give('marksman');
    } else if (money >= WEAPONS.rifle.price) {
      actor.money -= WEAPONS.rifle.price;
      actor.loadout.give('rifle');
    } else if (money >= WEAPONS.smg.price) {
      actor.money -= WEAPONS.smg.price;
      actor.loadout.give('smg');
    }
    if (actor.money >= ARMOR_PRICE) {
      actor.money -= ARMOR_PRICE;
      actor.armor = 100;
    }
    if (actor.money >= GRENADE_PRICE && state.round > 1) {
      actor.money -= GRENADE_PRICE;
      actor.grenades = 1;
    }
  }

  function startRound() {
    state.round += 1;
    const atkSpawns = [...spawns.atk];
    const defSpawns = [...spawns.def];
    let atkIndex = 0;
    let defIndex = 0;
    for (const actor of actors) {
      const spawn = actor.team === 'atk' ? atkSpawns[atkIndex++] : defSpawns[defIndex++];
      const yaw = actor.team === 'atk' ? -Math.PI / 2 : Math.PI / 2;
      const survived = actor.alive && state.round > 1;
      resetActor(actor, spawn, yaw);
      if (!survived) {
        actor.loadout = createLoadout();
        actor.grenades = 0;
        actor.armor = 0;
        if (!actor.isPlayer) botBuy(actor);
      } else if (!actor.isPlayer && actor.grenades === 0 && actor.money >= GRENADE_PRICE) {
        actor.money -= GRENADE_PRICE;
        actor.grenades = 1;
      }
      actor.hasBomb = false;
      if (actor.bot) {
        actor.bot.state = 'wait';
        actor.bot.target = null;
        actor.bot.thrownGrenade = false;
        actor.bot.path.length = 0;
      }
    }
    assignRoles(actors);
    const attackers = actors.filter((a) => a.team === 'atk');
    const carrier = pick(attackers);
    carrier.hasBomb = true;
    state.bomb.state = 'carried';
    state.bomb.carrier = carrier;
    state.bomb.site = null;
    state.bomb.fuse = 0;
    state.bomb.plant = 0;
    state.bomb.defuse = 0;
    state.bomb.planter = null;
    state.bomb.defuser = null;
    state.killfeed.length = 0;
    state.phase = 'buy';
    state.phaseTime = BUY_TIME;
    state.events.push({ kind: 'roundStart', round: state.round });
  }

  function awardMoney(winner) {
    const loser = winner === 'atk' ? 'def' : 'atk';
    state.lossStreak[winner] = 0;
    state.lossStreak[loser] += 1;
    const lossBonus = Math.min(2000, LOSS_REWARD + (state.lossStreak[loser] - 1) * 500);
    for (const actor of actors) {
      if (actor.team === winner) {
        actor.money += state.roundReason === 'bomb' ? BOMB_WIN_REWARD : WIN_REWARD;
      } else {
        actor.money += lossBonus;
      }
      actor.money = Math.min(16000, actor.money);
    }
  }

  function endRound(winner, reason) {
    if (state.phase !== 'live') return;
    state.wins[winner] += 1;
    state.roundHistory.push(winner);
    state.roundReason = reason;
    awardMoney(winner);
    state.phase = 'roundEnd';
    state.phaseTime = ROUND_END_TIME;
    state.events.push({ kind: 'roundEnd', winner, reason, wins: { ...state.wins } });
  }

  function damageActor(victim, amount, part, attacker) {
    if (!victim.alive || state.phase !== 'live') return;
    let final = amount;
    if (victim.armor > 0) {
      final = Math.round(final * 0.5);
      victim.armor = Math.max(0, victim.armor - 25);
    }
    victim.hp -= final;
    victim.hitFlash = 1;
    if (victim.isPlayer) {
      state.events.push({ kind: 'playerHurt', from: attacker ? attacker.pos : null, amount: final });
    }
    if (victim.hp <= 0) {
      victim.hp = 0;
      victim.alive = false;
      victim.deaths += 1;
      victim.deathAt = state.time;
      victim.group.visible = !victim.isPlayer;
      if (attacker && attacker !== victim) {
        attacker.kills += 1;
        attacker.money = Math.min(16000, attacker.money + KILL_REWARD);
      }
      if (victim.hasBomb) {
        victim.hasBomb = false;
        state.bomb.state = 'dropped';
        state.bomb.carrier = null;
        state.bomb.pos.copy(victim.pos);
        state.events.push({ kind: 'bombDropped', pos: victim.pos.clone() });
      }
      state.killfeed.push({ killer: attacker, victim, part, time: state.time });
      if (state.killfeed.length > 5) state.killfeed.shift();
      state.events.push({ kind: 'kill', killer: attacker, victim, part });
    }
  }

  function update(dt, ctx) {
    state.time += dt;
    if (state.phase === 'buy') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) {
        state.phase = 'live';
        state.phaseTime = ROUND_TIME;
        state.events.push({ kind: 'roundLive' });
      }
      return;
    }
    if (state.phase === 'roundEnd') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) {
        const decided = state.wins.atk >= WIN_ROUNDS || state.wins.def >= WIN_ROUNDS || state.round >= MAX_ROUNDS;
        if (decided) {
          state.phase = 'matchEnd';
          state.matchWinner = state.wins.atk > state.wins.def ? 'atk' : 'def';
          state.events.push({ kind: 'matchEnd', winner: state.matchWinner });
        } else {
          startRound();
        }
      }
      return;
    }
    if (state.phase !== 'live') return;

    state.phaseTime -= dt;

    // Bomb pickup, plant and defuse.
    const bomb = state.bomb;
    if (bomb.state === 'dropped') {
      for (const actor of aliveOf('atk')) {
        if (Math.hypot(actor.pos.x - bomb.pos.x, actor.pos.z - bomb.pos.z) < 1.2) {
          actor.hasBomb = true;
          bomb.state = 'carried';
          bomb.carrier = actor;
          state.events.push({ kind: 'bombPickup', actor });
          break;
        }
      }
    }
    if (bomb.state === 'carried' && bomb.carrier && bomb.carrier.alive) {
      const site = siteAt(bomb.carrier.pos);
      const planting = ctx.isPlanting(bomb.carrier);
      if (site && planting) {
        if (bomb.planter !== bomb.carrier) {
          bomb.planter = bomb.carrier;
          bomb.plant = 0;
        }
        bomb.plant += dt;
        if (bomb.plant >= PLANT_TIME) {
          bomb.state = 'planted';
          bomb.site = site;
          bomb.fuse = BOMB_FUSE;
          bomb.pos.copy(bomb.carrier.pos);
          bomb.carrier.hasBomb = false;
          bomb.carrier = null;
          state.events.push({ kind: 'bombPlanted', site, pos: bomb.pos.clone() });
        }
      } else {
        bomb.planter = null;
        bomb.plant = 0;
      }
    }
    if (bomb.state === 'planted') {
      bomb.fuse -= dt;
      const interval = bomb.fuse > 20 ? 1 : bomb.fuse > 10 ? 0.5 : 0.25;
      if (state.time >= state.beepAt) {
        state.beepAt = state.time + interval;
        state.events.push({ kind: 'bombBeep', urgent: bomb.fuse <= 10 });
      }
      let defuser = null;
      for (const actor of aliveOf('def')) {
        if (Math.hypot(actor.pos.x - bomb.pos.x, actor.pos.z - bomb.pos.z) < 2.2 && ctx.isDefusing(actor)) {
          defuser = actor;
          break;
        }
      }
      if (defuser) {
        if (bomb.defuser !== defuser) {
          bomb.defuser = defuser;
          bomb.defuse = 0;
        }
        bomb.defuse += dt;
        if (bomb.defuse >= DEFUSE_TIME) {
          bomb.state = 'defused';
          state.events.push({ kind: 'bombDefused', actor: defuser });
          endRound('def', 'defuse');
          return;
        }
      } else {
        bomb.defuser = null;
        bomb.defuse = 0;
      }
      if (bomb.fuse <= 0) {
        bomb.state = 'exploded';
        state.events.push({ kind: 'bombExploded', pos: bomb.pos.clone() });
        for (const actor of actors) {
          if (!actor.alive) continue;
          const dist = Math.hypot(actor.pos.x - bomb.pos.x, actor.pos.z - bomb.pos.z);
          if (dist < 9) damageActor(actor, Math.round(220 * (1 - dist / 12)), 'blast', null);
        }
        endRound('atk', 'bomb');
        return;
      }
    }

    // Elimination and clock.
    if (aliveOf('def').length === 0) {
      endRound('atk', 'elimination');
      return;
    }
    if (aliveOf('atk').length === 0 && bomb.state !== 'planted') {
      endRound('def', 'elimination');
      return;
    }
    if (state.phaseTime <= 0 && bomb.state !== 'planted') {
      state.phaseTime = 0;
      endRound('def', 'time');
    }
  }

  return {
    state,
    aliveOf,
    siteAt,
    startRound,
    damageActor,
    update,
    startMatch() {
      state.wins.atk = 0;
      state.wins.def = 0;
      state.roundHistory.length = 0;
      state.round = 0;
      state.matchWinner = null;
      state.lossStreak.atk = 0;
      state.lossStreak.def = 0;
      for (const actor of actors) {
        actor.money = START_MONEY;
        actor.kills = 0;
        actor.deaths = 0;
        actor.alive = false; // forces a fresh loadout on the first round
      }
      startRound();
    },
    buy(actor, id) {
      if (state.phase !== 'buy') return false;
      if (id === 'armor') {
        if (actor.armor >= 100 || actor.money < ARMOR_PRICE) return false;
        actor.money -= ARMOR_PRICE;
        actor.armor = 100;
        return true;
      }
      if (id === 'grenade') {
        if (actor.grenades >= 2 || actor.money < GRENADE_PRICE) return false;
        actor.money -= GRENADE_PRICE;
        actor.grenades += 1;
        return true;
      }
      const def = WEAPONS[id];
      if (!def || actor.money < def.price || actor.loadout.has(id)) return false;
      actor.money -= def.price;
      actor.loadout.give(id);
      return true;
    },
  };
}

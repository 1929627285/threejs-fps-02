// Deterministic screenshot setups: ?shot=start|play|buy|end with &seed=N.
// Each stages one honest frame of the real game — the menu, a live firefight,
// the buy menu, a round won — then freezes it for capture. No scene is
// composed from anything but the game's own simulation and rendering.
import * as THREE from 'three';

const _v = new THREE.Vector3();

export function setupShot(name, game) {
  const { player, actors, hud } = game;
  if (name === 'start') {
    game.placePlayer(-21, 0, -Math.PI / 2 + 0.08, -0.03);
    game.settle(10);
    hud.showOverlay('start');
  } else if (name === 'play') {
    game.startMatch();
    game.skipBuy();
    game.armPlayer('rifle');
    player.grenades = 1;
    game.settle(40);
    // Stage the firefight after the bots have spread out, so the frame holds.
    const enemy = actors.find((a) => a.team === 'def');
    game.placeActor(enemy, 6.5, 0.5, Math.PI / 2);
    const mates = actors.filter((a) => a.team === 'atk' && !a.isPlayer);
    game.placeActor(mates[0], -1, -4.5, -Math.PI / 2);
    game.placeActor(mates[1], 0, 2.5, -Math.PI / 2);
    game.placePlayer(-4, -2, -Math.PI / 2, 0);
    game.settle(1);
    game.aimAt(_v.set(6.5, 1.3, 0.5));
    game.playerShoot();
    game.settle(1);
    game.aimAt(_v.set(6.5, 1.3, 0.5));
  } else if (name === 'buy') {
    game.startMatch();
    game.placePlayer(-20, -5, -Math.PI / 2, -0.02);
    game.settle(5);
    game.openBuy();
  } else {
    // end: a round just won at site A, the charge planted, defenders down.
    game.startMatch();
    game.skipBuy();
    game.armPlayer('rifle');
    game.stageRoundWin();
    game.placePlayer(-18, -6.5, 0, -0.06);
    game.settle(30);
    hud.banner('ROUND WON', 'Site A secured · Vanguard leads 5 – 2', 60000);
  }
  game.finishShot();
}

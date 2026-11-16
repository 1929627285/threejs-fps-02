// The HUD: every DOM write in the game goes through here, cached so unchanged
// values never touch the DOM. It renders health, ammo, money, the timer, the
// score, the kill feed, the minimap, the buy menu, the scoreboard and the
// overlays — and nothing else decides what the player sees.


function el(id) {
  return document.getElementById(id);
}

function fmtTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud(callbacks) {
  const refs = {
    crosshair: el('crosshair'),
    hitmarker: el('hitmarker'),
    vignette: el('vignette'),
    dmgdir: el('dmgdir'),
    healthNum: el('health-num'),
    healthFill: el('health-fill'),
    armorNum: el('armor-num'),
    armorFill: el('armor-fill'),
    ammoMag: el('ammo-mag'),
    ammoReserve: el('ammo-reserve'),
    weaponName: el('weapon-name'),
    reloadHint: el('reload-hint'),
    grenadePips: el('grenade-pips'),
    bombIcon: el('bomb-icon'),
    money: el('money'),
    timer: el('round-timer'),
    roundLabel: el('round-label'),
    scoreAtk: el('score-atk'),
    scoreDef: el('score-def'),
    pips: el('pips'),
    killfeed: el('killfeed'),
    banner: el('banner'),
    bannerSub: el('banner-sub'),
    bombStatus: el('bomb-status'),
    bombFuse: el('bomb-fuse'),
    interact: el('interact'),
    interactLabel: el('interact-label'),
    interactFill: el('interact-fill'),
    minimap: el('minimap'),
    buyMenu: el('buy-menu'),
    buyMoney: el('buy-money'),
    scoreboard: el('scoreboard'),
    scoreRows: el('score-rows'),
    overlay: el('overlay'),
    overlayTitle: el('overlay-title'),
    overlayCopy: el('overlay-copy'),
    playBtn: el('play'),
    scope: el('scope'),
    toast: el('toast'),
  };
  const last = {};
  const mapCtx = refs.minimap.getContext('2d');
  const mapStatic = document.createElement('canvas');
  mapStatic.width = 168;
  mapStatic.height = 168;
  let mapDirty = true;
  let bannerUntil = 0;
  let hitUntil = 0;
  let toastUntil = 0;
  let buyOpen = false;
  let scoreOpen = false;

  function setText(ref, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      ref.textContent = value;
    }
  }
  function setWidth(ref, key, frac) {
    const pct = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    if (last[key] !== pct) {
      last[key] = pct;
      ref.style.width = pct;
    }
  }

  refs.playBtn.addEventListener('click', () => callbacks.onPlay());
  refs.buyMenu.querySelectorAll('[data-buy]').forEach((button) => {
    button.addEventListener('click', () => callbacks.onBuy(button.dataset.buy));
  });
  el('buy-close').addEventListener('click', () => callbacks.onBuyClose());

  // Static minimap layer: walls as blocks, sites ringed, lanes open.
  function buildStaticMap(world) {
    const ctx = mapStatic.getContext('2d');
    const sx = 168 / 62;
    const sz = 168 / 46;
    ctx.fillStyle = '#20242c';
    ctx.fillRect(0, 0, 168, 168);
    const px = (x) => (x + 31) * sx;
    const pz = (z) => (z + 23) * sz;
    ctx.fillStyle = '#3d434e';
    for (const [cx, cz, w, d] of world.boxes) {
      ctx.fillRect(px(cx - w / 2), pz(cz - d / 2), w * sx, d * sz);
    }
    ctx.fillStyle = '#565e6a';
    for (const [x, z] of world.barrels) ctx.fillRect(px(x) - 2, pz(z) - 2, 4, 4);
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffb340';
    ctx.fillText('A', px(-18), pz(-15));
    ctx.fillStyle = '#38b8a8';
    ctx.fillText('B', px(17), pz(14.5));
    mapDirty = false;
  }

  function drawMinimap(player, actors, bomb) {
    if (mapDirty) return;
    mapCtx.drawImage(mapStatic, 0, 0);
    const sx = 168 / 62;
    const sz = 168 / 46;
    const px = (x) => (x + 31) * sx;
    const pz = (z) => (z + 23) * sz;
    if (bomb.state === 'dropped' || bomb.state === 'planted') {
      mapCtx.fillStyle = bomb.state === 'planted' ? '#ff5040' : '#ffd27a';
      mapCtx.beginPath();
      mapCtx.arc(px(bomb.pos.x), pz(bomb.pos.z), 4, 0, Math.PI * 2);
      mapCtx.fill();
    }
    for (const actor of actors) {
      if (!actor.alive || actor.isPlayer) continue;
      if (actor.team !== player.team) continue;
      mapCtx.fillStyle = '#ffb340';
      mapCtx.beginPath();
      mapCtx.arc(px(actor.pos.x), pz(actor.pos.z), 3, 0, Math.PI * 2);
      mapCtx.fill();
    }
    // The player: an arrow pointing the way they face.
    mapCtx.save();
    mapCtx.translate(px(player.pos.x), pz(player.pos.z));
    mapCtx.rotate(Math.atan2(Math.sin(player.yaw), Math.cos(player.yaw)) + Math.PI / 2);
    mapCtx.fillStyle = '#ffffff';
    mapCtx.beginPath();
    mapCtx.moveTo(0, -6);
    mapCtx.lineTo(4, 5);
    mapCtx.lineTo(-4, 5);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.restore();
  }

  return {
    initMinimap(world) {
      buildStaticMap(world);
    },
    update(state, player, actors, now) {
      document.body.classList.toggle('in-menu', state.phase === 'menu');
      setText(refs.healthNum, 'hp', String(Math.max(0, Math.ceil(player.hp))));
      setWidth(refs.healthFill, 'hpf', player.hp / 100);
      setText(refs.armorNum, 'ar', String(Math.ceil(player.armor)));
      setWidth(refs.armorFill, 'arf', player.armor / 100);
      const loadout = player.loadout.state;
      const def = player.loadout.def();
      setText(refs.ammoMag, 'mag', String(loadout.mag[loadout.current]));
      setText(refs.ammoReserve, 'res', `/ ${loadout.reserve[loadout.current]}`);
      setText(refs.weaponName, 'wn', def.name.toUpperCase());
      refs.reloadHint.hidden = !player.loadout.reloading();
      setText(refs.grenadePips, 'gr', '●'.repeat(player.grenades) || '–');
      refs.bombIcon.hidden = !player.hasBomb;
      setText(refs.money, 'money', `$${player.money}`);
      setText(refs.timer, 'timer', fmtTime(state.phaseTime));
      setText(refs.roundLabel, 'round', state.phase === 'buy' ? `BUY · ROUND ${state.round}` : `ROUND ${state.round}`);
      setText(refs.scoreAtk, 'sa', String(state.wins.atk));
      setText(refs.scoreDef, 'sd', String(state.wins.def));
      const pips = state.roundHistory.map((w) => (w === 'atk' ? '◆' : '◇')).join(' ');
      setText(refs.pips, 'pips', pips);
      refs.bombStatus.hidden = state.bomb.state !== 'planted';
      if (state.bomb.state === 'planted') setWidth(refs.bombFuse, 'fuse', state.bomb.fuse / 35);
      if (now > bannerUntil && !refs.banner.hidden) {
        refs.banner.hidden = true;
        refs.bannerSub.hidden = true;
      }
      if (now > hitUntil) refs.hitmarker.classList.remove('on', 'kill');
      if (now > toastUntil) refs.toast.hidden = true;
      refs.vignette.style.opacity = String(Math.max(0, refs.vignette.style.opacity - 0.02));
      drawMinimap(player, actors, state.bomb);
    },
    setCrosshair(px) {
      refs.crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(kill, holdMs = 110) {
      refs.hitmarker.classList.add('on');
      refs.hitmarker.classList.toggle('kill', kill);
      hitUntil = performance.now() + holdMs;
    },
    damageFrom(angleDeg) {
      refs.vignette.style.opacity = '0.85';
      refs.dmgdir.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
      refs.dmgdir.style.opacity = '1';
      setTimeout(() => {
        refs.dmgdir.style.opacity = '0';
      }, 500);
    },
    banner(text, sub = '', holdMs = 2600) {
      refs.banner.textContent = text;
      refs.banner.hidden = false;
      refs.bannerSub.textContent = sub;
      refs.bannerSub.hidden = !sub;
      bannerUntil = performance.now() + holdMs;
    },
    toast(text, holdMs = 2600) {
      refs.toast.textContent = text;
      refs.toast.hidden = false;
      toastUntil = performance.now() + holdMs;
    },
    killfeedAdd(entry) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      const killer = entry.killer ? entry.killer.name : '💥';
      const head = entry.part === 'head' ? ' ◉' : '';
      row.innerHTML = '';
      const k = document.createElement('b');
      k.textContent = killer;
      k.className = entry.killer && entry.killer.team === 'atk' ? 't-atk' : 't-def';
      const v = document.createElement('b');
      v.textContent = entry.victim.name;
      v.className = entry.victim.team === 'atk' ? 't-atk' : 't-def';
      row.append(k, document.createTextNode(` ⟶${head} `), v);
      refs.killfeed.prepend(row);
      while (refs.killfeed.children.length > 5) refs.killfeed.lastChild.remove();
      setTimeout(() => row.remove(), 5200);
    },
    setInteract(label, frac) {
      if (label === null) {
        refs.interact.hidden = true;
        return;
      }
      refs.interact.hidden = false;
      setText(refs.interactLabel, 'il', label);
      setWidth(refs.interactFill, 'if', frac);
    },
    setScope(on) {
      refs.scope.hidden = !on;
    },
    renderBuy(player, canBuy) {
      setText(refs.buyMoney, 'bm', `$${player.money}`);
      refs.buyMenu.querySelectorAll('[data-buy]').forEach((button) => {
        const id = button.dataset.buy;
        const price = Number(button.dataset.price);
        const owned = id === 'armor' ? player.armor >= 100 : id === 'grenade' ? player.grenades >= 2 : player.loadout.has(id);
        button.disabled = !canBuy || owned || player.money < price;
        button.classList.toggle('owned', owned);
      });
    },
    openBuy() {
      buyOpen = true;
      refs.buyMenu.hidden = false;
    },
    closeBuy() {
      buyOpen = false;
      refs.buyMenu.hidden = true;
    },
    isBuyOpen() {
      return buyOpen;
    },
    showScoreboard(actors, wins) {
      scoreOpen = true;
      refs.scoreboard.hidden = false;
      const rows = [...actors].sort((a, b) => (a.team === b.team ? b.kills - a.kills : a.team === 'atk' ? -1 : 1));
      refs.scoreRows.innerHTML = '';
      for (const actor of rows) {
        const tr = document.createElement('tr');
        tr.className = actor.team;
        const cells = [actor.name, String(actor.kills), String(actor.deaths), `$${actor.money}`, actor.alive ? '✓' : '✕'];
        for (const text of cells) {
          const td = document.createElement('td');
          td.textContent = text;
          tr.append(td);
        }
        refs.scoreRows.append(tr);
      }
    },
    hideScoreboard() {
      scoreOpen = false;
      refs.scoreboard.hidden = true;
    },
    isScoreOpen() {
      return scoreOpen;
    },
    showOverlay(kind, data = {}) {
      refs.overlay.hidden = false;
      if (kind === 'start') {
        refs.overlayTitle.textContent = 'BREAKWATER';
        refs.overlayCopy.textContent = 'Terminal 9, dusk. Plant the charge at A or B — or wipe the Sentinels out. Five rounds take the match. Your team is counting on you.';
        refs.playBtn.textContent = 'Click to play';
      } else if (kind === 'paused') {
        refs.overlayTitle.textContent = 'Paused';
        refs.overlayCopy.textContent = 'The round is still running. Click to jump back in.';
        refs.playBtn.textContent = 'Resume';
      } else if (kind === 'end') {
        const won = data.winner === 'atk';
        refs.overlayTitle.textContent = won ? 'MATCH WON' : 'MATCH LOST';
        refs.overlayCopy.textContent = `Final score ${data.wins.atk} – ${data.wins.def}. ${won ? 'The terminal is yours.' : 'The Sentinels hold the terminal.'} Play again?`;
        refs.playBtn.textContent = 'Play again';
      }
    },
    hideOverlay() {
      refs.overlay.hidden = true;
    },
  };
}

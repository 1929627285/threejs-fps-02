// Procedural sound: every effect is synthesized with WebAudio, no audio
// assets. Gunshots are filtered noise bursts, the bomb ticks are short sine
// pips, and distance attenuates volume and brightness.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return false;
    }
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function noise(dur, filterFreq, gain, when = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t, Math.random() * 0.2, dur);
    src.stop(t + dur);
  }

  function tone(freq, dur, gain, type = 'sine', slideTo = 0, when = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur);
  }

  function atten(dist) {
    return 1 / (1 + dist * 0.09);
  }

  return {
    ensure,
    toggleMute() {
      muted = !muted;
      return muted;
    },
    shoot(kind, dist) {
      const a = atten(dist);
      if (kind === 'marksman') {
        noise(0.22, 900 + 2400 * a, 0.7 * a);
        tone(90, 0.18, 0.5 * a, 'sine', 40);
      } else if (kind === 'sidearm') {
        noise(0.1, 1400 + 2000 * a, 0.45 * a);
        tone(140, 0.08, 0.25 * a, 'sine', 60);
      } else {
        noise(0.12, 1100 + 2200 * a, 0.55 * a);
        tone(110, 0.1, 0.3 * a, 'sine', 50);
      }
    },
    dry() {
      tone(1800, 0.04, 0.12, 'square');
    },
    reload() {
      tone(700, 0.05, 0.15, 'square');
      tone(500, 0.05, 0.15, 'square', 0, 0.35);
      tone(900, 0.06, 0.18, 'square', 0, 0.7);
    },
    hit(kill) {
      tone(kill ? 1320 : 1040, 0.06, 0.2, 'sine');
      if (kill) tone(1560, 0.09, 0.2, 'sine', 0, 0.07);
    },
    hurt() {
      tone(160, 0.12, 0.3, 'sine', 70);
    },
    explosion(dist) {
      const a = atten(dist * 0.6);
      noise(0.9, 500 + 900 * a, 0.9 * a);
      tone(120, 0.8, 0.7 * a, 'sine', 28);
    },
    beep(freq = 1560) {
      tone(freq, 0.07, 0.16, 'sine');
    },
    plantTick() {
      tone(1200, 0.05, 0.14, 'sine');
    },
    roundWin(win) {
      if (win) {
        tone(523, 0.12, 0.2, 'triangle');
        tone(659, 0.12, 0.2, 'triangle', 0, 0.12);
        tone(784, 0.22, 0.22, 'triangle', 0, 0.24);
      } else {
        tone(392, 0.14, 0.2, 'triangle');
        tone(330, 0.14, 0.2, 'triangle', 0, 0.14);
        tone(262, 0.26, 0.2, 'triangle', 0, 0.28);
      }
    },
    buy() {
      tone(880, 0.06, 0.15, 'sine');
      tone(1174, 0.08, 0.15, 'sine', 0, 0.06);
    },
    denied() {
      tone(220, 0.12, 0.18, 'square');
    },
    step() {
      noise(0.05, 500, 0.06);
    },
    throwWhoosh() {
      noise(0.18, 1800, 0.12);
    },
  };
}

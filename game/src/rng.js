// One seeded RNG for the whole simulation. Live play seeds from the clock; the
// screenshot setups seed from the URL, so a capture replays exactly. Every
// random choice in the game (spread, bot decisions, spawns) goes through here.
let s = 1;

export function seedRandom(n) {
  s = (n >>> 0) || 1;
}

export function random() {
  s |= 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function range(a, b) {
  return a + (b - a) * random();
}

export function pick(list) {
  return list[Math.floor(random() * list.length)];
}

export function chance(p) {
  return random() < p;
}

export function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

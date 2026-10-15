// Animal sprites from a spec, for the cast that isn't people: a dog at someone's heels, a
// cat on a wall, a pigeon in the square, a bee in a garden. A doll spec with `creature`
// comes here (engine/doll.js) and gives back the same shape a person does, so walking,
// running, poses, routes, companions and modes work with nothing else.
//
//   doll({ creature: 'dog' | 'cat' | 'bird' | 'bee' | 'horse', fur, markings, eyes, nose,
//          wings, legs, mane, outline })
//
// fur: the main colour (a corgi's orange, a black cat, a grey pigeon, a bee's yellow).
// markings: the second colour — a dog's or a cat's muzzle, chest, belly and socks, a
//   bird's breast, a bee's stripes (default: a light tint of the fur; black for a bee).
// nose: a dog's or a cat's nose, a bird's beak. wings: a bee's wings.
// legs: 'short' (a corgi, a dachshund): the body one pixel nearer the ground.
// A horse is two cells long seen from the side (32×24; 16×24 from the front and the
//   back): markings are its blaze and socks (default white), mane its mane and tail
//   (default a dark shade of the fur), nose its hooves and nostrils. It walks, gallops,
//   lies down, sleeps and blinks; it doesn't sit.
//
// Every one has 4 directions × 3 walking frames and 3 running ones. Dogs and cats also
// sit, lie, sleep and blink; birds hop when they walk and flap when they fly; a bee is
// always in the air, its wings beating even when it hangs still. Give birds and bees
// `mode: 'fly'` on the map's actor (README "Getting about") to have them fly over things.
// They are small: `shadow` (pixels) and `idle`/`flap` (frames that loop) tell the world
// how to draw them.
import { tint, mix } from './gfx.js';

const W = 16;
const H = 24;
const EMPTY = '.'.repeat(W);

// A front or back view drawn as its left half: the right half is the same, mirrored.
const sym = (rows) => rows.map((r) => r + [...r].reverse().join(''));
// Stand the rows on the bottom of the frame (`up` pixels off it).
const ground = (rows, up = 0) => [...Array(H - rows.length - up).fill(EMPTY), ...rows, ...Array(up).fill(EMPTY)];
const swap = (rows, from, to) => rows.map((r) => r.replaceAll(from, to));

function put(row, x, s, w = W) {
  const a = row.split('');
  for (let i = 0; i < s.length; i++) if (s[i] !== ' ' && x + i >= 0 && x + i < w) a[x + i] = s[i];
  return a.join('');
}

// The legs under a side view: the belly line from x0 to x1 with the top of each leg in
// it, a row of leg (none for short legs) and the feet. df/db move the front and back
// foot (a step, a stride); a leg lifted off the ground (lift) loses its lowest row.
function sideLegs({ x0, x1, front, back, fc, bc, short }, { df = 0, db = 0, lift = null } = {}) {
  let attach = put(EMPTY, x0, 'o'.repeat(x1 - x0 + 1));
  attach = put(put(attach, front, fc), back, bc);
  const rows = short ? [] : [EMPTY];
  rows.push(EMPTY);
  for (const [x, c, k] of [[front + df, fc, 'f'], [back + db, bc, 'b']]) {
    const n = rows.length - (lift === k ? 1 : 0);
    for (let i = 0; i < n - 1; i++) rows[i] = put(rows[i], x - 1, `o${c}o`);
    if (n > 0) rows[n - 1] = put(rows[n - 1], x - 1, 'ooo');
  }
  return [attach, ...rows];
}

// The legs under a front or back view: the same, both legs mirrored about the middle.
function frontLegs({ x0, lc, c, short }, lift = null) {
  const x1 = W - 1 - x0;
  let attach = put(EMPTY, x0, 'o'.repeat(x1 - x0 + 1));
  attach = put(put(attach, lc, c), W - 1 - lc, c);
  const rows = short ? [EMPTY] : [EMPTY, EMPTY];
  for (const [x, k] of [[lc, 'l'], [W - 1 - lc, 'r']]) {
    const n = rows.length - (lift === k ? 1 : 0);
    for (let i = 0; i < n - 1; i++) rows[i] = put(rows[i], x - 1, `o${c}o`);
    if (n > 0) rows[n - 1] = put(rows[n - 1], x - 1, 'ooo');
  }
  return [attach, ...rows];
}

// ---------- dog ----------

const DOG = {
  side: [
    '...o.o..........',
    '..oHoHo.........',
    '..oHHHHo........',
    '.oHEHHHo........',
    'oFSHHHHHoooooo..',
    '.oSSHHHHHHHHHHo.',
    '..ooSHHHHHHHHHo.',
    '...oSSHHHHHHHHo.',
    '...oSSSSSSSSSHo.',
  ],
  sideLegs: { x0: 3, x1: 13, front: 4, back: 12, fc: 'S', bc: 'H' },
  front: sym([
    '....o...',
    '...oHo..',
    '...oHHoo',
    '..oHHHHH',
    '..oHHEHH',
    '..oHHHSS',
    '...oSSSF',
    '....oSSS',
    '...oHSSS',
    '...oHSSS',
  ]),
  back: sym([
    '....o...',
    '...oHo..',
    '...oHHoo',
    '..oHHHHH',
    '..oHHHHH',
    '..oHHHHH',
    '...oHHHH',
    '....ohHH',
    '...oHHHH',
    '...oHHHH',
  ]),
  frontLegs: { x0: 3, lc: 4 },
  sit: [
    '...o.o..........',
    '..oHoHo.........',
    '..oHHHHo........',
    '.oHEHHHo........',
    'oFSHHHHHo.......',
    '.oSSHHHHo.......',
    '..ooSHHHHo......',
    '...oSSHHHHo.....',
    '...oSSHHHHHo....',
    '...oSSHHHHHHo...',
    '...oSoHHHHHHo...',
    '...oSooHHHHo....',
    '...ooo.ooooo....',
  ],
  sitFront: sym(['...oSoSS', '..oHSoSS', '..oooooo']),
  sitBack: sym(['..oHHHHH', '..oHHHHH', '..oooooo']),
  lie: [
    '...o.o..........',
    '..oHoHo.........',
    '.oHEHHHoooooooo.',
    'oFSHHHHHHHHHHHHo',
    '.oSSSHHHHHHHHHHo',
    'ooSSSSSSSSSSSHo.',
    'oooooooooooooo..',
  ],
};

// ---------- cat ----------

const CAT = {
  side: [
    '..o.o...........',
    '.oHoHo......oo..',
    '.oHHHHo....oHo..',
    'oHEHHHo....oHo..',
    'oSFHHHoooooHHo..',
    '.oSSHHHHHHHHHo..',
    '..oSHHHHHHHHo...',
    '..oSSHHHHHHHo...',
  ],
  sideLegs: { x0: 2, x1: 12, front: 3, back: 11, fc: 'S', bc: 'H' },
  front: sym([
    '...o....',
    '...oHooo',
    '...oHHHH',
    '...oHEHH',
    '...oHHSF',
    '....oSSS',
    '...oHSSS',
    '...oHSSS',
  ]),
  back: sym([
    '...o....',
    '...oHooo',
    '...oHHHH',
    '...oHHHH',
    '...oHHHH',
    '....ohHH',
    '...oHHHH',
    '...oHHHH',
  ]),
  frontLegs: { x0: 3, lc: 4 },
  sit: [
    '..o.o...........',
    '.oHoHo..........',
    '.oHHHHo.........',
    'oHEHHHo.........',
    'oSFHHHo.........',
    '.oSSHHo.........',
    '..oSHHHo........',
    '..oSSHHHo.......',
    '..oSSHHHHo......',
    '..oSoHHHHo......',
    '..oSooHHHHoooo..',
    '..ooo.ooooHHHHo.',
    '..........oooo..',
  ],
  sitFront: sym(['...oSoSS', '..oHSoSS', '..oooooo']),
  sitBack: sym(['..oHHHHH', '..oHHHHH', '..oooooo']),
  lie: [
    '..o.o...........',
    '.oHoHo..........',
    'oHEHHHooooooo...',
    'oSFHHHHHHHHHHo..',
    '.oSSSHHHHHHHHHoo',
    'ooSSSSSSSSHHHHHo',
    'oooooooooooooooo',
  ],
};

// Dogs and cats: four legs, the same frames.
function quadruped(art, spec) {
  const short = spec.legs === 'short';
  const sl = { ...art.sideLegs, short };
  const fl = (c) => ({ ...art.frontLegs, c, short });
  const side = (o) => ground([...art.side, ...sideLegs(sl, o)]);
  const front = (lift) => ground([...art.front, ...frontLegs(fl('S'), lift)]);
  const back = (lift) => ground([...art.back, ...frontLegs(fl('H'), lift)]);
  const frames = {
    left: [side(), side({ df: -1, db: 1 }), side({ df: 1, db: -1 })],
    down: [front(), front('l'), front('r')],
    up: [back(), back('l'), back('r')],
  };
  // running: the legs flung apart, then gathered under the belly in the air
  const air = ground([...art.side, ...sideLegs({ ...sl, short: true }, { df: 1, db: -1 })], 1);
  const run = {
    left: [side({ df: -2, db: 2 }), air, side({ df: 1, db: -1, lift: 'b' })],
    down: [front('l'), ground(front().slice(-H + 1), 1), front('r')],
    up: [back('l'), ground(back().slice(-H + 1), 1), back('r')],
  };
  const lie = ground(art.lie);
  const poses = {
    sit: { left: ground(art.sit), down: ground([...art.front, ...art.sitFront]), up: ground([...art.back, ...art.sitBack]) },
    lie: { left: lie, down: lie, up: lie },
    sleep: { left: swap(lie, 'E', 'H'), down: swap(lie, 'E', 'H'), up: swap(lie, 'E', 'H') },
    blink: { left: swap(frames.left[0], 'E', 'H'), down: swap(frames.down[0], 'E', 'H') },
  };
  return { frames, run, poses, shadow: 12 };
}

// ---------- bird ----------

const BIRD = {
  side: [
    '....ooo.........',
    '...oHHHo........',
    '.FFoEHHHo.......',
    '...oHHHHoooo....',
    '...oSSHHHHHHoo..',
    '....oSShhhhHHHo.',
    '.....oSSSShhoo..',
    '......oooooo....',
    '.......F..F.....',
  ],
  front: sym([
    '......oo',
    '.....oHH',
    '....oHEH',
    '....oHHF',
    '....oSSS',
    '...ohSSS',
    '...ohSSS',
    '....oooo',
    '......F.',
  ]),
  back: sym([
    '......oo',
    '.....oHH',
    '....oHHH',
    '....oHHH',
    '....oHHH',
    '...ohhHH',
    '...ohhHH',
    '....oooo',
    '......F.',
  ]),
  // in the air: wings up, then down
  flySide: [
    [
      '.......oo.......',
      '......ohho......',
      '....oooohho.....',
      '...oHHHohho.....',
      '.FFoEHHHoooooo..',
      '...oHHHHHHHHHo..',
      '....oSSSHHHHoo..',
      '.....oooooooo...',
    ],
    [
      '....ooo.........',
      '...oHHHo........',
      '.FFoEHHHoooooo..',
      '...oHHHHhhhHHo..',
      '....oSShhhhoo...',
      '.....oohhho.....',
      '......oohho.....',
      '........oo......',
    ],
  ],
  flyFront: [
    sym(['......oo', '.....oHH', 'oo..oHEH', 'ohhooHHF', '.ohhhSSS', '..oohSSS', '....oooo']),
    sym(['......oo', '.....oHH', '....oHEH', '...ooHHF', '..ohhSSS', '.ohhoSSS', '.oo.oooo']),
  ],
  flyBack: [
    sym(['......oo', '.....oHH', 'oo..oHHH', 'ohhooHHH', '.ohhhHHH', '..oohHHH', '....oooo']),
    sym(['......oo', '.....oHH', '....oHHH', '...ooHHH', '..ohhHHH', '.ohhoHHH', '.oo.oooo']),
  ],
};

function bird() {
  // walking is hopping: the whole bird a pixel up, then down
  const hop = (rows) => [ground(rows), ground(rows.slice(0, -1), 2), ground(rows)];
  const frames = { left: hop(BIRD.side), down: hop(BIRD.front), up: hop(BIRD.back) };
  const fly = (pair) => pair.map((r) => ground(r, 3));
  const flap = { left: fly(BIRD.flySide), down: fly(BIRD.flyFront), up: fly(BIRD.flyBack) };
  const run = { left: frames.left, down: frames.down, up: frames.up };
  const poses = {
    fly: { left: flap.left[0], down: flap.down[0], up: flap.up[0] },
    blink: { left: swap(frames.left[0], 'E', 'H'), down: swap(frames.down[0], 'E', 'H') },
  };
  return { frames, run, poses, flap, shadow: 6 };
}

// ---------- bee ----------

const BEE = {
  side: [
    [
      '.....oo.oo......',
      '....oWWoWWo.....',
      '.....oWooWo.....',
      '..oooooooo......',
      '.oSHHSHHSo......',
      '.oSHHSHHSoo.....',
      '..oooooooo......',
    ],
    [
      '................',
      '................',
      '....ooooooo.....',
      '..oooWWWWWoo....',
      '.oSHHSHHSo......',
      '.oSHHSHHSoo.....',
      '..oooooooo......',
    ],
  ],
  front: [
    sym(['...oo...', '..oWWooo', '..oWooSS', '...ooHHH', '....oSSS', '....oHHH', '.....ooo']),
    sym(['........', '.....ooo', '...oooSS', '.oWWoHHH', '..oooSSS', '....oHHH', '.....ooo']),
  ],
};

function bee() {
  // it hangs in the air even on the ground: lifted off its shadow
  const up = 7;
  const left = BEE.side.map((r) => ground(r, up));
  const down = BEE.front.map((r) => ground(r, up));
  const frames = { left: [left[0], left[1], left[0]], down: [down[0], down[1], down[0]], up: [down[0], down[1], down[0]] };
  const flap = { left, down, up: down };
  const run = frames;
  return { frames, run, poses: { fly: { left: left[0], down: down[0], up: down[0] } }, flap, idle: flap, shadow: 4 };
}

// ---------- horse ----------
//
// Seen from the side it is two cells long (32 pixels wide, centred on its cell like any
// sprite); from the front and the back, one. M is the mane and tail, S the blaze and the
// socks, F the hooves and the nostrils.

const HW = 32;
const HORSE = {
  side: [
    '.....o.o',
    '....oHoHo',
    '....oHHHMo',
    '...oHEHHMMo',
    '..oHHHHHHMMo',
    '.oHHHHoHHHMMo',
    'oHHHHo.oHHHMMo',
    'oSHHo...oHHHMMoooooooooooo',
    'oFSo....oHHHHHHHHHHHHHHHHHoo',
    '.oo.....oHHHHHHHHHHHHHHHHHHHoo',
    '........oHHHHHHHHHHHHHHHHHHHoMo',
    '........oHHHHHHHHHHHHHHHHHHHoMMo',
    '.........oHHHHHHHHHHHHHHHHHHoMMo',
    '.........ohHHHHHHHHHHHHHHHHhoMMo',
    '..........ohhhhhhhhhhhhhhhhooMo',
  ],
  // the near and far leg of each pair, under the belly
  legs: [12, 15, 23, 26],
  front: [
    '...o........o...',
    '..oHo......oHo..',
    '..oHHooooooHHo..',
    '...oHHMMMMHHo...',
    '..oHEHHMMHHEHo..',
    '...oHHHHHHHHo...',
    '..ooHHHSSHHHoo..',
    '.oHHoHHSSHHoHHo.',
    '.oHHHoHSSHoHHHo.',
    'oHHHHoSSSSoHHHHo',
    'oHHHHoFSSFoHHHHo',
    'oHHHHHoooooHHHHo',
    '.oHHHHHHHHHHHHo.',
    '..ohHHHHHHHHho..',
    '...oooooooooo...',
  ],
  back: [
    '...o........o...',
    '..oHo......oHo..',
    '..oHHooooooHHo..',
    '...oHHMMMMHHo...',
    '...oHHHMMHHHo...',
    '....oHHMMHHo....',
    '..oooHHMMHHooo..',
    '.oHHHHHMMHHHHHo.',
    'oHHHHHHHHHHHHHHo',
    'oHHHHHHHHHHHHHHo',
    'oHHHHHHoMoHHHHHo',
    'oHHHHHoMMMoHHHHo',
    '.oHHHHoMMMoHHHo.',
    '..ohHHoMMMoHho..',
    '...ooooMMMoooo..',
  ],
};

// Legs of `n` rows (the last two a sock and a hoof) at the given centres; a lifted leg is
// a row shorter. `extra` rows are drawn between the legs (the tail from behind).
function horseLegs(w, xs, { lift = [], n = 6, extra = [] } = {}) {
  const rows = Array.from({ length: n }, () => '.'.repeat(w));
  extra.forEach(([x, s], j) => { rows[j] = put(rows[j], x, s, w); });
  xs.forEach((x, i) => {
    const len = lift.includes(i) ? n - 1 : n;
    for (let j = 0; j < len - 1; j++) rows[j] = put(rows[j], x - 1, j === len - 3 ? 'oSo' : j === len - 2 ? 'oFo' : 'oHo', w);
    rows[len - 1] = put(rows[len - 1], x - 1, 'ooo', w);
  });
  return rows;
}

function horse() {
  const pad = (rows, w) => rows.map((r) => r.padEnd(w, '.'));
  const side = pad(HORSE.side, HW);
  const [a, b, c, d] = HORSE.legs;
  const groundW = (rows, w, up = 0) => [...Array(H - rows.length - up).fill('.'.repeat(w)), ...rows, ...Array(up).fill('.'.repeat(w))];
  const sideAt = (xs, o = {}, up = 0) => groundW([...side, ...horseLegs(HW, xs, o)], HW, up);
  // a walk: each diagonal pair steps in turn
  const left = [sideAt([a, b, c, d]), sideAt([a - 1, b + 1, c + 1, d - 1], { lift: [0, 3] }), sideAt([a + 1, b - 1, c - 1, d + 1], { lift: [1, 2] })];
  const fl = (lift) => horseLegs(W, [4, 11], { lift });
  const down = [0, 1, 2].map((k) => groundW([...HORSE.front, ...fl(k === 1 ? [0] : k === 2 ? [1] : [])], W));
  const tail = [[7, 'oMo'], [7, 'oMo'], [8, 'o']];
  const up = [0, 1, 2].map((k) => groundW([...HORSE.back, ...horseLegs(W, [4, 11], { lift: k === 1 ? [1] : k === 2 ? [0] : [], extra: tail })], W));
  // the gallop: legs flung out front and back, then gathered under it in the air
  const run = {
    left: [sideAt([a - 2, b - 1, c + 2, d + 3], { lift: [0, 3] }), sideAt([a + 1, b + 2, c - 2, d - 1], { lift: [0, 1, 2, 3], n: 5 }, 1), sideAt([a - 1, b - 2, c + 3, d + 2], { lift: [1, 2] })],
    down: [down[1], groundW(down[0].slice(-H + 1), W, 1), down[2]],
    up: [up[1], groundW(up[0].slice(-H + 1), W, 1), up[2]],
  };
  const lie = groundW([...side, pad(['..........oHHHHHo....oHHHHHHo', '..........ooooooo....oooooooo'], HW)].flat(), HW);
  const poses = {
    lie: { left: lie, down: lie, up: lie },
    sleep: { left: swap(lie, 'E', 'H'), down: swap(lie, 'E', 'H'), up: swap(lie, 'E', 'H') },
    blink: { left: swap(left[0], 'E', 'H'), down: swap(down[0], 'E', 'H') },
  };
  return { frames: { left, down, up }, run, poses, shadow: 14 };
}

export const CREATURES = ['dog', 'cat', 'bird', 'bee', 'horse'];

// Every frame as rows of palette keys (right is drawn by mirroring left).
export function creatureRows(spec) {
  switch (spec.creature) {
    case 'dog': return quadruped(DOG, spec);
    case 'cat': return quadruped(CAT, spec);
    case 'bird': return bird(spec);
    case 'bee': return bee(spec);
    case 'horse': return horse(spec);
    default: throw new Error(`unknown creature: ${spec.creature} (the engine draws ${CREATURES.join(', ')}; any other animal is a doll the cartridge builds itself: { frames, … } in game.dolls is used as it is)`);
  }
}

const dark = (c, t) => mix(c, '#1a1838', t * 1.1);
const lit = (c, t) => mix(c, '#fff4d8', t);

export function creaturePalette(spec) {
  const kind = spec.creature;
  const fur = spec.fur || { dog: '#a87038', cat: '#686470', bird: '#8a8a94', bee: '#e8b828', horse: '#8a5a34' }[kind];
  const marks = spec.markings || (kind === 'bee' ? '#2a2018' : tint(fur, 0.6));
  const nose = spec.nose || (kind === 'bird' ? '#d89838' : kind === 'cat' ? '#d88890' : '#201818');
  return {
    o: spec.outline || '#1a1826',
    H: fur, h: dark(fur, 0.28), I: lit(fur, 0.25),
    S: marks, s: dark(marks, 0.22),
    E: spec.eyes || '#1c1814',
    F: nose,
    W: spec.wings || '#e4eef8',
    ...(kind === 'horse' ? { M: spec.mane || dark(fur, 0.55), F: spec.nose || '#2a2420', S: spec.markings || '#ece4d8' } : {}),
  };
}

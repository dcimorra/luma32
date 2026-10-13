// Character sprites from a spec: one hand-drawn body in three poses per direction,
// with layers for hair, coats and glasses painted on top. A cartridge describes its
// cast in a few lines instead of shipping sprite sheets.
//
//   doll({ skin, hair, hairStyle, top, shirt, tie, bottom, shoes, coat, dress, glasses, earpiece,
//          stripe, hat, hatColor, ears, beard, beardColor, mask, maskColor, earShape })
//   -> { w: 16, h: 24, frames: { down: [stand, stepA, stepB], up, left, right },
//        run: { down: [strideA, air, strideB], … }, poses }
//
// hairStyle: short slick bald receding bob long bun buzz wavy curly mop bangs ponytail
//   (wavy: shoulder-length with volume; curly: short tight curls; mop: curls falling over
//   the forehead; bangs: shoulder-length with a straight fringe; ponytail: pulled back,
//   the tail shows from behind and the side; buzz: close-cropped).
// stripe: a colour; a band across the sleeves and chest of the top (sports jerseys).
// hat: 'cap' | 'beanie' | 'top' | 'helmet', painted in hatColor (default: the top's colour).
// ears: a colour; a pair of costume animal ears on a headband.
// beard: 'stubble' | 'moustache' | 'full', in beardColor (default: the hair's colour).
// mask: 'domino' (a band across the eyes) | 'full' (the whole face), in maskColor
//   (default gold). It repaints skin only, so hair, beards and hats stay on top; eyes show.
// earShape: 'pointed' (elves, fae): long ears out past the head, through any hair.
// creature: 'dog' | 'cat' | 'bird' | 'bee': an animal instead of a person, with its own
//   keys (fur, markings, nose, wings, legs) — see engine/creature.js.
// height: 'short' (children, small people: two pixels shorter, same head).
// outline: the silhouette's dark (default a cool near-black). Outlines are selective: the
//   outer edge leans to the colour it surrounds and the lines inside the body (sleeve
//   against torso, hair against face) are the darkest tone of their material.
// Light comes from the top-left: the lit edge of hair, hats, tops and coats gets a warm
// highlight, the far edge a cool shadow. Step frames sit one pixel lower (the walk bobs).
import { canvas, tint, mix } from './gfx.js';
import { creatureRows, creaturePalette } from './creature.js';

export const DOLL_W = 16;
export const DOLL_H = 24;

const EMPTY = '................';

const HEAD_DOWN = [
  '................',
  '.....oooooo.....',
  '....oSSSSSSo....',
  '...oSSSSSSSSo...',
  '...oSSSSSSSSo...',
  '...oSSSSSSSSo...',
  '...oSSSSSSSSo...',
  '...oSSESSESSo...',
  '...oSSESSESSo...',
  '...osSSSSSSso...',
  '....osSSSSso....',
  '.....oossoo.....',
];
const HEAD_UP = [
  '................',
  '.....oooooo.....',
  '....oSSSSSSo....',
  '...oSSSSSSSSo...',
  '...oSSSSSSSSo...',
  '...oSSSSSSSSo...',
  '...oSSSSSSSSo...',
  '...oSSSSSSSSo...',
  '...oSSSSSSSSo...',
  '...osSSSSSSso...',
  '....osSSSSso....',
  '.....oossoo.....',
];
const HEAD_LEFT = [
  '................',
  '.....oooooo.....',
  '....oSSSSSSo....',
  '...oSSSSSSSSo...',
  '...oSSSSSSSSo...',
  '...oSSSSSSSSo...',
  '..oSSSSSSSSSo...',
  '..oSESSSSSSSo...',
  '...oESSSSSSSo...',
  '...osSSSSSSso...',
  '....osSSSSso....',
  '......ossoo.....',
];

const BODY_DOWN = [
  '....oTTUUTTo....',
  '...oTTTUUTTTo...',
  '..oTTTTXXTTTTo..',
  '..oTtTTXXTTtTo..',
  '..oTtTTXXTTtTo..',
  '..oStTTTTTTtSo..',
  '...oobBBBBboo...',
];
const BODY_UP = [
  '....oTTTTTTo....',
  '...oTTTTTTTTo...',
  '..oTTTTTTTTTTo..',
  '..oTtTTTTTTtTo..',
  '..oTtTTTTTTtTo..',
  '..oStTTTTTTtSo..',
  '...oobBBBBboo...',
];
const BODY_LEFT = [
  '.....oTTTTo.....',
  '....oTTTTTTo....',
  '....oTTTTTTo....',
  '....oTtTTTTo....',
  '....oTtTTTTo....',
  '....oStTTTTo....',
  '.....obBBbo.....',
];
const BODY_LEFT_A = [...BODY_LEFT.slice(0, 5), '....otTTTtSo....', BODY_LEFT[6]];
const BODY_LEFT_B = [...BODY_LEFT.slice(0, 5), '...oSotTTTTo....', BODY_LEFT[6]];

const LEGS_FRONT = [
  '....oBBbbBBo....',
  '....oBBooBBo....',
  '....oBBooBBo....',
  '....oFFooFFo....',
  '.....oo..oo.....',
];
const LEGS_FRONT_A = [
  '....oBBbbBBo....',
  '....oBBooBBo....',
  '....oBBooFFo....',
  '....oFFo.oo.....',
  '.....oo.........',
];
const LEGS_FRONT_B = [
  '....oBBbbBBo....',
  '....oBBooBBo....',
  '....oFFooBBo....',
  '.....oo.oFFo....',
  '.........oo.....',
];
const LEGS_SIDE = [
  '.....oBBBBo.....',
  '.....oBBBBo.....',
  '.....oBBBBo.....',
  '....oFFFFFo.....',
  '.....ooooo......',
];
const LEGS_SIDE_A = [
  '.....oBBBBo.....',
  '....oBBooBBo....',
  '...oBBo..oBBo...',
  '..oFFFo..oFFFo..',
  '...ooo....ooo...',
];

// Running (speed above 1.5): a stride, the legs passing in the air, the other stride.
// The strides spread wider and lift the back foot higher than a walk; the side view
// leans forward and swings an arm; the passing frame rises off the ground.
const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));
const RUN_FRONT_A = [
  '....oBBbbBBo....',
  '...oBBo.oFFo....',
  '...oBBo..oo.....',
  '..oFFFo.........',
  '...ooo..........',
];
const RUN_FRONT_P = [
  '....oBBbbBBo....',
  '....oBBooBBo....',
  '....oFFooFFo....',
  '.....oo..oo.....',
  EMPTY,
];
const RUN_SIDE_A = [
  '.....oBBBBo.....',
  '....oBBoBBBBo...',
  '...oBBo..ooFFo..',
  '..oFFFo....oo...',
  '...ooo..........',
];
const RUN_SIDE_B = [
  '.....oBBBBo.....',
  '...oBBBooBBo....',
  '..oFFoo...oBBo..',
  '...oo.....oFFFo.',
  '...........ooo..',
];
const RUN_SIDE_P = [
  '.....oBBBBo.....',
  '.....oBBBo......',
  '....oBBoBBo.....',
  '....oFFFFFo.....',
  EMPTY,
];
const RUN_LEGS = {
  down: [RUN_FRONT_A, RUN_FRONT_P, mirror(RUN_FRONT_A)],
  up: [mirror(RUN_FRONT_A), RUN_FRONT_P, RUN_FRONT_A],
  left: [RUN_SIDE_A, RUN_SIDE_P, RUN_SIDE_B],
};

// The arm that swings forward while running (0 = stride A, 2 = stride B).
function runArms(rows, dir, k) {
  if (k === 1) return rows;
  const r = rowsOf(rows);
  const set = (x, y, ch) => { if (r[y] && x >= 0 && x < DOLL_W) r[y][x] = ch; };
  if (dir === 'left') {
    // the hand at the hip moves: forward at the chest, or back behind the body
    if (r[17][5] === 'S') r[17][5] = 't';
    if (k === 0) { set(3, 15, 'S'); set(2, 15, 'o'); set(3, 14, 'o'); set(3, 16, 'o'); }
    else { set(12, 16, 'S'); set(13, 16, 'o'); set(12, 15, 'o'); set(12, 17, 'o'); }
    return joinRows(r);
  }
  // seen from the front or the back, one forearm comes up across the body
  const x = k === 0 ? 3 : 12;
  set(x, 16, 'S'); set(x, 17, 'o'); set(k === 0 ? 2 : 13, 17, '.');
  return joinRows(r);
}

// Hair: '.' keeps whatever is below, 'S' forces skin back.
const HAIR = {
  short: {
    down: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '...oHHhHHhHHo...', '...oHH....HHo...', '...oH......Ho...'],
    up: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '...oHHHHHHHHo...', '...oHHhHHhHHo...', '...oHHHHHHHHo...', '...ohHHHHHHho...', '...o.hhhhhh.o...'],
    left: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '...oHHHHHHHHo...', '...o..HHHHhHo...', '..o.....HHHHo...', '..o......HHHo...', '...o.....hHHo...', '...o......h.o...'],
  },
  slick: {
    down: ['', '.....oooooo.....', '....oHHHHhHo....', '...oHHHHHhHHo...', '...oHHHHHHhHo...', '...oH......Ho...', '...oh......ho...'],
    up: ['', '.....oooooo.....', '....oHHhHHHo....', '...oHHHhHHHHo...', '...oHHHHHHHHo...', '...oHHHHHHHHo...', '...oHHHHHHHHo...', '...ohHHHHHHho...', '...o.hhhhhh.o...'],
    left: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHhhHHHo...', '...oH.HHHHHHo...', '...o...HHHHHo...', '..o......HHHo...', '..o.......HHo...', '...o......hHo...'],
  },
  bald: {
    down: ['', '', '', '.........LL.....', '..........L.....'],
    up: ['', '', '', '......LL........', '.....L..........'],
    left: ['', '', '', '.....LL.........', '....L...........'],
  },
  receding: {
    down: ['', '', '', '', '...oH......Ho...', '...oHH....HHo...', '...oH......Ho...'],
    up: ['', '', '', '', '...oHHHHHHHHo...', '...oHHHHHHHHo...', '...oHHHHHHHHo...', '...ohHHHHHHho...', '...o.hhhhhh.o...'],
    left: ['', '', '', '', '...o.....HHHo...', '..o......HHHo...', '..o......HHHo...', '...o.....hHHo...'],
  },
  bob: {
    down: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '..oHHHhHHhHHHo..', '..oHHH....HHHo..', '..oHH......HHo..', '..oHH......HHo..', '..oHH......HHo..', '..oHh......hHo..', '...oo......oo...'],
    up: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '..oHHHHHHHHHHo..', '..oHHHhHHhHHHo..', '..oHHHHHHHHHHo..', '..oHHHHHHHHHHo..', '..oHHHHHHHHHHo..', '..ohHHHHHHHHho..', '...oohhhhhhoo...'],
    left: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '...oHHHHHHHHHo..', '...o..HHHHHHHo..', '..o.....HHHHHo..', '..o......HHHHo..', '...o.....HHHHo..', '...o.....hHHho..', '.........oooo...'],
  },
  long: {
    down: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '..oHHHhHHhHHHo..', '..oHHH....HHHo..', '..oHH......HHo..', '..oHH......HHo..', '..oHH......HHo..', '..oHH......HHo..', '..oHH......HHo..', '..oHhH....HhHo..', '..ohhHo..oHhho..', '...ooo....ooo...'],
    up: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '..oHHHHHHHHHHo..', '..oHHHhHHhHHHo..', '..oHHHHHHHHHHo..', '..oHHHHHHHHHHo..', '..oHHHHHHHHHHo..', '..oHHHHHHHHHHo..', '..oHHHHHHHHHHo..', '..oHHHHHHHHHHo..', '..ohHHHHHHHHho..', '...oohhhhhhoo...'],
    left: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '...oHHHHHHHHHo..', '...o..HHHHHHHo..', '..o.....HHHHHo..', '..o......HHHHo..', '...o.....HHHHo..', '...o.....HHHHo..', '.........HHHHo..', '.........HHhho..', '.........ohhho..', '..........ooo...'],
  },
  bun: {
    down: ['.......oo.......', '.....oHHHHo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '...oHHhHHhHHo...', '...oHH....HHo...', '...oH......Ho...'],
    up: ['......oHHo......', '.....oHHHHo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '...oHHHHHHHHo...', '...oHHhHHhHHo...', '...oHHHHHHHHo...', '...ohHHHHHHho...', '...o.hhhhhh.o...'],
    left: ['.........oo.....', '.....ooooHHo....', '....oHHHHHHo....', '...oHHHHHHHHo...', '...oHHHHHHHHo...', '...o..HHHHhHo...', '..o.....HHHHo...', '..o......HHHo...', '...o.....hHHo...'],
  },
  buzz: {
    down: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHhHHHHhHo...', '...oH......Ho...'],
    up: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '...oHhHHHHhHo...', '...oHHHHHHHHo...', '...oHHHHHHHHo...', '...ohHHHHHHho...'],
    left: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHhHHHo...', '...o..HHHHHHo...', '...o.....HHHo...', '..o.......HHo...', '..o........ho...'],
  },
  wavy: {
    down: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHhHHo...', '..oHHHHHhHHHHo..', '..oHHHh...hHHo..', '..oHH......HHo..', '.oHHh......hHHo.', '..oHH......HHo..', '.oHHh......hHHo.', '..oHhH....HhHo..', '..oohho..ohhoo..', '...ooo....ooo...'],
    up: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '..oHHHHHHHHHHo..', '..oHHHHhHHHHHo..', '.oHHHHHHHHHHHHo.', '.oHHhHHHHHHhHHo.', '..oHHHHHHHHHHo..', '.oHHHhHHHHhHHHo.', '..oHhHHHHHHhHo..', '..oohhHhhHhhoo..', '...oohhhhhhoo...'],
    left: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '...oHHHHHHHHHo..', '...o.hHHHHHHHo..', '..o.....HHHHHHo.', '..o.....hHHHHHo.', '...o.....HHHHo..', '...o.....hHHHHo.', '.........HHhHo..', '.........ohhoo..', '..........ooo...'],
  },
  curly: {
    down: ['.....o.oo.o.....', '....oHoHHoHo....', '...oHHhHHhHHo...', '..oHhHHhHHhHHo..', '..oHHhHHhHHhHo..', '...ohH....Hho...', '...oh......ho...'],
    up: ['.....o.oo.o.....', '....oHoHHoHo....', '...oHHhHHhHHo...', '..oHhHHhHHhHHo..', '..oHHhHHhHHhHo..', '...oHhHHHHhHo...', '...oHHhHHhHHo...', '...ohHHhHHHho...', '...o.hhhhhh.o...'],
    left: ['......o.o.o.....', '.....oHoHoHo....', '....oHHhHHhHo...', '...oHhHHhHHhHo..', '...oHHhHHhHHHo..', '...o.hHHhHHhHo..', '..o.....HhHHo...', '..o......hHHo...', '...o.....hHho...', '...o......h.o...'],
  },
  mop: {
    down: ['.....o.oo.o.....', '....oHoHHoHo....', '...oHHhHHhHHo...', '..oHhHHhHHhHHo..', '..oHHhHHhHHhHo..', '..oHHHhHHhHHHo..', '..oHHh.Hh...Ho..', '..oHh.......Ho..', '..oh........ho..'],
    up: ['.....o.oo.o.....', '....oHoHHoHo....', '...oHHhHHhHHo...', '..oHhHHhHHhHHo..', '..oHHhHHhHHhHo..', '..oHhHHhHHhHHo..', '...oHHhHHhHHo...', '...oHhHHhHHho...', '...ohHhhHhHho...', '....o.h..h.o....'],
    left: ['......o.o.o.....', '.....oHoHoHo....', '....oHHhHHhHo...', '...oHhHHhHHhHo..', '...oHHhHHhHHHo..', '..oHHhHHhHHhHo..', '..oHh..HhHHHo...', '..o.h....hHHo...', '...o.....hHHo...', '...o.....hHho...', '.........ohho...'],
  },
  bangs: {
    down: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '..oHHHHHHHHHHo..', '..oHHHHHHHHHHo..', '..oHHhHhhHhHHo..', '..oHH......HHo..', '..oHH......HHo..', '..oHH......HHo..', '..oHh......hHo..', '..ohHo....oHho..', '...oo......oo...'],
    up: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '..oHHHHHHHHHHo..', '..oHHHhHHhHHHo..', '..oHHHHHHHHHHo..', '..oHHHHHHHHHHo..', '..oHHHHHHHHHHo..', '..oHHHHHHHHHHo..', '..ohHHHHHHHHho..', '..oohhhhhhhhoo..', '...oo......oo...'],
    left: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '...oHHHHHHHHHo..', '..oHHHHHHHHHHo..', '..oHhHhHHHHHHo..', '..o.....HHHHHo..', '...o.....HHHHo..', '...o.....HHHHo..', '.........HhHho..', '.........ohho...', '..........oo....'],
  },
  ponytail: {
    down: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '...oHHHhhHHHo...', '...oHH....HHo...', '...oH......Ho...', '...oH......Ho...', '............oHo.', '............oho.'],
    up: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '...oHHHHHHHHo...', '...oHHhHHhHHo...', '...oHHHooHHHo...', '...ohHHHHHHho...', '...o.hhHHhh.o...', '......oHHo......', '......oHHo......', '......ohHo......', '......ohho......', '.......oo.......'],
    left: ['', '.....oooooo.....', '....oHHHHHHo....', '...oHHHHHHHHo...', '...oHHHHHHHHo...', '...o..HHHHhHoo..', '..o.....HHHHoHo.', '..o......HHHoHHo', '...o.....hHHohHo', '...o......h.ohHo', '.............oho', '..............o.'],
  },
};

// Hats: Q is the hat's colour, q its shade, R its highlight.
const HAT = {
  cap: {
    down: ['', '.....oooooo.....', '....oQQRQQQo....', '...oQQRQQQQQo...', '...oQQQQQQQQo...', '..oqqqqqqqqqqo..', '...oo......oo...'],
    up: ['', '.....oooooo.....', '....oQQQQQQo....', '...oQQRQQQQQo...', '...oQQQQQQQQo...', '...oqQQQQQQqo...', '...o.qoooq..o...'],
    left: ['', '.....oooooo.....', '....oQQRQQQo....', '...oQQRQQQQQo...', '...oQQQQQQQQo...', 'ooqqqqqQQQQQo...', '.ooooo..........'],
  },
  beanie: {
    down: ['.......oo.......', '.....oQQQQo.....', '....oQRQQQQo....', '...oQRQQQQQQo...', '...oQQQQQQQQo...', '...oqRqRqRqqo...', '...oo......oo...'],
    up: ['.......oo.......', '.....oQQQQo.....', '....oQRQQQQo....', '...oQRQQQQQQo...', '...oQQQQQQQQo...', '...oqRqRqRqqo...', '...oooooooooo...'],
    left: ['.......oo.......', '.....oQQQQo.....', '....oQRQQQQo....', '...oQRQQQQQQo...', '...oQQQQQQQQo...', '...oqRqRqRqqo...', '...oooooooooo...'],
  },
  top: {
    down: ['....oooooooo....', '....oQRQQQQo....', '....oQRQQQQo....', '....oqqqqqqo....', '..oQQQQQQQQQQo..', '..oooooooooooo..'],
    up: ['....oooooooo....', '....oQQQQQRo....', '....oQQQQQRo....', '....oqqqqqqo....', '..oQQQQQQQQQQo..', '..oooooooooooo..'],
    left: ['....oooooooo....', '....oQRQQQQo....', '....oQRQQQQo....', '....oqqqqqqo....', '.oQQQQQQQQQQQo..', '.ooooooooooooo..'],
  },
  helmet: {
    down: ['', '.....oooooo.....', '....oQRRQQQo....', '...oQRQQQQQQo...', '...oQQQQQQQQo...', '...oqqqqqqqqo...', '...oq......qo...', '...oq......qo...', '...oo......oo...'],
    up: ['', '.....oooooo.....', '....oQQRRQQo....', '...oQQRQQQQQo...', '...oQQQQQQQQo...', '...oQQQQQQQQo...', '...oqQQQQQQqo...', '...oqqqqqqqqo...', '...oooooooooo...'],
    left: ['', '.....oooooo.....', '....oQRRQQQo....', '...oQRQQQQQQo...', '...oQQQQQQQQo...', '..oqqqqqqqqqo...', '..o.....qQQqo...', '..o.....qQQqo...', '...o....oooo....'],
  },
};

// Costume ears on a headband: Y is their colour, y the inside.
const EARS = {
  down: ['...oo......oo...', '..oYyo....oyYo..', '..oYyo....oyYo..', '...oYoooooooYo..', '....oYYYYYYYo...'],
  up: ['...oo......oo...', '..oYYo....oYYo..', '..oYYo....oYYo..', '...oYoooooooYo..', '....oYYYYYYYo...'],
  left: ['.......oo.......', '......oYyo......', '......oYyo......', '......oYYo......', '.....oYYYYYo....'],
};

// Beards (front and side only): D is the beard's colour, d its shade.
const BEARD = {
  stubble: { down: [, , , , , , , , , '...o.d....d.o...', '....odDDDDdo....'], up: [], left: [, , , , , , , , , '.........d......', '....odDDDd......'] },
  moustache: { down: [, , , , , , , , , '......dddd......'], up: [], left: [, , , , , , , , , '...ddd..........'] },
  full: { down: [, , , , , , , , '...oD......Do...', '...oDD.dd.DDo...', '....oDDDDDDo....', '.....odDDdo.....'], up: [], left: [, , , , , , , , '.........D......', '...oD..DDDD.o...', '....oDDDDDo.....', '......oddo......'] },
};

// Pointed ears, in skin: they stick out of the head and through the hair.
const POINTED_EARS = {
  down: ['', '', '', '', '.o............o.', '.oSo........oSo.', '..oS........So..', '..os........so..', '..oo........oo..'],
  left: ['', '', '', '', '.............o..', '...........ooSo.', '..........oSSo..', '..........oSso..', '..........ooo...'],
};
POINTED_EARS.up = POINTED_EARS.down.map((r) => r.replace(/S/g, 's'));

// Masks repaint the face's skin between two rows (and, seen from the side, only its front
// half): M is the mask, m its shade along the lower edge.
const MASK = {
  domino: { from: 6, to: 8, sideTo: 7, up: 'strap' },
  full: { from: 2, to: 10, sideTo: 8, up: 'strap' },
};

function maskRows(rows, dir, kind) {
  const m = MASK[kind];
  if (!m) return rows;
  if (dir === 'up') {
    // from behind only the strap shows, where no hair covers it
    return rows.map((r, j) => (j === 7 ? r.replace(/S/g, 'm') : r));
  }
  return rows.map((r, j) => {
    if (j < m.from || j > m.to) return r;
    return Array.from(r, (ch, x) => {
      if (dir === 'left' && x > m.sideTo) return ch === 'S' && j === m.from + 1 && kind === 'domino' ? 'm' : ch;
      if (ch === 'S') return j === m.to ? 'm' : 'M';
      if (ch === 's') return 'm';
      return ch;
    }).join('');
  });
}

const COAT = {
  down: ['....oCCUUCCo....', '...oCCCUUCCCo...', '..oCCCCTTCCCCo..', '..oCcCCTTCCcCo..', '..oCcCCTTCCcCo..', '..o.cCCTTCCc.o..', '...oCCCTTCCCo...', '...oCcCBBCcCo...', '...ooooBBoooo...'],
  up: ['....oCCCCCCo....', '...oCCCCCCCCo...', '..oCCCCCCCCCCo..', '..oCcCCCCCCcCo..', '..oCcCCCCCCcCo..', '..o.cCCCCCCc.o..', '...oCCCCCCCCo...', '...oCCcCCcCCo...', '...oooooooooo...'],
  left: ['.....oCCCCo.....', '....oCCCCCCo....', '....oCCCCCCo....', '....oCcCCCCo....', '....oCcCCCCo....', '....o.cCCCCo....', '....oCCCCCCCo...', '....oCCCCCCCo...', '....ooooooooo...'],
};
const DRESS = {
  down: [null, null, null, null, null, null, '...oTTTTTTTTo...', '...oTtTTTTtTo...', '...oooooooooo...'],
  up: [null, null, null, null, null, null, '...oTTTTTTTTo...', '...oTtTTTTtTo...', '...oooooooooo...'],
  left: [null, null, null, null, null, null, '....oTTTTTTo....', '....oTTTTTTTo...', '....ooooooooo...'],
};

const GLASSES = {
  sun: { down: { 7: '.....WGGGWG.....', 8: '.....GG..GG.....' }, left: { 7: '..oWGGo.........', 8: '...oGG..........' }, up: {} },
  round: { down: { 7: '.....GEG.GEG....' }, left: { 7: '..oEG...........' }, up: {} },
  pince: { down: { 7: '......G..G......', 8: '......GooG......' }, left: { 7: '..oG............' }, up: {} },
};

function compose(base, layer, offset = 0) {
  const out = base.map((r) => r.split(''));
  layer.forEach((row, j) => {
    if (!row) return;
    const y = j + offset;
    if (!out[y]) return;
    for (let i = 0; i < row.length; i++) if (row[i] !== '.') out[y][i] = row[i];
  });
  return out.map((r) => r.join(''));
}

function frameRows(dir, pose, spec, run = null) {
  const head = dir === 'down' ? HEAD_DOWN : dir === 'up' ? HEAD_UP : HEAD_LEFT;
  const body = dir === 'down' ? BODY_DOWN : dir === 'up' ? BODY_UP : run === null && pose === 1 ? BODY_LEFT_A : run === null && pose === 2 ? BODY_LEFT_B : BODY_LEFT;
  let legs = dir === 'left' ? (pose ? LEGS_SIDE_A : LEGS_SIDE) : pose === 1 ? LEGS_FRONT_A : pose === 2 ? LEGS_FRONT_B : LEGS_FRONT;
  if (dir === 'up') legs = pose === 1 ? LEGS_FRONT_B : pose === 2 ? LEGS_FRONT_A : LEGS_FRONT;
  if (run !== null) legs = RUN_LEGS[dir][run];
  let rows = [...head, ...body, ...legs];
  if (spec.stripe) {
    // the band runs across the forearms and the chest, on the top's own pixels
    const y = 12 + 4;
    rows[y] = rows[y].replace(/T/g, 'K').replace(/t/g, 'k');
  }
  const beard = BEARD[spec.beard];
  if (beard && beard[dir]) rows = compose(rows, Array.from(beard[dir], (r) => r || ''));
  const hair = HAIR[spec.hairStyle || 'short'];
  if (hair) rows = compose(rows, hair[dir]);
  if (spec.earShape === 'pointed') rows = compose(rows, POINTED_EARS[dir]);
  if (spec.ears) rows = compose(rows, EARS[dir]);
  const hat = HAT[spec.hat];
  if (hat) rows = compose(rows, hat[dir]);
  if (spec.mask) rows = maskRows(rows, dir, spec.mask);
  if (spec.coat) rows = compose(rows, COAT[dir], 12);
  else if (spec.dress) rows = compose(rows, DRESS[dir], 12);
  const gl = GLASSES[spec.glasses];
  if (gl) {
    const g = gl[dir] || {};
    rows = rows.map((r, j) => (g[j] ? compose([r], [g[j]])[0] : r));
  }
  if (spec.earpiece && dir !== 'left') {
    const x = dir === 'down' ? 12 : 3;
    rows = rows.map((r, j) => (j >= 8 && j <= 10 ? r.slice(0, x) + 'W' + r.slice(x + 1) : r));
  }
  if (run !== null) {
    rows = runArms(rows, dir, run);
    // seen from the side, a runner leans into the run: the head and shoulders a pixel ahead
    if (dir === 'left') rows = rows.map((r, j) => (j < 15 ? r.slice(1) + '.' : r));
  }
  // with every layer on: the legs start at row 19
  if (spec.height === 'short') {
    // one torso row and one leg row fewer, the head unchanged
    rows = [EMPTY, EMPTY, ...rows.slice(0, 15), ...rows.slice(16, 19), ...rows.slice(20)];
  }
  // the run's passing frame is in the air: everything a pixel up
  if (run === 1) return [...rows.slice(1), EMPTY];
  // the walk bobs: with the legs apart the body sits a pixel lower (the hips row folds)
  if (pose || run !== null) {
    const hips = rows.length - 5;
    rows = [EMPTY, ...rows.slice(0, hips), ...rows.slice(hips + 1)];
  }
  return rows;
}

// Ramps lean in hue like hand-picked ones: shadows cooler, highlights warmer.
const dark = (c, t) => mix(c, '#1a1838', t * 1.1);
const lit = (c, t) => mix(c, '#fff4d8', t);

export function palette(spec) {
  const skin = spec.skin || '#e8b48c';
  const hair = spec.hair || '#2a2420';
  const top = spec.top || '#506070';
  const bottom = spec.bottom || '#303840';
  // `coat` is usually just "wear one" (true): only a string overrides its colour.
  const coat = (typeof spec.coat === 'string' ? spec.coat : spec.top) || '#202020';
  const pal = {
    o: spec.outline || '#1a1826',
    S: skin, s: mix(skin, '#a04848', 0.22), L: lit(skin, 0.4),
    E: spec.eyes || '#1c1814',
    H: hair, h: dark(hair, 0.28), I: lit(hair, 0.25),
    T: top, t: dark(top, 0.22), V: lit(top, 0.2),
    U: spec.shirt || tint(top, 0.55),
    X: spec.tie || dark(top, 0.35),
    B: bottom, b: dark(bottom, 0.25),
    F: spec.shoes || '#1c1c1c',
    C: coat, c: dark(coat, 0.3), P: lit(coat, 0.2),
    G: spec.lens || '#0c1012', W: '#e8f0ec',
  };
  if (spec.stripe) Object.assign(pal, { K: spec.stripe, k: dark(spec.stripe, 0.22) });
  if (spec.hat) {
    const h = spec.hatColor || top;
    Object.assign(pal, { Q: h, q: dark(h, 0.3), R: lit(h, 0.35) });
  }
  if (spec.mask) {
    const k = spec.maskColor || '#d8a830';
    Object.assign(pal, { M: k, m: dark(k, 0.3), N: lit(k, 0.35) });
  }
  if (spec.ears) Object.assign(pal, { Y: spec.ears, y: spec.earsInner || '#f4a0b8' });
  if (spec.beard) {
    const d = spec.beardColor || (spec.beard === 'stubble' ? mix(skin, hair, 0.45) : hair);
    Object.assign(pal, { D: d, d: dark(d, 0.25) });
  }
  return pal;
}

// Each material's darker tone, already in the palette: inner lines and the far edge use
// it, so selective outlining adds no colour (a GBA sprite has 15).
const DARK = { H: 'h', T: 't', C: 'c', Q: 'q', B: 'b', K: 'k', S: 's', U: 't', D: 'd', Y: 'y', M: 'm' };
// Materials whose top-left edge catches the light (one extra tone each).
const LIT = { H: 'I', T: 'V', C: 'P', Q: 'R', M: 'N' };

// Resolves every pixel to a palette key: selective outlines and top-left light. The
// right-facing frame is the left one mirrored whole, light included, as GBA games did.
function shadeRows(rows, pal) {
  const at = (x, y) => (rows[y] && rows[y][x]) || '.';
  const lum = (k) => { const n = parseInt(pal[k].slice(1), 16); return 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255); };
  return rows.map((row, y) => Array.from(row, (ch, x) => {
    if (!pal[ch]) return null;
    const near = [at(x, y - 1), at(x + 1, y), at(x, y + 1), at(x - 1, y)];
    if (ch === 'o') {
      // a line inside the body (no transparency around it) is the darker side's own dark
      if (near.some((n) => n === '.' || n === 'o')) return 'o';
      const darks = near.map((n) => DARK[n]).filter((k) => k && pal[k]);
      return darks.length ? darks.reduce((a, b) => (lum(b) < lum(a) ? b : a)) : 'o';
    }
    const [up, right, , left] = near;
    if (LIT[ch] && pal[LIT[ch]] && (up === 'o' || up === '.') && left !== '.' && right !== 'o') return LIT[ch];
    if (DARK[ch] && ch !== 'S' && right === 'o' && left !== 'o' && pal[DARK[ch]]) return DARK[ch];
    return ch;
  }));
}

function render(rows, pal, flip) {
  const c = canvas(DOLL_W, DOLL_H);
  const ctx = c.getContext('2d');
  shadeRows(rows, pal).forEach((row, j) => {
    row.forEach((key, i) => {
      if (!key) return;
      ctx.fillStyle = pal[key];
      ctx.fillRect(flip ? DOLL_W - 1 - i : i, j, 1, 1);
    });
  });
  return c;
}

// ---------- poses beyond walking ----------
//
// Built from the standing frame with every layer on (hair, hat, coat), so every doll has
// them with nothing more in its spec. Rows: 0–11 head, 12–17 torso, 18 hips, 19–23 legs.
//   sit     on a chair or a bench, seen from any side (the body drops three pixels)
//   kneel   on one knee (down and the sides)
//   lie     on the back, head to the left (24×16, for a bed or the floor); sleep: eyes shut.
//           On a bed drawn upright the world uses lieBed/sleepBed instead: head on the
//           pillow, the body under the covers (see Actor.image in engine/world.js)
//   reach   arms forward: to give, to take, to hug (sides and down)
//   cheer   arms up: joy, surprise, surrender (down and up)
//   fly     arms spread like wings (down and up), the near arm ahead (sides): flying, diving
//   blink   eyes shut: the idle blink, and sleep
// A pose missing for a direction falls back to standing.

const LEGS_SIT = {
  down: ['...oBBBBBBBBo...', '...obBBbbBBbo...', '....oFFooFFo....', '.....oo..oo.....'],
  up: ['....obBBBBbo....', '.....oooooo.....'],
  left: ['..oBBBBBBo......', '..obBBBBBo......', '..oBBo..........', '.oFFFo..........', '..ooo...........'],
};
const LEGS_KNEEL = {
  down: ['...oBBbbBBBo....', '...oBBoooFFo....', '....oFFo..oo....', '.....oo.........'],
  left: ['..oBBBBBo.......', '..oBBooBBBo.....', '.oFFo..oFFFo....', '..oo....ooo.....'],
};

const rowsOf = (rows) => rows.map((r) => r.split(''));
const joinRows = (rows) => rows.map((r) => r.join(''));

function poseRows(name, dir, spec) {
  const base = frameRows(dir, 0, spec);
  const top = base.slice(0, 19);   // head, torso, hips
  if (name === 'sit') {
    const legs = LEGS_SIT[dir];
    return [...Array(DOLL_H - top.length - legs.length).fill(EMPTY), ...top, ...legs];
  }
  if (name === 'kneel') {
    const legs = LEGS_KNEEL[dir];
    if (!legs) return null;
    return [...Array(DOLL_H - top.length - legs.length).fill(EMPTY), ...top, ...legs];
  }
  if (name === 'blink') {
    if (dir === 'up') return null;
    return base.map((r, j) => (j >= 6 && j <= 9 ? r.replace(/E/g, 'S') : r));
  }
  if (name === 'reach') {
    const r = rowsOf(base);
    if (dir === 'left') {
      // the near arm comes off the side and points forward at chest height
      for (let y = 14; y <= 17; y++) for (let x = 4; x <= 6; x++) if (r[y][x] === 'S' || r[y][x] === 't') r[y][x] = 'T';
      const arm = '.oSTTT'.split('');
      for (let i = 0; i < arm.length; i++) if (arm[i] !== '.') r[15][i] = arm[i];
      r[14][1] = 'o'; r[14][2] = 'o'; r[14][3] = 'o'; r[16][1] = 'o'; r[16][2] = 'o'; r[16][3] = 'o';
      return joinRows(r);
    }
    if (dir === 'down') {
      // both hands meet in front of the belly
      for (const x of [2, 13]) for (let y = 15; y <= 17; y++) if (r[y][x] === 'o' || r[y][x] === 'S') r[y][x] = '.';
      for (const x of [3, 12]) for (let y = 15; y <= 17; y++) if (r[y][x] === 't' || r[y][x] === 'S') r[y][x] = 'o';
      r[17][6] = 'S'; r[17][7] = 'S'; r[17][8] = 'S'; r[17][9] = 'S';
      return joinRows(r);
    }
    return null;
  }
  if (name === 'cheer') {
    if (dir !== 'down' && dir !== 'up') return null;
    const r = rowsOf(base);
    // the arms leave the sides of the torso and rise beside the head
    for (const x of [2, 13]) for (let y = 14; y <= 17; y++) r[y][x] = '.';
    for (const x of [3, 12]) for (let y = 14; y <= 17; y++) if (r[y][x] !== 'o') r[y][x] = 'o';
    for (const [x, side] of [[1, -1], [14, 1]]) {
      r[6][x] = 'o'; r[7][x] = 'S'; r[8][x] = 'S'; r[9][x] = 'T'; r[10][x] = 'T'; r[11][x] = 'T'; r[12][x] = 'T'; r[13][x] = 'o';
      r[6][x - side] = r[6][x - side] === '.' ? 'o' : r[6][x - side];
      r[7][x + side] = 'o'; r[8][x + side] = 'o'; r[9][x + side] = 'o'; r[10][x + side] = 'o'; r[11][x + side] = 'o';
      // the shoulder joins the arm to the torso
      r[12][x + side] = 'T'; r[12][x + 2 * side] = 'T'; r[13][x + side] = 'T'; r[13][x + 2 * side] = 'T';
      r[13][x] = 'T'; r[14][x] = 'o'; r[14][x + side] = 'o';
    }
    return joinRows(r);
  }
  if (name === 'fly') {
    // seen from the side, the near arm points ahead (the reach); from the front and the
    // back, both arms spread out level with the shoulders, like wings
    if (dir === 'left') return poseRows('reach', 'left', spec);
    const r = rowsOf(base);
    for (const x of [2, 13]) for (let y = 15; y <= 17; y++) r[y][x] = '.';
    for (const x of [3, 12]) for (let y = 15; y <= 17; y++) if (r[y][x] !== 'o') r[y][x] = 'o';
    for (const [hand, sleeve, side] of [[0, 2, 1], [15, 13, -1]]) {
      r[13][hand] = 'o'; r[13][hand + side] = 'o'; r[13][sleeve] = 'o';
      r[14][hand] = 'S'; r[14][hand + side] = 'T'; r[14][sleeve] = 'T';
      r[15][hand] = 'o'; r[15][hand + side] = 'o'; r[15][sleeve] = 'o';
    }
    return joinRows(r);
  }
  return null;
}

// Lying down: the standing front frame turned a quarter, head to the left.
function lying(img, flip) {
  const c = canvas(DOLL_H, DOLL_W);
  const ctx = c.getContext('2d');
  ctx.save();
  if (flip) { ctx.translate(DOLL_H, 0); ctx.scale(-1, 1); }
  ctx.translate(0, DOLL_W);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
  return c;
}

// In a bed drawn upright (taller than wide): the standing front frame from the shoulders
// up, the rest left clear so the bed's own covers show through.
function tuckedIn(img) {
  const c = canvas(DOLL_W, DOLL_H);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, DOLL_W, 14, 0, 0, DOLL_W, 14);
  return c;
}

export const POSES = ['sit', 'kneel', 'lie', 'reach', 'cheer', 'fly', 'blink'];

// An animal: its rows come from engine/creature.js, drawn with the same light and
// outlines as a person. `idle` and `flap` are frames that loop (standing, flying).
function creatureDoll(spec) {
  const pal = creaturePalette(spec);
  const k = creatureRows(spec);
  const dirs = (set, each = (r, flip) => render(r, pal, flip)) => {
    const out = {};
    for (const dir of ['down', 'up', 'left']) if (set[dir]) out[dir] = Array.isArray(set[dir][0]) ? set[dir].map((r) => each(r, false)) : each(set[dir], false);
    if (set.left) out.right = Array.isArray(set.left[0]) ? set.left.map((r) => each(r, true)) : each(set.left, true);
    return out;
  };
  const poses = {};
  for (const [name, set] of Object.entries(k.poses)) poses[name] = dirs(set);
  const d = { w: DOLL_W, h: DOLL_H, frames: dirs(k.frames), run: dirs(k.run), poses, spec, shadow: k.shadow };
  if (k.flap) d.flap = dirs(k.flap);
  if (k.idle) d.idle = k.idle === k.flap ? d.flap : dirs(k.idle);
  return d;
}

export function doll(spec) {
  if (spec.creature) return creatureDoll(spec);
  const pal = palette(spec);
  const frames = {};
  for (const dir of ['down', 'up', 'left']) frames[dir] = [0, 1, 2].map((pose) => render(frameRows(dir, pose, spec), pal, false));
  frames.right = [0, 1, 2].map((pose) => render(frameRows('left', pose, spec), pal, true));
  // running: [stride, in the air, other stride] per direction
  const run = {};
  for (const dir of ['down', 'up', 'left']) run[dir] = [0, 1, 2].map((k) => render(frameRows(dir, 1, spec, k), pal, false));
  run.right = [0, 1, 2].map((k) => render(frameRows('left', 1, spec, k), pal, true));
  const poses = {};
  for (const name of POSES) {
    poses[name] = {};
    if (name === 'lie') {
      poses.lie = { left: lying(frames.down[0], false), right: lying(frames.down[0], true) };
      poses.lie.down = poses.lie.left;
      poses.lie.up = poses.lie.left;
      // asleep: lying with the eyes shut
      const shut = render(poseRows('blink', 'down', spec), pal, false);
      poses.sleep = { left: lying(shut, false), right: lying(shut, true) };
      poses.sleep.down = poses.sleep.left;
      poses.sleep.up = poses.sleep.left;
      poses.lieBed = tuckedIn(frames.down[0]);
      poses.sleepBed = tuckedIn(shut);
      continue;
    }
    for (const dir of ['down', 'up', 'left']) {
      const rows = poseRows(name, dir, spec);
      if (rows) poses[name][dir] = render(rows, pal, false);
    }
    const side = poseRows(name, 'left', spec);
    if (side) poses[name].right = render(side, pal, true);
  }
  return { w: DOLL_W, h: DOLL_H, frames, run, poses, spec };
}

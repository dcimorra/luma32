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
// creature: 'dog' | 'cat' | 'bird' | 'bee' | 'horse': an animal instead of a person, with its own
//   keys (fur, markings, nose, wings, legs) — see engine/creature.js.
// height: 'short' (children, small people: two pixels shorter, same head) | 'tall' (two
//   pixels taller: one torso row and one hip row more; the frame is 16×26).
// build: 'stout' | 'big' (the same): torso, arms and coat a pixel wider on each side.
// belly: true; a rounded belly, seen from the side (pregnancy, a paunch).
// dress: true (a skirt to the hips) | 'long' (to the feet, hiding the legs, flaring at
//   the hem; under a coat it shows below the coat's tails) | 'wide' (court panniers).
// hairStyle also: crown (= braid: a crown of braids) updo (piled up, flat and wide on top,
//   curls at the temples) wig (big and powdered, rolls over the ears, a queue behind)
//   ringlets (long and voluminous, curly).
// hat also: 'bonnet' (a brim framing the face) 'turban' 'plume' (a feather in the hair)
//   'bicorne' 'mobcap' 'toque' (a chef's) 'shades' (sunglasses pushed up on the head)
//   'hood' (a cowl over the hair, down to the shoulders; `hood: true` is the same, in
//   hatColor or the coat's or top's colour) 'crown' (the crown below, in hatColor).
// crown: a colour; a crown with three points on top of the head, over hair and hats.
// horns: 'small' | 'big' | 'broken' (one big, one snapped short), in hornColor (bone).
// glasses also: 'thin' (thin rectangular frames, in glassesColor).
// hold: something in the hand: 'cane' 'book' 'fan' 'phone' 'briefcase' 'tray' 'umbrella'
//   'glass' 'gavel' 'folder' 'flag', in holdColor (main) and holdAccent. It follows the
//   hand as it swings, and drops from poses that raise the arms.
// pack: a colour; a pack on the back (straps from the front).
// wings: a colour (the membrane; the frame a shade darker) or { color, membrane, clipped,
//   bound }: folded behind the shoulders. wingsOpen: true spreads them (the frame grows to
//   28×24, centred); the fly pose spreads them anyway (unless bound).
// A face and clothes that have lived (all opt-in: a spec without them draws as it always did):
// relief: true: deeper modelling — the collar in the chin's shadow, the far side of the
//   body two tones deep, the face and the hands rounded off on their far side.
// lines: true: an older face (lines under the eyes and beside the mouth, in the skin's shade).
// weathered: true: a face that has seen weather — the cheekbones and the sides of the face
//   in the skin's shade, and that shade deeper and ruddier.
// scar: 'cheek' | 'brow' | 'eye' (across the eye, which is shut), in scarColor.
// eyepatch: 'left' | 'right' (the character's own left or right).
// belt: a colour, at the waist, with a buckle in buckle (default brass).
// boots: a colour; the shoes and a row of shaft above them.
// gloves: a colour, on the hands.
// sleeves: 'rolled': the forearms bare (without a coat).
// scarf: a colour, round the neck, an end hanging down the front.
// apron: a colour, from the chest to the knees (under a coat, if any).
// worn: true: patched clothes — a patch on a knee and one on an elbow, in the darker tones.
// hat also: 'bandana' (tied round the head, the knot's tails behind), in hatColor.
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
  // a crown of braids (I is the hair's own highlight: the plaits catch the light)
  crown: {
    down: ['', '....oooooooo....', '...oIIHIIHIIo...', '..oHhIHhIHhIHo..', '...ohhhhhhhho...', '...oHH....HHo...', '...oH......Ho...'],
    up: ['', '....oooooooo....', '...oHHHHHHHHo...', '..ohhhhhhhhhho..', '..oIIHIIHIIHIo..', '..oHhIHhIHhIHo..', '..ohhhhhhhhhho..', '...oHHHIIHHHo...', '...ohHHIHHHho...', '...o.hhhhhh.o...'],
    left: ['', '....ooooooo.....', '...oIIHIIHIo....', '..ohIHhIHhIHo...', '...ohhhhhhhhIo..', '...o..HHHHhIHo..', '..o.....HHHIHo..', '..o......HHhHo..', '...o.....hHHo...'],
  },
  updo: {
    down: ['.....oooooo.....', '....oHIIHHHo....', '...oHIHHHHHho...', '...ohhHHHHhho...', '...oHHHHHHHHo...', '...oHH....HHo...', '..ohH......Hho..', '..oho......oho..', '...o........o...'],
    up: ['.....oooooo.....', '....oHHHIIHo....', '...oHHHHHHIHo...', '...ohhHHHHhho...', '...oHHHHHHHHo...', '...oHHHhhHHHo...', '..ohHHHHHHHHho..', '..ohohhhhhhoho..', '...o........o...'],
    left: ['.....oooooo.....', '....oHIIHHHo....', '...oHIHHHHHho...', '...ohhHHHHhho...', '...oHHHHHHHHo...', '...o..HHHHhHo...', '..o.....HHHHo...', '..o......hHHo...', '...o.....oho....'],
  },
  wig: {
    down: ['....oooooooo....', '...oHIHHHHHHo...', '..oHIHHHHHHHHo..', '..oHHHHHHHHHHo..', '.oHhHHhHHhHHhHo.', '.oHHo......oHHo.', '.ohHo......ohHo.', '.oHHo......oHHo.', '.ohho......ohho.', '..oo........oo..'],
    up: ['....oooooooo....', '...oHHHHHHIHo...', '..oHHHHHHHHIHo..', '..oHHHHHHHHHHo..', '.oHHHHHHHHHHHHo.', '.oHHhHHHHHHhHHo.', '.ohHHHHHHHHHHho.', '.oHHhHHHHHHhHHo.', '.ohhohHHHHhohho.', '..oo.ohHHho.oo..', '......oEEo......', '......oHHo......', '......ohho......', '.......oo.......'],
    left: ['....ooooooo.....', '...oHIHHHHHo....', '..oHIHHHHHHHo...', '..oHHHHHHHHHHo..', '...oHHHHHHHHHo..', '...o..HHHHHHHo..', '..o.....hHHhHo..', '..o.....HhhHHHo.', '...o....hHHhHHo.', '...o.....oo.oho.', '............oo..'],
  },
  ringlets: {
    down: ['.....o.oo.o.....', '....oHoHHoHo....', '...oHHhHHhHHo...', '..oHhHHhHHhHHo..', '.oHHhHHhHHhHHHo.', '.oHhHh....hHhHo.', '.oHhH......HhHo.', 'oHhHh......hHhHo', '.oHHh......hHHo.', 'oHhHh......hHhHo', '.oHhHo....oHhHo.', '.ohHhHo..oHhHho.', '..o.oo....oo.o..'],
    up: ['.....o.oo.o.....', '....oHoHHoHo....', '...oHHhHHhHHo...', '..oHhHHhHHhHHo..', '.oHHhHHhHHhHHHo.', '.oHhHHhHHhHHhHo.', '.oHHhHHhHHhHHHo.', 'oHhHHhHHhHHhHhHo', '.oHHhHHhHHhHHHo.', 'oHhHHhHHhHHhHhHo', '.oHhHHhHHhHHhHo.', '.ohHhHhhHhHhHho.', '..o.oo.oo.oo.o..'],
    left: ['......o.o.o.....', '.....oHoHoHo....', '....oHHhHHhHo...', '...oHhHHhHHhHo..', '...oHHhHHhHHHHo.', '...o.hHHhHHhHhHo', '..o.....HhHHhHo.', '..o.....hHhHhHHo', '...o.....HHhHho.', '...o.....hHhHHHo', '.........oHhHho.', '.........ohHhHo.', '..........o.oo..'],
  },
};
HAIR.braid = HAIR.crown;

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
  bonnet: {
    down: ['....oooooooo....', '...oQQRQQQQQo...', '..oQRQQQQQQQQo..', '..oQQqqqqqqQQo..', '..oQq......qQo..', '..oQq......qQo..', '..oQq......qQo..', '...oq......qo...', '...oo......oo...'],
    up: ['....oooooooo....', '...oQQQQQQRQo...', '..oQQQQQQQQRQo..', '..oQQQQQQQQQQo..', '..oqQQQQQQQQqo..', '..oqqQQQQQQqqo..', '...oqqqqqqqqo...', '...oo.oqqo.oo...'],
    left: ['.....ooooooo....', '....oQRQQQQQo...', '..ooQQQQQQQQQo..', '.oQQqQQQQQQQQo..', '.oQq..QQQQQQQo..', '.oQq...qQQQQqo..', '..oq....qqqqo...', '..o......ooo....'],
  },
  turban: {
    down: ['.....oooooo.....', '....oQRQqQQo....', '...oQRQqQQQQo...', '..oQQqQQQqQQQo..', '..oqQQQRQqQQqo..', '...oqqqqqqqqo...'],
    up: ['.....oooooo.....', '....oQQqQRQo....', '...oQQQqQQRQo...', '..oQQqQQQqQQQo..', '..oqQQqQQQqQqo..', '...oqqqqqqqqo...'],
    left: ['.....oooooo.....', '....oQRQqQQo....', '...oQRQqQQQQo...', '..oQQqQQQqQQQo..', '..oRqQQQqQQQqo..', '...oqqqqqqqqo...'],
  },
  plume: {
    down: ['..........ooo...', '.........oRRQo..', '.........oRQo...', '........ooQo....', '....ooooqqoo....'],
    up: ['...ooo..........', '..oQRRo.........', '...oQRo.........', '....oQoo........', '....ooqqoooo....'],
    left: ['.........ooo....', '........oRRQo...', '........oRQo....', '.......ooQo.....', '...oooooqqo.....'],
  },
  bicorne: {
    down: ['', '.....oooooo.....', '..ooQQQRQQQQoo..', 'ooQQQQRQQQQQQQoo', 'oqqqqqqqqqqqqqqo', '.oooo......oooo.'],
    up: ['', '.....oooooo.....', '..ooQQQQRQQQoo..', 'ooQQQQQQRQQQQQoo', 'oqqqqqqqqqqqqqqo', '.oooo......oooo.'],
    left: ['', '......oooo......', '....ooQRQQoo....', '...oQQRQQQQQo...', '...oqqqqqqqqo...', '...o........o...'],
  },
  mobcap: {
    down: ['.....oooooo.....', '....oQRQQQQo....', '...oQRQQQQQQo...', '..oQQQQQQQQQQo..', '..oqQqQqQqQqqo..', '...o.q.q.q.q.o..'],
    up: ['.....oooooo.....', '....oQQQQRQo....', '...oQQQQQQRQo...', '..oQQQQQQQQQQo..', '..oqQQQQQQQQqo..', '..oqQqQqQqQqqo..', '...o.q.q.q.q.o..'],
    left: ['.....oooooo.....', '....oQRQQQQo....', '...oQRQQQQQQo...', '..oQQQQQQQQQQo..', '..oqQqQqQQQQqo..', '...o.q.q.qQqo...', '..........qo....'],
  },
  toque: {
    down: ['....oooooooo....', '...oQRQQQQQQo...', '..oQRQQQQQQQQo..', '..oQQQQQQQQQQo..', '...oqQQQQQQqo...', '...oqqqqqqqqo...', '...oo......oo...'],
    up: ['....oooooooo....', '...oQQQQQQRQo...', '..oQQQQQQQQRQo..', '..oQQQQQQQQQQo..', '...oqQQQQQQqo...', '...oqqqqqqqqo...', '...oHHHHHHHHo...'],
    left: ['....oooooooo....', '...oQRQQQQQQo...', '..oQRQQQQQQQQo..', '..oQQQQQQQQQQo..', '...oqQQQQQQqo...', '...oqqqqqqqqo...', '...o..HHHHHHo...'],
  },
  shades: {
    down: ['', '', '', '..oGWGooGWGo....', '...oGGo.oGGo....'],
    up: ['', '', '', '..oo........oo..'],
    left: ['', '', '', '.oGWGGo.........', '..oGGo..........'],
  },
  bandana: {
    down: ['', '.....oooooo.....', '....oQQRQQQo....', '...oQQQQQQQQo...', '...oqqqqqqqqo...', '...o........o...'],
    up: ['', '.....oooooo.....', '....oQQQQQQo....', '...oQQQQQQQQo...', '...oqqqqqqqqo...', '...o.......qo...', '...........q....'],
    left: ['', '.....oooooo.....', '....oQQRQQQo....', '...oQQQQQQQQo...', '...oqqqqqqqqqo..', '...o........qo..', '.............q..'],
  },
  // a cowl: the hair outside it is taken away (`hides`), the face shows in its opening
  hood: {
    hides: true,
    down: ['.....oooooo.....', '....oQRQQQQo....', '...oQRQQQQQQo...', '..oQRQQQQQQQQo..', '..oQQq....qQQo..', '..oQq......qQo..', '..oQq......qQo..', '..oQq......qQo..', '..oQq......qQo..', '..oQq......qQo..', '..oQQq....qQQo..', '..oQQQo..oQQQo..', '..oQQQQQQQQQQo..', '..oqqqqqqqqqqo..'],
    up: ['.....oooooo.....', '....oQQQQRQo....', '...oQQQQQQRQo...', '..oQQQQQQQQRQo..', '..oQQQQQQQQQQo..', '..oQQQQqQQQQQo..', '..oQQQQqQQQQQo..', '..oQQQQqQQQQQo..', '..oQQQQQqQQQQo..', '..oQQQQQqQQQQo..', '..oQQQQQqQQQQo..', '..oQQQQQQQQQQo..', '..oQQQQQQQQQQo..', '..oqqqqqqqqqqo..'],
    left: ['.....oooooo.....', '....oQRQQQQo....', '...oQRQQQQQQo...', '..oQRQQQQQQQQo..', '..oQQQQQQQQQQo..', '..oQq...qQQQQo..', '..o.....qQQQQo..', '..o......qQQQo..', '...o.....qQQQo..', '...o.....qQQQo..', '....o...qQQQQo..', '.....oqQQQQQQo..', '....oQQQQQQQQo..', '....oqqqqqqqqo..'],
  },
};

// A crown on top of the head, over the hair and any hat: J its colour, j its shade, A the
// light on its points.
const CROWN = {
  down: ['.....o.oo.o.....', '....oAoAAoAo....', '....oJJAJJJo....', '....ojjjjjjo....'],
  up: ['.....o.oo.o.....', '....oAoAAoAo....', '....oJJJJJJo....', '....ojjjjjjo....'],
  left: ['.....o.o.o......', '....oAoAoAo.....', '....oJJAJJJo....', '....ojjjjjjo....'],
};

// Horns, through the hair: u their colour, v their shade.
const HORNS = {
  small: {
    down: ['....o......o....', '...ouo....ouo...', '...ovo....ovo...'],
    left: ['......o.........', '.....ouo........', '.....ovo........'],
  },
  big: {
    down: ['.oo..........oo.', 'ouo..........ouo', 'ouuo........ouuo', '.ovuo......ouvo.', '..ovuo....ouvo..', '...oo......oo...'],
    left: ['.........oo.....', '........ouo.....', '.......ouuo.....', '......ouvo......', '.....ovuo.......', '.....ooo........'],
  },
};
HORNS.small.up = HORNS.small.down;
HORNS.big.up = HORNS.big.down;
// one horn whole, the other snapped off near the head (seen from the side, the whole one)
HORNS.broken = {
  down: HORNS.big.down.map((r, j) => r.slice(0, 8) + (j < 2 ? '........' : j === 2 ? '...ooo..' : r.slice(8))),
  left: HORNS.big.left,
};
HORNS.broken.up = mirror(HORNS.broken.down);

// A pack on the back, from behind and the side; its straps from the front. p the pack,
// r its shade.
const PACK = {
  down: ['.....r....r.....', '.....r....r.....', '.....r....r.....', '.....r....r.....'],
  up: ['.....oooooo.....', '....oppppppo....', '....orrrrrro....', '....oppppppo....', '....oppppppo....', '....orrrrrro....', '.....oooooo.....'],
  left: ['..........oo....', '..........opo...', '..........oppo..', '..........oppo..', '..........orro..', '..........oppo..', '...........oo...'],
};

// Skirts to the feet, from the hips (row 18) down: T the skirt (the top's colour, like a
// dress), F the shoes peeking under the hem. Walking, the hem sways a pixel to the side of
// the foot that steps.
const SKIRT = {
  long: {
    down: ['...oTTTTTTTTo...', '...oTtTTTTtTo...', '...oTtTTTTtTo...', '..oTtTTTTTTtTo..', '..otTTTTTTTTto..', '..oooFFooFFooo..'],
    left: ['....oTTTTTTo....', '....oTTTTTTo....', '....oTTTTTTTo...', '...oTTTTTTTTo...', '...otTTTTTTTto..', '..oFFooooooooo..'],
  },
  wide: {
    down: ['..oTTTTTTTTTTo..', '.oTTtTTTTTTtTTo.', '.oTtTTTTTTTTtTo.', '.oTtTTTTTTTTtTo.', '.otTTTTTTTTTTto.', '.oooooFFooFFooo.'],
    left: ['...oTTTTTTTTo...', '..oTTTTTTTTTTo..', '..oTTTTTTTTTTo..', '..oTTTTTTTTTTo..', '..otTTTTTTTTto..', '.oFFoooooooooo..'],
  },
};

function skirtRows(kind, dir, pose) {
  const s = SKIRT[kind];
  let rows = s[dir === 'left' ? 'left' : 'down'];
  if (pose) {
    // the two lowest rows lean a pixel towards the stepping foot; only that shoe shows
    const lean = (dir === 'up' ? 3 - pose : pose) === 1 ? -1 : 1;
    const shift = (r) => (lean < 0 ? r.slice(1) + '.' : '.' + r.slice(0, -1));
    rows = rows.map((r, j) => (j >= 4 ? shift(r) : r));
    if (dir !== 'left') {
      const feet = rows[5];
      const keep = lean < 0 ? [0, 8] : [8, 16];
      rows[5] = Array.from(feet, (ch, x) => (ch === 'F' && (x < keep[0] || x >= keep[1]) ? 'o' : ch)).join('');
    }
  }
  return rows;
}

// Wings, behind the body: e their frame, f the membrane. Folded, a tall narrow shape rises
// over each shoulder; from behind they cover the back. Drawn as the left one (mirrored).
const WING_FOLDED = {
  down: ['', '', '', '', '.o..', 'oeo.', 'oefo', 'oefo', 'oefo', 'oefo', 'oefo', 'oeff', 'oeff', 'oefo', 'oeo.', 'oeo.', 'oeo.', '.oe.', '.oeo', '..oo'],
  up: ['', '', '', '', '', '.o......', 'oeo.....', 'oefo....', 'oefo....', 'oefo....', 'oeffo...', 'oefffo..', 'oeffffo.', 'oefffffo', 'oefffffo', 'oeffffo.', '.oefffo.', '.oeffo..', '.oeffo..', '..oeo...', '...o....'],
  left: ['', '', '', '', '............o...', '...........oeo..', '...........oefo.', '...........oefo.', '...........oefo.', '...........oefo.', '..........oeffo.', '.........oefffo.', '.........oefffo.', '.........oeffo..', '.........oeffo..', '.........oeffo..', '.........oefo...', '.........oefo...', '.........oeo....', '.........oo.....'],
};
// Spread: the left wing, outside a 16-pixel body padded by WING_PAD on each side.
const WING_PAD = 6;
const WING_OPEN = ['', '', '', '', 'oo........', 'oeoo......', 'oeeeoo....', 'ofeffeeo..', 'offeffffeo', 'offfeffffe', 'offffefffe', 'offfffefff', 'offfffeeff', 'offfffffff', '.offoffffo', '.oo.offfo.', '.....offo.', '......oo..'];

function wingLayer(dir, open, clipped) {
  const W = DOLL_W + (open ? 2 * WING_PAD : 0);
  const blank = '.'.repeat(W);
  let left;
  if (open) {
    const half = WING_OPEN.map((r) => (r || '').padEnd(W / 2, '.'));
    // seen from the side only one wing shows, spread behind the back
    if (dir === 'left') left = half.map((r) => '.'.repeat(W - 11) + [...r.slice(0, 10)].reverse().join('') + '.');
    else left = half.map((r) => r + [...r].reverse().join(''));
  } else if (dir === 'left') {
    left = WING_FOLDED.left.map((r) => (r || '').padEnd(W, '.'));
  } else {
    const half = WING_FOLDED[dir].map((r) => (r || '').padEnd(W / 2, '.'));
    left = half.map((r) => r + [...r].reverse().join(''));
  }
  // clipped wings lose their tips: the top three rows of the shape
  if (clipped) {
    const first = left.findIndex((r) => /[^.]/.test(r));
    left = left.map((r, j) => (j >= first && j < first + 3 ? blank : j === first + 3 ? r.replace(/[ef]/g, 'o') : r));
  }
  return Array.from({ length: DOLL_H }, (_, j) => left[j] || blank);
}

// Fills the layer in only where the rows are clear: things behind the body.
function under(rows, layer) {
  return rows.map((r, j) => (layer[j] ? Array.from(r, (ch, i) => (ch === '.' && layer[j][i] && layer[j][i] !== '.' ? layer[j][i] : ch)).join('') : r));
}

// Things held in the hand. Z is holdColor, z its shade, w holdAccent; [dx, dy] places the
// pattern's top-left against the hand (the right hand: screen-left from the front, the
// near hand from the side; mirrored from behind).
const HOLD = {
  cane: { at: [-2, -1], rows: ['.oo', 'oZZ', 'Zo.', 'Z..', 'Z..', 'Z..', 'Z..', 'z..'] },
  book: { at: [-2, -2], rows: ['oooo', 'oZwo', 'oZwo', 'ozwo', 'oooo'] },
  fan: { at: [-3, -4], rows: ['.ooo.', 'owZwo', 'oZwZo', '.ozo.', '..o..'] },
  phone: { at: [-2, -4], rows: ['ooo', 'owo', 'owo', 'ozo', '.o.'] },
  briefcase: { at: [-3, 1], rows: ['.ooo.', 'owwwo', 'oZZZo', 'ozZzo', 'ooooo'] },
  tray: { at: [-3, -4], rows: ['.w.o.', 'owozo', 'oooooo', '.zZZz.'] },
  umbrella: { at: [-2, -3], rows: ['oo..', 'o.o.', '.oZo', '.oZo', '.ozo', 'oZZo', 'oZzo', 'oZzo', '.oo.', '.ow.'] },
  glass: { at: [-2, -5], rows: ['ooo', 'owo', 'oZo', 'oZo', 'ozo', 'ooo'] },
  gavel: { at: [-3, -5], rows: ['oooo', 'oZZo', 'ozoo', '..o.', '..ow'] },
  folder: { at: [-2, -1], rows: ['ooo', 'oZo', 'owo', 'oZo', 'ozo', 'ooo'] },
  flag: { at: [-3, -14], rows: ['ZZo', 'wwo', 'ZZo', '..o', '..o', '..o', '..o', '..o', '..o', '..o', '..o', '..o', '..o'] },
};

function holdRows(rows, dir, kind, off = 0) {
  const held = HOLD[kind];
  // the hand: the lowest skin pixel of the arm (rows 14–17) on the holding side
  let hand = null;
  for (let y = 17 + off; y >= 14 + off && !hand; y--) {
    const r = rows[y];
    for (let k = 0; k < r.length; k++) {
      const x = dir === 'up' ? r.length - 1 - k : k;
      if (r[x] === 'S' && (dir === 'left' || (dir === 'down' ? x <= 4 : x >= 11))) { hand = [x, y]; break; }
    }
  }
  if (!hand) return rows;
  const flip = dir === 'up';
  const w = Math.max(...held.rows.map((r) => r.length));
  const x0 = flip ? hand[0] - held.at[0] - w + 1 : hand[0] + held.at[0];
  const y0 = hand[1] + held.at[1];
  const out = rowsOf(rows);
  held.rows.forEach((r, j) => {
    const row = flip ? [...r.padEnd(w, '.')].reverse().join('') : r;
    for (let i = 0; i < row.length; i++) {
      const x = x0 + i;
      if (row[i] === '.' || x < 0 || x >= DOLL_W || !out[y0 + j]) continue;
      out[y0 + j][x] = row[i];
    }
  });
  return joinRows(out);
}

// A rounded belly, seen from the side: the front of the lower torso a pixel or two ahead.
function bellyRows(rows) {
  const r = rowsOf(rows);
  const cloth = /[A-Za-z]/.test(r[16][7]) ? r[16][7] : 'T';
  const put = (x, y, ch) => { if (r[y][x] === '.' || r[y][x] === 'o') r[y][x] = ch; };
  put(3, 15, 'o'); r[15][4] = r[15][4] === 'o' ? cloth : r[15][4];
  put(2, 16, 'o'); put(3, 16, cloth); r[16][4] = r[16][4] === 'o' ? cloth : r[16][4];
  put(3, 17, 'o'); r[17][4] = r[17][4] === 'o' ? cloth : r[17][4];
  return joinRows(r);
}

// Stout: the columns beside the middle of the torso repeat, pushing arms and edges a pixel
// out on each side (between rows y0 and y1). A hand at the frame's edge (the fly pose)
// keeps its place and the arm is a pixel shorter.
function widenRows(rows, dir, y0, y1) {
  return rows.map((r, j) => {
    if (j < y0 || j > y1 || !r) return r;
    if (dir === 'left') return (r[0] === '.' ? r.slice(1, 8) : r[0] + r.slice(2, 8)) + r.slice(7, 16);
    const left = r[0] === '.' ? r.slice(1, 5) : r[0] + r.slice(2, 5);
    const right = r[15] === '.' ? r.slice(11, 15) : r.slice(11, 14) + r[15];
    return left + r.slice(4, 12) + right;
  });
}

// Tall: one torso row (15) more, and a hip row above the legs (at 19, the trousers solid).
function tallen(rows, torso = 15, hips = 19) {
  const out = [...rows.slice(0, torso + 1), rows[torso], ...rows.slice(torso + 1)];
  if (hips === null) return [EMPTY, ...out];
  const h = hips + 1;
  return [...out.slice(0, h), out[h].replace(/b/g, 'B'), ...out.slice(h)];
}

const wingsOf = (spec) => {
  const w = spec.wings;
  if (!w || spec.creature) return null;
  return typeof w === 'string' ? { membrane: w } : w;
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
  thin: { down: { 7: '.....gEggEg.....' }, left: { 7: '..ogEgggg.......' }, up: {} },
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

// The hat a spec wears: `hood: true` is a hood whatever the hat; a crown is not a hat.
const hatOf = (spec) => (spec.hood ? 'hood' : spec.hat);
const shortRows = (rows) => [EMPTY, EMPTY, ...rows.slice(0, 15), ...rows.slice(16, 19), ...rows.slice(20)];

// The marks of a life on the face, before the hair goes on: lines, weather, a scar, a patch
// over one eye (shown from the side on the side it is on: `facing`).
function faceRows(rows, dir, spec, facing) {
  const r = rows.map((row) => row.split(''));
  const put = (x, y, k) => { if (r[y] && r[y][x] && r[y][x] !== '.' && r[y][x] !== 'o') r[y][x] = k; };
  const side = dir === 'left';
  if (spec.lines) {
    if (side) { put(4, 9, 's'); put(5, 10, 's'); } else if (dir === 'down') { put(5, 9, 's'); put(10, 9, 's'); put(6, 10, 's'); put(9, 10, 's'); }
  }
  if (spec.weathered) {
    if (side) { put(5, 8, 's'); put(5, 9, 's'); } else if (dir === 'down') { put(4, 8, 's'); put(11, 8, 's'); put(5, 9, 's'); put(10, 9, 's'); }
  }
  if (spec.scar && dir !== 'up') {
    const marks = {
      cheek: side ? [[5, 8], [6, 9]] : [[10, 8], [11, 9]],
      brow: side ? [[3, 5], [4, 6]] : [[5, 5], [6, 6]],
      eye: side ? [[3, 5], [4, 6], [4, 9]] : [[5, 5], [6, 6], [6, 9]],
    }[spec.scar] || [];
    for (const [x, y] of marks) put(x, y, 'n');
    // across the eye, the eye is shut
    if (spec.scar === 'eye') for (const [x, y] of side ? [[4, 7], [4, 8]] : [[6, 7], [6, 8]]) if (r[y][x] === 'E') r[y][x] = 's';
  }
  if (spec.eyepatch && dir !== 'up') {
    if (side) {
      if (facing === spec.eyepatch) { for (const [x, y] of [[4, 7], [4, 8], [5, 7], [5, 8]]) put(x, y, 'E'); for (let x = 3; x <= 6; x++) put(x, 6, 'E'); }
    } else {
      const x0 = spec.eyepatch === 'right' ? 8 : 5;
      for (let y = 7; y <= 8; y++) for (let x = x0; x < x0 + 3; x++) put(x, y, 'E');
      for (let x = x0 - 1; x < x0 + 4; x++) put(x, 6, 'E');
    }
  }
  return r.map((row) => row.join(''));
}

// What is worn over the body (standard layout: torso 12–17, hips 18, legs from 19):
// `under` goes before the coat (an apron, rolled sleeves), `over` after it (a belt, a
// scarf, boots, gloves, patches).
function wearRows(rows, dir, spec, when) {
  const r = rows.map((row) => row.split(''));
  const side = dir === 'left';
  const at = (x, y) => (r[y] && r[y][x]) || '.';
  const set = (x, y, k) => { if (r[y] && r[y][x]) r[y][x] = k; };
  if (when === 'under') {
    if (spec.sleeves === 'rolled' && !spec.coat) {
      for (let y = 15; y <= 17; y++) for (const x of side ? [5, 6] : [3, 4, 11, 12]) if ('Tt'.includes(at(x, y))) set(x, y, 'S');
    }
    if (spec.apron && dir !== 'up') {
      const xs = side ? [6, 7, 8] : [5, 6, 7, 8, 9, 10];
      for (let y = 14; y <= 17; y++) for (const x of xs) if ('TtXU'.includes(at(x, y))) set(x, y, x === xs[xs.length - 1] ? '9' : '8');
      for (let y = 19; y <= 20; y++) for (const x of xs) if ('Bb'.includes(at(x, y))) set(x, y, y === 20 || x === xs[xs.length - 1] ? '9' : '8');
    }
    return r.map((row) => row.join(''));
  }
  if (spec.boots) {
    for (let y = 19; y < r.length; y++) for (let x = 0; x < 16; x++) {
      if (at(x, y) === 'F') { set(x, y, '3'); if ('Bb'.includes(at(x, y - 1))) set(x, y - 1, '3'); }
    }
  }
  if (spec.gloves) for (let y = 13; y < r.length; y++) for (let x = 0; x < 16; x++) if (at(x, y) === 'S') set(x, y, '7');
  if (spec.belt) {
    for (let x = 0; x < 16; x++) if ('Bb'.includes(at(x, 18)) || (spec.coat && 'Cc'.includes(at(x, 18)))) set(x, 18, '1');
    if (!side) set(8, 18, 'a');
  }
  if (spec.scarf) {
    for (const x of side ? [6, 7, 8, 9] : [5, 6, 7, 8, 9, 10]) if ('TtUXCcV'.includes(at(x, 12))) set(x, 12, '5');
    if (dir !== 'up') { const x = side ? 6 : 9; if (at(x, 13) !== '.') set(x, 13, '5'); if (at(x, 14) !== '.') set(x, 14, '6'); }
  }
  if (spec.worn) {
    for (const [x, y] of side ? [[6, 20], [6, 21], [7, 21]] : [[5, 20], [6, 20], [5, 21]]) if (at(x, y) === 'B') set(x, y, 'b');
    for (const [x, y] of side ? [[5, 15], [5, 16]] : [[11, 15], [12, 15], [12, 16]]) if (at(x, y) === 'T') set(x, y, 't');
  }
  return r.map((row) => row.join(''));
}

function frameRows(dir, pose, spec, run = null, facing = dir) {
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
  if (spec.lines || spec.weathered || spec.scar || spec.eyepatch) rows = faceRows(rows, dir, spec, facing);
  const beard = BEARD[spec.beard];
  if (beard && beard[dir]) rows = compose(rows, Array.from(beard[dir], (r) => r || ''));
  if (spec.sleeves || spec.apron) rows = wearRows(rows, dir, spec, 'under');
  const bare = rows;
  const hair = HAIR[spec.hairStyle || 'short'];
  if (hair) rows = compose(rows, hair[dir]);
  const horns = HORNS[spec.horns];
  if (horns) rows = compose(rows, horns[dir]);
  if (spec.earShape === 'pointed') rows = compose(rows, POINTED_EARS[dir]);
  if (spec.ears) rows = compose(rows, EARS[dir]);
  const hat = HAT[hatOf(spec)];
  if (hat) {
    rows = compose(rows, hat[dir]);
    // a hood hides the hair outside it (a ponytail, long hair over the shoulders)
    if (hat.hides) {
      rows = rows.map((r, j) => {
        const h = hat[dir][j];
        if (j > 13) return r;
        const a = h ? h.search(/[^.]/) : -1;
        const b = h ? h.length - 1 - [...h].reverse().join('').search(/[^.]/) : -1;
        return Array.from(r, (ch, x) => (a < 0 || x < a || x > b ? bare[j][x] : ch)).join('');
      });
    }
  }
  if (spec.crown || spec.hat === 'crown') rows = compose(rows, CROWN[dir]);
  if (spec.mask) rows = maskRows(rows, dir, spec.mask);
  const skirt = SKIRT[spec.dress] ? skirtRows(spec.dress, dir, pose) : null;
  if (spec.coat) rows = compose(rows, COAT[dir], 12);
  else if (spec.dress && !skirt) rows = compose(rows, DRESS[dir], 12);
  // under a coat, the skirt shows below its tails
  if (skirt) rows = compose(rows, spec.coat ? ['', '', '', ...skirt.slice(3)] : skirt, 18);
  if (spec.belly && dir === 'left') rows = bellyRows(rows);
  if (spec.boots || spec.gloves || spec.belt || spec.scarf || spec.worn) rows = wearRows(rows, dir, spec, 'over');
  if (spec.pack) rows = compose(rows, PACK[dir], 12);
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
  rows = extras(rows, dir, spec, { open: spec.wingsOpen });
  // with every layer on: the legs start at row 19
  if (spec.height === 'short') {
    // one torso row and one leg row fewer, the head unchanged
    rows = shortRows(rows);
  }
  if (spec.height === 'tall') rows = tallen(rows);
  // the run's passing frame is in the air: everything a pixel up
  if (run === 1) return [...rows.slice(1), EMPTY];
  // the walk bobs: with the legs apart the body sits a pixel lower (the hips row folds)
  if (pose || run !== null) {
    const hips = rows.length - 5;
    rows = [EMPTY, ...rows.slice(0, hips), ...rows.slice(hips + 1)];
  }
  return rows;
}

// The layers that go on last, over a finished body in the standard layout (head 0–11,
// torso 12–17, hips 18), or one moved by `off` rows (a seated pose) or shortened (`short`):
// the stout build, the held thing, the wings.
function extras(rows, dir, spec, { off = 0, short = false, hold = true, open = false, seated = false } = {}) {
  const s = short ? 2 : 0;
  if (spec.build === 'stout' || spec.build === 'big') {
    const y1 = SKIRT[spec.dress] ? 23 : spec.coat || spec.dress ? 20 : short ? 19 : 18;
    rows = widenRows(rows, dir, 12 + s + off, seated ? 18 + off : y1 + off);
  }
  if (hold && HOLD[spec.hold]) rows = holdRows(rows, dir, spec.hold, off + (short ? 1 : 0));
  const w = wingsOf(spec);
  if (w) {
    const wide = open && !w.bound;
    let layer = wingLayer(dir, wide, w.clipped);
    if (short) layer = shortRows(layer);
    if (seated) layer = [EMPTY, ...layer.slice(0, 19), EMPTY, EMPTY, EMPTY, EMPTY];
    else if (off) layer = [...Array(off).fill(EMPTY), ...layer];
    if (wide) {
      const pad = '.'.repeat(WING_PAD);
      rows = rows.map((r) => pad + r + pad);
    }
    // from behind, folded wings lie over the back
    rows = dir === 'up' && !wide ? compose(rows, layer) : under(rows, layer);
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
  if (hatOf(spec) === 'hood' || spec.hat === 'crown') {
    // a hood is cloth: the hat's colour, or the coat's, or the top's
    const h = spec.hatColor || (typeof spec.coat === 'string' ? spec.coat : top);
    Object.assign(pal, { Q: h, q: dark(h, 0.3), R: lit(h, 0.35) });
  }
  if (spec.crown || spec.hat === 'crown') {
    const k = (typeof spec.crown === 'string' && spec.crown) || (spec.hat === 'crown' && spec.hatColor) || '#d8b040';
    Object.assign(pal, { J: k, j: dark(k, 0.3), A: lit(k, 0.4) });
  }
  if (spec.horns) {
    const k = spec.hornColor || '#e4d8bc';
    Object.assign(pal, { u: k, v: dark(k, 0.3) });
  }
  if (spec.glasses === 'thin') pal.g = spec.glassesColor || '#3a3230';
  if (HOLD[spec.hold]) {
    const k = spec.holdColor || '#585c68';
    Object.assign(pal, { Z: k, z: dark(k, 0.3), w: spec.holdAccent || lit(k, 0.45) });
  }
  if (spec.pack) Object.assign(pal, { p: spec.pack, r: dark(spec.pack, 0.3) });
  const wg = wingsOf(spec);
  if (wg) {
    const m = wg.membrane || (wg.color ? lit(wg.color, 0.15) : '#584848');
    Object.assign(pal, { e: wg.color || dark(m, 0.35), f: m });
  }
  if (spec.beard) {
    const d = spec.beardColor || (spec.beard === 'stubble' ? mix(skin, hair, 0.45) : hair);
    Object.assign(pal, { D: d, d: dark(d, 0.25) });
  }
  if (spec.weathered) pal.s = mix(skin, '#8a3828', 0.32);
  if (spec.scar) pal.n = spec.scarColor || mix(skin, '#7a2a30', 0.45);
  if (spec.belt) Object.assign(pal, { 1: spec.belt, 2: dark(spec.belt, 0.3), a: spec.buckle || '#c8a040' });
  if (spec.boots) Object.assign(pal, { 3: spec.boots, 4: dark(spec.boots, 0.3) });
  if (spec.scarf) Object.assign(pal, { 5: spec.scarf, 6: dark(spec.scarf, 0.3) });
  if (spec.gloves) pal[7] = spec.gloves;
  if (spec.apron) Object.assign(pal, { 8: spec.apron, 9: dark(spec.apron, 0.25) });
  return pal;
}

// Each material's darker tone, already in the palette: inner lines and the far edge use
// it, so selective outlining adds no colour (a GBA sprite has 15).
const DARK = { H: 'h', T: 't', C: 'c', Q: 'q', B: 'b', K: 'k', S: 's', U: 't', D: 'd', Y: 'y', M: 'm', J: 'j', u: 'v', Z: 'z', p: 'r', f: 'e', 1: '2', 3: '4', 5: '6', 8: '9' };
// Materials whose top-left edge catches the light (one extra tone each).
const LIT = { H: 'I', T: 'V', C: 'P', Q: 'R', M: 'N', J: 'A' };

// Resolves every pixel to a palette key: selective outlines and top-left light. The
// right-facing frame is the left one mirrored whole, light included, as GBA games did.
// `relief` (spec.relief) models deeper: the collar under the chin in shadow, the far side
// of a broad shape two tones deep, the face and the hands rounded off on their far side.
function shadeRows(rows, pal, relief = false) {
  const at = (x, y) => (rows[y] && rows[y][x]) || '.';
  const lum = (k) => { const n = parseInt(pal[k].slice(1), 16); return 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255); };
  const edge = (k) => k === '.' || k === 'o';
  const span = (x, y) => { let a = x; let b = x; while (!edge(at(a - 1, y))) a--; while (!edge(at(b + 1, y))) b++; return b - a + 1; };
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
    if (relief) {
      const dk = DARK[ch] && pal[DARK[ch]] ? DARK[ch] : null;
      if (dk && ch !== 'S' && up === 'o' && at(x, y - 2) !== '.' && at(x, y - 2) !== 'o') return dk;
      if (dk && ch !== 'S' && right !== 'o' && right !== '.' && at(x + 2, y) === 'o' && left !== 'o' && span(x, y) >= 6) return dk;
      if (ch === 'S' && right === 'o' && left !== 'o' && up !== 'o' && up !== '.') return 's';
    }
    if (LIT[ch] && pal[LIT[ch]] && (up === 'o' || up === '.') && left !== '.' && right !== 'o') return LIT[ch];
    if (DARK[ch] && ch !== 'S' && right === 'o' && left !== 'o' && pal[DARK[ch]]) return DARK[ch];
    return ch;
  }));
}

function render(rows, pal, flip, width = null, relief = false) {
  // 16 wide, or 28 with spread wings (a pose may write a pixel past the edge: clipped)
  const w = width || (rows.some((r) => r.length >= DOLL_W + 2 * WING_PAD) ? DOLL_W + 2 * WING_PAD : DOLL_W);
  const c = canvas(w, Math.max(DOLL_H, rows.length));
  const ctx = c.getContext('2d');
  shadeRows(rows, pal, relief).forEach((row, j) => {
    row.forEach((key, i) => {
      if (!key) return;
      ctx.fillStyle = pal[key];
      ctx.fillRect(flip ? w - 1 - i : i, j, 1, 1);
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

// Poses for a spec with a build, a held thing, wings or height 'tall': the pose of the
// plain body, then those on top (a spec without them takes basePose as it always did).
function poseRows(name, dir, spec) {
  const w = wingsOf(spec);
  const tall = spec.height === 'tall';
  if (!spec.build && !tall && !w && !HOLD[spec.hold]) return basePose(name, dir, spec);
  const core = { ...spec, build: undefined, wings: undefined, hold: undefined, height: tall ? undefined : spec.height };
  let rows = basePose(name, dir, core);
  if (!rows) return null;
  const seated = name === 'sit' || name === 'kneel';
  // arms up or forward let go of what they held; flying spreads the wings
  rows = extras(rows, dir, spec, {
    off: seated ? 1 : 0, seated, short: spec.height === 'short',
    hold: name === 'sit' || name === 'kneel' || name === 'blink',
    open: name === 'fly' || spec.wingsOpen,
  });
  if (tall) rows = seated ? tallen(rows, 16, null) : tallen(rows);
  return rows;
}

function basePose(name, dir, spec) {
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
    if (dir === 'left') return basePose('reach', 'left', spec);
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
  const c = canvas(img.height, img.width);
  const ctx = c.getContext('2d');
  ctx.save();
  if (flip) { ctx.translate(img.height, 0); ctx.scale(-1, 1); }
  ctx.translate(0, img.width);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
  return c;
}

// In a bed drawn upright (taller than wide): the standing front frame from the shoulders
// up, the rest left clear so the bed's own covers show through.
function tuckedIn(img) {
  const c = canvas(img.width, DOLL_H);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, img.width, 14, 0, 0, img.width, 14);
  return c;
}

export const POSES = ['sit', 'kneel', 'lie', 'reach', 'cheer', 'fly', 'blink'];

// An animal: its rows come from engine/creature.js, drawn with the same light and
// outlines as a person. `idle` and `flap` are frames that loop (standing, flying).
function creatureDoll(spec) {
  const pal = creaturePalette(spec);
  const k = creatureRows(spec);
  const dirs = (set, each = (r, flip) => render(r, pal, flip, r[0].length)) => {
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

// What every doll of the cartridge being played has unless its spec says otherwise: the
// game's `relief: true` gives the whole cast the deeper modelling (cart.js sets it when the
// cartridge starts; a doll built when its file loads, before that, has to say it itself).
let defaults = {};
export function dollDefaults(d) { defaults = d || {}; }

export function doll(spec) {
  if (spec.creature) return creatureDoll(spec);
  const pal = palette(spec);
  const R = !!(spec.relief ?? defaults.relief);
  const frames = {};
  for (const dir of ['down', 'up', 'left']) frames[dir] = [0, 1, 2].map((pose) => render(frameRows(dir, pose, spec), pal, false, null, R));
  frames.right = [0, 1, 2].map((pose) => render(frameRows('left', pose, spec, null, 'right'), pal, true, null, R));
  // running: [stride, in the air, other stride] per direction
  const run = {};
  for (const dir of ['down', 'up', 'left']) run[dir] = [0, 1, 2].map((k) => render(frameRows(dir, 1, spec, k), pal, false, null, R));
  run.right = [0, 1, 2].map((k) => render(frameRows('left', 1, spec, k, 'right'), pal, true, null, R));
  const poses = {};
  for (const name of POSES) {
    poses[name] = {};
    if (name === 'lie') {
      poses.lie = { left: lying(frames.down[0], false), right: lying(frames.down[0], true) };
      poses.lie.down = poses.lie.left;
      poses.lie.up = poses.lie.left;
      // asleep: lying with the eyes shut
      const shut = render(poseRows('blink', 'down', spec), pal, false, null, R);
      poses.sleep = { left: lying(shut, false), right: lying(shut, true) };
      poses.sleep.down = poses.sleep.left;
      poses.sleep.up = poses.sleep.left;
      poses.lieBed = tuckedIn(frames.down[0]);
      poses.sleepBed = tuckedIn(shut);
      continue;
    }
    for (const dir of ['down', 'up', 'left']) {
      const rows = poseRows(name, dir, spec);
      if (rows) poses[name][dir] = render(rows, pal, false, null, R);
    }
    const side = poseRows(name, 'left', spec);
    if (side) poses[name].right = render(side, pal, true, null, R);
  }
  return { w: frames.down[0].width, h: frames.down[0].height, frames, run, poses, spec };
}

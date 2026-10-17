// The lab's village: what an ordinary cartridge is made of and the rest of the lab had
// not, so a change to the engine is tried against it before a game finds it out. Every
// map here is a bench of cases, each one noted where it is; the dev jumps (villageJumps)
// put the player at each, and tools/bench.mjs walks them in every view.
//
// village (outdoors, 3/4 art): houses built from ground tiles — a façade of one, two and
//   three storeys under a roof, a door in it (a warp on a solid tile), a window row, a
//   shed whose roof is one row — a hedge (a solid run with no face), trees as a solid
//   trunk with a crown `top`, a big tree, a tent, a cart in profile and a hut as props (the
//   diorama's body, still body, roof box and plain box), a bench and barrels, a puddle
//   lying flat, a stream along the south edge (reflects, lies flat, blocks), a sprite
//   actor with a picture a direction (a horse), a one-cell gap between two houses, and a
//   connection east to the field. No `sky`: the ground views get the hour's.
// field: joined to the village edge to edge, with its own `sky`, a `skirt`, a far layer
//   (`parallax`), a terrace one level up with stairs that climb east, a scarecrow.
// house (indoors, `clock: false`): an interior as 3/4 art draws one — a wall of a top row
//   over two face rows, side walls of top tiles, a south wall of one top row with the
//   door in it (cut low from above; a wall from behind), a window — furniture that lies
//   down (a bed, a table), stands (a shelf, a chair, a chest to examine, a stove that
//   lights), a rug lying flat, a partition that makes a one-cell corridor and a dead end.
// cellar: made for the ground view (`wallHeight`, `ceiling`, `fog`, walls that show
//   another tile's picture, pillars, a torch on the player), reached from the big house.
import { setViewChoice } from '../../engine/firstperson.js';

const C = {
  ink: '#22201c', grass: '#5a9a4a', grassHi: '#74b65e', grassLo: '#3e7a34',
  path: '#b89868', pathHi: '#cdb080', pathLo: '#9a7c50',
  brick: '#a86048', brickHi: '#c07858', brickLo: '#7c4432', mortar: '#d8c0a0',
  plaster: '#e8dcc0', plasterLo: '#c8b898', wood: '#7a5230', woodHi: '#9a7048', woodLo: '#50341c',
  roof: '#9a4030', roofHi: '#b85840', roofLo: '#6e2c20', ridge: '#d0785c',
  glass: '#88b8d8', glassHi: '#c8e8f8', leaf: '#2e6e2a', leafHi: '#4a9a40', leafLo: '#1e4e1c',
  water: '#3a78b8', waterHi: '#6aa8e0', stone: '#7a7068', stoneHi: '#a0968a', stoneLo: '#544c46',
  floor: '#b08858', floorHi: '#c8a070', floorLo: '#8c6840', cloth: '#b04a3a', clothHi: '#d06a58',
  iron: '#3a3a44', flame: '#ffb050', hay: '#d8b860', cellar: '#3a3540', cellarHi: '#4a4452', cellarLo: '#2a262e',
};

// a wall of bricks, `w` wide and `h` tall, from (x, y)
function bricks(p, x, y, w, h, hi = C.brick, lo = C.brickLo, mortar = C.mortar) {
  p.rect(x, y, w, h, hi);
  for (let r = 0; r < h; r += 4) {
    p.hline(x, y + r + 3, w, mortar);
    for (let c = r % 8 ? 4 : 0; c < w; c += 8) p.vline(x + c, y + r, 3, mortar);
    for (let c = r % 8 ? 1 : 5; c < w; c += 8) p.px(x + c, y + r + 1, lo);
  }
}
const grass = (p) => { p.fill(C.grass); p.noise(0, 0, 16, 16, [C.grassHi, C.grassLo], 0.15); };
const roofRow = (p, y0 = 0) => { p.fill(C.roof); for (let y = y0; y < 16; y += 4) { p.hline(0, y, 16, C.roofLo); for (let x = (y % 8 ? 4 : 0); x < 16; x += 8) p.vline(x, y + 1, 3, C.roofHi); } };

// a horse in profile (left) or from the front (down) or the back (up), 32x32; right is left mirrored
function horse(p, dir, f) {
  const hoof = f ? 1 : 0;
  if (dir === 'left' || dir === 'right') {
    const X = (x, w = 1) => (dir === 'left' ? x : 32 - x - w);
    p.rect(X(6, 18), 14, 18, 9, '#6a4428');
    p.rect(X(4, 6), 9, 6, 9, '#6a4428');
    p.rect(X(2, 5), 12, 5, 4, '#5a3820');
    p.rect(X(3), 13, 1, 1, C.ink);
    p.rect(X(8, 2), 7, 2, 4, '#4a2c18');
    p.rect(X(10, 3), 9, 3, 2, C.ink);
    p.rect(X(22, 3), 10, 3, 6, '#4a2c18');
    for (const x of [7, 11, 18, 22]) p.rect(X(x, 2), 23, 2, 8 - ((x === 7 || x === 18) ? hoof : 0), '#5a3820');
    p.rect(X(23, 2), 12, 2, 10, '#3a2412');
    return;
  }
  p.rect(10, 12, 12, 11, '#6a4428');
  p.rect(12, 4, 8, 9, '#6a4428');
  if (dir === 'down') { p.rect(13, 8, 2, 2, C.ink); p.rect(17, 8, 2, 2, C.ink); p.rect(14, 3, 1, 2, '#4a2c18'); p.rect(17, 3, 1, 2, '#4a2c18'); } else p.rect(13, 4, 6, 8, '#4a2c18');
  for (const x of [11, 15, 19]) p.rect(x, 23, 2, 8 - (x === 15 ? hoof : 0), '#5a3820');
}

export const villageTiles = {
  path: { step: 'soft', draw(p) { p.fill(C.path); p.noise(0, 0, 16, 16, [C.pathHi, C.pathLo], 0.12); } },
  // a house as 3/4 art draws one: face rows (brick, a window, a door) under roof rows
  brick: { solid: true, draw(p) { bricks(p, 0, 0, 16, 16); } },
  plaster: { solid: true, draw(p) { p.fill(C.plaster); p.noise(0, 0, 16, 16, [C.plasterLo], 0.08); p.rect(0, 0, 16, 2, C.wood); } },
  window: { solid: true, draw(p) { bricks(p, 0, 0, 16, 16); p.rect(3, 2, 10, 10, C.wood); p.rect(4, 3, 8, 8, C.glass); p.px(5, 4, C.glassHi); p.px(6, 4, C.glassHi); p.vline(8, 3, 8, C.wood); p.hline(4, 7, 8, C.wood); } },
  door: { solid: true, draw(p) { bricks(p, 0, 0, 16, 16); p.rect(3, 2, 10, 14, C.woodLo); p.rect(4, 3, 8, 13, C.wood); p.px(10, 10, C.flame); } },
  roof: { solid: true, draw(p) { roofRow(p); } },
  ridge: { solid: true, draw(p) { roofRow(p, 3); p.rect(0, 0, 16, 3, C.ridge); p.hline(0, 2, 16, C.roofLo); } },
  // a hedge: a solid run with no face, so it takes the height most walls have
  hedge: { solid: true, draw(p) { p.fill(C.leaf); p.noise(0, 0, 16, 16, [C.leafHi, C.leafLo], 0.3); p.hline(0, 15, 16, C.leafLo); } },
  // a tree: its trunk the cell, its crown a `top` painted over whoever is behind it
  trunk: { solid: true, draw(p) { grass(p); p.rect(6, 4, 4, 12, C.woodLo); p.rect(7, 2, 2, 14, C.wood); },
    top(p) { p.ellipse(8, 6, 8, 7, C.leaf); p.ellipse(6, 5, 4, 3, C.leafHi); } },
  // a stream: it reflects, lies flat, and stops the feet (a chasm would too)
  stream: { solid: true, wall: false, reflect: 0.35, step: 'water', dust: false, frames: 2, draw(p, f) { p.fill(C.water); p.hline(2 + f * 4, 5, 5, C.waterHi); p.hline(9 - f * 3, 11, 4, C.waterHi); } },
  bank: { step: 'soft', draw(p) { grass(p); p.rect(0, 12, 16, 4, C.path); p.hline(0, 12, 16, C.pathLo); } },
  // the field's terrace and the stairs up it, which climb east
  terrace: { draw(p) { grass(p); p.hline(0, 0, 16, C.grassHi); },
    side(p, f, h) { p.fill(C.path); for (let y = 0; y < h; y += 3) p.hline((y % 6 ? 2 : 6), y, 5, C.pathLo); p.hline(0, 0, 16, C.grassLo); } },
  ramp_e: { ramp: true, stairs: 'east', step: 'hard', draw(p) { p.fill(C.stone); for (let x = 0; x < 16; x += 4) p.vline(x, 0, 16, C.stoneHi); p.hline(0, 0, 16, C.stoneLo); p.hline(0, 15, 16, C.stoneLo); },
    side(p, f, h) { p.fill(C.stoneLo); for (let x = 0; x < 16; x += 4) p.vline(x, 0, h, C.stoneHi); } },
  // the house inside: a wall is a top row over two face rows; the side walls are tops
  floor_wood: { step: 'wood', draw(p) { p.fill(C.floor); for (let y = 0; y < 16; y += 4) { p.hline(0, y, 16, C.floorLo); p.px((y * 3) % 16, y + 2, C.floorHi); } } },
  inwall_top: { solid: true, draw(p) { p.fill(C.stoneLo); p.rect(1, 1, 14, 14, C.stone); p.hline(2, 2, 10, C.stoneHi); } },
  inwall_hi: { solid: true, draw(p) { p.fill(C.plaster); p.noise(0, 0, 16, 16, [C.plasterLo], 0.08); p.rect(0, 0, 16, 2, C.woodLo); } },
  inwall_lo: { solid: true, draw(p) { p.fill(C.plaster); p.noise(0, 0, 16, 16, [C.plasterLo], 0.08); p.rect(0, 11, 16, 5, C.wood); p.hline(0, 11, 16, C.woodHi); } },
  inwindow: { solid: true, draw(p) { p.fill(C.plaster); p.rect(3, 2, 10, 11, C.wood); p.rect(4, 3, 8, 9, C.glassHi); p.vline(8, 3, 9, C.wood); p.hline(4, 7, 8, C.wood); } },
  indoor: { solid: true, draw(p) { p.fill(C.stoneLo); p.rect(1, 1, 14, 14, C.stone); p.rect(4, 0, 8, 16, C.woodLo); p.rect(5, 0, 6, 16, C.wood); } },
  // the cellar, made for the ground view: a wall that shows another tile's picture, a
  // ceiling, a way up
  cellar_floor: { step: 'hard', draw(p) { p.fill(C.cellar); p.noise(0, 0, 16, 16, [C.cellarHi, C.cellarLo], 0.14); } },
  cellar_wall: { solid: true, wall: 'brick_face', draw(p) { p.fill(C.cellarLo); p.rect(1, 1, 14, 14, C.cellar); } },
  brick_face: { draw(p) { bricks(p, 0, 0, 16, 16, '#6a5048', '#4a3630', '#8a7468'); } },
  pillar: { solid: true, wall: 'pillar_face', draw(p) { p.fill(C.cellar); p.rect(3, 3, 10, 10, C.stone); } },
  pillar_face: { draw(p) { p.fill(C.stone); p.vline(0, 0, 16, C.stoneLo); p.vline(15, 0, 16, C.stoneLo); p.hline(0, 7, 16, C.stoneLo); } },
  planks: { draw(p) { p.fill(C.wood); for (let y = 0; y < 16; y += 5) p.hline(0, y, 16, C.woodLo); p.px(4, 2, C.woodHi); p.px(12, 8, C.woodHi); } },
  cellar_stairs: { step: 'hard', draw(p) { p.fill(C.cellar); for (let y = 0; y < 16; y += 4) { p.hline(1, y, 14, C.stoneHi); p.hline(1, y + 1, 14, C.stone); } } },
  // props
  bigtree: { size: [3, 3], foot: [1, 1, 1, 0], examine: 'village.bigtree', draw(p) { p.rect(21, 30, 6, 18, C.woodLo); p.rect(22, 28, 4, 20, C.wood); p.ellipse(24, 16, 22, 15, C.leaf); p.ellipse(18, 12, 10, 7, C.leafHi); p.ellipse(30, 20, 8, 5, C.leafLo); } },
  cart: { size: [3, 2], foot: [3, 1], examine: 'village.cart', draw(p) { p.rect(6, 10, 30, 12, C.wood); p.rect(6, 8, 30, 2, C.woodHi); p.rect(8, 4, 26, 6, C.hay); p.ellipse(14, 24, 6, 6, C.iron); p.ellipse(14, 24, 3, 3, C.wood); p.ellipse(30, 24, 6, 6, C.iron); p.ellipse(30, 24, 3, 3, C.wood); p.rect(36, 14, 10, 2, C.woodLo); p.rect(44, 12, 2, 6, C.woodLo); } },
  tent: { size: [3, 2], foot: [3, 1], roof: 12, draw(p) { p.rect(2, 12, 44, 20, C.cloth); for (let y = 0; y < 12; y++) p.rect(24 - y * 2 - 2, y, y * 4 + 4, 1, y % 2 ? C.cloth : C.clothHi); p.rect(18, 18, 12, 14, C.ink); p.rect(2, 30, 44, 2, C.woodLo); } },
  hut: { size: [4, 3], foot: [4, 3], examine: 'village.hut', draw(p) { p.rect(0, 0, 64, 14, C.hay); for (let y = 2; y < 14; y += 3) p.hline(0, y, 64, '#b89848'); p.hline(0, 13, 64, C.woodLo); bricks(p, 2, 14, 60, 34, '#c8b890', '#a89870', '#e0d0a8'); p.rect(26, 26, 12, 22, C.woodLo); p.rect(27, 27, 10, 21, C.wood); p.rect(8, 22, 10, 10, C.wood); p.rect(9, 23, 8, 8, C.glass); p.rect(46, 22, 10, 10, C.wood); p.rect(47, 23, 8, 8, C.glass); } },
  barrel: { examine: 'village.barrel', draw(p) { p.rect(3, 2, 10, 13, C.wood); p.rect(2, 4, 12, 9, C.woodHi); p.hline(2, 5, 12, C.iron); p.hline(2, 11, 12, C.iron); p.rect(4, 1, 8, 2, C.woodLo); } },
  bench: { size: [2, 1], draw(p) { p.rect(2, 6, 28, 4, C.woodHi); p.rect(2, 10, 28, 1, C.woodLo); p.rect(4, 11, 2, 5, C.woodLo); p.rect(26, 11, 2, 5, C.woodLo); p.rect(2, 2, 28, 3, C.wood); } },
  puddle: { flat: true, reflect: 0.3, draw(p) { p.ellipse(8, 10, 7, 4, C.water); p.ellipse(6, 9, 2, 1, C.waterHi); } },
  scarecrow: { size: [1, 2], foot: [1, 1], draw(p) { p.rect(7, 10, 2, 22, C.woodLo); p.rect(1, 12, 14, 2, C.woodLo); p.rect(4, 4, 8, 8, C.hay); p.rect(5, 6, 2, 2, C.ink); p.rect(9, 6, 2, 2, C.ink); p.rect(2, 14, 12, 10, C.cloth); } },
  // the house's furniture: what lies down (its whole picture is the floor it covers),
  // what stands, what lies flat
  bed: { size: [2, 2], foot: [2, 2], examine: 'house.bed', draw(p) { p.rect(0, 2, 32, 30, C.woodLo); p.rect(2, 4, 28, 26, '#e8e0d0'); p.rect(2, 12, 28, 18, C.cloth); p.rect(4, 6, 10, 5, '#f4ecd8'); p.rect(0, 0, 32, 4, C.wood); } },
  table: { size: [2, 2], foot: [2, 2], draw(p) { p.rect(2, 4, 28, 24, C.woodHi); p.rect(2, 28, 28, 2, C.woodLo); p.rect(4, 6, 24, 20, C.wood); p.rect(12, 10, 8, 8, '#f4ecd8'); } },
  shelf: { size: [1, 2], foot: [1, 1], examine: 'house.shelf', draw(p) { p.rect(1, 0, 14, 32, C.woodLo); p.rect(2, 1, 12, 30, C.wood); for (const y of [6, 14, 22]) { p.hline(2, y, 12, C.woodHi); p.rect(3, y - 4, 3, 4, C.cloth); p.rect(8, y - 4, 2, 4, C.glass); } } },
  chair: { draw(p) { p.rect(3, 2, 10, 2, C.wood); p.rect(3, 4, 2, 8, C.wood); p.rect(11, 4, 2, 8, C.wood); p.rect(3, 9, 10, 4, C.woodHi); p.rect(4, 13, 2, 3, C.woodLo); p.rect(10, 13, 2, 3, C.woodLo); } },
  chest: { examine: 'house.chest', draw(p) { p.rect(2, 5, 12, 10, C.woodLo); p.rect(3, 6, 10, 8, C.wood); p.rect(2, 4, 12, 3, C.woodHi); p.rect(7, 9, 2, 3, C.iron); } },
  stove: { examine: 'house.stove', light: { r: 36, color: '#ff9040', flicker: 1, dy: -4 }, frames: 2, draw(p, f) { p.rect(1, 2, 14, 14, C.iron); p.rect(3, 6, 10, 6, C.ink); p.rect(5, 8 - f, 6, 3 + f, C.flame); p.rect(6, 0, 4, 3, C.iron); } },
  rug: { flat: true, size: [3, 2], draw(p) { p.rect(0, 0, 48, 32, C.cloth); p.rect(3, 3, 42, 26, C.clothHi); p.rect(6, 6, 36, 20, C.cloth); p.rect(16, 10, 16, 12, '#e8d8a0'); } },
  lantern: { light: { r: 44, color: '#ffd090', flicker: 1 }, examine: 'cellar.lantern', draw(p) { p.rect(6, 0, 4, 2, C.iron); p.rect(4, 2, 8, 10, C.iron); p.rect(5, 3, 6, 8, C.flame); p.rect(5, 12, 6, 2, C.iron); } },
  crate: { draw(p) { p.rect(1, 1, 14, 14, C.woodLo); p.rect(2, 2, 12, 12, C.wood); p.line(2, 2, 13, 13, C.woodHi); p.line(13, 2, 2, 13, C.woodHi); } },
  // a sprite actor's pictures, one a direction
  horse_d: { size: [2, 2], frames: 2, draw(p, f) { horse(p, 'down', f); } },
  horse_u: { size: [2, 2], frames: 2, draw(p, f) { horse(p, 'up', f); } },
  horse_l: { size: [2, 2], frames: 2, draw(p, f) { horse(p, 'left', f); } },
  horse_r: { size: [2, 2], frames: 2, draw(p, f) { horse(p, 'right', f); } },
};

// the village: two houses on a lane (the big one three storeys, its door down to the
// cellar), a shed, a hedge, the green, the stream
const VILLAGE = [
  '~~~~~~~~~~~~~~~~~~~~~~~~',
  'TTTTTTTTTTTTTTTTTTTTTTTT',
  'T.......RRRRRR.........T',
  'T.......rrrrrr.hhhhhhh.T',
  'T..RRRR.wwwwww.........T',
  'T..rrrr.bwwwwb.........T',
  'T..wwww.bbbDbb.........T',
  'T..bDbb.......ppppp....T',
  'T..............p.......T',
  'p,,,,,.ppppppppp.......T',
  'T,,,,,.p...............T',
  'T......p......Rr.......T',
  'T......p......bb........',
  'T......p...............T',
  'T......p...............T',
  'T......p...............T',
  'BBBBBBBBBBBBBBBBBBBBBBBT',
  'SSSSSSSSSSSSSSSSSSSSSSST',
  'SSSSSSSSSSSSSSSSSSSSSSST',
];

// the house inside: the north wall a top row over two face rows (a window in the upper
// one), side walls of top tiles, the south wall one top row with the door; a partition
// that leaves a one-cell corridor ending in a dead end, and an alcove
const HOUSE = [
  '############',
  '#----W-----#',
  '#==========#',
  '#..........#',
  '#..........#',
  '#.....#.#..#',
  '#.....#.#..#',
  '#.....#.#..#',
  '#.....#.####',
  '#.....##...#',
  '#..........#',
  '####D#######',
];

const CELLAR = [
  '##########',
  '#........#',
  '#..P..P..#',
  '#........#',
  '#..P..P..#',
  '#........#',
  '#......S.#',
  '##########',
];

// the field: open ground, a terrace one level up with stairs that climb east
const FIELD = [
  '~~~~~~~~~~~~~~~~',
  'TTTTTTTTTTTTTTTT',
  'T..............T',
  'T...,,,........T',
  'T...,,,.....tttT',
  'T...........tttT',
  'T..........etttT',
  'T..............T',
  'T..............T',
  'T..............T',
  'T..............T',
  'T.......,,,,...T',
  '........,,,,...T',
  'T..............T',
  'T..............T',
  'T..............T',
  'BBBBBBBBBBBBBBBT',
  'SSSSSSSSSSSSSSST',
  'SSSSSSSSSSSSSSST',
];

export const villageMaps = {
  village: {
    name: 'place.village',
    legend: { '.': 'grass', ',': 'tall', p: 'path', R: 'ridge', r: 'roof', w: 'window', b: 'brick', D: 'door', h: 'hedge', T: 'trunk', B: 'bank', S: 'stream', '~': 'stream' },
    ground: VILLAGE,
    connections: [{ dir: 'east', map: 'field', offset: 0 }],
    warps: [
      { x: 0, y: 9, to: 'town', at: [12, 3], face: 'left' },     // the way back to the town, off the west edge
      { x: 4, y: 7, to: 'house', at: [4, 10], face: 'up' },      // the small house
      { x: 11, y: 6, to: 'cellar', at: [7, 5], face: 'up' },    // the big one: down to its cellar
    ],
    props: [
      { t: 'bigtree', x: 17, y: 10 }, { t: 'tent', x: 16, y: 14 }, { t: 'cart', x: 9, y: 14 }, { t: 'hut', x: 18, y: 7 },
      { t: 'barrel', x: 8, y: 7 }, { t: 'barrel', x: 8, y: 6 }, { t: 'bench', x: 2, y: 9 }, { t: 'puddle', x: 10, y: 10 }, { t: 'puddle', x: 13, y: 8 },
      { t: 'lamp', x: 12, y: 10 }, { t: 'well', x: 20, y: 3 },
    ],
    actors: [
      { id: 'villager', doll: 'walker', x: 15, y: 9, dir: 'down', move: 'wander', radius: 2, talk: async (api) => api.say('walker', 'village.villager') },
      { id: 'horse', sprite: { down: 'horse_d', up: 'horse_u', left: 'horse_l', right: 'horse_r' }, shadow: true, x: 20, y: 12, dir: 'left', move: 'turn', talk: async (api) => api.say(null, 'village.horse') },
      { id: 'bo', doll: 'bo', x: 3, y: 12, dir: 'right', talk: async (api) => api.say('bo', 'village.bo') },
      { id: 'boatman', doll: 'boatman', x: 6, y: 15, dir: 'down', move: 'turn', talk: async (api) => api.say('walker', 'village.boatman') },
    ],
    spots: [{ x: 20, y: 3, w: 2, h: 1, run: async (api) => api.say(null, 'village.well') }],
  },
  field: {
    name: 'place.field',
    legend: { '.': 'grass', ',': 'tall', T: 'trunk', t: 'terrace', e: 'ramp_e', B: 'bank', S: 'stream', '~': 'stream' },
    ground: FIELD,
    heights: [
      '0000000000000000',
      '0000000000000000',
      '0000000000000000',
      '0000000000000000',
      '0000000000001110',
      '0000000000001110',
      '0000000000001110',
    ],
    connections: [{ dir: 'west', map: 'village', offset: 0 }],
    skirt: 10,
    sky: ['#4a78c8', '#a8c8e8', '#e8e0d0'],
    // far hills, where no ground is: they slide slower than the ground
    parallax: [{ speed: 0.25, draw(ctx, ox, oy) {
      ctx.fillStyle = '#6a8ab0';
      for (let i = -2; i < 8; i++) { ctx.beginPath(); ctx.ellipse(ox % 240 + i * 90, 100, 70, 36, 0, 0, Math.PI * 2); ctx.fill(); }
    } }],
    props: [{ t: 'scarecrow', x: 5, y: 8 }, { t: 'crate', x: 13, y: 5 }, { t: 'sign', x: 2, y: 2 }],
    actors: [{ id: 'ana', doll: 'ana', x: 13, y: 4, dir: 'down', talk: async (api) => api.say('ana', 'field.ana') }],
  },
  house: {
    name: 'place.house',
    clock: false,
    legend: { '#': 'inwall_top', '-': 'inwall_hi', '=': 'inwall_lo', W: 'inwindow', '.': 'floor_wood', D: 'indoor' },
    ground: HOUSE,
    warps: [{ x: 4, y: 11, to: 'village', at: [4, 8], face: 'down' }],
    props: [
      { t: 'bed', x: 1, y: 4 }, { t: 'table', x: 3, y: 7 }, { t: 'chair', x: 2, y: 7 }, { t: 'shelf', x: 8, y: 3 }, { t: 'chest', x: 10, y: 5 },
      { t: 'stove', x: 4, y: 3 }, { t: 'rug', x: 1, y: 10 }, { t: 'crate', x: 10, y: 9 },
    ],
    actors: [
      { id: 'ana', doll: 'ana', x: 5, y: 7, dir: 'left', pose: 'sit', talk: async (api) => api.say('ana', 'house.ana') },
      { id: 'bo', doll: 'bo', x: 9, y: 7, dir: 'up', talk: async (api) => api.say('bo', 'house.bo') },
    ],
  },
  cellar: {
    name: 'place.cellar',
    clock: false,
    wallHeight: 32,
    ceiling: 'planks',
    fog: 6,
    dark: { color: '#06050c', alpha: 0.85 },
    reverb: { mix: 0.3, size: 1.2 },
    legend: { '#': 'cellar_wall', P: 'pillar', '.': 'cellar_floor', S: 'cellar_stairs' },
    ground: CELLAR,
    warps: [{ x: 7, y: 6, to: 'village', at: [11, 7], face: 'down' }],
    props: [{ t: 'barrel', x: 1, y: 1 }, { t: 'barrel', x: 2, y: 1 }, { t: 'crate', x: 8, y: 1 }, { t: 'lantern', x: 5, y: 1 }],
    // the player carries a torch here: a light with a beam
    actors: [
      { id: 'player', light: { r: 90, cone: 1.1, color: '#ffd090' } },
      { id: 'guard', doll: 'guard', x: 4, y: 3, dir: 'right', talk: async (api) => api.say('guard', 'cellar.guard') },
    ],
  },
};

// Where the camera has a hard time, each a jump: the player's back to a wall, a one-cell
// gap, the map's edge, a corridor, a dead end, under a crown, on a terrace. `view` puts
// the player's own choice of camera there first (what the options would), where the
// cartridge leaves it to them.
const go = (map, x, y, dir, view) => async (api) => { if (view) setViewChoice(api.game.id, view); await api.warp(map, x, y, dir); };
export const villageJumps = [
  { label: 'village', run: go('village', 7, 9, 'up') },
  { label: 'village, back to a wall', run: go('village', 5, 8, 'down', 'third') },
  { label: 'village, between the houses', run: go('village', 7, 6, 'up', 'third') },
  { label: 'village, under the tree', run: go('village', 18, 11, 'up', 'third') },
  { label: 'village, by the stream', run: go('village', 12, 15, 'down', 'third') },
  { label: 'village, the lane east', run: go('village', 22, 12, 'right', 'third') },
  { label: 'field', run: go('field', 2, 12, 'right') },
  { label: 'field, the terrace', run: go('field', 12, 5, 'left', 'third') },
  { label: 'house', run: go('house', 4, 10, 'up') },
  { label: 'house, the corridor', run: go('house', 7, 6, 'down', 'third') },
  { label: 'house, the dead end', run: go('house', 7, 8, 'down', 'third') },
  { label: 'house, the alcove', run: go('house', 10, 7, 'down', 'third') },
  { label: 'house, by the window', run: go('house', 5, 3, 'up', 'first') },
  { label: 'cellar', run: go('cellar', 7, 5, 'up') },
  { label: 'cellar, from behind', run: go('cellar', 7, 5, 'up', 'third') },
];

// Engine lab: the smallest cartridge that exercises every engine feature, for checking
// the engine after a change. Not on the shelf. Link it in and boot it:
//   ln -s ../../tools/lab public/games/lab   →   /?game=lab
// town (grid): ledges, tall grass, a watcher, a bag list, a stage, portraits, the log.
// cave (free movement): a hitbox, a slime entity, a pushable block, a HUD, and the
// extra buttons: X heals, Y emotes, Z shakes (declared X and Y; Z comes out by being read).
// plaza (life and light): passers-by (crowd), a guard on a route, a wanderer, the A hint,
// directed conversation, footsteps on cobbles, lamps that light the night, snow and
// fireflies, a music layer, poses and gestures, text effects, a living portrait, cinema
// bars, an iris door, a pond that reflects, a quest, a collection and the credits.
// shore (getting about, engine/move.js): sea to swim, deep water to dive into a reef
// below with its breath bar, a chasm to fly over, a cliff to climb, ice, a current, a
// fence a flyer crosses, a gull that always flies and a swimmer who never leaves the water.
// hill (heights, 2.5D): a mesa one level up with a tower two up, stairs between them,
// faces drawn by the engine (and by a tile's own `side`), a person and a sign on top,
// a dropping-off edge, and whoever walks behind the tower hidden by it.
// flyover (dev menu): the plaza from the air in Mode 7, gliding north and turning.
// concert (dev menu): a song on real instruments — piano, strings, flute, a harp, the kit —
// and Options' "Instrumentos" to hear it as chiptune.
// city (dev menu, ./city.js): streets with traffic and signals, people on the pavement,
// the player's own car, a police chase, shooting, the minimap and a mission; the clock
// (a day in six minutes) lights every outdoor map, and Pip rides along in a vehicle.
// zaragoza (dev menu, ./zaragoza.js): the whole city from OpenStreetMap on one map, its
// streets a graph with diagonals, signals and traffic.
// village, field, house, cellar (dev menu, ./village.js): what an ordinary cartridge is
// made of, as a bench for the modern look and the ground views — houses from 3/4 tiles,
// an interior, a map made for the eyes, maps joined edge to edge, big props, a terrace —
// with a jump at every place the camera has a hard time. tools/bench.mjs walks them.
// ?dev=1 adds the overlay (F2) and the jump menu (F3).
import { SCREEN_W } from '../../engine/gfx.js';
import { drawText, drawBig, measure, measureBig } from '../../engine/font.js';
import { t } from '../../engine/i18n.js';
import { bar, panel, textBox } from '../../engine/ui.js';
import { cityTiles, cityDolls, cityMap, cityMissions, cityJumps, cityVehicles } from './city.js';
import { zaragozaTiles, zaragozaMap, zaragozaJumps } from './zaragoza.js';
import { villageTiles, villageMaps, villageJumps } from './village.js';

const C = {
  ink: '#22201c', grass: '#5a9a4a', grassHi: '#74b65e', grassLo: '#3e7a34', tall: '#2e6e2a', tallHi: '#58a048',
  rock: '#7a7068', rockHi: '#a0968a', rockLo: '#544c46', floor: '#4a4058', floorHi: '#5c5070', slime: '#58c070',
  sky: '#203048', paper: '#f4ecd8', red: '#d84838',
};

const tiles = {
  grass: { draw(p) { p.fill(C.grass); p.noise(0, 0, 16, 16, [C.grassHi, C.grassLo], 0.15); } },
  // tall grass: its blades are painted again over whoever walks through it
  tall: {
    draw(p) { p.fill(C.tall); p.noise(0, 0, 16, 16, [C.tallHi], 0.2); },
    top(p) { p.rect(0, 11, 16, 5, C.tall); for (let x = 0; x < 16; x += 2) { p.vline(x, 8 + (x % 4 ? 1 : 0), 3, C.tall); p.px(x, 8 + (x % 4 ? 1 : 0), C.tallHi); } },
  },
  ledge: { ledge: 'down', draw(p) { p.fill(C.grass); p.rect(0, 9, 16, 4, C.rockLo); p.hline(0, 9, 16, C.rockHi); } },
  rock: { solid: true, draw(p) { p.fill(C.rockLo); p.rect(1, 1, 14, 13, C.rock); p.hline(2, 2, 11, C.rockHi); } },
  cave_door: { solid: true, draw(p) { p.fill(C.rockLo); p.rect(3, 2, 10, 14, C.ink); } },
  floor: { draw(p) { p.fill(C.floor); p.noise(0, 0, 16, 16, [C.floorHi], 0.1); } },
  exit: { draw(p) { p.fill(C.floor); p.rect(4, 0, 8, 3, C.paper); } },
  cobble: { step: 'hard', draw(p) { p.fill(C.rock); for (let y = 0; y < 16; y += 4) for (let x = (y % 8 ? 2 : 0); x < 16; x += 4) p.rect(x, y, 3, 3, C.rockHi); } },
  // an autotile: its stone rim follows the pond's outline, corners included
  pond: { solid: true, reflect: 0.4, frames: 2, auto: true, draw(p, f, m) {
    p.fill('#2a5a8a'); p.hline(4 + f * 3, 7, 5, '#5a8ac0'); p.hline(7 - f * 2, 11, 4, '#4a7ab0');
    p.edge(m, { color: C.rockHi, width: 2, inner: C.rockHi });
  } },
  // getting about: each medium is solid to whoever can't use it
  sand: { dust: '#e8d8a8', draw(p) { p.fill('#d8c890'); p.noise(0, 0, 16, 16, ['#e8dca8', '#c0b078'], 0.12); } },
  sea: { medium: 'water', step: 'water', dust: false, frames: 2, draw(p, f) { p.fill('#3a78b8'); p.hline(2 + f * 4, 5, 5, '#6aa8e0'); p.hline(9 - f * 3, 11, 4, '#5a98d0'); } },
  deep: { medium: 'deep', step: 'water', dust: false, frames: 2, draw(p, f) { p.fill('#1e4a88'); p.hline(3 + f * 3, 6, 4, '#3a6aa8'); p.hline(10 - f * 2, 12, 3, '#2e5a98'); } },
  chasm: { medium: 'air', draw(p) { p.fill('#141018'); p.hline(0, 0, 16, C.rockLo); p.rect(0, 1, 16, 2, '#241c28'); } },
  cliff: { medium: 'climb', step: 'hard', draw(p) { p.fill(C.rockLo); for (let y = 2; y < 16; y += 5) { p.hline(3, y, 3, C.rockHi); p.hline(10, y + 2, 3, C.rockHi); } p.vline(0, 0, 16, C.ink); p.vline(15, 0, 16, C.ink); } },
  ice: { medium: 'ice', step: 'hard', dust: false, draw(p) { p.fill('#b8dcf0'); p.line(2, 12, 7, 7, '#e8f6ff'); p.line(9, 14, 13, 10, '#e8f6ff'); } },
  current: { push: 'right', step: 'water', dust: false, frames: 2, draw(p, f) { p.fill('#3a78b8'); for (const y of [4, 11]) { p.hline(3 + f * 2, y, 5, '#a8d8f8'); p.px(8 + f * 2, y - 1, '#a8d8f8'); p.px(8 + f * 2, y + 1, '#a8d8f8'); } } },
  seabed: { draw(p) { p.fill('#3a6a80'); p.noise(0, 0, 16, 16, ['#4a7a90', '#2e5a70'], 0.15); } },
  reefrock: { solid: true, draw(p) { p.fill('#1e3a50'); p.rect(1, 2, 14, 12, '#2a4a60'); p.hline(2, 3, 10, '#3e6478'); } },
  // heights: a mesa's grass with its own rock face; stairs (a ramp) with steps for a face;
  // the tower's stone, whose face the engine draws from its bottom row
  mesa: { draw(p) { p.fill(C.grass); p.noise(0, 0, 16, 16, [C.grassHi, C.grassLo], 0.15); p.hline(0, 0, 16, C.grassHi); },
    side(p, f, h) { p.fill(C.rock); for (let y = 0; y < h; y += 4) for (let x = (y % 8 ? 3 : 0); x < 16; x += 6) p.hline(x, y, 4, C.rockLo); p.hline(0, 0, 16, C.grassLo); p.hline(0, h - 1, 16, C.rockLo); } },
  stairs: { ramp: true, step: 'hard', draw(p) { p.fill(C.rock); p.hline(0, 0, 16, C.rockHi); p.vline(0, 0, 16, C.rockLo); p.vline(15, 0, 16, C.rockLo); },
    side(p, f, h) { p.fill(C.rockLo); for (let y = 0; y < h; y += 3) { p.hline(1, y, 14, C.rockHi); p.hline(1, y + 1, 14, C.rock); } p.vline(0, 0, h, C.ink); p.vline(15, 0, h, C.ink); } },
  tower: { step: 'hard', draw(p) { p.fill(C.rock); for (let y = 0; y < 16; y += 4) for (let x = (y % 8 ? 2 : 0); x < 16; x += 4) p.rect(x, y, 3, 3, C.rockHi); } },
  fence: { low: true, draw(p) { p.rect(1, 6, 2, 10, '#7a5a3a'); p.rect(13, 6, 2, 10, '#7a5a3a'); p.rect(0, 8, 16, 2, '#9a7a50'); p.rect(0, 12, 16, 2, '#9a7a50'); } },
  sign: { examine: 'shore.top', draw(p) { p.rect(7, 8, 2, 8, '#6a4a2a'); p.rect(2, 2, 12, 7, '#9a7a50'); p.hline(4, 4, 8, '#6a4a2a'); p.hline(4, 6, 6, '#6a4a2a'); } },
  clam: { draw(p) { p.ellipse(8, 11, 6, 4, '#c8b8d8'); p.hline(3, 11, 10, '#8a789a'); p.px(8, 10, '#fff8f0'); } },
  kelp: { size: [1, 2], solid: false, frames: 2, draw(p, f) { for (let y = 4; y < 32; y += 4) p.rect(6 + ((y / 4 + f) % 2), y, 3, 4, y % 8 ? '#3a8a50' : '#2e7040'); } },
  wall: { solid: true, draw(p) { p.fill(C.rockLo); p.hline(0, 15, 16, C.ink); } },
  lamp: { size: [1, 2], foot: [1, 1], examine: 'plaza.lamp', light: { r: 40, color: '#ffb050', flicker: 1 },
    draw(p) { p.rect(7, 6, 2, 26, C.ink); p.rect(5, 2, 6, 5, C.ink); p.rect(6, 3, 4, 3, '#ffd070'); } },
  well: { size: [2, 2], foot: [2, 1], draw(p) { p.rect(2, 10, 28, 22, C.rockLo); p.rect(4, 12, 24, 6, C.ink); p.hline(2, 10, 28, C.rockHi); p.rect(4, 0, 2, 12, C.ink); p.rect(26, 0, 2, 12, C.ink); p.rect(4, 0, 24, 2, C.ink); } },
};

// the cast: each with the marks of a life (engine/doll.js, "A face and clothes that have
// lived"), so every option of the doll is on the sheet and in the diorama
const dolls = {
  hero: { skin: '#e8b48c', hair: '#3a2a1a', hairStyle: 'short', top: '#3a6ab0', bottom: '#2a3040', relief: true, belt: '#5a3a22' },
  ana: { skin: '#c48c64', hair: '#1e1612', hairStyle: 'long', top: '#b04a3a', bottom: '#4a3a2a', dress: true, relief: true, apron: '#e8dcc0', sleeves: 'rolled' },
  bo: { skin: '#e0b090', hair: '#c08030', hairStyle: 'buzz', top: '#408040', bottom: '#303030', hat: 'cap', relief: true, scarf: '#d8a030', worn: true, gloves: '#6a4a30' },
  guard: { skin: '#d0a080', hair: '#2a2a2a', hairStyle: 'short', top: '#5a5a7a', bottom: '#2a2a3a', hat: 'helmet', hatColor: '#9098a8', relief: true, weathered: true, scar: 'cheek', beard: 'stubble' },
  sage: { skin: '#e8c0a0', hair: '#d8d8d0', hairStyle: 'long', top: '#6a4a8a', bottom: '#3a2a4a', coat: '#4a3a6a', relief: true, lines: true, belt: '#8a6a30' },
  walker: { skin: '#a87050', hair: '#1e1612', hairStyle: 'short', top: '#a06a30', bottom: '#4a3a2a', relief: true, weathered: true, hat: 'bandana', hatColor: '#b03a30', sleeves: 'rolled', worn: true, boots: '#5a3a22' },
  // the one-eyed boatman: a scar across the other eye too
  boatman: { skin: '#c89868', hair: '#4a3a2a', hairStyle: 'receding', top: '#4a5a6a', bottom: '#2a3038', relief: true, weathered: true, eyepatch: 'left', scar: 'brow', beard: 'full', beardColor: '#6a5a4a', scarf: '#c04838' },
};

// a 40×40 face; mood changes the mouth
// the shore and the reef below it share their cells: the deep water (O) is where you go
// under, and the reef's same cells are where you come up
const SHORE = [
  '####################',
  '#..................#',
  '#..................#',
  '##CC################',
  '#.........::::.....#',
  '#.........::::.....#',
  '#..^^^....::::.....#',
  '#..^^^.............#',
  '#.......>>>>>>.....#',
  'Dssssssssssssssssss#',
  '#ss~~~~~~~~~~~~~~ss#',
  '#s~~~~OOOOOO~~~~~~s#',
  '#s~~~OOOOOOOO~~~~~s#',
  '#ss~~~~~~~~~~~~~~ss#',
  '####################',
];
const REEF = SHORE.map((r, y) => (y < 10 ? '#'.repeat(20) : r.replace(/[^#]/g, ',').replace(/^#,/, '##').replace(/,#$/, '##')));

const portraits = {
  ana(ctx, x, y, f, mood, state = {}) {
    ctx.fillStyle = '#e8d8c0'; ctx.fillRect(x, y, 40, 40);
    ctx.fillStyle = '#1e1612'; ctx.fillRect(x + 8, y + 4, 24, 34);
    ctx.fillStyle = '#c48c64'; ctx.fillRect(x + 12, y + 10, 16, 20);
    // eyes shut on a blink; the mouth opens on the beats of a line being said
    const eh = state.blink ? 1 : 3;
    ctx.fillStyle = C.ink; ctx.fillRect(x + 15, y + 17 + 3 - eh, 2, eh); ctx.fillRect(x + 23, y + 17 + 3 - eh, 2, eh);
    ctx.fillStyle = '#802a20';
    if (state.mouth) ctx.fillRect(x + 17, y + 24, 6, 3);
    else if (mood === 'smile') { ctx.fillRect(x + 16, y + 25, 8, 1); ctx.fillRect(x + 15, y + 24, 1, 1); ctx.fillRect(x + 24, y + 24, 1, 1); }
    else ctx.fillRect(x + 17, y + 25, 6, 1);
    ctx.fillStyle = '#b04a3a'; ctx.fillRect(x + 6, y + 32, 28, 8);
  },
};

// full-body art for the stage; bo has none and stands in with his doll
const figures = {
  ana(ctx, x, y, f, mood) {
    const b = Math.round(Math.sin(f / 30));
    ctx.fillStyle = '#b04a3a'; ctx.fillRect(x - 16, y - 60 + b, 32, 60);
    ctx.fillStyle = '#c48c64'; ctx.fillRect(x - 10, y - 88 + b, 20, 26);
    ctx.fillStyle = '#1e1612'; ctx.fillRect(x - 13, y - 92 + b, 26, 10); ctx.fillRect(x - 13, y - 82 + b, 4, 24); ctx.fillRect(x + 9, y - 82 + b, 4, 24);
    ctx.fillStyle = C.ink; ctx.fillRect(x - 6, y - 78 + b, 2, 3); ctx.fillRect(x + 4, y - 78 + b, 2, 3);
    if (mood === 'smile') ctx.fillRect(x - 3, y - 70 + b, 6, 1);
  },
};

const BAG = Array.from({ length: 14 }, (_, i) => ({ label: `item.n${i % 7}`, value: `x${i + 1}`, note: `item.note${i % 7}` }));

const maps = {
  town: {
    name: 'place.town',
    legend: { '.': 'grass', ',': 'tall', '_': 'ledge', '#': 'rock', D: 'cave_door' },
    ground: [
      '####D#########',
      '#............#',
      '#.....,,,,...#',
      '#.....,,,,...D',
      '#____...._____',
      '#............#',
      '#............D',
      '#............#',
      '##############',
    ],
    warps: [{ x: 4, y: 0, to: 'cave', at: [6, 7], face: 'up' }, { x: 13, y: 6, to: 'plaza', at: [12, 2], face: 'down' }, { x: 13, y: 3, to: 'village', at: [1, 9], face: 'right' }],
    actors: [
      { id: 'ana', doll: 'ana', x: 2, y: 6, dir: 'right', talk: async (api) => {
        await api.say('ana', 'town.ana_1', { mood: 'smile' });
        const i = await api.ask('ana', 'town.ana_ask', ['town.opt_bag', 'town.opt_stage', 'town.opt_panel', 'town.opt_none']);
        if (i === 0) {
          const k = await api.list(BAG, { title: 'town.bag' });
          if (k >= 0) await api.say(null, 'town.picked', { vars: { item: api.text(BAG[k].label) } });
        } else if (i === 1) {
          const st = api.stage({ bg: (ctx) => { ctx.fillStyle = C.sky; ctx.fillRect(0, 0, 240, 160); ctx.fillStyle = C.grassLo; ctx.fillRect(0, 100, 240, 60); } });
          st.show('ana', { at: 'left', mood: 'smile' });
          await api.wait(300);
          await api.say('ana', 'town.stage_1', { mood: 'smile' });
          st.show('bo', { at: 'right' });
          await api.say('bo', 'town.stage_2');
          st.hide('bo');
          await api.say('ana', 'town.stage_3');
          await st.close();
        } else if (i === 2) {
          await api.play(new StatsPanel());
        }
      } },
      // the watcher: walk into his line and he comes to you, once
      { id: 'bo', doll: 'bo', x: 11, y: 7, dir: 'left', sight: { range: 5, flag: 'met_bo', run: async (api) => {
        await api.say('bo', 'town.bo_seen');
      } }, talk: async (api) => api.say('bo', 'town.bo_after') },
    ],
    // the objective has a place on another map: the guide points to the door that leads there
    async enter(api) { if (!api.save.objective) api.objective('obj.town', { map: 'plaza', x: 18, y: 8, w: 2 }); },
  },
  shore: {
    name: 'place.shore',
    below: 'reef',
    legend: { '#': 'rock', '.': 'grass', s: 'sand', '~': 'sea', O: 'deep', '^': 'chasm', C: 'cliff', ':': 'ice', '>': 'current', D: 'cave_door' },
    ground: SHORE,
    warps: [{ x: 0, y: 9, to: 'town', at: [1, 6], face: 'right' }],
    props: [
      ...[15, 16, 17, 18].map((x) => ({ t: 'fence', x, y: 5 })), { t: 'fence', x: 15, y: 6 },
      ...[15, 16, 17, 18].map((x) => ({ t: 'fence', x, y: 7 })),
      { t: 'sign', x: 16, y: 1 },
    ],
    actors: [
      { id: 'gull', doll: 'walker', mode: 'fly', x: 9, y: 1, move: 'wander', radius: 4, talk: async (api) => api.say('walker', 'shore.gull') },
      { id: 'swimmer', doll: 'ana', mode: 'swim', x: 15, y: 11, move: 'wander', radius: 2, talk: async (api) => api.say('ana', 'shore.swimmer') },
    ],
    // a boat at the water's edge: A from the sand gets in, and it only goes on water
    async enter(api) { api.addVehicle({ id: 'rowboat', body: 'boat', x: 5, y: 11, dir: 'right' }); },
  },
  reef: {
    name: 'place.reef',
    clock: false,
    above: 'shore',
    breath: 12,
    grade: '#a8c8f0',
    legend: { '#': 'reefrock', ',': 'seabed' },
    ground: REEF,
    props: [{ t: 'kelp', x: 3, y: 12 }, { t: 'kelp', x: 15, y: 11 }, { t: 'clam', x: 9, y: 13 }],
    fx: [{ name: 'bubbles', x: 3, y: 11, every: 900 }, { name: 'bubbles', x: 15, y: 10, every: 1300 }],
    spots: [{ x: 9, y: 13, run: async (api) => { api.collect('coins', 'reef'); await api.say(null, 'shore.pearl'); } }],
  },
  hill: {
    name: 'place.hill',
    drop: true,
    legend: { '.': 'grass', ',': 'tall', 'm': 'mesa', 's': 'stairs', 't': 'tower', '#': 'rock', D: 'cave_door' },
    ground: [
      '################',
      '#..............#',
      '#..mmmmmmmmmm..#',
      '#..mmmtttmmmm..#',
      '#..mmmtttmmmm..#',
      '#..mmmtstmmmm,,#',
      '#..mmmmmmmmmm,,#',
      '#..mmmmsmmmmm..#',
      '#..............#',
      '#....,,,.......#',
      '#..............#',
      '#######D########',
    ],
    warps: [{ x: 7, y: 11, to: 'town', at: [7, 7], face: 'down' }],
    heights: [
      '0000000000000000',
      '0000000000000000',
      '0001111111111000',
      '0001112221111000',
      '0001112221111000',
      '0001112221111000',
      '0001111111111000',
      '0001111111111000',
    ],
    props: [{ t: 'sign', x: 11, y: 3 }, { t: 'fence', x: 3, y: 2 }, { t: 'fence', x: 4, y: 2 }],
    actors: [
      { id: 'bo', doll: 'bo', x: 7, y: 3, dir: 'down', talk: async (api) => api.say('bo', 'hill.bo') },
      { id: 'sage', doll: 'sage', x: 10, y: 6, dir: 'left', move: 'wander', radius: 1, talk: async (api) => api.say('sage', 'hill.sage') },
      { id: 'walker', doll: 'walker', x: 7, y: 1, dir: 'right', route: { path: [[2, 1], [13, 1]], back: true }, talk: async (api) => api.say('walker', 'hill.walker') },
    ],
  },
  plaza: {
    name: 'place.plaza',
    legend: { '.': 'cobble', '#': 'wall', D: 'cave_door', '~': 'pond' },
    ground: [
      '########################',
      '############D###########',
      ...Array.from({ length: 4 }, () => '#......................#'),
      '.......................#',
      ...Array.from({ length: 4 }, () => '#......................#'),
      '#.....~~~~~~...........#',
      '#.....~~~~~~...........#',
      '########################',
    ],
    props: [{ t: 'lamp', x: 8, y: 4 }, { t: 'lamp', x: 16, y: 4 }, { t: 'lamp', x: 4, y: 11 }, { t: 'well', x: 18, y: 8, id: 'well' }],
    warps: [{ x: 12, y: 1, to: 'town', at: [12, 6], face: 'left', transition: 'iris' }],
    // the well answers from any side the player can touch it: its foot row
    spots: [{ x: 18, y: 8, w: 2, h: 1, run: async (api) => {
      await api.say(null, 'plaza.well');
      api.collect('coins', 'well');
      api.objective('obj.sage', 'sage');
    } }],
    direct: true,
    // the pond babbles: louder as the player comes near, from its side
    sounds: [{ x: 8, y: 11, ambience: 'water', radius: 7 }],
    dark: (api) => (api.is('night') ? { color: '#0a1030', alpha: 0.78 } : null),
    weather: (api) => (api.is('night') ? 'fireflies' : 'snow'),
    actors: [
      // at the east end of his round he stops, looks up at the wall and says so
      { id: 'guard', doll: 'guard', x: 3, y: 9, dir: 'right', route: { path: [[3, 9], [20, 9, { face: 'up', gesture: 'nod', bark: 'plaza.guard_bark', pause: 2500 }]], back: true, pause: 1800 },
        talk: async (api) => api.say('guard', 'plaza.guard') },
      { id: 'sage', doll: 'sage', x: 14, y: 3, dir: 'down', move: 'wander', radius: 1, talk: async (api, self) => {
        await api.letterbox(true);
        await api.say('sage', 'plaza.sage_1');
        await api.say('guard', 'plaza.guard_reply');
        await self.gesture('nod');
        await api.emote('guard', 'heart', 700);
        await api.say('sage', 'plaza.sage_2');
        api.set('night', !api.is('night'));
        api.musicLayer('night', api.is('night'));
        await api.letterbox(false);
        if (!api.questState('lamps')) api.quest('lamps');
        else if (api.questState('lamps') === 'open') api.quest('lamps', 'done');
      } },
      // someone resting on the edge of the pond, seated; another kneels by the water
      // the two by the pond chat between themselves; the kneeler looks up and greets
      { id: 'reader', doll: 'ana', x: 10, y: 10, dir: 'down', pose: 'sit', chat: { with: 'kneeler', lines: ['plaza.chat_1', 'plaza.chat_2', 'note'], every: 6000, first: 800 }, talk: async (api, self) => {
        await api.say('ana', 'plaza.reader', { mood: 'smile' });
        await self.gesture('hop');
      } },
      { id: 'kneeler', doll: 'bo', x: 8, y: 10, dir: 'down', look: 3, greet: 'plaza.greet', bump: 'sweat', talk: async (api) => api.say('bo', 'plaza.kneeler') },
    ],
    // someone crosses the plaza from the open west edge and goes in by the north door
    crowd: [{ id: 'walker', doll: 'walker', path: [[0, 6], [12, 6], [12, 2]], every: 6000, first: 500,
      talk: async (api) => api.say('walker', 'plaza.walker') }],
  },
  cave: {
    name: 'place.cave',
    clock: false,
    reverb: { mix: 0.4, size: 1.6 },
    movement: 'free',
    run: false,
    legend: { '.': 'floor', '#': 'rock', E: 'exit' },
    ground: [
      '############',
      '#..........#',
      '#..#.......#',
      '#..#....#..#',
      '#..........#',
      '#..........#',
      '#..........#',
      '#.....E....#',
      '############',
    ],
    warps: [{ x: 6, y: 7, to: 'town', at: [4, 1], face: 'down' }],
    // the extra buttons: X and Y are declared on the game (`buttons`), Z only read here, so
    // the handheld shows it from the first frame in the cave and keeps it
    update(api, e, control) {
      if (!control) return;
      if (api.input.pressed('x')) { api.save.hp = 6; api.sfx('bump'); }
      if (api.input.pressed('y')) api.emote('player', 'heart', 500);
      if (api.input.pressed('z')) api.shake(200, 3);
    },
    async enter(api) {
      api.save.hp ??= 6;
      // a slime that drifts toward the player and hurts on touch
      api.addEntity({
        x: 150, y: 40, w: 12, h: 10, kind: 'slime',
        update(api, e, self) {
          const p = api.box('player');
          const dx = Math.sign(p.x - self.x) * 0.5;
          const dy = Math.sign(p.y - self.y) * 0.5;
          api.move(self, dx, dy);
          if (self.cool > 0) self.cool--;
          else if (api.overlaps(self, 'player')) { api.save.hp = Math.max(0, api.save.hp - 1); self.cool = 60; api.sfx('bump'); api.shake(150, 2); }
        },
        draw(ctx, x, y, e) {
          const sq = Math.round(Math.sin(e.frame / 8));
          ctx.fillStyle = C.ink; ctx.fillRect(x - 1, y - 1 + sq, 14, 12 - sq);
          ctx.fillStyle = C.slime; ctx.fillRect(x, y + sq, 12, 10 - sq);
          ctx.fillStyle = C.paper; ctx.fillRect(x + 3, y + 3 + sq, 2, 2); ctx.fillRect(x + 8, y + 3 + sq, 2, 2);
        },
      });
      // a block the player pushes by walking into it
      api.addEntity({
        x: 80, y: 80, w: 16, h: 16, solid: true, kind: 'block',
        update(api, e, self) {
          const p = api.box('player');
          const near = (a, b, w) => a < b + w && b < a + w;
          const dir = api.player.dir;
          const held = api.input.held(dir);
          if (!held) return;
          const touching = (dir === 'right' && Math.abs(p.x + p.w - self.x) <= 1 && near(p.y, self.y, 12))
            || (dir === 'left' && Math.abs(self.x + self.w - p.x) <= 1 && near(p.y, self.y, 12))
            || (dir === 'down' && Math.abs(p.y + p.h - self.y) <= 1 && near(p.x, self.x, 12))
            || (dir === 'up' && Math.abs(self.y + self.h - p.y) <= 1 && near(p.x, self.x, 12));
          if (!touching) return;
          const [dx, dy] = { right: [0.5, 0], left: [-0.5, 0], down: [0, 0.5], up: [0, -0.5] }[dir];
          api.move(self, dx, dy);
        },
        draw(ctx, x, y) {
          ctx.fillStyle = C.ink; ctx.fillRect(x, y - 4, 16, 20);
          ctx.fillStyle = C.rockHi; ctx.fillRect(x + 1, y - 3, 14, 6);
          ctx.fillStyle = C.rock; ctx.fillRect(x + 1, y + 3, 14, 12);
        },
      });
    },
    hud(ctx, api) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(2, 2, 58, 11);
      bar(ctx, 4, 4, 54, 7, api.save.hp ?? 6, 6, { fill: C.red, steps: 6 });
    },
  },
};

// a cartridge's own screen built from the engine's widgets
export class StatsPanel {
  constructor() { this.opaque = false; this.aboveFade = true; this.f = 0; }
  update(e) { this.f++; if (this.f > 10 && (e.input.pressed('a') || e.input.pressed('b'))) this.done(); }
  draw(ctx) {
    panel(ctx, 20, 20, 200, 90, t('stats.title'));
    drawText(ctx, t('stats.hp'), 30, 40, '#384050');
    bar(ctx, 70, 41, 120, 6, 23, 40, { fill: '#58c070' });
    drawText(ctx, t('stats.xp'), 30, 54, '#384050');
    bar(ctx, 70, 55, 120, 4, 7, 10, { fill: '#5fa0ff' });
    textBox(ctx, t('stats.blurb'), 30, 70, 180, { lines: 3 });
  }
}

export default {
  id: 'lab',
  version: 2,
  // version 1 kept a 'hearts' flag; version 2 calls it hp in the save itself
  migrate(save, from) {
    if (from < 2) { save.hp = save.flags.hearts ?? 6; delete save.flags.hearts; }
    return save;
  },
  saves: 3,
  log: true,
  skip: true,
  // the handheld shows X and Y from the title; the cave reads Z too (see its update)
  buttons: ['x', 'y'],
  meta: { title: 'meta.title', tagline: 'meta.tagline' },
  strings: ['locales/es/common.json'],
  theme: { ui: { speakers: { ana: { color: '#b04a3a', voice: 700 }, bo: { color: '#408040', voice: 500 }, guard: { color: '#5a5a7a', voice: 450 }, sage: { color: '#6a4a8a', voice: 650 }, walker: { color: '#a06a30', voice: 600 } } } },
  tiles: { ...tiles, ...cityTiles, ...zaragozaTiles, ...villageTiles }, dolls: { ...dolls, ...cityDolls }, maps: { ...maps, ...villageMaps, city: cityMap, zaragoza: zaragozaMap }, portraits, figures,
  missions: cityMissions,
  vehicles: cityVehicles,
  // the hour passes (engine/clock.js): a day in six minutes; the cave and the reef are indoors
  clock: { start: 12, speed: 4, show: true },
  songs: {
    // real instruments by name, and one chiptune voice heard as a harp
    concert: {
      bpm: 92,
      channels: {
        melody: { inst: 'flute', vol: 1 },
        arp: { inst: 'pulse12', real: 'harp', vol: 0.8, echo: 0.25 },
        chords: { inst: 'strings', vol: 0.9 },
        piano: { inst: 'piano', vol: 0.7 },
        low: { inst: 'cello', vol: 0.9 },
        drums: { inst: 'drums', real: 'kit', vol: 0.7 },
      },
      patterns: {
        A: {
          melody: 'E5 - - - D5 - C5 - D5 - - - - - . . C5 - - - B4 - A4 - B4 - - - - - . .',
          arp: 'A3 C4 E4 A4 E4 C4 A3 C4 F3 A3 C4 F4 C4 A3 F3 A3 C3 E3 G3 C4 G3 E3 C3 E3 G3 B3 D4 G4 D4 B3 G3 B3',
          chords: 'A3 - - - - - - - F3 - - - - - - - C4 - - - - - - - G3 - - - - - - -',
          piano: 'A4 . . . C5 . . . A4 . . . F4 . . . G4 . . . E4 . . . D4 . . . B3 . . .',
          low: 'A2 - - - - - - - F2 - - - - - - - C3 - - - - - - - G2 - - - - - - -',
          drums: 'k . h . s . h . k . h k s . h h',
        },
      },
    },
  },
  player: 'hero',
  title: {
    intro: 20,
    draw(ctx) {
      ctx.fillStyle = C.sky; ctx.fillRect(0, 0, SCREEN_W, 160);
      const s = t('meta.title');
      drawBig(ctx, s, Math.round((SCREEN_W - measureBig(s, 3)) / 2), 50, C.paper, 3);
    },
  },
  cover(ctx, x, y, w) { ctx.fillStyle = C.sky; ctx.fillRect(x, y, w, 56); const s = t('meta.title'); drawText(ctx, s, x + Math.round((w - measure(s)) / 2), y + 24, C.paper); },
  async onSelect(api) { await api.say(null, api.save.objective || 'obj.town', { style: 'box' }); },
  async newGame(api) { await api.warp('town', 7, 6, 'up'); api.persist(); },
  collections: { coins: { name: 'col.coins', total: 3 } },
  // a companion who walks behind the player everywhere but the cave
  party: (api) => [{ id: 'pip', doll: 'walker', when: () => api.map !== 'cave' && api.map !== 'city' && api.map !== 'zaragoza', talk: async (a) => a.say('walker', 'party.pip') }],
  ambiences: {
    // running water: filtered noise that swells and ebbs
    water({ ctx, dest, noise }) {
      const src = ctx.createBufferSource();
      src.buffer = noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = 0.25;
      src.connect(f).connect(g).connect(dest);
      src.start();
      return () => src.stop();
    },
  },
  dev: { jumps: [
    ...villageJumps,
    ...cityJumps,
    ...zaragozaJumps,
    { label: 'credits', run: async (api) => api.credits({ lines: [{ title: 'credits.made', names: ['credits.engine'] }, 'credits.thanks'] }) },{ label: 'plaza, night', run: async (api) => { api.set('night'); await api.warp('plaza', 12, 2, 'down'); } },
    // getting about: on foot (the sea, the chasm and the cliff are walls), then with every ability
    { label: 'shore, on foot', run: async (api) => { for (const k of ['swim', 'dive', 'fly', 'climb']) api.revoke(k); await api.warp('shore', 6, 9, 'down'); } },
    { label: 'shore, every ability', run: async (api) => { for (const k of ['swim', 'dive', 'fly', 'climb']) api.grant(k); await api.warp('shore', 6, 9, 'down'); } },
    { label: 'concert (real instruments)', run: async (api) => { await api.warp('town', 7, 6, 'up'); api.music('concert'); } },
    { label: 'hill (heights)', run: async (api) => { await api.warp('hill', 7, 9, 'up'); } },
    // Mode 7: the plaza from the air, gliding north and turning
    { label: 'flyover', run: async (api) => { await api.warp('plaza', 12, 10, 'up'); await api.flyover({ from: [12, 12], to: [12, 2], turn: 30, ms: 5000 }); } },
    { label: 'shore, held flight', run: async (api) => { await api.warp('shore', 6, 9, 'down'); api.setMode('player', 'fly'); } },
    // jumps, scene-only: on the spot, sideways over a cell, up over the ledge
    { label: 'jumps', run: async (api) => {
      await api.warp('town', 7, 6, 'up');
      const ana = api.actor('ana');
      await api.jump('ana');
      await ana.jump('right', { n: 2 });
      await ana.walkTo(4, 5, { timeout: 3000, place: true });
      await ana.jump('up', { n: 2 });
      await api.jump('player', 'left', { n: 1 });
    } },
    // every visual effect, in order: bursts, appear and vanish, tint, trail, animate, zoom, wave
    { label: 'effects', run: async (api) => {
      await api.warp('town', 7, 6, 'up');
      for (const [name, at] of [['poof', [5, 5]], ['shadow', [9, 5]], ['sparkle', [5, 7]], ['magic', [9, 7]], ['dust', [5, 5]], ['embers', [9, 5]], ['shards', [5, 7]], ['splash', [9, 7]], ['hearts', 'ana'], ['leaves', [7, 3]], ['ring', 'player'], ['burst', 'bo'], ['glow', [7, 5]]]) {
        await api.fx(name, at);
      }
      await api.appear({ id: 'ghost', doll: 'walker', x: 9, y: 5, dir: 'down', transient: true }, { fx: 'shadow' });
      await api.tintActor('ghost', '#ff4040', 400);
      api.trail('ghost', { color: '#6a50d0' });
      await api.actor('ghost').walk('3l');
      api.trail('ghost', false);
      await api.animate('ghost', { lift: 8 }, 500, { ease: 'out' });
      await api.animate('ghost', { lift: 0 }, 400, { ease: 'bounce' });
      await api.zoom(2, { at: 'ghost' });
      await api.wait(300);
      await api.zoom(1);
      await api.wave(3);
      await api.wait(600);
      await api.wave(0);
      await api.vanish('ghost', { fx: 'poof' });
    } }] },
};

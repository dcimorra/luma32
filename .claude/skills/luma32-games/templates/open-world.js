// <Game name> — an open-world variant of templates/game.js: two maps joined edge to edge
// (no warp, the camera just walks on), a rule of play written on the hooks (water blocks
// the walker), a step hook that moves the story, and people who live there: two chat,
// one wanders, one walks a route, and passers-by (crowd) come and go out of sight. Use it as game.js together with
// art/palette.js and locales/es/common.json from this folder, then boot with ?game=<id>.
import { SCREEN_W } from '../../engine/gfx.js';
import { drawText, drawBig, measure, measureBig } from '../../engine/font.js';
import { t } from '../../engine/i18n.js';
import { C } from './art/palette.js';

// ---------- art ----------

const tiles = {
  // two ground variants chosen by position (see `ground` below), so it doesn't look tiled
  grass: { draw(p) { p.fill(C.grass); p.noise(0, 0, 16, 16, [C.grassHi, C.grassLo], 0.18); } },
  grass2: { draw(p) { p.fill(C.grass); p.noise(0, 0, 16, 16, [C.grassHi, C.grassLo], 0.18); p.px(4, 9, C.accent); p.px(11, 4, C.paper); } },
  sand: { draw(p) { p.fill(C.sand); p.noise(0, 0, 16, 16, [C.sandHi, C.sandLo], 0.15); } },
  water: { frames: 2, draw(p, f) { p.fill(C.water); p.dither(0, 12, 16, 4, C.water, C.waterLo); p.hline(2 + f * 6, 5, 5, C.waterHi); } },
  // a prop one cell wide and two tall, anchored at its bottom-left cell
  tree: {
    size: [1, 2],
    draw(p) {
      p.ellipse(8, 11, 8, 10, C.ink);
      p.ellipse(8, 11, 7, 9, C.leaf);
      p.ellipse(6, 8, 4, 4, C.leafHi);
      p.dither(2, 14, 12, 5, C.leaf, C.leafLo);
      p.rect(6, 20, 4, 11, C.ink); p.rect(7, 20, 2, 10, C.wood); p.vline(7, 20, 10, C.woodHi);
    },
  },
};

const dolls = {
  hero: { skin: '#e8b48c', hair: '#3a2a1a', hairStyle: 'short', top: '#3a6ab0', bottom: '#2a3040' },
  // background people: each one a different silhouette, not a recolour (art.md)
  farmer: { skin: '#c48c64', hair: '#5a3a1a', hairStyle: 'short', top: '#8a6a30', bottom: '#4a3a2a', hat: 'cap', hatColor: '#c8a860' },
  girl: { skin: '#f0c8a0', hair: '#d8a040', hairStyle: 'long', top: '#c05a6a', bottom: '#5a4a6a', dress: true },
  elder: { skin: '#d8a880', hair: '#d8d8d0', hairStyle: 'short', top: '#4a6a5a', bottom: '#3a3a3a', coat: '#5a4a3a' },
  walker: { skin: '#a87050', hair: '#1e1612', hairStyle: 'short', top: '#3a5a8a', bottom: '#5a4a3a' },
  shepherd: { skin: '#e0b090', hair: '#8a5a2a', hairStyle: 'buzz', top: '#e8e0d0', bottom: '#5a5040', hat: 'beanie', hatColor: '#6a4a3a', beard: true, beardColor: '#8a5a2a' },
};

// ---------- the world ----------

// rows of ground with a flower variant scattered by position, never at random per frame
const field = (w, h, ch, alt) => Array.from({ length: h }, (_, y) =>
  Array.from({ length: w }, (_, x) => (alt && (x * 7 + y * 13) % 11 === 0 ? alt : ch)).join(''));

const maps = {
  meadow: {
    name: 'place.meadow',
    legend: { '.': 'grass', ',': 'grass2', '~': 'water' },
    ground: [...field(20, 13, '.', ','), '~'.repeat(20)],
    props: [{ t: 'tree', x: 3, y: 3 }, { t: 'tree', x: 15, y: 9 }, { t: 'tree', x: 8, y: 11 }],
    // who lives here: declared on the map, so they are here on every visit and every reload
    actors: [
      // two neighbours chatting, facing each other: they answer, then turn back to their talk
      { id: 'farmer', doll: 'farmer', x: 6, y: 7, dir: 'right', turnBack: true, talk: async (api) => api.say('farmer', 'meadow.farmer') },
      { id: 'elder', doll: 'elder', x: 7, y: 7, dir: 'left', turnBack: true, talk: async (api) => api.say('elder', 'meadow.elder') },
      // someone pottering about, in a small radius away from the paths
      { id: 'girl', doll: 'girl', x: 12, y: 4, dir: 'down', move: 'wander', radius: 2, talk: async (api) => api.say('girl', 'meadow.girl') },
      // a shepherd walking his round, there and back, pausing at each end
      { id: 'shepherd', doll: 'shepherd', x: 2, y: 9, dir: 'right', route: { path: [[2, 9], [12, 9]], back: true, pause: [1500, 4000] },
        talk: async (api) => api.say('shepherd', 'meadow.shepherd') },
    ],
    // passers-by: now and then someone comes in off screen at the west edge, crosses and
    // leaves off screen at the south-west; they only appear and vanish out of sight
    crowd: [{ id: 'walker', doll: 'walker', path: [[0, 2], [10, 2], [10, 12], [0, 12]], every: 8000,
      talk: async (api) => api.say('walker', 'meadow.walker') }],
    // mirrored on the other map: meadow row y is shore row y - 2
    connections: [{ dir: 'east', map: 'shore', offset: 2 }],
  },
  shore: {
    name: 'place.shore',
    legend: { '.': 'sand', '~': 'water' },
    ground: [...field(16, 9, '.'), ...field(16, 3, '~')],
    props: [{ t: 'tree', x: 4, y: 3 }],
    connections: [{ dir: 'west', map: 'meadow', offset: -2 }],
  },
};

// ---------- title screen and shelf label ----------

const title = {
  intro: 60,
  pressY: 124,
  draw(ctx, f) {
    ctx.fillStyle = C.night;
    ctx.fillRect(0, 0, SCREEN_W, 160);
    const name = t('meta.title');
    drawBig(ctx, name, Math.round((SCREEN_W - measureBig(name, 3)) / 2), 50 + Math.round(Math.sin(f / 30) * 2), C.paper, 3);
  },
};

function cover(ctx, x, y, w, h) {
  ctx.fillStyle = C.water;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = C.sand;
  ctx.fillRect(x, y + h - 14, w, 14);
  const name = t('meta.title');
  drawText(ctx, name, x + Math.round((w - measure(name)) / 2), y + 20, C.paper);
}

export default {
  id: '<id>',
  meta: { title: 'meta.title', tagline: 'meta.tagline' },
  strings: ['locales/es/common.json'],
  theme: {
    shell: { body: '#2a7a6a', bodyHi: '#5aaa9a', bodyLo: '#144a40', accent1: '#ffcc40', accent2: '#ff6040' },
    ui: { border: '#1a2030', light: '#a8c0e0', fill: '#f8f8f0', text: '#303848', shadow: '#d0d0c8', accent: '#e05038' },
  },
  tiles,
  dolls,
  maps,
  songs: {},
  player: 'hero',
  title,
  cover,
  // conversations are directed: speakers turn to each other, the camera finds them
  direct: true,
  // a rule of play, in the cartridge: nobody walks on water
  canEnter(api, q) { if (q.tile === 'water') return false; },
  // a beat that happens where the player goes: first step on the sand. Hooks answer
  // nothing, or hand back a function that the world runs as a script (input waits).
  onStep(api, q) {
    if (q.map !== 'shore' || api.is('reached_shore')) return;
    return async (api) => {
      api.set('reached_shore');
      await api.emote('player', '!');
      api.objective('obj.none', false);
      api.persist();
    };
  },
  async onSelect(api) {
    await api.say(null, api.save.objective || 'obj.none', { style: 'box' });
  },
  async newGame(api) {
    // a whole map as the place: the guide leads there, arriving completes it
    api.objective('obj.shore', { map: 'shore' });
    await api.warp('meadow', 17, 5, 'right');
  },
};

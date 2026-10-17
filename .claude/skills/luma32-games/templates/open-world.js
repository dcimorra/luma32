// <Game name> — an open-world variant of templates/game.js: two maps joined edge to edge
// (no warp, the camera just walks on), water as the engine's medium (a wall until the story
// grants 'swim') with a bump hook that says so, a step hook that moves the story, and people who live there: two chat,
// one wanders, one walks a route, and passers-by (crowd) come and go out of sight. Use it as game.js together with
// art/palette.js and locales/es/common.json from this folder, then boot with ?game=<id>.
import { SCREEN_W } from '../../engine/gfx.js';
import { drawText, drawBig, measure, measureBig } from '../../engine/font.js';
import { t } from '../../engine/i18n.js';
import { C } from './art/palette.js';

// ---------- art ----------

const tiles = {
  // two ground variants chosen by position (see `ground` below), so it doesn't look tiled
  // ground is almost plain, low noise (art.md § 4): detail goes in the variant
  grass: { draw(p) { p.fill(C.grass); p.noise(0, 0, 16, 16, [C.grassHi, C.grassLo], 0.06); } },
  grass2: { draw(p) { p.fill(C.grass); p.noise(0, 0, 16, 16, [C.grassHi, C.grassLo], 0.06); p.px(4, 9, C.accent); p.px(11, 4, C.paper); p.px(12, 5, C.grassHi); } },
  sand: { draw(p) { p.fill(C.sand); p.noise(0, 0, 16, 16, [C.sandHi, C.sandLo], 0.06); } },
  // the engine's medium: a wall to whoever can't swim (README "Getting about"); the
  // highlights move, the tile doesn't, and nothing runs along its edges (art.md § 4.3)
  water: { medium: 'water', step: 'water', frames: 2, draw(p, f) {
    p.fill(C.water);
    p.hline(2 + f * 5, 4, 4, C.waterHi); p.hline(9 - f * 4, 10, 3, C.waterHi);
    p.px(13, 13 - f, C.waterLo); p.px(5, 7 + f, C.waterLo);
  } },
  // a prop one cell wide and two tall, anchored at its bottom-left cell
  tree: {
    size: [1, 2],
    draw(p) {
      // a drop shadow in the ground's own shadow tone, down and to the right (art.md § 5)
      p.ellipse(9, 30, 6, 2, C.grassLo);
      p.rect(6, 20, 4, 11, C.ink); p.rect(7, 20, 2, 10, C.wood); p.vline(7, 20, 10, C.woodHi);
      // the canopy in clusters, lit from the top-left, a dark core low on the right
      p.ellipse(8, 11, 8, 10, C.ink);
      p.ellipse(8, 11, 7, 9, C.leaf);
      p.ellipse(10, 14, 5, 5, C.leafLo);
      p.ellipse(5, 8, 3, 3, C.leafHi); p.ellipse(10, 6, 3, 2, C.leafHi); p.ellipse(4, 13, 2, 2, C.leafHi);
    },
  },
};

// everyone shares the world's ink as outline and gets relief; background people are told
// apart by silhouette (hat, hair, coat, a pack), not by colour alone (art.md § 6)
const ink = { outline: C.ink, relief: true };
const dolls = {
  hero: { ...ink, skin: '#e8b48c', hair: '#3a2a1a', hairStyle: 'short', top: '#3a6ab0', bottom: '#2a3040', boots: '#5e3c22' },
  farmer: { ...ink, skin: '#c48c64', hair: '#5a3a1a', hairStyle: 'short', top: '#8a6a30', bottom: '#4a3a2a', hat: 'cap', hatColor: '#c8a860', sleeves: 'rolled' },
  girl: { ...ink, skin: '#f0c8a0', hair: '#d8a040', hairStyle: 'long', top: '#c05a6a', bottom: '#5a4a6a', dress: true },
  elder: { ...ink, skin: '#d8a880', hair: '#d8d8d0', hairStyle: 'short', top: '#4a6a5a', bottom: '#3a3a3a', coat: '#5a4a3a', lines: true },
  walker: { ...ink, skin: '#a87050', hair: '#1e1612', hairStyle: 'ponytail', top: '#a0603a', bottom: '#5a4a3a' },
  shepherd: { ...ink, skin: '#e0b090', hair: '#8a5a2a', hairStyle: 'buzz', top: '#e8e0d0', bottom: '#5a5040', hat: 'beanie', hatColor: '#6a4a3a' },
};

// ---------- the world ----------

// rows of ground with a flower variant scattered by position, never at random per frame
const field = (w, h, ch, alt) => Array.from({ length: h }, (_, y) =>
  Array.from({ length: w }, (_, x) => (alt && (x * 7 + y * 13) % 11 === 0 ? alt : ch)).join(''));

const maps = {
  meadow: {
    name: 'place.meadow',
    music: 'meadow',
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

// ---------- music ----------

// The meadow: A Dorian, 4/4 at 126, open and walking. Its idea: a pickup into a held high
// note, answered by the bass a beat late, and a shaker that only becomes drums on the last
// bar of each phrase (music.md: drums written for this song, with a fill).
const songs = {
  meadow: {
    bpm: 126,
    steps: 4,
    channels: {
      lead: { inst: 'pulse25', echo: 0.3, vibrato: 0.2 },
      bass: { inst: 'bass' },
      drums: { inst: 'drums', vol: 0.5 },
    },
    patterns: {
      A: {
        lead: '. . E4 A4 C5 - - - - - B4 A4 G4 - A4 - B4 - - - D5 - C5 B4 A4 - - - . . E4 A4 C5 - - - - - B4 A4 G4 - E5 - D5 - - - C5 - B4 - A4 - - - - - - - . . . .',
        bass: 'A2 - - - . A2 . . G2 - - - . G2 . . F#2 - - - . F#2 . . E2 - - - G2 - B2 - A2 - - - . A2 . . G2 - - - . G2 . . D3 - - - . C3 . . E2 - - - E2 - G#2 -',
        drums: 'h . h? . h . h? . h . h? . h . h? . h . h? . h . h? . h . h? . h . h? . h . h? . h . h? . h . h? . h . h? . k . h s k k h . s . k s s! s s s',
      },
    },
    song: ['A'],
  },
};

// ---------- title screen and shelf label ----------

const title = {
  music: 'meadow',
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
  songs,
  player: 'hero',
  title,
  cover,
  // conversations are directed: speakers turn to each other, the camera finds them
  direct: true,
  // the water is a door, not a wall: the first bump says so (world.md, "Getting about")
  onBump(api, q) {
    if (q.tile !== 'water' || api.can('swim') || api.is('water_said')) return;
    return async (api) => {
      api.set('water_said');
      await api.narrate('meadow.water_cold');
    };
  },
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
  // one entry per point of the story, leaving the game where a player would be
  dev: { jumps: [
    { label: 'the meadow', run: async (api) => { api.objective('obj.shore', { map: 'shore' }); await api.warp('meadow', 17, 5, 'right'); } },
    { label: 'the shore', run: async (api) => { api.set('reached_shore'); api.objective('obj.none', false); await api.warp('shore', 2, 4, 'right'); } },
  ] },
  async newGame(api) {
    // a whole map as the place: the guide leads there, arriving completes it
    api.objective('obj.shore', { map: 'shore' });
    await api.warp('meadow', 17, 5, 'right');
  },
};

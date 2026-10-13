// <Game name> — the cartridge manifest. Copy this folder (game.js, art/palette.js,
// locales/es/common.json) to public/games/<id>/, rename the ids, and boot it with ?game=<id>.
//
// A tiny story with one thread: arrive in the village, talk to Ana, fetch the key from
// the well, open the gate. Progress is a single counter flag (`story`), so the whole
// state is in the save and every map can rebuild itself from it. Its stages go in tens
// so a beat added later fits between two others without breaking existing saves.
import { SCREEN_W } from '../../engine/gfx.js';
import { drawText, drawBig, measure, measureBig } from '../../engine/font.js';
import { t } from '../../engine/i18n.js';
import { C } from './art/palette.js';

// ---------- art (painted in code) ----------

const tiles = {
  grass: { draw(p) { p.fill(C.grass); p.noise(0, 0, 16, 16, [C.grassHi, C.grassLo], 0.18); } },
  fence: { solid: true, draw(p) { p.fill(C.grass); p.rect(0, 6, 16, 3, C.ink); p.rect(0, 6, 16, 2, C.woodHi); p.rect(2, 3, 3, 12, C.wood); p.rect(11, 3, 3, 12, C.wood); } },
  gate: { solid: true, examine: 'village.gate_locked', draw(p) { p.fill(C.grass); p.rect(1, 2, 14, 13, C.ink); p.rect(2, 3, 12, 11, C.wood); p.hline(2, 3, 12, C.woodHi); } },
  gate_open: { draw(p) { p.fill(C.grass); p.rect(1, 13, 14, 2, C.wood); } },
  // a prop: two cells wide, anchored at its bottom-left cell; `foot` = the cells that block
  well: {
    size: [2, 2], foot: [2, 1],
    draw(p) {
      p.ellipse(16, 22, 13, 8, C.ink);
      p.ellipse(16, 21, 12, 7, C.stone);
      p.ellipse(16, 19, 9, 4, C.waterLo);
      p.hline(6, 17, 20, C.stoneHi);
      p.rect(5, 2, 2, 16, C.wood); p.rect(25, 2, 2, 16, C.wood); p.rect(4, 1, 24, 3, C.woodHi);
    },
  },
};

const dolls = {
  hero: { skin: '#e8b48c', hair: '#3a2a1a', hairStyle: 'short', top: '#3a6ab0', bottom: '#2a3040' },
  ana: { skin: '#c48c64', hair: '#1e1612', hairStyle: 'long', top: '#b04a3a', bottom: '#4a3a2a', dress: true },
};

// ---------- the one map ----------

const STAGE = { arrived: 10, asked: 20, key: 30, open: 40 };
const at = (api) => api.get('story') || 0;
const advance = (api, n) => { if (at(api) < n) api.set('story', n); };

const maps = {
  village: {
    name: 'place.village',
    music: 'theme',
    legend: { '.': 'grass', '#': 'fence', G: 'gate' },
    ground: [
      '#######G#######',
      ...Array.from({ length: 9 }, () => '#.............#'),
      '###############',
    ],
    props: [{ t: 'well', x: 10, y: 7, id: 'well' }],
    actors: [
      // Ana says something different at each point of the story
      // she looks up when the player comes near (life.md, "People with each other")
      { id: 'ana', doll: 'ana', x: 4, y: 4, dir: 'down', look: 2, talk: async (api) => {
        if (at(api) < STAGE.asked) {
          // the last line says what and where; the objective repeats it and points there
          await api.say('ana', 'village.ana_ask');
          advance(api, STAGE.asked);
          api.objective('obj.well', { x: 10, y: 7, w: 2 });
          api.persist();
        } else if (at(api) < STAGE.key) await api.say('ana', 'village.ana_wait');
        else await api.say('ana', 'village.ana_thanks');
      } },
    ],
    // pressing A at the well
    spots: [{ x: 10, y: 7, w: 2, h: 1, when: (api) => at(api) === STAGE.asked, run: async (api) => {
      await api.narrate('village.found_key');
      advance(api, STAGE.key);
      api.objective('obj.gate', [7, 0]);
      api.persist();
    } }],
    // bumping into the gate with the key opens it
    warps: [{ x: 7, y: 0, dir: 'up', when: (api) => at(api) === STAGE.key, run: async (api) => {
      api.setTile(7, 0, 'gate_open');
      api.sfx('door');
      advance(api, STAGE.open);
      await api.narrate('village.the_end');
      api.end();
    } }],
    // every arrival (and every continue): rebuild from the flag, play the intro once
    async enter(api) {
      if (at(api) >= STAGE.open) api.setTile(7, 0, 'gate_open');
      if (at(api) >= STAGE.arrived) return;
      advance(api, STAGE.arrived);
      await api.narrate('village.intro');
      api.objective('obj.ana', 'ana');
      api.persist();
    },
  },
};

// ---------- music ----------

const songs = {
  theme: {
    bpm: 112,
    channels: { lead: { inst: 'pulse25', echo: 0.25 }, bass: { inst: 'bass' }, drums: { inst: 'drums', vol: 0.6 } },
    patterns: {
      A: {
        lead: 'C5 - E5 - G5 - - - E5 - D5 - C5 - - -',
        bass: 'C3 . C3 . G2 . G2 . A2 . A2 . F2 . G2 .',
        drums: 'k . h . s . h . k k h . s . h h',
      },
    },
    song: ['A'],
  },
};

// ---------- title screen (the console adds "PULSA START" and the menu) ----------

const title = {
  music: 'theme',
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
  ctx.fillStyle = C.night;
  ctx.fillRect(x, y, w, h);
  const name = t('meta.title');
  drawText(ctx, name, x + Math.round((w - measure(name)) / 2), y + 24, C.paper);
}

export default {
  id: '<id>',
  meta: { title: 'meta.title', tagline: 'meta.tagline' },
  strings: ['locales/es/common.json'],
  theme: {
    shell: { body: '#2a5a9a', bodyHi: '#5a8ad0', bodyLo: '#14305a', accent1: '#ffcc40', accent2: '#ff6040' },
    ui: { border: '#1a2030', light: '#a8c0e0', fill: '#f8f8f0', text: '#303848', shadow: '#d0d0c8', accent: '#e05038', speakers: { ana: { color: '#b04a3a', voice: 700 } } },
  },
  tiles,
  dolls,
  maps,
  songs,
  player: 'hero',
  title,
  cover,
  // SELECT: what the story wants from the player right now
  async onSelect(api) {
    await api.say(null, api.save.objective || 'obj.none', { style: 'box' });
  },
  // one entry per chapter start and ★ set piece, leaving the game where a player would be
  // there (flags, objective and its place, map, cell): tools/audit.mjs checks each one
  dev: { jumps: [
    { label: 'the well', run: async (api) => { api.set('story', STAGE.asked); await api.warp('village', 9, 8, 'up'); api.objective('obj.well', { x: 10, y: 7, w: 2 }); } },
    { label: 'the gate', run: async (api) => { api.set('story', STAGE.key); await api.warp('village', 7, 2, 'up'); api.objective('obj.gate', [7, 0]); } },
  ] },
  async newGame(api) {
    await api.warp('village', 7, 8, 'up');
  },
};

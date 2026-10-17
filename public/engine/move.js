// Getting about: walking, swimming, diving, flying and climbing, and ground that moves
// whoever stands on it (ice, currents). All of it is data (README "Getting about"):
//
//   tiles:  medium: 'water' | 'deep' | 'air' | 'climb' | 'ice', push: 'down', low: true
//   props:  low: true                       (a fence, a bush: a flyer goes over it)
//   actors: can: ['swim', 'fly'], mode: 'fly'   (a gull always in the air, a fish always swimming)
//   maps:   below: 'reef_floor', above: 'reef', breath: 12   (diving: the same cells, one level down)
//   game:   modes: { swim: { speed: 0.75 }, fly: { height: 12 } }
//   api:    grant('swim'), revoke('swim'), can('swim'), setMode('player', 'fly'), mode('ana')
//
// A medium is solid to whoever can't use it; whoever can goes in, and their mode follows
// the ground under them: nobody presses a button to swim, they walk into the water. The
// player's abilities are flags (`can.<ability>`), so a reload restores them; companions
// share them. A held mode (setMode) is not saved: restore it in `enter` from the flags.
import { TILE } from './gfx.js';
import { sfx } from './audio.js';
import { bar } from './ui.js';
import { drawText } from './font.js';
import { t } from './i18n.js';

export const ABILITIES = ['swim', 'dive', 'fly', 'climb'];
// what each medium asks of whoever enters it, and how it moves them
export const MEDIA = {
  water: { needs: 'swim', water: true },
  deep: { needs: 'swim', water: true, deep: true },
  air: { needs: 'fly' },
  climb: { needs: 'climb' },
  ice: { slide: true },
};
// speed is a multiple of the walk; run: B doubles it there; height: pixels off the ground
const MODES = {
  walk: { speed: 1, run: true },
  swim: { speed: 1, run: true },
  dive: { speed: 0.75, run: false },
  fly: { speed: 1.5, run: true, height: 10 },
  climb: { speed: 0.5, run: false },
};
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

// a cartridge's own media (game.media: { lava: { needs: 'fireproof' } }) beside the engine's;
// any ability name works (api.grant('fireproof')), and game.modes tunes its speed
let own = {};
export function useMedia(defs) { own = defs || {}; }
export const mediumOf = (d) => (d?.medium ? own[d.medium] || MEDIA[d.medium] || null : null);

export function modeConf(world, mode) {
  return { ...MODES[mode] || MODES.walk, ...world.game.modes?.[mode] };
}

// Can `a` do this? Its own `can`, its fixed or held mode, and for the player and the
// companions the story's flags (api.grant). The player's held mode carries the party.
export function can(world, a, k) {
  // entities (action games) have no abilities: only actors do
  if (!a?.def) return false;
  if (a.held === k || a.def.mode === k) return true;
  if (a.def.can?.includes(k)) return true;
  if (a !== world.player && !a.party) return false;
  if (a.party && world.player?.held === k) return true;
  return !!world.save.flags[`can.${k}`];
}

// Does the ground of this cell stop `who`? (Asked after the cartridge's canEnter hooks.)
export function groundStops(world, d, who) {
  if (world.map.above) return !!(d.solid || d.ledge);   // under water: the seabed is ground
  const m = mediumOf(d);
  // someone who only swims (a fish) keeps to the water
  if (who?.def?.mode === 'swim' && !m?.water) return true;
  if (m?.needs) {
    if (can(world, who, m.needs)) return false;
    // whoever flies crosses water and cliffs from above
    return !(m.needs !== 'fly' && can(world, who, 'fly'));
  }
  if (d.solid || d.ledge) return !((d.low || d.ledge) && can(world, who, 'fly'));
  return false;
}

// A prop with `low` (a fence, a hedge, a rock) is flown over.
export const propStops = (world, prop, who) => !!prop && !(prop.def.low && can(world, who, 'fly'));

// The mode `a` is in, from the ground under its middle (so it changes halfway across).
export function modeOf(world, a) {
  if (a.held) return a.held;
  if (a.def.mode) return a.def.mode;
  if (world.map?.above) return 'dive';
  const x = Math.round(a.px / TILE);
  const y = Math.round(a.py / TILE);
  const id = world.tileAt(x, y);
  const d = id && world.game.tiles[id];
  if (!d) return 'walk';
  const m = mediumOf(d);
  if (m?.water) return can(world, a, 'swim') ? 'swim' : 'fly';
  if (m?.needs) return m.needs;
  const prop = world.propAt(x, y);
  if (d.solid || d.ledge || (prop && prop.def.low)) return can(world, a, 'fly') ? 'fly' : 'walk';
  return 'walk';
}

// Every frame: each one's mode, the way into it and out of it (a splash, wings, a landing),
// how high a flyer is, bubbles under water and the breath held.
export function tickModes(world, e) {
  const f = e.frame;
  for (const a of world.actors) {
    if (!a.visible) continue;
    const m = modeOf(world, a);
    const was = a.mode || m;
    a.mode = m;
    if (m !== was && a.seenMode) changeMode(world, a, was, m);
    a.seenMode = true;
    const h = m === 'fly' ? modeConf(world, 'fly').height : 0;
    a.alt = (a.alt || 0) + Math.sign(h - (a.alt || 0)) * Math.min(1, Math.abs(h - (a.alt || 0)));
    if (m === 'dive' && (f + a.blinkAt) % 70 === 0 && world.inView(a.x, a.y)) world.vfx.burst('bubbles', a, { dy: -6, amount: 0.6 });
  }
  tickBreath(world, e);
}

function changeMode(world, a, from, to) {
  const near = world.inView(a.x, a.y);
  const loud = a === world.player || (near && !a.party);
  if (to === 'swim' && from !== 'dive') {
    if (near) world.vfx.burst('splash', a, { amount: 0.7 });
    if (loud) sfx('splash');
  } else if (from === 'swim' && to === 'walk') {
    if (near) world.vfx.burst('splash', a, { amount: 0.4, scale: 0.7 });
    if (loud) sfx('step_water');
  } else if (to === 'fly') {
    if (near && from === 'walk') world.vfx.burst('dust', a, { amount: 0.6, scale: 0.8 });
    if (loud) sfx('flap');
  } else if (from === 'fly') {
    if (near && to === 'walk') world.vfx.burst('dust', a, { amount: 0.5, scale: 0.7 });
    if (loud) sfx(to === 'swim' ? 'splash' : 'land');
  } else if (to === 'climb' && loud) sfx('grip');
}

// The speed of the player's next step: the cartridge's baseSpeed times the mode's, doubled
// by B where that mode lets you run.
export function stepSpeed(world, p, running) {
  const c = modeConf(world, modeOf(world, p));
  const base = (p.baseSpeed ?? 1) * c.speed;
  return running && c.run !== false ? base * 2 : base;
}

// The sound of a step in each mode; null leaves it to the ground.
export function stepSound(world, p) {
  const m = modeOf(world, p);
  if (m === 'swim' || m === 'dive') return 'stroke';
  if (m === 'fly') return p.stepCount % 2 ? 'flap' : '';
  if (m === 'climb') return 'grip';
  return null;
}

// ---------- ground that moves you ----------

// After the player lands on a cell: ice keeps them going the way they went, a current or a
// moving walkway (`push: dir`) carries them. Flyers are above all of it.
export function afterStep(world) {
  const p = world.player;
  p.sliding = false;
  const d = world.game.tiles[world.tileAt(p.x, p.y)];
  if (!d || modeOf(world, p) === 'fly') return;
  if (d.push) world.slide = { dir: d.push, push: true };
  else if (mediumOf(d)?.slide) world.slide = { dir: p.dir, push: false };
}

// One cell more of sliding or being carried; false when it stops.
export function slideOn(world) {
  const s = world.slide;
  world.slide = null;
  const p = world.player;
  const [dx, dy] = DIRS[s.dir];
  const nx = p.x + dx;
  const ny = p.y + dy;
  const warp = world.warpAt(nx, ny, s.dir, true);
  if (warp) { world.run((api) => api.take(warp)); return true; }
  if (world.blocked(nx, ny, p, s.dir)) return false;
  const face = p.dir;
  p.speed = s.push ? (world.game.tiles[world.tileAt(p.x, p.y)]?.pushSpeed ?? 1) : 2;
  p.sliding = true;
  if (!s.push) sfx('slide');
  p.step(s.dir, { onArrive: () => world.arrived() });
  if (s.push) p.dir = face;
  return true;
}

// ---------- diving ----------

const parsed = new WeakMap();
function levelOf(world, mapId) {
  const def = world.game.maps[mapId];
  if (!def) return null;
  if (!parsed.has(def)) parsed.set(def, world.parse(mapId));
  return parsed.get(def);
}

const deepAt = (world, level, x, y) => {
  const id = level?.ground[y]?.[x];
  return !!(id && mediumOf(world.game.tiles[id])?.deep);
};

// Where A would take the player, standing where they stand: down to the map `below`
// from deep water, or up to the map `above` from under deep water. null: nowhere.
export function diveHere(world) {
  const p = world.player;
  const m = world.map;
  if (!p || p.moving) return null;
  if (m.below && can(world, p, 'dive') && modeOf(world, p) === 'swim' && mediumOf(world.game.tiles[world.tileAt(p.x, p.y)])?.deep) {
    const lv = levelOf(world, m.below);
    const id = lv?.ground[p.y]?.[p.x];
    if (!id || world.game.tiles[id].solid || lv.solid.has(`${p.x},${p.y}`)) return null;
    return { to: m.below, x: p.x, y: p.y, down: true };
  }
  if (m.above && deepAt(world, levelOf(world, m.above), p.x, p.y)) return { to: m.above, x: p.x, y: p.y, down: false };
  return null;
}

// The script that takes the player down or up, or null.
export function diveScript(world) {
  const d = diveHere(world);
  return d ? (api) => plunge(api, d) : null;
}

async function plunge(api, d) {
  const w = api.world;
  const p = w.player;
  sfx(d.down ? 'dive' : 'surface');
  w.vfx.burst(d.down ? 'bubbles' : 'splash', p, { amount: 1.5 });
  const name = w.map.name;
  await api.fadeOut(d.down ? 420 : 320, d.down ? '#0a2240' : '#d8f0ff');
  w.load(d.to, d.x, d.y, p.dir);
  if (w.map.name && w.map.name !== name) api.banner(w.map.name);
  if (!d.down) w.vfx.burst('splash', p, { amount: 1.2 });
  await api.fadeIn(d.down ? 420 : 320);
  if (w.map.enter) await w.map.enter(api);
}

// `breath: seconds` on a map under water: a bar of bubbles runs down while the player has
// control, and when it is out they come up for air at the nearest deep water above.
function tickBreath(world, e) {
  const m = world.map;
  if (!m.above || !m.breath) { world.air = null; return; }
  if (!world.air || world.air.map !== world.mapId) world.air = { map: world.mapId, left: m.breath * 60, max: m.breath * 60 };
  if (world.busy || !world.onTop) return;
  if (--world.air.left > 0) return;
  const p = world.player;
  const up = nearestDeep(world, m.above, p.x, p.y);
  if (!up) {
    world.lint(`breath:${world.mapId}`, `breath ran out and ${m.above} has no deep water to come up to: give the map above deep cells (medium: 'deep').`);
    world.air.left = world.air.max;
    return;
  }
  sfx('gasp');
  world.run((api) => plunge(api, { to: m.above, x: up.x, y: up.y, down: false }));
}

function nearestDeep(world, mapId, x0, y0) {
  const lv = levelOf(world, mapId);
  if (!lv) return null;
  let best = null;
  for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
    if (!deepAt(world, lv, x, y) || lv.solid.has(`${x},${y}`)) continue;
    const dist = Math.abs(x - x0) + Math.abs(y - y0);
    if (!best || dist < best.d) best = { x, y, d: dist };
  }
  return best;
}

// The nearest cell where the player can go down (deep water here) or come up (under deep
// water above): where the guide points when the objective is on the other level.
export function diveCell(world, up) {
  const p = world.player;
  if (up) return world.map.above ? nearestDeep(world, world.map.above, p.x, p.y) : null;
  let best = null;
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
    if (!mediumOf(world.game.tiles[world.tileAt(x, y)])?.deep) continue;
    const d = Math.abs(x - p.x) + Math.abs(y - p.y);
    if (!best || d < best.d) best = { x, y, d };
  }
  return best;
}

export function drawBreath(world, ctx) {
  const air = world.air;
  if (!air || air.left >= air.max) return;
  const low = air.left < air.max * 0.25;
  if (low && Math.floor(world.engine.frame / 8) % 2) return;
  const label = t('console.air');
  drawText(ctx, label, 4, 3, '#e8f8ff');
  bar(ctx, 30, 4, 60, 6, air.left, air.max, { fill: low ? '#e05038' : '#80c8f0', steps: Math.min(10, world.map.breath) });
}

// ---------- how each mode looks ----------

// The frame for an actor in a mode other than walking, or null for the usual one.
export function modeImage(world, a) {
  const d = a.doll;
  if (!d) return null;
  const going = a.moving || a.strolling;
  const stroke = Math.floor(a.anim / 8) % 2;
  if (a.sliding) return d.frames[a.dir][0];
  switch (a.mode) {
    case 'swim': {
      // a crawl: the arms come up out of the water in turn
      const up = a.dir === 'left' || a.dir === 'right' ? d.poses.reach?.[a.dir] : d.poses.cheer?.[a.dir];
      return going && stroke && up ? up : d.frames[a.dir][0];
    }
    case 'dive': {
      // a slow breaststroke: arms out, then in
      const slow = Math.floor((a.anim + world.engine.frame / 3) / 12) % 2;
      return slow ? d.poses.fly?.[a.dir] || d.frames[a.dir][0] : d.frames[a.dir][0];
    }
    case 'fly': {
      // birds and bees beat their wings (engine/creature.js)
      const flap = d.flap?.[a.dir];
      if (flap) return flap[Math.floor((world.engine.frame + a.blinkAt) / (d.idle ? 3 : 8)) % flap.length];
      return d.poses.fly?.[a.dir] || d.run?.[a.dir]?.[1] || d.frames[a.dir][1];
    }
    case 'climb': {
      // seen from behind, whichever way they go: hand over hand
      if (!going) return d.frames.up[0];
      return stroke ? d.poses.cheer?.up || d.frames.up[1] : d.frames.up[a.stepCount % 2 ? 1 : 2];
    }
    default: return null;
  }
}

// How high an actor is drawn above its cell: a jump, a flight (with a slow bob).
export function liftOf(world, a) {
  const alt = Math.round(a.alt || 0);
  const bob = alt > 2 ? Math.round(Math.sin((world.engine.frame + a.blinkAt) / 9) * 1.5) : 0;
  return (a.lift || 0) + alt + bob;
}

// Draws an actor in a mode that needs more than its frame: up to the shoulders in water
// with a ring of ripples, blue and swaying under it, flat on a wall. False: not handled.
export function drawInMode(world, ctx, it, a, alpha) {
  const f = world.engine.frame;
  if (a.mode === 'swim') {
    const sink = 6;
    const bob = a.moving || a.strolling ? 0 : Math.floor((f + a.blinkAt) / 24) % 2;
    const water = it.y + it.img.height - 4 + bob;
    ctx.save();
    ctx.beginPath();
    ctx.rect(it.x - 4, water - 40, it.img.width + 8, 40);
    ctx.clip();
    if (alpha < 1 || a.tint) world.vfx.body(ctx, it.img, it.x, it.y + sink + bob, alpha, a.tint);
    else ctx.drawImage(it.img, it.x, it.y + sink + bob);
    ctx.restore();
    // the ring of water round the body, breathing; a wake when moving
    const tile = world.game.tiles[world.tileAt(a.x, a.y)];
    ctx.globalAlpha = 0.75 * alpha;
    ctx.fillStyle = tile?.foam || '#e8f6ff';
    const k = Math.floor((f + a.blinkAt) / 12) % 3;
    const x = it.x + 2 - k;
    const w = it.img.width - 4 + k * 2;
    ctx.fillRect(x, water, 3, 1);
    ctx.fillRect(x + w - 3, water, 3, 1);
    ctx.fillRect(x + 4, water + 1, w - 8, 1);
    if (a.moving || a.strolling) {
      const [dx, dy] = DIRS[a.dir];
      const bx = it.x + it.img.width / 2 - dx * 9;
      const by = water - dy * 4;
      ctx.globalAlpha = 0.5 * alpha;
      ctx.fillRect(Math.round(bx - 3 - (dy ? 2 : 0)), by + 1, 2, 1);
      ctx.fillRect(Math.round(bx + 1 + (dy ? 2 : 0)), by + 1, 2, 1);
    }
    ctx.globalAlpha = 1;
    return true;
  }
  if (a.mode === 'dive') {
    const sway = Math.round(Math.sin((f + a.blinkAt) / 20) * 1.5);
    world.vfx.body(ctx, it.img, it.x, it.y - 3 + sway, alpha * 0.92, a.tint || { color: '#2a5a9a', k: 0.28 });
    // a faint shadow on the seabed, below and apart
    ctx.fillStyle = `rgba(0,0,0,${0.15 * alpha})`;
    ctx.fillRect(it.x + 5, it.y + it.img.height, 6, 1);
    return true;
  }
  if (a.mode === 'climb') {
    if (alpha < 1 || a.tint) world.vfx.body(ctx, it.img, it.x, it.y, alpha, a.tint);
    else ctx.drawImage(it.img, it.x, it.y);
    return true;
  }
  return false;
}

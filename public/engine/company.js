// People with each other and with the place: companions who walk behind the player,
// short lines said over a head without stopping the game (barks), two neighbours who
// chat between themselves, people who look up when the player comes near or greet them,
// someone bumped into who turns round, someone in the player's way who steps aside, and
// route stops where someone does something
// (sits on the bench, reaches into the stall). All of it is data on the map or the game
// (README "Life on a map"); the engine plays it while nobody runs a script.
import { SCREEN_W } from './gfx.js';
import { drawText, measure, wrap } from './font.js';
import { frame, getTheme } from './ui.js';
import { has, tv } from './i18n.js';

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
// every bubble world.js draws (its EMOTES, plus '!', '?', 'dots' and 'zzz'): a chat line that
// names one shows the bubble instead of reading it as a text key
const EMOTE_NAMES = new Set(['!', '?', 'dots', 'zzz', 'heart', 'anger', 'sweat', 'note', 'idea', 'sad', 'shock',
  'blush', 'laugh', 'fear', 'doubt', 'love', 'cry', 'sparkle', 'sigh', 'disgust', 'scribble']);
const ms = (n) => n / 16.67;
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// ---------- companions ----------

// game.party (a list, or a function of the api) — people who go where the player goes:
//   party: (api) => [{ id: 'nieves', doll: 'nieves', talk, when }]
// On every arrival they stand behind the player and then follow their steps. A map that
// declares one of them among its own actors gives them a role there, and they stay put;
// `party: false` on a map leaves them all out. They are walked through, not bumped, and
// answer A like anyone.
export function placeParty(world, make) {
  let list = world.game.party;
  if (typeof list === 'function') list = list(world.api);
  if (world.map.party === false) list = null;
  const p = world.player;
  const trail = [];
  let i = 0;
  for (const d of list || []) {
    if (d.when && !d.when(world.api)) continue;
    if (world.actors.some((a) => a.id === d.id)) continue;
    i++;
    const at = behind(world, p, i);
    const a = make({ ...d, x: at.x, y: at.y, dir: p.dir, solid: false, remember: false });
    a.declared = true;
    a.party = i;
    world.actors.splice(world.actors.indexOf(p), 0, a);
    trail.unshift({ x: at.x, y: at.y });
  }
  trail.push({ x: p.x, y: p.y });
  world.trail = trail;
}

// The n-th cell behind the player: the way they came, or any free cell beside them.
function behind(world, p, n) {
  const [dx, dy] = DIRS[OPPOSITE[p.dir]] || [0, 1];
  const bx = p.x + dx * n;
  const by = p.y + dy * n;
  const clear = (x, y) => !world.blocked(x, y, p) && !world.warpAt(x, y, null, false);
  if (n === 1 && clear(bx, by)) return { x: bx, y: by };
  if (n > 1 && clear(bx, by) && clear(p.x + dx, p.y + dy)) return { x: bx, y: by };
  for (const [ax, ay] of Object.values(DIRS)) {
    const x = p.x + ax;
    const y = p.y + ay;
    if (clear(x, y) && !world.actors.some((a) => a.party && a.x === x && a.y === y)) return { x, y };
  }
  return { x: p.x, y: p.y };
}

// Each companion walks to where the player stood `party` steps ago.
export function tickParty(world) {
  const p = world.player;
  const t = world.trail || (world.trail = []);
  const last = t[t.length - 1];
  if (!last || last.x !== p.x || last.y !== p.y) {
    t.push({ x: p.x, y: p.y });
    if (t.length > 16) t.shift();
  }
  if (world.busy) return;
  for (const a of world.actors) {
    // in the player's vehicle, or left waiting for them to get out (engine/vehicle.js)
    if (!a.party || a.moving || a.catching || a.riding || a.waiting) continue;
    const goal = t[t.length - 1 - a.party];
    if (!goal || (a.x === goal.x && a.y === goal.y)) continue;
    // the player turned back onto the trail: never into their cell, nor another companion's
    const taken = (c) => (c.x === p.x && c.y === p.y) || world.actors.some((b) => b !== a && b.party && !b.riding && ((b.x === c.x && b.y === c.y) || (b.moving && b.moving.tx === c.x && b.moving.ty === c.y)));
    if (taken(goal)) {
      if (a.x === p.x && a.y === p.y && !p.moving) {
        const to = world.freeNear(a.x, a.y, a);
        if (to) { a.catching = true; a.walkTo(to.x, to.y, { timeout: 800, place: true }).then(() => { a.catching = false; }); }
      }
      continue;
    }
    a.speed = p.speed || 1;
    const d = dist(a, goal);
    if (d === 1) {
      const dir = goal.x > a.x ? 'right' : goal.x < a.x ? 'left' : goal.y > a.y ? 'down' : 'up';
      a.step(dir, { force: true });
    } else {
      // left behind by a cutscene or a hop: they catch up walking
      a.catching = true;
      a.walkTo(goal.x, goal.y, { timeout: 1500, place: true }).then(() => { a.catching = false; });
    }
  }
}

// ---------- barks: a line over a head that doesn't stop anything ----------

export function bark(world, a, text, time = 2600) {
  if (!a || !text) return;
  a.bark = { text, until: world.engine.frame + ms(time) };
}

// `camFor(a)` (the modern look): the camera offset that puts this person where the
// diorama shows them; without it, everyone shares cx, cy.
export function drawBarks(world, ctx, cx, cy, camFor = null) {
  const th = getTheme();
  const f = world.engine.frame;
  const placed = [];
  for (const a of world.actors) {
    if (!a.bark || !a.visible) continue;
    if (f > a.bark.until) { a.bark = null; continue; }
    if (camFor) [cx, cy] = camFor(a);
    const lines = wrap(a.bark.text, 100).slice(0, 3);
    const w = Math.max(...lines.map(measure)) + 8;
    const h = lines.length * 10 + 5;
    const ax = Math.round(a.px) - cx + 8 + a.ox;
    const x = Math.max(2, Math.min(SCREEN_W - w - 2, ax - Math.round(w / 2)));
    let y = Math.round(a.py) - a.ez - cy - 14 - h - (a.emote ? 14 : 0) + a.oy;
    // two people talking at once: the later balloon goes above the other
    for (let moved = true; moved;) {
      moved = false;
      for (const r of placed) {
        if (x < r.x + r.w && r.x < x + w && y < r.y + r.h + 2 && r.y < y + h + 2) { y = r.y - h - 3; moved = true; }
      }
    }
    y = Math.max(2, y);
    placed.push({ x, y, w, h });
    frame(ctx, x, y, w, h, { border: th.border, light: th.fill, fill: th.fill });
    // the tail, towards the head
    ctx.fillStyle = th.fill;
    const tx = Math.max(x + 3, Math.min(x + w - 5, ax - 1));
    ctx.fillRect(tx, y + h - 1, 3, 2);
    ctx.fillStyle = th.border;
    ctx.fillRect(tx + 1, y + h + 1, 1, 1);
    lines.forEach((l, i) => drawText(ctx, l, x + 4, y + 4 + i * 10, th.text));
  }
}

// ---------- the little life between people ----------

// Says a line (a locale key) or shows an emotion over someone, without sound. Marked as
// the map's own life, so a scene that starts takes it away (hushLife).
function express(world, a, line) {
  if (EMOTE_NAMES.has(line)) { a.emote = { glyph: line, until: world.engine.frame + ms(1100), from: world.engine.frame, life: true }; return; }
  bark(world, a, world.api.text(line));
  if (a.bark) a.bark.life = true;
}

// A script starts: background chatter, greetings and bumps said over heads stop at once
// (they would talk over the story, or stay cut by the cinema bars), and the next exchange
// waits a while after control returns. Barks and emotes from scripts stay.
export function hushLife(world) {
  const f = world.engine.frame;
  for (const a of world.actors) {
    if (a.bark?.life) a.bark = null;
    if (a.emote?.life) a.emote = null;
    if (a.def?.chat && a.chatNext !== undefined) { a.chatNext = Math.max(a.chatNext, f + ms(3000)); a.chatI -= a.chatI % (a.def.chat.lines?.length || 1); }
  }
}

// Per frame, while nobody runs a script:
//   chat: { with: 'id', lines: ['key', 'key', 'note', ...], every: ms, near: cells }
//     two people near each other exchange lines in turn (an emotion name instead of a key
//     shows the bubble): the first line is this one's, the next the other's, and so on.
//   look: cells — they turn to the player who comes this close, and back when they go.
//   greet: 'key' — said once a visit, when the player first comes near.
export function tickLife(world) {
  const f = world.engine.frame;
  const p = world.player;
  for (const a of world.actors) {
    if (a === p || !a.visible || a.party) continue;
    const d = a.def;
    if (d.chat) tickChat(world, a, f);
    if ((d.look || d.greet) && f % 6 === 0 && !a.moving && !a.leaving) {
      const r = d.look ?? 2;
      const close = dist(a, p) <= r && world.inView(a.x, a.y);
      if (close && !a.lookFrom) {
        if (d.look && d.turn !== false && (!a.act || a.act === 'sit')) { a.lookFrom = a.dir; a.faceActor(p); }
        else a.lookFrom = a.dir;
        if (d.greet && !a.greeted) { a.greeted = true; express(world, a, d.greet); }
      } else if (close && d.look && d.turn !== false && (!a.act || a.act === 'sit')) a.faceActor(p);
      else if (!close && a.lookFrom) { if (d.look && !d.route) a.face(a.lookFrom); a.lookFrom = null; }
    }
  }
}

function tickChat(world, a, f) {
  const c = a.def.chat;
  const lines = c.lines || ['dots'];
  if (a.chatNext === undefined) { a.chatNext = f + ms((c.first ?? 1500) + Math.random() * (c.every ?? 7000)); a.chatI = 0; }
  if (f < a.chatNext) return;
  const b = world.actor(c.with);
  const ok = b && b.visible && !a.moving && !b.moving && dist(a, b) <= (c.near ?? 3) && world.inView(a.x, a.y);
  if (!ok) { a.chatNext = f + ms(1200); return; }
  const i = a.chatI % lines.length;
  if (!a.act || a.act === 'sit') a.faceActor(b);
  if (!b.act || b.act === 'sit') b.faceActor(a);
  express(world, i % 2 === 0 ? a : b, lines[i]);
  a.chatI++;
  // within an exchange the answer comes soon; then a while until the next
  const more = a.chatI % lines.length !== 0;
  a.chatNext = f + ms(more ? 2400 : (c.every ?? 7000) * (0.7 + 0.6 * Math.random()));
}

// The player walked into someone: they turn round (unless busy at something), and say
// their `bump` line if they have one.
export function bumped(world, a) {
  if (!a || a.party || a === world.player) return;
  const f = world.engine.frame;
  if (f - (a.bumpedAt || -999) < 90) return;
  a.bumpedAt = f;
  if (a.def.turn !== false && !a.act && !a.moving) a.faceActor(world.player);
  if (a.def.bump) express(world, a, a.def.bump);
}

// ---------- making way ----------

// Someone the player keeps walking into (half a second), or who stands on the way a tap
// asked for, steps aside to a free cell near by, off the player's way, and says so: their
// `makeWay: 'key'` (an emotion, or a key whose value is a list: one at random), else the
// map's or the game's, else the console's own. `makeWay: false` on them, the map or the
// game: they hold their ground (a guard who bars a door until the story lets you by).
// Away from where they stood, once the player has gone by they walk back to it; someone
// on a route takes it up again from where they are.
const PUSH = ms(500);
const ASIDE = ms(2500);

export function canMakeWay(world, a) {
  if (!a || a === world.player || a.party || !a.visible || a.moving || a.errand || a.leaving !== undefined) return false;
  if (a.act === 'sit' || a.act === 'sleep' || a.act === 'lie') return false;
  return a.def.makeWay !== false && world.map.makeWay !== false && world.game.makeWay !== false;
}

// `dir`: the way the player is going; `way`: the cells they mean to cross ([x, y] pairs),
// by default straight on from where they stand.
export function makeWay(world, a, dir, way = null) {
  if (!canMakeWay(world, a)) return false;
  const f = world.engine.frame;
  if (f - (a.asideAt ?? -1e9) < ASIDE) return false;
  const p = world.player;
  const [dx, dy] = DIRS[dir] || [0, 0];
  const key = (x, y) => `${x},${y}`;
  const avoid = new Set([key(p.x, p.y)]);
  if (way) for (const [x, y] of way) avoid.add(key(x, y));
  else for (let k = 1; k <= 8; k++) avoid.add(key(p.x + dx * k, p.y + dy * k));
  avoid.add(key(a.x, a.y));
  // the nearest free cell off the way, a few steps at most; across the way first
  const seen = new Set([key(a.x, a.y)]);
  let ring = [[a.x, a.y]];
  let to = null;
  for (let d = 1; d <= 4 && !to && ring.length; d++) {
    const next = [];
    for (const [x, y] of ring) {
      for (const [ex, ey] of Object.values(DIRS)) {
        const nx = x + ex;
        const ny = y + ey;
        const k = key(nx, ny);
        if (seen.has(k)) continue;
        seen.add(k);
        if (world.blocked(nx, ny, a) || world.actorAt(nx, ny, a, true)) continue;
        next.push([nx, ny]);
        if (avoid.has(k)) continue;
        // not further on the player's way than they stood
        const ahead = (nx - a.x) * dx + (ny - a.y) * dy > 0 ? 1 : 0;
        if (!to || ahead < to.ahead) to = { x: nx, y: ny, ahead };
      }
    }
    ring = next;
  }
  if (!to) return false;
  a.asideAt = f;
  a.aside = f + ASIDE;
  // the way they faced before they turned to look at the player (tickLife)
  if (!a.def.route && !a.wayBack) a.wayBack = { x: a.x, y: a.y, dir: a.lookFrom || a.dir, act: a.act };
  sayMakeWay(world, a);
  world.errand(a, to.x, to.y, () => { if (p) a.faceActor(p); });
  return true;
}

function sayMakeWay(world, a) {
  const own = [a.def.makeWay, world.map.makeWay, world.game.makeWay].find((v) => typeof v === 'string');
  const k = own || 'console.life.make_way';
  const v = !EMOTE_NAMES.has(k) && has(k) ? tv(k) : null;
  if (Array.isArray(v) && v.length) {
    bark(world, a, String(v[Math.floor(Math.random() * v.length)]));
    if (a.bark) a.bark.life = true;
  } else express(world, a, k);
}

// The player held on into `a` this frame (going `dir`): after a moment they make way.
export function pushInto(world, a, dir) {
  const f = world.engine.frame;
  const push = world.pushing;
  if (!push || push.a !== a || f - push.last > 3) { world.pushing = { a, from: f, last: f }; return; }
  push.last = f;
  if (f - push.from >= PUSH && makeWay(world, a, dir)) world.pushing = null;
}

// Per frame, while nobody runs a script: whoever stepped aside and is not on a route walks
// back to where they stood once the player is not by it and it is free.
export function tickWay(world) {
  const f = world.engine.frame;
  const p = world.player;
  for (const a of world.actors) {
    const b = a.wayBack;
    if (!b || a.moving || a.errand || f < (a.aside || 0)) continue;
    if (a.x === b.x && a.y === b.y) { a.wayBack = null; continue; }
    if (p && Math.abs(p.x - b.x) + Math.abs(p.y - b.y) < 2) continue;
    if (world.actorAt(b.x, b.y, a, true)) { a.aside = f + ms(1000); continue; }
    a.aside = f + ms(1500);
    world.errand(a, b.x, b.y, () => { a.face(b.dir); a.setPose(b.act); a.wayBack = null; });
  }
}

// A route point may say what is done there: [x, y, { face, pose, gesture, emote, bark,
// pause }] — the waiter reaches over the bar, the old man sits on the bench a while.
export function routeStop(world, a, act) {
  if (!act) return null;
  if (act.face) a.face(act.face);
  if (act.pose) a.setPose(act.pose);
  if (act.gesture) a.gesture(act.gesture);
  if (act.emote) express(world, a, act.emote);
  if (act.bark) express(world, a, act.bark);
  return act.pause ?? null;
}


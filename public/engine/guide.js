// Where the story wants the player next, shown on the map, and the checks that say when
// it can't be reached. `api.objective(key, at)` gives the objective a place: a person
// ('ana'), a cell ([x, y]) or { map, x, y, w, h } / { map, actor }. A small arrow bobs over
// it when it is on screen, sits at the edge of the screen pointing to it when it is
// elsewhere on the map, and points to the door or the edge that leads there when it is
// on another map (found through the maps' warps — their `to` — and connections). A
// { map } alone leads to that map; arriving there is the point.
// It is there whenever the player has control, walking too; nobody has to open START to know.
import { diveCell } from './move.js';
import { SCREEN_W, SCREEN_H, TILE } from './gfx.js';
import { getTheme } from './ui.js';

const KEY = 'luma32.guide';
export const guideOn = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export function setGuide(on) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* a comfort */ } }

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

// What the save keeps for api.objective's second argument.
export function goalOf(world, at) {
  if (at == null || at === false) return null;
  const here = world.mapId;
  if (typeof at === 'string') return { actor: at, map: world.actor(at) ? here : null };
  if (Array.isArray(at)) return { map: here, x: at[0], y: at[1] };
  const g = { ...at };
  if (g.map === undefined) g.map = g.actor && !world.actor(g.actor) ? null : here;
  return g;
}

// The cells of the goal on the current map, or null when it is somewhere else.
export function goalHere(world, g) {
  if (!g) return null;
  if (g.actor) {
    const a = world.actor(g.actor);
    if (a && a.visible && world.actors.includes(a) && a !== world.player) return { x: a.x, y: a.y, w: 1, h: 1, actor: a };
    return null;
  }
  if (g.map !== world.mapId) return null;
  return { x: g.x, y: g.y, w: g.w || 1, h: g.h || 1 };
}

// The ways out of a map: its warps that name a map (`to`) and its connections.
function exits(world, mapId) {
  const def = world.game.maps[mapId];
  const out = [];
  for (const w of def?.warps || []) {
    if (!w.to) continue;
    let open = true;
    try { open = !w.when || !!w.when(world.api); } catch { open = true; }
    if (open) out.push({ to: w.to, warp: w });
  }
  for (const c of def?.connections || []) out.push({ to: c.map, conn: c });
  // diving: down from deep water to the map below, up to the map above (engine/move.js)
  if (def?.below) out.push({ to: def.below, dive: 'down' });
  if (def?.above) out.push({ to: def.above, dive: 'up' });
  return out;
}

// The first way out of the current map on the shortest way to `target`. Mapping it reads
// the warps' `when`; a `when` that asks the way itself (an escort that shuts the doors off
// its route) would recurse, so while the way is being mapped, asking again gives nothing.
export function exitTowards(world, target) {
  if (!target || !world.game.maps[target] || world.mappingWay) return null;
  world.mappingWay = true;
  try { return wayTowards(world, target); } finally { world.mappingWay = false; }
}

function wayTowards(world, target) {
  const prev = new Map([[world.mapId, null]]);
  const q = [world.mapId];
  while (q.length && !prev.has(target)) {
    const m = q.shift();
    for (const e of exits(world, m)) {
      if (prev.has(e.to)) continue;
      prev.set(e.to, { from: m, e });
      q.push(e.to);
    }
  }
  if (!prev.has(target)) return null;
  let k = target;
  let first = null;
  while (prev.get(k)) { const p = prev.get(k); first = p.e; k = p.from; }
  return first;
}

// Where on this map the arrow points: the goal, or the way out towards it.
export function guidePoint(world) {
  const g = world.save.goal;
  if (!g) return null;
  const here = goalHere(world, g);
  if (here) return here;
  // a person not here now, or a whole map the player is already on
  if (g.actor && (!g.map || g.map === world.mapId)) return null;
  if (g.map === world.mapId) return null;
  const k = `${world.mapId}>${g.map}`;
  if (world.exitCache?.k !== k || world.engine.frame - world.exitCache.at > 60) {
    world.exitCache = { k, at: world.engine.frame, e: exitTowards(world, g.map) };
  }
  const e = world.exitCache.e;
  if (!e) return null;
  if (e.warp) return { x: e.warp.x, y: e.warp.y, w: e.warp.w || 1, h: e.warp.h || 1, exit: true };
  if (e.dive) { const c = diveCell(world, e.dive === 'up'); return c ? { x: c.x, y: c.y, w: 1, h: 1, exit: true } : null; }
  // an edge joined to the next map: the arrow points off that side, level with the player
  const p = world.player;
  const side = { north: [p.x, -1], south: [p.x, world.h], east: [world.w, p.y], west: [-1, p.y] }[e.conn.dir];
  return side ? { x: side[0], y: side[1], w: 1, h: 1, exit: true } : null;
}

// Arrows drawn as pixels: k = outline, y = fill.
const ARROW = ['kkkkkkkkk', 'kyyyyyyyk', '.kyyyyyk.', '..kyyyk..', '...kyk...', '....k....'];
function arrowCells(dir) {
  const h = ARROW.length;
  const w = ARROW[0].length;
  const cells = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const c = ARROW[j][i];
    if (c === '.') continue;
    // the pattern points down; turn it
    const [x, y] = { down: [i, j], up: [i, h - 1 - j], right: [j, i], left: [h - 1 - j, i] }[dir];
    cells.push([x, y, c]);
  }
  return { cells, w: dir === 'up' || dir === 'down' ? w : h, h: dir === 'up' || dir === 'down' ? h : w };
}

function drawArrow(ctx, dir, cx, cy) {
  const th = getTheme();
  const a = arrowCells(dir);
  const x0 = Math.round(cx - a.w / 2);
  const y0 = Math.round(cy - a.h / 2);
  for (const [x, y, c] of a.cells) {
    ctx.fillStyle = c === 'k' ? th.border || '#202020' : th.accent || '#f0c030';
    ctx.fillRect(x0 + x, y0 + y, 1, 1);
  }
}

// The arrow, whenever the player has control, standing or walking. Off with `guide: false` on the game or a map, or in Options.
// `project(x, up, z)` (the modern look): where a point of the map (x, z in map pixels, `up`
// pixels above the ground) is on the screen; without it the screen is the map, shifted.
export function drawGuide(world, ctx, e, cx, cy, project = null) {
  if (world.game.guide === false || world.map.guide === false || !guideOn()) return;
  const p = world.player;
  if (!p || world.busy || world.engine.top() !== world) return;
  const g = guidePoint(world);
  if (!g) return;
  // touching it already: the "A" hint takes over
  const dx = Math.max(g.x - p.x, 0, p.x - (g.x + g.w - 1));
  const dy = Math.max(g.y - p.y, 0, p.y - (g.y + g.h - 1));
  if (dx + dy <= 1 && !g.exit) return;
  // the top of what is there: a person's head, a prop's top, the cell
  // (and the ground under it, for the modern look's camera)
  let top = g.y * TILE - 2 - world.elev(g.x, g.y);
  let ground = g.y * TILE + 8;
  if (g.actor) { top = Math.round(g.actor.py) - g.actor.ez - 14; ground = Math.round(g.actor.py) + 11; }
  else {
    const prop = world.props.find((pr) => g.x >= pr.x && g.x < pr.x + pr.w && pr.y >= g.y && pr.y - pr.h + 1 <= g.y + g.h - 1);
    if (prop) { top = (prop.y + 1 - prop.h) * TILE - 2 - world.elev(prop.x, prop.y); ground = (prop.y + 1) * TILE - 4; }
  }
  const bob = Math.floor(e.frame / 16) % 2;
  const wx = (g.x + g.w / 2) * TILE;
  const at = project ? project(wx, ground - top, ground) : { x: wx - cx, y: top - cy };
  const sx = Math.round(at.x);
  const sy = Math.round(at.y) - 4;
  const m = 6;
  if (sx >= m && sx <= SCREEN_W - m && sy >= m && sy <= SCREEN_H - m) { drawArrow(ctx, 'down', sx, sy - bob); return; }
  // off screen: at the edge it lies beyond, pointing at it
  const over = { right: sx - (SCREEN_W - m), left: m - sx, down: sy - (SCREEN_H - m), up: m - sy };
  const dir = Object.keys(over).reduce((a, b) => (over[a] >= over[b] ? a : b));
  const ex = Math.max(m, Math.min(SCREEN_W - m, sx)) + (dir === 'right' ? -bob : dir === 'left' ? bob : 0);
  const ey = Math.max(m + 10, Math.min(SCREEN_H - m, sy + (dir === 'left' || dir === 'right' ? 8 : 0))) + (dir === 'down' ? -bob : dir === 'up' ? bob : 0);
  drawArrow(ctx, dir, ex, ey);
}

// ---------- the audit: what a player would get stuck on, checked from the data ----------

// Cells the player can walk to from where they stand. People who stand still block; people
// who move (routes, wanderers, passers-by, companions) don't, they would step aside.
function reachable(world) {
  const p = world.player;
  const moved = [];
  for (const a of world.actors) {
    if (a === p || !a.solid) continue;
    if (a.def.route || a.def.move === 'wander' || a.def.transient || a.party) { a.solid = false; moved.push(a); }
  }
  const seen = new Set([`${p.x},${p.y}`]);
  const q = [[p.x, p.y]];
  // a whole city is millions of cells: past this many the answer is "don't know"
  // (seen.capped) and nothing is reported as out of reach
  const cap = 60000;
  for (let i = 0; i < q.length; i++) {
    if (seen.size > cap) { seen.capped = true; break; }
    const [x, y] = q[i];
    for (const [dx, dy] of Object.values(DIRS)) {
      const nx = x + dx;
      const ny = y + dy;
      const k = `${nx},${ny}`;
      if (seen.has(k) || nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
      if (world.blocked(nx, ny, p, null, [x, y])) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  for (const a of moved) a.solid = true;
  return seen;
}

// Where A on (x, y) is pressed from, and facing which way: beside it, or across a counter.
// The audit asks it of every spot; a click on the map (world.js) walks to the nearest.
export function pressFrom(world, x, y) {
  const out = [];
  for (const [dir, [dx, dy]] of Object.entries(DIRS)) {
    out.push({ x: x - dx, y: y - dy, dir });
    if (world.propAt(x - dx, y - dy)?.def.counter) out.push({ x: x - 2 * dx, y: y - 2 * dy, dir });
  }
  return out;
}

// Can A, pressed from a reachable cell, land on any of these cells?
function pressable(world, reach, cells) {
  return cells.some(([x, y]) => pressFrom(world, x, y).some((c) => reach.has(`${c.x},${c.y}`)));
}

export const rectCells = (r) => {
  const out = [];
  for (let j = 0; j < (r.h || 1); j++) for (let i = 0; i < (r.w || 1); i++) out.push([r.x + i, r.y + j]);
  return out;
};
const live = (world, list) => (list || []).filter((s) => { try { return !s.when || s.when(world.api); } catch { return false; } });

// Checks the current map against where the player stands and the objective. Returns a
// list of problems in words; `World.audit` prints them as [luma] warnings too.
export function audit(world, { goalOnly = false } = {}) {
  const out = [];
  const p = world.player;
  const api = world.api;
  const reach = reachable(world);
  const key = world.save.objective;
  const g = world.save.goal;
  const spots = live(world, world.map.spots);
  const triggers = live(world, world.map.triggers).filter((t) => !t.once || !api.is(t.once));
  const warps = live(world, world.map.warps);
  // the objective
  if (key && !g && !world.save.goalFree) out.push(`objective "${key}" has no place: api.objective(key, at) with the person, cell or map it means, so the guide can point there.`);
  if (g) {
    const here = goalHere(world, g);
    if (here) {
      const cells = rectCells(here);
      const has = (r) => cells.some(([x, y]) => x >= r.x && x < r.x + (r.w || 1) && y >= r.y && y < r.y + (r.h || 1));
      const stepOn = triggers.some(has) || warps.some((w) => has(w) && !world.blocked(w.x, w.y, p));
      const answers = here.actor?.def.talk || spots.some(has) || warps.some(has) || triggers.some(has)
        || cells.some(([x, y]) => world.examineAt(x, y));
      if (!answers) out.push(`objective "${key}" points at (${here.x},${here.y}) and nothing there answers A or reacts when stepped on.`);
      const ok = reach.capped || (stepOn ? cells.some(([x, y]) => reach.has(`${x},${y}`)) : pressable(world, reach, cells));
      if (!ok) out.push(`objective "${key}" at (${here.x},${here.y}) can't be reached from where the player stands (${p.x},${p.y}).`);
      // a thing pointed at with someone standing behind it, out of the player's reach: the
      // player sees a person at a desk and gets the desk (pitfalls.md, "the person behind")
      if (!here.actor && !goalOnly) {
        // next to it and facing it, the way someone serves at a desk
        const faces = (a) => { const [dx, dy] = DIRS[a.dir] || [0, 0]; return has({ x: a.x + dx, y: a.y + dy }); };
        const behind = world.actors.find((a) => a !== p && a.visible && !a.party && a.def.talk && faces(a) && world.propAt(a.x + DIRS[a.dir][0], a.y + DIRS[a.dir][1]));
        if (behind) out.push(`objective "${key}" points at the thing at (${here.x},${here.y}) and ${behind.id} stands behind it: if the beat is theirs, put it in ${behind.id}'s talk and point the objective at '${behind.id}' (and make the thing a counter: true prop, so A reaches them across it).`);
      }
    } else if (g.map === world.mapId && !g.actor) {
      // { map } alone: arriving was the point
    } else if (!(g.actor && (!g.map || g.map === world.mapId))) {
      if (!g.map) out.push(`objective "${key}" points at ${g.actor}, who isn't on this map: give the map ({ actor, map }).`);
      else if (!world.game.maps[g.map]) out.push(`objective "${key}" points at a map that doesn't exist: ${g.map}.`);
      else {
        const e = exitTowards(world, g.map);
        if (!e) out.push(`objective "${key}" is on ${g.map} and no warp (with \`to\`) or connection leads there from here.`);
        else if (e.warp) {
          const cells = rectCells(e.warp);
          const ok = reach.capped || cells.some(([x, y]) => reach.has(`${x},${y}`)) || pressable(world, reach, cells);
          if (!ok) out.push(`the way to ${g.map} (the warp at ${e.warp.x},${e.warp.y}) can't be reached from where the player stands.`);
        }
      }
    } else if (g.actor) out.push(`objective "${key}" points at ${g.actor}, who isn't here now.`);
  }
  if (goalOnly) return out;
  // where people stand
  const solidAt = (x, y) => world.propAt(x, y) || world.game.tiles[world.tileAt(x, y)]?.solid;
  if (!p.act && solidAt(p.x, p.y)) out.push(`the player stands inside a prop or a wall at (${p.x},${p.y}).`);
  const cellOf = new Map();
  for (const a of world.actors) {
    if (!a.visible || a === p) continue;
    if (!a.act && !a.sprite && solidAt(a.x, a.y)) out.push(`${a.id} stands inside a prop or a wall at (${a.x},${a.y}) (give them a pose if they sit or lie on it).`);
    const k = `${a.x},${a.y}`;
    if (cellOf.has(k) && !a.party && !cellOf.get(k).party) out.push(`${cellOf.get(k).id} and ${a.id} stand on the same cell (${k}).`);
    cellOf.set(k, a);
    if (a.def.doll && !a.def.talk) out.push(`${a.id} doesn't answer A.`);
  }
  // what the player presses
  for (const s of spots) {
    const cells = rectCells(s);
    if (!reach.capped && !pressable(world, reach, cells)) out.push(`the spot at (${s.x},${s.y}) can't be pressed: no cell next to it the player can reach.`);
    if (cells.every(([x, y]) => !world.blocked(x, y, p) && !world.propAt(x, y))) out.push(`the spot at (${s.x},${s.y}) lies on open floor: the player can stand on it and nothing marks it. Put it on the cells of the thing it is about.`);
  }
  // where doors lead
  for (const w of warps) {
    if (!w.to || !w.at) continue;
    let m;
    try { m = world.parse(w.to); } catch { out.push(`the warp at (${w.x},${w.y}) leads to an unknown map ${w.to}.`); continue; }
    const [ax, ay] = w.at;
    const t = m.ground[ay]?.[ax];
    if (!t || world.game.tiles[t]?.solid || m.solid.has(`${ax},${ay}`)) out.push(`the warp at (${w.x},${w.y}) lands on a blocked cell of ${w.to} (${ax},${ay}).`);
  }
  return out;
}

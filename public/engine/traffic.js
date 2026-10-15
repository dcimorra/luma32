// Roads and the traffic on them (README "Roads and traffic"). Roads are data on the tiles:
//
//   tiles: { road_n: { lane: 'up' }, road_s: { lane: 'down' }, junction: { lane: 'cross' },
//            pavement: { sidewalk: true }, zebra: { lane: 'cross', crosswalk: true } }
//   map:   signals: true | { green: 6000, amber: 1200 }
//
// A lane cell is driven one way; touching `cross` cells make a junction. The engine reads
// the cells into a graph once per map: each junction knows the lanes that enter it and
// the lanes that leave it, so a car arriving picks a way out (straight, left or right)
// and finds its own path across, whatever the junction's shape. With `signals`, a
// junction lets one axis through at a time and the stop line of each lane entering it
// shows its light.
import { TILE, SCREEN_W, SCREEN_H } from './gfx.js';
import { wrapAngle } from './vehicle.js';

const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const LEFT_OF = { up: 'left', left: 'down', down: 'right', right: 'up' };
const RIGHT_OF = { up: 'right', right: 'down', down: 'left', left: 'up' };
const BACK = { up: 'down', down: 'up', left: 'right', right: 'left' };
const AXIS = { up: 0, down: 0, left: 1, right: 1 };
const ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

// The map's road graph, built on arrival (and again if a tile changes under it).
export function readRoads(world) {
  const { w, h } = world;
  // only the lane cells (a city without tile lanes keeps none of its million cells)
  const lane = new Map();
  const walk = [];
  const lanes = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = world.tileAt(x, y);
      const d = id && world.game.tiles[id];
      if (!d) continue;
      if (d.lane) { lane.set(y * w + x, d.lane); if (d.lane !== 'cross') lanes.push([x, y]); }
      if (d.sidewalk || d.crosswalk) walk.push([x, y]);
    }
  }
  // junctions: each patch of touching cross cells, with the lanes in and out of it
  const block = new Int32Array(lane.size ? w * h : 0).fill(-1);
  const junctions = [];
  for (const [i, v] of lane) {
    if (v !== 'cross' || block[i] >= 0) continue;
    const j = { id: junctions.length, cells: [], exits: [], entries: [], phase: (junctions.length * 97) % 400 };
    const q = [i];
    block[i] = j.id;
    while (q.length) {
      const k = q.pop();
      const x = k % w;
      const y = (k - x) / w;
      j.cells.push([x, y]);
      for (const [dir, [dx, dy]] of Object.entries(STEP)) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (lane.get(n) === 'cross') { if (block[n] < 0) { block[n] = j.id; q.push(n); } continue; }
        if (lane.get(n) === dir) j.exits.push({ x: nx, y: ny, dir });
        else if (lane.get(n) === BACK[dir]) j.entries.push({ x: nx, y: ny, dir: BACK[dir] });
      }
    }
    junctions.push(j);
  }
  // cells by 16×16 patch: a city of millions of cells is asked only round the camera
  const bucket = (list) => {
    const m = new Map();
    for (const c of list) { const k = (c[0] >> 4) * 65536 + (c[1] >> 4); const l = m.get(k); if (l) l.push(c); else m.set(k, [c]); }
    return m;
  };
  return { w, h, lane, block, junctions, lanes, walk, walkSet: new Set(walk.map(([x, y]) => y * w + x)), lanesBy: bucket(lanes), walkBy: bucket(walk) };
}

// The cells of a bucketed list inside a rectangle of map pixels.
export function cellsIn(by, r) {
  const out = [];
  const x0 = Math.floor(r.x / TILE) >> 4;
  const y0 = Math.floor(r.y / TILE) >> 4;
  const x1 = Math.floor((r.x + r.w) / TILE) >> 4;
  const y1 = Math.floor((r.y + r.h) / TILE) >> 4;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (const c of by.get(x * 65536 + y) || []) out.push(c);
  return out;
}

export const laneAt = (roads, x, y) => (x < 0 || y < 0 || x >= roads.w || y >= roads.h ? null : roads.lane.get(y * roads.w + x) ?? null);

// Can a car heading `dir` go into the junction now? One axis at a time, with an amber
// in between; `signals` off, always.
export function signalFor(world, roads, j, dir) {
  const conf = world.map.signals;
  if (!conf) return 'green';
  const green = (conf.green ?? 6000) / 16.67;
  const amber = (conf.amber ?? 1200) / 16.67;
  const period = 2 * (green + amber);
  const t = (world.engine.frame + j.phase * 7) % period;
  const axisOpen = t < green + amber ? 0 : 1;
  const local = t % (green + amber);
  if (AXIS[dir] !== axisOpen) return 'red';
  return local < green ? 'green' : 'amber';
}

// A path across a junction from the cell before it: a way out chosen by the turn wanted,
// then the cells to it (breadth first, inside the junction).
function crossing(roads, j, from, dir) {
  const want = [dir, Math.random() < 0.5 ? LEFT_OF[dir] : RIGHT_OF[dir]];
  if (Math.random() < 0.5) want.reverse();
  want.push(LEFT_OF[dir], RIGHT_OF[dir]);
  let exits = [];
  for (const d of want) { exits = j.exits.filter((e) => e.dir === d); if (exits.length) break; }
  if (!exits.length) return null;
  // the nearest exit of that heading
  exits.sort((a, b) => Math.abs(a.x - from[0]) + Math.abs(a.y - from[1]) - Math.abs(b.x - from[0]) - Math.abs(b.y - from[1]));
  const goal = exits[0];
  const { w } = roads;
  const key = (x, y) => y * w + x;
  const prev = new Map([[key(from[0], from[1]), null]]);
  const q = [from];
  while (q.length) {
    const [x, y] = q.shift();
    if (x === goal.x && y === goal.y) {
      const path = [];
      let k = key(x, y);
      while (k !== key(from[0], from[1])) { path.unshift([k % w, Math.floor(k / w)]); k = prev.get(k); }
      return path;
    }
    for (const [dx, dy] of Object.values(STEP)) {
      const nx = x + dx;
      const ny = y + dy;
      const k = key(nx, ny);
      if (prev.has(k)) continue;
      const inside = roads.block[k] === j.id;
      if (!inside && !(nx === goal.x && ny === goal.y)) continue;
      prev.set(k, key(x, y));
      q.push([nx, ny]);
    }
  }
  return null;
}

// The next cells for a car on (x, y) heading `dir`: along its lane, or across a junction.
export function nextCells(roads, x, y, dir) {
  const here = laneAt(roads, x, y);
  if (here === 'cross') {
    const j = roads.junctions[roads.block[y * roads.w + x]];
    return j ? crossing(roads, j, [x, y], dir) : null;
  }
  const d = here || dir;
  const [dx, dy] = STEP[d];
  const nx = x + dx;
  const ny = y + dy;
  const there = laneAt(roads, nx, ny);
  if (there === 'cross') {
    const j = roads.junctions[roads.block[ny * roads.w + nx]];
    const path = j && crossing(roads, j, [x, y], d);
    return path ? path : null;
  }
  if (!there || there === BACK[d]) return null;
  return [[nx, ny]];
}

// One frame of a car in traffic: it follows its cells, keeps its distance, stops at red.
// It moves by its own rule (not the physics): a bump from the player hands it to the
// physics for a moment (`stunned`), and then it finds its lane again or stays parked.
export function trafficTick(world, v, roads, look) {
  const ai = v.ai;
  if (ai.stunned > 0) {
    ai.stunned--;
    const hit = v.coast();
    if (hit > 1.2) world.city.crashed(v, hit, null);
    if (ai.stunned === 0) {
      ai.path = null;
      const cx = Math.floor(v.cx / TILE);
      const cy = Math.floor(v.cy / TILE);
      if (!laneAt(roads, cx, cy) || v.wreck) { v.ai = null; v.driver = null; }
    }
    return;
  }
  const cx = Math.floor(v.cx / TILE);
  const cy = Math.floor(v.cy / TILE);
  if (!ai.path?.length) {
    const lane = laneAt(roads, cx, cy);
    const dir = lane && lane !== 'cross' ? lane : ai.dir || 'right';
    ai.path = nextCells(roads, cx, cy, dir);
    if (!ai.path) { ai.blocked = (ai.blocked || 0) + 1; ai.speed = 0; v.vx = 0; v.vy = 0; return; }
  }
  const [tx, ty] = ai.path[0];
  const gx = tx * TILE + TILE / 2;
  const gy = ty * TILE + TILE / 2;
  const dx = gx - v.cx;
  const dy = gy - v.cy;
  const dist = Math.hypot(dx, dy);
  const stepDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  // the light: a car about to enter a junction waits at the line
  let limit = ai.cruise ?? world.map.roads?.speed ?? 1.6;
  const nextLane = laneAt(roads, tx, ty);
  const hereLane = laneAt(roads, cx, cy);
  if (nextLane === 'cross' && hereLane !== 'cross') {
    const j = roads.junctions[roads.block[ty * roads.w + tx]];
    const light = j ? signalFor(world, roads, j, stepDir) : 'green';
    // and never into a junction it can't get out of: its way across must be clear
    const full = ai.path.some(([x, y]) => world.city.carIn(x, y, v));
    if (light === 'red' || (light === 'amber' && dist > 10) || full) limit = Math.min(limit, Math.max(0, (dist - 7) * 0.12));
  }
  // what is ahead: another vehicle, a person, the player. Held too long by another
  // vehicle (two nose to nose in a junction, a jam), it edges through for a second
  if ((hereLane === 'cross' && ai.held > 120) || ai.held > 720) { ai.push = 60; ai.held = 0; }
  if (ai.push > 0) ai.push--;
  const ahead = look(v, 26, ai.push > 0);
  if (ahead < 26) limit = Math.min(limit, Math.max(0, (ahead - 9) * 0.1));
  ai.speed = ai.speed ?? 0;
  ai.speed += Math.max(-0.15, Math.min(0.05, limit - ai.speed));
  if (ai.speed < 0.01) ai.speed = 0;
  // honk at whoever stands in the way for too long
  if (ahead < 16 && ai.speed === 0) { ai.held = (ai.held || 0) + (world.city.blocker && !world.city.blocker.driver ? 6 : 1); if (ai.held % 150 === 90) world.city.honk(v); } else ai.held = 0;
  if (dist <= ai.speed || dist < 0.5) {
    v.cx = gx; v.cy = gy;
    ai.path.shift();
    ai.dir = stepDir;
  } else {
    v.cx += (dx / dist) * ai.speed;
    v.cy += (dy / dist) * ai.speed;
  }
  // the body turns toward where it goes, smoothly
  const want = ANGLE[stepDir];
  const da = wrapAngle(want - v.angle);
  v.angle = wrapAngle(v.angle + Math.max(-0.14, Math.min(0.14, da)));
  v.vx = Math.cos(v.angle) * ai.speed;
  v.vy = Math.sin(v.angle) * ai.speed;
}

// The stop lines: a bar across each lane that enters a junction, in its light's colour.
export function drawSignals(world, roads, ctx, cx, cy) {
  if (!world.map.signals) return;
  const col = { red: '#e83030', amber: '#f0b020', green: '#40d060' };
  for (const j of roads.junctions) {
    for (const en of j.entries) {
      const x = en.x * TILE - cx;
      const y = en.y * TILE - cy;
      if (x < -16 || y < -16 || x > SCREEN_W + 16 || y > SCREEN_H + 16) continue;
      ctx.fillStyle = col[signalFor(world, roads, j, en.dir)];
      if (en.dir === 'right') ctx.fillRect(x + 14, y + 1, 2, 14);
      else if (en.dir === 'left') ctx.fillRect(x, y + 1, 2, 14);
      else if (en.dir === 'down') ctx.fillRect(x + 1, y + 14, 14, 2);
      else ctx.fillRect(x + 1, y, 14, 2);
    }
  }
}

export { STEP, BACK, ANGLE };

// Going after someone, and shooting (README "Pursuit and combat"). The engine gives the
// means; who chases whom, what a hit costs and when it ends are the cartridge's.
//
//   api.seek(self, 'player', { speed: 1 })          // an entity on foot closes in: → { dist, sees }
//   api.drive(car, { chase: 'player' })             // a vehicle hunts: rams, goes round, backs out
//   api.drive(car, { to: [x, y] }) / { traffic: true } / { park: true }
//   api.sees(a, b, range)                           // a clear line between them
//   api.shoot({ from: 'player', angle | at, speed, damage, range, spread })
//   api.damage(target, amount, from)                // → hooks onDamage; hp on entities
//
// Paths round walls come from a flow field: a breadth-first fill out from the target's
// cell, shared by everyone after the same target and redrawn twice a second. Whoever has
// a clear line goes straight.
import { TILE } from './gfx.js';
import { cellStops, wrapAngle } from './vehicle.js';

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Where something is, in map pixels: the player (in a vehicle or on foot), an actor, an
// entity, a vehicle, [x, y] cells or { px, py } pixels.
export function centreOf(world, t) {
  if (t == null) return null;
  if (t === 'player' && world.driving) return { x: world.driving.cx, y: world.driving.cy };
  if (typeof t === 'string') t = world.actor(t);
  if (!t) return null;
  if (Array.isArray(t)) return { x: t[0] * TILE + 8, y: t[1] * TILE + 8 };
  if (t.kind === 'vehicle') return { x: t.cx, y: t.cy };
  if (t.def && 'px' in t) { const b = world.box(t); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
  if ('w' in t) return { x: t.x + t.w / 2, y: t.y + t.h / 2 };
  if ('px' in t) return { x: t.px, y: t.py };
  return null;
}

// A clear line between two points: no solid cell on it (sampled every 4 pixels).
export function clearLine(world, a, b, range = Infinity) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d > range) return false;
  const n = Math.ceil(d / 4);
  for (let i = 1; i < n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n;
    const y = a.y + ((b.y - a.y) * i) / n;
    if (world.solidAt(Math.floor(x / TILE), Math.floor(y / TILE))) return false;
  }
  return true;
}

// Distances to the target cell over the cells `who` can cross (a vehicle: drivable ones),
// out to `reach` cells. Kept a while per target and kind.
function flowTo(world, tx, ty, vehicle = null, reach = 40) {
  const kind = vehicle ? 'car' : 'foot';
  const key = `${kind}:${tx},${ty}`;
  world.flows ||= new Map();
  const old = world.flows.get(key);
  if (old && world.engine.frame - old.at < 30 && old.mapId === world.mapId) return old;
  const { w, h } = world;
  const dist = new Map();
  const k = (x, y) => y * w + x;
  const stops = (x, y) => (vehicle ? cellStops(world, x, y, vehicle) : world.solidAt(x, y));
  dist.set(k(tx, ty), 0);
  const q = [[tx, ty]];
  while (q.length) {
    const [x, y] = q.shift();
    const d = dist.get(k(x, y));
    if (d >= reach) continue;
    for (const [dx, dy] of N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || dist.has(k(nx, ny))) continue;
      if (stops(nx, ny)) continue;
      // diagonals only where both sides are open: no cutting a wall's corner
      if (dx && dy && (stops(x + dx, y) || stops(x, y + dy))) continue;
      dist.set(k(nx, ny), d + 1);
      q.push([nx, ny]);
    }
  }
  const f = { at: world.engine.frame, mapId: world.mapId, dist, w };
  if (world.flows.size > 24) world.flows.clear();
  world.flows.set(key, f);
  return f;
}

// The point to head for from (x, y) pixels toward the target: the target itself when the
// line is clear, otherwise the centre of the next cell down the flow field.
export function headFor(world, from, to, vehicle = null) {
  if (clearLine(world, from, to, 160)) return { x: to.x, y: to.y, sees: true };
  const tx = Math.floor(to.x / TILE);
  const ty = Math.floor(to.y / TILE);
  const f = flowTo(world, tx, ty, vehicle);
  const x = Math.floor(from.x / TILE);
  const y = Math.floor(from.y / TILE);
  let best = null;
  let bestD = f.dist.get(y * f.w + x) ?? Infinity;
  for (const [dx, dy] of N8) {
    const d = f.dist.get((y + dy) * f.w + x + dx);
    if (d !== undefined && d < bestD) { bestD = d; best = [x + dx, y + dy]; }
  }
  if (!best) return null;
  return { x: best[0] * TILE + 8, y: best[1] * TILE + 8, sees: false };
}

// An entity on foot moves toward a target by `speed` pixels a frame, round walls.
export function seek(world, self, target, { speed = 1, stop = 6 } = {}) {
  const to = centreOf(world, target);
  if (!to) return { dist: Infinity, sees: false };
  const me = centreOf(world, self);
  const dist = Math.hypot(to.x - me.x, to.y - me.y);
  if (dist <= stop) return { dist, sees: true };
  const p = headFor(world, me, to);
  if (!p) return { dist, sees: false };
  const d = Math.hypot(p.x - me.x, p.y - me.y) || 1;
  world.moveBox(self, ((p.x - me.x) / d) * speed, ((p.y - me.y) / d) * speed);
  self.facing = Math.atan2(p.y - me.y, p.x - me.x);
  return { dist, sees: p.sees };
}

// One frame of a vehicle that hunts (`chase`) or goes somewhere (`to`), on the physics.
export function chaseTick(world, v) {
  const ai = v.ai;
  const to = ai.chase ? centreOf(world, ai.chase) : ai.to ? centreOf(world, ai.to) : null;
  if (!to) { v.ai = null; v.driver = null; return; }
  const dist = Math.hypot(to.x - v.cx, to.y - v.cy);
  if (ai.to && dist < 14) {
    v.drive(-1, 0);
    if (v.speed < 0.1) { const done = ai.resolve; v.ai = null; v.driver = null; done?.(true); }
    return;
  }
  let throttle = 1;
  let steer = 0;
  const p = headFor(world, { x: v.cx, y: v.cy }, to, v);
  if (p) {
    // lead a moving target a little
    const tv = ai.chase === 'player' && world.driving ? world.driving : ai.chase?.kind === 'vehicle' ? ai.chase : null;
    const ax = p.sees && tv ? p.x + tv.vx * 8 : p.x;
    const ay = p.sees && tv ? p.y + tv.vy * 8 : p.y;
    const da = wrapAngle(Math.atan2(ay - v.cy, ax - v.cx) - v.angle);
    steer = Math.max(-1, Math.min(1, da * 2.5));
    // a sharp turn at speed: ease off
    if (Math.abs(da) > 1.2 && v.speed > 2) throttle = 0;
    if (ai.max && v.speed > ai.max) throttle = 0;
  } else throttle = 0.3;
  // stuck against something: back out, turning the other way, then try again
  if (ai.reverse > 0) { ai.reverse--; throttle = -1; steer = -steer; }
  else if (v.speed < 0.25 && throttle > 0) { if (++ai.stuck > 45) { ai.stuck = 0; ai.reverse = 40; } }
  else ai.stuck = 0;
  const hit = v.drive(throttle, steer);
  if (hit > 1.2) world.city.crashed(v, hit, null);
}

// A bullet: a short line flying until it hits a wall or something with a body.
// `sound`, `flash` (the effect at the mouth), `spark` (where it hits a wall) and `draw`
// (ctx, sx, sy, shot) make it an arrow, a fireball, a stone from a sling…
export function shoot(world, { from = 'player', angle = null, at = null, speed = 5, damage = 10, range = 180, spread = 0.04, color = '#fff2a0', owner = null,
  sound = 'shot', flash = 'muzzle', spark = 'sparks', draw = null } = {}) {
  const src = centreOf(world, from);
  if (!src) return null;
  let a = angle;
  if (a == null && at != null) { const t = centreOf(world, at); if (t) a = Math.atan2(t.y - src.y, t.x - src.x); }
  if (a == null) {
    if (from === 'player' && world.driving) a = world.driving.angle;
    else { const who = typeof from === 'string' ? world.actor(from) : from; a = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[who?.dir] ?? who?.facing ?? 0; }
  }
  a += (Math.random() * 2 - 1) * spread;
  const me = owner ?? (from === 'player' ? 'player' : from);
  const vx = Math.cos(a) * speed;
  const vy = Math.sin(a) * speed;
  // from the edge of a vehicle, not inside it
  const off = from === 'player' && world.driving ? world.driving.spec.l / 2 + 2 : 6;
  const shot = {
    kind: 'shot', x: src.x + Math.cos(a) * off, y: src.y + Math.sin(a) * off - (from === 'player' && !world.driving ? 2 : 0), w: 2, h: 2, vx, vy, left: range, owner: me, damage, color, always: true,
    update(api) { flyShot(world, shot); },
    draw(ctx, sx, sy) {
      ctx.fillStyle = shot.color;
      ctx.fillRect(sx, sy, 2, 2);
      ctx.fillRect(Math.round(sx - shot.vx * 0.6), Math.round(sy - shot.vy * 0.6), 1, 1);
    },
  };
  world.api.addEntity(shot);
  shot.spark = spark;
  if (draw) shot.draw = (ctx, sx, sy) => draw(ctx, sx, sy, shot);
  if (flash) world.vfx.burst(flash, { px: shot.x, py: shot.y });
  if (sound) world.api.sfx(sound);
  return shot;
}

function flyShot(world, s) {
  const n = Math.ceil(Math.hypot(s.vx, s.vy) / 2);
  for (let i = 0; i < n; i++) {
    s.x += s.vx / n;
    s.y += s.vy / n;
    s.left -= Math.hypot(s.vx, s.vy) / n;
    if (s.left <= 0) { world.api.removeEntity(s); return; }
    if (world.solidAt(Math.floor(s.x / TILE), Math.floor(s.y / TILE))) {
      if (s.spark) world.vfx.burst(s.spark, { px: s.x, py: s.y });
      if (s.spark === 'sparks' && Math.random() < 0.4) world.api.sfx('ricochet');
      world.api.removeEntity(s);
      return;
    }
    const hit = world.city.bodyAt(s.x, s.y, s.owner);
    if (hit) {
      world.vfx.burst(hit.kind === 'vehicle' ? 'sparks' : 'burst', { px: s.x, py: s.y }, { amount: 0.4, scale: 0.5 });
      world.city.damage(hit, s.damage, s.owner);
      world.api.removeEntity(s);
      return;
    }
  }
}

// A living street: what the vehicles, the traffic, the people on the pavement, the
// pursuit and the minimap need from the world, held per map (README "A living city").
// The World makes one and calls it on arrival (`enter`), before leaving (`leave`), every
// frame (`tick`) and while drawing (`under`, `over`). Everything here is off until a map
// or the game asks for it: a vehicle added, lanes on the tiles, `population`, `minimap`.
import { TILE } from './gfx.js';
import { sfx, motor } from './audio.js';
import { Vehicle, boardable, crashed as vehicleCrashed, ask, board, bodyOf, BODIES } from './vehicle.js';
import { readRoads, trafficTick, drawSignals, laneAt, cellsIn, STEP, BACK } from './traffic.js';
import { buildGraph, graphTick, drawGraph, placeOnLane, inChunks } from './roadgraph.js';
import { chaseTick, centreOf } from './pursuit.js';
import { drawMinimap } from './minimap.js';
import { tickMissions, drawMissionMarks, drawMissionHud } from './mission.js';
import { drawText } from './font.js';

const CELL = 32;            // the entity grid's cell, in pixels
const PALETTE = ['#c03030', '#3060c0', '#e8e8e8', '#303038', '#30a050', '#e0a020', '#8a4ac0', '#a0a0a8', '#c06020', '#206878'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// ---------- people on the pavement ----------

export class Ped {
  constructor(city, def) {
    this.kind = 'ped';
    this.city = city;
    this.doll = def.doll;
    this.x = def.px - 4;
    this.y = def.py - 3;
    this.w = 8;
    this.h = 6;
    this.dir = def.dir || 'down';
    this.state = def.state || 'walk';   // walk, flee, down, dead
    this.t = def.t || 0;
    this.hp = def.hp ?? 20;
    this.anim = 0;
    this.side = Math.round(Math.random() * 6 - 3);
    this.pop = !!def.pop;
    this.from = def.from || null;
    this.vx = 0;
    this.vy = 0;
    this.alpha = 1;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  update(api, e) { this.city.tickPed(this, e); }

  draw(ctx, sx, sy, e) {
    const w = this.city.world;
    let d;
    try { d = w.doll(this.doll); } catch { return; }
    let img;
    if (this.state === 'down' || this.state === 'dead') img = d.poses?.lie?.[this.dir === 'left' ? 'left' : 'right'] || d.frames.down[0];
    else {
      const moving = this.moving;
      const run = this.state === 'flee' && d.run;
      img = moving ? (run ? d.run[this.dir][[0, 1, 2, 1][Math.floor(this.anim / 5) % 4]] : d.frames[this.dir][[1, 0, 2, 0][Math.floor(this.anim / 6) % 4]]) : d.frames[this.dir][0];
    }
    const x = Math.round(sx + 4 - img.width / 2);
    const y = Math.round(sy + 6 - img.height + 1);
    ctx.globalAlpha = this.alpha;
    if (this.state !== 'down' && this.state !== 'dead') {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(Math.round(sx), Math.round(sy + 4), 8, 2);
    }
    ctx.drawImage(img, x, y);
    ctx.globalAlpha = 1;
  }
}

// ---------- the city ----------

export class City {
  constructor(world) {
    this.world = world;
    this.roads = null;
    this.marks = [];
    this.grid = null;
    this.gridAt = -1;
    this.booted = false;
    this.hits = new WeakMap();
    this.blips = new Map();
  }

  get api() { return this.world.api; }

  // ---------- arriving and leaving ----------

  // Before a map change: whatever is kept is written down where it was left.
  leave() {
    this.snapshot();
    motor(0);
  }

  enter() {
    const w = this.world;
    const m = w.map;
    this.marks = [];
    this.grid = null;
    this.blips.clear();
    this.applyEdits();
    this.roads = null;
    this.roadsDirty = true;
    this.filled = false;
    // vehicles kept in the save that were left on this map
    for (const [id, s] of Object.entries(w.save.vehicles || {})) {
      if (s.map !== w.mapId || w.entities.some((en) => en.kind === 'vehicle' && en.id === id)) continue;
      this.addVehicle({ ...s, id, keep: true, fromSave: true });
    }
    // a session that starts with the player at a wheel (a save made driving) sits back in
    if (!this.booted) {
      this.booted = true;
      const id = w.save.driving;
      const v = typeof id === 'string' && w.entities.find((en) => en.kind === 'vehicle' && en.id === id);
      delete w.save.driving;
      if (v) board(w, v);
      // a mission is not resumed across a reload: it starts over from its marker
      delete w.save.mission;
    }
    void m;
  }

  // ---------- kept vehicles and map edits (README "A world that remembers") ----------

  snapshot() {
    const w = this.world;
    for (const en of w.entities || []) {
      if (en.kind !== 'vehicle' || !en.keep || !en.id || en.removed) continue;
      (w.save.vehicles ||= {})[en.id] = {
        map: w.mapId, body: en.body, color: en.color, cx: Math.round(en.cx), cy: Math.round(en.cy),
        angle: Math.round(en.angle * 1000) / 1000, hp: Math.round(en.hp), wreck: en.wreck || undefined,
      };
    }
  }

  addVehicle(def) {
    const w = this.world;
    if (def.keep && def.id && !def.fromSave) {
      const here = w.entities.find((en) => en.kind === 'vehicle' && en.id === def.id && !en.removed);
      if (here) return here;
      const s = w.save.vehicles?.[def.id];
      if (s) {
        if (s.map !== w.mapId) return null;
        def = { ...def, ...s };
      }
    }
    const v = new Vehicle(def, w);
    if (def.wreck) { v.wreck = true; v.hp = 0; }
    v.update = (api, e) => this.tickVehicle(v, e);
    if (def.ai) this.setAi(v, def.ai);
    w.entities.push(v);
    v.removed = false;
    if (v.keep && v.id) this.snapshot();
    return v;
  }

  setAi(v, ai) {
    if (!ai || ai.park) { v.ai = null; v.driver = v.driver === 'player' ? 'player' : null; v.siren = false; return; }
    if (v.driver === 'player') return;
    v.driver = 'ai';
    v.ai = { ...ai, mode: ai.chase ? 'chase' : ai.to ? 'to' : 'traffic', stuck: 0, reverse: 0 };
    // a body with a siren (the engine's police, a cartridge's ambulance) lights it to chase
    if (ai.chase && v.spec.siren) v.siren = true;
  }

  edits(mapId = this.world.mapId) {
    const s = this.world.save;
    s.edits ||= {};
    return (s.edits[mapId] ||= { tiles: {}, add: [], remove: [] });
  }

  applyEdits() {
    const w = this.world;
    const ed = w.save.edits?.[w.mapId];
    if (!ed) return;
    for (const [k, id] of Object.entries(ed.tiles || {})) { const [x, y] = k.split(',').map(Number); w.setTile(x, y, id); }
    for (const id of ed.remove || []) w.removeProp(id);
    for (const p of ed.add || []) { if (p.id != null) w.props = w.props.filter((q) => q.id !== p.id); w.addProp(p); }
  }

  // ---------- every frame ----------

  ensureRoads() {
    if (!this.roadsDirty) return this.roads;
    this.roadsDirty = false;
    const m = this.world.map;
    // streets as a graph (roadgraph.js): built once per map and kept with its data
    this.graph = m.roads?.graph ? (m.builtGraph ||= buildGraph(m.roads.graph)) : null;
    this.roads = readRoads(this.world);
    if (!this.roads.lanes.length && !this.roads.walk.length && !this.graph) this.roads = null;
    return this.roads;
  }

  tick(e, control) {
    const w = this.world;
    if (!control) { if (w.driving) motor(0); return; }
    this.buildGrid(e.frame);
    const roads = this.ensureRoads();
    const pop = w.map.population;
    if (pop && roads && (e.frame % 15 === 0 || !this.filled)) this.populate(pop, roads);
    this.collide(e);
    tickMissions(w, e);
    if (this.marks.length) for (const m of this.marks) m.life--;
    if (this.marks.length > 240 || (this.marks[0] && this.marks[0].life <= 0)) this.marks = this.marks.filter((m) => m.life > 0).slice(-240);
  }

  // The entities by where they are, rebuilt once a frame: collisions ask only the cells
  // around them instead of every entity on the map.
  buildGrid(frame) {
    if (this.gridAt === frame) return;
    this.gridAt = frame;
    const g = new Map();
    for (const en of this.world.entities) {
      if (en.removed) continue;
      const x0 = Math.floor(en.x / CELL);
      const y0 = Math.floor(en.y / CELL);
      const x1 = Math.floor((en.x + (en.w ?? 16)) / CELL);
      const y1 = Math.floor((en.y + (en.h ?? 16)) / CELL);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const k = x * 65536 + y;
        const list = g.get(k);
        if (list) list.push(en); else g.set(k, [en]);
      }
    }
    this.grid = g;
  }

  // Entities whose box may touch this rectangle (the whole list when there is no grid).
  near(b, pad = 0) {
    if (!this.grid || this.gridAt !== this.world.engine.frame) return this.world.entities;
    const out = new Set();
    const x0 = Math.floor((b.x - pad - 16) / CELL);
    const y0 = Math.floor((b.y - pad - 16) / CELL);
    const x1 = Math.floor((b.x + b.w + pad + 16) / CELL);
    const y1 = Math.floor((b.y + b.h + pad + 16) / CELL);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (const en of this.grid.get(x * 65536 + y) || []) out.add(en);
    return out;
  }

  addToGrid(en) {
    if (!this.grid) return;
    const k = Math.floor(en.x / CELL) * 65536 + Math.floor(en.y / CELL);
    const list = this.grid.get(k);
    if (list) list.push(en); else this.grid.set(k, [en]);
  }

  tickVehicle(v, e) {
    const w = this.world;
    if (v.driver === 'player') return;
    if (v.ai?.mode === 'traffic') {
      const roads = this.ensureRoads();
      const look = (car, range, pushy) => this.ahead(car, range, pushy);
      if (this.graph) { graphTick(w, v, this.graph, look); return; }
      if (roads) { trafficTick(w, v, roads, look); return; }
    }
    if (v.ai?.mode === 'chase' || v.ai?.mode === 'to') { chaseTick(w, v); return; }
    const hit = v.coast();
    if (hit > 1.2) this.crashed(v, hit, null);
  }

  // How far ahead of a car the nearest thing in its way is (vehicles, people, the
  // player), up to `range` pixels past its front.
  ahead(v, range, pushy = false) {
    this.blocker = null;
    const w = this.world;
    const c = Math.cos(v.angle);
    const s = Math.sin(v.angle);
    const half = v.spec.l / 2;
    let best = range;
    const test = (x, y, r, l) => {
      const rx = x - v.cx;
      const ry = y - v.cy;
      const along = rx * c + ry * s;
      const lat = Math.abs(-rx * s + ry * c);
      if (along <= 0 || lat > v.spec.w / 2 + r + 1) return;
      const d = along - half - l;
      if (d < best) best = Math.max(0, d);
    };
    const box = { x: v.cx - range - half, y: v.cy - range - half, w: (range + half) * 2, h: (range + half) * 2 };
    for (const en of this.near(box)) {
      if (en === v || en.removed) continue;
      if (en.kind === 'vehicle') {
        if ((pushy && en.driver !== 'player') || en.spec.on === 'air') continue;
        const was = best;
        test(en.cx, en.cy, en.spec.w / 2, en.spec.l / 2);
        // what stops it, if anything: a vehicle nobody drives is gone round sooner
        if (best < was) this.blocker = en;
      }
      else if (en.kind === 'ped' && en.state !== 'dead') test(en.cx, en.cy, 4, 3);
    }
    for (const a of w.actors) {
      if (!a.visible || !a.solid) continue;
      const b = w.box(a);
      test(b.x + b.w / 2, b.y + b.h / 2, 5, 3);
    }
    return best;
  }

  // ---------- bumps ----------

  collide(e) {
    const w = this.world;
    const cars = w.entities.filter((en) => en.kind === 'vehicle' && !en.removed);
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) this.bump(cars[i], cars[j]);
    // vehicles into people
    for (const v of cars) {
      if (v.speed < 0.3 || v.spec.on === 'air') continue;
      const circles = v.circles();
      const touches = (b) => circles.some(([x, y, r]) => {
        const qx = Math.max(b.x, Math.min(x, b.x + b.w));
        const qy = Math.max(b.y, Math.min(y, b.y + b.h));
        return (qx - x) ** 2 + (qy - y) ** 2 < r * r;
      });
      for (const en of this.near({ x: v.cx - 16, y: v.cy - 16, w: 32, h: 32 })) {
        if (en.kind !== 'ped' || en.state === 'dead' || en.state === 'down' || !touches(en)) continue;
        this.runOver(v, en, en);
      }
      for (const a of w.actors) {
        if (!a.visible || (a === w.player && w.driving) || !touches(w.box(a))) continue;
        this.runOver(v, a === w.player ? 'player' : a.id, a);
      }
    }
  }

  bump(a, b) {
    if (Math.abs(a.cx - b.cx) > 34 || Math.abs(a.cy - b.cy) > 34) return;
    // what flies and what doesn't never meet
    if ((a.spec.on === 'air') !== (b.spec.on === 'air')) return;
    // two cars of the traffic keep their distance by their own rule; when one edges
    // through a jam they overlap a moment rather than knock each other off the road
    if (a.ai?.mode === 'traffic' && b.ai?.mode === 'traffic' && !a.ai.stunned && !b.ai.stunned) return;
    for (const [ax, ay, ar] of a.circles()) {
      for (const [bx, by, br] of b.circles()) {
        const dx = bx - ax;
        const dy = by - ay;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d >= ar + br) continue;
        const nx = dx / d;
        const ny = dy / d;
        const ma = a.spec.mass || 1;
        const mb = b.spec.mass || 1;
        // a car in traffic moves by its own rule: a bump hands it to the physics a moment
        for (const v of [a, b]) if (v.ai?.mode === 'traffic') v.ai.stunned = 50;
        const over = ar + br - d;
        const pa = over * (mb / (ma + mb));
        const pb = over * (ma / (ma + mb));
        if (!a.blockedAt(a.cx - nx * pa, a.cy - ny * pa, a.angle)) { a.cx -= nx * pa; a.cy -= ny * pa; }
        if (!b.blockedAt(b.cx + nx * pb, b.cy + ny * pb, b.angle)) { b.cx += nx * pb; b.cy += ny * pb; }
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const j = (-1.3 * rel) / (1 / ma + 1 / mb);
          a.vx -= (nx * j) / ma; a.vy -= (ny * j) / ma;
          b.vx += (nx * j) / mb; b.vy += (ny * j) / mb;
          // a glancing blow turns them a little
          a.angle += (Math.random() - 0.5) * Math.min(0.3, -rel * 0.05);
          if (-rel > 1.2) this.crashed(a, -rel, b);
          else if (-rel > 0.4 && this.world.engine.frame % 8 === 0) sfx('thud');
        }
        return;
      }
    }
  }

  crashed(v, speed, other) {
    vehicleCrashed(this.world, v, speed, other);
    if (other) {
      const dmg = Math.max(0, speed - 1.2) * 12 / (other.spec.mass || 1);
      if (dmg > 0) this.damage(other, dmg, v);
    }
    this.panic(v.cx, v.cy, 48);
  }

  // A vehicle into someone. Fast enough, it's a hit: the cartridge's onHit says what it
  // means (return false: nothing more); people on the pavement are knocked down and the
  // player on foot thrown aside. Slower, they're pushed out of the way.
  runOver(v, target, body) {
    const w = this.world;
    const last = this.hits.get(body) || -99;
    if (w.engine.frame - last < 30) return;
    this.hits.set(body, w.engine.frame);
    const speed = v.speed;
    if (speed < 1) {
      if (body.kind === 'ped') { w.moveBox(body, v.vx * 3, v.vy * 3); if (body.state === 'walk') this.flee(body, v.cx, v.cy); }
      v.vx *= 0.5; v.vy *= 0.5;
      return;
    }
    const said = ask(w, 'onHit', { vehicle: v, target, speed, driver: v.driver });
    sfx('thud');
    if (said === false) return;
    if (body.kind === 'ped') {
      this.knock(body, v.vx, v.vy);
      this.damage(body, speed * 9, v);
    } else if (target === 'player') {
      w.moveBox(body, v.vx * 6, v.vy * 6);
      w.engine.shake(10, 2);
      this.damage('player', speed * 9, v);
    } else {
      // a person of the story stops the vehicle; what it means is the cartridge's
      v.vx *= -0.2; v.vy *= -0.2;
    }
    this.panic(v.cx, v.cy, 64);
  }

  // ---------- damage ----------

  // Something takes `amount`: onDamage may change it (a number) or refuse it (false).
  // Vehicles smoke and then burn; people on the pavement fall; an entity with `hp` runs
  // its `onDeath` (or goes in a puff). The player and the story's people only get the
  // hook: their health is the cartridge's.
  damage(target, amount, from = null) {
    const w = this.world;
    const said = ask(w, 'onDamage', { target, amount, from });
    if (said === false) return;
    if (typeof said === 'number') amount = said;
    if (!target || typeof target === 'string' || target.def) return;
    if (target.hp == null || target.removed) return;
    if (target.kind === 'vehicle') {
      if (target.wreck) return;
      target.hp -= amount;
      if (target.hp < target.maxHp * 0.35 && !target.smoke) target.smoke = w.vfx.emit('smoke', target, { every: 160 });
      if (target.hp <= 0) this.explode(target, from);
      return;
    }
    if (target.kind === 'ped') {
      target.hp -= amount;
      if (target.hp <= 0) { this.knock(target, 0, 0); target.state = 'dead'; target.t = 0; }
      else if (target.state === 'walk') this.flee(target, centreOf(w, from)?.x ?? target.cx, centreOf(w, from)?.y ?? target.cy);
      return;
    }
    target.hp -= amount;
    if (target.hp <= 0) {
      if (target.onDeath) target.onDeath(w.api, target, from);
      else { w.vfx.burst('poof', { px: target.x + (target.w ?? 16) / 2, py: target.y + (target.h ?? 16) / 2 }); w.api.removeEntity(target); }
    }
  }

  explode(v, from) {
    const w = this.world;
    v.wreck = true;
    v.hp = 0;
    v.ai = null;
    if (v.driver === 'ai') this.evict(v, true);
    v.driver = v.driver === 'player' ? 'player' : null;
    v.siren = false;
    v.vx *= 0.3; v.vy *= 0.3;
    v.smoke?.stop();
    v.smoke = w.vfx.emit('smoke', v, { every: 260, color: ['#4a444a', '#302a30'] });
    w.vfx.burst('explosion', v);
    sfx('boom');
    const p = centreOf(w, 'player');
    const near = p ? Math.hypot(p.x - v.cx, p.y - v.cy) : 999;
    if (near < 180) { w.engine.shake(30, Math.max(1, 5 - near / 40)); w.engine.flash('#fff0c0', 6); w.api.rumble([80, 40, 120]); }
    if (w.driving === v) { w.unboard({ force: true }); this.damage('player', 100, v); }
    else if (near < 34) this.damage('player', 60 * (1 - near / 34), v);
    for (const en of this.near({ x: v.cx - 40, y: v.cy - 40, w: 80, h: 80 })) {
      if (en === v || en.removed) continue;
      const c = centreOf(w, en);
      const d = Math.hypot(c.x - v.cx, c.y - v.cy);
      if (d > 40) continue;
      if (en.kind === 'vehicle') { this.damage(en, 70 * (1 - d / 40), v); en.vx += (c.x - v.cx) / (d || 1) * 1.5; en.vy += (c.y - v.cy) / (d || 1) * 1.5; }
      else if (en.kind === 'ped') { this.knock(en, (c.x - v.cx) / (d || 1) * 3, (c.y - v.cy) / (d || 1) * 3); this.damage(en, 100, v); }
      else if (en.hp != null) this.damage(en, 60, v);
    }
    this.panic(v.cx, v.cy, 120);
    ask(w, 'onExplode', { vehicle: v, from });
  }

  // What a bullet at (x, y) hits: a vehicle, someone on the pavement, an entity with hp,
  // a person; never whoever fired it (nor the vehicle they're in).
  bodyAt(x, y, owner) {
    const w = this.world;
    const mine = owner === 'player' ? w.driving : owner?.kind === 'vehicle' ? owner : null;
    for (const en of this.near({ x: x - 2, y: y - 2, w: 4, h: 4 })) {
      if (en.removed || en === owner || en === mine || en.kind === 'shot') continue;
      if (en.kind === 'vehicle') {
        const c = Math.cos(en.angle);
        const s = Math.sin(en.angle);
        const rx = x - en.cx;
        const ry = y - en.cy;
        if (Math.abs(rx * c + ry * s) <= en.spec.l / 2 && Math.abs(-rx * s + ry * c) <= en.spec.w / 2) return en;
        continue;
      }
      if (en.kind === 'ped') {
        if (en.state === 'dead' || en.state === 'down') continue;
        if (x >= en.x - 1 && x <= en.x + en.w + 1 && y >= en.y - 16 && y <= en.y + en.h) return en;
        continue;
      }
      if (en.hp != null && x >= en.x && x <= en.x + (en.w ?? 16) && y >= en.y && y <= en.y + (en.h ?? 16)) return en;
    }
    for (const a of w.actors) {
      if (!a.visible || a === owner || (owner === 'player' && a === w.player) || (a === w.player && w.driving)) continue;
      const bx = a.px + 4;
      const by = a.py - 4;
      if (x >= bx && x <= bx + 8 && y >= by && y <= by + 20) return a === w.player ? 'player' : a.id;
    }
    return null;
  }

  // ---------- people ----------

  knock(p, vx, vy) {
    p.state = 'down';
    p.t = 0;
    p.vx = vx * 0.8;
    p.vy = vy * 0.8;
    p.dir = vx < 0 ? 'left' : 'right';
  }

  flee(p, fx, fy) {
    if (p.state === 'dead' || p.state === 'down') return;
    p.state = 'flee';
    p.t = 150 + Math.floor(Math.random() * 90);
    p.from = { x: fx, y: fy };
    p.target = null;
  }

  // Everyone on the pavement within r pixels runs from (x, y): a crash, a shot, a blast.
  panic(x, y, r = 80) {
    for (const en of this.near({ x: x - r, y: y - r, w: r * 2, h: r * 2 })) {
      if (en.kind !== 'ped' || en.state !== 'walk') continue;
      if (Math.hypot(en.cx - x, en.cy - y) <= r) this.flee(en, x, y);
    }
  }

  tickPed(p) {
    const w = this.world;
    const roads = this.ensureRoads();
    p.moving = false;
    if (p.state === 'dead' || p.state === 'down') {
      p.vx *= 0.88; p.vy *= 0.88;
      if (Math.abs(p.vx) + Math.abs(p.vy) > 0.05) w.moveBox(p, p.vx, p.vy);
      p.t++;
      if (p.state === 'down' && p.t > 100) { p.state = 'walk'; this.flee(p, p.cx - p.vx, p.cy - 1); }
      if (p.state === 'dead' && p.t > 360) { p.alpha = Math.max(0, 1 - (p.t - 360) / 60); if (p.alpha <= 0) w.api.removeEntity(p); }
      return;
    }
    if (p.state === 'flee') {
      const dx = p.cx - p.from.x;
      const dy = p.cy - p.from.y;
      const d = Math.hypot(dx, dy) || 1;
      const r = w.moveBox(p, (dx / d) * 1.4 + (Math.random() - 0.5) * 0.4, (dy / d) * 1.4 + (Math.random() - 0.5) * 0.4);
      // a wall in the way: run along it
      if (r.hitX && r.hitY) p.from = { x: p.cx + (Math.random() - 0.5) * 40, y: p.cy + (Math.random() - 0.5) * 40 };
      p.moving = !!(r.x || r.y);
      p.anim += 1.4;
      p.dir = Math.abs(r.x) > Math.abs(r.y) ? (r.x > 0 ? 'right' : 'left') : r.y > 0 ? 'down' : r.y < 0 ? 'up' : p.dir;
      if (--p.t <= 0) { p.state = 'walk'; p.target = null; }
      return;
    }
    if (!roads?.walk.length) return;
    // walking the pavement, cell to cell, mostly straight on
    if (!p.target) {
      const cx = Math.floor(p.cx / TILE);
      const cy = Math.floor(p.cy / TILE);
      const on = roads.walkSet.has(cy * roads.w + cx);
      if (!on) {
        // off the pavement (after running): back to the nearest bit of it
        let best = null;
        let bd = 1e9;
        for (const [x, y] of cellsIn(roads.walkBy, { x: p.cx - 160, y: p.cy - 160, w: 320, h: 320 })) {
          const d = Math.abs(x - cx) + Math.abs(y - cy);
          if (d < bd) { bd = d; best = [x, y]; }
          if (d <= 1) break;
        }
        if (!best) { w.api.removeEntity(p); return; }
        p.target = best;
      } else {
        const opts = [];
        for (const [dir, [dx, dy]] of Object.entries(STEP)) {
          if (dir === BACK[p.dir]) continue;
          if (roads.walkSet.has((cy + dy) * roads.w + cx + dx)) opts.push(dir);
        }
        let dir = opts.includes(p.dir) && Math.random() < 0.8 ? p.dir : pick(opts.length ? opts : [BACK[p.dir]]);
        if (!roads.walkSet.has((cy + STEP[dir][1]) * roads.w + cx + STEP[dir][0])) dir = BACK[p.dir];
        p.target = [cx + STEP[dir][0], cy + STEP[dir][1]];
        p.dir = dir;
        // a person waits at the kerb while a car is about to cross the zebra
        if (laneAt(roads, p.target[0], p.target[1]) && this.carNear(p.target[0] * TILE + 8, p.target[1] * TILE + 8, 30)) { p.target = null; p.wait = 30; }
      }
      if (!p.target) return;
    }
    if (p.wait > 0) { p.wait--; return; }
    const along = p.dir === 'up' || p.dir === 'down';
    const gx = p.target[0] * TILE + 8 + (along ? p.side : 0);
    const gy = p.target[1] * TILE + 8 + (along ? 0 : p.side);
    const dx = gx - p.cx;
    const dy = gy - p.cy;
    const d = Math.hypot(dx, dy);
    if (d < 0.6) { p.target = null; return; }
    const sp = Math.min(0.45, d);
    p.x += (dx / d) * sp;
    p.y += (dy / d) * sp;
    p.moving = true;
    p.anim += sp;
    if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
    else p.dir = dy > 0 ? 'down' : 'up';
  }

  // Another vehicle on this cell (its centre in it)?
  carIn(x, y, not = null) {
    for (const en of this.near({ x: x * TILE, y: y * TILE, w: TILE, h: TILE })) {
      if (en === not || en.kind !== 'vehicle' || en.removed) continue;
      if (Math.floor(en.cx / TILE) === x && Math.floor(en.cy / TILE) === y) return true;
    }
    return false;
  }

  carNear(x, y, r) {
    for (const en of this.near({ x: x - r, y: y - r, w: r * 2, h: r * 2 })) if (en.kind === 'vehicle' && en.speed > 0.3 && Math.hypot(en.cx - x, en.cy - y) < r) return true;
    return false;
  }

  // The driver of a car the player takes gets out and runs.
  evict(v, quiet = false) {
    const pop = this.world.map.population;
    const dolls = pop?.dolls;
    if (!dolls?.length) return;
    const c = Math.cos(v.angle);
    const s = Math.sin(v.angle);
    const px = v.cx + s * (v.spec.w / 2 + 6);
    const py = v.cy - c * (v.spec.w / 2 + 6);
    const p = new Ped(this, { doll: pick(dolls), px, py, pop: true });
    p.removed = false;
    this.world.entities.push(p);
    if (!quiet) this.flee(p, v.cx, v.cy);
    else { this.knock(p, s * 2, -c * 2); this.damage(p, 100, v); }
  }

  honk(v) { if (this.onScreen(v.cx, v.cy, 0)) sfx('horn'); }

  mark(v) {
    const c = Math.cos(v.angle);
    const s = Math.sin(v.angle);
    const back = v.spec.l / 2 - 3;
    const side = v.spec.w / 2 - 1;
    for (const k of [1, -1]) this.marks.push({ x: v.cx - c * back - s * side * k, y: v.cy - s * back + c * side * k, life: 600 });
  }

  // ---------- population ----------

  view(pad = 0) {
    const c = this.world.cam;
    return { x: c.x - pad, y: c.y - pad, w: this.world.viewW + pad * 2, h: this.world.viewH + pad * 2 };
  }

  onScreen(x, y, pad = 0) {
    const v = this.view(pad);
    return x >= v.x && y >= v.y && x < v.x + v.w && y < v.y + v.h;
  }

  // Cars and people come and go out of sight around the camera: never more than the map
  // asks for, never popping in where the player looks.
  populate(pop, roads) {
    const w = this.world;
    const far = this.view(pop.despawn ?? 200);
    const inside = (x, y, r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
    let cars = 0;
    let people = 0;
    for (const en of [...w.entities]) {
      if (!en.pop || en.removed) continue;
      const cx = en.cx;
      const cy = en.cy;
      const keep = en.driver === 'player' || en.ai?.mode === 'chase' || en.always;
      const jammed = en.ai?.held > 900 && !this.onScreen(cx, cy, 24);
      if (!keep && (!inside(cx, cy, far) || jammed)) { en.smoke?.stop(); w.api.removeEntity(en); continue; }
      if (en.kind === 'vehicle' && en.driver === 'ai') cars++;
      if (en.kind === 'ped' && en.state !== 'dead') people++;
    }
    const first = !this.filled;
    this.filled = true;
    const ring = this.view(pop.spawn ?? 120);
    const seen = this.view(16);
    const ok = (x, y) => inside(x, y, ring) && (first || !inside(x, y, seen));
    const vehicles = pop.vehicles || ['sedan', 'compact', 'van', 'taxi'];
    const make = (def, at) => {
      // a body in livery (a taxi, the police) keeps its own colours
      const v = this.addVehicle({ ...def, color: def.color || (bodyOf(w.game, def.body)?.livery ? null : pick(pop.colors || PALETTE)), ...at });
      v.pop = true;
      this.setAi(v, { traffic: true, cruise: (pop.speed ?? w.map.roads?.speed ?? 1.6) * (0.85 + Math.random() * 0.3) });
      return v;
    };
    // on the graph: points along its lanes, round the camera only
    const g = this.graph;
    const spots = g ? inChunks(g.spawns, ring) : null;
    for (let n = 0; g && n < (first ? 40 : 2) && cars < (pop.cars ?? 0) && spots.length; n++) {
      const { lane, i } = pick(spots);
      const [px, py] = lane.pts[i];
      if (!ok(px, py) || this.carNear(px, py, 30) || this.blockedBy(px, py)) continue;
      const kind = pick(vehicles);
      const v = make(typeof kind === 'string' ? { body: kind } : kind, { cx: px, cy: py });
      placeOnLane(v, lane, i);
      cars++;
    }
    const laneCells = g ? [] : cellsIn(roads.lanesBy, ring);
    for (let n = 0; !g && n < (first ? 40 : 2) && cars < (pop.cars ?? 0) && laneCells.length; n++) {
      const [x, y] = pick(laneCells);
      const px = x * TILE + 8;
      const py = y * TILE + 8;
      if (!ok(px, py) || this.carNear(px, py, 30) || this.blockedBy(px, py)) continue;
      const kind = pick(vehicles);
      make(typeof kind === 'string' ? { body: kind } : kind, { x, y, dir: laneAt(roads, x, y) });
      cars++;
    }
    const dolls = pop.dolls || [];
    const walkCells = cellsIn(roads.walkBy, ring);
    for (let n = 0; n < (first ? 60 : 3) && people < (pop.people ?? 0) && dolls.length && walkCells.length; n++) {
      const [x, y] = pick(walkCells);
      const px = x * TILE + 8;
      const py = y * TILE + 8;
      if (!ok(px, py) || laneAt(roads, x, y) || this.blockedBy(px, py)) continue;
      const p = new Ped(this, { doll: pick(dolls), px, py, pop: true, dir: pick(['up', 'down', 'left', 'right']) });
      p.removed = false;
      w.entities.push(p);
      people++;
    }
  }

  blockedBy(px, py) {
    const p = this.world.player;
    return p && Math.abs(p.px + 8 - px) < 14 && Math.abs(p.py + 12 - py) < 14;
  }

  // ---------- drawing ----------

  // On the ground, under everyone: skid marks, the stop lines, mission markers.
  under(ctx, cx, cy, e) {
    if (this.marks.length) {
      ctx.fillStyle = 'rgba(20,16,24,0.35)';
      for (const m of this.marks) ctx.fillRect(Math.round(m.x - cx), Math.round(m.y - cy), 1, 1);
    }
    if (this.graph) drawGraph(this.world, this.graph, ctx, cx, cy, e);
    else if (this.roads) drawSignals(this.world, this.roads, ctx, cx, cy);
    drawMissionMarks(this.world, ctx, cx, cy, e);
  }

  // Over the map: the A over a vehicle the player can take.
  marker(ctx, cx, cy, e) {
    const w = this.world;
    if (!w.driving && !w.busy && w.engine.top() === w && w.map.hint !== false) {
      const v = boardable(w);
      if (v && Math.floor(e.frame / 20) % 2) {
        const x = Math.round(v.cx - cx - 3);
        const y = Math.round(v.cy - cy - v.hh - 12);
        ctx.fillStyle = '#1c1830';
        ctx.fillRect(x - 1, y - 1, 9, 9);
        ctx.fillStyle = '#f0c030';
        ctx.fillRect(x, y, 7, 7);
        drawText(ctx, 'A', x + 1, y, '#1c1830');
      }
    }
  }

  // Over the screen: the mission's clock and the minimap.
  over(ctx, e) {
    const w = this.world;
    drawMissionHud(w, ctx, e);
    drawMinimap(w, ctx, e);
  }
}

export { BODIES };

// Vehicles: cars, vans, trucks and bikes seen from above, with momentum, grip, drift and
// crashes, that the player gets into and drives (README "Vehicles"). A vehicle is an
// entity (api.entities) with its own physics; it decides nothing about the story:
// who may take it, what a crash costs and what a run-over means are the cartridge's
// hooks (`canBoard`, `onCrash`, `onHit`, `onDamage`).
//
//   const car = api.addVehicle({ id: 'mine', body: 'sedan', color: '#c03030', x: 10, y: 6, dir: 'right' });
//   api.board(car); api.unboard(); api.driving   // → the vehicle the player is in, or null
//
// Positions: `x, y` on creation are cells (the vehicle is centred on the cell); after that
// `cx, cy` is its centre in map pixels and `angle` its heading (radians, 0 = east, y down).
// The entity box (`x y w h`) is the box around it as it is turned, for whatever treats it
// as any other entity (the player walking into it, api.overlaps).
//
// Driving (on foot, A beside a vehicle gets in): up accelerates, down brakes and then
// reverses, left and right steer, B is the handbrake (it drifts), A gets out once slow.
import { TILE, canvas, snap, mix, shade, tint, Painter, pixels } from './gfx.js';
import { sfx, motor } from './audio.js';
import { propStops, mediumOf } from './move.js';

const TAU = Math.PI * 2;
export const ANGLES = 16;
const INK = '#1c1830';
const GLASS = '#7aa8c8';
const GLASS_DARK = '#2c3e5c';

// What each body is: its size (w across, l along) and how it drives. Speeds in map pixels
// a frame; grip: how much of the sideways slide is lost each frame (1 = on rails).
export const BODIES = {
  sedan: { w: 12, l: 22, accel: 0.06, max: 3.2, reverse: 1.2, brake: 0.14, grip: 0.82, turn: 0.055, mass: 1, hp: 100, seats: 4 },
  compact: { w: 11, l: 18, accel: 0.07, max: 3, reverse: 1.2, brake: 0.14, grip: 0.85, turn: 0.065, mass: 0.8, hp: 80, seats: 4 },
  sports: { w: 12, l: 21, accel: 0.09, max: 4.2, reverse: 1.3, brake: 0.16, grip: 0.8, turn: 0.06, mass: 0.9, hp: 90, seats: 2 },
  taxi: { livery: true, w: 12, l: 22, accel: 0.06, max: 3.2, reverse: 1.2, brake: 0.14, grip: 0.82, turn: 0.055, mass: 1, hp: 100, seats: 4 },
  police: { w: 12, l: 23, accel: 0.075, max: 3.8, reverse: 1.3, brake: 0.16, grip: 0.84, turn: 0.06, mass: 1.1, hp: 140, siren: true, livery: true, seats: 4 },
  van: { w: 13, l: 24, accel: 0.045, max: 2.6, reverse: 1, brake: 0.12, grip: 0.86, turn: 0.045, mass: 1.6, hp: 140, seats: 8 },
  truck: { w: 14, l: 32, accel: 0.035, max: 2.3, reverse: 0.9, brake: 0.1, grip: 0.9, turn: 0.038, mass: 3, hp: 220, seats: 2 },
  // of other times and other ground: drawn by horses (hooves, no engine), a boat that only
  // goes on water (`water`), a car of the 1920s
  carriage: { w: 12, l: 32, accel: 0.04, max: 2.2, reverse: 0.6, brake: 0.1, grip: 0.92, turn: 0.04, mass: 1.6, hp: 160, seats: 4, sound: 'hooves' },
  cart: { w: 10, l: 24, accel: 0.04, max: 1.9, reverse: 0.6, brake: 0.1, grip: 0.92, turn: 0.05, mass: 1.2, hp: 120, seats: 2, sound: 'hooves' },
  boat: { w: 10, l: 20, accel: 0.03, max: 1.8, reverse: 0.8, brake: 0.04, grip: 0.35, turn: 0.04, mass: 1, hp: 120, seats: 3, water: true, sound: 'oars' },
  vintage: { w: 12, l: 22, accel: 0.045, max: 2.6, reverse: 1, brake: 0.1, grip: 0.84, turn: 0.05, mass: 1.1, hp: 100, seats: 4 },
  bike: { w: 5, l: 14, accel: 0.09, max: 3.6, reverse: 0.6, brake: 0.18, grip: 0.9, turn: 0.075, mass: 0.4, hp: 50, seats: 2 },
};

// ---------- sprites ----------

// A body painted facing north, w × l pixels, in its colour; `state`: 0 whole, 1 dented,
// 2 burnt out; `lit`: the police light bar's phase.
// a horse seen from above, facing north, its legs at stride `f` (0 or 1)
function horse(px, x, y, f, coat) {
  const dark = shade(coat, 0.35);
  px(x, y + 2, 4, 9, INK); px(x + 1, y + 3, 2, 7, coat);
  px(x + 1, y, 2, 3, INK); px(x + 1, y + 1, 2, 1, coat);             // the head
  px(x + 1, y + 3, 2, 2, dark);                                       // the mane
  const a = f ? 1 : 0;
  px(x - 1, y + 3 + a, 1, 2, INK); px(x + 4, y + 4 - a, 1, 2, INK);   // forelegs
  px(x - 1, y + 8 - a, 1, 2, INK); px(x + 4, y + 7 + a, 1, 2, INK);   // hind legs
}

function paintBody(b, color, state, lit, f = 0) {
  const { w, l } = b;
  // a cartridge's own body paints itself, facing north, on a Painter w × l
  if (b.paint) {
    const p = new Painter(w, l);
    b.paint(p, { frame: f, state, lit, color });
    return p.canvas;
  }
  const body = b.look;
  const c = canvas(w, l);
  const g = c.getContext('2d');
  const px = (x, y, w2, h2, col) => { g.fillStyle = col; g.fillRect(x, y, w2, h2); };
  let base = snap(color || (body === 'taxi' ? '#e8c020' : body === 'police' ? '#e8e8f0' : '#c03030'));
  if (state === 2) base = '#3a3436';
  else if (state === 1) base = mix(base, '#4a4040', 0.3);
  const hi = tint(base, 0.3);
  const lo = shade(base, 0.35);
  if (body === 'carriage' || body === 'cart') {
    const coat = state === 2 ? '#3a3436' : '#7a4a2a';
    const two = body === 'carriage';
    // the horses in front, the shafts back to the box
    if (two) { horse(px, 1, 0, f, coat); horse(px, 7, 0, 1 - f, coat); } else horse(px, 3, 0, f, coat);
    px(two ? 3 : 2, 10, 1, 4, '#5a3a20'); px(two ? 8 : 7, 10, 1, 4, '#5a3a20');
    const top = 13;
    // big wheels at the sides
    px(0, top + 2, 1, 6, INK); px(w - 1, top + 2, 1, 6, INK); px(0, l - 8, 1, 6, INK); px(w - 1, l - 8, 1, 6, INK);
    if (two) {
      // a closed box: a dark roof with a gilt rim, the coachman's seat in front
      px(1, top, w - 2, l - top, INK);
      px(2, top + 1, w - 4, 3, '#4a3a2a');
      px(2, top + 4, w - 4, l - top - 5, base); px(2, top + 4, w - 4, 1, '#d8b040'); px(2, l - 2, w - 4, 1, '#d8b040');
      px(3, top + 6, w - 6, l - top - 9, hi);
    } else {
      // an open box of planks with a load of sacks
      px(1, top, w - 2, l - top, INK);
      px(2, top + 1, w - 4, l - top - 2, state === 2 ? '#3a3436' : '#9a6a3a');
      for (let y = top + 3; y < l - 2; y += 3) px(2, y, w - 4, 1, '#7a4a2a');
      px(3, top + 3, 3, 3, '#d8c890'); px(5, top + 6, 3, 3, '#c8b080');
    }
    return c;
  }
  if (body === 'boat') {
    // a pointed hull of planks, two benches, the oars out to the sides
    const hull = state === 2 ? '#3a3436' : '#8a5a30';
    for (let y = 0; y < l; y++) {
      const half = y < 6 ? Math.round(((y + 1) / 6) * (w / 2 - 1)) : y > l - 3 ? w / 2 - 2 : w / 2 - 1;
      px(w / 2 - half - 1, y, (half + 1) * 2, 1, INK);
      if (half > 0) px(w / 2 - half, y, half * 2, 1, y % 4 ? hull : shade(hull, 0.2));
    }
    px(2, 8, w - 4, 2, '#6a4020'); px(2, 14, w - 4, 2, '#6a4020');
    const o = f ? 1 : -1;
    px(0, 9 + o, 2, 1, '#c8a060'); px(w - 2, 9 - o, 2, 1, '#c8a060');
    return c;
  }
  if (body === 'vintage') {
    // a long bonnet, mudguards and running boards, the spare wheel at the back
    px(0, 2, w, l - 4, INK);
    px(1, 3, w - 2, l - 6, base);
    px(0, 3, 1, 5, '#2a2a2a'); px(w - 1, 3, 1, 5, '#2a2a2a'); px(0, l - 8, 1, 5, '#2a2a2a'); px(w - 1, l - 8, 1, 5, '#2a2a2a');
    px(3, 0, w - 6, 3, INK); px(4, 1, w - 8, 2, '#c8c8c8');                  // the radiator
    px(2, 3, w - 4, Math.round(l * 0.35), hi);                               // the bonnet
    px(Math.floor(w / 2), 3, 1, Math.round(l * 0.35), lo);
    px(2, Math.round(l * 0.42), w - 4, 2, state === 2 ? INK : GLASS);
    px(2, Math.round(l * 0.48), w - 4, Math.round(l * 0.38), state === 2 ? '#2a2628' : '#2a2a30');   // the folded top
    px(3, l - 3, w - 6, 3, INK); px(4, l - 2, w - 8, 1, '#4a4a4a');           // the spare wheel
    if (state < 2) { px(1, 0, 2, 2, '#fff6c0'); px(w - 3, 0, 2, 2, '#fff6c0'); }
    return c;
  }
  if (body === 'bike') {
    const m = Math.floor(w / 2);
    px(m - 1, 0, 2, 3, INK); px(m - 1, l - 3, 2, 3, INK);
    px(0, 3, w, l - 6, INK); px(1, 3, w - 2, l - 6, base); px(1, 4, w - 2, 2, hi);
    // the rider, seen from above: a helmet
    px(0, 6, w, 4, INK); px(1, 6, w - 2, 3, state === 2 ? '#3a3436' : '#d8d8d8');
    return c;
  }
  // wheels poke out at the four corners
  const wr = Math.round(l * 0.18);
  px(0, wr - 1, 1, 4, INK); px(w - 1, wr - 1, 1, 4, INK);
  px(0, l - wr - 3, 1, 4, INK); px(w - 1, l - wr - 3, 1, 4, INK);
  // the body, rounded at the corners
  px(1, 0, w - 2, l, INK); px(0, 1, w, l - 2, INK);
  px(1, 1, w - 2, l - 2, base);
  px(1, 1, 1, l - 2, hi); px(w - 2, 1, 1, l - 2, lo);
  const row = (k) => Math.round(l * k);
  if (body === 'truck') {
    // a cab and a box behind it
    px(2, 2, w - 4, row(0.12), hi);
    px(2, row(0.14), w - 4, 2, state === 2 ? INK : GLASS);
    px(1, row(0.3), w - 2, 1, INK);
    px(2, row(0.32), w - 4, l - row(0.32) - 2, state === 2 ? '#2a2628' : mix(base, '#e0e0e0', 0.5));
    for (let y = row(0.36); y < l - 3; y += 3) px(2, y, w - 4, 1, lo);
  } else {
    const van = body === 'van';
    px(2, 1, w - 4, row(0.2), hi);
    px(2, row(van ? 0.16 : 0.26), w - 4, row(0.1), state === 2 ? INK : GLASS);
    px(2, row(van ? 0.16 : 0.26), w - 4, 1, GLASS_DARK);
    const roofTop = row(van ? 0.27 : 0.37);
    const roofEnd = row(van ? 0.92 : 0.66);
    px(2, roofTop, w - 4, roofEnd - roofTop, state === 2 ? '#2a2628' : tint(base, 0.12));
    if (!van) px(2, roofEnd, w - 4, row(0.1), state === 2 ? INK : GLASS_DARK);
    if (body === 'police' && state < 2) {
      const y = roofTop + 2;
      px(2, y, Math.floor((w - 4) / 2), 2, lit ? '#ff3030' : '#801818');
      px(2 + Math.floor((w - 4) / 2), y, Math.ceil((w - 4) / 2), 2, lit ? '#3060ff' : '#182880');
    }
    if (body === 'taxi' && state < 2) px(Math.floor(w / 2) - 1, roofTop + 2, 2, 2, '#fff8c0');
    if (body === 'sports' && state < 2) px(Math.floor(w / 2) - 1, 1, 2, l - 2, tint(base, 0.6));
  }
  if (state < 2) {
    px(1, 0, 2, 1, '#fff6c0'); px(w - 3, 0, 2, 1, '#fff6c0');
    px(1, l - 1, 2, 1, '#e03030'); px(w - 3, l - 1, 2, 1, '#e03030');
  }
  if (state >= 1) { px(3, row(0.5), 1, 1, INK); px(w - 4, row(0.75), 2, 1, INK); }
  return c;
}

// The same body turned to each of the 16 headings, sampled pixel by pixel (no smoothing,
// so it stays pixel art). Index 0 faces east, 4 south, 8 west, 12 north.
// kept with the body they were painted from (the engine's, or a cartridge's)
function frames(body, color, state, lit, f = 0) {
  const key = `${color}|${state}|${lit ? 1 : 0}|${f}`;
  const cache = (body.sprites ||= new Map());
  let set = cache.get(key);
  if (set) return set;
  const src = paintBody(body, color, state, lit, f);
  const sw = src.width;
  const sh = src.height;
  const data = pixels(src).data;
  const size = Math.ceil(Math.hypot(sw, sh)) + 2;
  set = [];
  for (let i = 0; i < ANGLES; i++) {
    // the painted body faces north: turn it by the heading plus a quarter
    const phi = (i / ANGLES) * TAU + Math.PI / 2;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const out = canvas(size, size);
    const og = out.getContext('2d');
    const img = og.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - size / 2;
        const dy = y + 0.5 - size / 2;
        const sx = Math.floor(dx * cos + dy * sin + sw / 2);
        const sy = Math.floor(-dx * sin + dy * cos + sh / 2);
        if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
        const k = (sy * sw + sx) * 4;
        if (!data[k + 3]) continue;
        const o = (y * size + x) * 4;
        img.data[o] = data[k]; img.data[o + 1] = data[k + 1]; img.data[o + 2] = data[k + 2]; img.data[o + 3] = 255;
      }
    }
    og.putImageData(img, 0, 0);
    // its shadow: the same shape, black and see-through
    const sh2 = canvas(size, size);
    const sg = sh2.getContext('2d');
    sg.drawImage(out, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = 'rgba(0,0,0,0.28)';
    sg.fillRect(0, 0, size, size);
    out.shadow = sh2;
    set.push(out);
  }
  cache.set(key, set);
  return set;
}

// A body by name: the cartridge's own (game.vehicles; `base` borrows an engine body's
// look and tuning to change only some of it), or the engine's. The same object each time
// for a game, so its sprites are painted once.
const bodies = new WeakMap();
export function bodyOf(game, name) {
  let m = bodies.get(game || bodies);
  if (!m) bodies.set(game || bodies, (m = new Map()));
  if (m.has(name)) return m.get(name);
  const own = game?.vehicles?.[name];
  const base = BODIES[own?.base || name];
  let b = null;
  if (own) b = { ...(base || BODIES.sedan), sound: own.paint && !base ? undefined : base?.sound, ...own, look: own.paint ? null : own.base || 'sedan', name };
  else if (base) b = { ...base, look: name, name };
  b && (b.on ||= b.water ? 'water' : 'land');
  m.set(name, b);
  return b;
}

export const angleIndex = (a) => ((Math.round((a / TAU) * ANGLES) % ANGLES) + ANGLES) % ANGLES;
const DIR_ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
export const angleOf = (dir) => (typeof dir === 'number' ? dir : DIR_ANGLE[dir] ?? 0);
// the four-way direction nearest a heading (for the player getting out, the guide)
export const dirOf = (a) => ['right', 'down', 'left', 'up'][((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4];
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- the vehicle ----------

export class Vehicle {
  constructor(def, world) {
    let body = bodyOf(world.game, def.body || 'sedan');
    if (!body) {
      world.lint?.(`vehicle:${def.body}`, `no vehicle body named ${def.body}: the engine has ${Object.keys(BODIES).join(' ')}; a cartridge adds its own in game.vehicles. Drawn as a sedan.`);
      body = bodyOf(world.game, 'sedan');
    }
    this.bodyDef = body;
    const spec = { ...body, ...def.spec };
    this.kind = 'vehicle';
    this.id = def.id ?? null;
    this.world = world;
    this.body = body.name;
    this.color = def.color || null;
    this.spec = spec;
    this.cx = def.cx ?? (def.x ?? 0) * TILE + TILE / 2;
    this.cy = def.cy ?? (def.y ?? 0) * TILE + TILE / 2;
    this.angle = angleOf(def.angle ?? def.dir ?? 0);
    this.vx = 0;
    this.vy = 0;
    this.hp = def.hp ?? spec.hp;
    this.maxHp = spec.hp;
    this.grounded = true;     // solid to whoever walks into it (not while it flies over them)
    this.driver = null;          // 'player', 'ai' (traffic, a chase) or null (parked)
    this.ai = def.ai || null;
    this.keep = !!def.keep;      // kept in the save where it was left (README "A world that remembers")
    this.locked = !!def.locked;  // canBoard is asked anyway; this is the engine's own "no"
    this.siren = !!def.siren;
    this.wreck = false;
    this.skid = 0;
    this.mapId = world.mapId;
    this.always = !!def.always || this.keep;
    this.blip = def.blip;
    this.data = def.data || {};
  }

  // the box around it as it is turned: what other entities and the player collide with
  get hw() { return (Math.abs(Math.cos(this.angle)) * this.spec.l + Math.abs(Math.sin(this.angle)) * this.spec.w) / 2; }
  get hh() { return (Math.abs(Math.sin(this.angle)) * this.spec.l + Math.abs(Math.cos(this.angle)) * this.spec.w) / 2; }
  get x() { return this.cx - this.hw; }
  set x(v) { this.cx = v + this.hw; }
  get y() { return this.cy - this.hh; }
  set y(v) { this.cy = v + this.hh; }
  get w() { return this.hw * 2; }
  get h() { return this.hh * 2; }
  // effects (vfx `point`) read px, py as map pixels
  get px() { return this.cx; }
  get py() { return this.cy; }
  get speed() { return Math.hypot(this.vx, this.vy); }
  // speed along the heading: negative when reversing
  get forward() { return this.vx * Math.cos(this.angle) + this.vy * Math.sin(this.angle); }
  get solid() { return this.grounded && this.altitude < 4; }
  set solid(v) { this.grounded = v; }
  // what flies is drawn over everything on the ground
  get z() { return this.cy + this.hh + (this.spec.on === 'air' ? 1e5 : 0); }
  // how high it flies now: its full height once going (`takeoff`), always otherwise
  get altitude() {
    const h = this.spec.on === 'air' ? this.spec.height ?? 24 : 0;
    return h && this.spec.takeoff ? h * Math.min(1, this.speed / (this.spec.max * 0.5)) : h;
  }

  // Two circles along its length: how it touches other vehicles and people.
  circles() {
    const r = this.spec.w / 2 + 0.5;
    const d = Math.max(0, this.spec.l / 2 - r);
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return d ? [[this.cx + c * d, this.cy + s * d, r], [this.cx - c * d, this.cy - s * d, r]] : [[this.cx, this.cy, r]];
  }

  // Corners and the middle of each side, where the map is checked.
  samples(cx = this.cx, cy = this.cy, a = this.angle) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const hl = this.spec.l / 2 - 0.5;
    const hw = this.spec.w / 2 - 0.5;
    const out = [];
    for (const [u, v] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [hl, 0], [-hl, 0], [0, hw], [0, -hw]]) out.push([cx + c * u - s * v, cy + s * u + c * v]);
    return out;
  }

  blockedAt(cx, cy, a) {
    const w = this.world;
    for (const [x, y] of this.samples(cx, cy, a)) if (cellStops(w, Math.floor(x / TILE), Math.floor(y / TILE), this)) return true;
    return false;
  }

  // One frame of driving: throttle -1..1 (negative brakes, then reverses), steer -1..1,
  // handbrake. Moves it against the map and reports a crash.
  drive(throttle, steer, handbrake = false) {
    const s = this.spec;
    if (this.wreck) { throttle = 0; steer = 0; handbrake = true; }
    let c = Math.cos(this.angle);
    let sn = Math.sin(this.angle);
    let vf = this.vx * c + this.vy * sn;
    let vr = -this.vx * sn + this.vy * c;
    const ground = this.groundHere();
    const max = s.max * (ground.max ?? 1) * (this.hp < s.hp * 0.25 ? 0.7 : 1);
    if (throttle > 0) vf += vf < -0.05 ? s.brake : s.accel * throttle;
    else if (throttle < 0) vf -= vf > 0.05 ? s.brake : s.accel * 0.6 * -throttle;
    else vf *= 0.985;
    if (handbrake) vf *= 0.97;
    if (Math.abs(vf) < 0.02 && !throttle) vf = 0;
    vf = Math.max(-s.reverse, Math.min(max, vf));
    const grip = handbrake ? 0.04 : s.grip * (ground.grip ?? 1);
    const slide = Math.abs(vr);
    vr *= 1 - grip;
    // steering bites with speed, and turns the other way in reverse
    const bite = Math.min(1, Math.abs(vf) / 1.2) * Math.sign(vf);
    const turn = steer * s.turn * bite * (handbrake ? 1.5 : 1);
    if (turn) {
      const na = this.angle + turn;
      if (!this.blockedAt(this.cx, this.cy, na)) this.angle = wrapAngle(na);
    }
    c = Math.cos(this.angle);
    sn = Math.sin(this.angle);
    this.vx = c * vf - sn * vr;
    this.vy = sn * vf + c * vr;
    this.skid = slide > 0.7 || (handbrake && Math.abs(vf) > 1.2) ? this.skid + 1 : 0;
    return this.step();
  }

  // A vehicle no one drives keeps rolling and slows down.
  coast() {
    if (!this.vx && !this.vy) return null;
    this.vx *= 0.94;
    this.vy *= 0.94;
    if (Math.abs(this.vx) < 0.02 && Math.abs(this.vy) < 0.02) { this.vx = 0; this.vy = 0; }
    return this.step();
  }

  // Moves by its velocity, an axis at a time, bouncing off what stops it. → the speed
  // lost against the map (0 when nothing was hit).
  step() {
    this.odo = (this.odo || 0) + this.speed;
    let hit = 0;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(this.vx), Math.abs(this.vy))));
    for (let i = 0; i < n; i++) {
      const nx = this.cx + this.vx / n;
      if (this.blockedAt(nx, this.cy, this.angle)) { hit = Math.max(hit, Math.abs(this.vx)); this.vx *= -0.25; } else this.cx = nx;
      const ny = this.cy + this.vy / n;
      if (this.blockedAt(this.cx, ny, this.angle)) { hit = Math.max(hit, Math.abs(this.vy)); this.vy *= -0.25; } else this.cy = ny;
    }
    return hit;
  }

  // The ground under it: a tile's `drive: { max, grip }` (grass slows, ice slides).
  groundHere() {
    const w = this.world;
    const id = w.tileAt(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE));
    return (id && w.game.tiles[id]?.drive) || {};
  }

  // Headlights, while someone is at the wheel: two lights ahead of it (they show where
  // it is dark: a map's `dark`, the clock's night).
  lights() {
    if (this.wreck || !this.driver) return [];
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const ahead = this.spec.l / 2 + 13;
    const side = this.spec.w / 2 - 2;
    return [1, -1].map((k) => ({ r: 15, color: '#fff0c0', glow: 0.12, x: this.cx + c * ahead - s * side * k, y: this.cy + s * ahead + c * side * k }));
  }

  state() { return this.wreck ? 2 : this.hp < this.maxHp * 0.5 ? 1 : 0; }

  image(frame) {
    const lit = this.siren && Math.floor(frame / 8) % 2 === 0;
    // horses trot and oars row while it moves: two frames by the distance gone
    // what flies keeps beating its wings or turning its blades, even hovering
    const n = this.spec.frames ?? (this.spec.sound ? 2 : 1);
    const f = n > 1 ? (this.spec.on === 'air' ? Math.floor(frame / 6) : Math.floor((this.odo || 0) / 7)) % n : 0;
    return frames(this.bodyDef, this.color, this.state(), this.spec.siren && this.siren ? lit : false, f)[angleIndex(this.angle)];
  }

  // The engine draws it as an entity: the box's top-left on screen comes in.
  draw(ctx, sx, sy, e) {
    const img = this.image(e.frame);
    const ox = Math.round(sx + this.hw - img.width / 2);
    const oy = Math.round(sy + this.hh - img.height / 2);
    // the shadow on the ground (further down and right the higher it flies), the body over it
    const up = Math.round(this.altitude);
    ctx.drawImage(img.shadow, ox + 1 + Math.round(up / 3), oy + 2);
    ctx.drawImage(img, ox, oy - up);
  }
}

// Does this cell stop a vehicle? The map's own rules first (canEnter hooks, solid tiles,
// water, props); a tile may say `drive: false` (stairs, a fountain's rim) on its own.
export function cellStops(world, x, y, v) {
  const inside = x >= 0 && y >= 0 && x < world.w && y < world.h;
  if (!inside) return !(world.driving === v && world.neighbourAt(x, y));
  const id = world.tileAt(x, y);
  if (!id) return true;
  const d = world.game.tiles[id];
  // the cartridge's rule first (`canDrive` on the tile, the map or the game): false stops,
  // true lets through, undefined leaves it to the vehicle's ground
  for (const fn of [d.canDrive, world.map.canDrive, world.game.canDrive]) {
    if (typeof fn !== 'function') continue;
    const r = fn(world.api, { x, y, tile: id, def: d, vehicle: v });
    if (r !== undefined) return !r;
  }
  if (d.drive === false) return true;
  // what flies goes over everything; a boat keeps to the water; the rest to the land
  if (v.spec.on === 'air') return d.fly === false;
  if (v.spec.on === 'water') return !(mediumOf(d)?.water || d.boat) || propStops(world, world.propAt(x, y), v);
  return world.solidAt(x, y, v);
}

// ---------- the player at the wheel ----------

// The vehicle the player could get into from where they stand: the nearest within reach.
export function boardable(world) {
  const p = world.player;
  if (!p || world.driving) return null;
  const b = world.box(p);
  const fx = b.x + b.w / 2;
  const fy = b.y + b.h / 2;
  let best = null;
  let bestD = 22;
  for (const en of world.entities) {
    if (en.kind !== 'vehicle' || en.removed || en.wreck) continue;
    const d = Math.hypot(en.cx - fx, en.cy - fy) - en.spec.w / 2;
    if (d < bestD) { best = en; bestD = d; }
  }
  return best;
}

// Asks map then game for a value (not a script): the first answer that isn't undefined.
export function ask(world, name, info) {
  for (const fn of [world.map?.[name], world.game[name]]) {
    if (typeof fn !== 'function') continue;
    const v = fn(world.api, info);
    if (v !== undefined) return v;
  }
  return undefined;
}

export function board(world, v) {
  const p = world.player;
  if (!v || v.wreck || world.driving) return false;
  if (v.locked) { sfx('bump'); return false; }
  if (ask(world, 'canBoard', { vehicle: v }) === false) return false;
  // someone at the wheel is pulled out and runs (engine/traffic.js puts them on the street)
  if (v.driver === 'ai') world.city?.evict(v);
  v.driver = 'player';
  v.ai = null;
  v.always = true;
  v.mapId = world.mapId;
  world.driving = v;
  p.visible = false;
  p.solid = false;
  p.strolling = false;
  world.save.driving = v.id ?? true;
  seatParty(world, v);
  sfx('door');
  return true;
}

// Companions (game.party) get in with the player, as many as there are seats; whoever is
// too far away or finds no seat waits where they stand until the player is on foot again.
export function seatParty(world, v) {
  const p = world.player;
  let free = Math.max(0, (v.spec.seats ?? 4) - 1);
  const party = world.actors.filter((a) => a.party).sort((a, b) => a.party - b.party);
  for (const a of party) {
    const near = Math.abs(a.x - p.x) + Math.abs(a.y - p.y) <= 4;
    if (near && free > 0) {
      free--;
      a.riding = v;
      a.waiting = false;
      a.visible = false;
      a.moving = null;
      a.catching = false;
    } else a.waiting = true;
  }
  world.riders = new Set(party.filter((a) => a.riding).map((a) => a.id));
}

// Out of the vehicle, the riders step out round the player; whoever waited catches up.
function unseatParty(world) {
  const p = world.player;
  const trail = [];
  for (const a of world.actors) {
    if (!a.party) continue;
    a.waiting = false;
    if (!a.riding) continue;
    a.riding = null;
    const at = world.freeNear(p.x, p.y, a) || { x: p.x, y: p.y };
    // not on the player's own cell, nor on a companion who already got out
    let spot = at;
    if (spot.x === p.x && spot.y === p.y) spot = world.freeNear(p.x + 1, p.y, a) || at;
    a.x = spot.x; a.y = spot.y;
    a.px = spot.x * TILE; a.py = spot.y * TILE;
    a.dir = p.dir;
    a.visible = true;
    trail.unshift({ x: spot.x, y: spot.y });
  }
  trail.push({ x: p.x, y: p.y });
  world.trail = trail;
  world.riders = null;
}

export function unboard(world, { force = false } = {}) {
  const v = world.driving;
  if (!v) return false;
  if (!force && v.speed > 0.9) return false;
  const p = world.player;
  // out on the driver's side (the left of the heading), or wherever there's room
  const c = Math.cos(v.angle);
  const s = Math.sin(v.angle);
  const side = (sgn) => [v.cx + s * sgn * (v.spec.w / 2 + 7), v.cy - c * sgn * (v.spec.w / 2 + 7)];
  let spot = null;
  for (const sgn of [1, -1]) {
    const [x, y] = side(sgn);
    const cx = Math.floor(x / TILE);
    const cy = Math.floor(y / TILE);
    if (!world.blocked(cx, cy, p)) { spot = { x: cx, y: cy, px: x - 8, py: y - 12 }; break; }
  }
  if (!spot) {
    const f = world.freeNear(Math.floor(v.cx / TILE), Math.floor(v.cy / TILE), p);
    if (!f) return false;
    spot = { x: f.x, y: f.y, px: f.x * TILE, py: f.y * TILE };
  }
  p.x = spot.x;
  p.y = spot.y;
  // in grid movement people stand on cells; in free movement wherever they got out
  p.px = world.free ? Math.round(spot.px) : spot.x * TILE;
  p.py = world.free ? Math.round(spot.py) : spot.y * TILE;
  if (world.free && world.boxBlocked(world.box(p), p)) { p.px = spot.x * TILE; p.py = spot.y * TILE; }
  p.dir = dirOf(v.angle + Math.PI / 2);
  p.visible = true;
  p.solid = true;
  p.moving = null;
  unseatParty(world);
  v.driver = null;
  v.always = v.keep;
  world.driving = null;
  world.lead = { x: 0, y: 0 };
  delete world.save.driving;
  motor(0);
  sfx('door');
  return true;
}

// Every frame the player drives: the pad becomes the wheel and the pedals.
export function driveTick(world, e, inp) {
  const v = world.driving;
  const p = world.player;
  if (v.removed) { unboard(world, { force: true }); return; }
  // a new map (a connection, a warp): the vehicle came along, where the player now is
  if (v.mapId !== world.mapId) {
    v.mapId = world.mapId;
    v.cx = p.px + 8;
    v.cy = p.py + 8;
    if (!world.entities.includes(v)) world.entities.push(v);
  }
  // A gets out: at once when slow, otherwise it brakes to a stop first
  if (inp.pressed('a')) { if (unboard(world)) return; v.exiting = true; }
  let throttle;
  let steer;
  const controls = world.map.drive?.controls ?? world.game.drive?.controls ?? 'compass';
  if (controls === 'tank') {
    // up accelerates, down brakes and reverses, left and right turn the wheel
    throttle = (inp.held('up') ? 1 : 0) - (inp.held('down') ? 1 : 0);
    steer = (inp.held('right') ? 1 : 0) - (inp.held('left') ? 1 : 0);
  } else {
    // the compass: the pad says where to go, the vehicle turns that way and goes; nothing
    // held, it slows down; the way back, it brakes and turns round
    const { x: dx, y: dy } = inp.stick;   // at any angle the pad says
    throttle = 0;
    steer = 0;
    if (dx || dy) {
      const diff = wrapAngle(Math.atan2(dy, dx) - v.angle);
      steer = Math.max(-1, Math.min(1, diff * 2.5));
      if (Math.abs(diff) < 2.3) throttle = 1;
      else if (v.forward > 0.4) { throttle = -1; steer = 0; }
      // too slow to turn: back up turning the other way, a three-point turn
      else { throttle = -1; steer = -Math.sign(diff); }
    } else if (v.speed > 0.05) { v.vx *= 0.97; v.vy *= 0.97; }
    // nose against a wall: it backs out turning the other way, by itself
    if (v.backing > 0) { v.backing--; throttle = -1; steer = -steer || 0; }
    else if (throttle > 0 && v.speed < 0.15) { if (++v.stuck > 25) { v.stuck = 0; v.backing = 30; } }
    else v.stuck = 0;
  }
  if (v.exiting) {
    if (throttle) v.exiting = false;
    else if (v.speed <= 0.9) { v.exiting = false; if (unboard(world)) return; } else { throttle = v.forward > 0 ? -1 : 1; steer = 0; }
  }
  const hit = v.drive(throttle, steer, inp.held('b'));
  if (hit > 1.2) crashed(world, v, hit, null);
  if (v.spec.sound === false) motor(0);
  else if (v.spec.sound) {
    // hooves, oars, wings or the cartridge's own effect: a beat that quickens with the speed
    motor(0);
    const every = Math.max(8, Math.round(26 - v.speed * 7));
    const name = { hooves: 'hoof', oars: 'stroke', wings: 'flap' }[v.spec.sound] || v.spec.sound;
    if ((v.speed > 0.15 || v.spec.on === 'air') && e.frame % every === 0) sfx(name, { k: e.frame / every });
  } else motor(Math.min(1, v.speed / v.spec.max), v.spec.hum ?? v.body);
  if (v.skid > 2 && e.frame % 6 === 0) { sfx('skid'); world.city?.mark(v); }
  // the camera looks ahead, further the faster
  const lead = world.map.camera?.lead ?? world.game.camera?.lead ?? 14;
  const tx = Math.max(-56, Math.min(56, v.vx * lead));
  const ty = Math.max(-40, Math.min(40, v.vy * lead));
  world.lead.x += (tx - world.lead.x) * 0.05;
  world.lead.y += (ty - world.lead.y) * 0.05;
  // the player rides inside it: warps, triggers, edges and the camera read their cell
  p.px = v.cx - 8;
  p.py = v.cy - 12;
  p.dir = dirOf(v.angle);
  // the riders go where the vehicle goes (their cells count for whoever looks)
  for (const a of world.actors) if (a.riding === v) { a.px = p.px; a.py = p.py; a.x = p.x; a.y = p.y; }
  const cx = Math.floor(v.cx / TILE);
  const cy = Math.floor(v.cy / TILE);
  if (cx !== p.x || cy !== p.y) { p.x = cx; p.y = cy; world.arrived(); }
}

// A vehicle hit the map or another one hard: the sound, the shake, the damage, the hook.
export function crashed(world, v, speed, other) {
  if (speed > 1.6) sfx('crash', { power: Math.min(1, speed / 4) });
  if (world.driving === v || world.driving === other) world.engine.shake(Math.round(4 + speed * 3), Math.min(3, speed));
  ask(world, 'onCrash', { vehicle: v, other, speed });
  const dmg = Math.max(0, speed - 1.2) * 12 / (v.spec.mass || 1);
  if (dmg > 0) world.city?.damage(v, dmg, other);
}

// The overworld: tile maps seen from above at three quarters, actors that walk the
// grid, and the story API scripts use to drive everything (see README, "Scripts").
import { SCREEN_W, SCREEN_H, BASE_W, BASE_H, setView, TILE, Painter, canvas, hex, mix } from './gfx.js';
import { doll as makeDoll } from './doll.js';
import { Dialog, Choice, Card, Menu, List, Log, Credits, textSpeed, setTextSpeed, speakerName, banner as showBanner, frame, getTheme, stripMarkup } from './ui.js';
import { drawText, measure } from './font.js';
import { music, sfx, hasSfx, ambience, isMuted, setMuted, musicLayer, room, setSpots, mixSpots, rumble, canRumble, rumbleOn, setRumble, realOn, setReal, hasOrchestra } from './audio.js';
import { t, tv, has } from './i18n.js';
import { isFull, setFull, isWeb } from './shell.js';
import { Stage } from './stage.js';
import { changed } from './host.js';
import { reportProblem } from './report.js';
import { resolveWeather, drawWeather, drawDark, gatherLights } from './weather.js';
import { hdSupported, hdOn, setHd, hdOverhead, setHdOverhead } from './hd.js';
import { regionOf, stairLift } from './diorama.js';
import { goalOf, drawGuide, audit, guideOn, setGuide, pressFrom, rectCells } from './guide.js';
import { placeParty, tickParty, tickLife, hushLife, bark, drawBarks, bumped, routeStop, canMakeWay, makeWay, pushInto, tickWay } from './company.js';
import { Effects, EASE } from './vfx.js';
import { Mode7 } from './mode7.js';
import { Raycaster, headingOf, dirOf, forward, viewChoice, setViewChoice, nextView, thirdCamera, setThirdCamera, THIRD_STEPS, asView } from './thirdperson.js';
import { City } from './city.js';
import { board, unboard, boardable, driveTick } from './vehicle.js';
import { seek, clearLine, centreOf, shoot } from './pursuit.js';
import { MapScreen } from './minimap.js';
import { startMission, failMission, passMission } from './mission.js';
import { tickClock, clockInfo, setClock, clockLabel, clockGrade, clockDark, drawClock, isNight } from './clock.js';
import { useMedia, can, groundStops, propStops, modeOf, tickModes, stepSpeed, stepSound, afterStep, slideOn, diveHere, diveScript, drawBreath, modeImage, liftOf, drawInMode } from './move.js';

export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const SHORT = { u: 'up', d: 'down', l: 'left', r: 'right' };

// ---------- tiles and props ----------

export class Tileset {
  constructor(defs) {
    this.defs = defs;
    this.cache = new Map();
  }

  def(id) {
    const d = this.defs[id];
    if (!d) throw new Error(`unknown tile: ${id}`);
    return d;
  }

  // Image of a tile or prop for an animation frame; painted once, then cached. Autotiles
  // (`auto`) get one image per neighbour mask too: draw(p, frame, mask).
  image(id, frame = 0, mask = 0) {
    const d = this.def(id);
    const f = d.frames ? frame % d.frames : 0;
    const key = d.auto ? `${id}#${f}#${mask}` : `${id}#${f}`;
    let img = this.cache.get(key);
    if (!img) {
      const [w, h] = d.size || [1, 1];
      const p = new Painter(w * TILE, h * TILE, d.seed ?? hashSeed(id));
      p.frame = f;
      d.draw(p, f, mask);
      img = p.canvas;
      this.cache.set(key, img);
    }
    return img;
  }

  // The layer a tile paints over whoever stands on it (tall grass, a roof's edge).
  top(id, frame = 0) {
    const d = this.def(id);
    if (!d.top) return null;
    const f = d.frames ? frame % d.frames : 0;
    const key = `${id}#top#${f}`;
    let img = this.cache.get(key);
    if (!img) {
      const p = new Painter(TILE, TILE, (d.seed ?? hashSeed(id)) + 1);
      p.frame = f;
      d.top(p, f);
      img = p.canvas;
      this.cache.set(key, img);
    }
    return img;
  }

  // The face a raised tile shows below its top, `h` pixels tall (README "Heights"): the
  // tile's own `side(p, frame, h)`, or its bottom row carried down and shaded, with a
  // seam at every level.
  side(id, frame, h, level) {
    const d = this.def(id);
    const f = d.frames ? frame % d.frames : 0;
    const key = `${id}#side#${f}#${h}`;
    let img = this.cache.get(key);
    if (!img) {
      if (d.side) {
        const p = new Painter(TILE, h, (d.seed ?? hashSeed(id)) + 2);
        p.frame = f;
        d.side(p, f, h);
        img = p.canvas;
      } else {
        img = canvas(TILE, h);
        const c = img.getContext('2d');
        c.drawImage(this.image(id, f), 0, TILE - 1, TILE, 1, 0, 0, TILE, h);
        c.fillStyle = 'rgba(0,0,0,0.34)';
        c.fillRect(0, 0, TILE, h);
        c.fillStyle = 'rgba(255,255,255,0.16)';
        c.fillRect(0, 0, TILE, 1);
        c.fillStyle = 'rgba(0,0,0,0.16)';
        for (let y = level; y < h; y += level) c.fillRect(0, y, TILE, 1);
        c.fillStyle = 'rgba(0,0,0,0.3)';
        c.fillRect(0, h - 1, TILE, 1);
      }
      this.cache.set(key, img);
    }
    return img;
  }
}

function hashSeed(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ---------- actors ----------

export class Actor {
  constructor(def, world) {
    this.id = def.id;
    this.world = world;
    this.def = def;
    this.x = def.x;
    this.y = def.y;
    this.px = def.x * TILE;
    this.py = def.y * TILE;
    this.dir = def.dir || 'down';
    this.heading = headingOf(this.dir);   // radians, for the view from the ground: up is 0, right π/2
    this.visible = def.visible !== false;
    this.solid = def.solid !== false;
    this.speed = def.speed ?? 1;
    this.moving = null;     // { tx, ty, resolve }
    this.stepCount = 0;
    this.anim = 0;
    this.emote = null;
    this.setLook(def.doll, def.sprite);
    this.home = { x: def.x, y: def.y };
    this.idle = 60 + Math.floor(Math.random() * 120);
    this.act = def.pose || null;   // a pose beyond walking: sit, kneel, lie, sleep, reach, cheer
    this.ox = 0;            // a nudge off the cell, in pixels (two people hugging)
    this.oy = 0;
    this.blinkAt = Math.floor(Math.random() * 200);
    this.alpha = def.alpha ?? 1;   // see-through, 0..1 (api.appear, api.animate)
    this.tint = null;       // { color, k }: a colour over the body (api.tintActor)
    this.trail = null;      // { color, life, still }: afterimages (api.trail)
    this.leg = 0;           // the next point of a route
    this.gone = false;      // dropped from the map: pending walks give up
    this.walks = 0;         // bumped to cancel the walk in progress
  }

  // Left the map (map change, despawn): whatever was walking it resolves false, now,
  // instead of waiting forever for a frame that will never update this actor.
  drop() {
    this.gone = true;
    if (this.moving) { const { resolve } = this.moving; this.moving = null; resolve(false); }
  }

  // A route the actor walks by itself: { path: [[x, y], ...], back, pause, once } or the
  // path alone; a function of the api picks it from the story.
  get route() {
    let r = this.def.route;
    if (typeof r === 'function') r = r(this.world.api);
    if (!r) return null;
    return Array.isArray(r) ? { path: r } : r;
  }

  setLook(dollId, sprite) {
    this.sprite = sprite || null;
    if (dollId) this.dollId = dollId;
    if (!sprite && this.dollId) this.doll = this.world.doll(this.dollId);
  }

  get busy() { return !!this.moving; }

  // How far above its cell's flat place it is drawn, in pixels: the height of the ground
  // under it (README "Heights"), eased from one cell to the next while it walks.
  get ez() { return this.world.ezOf(this); }

  face(dir) { this.dir = SHORT[dir] || dir; this.heading = headingOf(this.dir); }

  faceActor(other) {
    const dx = other.x - this.x;
    const dy = other.y - this.y;
    this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    // from the ground the player turns to face them, not just a quarter
    if (this === this.world.player && this.world.thirdPerson) this.heading = Math.atan2(other.px - this.px, -(other.py - this.py));
    else this.heading = headingOf(this.dir);
  }

  // One tile in a direction. Resolves true when arrived, false when blocked.
  step(dir, { force = false, onArrive = null } = {}) {
    dir = SHORT[dir] || dir;
    this.dir = dir;
    const [dx, dy] = DIRS[dir];
    const tx = this.x + dx;
    const ty = this.y + dy;
    if (this.gone || this.jumping) return Promise.resolve(false);
    if (!force && this.world.blocked(tx, ty, this, dir)) return Promise.resolve(false);
    this.act = null;
    this.ox = 0;
    this.oy = 0;
    return new Promise((resolve) => {
      this.moving = { tx, ty, resolve, onArrive };
      this.stepCount++;
    });
  }

  // Jumps `n` tiles in a direction in an arc (ledges, gaps). Does not check the way.
  hop(dir, { n = 2, onArrive = null } = {}) {
    dir = SHORT[dir] || dir;
    this.dir = dir;
    const [dx, dy] = DIRS[dir];
    return new Promise((resolve) => {
      this.moving = { tx: this.x + dx * n, ty: this.y + dy * n, resolve, onArrive, hop: n * TILE, from: [this.px, this.py] };
      this.stepCount++;
    });
  }

  // A jump, for scenes only (no button makes anyone jump): a crouch, an arc through the air
  // in the running "air" frame with the shadow left on the ground, a landing that gives
  // a little, and dust in the ground's colour. In place, or `n` cells in a direction over
  // whatever is between (a fence, a gap, a stream); the landing cell must be free unless
  // `force`. Resolves true when it landed where it was going, false if it couldn't jump.
  //   await a.jump()                       // on the spot
  //   await a.jump('right', { n: 2 })      // over the cell to its right
  //   opts: { n, height: px (12 + 4 a cell), ms, sound: 'hop' | false, dust: true, force }
  async jump(dir = null, { n = 1, height = null, ms = null, sound = 'hop', dust = true, force = false } = {}) {
    const w = this.world;
    const e = w.engine;
    if (this.gone || this.moving || this.jumping) return false;
    dir = dir && (SHORT[dir] || dir);
    if (dir) this.dir = dir;
    const [dx, dy] = dir ? DIRS[dir] : [0, 0];
    const tx = this.x + dx * n;
    const ty = this.y + dy * n;
    if (dir && !force && w.blocked(tx, ty, this, dir)) return false;
    const cells = dir ? n : 0;
    const h = height ?? 12 + cells * 4;
    const frames = Math.max(12, Math.round((ms ?? 380 + cells * 120) / 16.67));
    const run = ++this.walks;
    const keep = this.act;
    this.act = null;
    this.jumping = true;
    // the crouch before it
    this.oy = 1;
    await e.wait(4);
    if (sound) sfx(sound);
    const fx = this.px;
    const fy = this.py;
    for (let i = 1; i <= frames && !this.gone && run === this.walks; i++) {
      const t = i / frames;
      this.oy = 0;
      this.px = fx + (tx * TILE - fx) * t;
      this.py = fy + (ty * TILE - fy) * t;
      this.lift = Math.round(Math.sin(Math.PI * t) * h);
      await e.wait(1);
    }
    this.lift = 0;
    this.jumping = false;
    if (this.gone || run !== this.walks) { this.act = keep; return false; }
    this.x = tx; this.y = ty;
    this.px = tx * TILE; this.py = ty * TILE;
    // the landing gives a little, and kicks up the ground
    if (dust && w.map?.dust !== false && w.game.dust !== false) {
      const d = w.game.tiles[w.tileAt(tx, ty)]?.dust;
      if (d !== false) w.vfx.burst('dust', this, { color: typeof d === 'string' ? [d] : undefined, amount: 0.6, scale: 0.7 });
    }
    this.oy = 1;
    await e.wait(4);
    this.oy = 0;
    this.act = keep;
    return true;
  }

  // Walks a path: "uull3r" (letters, optional counts) or an array of directions.
  async walk(path, opts = {}) {
    const run = ++this.walks;
    for (const d of parsePath(path)) {
      let ok = await this.step(d, opts);
      let tries = 0;
      while (!ok && tries++ < 90 && !this.gone && run === this.walks) { await this.world.engine.wait(1); ok = await this.step(d, opts); }
      if (!ok || run !== this.walks) return false;
    }
    return true;
  }

  // Walks to a tile, planning again around whatever steps in the way (the player, a
  // passer-by). Gives up after 1.5 s without progress, or after `timeout` ms in all; with
  // `place: true` it then stands on the tile anyway, so a cutscene can't freeze on a
  // blocked cell. Resolves true when it got there walking.
  async walkTo(x, y, opts = {}) {
    const run = ++this.walks;
    const e = this.world.engine;
    const until = opts.timeout ? e.frame + opts.timeout / 16.67 : Infinity;
    let stuck = 0;
    while ((this.x !== x || this.y !== y) && !this.gone && run === this.walks && e.frame < until && stuck < 90) {
      const path = this.world.findPath(this, x, y);
      const ok = path?.length ? await this.step(path[0], opts) : false;
      if (ok) stuck = 0;
      else { stuck++; await e.wait(1); }
    }
    const there = this.x === x && this.y === y;
    if (!there && opts.place && !this.gone && run === this.walks) {
      // the cell is taken by someone: the nearest free one, never on top of them
      const taken = this.world.actorAt(x, y, this, true);
      const to = taken ? this.world.freeNear(x, y, this) || { x, y } : { x, y };
      this.place(to.x, to.y);
    }
    return there;
  }

  // Stands on a tile at once (only for cuts, or a blocked cutscene's last resort).
  place(x, y, dir) {
    this.walks++;
    if (this.moving) { const { resolve } = this.moving; this.moving = null; resolve(false); }
    this.x = x; this.y = y;
    this.px = x * TILE; this.py = y * TILE;
    if (dir) this.face(dir);
  }

  update(e) {
    if (this.moving) {
      const tx = this.moving.tx * TILE;
      const ty = this.moving.ty * TILE;
      const sp = this.speed;
      this.px += Math.sign(tx - this.px) * Math.min(sp, Math.abs(tx - this.px));
      this.py += Math.sign(ty - this.py) * Math.min(sp, Math.abs(ty - this.py));
      this.anim += sp;
      const m = this.moving;
      if (m.hop) this.lift = Math.round(Math.sin(Math.PI * Math.min(1, (Math.abs(this.px - m.from[0]) + Math.abs(this.py - m.from[1])) / m.hop)) * 10);
      if (this.px === tx && this.py === ty) {
        this.lift = 0;
        this.x = this.moving.tx;
        this.y = this.moving.ty;
        const { resolve, onArrive } = this.moving;
        this.moving = null;
        resolve(true);
        onArrive?.();
      }
    } else if (!this.strolling) {
      this.anim = 0;
    }
    if (this.emote && e.frame > this.emote.until) this.emote = null;
  }

  // Pose inside the step: first half shows a foot forward, alternating per step.
  pose() {
    if (!this.moving && !this.strolling) return 0;
    const progress = (this.anim % TILE) / TILE;
    if (progress < 0.5 || this.speed > 1.5) return this.stepCount % 2 ? 1 : 2;
    return 0;
  }

  image() {
    // in third person the camera is behind the player: their back, whichever way they face
    if (this === this.world.player && this.dir !== 'up' && this.world.thirdPerson) {
      const dir = this.dir;
      this.dir = 'up';
      try { return this.image(); } finally { this.dir = dir; }
    }
    // a sprite (a tile id), or one a direction: { down, up, left, right } (down if missing)
    if (this.sprite) return this.world.tiles.image(typeof this.sprite === 'object' ? this.sprite[this.dir] || this.sprite.down : this.sprite, Math.floor(this.world.engine.frame / 12));
    if (!this.doll) return null;
    // in the air (a jump): the running stride with both feet off the ground
    if (this.jumping && this.lift > 2) return this.doll.run?.[this.dir]?.[1] || this.doll.frames[this.dir][1];
    // swimming, diving, flying, climbing, sliding on ice (engine/move.js)
    if ((this.mode && this.mode !== 'walk') || this.sliding) {
      const m = modeImage(this.world, this);
      if (m) return m;
    }
    // lying on a bed drawn upright: tucked in along it, not across it
    if ((this.act === 'lie' || this.act === 'sleep') && this.doll.poses?.lieBed && this.uprightBed()) return this.doll.poses[this.act + 'Bed'];
    const posed = this.act && this.doll.poses?.[this.act]?.[this.dir];
    if (posed) return posed;
    // running: stride, in the air, the other stride, in the air — two frames a tile
    if (this.speed > 1.5 && (this.moving || this.strolling) && this.doll.run) {
      const k = Math.floor(this.anim / (TILE / 2)) % 4;
      if (k !== this.runK) {
        this.runK = k;
        if (k === 0 || k === 2) this.world.dust?.(this);
      }
      return this.doll.run[this.dir][[0, 1, 2, 1][k]];
    }
    // standing still, a bee's wings keep beating (frames that loop: engine/creature.js)
    if (this.doll.idle && !this.moving && !this.strolling && !this.act) {
      const loop = this.doll.idle[this.dir];
      return loop[Math.floor((this.world.engine.frame + this.blinkAt) / 3) % loop.length];
    }
    // standing still, people blink now and then
    if (!this.moving && !this.strolling && !this.act && (this.world.engine.frame + this.blinkAt) % 220 < 7) {
      const shut = this.doll.poses?.blink?.[this.dir];
      if (shut) return shut;
    }
    return this.doll.frames[this.dir][this.pose()];
  }

  // The prop drawn over this cell when it is taller than wide (a bed seen from the foot),
  // or null. Kept per cell: asked every frame while someone lies down.
  uprightBed() {
    const key = `${this.x},${this.y},${this.world.props.length}`;
    if (this.bedKey !== key) {
      this.bedKey = key;
      this.bedProp = this.world.props.find((p) => p.h > p.w && this.x >= p.x && this.x < p.x + p.w && this.y <= p.y && this.y > p.y - p.h) || null;
    }
    return this.bedProp;
  }

  // A pose beyond walking (see engine/doll.js): 'sit', 'kneel', 'lie', 'sleep', 'reach',
  // 'cheer', 'blink', or null to stand. Walking stands them up.
  setPose(name) { this.act = name || null; }

  // Holds a way of getting about until released (null): 'fly' takes off and stays up,
  // whatever the ground. Not saved: restore it from the story's flags in `enter`.
  setMode(name) { this.held = name || null; }

  // Off the cell by a few pixels, until the next step: two people hugging stand closer
  // than two cells allow.
  nudge(dx = 0, dy = 0) { this.ox = dx; this.oy = dy; }

  // A small body gesture, awaited: 'nod' (yes), 'shake' (no), 'hop' (joy, surprise),
  // 'shiver' (cold, fear), 'bow'.
  async gesture(name) {
    const e = this.world.engine;
    const keep = { dir: this.dir, oy: this.oy, ox: this.ox, act: this.act };
    const seq = {
      nod: [[0, 1, 6], [0, 0, 6], [0, 1, 6], [0, 0, 4]],
      bow: [[0, 2, 18], [0, 0, 6]],
      shiver: [[1, 0, 2], [-1, 0, 2], [1, 0, 2], [-1, 0, 2], [1, 0, 2], [-1, 0, 2], [0, 0, 1]],
    }[name];
    if (seq) {
      for (const [dx, dy, n] of seq) { this.ox = keep.ox + dx; this.oy = keep.oy + dy; await e.wait(n); }
    } else if (name === 'hop') {
      for (const h of [3, 5, 6, 5, 3, 0]) { this.lift = h; await e.wait(2); }
    } else if (name === 'shake') {
      const side = this.dir === 'up' || this.dir === 'down' ? ['left', 'right'] : [this.dir, this.dir];
      for (let i = 0; i < 4; i++) { this.dir = side[i % 2]; await e.wait(7); }
    }
    this.dir = keep.dir; this.ox = keep.ox; this.oy = keep.oy; this.act = keep.act;
  }
}

function parsePath(path) {
  if (Array.isArray(path)) return path.map((d) => SHORT[d] || d);
  const out = [];
  const re = /(\d*)([udlr])/g;
  let m;
  while ((m = re.exec(path))) for (let i = 0; i < (Number(m[1]) || 1); i++) out.push(SHORT[m[2]]);
  return out;
}

// ---------- the world scene ----------

const seenKey = (game) => `luma32.${game.id}.seen`;
function loadSeen(game) {
  if (!game.skip) return null;
  try { return new Set(JSON.parse(localStorage.getItem(seenKey(game))) || []); } catch { return new Set(); }
}

// The cells a prop blocks: `foot: [w, h]` from its bottom-left cell, or `[w, h, dx, dy]`
// starting dx cells in from the left and dy up (a trunk in the middle of a wide canopy).
function footCells(p, fn) {
  const [fw, fh, dx = 0, dy = 0] = p.foot;
  for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) fn(p.x + dx + i, p.y - dy - j);
}

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export class World {
  constructor(engine, game, save) {
    this.engine = engine;
    this.game = game;
    this.save = save;
    this.tiles = new Tileset(game.tiles);
    this.dolls = new Map();
    this.actors = [];
    this.player = null;
    this.map = null;
    this.busy = 0;
    this.lent = 0;             // scripts waiting under api.control: the player has the world meanwhile
    this.dark = 0;             // frames the player has had control on a black screen
    this.cam = { x: 0, y: 0, follow: true };
    this.turnDelay = 0;
    this.log = [];          // what has been said this session, for the backlog
    this.scenes = [];       // what a script shows while a pilot plays (show)
    this.seen = loadSeen(game);
    this.linted = new Set();
    this.memory = new Map();   // mapId -> where its people were when the player left
    this.crowds = new Map();   // `${mapId}:${i}` -> { actor, next }: passers-by
    this.still = 0;            // frames the player has stood still (for the A hint)
    this.puffs = [];           // dust kicked up by runners
    this.vfx = new Effects(this);   // particles, emitters, zoom and wave (vfx.js)
    this.city = new City(this);     // vehicles, traffic, the pavement, the minimap (city.js)
    this.driving = null;            // the vehicle the player is in (vehicle.js)
    this.lead = { x: 0, y: 0 };     // how far ahead of the player the camera looks
    this.cam3d = null;              // the modern look's camera turned by a script (api.view3d)
    this.zoomOut = 1;               // under 1: the camera pulled back (a vehicle at speed, api.zoom(0.8))
    this.zoomTo = 1;                // what a script asked for
    this.dev = typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev');
    this.devShow = this.dev;
    if (this.dev) addEventListener('keydown', (ev) => { if (ev.code === 'F2' || ev.code === 'F3') { ev.preventDefault(); this.devKey(ev.code); } });
    this.api = new StoryApi(this);
    useMedia(game.media);
  }

  // ---------- lint ----------

  // What reads fine in code and wrong in play throws nothing: a person popping into view,
  // a spot that answers from a cell away, someone who won't be there next visit. The
  // engine says those in the console, once each (tools/shot.mjs prints the console), so a
  // test run shows them. A cartridge that plays clean prints none.
  lint(key, msg) {
    if (this.linted.has(key)) return;
    this.linted.add(key);
    console.warn(`[luma] ${this.game.id} · ${this.mapId}: ${msg}`);
  }

  // The map is on screen: not faded out, not under an opaque scene.
  showing() {
    const sc = this.engine.scenes;
    const i = sc.indexOf(this);
    return i >= 0 && this.engine.fx.fade < 0.5 && !sc.slice(i + 1).some((s) => s.opaque !== false);
  }

  inView(x, y) {
    const c = this.cam;
    return (x + 1) * TILE > c.x && x * TILE < c.x + this.viewW && (y + 1) * TILE > c.y && (y - 1) * TILE < c.y + this.viewH;
  }

  // How much of the map the camera takes in, in map pixels: the screen, or more of it
  // while pulled back (zoomOut under 1).
  get viewW() { return Math.ceil(BASE_W / this.zoomOut); }
  get viewH() { return Math.ceil(BASE_H / this.zoomOut); }

  // At a door (a warp or the cell next to one): people come and go through doors.
  atDoor(x, y) { return !!this.doorAt(x, y); }

  // Someone appearing or vanishing in plain sight.
  lintPop(a, verb) {
    if (!a.visible || !this.showing() || !this.inView(a.x, a.y) || this.atDoor(a.x, a.y)) return;
    this.lint(`${verb}:${this.mapId}:${a.id}`, `${a.id} ${verb} in view at (${a.x},${a.y}). Bring people in and out walking, from off screen or a door, behind a fade, or out of an effect when the story says they appear by magic (api.appear, api.vanish).`);
  }

  // Leaving a map: anyone here only because a script spawned them, whom the map's own
  // actors don't bring back for the story as it stands, will be missing next visit.
  lintLeaving() {
    if (!this.map) return;
    for (const a of this.actors) {
      if (a === this.player || a.declared || a.def.transient || !a.visible) continue;
      const back = (this.map.actors || []).some((d) => d.id === a.id && (!d.when || d.when(this.api)));
      if (!back) this.lint(`gone:${this.mapId}:${a.id}`, `${a.id} is here only by spawn and won't be here when the player comes back. Declare them in the map's actors with a when that covers this stretch of the story (or spawn with transient: true if they were passing by).`);
    }
  }

  // What a player would get stuck on here, from the data: an objective without a place or
  // out of reach, a spot nobody can press, someone inside a wall, a door into a wall.
  // tools/audit.mjs runs it at every dev jump. Returns the list; prints each as [luma].
  audit() {
    const out = audit(this);
    for (const m of out) this.lint(`audit:${this.mapId}:${m}`, m);
    return out;
  }

  // A locale key that doesn't exist reaches the screen as its raw name ("pili.talk").
  lintKey(key) {
    if (typeof key !== 'string' || !/^[\w-]+(\.[\w-]+)+$/.test(key)) return;
    this.lint(`key:${key}`, `no text for the key "${key}": the player sees the key itself. Add it to the locale.`);
  }

  // Lines read in any play of this cartridge (game.skip): holding B skips them.
  seenLine(id) { return !!(id && this.seen?.has(id)); }
  markSeen(id) {
    if (!id || !this.seen || this.seen.has(id)) return;
    this.seen.add(id);
    try { localStorage.setItem(seenKey(this.game), JSON.stringify([...this.seen])); changed(seenKey(this.game)); } catch { /* full: skipping is a comfort */ }
  }
  remember(speaker, text) {
    this.log.push({ name: speaker ? speakerName(speaker) : '', text: stripMarkup(text) });
    if (this.log.length > 200) this.log.shift();
  }

  doll(id) {
    let d = this.dolls.get(id);
    if (!d) {
      const spec = this.game.dolls[id];
      if (!spec) throw new Error(`unknown doll: ${id}`);
      // a doll already built (a creature, a winged look made by the cartridge) is used as is
      d = spec.frames ? spec : makeDoll(spec);
      this.dolls.set(id, d);
    }
    return d;
  }

  // ---------- loading ----------

  // A map's ground grid and props, ready to query. Used for the current map and for the
  // neighbours seen across its edges.
  parse(mapId) {
    const def = this.game.maps[mapId];
    if (!def) throw new Error(`unknown map: ${mapId}`);
    const rows = def.ground;
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    for (const [ch, id] of Object.entries(def.legend)) if (id && !this.game.tiles[id]) throw new Error(`${mapId}: legend ${ch} -> unknown tile ${id}`);
    const ground = rows.map((r) => [...r.padEnd(w, ' ')].map((ch) => (ch === ' ' ? null : def.legend[ch] ?? null)));
    const props = [];
    const add = (p, src) => {
      if (src?.when && !src.when(this.api)) return;
      props.push(this.makeProp(p, src));
    };
    // props: from the objects grid (char marks the bottom-left cell) and from the list
    (def.objects || []).forEach((row, j) => [...row].forEach((ch, i) => {
      const id = def.objectLegend?.[ch];
      if (id) add({ t: id, x: i, y: j });
    }));
    for (const p of def.props || []) add(p, p);
    const solid = new Map();
    for (const p of props) footCells(p, (x, y) => solid.set(`${x},${y}`, p));
    // heights: one digit a cell, 0 where a row or a cell is missing
    const heights = def.heights ? def.heights.map((r) => [...r].map((ch) => (ch >= '0' && ch <= '9' ? ch.charCodeAt(0) - 48 : 0))) : null;
    return { id: mapId, def, w, h, ground, props, solid, heights };
  }

  // Maps joined edge to edge (open worlds): each connection places a neighbour at an
  // origin in this map's coordinates, so walking off the edge carries on into it.
  //   connections: [{ dir: 'north'|'south'|'east'|'west', map, offset }]
  // offset slides the neighbour along the shared edge, in tiles.
  loadNeighbours() {
    this.neighbours = [];
    for (const c of this.map.connections || []) {
      if (c.when && !c.when(this.api)) continue;
      const n = this.parse(c.map);
      const off = c.offset || 0;
      const o = { north: [off, -n.h], south: [off, this.h], east: [this.w, off], west: [-n.w, off] }[c.dir];
      if (!o) throw new Error(`${this.mapId}: bad connection dir ${c.dir}`);
      n.ox = o[0];
      n.oy = o[1];
      n.dir = c.dir;
      n.actors = (n.def.actors || []).filter((a) => !a.when || a.when(this.api)).map((a) => {
        const actor = new Actor(a, this);
        this.recall(c.map, actor);
        return actor;
      });
      this.neighbours.push(n);
    }
  }

  neighbourAt(x, y) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) return null;
    return this.neighbours.find((n) => x >= n.ox && y >= n.oy && x < n.ox + n.w && y < n.oy + n.h) || null;
  }

  // Where the people of the map being left stand, so coming back in the same session finds
  // them there and not back at their starting cells. Only while their starting cell is
  // the same (if the story moved their home, the new home wins). `remember: false` opts out.
  rememberPlaces() {
    if (!this.map || this.game.memory === false) return;
    const mem = new Map();
    for (const a of this.actors) {
      if (!a.declared || a.def.remember === false || !a.visible) continue;
      mem.set(a.id, { x: a.x, y: a.y, dir: a.dir, hx: a.def.x, hy: a.def.y, leg: a.leg });
    }
    this.memory.set(this.mapId, mem);
  }

  recall(mapId, a) {
    const m = this.memory.get(mapId)?.get(a.id);
    if (!m || m.hx !== a.def.x || m.hy !== a.def.y) return;
    a.x = m.x; a.y = m.y; a.px = m.x * TILE; a.py = m.y * TILE;
    a.dir = m.dir; a.leg = m.leg;
  }

  load(mapId, x, y, dir) {
    if (this.map) this.city.leave();
    this.lintLeaving();
    this.rememberPlaces();
    for (const a of this.actors) if (a !== this.player) a.drop();
    this.vfx.clear();
    const m = this.parse(mapId);
    const def = m.def;
    for (const f of def.fx || []) this.vfx.emit(f.name, f.at ?? [f.x, f.y], f);
    this.map = def;
    this.mapId = mapId;
    this.w = m.w;
    this.h = m.h;
    this.ground = m.ground;
    this.props = m.props;
    this.solidProps = m.solid;
    this.heights = m.heights;
    this.loadNeighbours();
    this.measureHeights();
    // the vehicle the player drives comes along (vehicle.js puts it where they arrive)
    this.entities = this.driving ? [this.driving] : [];
    this.slide = null;
    this.pending = false;
    this.flagsSeen = JSON.stringify(this.save.flags);
    // actors
    const keep = this.player;
    this.actors = [];
    for (const a of def.actors || []) {
      if (a.when && !a.when(this.api)) continue;
      const actor = new Actor(a, this);
      actor.declared = true;
      this.recall(mapId, actor);
      if (!a.talk && a.doll && a.visible !== false) this.lint(`mute:${mapId}:${a.id}`, `${a.id} doesn't answer A: give every person a talk, background people too.`);
      this.actors.push(actor);
    }
    if (keep) {
      keep.x = x; keep.y = y;
      keep.px = x * TILE; keep.py = y * TILE;
      keep.moving = null;
      keep.seenMode = false;
      keep.sliding = false;
      if (dir) keep.face(dir);
      keep.visible = !this.driving;
      this.player = keep;
    } else {
      this.player = new Actor({ id: 'player', doll: this.save.playerDoll || this.game.player, x, y, dir: dir || 'down', speed: 1 }, this);
    }
    this.actors.push(this.player);
    for (const a of this.actors) if (a !== this.player) this.unstack(a);
    placeParty(this, (d) => new Actor(d, this));
    // arriving at the wheel: who rode along is still inside, the rest wait here
    if (this.driving) {
      for (const a of this.actors) {
        if (!a.party) continue;
        if (this.riders?.has(a.id)) { a.riding = this.driving; a.visible = false; } else a.waiting = true;
      }
    }
    this.cam.follow = true;
    this.centerCamera();
    // music and ambience may be chosen by the story: a function of the api
    const tune = typeof def.music === 'function' ? def.music(this.api) : def.music;
    const air = typeof def.ambience === 'function' ? def.ambience(this.api) : def.ambience;
    if (tune !== undefined) music(tune);
    if (air !== undefined) ambience(air, this.game.ambiences?.[air]);
    // how the place rings, and the sounds that sit at its spots
    const rv = def.reverb ?? 0;
    room(typeof rv === 'object' ? rv.mix : rv, typeof rv === 'object' ? rv.size ?? 1.2 : 1.2);
    this.soundSpots = (def.sounds || []).filter((sp) => {
      if (this.game.ambiences?.[sp.ambience]) return true;
      this.lint(`sound:${mapId}:${sp.ambience}`, `sounds: no ambience named ${sp.ambience} in game.ambiences.`);
      return false;
    });
    setSpots(this.soundSpots.map((sp) => ({ build: this.game.ambiences[sp.ambience] })));
    // a new place is a safe point: saved as soon as the player has control again
    if (keep && this.game.autosave !== false) this.autosaveDue = true;
    this.save.map = mapId;
    this.city.enter();
  }

  // ---------- the map follows the story (README "Life on a map") ----------

  // The map chose its people and its props by their `when` on arrival; the story may have
  // moved on since. This brings the map in line with its data as the story stands: whoever
  // the data wants and isn't here walks in from the nearest door (or is put at home where
  // nobody sees), whoever it no longer wants walks out by one (or goes where nobody sees),
  // and someone whose entry changed (another stretch of the story) takes on the new one
  // where they stand. Behind a black screen it all happens at once. Someone a script spawned
  // under the same id counts as here, so nobody is ever doubled. With no door and in plain
  // view they wait until the player looks away. Resolves when every walk has ended.
  refresh() {
    if (!this.map) return Promise.resolve();
    this.refreshProps();
    const now = !this.showing();
    const defs = this.map.actors || [];
    const wanted = new Map();
    for (const d of defs) if (!wanted.has(d.id) && (!d.when || d.when(this.api))) wanted.set(d.id, d);
    const walks = [];
    this.pending = false;
    this.flagsSeen = JSON.stringify(this.save.flags);
    for (const [id, d] of wanted) {
      const a = this.actors.find((x) => x.id === id && x !== this.player);
      if (a) {
        if (a.party || !a.declared || (a.def === d && !a.leavingMap)) continue;
        // walking out and wanted again, or the same person in another entry of the data
        a.leavingMap = false;
        if (a.def !== d) this.recast(a, d);
        if (now || (!this.inView(a.x, a.y) && !this.inView(d.x, d.y))) { a.place(d.x, d.y, d.dir); a.errand = false; continue; }
        walks.push(this.errand(a, d.x, d.y, () => { if (d.dir) a.face(d.dir); if (d.pose) a.setPose(d.pose); }));
        continue;
      }
      const door = !now && this.inView(d.x, d.y) ? this.nearestDoor(d.x, d.y) : null;
      if (!now && this.inView(d.x, d.y) && !door) { this.pending = true; continue; }
      const actor = new Actor(door ? { ...d, x: door.x, y: door.y } : d, this);
      if (door) { actor.def = d; actor.home = { x: d.x, y: d.y }; actor.act = null; }
      actor.declared = true;
      this.actors.splice(this.actors.indexOf(this.player), 0, actor);
      if (!door) { this.unstack(actor); continue; }
      walks.push(this.errand(actor, d.x, d.y, () => { if (d.dir) actor.face(d.dir); if (d.pose) actor.setPose(d.pose); }));
    }
    for (const a of [...this.actors]) {
      if (a === this.player || a.party || !a.declared || a.leavingMap || wanted.has(a.id) || !defs.includes(a.def)) continue;
      const gone = () => { a.drop(); this.actors = this.actors.filter((x) => x !== a); };
      if (now || !this.inView(a.x, a.y)) { gone(); continue; }
      const door = this.nearestDoor(a.x, a.y);
      if (!door) { this.pending = true; continue; }
      a.leavingMap = true;
      walks.push(this.errand(a, door.x, door.y, () => { if (a.leavingMap) gone(); }));
    }
    return Promise.all(walks);
  }

  // Props with `when` in the map's data come and go in place (a door opening, a lamp lit).
  // A prop the cartridge added itself with the same id and kind counts as that one.
  refreshProps() {
    let changed = false;
    for (const p of this.map.props || []) {
      if (!p.when) continue;
      const want = !!p.when(this.api);
      const mine = (q) => q.src === p || (p.id != null && q.id === p.id && q.t === p.t);
      const here = this.props.some(mine);
      if (want && !here) { this.props.push(this.makeProp(p, p)); changed = true; }
      if (!want && here) { this.props = this.props.filter((q) => !mine(q)); changed = true; }
    }
    if (changed) this.rebuildSolid();
  }

  // Someone takes on another entry of the map's data: its look, its talk, its home.
  recast(a, d) {
    const look = d.doll !== a.def.doll || d.sprite !== a.def.sprite;
    a.def = d;
    a.home = { x: d.x, y: d.y };
    a.solid = d.solid !== false;
    a.visible = d.visible !== false;
    a.act = null;
    if (look) a.setLook(d.doll, d.sprite);
  }

  // A walk the map sends someone on by itself (in, out, to a new home): their own life
  // (route, wander) waits until it ends. Whatever happens when they get there runs only if
  // they did: a script that takes them over cancels it.
  errand(a, x, y, then) {
    a.errand = true;
    a.act = null;
    return a.walkTo(x, y, { timeout: 8000, place: true }).then(() => {
      a.errand = false;
      if (a.x === x && a.y === y && !a.gone) then?.();
    });
  }

  // Where people come in and go out near a cell: the nearest warp, or for a door in a wall
  // the free cell in front of it.
  nearestDoor(x, y) {
    const far = (c) => Math.abs(c.x - x) + Math.abs(c.y - y);
    let best = null;
    for (const w of this.map.warps || []) {
      if (w.to === undefined) continue;
      let c = { x: w.x, y: w.y };
      if (this.blocked(c.x, c.y)) {
        c = Object.values(DIRS).map(([dx, dy]) => ({ x: w.x + dx, y: w.y + dy }))
          .filter((n) => n.x >= 0 && n.y >= 0 && n.x < this.w && n.y < this.h && !this.blocked(n.x, n.y))
          .sort((a, b) => far(a) - far(b))[0];
        if (!c) continue;
      }
      if (!best || far(c) < far(best)) best = c;
    }
    return best;
  }

  // `refresh: true` on the game or the map: the map follows the story by itself, after
  // every script and whenever the flags change while the player walks about.
  get autoRefresh() { return (this.map?.refresh ?? this.game.refresh) === true; }

  // Swaps one ground tile (a door opening, a light going out).
  setTile(x, y, id) {
    if (!this.ground[y]) return;
    this.ground[y][x] = id;
    this.groundVersion = (this.groundVersion || 0) + 1;   // the raycaster's floor is drawn again
  }

  // A prop entry ready to draw and query. `src` is the map's own entry, kept so a `when`
  // can take it away again (refreshProps).
  makeProp(p, src = null) {
    const d = this.tiles.def(p.t);
    const [w, h] = d.size || [1, 1];
    const foot = p.foot ?? (d.foot === undefined ? (d.solid === false ? [0, 0] : [w, 1]) : d.foot);
    return { ...p, def: d, w, h, foot, id: p.id, src };
  }

  addProp(p) {
    const prop = this.makeProp(p);
    this.props.push(prop);
    this.rebuildSolid();
    return prop;
  }

  removeProp(id) { this.props = this.props.filter((p) => p.id !== id); this.rebuildSolid(); }

  rebuildSolid() {
    this.solidProps = new Map();
    for (const p of this.props) footCells(p, (x, y) => this.solidProps.set(`${x},${y}`, p));
  }

  // The ground is drawn tile by tile from the visible area each frame, so a map can be any
  // size. Kept for scripts that edit `ground` directly and then call it.
  buildGround() { this.groundVersion = (this.groundVersion || 0) + 1; }

  // ---------- heights (README "Heights") ----------

  // Whether this map or a neighbour has heights at all, how many pixels a level is, and
  // how high the highest cell rises: a map without `heights` never takes another path.
  measureHeights() {
    const grids = [this.heights, ...(this.neighbours || []).map((n) => n.heights)].filter(Boolean);
    this.raised = grids.length > 0;
    this.level = this.map.level ?? this.game.level ?? 8;
    let top = 0;
    for (const g of grids) for (const r of g) for (const h of r) top = Math.max(top, h);
    this.maxElev = top * this.level;
  }

  // How high a cell stands, in levels; 0 where the map says nothing.
  heightAt(x, y) {
    if (!this.raised) return 0;
    const n = this.neighbourAt(x, y);
    if (n) return n.heights?.[y - n.oy]?.[x - n.ox] ?? 0;
    return this.heights?.[y]?.[x] ?? 0;
  }

  // The same in pixels: how far above its flat place the cell is drawn.
  elev(x, y) { return this.raised ? this.heightAt(x, y) * this.level : 0; }

  // A bridge rising, a lift going down: a cell's height from a script.
  setHeight(x, y, h) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.heights ??= Array.from({ length: this.h }, () => new Array(this.w).fill(0));
    this.heights[y] ??= [];
    this.heights[y][x] = h;
    this.measureHeights();
  }

  // An actor's height on screen: its cell's, eased toward the next while it walks or hops.
  ezOf(a) {
    if (!this.raised) return 0;
    const from = this.elev(a.x, a.y);
    const m = a.moving;
    if (!m) return from;
    const to = this.elev(m.tx, m.ty);
    if (to === from) return from;
    const span = (Math.abs(m.tx - a.x) + Math.abs(m.ty - a.y)) * TILE;
    const done = Math.abs(a.px - a.x * TILE) + Math.abs(a.py - a.y * TILE);
    return Math.round(from + (to - from) * Math.min(1, done / span));
  }

  rampAt(x, y) {
    const id = this.tileAt(x, y);
    return !!(id && this.game.tiles[id]?.ramp);
  }

  // Whether one can walk straight from one cell to the next as far as heights go: on the
  // same level, or one level up or down where either cell is a ramp (stairs, a slope).
  climbs(fx, fy, tx, ty) {
    const a = this.heightAt(fx, fy);
    const b = this.heightAt(tx, ty);
    if (a === b) return true;
    return Math.abs(a - b) === 1 && (this.rampAt(fx, fy) || this.rampAt(tx, ty));
  }

  // Off the edge of a higher cell onto a lower one, hopping down, where the map or the
  // game says `drop: true`. There is no way back up but a ramp.
  canDrop(x, y, dir, who) {
    if (!this.raised || !(this.map.drop ?? this.game.drop)) return false;
    if (this.heightAt(x, y) >= this.heightAt(who.x, who.y)) return false;
    return !this.blocked(x, y, who, dir, false);
  }

  // A raised cell, drawn among the props and the people: its top lifted by its height, the
  // face below down to the next cell's top, the shade it casts on its neighbours.
  drawRaised(ctx, id, img, tx, ty, cx, cy, animF) {
    const h = this.heightAt(tx, ty);
    const L = this.level;
    const x = tx * TILE - cx;
    const top = ty * TILE - cy - h * L;
    ctx.drawImage(img, x, top);
    this.shadeWest(ctx, tx, ty, x, top, h);
    const below = this.tileAt(tx, ty + 1) ? this.heightAt(tx, ty + 1) : 0;
    if (below >= h) return;
    const fh = (h - below) * L;
    ctx.drawImage(this.tiles.side(id, animF, fh, L), x, top + TILE);
    // where the face meets the ground below, a soft line of shade
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x, top + TILE + fh, TILE, 2);
  }

  // Light comes from the upper left: a cell lower than the one to its west lies in its shade.
  shadeWest(ctx, tx, ty, x, y, h) {
    const d = this.heightAt(tx - 1, ty) - h;
    if (d <= 0) return;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x, y, Math.min(TILE / 2, 2 + d * 2), TILE);
  }

  // The current map drawn flat, ground and props, nobody on it: a picture for Mode 7.
  // `props: 'flat'` keeps only the ones lying on the ground (rugs, puddles), for scenes
  // that stand the rest up as sprites.
  mapImage(frame = 0, { props: which = 'all' } = {}) {
    const c = canvas(this.w * TILE, this.h * TILE);
    const ctx = c.getContext('2d');
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const id = this.ground[y][x];
        if (!id) continue;
        const d = this.game.tiles[id];
        ctx.drawImage(this.tiles.image(id, frame, d.auto ? this.edgeMask(x, y, d.auto === true ? id : d.auto) : 0), x * TILE, y * TILE);
      }
    }
    const props = this.props.filter((p) => !p.hidden && (which === 'all' || p.def.flat)).sort((a, b) => (a.def.flat ? -1e6 : a.y) - (b.def.flat ? -1e6 : b.y));
    for (const p of props) {
      const img = this.tiles.image(p.t, frame + (p.phase || 0));
      ctx.drawImage(img, p.x * TILE, (p.y + 1) * TILE - img.height);
    }
    return c;
  }

  // A cell's on-screen top-left in world pixels, height included.
  cellTop(x, y) { return { x: x * TILE, y: y * TILE - this.elev(x, y) }; }

  // ---------- queries ----------

  tileAt(x, y) {
    const n = this.neighbourAt(x, y);
    if (n) return n.ground[y - n.oy]?.[x - n.ox] ?? null;
    return this.ground[y]?.[x] ?? null;
  }

  propAt(x, y) {
    const n = this.neighbourAt(x, y);
    if (n) return n.solid.get(`${x - n.ox},${y - n.oy}`) || null;
    return this.solidProps.get(`${x},${y}`) || null;
  }

  // `any`: non-solid people too (a companion who follows the player can be walked
  // through, but still answers A).
  actorAt(x, y, except = null, any = false) {
    return this.actors.find((a) => a !== except && a.visible && (a.solid || any)
      && ((a.x === x && a.y === y) || (a.moving && a.moving.tx === x && a.moving.ty === y))) || null;
  }

  // Someone standing in a cell that `who` can't share. Two bodies never stand in one cell:
  // non-solid people (a dog, a ghost) only let the player through when they are the
  // player's companions, who step aside along the player's trail.
  bodyAt(x, y, who) {
    if (this.ghosts && who === this.player) return null;
    const a = this.actorAt(x, y, who, true);
    if (!a) return null;
    if (a.solid) return a;
    if (who === this.player && a.party) return null;
    return who ? a : null;
  }

  // The free cell nearest to (x, y) for `who`: nobody there, nothing solid.
  freeNear(x, y, who = null) {
    const seen = new Set([`${x},${y}`]);
    const q = [[x, y]];
    while (q.length && seen.size < 600) {
      const [cx, cy] = q.shift();
      if (!this.blocked(cx, cy, who) && !this.actorAt(cx, cy, who, true)) return { x: cx, y: cy };
      for (const [dx, dy] of Object.values(DIRS)) {
        const k = `${cx + dx},${cy + dy}`;
        if (seen.has(k)) continue;
        seen.add(k);
        q.push([cx + dx, cy + dy]);
      }
    }
    return null;
  }

  // Someone set down where another already stands: moved to the nearest free cell, and said.
  unstack(a) {
    const other = this.actors.find((b) => b !== a && b.visible && !b.party && b.x === a.x && b.y === a.y);
    if (!other || !a.visible || a.party) return;
    const to = this.freeNear(a.x, a.y, a);
    if (!to) return;
    this.lint(`stack:${this.mapId}:${a.id}`, `${a.id} was set on ${other.id}'s cell (${a.x},${a.y}): two people never share a cell; moved to (${to.x},${to.y}). Give them their own cell in the data.`);
    a.x = to.x; a.y = to.y; a.px = to.x * TILE; a.py = to.y * TILE;
  }

  // `from`: the cell the step starts at, for heights (README "Heights"); by default the
  // cell behind (x, y) along `dir`. `false` leaves heights out (dropping off an edge).
  blocked(x, y, who = null, dir = null, from = null) {
    const inside = x >= 0 && y >= 0 && x < this.w && y < this.h;
    // only the player crosses into a neighbouring map
    if (!inside && (who !== this.player || !this.neighbourAt(x, y))) return true;
    const id = this.tileAt(x, y);
    if (!id) return true;
    const d = this.game.tiles[id];
    // the cartridge may decide who passes where (water, ledges, locked gates…)
    const rule = this.canEnter(x, y, id, d, who, dir);
    if (rule === false) return true;
    if (rule === true) return !!(this.propAt(x, y) || this.bodyAt(x, y, who));
    // a step up or down a cliff: only by a ramp, or flying
    if (this.raised && from !== false && who) {
      const f = from || (dir ? [x - DIRS[dir][0], y - DIRS[dir][1]] : null);
      if (f && !this.climbs(f[0], f[1], x, y) && !can(this, who, 'fly')) return true;
    }
    // water, sky, cliffs: solid to whoever can't swim, fly or climb (engine/move.js)
    if (groundStops(this, d, who)) return true;
    if (this.map.walls?.some?.((w) => w[0] === x && w[1] === y)) return true;
    if (propStops(this, this.propAt(x, y), who)) return true;
    if (this.bodyAt(x, y, who)) return true;
    if (who && who !== this.player && this.map.npcWalls?.(x, y)) return true;
    return false;
  }

  // Asks the tile, then the map, then the game. The first non-undefined answer wins.
  canEnter(x, y, id, d, who, dir) {
    const q = { x, y, tile: id, def: d, who, dir, player: who === this.player };
    for (const fn of [d.canEnter, this.map.canEnter, this.game.canEnter]) {
      if (!fn) continue;
      const r = fn(this.api, q);
      if (r !== undefined) return r;
    }
    return undefined;
  }

  // Cartridge hooks that may hand back a script: a function, run as a script, or nothing.
  hook(name, info) {
    const tileDef = info?.tile ? this.game.tiles[info.tile] : null;
    for (const fn of [tileDef?.[name], this.map[name], this.game[name]]) {
      if (!fn) continue;
      const script = fn(this.api, info);
      if (typeof script === 'function') { this.run(script); return true; }
    }
    return false;
  }

  // A breadth-first search over the cells the map and its neighbours cover, in the order
  // of DIRS, so the way found is the same as ever. Kept in typed arrays marked by a count
  // of searches instead of cleared: someone walking a long street plans again at every
  // step, and with keys as strings in a Map a search across a big map took tens of ms.
  findPath(actor, gx, gy) {
    let x0 = 0;
    let y0 = 0;
    let x1 = this.w;
    let y1 = this.h;
    for (const n of this.neighbours || []) {
      x0 = Math.min(x0, n.ox); y0 = Math.min(y0, n.oy);
      x1 = Math.max(x1, n.ox + n.w); y1 = Math.max(y1, n.oy + n.h);
    }
    // and a cell round it all, where a goal past the edge may lie, and wherever the start
    // and the goal are
    x0 = Math.min(x0, actor.x, gx) - 1; y0 = Math.min(y0, actor.y, gy) - 1;
    x1 = Math.max(x1, actor.x + 1, gx + 1) + 1; y1 = Math.max(y1, actor.y + 1, gy + 1) + 1;
    const W = x1 - x0;
    const size = W * (y1 - y0);
    const inside = (x, y) => x >= x0 && y >= y0 && x < x1 && y < y1;
    let st = this.pathState;
    if (!st || st.seen.length < size) {
      st = this.pathState = { seen: new Uint32Array(size), wall: new Uint32Array(size), from: new Int32Array(size), dir: new Uint8Array(size), queue: new Int32Array(size), mark: 0 };
    }
    // a new mark for this search; on the rare wrap round, clear
    if (++st.mark >= 0xffffffff) { st.seen.fill(0); st.wall.fill(0); st.mark = 1; }
    const { seen, wall, from, dir: way, queue } = st;
    const mark = st.mark;
    const names = Object.keys(DIRS);
    const steps = Object.values(DIRS);
    // a cell found blocked stays blocked for this search unless heights make it depend on
    // the side it is entered from
    const keep = !this.raised;
    const start = (actor.y - y0) * W + (actor.x - x0);
    seen[start] = mark;
    from[start] = -1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    while (head < tail) {
      const i = queue[head++];
      const x = (i % W) + x0;
      const y = Math.floor(i / W) + y0;
      if (x === gx && y === gy) {
        const path = [];
        for (let k = i; from[k] >= 0; k = from[k]) path.push(names[way[k]]);
        return path.reverse();
      }
      for (let d = 0; d < 4; d++) {
        const nx = x + steps[d][0];
        const ny = y + steps[d][1];
        // past that nothing is walkable (blocked says so) and no goal lies
        if (!inside(nx, ny)) continue;
        const k = (ny - y0) * W + (nx - x0);
        if (seen[k] === mark) continue;
        const goal = nx === gx && ny === gy;
        if (!goal) {
          if (keep && wall[k] === mark) continue;
          if (this.blocked(nx, ny, actor, null, [x, y])) { if (keep) wall[k] = mark; continue; }
        } else if (this.blocked(nx, ny, actor, null, [x, y]) && (this.actorAt(nx, ny, actor) || !this.climbs(x, y, nx, ny))) continue;
        seen[k] = mark;
        from[k] = i;
        way[k] = d;
        queue[tail++] = k;
      }
    }
    return null;
  }

  // ---------- the pointer (desktop and tablet, see input.js) ----------

  // A click on the map: walk to that cell, or to the nearest cell beside what answers A
  // there, then face it and press A (or walk into it, for a door). Planned again at every
  // step (tripStep), so whoever gets in the way is walked round; a key cancels it.
  pointTo(inp) {
    const pt = inp.pointer;
    if (!pt?.clicked || !pt.over || this.vfx.zoom > 1.001) return;
    const c = this.pointedCell(pt);
    this.trip = this.tripTo(c.x, c.y, c.fy);
    // nowhere to go: a cross blinks there, or a tap would look unheard
    this.miss = this.trip ? null : { x: c.x, y: c.y, at: this.engine.frame };
  }

  pointedCell(pt) {
    // in the modern look the screen is a camera on a diorama: the ground under the pointer
    const g = this.engine.hdShown && this.engine.hdPass.pick(pt.x, pt.y);
    const wx = g ? Math.floor(g.x) : pt.x + Math.round(this.cam.x);
    const wy = g ? Math.floor(g.y) : pt.y + Math.round(this.cam.y);
    const x = Math.floor(wx / TILE);
    // with heights, the cell whose raised top is under the pointer: the nearest row wins,
    // as it is drawn over the ones behind it
    if (this.raised) {
      for (let y = Math.floor((wy + this.maxElev) / TILE); y >= Math.floor(wy / TILE); y--) {
        const top = y * TILE - this.elev(x, y);
        if (wy >= top && wy < top + TILE) return { x, y, fy: wy - top };
      }
    }
    return { x, y: Math.floor(wy / TILE), fy: wy - Math.floor(wy / TILE) * TILE };
  }

  // What is at a clicked cell: who or what answers A there and from which side (`ok`), or
  // nothing (a cell to walk to). A person is taller than their cell: their head counts.
  pointed(x, y, fy = 0) {
    const p = this.player;
    let a = this.actorAt(x, y, p, true);
    if (!a?.def.talk && fy >= TILE / 2) { const b = this.actorAt(x, y + 1, p, true); if (b?.def.talk) a = b; }
    if (a?.def.talk) return { who: a, cells: [[a.x, a.y]], ok: () => true };
    const s = this.spotAt(x, y);
    if (s) return { cells: [[x, y], ...rectCells(s)], ok: (tx, ty, dir) => !!this.spotAt(tx, ty, dir) };
    if (this.examineAt(x, y)) return { cells: [[x, y]], ok: () => true };
    if (this.warpAt(x, y, null, true) || (this.map.warps || []).some((w) => w.dir && this.warpAt(x, y, w.dir, true))) {
      return { cells: [[x, y]], bump: true, ok: (tx, ty, dir) => !!this.warpAt(tx, ty, dir, true) };
    }
    return null;
  }

  tripTo(x, y, fy = 0) {
    const p = this.player;
    const what = this.pointed(x, y, fy);
    if (!what) return this.blocked(x, y, p) ? null : { x, y };
    let best = null;
    for (const [tx, ty] of what.cells) {
      for (const c of pressFrom(this, tx, ty)) {
        if (!what.ok(tx, ty, c.dir)) continue;
        const here = c.x === p.x && c.y === p.y;
        if (!here && this.blocked(c.x, c.y, p)) continue;
        const path = here ? [] : this.findPath(p, c.x, c.y);
        if (path && (!best || path.length < best.n)) best = { x: c.x, y: c.y, face: c.dir, n: path.length };
      }
      if (best) break;
    }
    if (!best) return null;
    return { ...best, bump: !!what.bump, who: what.who || null, at: what.who ? [what.who.x, what.who.y] : null, mark: [x, y] };
  }

  // The next step of the walk the pointer asked for; at its end, the press.
  tripStep() {
    const g = this.trip;
    if (!g) return null;
    const p = this.player;
    // whoever was clicked walked off: go after them
    if (g.who && (g.who.x !== g.at[0] || g.who.y !== g.at[1])) {
      this.trip = this.tripTo(g.who.x, g.who.y);
      return this.trip ? this.tripStep() : null;
    }
    if (p.x === g.x && p.y === g.y) {
      this.trip = null;
      if (!g.face) return null;
      p.face(g.face);
      if (g.bump) return g.face;
      this.interact();
      return null;
    }
    const path = this.findPath(p, g.x, g.y);
    if (path?.length) { g.held = null; return path[0]; }
    // nobody's way but for someone standing in it: walk on to them, and they make way
    // (company.js, makeWay); the walk waits a while for them, then gives up
    const way = this.pathThrough(p, g.x, g.y);
    if (way?.length) {
      const [dx, dy] = DIRS[way[0]];
      const who = this.actorAt(p.x + dx, p.y + dy, p, true);
      if (!who) return way[0];
      const f = this.engine.frame;
      g.held ??= f;
      if (canMakeWay(this, who) || who.errand) {
        if (f - g.held < 150) {
          p.face(way[0]);
          const cells = [];
          let [x, y] = [p.x, p.y];
          for (const d of way) { x += DIRS[d][0]; y += DIRS[d][1]; cells.push([x, y]); }
          makeWay(this, who, way[0], cells);
          return null;
        }
      }
    }
    this.trip = null;
    return null;
  }

  // The player's way to a cell as if nobody stood in it (tripStep).
  pathThrough(p, x, y) {
    this.ghosts = true;
    try { return this.findPath(p, x, y); } finally { this.ghosts = false; }
  }

  // Under the mouse, the cell a click would go to: in the accent colour where A answers.
  drawPointer(ctx, e, cx, cy) {
    const pt = this.engine.input.pointer;
    const g = this.trip;
    const mark = (x, y, color) => {
      const sx = x * TILE - cx;
      const sy = y * TILE - cy - this.elev(x, y);
      ctx.fillStyle = color;
      for (const [ox, oy, w, h] of [[0, 0, 4, 1], [0, 0, 1, 4], [TILE - 4, 0, 4, 1], [TILE - 1, 0, 1, 4], [0, TILE - 1, 4, 1], [0, TILE - 4, 1, 4], [TILE - 4, TILE - 1, 4, 1], [TILE - 1, TILE - 4, 1, 4]]) ctx.fillRect(sx + ox, sy + oy, w, h);
    };
    const accent = getTheme().accent;
    if (g) { const [x, y] = g.mark || [g.x, g.y]; mark(x, y, Math.floor(e.frame / 8) % 2 ? accent : '#ffffff'); }
    const miss = this.miss && e.frame - this.miss.at;
    if (miss >= 0 && miss < 30 && Math.floor(miss / 5) % 2 === 0) {
      ctx.fillStyle = '#ff4d5e';
      const sx = this.miss.x * TILE - cx + 4;
      const sy = this.miss.y * TILE - cy + 4 - this.elev(this.miss.x, this.miss.y);
      for (let i = 0; i < 8; i++) { ctx.fillRect(sx + i, sy + i, 2, 1); ctx.fillRect(sx + 6 - i, sy + i, 2, 1); }
    }
    if (this.free || this.busy || !this.onTop || !this.engine.input.pointerOn || pt.type !== 'mouse' || !pt.over) return;
    const c = this.pointedCell(pt);
    const what = this.pointed(c.x, c.y, c.fy);
    if (what) { const [x, y] = what.who ? [what.who.x, what.who.y] : [c.x, c.y]; mark(x, y, accent); } else if (!this.blocked(c.x, c.y, this.player)) mark(c.x, c.y, 'rgba(255,255,255,0.7)');
  }

  actor(id) {
    if (id === 'player') return this.player;
    return this.actors.find((a) => a.id === id) || null;
  }

  // ---------- running scripts ----------

  async run(fn) {
    if (!this.busy) hushLife(this);
    this.busy++;
    try { await fn(this.api); } catch (err) { console.error(err); }
    finally {
      // a script counted in what api.control lent the player ended meanwhile
      if (this.busy <= 0 && this.lent > 0) this.lent--;
      else this.busy--;
      this.engine.input.flush();
      if (!this.busy) this.endScript();
    }
  }

  // Control returns: a conversation is over, and a camera the direction moved comes home.
  endScript() {
    this.lastSpeaker = null;
    this.scriptEnded = this.engine.frame;
    if (this.autoRefresh) this.refresh();
    // a zoom or a wave a scene forgot to undo would stay over the game
    if (this.vfx.zoom > 1.001 || this.vfx.wave > 0.2) {
      this.lint(`view:${this.mapId}`, 'a script ended with the camera zoomed or waving: undo it before control returns (api.zoom(1), api.wave(0)).');
      this.api.zoom(1, { ms: 300 });
      this.api.wave(0, { ms: 300 });
    }
    if (this.directed) {
      this.directed = false;
      if (!this.cam.follow) this.api.follow(300);
    }
  }

  // ---------- dev mode (?dev=1) ----------

  // F2 shows the grid, solid cells, spots, triggers, warps, routes and ids; F3 opens a
  // menu to jump to any point the cartridge lists (game.dev.jumps) or to any map.
  devKey(code) {
    if (code === 'F2') this.devShow = !this.devShow;
    if (code === 'F3') this.devJump = true;
  }

  async devMenu(api) {
    let jumps = this.game.dev?.jumps || [];
    if (typeof jumps === 'function') jumps = jumps(api);
    const maps = Object.keys(this.game.maps);
    const rows = [...jumps.map((j) => ({ label: j.label })), ...maps.map((m) => ({ label: `map: ${m}` }))];
    const k = await api.list(rows, { title: 'dev' });
    if (k < 0) return;
    if (k < jumps.length) { await jumps[k].run(api); return; }
    const id = maps[k - jumps.length];
    const def = this.game.maps[id];
    const c = this.parse(id);
    // the walkable cell nearest the middle
    let best = null;
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      const t = c.ground[y][x];
      if (!t || this.game.tiles[t].solid || c.solid.has(`${x},${y}`)) continue;
      const d = Math.abs(x - c.w / 2) + Math.abs(y - c.h / 2);
      if (!best || d < best.d) best = { x, y, d };
    }
    if (best) await api.warp(id, best.x, best.y, 'down');
    void def;
  }

  drawDev(ctx, cx, cy) {
    const x0 = Math.floor(cx / TILE);
    const y0 = Math.floor(cy / TILE);
    const nx = Math.ceil(SCREEN_W / TILE);
    const ny = Math.ceil(SCREEN_H / TILE);
    for (let y = y0; y <= y0 + ny; y++) for (let x = x0; x <= x0 + nx; x++) {
      const sx = x * TILE - cx;
      const sy = y * TILE - cy;
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(sx, sy, TILE, 1);
      ctx.fillRect(sx, sy, 1, TILE);
      if (this.blocked(x, y, this.player) && !this.actorAt(x, y, this.player)) {
        ctx.fillStyle = 'rgba(255,40,40,0.22)';
        ctx.fillRect(sx + 1, sy + 1, TILE - 1, TILE - 1);
      }
    }
    const box = (r, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x * TILE - cx + 0.5, r.y * TILE - cy + 0.5, (r.w || 1) * TILE - 1, (r.h || 1) * TILE - 1);
    };
    for (const sp of this.map.spots || []) box(sp, sp.when && !sp.when(this.api) ? 'rgba(255,220,0,0.35)' : '#ffdc00');
    for (const tr of this.map.triggers || []) box(tr, tr.when && !tr.when(this.api) ? 'rgba(255,0,255,0.35)' : '#ff40ff');
    for (const w of this.map.warps || []) box(w, '#40e0ff');
    for (const a of this.actors) {
      if (a === this.player || !a.visible) continue;
      const path = a.route?.path || [];
      ctx.fillStyle = '#80ff80';
      for (const [x, y] of path) ctx.fillRect(x * TILE - cx + 6, y * TILE - cy + 6, 4, 4);
      const label = String(a.id);
      const lx = Math.round(a.px) - cx + 8 - Math.round(measure(label) / 2);
      const ly = Math.round(a.py) - a.ez - cy - 18;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(lx - 1, ly - 1, measure(label) + 2, 10);
      drawText(ctx, label, lx, ly, a.declared ? '#ffffff' : a.def.transient ? '#80ff80' : '#ff9090');
    }
    const p = this.player;
    const head = `${this.mapId} ${p.x},${p.y}${this.busy ? ' busy' : ''}`;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, measure(head) + 4, 11);
    drawText(ctx, head, 2, 1, '#ffffff');
  }

  // ---------- loop ----------

  update(e) {
    if (!this.map) return;
    // a demo playing itself (engine/pilot.js): its buttons instead of the player's pad
    if (this.pilot) { this.pilot.update(); e = Object.create(e, { input: { value: this.pilot } }); }
    // a line or a choice the pilot is answering (show): the world waits under it, as under
    // any scene on top of the engine
    if (this.scenes.length) { this.tick(e); this.scenes[this.scenes.length - 1].update?.(e); return; }
    // time played, in seconds, kept in the save (the credits show it)
    this.save.time = (this.save.time || 0) + 1 / 60;
    tickClock(this);
    // the camera pulls back with a vehicle's speed (camera.zoomOut: how far, at top speed;
    // false keeps it still) and where a script asked
    const zc = this.map.camera?.zoomOut ?? this.game.camera?.zoomOut ?? 0.8;
    let zt = this.zoomTo;
    if (this.driving && zc && zc < 1) zt = Math.min(zt, 1 - (1 - zc) * Math.min(1, this.driving.speed / this.driving.spec.max));
    if (Math.abs(zt - this.zoomOut) > 0.002) this.zoomOut += (zt - this.zoomOut) * 0.03; else this.zoomOut = zt;
    const ground = this.thirdPerson;
    if (this.wasGround !== undefined && ground !== this.wasGround) this.viewChanged(ground);
    this.wasGround = ground;
    this.tickActors(e);
    const control = !this.busy && this.onTop;
    if (!control) this.trip = null;
    if (this.soundSpots?.length && e.frame % 4 === 0) this.mixSoundSpots();
    // a new objective, or a new map under one: can the player get there from here?
    if (control && !this.player.moving && this.goalChecked !== `${this.mapId}|${this.save.objective}`) {
      this.goalChecked = `${this.mapId}|${this.save.objective}`;
      for (const m of audit(this, { goalOnly: !this.dev })) this.lint(`audit:${this.mapId}:${m}`, m);
    }
    if (this.autosaveDue && control && !this.player.moving) {
      this.autosaveDue = false;
      this.api.persist();
      this.savedAt = e.frame;
    }
    // the map follows the story: someone left waiting for the player to look away, or the
    // flags changed under a map that follows them by itself (`refresh: true`)
    if (!this.busy && e.frame % 20 === 0 && (this.pending || (this.autoRefresh && JSON.stringify(this.save.flags) !== this.flagsSeen))) this.refresh();
    this.map.update?.(this.api, e, control);
    this.game.update?.(this.api, e, control);
    if (this.busy || !this.onTop) { this.city.tick(e, false); return; }
    this.city.tick(e, true);
    // a big map may ask to move only what is near the camera (`sim: { radius }`, pixels);
    // an entity with `always` moves anyway (whatever chases the player, a kept vehicle)
    const sim = this.map.sim ?? this.game.sim;
    const r = sim?.radius;
    const mx = this.cam.x + this.viewW / 2;
    const my = this.cam.y + this.viewH / 2;
    for (const en of [...this.entities]) {
      if (en.removed) continue;
      if (r && !en.always && (Math.abs(en.x - mx) > r || Math.abs(en.y - my) > r)) continue;
      en.update?.(this.api, e, en);
    }
    if (this.busy || !this.onTop) return;
    const inp = e.input;
    const p = this.player;
    // control back on a black screen: a script ended faded out and nothing fades it in
    if (this.engine.fx.fade > 0.99 && !this.engine.jobs?.length) {
      if (++this.dark === 30) {
        this.lint(`black:${this.mapId}`, 'control returned with the screen still black: a script ended after fadeOut without fadeIn (or a warp with fade: false). Faded in.');
        this.engine.fadeIn(20);
      }
    } else this.dark = 0;
    // A that closed a conversation, pressed again at once, doesn't open it again
    const cooling = e.frame - (this.scriptEnded ?? -99) < 12;
    if (this.devJump) { this.devJump = false; this.run((api) => this.devMenu(api)); return; }
    if (inp.pressed('start') || inp.pointer?.back) { this.run((api) => api.pauseMenu()); return; }
    if (inp.pressed('select') && this.game.onSelect) { this.run((api) => this.game.onSelect(api)); return; }
    // at the wheel the pad drives (vehicle.js); on foot, A beside a vehicle gets in
    if (this.driving) { driveTick(this, e, inp); return; }
    if (inp.pressed('a') && !cooling && !p.moving) { const v = boardable(this); if (v && board(this, v)) return; }
    // a key takes over from a walk the pointer asked for
    if (this.trip && inp.now.size) this.trip = null;
    if (!this.free) this.pointTo(inp);
    if (p.moving) return;
    if (this.checkSight()) return;
    // ice keeps the player going, a current carries them (engine/move.js)
    if (this.slide && !this.free && slideOn(this)) return;
    if (this.thirdPerson) {
      if (inp.pressed('a') && !(this.map.actionA ?? this.game.actionA) && !cooling) { this.interact(); return; }
      this.walkGround(e, inp, p);
      return;
    }
    if (this.free) {
      if (inp.pressed('a') && !(this.map.actionA ?? this.game.actionA) && !cooling) { this.interact(); return; }
      this.walkFree(e, inp, p);
      return;
    }
    if (inp.pressed('a') && !cooling) { this.interact(); return; }
    const dir = inp.dir() || this.tripStep();
    if (this.busy) return;
    if (!dir) { this.turnDelay = 0; return; }
    // from a standstill a tap only turns; while walking, turns are immediate
    const walking = e.frame - (this.lastArrival || -99) <= 1;
    if (p.dir !== dir && !walking && !this.trip) { p.face(dir); this.turnDelay = 6; return; }
    if (this.turnDelay > 0) { this.turnDelay--; return; }
    // baseSpeed is the cartridge's (a bike, mud) times the mode's (swimming, flying,
    // climbing); B doubles it where running is allowed
    p.speed = stepSpeed(this, p, inp.held('b') && this.map.run !== false);
    const [dx, dy] = DIRS[dir];
    const nx = p.x + dx;
    const ny = p.y + dy;
    const warp = this.warpAt(nx, ny, dir, true);
    if (warp) { this.run((api) => api.take(warp)); return; }
    if (!this.blocked(nx, ny, p, dir)) {
      p.step(dir, { onArrive: () => this.arrived() });
    } else if (this.canHop(nx, ny, dir, p)) {
      sfx('hop');
      p.hop(dir, { onArrive: () => this.arrived() });
    } else if (this.canDrop(nx, ny, dir, p)) {
      sfx('hop');
      p.hop(dir, { n: 1, onArrive: () => this.arrived() });
    } else {
      p.face(dir);
      if (this.hook('onBump', { x: nx, y: ny, dir, tile: this.tileAt(nx, ny) })) return;
      const other = this.actorAt(nx, ny, p);
      bumped(this, other);
      if (other) pushInto(this, other, dir);
      if (e.frame - (this.lastBump || 0) > 20) { sfx('bump'); this.lastBump = e.frame; }
    }
  }

  // ---------- ledges and line of sight ----------

  // A ledge is crossed one way only, landing on the cell beyond it.
  canHop(x, y, dir, who) {
    const id = this.tileAt(x, y);
    if (!id || this.game.tiles[id].ledge !== dir) return false;
    const [dx, dy] = DIRS[dir];
    if (this.canEnter(x, y, id, this.game.tiles[id], who, dir) === false) return false;
    return !this.blocked(x + dx, y + dy, who, dir);
  }

  // Actors with `sight: { range, flag, when, run }` stop the player who walks into their
  // line of view: '!', they walk up, and `run` plays. `flag` is set first, so it happens once.
  checkSight() {
    const p = this.player;
    for (const a of this.actors) {
      const s = a.def.sight;
      if (!s || a === p || !a.visible || a.moving) continue;
      if (s.flag && this.api.is(s.flag)) continue;
      if (s.when && !s.when(this.api)) continue;
      const [dx, dy] = DIRS[a.dir];
      let dist = 0;
      for (let i = 1; i <= (s.range ?? 4); i++) {
        const x = a.x + dx * i;
        const y = a.y + dy * i;
        if (x === p.x && y === p.y) { dist = i; break; }
        if (this.blocked(x, y, a)) break;
      }
      if (!dist) continue;
      p.strolling = false;
      this.run(async (api) => {
        if (s.flag) api.set(s.flag);
        await api.emote(a, '!');
        for (let i = 1; i < dist; i++) await a.step(a.dir);
        p.faceActor(a);
        await s.run(api, a);
      });
      return true;
    }
    return false;
  }

  // ---------- free movement (action games) ----------

  // map.movement or game.movement = 'free': the player moves by pixels with a hitbox
  // instead of cell by cell. Warps, triggers, spots, talk and edges work the same, on the
  // cell under the hitbox's centre.
  get free() { return (this.map.movement ?? this.game.movement) === 'free'; }
  // A scene a script shows (a line, a choice, a card, a minigame): pushed on the engine,
  // as ever. While a pilot plays the world (engine/pilot.js), under a page that has scenes
  // of its own, the world keeps it instead: it answers it with the pilot's buttons and
  // draws it over itself (drawScreen), and the page's scenes stay as they were.
  show(scene) {
    if (!this.pilot) return this.engine.push(scene);
    return new Promise((resolve) => {
      scene.done = (value) => {
        const i = this.scenes.indexOf(scene);
        if (i >= 0) this.scenes.splice(i, 1);
        scene.onExit?.();
        this.pilot?.flush();
        resolve(value);
      };
      this.scenes.push(scene);
      scene.onEnter?.(this.engine);
      this.pilot.flush();
    });
  }

  // the world has the screen: it is on top of the engine, or a demo's pilot plays it
  // (engine/pilot.js) under whatever the page shows over it
  get onTop() { return this.engine.top() === this || !!this.pilot; }
  // the map seen from the ground (engine/thirdperson.js, README "Third person"): 'third'
  // from behind and over the player, or null from above. What the map or the game says
  // (a `view: 'first'` of before 1.26 is read as 'third'), else what the player chose,
  // where they may.
  get groundView() {
    if (!this.map) return null;
    const view = (this.map.view ?? this.game.view) || (this.eyesChoice ? viewChoice(this.game.id) : null);
    return asView(view) === 'third' ? 'third' : null;
  }
  // from the ground: the heading's way of walking, looking and talking
  get thirdPerson() { return this.groundView === 'third'; }
  // whether the player may choose the view here: the cartridge did not say a view, did not
  // say `thirdPerson: false` (`firstPerson: false` before 1.26), and nobody is at a wheel
  get eyesChoice() { return !!this.map && !(this.map.view ?? this.game.view) && (this.map.thirdPerson ?? this.game.thirdPerson ?? this.map.firstPerson ?? this.game.firstPerson) !== false && !this.driving; }
  // the view changed under the player: from the ground they look where they faced, and
  // back on the grid the feet stand on the cell they were over
  viewChanged(ground) {
    const p = this.player;
    if (!p) return;
    if (ground) p.heading = headingOf(p.dir);
    else if (!this.free && !p.moving) p.place(p.x, p.y);
  }
  // what the engine tells the page (engine.js): the grid is walked with the pointer, free
  // movement only with buttons (a tablet gets its pad); the corner button is START
  get pointer() { return !this.map || (!this.free && !this.thirdPerson); }
  get menuButton() { return !this.busy; }

  // A rectangle in map pixels: an actor's feet, or an entity's own box.
  box(o) {
    if (o instanceof Actor) {
      const hb = o.def.hitbox || this.game.hitbox || { x: 3, y: 9, w: 10, h: 6 };
      return { x: o.px + hb.x, y: o.py + hb.y, w: hb.w, h: hb.h };
    }
    return { x: o.x, y: o.y, w: o.w ?? 16, h: o.h ?? 16 };
  }

  // A cell that stops a moving box: ground, props and the cartridge's rules; not actors.
  solidAt(x, y, who = null, dir = null) {
    const inside = x >= 0 && y >= 0 && x < this.w && y < this.h;
    if (!inside && (who !== this.player || !this.neighbourAt(x, y))) return true;
    const id = this.tileAt(x, y);
    if (!id) return true;
    const d = this.game.tiles[id];
    const rule = this.canEnter(x, y, id, d, who, dir);
    if (rule === false) return true;
    if (rule === true) return !!this.propAt(x, y);
    if (this.raised && who instanceof Actor && !this.climbs(who.x, who.y, x, y) && !can(this, who, 'fly')) return true;
    if (groundStops(this, d, who)) return true;
    if (this.map.walls?.some?.((w) => w[0] === x && w[1] === y)) return true;
    return propStops(this, this.propAt(x, y), who);
  }

  boxBlocked(b, who, dir) {
    const x0 = Math.floor(b.x / TILE);
    const y0 = Math.floor(b.y / TILE);
    const x1 = Math.floor((b.x + b.w - 1) / TILE);
    const y1 = Math.floor((b.y + b.h - 1) / TILE);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.solidAt(x, y, who, dir)) return true;
    // actors stop actors; entities pass through them unless they ask (an enemy touches you)
    const actorsBlock = who instanceof Actor || who?.bumpsActors;
    for (const a of actorsBlock ? this.actors : []) {
      if (a === who || !a.visible || !a.solid) continue;
      if (overlap(b, this.free || this.thirdPerson ? this.box(a) : { x: a.px, y: a.py, w: TILE, h: TILE })) return true;
    }
    for (const en of this.city.near(b)) if (en !== who && en.solid && !en.removed && overlap(b, this.box(en))) return true;
    return false;
  }

  // Moves an actor or entity by (dx, dy) pixels, sliding along what it hits.
  // Returns { x, y } = how far it really went, and hitX / hitY.
  moveBox(o, dx, dy) {
    const isActor = o instanceof Actor;
    const get = () => (isActor ? [o.px, o.py] : [o.x, o.y]);
    const set = (x, y) => { if (isActor) { o.px = x; o.py = y; } else { o.x = x; o.y = y; } };
    const start = get();
    const out = { x: 0, y: 0, hitX: false, hitY: false };
    const straight = !dx || !dy;
    const axis = (d, horizontal) => {
      if (!d) return;
      const dir = horizontal ? (d > 0 ? 'right' : 'left') : (d > 0 ? 'down' : 'up');
      let left = d;
      while (left !== 0) {
        const stepPx = Math.abs(left) >= 1 ? Math.sign(left) : left;
        const [x, y] = get();
        const b = this.box(o);
        const nb = horizontal ? { ...b, x: b.x + stepPx } : { ...b, y: b.y + stepPx };
        if (this.boxBlocked(nb, o, dir)) {
          // round a corner: a few pixels off the edge, the box slides toward the gap
          if (horizontal) out.hitX = true; else out.hitY = true;
          if (straight) this.nudge(o, horizontal, stepPx, dir, get, set);
          break;
        }
        set(horizontal ? x + stepPx : x, horizontal ? y : y + stepPx);
        left -= stepPx;
      }
    };
    axis(dx, true);
    axis(dy, false);
    const [ex, ey] = get();
    out.x = ex - start[0];
    out.y = ey - start[1];
    return out;
  }

  nudge(o, horizontal, stepPx, dir, get, set) {
    const b = this.box(o);
    // the nearest gap wins, on either side
    for (let k = 1; k <= 5; k++) {
      for (const side of [1, -1]) {
        const sb = horizontal ? { ...b, y: b.y + side * k } : { ...b, x: b.x + side * k };
        const moved = horizontal ? { ...sb, x: sb.x + stepPx } : { ...sb, y: sb.y + stepPx };
        if (this.boxBlocked(sb, o, dir) || this.boxBlocked(moved, o, dir)) continue;
        const first = horizontal ? { ...b, y: b.y + side } : { ...b, x: b.x + side };
        if (this.boxBlocked(first, o, dir)) continue;
        const [x, y] = get();
        // one pixel at a time toward the gap, so it reads as sliding
        set(horizontal ? x : x + side, horizontal ? y + side : y);
        return true;
      }
    }
    return false;
  }

  walkFree(e, inp, p) {
    // at any angle the pad says (input.stick): a diagonal of the arrows is one
    const { x: vx, y: vy } = inp.stick;
    const dir = inp.dir();
    if (dir) p.face(dir);
    if (!vx && !vy) { p.strolling = false; return; }
    const sp = stepSpeed(this, p, inp.held('b') && this.map.run !== false && this.game.run !== false);
    const before = Math.floor(p.anim / TILE);
    const res = this.moveBox(p, vx * sp, vy * sp);
    p.strolling = !!(res.x || res.y);
    p.speed = sp;
    p.anim += p.strolling ? sp : 0;
    if (Math.floor(p.anim / TILE) !== before) p.stepCount++;
    // the cell under the feet is the player's cell: warps, triggers and edges read it
    const b = this.box(p);
    const cx = Math.floor((b.x + b.w / 2) / TILE);
    const cy = Math.floor((b.y + b.h / 2) / TILE);
    if (cx !== p.x || cy !== p.y) { p.x = cx; p.y = cy; this.arrived(); return; }
    if ((res.hitX && vx) || (res.hitY && vy)) {
      const [dx, dy] = DIRS[p.dir];
      const nx = p.x + dx;
      const ny = p.y + dy;
      const warp = this.warpAt(nx, ny, p.dir, true);
      if (warp) { p.strolling = false; this.run((api) => api.take(warp)); return; }
      const other = this.actorAt(nx, ny, p);
      if (other) pushInto(this, other, p.dir);
      if (e.frame - (this.lastBump || 0) > 20) {
        this.lastBump = e.frame;
        if (!this.hook('onBump', { x: nx, y: ny, dir: p.dir, tile: this.tileAt(nx, ny) })) sfx('bump');
      }
    }
  }

  // From the ground: left and right turn, up and down walk the way the player faces (B runs).
  // The feet are the same box as free movement, so walls, props and people stop them the
  // same, and the cell under them is the player's cell for warps, triggers and edges.
  walkGround(e, inp, p) {
    // the pad at any angle (input.stick): across turns, along walks, both at once at a
    // slant; always at the same pace, as from above, however far the thumb pushes
    const axis = (v) => (Math.abs(v) < 0.38 ? 0 : Math.sign(v));
    const turn = axis(inp.stick.x);
    const go = axis(-inp.stick.y);
    if (turn) {
      p.heading += turn * (this.map.turnSpeed ?? this.game.turnSpeed ?? 0.05);
      p.heading = ((p.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    }
    p.dir = dirOf(p.heading);
    if (!go) { p.strolling = false; return; }
    // seen from the ground a step covers less of the screen than from above: the walk is
    // quicker so it feels the same (`eyesSpeed` on the map or the game)
    const sp = stepSpeed(this, p, inp.held('b') && this.map.run !== false && this.game.run !== false) * (this.map.eyesSpeed ?? this.game.eyesSpeed ?? 1.7);
    const [fx, fy] = forward(p.heading);
    const before = Math.floor(p.anim / TILE);
    const res = this.moveBox(p, fx * sp * go, fy * sp * go);
    p.strolling = !!(res.x || res.y);
    p.speed = sp;
    p.anim += p.strolling ? sp : 0;
    if (Math.floor(p.anim / TILE) !== before) p.stepCount++;
    const b = this.box(p);
    const cx = Math.floor((b.x + b.w / 2) / TILE);
    const cy = Math.floor((b.y + b.h / 2) / TILE);
    if (cx !== p.x || cy !== p.y) { p.x = cx; p.y = cy; this.arrived(); return; }
    if (res.hitX || res.hitY) {
      // a door in a wall opens to whoever walks into it
      const t = this.targetAhead();
      const warp = this.warpAt(t.x, t.y, p.dir, true);
      if (warp) { p.strolling = false; this.run((api) => api.take(warp)); return; }
      const other = this.actorAt(t.x, t.y, p);
      if (other) pushInto(this, other, p.dir);
      if (e.frame - (this.lastBump || 0) > 20) {
        this.lastBump = e.frame;
        if (!this.hook('onBump', { x: t.x, y: t.y, dir: p.dir, tile: this.tileAt(t.x, t.y) })) sfx('bump');
      }
    }
  }

  tick(e) { if (this.map) this.tickActors(e); }

  unboard(opts) { return unboard(this, opts); }

  tickActors(e) {
    for (const a of this.actors) a.update(e);
    tickModes(this, e);
    this.vfx.tick(e);
    // the life of the map: townsfolk turn, wander and walk their routes; passers-by come
    // and go. All of it holds still while a script runs.
    if (!this.busy) {
      for (const a of this.actors) {
        if (a === this.player || a.moving || !a.visible || a.errand || a.aside > e.frame) continue;
        if (a.def.route) { this.tickRoute(a, e); continue; }
        if (!a.def.move) continue;
        if (--a.idle > 0) continue;
        a.idle = 50 + Math.floor(Math.random() * 140);
        if (a.def.move === 'turn') a.face(['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)]);
        if (a.def.move === 'wander') {
          const d = ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)];
          const [dx, dy] = DIRS[d];
          const r = a.def.radius ?? 2;
          if (Math.abs(a.x + dx - a.home.x) <= r && Math.abs(a.y + dy - a.home.y) <= r) a.step(d);
          else a.face(d);
        }
      }
      if (this.onTop) { this.tickCrowd(e); tickLife(this); tickWay(this); }
    }
    if (this.player) tickParty(this);
    if (this.cam.follow) this.centerCamera();
  }

  // One step along a route, planned again each step so whoever is in the way is walked
  // round or waited for. At each point it pauses (`pause` ms, default 1.5 s); at the end
  // it starts over (`back: true` walks it back instead); `once` stops at the last point.
  tickRoute(a, e) {
    if (a.wait > e.frame) return;
    const r = a.route;
    const path = r?.path;
    if (!path?.length) return;
    const n = path.length;
    const at = (i) => {
      if (!r.back || n < 2) return path[i % n];
      const k = i % (2 * n - 2);
      return path[k < n ? k : 2 * n - 2 - k];
    };
    const [tx, ty, act] = at(a.leg);
    if (a.x === tx && a.y === ty) {
      // what is done at this point, once per arrival
      const stay = a.stopped !== a.leg ? routeStop(this, a, act) : null;
      a.stopped = a.leg;
      if (r.once && a.leg >= n - 1) { a.arrived = true; return; }
      a.leg++;
      const pause = stay ?? (Array.isArray(r.pause) ? r.pause[0] + Math.random() * (r.pause[1] - r.pause[0]) : (r.pause ?? 1500));
      a.wait = e.frame + pause / 16.67;
      if (r.face && a.leg % n === 0) a.face(r.face);
      return;
    }
    const way = this.findPath(a, tx, ty);
    if (!way?.length) { a.wait = e.frame + 20; return; }
    a.step(way[0]).then((ok) => { if (!ok) a.wait = e.frame + 20; });
  }

  // Passers-by (`map.crowd`): someone appears at the first cell of a path, walks it and
  // leaves at the last, then a while later someone else does. They appear and disappear
  // only where it can't be seen — off screen, or at a door (a warp or the cell beside it,
  // where they turn to it and go in) — and they don't come back as the same person
  // mid-walk after a reload: they are not saved.
  //   crowd: [{ id, doll, path: [[x, y], ...], every: ms, talk, when, speed }]
  // or a function of the api returning that list.
  tickCrowd(e) {
    let list = this.map.crowd;
    if (typeof list === 'function') list = list(this.api);
    if (!list?.length) return;
    list.forEach((c, i) => {
      const key = `${this.mapId}:${c.id ?? i}`;
      let st = this.crowds.get(key);
      if (!st) { st = { actor: null, next: e.frame + (c.first ?? 2000 * Math.random()) / 16.67 }; this.crowds.set(key, st); }
      const a = st.actor;
      if (a && !this.actors.includes(a)) { st.actor = null; st.next = e.frame + ((c.every ?? 8000) * (0.3 + 0.4 * Math.random())) / 16.67; return; }
      if (a) {
        if (!a.arrived || a.moving) return;
        const [ex, ey] = c.path[c.path.length - 1];
        const door = this.doorAt(ex, ey);
        if (!door && this.inView(ex, ey)) return;   // waits out of the player's sight
        if (door && a.leaving === undefined) { a.face(door); a.leaving = e.frame + 12; return; }
        if (door && e.frame < a.leaving) return;
        a.drop();
        this.actors = this.actors.filter((x) => x !== a);
        st.actor = null;
        st.next = e.frame + ((c.every ?? 8000) * (0.7 + 0.6 * Math.random())) / 16.67;
        return;
      }
      if (e.frame < st.next || (c.when && !c.when(this.api))) return;
      const [x, y] = c.path[0];
      const def = { ...c, x, y, transient: true, route: { path: c.path.slice(1), once: true, pause: 0 } };
      const actor = new Actor(def, this);
      // a swimmer or a flier starts on water or in the air: asked as itself
      if ((this.inView(x, y) && !this.doorAt(x, y)) || this.blocked(x, y, c.mode || c.can ? actor : null)) { st.next = e.frame + 30; return; }
      const [nx, ny] = c.path[1] || c.path[0];
      actor.dir = Math.abs(nx - x) > Math.abs(ny - y) ? (nx > x ? 'right' : 'left') : (ny > y ? 'down' : 'up');
      if (!c.talk && c.doll) this.lint(`mute:${this.mapId}:${actor.id}`, `${actor.id} (crowd) doesn't answer A: give passers-by a talk too.`);
      this.actors.push(actor);
      st.actor = actor;
    });
  }

  // The direction of the door beside a cell, for someone who goes in through it.
  doorAt(x, y) {
    for (const w of this.map.warps || []) {
      for (let j = 0; j < (w.h || 1); j++) for (let i = 0; i < (w.w || 1); i++) {
        const dx = w.x + i - x;
        const dy = w.y + j - y;
        if (!dx && !dy) return w.dir || 'up';
        if (Math.abs(dx) + Math.abs(dy) === 1) return dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
      }
    }
    return null;
  }

  warpAt(x, y, dir, onBump) {
    for (const w of this.map.warps || []) {
      if (w.when && !w.when(this.api)) continue;
      const hit = x >= w.x && x < w.x + (w.w || 1) && y >= w.y && y < w.y + (w.h || 1);
      if (!hit) continue;
      if (w.dir && w.dir !== dir) continue;
      // warps on solid tiles (doors in walls) fire when bumped; others when stepped on
      if (onBump && !this.blocked(x, y, this.player)) continue;
      if (!onBump && this.blocked(x, y, this.player)) continue;
      return w;
    }
    return null;
  }

  arrived() {
    const p = this.player;
    this.lastArrival = this.engine.frame;
    if (this.neighbourAt(p.x, p.y)) this.cross(this.neighbourAt(p.x, p.y));
    if (this.map.footsteps !== false && !this.driving) {
      const own = stepSound(this, p);
      if (own === null) this.footstep(p.x, p.y);
      else if (own) sfx(own);
    }
    const warp = this.warpAt(p.x, p.y, p.dir, false);
    if (warp) { this.run((api) => api.take(warp)); return; }
    for (const tr of this.map.triggers || []) {
      const hit = p.x >= tr.x && p.x < tr.x + (tr.w || 1) && p.y >= tr.y && p.y < tr.y + (tr.h || 1);
      if (!hit) continue;
      if (tr.once && this.api.is(tr.once)) continue;
      if (tr.when && !tr.when(this.api)) continue;
      this.run(async (api) => { if (tr.once) api.set(tr.once); await tr.run(api); });
      return;
    }
    if (!this.hook('onStep', { x: p.x, y: p.y, dir: p.dir, tile: this.tileAt(p.x, p.y), map: this.mapId }) && !this.free && !this.driving) afterStep(this);
  }

  // The ground decides the sound of a step: a tile's `step` names an effect, or one of
  // the console's (soft, hard, wood, snow, water → step_soft …).
  footstep(x, y) {
    const st = this.game.tiles[this.tileAt(x, y)]?.step;
    if (!st) { sfx('step'); return; }
    sfx(hasSfx(st) ? st : `step_${st}`);
  }

  // The player walked over an edge into a neighbour: it becomes the current map with no
  // fade, and the camera shifts by the same amount so nothing on screen jumps.
  cross(n) {
    const p = this.player;
    const { ox, oy } = n;
    const prevName = this.map.name;
    const cam = { x: this.cam.x - ox * TILE, y: this.cam.y - oy * TILE };
    // free movement stands between cells: keep the offset so nothing jumps
    const sub = [p.px - p.x * TILE, p.py - p.y * TILE];
    this.load(n.id, p.x - ox, p.y - oy, p.dir);
    if (this.trip) { this.trip.x -= ox; this.trip.y -= oy; this.trip.mark = null; }
    p.px += sub[0];
    p.py += sub[1];
    this.cam.x = cam.x;
    this.cam.y = cam.y;
    this.centerCamera();
    if (this.map.name && this.map.name !== prevName) showBanner(this.engine, this.api.text(this.map.name));
    if (this.map.enter) this.run((api) => this.map.enter(api));
  }

  // What A would act on now: a person, a spot or something to examine, with its cell.
  // From the ground: what is ahead, along the way the player faces, up to a cell and a
  // half away: the first person who answers, the first live spot, the first thing to
  // examine, else the wall or the floor there.
  targetAhead() {
    const p = this.player;
    const [fx, fy] = forward(p.heading);
    const b = this.box(p);
    const ex = b.x + b.w / 2;
    const ey = b.y + b.h / 2;
    const [dx, dy] = DIRS[p.dir];
    let last = null;
    let mute = null;
    for (let t = 4; t <= 26; t += 2) {
      const x = Math.floor((ex + fx * t) / TILE);
      const y = Math.floor((ey + fy * t) / TILE);
      if (x === p.x && y === p.y) continue;
      if (last && last[0] === x && last[1] === y) continue;
      last = [x, y];
      const a = this.actorAt(x, y, p, true);
      if (a?.def.talk) return { actor: a, x, y };
      mute ||= a;
      const s = this.spotAt(x, y, p.dir);
      if (s) return { spot: s, x, y };
      const prop = this.propAt(x, y);
      const examine = this.examineAt(x, y, prop);
      if (examine) return { examine, x, y };
      if (this.solidAt(x, y, p, p.dir)) break;
    }
    const [x, y] = last || [p.x + dx, p.y + dy];
    return { none: true, x, y, dx, dy, mute };
  }

  target() {
    const p = this.player;
    if (this.thirdPerson) return this.targetAhead();
    const [dx, dy] = DIRS[p.dir];
    const fx = p.x + dx;
    const fy = p.y + dy;
    const prop = this.propAt(fx, fy);
    // talking across a counter, Pokémon style: the person behind it, and a spot on the
    // counter itself or on the cell behind it, both answer
    const cells = prop?.def.counter ? [[fx, fy], [fx + dx, fy + dy]] : [[fx, fy]];
    let mute = null;
    for (const [x, y] of cells) {
      const a = this.actorAt(x, y, p, true);
      if (a?.def.talk) return { actor: a, x, y };
      mute ||= a;
    }
    for (const [x, y] of cells) {
      const s = this.spotAt(x, y, p.dir);
      if (s) return { spot: s, x, y };
    }
    const examine = this.examineAt(fx, fy, prop);
    if (examine) return { examine, x: fx, y: fy };
    return { none: true, x: fx, y: fy, dx, dy, mute };
  }

  // What A on a thing says: the prop's own `examine` (this one desk), else its kind's, else
  // the tile's. Each may be a key or a function of (api, thing) giving one, or nothing: the
  // story's state picks the line (the lamp lit at night) without a spot.
  examineAt(x, y, prop = this.propAt(x, y)) {
    const pick = (ex, thing) => (typeof ex === 'function' ? ex(this.api, thing) : ex) || null;
    const tile = this.tileAt(x, y);
    return (prop && (pick(prop.examine, prop) ?? pick(prop.def.examine, prop)))
      || (tile && pick(this.game.tiles[tile].examine, { x, y, tile })) || null;
  }

  // The live spot covering a cell (and answering from `dir`, when it asks for one).
  spotAt(x, y, dir = null) {
    for (const s of this.map.spots || []) {
      const hit = x >= s.x && x < s.x + (s.w || 1) && y >= s.y && y < s.y + (s.h || 1);
      if (!hit || (s.when && !s.when(this.api))) continue;
      if (dir && s.dir && s.dir !== dir) continue;
      return s;
    }
    return null;
  }

  interact() {
    const p = this.player;
    const t = this.target();
    if (t.actor) {
      const a = t.actor;
      this.run(async (api) => {
        const before = a.dir;
        if (a.def.turn !== false) a.faceActor(p);
        await a.def.talk(api, a);
        if (a.def.turnBack) a.face(before);
      });
      return;
    }
    if (t.spot) { this.run((api) => t.spot.run(api)); return; }
    if (t.examine) { this.run((api) => api.say(null, t.examine)); return; }
    // A on deep water goes under; A under it comes up (engine/move.js)
    const dive = diveScript(this);
    if (dive) { this.run(dive); return; }
    this.lintReach(t.x, t.y, t.dx, t.dy, t.mute);
  }

  // A small "A" over what the player faces, once they stand still a moment: nobody has to
  // guess what answers. `hint: false` on the game or a map turns it off; a spot or an
  // actor with `hint: false` keeps a secret secret.
  drawHint(ctx, e, cx, cy, camFor = null) {
    if ((this.map.hint ?? this.game.hint) === false) return;
    const p = this.player;
    if (!p || this.busy || !this.onTop || p.moving || p.strolling) { this.still = 0; return; }
    if (++this.still < 12) return;
    const t = this.target();
    if ((t.none && !diveHere(this)) || t.actor?.def.hint === false || t.spot?.hint === false || t.actor?.emote) return;
    const bob = Math.floor(e.frame / 20) % 2;
    const th = getTheme();
    if (this.thirdPerson) {
      // over the person's head where the view shows it (the raycaster's box, or the
      // modern look's projection), else at the middle of the view
      let box = t.actor?.rayBox;
      if (t.actor && this.engine.hdShown) {
        const s = this.engine.hdPass.project(t.actor.px + 8 + t.actor.ox, 28, t.actor.py + 12 + t.actor.oy);
        box = s ? { x: s.x - 4, y: s.y, w: 8 } : null;
      }
      const x = box ? Math.round(Math.max(2, Math.min(SCREEN_W - 11, box.x + box.w / 2 - 4))) : SCREEN_W / 2 - 4;
      const y = box ? Math.round(Math.max(2, box.y - 12)) - bob : SCREEN_H / 2 + 8 - bob;
      frame(ctx, x, y, 9, 10, { border: th.border, light: th.fill, fill: th.fill });
      drawText(ctx, 'A', x + 2, y + 1, th.accent);
      return;
    }
    // over the person; for a thing, over the player's head (a prop may be any height)
    const who = t.actor || p;
    if (camFor) [cx, cy] = camFor(who);
    const x = Math.round(who.px) - cx + 4;
    const y = Math.round(who.py) - who.ez - 18 - cy - bob;
    frame(ctx, x, y, 9, 10, { border: th.border, light: th.fill, fill: th.fill });
    drawText(ctx, 'A', x + 2, y + 1, th.accent);
  }

  // A pressed on nothing: say why, if a spot or a person was meant to answer.
  lintReach(fx, fy, dx, dy, a) {
    const p = this.player;
    if (a) { this.lint(`mute:${this.mapId}:${a.id}`, `${a.id} doesn't answer A: give every person a talk, background people too.`); return; }
    const live = (this.map.spots || []).filter((s) => !s.when || s.when(this.api));
    const covers = (s, x, y) => x >= s.x && x < s.x + (s.w || 1) && y >= s.y && y < s.y + (s.h || 1);
    const under = live.find((s) => covers(s, p.x, p.y));
    if (under) this.lint(`under:${this.mapId}:${under.x},${under.y}`, `a spot covers the cell the player stands on (${p.x},${p.y}). A looks at the cell in front: put the spot on the thing's own cells.`);
    const far = this.blocked(fx, fy, p) && live.find((s) => covers(s, fx + dx, fy + dy));
    if (far) this.lint(`far:${this.mapId}:${far.x},${far.y}`, `the player touched (${fx},${fy}) and pressed A, but the spot starts one cell further (${fx + dx},${fy + dy}). Cover the cells of the thing the player bumps into.`);
  }

  centerCamera() {
    const p = this.player;
    if (!p) return;
    // a connected side does not stop the camera: the neighbour is right there
    const b = this.bounds();
    const vw = this.viewW;
    const vh = this.viewH;
    this.cam.x = this.clampCam(p.px + 8 + this.lead.x - vw / 2, b.x1 - b.x0, vw, b.x0);
    this.cam.y = this.clampCam(p.py - p.ez + 8 + this.lead.y - vh / 2, b.y1 - b.y0, vh, b.y0);
  }

  bounds() {
    const b = { x0: 0, y0: 0, x1: this.w * TILE, y1: this.h * TILE };
    for (const n of this.neighbours || []) {
      if (n.dir === 'west') b.x0 = Math.min(b.x0, n.ox * TILE);
      if (n.dir === 'east') b.x1 = Math.max(b.x1, (n.ox + n.w) * TILE);
      if (n.dir === 'north') b.y0 = Math.min(b.y0, n.oy * TILE);
      if (n.dir === 'south') b.y1 = Math.max(b.y1, (n.oy + n.h) * TILE);
    }
    return b;
  }

  // Keeps the view inside [from, from + size]; a map smaller than the screen is centred.
  clampCam(v, size, view, from = 0) {
    if (size <= view) return Math.round(from - (view - size) / 2);
    return Math.round(Math.max(from, Math.min(from + size - view, v)));
  }

  // The world, then what sits over it on the screen. Pulled back (zoomOut under 1), the
  // world is drawn bigger — SCREEN_W/H are its size meanwhile (gfx.js setView) — and
  // shrunk onto the screen; the HUD is drawn after, at the screen's own size.
  draw(ctx, e) {
    if (!this.map) return;
    if (this.thirdPerson) { this.drawGround(ctx, e); this.drawScreen(ctx, e); return; }
    const bw = this.viewW;
    const bh = this.viewH;
    if (bw !== BASE_W || bh !== BASE_H) {
      const was = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.drawView(e), 0, 0, bw, bh, 0, 0, BASE_W, BASE_H);
      ctx.imageSmoothingEnabled = was;
    } else this.drawWorld(ctx, e);
    this.drawScreen(ctx, e);
  }

  // The world alone, the camera's whole view, in a picture of its own.
  drawView(e) {
    const bw = this.viewW;
    const bh = this.viewH;
    if (!this.zbuf || this.zbuf.width !== bw || this.zbuf.height !== bh) {
      this.zbuf = canvas(bw, bh);
      this.zbuf.getContext('2d').imageSmoothingEnabled = false;
    }
    setView(bw, bh);
    try { this.drawWorld(this.zbuf.getContext('2d'), e); } finally { setView(); }
    return this.zbuf;
  }

  // For the modern look (engine.js, hd.js, diorama.js): the world is built in 3D from
  // the map itself; the engine draws the HUD apart.
  drawHd(e) {
    if (!this.map) return null;
    // a region bigger than the GPU takes in one picture is shown classic
    const R = regionOf(this);
    if (Math.max(R.w, R.h) * TILE > (this.engine.hdPass?.maxTex ?? 4096)) return null;
    // from behind the player on an ordinary map (`third`): the diorama, built to be seen
    // from any side. A map made for the ground view (a `view` on it or the game, a ceiling,
    // a `wallHeight`) is built as the raycaster stands it (`walls`, engine/hd.js,
    // buildStatic): its walls as tall as it says, with every face, and a ceiling.
    const ground = this.groundView === 'third';
    const made = !!(this.map.view ?? this.game.view) || !!(this.map.ceiling ?? this.game.ceiling) || (this.map.wallHeight ?? this.game.wallHeight) !== undefined;
    return { world: this, frame: e.frame, region: R, walls: ground && made, third: ground && !made };
  }

  // The sky of the modern look: the map's own (`sky`, colours from the top down), or, seen
  // from the ground on a map that is outdoors, one of the hour's: blue by day, the dark's
  // colour at night, the dusk's or the dawn's grade between (the map's own `grade` and
  // `dark` where it has them, as its light). Indoors is a map that says `clock: false`,
  // `sky: false`, or has a ceiling; a map with far layers says what lies past it; from
  // above there is none.
  hdSky(e) {
    const sky = typeof this.map.sky === 'function' ? this.map.sky(this.api, e) : this.map.sky;
    if (sky?.length) return sky;
    if (sky === false || !this.thirdPerson || this.map.parallax?.length || this.map.clock === false || (this.map.ceiling ?? this.game.ceiling)) return null;
    const grade = this.map.grade === undefined ? clockGrade(this) : typeof this.map.grade === 'function' ? this.map.grade(this.api, e) : this.map.grade;
    const dark = this.map.dark === undefined ? clockDark(this) : typeof this.map.dark === 'function' ? this.map.dark(this.api, e) : this.map.dark;
    const night = dark?.color || '#0a1030';
    const k = Math.min(1, (dark?.alpha ?? 0) * 1.5);
    const tint = (c) => {
      if (!grade) return c;
      const a = hex(c);
      const g = hex(grade);
      return `#${[0, 1, 2].map((i) => Math.round((a[i] * g[i]) / 255).toString(16).padStart(2, '0')).join('')}`;
    };
    return [tint(mix('#6494d8', night, k)), tint(mix('#c8dcf0', night, Math.min(1, k * 0.9)))];
  }

  // What lies on the ground, drawn as the classic look does into a picture of the view
  // (map pixels from cx, cy) that the diorama lays over its floor: a map's underlay, the
  // reflections in water, footstep dust, effects at ground level, a city's roads, and
  // the entities seen from above (vehicles, shots).
  drawHdDecal(ctx, e, cx, cy, w, h) {
    setView(w, h);
    try {
      this.map.underlay?.(ctx, this.api, { x: cx, y: cy }, e);
      this.drawReflections(ctx, cx, cy);
      if (this.puffs.length) this.drawPuffs(ctx, cx, cy);
      this.vfx.draw(ctx, cx, cy, 'back');
      this.city.under(ctx, cx, cy, e);
      for (const en of this.entities) {
        if (en.removed || en.hidden || !en.draw || en.doll || en.stand || (en.spec && en.image)) continue;
        const b = this.box(en);
        if (b.x - cx > w + 48 || b.y - cy > h + 64 || b.x + b.w - cx < -48 || b.y + b.h - cy < -16) continue;
        en.draw(ctx, Math.round(b.x - cx), Math.round(b.y - cy), e, en);
      }
    } finally { setView(); }
  }

  // The entities that are people (a city's passers-by): each drawn into a picture of its
  // own, to stand up as a card where its feet are. Vehicles (seen from above) lie down
  // with a body, as a person stands with one.
  hdEntityCards(e) {
    const out = [];
    for (const en of this.entities) {
      if (en.removed || en.hidden || !en.spec || !en.image) continue;
      const img = en.image(e.frame);
      if (!img?.getContext) continue;
      out.push({ img, x: Math.round(en.cx - img.width / 2), z: Math.round(en.cy - img.height / 2), y: Math.round(en.altitude || 0), w: img.width, h: img.height, body: true, lie: true });
    }
    const pics = (this.hdPics ||= new WeakMap());
    for (const en of this.entities) {
      if (en.removed || en.hidden || !en.draw || !(en.doll || en.stand)) continue;
      const b = this.box(en);
      let c = pics.get(en);
      if (!c) { c = canvas(64, 64); pics.set(en, c); }
      const g = c.getContext('2d');
      g.clearRect(0, 0, 64, 64);
      en.draw(g, 32 - Math.round(b.w / 2), 56 - b.h, e, en);
      // `fresh`: drawn again every frame into the same canvas (hd.js sends the atlas again)
      out.push({ img: c, x: Math.round(b.x + b.w / 2) - 32, z: b.y + b.h - 1, y: -8, w: 64, h: 64, fresh: true });
    }
    return out;
  }

  // Far layers behind the diorama (sky, mountains, sea): where no ground is, as in classic;
  // a map's `sky` (colours from the top down) is the modern look's own, seen past the
  // edges when the camera is low.
  drawHdBackdrop(ctx, e) {
    const cx = Math.round(this.cam.x);
    const cy = Math.round(this.cam.y);
    const sky = this.hdSky(e);
    if (sky?.length) {
      const g = ctx.createLinearGradient(0, 0, 0, BASE_H);
      sky.forEach((c, i) => g.addColorStop(sky.length > 1 ? i / (sky.length - 1) : 0, c));
      ctx.fillStyle = g;
    } else ctx.fillStyle = this.map.void || '#000';
    ctx.fillRect(0, 0, BASE_W, BASE_H);
    for (const l of this.map.parallax || []) l.draw(ctx, Math.round(-cx * (l.speed ?? 0.3)), Math.round(-cy * (l.speedY ?? l.speed ?? 0.3)), e.frame, this.api);
  }

  // What the modern look still draws flat over the diorama: what is in the air, and what
  // points at people and cells (emotes, barks, the A hint, the guide, the pointer). Each
  // is drawn with a camera offset that puts its anchor where the diorama shows it: the
  // feet of whoever it is about, or the player's for what is about cells near them.
  drawHdOverlay(ctx, e) {
    const pass = this.engine.hdPass;
    pass.aim(this);
    const weather = resolveWeather(this.map.weather, this.api, e);
    const at = { x: Math.round(this.cam.x), y: Math.round(this.cam.y) };
    drawWeather(ctx, weather, at, e.frame);
    drawWeather(ctx, weather, at, e.frame, { glowOnly: true });
    // each thing drawn over a person or a cell is placed by its own point of the diorama
    // (a height above the ground, `ez`, the classic drawing already takes off itself)
    const offset = (px, py) => {
      const s = pass.project(px + 8, stairLift(this, px + 8, py + 12), py + 11);
      return [Math.round(px + 8 - s.x), Math.round(py + 15 - s.y)];
    };
    const camFor = (a) => offset(a.px + (a.ox || 0), a.py + (a.oy || 0));
    const p = this.player;
    const [cx, cy] = p ? camFor(p) : [at.x, at.y];
    // the map's own drawing and the effects over people, anchored at the player
    const cam = { x: cx, y: cy };
    if (typeof this.map.above === 'function') this.map.above(ctx, this.api, cam, e);
    this.vfx.draw(ctx, cx, cy, 'front');
    this.vfx.draw(ctx, cx, cy, 'light');
    this.map.overlay?.(ctx, this.api, cam, e);
    for (const a of this.actors) if (a.emote && a.visible) this.drawEmote(ctx, a, ...camFor(a));
    drawBarks(this, ctx, cx, cy, camFor);
    if (this.vfx.zoom <= 1.001) {
      if (!this.driving) this.drawHint(ctx, e, cx, cy, camFor);
      drawGuide(this, ctx, e, cx, cy, (x, up, z) => pass.project(x, up + stairLift(this, x, z), z));
    }
    this.city.marker(ctx, cx, cy, e);
  }

  // The hour's light, for the views that ask (engine/thirdperson.js).
  clockGradeNow() { return clockGrade(this); }
  clockDarkNow() { return clockDark(this); }

  // The map from behind the player (engine/thirdperson.js, the raycaster), and what the
  // console draws flat over it: the weather, the bubbles over heads (anchored where the
  // view shows them), the A hint and the guide's arrow.
  drawGround(ctx, e) {
    const ray = (this.ray ||= new Raycaster(this));
    ray.draw(ctx, e);
    const p = this.player;
    const weather = resolveWeather(this.map.weather, this.api, e);
    const at = { x: Math.round(p.heading * 140), y: Math.round(p.py * 0.5) };
    drawWeather(ctx, weather, at, e.frame);
    drawWeather(ctx, weather, at, e.frame, { glowOnly: true });
    // a bubble is drawn as if at its person's feet on the classic screen: the camera
    // offset that puts that point at the head the view shows (or far away, unseen)
    const camFor = (a) => {
      const s = ray.project(a.px + 8 + (a.ox || 0), 26, a.py + 12 + (a.oy || 0));
      if (!s || s.depth > 12 * TILE) return [1e5, 1e5];
      return [Math.round(a.px + 8 - s.x), Math.round(a.py - 9 - s.y)];
    };
    for (const a of this.actors) if (a !== p && a.emote && a.visible) this.drawEmote(ctx, a, ...camFor(a));
    drawBarks(this, ctx, 0, 0, (a) => (a === p ? [Math.round(p.px) - SCREEN_W / 2 + 8, Math.round(p.py) - SCREEN_H + 30] : camFor(a)));
    this.drawHint(ctx, e, 0, 0);
    drawGuide(this, ctx, e, 0, 0, (x, up, z) => ray.project(x, up, z) || { x: -1e4, y: -1e4 });
  }

  // The light of the diorama: the sun, the shade, the hour's grade and dark, and every
  // light the map declares, in map pixels.
  hdLight(frame) {
    const e = this.engine;
    const grade = this.map.grade === undefined ? clockGrade(this) : typeof this.map.grade === 'function' ? this.map.grade(this.api, e) : this.map.grade;
    const dark = this.map.dark === undefined ? clockDark(this) : typeof this.map.dark === 'function' ? this.map.dark(this.api, e) : this.map.dark;
    const cx = Math.round(this.cam.x) - 160;
    const cy = Math.round(this.cam.y) - 160;
    setView(this.viewW + 320, this.viewH + 320);
    let lights;
    try { lights = gatherLights(this, cx, cy); } finally { setView(); }
    const rgb = (c) => {
      const m = /^#([0-9a-f]{6})$/i.exec(c || '');
      if (!m) return [1, 1, 1];
      const n = parseInt(m[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    };
    const dc = rgb(dark?.color || '#0a1030');
    const da = dark?.alpha > 0 ? dark.alpha : 0;
    // the colour of the distance: the sky's foot (or the void), and the dark's share of it
    const sky = this.hdSky(e);
    const hz = rgb(sky?.length ? sky[sky.length - 1] : this.map.void || '#000000');
    return {
      sun: [0.5, 0.47, 0.4],
      ambient: [0.64, 0.65, 0.7],
      grade: grade ? rgb(grade) : [1, 1, 1],
      dark: [dc[0], dc[1], dc[2], da],
      haze: [0, 1, 2].map((i) => hz[i] + (dc[i] - hz[i]) * da),
      lights: lights.map((l) => ({ ...l, x: l.x + cx, y: l.y + cy })),
    };
  }

  drawWorld(ctx, e) {
    const cx = Math.round(this.cam.x);
    const cy = Math.round(this.cam.y);
    ctx.fillStyle = this.map.void || '#000';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    // far layers behind the map (sky, mountains, sea), showing where the ground is empty:
    // each moves `speed` times as fast as the camera, so distance reads as depth
    for (const l of this.map.parallax || []) l.draw(ctx, Math.round(-cx * (l.speed ?? 0.3)), Math.round(-cy * (l.speedY ?? l.speed ?? 0.3)), e.frame, this.api);
    const animF = Math.floor(e.frame / (this.map.animRate || 20));
    // only the cells on screen are drawn, from the current map and any neighbour
    const tx0 = Math.floor(cx / TILE);
    const ty0 = Math.floor(cy / TILE);
    // with heights, raised cells are sorted with the people (they hide whoever stands
    // behind them), and rows below the screen may rise into it
    const raised = this.raised;
    const lifted = [];
    const rows = Math.ceil(SCREEN_H / TILE) + (raised ? Math.ceil(this.maxElev / TILE) : 0);
    for (let ty = ty0; ty <= ty0 + rows; ty++) {
      for (let tx = tx0; tx <= tx0 + Math.ceil(SCREEN_W / TILE); tx++) {
        const id = this.tileAt(tx, ty);
        if (!id) continue;
        const d = this.game.tiles[id];
        const img = this.tiles.image(id, animF, d.auto ? this.edgeMask(tx, ty, d.auto === true ? id : d.auto) : 0);
        if (raised && this.heightAt(tx, ty) > 0) { lifted.push({ id, img, tx, ty }); continue; }
        ctx.drawImage(img, tx * TILE - cx, ty * TILE - cy);
        if (raised) this.shadeWest(ctx, tx, ty, tx * TILE - cx, ty * TILE - cy, 0);
      }
    }
    this.map.underlay?.(ctx, this.api, { x: cx, y: cy }, e);
    this.drawReflections(ctx, cx, cy);
    if (this.puffs.length) this.drawPuffs(ctx, cx, cy);
    this.vfx.draw(ctx, cx, cy, 'back');
    this.city.under(ctx, cx, cy, e);
    // y-sorted props and actors, anchored at the bottom of their cell
    const items = [];
    for (const c of lifted) items.push({ z: (c.ty + 1) * TILE - 0.5, fn: () => this.drawRaised(ctx, c.id, c.img, c.tx, c.ty, cx, cy, animF) });
    const addProps = (list, ox, oy) => {
      for (const p of list) {
        if (p.hidden) continue;
        const img = this.tiles.image(p.t, animF + (p.phase || 0));
        const lift = raised ? this.elev(p.x + ox, p.y + oy) : 0;
        const x = (p.x + ox) * TILE - cx;
        const y = (p.y + oy + 1) * TILE - img.height - cy - lift;
        if (x > SCREEN_W || y > SCREEN_H || x + img.width < 0 || y + img.height < 0) continue;
        // a rug on a raised cell lies on it, not under it
        const flat = lift ? (p.y + oy + 1) * TILE - 0.25 : -1e6 + p.y + oy;
        items.push({ z: p.def.flat ? flat : p.def.over ? 1e6 : (p.y + oy + 1) * TILE + (p.def.z || 0), img, x, y });
      }
    };
    addProps(this.props, 0, 0);
    for (const n of this.neighbours || []) {
      addProps(n.props, n.ox, n.oy);
      // the neighbour's people, standing where they will be when you get there
      for (const a of n.actors) {
        const img = a.image();
        if (!img) continue;
        const x = (a.x + n.ox) * TILE - cx + (TILE - img.width) / 2;
        const y = (a.y + n.oy) * TILE + TILE - img.height - cy - 1 - (raised ? this.elev(a.x + n.ox, a.y + n.oy) : 0);
        if (x > SCREEN_W || y > SCREEN_H || x + img.width < 0 || y + img.height < 0) continue;
        items.push({ z: (a.y + n.oy + 1) * TILE + 0.5, img, x, y, actor: a });
      }
    }
    for (const a of this.actors) {
      if (!a.visible) continue;
      const img = a.image();
      if (!img) continue;
      const x = Math.round(a.px) - cx + (TILE - img.width) / 2 + a.ox;
      const ez = raised ? a.ez : 0;
      let y = Math.round(a.py) + TILE - img.height - cy - 1 + a.oy - ez;
      // tucked in: the head on the pillow, near the top of the bed, whatever cell of it
      const bed = (img === a.doll?.poses?.lieBed || img === a.doll?.poses?.sleepBed) && a.uprightBed();
      if (bed) y = (bed.y - bed.h + 1) * TILE - cy + 8 + a.oy - ez;
      // and over the bed, which sorts by its own bottom row. With heights, by the lower
      // of the cells it is between, so the cell it walks onto or off never covers its feet
      const row = raised ? Math.max(Math.round(a.py), a.y * TILE, a.moving ? a.moving.ty * TILE : -1e9) : Math.round(a.py);
      const z = bed ? (bed.y + 1) * TILE + Math.max(0, bed.def.z || 0) + 0.5 : row + TILE + 0.5;
      items.push({ z, img, x, y, actor: a, lift: liftOf(this, a) });
    }
    // entities draw themselves at their box's top-left, sorted by the box's bottom
    for (const en of this.entities) {
      if (en.removed || en.hidden || !en.draw) continue;
      const b = this.box(en);
      if (b.x - cx > SCREEN_W + 48 || b.y - cy > SCREEN_H + 64 || b.x + b.w - cx < -48 || b.y + b.h - cy < -16) continue;
      const lift = raised ? this.elev(Math.floor((b.x + b.w / 2) / TILE), Math.floor((b.y + b.h - 1) / TILE)) : 0;
      items.push({ z: en.z ?? b.y + b.h, fn: () => en.draw(ctx, Math.round(b.x - cx), Math.round(b.y - cy - lift), e, en) });
    }
    // tiles whose top layer covers whoever stands on them (tall grass, eaves): sorted with
    // the rest, so it hides the one in its own cell but never the head of someone below
    if (this.hasTops ??= Object.values(this.game.tiles).some((d) => d.top)) {
      for (let ty = ty0; ty <= ty0 + Math.ceil(SCREEN_H / TILE); ty++) {
        for (let tx = tx0; tx <= tx0 + Math.ceil(SCREEN_W / TILE); tx++) {
          const id = this.tileAt(tx, ty);
          if (!id || !this.game.tiles[id].top) continue;
          items.push({ z: (ty + 1) * TILE + 0.75, img: this.tiles.top(id, animF), x: tx * TILE - cx, y: ty * TILE - cy - this.elev(tx, ty) });
        }
      }
    }
    items.sort((a, b) => a.z - b.z);
    for (const it of items) {
      if (it.fn) { it.fn(); continue; }
      const a = it.actor;
      const alpha = a ? a.alpha ?? 1 : 1;
      if (alpha <= 0) continue;
      if (a?.mode && a.mode !== 'walk' && !it.lift && drawInMode(this, ctx, it, a, alpha)) continue;
      if (it.lift) {
        // in the air: the shadow stays on the ground, the body rises
        const sw = a?.doll?.shadow ?? 10;
        ctx.fillStyle = `rgba(0,0,0,${0.22 * alpha})`;
        ctx.fillRect(it.x + (it.img.width - sw) / 2 + 1, it.y + it.img.height - 2, sw - 2, 2);
        if (alpha < 1 || a?.tint) this.vfx.body(ctx, it.img, Math.round(it.x), Math.round(it.y - it.lift), alpha, a.tint);
        else ctx.drawImage(it.img, Math.round(it.x), Math.round(it.y - it.lift));
        continue;
      }
      if (a && (!a.sprite || a.def.shadow) && this.map.shadows !== false) {
        // an animal's shadow is its own size (engine/creature.js); a person's, 10 pixels;
        // a sprite's only when it asks (`shadow: true` or its width)
        const sw = a.sprite ? (typeof a.def.shadow === 'number' ? a.def.shadow : 10) : a.doll?.shadow ?? 10;
        const sx = it.x + (it.img.width - sw) / 2;
        ctx.fillStyle = `rgba(0,0,0,${0.22 * alpha})`;
        ctx.fillRect(sx + 1, it.y + it.img.height - 2, sw - 2, 2);
        ctx.fillRect(sx, it.y + it.img.height - 1, sw, 1);
      }
      if (a && (alpha < 1 || a.tint)) this.vfx.body(ctx, it.img, Math.round(it.x), Math.round(it.y), alpha, a.tint);
      else ctx.drawImage(it.img, Math.round(it.x), Math.round(it.y));
    }
    // the map's own drawing over the people and the props, under the light and the weather
    // (art laid over raised roofs: a city's landmarks)
    // (`above` may also name the map over the water, for diving: then it draws nothing)
    if (typeof this.map.above === 'function') this.map.above(ctx, this.api, { x: cx, y: cy }, e);
    this.vfx.draw(ctx, cx, cy, 'front');
    // grade may depend on the story or the clock: a colour, or a function returning one
    // the map's own light, or the hour's (engine/clock.js)
    const grade = this.map.grade === undefined ? clockGrade(this) : typeof this.map.grade === 'function' ? this.map.grade(this.api, e) : this.map.grade;
    if (grade) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = grade;
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      ctx.globalCompositeOperation = 'source-over';
    }
    // what is in the air, then the dark and its lights (README "Light and weather")
    const weather = resolveWeather(this.map.weather, this.api, e);
    drawWeather(ctx, weather, { x: cx, y: cy }, e.frame);
    const dark = this.map.dark === undefined ? clockDark(this) : typeof this.map.dark === 'function' ? this.map.dark(this.api, e) : this.map.dark;
    if (dark) drawDark(ctx, dark, gatherLights(this, cx, cy), e.frame);
    drawWeather(ctx, weather, { x: cx, y: cy }, e.frame, { glowOnly: true });
    // what gives off light (sparks, magic, a glow) shines through the dark
    this.vfx.draw(ctx, cx, cy, 'light');
    this.map.overlay?.(ctx, this.api, { x: cx, y: cy }, e);
    for (const a of this.actors) if (a.emote && a.visible) this.drawEmote(ctx, a, cx, cy);
    drawBarks(this, ctx, cx, cy);
    this.vfx.post(ctx, cx, cy, e.frame);
    // the hint and the guide point at cells: not while the camera is zoomed
    if (this.vfx.zoom <= 1.001) {
      if (!this.driving) this.drawHint(ctx, e, cx, cy);
      drawGuide(this, ctx, e, cx, cy);
      if (this.engine.input.pointerOn && this.zoomOut > 0.995) this.drawPointer(ctx, e, cx, cy);
    }
    this.city.marker(ctx, cx, cy, e);
    if (this.devShow) this.drawDev(ctx, cx, cy);
  }

  drawScreen(ctx, e) {
    // a small sign in the corner after an autosave
    if (this.savedAt !== undefined && e.frame - this.savedAt < 90 && Math.floor(e.frame / 10) % 3) {
      const label = t('console.menu.autosaved');
      const w = measure(label) + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(SCREEN_W - w - 3, SCREEN_H - 14, w, 11);
      drawText(ctx, label, SCREEN_W - w + 1, SCREEN_H - 12, '#ffffff');
    }
    drawBreath(this, ctx);
    this.city.over(ctx, e);
    drawClock(this, ctx);
    // the cartridge's heads-up display: hearts, rupees, a timer
    this.map.hud?.(ctx, this.api, e);
    this.game.hud?.(ctx, this.api, e);
    // what the pilot is answering (show)
    for (const s of this.scenes) s.draw(ctx, e);
  }

  // Each spot's sound: louder as the player nears it (within `radius` cells, default 6),
  // panned to its side.
  mixSoundSpots() {
    const p = this.player;
    mixSpots(this.soundSpots.map((sp) => {
      const r = sp.radius ?? 6;
      const d = Math.hypot(sp.x - p.x, sp.y - p.y);
      const k = Math.max(0, 1 - d / r);
      return { gain: (sp.volume ?? 1) * k * k, pan: Math.max(-0.8, Math.min(0.8, (sp.x - p.x) / r)) };
    }));
  }

  // Which neighbours of a cell are the same ground (EDGE bits): a tile's group is its
  // `auto` name (or its id). Off the map counts as the same, so the border has no seam. A
  // diagonal only counts when both sides next to it do, which leaves 47 shapes, not 256.
  edgeMask(x, y, group) {
    const same = (dx, dy) => {
      const id = this.tileAt(x + dx, y + dy);
      if (!id) return true;
      const a = this.game.tiles[id].auto;
      return (a === true ? id : a || id) === group;
    };
    let m = 0;
    if (same(0, -1)) m |= 1;
    if (same(1, 0)) m |= 2;
    if (same(0, 1)) m |= 4;
    if (same(-1, 0)) m |= 8;
    if ((m & 3) === 3 && same(1, -1)) m |= 16;
    if ((m & 6) === 6 && same(1, 1)) m |= 32;
    if ((m & 12) === 12 && same(-1, 1)) m |= 64;
    if ((m & 9) === 9 && same(-1, -1)) m |= 128;
    return m;
  }

  // A runner's foot lands: a small puff behind it, in the ground's colour (`dust` on the
  // tile: a colour, or false on water, carpet…; `dust: false` on the map or game: none).
  dust(a) {
    if (this.map.dust === false || this.game.dust === false || !a.visible) return;
    const d = this.game.tiles[this.tileAt(a.x, a.y)]?.dust;
    if (d === false || this.puffs.length > 24) return;
    const [dx, dy] = DIRS[a.dir];
    this.puffs.push({ x: a.px + 8 - dx * 5 + (Math.random() * 4 - 2), y: a.py - a.ez + 14 - dy * 3, born: this.engine.frame, color: typeof d === 'string' ? d : '#f0ead8', drift: -dx * 0.15 });
  }

  drawPuffs(ctx, cx, cy) {
    const f = this.engine.frame;
    this.puffs = this.puffs.filter((p) => f - p.born < 18);
    for (const p of this.puffs) {
      const age = f - p.born;
      const r = 1 + Math.floor(age / 6);
      ctx.globalAlpha = 0.7 * (1 - age / 18);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x + p.drift * age - cx - r), Math.round(p.y - age * 0.25 - cy - r / 2), r * 2, r);
    }
    ctx.globalAlpha = 1;
  }

  // People standing at the edge of still water (tiles with `reflect`) show upside down in
  // it, faint, cut to the water's cells.
  drawReflections(ctx, cx, cy) {
    if (!(this.hasReflect ??= Object.values(this.game.tiles).some((d) => d.reflect))) return;
    for (const a of this.actors) {
      if (!a.visible || a.lift || a.alt || (a.mode && a.mode !== 'walk')) continue;
      const below = this.game.tiles[this.tileAt(a.x, a.y + 1)];
      if (!below?.reflect) continue;
      const img = a.image();
      if (!img) continue;
      const x = Math.round(a.px) - cx + (TILE - img.width) / 2 + a.ox;
      const feet = Math.round(a.py) + TILE - cy - a.ez;
      ctx.save();
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) for (let j = 1; j <= 2; j++) {
        if (this.game.tiles[this.tileAt(a.x + i, a.y + j)]?.reflect) ctx.rect((a.x + i) * TILE - cx, (a.y + j) * TILE - cy - this.elev(a.x + i, a.y + j), TILE, TILE);
      }
      ctx.clip();
      ctx.globalAlpha = (typeof below.reflect === 'number' ? below.reflect : 0.35) * (a.alpha ?? 1);
      ctx.translate(0, feet * 2);
      ctx.scale(1, -1);
      ctx.drawImage(img, x, feet - img.height);
      ctx.restore();
    }
  }

  drawEmote(ctx, a, cx, cy) {
    const x = Math.round(a.px) - cx + 3 + a.ox;
    const y = Math.round(a.py) - a.ez - cy - 22 + a.oy;
    frame(ctx, x, y, 11, 13, { border: '#202020', light: '#ffffff', fill: '#ffffff' });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 4, y + 12, 3, 2);
    ctx.fillRect(x + 5, y + 14, 1, 1);
    const g = a.emote.glyph;
    const age = this.engine.frame - a.emote.from;
    const icon = EMOTES[g];
    if (icon) {
      for (let j = 0; j < icon.length; j++) for (let i = 0; i < icon[j].length; i++) {
        const c = EMOTE_INK[icon[j][i]];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x + 2 + i, y + 3 + j, 1, 1);
      }
    } else if (g === 'dots') {
      // they appear one by one: thinking, an awkward silence
      ctx.fillStyle = '#202020';
      for (let i = 0; i < Math.min(3, Math.floor(age / 12)); i++) ctx.fillRect(x + 2 + i * 3, y + 7, 2, 2);
    } else if (g === 'zzz') {
      const k = Math.floor(age / 10) % 3;
      drawText(ctx, 'z', x + 2 + k, y + 5 - k, '#4060c0');
    } else drawText(ctx, g, x + Math.floor((11 - measure(g)) / 2), y + 3, a.emote.color || '#d03030');
  }
}

// Emotion bubbles drawn as pixels (api.emote(id, 'heart')); any other glyph is text.
const EMOTE_INK = { r: '#d83040', b: '#4080e0', w: '#ffffff', k: '#202020', y: '#f0c030', g: '#909090', p: '#f07090', v: '#60a040' };
const EMOTES = {
  heart: ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'],
  anger: ['rr...rr', 'r.....r', '.......', 'r.....r', 'rr...rr'],
  sweat: ['...b...', '..bb...', '.bbbb..', '.bbwb..', '..bb...'],
  note: ['..kkkk.', '..k..k.', '..k..k.', 'kkk.kkk', 'kkk.kkk'],
  idea: ['..yyy..', '.yywyy.', '.yyyyy.', '..yyy..', '..ggg..', '..ggg..'],
  sad: ['b.....b', '.b...b.', '.......', '..bbb..', '.b...b.'],
  shock: ['r..r..r', '.r.r.r.', '.......', '.r.r.r.', 'r..r..r'],
  // embarrassment: cheeks hatched pink
  blush: ['..p.p.p', '.p.p.p.', 'p.p.p..', '.......', 'ppp.ppp', '.p...p.'],
  // laughter: eyes shut in arcs, the mouth wide open
  laugh: ['.k...k.', 'k.k.k.k', '.......', 'kkkkkkk', '.krrrk.', '..kkk..'],
  // fear: the blue lines of dread, teeth chattering
  fear: ['b.b.b.b', 'b.b.b.b', 'b.b.b.b', '.......', '.k.k.k.', 'k.k.k.k'],
  // doubt: a question drawn, not typed
  doubt: ['.kkk...', 'k...k..', '....k..', '...k...', '..k....', '.......', '..k....'],
  // love: a small heart and a bigger one
  love: ['r.r....', 'rrr....', '.r.....', '..rr.rr', '..rrrrr', '...rrr.', '....r..'],
  // crying: tears running down, the mouth turned down
  cry: ['b.....b', 'b.....b', 'bb...bb', '.......', '..kkk..', '.k...k.'],
  // admiration, delight: a star and a spark
  sparkle: ['...y...', '..yyy..', 'yyywyyy', '..yyy..', '...y...', '.....y.', '....yyy'],
  // a sigh: a puff of breath
  sigh: ['.......', '..ggg..', '.ggggg.', 'gggwggg', '.ggggg.', '..g.g..'],
  // disgust: green waves, the mouth a line
  disgust: ['v.v.v.v', '.v.v.v.', '.......', 'v.v.v.v', '.v.v.v.', '.......', 'kkkkkkk'],
  // frustration: a tangle
  scribble: ['.kkkk..', 'k...kk.', '.kk.k.k', 'k..kk.k', '.kkk..k', '....kk.'],
};

// ---------- the story API ----------

// Everything a script can do. Scripts are async functions of this object:
//   async (api) => { await api.say('neo', 'ch1.hello'); await api.actor('pete').walk('3l'); }
export class StoryApi {
  constructor(world) {
    this.world = world;
    this.engine = world.engine;
  }

  get flags() { return this.world.save.flags; }
  get save() { return this.world.save; }
  get player() { return this.world.player; }
  get map() { return this.world.mapId; }
  get input() { return this.world.pilot || this.engine.input; }
  get game() { return this.world.game; }

  is(flag) { return !!this.flags[flag]; }
  get(flag) { return this.flags[flag]; }
  set(flag, value = true) { this.flags[flag] = value; }
  inc(flag, by = 1) { this.flags[flag] = (this.flags[flag] || 0) + by; return this.flags[flag]; }

  // Getting about (engine/move.js): what the player (and so the companions) can do, kept
  // as flags: grant('swim') and water stops being a wall. can() asks for anyone.
  grant(ability) { this.set(`can.${ability}`); }
  revoke(ability) { delete this.flags[`can.${ability}`]; }
  can(ability, who = 'player') { return can(this.world, this.world.actor(typeof who === 'string' ? who : who.id) || who, ability); }
  // Holds someone in a mode whatever the ground ('fly': up and staying up), or lets the
  // ground decide again (null). Landing where a walker can't stand is refused (false).
  setMode(who, mode) {
    const w = this.world;
    const a = typeof who === 'string' ? w.actor(who) : who;
    if (!a) return false;
    const was = a.held;
    a.setMode(mode);
    if (!mode && w.blocked(a.x, a.y, a) && !w.actorAt(a.x, a.y, a, true)) {
      a.setMode(was);
      w.lint(`land:${w.mapId}:${a.id}`, `${a.id} can't come down at (${a.x},${a.y}): nothing to stand on there. Bring them over ground first.`);
      return false;
    }
    return true;
  }
  mode(who = 'player') { const a = typeof who === 'string' ? this.world.actor(who) : who; return a ? modeOf(this.world, a) : null; }

  // Remembers a decision in order: later chapters can read the whole history back.
  choose(name, value) {
    this.set(`choice.${name}`, value);
    (this.save.choices ||= []).push({ name, value });
  }

  text(key, vars) {
    if (has(key)) return t(key, vars);
    this.world.lintKey(key);
    return key;
  }

  // Says a key (or an array-valued key, one box per entry) as a speaker. null = narration.
  // opts: { mood, top, style, vars, speed }
  async say(speaker, key, opts = {}) {
    if (speaker && opts.direct !== false && (this.world.map?.direct ?? this.game.direct)) await this.direct(speaker, opts);
    const known = has(key);
    if (!known) this.world.lintKey(key);
    const value = known ? tv(key) : key;
    const list = Array.isArray(value) ? value : [known ? t(key, opts.vars) : key];
    for (let i = 0; i < list.length; i++) {
      const id = known ? `${key}#${i}` : null;
      this.world.remember(speaker, list[i]);
      await this.world.show(new Dialog(list[i], { speaker, seen: this.world.seenLine(id), ...opts }));
      this.world.markSeen(id);
    }
  }

  narrate(key, opts) { return this.say(null, key, opts); }

  // Directed conversations (game.direct or map.direct: true, or { player: '<speaker id of
  // the player>' }): before a line, its speaker turns to whom they answer and that one to
  // them; a speaker off screen gets the camera, which comes home when the script ends.
  async direct(speaker, opts) {
    const w = this.world;
    const cfg = w.map?.direct ?? this.game.direct;
    const id = opts.actor || (typeof cfg === 'object' && cfg.player === speaker ? 'player' : speaker);
    const a = this.actor(id);
    if (!a || !a.visible || !w.actors.includes(a)) return;
    const prev = w.lastSpeaker;
    const answering = prev && prev !== a && w.actors.includes(prev) && prev.visible;
    const other = answering ? prev : a !== w.player ? w.player : null;
    // someone caught mid-step finishes it before turning
    for (let i = 0; i < 20 && (a.moving || other?.moving); i++) await this.frames(1);
    // people answer each other from talking distance, not from across the house: the one
    // who can walk comes over first. { far: true } on a line is a shout across the place.
    if (answering && !opts.far) await this.approach(a, prev, typeof cfg === 'object' && cfg.approach === false);
    if (other) {
      if (!a.moving && a.def.turn !== false) a.faceActor(other);
      if (!other.moving && other.def.turn !== false) other.faceActor(a);
    }
    w.lastSpeaker = a;
    const c = w.cam;
    const sx = a.px - c.x;
    const sy = a.py - c.y;
    if (sx < 0 || sx > w.viewW - TILE || sy < 8 || sy > w.viewH - 50 - TILE) {
      // at the edge of the map the camera may already be as close as it gets
      const bd = w.bounds();
      const tx = w.clampCam(a.x * TILE + 8 - w.viewW / 2, bd.x1 - bd.x0, w.viewW, bd.x0);
      const ty = w.clampCam(a.y * TILE + 8 - w.viewH / 2, bd.y1 - bd.y0, w.viewH, bd.y0);
      if (Math.abs(tx - c.x) < 1 && Math.abs(ty - c.y) < 1) return;
      w.directed = true;
      await this.pan(a.x, a.y, 450);
    }
  }

  // Close enough to talk: within three cells, and with a way of three or four steps
  // between them (not through a wall).
  near(a, b) {
    if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) > 3) return false;
    const w = this.world;
    const seen = new Set([`${a.x},${a.y}`]);
    let ring = [[a.x, a.y]];
    for (let d = 0; d <= 6 && ring.length; d++) {
      const next = [];
      for (const [x, y] of ring) {
        if (Math.abs(x - b.x) + Math.abs(y - b.y) <= 1) return true;
        for (const [dx, dy] of Object.values(DIRS)) {
          const nx = x + dx; const ny = y + dy;
          const k = `${nx},${ny}`;
          if (seen.has(k)) continue;
          seen.add(k);
          if (nx === b.x && ny === b.y) return true;
          // people don't wall a room off; tables, counters and walls do (a counter is talked across)
          const prop = w.propAt(nx, ny);
          if (prop?.def.counter) { next.push([nx, ny]); continue; }
          const t = w.game.tiles[w.tileAt(nx, ny)];
          if (!t || t.solid || prop) continue;
          next.push([nx, ny]);
        }
      }
      ring = next;
    }
    return false;
  }

  // Brings two people within talking distance before a line: the one free to walk (not
  // the player, not someone sitting or lying) goes to the free cell next to the other.
  async approach(a, b, off) {
    const w = this.world;
    if (this.near(a, b)) return;
    const free = (x) => x !== w.player && !x.act;
    const mover = off ? null : free(a) ? a : free(b) ? b : null;
    if (mover) {
      const still = mover === a ? b : a;
      const cell = this.cellBeside(mover, still);
      if (cell) {
        await mover.walkTo(cell.x, cell.y, { timeout: 5000 });
        mover.faceActor(still);
      }
    }
    if (!this.near(a, b)) {
      const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      w.lint(`far:${a.id}:${b.id}`, `${a.id} answers ${b.id} from ${d} cells away (${a.x},${a.y} → ${b.x},${b.y}): bring them together before the conversation (walkTo), or mark the line { far: true } if it is a shout across the place.`);
    }
  }

  // The free cell next to `to` that `who` reaches first.
  cellBeside(who, to) {
    const w = this.world;
    const seen = new Set([`${who.x},${who.y}`]);
    const q = [[who.x, who.y]];
    while (q.length) {
      const [x, y] = q.shift();
      if (Math.abs(x - to.x) + Math.abs(y - to.y) === 1) return { x, y };
      for (const [dx, dy] of Object.values(DIRS)) {
        const nx = x + dx; const ny = y + dy;
        const k = `${nx},${ny}`;
        if (seen.has(k) || w.blocked(nx, ny, who)) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
      if (seen.size > 4000) break;
    }
    return null;
  }

  // Shows a line and then a list of options (keys). Resolves with the index.
  async ask(speaker, key, options, opts = {}) {
    const str = this.text(key, opts.vars);
    this.world.remember(speaker, str);
    const d = new Dialog(str, { speaker, keep: true, mood: opts.mood });
    await this.world.show(d);
    return this.world.show(new Choice(options.map((o) => this.text(o)), { under: d, cancel: opts.cancel }));
  }

  menu(options, opts = {}) { return this.world.show(new Choice(options.map((o) => this.text(o)), opts)); }

  // A scrolling list (a bag, a shop, a party). items: [{ label, value?, note?, disabled? }],
  // label and note as keys or text. Resolves with the index, or -1 on B.
  list(items, opts = {}) {
    const rows = items.map((it) => ({ ...it, label: this.text(it.label), note: it.note ? this.text(it.note) : undefined }));
    return this.world.show(new List(rows, { ...opts, title: opts.title ? this.text(opts.title) : '' }));
  }

  // The backlog: everything said this session.
  showLog() { return this.world.show(new Log(this.world.log, t('console.menu.log'))); }

  wait(ms) { return this.engine.waitMs(ms); }
  frames(n) { return this.engine.wait(n); }
  // opts: { kind: 'fade' | 'iris' | 'wipe' | 'mosaic' | 'blinds', at: 'player' | an actor id | { x, y } (screen) }
  fadeOut(ms = 350, color, opts = {}) { return this.engine.fadeOut(ms / 16.67, color, opts.kind, this.screenAt(opts.at)); }
  fadeIn(ms = 350, opts = {}) { return this.engine.fadeIn(ms / 16.67, opts.kind, this.screenAt(opts.at)); }
  letterbox(on = true, ms = 350) { return this.engine.letterbox(on, ms / 16.67); }

  // The current map from the air, in Mode 7 (engine/mode7.js, README "Mode 7"): the camera
  // glides from `from` to `to` (cells; by default from the player to `ahead` cells in
  // front of them) at `height` pixels, turning from `angle` to `turn` (degrees, 0 is
  // north), in `ms`. The people on the map stand where they are. A skips it. Resolves
  // when it is over, back on the map as it was.
  //   await api.flyover({ from: [4, 30], to: [20, 4], ms: 4000, height: 48 })
  flyover(opts) { return this.play(this.flyoverScene(opts)); }
  // The same flight as a scene, not played: for whoever shows it themselves (a demo reel
  // that draws it where the world was). It calls `done()` at the end, when it has one.
  flyoverScene({ from = null, to = null, ahead = 12, ms = 3000, height = 48, horizon = 40, angle = 0, turn = null, sky = ['#3a5a8a', '#b8d0e8'], fog = { color: '#b8d0e8', from: 0.45 }, outside = null, people = true, skip = true } = {}) {
    const w = this.world;
    const p = w.player;
    const rad = (d) => (d * Math.PI) / 180;
    const a0 = rad(angle);
    const a1 = rad(turn ?? angle);
    const start = from ? [from[0] * TILE + 8, from[1] * TILE + 8] : [p.px + 8, p.py + 8];
    const end = to ? [to[0] * TILE + 8, to[1] * TILE + 8] : [start[0] + Math.sin(a1) * ahead * TILE, start[1] - Math.cos(a1) * ahead * TILE];
    const m7 = new Mode7({ ground: w.mapImage(0, { props: 'flat' }), sky, fog, outside: outside || w.map.void || '#000000' });
    // what stands up (lamps, trees, houses) stands up in the air view too
    const standing = w.props.filter((pr) => !pr.hidden && !pr.def.flat).map((pr) => ({ img: w.tiles.image(pr.t, pr.phase || 0), x: pr.x * TILE + (pr.w * TILE) / 2, y: (pr.y + 1) * TILE - 1 }));
    const frames = Math.max(1, Math.round(ms / 16.67));
    let t = 0;
    const ease = EASE.inOut;
    const scene = {
      update(e) {
        t++;
        if ((skip && t > 20 && (e.input.pressed('a') || e.input.pressed('start'))) || t >= frames) scene.done?.();
      },
      draw(ctx) {
        const k = ease(Math.min(1, t / frames));
        const ang = a0 + (a1 - a0) * k;
        // the camera sits behind the point it looks at, so that point shows a little below
        // the middle of the ground
        const back = (height * (SCREEN_W / 2)) / Math.tan(m7.fov / 2) / ((SCREEN_H - horizon) * 0.6);
        const x = start[0] + (end[0] - start[0]) * k - Math.sin(ang) * back;
        const y = start[1] + (end[1] - start[1]) * k + Math.cos(ang) * back;
        m7.cam = { x, y, angle: ang, height, horizon };
        m7.draw(ctx);
        const who = people ? w.actors.filter((a) => a.visible).map((a) => ({ img: a.image(), x: a.px + 8, y: a.py + 15, z: (a.lift || 0) + (a.alt || 0) })).filter((s) => s.img) : [];
        m7.sprites(ctx, [...standing, ...who]);
      },
    };
    return scene;
  }

  // Where an actor (or 'player') is on screen, for an iris to close on.
  screenAt(at) {
    if (!at) return null;
    if (typeof at === 'object') return at;
    const a = this.actor(at);
    if (!a) return null;
    return { x: a.px - this.world.cam.x + 8, y: a.py - a.ez - this.world.cam.y + 2 };
  }
  flash(color, ms = 200) { return this.engine.flash(color, ms / 16.67); }
  shake(ms = 300, power) { rumble(Math.min(400, ms)); return this.engine.shake(ms / 16.67, power); }
  // The phone vibrates (ms, or a pattern [on, off, on…]); nothing where it can't.
  rumble(pattern = 40) { rumble(pattern); }
  glitch(ms = 300) { sfx('glitch'); return this.engine.glitch(ms / 16.67); }
  music(name, opts) { return music(name, opts); }
  musicLayer(name, on = true) { musicLayer(name, on); }
  sfx(name, opts) { sfx(name, opts); }
  ambience(name) { ambience(name, this.world.game.ambiences?.[name]); }

  actor(id) { return this.world.actor(id); }
  // `keep: true` writes it in the save: the map is that way on every visit after
  // (README "A world that remembers"). The same for addProp and removeProp.
  setTile(x, y, id, { keep = false } = {}) {
    const w = this.world;
    w.setTile(x, y, id);
    w.mapEdits = (w.mapEdits || 0) + 1;
    w.city.roadsDirty = true;
    if (keep) w.city.edits().tiles[`${x},${y}`] = id;
  }

  // Adds an actor to the current map (not saved: a map's own `actors` list, gated by
  // `when`, is how something stays put across a reload).
  spawn(def) {
    this.despawn(def.id, { quiet: true });
    const a = new Actor(def, this.world);
    this.world.actors.push(a);
    this.world.unstack(a);
    this.world.lintPop(a, 'appeared');
    return a;
  }
  despawn(id, { quiet = false } = {}) {
    const w = this.world;
    for (const a of w.actors) {
      if (a.id !== id || a === w.player) continue;
      if (!quiet) w.lintPop(a, 'vanished');
      a.drop();
    }
    w.actors = w.actors.filter((a) => a.id !== id || a === w.player);
  }

  // The map brought in line with its data as the story stands now (World.refresh): people
  // whose `when` changed walk in or out, props with `when` come and go. Awaitable.
  refresh() { return this.world.refresh(); }

  // A prop for the rest of this visit (the data, with `when`, is what survives a reload).
  // The same id again replaces it in place: the wardrobe opening.
  addProp(p, { keep = false } = {}) {
    if (p.id != null) this.world.props = this.world.props.filter((q) => q.id !== p.id);
    this.world.mapEdits = (this.world.mapEdits || 0) + 1;
    if (keep) {
      const ed = this.world.city.edits();
      if (p.id != null) ed.add = ed.add.filter((q) => q.id !== p.id);
      ed.add.push(p);
    }
    return this.world.addProp(p);
  }
  removeProp(id, { keep = false } = {}) {
    this.world.removeProp(id);
    this.world.mapEdits = (this.world.mapEdits || 0) + 1;
    if (keep) {
      const ed = this.world.city.edits();
      const before = ed.add.length;
      ed.add = ed.add.filter((q) => q.id !== id);
      // a prop the map's data brings is remembered as taken away; one added by keep is just forgotten
      if (ed.add.length === before && !ed.remove.includes(id)) ed.remove.push(id);
    }
  }

  // ---------- the street (vehicle.js, city.js, pursuit.js, minimap.js, mission.js) ----------

  // A vehicle on this map: { id, body, color, x, y (cells), dir | angle, keep, locked,
  // ai: { traffic | chase: target | to: [x, y] }, blip, hp }. With `keep` and an id it is
  // remembered where it is left, and adding it again finds the one already there (or
  // nothing, null, when it was left on another map).
  addVehicle(def) { return this.world.city.addVehicle(def); }
  get vehicles() { return this.world.entities.filter((en) => en.kind === 'vehicle' && !en.removed); }
  vehicle(id) { return this.vehicles.find((v) => v.id === id) || null; }
  // The vehicle the player is in, or null.
  get driving() { return this.world.driving; }
  // Puts the player at the wheel (false if refused: locked, canBoard, a wreck) or out of it.
  board(v) { return board(this.world, typeof v === 'string' ? this.vehicle(v) : v); }
  unboard({ force = true } = {}) { return unboard(this.world, { force }); }
  // Who drives a vehicle that isn't the player's: { traffic: true } joins the traffic,
  // { chase: 'player' | entity } hunts, { to: [x, y] } goes there (resolves on arrival),
  // { park: true } stops. A chase with `max` keeps under that speed.
  drive(v, ai) {
    const veh = typeof v === 'string' ? this.vehicle(v) : v;
    if (!veh) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.world.city.setAi(veh, ai);
      if (veh.ai && ai?.to) veh.ai.resolve = resolve; else resolve(true);
    });
  }
  // People on the pavement (README "A living city").
  get peds() { return this.world.entities.filter((en) => en.kind === 'ped' && !en.removed); }
  // An entity moves toward someone round walls; → { dist, sees } (see pursuit.js).
  seek(self, target, opts) { return seek(this.world, self, target, opts); }
  // A clear line between two (actors, entities, vehicles, cells), no further than range px.
  sees(a, b, range = Infinity) {
    const p = centreOf(this.world, a);
    const q = centreOf(this.world, b);
    return !!p && !!q && clearLine(this.world, p, q, range);
  }
  // Where something is in map pixels (its centre): 'player' follows them into a vehicle.
  where(target) { return centreOf(this.world, target); }
  shoot(opts) {
    const s = shoot(this.world, opts);
    if (s) this.world.city.panic(s.x, s.y, 90);
    return s;
  }
  damage(target, amount, from = null) { this.world.city.damage(typeof target === 'string' && target !== 'player' ? this.actor(target) || target : target, amount, from); }
  panic(x, y, r) { this.world.city.panic(x, y, r); }
  explode(v) { const veh = typeof v === 'string' ? this.vehicle(v) : v; if (veh && !veh.wreck) this.world.city.explode(veh, null); }
  // A dot on the minimap and the map screen until blip(id, null).
  blip(id, opts) { if (opts) this.world.city.blips.set(id, opts); else this.world.city.blips.delete(id); }
  // Missions (mission.js): the one under way, and starting, failing or passing it by hand.
  mission() { const s = this.save.mission; return s ? { id: s.id, step: s.step } : null; }
  startMission(id) { startMission(this.world, id); }
  failMission(why) { return failMission(this.world, why); }
  passMission() { return passMission(this.world); }

  // The player has the world while a script waits for something they do (a fight, a
  // chase, reaching a place): `await api.control(promise)` gives back the script's turn
  // when it settles. Others may run meanwhile (talking to someone).
  async control(promise) {
    const w = this.world;
    const n = w.busy;
    w.lent += n;
    w.busy = 0;
    w.scriptEnded = this.engine.frame;
    if (!w.cam.follow) this.follow(300);
    try { return await (typeof promise === 'function' ? promise(this) : promise); } finally {
      const back = Math.min(n, w.lent);
      w.lent -= back;
      w.busy += back;
      if (w.busy) hushLife(w);
    }
  }

  // Someone jumps, in a scene (see Actor.jump): api.jump('ana'), api.jump('ana', 'up', { n: 2 }).
  jump(id, dir, opts) {
    const a = typeof id === 'string' ? this.actor(id) : id;
    return a ? a.jump(dir, opts) : Promise.resolve(false);
  }

  emote(id, glyph = '!', ms = 900, color) {
    const a = typeof id === 'string' ? this.actor(id) : id;
    if (!a) return Promise.resolve();
    sfx('cursor');
    a.emote = { glyph, until: this.engine.frame + ms / 16.67, color, from: this.engine.frame };
    return this.wait(ms);
  }

  // ---------- visual effects (vfx.js, README "Visual effects") ----------

  // A burst on someone (an id, 'player' or an actor), a cell [x, y] or { px, py } in map
  // pixels; resolves when it has faded, so it can be awaited or let run.
  // opts: { color (one or a list, light to dark), amount, scale, front, feet, dx, dy, sound }
  fx(name, at, opts = {}) {
    if (opts.sound) sfx(opts.sound);
    return this.engine.wait(this.world.vfx.burst(name, at, opts) || 1);
  }
  // Keeps one going until `.stop()` or the map changes: an aura, a chimney. Declared on a
  // map as `fx: [{ name, x, y, every, when, color… }]` it comes back on every visit.
  emitter(name, at, opts) { return this.world.vfx.emit(name, at, opts); }

  // Someone appears in plain sight, out of an effect: a def (as api.spawn) or the id of
  // someone already here and hidden (visible: false). opts: { fx = 'poof', ms, sound, color… }
  async appear(who, opts = {}) {
    const w = this.world;
    let a;
    if (typeof who === 'string') {
      a = this.actor(who);
      if (!a) { w.lint(`appear:${w.mapId}:${who}`, `api.appear('${who}'): nobody with that id here. Pass a def ({ id, doll, x, y }) to bring someone new.`); return null; }
    } else {
      this.despawn(who.id, { quiet: true });
      a = new Actor(who, w);
      w.actors.push(a);
      w.unstack(a);
    }
    a.visible = true;
    a.alpha = 0;
    const name = opts.fx ?? 'poof';
    const cover = name ? this.fx(name, a, opts) : null;
    await this.animate(a, { alpha: 1 }, opts.ms ?? 300, { ease: 'out' });
    if (opts.wait) await cover;
    return a;
  }

  // Someone goes in plain sight, into an effect. They leave the map (as api.despawn)
  // unless it is the player or `keep: true`: then they are only hidden, for api.appear.
  async vanish(id, opts = {}) {
    const a = typeof id === 'string' ? this.actor(id) : id;
    if (!a) return;
    const name = opts.fx ?? 'poof';
    const cover = name ? this.fx(name, a, opts) : null;
    await this.animate(a, { alpha: 0 }, opts.ms ?? 260, { ease: 'in' });
    if (a === this.player || opts.keep) { a.visible = false; a.alpha = 1; }
    else this.despawn(a.id, { quiet: true });
    if (opts.wait) await cover;
  }

  // Moves numbers on someone (or on any object) over `ms`: alpha (0..1), lift (pixels in
  // the air, the shadow stays), ox and oy (pixels off the cell). ease: linear in out inOut
  // back bounce step. Floating: animate(a, { lift: 6 }); a lunge: { ox: 6 } then { ox: 0 }.
  animate(target, props, ms = 400, { ease = 'inOut' } = {}) {
    const a = typeof target === 'string' ? this.actor(target) : target;
    if (!a) return Promise.resolve();
    const from = {};
    for (const k of Object.keys(props)) from[k] = a[k] ?? 0;
    const start = this.engine.frame;
    const frames = Math.max(1, ms / 16.67);
    const curve = EASE[ease] || EASE.inOut;
    return new Promise((resolve) => (this.engine.jobs ||= []).push({ tick: () => {
      const t = a.gone ? 1 : Math.min(1, (this.engine.frame - start) / frames);
      for (const k in props) a[k] = from[k] + (props[k] - from[k]) * curve(t);
      if (t >= 1) { resolve(); return true; }
      return false;
    } }));
  }

  // A colour over someone's body that fades: hit (red), healed (green), lit by a spell.
  // ms 0 leaves it on until tintActor(id, null).
  tintActor(id, color = '#ffffff', ms = 220) {
    const a = typeof id === 'string' ? this.actor(id) : id;
    if (!a) return Promise.resolve();
    if (!color) { a.tint = null; return Promise.resolve(); }
    const tint = a.tint = { color, k: 1 };
    if (!ms) return Promise.resolve();
    return this.animate(tint, { k: 0 }, ms, { ease: 'in' }).then(() => { if (a.tint === tint) a.tint = null; });
  }

  // Afterimages behind someone while they move: speed, a dash, something not quite human.
  // trail(id, true) / trail(id, { color, life (frames), still: true (even standing) }) / false.
  trail(id, on = true) {
    const a = typeof id === 'string' ? this.actor(id) : id;
    if (a) a.trail = on ? (on === true ? {} : on) : null;
  }

  // The camera closes in on someone or a cell (2 = twice as close); zoom(1) back. A
  // scene must undo it before control returns (the engine does, with a warning).
  // Under 1 it pulls back instead (0.75: a third more of the map), around the player,
  // and stays until zoom(1).
  zoom(z = 1, { at = 'player', ms = 400, ease = 'inOut' } = {}) {
    const v = this.world.vfx;
    v.zoomAt = at;
    if (z < 1) return Promise.all([this.animate(v, { zoom: 1 }, ms, { ease }), this.animate(this.world, { zoomTo: Math.max(0.5, z) }, ms, { ease })]);
    if (this.world.zoomTo < 1) this.animate(this.world, { zoomTo: 1 }, ms, { ease });
    return this.animate(v, { zoom: Math.max(1, z) }, ms, { ease });
  }

  // The time of day (engine/clock.js): { day, hour, minute, minutes } or null without game.clock.
  get clock() { return clockInfo(this.world); }
  setClock(hour, minute = 0) { setClock(this.world, hour, minute); }
  clockLabel() { return clockLabel(this.world); }
  get night() { return isNight(this.world); }

  // The picture waves, row by row (pixels at most): a dream, a memory, heat, the air bent.
  wave(power = 3, { ms = 400 } = {}) { return this.animate(this.world.vfx, { wave: power }, ms, { ease: 'linear' }); }

  // ---------- action games (free movement) ----------

  // Entities: { x, y, w, h, solid?, z?, update(api, engine, self), draw(ctx, sx, sy, engine, self) }.
  // x, y, w, h is the hitbox in map pixels. They live until the map changes: add them in
  // `enter` from flags. update runs every frame the player has control.
  addEntity(en) { en.removed = false; this.world.entities.push(en); this.world.city.addToGrid(en); return en; }
  removeEntity(en) { en.removed = true; this.world.entities = this.world.entities.filter((x) => x !== en); }
  get entities() { return this.world.entities; }
  // Moves an entity or actor ('player' or an id) by pixels against the map; see World.moveBox.
  move(o, dx, dy) { return this.world.moveBox(typeof o === 'string' ? this.actor(o) : o, dx, dy); }
  box(o) { return this.world.box(typeof o === 'string' ? this.actor(o) : o); }
  overlaps(a, b) { return overlap(this.box(a), this.box(b)); }
  // Is the cell under this map pixel solid (for projectiles, a dash, a thrown pot)?
  solidPixel(x, y) { return this.world.solidAt(Math.floor(x / TILE), Math.floor(y / TILE)); }

  // Opens a full-screen stage (backdrop + characters) over the map. See engine/stage.js.
  stage(opts = {}) {
    const st = new Stage(this.world, opts);
    this.world.show(st);
    if (opts.music !== undefined) music(opts.music);
    return st;
  }

  // Third person: turns the player's heading to a direction ('left'), a person ('ana') or a
  // heading in radians, easing over `ms`. From above it only faces the quarter.
  async look(to, ms = 400) {
    const p = this.player;
    const target = typeof to === 'number' ? to : typeof to === 'string' && this.world.actor(to) && !(to in DIRS)
      ? (() => { const a = this.world.actor(to); return Math.atan2(a.px - p.px, -(a.py - p.py)); })() : headingOf(to);
    if (!this.world.thirdPerson) { p.face(dirOf(target)); return; }
    const from = p.heading;
    let d = target - from;
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const n = Math.max(1, Math.round(ms / 16.67));
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      p.heading = from + d * (k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k));
      p.dir = dirOf(p.heading);
      await this.engine.wait(1);
    }
  }

  // Moves several actors at once: await api.together(a.walk('3l'), b.walk('2u')).
  together(...promises) { return Promise.all(promises); }

  // transition: 'fade' | 'iris' | 'wipe' | 'mosaic' | 'blinds' (default the game's `transition`, or 'fade');
  // an iris closes on the player and opens on them at the arrival.
  async warp(mapId, x, y, dir, { fade = true, silent = false, transition } = {}) {
    const kind = transition || this.game.transition || 'fade';
    if (fade) await this.fadeOut(kind === 'fade' ? 260 : 420, undefined, { kind, at: 'player' });
    this.world.load(mapId, x, y, dir);
    if (!silent) sfx('door');
    const m = this.world.map;
    if (m.name && !silent) showBanner(this.engine, this.text(m.name));
    if (fade) await this.fadeIn(kind === 'fade' ? 260 : 420, { kind, at: 'player' });
    if (m.enter) await m.enter(this);
  }

  // A warp from a map's `warps` list.
  async take(w) {
    if (w.run) { await w.run(this); return; }
    await this.warp(w.to, w.at[0], w.at[1], w.face || this.player.dir, { transition: w.transition });
  }

  // The modern look's camera (engine/hd.js): turned round what it looks at (`yaw`, degrees,
  // 0 from the south, positive from the east), raised or lowered (`pitch`, degrees over
  // the horizon, 40 by default) and brought closer (`zoom`), easing over `ms`. A scene
  // shot for the diorama: in the classic look it only waits. view3d() puts it back.
  async view3d({ yaw = 0, pitch = 40, zoom = 1 } = {}, ms = 800) {
    const w = this.world;
    const from = { yaw: 0, pitch: 40, zoom: 1, ...(w.cam3d || {}) };
    const n = Math.max(1, Math.round(ms / 16.67));
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const e = k * k * (3 - 2 * k);
      w.cam3d = { yaw: from.yaw + (yaw - from.yaw) * e, pitch: from.pitch + (pitch - from.pitch) * e, zoom: from.zoom + (zoom - from.zoom) * e };
      await this.frames(1);
    }
    if (!yaw && pitch === 40 && zoom === 1) w.cam3d = null;
  }

  // Camera: pan to a tile (centre) or back to the player.
  async pan(x, y, ms = 600) {
    const w = this.world;
    w.cam.follow = false;
    const fx = w.cam.x;
    const fy = w.cam.y;
    const b = w.bounds();
    const tx = w.clampCam(x * TILE + 8 - w.viewW / 2, b.x1 - b.x0, w.viewW, b.x0);
    const ty = w.clampCam(y * TILE + 8 - w.viewH / 2, b.y1 - b.y0, w.viewH, b.y0);
    const n = Math.max(1, Math.round(ms / 16.67));
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const s = k * k * (3 - 2 * k);
      w.cam.x = fx + (tx - fx) * s;
      w.cam.y = fy + (ty - fy) * s;
      await this.frames(1);
    }
  }
  async follow(ms = 400) {
    const p = this.player;
    await this.pan(p.x, p.y, ms);
    this.world.cam.follow = true;
  }

  // What the story wants next (a key) and where it is: a person ('ana'), a cell ([x, y]) on
  // this map, or { map, x, y, w, h } / { actor, map } elsewhere. The guide points there
  // (engine/guide.js) and the audit checks it can be reached. `false` says on purpose
  // that it has no one place ("explore the town").
  objective(key, at) {
    this.save.objective = key;
    this.save.goal = goalOf(this.world, at);
    this.save.goalFree = at === false;
    this.world.goalChecked = null;
  }

  // A short line over someone's head that doesn't stop the game: a shout across the
  // square, a remark while walking, what a passer-by mutters. key: a locale key.
  bark(id, key, { ms = 2600, vars } = {}) {
    const a = typeof id === 'string' ? this.actor(id) : id;
    bark(this.world, a, this.text(key, vars), ms);
  }

  // The problems a player would hit here, from the data (engine/guide.js).
  audit() { return this.world.audit(); }

  banner(key) { showBanner(this.engine, this.text(key)); }

  card(opts) {
    return this.world.show(new Card({ ...opts, kicker: opts.kicker && this.text(opts.kicker, opts.vars), title: opts.title && this.text(opts.title), sub: opts.sub && this.text(opts.sub) }));
  }

  // Pushes any scene (a puzzle, a minigame) and resolves with its result.
  play(scene) {
    if (this.engine.fx.fade > 0.99 && !scene.aboveFade) {
      this.world.lint(`black:${scene.constructor?.name}`, `a scene (${scene.constructor?.name || 'anonymous'}) was pushed while the screen is faded to black: it plays unseen. fadeIn first, or give the scene aboveFade = true.`);
    }
    return this.world.show(scene);
  }

  // Writes the save slot. Called by the menu and by chapters at safe points.
  persist() {
    const p = this.player;
    this.world.city.snapshot();
    const v = this.world.driving;
    if (v?.keep && v.id) this.save.driving = v.id; else delete this.save.driving;
    Object.assign(this.save, { map: this.world.mapId, x: p.x, y: p.y, dir: p.dir, heading: p.heading, playerDoll: p.dollId, at: Date.now() });
    this.world.game.saveSlot.write(this.save, this.world.game);
  }

  async autosave() { this.persist(); }

  dress(dollId) { this.player?.setLook(dollId); this.save.playerDoll = dollId; }

  async pauseMenu() {
    const items = [
      { id: 'resume', label: t('console.menu.resume') },
      { id: 'save', label: t('console.menu.save') },
      { id: 'options', label: t('console.menu.options') },
      { id: 'report', label: t('console.menu.report') },
      { id: 'title', label: t('console.menu.title') },
    ];
    if (this.world.game.log) items.splice(1, 0, { id: 'log', label: t('console.menu.log') });
    if (this.world.map.minimap ?? this.world.game.minimap) items.splice(1, 0, { id: 'map', label: t('console.menu.map') });
    if (this.save.quests?.length || this.world.game.collections) items.splice(1, 0, { id: 'journal', label: t('console.menu.journal') });
    if (this.world.game.menuItems) items.splice(1, 0, ...this.world.game.menuItems(this));
    sfx('cursor');
    // the screen as the player saw it, before the menu covers it: a report takes it along
    let shot = null;
    try { shot = this.engine.snapshot(); } catch { /* a tainted canvas: no picture */ }
    const obj = this.save.objective ? this.text(this.save.objective) : '';
    const id = await this.engine.push(new Menu(items, { objective: obj, title: obj ? t('console.menu.objective') : '' }));
    if (id === 'map') {
      await this.engine.push(new MapScreen(this.world));
    } else if (id === 'options') {
      await this.optionsMenu();
    } else if (id === 'journal') {
      await this.journal();
    } else if (id === 'log') {
      await this.showLog();
    } else if (id === 'save') {
      this.persist();
      sfx('save');
      await this.say(null, 'console.menu.saved', { style: 'box' });
    } else if (id === 'report') {
      // the save as it is now, so whoever looks can stand where the player stands
      this.persist();
      const p = this.player;
      await reportProblem({ game: this.world.game.id, map: this.world.mapId, x: p.x, y: p.y, objective: obj,
        save: localStorage.getItem(this.world.game.saveSlot.key) || '', shot });
    } else if (id === 'title') {
      const i = await this.ask(null, 'console.menu.title_confirm', ['console.menu.yes', 'console.menu.no']);
      if (i === 0) this.world.game.quit();
    } else if (id && this.world.game.onMenu) {
      await this.world.game.onMenu(this, id);
    }
  }

  // The settings: how the console looks, sounds, reads and vibrates. Kept per device.
  optionsMenu() {
    const game = this.world.game.id;
    const items = [
      ...(isWeb() ? [] : [{ id: 'view', label: t('console.menu.view'), value: () => t(isFull() ? 'console.menu.view_full' : 'console.menu.view_shell'), toggle: () => setFull(!isFull()) }]),
      ...(hdSupported() ? [{ id: 'graphics', label: t('console.menu.graphics'), value: () => t(hdOn() ? 'console.menu.graphics_modern' : 'console.menu.graphics_classic'), toggle: () => setHd(!hdOn()) }] : []),
      // the modern look from above: leaning, or straight over the map as the classic screen (kept per device)
      ...(hdSupported() && hdOn() && !this.world.thirdPerson ? [{ id: 'angle', label: t('console.menu.angle'), value: () => t(hdOverhead() ? 'console.menu.angle_overhead' : 'console.menu.angle_tilted'), toggle: () => setHdOverhead(!hdOverhead()) }] : []),
      // the map from behind the player, where the cartridge leaves it to them (kept per game)
      ...(this.world.eyesChoice ? [{ id: 'camera', label: t('console.menu.camera'), value: () => t(`console.menu.camera_${viewChoice(game)}`), toggle: () => setViewChoice(game, nextView(viewChoice(game))) }] : []),
      // in third person, how far behind and how high the camera is: left and right, or A
      // round the steps
      ...(this.world.thirdPerson ? ['far', 'high'].map((k) => ({ id: `camera_${k}`, label: t(`console.menu.camera_${k}`),
        value: () => `◀ ${thirdCamera(game)[k] + 1} ▶`,
        step: (d) => setThirdCamera(game, k, thirdCamera(game)[k] + d),
        toggle: () => setThirdCamera(game, k, (thirdCamera(game)[k] + 1) % THIRD_STEPS[k].length) })) : []),
      { id: 'sound', label: t('console.menu.sound'), value: () => t(isMuted() ? 'console.menu.off' : 'console.menu.on'), toggle: () => setMuted(!isMuted()) },
      // real instruments or the console's own, in a game that has an orchestra
      ...(hasOrchestra() ? [{ id: 'real', label: t('console.menu.instruments'), value: () => t(realOn() ? 'console.menu.instruments_real' : 'console.menu.instruments_chip'), toggle: () => setReal(!realOn()) }] : []),
      { id: 'text', label: t('console.menu.text'), value: () => t(`console.menu.text_${textSpeed()}`), toggle: () => setTextSpeed({ slow: 'normal', normal: 'fast', fast: 'slow' }[textSpeed()]) },
      ...(this.game.guide !== false ? [{ id: 'guide', label: t('console.menu.guide'), value: () => t(guideOn() ? 'console.menu.on' : 'console.menu.off'), toggle: () => setGuide(!guideOn()) }] : []),
      ...(canRumble() ? [{ id: 'rumble', label: t('console.menu.rumble'), value: () => t(rumbleOn() ? 'console.menu.on' : 'console.menu.off'), toggle: () => { setRumble(!rumbleOn()); rumble(60); } }] : []),
      { id: 'back', label: t('console.menu.back') },
    ];
    return this.engine.push(new Menu(items, {}));
  }

  // ---------- journal, collections, credits ----------

  // Quests, in the journal of the START menu. Texts: quests.<id>.title and
  // quests.<id>.note (and quests.<id>.done / .failed to read once it's over).
  // state: 'open' | 'done' | 'failed'. A banner and a sound mark each change.
  quest(id, state = 'open', { quiet = false } = {}) {
    const list = (this.save.quests ||= []);
    const q = list.find((x) => x.id === id);
    if (q?.state === state) return;
    if (q) q.state = state; else list.push({ id, state });
    if (quiet) return;
    sfx(state === 'done' ? 'item' : state === 'failed' ? 'error' : 'confirm');
    showBanner(this.engine, t(`console.journal.banner_${state}`, { name: this.text(`quests.${id}.title`) }));
  }
  questState(id) { return this.save.quests?.find((q) => q.id === id)?.state ?? null; }

  // Things to find: game.collections = { shells: { name: 'col.shells', total: 12 } }.
  // collect() marks one (once), plays a sound, shows "Conchas 3/12" and returns the count.
  collect(set, id, { quiet = false } = {}) {
    const k = `got.${set}.${id}`;
    if (this.is(k)) return this.collected(set);
    this.set(k);
    const n = this.collected(set);
    if (!quiet) {
      sfx('item');
      const c = this.game.collections?.[set];
      const name = c ? this.text(c.name) : set;
      showBanner(this.engine, c?.total ? t('console.journal.found', { name, n, total: c.total }) : t('console.journal.found_open', { name, n }));
    }
    return n;
  }
  collected(set) {
    const p = `got.${set}.`;
    return Object.keys(this.flags).filter((k) => k.startsWith(p) && this.flags[k]).length;
  }

  async journal() {
    const qs = this.save.quests || [];
    const order = [...qs.filter((q) => q.state === 'open'), ...qs.filter((q) => q.state !== 'open')];
    const rows = order.map((q) => ({ label: `quests.${q.id}.title`, note: `console.journal.${q.state}` }));
    for (const [set, c] of Object.entries(this.game.collections || {})) {
      rows.push({ label: c.name, note: c.total ? `${this.collected(set)}/${c.total}` : String(this.collected(set)), disabled: true });
    }
    if (!rows.length) rows.push({ label: 'console.journal.empty', disabled: true });
    for (;;) {
      const k = await this.list(rows, { title: 'console.journal.title' });
      if (k < 0 || !order[k]) return;
      const q = order[k];
      const after = `quests.${q.id}.${q.state}`;
      await this.say(null, q.state !== 'open' && has(after) ? after : `quests.${q.id}.note`, { style: 'box' });
    }
  }

  // The end credits. lines: keys or text, or { title, names: [...] } groups. Then what
  // was found (game.collections) and the time played, then `end` (default "FIN").
  // opts: { lines, bg(ctx, frame), music, speed, end, stats: false }
  async credits(opts = {}) {
    const rows = [];
    for (const l of opts.lines || []) {
      if (typeof l === 'string') rows.push({ text: this.text(l) });
      else {
        if (l.title) rows.push({ text: this.text(l.title), kind: 'title' });
        for (const n of l.names || []) rows.push({ text: this.text(n), kind: 'name' });
      }
      rows.push({ kind: 'gap' });
    }
    if (opts.stats !== false) {
      const cols = Object.entries(this.game.collections || {});
      if (cols.length) {
        rows.push({ text: t('console.credits.found'), kind: 'title' });
        for (const [set, c] of cols) rows.push({ text: `${this.text(c.name)}  ${this.collected(set)}${c.total ? `/${c.total}` : ''}`, kind: 'name' });
        rows.push({ kind: 'gap' });
      }
      const m = Math.floor((this.save.time || 0) / 60);
      rows.push({ text: t('console.credits.time'), kind: 'title' });
      rows.push({ text: m >= 60 ? t('console.credits.hours', { h: Math.floor(m / 60), m: m % 60 }) : t('console.credits.minutes', { m }), kind: 'name' });
    }
    if (opts.music !== undefined) music(opts.music);
    await this.world.show(new Credits(rows, { bg: opts.bg, speed: opts.speed, end: opts.end ? this.text(opts.end) : t('console.credits.end') }));
  }

  // Ends the cartridge's story: back to its title screen.
  end() { this.world.game.quit(); }
}

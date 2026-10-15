// Visual effects on a map: bursts of particles (a cloud of smoke, sparkles, embers,
// debris…) placed on a person, a cell or a pixel; emitters that keep puffing (a chimney,
// someone wrapped in shadow); the looks a person can take for a moment (fading in or out,
// a flash of colour over the body, afterimages); and the camera's own effects (zoom,
// a wave over the picture). All of it is decoration: nothing here is saved, and what is
// still in the air when the map changes is dropped (README "Visual effects").
import { SCREEN_W, SCREEN_H, TILE, canvas } from './gfx.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const palette = (o, def) => (o.color ? (Array.isArray(o.color) ? o.color : [o.color]) : def);

// A particle: where it is (map pixels), how it moves, how long it lives and how it looks.
// shape: px dot disc ring star streak heart leaf halo. `colors` are walked over its life;
// `shade` gives a disc an underside; `add` makes it light (drawn after the dark).
function particle(p) {
  return { vx: 0, vy: 0, g: 0, drag: 1, swirl: 0, wob: 0, ph: Math.random() * 6.28, life: 30, age: 0, size: 1, grow: 0,
    alpha: 1, shape: 'dot', twinkle: false, shade: false, floor: null, add: false, ...p };
}

// Radial bursts share a shape: n particles out from the centre at speeds in [s0, s1].
function radial(o, n, s0, s1, extra) {
  const out = [];
  const k = Math.max(1, Math.round(n * (o.amount ?? 1)));
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2 + rand(-0.3, 0.3);
    const s = rand(s0, s1) * (o.scale ?? 1);
    out.push(particle({ x: o.x, y: o.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7, ...extra(i, a) }));
  }
  return out;
}

const n = (o, k) => Math.max(1, Math.round(k * (o.amount ?? 1)));
const sc = (o) => o.scale ?? 1;

// The engine's effects. A cartridge adds its own as `game.fx = { name: (o) => [particles] }`,
// o = { x, y, color, amount, scale } (x, y the centre in map pixels), built with `particle`.
export const PRESETS = {
  // a cloud bursting out and thinning: someone appears or goes, something lands
  poof: (o) => {
    const c = palette(o, ['#ffffff', '#e4e4ec', '#bcbcca', '#8c8c9c']);
    return [
      ...radial(o, 16, 0.8, 1.5, () => ({ drag: 0.9, vy: rand(-0.3, 0), life: rand(28, 40), size: 3 * sc(o), grow: 0.1 * sc(o), colors: c, shape: 'disc', shade: true })),
      ...Array.from({ length: n(o, 5) }, () => particle({ x: o.x + rand(-5, 5), y: o.y + rand(-7, 5), vy: -0.15, life: rand(32, 44), size: 5 * sc(o), grow: 0.05, colors: c, shape: 'disc', shade: true })),
    ];
  },
  // rising and spreading, slow: a chimney, a fire put out, a smoking ruin (an emitter)
  smoke: (o) => Array.from({ length: n(o, 3) }, () => particle({ x: o.x + rand(-2, 2), y: o.y, vx: rand(-0.12, 0.12) + (o.wind ?? 0.08), vy: rand(-0.45, -0.25),
    life: rand(55, 80), size: 1, grow: 0.06 * sc(o), wob: 0.15, alpha: 0.75, colors: palette(o, ['#d8d8dc', '#a8a8b0', '#78787f']), shape: 'disc', shade: true })),
  // dark wisps spiralling: shadows, darkness, a teleport out of the night
  shadow: (o) => {
    const c = palette(o, ['#3c2a58', '#24183a', '#120a1e', '#000000']);
    return [
      ...radial(o, 18, 0.6, 1.3, (i) => ({ drag: 0.93, swirl: 0.08, life: rand(28, 42), size: rand(1.5, 3) * sc(o), grow: 0.05, colors: c, shape: i % 3 ? 'disc' : 'streak' })),
      ...Array.from({ length: n(o, 5) }, () => particle({ x: o.x + rand(-3, 3), y: o.y + rand(-6, 4), vy: -0.2, life: rand(20, 30), size: 4 * sc(o), grow: 0.08, alpha: 0.85, colors: c, shape: 'disc' })),
    ];
  },
  // stars that wink around a point: something precious, a wish, a spell landing softly
  sparkle: (o) => Array.from({ length: n(o, 10) }, () => particle({ x: o.x + rand(-10, 10) * sc(o), y: o.y + rand(-12, 8) * sc(o), vy: rand(-0.25, 0),
    life: rand(18, 40), size: pick([1, 2, 2, 3]), twinkle: true, colors: palette(o, ['#ffffff', '#fff2a8', '#ffd860']), shape: 'star' })),
  // motes rising in a spiral and a ring at the feet: magic being worked
  magic: (o) => {
    const c = palette(o, ['#ffffff', '#c8a0ff', '#8ad8ff', '#6a50d0']);
    return [
      ...Array.from({ length: n(o, 22) }, (_, i) => {
        const a = (i / n(o, 22)) * Math.PI * 2;
        return particle({ x: o.x + Math.cos(a) * 8 * sc(o), y: o.y + 6 + Math.sin(a) * 3, vx: -Math.sin(a) * 0.4, vy: rand(-0.9, -0.4), swirl: 0.06, drag: 0.98,
          life: rand(30, 50), size: pick([1, 2, 2]), twinkle: true, colors: c, shape: 'dot', add: true });
      }),
      particle({ x: o.x, y: o.y + 7, life: 22, size: 3, grow: 0.7 * sc(o), colors: [c[1] || c[0]], shape: 'ring', flat: true }),
    ];
  },
  // a low puff along the ground: a landing, a stamp, a heavy thing set down
  dust: (o) => radial(o, 10, 0.5, 1.2, () => ({ vy: rand(-0.25, 0), drag: 0.9, life: rand(16, 26), size: 1.5 * sc(o), grow: 0.08, alpha: 0.8,
    colors: palette(o, ['#f0e8d8', '#d0c4a8', '#a89c80']), shape: 'disc' })).map((p) => ({ ...p, vy: p.vy * 0.3 })),
  // sparks rising and flickering: fire, a forge, anger made visible (an emitter by a fire)
  embers: (o) => Array.from({ length: n(o, 8) }, () => particle({ x: o.x + rand(-6, 6) * sc(o), y: o.y + rand(-2, 4), vx: rand(-0.2, 0.2), vy: rand(-0.9, -0.4),
    wob: 0.25, life: rand(30, 60), size: pick([1, 1, 2]), twinkle: true, add: true, colors: palette(o, ['#fff0a0', '#ffb040', '#ff6020', '#a02010']), shape: 'px' })),
  // pieces flying out and falling, bouncing once: something breaks, a wall bursts
  shards: (o) => radial(o, 14, 1, 2.4, () => ({ vy: rand(-3, -1.2) * sc(o), g: 0.16, floor: o.y + rand(6, 12), life: rand(40, 60), size: pick([1, 2, 2, 3]),
    colors: palette(o, ['#b8a890', '#8a7a68', '#5a4c3e']), shape: 'dot' })),
  // drops thrown up and falling back: something falls in water, a wave breaks
  splash: (o) => [
    ...radial(o, 12, 0.5, 1.2, () => ({ vy: rand(-2.6, -1.4) * sc(o), g: 0.15, life: rand(22, 34), size: pick([1, 1, 2]), colors: palette(o, ['#ffffff', '#b8e0ff', '#5898d8']), shape: 'dot' })),
    particle({ x: o.x, y: o.y + 4, life: 20, size: 2, grow: 0.6 * sc(o), colors: ['#d8f0ff'], alpha: 0.8, shape: 'ring', flat: true }),
  ],
  // bubbles rising and swaying: someone under water, a pot boiling, a fish below
  bubbles: (o) => Array.from({ length: n(o, 3) }, (_, i) => particle({ x: o.x + rand(-3, 3) * sc(o), y: o.y - i * 2, vy: rand(-0.55, -0.3), wob: 0.3, life: rand(30, 48),
    size: pick([1, 1, 2]), alpha: 0.85, colors: palette(o, ['#e8f8ff', '#a8d8f0']), shape: 'dot' })),
  // hearts floating up: love, a crush, a kiss
  hearts: (o) => Array.from({ length: n(o, 4) }, (_, i) => particle({ x: o.x + rand(-6, 6), y: o.y - 4 - i * 3, vy: rand(-0.6, -0.35), wob: 0.35, life: rand(40, 60),
    colors: palette(o, ['#ff6088', '#ff90b0']), shape: 'heart' })),
  // leaves or petals falling and swaying: wind, a tree shaken, spring (`color` for petals)
  leaves: (o) => Array.from({ length: n(o, 8) }, () => particle({ x: o.x + rand(-14, 14) * sc(o), y: o.y - rand(10, 22), vx: rand(0.1, 0.3), vy: rand(0.25, 0.45), wob: 0.5,
    life: rand(60, 90), colors: [pick(palette(o, ['#5aa040', '#8ac050', '#c8b040', '#d07a30']))], shape: 'leaf' })),
  // a ring spreading on the ground: a shockwave, a stomp, power released
  ring: (o) => [particle({ x: o.x, y: o.y + 6, life: 22, size: 2, grow: 1.4 * sc(o), colors: palette(o, ['#ffffff', '#c0d8ff']), shape: 'ring', flat: true })],
  // lines shooting out from a point: a hit, an impact, a realisation
  burst: (o) => radial(o, 10, 2.2, 3.2, () => ({ drag: 0.82, life: rand(9, 14), size: 3, colors: palette(o, ['#ffffff', '#fff2a8']), shape: 'streak' })),
  // fire, a blast ring and smoke left hanging: a vehicle blowing up, a gas tank, a bomb
  explosion: (o) => [
    ...radial(o, 22, 1.2, 3, () => ({ drag: 0.86, life: rand(16, 28), size: 3 * sc(o), grow: 0.18, colors: palette(o, ['#ffffff', '#fff0a0', '#ffa030', '#e04010', '#602010']), shape: 'disc', add: true })),
    ...radial(o, 12, 0.3, 0.9, () => ({ drag: 0.95, vy: rand(-0.5, -0.2), life: rand(50, 80), size: 4 * sc(o), grow: 0.1, alpha: 0.8, colors: ['#6a626a', '#4a424c', '#2e2830'], shape: 'disc' })),
    ...radial(o, 10, 1.5, 3, () => ({ vy: rand(-3, -1.5), g: 0.16, floor: o.y + rand(6, 14), life: rand(40, 60), size: pick([1, 2]), colors: ['#3a3436', '#5a5254'], shape: 'dot' })),
    particle({ x: o.x, y: o.y + 4, life: 18, size: 4, grow: 2 * sc(o), colors: ['#fff0c0', '#ffa030'], shape: 'ring', flat: true }),
  ],
  // a spray of hot sparks: metal on metal, a bullet on a wall
  sparks: (o) => radial(o, 7, 0.8, 2.2, () => ({ drag: 0.85, life: rand(6, 12), size: 1, colors: palette(o, ['#ffffff', '#fff2a8', '#ffb040']), shape: 'dot', add: true })),
  // the flash at a gun's mouth
  muzzle: (o) => [particle({ x: o.x, y: o.y, life: 4, size: 3, colors: palette(o, ['#fff8c0', '#ffd060']), shape: 'disc', add: true })],
  // light swelling and fading: a blessing, a glow of power, something revealed
  glow: (o) => [particle({ x: o.x, y: o.y, life: 40, size: 4, grow: 0.5 * sc(o), alpha: 0.45, add: true, colors: palette(o, ['#fff8d0', '#ffd860']), shape: 'halo' })],
};

// How an animation runs from 0 to 1 (api.animate, api.zoom, api.wave).
export const EASE = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
  back: (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2,
  bounce: (t) => { const k = 1 - t; return 1 - Math.abs(Math.cos(t * Math.PI * 2.5)) * k * k; },
  step: (t) => Math.floor(t * 4) / 4,
};

export const hasPreset = (game, name) => !!(game.fx?.[name] || PRESETS[name]);
export { particle };

// How hard a burst is, in pixels: a cell's people stand on its bottom, their middle 8 px up.
export class Effects {
  constructor(world) {
    this.world = world;
    this.list = [];         // live particles
    this.ghosts = [];       // afterimages
    this.emitters = [];     // { at, name, opts, every, next, stopped }
    this.last = 0;
    this.zoom = 1;
    this.zoomAt = null;
    this.wave = 0;          // pixels a row moves at most
    this.tmp = canvas(64, 64);
  }

  // A new map: what was in the air stays behind.
  clear() {
    this.list = [];
    this.ghosts = [];
    this.emitters = [];
    this.zoom = 1;
    this.zoomAt = null;
    this.wave = 0;
  }

  // Where something is, in map pixels: a person's middle, a cell's centre, or pixels.
  // `feet: true` gives the bottom of the cell instead (dust, rings).
  point(at, feet = false) {
    const w = this.world;
    if (at == null) return null;
    if (typeof at === 'string' || (typeof at === 'object' && at.def && 'px' in at)) {
      const a = typeof at === 'string' ? w.actor(at) : at;
      if (!a) return null;
      return { x: a.px + 8 + a.ox, y: a.py - (a.ez || 0) + (feet ? 14 : 6) + a.oy - (a.lift || 0) - Math.round(a.alt || 0) };
    }
    if (Array.isArray(at)) return { x: at[0] * TILE + 8, y: at[1] * TILE + (feet ? 14 : 8) - w.elev(at[0], at[1]) };
    if ('px' in at) return { x: at.px, y: at.py };
    if ('x' in at) return { x: at.x * TILE + 8, y: at.y * TILE + (feet ? 14 : 8) - w.elev(at.x, at.y) };
    return null;
  }

  // One burst. Returns how long it lasts, in frames, so a script can wait for it.
  burst(name, at, opts = {}) {
    const w = this.world;
    const fn = w.game.fx?.[name] || PRESETS[name];
    if (!fn) { w.lint(`fx:${name}`, `unknown effect: ${name}. The engine has ${Object.keys(PRESETS).join(' ')}; a cartridge adds its own in game.fx.`); return 0; }
    const low = name === 'dust' || name === 'ring' || name === 'splash';
    const p = this.point(at, opts.feet ?? low);
    if (!p) return 0;
    const made = fn({ ...opts, x: p.x + (opts.dx || 0), y: p.y + (opts.dy || 0) }) || [];
    const front = opts.front ?? !low;
    let longest = 0;
    for (const q of made) {
      q.front = q.flat ? false : front;
      q.colors ||= ['#ffffff'];
      longest = Math.max(longest, q.life);
    }
    if (this.list.length + made.length > 400) this.list.splice(0, this.list.length + made.length - 400);
    this.list.push(...made);
    return longest;
  }

  // Keeps bursting `name` at `at` every `every` ms until stopped (or the map changes).
  emit(name, at, opts = {}) {
    const em = { name, at, opts, every: Math.max(1, (opts.every ?? 200) / 16.67), next: 0, stopped: false, when: opts.when };
    em.stop = () => { em.stopped = true; };
    this.emitters.push(em);
    return em;
  }

  tick(e) {
    const f = e.frame;
    const steps = Math.min(4, f - this.last || 1);
    this.last = f;
    const w = this.world;
    for (const em of this.emitters) {
      if (em.stopped || f < em.next) continue;
      em.next = f + em.every;
      if (em.when && !em.when(w.api)) continue;
      if (typeof em.at === 'string' && !w.actor(em.at)?.visible) continue;
      this.burst(em.name, em.at, em.opts);
    }
    this.emitters = this.emitters.filter((em) => !em.stopped);
    for (let s = 0; s < steps; s++) {
      for (const p of this.list) {
        p.age++;
        if (p.swirl) { const c = Math.cos(p.swirl), si = Math.sin(p.swirl); [p.vx, p.vy] = [p.vx * c - p.vy * si, p.vx * si + p.vy * c]; }
        p.vx *= p.drag;
        p.vy = p.vy * p.drag + p.g;
        p.x += p.vx + (p.wob ? Math.sin(p.ph + p.age * 0.12) * p.wob : 0);
        p.y += p.vy;
        if (p.floor != null && p.y > p.floor && p.vy > 0) { p.y = p.floor; p.vy *= -0.35; p.vx *= 0.6; if (Math.abs(p.vy) < 0.3) { p.vy = 0; p.g = 0; } }
      }
      this.list = this.list.filter((p) => p.age < p.life);
    }
    // afterimages: a copy of the body every few frames while `trail` is on
    if (f % 3 === 0) {
      for (const a of w.actors) {
        if (!a.trail || !a.visible || (!a.moving && !a.strolling && !a.trail.still)) continue;
        const img = a.image();
        if (!img) continue;
        this.ghosts.push({ img, x: a.px + (TILE - img.width) / 2 + a.ox, y: a.py - (a.ez || 0) + TILE - img.height - 1 + a.oy - (a.lift || 0) - Math.round(a.alt || 0), born: f, color: a.trail.color, life: a.trail.life || 14 });
      }
    }
    this.ghosts = this.ghosts.filter((g) => f - g.born < g.life);
  }

  // layer: 'back' under the people (rings on the ground, afterimages), 'front' over them
  // (smoke, debris) and 'light' after the dark, for what shines (sparks, magic, a glow).
  draw(ctx, cx, cy, layer) {
    const f = this.world.engine.frame;
    if (!this.list.length && !this.ghosts.length) return;
    if (layer === 'back') {
      for (const g of this.ghosts) {
        const k = 1 - (f - g.born) / g.life;
        this.body(ctx, g.img, Math.round(g.x - cx), Math.round(g.y - cy), 0.45 * k, g.color ? { color: g.color, k: 0.7 } : null);
      }
    }
    for (const p of this.list) {
      if ((layer === 'back') !== !p.front || (p.front && (layer === 'light') !== !!p.add)) continue;
      const t = p.age / p.life;
      const color = p.colors[Math.min(p.colors.length - 1, Math.floor(t * p.colors.length))];
      let a = p.alpha * (t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
      if (p.twinkle && (p.age + Math.floor(p.ph * 10)) % 6 < 2) a *= 0.3;
      if (a <= 0.02) continue;
      // stepped alpha, like the fades: it reads as the console's, not as a browser blur
      ctx.globalAlpha = Math.ceil(a * 6) / 6;
      if (p.add) ctx.globalCompositeOperation = 'lighter';
      const x = Math.round(p.x - cx);
      const y = Math.round(p.y - cy);
      const r = Math.max(0, p.size + p.grow * p.age);
      // a cloud has an underside: the next colour down, one pixel lower
      if (p.shade) { ctx.fillStyle = p.colors[Math.min(p.colors.length - 1, p.colors.indexOf(color) + 1)]; disc(ctx, x, y + 1, r); }
      ctx.fillStyle = color;
      shape(ctx, p, x, y, r);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  // A body drawn with its looks: see-through (`alpha`), covered by a colour (`tint`).
  body(ctx, img, x, y, alpha = 1, tint = null) {
    if (alpha <= 0) return;
    let src = img;
    if (tint && tint.k > 0) {
      if (this.tmp.width < img.width || this.tmp.height < img.height) this.tmp = canvas(Math.max(64, img.width), Math.max(64, img.height));
      const t = this.tmp.getContext('2d');
      t.clearRect(0, 0, this.tmp.width, this.tmp.height);
      t.globalCompositeOperation = 'source-over';
      t.drawImage(img, 0, 0);
      t.globalCompositeOperation = 'source-atop';
      t.globalAlpha = Math.min(1, tint.k);
      t.fillStyle = tint.color;
      t.fillRect(0, 0, img.width, img.height);
      t.globalAlpha = 1;
      t.globalCompositeOperation = 'source-over';
      src = this.tmp;
    }
    ctx.globalAlpha = alpha >= 1 ? 1 : Math.ceil(alpha * 8) / 8;
    ctx.drawImage(src, 0, 0, img.width, img.height, x, y, img.width, img.height);
    ctx.globalAlpha = 1;
  }

  // The camera's own: a zoom on a point, then a wave over the picture (dreams, heat, a
  // spell bending the air). Runs after the map, its light and the bubbles over heads.
  post(ctx, cx, cy, frame) {
    if (this.zoom > 1.001) {
      const p = this.point(this.zoomAt) || { x: cx + SCREEN_W / 2, y: cy + SCREEN_H / 2 };
      const sw = SCREEN_W / this.zoom;
      const sh = SCREEN_H / this.zoom;
      const sx = Math.max(0, Math.min(SCREEN_W - sw, p.x - cx - sw / 2));
      const sy = Math.max(0, Math.min(SCREEN_H - sh, p.y - cy - sh / 2));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, SCREEN_W, SCREEN_H);
    }
    if (this.wave > 0.2) {
      for (let y = 0; y < SCREEN_H; y += 2) {
        const dx = Math.round(Math.sin(y / 9 + frame / 8) * this.wave);
        if (dx) ctx.drawImage(ctx.canvas, 0, y, SCREEN_W, 2, dx, y, SCREEN_W, 2);
      }
    }
  }
}

// A disc in pixel steps: rows of rects, no anti-aliased edge.
function disc(ctx, x, y, r) {
  r = Math.round(r);
  if (r <= 0) { ctx.fillRect(x, y, 1, 1); return; }
  for (let j = -r; j <= r; j++) {
    const w = Math.round(Math.sqrt(r * r - j * j));
    ctx.fillRect(x - w, y + j, w * 2 + 1, 1);
  }
}

function shape(ctx, p, x, y, s) {
  switch (p.shape) {
    case 'px': ctx.fillRect(x, y, 1, 1); return;
    case 'disc': disc(ctx, x, y, s); return;
    case 'halo': {
      const a = ctx.globalAlpha;
      for (let k = 3; k >= 1; k--) { ctx.globalAlpha = a * (0.35 / k + 0.1); disc(ctx, x, y, (s * k) / 3); }
      ctx.globalAlpha = a;
      return;
    }
    case 'ring': {
      // flattened: it lies on the ground
      const r = Math.round(s);
      const k = Math.max(8, Math.round(r * 6));
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2;
        ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r * (p.flat ? 0.45 : 1)), 1, 1);
      }
      return;
    }
    case 'star': {
      const r = Math.round(s);
      ctx.fillRect(x - r, y, r * 2 + 1, 1);
      ctx.fillRect(x, y - r, 1, r * 2 + 1);
      return;
    }
    case 'streak': {
      const sp = Math.hypot(p.vx, p.vy) || 1;
      const len = Math.max(2, Math.round(s + sp * 2));
      for (let i = 0; i < len; i++) ctx.fillRect(Math.round(x - (p.vx / sp) * i), Math.round(y - (p.vy / sp) * i), 1, 1);
      return;
    }
    case 'heart':
      ctx.fillRect(x - 2, y - 1, 2, 1); ctx.fillRect(x + 1, y - 1, 2, 1);
      ctx.fillRect(x - 2, y, 5, 1); ctx.fillRect(x - 1, y + 1, 3, 1); ctx.fillRect(x, y + 2, 1, 1);
      return;
    case 'leaf':
      if (Math.floor(p.age / 10) % 2) { ctx.fillRect(x, y, 2, 1); ctx.fillRect(x + 1, y + 1, 1, 1); }
      else { ctx.fillRect(x, y, 1, 2); ctx.fillRect(x + 1, y, 1, 1); }
      return;
    default: {
      const r = Math.max(1, Math.round(s));
      ctx.fillRect(x - (r >> 1), y - (r >> 1), r, r);
    }
  }
}

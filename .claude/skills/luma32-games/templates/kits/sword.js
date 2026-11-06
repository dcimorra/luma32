// Kit: action combat with a blade, seen from above. Code to copy beside game.js and make
// the game's own (the reach, the hearts, the enemies, how it all looks), not a library the
// engine knows. Nothing in the console asks a game to use it.
//
// In game.js:
//   import { blade, foe } from './sword.js';
//   const combat = blade({ hearts: 3, onDeath: async (api) => { … } });
//   export default { movement: 'free', actionA: true,
//     update: (api, e, control) => combat.update(api, e, control),
//     hud: (ctx, api, e) => combat.hud(ctx, api, e), … };
//   and in a map's enter: api.addEntity(foe({ x: 9 * 16, y: 5 * 16, hp: 2, chase: 0.6 }));
//
// The player's health is in the flags (`hp`, `hpMax`, in half hearts), so a reload keeps it.
// A on its own swings: give talking another button, or leave `actionA` off on the maps
// where nobody fights. Uses only the engine's entity API (README "Action games").

const FACING = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export function blade({
  hearts = 3,          // the starting maximum
  damage = 1,          // what a swing takes off a foe's hp
  reach = 14,          // pixels in front of the hitbox the swing covers
  frames = 12,         // how long a swing lasts
  cooldown = 6,        // frames after it before the next
  invulnerable = 60,   // frames the player can't be hurt again after a hit
  knock = 3,           // pixels a frame a hit pushes the one hit, falling off
  color = '#f8f0d8',   // the swing's arc
  heart = '#e04040', heartBack = '#401018',
  onDeath = null,      // async (api) when the hearts run out; by default refilled where they stand
} = {}) {
  let swing = null;    // { t, dir, hit: Set }
  let rest = 0;
  let safe = 0;
  let push = null;     // the player knocked back: { x, y }

  const hp = (api) => api.get('hp') ?? hearts * 2;
  const max = (api) => api.get('hpMax') ?? hearts * 2;

  function hurt(api, n, from) {
    if (safe > 0 || n <= 0) return;
    api.set('hp', Math.max(0, hp(api) - n));
    api.sfx('thud');
    api.rumble?.(60);
    safe = invulnerable;
    const p = api.box('player');
    const f = from && api.box(from);
    if (f) {
      const dx = p.x + p.w / 2 - (f.x + f.w / 2);
      const dy = p.y + p.h / 2 - (f.y + f.h / 2);
      const d = Math.hypot(dx, dy) || 1;
      push = { x: (dx / d) * knock, y: (dy / d) * knock };
    }
    // out of hearts: the game's own scene (a fade, back to the last door), as a script
    if (hp(api) <= 0) api.world.run(async (a) => { if (onDeath) await onDeath(a); else a.set('hp', max(a)); });
  }

  function heal(api, n) { api.set('hp', Math.min(max(api), hp(api) + n)); }

  // The swing's box: in front of the player's hitbox, as wide as it is.
  function area(api, dir) {
    const b = api.box('player');
    const [dx, dy] = FACING[dir];
    if (dx) return { x: dx > 0 ? b.x + b.w : b.x - reach, y: b.y - 4, w: reach, h: b.h + 8 };
    return { x: b.x - 4, y: dy > 0 ? b.y + b.h : b.y - reach, w: b.w + 8, h: reach };
  }

  function update(api, e, control) {
    if (safe > 0) safe--;
    const p = api.player;
    p.alpha = safe > 0 && Math.floor(safe / 4) % 2 ? 0.35 : 1;
    if (!control) { end(api); return; }
    if (push) {
      api.move('player', push.x, push.y);
      push.x *= 0.75; push.y *= 0.75;
      if (Math.abs(push.x) + Math.abs(push.y) < 0.3) push = null;
    }
    if (rest > 0) rest--;
    if (!swing && !rest && e.input.pressed('a')) {
      swing = { t: 0, dir: p.dir, hit: new Set() };
      // the swing is an entity, so both looks draw it with the world
      swing.mark = api.addEntity({ ...area(api, swing.dir), solid: false, draw: (ctx, sx, sy) => drawSwing(ctx, sx, sy, swing) });
      api.sfx('shot');
    }
    if (swing) {
      swing.t++;
      const a = area(api, swing.dir);
      Object.assign(swing.mark, a);
      for (const en of api.entities) {
        if (!en.foe || en.removed || swing.hit.has(en)) continue;
        const b = api.box(en);
        if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
          swing.hit.add(en);
          const [dx, dy] = FACING[swing.dir];
          en.kb = { x: dx * knock * 1.5, y: dy * knock * 1.5 };
          en.flash = 10;
          api.sfx('bump');
          api.damage(en, damage, 'player');
        }
      }
      if (swing.t >= frames) { end(api); rest = cooldown; }
    }
    // foes that touch the player hurt them
    for (const en of api.entities) {
      if (en.foe && !en.removed && en.touch !== 0 && api.overlaps(en, 'player')) hurt(api, en.touch ?? 1, en);
    }
  }

  function end(api) {
    if (swing?.mark) api.removeEntity(swing.mark);
    swing = null;
  }

  // A blade sweeping across its box, in whole pixels, fading at the end.
  function drawSwing(ctx, sx, sy, sw) {
    if (!sw) return;
    const k = sw.t / frames;
    const [dx] = FACING[sw.dir];
    const a = sw.mark;
    ctx.globalAlpha = k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3);
    ctx.fillStyle = color;
    const s = Math.round(k * ((dx ? a.h : a.w) - 2));
    if (dx) ctx.fillRect(Math.round(sx), Math.round(sy + s), a.w, 2);
    else ctx.fillRect(Math.round(sx + s), Math.round(sy), 2, a.h);
    ctx.globalAlpha = 1;
  }

  // Hearts at the top left.
  function hud(ctx, api) {
    const n = max(api) / 2;
    const h = hp(api);
    for (let i = 0; i < n; i++) {
      const x = 4 + i * 10;
      drawHeart(ctx, x, 4, heartBack);
      const fill = Math.max(0, Math.min(2, h - i * 2));
      if (fill === 2) drawHeart(ctx, x, 4, heart);
      else if (fill === 1) { ctx.save(); ctx.beginPath(); ctx.rect(x, 4, 4, 8); ctx.clip(); drawHeart(ctx, x, 4, heart); ctx.restore(); }
    }
  }

  return { update, hud, hurt, heal, hp, max, get swinging() { return !!swing; } };
}

function drawHeart(ctx, x, y, c) {
  ctx.fillStyle = c;
  ctx.fillRect(x + 1, y, 2, 1); ctx.fillRect(x + 5, y, 2, 1);
  ctx.fillRect(x, y + 1, 8, 3);
  ctx.fillRect(x + 1, y + 4, 6, 1);
  ctx.fillRect(x + 2, y + 5, 4, 1);
  ctx.fillRect(x + 3, y + 6, 2, 1);
}

// A foe: an entity the blade can hit. chase: its speed towards the player when it sees
// them (0 stands still); wander: its speed otherwise. touch: what touching it costs (half
// hearts; 0 harmless). draw(ctx, sx, sy, e, self) is the game's; the default is a blob.
export function foe({ x, y, w = 12, h = 12, hp = 2, chase = 0.5, wander = 0.3, sight = 96, touch = 1, color = '#60a040', draw = null, onDeath, stand = true, ...rest }) {
  return {
    x, y, w, h, hp, foe: true, touch, stand, solid: false, kb: null, flash: 0, t: Math.floor(Math.random() * 120),
    heading: Math.random() * Math.PI * 2,
    ...rest,
    onDeath,
    update(api, e, self) {
      self.t++;
      if (self.flash > 0) self.flash--;
      if (self.kb) {
        api.move(self, self.kb.x, self.kb.y);
        self.kb.x *= 0.7; self.kb.y *= 0.7;
        if (Math.abs(self.kb.x) + Math.abs(self.kb.y) < 0.3) self.kb = null;
        return;
      }
      if (chase && api.sees(self, 'player', sight)) { api.seek(self, 'player', { speed: chase, stop: 0 }); return; }
      if (!wander) return;
      if (self.t % 90 === 0) self.heading = Math.random() * Math.PI * 2;
      const r = api.move(self, Math.cos(self.heading) * wander, Math.sin(self.heading) * wander);
      if (r.hitX || r.hitY) self.heading += Math.PI / 2;
    },
    draw: draw || ((ctx, sx, sy, e, self) => {
      const bob = Math.floor(self.t / 10) % 2;
      ctx.fillStyle = self.flash > 0 && self.flash % 4 < 2 ? '#ffffff' : color;
      ctx.fillRect(sx + 1, sy + 3 + bob, self.w - 2, self.h - 3 - bob);
      ctx.fillRect(sx + 3, sy + 1 + bob, self.w - 6, 2);
      ctx.fillStyle = '#101010';
      ctx.fillRect(sx + 3, sy + 5 + bob, 2, 2); ctx.fillRect(sx + self.w - 5, sy + 5 + bob, 2, 2);
    }),
  };
}

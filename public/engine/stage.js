// The stage: a full-screen backdrop with characters standing on it, for visual novels and
// story scenes that happen off the map. Dialogue, choices and cards are pushed on top as
// usual; the stage stays until it is closed.
//
//   const st = await api.stage({ bg: (ctx, frame) => {...}, music: 'theme' });
//   st.show('ana', { at: 'left', mood: 'smile' });   // fades in
//   await api.say('ana', 'cafe.ana_1', { mood: 'smile' });
//   st.mood('ana', 'sad'); st.hide('ana'); st.bg(otherFn);
//   await st.close();                                 // fades out, back to the map
//
// A character is game.figures[id](ctx, x, y, frame, mood): full-body art painted with its
// feet at (x, y), centred on x. Without a figure the character's doll stands in, scaled.
import { SCREEN_W, SCREEN_H } from './gfx.js';
import { faceState } from './ui.js';

const AT = { left: 56, center: SCREEN_W / 2, right: SCREEN_W - 56, farleft: 30, farright: SCREEN_W - 30 };
const FADE = 12;

export class Stage {
  constructor(world, { bg = null, floor = SCREEN_H - 50, scale = 3 } = {}) {
    this.world = world;
    this.backdrop = bg;
    this.floor = floor;      // where feet rest; the dialogue box covers the bottom 50 px
    this.scale = scale;      // doll stand-ins are drawn this many times larger
    this.cast = new Map();
    this.alpha = 0;          // the whole stage fades in on open and out on close
    this.closing = null;
    this.f = 0;
    this.pointer = true;     // nothing here waits on a button: no pad over it on a tablet
  }

  // ---------- scripts ----------

  bg(fn) { this.backdrop = fn; }

  show(id, { at = 'center', mood = null, flip = false } = {}) {
    const x = typeof at === 'number' ? at : AT[at] ?? AT.center;
    const prev = this.cast.get(id);
    this.cast.set(id, { id, x, mood, flip, a: prev ? prev.a : 0, leaving: false });
  }

  mood(id, mood) { const c = this.cast.get(id); if (c) c.mood = mood; }

  move(id, at) { const c = this.cast.get(id); if (c) c.to = typeof at === 'number' ? at : AT[at]; }

  hide(id) { const c = this.cast.get(id); if (c) c.leaving = true; }

  close() {
    return new Promise((resolve) => { this.closing = resolve; });
  }

  // ---------- scene ----------

  update() { this.tick(); }

  tick() {
    this.f++;
    if (this.closing) {
      this.alpha = Math.max(0, this.alpha - 1 / FADE);
      if (this.alpha === 0) { const r = this.closing; this.closing = null; this.done(); r(); }
    } else this.alpha = Math.min(1, this.alpha + 1 / FADE);
    for (const c of this.cast.values()) {
      c.a = c.leaving ? Math.max(0, c.a - 1 / FADE) : Math.min(1, c.a + 1 / FADE);
      if (c.to !== undefined) { c.x += Math.sign(c.to - c.x) * Math.min(3, Math.abs(c.to - c.x)); if (c.x === c.to) delete c.to; }
      if (c.leaving && c.a === 0) this.cast.delete(c.id);
    }
  }

  draw(ctx) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    // fades in steps, like the rest of the console
    const step = (a) => Math.round(a * 6) / 6;
    ctx.globalAlpha = step(this.alpha);
    this.backdrop?.(ctx, this.f);
    for (const c of this.cast.values()) {
      ctx.globalAlpha = step(this.alpha * c.a);
      this.figure(ctx, c);
    }
    ctx.globalAlpha = 1;
  }

  // Talking while the line on screen is theirs and still typing (see ui.js faceState).
  state(c) {
    const e = this.world.engine;
    const top = e.top();
    return faceState(e, !!(top?.speaker?.id === c.id && !top.complete && !(top.hold > 0)));
  }

  figure(ctx, c) {
    const fn = this.world.game.figures?.[c.id];
    const x = Math.round(c.x);
    if (fn) {
      if (c.flip) {
        ctx.save();
        ctx.translate(x * 2, 0);
        ctx.scale(-1, 1);
        fn(ctx, x, this.floor, this.f, c.mood, this.state(c));
        ctx.restore();
      } else fn(ctx, x, this.floor, this.f, c.mood, this.state(c));
      return;
    }
    const dollId = this.world.game.dolls?.[c.id] ? c.id : null;
    if (!dollId) return;
    const img = this.world.doll(dollId).frames.down[0];
    const w = img.width * this.scale;
    const h = img.height * this.scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, x - w / 2, this.floor - h, w, h);
  }
}

// The console itself: a 240x160 frame buffer, a fixed 60 Hz loop, a stack of scenes
// and the full-screen effects (fades, flashes, shakes, glitches) every game shares.
import { SCREEN_W, SCREEN_H, BASE_W, BASE_H, canvas } from './gfx.js';
import { Hd, hdOn, hdSupported, setHd } from './hd.js';

export class Engine {
  constructor(display, input) {
    this.display = display;            // the visible <canvas>
    this.input = input;
    // holding START switches between the classic and the modern look, anywhere
    input.onHoldStart = () => { if (hdSupported()) setHd(!hdOn()); };
    this.buffer = canvas(SCREEN_W, SCREEN_H);
    this.ctx = this.buffer.getContext('2d');
    this.scenes = [];
    this.frame = 0;
    this.timers = [];
    this.fx = { fade: 0, fadeColor: '#000000', fadeKind: 'fade', fadeAt: null, fadingIn: false, flash: 0, flashColor: '#ffffff', shake: 0, glitch: 0, bars: 0 };
    this.paused = false;
    this.post = [];                     // extra full-screen passes (game overlays)
    this.hdFrame = null;                // the world's picture this frame, in the modern look
    this.resize();
    input.bindPointer?.(display, SCREEN_W, SCREEN_H);
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { this.last = performance.now(); });
  }

  resize() {
    const r = this.display.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(SCREEN_W, Math.round(r.width * dpr));
    const h = Math.max(SCREEN_H, Math.round(r.height * dpr));
    if (this.display.width !== w || this.display.height !== h) {
      this.display.width = w;
      this.display.height = h;
    }
    this.out = this.display.getContext('2d');
    this.out.imageSmoothingEnabled = false;
  }

  start() {
    this.last = performance.now();
    this.acc = 0;
    const step = 1000 / 60;
    // ?turbo=N (testing only): N ticks of game time per tick of the clock. Everything the
    // game does counts ticks (save.time too), so it plays the same, only N times sooner.
    const turbo = Math.min(8, Math.max(1, Number(new URLSearchParams(location.search).get('turbo')) || 1));
    const loop = (now) => {
      this.acc += Math.min(250, now - this.last) * turbo;
      this.last = now;
      let n = 0;
      while (this.acc >= step && n < 4 * turbo) {
        this.update();
        this.acc -= step;
        n++;
      }
      if (n) this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---------- scenes ----------

  // Pushes a scene and resolves with whatever it passes to `done`.
  push(scene) {
    return new Promise((resolve) => {
      scene.done = (value) => {
        const i = this.scenes.indexOf(scene);
        if (i >= 0) this.scenes.splice(i, 1);
        scene.onExit?.();
        this.input.flush();
        resolve(value);
      };
      this.scenes.push(scene);
      scene.onEnter?.(this);
      this.input.flush();
    });
  }

  replaceAll(scene) {
    for (const s of this.scenes.splice(0)) s.onExit?.();
    return this.push(scene);
  }

  top() { return this.scenes[this.scenes.length - 1]; }

  // Resolves after `frames` updates; timers stop while the console is paused.
  wait(frames) {
    return new Promise((resolve) => this.timers.push({ at: this.frame + Math.max(1, Math.round(frames)), resolve }));
  }

  waitMs(ms) { return this.wait(ms / (1000 / 60)); }

  // Animates a value of this.fx from its current value to `to` over `frames`.
  tween(key, to, frames) {
    const from = this.fx[key];
    const start = this.frame;
    return new Promise((resolve) => {
      const job = { tick: () => {
        const t = Math.min(1, (this.frame - start) / Math.max(1, frames));
        this.fx[key] = from + (to - from) * t;
        if (t >= 1) { resolve(); return true; }
        return false;
      } };
      (this.jobs ||= []).push(job);
    });
  }

  // kind: 'fade' (stepped, like brightness registers), 'iris' (a circle closing on `at`,
  // screen pixels, default the centre), 'wipe' (a curtain from the left), 'mosaic' (the
  // picture breaks into blocks that grow until the colour takes over, as the GBA's mosaic
  // register did) or 'blinds' (bands closing from the top). The way in uses the kind of
  // the way out unless told otherwise.
  fadeOut(frames = 20, color = '#000000', kind = 'fade', at = null) {
    Object.assign(this.fx, { fadeColor: color, fadeKind: kind || 'fade', fadeAt: at, fadingIn: false });
    return this.tween('fade', 1, frames);
  }
  fadeIn(frames = 20, kind = null, at = null) {
    if (kind) this.fx.fadeKind = kind;
    if (at) this.fx.fadeAt = at;
    this.fx.fadingIn = true;
    return this.tween('fade', 0, frames);
  }
  // Cinema bars, top and bottom, for a cutscene: letterbox(true) / letterbox(false).
  letterbox(on = true, frames = 20) { return this.tween('bars', on ? 1 : 0, frames); }
  flash(color = '#ffffff', frames = 12) { this.fx.flashColor = color; this.fx.flash = 1; return this.tween('flash', 0, frames); }
  shake(frames = 20, power = 3) { this.fx.shakePower = power; this.fx.shake = frames; return this.wait(frames); }
  glitch(frames = 20) { this.fx.glitch = Math.max(this.fx.glitch, frames); return this.wait(frames); }

  update() {
    this.input.update();
    this.frame++;
    if (this.jobs) this.jobs = this.jobs.filter((j) => !j.tick());
    const due = this.timers.filter((t) => t.at <= this.frame);
    if (due.length) {
      this.timers = this.timers.filter((t) => t.at > this.frame);
      due.forEach((t) => t.resolve());
    }
    const top = this.top();
    for (const s of this.scenes) if (s !== top) s.tick?.(this);
    top?.update?.(this);
    this.tellPage(this.top());
    if (this.fx.shake > 0) this.fx.shake--;
    if (this.fx.glitch > 0) this.fx.glitch--;
  }

  // Tells the page what the scene on top takes: a scene that reads the pointer says
  // `pointer = true` (a getter may change its mind, as the world does in free movement);
  // the rest get the on-screen pad on a tablet. `menuButton`: the corner button is START.
  // The modern look (engine/hd.js) is on and this browser can show it.
  get hd() {
    if (!hdOn()) return null;
    if (this.hdPass === undefined) {
      try { this.hdPass = hdSupported() ? new Hd() : null; } catch (err) { console.warn('[luma32] modern look unavailable:', err); this.hdPass = null; }
      if (!this.hdPass?.ok) this.hdPass = null;
    }
    return this.hdPass;
  }

  // The screen as the player sees it, for a problem report.
  snapshot() {
    if (this.hdShown) {
      const c = canvas(480, 320);
      c.getContext('2d').imageSmoothingEnabled = true;
      c.getContext('2d').drawImage(this.hdPass.canvas, 0, 0, 480, 320);
      return c.toDataURL('image/png');
    }
    return this.buffer.toDataURL('image/png');
  }

  tellPage(top) {
    const pad = !!top && !top.pointer;
    const menu = !!top?.menuButton;
    if (pad === this.saidPad && menu === this.saidMenu) return;
    this.saidPad = pad;
    this.saidMenu = menu;
    document.body.classList.toggle('needs-pad', pad);
    document.body.classList.toggle('has-menu', menu);
  }

  draw() {
    const ctx = this.ctx;
    // draw from the topmost opaque scene upwards
    let from = 0;
    for (let i = this.scenes.length - 1; i >= 0; i--) if (this.scenes[i].opaque !== false) { from = i; break; }
    const list = this.scenes.slice(from);
    // the modern look takes the world at the bottom of what is shown into a picture of its
    // own, and everything drawn after it here goes over it, flat: the buffer is see-through
    const hd = this.fx.glitch > 0 ? null : this.hd;
    const base = hd && list[0]?.drawHd && !list[0].aboveFade ? list[0] : null;
    this.hdFrame = base ? base.drawHd(this) : null;
    if (this.hdFrame) ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
    else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, SCREEN_W, SCREEN_H); }
    // world-like scenes, then the fade, then UI that must stay readable over black
    for (const s of list) if (!s.aboveFade) {
      if (s === base && this.hdFrame) { s.drawHdOverlay?.(ctx, this); s.drawScreen(ctx, this); }
      else s.draw(ctx, this);
    }
    for (const p of this.post) p(ctx, this);
    this.drawBars();
    this.drawFade();
    for (const s of list) if (s.aboveFade) s.draw(ctx, this);
    if (this.fx.flash > 0) {
      ctx.globalAlpha = this.fx.flash;
      ctx.fillStyle = this.fx.flashColor;
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      ctx.globalAlpha = 1;
    }
    if (this.fx.glitch > 0) this.drawGlitch();
    this.present();
  }

  drawBars() {
    if (this.fx.bars <= 0) return;
    const h = Math.round(this.fx.bars * 18);
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, SCREEN_W, h);
    this.ctx.fillRect(0, SCREEN_H - h, SCREEN_W, h);
  }

  drawFade() {
    const f = this.fx.fade;
    if (f <= 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = this.fx.fadeColor;
    if (this.fx.fadeKind === 'iris' && f < 1) {
      const at = this.fx.fadeAt || { x: SCREEN_W / 2, y: SCREEN_H / 2 };
      const max = Math.hypot(Math.max(at.x, SCREEN_W - at.x), Math.max(at.y, SCREEN_H - at.y));
      const r = Math.floor(((1 - f) * max) / 4) * 4;
      ctx.beginPath();
      ctx.rect(0, 0, SCREEN_W, SCREEN_H);
      ctx.arc(Math.round(at.x), Math.round(at.y), Math.max(0, r), 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      return;
    }
    if (this.fx.fadeKind === 'wipe' && f < 1) {
      const w = Math.round((f * SCREEN_W) / 8) * 8;
      if (this.fx.fadingIn) ctx.fillRect(SCREEN_W - w, 0, w, SCREEN_H);
      else ctx.fillRect(0, 0, w, SCREEN_H);
      return;
    }
    if (this.fx.fadeKind === 'blinds' && f < 1) {
      // eight bands, each shut from its top edge, in whole pixels
      const band = SCREEN_H / 8;
      const h = Math.round(f * band);
      for (let y = 0; y < SCREEN_H; y += band) ctx.fillRect(0, Math.round(y), SCREEN_W, h);
      return;
    }
    // in the modern look the world is drawn apart, under a see-through buffer: there
    // hd.js breaks its own picture into the blocks, and only the colour is drawn here
    if (this.fx.fadeKind === 'mosaic' && f < 1) {
      // blocks grow from 1 to 16 pixels over most of the way; the colour comes last
      const k = Math.min(1, f / 0.75);
      const b = Math.max(1, Math.round(k * 16));
      if (b > 1 && !this.hdFrame) {
        const cw = Math.ceil(SCREEN_W / b);
        const ch = Math.ceil(SCREEN_H / b);
        if (!this.mosaicBuf || this.mosaicBuf.width < cw || this.mosaicBuf.height < ch) this.mosaicBuf = canvas(Math.max(cw, 64), Math.max(ch, 64));
        const m = this.mosaicBuf.getContext('2d');
        m.imageSmoothingEnabled = false;
        m.drawImage(ctx.canvas, 0, 0, SCREEN_W, SCREEN_H, 0, 0, cw, ch);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.mosaicBuf, 0, 0, cw, ch, 0, 0, cw * b, ch * b);
      }
      if (f > 0.75) {
        ctx.globalAlpha = Math.round(((f - 0.75) / 0.25) * 4) / 4;
        ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
        ctx.globalAlpha = 1;
      }
      return;
    }
    // fades in steps, like hardware brightness registers
    ctx.globalAlpha = Math.round(f * 8) / 8;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    ctx.globalAlpha = 1;
  }

  // Horizontal tearing: random bands of the frame slide sideways, some with a colour split.
  drawGlitch() {
    const ctx = this.ctx;
    const n = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const y = Math.floor(Math.random() * SCREEN_H);
      const h = 2 + Math.floor(Math.random() * 14);
      const dx = Math.floor((Math.random() - 0.5) * 24);
      ctx.drawImage(this.buffer, 0, y, SCREEN_W, h, dx, y, SCREEN_W, h);
      if (Math.random() < 0.4) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35;
        ctx.drawImage(this.buffer, 0, y, SCREEN_W, h, dx + 3, y, SCREEN_W, h);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  present() {
    const out = this.out;
    const W = this.display.width;
    const H = this.display.height;
    let ox = 0;
    let oy = 0;
    if (this.fx.shake > 0) {
      const p = this.fx.shakePower ?? 3;
      ox = Math.round((Math.random() - 0.5) * 2 * p) * (W / SCREEN_W);
      oy = Math.round((Math.random() - 0.5) * 2 * p) * (H / SCREEN_H);
    }
    if (ox || oy) { out.fillStyle = '#000'; out.fillRect(0, 0, W, H); }
    this.hdShown = !!this.hdFrame;
    if (this.hdFrame) {
      this.hdPass.size(W, H);
      this.hdPass.render(this.hdFrame, this.buffer, this.frame);
      out.imageSmoothingEnabled = true;
      out.drawImage(this.hdPass.canvas, ox, oy, W, H);
      return;
    }
    // at a whole multiple every pixel is the same size: straight nearest-neighbour. At any
    // other size (a 1366×768 window is 4.8×, a phone 3.25×) nearest would make some pixels a
    // step wider than their neighbours, and the picture shimmers as it scrolls: so the
    // buffer is first blown up to the next whole multiple, sharp, and that is shrunk to
    // the window smoothly. Pixels stay even and crisp; only their edges blend, under a pixel.
    const kx = W / BASE_W;
    const ky = H / BASE_H;
    const whole = Math.abs(kx - Math.round(kx)) < 1e-6 && Math.abs(ky - Math.round(ky)) < 1e-6;
    if (whole || kx <= 1 || ky <= 1) {
      out.imageSmoothingEnabled = false;
      out.drawImage(this.buffer, 0, 0, BASE_W, BASE_H, ox, oy, W, H);
      return;
    }
    const n = Math.ceil(Math.max(kx, ky));
    const sw = BASE_W * n;
    const sh = BASE_H * n;
    if (!this.sharp || this.sharp.width !== sw || this.sharp.height !== sh) this.sharp = canvas(sw, sh);
    const s = this.sharp.getContext('2d');
    s.imageSmoothingEnabled = false;
    s.drawImage(this.buffer, 0, 0, BASE_W, BASE_H, 0, 0, sw, sh);
    out.imageSmoothingEnabled = true;
    out.imageSmoothingQuality = 'high';
    out.drawImage(this.sharp, 0, 0, sw, sh, ox, oy, W, H);
  }
}

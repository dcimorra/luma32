// The console's own screens: the power-on logo, the cartridge shelf and the title
// screen every cartridge gets (art by the cartridge, "Press Start" by the console).
import { SCREEN_W, SCREEN_H } from './gfx.js';
import { drawText, drawBig, measure, measureBig } from './font.js';
import { frame, getTheme, centerX, List, pointRows, clicked } from './ui.js';
import { tone, sfx, music, audioContext } from './audio.js';
import { t, withCatalog } from './i18n.js';
import { account, openAccount, isOpen, offlineLocked } from './host.js';
import { drawGroup, drawSearch } from './groups.js';
import { openSearch, searching } from './search.js';
import { isWeb, hint } from './shell.js';

const blink = (f, rate = 30) => Math.floor(f / rate) % 2 === 0;

// ---------- power on ----------

export class BootLogo {
  constructor() { this.f = 0; this.chimed = false; this.pointer = true; }

  update(e) {
    this.f++;
    if (this.f === 70 && !this.chimed) { this.chimed = true; chime(); }
    if (this.f > 40 && (e.input.pressed('a') || e.input.pressed('start') || clicked(e.input))) this.f = Math.max(this.f, 175);
    if (this.f >= 190) this.done();
  }

  draw(ctx) {
    const f = this.f;
    ctx.fillStyle = '#f4f2ea';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    // the word drops in from above, then a light sweeps across it
    const drop = Math.max(0, 1 - f / 60);
    const y = Math.round(64 - drop * drop * 90);
    const word = 'LUMA';
    const wx = Math.round((SCREEN_W - measureBig(word, 3) - measureBig('32', 3) - 6) / 2);
    drawBig(ctx, word, wx, y, '#2a2770', 3);
    const nx = wx + measureBig(word, 3) + 6;
    drawBig(ctx, '32', nx, y, '#e8445c', 3);
    if (f > 60 && f < 110) {
      const sx = wx - 20 + (f - 60) * 4.4;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 6; i++) ctx.fillRect(Math.round(sx + i - (y - 64)), y - 6, 2, 30);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (f > 80) {
      const sub = t('console.shell.colour');
      const colors = ['#e8445c', '#f0a030', '#3cb878', '#3a9ee8', '#7a5ae0'];
      let x = Math.round((SCREEN_W - measure(sub) - (sub.length - 1) * 3) / 2);
      [...sub].forEach((ch, i) => { drawText(ctx, ch, x, 96, colors[i % colors.length]); x += measure(ch) + 4; });
    }
    if (f > 110) {
      const c = t('console.boot.legal');
      drawText(ctx, c, centerX(c), 138, '#9a98a8');
    }
    if (f > 165) {
      ctx.globalAlpha = Math.min(1, (f - 165) / 25);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      ctx.globalAlpha = 1;
    }
  }
}

// Two bright pulses and a falling fifth, the console's signature.
function chime() {
  const ctx = audioContext();
  const at = ctx ? ctx.currentTime : undefined;
  if (at === undefined) return;
  tone({ at, freq: 1046.5, len: 0.12, wave: 'pulse25', gain: 0.06, echo: 0.4 });
  tone({ at: at + 0.11, freq: 2093, len: 0.55, wave: 'pulse12', gain: 0.05, echo: 0.5, vibrato: 0.004 });
  tone({ at: at + 0.11, freq: 1567.98, len: 0.55, wave: 'tri', gain: 0.1, echo: 0.3 });
}

// ---------- the cartridge shelf ----------

export class Shelf {
  // items: the shelf's tree, in order: cartridges { id, game } and groups { group: true,
  // id, kind, art, items, count }. `last`: the cartridge played last, selected where it is
  // (inside its groups). `find(q)`: the cartridges those words find, for the search.
  constructor(items, last = null, find = () => []) {
    this.find = find;
    this.f = 0;
    this.inserting = -1;
    this.pointer = true;
    // where we are: a stack of levels, the shelf at the bottom
    this.stack = [{ items: items.length ? [{ search: true, id: '' }, ...items] : [], sel: 1 }];
    const path = (list, chain) => {
      for (const it of list) {
        if (it.group) { const p = path(it.items, [...chain, it]); if (p) return p; } else if (it.id === last) return [...chain, it];
      }
      return null;
    };
    const chain = (last && path(items, [])) || [];
    for (const step of chain) {
      const level = this.stack[this.stack.length - 1];
      level.sel = level.items.indexOf(step);
      if (step.group) this.stack.push({ items: step.items, sel: 0, group: step });
    }
    if (!chain.length) this.stack[0].sel = items.length ? 1 : 0;
    this.pos = this.level.sel;
  }

  get level() { return this.stack[this.stack.length - 1]; }
  get items() { return this.level.items; }
  get sel() { return this.level.sel; }
  set sel(v) { this.level.sel = v; }

  // Into a group or a search's results, and back out to where it was.
  push(level) {
    this.stack.push({ sel: 0, ...level });
    this.pos = -1;
    sfx('confirm');
  }

  pop() {
    this.stack.pop();
    this.pos = this.sel + 1;
    sfx('cancel');
  }

  async search() {
    const q = await openSearch((words) => this.find(words).length, this.lastSearch || '');
    if (!q) return;
    this.lastSearch = q;
    while (this.stack.length > 1) this.stack.pop();
    this.push({ items: this.find(q), query: q });
  }

  // What a click on the shelf means, as a button: the cartridges slide, so hovering
  // selects nothing (the one under the mouse would run away from it). A click on a side
  // one brings it to the middle, on the middle one (or the line under it) inserts it; the
  // arrows at the edges and the wheel move along; the head goes back out of a group, or
  // opens the account at the top; a right click is B.
  pointed(inp) {
    const p = inp.pointer;
    if (!p?.clicked && !p?.back && !p?.wheel) return null;
    if (p.back) return 'b';
    if (p.wheel) return p.wheel < 0 ? 'left' : 'right';
    if (!p.over) return null;
    if (p.y < 18) return this.stack.length > 1 ? 'b' : p.x > SCREEN_W / 2 && !account()?.local ? 'select' : null;
    if (p.y >= 122) return 'a';
    for (let i = 0; i < this.items.length; i++) {
      const x = Math.round(SCREEN_W / 2 - 34 + (i - this.pos) * 84);
      if (inp.pointIn(x, 20, 70, 100)) {
        if (i === this.sel) return 'a';
        this.sel = i;
        sfx('cursor');
        return null;
      }
    }
    if (p.x < 24) return 'left';
    if (p.x >= SCREEN_W - 24) return 'right';
    return null;
  }

  update(e) {
    this.f++;
    const n = this.items.length;
    if (isOpen() || searching()) return;
    const inp = e.input;
    const tap = clicked(inp);
    if (offlineLocked()) {
      if (inp.pressed('a') || inp.pressed('start') || tap) { sfx('confirm'); location.reload(); }
      if (inp.pressed('select')) { sfx('confirm'); openAccount(); }
      return;
    }
    if (!account()) {
      if (!this.asked || inp.pressed('a') || inp.pressed('start') || inp.pressed('select') || tap) { this.asked = true; sfx('confirm'); openAccount(); }
      return;
    }
    if (this.inserting >= 0) {
      this.inserting++;
      if (this.inserting > 50) this.done(this.items[this.sel].id);
      return;
    }
    const pt = this.pointed(inp);
    if ((inp.pressed('left') || pt === 'left') && n > 1) { this.sel = (this.sel + n - 1) % n; sfx('cursor'); }
    if ((inp.pressed('right') || pt === 'right') && n > 1) { this.sel = (this.sel + 1) % n; sfx('cursor'); }
    if (inp.pressed('select') || pt === 'select') { sfx('confirm'); openAccount(); return; }
    if ((inp.pressed('b') || pt === 'b') && this.stack.length > 1) { this.pop(); return; }
    if ((inp.pressed('a') || inp.pressed('start') || pt === 'a') && n) {
      const it = this.items[this.sel];
      if (it.search) { sfx('confirm'); this.search(); } else if (it.group) this.push({ items: it.items, group: it });
      else { this.inserting = 0; sfx('confirm'); }
    }
    this.pos += (this.sel - this.pos) * 0.25;
  }

  draw(ctx) {
    const f = this.f;
    const { group, query } = this.level;
    // a dark room with a slowly drifting grid
    ctx.fillStyle = '#121026';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    ctx.fillStyle = '#1c1940';
    const off = Math.floor(f / 3) % 16;
    for (let x = -16 + off; x < SCREEN_W; x += 16) ctx.fillRect(x, 0, 1, SCREEN_H);
    for (let y = -16 + off; y < SCREEN_H; y += 16) ctx.fillRect(0, y, SCREEN_W, 1);
    ctx.fillStyle = '#0c0a1c';
    ctx.fillRect(0, 0, SCREEN_W, 18);
    // the head says where we are: the shelf, a group (and the groups above it), a search
    const who = account()?.email;
    // a local checkout (plain files): nobody logs in, there is no account to open
    const local = !!account()?.local;
    if (this.stack.length === 1) {
      const head = t('console.shelf.title');
      drawText(ctx, head, 8, 6, '#e8e6ff');
      // who is playing, or how to log in; SELECT opens the account either way
      let label = local ? t('console.name') : who || t('console.shelf.account');
      while (who && measure(label) > SCREEN_W - 24 - measure(head) && label.length > 4) label = `${label.slice(0, -2)}…`;
      drawText(ctx, label, SCREEN_W - 8 - measure(label), 6, who || local ? '#5fd0ff' : '#8a86c0');
    } else {
      let head = query ? t('console.shelf.results', { q: query })
        : this.stack.slice(1).map((l) => withCatalog(`group:${l.group.id}`, () => t('meta.title'))).join(' / ').toUpperCase();
      while (measure(head) > SCREEN_W - 16 && head.length > 4) head = `…${head.slice(2)}`;
      // with a pointer the head is the way back out: say so
      if (isWeb()) { drawText(ctx, '◀', 4, 6, '#8a86c0'); drawText(ctx, head, 14, 6, '#ffd25f'); } else drawText(ctx, head, 8, 6, '#ffd25f');
    }
    if (!this.items.length) {
      const locked = offlineLocked();
      const over = !!account()?.trial?.expired;
      const empty = t(query ? 'console.shelf.no_results' : locked ? 'console.shelf.offline' : over ? 'console.shelf.trial_over'
        : who || local ? 'console.shelf.empty' : 'console.shelf.login');
      drawText(ctx, empty, centerX(empty), 70, '#a8a4d8');
      const how = t(hint(query ? 'console.shelf.back' : locked ? 'console.shelf.offline_hint' : over ? 'console.shelf.account_hint' : 'console.shelf.login_hint'));
      if ((query || (!who && !local) || over) && blink(f)) drawText(ctx, how, centerX(how), 84, '#5fd0ff');
    }

    this.items.forEach((it, i) => {
      const d = i - this.pos;
      const sel = i === this.sel;
      const x = Math.round(SCREEN_W / 2 - 34 + d * 84);
      let y = 30 + (sel ? 0 : 6) + (sel ? Math.round(Math.sin(f / 20)) : 0);
      if (sel && this.inserting >= 0) y += Math.round(this.inserting * this.inserting * 0.06);
      if (x < -90 || x > SCREEN_W + 20) return;
      if (it.search) drawSearch(ctx, x, y, f, sel);
      else if (it.group) withCatalog(`group:${it.id}`, () => drawGroup(ctx, x, y + 4, it, f, sel, it.count));
      else withCatalog(it.id, () => drawCart(ctx, x, y, it.game, f, sel));
    });

    const cur = this.items[this.sel];
    if (this.inserting < 0 && cur) {
      ctx.fillStyle = '#0c0a1c';
      ctx.fillRect(0, 122, SCREEN_W, 38);
      const cat = cur.group ? `group:${cur.id}` : cur.id;
      const line = (key) => (cur.search ? t(`console.shelf.search_${key}`) : withCatalog(cat, () => t(cur.group ? `meta.${key}` : cur.game.meta[key])));
      const name = line('title');
      drawText(ctx, name, centerX(name), 128, '#ffffff', '#3a3670');
      const tag = line('tagline');
      drawText(ctx, tag, centerX(tag), 140, '#a8a4d8');
      if (blink(f)) {
        // every third blink, the way back out (or to the account, which a local console lacks)
        const third = Math.floor(f / 60) % 3 === 2 && (this.stack.length > 1 || !local);
        const say = t(hint(cur.search ? 'console.shelf.search_hint' : cur.group ? 'console.shelf.open_group'
          : third ? (this.stack.length > 1 ? 'console.shelf.back' : 'console.shelf.account_hint') : 'console.shelf.insert'));
        drawText(ctx, say, centerX(say), 151, '#5fd0ff');
      }
      if (this.items.length > 1) {
        drawText(ctx, '◀', 6, 78, '#8a86c0');
        drawText(ctx, '▶', SCREEN_W - 10, 78, '#8a86c0');
      }
    }
    if (this.inserting > 30) {
      ctx.globalAlpha = Math.min(1, (this.inserting - 30) / 20);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      ctx.globalAlpha = 1;
    }
  }
}

// A cartridge: grey plastic with grip ridges and the game's own label.
function drawCart(ctx, x, y, game, f, sel) {
  const W = 68;
  const H = 82;
  const body = sel ? '#b8b6c4' : '#8a889a';
  const dark = sel ? '#6e6c80' : '#565466';
  const light = sel ? '#e2e0ea' : '#a8a6b6';
  ctx.fillStyle = '#0a0918';
  ctx.fillRect(x + 3, y + 4, W, H);
  ctx.fillStyle = dark;
  ctx.fillRect(x, y + 1, W, H - 1);
  ctx.fillRect(x + 1, y, W - 2, H);
  ctx.fillStyle = body;
  ctx.fillRect(x + 1, y + 1, W - 2, H - 3);
  ctx.fillStyle = light;
  ctx.fillRect(x + 2, y + 1, W - 4, 1);
  // the notch at the top and the grip lines
  ctx.fillStyle = dark;
  ctx.fillRect(x + 8, y, W - 16, 3);
  for (let i = 0; i < 5; i++) ctx.fillRect(x + 14 + i * 9, y + H - 4, 5, 1);
  // label
  const lx = x + 5;
  const ly = y + 7;
  const lw = W - 10;
  const lh = 56;
  ctx.fillStyle = '#1a1826';
  ctx.fillRect(lx - 1, ly - 1, lw + 2, lh + 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(lx, ly, lw, lh);
  ctx.clip();
  game.cover?.(ctx, lx, ly, lw, lh, f);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(lx, ly, lw, 1);
  // brand plate under the label
  drawText(ctx, 'LUMA32', x + Math.round((W - measure('LUMA32')) / 2), y + 67, dark);
  // an age rating, stamped on the label's corner where it can't be missed
  if (game.meta?.rating) {
    const r = t('console.shelf.rating', { age: game.meta.rating });
    const rw = measure(r) + 4;
    ctx.fillStyle = '#5a0c18';
    ctx.fillRect(lx + lw - rw - 1, ly + lh - 11, rw + 2, 12);
    ctx.fillStyle = '#d8283c';
    ctx.fillRect(lx + lw - rw, ly + lh - 10, rw, 10);
    drawText(ctx, r, lx + lw - rw + 2, ly + lh - 9, '#ffffff');
  }
}

// ---------- the title screen every cartridge has ----------

// The label of a save slot: the cartridge's own (slotLabel), or the place it was saved in.
function slotItem(game, slot) {
  const s = slot.load(game);
  if (!s) return { label: `${slot.n}  ${t('console.title.slot_empty')}`, empty: true };
  const place = game.slotLabel?.(s) ?? (game.maps?.[s.map]?.name ? t(game.maps[s.map].name) : s.map);
  const d = s.at ? new Date(s.at) : null;
  const pad = (n) => String(n).padStart(2, '0');
  const value = d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
  return { label: `${slot.n}  ${place}`, value };
}

// Resolves with { id: 'continue' | 'new' | 'eject', slot } (slot: a SaveSlot).
export class TitleScreen {
  constructor(game, slots) {
    this.game = game;
    this.title = game.title || {};
    this.slots = slots;
    this.hasSave = slots.some((sl) => sl.load(game));
    this.pointer = true;
    this.f = 0;
    this.phase = 'intro';
    this.sel = 0;
    this.confirm = false;
    this.leaving = -1;
  }

  onEnter() { if (this.title.music) music(this.title.music); }

  options() {
    const o = [];
    if (this.hasSave) o.push(['continue', t('console.title.continue')]);
    o.push(['new', t('console.title.new')]);
    o.push(['eject', t('console.title.eject')]);
    return o;
  }

  update(e) {
    this.f++;
    const inp = e.input;
    if (this.leaving >= 0) {
      if (++this.leaving > 30) this.done(this.result);
      return;
    }
    const intro = this.title.intro ?? 90;
    const tap = clicked(inp);
    if (this.phase === 'intro') {
      if (this.f >= intro || (this.f > 10 && (inp.pressed('start') || inp.pressed('a') || tap))) { this.phase = 'press'; this.f = Math.max(this.f, intro); this.pressAt = this.f; }
      return;
    }
    if (this.phase === 'press') {
      if (this.f - this.pressAt > 8 && (inp.pressed('start') || inp.pressed('a') || tap)) {
        sfx('start');
        e.flash('#ffffff', 10);
        this.phase = 'menu';
        this.sel = 0;
      }
      return;
    }
    // menu
    const opts = this.options();
    if (this.confirm) {
      const q = this.confirmBox();
      const pt = pointRows(inp, q.x, 40, q.w, 52, 60, 13, 2);
      if (inp.pressed('up') || inp.pressed('down') || pt.wheel) { this.confirmSel = 1 - this.confirmSel; sfx('cursor'); }
      if (pt.hover >= 0 && pt.hover !== this.confirmSel) { this.confirmSel = pt.hover; sfx('cursor'); }
      if (inp.pressed('b') || pt.back) { this.confirm = false; sfx('cancel'); }
      if (inp.pressed('a') || pt.pick >= 0) {
        if (this.confirmSel === 0) this.leave('new', this.confirmSlot);
        else { this.confirm = false; sfx('cancel'); }
      }
      return;
    }
    if (this.picking) return;
    const m = this.menuBox();
    const pt = pointRows(inp, m.x, m.y, m.w, m.h, m.y + 5, 14, opts.length);
    if (inp.pressed('up') || pt.wheel < 0) { this.sel = (this.sel + opts.length - 1) % opts.length; sfx('cursor'); }
    if (inp.pressed('down') || pt.wheel > 0) { this.sel = (this.sel + 1) % opts.length; sfx('cursor'); }
    if (pt.hover >= 0 && pt.hover !== this.sel) { this.sel = pt.hover; sfx('cursor'); }
    if (inp.pressed('b') || pt.back) { this.phase = 'press'; this.pressAt = this.f; sfx('cancel'); }
    if (inp.pressed('a') || inp.pressed('start') || pt.pick >= 0) {
      const id = opts[this.sel][0];
      if (id === 'eject') { this.leave(id); return; }
      if (this.slots.length > 1) { this.pick(e, id); return; }
      const slot = this.slots[0];
      if (id === 'new' && this.hasSave) { this.ask(slot); return; }
      this.leave(id, slot);
    }
  }

  menuBox() {
    const opts = this.options();
    const w = Math.max(...opts.map((o) => measure(o[1]))) + 30;
    const h = opts.length * 14 + 10;
    return { x: Math.round((SCREEN_W - w) / 2), y: this.title.menuY ?? SCREEN_H - h - 8, w, h };
  }

  confirmBox() {
    const q = t(this.slots.length > 1 ? 'console.title.confirm_slot' : 'console.title.confirm');
    const w = Math.min(228, measure(q) + 20);
    return { q, x: Math.round((SCREEN_W - w) / 2), w };
  }

  ask(slot) { this.confirm = true; this.confirmSel = 1; this.confirmSlot = slot; sfx('cursor'); }

  // With several slots: which one to continue, or which one a new game is saved in.
  async pick(e, id) {
    this.picking = true;
    const items = this.slots.map((sl) => slotItem(this.game, sl));
    if (id === 'continue') items.forEach((it) => { it.disabled = it.empty; });
    const first = id === 'continue' ? items.findIndex((it) => !it.empty) : Math.max(0, items.findIndex((it) => it.empty));
    const i = await e.push(new List(items, { title: t('console.title.slot_title'), x: null, y: 24, initial: first }));
    this.picking = false;
    if (i < 0) return;
    const slot = this.slots[i];
    if (id === 'new' && !items[i].empty) { this.ask(slot); return; }
    this.leave(id, slot);
  }

  leave(id, slot = null) {
    sfx('confirm');
    this.result = { id, slot };
    this.leaving = 0;
    if (id !== 'eject') music(null, { fade: 0.8 });
  }

  draw(ctx, e) {
    this.title.draw?.(ctx, this.f, e, this.phase);
    const th = getTheme();
    if (this.phase === 'press' && blink(this.f - this.pressAt, 32)) {
      const s = t(hint(this.title.press || 'console.title.press'));
      const y = this.title.pressY ?? 134;
      drawText(ctx, s, centerX(s), y, this.title.pressColor || '#ffffff', this.title.pressShadow || '#000000');
    }
    if (this.phase === 'menu' && !this.picking) {
      const opts = this.options();
      const { x, y, w, h } = this.menuBox();
      frame(ctx, x, y, w, h);
      opts.forEach(([, label], i) => {
        const ly = y + 7 + i * 14;
        if (i === this.sel) drawText(ctx, '▶', x + 8, ly, th.accent, th.shadow);
        drawText(ctx, label, x + 18, ly, th.text, th.shadow);
      });
      if (this.confirm) {
        const { q, x: qx, w: qw } = this.confirmBox();
        frame(ctx, qx, 40, qw, 52);
        drawText(ctx, q, Math.round((SCREEN_W - measure(q)) / 2), 48, th.text, th.shadow);
        [t('console.title.confirm_yes'), t('console.title.confirm_no')].forEach((label, i) => {
          const lx = Math.round(SCREEN_W / 2 - 40);
          const ly = 62 + i * 13;
          if (i === this.confirmSel) drawText(ctx, '▶', lx, ly, th.accent, th.shadow);
          drawText(ctx, label, lx + 10, ly, th.text, th.shadow);
        });
      }
    }
    if (this.leaving >= 0) {
      ctx.globalAlpha = Math.min(1, this.leaving / 28);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      ctx.globalAlpha = 1;
    }
  }
}

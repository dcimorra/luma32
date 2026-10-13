// Windows, dialogue, choices and menus: the parts of a GBA game every cartridge shares.
// Colours come from the cartridge's theme; layout and behaviour are the console's.
import { SCREEN_W, SCREEN_H } from './gfx.js';
import { drawText, drawBig, measure, measureBig, wrap, charWidth, LINE_H } from './font.js';
import { sfx } from './audio.js';
import { t } from './i18n.js';
import { hint } from './shell.js';

export const DEFAULT_THEME = {
  border: '#283048', light: '#a8b8d8', fill: '#f8f8f0', text: '#384050', shadow: '#d0d0c8',
  accent: '#e05038', dim: '#8890a0',
  narration: { border: '#181818', light: '#505050', fill: '#202020', text: '#e8e8e8', shadow: '#505050' },
  speakers: {},
};

let theme = DEFAULT_THEME;
export function setTheme(th) {
  theme = { ...DEFAULT_THEME, ...th, narration: { ...DEFAULT_THEME.narration, ...(th?.narration || {}) } };
}
export const getTheme = () => theme;

// A rounded window with a double border.
export function frame(ctx, x, y, w, h, style = theme) {
  ctx.fillStyle = style.border;
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
  ctx.fillStyle = style.light;
  ctx.fillRect(x + 2, y + 1, w - 4, h - 2);
  ctx.fillRect(x + 1, y + 2, w - 2, h - 4);
  ctx.fillStyle = style.fill;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
}

export function text(ctx, str, x, y, color = theme.text, shadow = theme.shadow) {
  return drawText(ctx, str, x, y, color, shadow);
}

export function big(ctx, str, x, y, color, scale = 2, shadow = null) { return drawBig(ctx, str, x, y, color, scale, shadow); }
export function centerX(str, scale = 1) { return Math.round((SCREEN_W - (scale === 1 ? measure(str) : measureBig(str, scale))) / 2); }

const blink = (e, rate = 16) => Math.floor(e.frame / rate) % 2 === 0;

// ---------- the pointer (a desktop's mouse, a tablet's finger: input.js) ----------

// Every scene here reads it (`pointer = true`). A click where A would act acts; a right
// click, or a click outside a window that B would close, is B; the wheel moves the cursor.
// pointRows: what it did this frame to `n` rows starting at `rowY`, `rowH` apart, inside the
// window (x, y, w, h). hover: the row it moved onto, pick: the row clicked (-1 for neither).
export function pointRows(inp, x, y, w, h, rowY, rowH, n) {
  const p = inp.pointer;
  const out = { hover: -1, pick: -1, back: false, wheel: 0 };
  if (!inp.pointerOn || !p) return out;
  const inside = inp.pointIn(x, y, w, h);
  const r = Math.floor((p.y - rowY) / rowH);
  const row = inside && p.y >= rowY && r < n ? r : -1;
  if ((p.moved || p.clicked) && row >= 0) out.hover = row;
  if (p.clicked && row >= 0) out.pick = row;
  out.back = p.back || (p.clicked && !inside);
  out.wheel = p.wheel;
  return out;
}

// A click (or a tap) anywhere on the screen: A, where A only goes on.
export const clicked = (inp) => !!inp.pointer?.clicked;

// ---------- text effects ----------

// Inside a line of dialogue: {shake}…{/} trembles, {wave}…{/} floats, {c=#e05038}…{/} or
// {c=accent}…{/} (a theme colour; {c=speaker} the speaker's) colours, {p} pauses the
// typing a moment and {p=800} for that many ms. Unknown braces stay as written. The
// backlog, widths and wrapping see the plain text.
const TAG = /\{(shake|wave|\/|p(?:=\d+)?|c=[#\w]+)\}/g;

export function parseMarkup(str) {
  str = String(str);
  let plain = '';
  const fx = [];
  const pauses = new Map();
  let cur = null;
  let last = 0;
  const take = (chunk) => { for (let i = 0; i < chunk.length; i++) fx.push(cur); plain += chunk; };
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(str))) {
    take(str.slice(last, m.index));
    last = TAG.lastIndex;
    const tag = m[1];
    if (tag === '/') cur = null;
    else if (tag === 'shake' || tag === 'wave') cur = { ...(cur || {}), [tag]: true };
    else if (tag.startsWith('c=')) cur = { ...(cur || {}), color: tag.slice(2) };
    else pauses.set(plain.length, tag.length > 1 ? Number(tag.slice(2)) : 400);
  }
  take(str.slice(last));
  return { plain, fx: fx.some(Boolean) ? fx : null, pauses };
}

export const stripMarkup = (str) => String(str).replace(TAG, '');

// For each character of a page (lines joined by \n), its index in the plain text; -1 for
// the line breaks. Wrapping only drops the spaces it breaks at, so the walk lines up.
function pageMap(plain, lines) {
  const out = [];
  let k = 0;
  lines.forEach((line, j) => {
    if (j) out.push(-1);
    for (const ch of line) {
      while (k < plain.length && plain[k] !== ch) k++;
      out.push(k++);
    }
  });
  return out;
}

// ---------- dialogue ----------

// The player's reading speed, from the START menu: slow, normal, fast.
const SPEED_KEY = 'luma32.textSpeed';
const SPEEDS = { slow: 0.5, normal: 1, fast: 2.5 };
export const textSpeed = () => (SPEEDS[localStorage.getItem(SPEED_KEY)] ? localStorage.getItem(SPEED_KEY) : 'normal');
export function setTextSpeed(v) { localStorage.setItem(SPEED_KEY, v); }

const BOX = { x: 3, y: 110, w: 234, h: 47 };
const TEXT_W = 216;
const LINES = 3;

// Portraits: game.portraits[speaker](ctx, x, y, frame, mood) paints a 40×40 face.
let portraits = {};
export function setPortraits(p) { portraits = p || {}; }
export const PORTRAIT = 40;

function speakerOf(id) {
  if (!id) return null;
  const s = theme.speakers[id] || {};
  const name = s.name ? t(s.name) : t(`speakers.${id}`);
  return { id, name, color: s.color || theme.accent, voice: s.voice ?? 800, text: s.text, portrait: portraits[id] || null };
}

export const speakerName = (id) => speakerOf(id)?.name ?? '';

// One speech, paged into boxes of three lines. Resolves when the last page is dismissed.
export class Dialog {
  // seen: the line was read in an earlier play; holding B then skips it whole.
  constructor(str, { speaker = null, style = null, top = false, keep = false, speed = 1, mood = null, seen = false } = {}) {
    this.speaker = speakerOf(speaker);
    this.mood = mood;
    this.seen = seen;
    this.style = style === 'narration' || (!speaker && style !== 'box') ? theme.narration : theme;
    const mk = parseMarkup(str);
    this.fx = mk.fx;
    this.pauses = mk.pauses;
    this.paused = new Set();
    this.hold = 0;
    this.lines = wrap(mk.plain, TEXT_W);
    this.pages = [];
    for (let i = 0; i < this.lines.length; i += LINES) this.pages.push(this.lines.slice(i, i + LINES));
    this.maps = this.pages.map((pg) => pageMap(mk.plain, pg));
    this.page = 0;
    this.shown = 0;
    this.speed = speed * SPEEDS[textSpeed()];
    this.top = top;
    this.keep = keep; // leave the box drawn (used under a choice)
    this.opaque = false;
    this.aboveFade = true;
    this.pointer = true;
  }

  get pageText() { return this.pages[this.page].join('\n'); }
  get complete() { return this.shown >= this.pageText.length; }

  update(e) {
    const inp = e.input;
    if (this.seen && !this.keep && inp.held('b')) {
      this.shown = this.pageText.length;
      if (e.frame % 3) return;
      if (this.page < this.pages.length - 1) { this.page++; this.shown = this.pageText.length; } else this.done();
      return;
    }
    // a click or a right click is A or B: both go on
    const go = inp.pressed('a') || inp.pressed('b') || clicked(inp) || !!inp.pointer?.back;
    if (!this.complete) {
      const fast = inp.held('a') || inp.held('b') || !!inp.pointer?.down;
      if (this.hold > 0 && !fast) { this.hold--; return; }
      const before = Math.floor(this.shown);
      let target = Math.min(this.pageText.length, this.shown + (fast ? 4 : this.speed));
      // a {p} before a character holds the typing there for a moment
      if (!fast && this.pauses.size) {
        const map = this.maps[this.page];
        for (let i = Math.max(1, before); i < Math.ceil(target); i++) {
          let prev = i - 1;
          while (prev > 0 && map[prev] < 0) prev--;
          const at = [...this.pauses.keys()].find((p) => p > map[prev] && p <= map[i] && !this.paused.has(p));
          if (at === undefined) continue;
          this.paused.add(at);
          target = i;
          this.hold = this.pauses.get(at) / 16.67;
          break;
        }
      }
      this.shown = Math.max(this.shown, target);
      const now = Math.floor(this.shown);
      for (let i = before; i < now; i++) {
        const ch = this.pageText[i];
        if (i % 2 === 0 && ch && ch.trim() && !fast) sfx('blip', { pitch: this.speaker?.voice ?? 620 });
      }
      if (go && this.shown > 2) this.shown = this.pageText.length;
      return;
    }
    if (this.keep && this.page === this.pages.length - 1) { this.done(); return; }
    if (go) {
      if (this.page < this.pages.length - 1) {
        this.page++;
        this.shown = 0;
        sfx('cursor');
      } else {
        this.done();
      }
    }
  }

  draw(ctx, e) {
    drawDialogBox(ctx, e, this);
  }
}

export function drawDialogBox(ctx, e, d, { indicator = true } = {}) {
  const st = d.style;
  const y = d.top ? 3 : BOX.y;
  // the face sits on the box's corner, above it (or below a box at the top)
  const face = d.speaker?.portrait;
  if (face) {
    const py = d.top ? y + BOX.h + 1 : y - PORTRAIT - 5;
    frame(ctx, BOX.x, py, PORTRAIT + 4, PORTRAIT + 4, { border: st.border, light: d.speaker.color, fill: st.fill });
    ctx.save();
    ctx.beginPath();
    ctx.rect(BOX.x + 2, py + 2, PORTRAIT, PORTRAIT);
    ctx.clip();
    face(ctx, BOX.x + 2, py + 2, e.frame, d.mood, faceState(e, !d.complete && !(d.hold > 0)));
    ctx.restore();
  }
  frame(ctx, BOX.x, y, BOX.w, BOX.h, st);
  if (d.speaker && d.speaker.name) {
    const w = measure(d.speaker.name) + 14;
    const ny = d.top ? y + BOX.h - 5 : y - 10; // a box at the top hangs its name below
    const nx = face ? BOX.x + PORTRAIT + 7 : BOX.x + 5;
    frame(ctx, nx, ny, w, 15, { border: st.border, light: d.speaker.color, fill: st.fill });
    drawText(ctx, d.speaker.name, nx + 7, ny + 4, d.speaker.color, st.shadow);
  }
  const color = (d.speaker && d.speaker.text) || st.text;
  if (d.fx) drawEffects(ctx, e, d, y, color, st);
  else {
    const visible = d.pageText.slice(0, Math.floor(d.shown)).split('\n');
    visible.forEach((line, i) => drawText(ctx, line, BOX.x + 9, y + 9 + i * LINE_H, color, st.shadow));
  }
  if (indicator && d.complete && !d.keep && blink(e)) {
    const last = d.page === d.pages.length - 1;
    drawText(ctx, last ? '■' : '▼', BOX.x + BOX.w - 13, y + BOX.h - 12, (d.speaker && d.speaker.color) || theme.accent);
  }
}

// What a portrait or a stage figure is doing this frame, passed as its last argument:
// `talking` while its line types, `mouth` open on alternate beats of it, `blink` for a few
// frames every few seconds. Painters that ignore it keep working.
export function faceState(e, talking) {
  return { talking, mouth: talking && Math.floor(e.frame / 5) % 2 === 0, blink: e.frame % 170 < 6 };
}

// A page drawn character by character, for lines with effects.
function drawEffects(ctx, e, d, y, color, st) {
  const text = d.pageText;
  const map = d.maps[d.page];
  const n = Math.floor(d.shown);
  let x = BOX.x + 9;
  let row = 0;
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (ch === '\n') { row++; x = BOX.x + 9; continue; }
    const f = map[i] >= 0 ? d.fx[map[i]] : null;
    let c = color;
    let dx = 0;
    let dy = 0;
    if (f?.color) c = f.color.startsWith('#') ? f.color : f.color === 'speaker' ? d.speaker?.color || theme.accent : theme[f.color] || color;
    if (f?.shake) {
      const h = (Math.floor(e.frame / 3) * 31 + i * 17) % 9;
      dx = (h % 3) - 1;
      dy = (Math.floor(h / 3) % 3) - 1;
    }
    if (f?.wave) dy += Math.round(Math.sin(e.frame / 6 + i * 0.7) * 1.5);
    if (ch !== ' ') drawText(ctx, ch, x + dx, y + 9 + row * LINE_H + dy, c, st.shadow);
    x += charWidth(ch);
  }
}

// ---------- choices ----------

// A vertical list. Resolves with the chosen index, or -1 when cancelled (if allowed).
// Longer lists than `rows` scroll, with arrows on the frame.
export class Choice {
  constructor(options, { under = null, cancel = false, x = null, y = null, initial = 0, rows = null } = {}) {
    this.options = options;
    this.under = under;   // a Dialog kept on screen behind the list
    this.cancel = cancel;
    this.sel = initial;
    this.opaque = false;
    this.aboveFade = true;
    this.pointer = true;
    const room = under ? BOX.y - 14 : SCREEN_H - 6;
    this.rows = Math.max(1, Math.min(options.length, rows ?? Infinity, Math.floor((room - 10) / 14)));
    this.top = 0;
    const w = Math.max(...options.map((o) => measure(o))) + 26;
    const h = this.rows * 14 + 10;
    this.w = Math.min(w, SCREEN_W - 6);
    this.h = h;
    this.x = x ?? SCREEN_W - this.w - 3;
    this.y = y ?? (under ? BOX.y - h - 2 : Math.round((SCREEN_H - h) / 2));
    this.scroll();
  }

  scroll() {
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + this.rows) this.top = this.sel - this.rows + 1;
  }

  update(e) {
    const inp = e.input;
    const n = this.options.length;
    const pt = pointRows(inp, this.x, this.y, this.w, this.h, this.y + 5, 14, this.rows);
    if (inp.pressed('up') || pt.wheel < 0) { this.sel = (this.sel + n - 1) % n; sfx('cursor'); }
    if (inp.pressed('down') || pt.wheel > 0) { this.sel = (this.sel + 1) % n; sfx('cursor'); }
    if (pt.hover >= 0 && this.top + pt.hover !== this.sel) { this.sel = this.top + pt.hover; sfx('cursor'); }
    this.scroll();
    if (inp.pressed('a') || pt.pick >= 0) { sfx('confirm'); this.done(this.sel); }
    else if (this.cancel && (inp.pressed('b') || pt.back)) { sfx('cancel'); this.done(-1); }
  }

  draw(ctx, e) {
    if (this.under) drawDialogBox(ctx, e, this.under, { indicator: false });
    frame(ctx, this.x, this.y, this.w, this.h);
    for (let r = 0; r < this.rows; r++) {
      const i = this.top + r;
      const y = this.y + 7 + r * 14;
      if (i === this.sel) drawText(ctx, '▶', this.x + 7, y, theme.accent, theme.shadow);
      drawText(ctx, this.options[i], this.x + 16, y, theme.text, theme.shadow);
    }
    scrollArrows(ctx, e, this.x + this.w - 9, this.y, this.h, this.top > 0, this.top + this.rows < this.options.length);
  }
}

function scrollArrows(ctx, e, x, y, h, up, down) {
  if (!blink(e, 20)) return;
  if (up) drawText(ctx, '▲', x - 2, y + 2, theme.accent, theme.shadow);
  if (down) drawText(ctx, '▼', x - 2, y + h - 10, theme.accent, theme.shadow);
}

// ---------- lists (bags, parties, shops, save slots) ----------

// A scrolling list of rows with an optional value on the right and a note shown in a box
// at the bottom for the selected row. Items: { label, value?, note?, disabled? } (strings,
// already translated). Resolves with the index, or -1 when cancelled with B.
//   opts: { title, x, y, w, rows, initial, cancel = true, onMove(i) }
export class List {
  constructor(items, { title = '', x = null, y = 3, w = null, rows = null, initial = 0, cancel = true, onMove = null } = {}) {
    this.items = items;
    this.title = title;
    this.cancel = cancel;
    this.onMove = onMove;
    this.sel = Math.max(0, Math.min(items.length - 1, initial));
    this.opaque = false;
    this.aboveFade = true;
    this.pointer = true;
    const hasNote = items.some((i) => i.note);
    const head = title ? 14 : 0;
    const room = SCREEN_H - y - 3 - (hasNote ? 34 : 0) - head - 10;
    this.rows = Math.max(1, Math.min(items.length, rows ?? Infinity, Math.floor(room / 14)));
    this.top = 0;
    const widest = Math.max(measure(title), ...items.map((i) => measure(i.label) + (i.value ? measure(String(i.value)) + 12 : 0)));
    this.w = Math.min(SCREEN_W - 6, w ?? widest + 30);
    this.h = this.rows * 14 + 10 + head;
    this.x = x ?? SCREEN_W - this.w - 3;
    this.y = y;
    this.head = head;
    this.hasNote = hasNote;
    this.scroll();
  }

  scroll() {
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + this.rows) this.top = this.sel - this.rows + 1;
  }

  update(e) {
    const inp = e.input;
    const n = this.items.length;
    const before = this.sel;
    const pt = pointRows(inp, this.x, this.y, this.w, this.h, this.y + 5 + this.head, 14, Math.min(this.rows, n - this.top));
    // a click on the note under the list is not a click outside it
    if (pt.back && !inp.pointer.back && this.hasNote && inp.pointIn(3, SCREEN_H - 34, SCREEN_W - 6, 31)) pt.back = false;
    if (inp.pressed('up') || pt.wheel < 0) this.sel = (this.sel + n - 1) % n;
    if (inp.pressed('down') || pt.wheel > 0) this.sel = (this.sel + 1) % n;
    if (pt.hover >= 0) this.sel = this.top + pt.hover;
    // left and right page through long lists
    if (inp.pressed('left')) this.sel = Math.max(0, this.sel - this.rows);
    if (inp.pressed('right')) this.sel = Math.min(n - 1, this.sel + this.rows);
    if (this.sel !== before) { sfx('cursor'); this.scroll(); this.onMove?.(this.sel); }
    if (inp.pressed('a') || pt.pick >= 0) {
      if (this.items[this.sel]?.disabled) { sfx('error'); return; }
      sfx('confirm');
      this.done(this.sel);
    } else if (this.cancel && (inp.pressed('b') || pt.back)) { sfx('cancel'); this.done(-1); }
  }

  draw(ctx, e) {
    frame(ctx, this.x, this.y, this.w, this.h);
    if (this.title) drawText(ctx, this.title, this.x + 9, this.y + 6, theme.accent, theme.shadow);
    for (let r = 0; r < this.rows; r++) {
      const i = this.top + r;
      const it = this.items[i];
      if (!it) break;
      const y = this.y + 7 + this.head + r * 14;
      const color = it.disabled ? theme.dim : theme.text;
      if (i === this.sel) drawText(ctx, '▶', this.x + 7, y, theme.accent, theme.shadow);
      drawText(ctx, it.label, this.x + 16, y, color, theme.shadow);
      if (it.value !== undefined && it.value !== null) {
        const v = String(it.value);
        drawText(ctx, v, this.x + this.w - 14 - measure(v), y, color, theme.shadow);
      }
    }
    scrollArrows(ctx, e, this.x + this.w - 6, this.y + this.head, this.h - this.head, this.top > 0, this.top + this.rows < this.items.length);
    const note = this.items[this.sel]?.note;
    if (this.hasNote) {
      frame(ctx, 3, SCREEN_H - 34, SCREEN_W - 6, 31);
      if (note) textBox(ctx, note, 11, SCREEN_H - 27, SCREEN_W - 22, { lines: 2 });
    }
  }
}

// ---------- widgets for a cartridge's own screens ----------

// A gauge (health, experience, a timer). Colours default to the theme.
export function bar(ctx, x, y, w, h, value, max, { fill = theme.accent, back = theme.shadow, border = theme.border, steps = 0 } = {}) {
  const k = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  ctx.fillStyle = border;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = back;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  // `steps` snaps the fill to whole segments, like hearts or pips
  const inner = w - 2;
  const filled = steps ? Math.round(k * steps) * (inner / steps) : Math.round(k * inner);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, Math.round(filled), h - 2);
  if (h > 3) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x + 1, y + 1, Math.round(filled), 1);
  }
}

// Wrapped text inside a width, cut to `lines`. Returns the number of lines drawn.
export function textBox(ctx, str, x, y, w, { lines = 99, color = theme.text, shadow = theme.shadow } = {}) {
  const rows = wrap(str, w).slice(0, lines);
  rows.forEach((l, i) => drawText(ctx, l, x, y + i * LINE_H, color, shadow));
  return rows.length;
}

// A framed panel with an optional title, for stats, prices or a party member.
export function panel(ctx, x, y, w, h, title = '') {
  frame(ctx, x, y, w, h);
  if (title) drawText(ctx, title, x + 8, y + 6, theme.accent, theme.shadow);
}

// ---------- full-screen card (chapter titles, interstitials) ----------

export class Card {
  constructor({ kicker = '', title = '', sub = '', bg = '#000000', color = '#ffffff', accent = theme.accent, frames = 150, draw = null }) {
    Object.assign(this, { kicker, title, sub, bg, color, accent, frames, custom: draw });
    this.t = 0;
    // a card paints its own background, so it shows even when the world is faded out
    this.aboveFade = true;
    this.pointer = true;
  }

  update(e) {
    this.t++;
    if (this.t > 30 && (e.input.pressed('a') || e.input.pressed('start') || clicked(e.input))) this.t = Math.max(this.t, this.frames);
    if (this.t >= this.frames) this.done();
  }

  draw(ctx, e) {
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    if (this.custom) this.custom(ctx, this.t, e);
    const a = Math.min(1, this.t / 30, (this.frames - this.t) / 25);
    ctx.globalAlpha = Math.max(0, Math.round(a * 6) / 6);
    if (this.kicker) drawText(ctx, this.kicker, centerX(this.kicker), 58, this.accent);
    if (this.title) drawBig(ctx, this.title, centerX(this.title, 2), 74, this.color, 2);
    if (this.sub) wrap(this.sub, 220).forEach((l, i) => drawText(ctx, l, centerX(l), 104 + i * LINE_H, this.accent));
    ctx.globalAlpha = 1;
  }
}

// ---------- the pause menu ----------

export class Menu {
  constructor(items, { objective = '', title = '' } = {}) {
    this.items = items;           // [{ label, run?: () => any, value?: () => string }]
    this.objective = objective;
    this.title = title;
    this.sel = 0;
    this.opaque = false;
    this.aboveFade = true;
    this.pointer = true;
  }

  box() {
    const w = Math.max(...this.items.map((i) => measure(i.label + (i.value ? `  ${i.value()}` : '')))) + 28;
    return { x: SCREEN_W - w - 3, w, h: this.items.length * 14 + 10 };
  }

  update(e) {
    const inp = e.input;
    const n = this.items.length;
    const { x, w, h } = this.box();
    const pt = pointRows(inp, x, 3, w, h, 8, 14, n);
    if (inp.pressed('up') || pt.wheel < 0) { this.sel = (this.sel + n - 1) % n; sfx('cursor'); }
    if (inp.pressed('down') || pt.wheel > 0) { this.sel = (this.sel + 1) % n; sfx('cursor'); }
    if (pt.hover >= 0 && pt.hover !== this.sel) { this.sel = pt.hover; sfx('cursor'); }
    if (inp.pressed('b') || inp.pressed('start') || pt.back) { sfx('cancel'); this.done(null); return; }
    if (inp.pressed('a') || pt.pick >= 0) {
      const it = this.items[this.sel];
      sfx('confirm');
      if (it.toggle) { it.toggle(); return; }
      this.done(it.id);
    }
  }

  draw(ctx) {
    const { x, w, h } = this.box();
    frame(ctx, x, 3, w, h);
    this.items.forEach((it, i) => {
      const y = 10 + i * 14;
      if (i === this.sel) drawText(ctx, '▶', x + 7, y, theme.accent, theme.shadow);
      drawText(ctx, it.label, x + 16, y, theme.text, theme.shadow);
      if (it.value) {
        const v = it.value();
        drawText(ctx, v, x + w - 9 - measure(v), y, theme.accent, theme.shadow);
      }
    });
    if (this.objective) {
      const lines = wrap(this.objective, 210).slice(0, 2);
      frame(ctx, 3, SCREEN_H - 14 - lines.length * LINE_H - 4, SCREEN_W - 6, lines.length * LINE_H + 16);
      const y0 = SCREEN_H - 10 - lines.length * LINE_H - 2;
      if (this.title) drawText(ctx, this.title, 11, y0, theme.accent, theme.shadow);
      lines.forEach((l, i) => drawText(ctx, l, 11, y0 + (this.title ? 0 : 0) + (i + (this.title ? 1 : 0)) * LINE_H, theme.text, theme.shadow));
    }
  }
}

// ---------- the backlog (what has been said, to read again) ----------

// entries: [{ name, text }], oldest first. Opens at the end; ↑↓ scroll, A/B/START close.
// The end credits: rows that scroll up over a backdrop, then a closing line that stays
// until A or START. rows: [{ text, kind: 'title' | 'name' | 'gap' }], already in Spanish.
export class Credits {
  constructor(rows, { bg = null, speed = 0.35, end = '' } = {}) {
    this.rows = rows;
    this.bg = bg;
    this.speed = speed;
    this.end = end;
    this.y = SCREEN_H;
    this.f = 0;
    this.height = rows.reduce((h, r) => h + (r.kind === 'title' ? 20 : r.kind === 'gap' ? 14 : 12), 0);
    // the credits paint their own black: they show even when the story faded out first
    this.aboveFade = true;
    this.pointer = true;
  }

  // the last row has left the screen: the closing line stays
  get finished() { return this.y + this.height < 0; }

  update(e) {
    this.f++;
    const inp = e.input;
    if (!this.finished) {
      this.y -= inp.held('a') || inp.held('b') || inp.pointer?.down ? this.speed * 4 : this.speed;
      return;
    }
    if (inp.pressed('a') || inp.pressed('start') || clicked(inp)) { sfx('confirm'); this.done(); }
  }

  draw(ctx, e) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    this.bg?.(ctx, this.f);
    let y = Math.round(this.y);
    for (const r of this.rows) {
      const h = r.kind === 'title' ? 20 : r.kind === 'gap' ? 14 : 12;
      if (r.text && y > -20 && y < SCREEN_H + 4) {
        if (r.kind === 'title') drawText(ctx, r.text, centerX(r.text), y, theme.accent, '#000');
        else drawText(ctx, r.text, centerX(r.text), y, '#ffffff', '#000');
      }
      y += h;
    }
    if (this.finished) {
      big(ctx, this.end, centerX(this.end, 2), SCREEN_H / 2 - 8, '#ffffff', 2, '#000');
      const press = t(hint('console.credits.press'));
      if (blink(e, 30)) drawText(ctx, press, centerX(press), SCREEN_H - 20, theme.dim, '#000');
    }
  }
}

export class Log {
  constructor(entries, title = '') {
    this.title = title;
    this.opaque = false;
    this.aboveFade = true;
    this.pointer = true;
    this.lines = [];
    for (const en of entries) {
      if (en.name) this.lines.push({ text: en.name, name: true });
      for (const l of wrap(en.text, SCREEN_W - 30)) this.lines.push({ text: l });
      this.lines.push({ text: '' });
    }
    this.rows = Math.floor((SCREEN_H - 30) / LINE_H);
    this.top = Math.max(0, this.lines.length - this.rows);
  }

  update(e) {
    const inp = e.input;
    const max = Math.max(0, this.lines.length - this.rows);
    if (inp.held('up') && e.frame % 4 === 0) this.top = Math.max(0, this.top - 1);
    if (inp.held('down') && e.frame % 4 === 0) this.top = Math.min(max, this.top + 1);
    if (inp.pressed('left')) this.top = Math.max(0, this.top - this.rows);
    if (inp.pressed('right')) this.top = Math.min(max, this.top + this.rows);
    const wheel = inp.pointer?.wheel || 0;
    if (wheel) this.top = Math.max(0, Math.min(max, this.top + wheel * 3));
    if (inp.pressed('b') || inp.pressed('a') || inp.pressed('start') || clicked(inp) || inp.pointer?.back) { sfx('cancel'); this.done(); }
  }

  draw(ctx, e) {
    frame(ctx, 3, 3, SCREEN_W - 6, SCREEN_H - 6);
    if (this.title) drawText(ctx, this.title, 11, 9, theme.accent, theme.shadow);
    for (let r = 0; r < this.rows; r++) {
      const l = this.lines[this.top + r];
      if (!l) break;
      drawText(ctx, l.text, l.name ? 11 : 15, 22 + r * LINE_H, l.name ? theme.accent : theme.text, theme.shadow);
    }
    scrollArrows(ctx, e, SCREEN_W - 9, 3, SCREEN_H - 6, this.top > 0, this.top + this.rows < this.lines.length);
  }
}

// ---------- the location banner (non-blocking) ----------

let shownBanner = null;
export function banner(e, label, frames = 150) {
  const start = e.frame;
  const w = measure(label) + 20;
  // a new place replaces the sign of the last one instead of stacking on it
  if (shownBanner) e.post.splice(e.post.indexOf(shownBanner) >>> 0, 1);
  const pass = (ctx) => {
    const t = e.frame - start;
    if (t > frames) { e.post.splice(e.post.indexOf(pass), 1); if (shownBanner === pass) shownBanner = null; return; }
    const slide = Math.min(1, t / 12, (frames - t) / 12);
    const y = Math.round(-22 + slide * 25);
    frame(ctx, 3, y, w, 19);
    drawText(ctx, label, 13, y + 6, theme.text, theme.shadow);
  };
  e.post.push(pass);
  shownBanner = pass;
}

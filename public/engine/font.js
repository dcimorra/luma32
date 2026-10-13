// The console's bitmap font. Cap height 7, x-height 5, two rows of descender and three
// rows above the caps for accents. Accented letters are composed from a base glyph
// and a mark, so the whole Spanish alphabet costs a handful of lines.
import { canvas } from './gfx.js';
import { GLYPHS as G, MARKS, COMPOSED } from './glyphs.js';

export const LINE_H = 12;   // distance between baselines in a text box
const ROWS = 12;            // -3..8 relative to the cap line
const TOP = 3;              // row index of the cap line inside a glyph bitmap


const glyphs = new Map(); // char -> { w, bits: Uint8Array(w*ROWS) }

function parse(def) {
  const rows = def.split('|');
  const w = Math.max(...rows.map((r) => r.length));
  const bits = new Uint8Array(w * ROWS);
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') bits[(j + TOP) * w + i] = 1; });
  return { w, bits };
}

for (const [ch, def] of Object.entries(G)) glyphs.set(ch, parse(def));
for (const [ch, [base, mark]] of Object.entries(COMPOSED)) {
  const b = glyphs.get(base);
  let w = b.w;
  // í and ï need room for a mark wider than the stem
  if (base === 'ı') w = mark === 'dier' ? 3 : 2;
  const bits = new Uint8Array(w * ROWS);
  const off = base === 'ı' ? (w === 3 ? 1 : 0) : 0;
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < b.w; i++) bits[j * w + i + off] = b.bits[j * b.w + i];
  if (ch === 'ç') { bits[(TOP + 7) * w + 1] = 1; bits[(TOP + 8) * w + 0] = 1; }
  if (mark) {
    const upper = base === base.toUpperCase() && base !== 'ı';
    const top = upper ? TOP : TOP + 2; // marks sit two rows above, leaving a gap row
    const cx = Math.floor((w - 1) / 2);
    for (const [dx, dy] of MARKS[mark]) {
      const x = cx + dx;
      const y = top + dy + (upper ? 0 : 0);
      if (x >= 0 && x < w && y >= 0) bits[y * w + x] = 1;
    }
  }
  glyphs.set(ch, { w, bits });
}
const fallback = glyphs.get('?');

function glyph(ch) { return glyphs.get(ch) || glyphs.get(ch.normalize('NFD')[0]) || fallback; }

export function charWidth(ch) { return glyph(ch).w + 1; }

export function measure(str) {
  let w = 0;
  for (const ch of str) w += charWidth(ch);
  return Math.max(0, w - 1);
}

// Each colour gets its own atlas the first time it is used.
const atlases = new Map();
function atlasFor(color) {
  let a = atlases.get(color);
  if (a) return a;
  a = new Map();
  atlases.set(color, a);
  return a;
}

function glyphImage(ch, color) {
  const atlas = atlasFor(color);
  let img = atlas.get(ch);
  if (img) return img;
  const g = glyph(ch);
  img = canvas(Math.max(1, g.w), ROWS);
  const ctx = img.getContext('2d');
  ctx.fillStyle = color;
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < g.w; i++) if (g.bits[j * g.w + i]) ctx.fillRect(i, j, 1, 1);
  atlas.set(ch, img);
  return img;
}

// Draws text with its cap line at y. `shadow` paints a 1px drop shadow first (GBA style).
export function drawText(ctx, str, x, y, color = '#ffffff', shadow = null) {
  let cx = Math.round(x);
  const top = Math.round(y) - TOP;
  for (const ch of String(str)) {
    if (ch !== ' ') {
      if (shadow) ctx.drawImage(glyphImage(ch, shadow), cx + 1, top + 1);
      ctx.drawImage(glyphImage(ch, color), cx, top);
    }
    cx += charWidth(ch);
  }
  return cx;
}

// Greedy word wrap to a pixel width. Explicit \n is respected.
export function wrap(str, width) {
  const out = [];
  for (const para of String(str).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= width || !line) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

// Text at an integer scale, for titles. Rendered once per (string, colour, scale).
const bigCache = new Map();
export function drawBig(ctx, str, x, y, color = '#ffffff', scale = 2, shadow = null) {
  const key = `${str}|${color}|${scale}|${shadow}`;
  let img = bigCache.get(key);
  if (!img) {
    const w = measure(str) + 2;
    const small = canvas(w, ROWS + 1);
    drawText(small.getContext('2d'), str, 0, TOP, color, shadow);
    img = canvas(w * scale, (ROWS + 1) * scale);
    const c = img.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.drawImage(small, 0, 0, img.width, img.height);
    if (bigCache.size > 200) bigCache.clear();
    bigCache.set(key, img);
  }
  ctx.drawImage(img, Math.round(x), Math.round(y - TOP * scale));
  return img.width;
}

export const measureBig = (str, scale = 2) => measure(str) * scale;

// Low-level drawing: offscreen canvases, a Painter for authoring pixel art in code,
// and colour helpers. Everything here works in native GBA pixels (240x160 screen).

// The screen's size. `let`, not `const`: while the world is drawn pulled back (the
// camera zoomed out, engine/world.js) these are the bigger picture's size, and every
// module that imports them sees it; setView puts them back at once after.
export let SCREEN_W = 240;
export let SCREEN_H = 160;
export const BASE_W = 240;
export const BASE_H = 160;
export function setView(w = BASE_W, h = BASE_H) { SCREEN_W = w; SCREEN_H = h; }
export const TILE = 16;

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return c;
}

// A picture's pixels (RGBA, as ImageData), read through one scratch canvas made for
// reading back: a canvas drawn on is not, and the browser warns at every read of it.
let reader;
export function pixels(img) {
  const w = img.width;
  const h = img.height;
  if (!reader || reader.width < w || reader.height < h) {
    const rw = Math.max(w, reader?.width || 0);
    const rh = Math.max(h, reader?.height || 0);
    reader = document.createElement('canvas');
    reader.width = rw;
    reader.height = rh;
  }
  const ctx = reader.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

// ---------- colour ----------

export function hex(c) {
  const n = parseInt(c.slice(1), 16);
  if (c.length === 4) return [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgb(r, g, b) {
  const v = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${v(r)}${v(g)}${v(b)}`;
}

// GBA colours are 15-bit: snapping keeps palettes honest.
export function snap(c) {
  const [r, g, b] = hex(c);
  const q = (x) => Math.round(x / 255 * 31) * 255 / 31;
  return rgb(q(r), q(g), q(b));
}

export function mix(a, b, t) {
  const A = hex(a);
  const B = hex(b);
  return rgb(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

export const shade = (c, t = 0.3) => mix(c, '#000000', t);
export const tint = (c, t = 0.3) => mix(c, '#ffffff', t);

// Deterministic randomness so procedural art is identical on every load.
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---------- painter ----------

// Neighbour bits of an autotile's mask: set when that neighbour is the same ground.
export const EDGE = { N: 1, E: 2, S: 4, W: 8, NE: 16, SE: 32, SW: 64, NW: 128 };

let warnedLine = false;   // Painter.line said once that it got a NaN

// A Painter draws on a small canvas with pixel primitives. Tiles, props and
// sprites are authored as functions of a painter, so a game ships no image files.
export class Painter {
  constructor(w, h, seed = 7) {
    this.canvas = canvas(w, h);
    this.ctx = this.canvas.getContext('2d');
    this.w = w;
    this.h = h;
    this.rand = rng(seed);
  }

  fill(c) { return this.rect(0, 0, this.w, this.h, c); }

  rect(x, y, w, h, c) {
    if (!c) return this;
    this.ctx.fillStyle = c;
    this.ctx.fillRect(x, y, w, h);
    return this;
  }

  px(x, y, c) { return this.rect(x, y, 1, 1, c); }
  hline(x, y, w, c) { return this.rect(x, y, w, 1, c); }
  vline(x, y, h, c) { return this.rect(x, y, 1, h, c); }

  // Outlined box: border colour, fill, optional top highlight and bottom shadow.
  box(x, y, w, h, border, fill, light, dark) {
    this.rect(x, y, w, h, border);
    this.rect(x + 1, y + 1, w - 2, h - 2, fill);
    if (light) this.hline(x + 1, y + 1, w - 2, light);
    if (dark) this.hline(x + 1, y + h - 2, w - 2, dark);
    return this;
  }

  // Checkerboard of two colours, the GBA way of faking a third.
  dither(x, y, w, h, a, b, phase = 0) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, (i + j + phase) % 2 ? b : a);
    return this;
  }

  // Sprinkle colours at random over an area.
  noise(x, y, w, h, colors, density = 0.1) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (this.rand() < density) this.px(x + i, y + j, colors[Math.floor(this.rand() * colors.length)]);
      }
    }
    return this;
  }

  line(x0, y0, x1, y1, c) {
    // a NaN would never reach its end, nor would ends a fraction apart: one bad prop must
    // not freeze the game. Whole-number spans draw exactly as they always did.
    if (![x0, y0, x1, y1].every(Number.isFinite)) {
      if (!warnedLine) { warnedLine = true; console.warn(`[luma] Painter.line(${x0}, ${y0}, ${x1}, ${y1}): not a number, nothing drawn.`); }
      return this;
    }
    if (!Number.isInteger(x1 - x0) || !Number.isInteger(y1 - y0)) { x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1); }
    let dx = Math.abs(x1 - x0);
    let dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }

  ellipse(cx, cy, rx, ry, c) {
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        if ((x * x) / (rx * rx + 0.5) + (y * y) / (ry * ry + 0.5) <= 1) this.px(cx + x, cy + y, c);
      }
    }
    return this;
  }

  // Pixel strings: each char is looked up in `pal`; '.' and ' ' are transparent.
  pix(x, y, rows, pal) {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = pal[row[i]];
        if (c) this.px(x + i, y + j, c);
      }
    });
    return this;
  }

  // Autotile edges. `mask` says which neighbours are the same ground (EDGE bits; the
  // engine passes it to a tile with `auto`). Paints a band along each side that borders
  // other ground, the inner corners (both sides the same, the diagonal not), and rounds
  // the outer corners one step so two open sides meet in a curve, not a square.
  //   p.edge(mask, { color, width: 2, inner: color, round: true })
  edge(mask, { color, width = 2, inner = color, round = true } = {}) {
    const { w, h } = this;
    const k = width;
    const n = mask & EDGE.N, e = mask & EDGE.E, s = mask & EDGE.S, wst = mask & EDGE.W;
    if (!n) this.rect(0, 0, w, k, color);
    if (!s) this.rect(0, h - k, w, k, color);
    if (!wst) this.rect(0, 0, k, h, color);
    if (!e) this.rect(w - k, 0, k, h, color);
    if (n && wst && !(mask & EDGE.NW)) this.rect(0, 0, k, k, inner);
    if (n && e && !(mask & EDGE.NE)) this.rect(w - k, 0, k, k, inner);
    if (s && e && !(mask & EDGE.SE)) this.rect(w - k, h - k, k, k, inner);
    if (s && wst && !(mask & EDGE.SW)) this.rect(0, h - k, k, k, inner);
    if (round) {
      if (!n && !wst) this.rect(k, k, 1, 1, color);
      if (!n && !e) this.rect(w - k - 1, k, 1, 1, color);
      if (!s && !e) this.rect(w - k - 1, h - k - 1, 1, 1, color);
      if (!s && !wst) this.rect(k, h - k - 1, 1, 1, color);
    }
    return this;
  }

  // Draw another canvas (or painter) on this one.
  stamp(src, x = 0, y = 0, flip = false) {
    const img = src.canvas || src;
    if (flip) {
      this.ctx.save();
      this.ctx.translate(x + img.width, y);
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(img, 0, 0);
      this.ctx.restore();
    } else {
      this.ctx.drawImage(img, x, y);
    }
    return this;
  }
}

export function paint(w, h, fn, seed) {
  const p = new Painter(w, h, seed);
  fn(p);
  return p.canvas;
}

// Replaces every colour of a canvas through a function (r,g,b) -> [r,g,b].
// Used to grade art for a world (the Matrix green, the real world's cold steel).
export function recolor(src, fn) {
  const out = canvas(src.width, src.height);
  const ctx = out.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const [r, g, b] = fn(d[i], d[i + 1], d[i + 2]);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

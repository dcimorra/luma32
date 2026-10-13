// Groups: games kept together on the shelf, and groups inside groups, to sort them any way
// at all (by kind of game, by story, by both). A group lives in groups/<id>/: group.js
// (its default export draws its art: cover(ctx, x, y, w, h, f), and may give a `spine`
// colour) and locales/es.json (meta.title, meta.tagline), read under the catalogue
// `group:<id>`. Two kinds, two looks on the shelf:
// - saga: one story's games. A game case, its cartridges peeking out behind.
// - collection: a kind of game, or any other heading. A storage box with a lid and a tab.
// A opens either; inside are its groups and cartridges, as on the shelf; B goes back up.
//
// boxArt() is the art a new group starts with: night bands in its colours, a moon, hills and
// its title. A group can swap it for art of its own at any time.
import { drawText, drawBig, measure, measureBig } from './font.js';
import { t } from './i18n.js';

const px = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
const W = 68;
const H = 82;

// The art behind the clear front, and how many games the group holds, under it.
function front(ctx, x, y, w, h, art, f, count, sel) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  art?.cover?.(ctx, x, y, w, h, f);
  ctx.restore();
  px(ctx, x, y, w, 1, 'rgba(255,255,255,0.18)');
  px(ctx, x + w - 6, y + 2, 2, h - 4, 'rgba(255,255,255,0.06)');
  const n = t(count === 1 ? 'console.shelf.group_count_one' : 'console.shelf.group_count', { n: count });
  drawText(ctx, n, x + Math.round((w - measure(n)) / 2), y + h + 2, sel ? '#e8e6ff' : '#a8a4d8');
}

// A group on the shelf, `W`×`H` like a cartridge. count: the games in it, nested ones too.
export function drawGroup(ctx, x, y, group, f, sel, count) {
  if (group.kind === 'collection') drawCollection(ctx, x, y, group.art, f, sel, count);
  else drawSaga(ctx, x, y, group.art, f, sel, count);
}

function drawSaga(ctx, x, y, art, f, sel, count) {
  // the cartridges inside, their tops showing behind the case
  for (let i = Math.min(count, 3) - 1; i >= 0; i--) {
    const bx = x + 6 + i * 5;
    const by = y - 5 - i * 3;
    px(ctx, bx, by, W - 14, 10, sel ? '#6e6c80' : '#565466');
    px(ctx, bx + 1, by + 1, W - 16, 8, sel ? '#b8b6c4' : '#8a889a');
    px(ctx, bx + 8, by, W - 30, 2, sel ? '#6e6c80' : '#565466');
  }
  px(ctx, x + 3, y + 4, W, H, '#0a0918');
  px(ctx, x, y, W, H, sel ? '#4a4670' : '#34305a');
  px(ctx, x + 1, y + 1, W - 2, H - 2, '#16142e');
  // the spine, in the saga's colour
  px(ctx, x + 1, y + 1, 5, H - 2, art?.spine || '#8a2a4a');
  px(ctx, x + 2, y + 1, 1, H - 2, 'rgba(255,255,255,0.25)');
  front(ctx, x + 8, y + 3, W - 11, H - 15, art, f, count, sel);
}

function drawCollection(ctx, x, y, art, f, sel, count) {
  const body = sel ? '#c8a878' : '#9a805c';
  const dark = sel ? '#8a6a40' : '#6a5234';
  const light = sel ? '#ecd4a8' : '#b89a70';
  // the lid, a little wider than the box, and a paper tab on it
  px(ctx, x + 3, y + 4, W, H, '#0a0918');
  px(ctx, x - 1, y, W + 2, 9, dark);
  px(ctx, x, y + 1, W, 6, light);
  const tab = t('console.shelf.collection');
  const tw = measure(tab) + 8;
  px(ctx, x + Math.round((W - tw) / 2), y - 10, tw, 11, '#f4f2ea');
  px(ctx, x + Math.round((W - tw) / 2), y - 10, tw, 1, '#ffffff');
  drawText(ctx, tab, x + Math.round((W - measure(tab)) / 2), y - 8, '#6a5234');
  // the box, with a cut-out handle at each side
  px(ctx, x, y + 8, W, H - 8, dark);
  px(ctx, x + 1, y + 8, W - 2, H - 9, body);
  px(ctx, x + 2, y + 40, 3, 6, dark);
  px(ctx, x + W - 5, y + 40, 3, 6, dark);
  // the label stuck on its front
  px(ctx, x + 7, y + 12, W - 14, H - 25, '#0a0918');
  front(ctx, x + 8, y + 13, W - 16, H - 27, art, f, count, sel);
}

// The first place on the shelf: where to search, a magnifier on a blank card.
export function drawSearch(ctx, x, y, f, sel) {
  px(ctx, x + 3, y + 4, W, H, '#0a0918');
  px(ctx, x, y, W, H, sel ? '#5fd0ff' : '#3a3670');
  px(ctx, x + 1, y + 1, W - 2, H - 2, sel ? '#1c1948' : '#16142e');
  const cx = x + 30;
  const cy = y + 32 + (sel ? Math.round(Math.sin(f / 15)) : 0);
  const glass = sel ? '#e8e6ff' : '#a8a4d8';
  for (let dy = -10; dy <= 10; dy++) {
    const half = Math.round(Math.sqrt(100 - dy * dy));
    const inner = dy > -8 && dy < 8 ? Math.round(Math.sqrt(64 - dy * dy)) : -1;
    if (inner < 0) px(ctx, cx - half, cy + dy, half * 2 + 1, 1, glass);
    else { px(ctx, cx - half, cy + dy, half - inner, 1, glass); px(ctx, cx + inner + 1, cy + dy, half - inner, 1, glass); }
  }
  px(ctx, cx - 4, cy - 5, 3, 2, 'rgba(255,255,255,0.5)');
  for (let i = 0; i < 10; i++) px(ctx, cx + 7 + i, cy + 7 + i, 4, 3, sel ? '#ffd25f' : '#8a86c0');
  const label = t('console.shelf.search');
  drawText(ctx, label, x + Math.round((W - measure(label)) / 2), y + H - 15, glass);
}

// The art of a group whose player uploaded a cover: the image filling the front, cropped to
// it, its pixels kept sharp. The spine takes the image's average colour, darkened.
export function imageArt(img) {
  let spine = '#3a2a5a';
  try {
    const c = new OffscreenCanvas(1, 1).getContext('2d');
    c.drawImage(img, 0, 0, 1, 1);
    const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
    spine = `rgb(${Math.round(r * 0.6)}, ${Math.round(g * 0.6)}, ${Math.round(b * 0.6)})`;
  } catch { /* the default spine */ }
  return {
    spine,
    cover(ctx, x, y, w, h) {
      const k = Math.max(w / img.width, h / img.height);
      const dw = img.width * k;
      const dh = img.height * k;
      const smooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      ctx.imageSmoothingEnabled = smooth;
    },
  };
}

// The colours of a group without art of its own, picked by its id so it keeps them.
const BOX_COLORS = [
  { top: '#140c34', bottom: '#5a1a3a', ink: '#f0d890', glow: '#ff8ab0' },
  { top: '#06142e', bottom: '#1a4a6a', ink: '#e8f4ff', glow: '#5fd0ff' },
  { top: '#0e1a0c', bottom: '#2f5a24', ink: '#f4f0c0', glow: '#9ae06a' },
  { top: '#1e0c06', bottom: '#7a3a12', ink: '#ffe8b0', glow: '#ffb050' },
  { top: '#120a20', bottom: '#3a2a6a', ink: '#e8e0ff', glow: '#b09aff' },
];
export function defaultArt(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const colors = BOX_COLORS[h % BOX_COLORS.length];
  return { spine: colors.bottom, cover: boxArt(colors) };
}

// The art a new group starts with. colors: { top, bottom, ink, glow } as #rrggbb.
export function boxArt({ top = '#1a1440', bottom = '#5a1a3a', ink = '#f0d890', glow = '#ff8ab0' } = {}) {
  const mix = (a, b, k) => `#${[1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - k) + parseInt(b.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('')}`;
  return (ctx, x, y, w, h, f = 0) => {
    const bands = 8;
    for (let i = 0; i < bands; i++) px(ctx, x, y + Math.floor((h * i) / bands), w, Math.ceil(h / bands) + 1, mix(top, bottom, i / (bands - 1)));
    for (let i = 0; i < 12; i++) {
      const sx = x + ((i * 37) % w);
      const sy = y + ((i * 23) % Math.floor(h * 0.6));
      if ((f + i * 13) % 90 > 8) px(ctx, sx, sy, 1, 1, i % 3 ? '#ffffff' : glow);
    }
    // a moon with a halo, and two ranges of hills, each darker than the sky behind it
    const mx = x + w - 16;
    const my = y + 14;
    for (const [r, c] of [[9, mix(top, glow, 0.25)], [7, mix(top, glow, 0.6)], [5, mix(glow, '#ffffff', 0.5)]]) {
      for (let dy = -r; dy <= r; dy++) {
        const half = Math.round(Math.sqrt(r * r - dy * dy));
        px(ctx, mx - half, my + dy, half * 2 + 1, 1, c);
      }
    }
    px(ctx, mx + 1, my - 2, 2, 2, mix(glow, top, 0.3));
    for (const [base, amp, period, c] of [[0.62, 6, 11, mix(bottom, top, 0.55)], [0.74, 5, 7, mix(bottom, '#000000', 0.55)]]) {
      for (let i = 0; i < w; i++) {
        const peak = y + Math.round(h * base - Math.abs(Math.sin((i + period) / period)) * amp);
        px(ctx, x + i, peak, 1, y + h - peak, c);
      }
    }
    // the title, as large as it fits, word by word
    const words = t('meta.title').toUpperCase().split(/\s+/).map((word) => ({ word, big: measureBig(word, 2) <= w - 4 }));
    let ty = y + h - 4 - words.reduce((sum, l) => sum + (l.big ? 16 : 9), 0);
    for (const { word, big } of words) {
      if (big) drawBig(ctx, word, x + Math.round((w - measureBig(word, 2)) / 2), ty, ink, 2, '#000');
      else drawText(ctx, word, x + Math.round((w - measure(word)) / 2), ty, ink, '#000');
      ty += big ? 16 : 9;
    }
  };
}

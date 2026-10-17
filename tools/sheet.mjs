// Contact sheet of a cartridge's art: every ground tile repeated 3×3 (seams and grids show
// up at once), every prop on its own, every doll in its 12 frames plus a black silhouette
// at the frame's own size (a tall doll's 16×26 too), all at 2× on PNG pages. Prints a report:
// colours per image and ground tiles whose edges stand out (right for a shore or a wall, a
// visible grid on plain ground). Not part of the site.
//   node tools/sheet.mjs <base-url> <game-id> <out.png> [--only tiles,props,dolls] [--match text]
// e.g. node tools/sheet.mjs http://127.0.0.1:8765 diamante /tmp/diamante-sheet.png --only dolls
// --only draws those kinds alone; --match only the ids that contain the text. A sheet
// taller than SHEET_PAGE pixels (4000) goes on pages: out.png, out-2.png, out-3.png…
// A doll whose spec already has `frames` (built by the cartridge) is drawn as it is.
// It gives up after SHEET_TIMEOUT seconds (300) and says what it was drawing when it hung.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT || 'playwright-core');
const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf(`--${k}`); if (i < 0) return ''; const v = argv[i + 1] || ''; argv.splice(i, 2); return v; };
const only = flag('only').split(',').filter(Boolean);
const match = flag('match');
const [base, id, out] = argv;
if (!base || !id || !out || only.some((k) => !['tiles', 'props', 'dolls'].includes(k))) {
  console.error('usage: node tools/sheet.mjs <base-url> <game-id> <out.png> [--only tiles,props,dolls] [--match text]');
  process.exit(2);
}
const pageH = Number(process.env.SHEET_PAGE) || 4000;
const timeout = Number(process.env.SHEET_TIMEOUT) || 300;

const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || pw.chromium.executablePath() });
let drawing = 'the cartridge (loading it)';
// a run that hangs must not leave its browser behind
let gaveUp = false;
setTimeout(async () => { gaveUp = true; console.log(`[sheet] gave up after ${timeout} s, while drawing ${drawing}; browser closed`); await browser.close().catch(() => {}); process.exit(1); }, timeout * 1e3).unref();
process.on('unhandledRejection', async (e) => {
  if (gaveUp) return; console.log(`[sheet] ${e?.message || e}`); await browser.close().catch(() => {}); process.exit(1); });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { const t = m.text(); if (t.startsWith('[sheet-at] ')) drawing = t.slice(11); });
await page.goto(`${base}/`);
const res = await page.evaluate(async ({ id, only, match, pageH }) => {
  const { Tileset } = await import('/engine/world.js');
  const { doll, dollDefaults } = await import('/engine/doll.js');
  const game = (await import(`/games/${id}/game.js`)).default;
  // the cast as the game shows it: its own defaults (`relief`), as cart.js sets them
  dollDefaults?.({ relief: game.relief });
  await game.setup?.();
  const tiles = new Tileset(game.tiles || {});
  const S = 2;
  const pad = 6;
  const W = 900;
  const report = [];
  const colours = (img) => {
    const d = img.getContext('2d').getImageData(0, 0, img.width, img.height).data;
    const set = new Set();
    let opaque = true;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 255) { opaque = false; continue; }
      set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    }
    return { n: set.size, opaque, d };
  };
  // a repeated tile draws a line when a border row/column is clearly lighter or darker than
  // the tile as a whole: the eye joins it with the same edge of the next copy
  const seam = (d, w, h) => {
    const lum = (x, y) => { const i = (y * w + x) * 4; return 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; };
    const mean = (pts) => pts.reduce((a, b) => a + b, 0) / pts.length;
    let all = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) all.push(lum(x, y));
    const m = mean(all);
    const out = [];
    const edges = { top: Array.from({ length: w }, (_, x) => lum(x, 0)), bottom: Array.from({ length: w }, (_, x) => lum(x, h - 1)),
      left: Array.from({ length: h }, (_, y) => lum(0, y)), right: Array.from({ length: h }, (_, y) => lum(w - 1, y)) };
    for (const [k, pts] of Object.entries(edges)) if (Math.abs(mean(pts) - m) > 22) out.push(`${k} ${mean(pts) < m ? 'darker' : 'lighter'}`);
    return out;
  };
  const items = [];
  const want = (kind, key) => (!only.length || only.includes(kind)) && (!match || key.includes(match));
  // what is being drawn, for the timeout's message: an endless loop in a painter freezes
  // this page, but not the line already sent
  const at = (what) => console.log(`[sheet-at] ${what}`);
  for (const tid of Object.keys(game.tiles || {})) {
    if (only.length && !only.some((k) => k !== 'dolls') || (match && !tid.includes(match))) continue;
    let img;
    at(`tile ${tid}`);
    try { img = tiles.image(tid, 0); } catch (err) { report.push(`${tid}: ERROR ${err.message}`); continue; }
    const c = colours(img);
    const ground = c.opaque && img.width === 16 && img.height === 16;
    if (!want(ground ? 'tiles' : 'props', tid)) continue;
    const s = ground ? seam(c.d, 16, 16) : [];
    report.push(`${ground ? 'tile' : 'prop'} ${tid}: ${c.n} colours${c.n > 15 ? ' (over 15)' : ''}${s.length ? ` · edge stands out: ${s.join(', ')}` : ''}`);
    items.push({ label: tid, w: ground ? 48 : img.width, h: ground ? 48 : img.height, draw(ctx, x, y) {
      if (ground) for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) ctx.drawImage(img, x + i * 16, y + j * 16);
      else ctx.drawImage(img, x, y);
    } });
  }
  for (const [did, spec] of Object.entries(game.dolls || {})) {
    if (!want('dolls', did)) continue;
    at(`doll ${did}`);
    let dl;
    // a prebuilt doll (spec.frames) is drawn as the cartridge built it
    try { dl = spec.frames ? spec : doll(spec); } catch (err) { report.push(`doll ${did}: ERROR ${err.message}`); continue; }
    const frames = ['down', 'up', 'left', 'right'].flatMap((d) => dl.frames[d] || []);
    if (!frames.length) { report.push(`doll ${did}: no frames`); continue; }
    // each frame at its own size, feet on one line: a tall doll's 16×26 shows whole
    const fw = Math.max(...frames.map((f) => f.width));
    const fh = Math.max(...frames.map((f) => f.height));
    const first = dl.frames.down?.[0] || frames[0];
    const sil = document.createElement('canvas');
    sil.width = first.width; sil.height = first.height;
    const sx = sil.getContext('2d');
    sx.drawImage(first, 0, 0);
    sx.globalCompositeOperation = 'source-in';
    sx.fillStyle = '#000';
    sx.fillRect(0, 0, sil.width, sil.height);
    const size = first.width !== 16 || first.height !== 24 ? ` · ${first.width}×${first.height}` : '';
    report.push(`doll ${did}: ${colours(first).n} colours${size}`);
    const step = fw + 2;
    items.push({ label: did, w: frames.length * step + fw + 2, h: fh, draw(ctx, x, y) {
      frames.forEach((f, i) => ctx.drawImage(f, x + i * step, y + fh - f.height));
      ctx.drawImage(sil, x + frames.length * step + 2, y + fh - sil.height);
    } });
  }
  // shelf layout at 1×, then scaled; a row that would go past a page's height starts the next
  at('the pages');
  const pages = [[]];
  let x = pad, y = pad + 8, rowH = 0;
  for (const it of items) {
    const w = Math.max(it.w, it.label.length * 4);
    if (x + w > W / S - pad) {
      x = pad; y += rowH + 14; rowH = 0;
      if ((y + it.h + pad) * S > pageH && pages.at(-1).length) { pages.push([]); y = pad + 8; }
    }
    pages.at(-1).push({ it, x, y });
    x += w + pad;
    rowH = Math.max(rowH, it.h);
  }
  const pngs = pages.map((placed) => {
    const H = Math.max(...placed.map(({ it, y }) => y + it.h), 0) * S + pad * S;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = Math.max(H, 40);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#6a6a72';
    ctx.fillRect(0, 0, W, cv.height);
    ctx.save();
    ctx.scale(S, S);
    for (const { it, x, y } of placed) it.draw(ctx, x, y);
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.font = '10px monospace';
    for (const { it, x, y } of placed) ctx.fillText(it.label, x * S, y * S - 3);
    return cv.toDataURL('image/png');
  });
  return { pngs, report };
}, { id, only, match, pageH }).catch((e) => (gaveUp ? new Promise(() => {}) : Promise.reject(e)));
const files = res.pngs.map((png, i) => {
  const file = i ? out.replace(/(\.png)?$/i, `-${i + 1}.png`) : out;
  fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
  return file;
});
console.log(res.report.join('\n'));
console.log(`[sheet] ${files.join(' ')}`);
await browser.close();

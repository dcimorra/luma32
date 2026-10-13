// Contact sheet of a cartridge's art: every ground tile repeated 3×3 (seams and grids show
// up at once), every prop on its own, every doll in its 12 frames plus a black silhouette,
// all at 2× on one PNG. Prints a report: colours per image and ground tiles whose edges
// whose edges stand out (right for a shore or a wall, a visible grid on plain ground). Not part of the site.
//   node tools/sheet.mjs <base-url> <game-id> <out.png>
// e.g. node tools/sheet.mjs http://127.0.0.1:8765 diamante /tmp/diamante-sheet.png
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT || 'playwright-core');
const [base, id, out] = process.argv.slice(2);
if (!base || !id || !out) {
  console.error('usage: node tools/sheet.mjs <base-url> <game-id> <out.png>');
  process.exit(2);
}

const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || pw.chromium.executablePath() });
// a run that hangs must not leave its browser behind
setTimeout(async () => { console.log('[sheet] gave up after 300 s; browser closed'); await browser.close().catch(() => {}); process.exit(1); }, 300e3).unref();
process.on('unhandledRejection', async (e) => { console.log(`[sheet] ${e?.message || e}`); await browser.close().catch(() => {}); process.exit(1); });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/`);
const res = await page.evaluate(async (id) => {
  const { Tileset } = await import('/engine/world.js');
  const { doll } = await import('/engine/doll.js');
  const game = (await import(`/games/${id}/game.js`)).default;
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
  for (const tid of Object.keys(game.tiles || {})) {
    let img;
    try { img = tiles.image(tid, 0); } catch (err) { report.push(`${tid}: ERROR ${err.message}`); continue; }
    const c = colours(img);
    const ground = c.opaque && img.width === 16 && img.height === 16;
    const s = ground ? seam(c.d, 16, 16) : [];
    report.push(`${ground ? 'tile' : 'prop'} ${tid}: ${c.n} colours${c.n > 15 ? ' (over 15)' : ''}${s.length ? ` · edge stands out: ${s.join(', ')}` : ''}`);
    items.push({ label: tid, w: ground ? 48 : img.width, h: ground ? 48 : img.height, draw(ctx, x, y) {
      if (ground) for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) ctx.drawImage(img, x + i * 16, y + j * 16);
      else ctx.drawImage(img, x, y);
    } });
  }
  for (const [did, spec] of Object.entries(game.dolls || {})) {
    const dl = doll(spec);
    const frames = ['down', 'up', 'left', 'right'].flatMap((d) => dl.frames[d]);
    const sil = document.createElement('canvas');
    sil.width = 16; sil.height = 24;
    const sx = sil.getContext('2d');
    sx.drawImage(dl.frames.down[0], 0, 0);
    sx.globalCompositeOperation = 'source-in';
    sx.fillStyle = '#000';
    sx.fillRect(0, 0, 16, 24);
    report.push(`doll ${did}: ${colours(dl.frames.down[0]).n} colours`);
    items.push({ label: did, w: 13 * 18, h: 24, draw(ctx, x, y) {
      frames.forEach((f, i) => ctx.drawImage(f, x + i * 18, y));
      ctx.drawImage(sil, x + 12 * 18 + 2, y);
    } });
  }
  // shelf layout at 1×, then scaled
  let x = pad, y = pad + 8, rowH = 0;
  const placed = [];
  for (const it of items) {
    const w = Math.max(it.w, it.label.length * 4);
    if (x + w > W / S - pad) { x = pad; y += rowH + 14; rowH = 0; }
    placed.push({ it, x, y });
    x += w + pad;
    rowH = Math.max(rowH, it.h);
  }
  const H = (y + rowH + pad) * S;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#6a6a72';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.scale(S, S);
  for (const { it, x, y } of placed) it.draw(ctx, x, y);
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.font = '10px monospace';
  for (const { it, x, y } of placed) ctx.fillText(it.label, x * S, y * S - 3);
  return { png: cv.toDataURL('image/png'), report };
}, id);
fs.writeFileSync(out, Buffer.from(res.png.split(',')[1], 'base64'));
console.log(res.report.join('\n'));
await browser.close();

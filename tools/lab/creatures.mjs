// Draws every frame of a few creature specs at 4× on one PNG, with the engine's own doll().
//   node tools/lab/creatures.mjs <base-url> <out.png>
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT || 'playwright-core');
const [base, out] = process.argv.slice(2);
const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || pw.chromium.executablePath() });
setTimeout(async () => { await browser.close().catch(() => {}); process.exit(1); }, 60e3).unref();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/`);
const png = await page.evaluate(async () => {
  const { doll } = await import(`/engine/doll.js?${Date.now()}`);
  const specs = [
    { creature: 'dog', fur: '#d08838', markings: '#f4ece0', legs: 'short' },
    { creature: 'dog', fur: '#3a2c24', markings: '#c89060' },
    { creature: 'cat', fur: '#383440', markings: '#e8e4e0' },
    { creature: 'bird', fur: '#7c8090', markings: '#b0a8b8' },
    { creature: 'bee' },
  ];
  const S = 4;
  const rows = specs.map((s) => {
    const d = doll(s);
    const imgs = [];
    for (const set of [d.frames, d.run, d.flap || {}]) for (const dir of ['down', 'up', 'left', 'right']) if (set[dir]) imgs.push(...set[dir]);
    for (const p of Object.values(d.poses)) for (const dir of ['down', 'up', 'left', 'right']) if (p[dir]) imgs.push(p[dir]);
    return imgs;
  });
  const cols = Math.max(...rows.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = cols * 17 * S; c.height = rows.length * 25 * S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7fae5c'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  rows.forEach((r, y) => r.forEach((img, x) => ctx.drawImage(img, x * 17 * S, y * 25 * S, img.width * S, img.height * S)));
  return c.toDataURL('image/png');
});
fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
await browser.close();

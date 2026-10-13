// Draws every map of every cartridge with two builds of the engine and compares them pixel
// by pixel: proof that an engine change leaves the games that don't ask for it as they
// were. Each map is drawn whole (the camera stepped across it a screen at a time), with
// the loop stopped, frame 0 and the same seeded Math.random on both sides. Not part of the site.
//   node tools/compare.mjs <base url> <candidate url> [game ...]
// e.g. node tools/compare.mjs http://127.0.0.1:8771 http://127.0.0.1:8772 matrix politika
// Differences are written to $OUT (/tmp/luma-compare by default) as base/candidate pairs.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT || 'playwright-core');
const [baseUrl, candUrl, ...only] = process.argv.slice(2);
if (!candUrl) { console.error('usage: node tools/compare.mjs <base url> <candidate url> [game ...]'); process.exit(2); }
const OUT = process.env.OUT || '/tmp/luma-compare';
fs.mkdirSync(OUT, { recursive: true });

const index = await (await fetch(`${baseUrl}/games/index.json`)).json();
const games = index.games.map((g) => g.id).filter((id) => !only.length || only.includes(id));
const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || pw.chromium.executablePath(), args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const limit = setTimeout(async () => { console.log('[compare] gave up after the time limit; browser closed'); await browser.close().catch(() => {}); process.exit(1); }, (Number(process.env.COMPARE_TIMEOUT) || 3000) * 1e3);

const world = 'luma.engine.scenes.find((s) => s.api)';

// Boots a cartridge to its first world and stops the loop's game time.
async function open(url, id) {
  const page = await browser.newPage({ viewport: { width: 960, height: 560 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/?game=${id}&dev=1`);
  await page.waitForFunction(() => window.luma?.engine, null, { timeout: 30e3 });
  const tap = async (key) => { await page.keyboard.down(key); await page.waitForTimeout(60); await page.keyboard.up(key); await page.waitForTimeout(90); };
  for (let i = 0; i < 120 && !(await page.evaluate(`!!${world}`)); i++) await tap(i % 2 ? 'KeyZ' : 'Enter');
  if (!(await page.evaluate(`!!${world}`))) throw new Error(`${id}: no world after the title`);
  await page.evaluate(() => { luma.engine.update = () => {}; luma.engine.draw = () => {}; });
  return { page, errors };
}

// Every screen of one map, as data URLs.
function shoot(mapId) {
  const w = luma.engine.scenes.find((s) => s.api);
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const real = Math.random;
  Math.random = rnd;
  try {
    const def = w.game.maps[mapId];
    if (!def) return { error: 'no such map' };
    w.load(mapId, 0, 0, 'down');
    w.cam.follow = false;
    const ctx = luma.engine.ctx;
    luma.engine.frame = 0;
    const e = luma.engine;
    const shots = [];
    const W = w.w * 16, H = w.h * 16;
    for (let y = 0; y < Math.max(1, H); y += 160) {
      for (let x = 0; x < Math.max(1, W); x += 240) {
        seed = 12345;
        w.cam.x = Math.min(x, Math.max(0, W - 240));
        w.cam.y = Math.min(y, Math.max(0, H - 160));
        ctx.save();
        w.draw(ctx, e);
        ctx.restore();
        shots.push(luma.engine.buffer.toDataURL());
      }
    }
    return { shots };
  } catch (err) {
    return { error: String(err && err.stack || err).split('\n').slice(0, 3).join(' | ') };
  } finally {
    Math.random = real;
  }
}

// Pixels that differ between two data URLs, counted in the candidate's page.
function differ([a, b]) {
  const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
  return Promise.all([load(a), load(b)]).then(([A, B]) => {
    const px = (img) => { const c = document.createElement('canvas'); c.width = 240; c.height = 160; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, 240, 160).data; };
    const p = px(A), q = px(B);
    let n = 0;
    for (let i = 0; i < p.length; i += 4) if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) n++;
    return n;
  });
}

let bad = 0;
try {
  for (const id of games) {
    let A, B;
    try {
      A = await open(baseUrl, id);
      B = await open(candUrl, id);
    } catch (err) {
      console.log(`${id}: could not boot (${err.message})`);
      bad++;
      await A?.page.close(); await B?.page.close();
      continue;
    }
    const maps = await A.page.evaluate(`Object.keys(${world}.game.maps)`);
    let shots = 0, diffs = 0;
    for (const m of maps) {
      const a = await A.page.evaluate(shoot, m);
      const b = await B.page.evaluate(shoot, m);
      if (a.error || b.error) {
        if (a.error !== b.error) { console.log(`${id} · ${m}: base ${a.error || 'ok'} / candidate ${b.error || 'ok'}`); diffs++; }
        continue;
      }
      if (a.shots.length !== b.shots.length) { console.log(`${id} · ${m}: ${a.shots.length} screens vs ${b.shots.length}`); diffs++; continue; }
      for (let i = 0; i < a.shots.length; i++) {
        shots++;
        if (a.shots[i] === b.shots[i]) continue;
        const n = await B.page.evaluate(differ, [a.shots[i], b.shots[i]]);
        if (!n) continue;
        diffs++;
        const name = `${id}-${m}-${i}`;
        fs.writeFileSync(`${OUT}/${name}-base.png`, Buffer.from(a.shots[i].split(',')[1], 'base64'));
        fs.writeFileSync(`${OUT}/${name}-cand.png`, Buffer.from(b.shots[i].split(',')[1], 'base64'));
        console.log(`${id} · ${m} · screen ${i}: ${n} pixels differ (${OUT}/${name}-*.png)`);
      }
    }
    const errs = [...new Set(B.errors)].filter((x) => !A.errors.includes(x));
    for (const x of errs) console.log(`${id}: candidate error: ${x}`);
    console.log(`${id}: ${maps.length} maps, ${shots} screens, ${diffs} different${errs.length ? `, ${errs.length} new errors` : ''}`);
    bad += diffs + errs.length;
    await A.page.close(); await B.page.close();
  }
} finally {
  clearTimeout(limit);
  await browser.close();
}
console.log(bad ? `[compare] ${bad} differences` : '[compare] identical');
process.exit(bad ? 1 : 0);

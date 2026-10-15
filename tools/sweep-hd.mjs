// Draws every map of every cartridge in the modern look (engine/hd.js) and lays them on
// contact sheets, with a census of what each map uses that the diorama does not draw yet.
// For looking over the modern look by eye, game by game. Not part of the site.
//   node tools/sweep-hd.mjs <url> [game ...]
// Sheets and census go to $OUT (/tmp/luma-sweep by default): <game>-<n>.png, census.json.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT || 'playwright-core');
const [url, ...only] = process.argv.slice(2);
if (!url) { console.error('usage: node tools/sweep-hd.mjs <url> [game ...]'); process.exit(2); }
const OUT = process.env.OUT || '/tmp/luma-sweep';
fs.mkdirSync(OUT, { recursive: true });

const index = await (await fetch(`${url}/games/index.json`)).json();
const games = index.games.map((g) => g.id).filter((id) => !only.length || only.includes(id));
const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || pw.chromium.executablePath(), args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const world = 'luma.engine.scenes.find((s) => s.api)';
const census = {};

for (const id of games) {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${url}/?game=${id}&dev=1&hd=1`);
    await page.waitForFunction(() => window.luma?.engine, null, { timeout: 30e3 });
    const tap = async (key) => { await page.keyboard.down(key); await page.waitForTimeout(60); await page.keyboard.up(key); await page.waitForTimeout(90); };
    for (let i = 0; i < 160 && !(await page.evaluate(`!!${world}`)); i++) await tap(i % 2 ? 'KeyZ' : 'Enter');
    if (!(await page.evaluate(`!!${world}`))) throw new Error('no world after the title');
    await page.waitForTimeout(500);
    const res = await page.evaluate(async (worldExpr) => {
      const e = luma.engine;
      e.update = () => {};
      const w = eval(worldExpr);
      // only the world on screen: no dialogue, no banner over it
      e.scenes.splice(0, e.scenes.length, w);
      e.fx.fade = 0; e.fx.bars = 0;
      const sheets = [];
      const maps = Object.keys(w.game.maps || {});
      const COLS = 3, ROWS = 4, CW = 480, CH = 320;
      let sheet = null;
      let n = 0;
      const out = {};
      for (const m of maps) {
        const info = { problems: [] };
        out[m] = info;
        try {
          w.load(m, 0, 0, 'down');
          if (w.player) w.player.visible = false;
          w.cam.follow = false;
          const W = w.w * 16, H = w.h * 16;
          w.cam.x = Math.max(0, Math.min(W / 2 - 120, W - 240));
          w.cam.y = Math.max(0, Math.min(H / 2 - 80, H - 160));
          const d = w.map;
          // what the diorama does not draw yet
          if (d.parallax?.length) info.problems.push('parallax');
          if (d.underlay) info.problems.push('underlay');
          if (d.above) info.problems.push('above');
          if (d.overlay) info.problems.push('overlay');
          if (w.neighbours?.length) info.problems.push('neighbours');
          if (w.entities?.length) info.problems.push(`entities:${w.entities.length}`);
          if (d.traffic || d.city || d.roads || w.city?.active) info.problems.push('city');
          const ids = new Set(); for (const row of w.ground) for (const t of row) if (t) ids.add(t);
          const defs = [...ids].map((t) => w.game.tiles[t]).filter(Boolean);
          if (defs.some((x) => x.reflect)) info.problems.push('reflect');
          if (defs.some((x) => x.top)) info.problems.push('tile-top');
          if (w.raised) info.problems.push('heights');
          info.size = `${w.w}x${w.h}`;
          e.draw();
          const c = e.hdShown ? e.hdPass.canvas : e.buffer;
          if (!sheet || n % (COLS * ROWS) === 0) {
            if (sheet) sheets.push(sheet.toDataURL('image/png'));
            sheet = document.createElement('canvas'); sheet.width = COLS * CW; sheet.height = ROWS * (CH + 14);
            const s = sheet.getContext('2d'); s.fillStyle = '#222'; s.fillRect(0, 0, sheet.width, sheet.height);
          }
          const s = sheet.getContext('2d');
          const k = n % (COLS * ROWS);
          const x = (k % COLS) * CW, y = Math.floor(k / COLS) * (CH + 14);
          s.imageSmoothingEnabled = true;
          s.drawImage(c, x, y + 14, CW, CH);
          s.fillStyle = '#fff'; s.font = '12px monospace';
          s.fillText(`${m} ${info.size}${e.hdShown ? '' : ' (CLASSIC)'} ${info.problems.join(' ')}`, x + 4, y + 11);
          n++;
        } catch (err) { info.error = String(err.message || err); }
      }
      if (sheet) sheets.push(sheet.toDataURL('image/png'));
      return { sheets, maps: out };
    }, world);
    res.sheets.forEach((u, i) => fs.writeFileSync(`${OUT}/${id}-${i + 1}.png`, Buffer.from(u.split(',')[1], 'base64')));
    census[id] = { maps: res.maps, errors };
    console.log(`${id}: ${Object.keys(res.maps).length} maps, ${res.sheets.length} sheets${errors.length ? `, ${errors.length} errors` : ''}`);
  } catch (err) {
    census[id] = { error: String(err.message || err), errors };
    console.log(`${id}: FAILED ${err.message}`);
  }
  await page.close();
}
fs.writeFileSync(`${OUT}/census.json`, JSON.stringify(census, null, 1));
await browser.close();

// Walks a cartridge's dev jumps in the modern look and looks at each from every view the
// player may choose — from above, from behind (and from behind after a turn and a few
// steps, which is where the camera has a hard time) — on contact sheets,
// with every console error and [luma] warning under the picture it came up in. For
// checking the engine against the lab (tools/lab, README "Testing by eye") after a change,
// and any cartridge the same way. Not part of the site.
//   node tools/bench.mjs <url> <game> [--match <parts of jumps' labels, comma-separated>] [--views top,third]
// Sheets and a report go to $OUT (/tmp/luma-bench): <game>-<n>.png, bench.json. The exit
// code is 1 when anything was printed under a picture.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT || 'playwright-core');
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); if (i < 0) return dflt; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const MATCH = opt('--match', '').split(',').filter(Boolean);
const VIEWS = opt('--views', 'top,third').split(',');
const [url, id] = argv;
if (!url || !id) { console.error('usage: node tools/bench.mjs <url> <game> [--match <label part>] [--views top,third]'); process.exit(2); }
const OUT = process.env.OUT || '/tmp/luma-bench';
fs.mkdirSync(OUT, { recursive: true });

const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || pw.chromium.executablePath(), args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const limit = setTimeout(async () => { console.log('[bench] gave up after the time limit; browser closed'); await browser.close().catch(() => {}); process.exit(1); }, (Number(process.env.BENCH_TIMEOUT) || 1200) * 1e3);
const world = 'luma.engine.scenes.find((s) => s.api)';
const report = {};
let bad = 0;
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 560 } });
  let seen = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text(); if (!/GL Driver Message/.test(t)) seen.push(`[${m.type()}] ${t}`); } });
  page.on('pageerror', (e) => seen.push(`[pageerror] ${e.message}`));
  await page.goto(`${url}/?game=${id}&dev=1&hd=1`);
  await page.waitForFunction(() => window.luma?.engine, null, { timeout: 30e3 });
  const tap = async (key) => { await page.keyboard.down(key); await page.waitForTimeout(60); await page.keyboard.up(key); await page.waitForTimeout(90); };
  // a key held for so many frames of the game (the browser may run slow under the load)
  const hold = async (key, frames) => {
    const f0 = await page.evaluate('luma.engine.frame');
    await page.keyboard.down(key);
    await page.waitForFunction((n) => luma.engine.frame >= n, f0 + frames, { timeout: 20e3 }).catch(() => {});
    await page.keyboard.up(key);
  };
  const frames = (n) => { return page.evaluate('luma.engine.frame').then((f0) => page.waitForFunction((m) => luma.engine.frame >= m, f0 + n, { timeout: 20e3 }).catch(() => {})); };
  for (let i = 0; i < 160 && !(await page.evaluate(`!!${world}`)); i++) await tap(i % 2 ? 'KeyZ' : 'Enter');
  if (!(await page.evaluate(`!!${world}`))) throw new Error('no world after the title');
  // A until the player has control
  const settle = async (ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await page.evaluate(`(() => { const w = ${world}; return !!w && !w.busy && luma.engine.top() === w; })()`)) { await page.waitForTimeout(300); return true; }
      await tap('KeyZ');
    }
    return false;
  };
  await settle(60e3);
  await page.evaluate(`${world}.api.set('dev.win')`);
  const labels = await page.evaluate(`(() => { const w = ${world}; let j = w.game.dev?.jumps || []; if (typeof j === 'function') j = j(w.api); return j.map((x) => x.label); })()`);
  const picked = labels.map((l, k) => ({ l, k })).filter(({ l }) => !MATCH.length || MATCH.some((m) => l.includes(m)));
  if (!picked.length) throw new Error(labels.length ? `no jump matches "${MATCH}"` : 'the cartridge has no dev.jumps');

  // the sheet is drawn in the page: a row a jump, a picture a look
  const COLS = ['top', 'third', 'third, turned', 'third, walked'].filter((c) => VIEWS.includes(c.split(',')[0]));
  const CW = 320;
  const CH = 213;
  const ROWS = 6;
  await page.evaluate(({ COLS, CW, CH, ROWS }) => {
    const sheet = () => { const c = document.createElement('canvas'); c.width = COLS.length * (CW + 4); c.height = ROWS * (CH + 30); const g = c.getContext('2d'); g.fillStyle = '#222'; g.fillRect(0, 0, c.width, c.height); return c; };
    window.__bench = { COLS, CW, CH, ROWS, sheets: [], cur: sheet(), row: 0, sheet };
  }, { COLS, CW, CH, ROWS });
  const put = (col, label, notes) => page.evaluate(({ col, label, notes }) => {
    const b = window.__bench;
    const e = luma.engine;
    const src = e.hdShown ? e.hdPass.canvas : e.buffer;
    const g = b.cur.getContext('2d');
    const x = col * (b.CW + 4);
    const y = b.row * (b.CH + 30);
    g.imageSmoothingEnabled = true;
    g.drawImage(src, x, y + 14, b.CW, b.CH);
    g.fillStyle = e.hdShown ? '#fff' : '#f88';
    g.font = '11px monospace';
    g.fillText(label.slice(0, 48), x + 2, y + 11);
    g.fillStyle = '#f88';
    notes.slice(0, 2).forEach((n, i) => g.fillText(n.slice(0, 52), x + 2, y + b.CH + 14 + i * 8 + 10));
  }, { col, label, notes });
  const nextRow = () => page.evaluate(() => {
    const b = window.__bench;
    b.row++;
    if (b.row === b.ROWS) { b.sheets.push(b.cur.toDataURL('image/png')); b.cur = b.sheet(); b.row = 0; }
  });
  const setView = (view) => page.evaluate(async (view) => {
    const w = eval('luma.engine.scenes.find((s) => s.api)');
    const m = await import('/engine/thirdperson.js');
    if (w.eyesChoice) m.setViewChoice(w.game.id, view);
    return w.eyesChoice ? view : (w.map.view ?? w.game.view) || 'top';
  }, view);
  const state = () => page.evaluate(`(() => { const w = ${world}; return { map: w.mapId, at: w.player ? [w.player.x, w.player.y] : null, view: w.groundView || 'top', hd: luma.engine.hdShown }; })()`);

  for (const { l, k } of picked) {
    report[l] = {};
    seen = [];
    await setView('top');
    // each jump starts on foot: a jump that left the player at a wheel would keep the view
    // from above for every jump after it
    await page.evaluate(`(() => { const w = ${world}; if (w.driving) w.unboard({ force: true }); })()`);
    await page.evaluate(`(() => { const w = ${world}; let j = w.game.dev.jumps; if (typeof j === 'function') j = j(w.api); w.run((api) => j[${k}].run(api)); })()`);
    await page.waitForTimeout(300);
    const ok = await settle(45e3);
    if (!ok) {
      report[l].error = 'the player never got control back';
      bad++;
      console.log(`${l}: the player never got control back`);
      await page.evaluate(`(() => { const w = ${world}; const e = luma.engine; for (let i = 0; i < 20 && e.top() !== w; i++) { const t = e.top(); if (t.done) t.done(null); else e.scenes.pop(); } e.fx.fade = 0; })()`);
      await settle(10e3);
    }
    // the jump's own choice of view (the lab's say one where the camera has a hard time)
    const chosen = (await state()).view;
    const line = [];
    for (const [col, name] of COLS.entries()) {
      const [view, extra] = name.split(', ');
      seen = [];
      const got = await setView(view);
      if (view === 'third' && chosen !== 'third' && !extra) await setView('third');
      await frames(40);
      if (extra === 'turned') { await hold('ArrowRight', 32); await frames(40); }
      if (extra === 'walked') { await hold('ArrowUp', 45); await frames(25); }
      const st = await state();
      const notes = [...new Set(seen)];
      const label = `${l} · ${name}${got !== view ? ` (${got})` : ''}${st.hd ? '' : ' CLASSIC'}`;
      await put(col, label, notes);
      report[l][name] = { map: st.map, at: st.at, view: st.view, hd: st.hd, notes };
      if (notes.length) bad++;
      line.push(`${name}${notes.length ? ` !${notes.length}` : ''}${st.hd ? '' : ' CLASSIC'}`);
    }
    await nextRow();
    console.log(`${l}: ${line.join(' | ')}`);
    for (const [name, r] of Object.entries(report[l])) for (const n of r.notes || []) console.log(`  ${name}: ${n}`);
  }
  const sheets = await page.evaluate(() => { const b = window.__bench; if (b.row) b.sheets.push(b.cur.toDataURL('image/png')); return b.sheets; });
  sheets.forEach((u, i) => fs.writeFileSync(`${OUT}/${id}-${i + 1}.png`, Buffer.from(u.split(',')[1], 'base64')));
  fs.writeFileSync(`${OUT}/bench.json`, JSON.stringify(report, null, 1));
  console.log(`${picked.length} jumps, ${sheets.length} sheets in ${OUT}${bad ? `, ${bad} pictures with something under them` : ''}`);
} finally {
  clearTimeout(limit);
  await browser.close();
}
process.exit(bad ? 1 : 0);

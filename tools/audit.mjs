// Checks a cartridge at every point of its story the cartridge can jump to (game.dev.jumps)
// and lists what a player would get stuck on there: an objective without a place or out
// of reach, a spot nobody can press, someone standing inside a wall, a door into a wall,
// a person who doesn't answer, a missing text — the engine's audit (engine/guide.js) plus
// every [luma] warning and console error on the way. Not part of the site.
//   node tools/audit.mjs <url with ?game=<id>> [first jump] [last jump] [--follow [secs]]
// e.g. node tools/audit.mjs "http://127.0.0.1:8765/?game=el-match" 0 5
// It presses A through each jump's scenes until the player has control (a minigame that
// needs more than A is reported, not played): 45 s a jump, AUDIT_JUMP=<secs> for all of
// them, or `timeout: <secs>` on the jump itself (a long set piece). It proves the data is
// sound at each jump, not that the game plays well: the start of every chapter is still
// played by hand.
// --follow then plays each jump on into its next beat with tools/play.mjs (walks to the
// objective, presses A, reads, picks choices) until the objective changes, for up to
// `secs` (60): where it gets stuck, or finds the next person missing or a place it can't
// reach, is listed as `follow:` with the last lines it read. A follow problem is where to
// look by hand: the autoplayer is no player, but where it stops a player often does too.
import { createRequire } from 'node:module';
import { runSteps } from './steps.mjs';
import { playStretch } from './play.mjs';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT || 'playwright-core');
const argv = process.argv.slice(2);
const fi = argv.indexOf('--follow');
const FOLLOW = fi < 0 ? 0 : /^\d+$/.test(argv[fi + 1] || '') ? Number(argv[fi + 1]) : 60;
if (fi >= 0) argv.splice(fi, /^\d+$/.test(argv[fi + 1] || '') ? 2 : 1);
const [url, from = '0', to = '9999'] = argv;
if (!url) { console.error('usage: node tools/audit.mjs <url with ?game=<id>> [first jump] [last jump] [--follow [secs]]'); process.exit(2); }

const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || pw.chromium.executablePath(), args: ['--autoplay-policy=no-user-gesture-required'] });
const limit = setTimeout(async () => { console.log('[audit] gave up after the time limit; browser closed'); await browser.close().catch(() => {}); process.exit(1); }, (Number(process.env.AUDIT_TIMEOUT) || 1500) * 1e3);
let problems = 0;
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 560 } });
  let seen = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') seen.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => seen.push(`[pageerror] ${e.message}`));
  const u = new URL(url);
  u.searchParams.set('dev', '1');
  await page.goto(u.href);
  const world = 'luma.engine.scenes.find((s) => s.api)';
  // the console reads keys once a frame: a press has to last a few
  const tap = async (key) => { await page.keyboard.down(key); await page.waitForTimeout(60); await page.keyboard.up(key); await page.waitForTimeout(60); };
  // title → "Nueva partida": START until a world runs
  await page.waitForFunction(() => window.luma?.engine, null, { timeout: 30e3 });
  for (let i = 0; i < 80 && !(await page.evaluate(`!!${world}`)); i++) { await tap(i % 2 ? 'KeyZ' : 'Enter'); await page.waitForTimeout(150); }
  if (!(await page.evaluate(`!!${world}`))) throw new Error('no world after the title: is "Nueva partida" the first option?');
  // A until the player has control
  const settle = async (ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const free = await page.evaluate(`(() => { const w = ${world}; return !!w && !w.busy && luma.engine.top() === w; })()`);
      if (free) { await page.waitForTimeout(400); if (await page.evaluate(`(() => { const w = ${world}; return !w.busy && luma.engine.top() === w; })()`)) return true; }
      await tap('KeyZ');
    }
    return false;
  };
  await settle(60e3);
  // every minigame lets a test through when it reads this (SKILL.md, "Done means")
  await page.evaluate(`${world}.api.set('dev.win')`);
  const jumps = await page.evaluate(`(() => { const w = ${world}; let j = w.game.dev?.jumps || []; if (typeof j === 'function') j = j(w.api); return j.map((x) => ({ label: x.label, timeout: Number(x.timeout) || 0 })); })()`);
  const labels = jumps.map((j) => j.label);
  if (!labels.length) console.log('[audit] the cartridge has no dev.jumps: only the start is checked (testing.md: give it one jump per chapter and set piece)');
  const run = async (name, go) => {
    seen = [];
    if (go) {
      await page.evaluate(`(() => { const w = ${world}; let j = w.game.dev.jumps; if (typeof j === 'function') j = j(w.api); w.run((api) => j[${go.k}].run(api)); })()`);
      await page.waitForTimeout(300);
    }
    const ok = await settle((go && jumps[go.k].timeout) * 1e3 || Number(process.env.AUDIT_JUMP) * 1e3 || 45e3);
    const found = ok ? await page.evaluate(`(() => { const w = ${world}; return { list: w.audit(), at: \`\${w.mapId} \${w.player.x},\${w.player.y}\`, obj: w.save.objective }; })()`) : null;
    const out = [...(found?.list || []).map((m) => `audit: ${m}`), ...seen.filter((m) => !found?.list.some((x) => m.includes(x)))];
    if (!ok) {
      out.unshift('the player never got control back (a scene that needs more than A, or a hang)');
      // close what is on top of the world, so the next jump starts from a world again
      await page.evaluate(`(() => { const w = ${world}; const e = luma.engine; for (let i = 0; i < 20 && e.top() !== w; i++) { const t = e.top(); if (t.done) t.done(null); else e.scenes.pop(); } e.fx.fade = 0; })()`);
      await settle(10e3);
    }
    let tail = [];
    if (ok && FOLLOW) {
      seen = [];
      const io = {
        post: (steps) => runSteps(page, steps, { say: () => {} }),
        ev: async (js) => { const v = await page.evaluate(js); return typeof v === 'string' ? JSON.parse(v) : v; },
      };
      const r = await playStretch(io, { secs: FOLLOW, newobj: true });
      const said = r.out.filter((l) => !l.startsWith('  '));
      const lost = r.out.filter((l) => /^(STUCK|  !!)/.test(l));
      if (r.why === 'newobj') tail.push(`  followed into ${r.end.obj} at ${r.end.map} ${r.end.p}`);
      else lost.push(`never reached the next beat in ${FOLLOW} s (ended ${r.why} at ${r.end.map} ${r.end.p}, on ${r.end.top})`);
      for (const l of [...new Set(lost)]) out.push(`follow: ${l.trim()}`);
      for (const m of seen) if (!out.includes(m)) out.push(`follow: ${m}`);
      if (lost.length) tail = said.slice(-3).map((l) => `  last read — ${l}`);
      // back to a world on top before the next jump
      if (!(await settle(10e3))) await page.evaluate(`(() => { const w = ${world}; const e = luma.engine; for (let i = 0; i < 20 && e.top() !== w; i++) { const t = e.top(); if (t.done) t.done(null); else e.scenes.pop(); } e.fx.fade = 0; })()`);
    }
    problems += out.length;
    console.log(`\n## ${name}${found ? ` — ${found.at} — ${found.obj || 'no objective'}` : ''}`);
    for (const m of [...new Set(out)]) console.log(`- ${m}`);
    if (!out.length) console.log('- clean');
    for (const l of tail) console.log(l);
  };
  await run('Nueva partida');
  for (let k = Number(from); k < Math.min(labels.length, Number(to) + 1); k++) await run(`jump ${k}: ${labels[k]}`, { k });
} finally {
  clearTimeout(limit);
  await browser.close();
}
console.log(`\n${problems} problem${problems === 1 ? '' : 's'}`);
process.exit(problems ? 1 : 0);

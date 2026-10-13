// The house's autoplayer, on a browser opened with drive.mjs: it plays the way a player
// would, with real keys — walks the engine's own path to the objective (or through the
// warps to its map), faces it and presses A, reads every box, picks choices — and prints
// what happened: every line said, every objective, every [luma] warning. Not part of the site.
//   node tools/play.mjs <name> [--secs S] [--max N] [--choice i,j,…] [--jump N]
//                              [--stopobj prefix] [--stopmap map] [--target actorId] [--nopress]
// --secs is wall-clock time for this call (100 by default: keep each call under two minutes).
// --jump N runs the cartridge's dev jump N first. --choice gives the option picked at each
// choice, in order; past those, a menu seen again gets its next option. It stops on --stopobj / --stopmap, or when stuck.
// Open the page with ?turbo=4 and it plays four times sooner: every wait and hold here is
// game time (steps.mjs divides them), so it plays exactly the same.
// It proves the story runs and a goal can be reached; it does not judge. What it walked
// past without looking is still yours to play by hand.
import fs from 'node:fs';
import http from 'node:http';

const [name, ...args] = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
if (!name || name.startsWith('--')) { console.error('usage: play.mjs <drive name> [--secs S] [--choice i,j] [--jump N] [--stopobj p] [--stopmap m] [--target id]'); process.exit(1); }
let st;
try { st = JSON.parse(fs.readFileSync(`/tmp/luma-drive-${name}.json`, 'utf8')); } catch { console.error(`no browser "${name}": node tools/drive.mjs start ${name} <url>`); process.exit(1); }

const MAX = Number(opt('max', 400));
const SECS = Number(opt('secs', 100));
const STOPMAP = opt('stopmap', '');
const STOPOBJ = opt('stopobj', '');
const TARGET = opt('target', '');
const JUMP = opt('jump', '');
const CHOICES = (opt('choice', '') || '').split(',').filter(Boolean).map(Number);
const NOPRESS = args.includes('--nopress');

function post(steps) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: st.port, method: 'POST', path: '/', headers: { 'x-token': st.token } }, (res) => {
      let out = '';
      res.on('data', (d) => (out += d));
      res.on('end', () => resolve(out.split('\n').filter((l) => l && !l.includes('willReadFrequently'))));
    });
    req.on('error', reject);
    req.end(JSON.stringify(steps));
  });
}

const warnings = new Set();
const NOISE = /^\[(warning|error|pageerror|log)\]|\[luma\]/;
async function ev(js) {
  const lines = await post([{ eval: js }]);
  for (const l of lines) if (NOISE.test(l)) warnings.add(l);
  const val = lines.find((l) => !NOISE.test(l));
  let v = val === undefined ? null : JSON.parse(val);
  if (typeof v === 'string') v = JSON.parse(v);
  return v;
}

// where the game is: the map, the cell, the objective, and the box or choice on top
const STATE = `JSON.stringify((() => {
  const S = luma.engine.scenes, w = S[0], top = S[S.length - 1], nm = top.constructor.name;
  const o = { n: S.length, top: nm, map: w.mapId, p: [w.player?.x, w.player?.y], obj: w.save?.objective, t: Math.round(w.save?.time || 0), g: w.save?.goal };
  if (nm === 'Dialog') { o.sp = top.speaker && (top.speaker.name || top.speaker.label || top.speaker.id || ''); o.tx = (top.pages?.[top.page] || []).join(' '); }
  if (nm === 'Choice') o.opts = (top.options || []).map((x) => typeof x === 'string' ? x : (x.label || x.text || JSON.stringify(x)));
  return o;
})())`;

// the next cells to walk: to the objective, to the warp toward its map, or to --target
const PATH = `JSON.stringify((() => {
  const w = luma.engine.scenes[0], p = w.player, g = w.save.goal || {}, want = ${JSON.stringify(TARGET)};
  let tx, ty;
  if (!want && g.map && g.map !== w.mapId) {
    const M = w.game.maps, prev = { [w.mapId]: null }, q = [w.mapId];
    while (q.length) { const m = q.shift(); for (const wp of (M[m]?.warps || [])) if (!(wp.to in prev) && M[wp.to]) { prev[wp.to] = { from: m, wp }; q.push(wp.to); } }
    if (!(g.map in prev)) return { err: 'no warp route to ' + g.map + ' from ' + w.mapId };
    let c = g.map; while (prev[c].from !== w.mapId) c = prev[c].from;
    tx = prev[c].wp.x; ty = prev[c].wp.y;
  } else if (want || g.actor) {
    const a = w.actors.find((a) => a.id === (want || g.actor));
    if (!a) return { err: (want || g.actor) + ' is not on this map' };
    tx = a.x; ty = a.y;
  } else if (g.x !== undefined) { tx = g.x; ty = g.y; }
  else return { err: 'no goal' };
  let t = w.tripTo(tx, ty);
  for (let dx = 0; !t && g.w && dx < g.w; dx++) for (let dy = 0; !t && dy < (g.h || 1); dy++) t = w.tripTo(g.x + dx, g.y + dy);
  if (!t) return { err: 'no way to ' + tx + ',' + ty };
  return { path: t.x === p.x && t.y === p.y ? [] : w.findPath(p, t.x, t.y), face: t.face, bump: t.bump };
})())`;

const key = (d) => `Arrow${d[0].toUpperCase()}${d.slice(1)}`;
const out = [];
const t0 = Date.now();

if (JUMP !== '') {
  await post([{ eval: `(() => { const w = luma.engine.scenes[0]; w.game.dev.jumps[${Number(JUMP)}].run(w.api); })()` }, { wait: 2500 }]);
  out.push(`-- jump ${JUMP}`);
}

let lastText = '', lastObj = null, lastPos = '', stuck = 0, picked = 0, inScene = 0;
const seen = {};
for (let i = 0; i < MAX && (Date.now() - t0) / 1000 < SECS; i++) {
  const s = await ev(STATE);
  if (s.obj !== lastObj) { out.push(`  >> [${s.map} ${s.p}] objective ${s.obj} · ${s.t}s played · goal ${JSON.stringify(s.g)}`); lastObj = s.obj; }
  if (STOPMAP && s.map === STOPMAP) break;
  if (STOPOBJ && s.obj?.startsWith(STOPOBJ)) break;
  if (s.top === 'Dialog') {
    if (s.tx !== lastText) { out.push(`${s.sp || '-'}: ${s.tx}`); lastText = s.tx; }
    await post([{ key: 'KeyZ' }, { wait: 330 }]);
    continue;
  }
  if (s.top === 'Choice') {
    // past the given ones, a menu seen again gets its next option: a talk menu that comes
    // back after each answer is gone through, not asked the first thing forever
    const k = JSON.stringify(s.opts);
    const n = CHOICES[picked++] ?? (seen[k] = ((seen[k] ?? -1) + 1)) % s.opts.length;
    out.push(`  ?? ${JSON.stringify(s.opts)} -> ${n}`);
    await post([...Array(n).fill({ key: 'ArrowDown', hold: 60 }), { key: 'KeyZ' }, { wait: 400 }]);
    continue;
  }
  // a minigame or any other screen of its own: pressing A is all this can do there
  if (s.n > 1) {
    if (!inScene++) out.push(`  [scene ${s.top}]`);
    if (inScene > 40) { out.push(`STUCK in the scene ${s.top}: play it by hand`); break; }
    await post([{ key: 'KeyZ' }, { wait: 700 }]);
    continue;
  }
  inScene = 0;
  const pos = `${s.map} ${s.p}`;
  stuck = pos === lastPos ? stuck + 1 : 0;
  lastPos = pos;
  if (stuck > 12) { out.push(`STUCK at ${pos}`); break; }
  // someone in the way: a step aside, as a player would
  if (stuck >= 2) await post([{ key: key(['left', 'right', 'up', 'down'][Math.floor(Math.random() * 4)]), times: 3, gap: 40, hold: 140 }]);
  const P = await ev(PATH);
  if (P.err) { out.push(`  !! ${P.err} at ${pos}`); await post([{ wait: 1500 }]); continue; }
  if (P.path.length) {
    // one or two straight runs at a time, then look again: people move
    const steps = [];
    for (let a = 0; a < P.path.length && steps.length < 4;) {
      let b = a;
      while (b < P.path.length && P.path[b] === P.path[a]) b++;
      steps.push({ key: key(P.path[a]), hold: 250 * (b - a) - 100 }, { wait: 160 });
      a = b;
    }
    await post(steps);
  } else if (!NOPRESS) {
    const steps = P.face ? [{ key: key(P.face), hold: 80 }, { wait: 200 }] : [];
    steps.push(P.bump ? { key: key(P.face), hold: 250 } : { key: 'KeyZ' }, { wait: 700 });
    await post(steps);
  } else break;
}

const end = await ev(STATE);
console.log(out.join('\n'));
console.log(`END ${end.map} ${end.p} · objective ${end.obj} · ${end.t}s played · ${end.top}`);
if (warnings.size) console.log(`WARNINGS\n${[...warnings].join('\n')}`);

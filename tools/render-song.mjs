// Renders a cartridge's song (or an effect) to a WAV file, faster than real time and
// the same every run, for listening tests and for checking that a change to the engine
// leaves a song as it was. Not part of the site.
//   node tools/render-song.mjs <game> <song> <out.wav> [options]
//     --secs N        how long (default: one pass of the song plus 2 s, at most 180)
//     --chiptune      the console's instruments, as the player's "CHIPTUNE"
//     --sfx           <song> names an effect instead (default --secs 3)
//     --layers a,b    layers switched on from the start
//     --at T:js       runs `js` T seconds in (repeatable); `audio` is engine/audio.js
//     --url URL       where public/ is served (default http://127.0.0.1:8765)
//     --json          prints the measures as JSON
//   node tools/render-song.mjs <game> --list      the game's songs and effects
// Prints the length, a hash of the samples, and RMS / peak in dB for every second.
// It runs engine/audio.js as it is, in headless Chromium, on an OfflineAudioContext in
// place of the real one, with Math.random seeded: the same song renders to the same
// samples while the engine plays it the same. Needs what tools/shot.mjs needs.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT || 'playwright-core');

const args = process.argv.slice(2);
const pos = [];
const opt = { at: [], layers: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--secs') opt.secs = Number(args[++i]);
  else if (a === '--chiptune') opt.chiptune = true;
  else if (a === '--sfx') opt.sfx = true;
  else if (a === '--json') opt.json = true;
  else if (a === '--list') opt.list = true;
  else if (a === '--layers') opt.layers = args[++i].split(',').filter(Boolean);
  else if (a === '--url') opt.url = args[++i];
  else if (a === '--at') { const s = args[++i]; const k = s.indexOf(':'); opt.at.push({ t: Number(s.slice(0, k)), js: s.slice(k + 1) }); }
  else pos.push(a);
}
const [game, song, out] = pos;
if (!game || (!opt.list && (!song || !out))) {
  console.log('usage: node tools/render-song.mjs <game> <song> <out.wav> [--secs N] [--chiptune] [--sfx] [--layers a,b] [--at T:js] [--url URL] [--json]');
  process.exit(2);
}
const base = (opt.url || 'http://127.0.0.1:8765').replace(/\/$/, '');

const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || pw.chromium.executablePath() });
const limit = setTimeout(async () => { console.log('[render] gave up after 300 s; browser closed'); await browser.close().catch(() => {}); process.exit(1); }, 300e3);
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (process.env.RENDER_DEBUG || m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  // a blank page of the same origin, so the engine's modules import as they do in the game
  await page.route(`${base}/__render__.html`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>render</title>' }));
  await page.goto(`${base}/__render__.html`);
  if (opt.list) {
    const l = await page.evaluate(async (g) => {
      const c = (await import(`/games/${g}/game.js`)).default;
      return { songs: Object.entries(c.songs || {}).map(([k, v]) => k + (v.once ? '(once)' : '')), effects: Object.keys(c.effects || {}) };
    }, game);
    console.log(`songs: ${l.songs.join(' ')}\neffects: ${l.effects.join(' ')}`);
    process.exit(0);
  }
  const res = await page.evaluate(render, { game, song, opt });
  if (res.error) throw new Error(res.error);
  fs.writeFileSync(out, Buffer.from(res.wav, 'base64'));
  delete res.wav;
  if (opt.json) console.log(JSON.stringify(res));
  else {
    console.log(`${out}: ${res.secs.toFixed(2)} s, ${res.rate} Hz, sha256 ${res.hash.slice(0, 16)}, peak ${res.peak.toFixed(1)} dB, rms ${res.rms.toFixed(1)} dB`);
    console.log('per second (rms/peak dB): ' + res.perSec.map((s) => `${s[0].toFixed(1)}/${s[1].toFixed(1)}`).join(' '));
  }
} finally {
  clearTimeout(limit);
  await browser.close();
}

// In the page.
async function render({ game, song, opt }) {
  try {
    const RATE = 48000;
    // a seeded Math.random: the noise, the drums' offsets and the room are the same every run
    let seed = 0x9e3779b9;
    Math.random = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    localStorage.setItem('luma32.muted', '0');
    localStorage.setItem('luma32.real', opt.chiptune ? '0' : '1');
    // what is still being fetched or decoded: the render starts when nothing is
    let pending = 0;
    const track = (p) => { pending++; return p.finally(() => { pending--; }); };
    const realFetch = window.fetch.bind(window);
    window.fetch = (...a) => track(realFetch(...a));
    const mod = await import(`/games/${game}/game.js`);
    const cart = mod.default;
    const audio = await import('/engine/audio.js');
    audio.setOrchestra(cart.orchestra);
    audio.defineSongs(cart.songs || {});
    audio.defineEffects(cart.effects || {});
    let secs = opt.secs;
    if (!secs) {
      if (opt.sfx) secs = 3;
      else {
        const def = audio.songDef(song);
        if (!def) return { error: `no song ${song} in ${game}` };
        let t = 0;
        for (const p of def.song || Object.keys(def.patterns)) {
          const pat = def.patterns[p];
          let n = pat.length || 0;
          for (const [k, v] of Object.entries(pat)) if (k !== 'length' && typeof v === 'string') n = Math.max(n, v.trim().split(/\s+/).filter(Boolean).length);
          t += n * 60 / (pat.bpm ?? def.bpm) / (def.steps ?? 4);
        }
        secs = Math.min(180, t + 2);
      }
    }
    let ctx = null;
    window.AudioContext = function () {
      ctx = new OfflineAudioContext(2, Math.ceil(secs * RATE), RATE);
      const dec = ctx.decodeAudioData.bind(ctx);
      ctx.decodeAudioData = (b) => track(dec(b));
      ctx.resume = () => Promise.resolve();
      return ctx;
    };
    window.webkitAudioContext = undefined;
    const settle = async () => {
      let quiet = 0;
      while (quiet < 6) { await new Promise((r) => setTimeout(r, 50)); quiet = pending ? 0 : quiet + 1; }
    };
    audio.unlock();
    await settle();                       // the game's instruments, all of them
    for (const l of opt.layers) audio.musicLayer(l, true);
    window.audio = audio;
    if (opt.sfx) audio.sfx(song); else audio.music(song);
    await settle();                       // whatever the song still asked for
    await new Promise((r) => setTimeout(r, 60));
    // the engine schedules from timers against currentTime: stop the render every
    // 0.1 s, let its timers run, go on
    const STEP = 0.1;
    const acts = [...opt.at].sort((a, b) => a.t - b.t);
    for (let k = 1; k * STEP < secs - 0.01; k++) {
      const at = Math.round(k * STEP * 10) / 10;
      ctx.suspend(at).then(async () => {
        while (acts.length && acts[0].t <= at + 1e-9) { const a = acts.shift(); try { (0, eval)(a.js); } catch (e) { console.error(`--at ${a.t}: ${e.message}`); } }
        await new Promise((r) => setTimeout(r, 30));
        OfflineAudioContext.prototype.resume.call(ctx);
      });
    }
    while (acts.length && acts[0].t <= 0) (0, eval)(acts.shift().js);
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : -200);
    const perSec = [];
    let sum = 0;
    let peak = 0;
    for (let s = 0; s * RATE < L.length; s++) {
      let ss = 0;
      let pk = 0;
      const end = Math.min(L.length, (s + 1) * RATE);
      for (let i = s * RATE; i < end; i++) { const v = (L[i] + R[i]) / 2; ss += v * v; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
      sum += ss;
      peak = Math.max(peak, pk);
      perSec.push([db(Math.sqrt(ss / (end - s * RATE))), db(pk)]);
    }
    const inter = new Float32Array(L.length * 2);
    for (let i = 0; i < L.length; i++) { inter[2 * i] = L[i]; inter[2 * i + 1] = R[i]; }
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', inter.buffer))].map((b) => b.toString(16).padStart(2, '0')).join('');
    // 16-bit stereo WAV
    const n = L.length;
    const wav = new DataView(new ArrayBuffer(44 + n * 4));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); wav.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
    wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 2, true);
    wav.setUint32(24, RATE, true); wav.setUint32(28, RATE * 4, true); wav.setUint16(32, 4, true); wav.setUint16(34, 16, true);
    str(36, 'data'); wav.setUint32(40, n * 4, true);
    for (let i = 0; i < n * 2; i++) wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, inter[i])) * 32767, true);
    const bytes = new Uint8Array(wav.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { secs: n / RATE, rate: RATE, hash, peak: db(peak), rms: db(Math.sqrt(sum / n)), perSec, wav: btoa(bin) };
  } catch (e) {
    return { error: e.stack || e.message };
  }
}

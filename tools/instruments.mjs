// Builds the engine's real instruments (README "Real instruments") from a General MIDI
// SoundFont: for each instrument in INSTRUMENTS below, a few of its recorded notes (one
// every few semitones; the engine pitches the rest), resampled to 22 050 Hz, cut short
// where they don't loop, levelled, and written as one MP3 an instrument (ffmpeg with
// libmp3lame) plus public/engine/instruments/index.js, which says where each note is in
// its file. Every file begins with a mark — one loud sample at MARK, silence round it —
// so the engine finds where the decoder put the start, whatever its padding, and the
// loops land where they should. Not part of the site; run it again only to change the set.
//   node tools/instruments.mjs list  <file.sf2>              presets in the font
//   node tools/instruments.mjs build <file.sf2> [out dir]    writes the instruments
// The house's font is FluidR3_GM (MIT, Frank Wen): Debian's fluid-soundfont-gm package
// (`apt-get download fluid-soundfont-gm`, then `dpkg-deb -x`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RATE = 22050;
// the mark at the start of each file, and where the first note begins (samples)
// (the engine looks for the mark before SEEK seconds, where no note has begun yet)
const MARK = 1000;
const LEAD = 3308;
const SEEK = 0.12;

// name: { program (General MIDI, from 0), bank (128: drums), lo, hi (MIDI keys kept),
// every (semitones between kept notes), max (seconds kept of a note that doesn't loop),
// keys (drums: the MIDI keys kept, each its own note) }
const INSTRUMENTS = {
  piano: { program: 0, lo: 28, hi: 100, every: 5, max: 1.6 },
  epiano: { program: 4, lo: 36, hi: 96, every: 5, max: 1.6 },
  harpsichord: { program: 6, lo: 36, hi: 96, every: 5, max: 1.2 },
  celesta: { program: 8, lo: 48, hi: 108, every: 6, max: 1.4 },
  glockenspiel: { program: 9, lo: 60, hi: 108, every: 6, max: 1.4 },
  musicbox: { program: 10, lo: 48, hi: 108, every: 6, max: 1.6 },
  vibraphone: { program: 11, lo: 48, hi: 96, every: 6, max: 1.6 },
  marimba: { program: 12, lo: 36, hi: 96, every: 6, max: 0.9 },
  organ: { program: 19, lo: 24, hi: 96, every: 6, max: 1.5 },
  accordion: { program: 21, lo: 36, hi: 96, every: 6, max: 1.5 },
  guitar: { program: 24, lo: 36, hi: 88, every: 5, max: 1.6 },
  steelguitar: { program: 25, lo: 36, hi: 88, every: 5, max: 1.6 },
  fingerbass: { program: 33, lo: 24, hi: 67, every: 5, max: 1.4 },
  fretless: { program: 35, lo: 24, hi: 67, every: 5, max: 1.4 },
  violin: { program: 40, lo: 55, hi: 103, every: 5, max: 1.5 },
  cello: { program: 42, lo: 36, hi: 81, every: 5, max: 1.5 },
  pizzicato: { program: 45, lo: 28, hi: 96, every: 6, max: 0.8 },
  harp: { program: 46, lo: 24, hi: 103, every: 5, max: 1.6 },
  timpani: { program: 47, lo: 36, hi: 60, every: 6, max: 1.6 },
  strings: { program: 48, lo: 28, hi: 103, every: 5, max: 1.5 },
  choir: { program: 52, lo: 36, hi: 84, every: 6, max: 1.5 },
  trumpet: { program: 56, lo: 52, hi: 88, every: 5, max: 1.4 },
  trombone: { program: 57, lo: 34, hi: 72, every: 5, max: 1.4 },
  horn: { program: 60, lo: 36, hi: 80, every: 5, max: 1.4 },
  brass: { program: 61, lo: 36, hi: 88, every: 6, max: 1.4 },
  sax: { program: 65, lo: 46, hi: 84, every: 5, max: 1.4 },
  oboe: { program: 68, lo: 58, hi: 93, every: 5, max: 1.4 },
  bassoon: { program: 70, lo: 34, hi: 72, every: 5, max: 1.4 },
  clarinet: { program: 71, lo: 50, hi: 91, every: 5, max: 1.4 },
  flute: { program: 73, lo: 60, hi: 98, every: 5, max: 1.4 },
  panflute: { program: 75, lo: 60, hi: 96, every: 6, max: 1.4 },
  whistle: { program: 78, lo: 60, hi: 96, every: 6, max: 1.4 },
  ocarina: { program: 79, lo: 60, hi: 96, every: 6, max: 1.4 },
  sitar: { program: 104, lo: 48, hi: 84, every: 6, max: 1.6 },
  koto: { program: 107, lo: 48, hi: 90, every: 6, max: 1.4 },
  kalimba: { program: 108, lo: 48, hi: 90, every: 6, max: 1.2 },
  bagpipe: { program: 109, lo: 48, hi: 84, every: 6, max: 1.4 },
  fiddle: { program: 110, lo: 55, hi: 96, every: 6, max: 1.4 },
  taiko: { program: 116, lo: 36, hi: 60, every: 12, max: 1.2 },
  // the kit: kick, side stick, snare, low tom, closed and open hat, crash, ride, mid tom,
  // hand clap, tambourine, cowbell, shaker
  kit: { program: 0, bank: 128, keys: [36, 37, 38, 39, 42, 45, 46, 47, 49, 51, 54, 56, 70], max: 1.3 },
};

// ---------- reading a SoundFont 2 ----------

function readSf2(file) {
  const b = fs.readFileSync(file);
  const id = (o) => b.toString('latin1', o, o + 4);
  if (id(0) !== 'RIFF' || id(8) !== 'sfbk') throw new Error('not a SoundFont 2');
  const chunks = {};
  // walks a LIST's chunks, keeping each by its id
  const walk = (o, end) => {
    while (o < end) {
      const cid = id(o);
      const size = b.readUInt32LE(o + 4);
      if (cid === 'LIST') walk(o + 12, o + 8 + size);
      else chunks[cid] = { o: o + 8, size };
      o += 8 + size + (size & 1);
    }
  };
  walk(12, 8 + b.readUInt32LE(4));
  const recs = (cid, len, read) => {
    const c = chunks[cid];
    const out = [];
    for (let o = c.o; o + len <= c.o + c.size; o += len) out.push(read(o));
    return out;
  };
  const name = (o) => b.toString('latin1', o, o + 20).replace(/\0.*$/s, '').trim();
  const gen = (o) => ({ oper: b.readUInt16LE(o), lo: b[o + 2], hi: b[o + 3], s: b.readInt16LE(o + 2), u: b.readUInt16LE(o + 2) });
  const bag = (o) => ({ gen: b.readUInt16LE(o) });
  return {
    smpl: new Int16Array(b.buffer, b.byteOffset + chunks.smpl.o, chunks.smpl.size >> 1),
    phdr: recs('phdr', 38, (o) => ({ name: name(o), preset: b.readUInt16LE(o + 20), bank: b.readUInt16LE(o + 22), bag: b.readUInt16LE(o + 24) })),
    pbag: recs('pbag', 4, bag),
    pgen: recs('pgen', 4, gen),
    inst: recs('inst', 22, (o) => ({ name: name(o), bag: b.readUInt16LE(o + 20) })),
    ibag: recs('ibag', 4, bag),
    igen: recs('igen', 4, gen),
    shdr: recs('shdr', 46, (o) => ({
      name: name(o), start: b.readUInt32LE(o + 20), end: b.readUInt32LE(o + 24), loopStart: b.readUInt32LE(o + 28),
      loopEnd: b.readUInt32LE(o + 32), rate: b.readUInt32LE(o + 36), pitch: b[o + 40], correction: b.readInt8(o + 41), type: b.readUInt16LE(o + 44),
    })),
  };
}

// The generators of each zone between two bag indexes, the global zone's merged in.
function zonesOf(bags, gens, from, to, last) {
  const zones = [];
  let global = null;
  for (let i = from; i < to; i++) {
    const z = {};
    for (let g = bags[i].gen; g < bags[i + 1].gen; g++) z[gens[g].oper] = gens[g];
    if (z[last] === undefined) { if (i === from) global = z; continue; }
    zones.push({ ...(global || {}), ...z });
  }
  return zones;
}

// Every playable zone of a preset: its keys, its sample and how to play it.
function presetZones(sf, bank, program) {
  const pi = sf.phdr.findIndex((p) => p.bank === bank && p.preset === program);
  if (pi < 0 || pi >= sf.phdr.length - 1) throw new Error(`no preset ${bank}:${program}`);
  const out = [];
  for (const pz of zonesOf(sf.pbag, sf.pgen, sf.phdr[pi].bag, sf.phdr[pi + 1].bag, 41)) {
    const ii = pz[41].u;
    const pk = pz[43] ? [pz[43].lo, pz[43].hi] : [0, 127];
    for (const iz of zonesOf(sf.ibag, sf.igen, sf.inst[ii].bag, sf.inst[ii + 1].bag, 53)) {
      const s = sf.shdr[iz[53].u];
      if (s.type & 2) continue;   // the right half of a stereo pair: the left one is kept
      const vel = iz[44] ? [iz[44].lo, iz[44].hi] : [0, 127];
      if (vel[0] > 100 || vel[1] < 100) continue;   // one velocity layer: a firm note
      const ik = iz[43] ? [iz[43].lo, iz[43].hi] : [0, 127];
      const lo = Math.max(pk[0], ik[0]);
      const hi = Math.min(pk[1], ik[1]);
      if (lo > hi) continue;
      const v = (k) => iz[k]?.s ?? 0;
      const start = s.start + v(0) + v(4) * 32768;
      const end = s.end + v(1) + v(12) * 32768;
      const loopStart = s.loopStart + v(2) + v(45) * 32768;
      const loopEnd = s.loopEnd + v(3) + v(50) * 32768;
      const root = iz[58] ? iz[58].s : s.pitch;
      const mode = iz[54]?.u ?? 0;
      out.push({
        lo, hi, root, tune: v(51) + (v(52) + s.correction) / 100 + (pz[51]?.s ?? 0) + (pz[52]?.s ?? 0) / 100,
        start, end, loopStart, loopEnd, loop: (mode & 1) === 1 && loopEnd > loopStart + 8, rate: s.rate,
        gain: Math.pow(10, -(v(48) + (pz[48]?.s ?? 0)) / 200),
        release: iz[38] ? Math.min(1.2, Math.max(0.04, Math.pow(2, iz[38].s / 1200))) : 0.12,
      });
    }
  }
  return out;
}

// ---------- sound ----------

// Windowed-sinc resampling to RATE, so a high note keeps its top and gains no hiss.
function resample(src, from) {
  if (from === RATE) return Float32Array.from(src, (x) => x / 32768);
  const k = RATE / from;
  const n = Math.floor(src.length * k);
  const out = new Float32Array(n);
  const cut = Math.min(1, k) * 0.95;
  const taps = 16;
  for (let i = 0; i < n; i++) {
    const x = i / k;
    const c = Math.floor(x);
    let acc = 0;
    let wsum = 0;
    for (let j = c - taps + 1; j <= c + taps; j++) {
      if (j < 0 || j >= src.length) continue;
      const t = x - j;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t * cut) / (Math.PI * t * cut);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / taps);
      acc += (src[j] / 32768) * sinc * w;
      wsum += sinc * w;
    }
    out[i] = wsum ? acc / wsum : 0;
  }
  return out;
}

function wav(samples) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return b;
}

// The zones kept: the one nearest each `every` semitones (or each drum key), each then
// covering the keys halfway to its neighbours.
function choose(zones, def) {
  if (def.keys) {
    return def.keys.map((key) => {
      const z = zones.find((q) => key >= q.lo && key <= q.hi);
      if (!z) throw new Error(`kit: no sample for key ${key}`);
      return { ...z, lo: key, hi: key };
    });
  }
  const kept = [];
  for (let key = def.lo; key <= def.hi; key += def.every) {
    const z = zones.find((q) => key >= q.lo && key <= q.hi);
    if (z && !kept.includes(z)) kept.push(z);
  }
  kept.sort((a, b) => a.root - b.root || a.lo - b.lo);
  return kept.map((z, i) => {
    const mid = (a, b) => Math.floor((a.root + b.root) / 2);
    return { ...z, lo: i ? mid(kept[i - 1], z) + 1 : 0, hi: i < kept.length - 1 ? mid(z, kept[i + 1]) : 127 };
  });
}

function build(sf, out) {
  fs.mkdirSync(out, { recursive: true });
  const index = {};
  let total = 0;
  for (const [name, def] of Object.entries(INSTRUMENTS)) {
    const zones = choose(presetZones(sf, def.bank ?? 0, def.program), def);
    // the font's own levels, kept only between one note and another of the instrument:
    // the instrument as a whole is levelled below
    const top = Math.max(...zones.map((z) => z.gain));
    const parts = [new Float32Array(LEAD)];
    const notes = [];
    let at = LEAD;
    for (const z of zones) {
      // a note that loops is kept to its loop's end; one that doesn't, to `max` seconds —
      // and so is one whose loop only comes after them (a piano's long tail)
      const loops = z.loop && z.loopStart - z.start < def.max * z.rate;
      const last = loops ? z.loopEnd : Math.min(z.end, z.start + Math.round(def.max * z.rate));
      const k = RATE / z.rate;
      let pcm;
      if (loops) {
        // resampled with the loop's beginning after its end, as it will be heard, so the
        // filter sees no cliff at the seam
        const src = new Int16Array(last - z.start + 64);
        src.set(sf.smpl.subarray(z.start, last));
        src.set(sf.smpl.subarray(z.loopStart, z.loopStart + 64), last - z.start);
        pcm = resample(src, z.rate).slice(0, Math.round((last - z.start) * k));
      } else pcm = resample(sf.smpl.subarray(z.start, last), z.rate);
      for (let i = 0; i < pcm.length; i++) pcm[i] *= z.gain / top;
      if (!loops) {
        const fade = Math.min(pcm.length, Math.round(0.06 * RATE));
        for (let i = 0; i < fade; i++) pcm[pcm.length - 1 - i] *= i / fade;
      }
      notes.push({
        lo: z.lo, hi: z.hi, root: z.root, tune: Math.round(z.tune * 100) / 100,
        at: at / RATE, len: pcm.length / RATE,
        ...(loops ? { loop: [Math.round((z.loopStart - z.start) * k) / RATE, pcm.length / RATE] } : {}),
        release: Math.round(z.release * 100) / 100,
      });
      parts.push(pcm);
      at += pcm.length;
    }
    const all = new Float32Array(at);
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    // levelled: every instrument at the same loudness, measured over its notes' first
    // half second (where a note is heard), and never past full scale
    let rms = 0;
    let count = 0;
    let peak = 0;
    for (const n of notes) {
      const s = Math.round(n.at * RATE);
      for (let i = s; i < Math.min(s + RATE / 2, s + Math.round(n.len * RATE)); i++) { rms += all[i] * all[i]; count++; }
    }
    for (const x of all) peak = Math.max(peak, Math.abs(x));
    rms = Math.sqrt(rms / Math.max(1, count));
    const scale = Math.min(0.2 / Math.max(1e-6, rms), 0.9 / Math.max(1e-6, peak));
    for (let i = 0; i < all.length; i++) all[i] *= scale;
    all[MARK] = 0.99;
    const tmp = path.join(os.tmpdir(), `luma-instr-${process.pid}.wav`);
    fs.writeFileSync(tmp, wav(all));
    const file = path.join(out, `${name}.mp3`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-codec:a', 'libmp3lame', '-b:a', '64k', '-ac', '1', '-ar', String(RATE), file]);
    fs.unlinkSync(tmp);
    const size = fs.statSync(file).size;
    total += size;
    index[name] = { file: `${name}.mp3`, notes };
    console.log(`${name.padEnd(13)} ${String(notes.length).padStart(2)} notes  ${(size / 1024).toFixed(0).padStart(5)} KB`);
  }
  const js = `// Written by tools/instruments.mjs from FluidR3_GM (MIT, Frank Wen): don't edit by hand.
// Each instrument's recorded notes, in seconds into its MP3 as written (the engine adds
// where the decoder put the mark): the keys each one plays (lo, hi), the key it was
// recorded at (root, plus tune in semitones), its loop if it has one and its release in
// seconds.
export const MARK = ${MARK / RATE};
export const SEEK = ${SEEK};
export const INSTRUMENTS = ${JSON.stringify(index)};
`;
  fs.writeFileSync(path.join(out, 'index.js'), js);
  console.log(`${Object.keys(index).length} instruments, ${(total / 1048576).toFixed(1)} MB`);
}

const [cmd, file, dir] = process.argv.slice(2);
if (!file || !['list', 'build'].includes(cmd)) { console.error('usage: node tools/instruments.mjs list|build <file.sf2> [out dir]'); process.exit(2); }
const sf = readSf2(file);
if (cmd === 'list') for (const p of sf.phdr.slice(0, -1)) console.log(`${p.bank}:${p.preset} ${p.name}`);
else build(sf, dir || path.join(ROOT, 'public', 'engine', 'instruments'));

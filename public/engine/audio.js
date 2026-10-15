// Synthesised sound, nothing to download: a four-voice-and-then-some chiptune
// sequencer for music, plus one-shot effects. Games describe songs as text patterns
// (see README, "Music") and may add their own effects built on `tone` and `burst`.
// A song may also play real instruments, recorded notes the way the GBA's own music
// was made (README "Real instruments"): those are downloaded, each the first time a
// song needs it.
import { INSTRUMENTS as REAL, MARK, SEEK } from './instruments/index.js';

const MUTE_KEY = 'luma32.muted';
const REAL_KEY = 'luma32.real';

let ctx = null;
let master = null;
let musicBus = null;
let duckBus = null;           // the songs' way into musicBus, lowered under a jingle
let sfxBus = null;
let echoIn = null;
let muted = localStorage.getItem(MUTE_KEY) === '1';
let waves = {};
let noise = null;
let roomSend = null;
let roomVerb = null;
let roomSize = 0;
let roomWanted = null;

const songs = new Map();     // name -> song definition
const effects = new Map();   // name -> (api) => void
let playing = null;          // { name, timer, stop }
let wanted = null;           // song requested before audio was unlocked
const layers = new Set();    // named layers switched on (channels with `layer`)

// Channels with `layer: 'name'` play only while that layer is on: the same song gains
// drums when a chase starts, strings when someone dies. Switches on the next note.
export function musicLayer(name, on = true) { if (on) layers.add(name); else layers.delete(name); }
export const musicLayerOn = (name) => layers.has(name);

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 6;
    master.connect(limiter).connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 1;
    musicBus.connect(master);
    duckBus = ctx.createGain();
    duckBus.connect(musicBus);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    // a short feedback echo, the closest thing the GBA had to a room
    echoIn = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.19;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    echoIn.connect(delay).connect(damp).connect(fb).connect(delay);
    damp.connect(musicBus);
    buildWaves();
    // the room: a send from music and effects into a short reverb, set per map
    roomSend = ctx.createGain();
    roomSend.gain.value = 0;
    roomVerb = ctx.createConvolver();
    roomSend.connect(roomVerb).connect(master);
    musicBus.connect(roomSend);
    sfxBus.connect(roomSend);
    if (roomWanted) room(roomWanted.mix, roomWanted.size);
    if (wanted) music(wanted.name, wanted.opts);
    prefetchReal();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export const audioContext = () => ctx;
export function isMuted() { return muted; }
export function setMuted(v) {
  muted = v;
  localStorage.setItem(MUTE_KEY, v ? '1' : '0');
  if (master) master.gain.setTargetAtTime(v ? 0 : 0.9, ctx.currentTime, 0.04);
}

function pulse(duty) {
  const n = 64;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return ctx.createPeriodicWave(re, im);
}

function buildWaves() {
  waves = { pulse12: pulse(0.125), pulse25: pulse(0.25), pulse50: pulse(0.5) };
  // a 4-bit stepped triangle, like the GB wave channel
  const n = 32;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let k = 1; k < n; k += 2) im[k] = (8 / (Math.PI * Math.PI * k * k)) * (((k - 1) / 2) % 2 ? -1 : 1);
  waves.tri = ctx.createPeriodicWave(re, im);
  const len = ctx.sampleRate;
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

// ---------- primitives (exported for game-defined effects) ----------

export function tone({ at, freq = 440, to = null, len = 0.2, wave = 'pulse50', gain = 0.08, attack = 0.004, release = null, dest = null, vibrato = 0, echo = 0 }) {
  if (!ctx) return;
  at = at ?? ctx.currentTime;
  const o = ctx.createOscillator();
  if (waves[wave]) o.setPeriodicWave(waves[wave]);
  else o.type = wave;
  o.frequency.setValueAtTime(freq, at);
  if (to) o.frequency.exponentialRampToValueAtTime(to, at + len);
  if (vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, at);
    depth.gain.linearRampToValueAtTime(freq * vibrato, at + Math.min(len, 0.5));
    lfo.connect(depth).connect(o.frequency);
    lfo.start(at);
    lfo.stop(at + len + 0.1);
  }
  const g = ctx.createGain();
  const rel = release ?? Math.min(0.08, len * 0.4);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + attack);
  g.gain.setValueAtTime(gain, Math.max(at + attack, at + len - rel));
  g.gain.linearRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(dest || sfxBus);
  if (echo && echoIn) {
    const s = ctx.createGain();
    s.gain.value = echo;
    g.connect(s).connect(echoIn);
  }
  o.start(at);
  o.stop(at + len + 0.02);
}

// A burst of filtered noise. `attack` and `release` (seconds, default 0) shape a held
// one (`decay: false`); any length plays whole, the noise loops.
export function burst({ at, len = 0.05, type = 'highpass', freq = 3000, q = 0.8, gain = 0.1, dest = null, decay = true, rate = 1, attack = 0, release = 0, echo = 0 }) {
  if (!ctx) return;
  at = at ?? ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  src.playbackRate.value = rate;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  if (attack > 0) {
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + attack);
  } else g.gain.setValueAtTime(gain, at);
  if (decay) g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  else if (release > 0) {
    g.gain.setValueAtTime(gain, Math.max(at + attack, at + len - release));
    g.gain.linearRampToValueAtTime(0, at + len);
  } else g.gain.setValueAtTime(0, at + len);
  src.connect(f).connect(g).connect(dest || sfxBus);
  if (echo && echoIn) {
    const s = ctx.createGain();
    s.gain.value = echo;
    g.connect(s).connect(echoIn);
  }
  src.start(at, Math.random() * 0.5);
  src.stop(at + len + 0.02);
}

// ---------- music ----------

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteFreq(tok) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(tok);
  if (!m) return null;
  let n = NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  n += (Number(m[3]) + 1) * 12;
  return 440 * Math.pow(2, (n - 69) / 12);
}

// Instruments: how a channel turns a note into sound.
const INSTRUMENTS = {
  pulse12: { wave: 'pulse12', gain: 0.07 },
  pulse25: { wave: 'pulse25', gain: 0.07 },
  pulse50: { wave: 'pulse50', gain: 0.06 },
  tri: { wave: 'tri', gain: 0.16 },
  saw: { wave: 'sawtooth', gain: 0.05, lp: 900 },
  bass: { wave: 'tri', gain: 0.2 },
  sine: { wave: 'sine', gain: 0.1 },
  bell: { wave: 'sine', gain: 0.08, decay: true, harmonic: 2 },
  pluck: { wave: 'pulse25', gain: 0.07, decay: true },
  pad: { wave: 'sawtooth', gain: 0.025, lp: 1300, attack: 0.25, detune: true },
  // breath, wind, a hiss: noise around the note's pitch (`q` how narrow), never real
  noise: { wave: 'noise', gain: 0.25, q: 2, attack: 0.03 },
};

function playNote(chan, freq, at, len, real = null) {
  if (real && playReal(real, chan, freq, at, len)) return;
  const inst = { ...(INSTRUMENTS[chan.inst] || INSTRUMENTS.pulse50), ...chan };
  const gain = (inst.gain ?? 0.07) * (chan.vol ?? 1);
  let dest = musicBus;
  if (inst.lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = inst.lp;
    f.connect(musicBus);
    dest = f;
    setTimeout(() => f.disconnect(), (at - ctx.currentTime + len + 1) * 1000);
  }
  if (inst.wave === 'noise') {
    // a band of noise is louder the higher it sits (it is wider): levelled to A4
    burst({ at, len, dest, type: 'bandpass', freq, q: inst.q ?? 2, gain: gain * Math.sqrt(440 / freq), decay: !!inst.decay, attack: inst.attack ?? 0.03, release: Math.min(0.08, len * 0.4), echo: chan.echo ?? 0 });
    return;
  }
  const common = { at, len, dest, attack: inst.attack ?? 0.006, echo: chan.echo ?? 0 };
  if (inst.decay) {
    tone({ ...common, freq, wave: inst.wave, gain, release: len * 0.9 });
    if (inst.harmonic) tone({ ...common, freq: freq * inst.harmonic, wave: 'sine', gain: gain * 0.35, len: len * 0.5, release: len * 0.45 });
    return;
  }
  const vibrato = len > 0.45 && chan.vibrato !== 0 ? (chan.vibrato ?? 0.006) : 0;
  tone({ ...common, freq, wave: inst.wave, gain, vibrato });
  if (inst.detune) tone({ ...common, freq: freq * 1.006, wave: inst.wave, gain });
}

const DRUMS = {
  k: (at, v, dest) => { tone({ at, freq: 150, to: 40, len: 0.16, wave: 'sine', gain: 0.5 * v, dest }); },
  s: (at, v, dest) => { burst({ at, len: 0.12, type: 'bandpass', freq: 1800, q: 0.6, gain: 0.32 * v, dest }); tone({ at, freq: 220, to: 120, len: 0.06, wave: 'tri', gain: 0.2 * v, dest }); },
  h: (at, v, dest) => burst({ at, len: 0.03, freq: 7000, gain: 0.1 * v, dest }),
  o: (at, v, dest) => burst({ at, len: 0.16, freq: 6000, gain: 0.08 * v, dest }),
  c: (at, v, dest) => burst({ at, len: 0.9, freq: 4500, gain: 0.1 * v, dest }),
  t: (at, v, dest) => tone({ at, freq: 180, to: 90, len: 0.15, wave: 'tri', gain: 0.25 * v, dest }),
  r: (at, v, dest) => burst({ at, len: 0.02, type: 'bandpass', freq: 2500, q: 3, gain: 0.25 * v, dest }),
};

// ---------- real instruments ----------

// What each of the console's own instruments becomes in a game's orchestra, which every
// game has unless it says `orchestra: false`; `orchestra: { pad: 'choir' }` changes some,
// a channel's `real` changes its own.
export const ORCHESTRA = {
  pulse12: 'harp', pulse25: 'flute', pulse50: 'clarinet', tri: 'horn', saw: 'brass', bass: 'fingerbass',
  sine: 'panflute', bell: 'celesta', pluck: 'guitar', pad: 'strings', drums: 'kit',
};
// How loud each of the console's instruments sounds (RMS of a held note), so a real one
// standing in for it keeps the song's mix; recorded notes are levelled to REAL_RMS.
const SYNTH_RMS = { pulse12: 0.046, pulse25: 0.06, pulse50: 0.06, tri: 0.09, saw: 0.03, bass: 0.115, sine: 0.07, bell: 0.045, pluck: 0.045, pad: 0.03, drums: 0.08 };
const REAL_RMS = 0.2;
// the drum letters, as keys of the General MIDI kit
const KIT = { k: 36, s: 38, h: 42, o: 46, c: 49, t: 45, r: 37 };

let orchestra = true;        // the game's: true, { inst: 'real name' }, or null (chiptune)
const banks = new Map();     // real name -> { buffer, off, def } | Promise | null (failed)

// The player's choice in Options, for games that have an orchestra: real or chiptune.
export const realOn = () => localStorage.getItem(REAL_KEY) !== '0';
export function setReal(on) {
  localStorage.setItem(REAL_KEY, on ? '1' : '0');
  // the song starts again with its new instruments
  const w = wanted;
  if (w && ctx) { stopMusic(0.2); wanted = null; music(w.name, w.opts); }
}

// The game's orchestra (cart.js, from game.orchestra): on unless it says false. And
// whether it has one at all.
export function setOrchestra(conf) { orchestra = conf === undefined ? true : conf || null; prefetchReal(); }
export const hasOrchestra = () => !!orchestra || [...songs.values()].some((s) => s.orchestra || Object.values(s.channels || {}).some((c) => REAL[c.inst] || REAL[c.real]));

// The real instrument a channel plays, or null for the console's own: its `real`, its
// `inst` when that names one (no real instrument shares a name with one of the console's,
// so `inst: 'bass'` is always the console's bass), or what the song's or the game's
// orchestra makes of it.
// `real: false` keeps a channel chiptune; the player's "chiptune" keeps them all.
export function realOf(song, chan) {
  if (chan.real === false || !realOn()) return null;
  if (REAL[chan.real]) return chan.real;
  if (REAL[chan.inst]) return chan.inst;
  const o = song.orchestra ?? orchestra;
  if (!o) return null;
  return (typeof o === 'object' && o[chan.inst]) || ORCHESTRA[chan.inst || 'pulse50'] || null;
}

// Fetches and decodes an instrument once; resolves with it, or null if it can't be had.
function loadReal(name) {
  if (banks.has(name)) return Promise.resolve(banks.get(name));
  const def = REAL[name];
  if (!def || !ctx) return Promise.resolve(null);
  const p = fetch(new URL(`./instruments/${def.file}`, import.meta.url))
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then((b) => ctx.decodeAudioData(b))
    .then((buffer) => {
      // the mark: wherever this decoder put the file's first sample
      const d = buffer.getChannelData(0);
      const lim = Math.min(d.length, Math.round(buffer.sampleRate * SEEK));
      let at = 0;
      for (let i = 1; i < lim; i++) if (Math.abs(d[i]) > Math.abs(d[at])) at = i;
      const bank = { buffer, off: at / buffer.sampleRate - MARK, def };
      banks.set(name, bank);
      return bank;
    })
    .catch((err) => { console.warn(`[luma] instrument ${name} could not load: ${err.message || err}`); banks.set(name, null); return null; });
  banks.set(name, p);
  return p;
}
const readyReal = (name) => { const b = banks.get(name); return b && !(b instanceof Promise) ? b : null; };

// The real instruments a song plays, as things are now.
function realsOf(song) {
  const out = new Set();
  for (const chan of Object.values(song.channels || {})) { const r = realOf(song, chan); if (r) out.add(r); }
  return out;
}

// Every instrument the game's songs play, one after another, once sound is on: a scene
// change then never waits for one.
let prefetching = false;
function prefetchReal() {
  if (!ctx || prefetching) return;
  const all = new Set();
  for (const s of songs.values()) for (const r of realsOf(s)) if (!banks.has(r)) all.add(r);
  if (!all.size) return;
  prefetching = true;
  (async () => { for (const r of all) await loadReal(r); prefetching = false; })();
}

// One note on a real instrument; false if it isn't loaded (the console's own plays it).
function playReal(name, chan, freq, at, len) {
  const bank = readyReal(name);
  if (!bank) return false;
  const midi = 69 + 12 * Math.log2(freq / 440);
  const notes = bank.def.notes;
  const n = notes.find((z) => midi >= z.lo - 0.5 && midi <= z.hi + 0.5) || notes[midi < notes[0].root ? 0 : notes.length - 1];
  const level = ((SYNTH_RMS[chan.inst] ?? 0.06) / REAL_RMS) * (chan.vol ?? 1) * (n.gain ?? 1);
  sample(bank, n, Math.pow(2, (midi - n.root + n.tune) / 12), at, len, level, chan.echo ?? 0);
  return true;
}

// A recorded note: from its place in the file, at a rate, held `len` seconds (looping
// if it loops) and let go over its release; null `len` plays it out (a drum).
function sample(bank, n, rate, at, len, level, echo = 0) {
  const src = ctx.createBufferSource();
  src.buffer = bank.buffer;
  src.playbackRate.value = rate;
  const begin = bank.off + n.at;
  const g = ctx.createGain();
  const rel = Math.max(0.04, Math.min(0.5, n.release));
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.004);
  let end;
  if (len == null) {
    end = at + n.len / rate;
  } else {
    // a note that doesn't loop can't outlast its recording
    const hold = n.loop ? len : Math.min(len, n.len / rate - 0.01);
    g.gain.setValueAtTime(level, at + Math.max(0.004, hold));
    g.gain.linearRampToValueAtTime(0.0001, at + Math.max(0.004, hold) + rel);
    end = at + Math.max(0.004, hold) + rel;
  }
  if (n.loop) {
    src.loop = true;
    src.loopStart = begin + n.loop[0];
    src.loopEnd = begin + n.loop[1];
  }
  src.connect(g).connect(musicBus);
  if (echo && echoIn) { const s = ctx.createGain(); s.gain.value = echo; g.connect(s).connect(echoIn); }
  src.start(at, begin, n.loop ? undefined : n.len);
  src.stop(end + 0.02);
}

// A drum letter on the real kit; false if it isn't loaded.
function playKit(name, letter, at, v) {
  const bank = readyReal(name);
  const key = KIT[letter];
  if (!bank || key === undefined) return false;
  const n = bank.def.notes.find((z) => z.lo === key);
  if (!n) return false;
  sample(bank, n, Math.pow(2, n.tune / 12), at, null, (SYNTH_RMS.drums / REAL_RMS) * v * (n.gain ?? 1));
  return true;
}

function tokens(str) { return String(str).trim().split(/\s+/).filter(Boolean); }

// A token's accent: `C4!` (or `ks!`) louder, `C4?` softer.
const ACCENT = { '!': 1.5, '?': 0.55 };

// Compiles a song once: every pattern channel becomes a list of { step, freq|drum, len,
// vol }, and every pattern knows its step's length (its own `bpm`, or the song's).
function compile(song) {
  if (song._compiled) return song._compiled;
  const out = {};
  for (const [pname, pat] of Object.entries(song.patterns)) {
    const chans = {};
    let length = pat.length || 0;
    const parsed = {};
    for (const [cname, str] of Object.entries(pat)) {
      if (cname === 'length' || cname === 'bpm') continue;
      parsed[cname] = tokens(str);
      length = Math.max(length, parsed[cname].length);
    }
    for (const [cname, toks] of Object.entries(parsed)) {
      const events = [];
      const drum = song.channels[cname]?.inst === 'drums';
      for (let rep = 0; rep < length; rep += toks.length) {
        for (let i = 0; i < toks.length && rep + i < length; i++) {
          let tok = toks[i];
          if (tok === '-' || tok === '.') continue;
          const vol = ACCENT[tok[tok.length - 1]];
          if (vol) tok = tok.slice(0, -1);
          if (drum) { events.push({ step: rep + i, drum: tok, vol: vol ?? 1 }); continue; }
          const freq = noteFreq(tok);
          if (!freq) continue;
          let len = 1;
          while (i + len < toks.length && toks[i + len] === '-') len++;
          events.push({ step: rep + i, freq, len, vol });
        }
      }
      chans[cname] = events;
    }
    out[pname] = { length, chans, stepDur: 60 / (pat.bpm ?? song.bpm) / (song.steps ?? 4) };
  }
  song._compiled = out;
  return out;
}

export function defineSongs(defs) { for (const [k, v] of Object.entries(defs)) songs.set(k, v); prefetchReal(); }
export function defineEffects(defs) { for (const [k, v] of Object.entries(defs)) effects.set(k, v); }
export const currentSong = () => wanted?.name ?? null;

// The definition of a song by name (to chart a rhythm game from its notes), or null.
export const songDef = (name) => songs.get(name) ?? null;

// Where the playing song is, for anything that has to stay in time with it: `step` counts
// steps since the song's first one (fractional, never wraps, ignores swing and the
// patterns' own `bpm`) and `time`
// the seconds since then. null when nothing is playing or audio is still locked.
export function songClock() {
  if (!ctx || !playing) return null;
  const time = ctx.currentTime - (ctx.outputLatency || 0) - playing.startAt;
  return { name: playing.name, time, step: time / playing.stepDur, stepDur: playing.stepDur, bpm: playing.bpm };
}

const done = Promise.resolve();

// Plays a song by name (null: silence). The same song does not restart while it plays.
// Returns a promise: a `once` song's resolves when it ends (or is stopped), any other's
// at once. opts: { fadeIn, fade, over } — `over` plays it as a jingle (below).
export function music(name, opts = {}) {
  if (opts.over) return jingle(name, opts);
  if (wanted?.name === name && playing?.name === name && !playing.stopped) return playing.done;
  wanted = name ? { name, opts } : null;
  if (!ctx) return done;
  stopMusic(opts.fade ?? 0.4);
  if (!name) return done;
  const song = songs.get(name);
  if (!song) { console.warn(`missing song: ${name}`); return done; }
  const bus = ctx.createGain();
  // opts.fadeIn (seconds): the new song rises while the old one fades, a crossfade
  if (opts.fadeIn) {
    bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(song.volume ?? 1, ctx.currentTime + opts.fadeIn);
  } else bus.gain.value = song.volume ?? 1;
  bus.connect(duckBus);
  playing = schedule(name, song, bus);
  return playing.done;
}

// A `once` song over the playing one, which ducks to `duck` (default 0.3) of its level
// while it lasts and comes back after: an item, a point scored. Resolves at its end.
const jingles = new Set();
export function jingle(name, opts = {}) {
  if (!ctx || !name) return done;
  const song = songs.get(name);
  if (!song) { console.warn(`missing song: ${name}`); return done; }
  const bus = ctx.createGain();
  bus.gain.value = song.volume ?? 1;
  bus.connect(musicBus);
  compile(song);
  const state = schedule(name, { ...song, once: true }, bus);
  state.duck = opts.duck ?? 0.3;
  jingles.add(state);
  const g = duckBus.gain;
  g.cancelScheduledValues(ctx.currentTime);
  g.setTargetAtTime(Math.min(...[...jingles].map((j) => j.duck)), ctx.currentTime, 0.04);
  // the song comes back from the jingle's last step, in the audio's own time
  state.onEnd = (endAt) => {
    jingles.delete(state);
    setTimeout(() => bus.disconnect(), (endAt - ctx.currentTime + 3) * 1000);
    const rest = [...jingles].map((j) => j.duck);
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(rest.length ? Math.min(...rest) : 1, endAt, rest.length ? 0.04 : 0.25);
  };
  return state.done;
}

// Schedules a song into `bus`, from timers, a little ahead of the clock. The state's
// `done` resolves at a once song's end (or when stopMusic stops it); `onEnd(at)`, if
// set, hears of that end as soon as it is scheduled.
function schedule(name, song, bus) {
  const pats = compile(song);
  const order = song.song || Object.keys(song.patterns);
  const stepDur = 60 / song.bpm / (song.steps ?? 4);
  // the real instruments it plays: each channel's, decided once; the song waits for
  // them (a few seconds at most, then whatever isn't there plays as chiptune)
  const reals = {};
  for (const [cname, chan] of Object.entries(song.channels || {})) reals[cname] = realOf(song, chan);
  const missing = [...new Set(Object.values(reals))].filter((r) => r && !readyReal(r) && banks.get(r) !== null);
  let idx = 0;
  let step = 0;
  let nextAt = ctx.currentTime + 0.08;
  const swing = song.swing ?? 0;
  const state = { name, bus, stopped: false, startAt: nextAt, stepDur, bpm: song.bpm, waiting: missing.length > 0 };
  state.done = song.once ? new Promise((r) => { state.end = r; }) : done;
  if (state.waiting) {
    const go = () => {
      if (!state.waiting) return;
      state.waiting = false;
      nextAt = ctx.currentTime + 0.05;
      state.startAt = nextAt;
    };
    Promise.all(missing.map(loadReal)).then(go);
    setTimeout(go, 4000);
  }
  const tick = () => {
    if (state.stopped || state.waiting) return;
    while (nextAt < ctx.currentTime + 0.2) {
      const pat = pats[order[idx]];
      const dur = pat.stepDur;
      for (const [cname, events] of Object.entries(pat.chans)) {
        const chan = song.channels[cname] || {};
        if (chan.mute || (chan.layer && !layers.has(chan.layer)) || (chan.unless && layers.has(chan.unless))) continue;
        for (const ev of events) {
          if (ev.step !== step) continue;
          const at = nextAt + (step % 2 ? swing * dur : 0);
          const v = (chan.vol ?? 1) * ev.vol;
          // route this note through the song bus
          musicBusSwap(bus, () => {
            if (ev.drum) { for (const d of ev.drum) if (!(reals[cname] && playKit(reals[cname], d, at, v))) DRUMS[d]?.(at, v, bus); }
            else playNote(ev.vol ? { ...chan, vol: v } : chan, ev.freq * Math.pow(2, (chan.transpose ?? 0) / 12), at, ev.len * dur * (chan.gate ?? 0.92), reals[cname]);
          });
        }
      }
      nextAt += dur;
      step++;
      if (step >= pat.length) {
        step = 0;
        idx++;
        if (idx >= order.length) {
          if (song.once) {
            state.stopped = true;
            clearInterval(state.timer);
            state.onEnd?.(nextAt);
            setTimeout(state.end, Math.max(0, nextAt - ctx.currentTime) * 1000);
            return;
          }
          idx = song.loop ?? 0;
        }
      }
    }
  };
  state.timer = setInterval(tick, 25);
  tick();
  return state;
}

// playNote writes to musicBus; while scheduling a song we point it at the song's own bus
// so a crossfade can fade one song out while the next one starts.
function musicBusSwap(bus, fn) {
  const keep = musicBus;
  musicBus = bus;
  try { fn(); } finally { musicBus = keep; }
}

function stopMusic(fade = 0.4) {
  if (!playing) return;
  const p = playing;
  playing = null;
  p.stopped = true;
  clearInterval(p.timer);
  p.end?.();
  p.bus.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.01, fade / 3));
  setTimeout(() => p.bus.disconnect(), (fade + 1.5) * 1000);
}

// ---------- effects ----------

const BUILTIN = {
  blip: (o = {}) => tone({ freq: o.pitch ?? 880, len: 0.025, wave: 'pulse25', gain: 0.035 }),
  cursor: () => tone({ freq: 1320, len: 0.04, wave: 'pulse25', gain: 0.05 }),
  confirm: () => { tone({ freq: 988, len: 0.06, wave: 'pulse50', gain: 0.06 }); tone({ at: ctx.currentTime + 0.06, freq: 1319, len: 0.09, wave: 'pulse50', gain: 0.06 }); },
  cancel: () => tone({ freq: 660, to: 330, len: 0.1, wave: 'pulse50', gain: 0.05 }),
  bump: () => tone({ freq: 90, to: 60, len: 0.08, wave: 'pulse50', gain: 0.08 }),
  hop: () => tone({ freq: 330, to: 660, len: 0.12, wave: 'pulse25', gain: 0.05 }),
  step: () => burst({ len: 0.02, type: 'lowpass', freq: 500, gain: 0.08 }),
  // footsteps by ground (a tile's `step`)
  step_soft: () => burst({ len: 0.035, type: 'lowpass', freq: 320, gain: 0.06 }),
  step_hard: () => { burst({ len: 0.018, type: 'bandpass', freq: 1400, q: 1.2, gain: 0.07 }); burst({ len: 0.02, type: 'lowpass', freq: 600, gain: 0.05 }); },
  step_wood: () => { tone({ freq: 190, to: 150, len: 0.05, wave: 'tri', gain: 0.07 }); burst({ len: 0.02, type: 'bandpass', freq: 900, gain: 0.04 }); },
  step_snow: () => burst({ len: 0.07, type: 'bandpass', freq: 2200, q: 0.5, gain: 0.05, decay: true }),
  step_water: () => { burst({ len: 0.09, type: 'bandpass', freq: 1200, q: 0.7, gain: 0.07 }); tone({ freq: 600, to: 300, len: 0.06, wave: 'sine', gain: 0.03 }); },
  // getting about (engine/move.js): into the water and out, a stroke, wings, a grip, ice
  splash: () => { burst({ len: 0.22, type: 'bandpass', freq: 900, q: 0.5, gain: 0.14, decay: true }); tone({ freq: 420, to: 160, len: 0.14, wave: 'sine', gain: 0.05 }); },
  stroke: () => burst({ len: 0.08, type: 'bandpass', freq: 700, q: 0.8, gain: 0.05, decay: true }),
  flap: () => { burst({ len: 0.06, type: 'lowpass', freq: 380, gain: 0.12 }); burst({ at: ctx.currentTime + 0.09, len: 0.05, type: 'lowpass', freq: 340, gain: 0.08 }); },
  land: () => { burst({ len: 0.05, type: 'lowpass', freq: 260, gain: 0.14 }); tone({ freq: 110, to: 70, len: 0.06, wave: 'tri', gain: 0.06 }); },
  dive: () => { tone({ freq: 520, to: 140, len: 0.3, wave: 'sine', gain: 0.06 }); burst({ len: 0.3, type: 'lowpass', freq: 700, gain: 0.12, decay: true }); },
  surface: () => { tone({ freq: 160, to: 560, len: 0.24, wave: 'sine', gain: 0.06 }); burst({ at: ctx.currentTime + 0.15, len: 0.16, type: 'bandpass', freq: 1100, gain: 0.1, decay: true }); },
  grip: () => burst({ len: 0.025, type: 'bandpass', freq: 1700, q: 2, gain: 0.06 }),
  slide: () => burst({ len: 0.18, type: 'highpass', freq: 3200, gain: 0.03, decay: true }),
  gasp: () => { tone({ freq: 300, to: 700, len: 0.18, wave: 'pulse25', gain: 0.04 }); burst({ len: 0.2, type: 'bandpass', freq: 1500, gain: 0.08, decay: true }); },
  door: () => { burst({ len: 0.2, type: 'lowpass', freq: 400, gain: 0.3 }); tone({ freq: 200, to: 80, len: 0.2, wave: 'tri', gain: 0.15 }); },
  save: () => [784, 988, 1175, 1568].forEach((f, i) => tone({ at: ctx.currentTime + i * 0.07, freq: f, len: 0.1, wave: 'pulse25', gain: 0.05 })),
  error: () => { tone({ freq: 220, len: 0.12, wave: 'pulse50', gain: 0.06 }); tone({ at: ctx.currentTime + 0.13, freq: 196, len: 0.18, wave: 'pulse50', gain: 0.06 }); },
  start: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ at: ctx.currentTime + i * 0.05, freq: f, len: 0.22, wave: 'pulse25', gain: 0.05, echo: 0.3 })),
  item: () => [659, 784, 988, 1319].forEach((f, i) => tone({ at: ctx.currentTime + i * 0.09, freq: f, len: 0.16, wave: 'pulse50', gain: 0.05 })),
  glitch: () => { burst({ len: 0.14, freq: 2500, gain: 0.12 }); tone({ freq: 60, len: 0.14, wave: 'pulse50', gain: 0.04 }); },
  // the street (engine/vehicle.js, engine/traffic.js, engine/pursuit.js)
  skid: () => burst({ len: 0.09, type: 'bandpass', freq: 2600, q: 3, gain: 0.03 }),
  crash: (o = {}) => { const k = o.power ?? 0.6; burst({ len: 0.25 + k * 0.2, type: 'lowpass', freq: 900, gain: 0.12 + k * 0.12 }); burst({ len: 0.12, type: 'bandpass', freq: 3200, q: 0.6, gain: 0.05 * k }); tone({ freq: 120, to: 50, len: 0.18, wave: 'tri', gain: 0.08 }); },
  horn: () => { tone({ freq: 392, len: 0.28, wave: 'pulse25', gain: 0.035 }); tone({ freq: 494, len: 0.28, wave: 'pulse25', gain: 0.03 }); },
  shot: () => { burst({ len: 0.12, type: 'lowpass', freq: 1800, gain: 0.16 }); tone({ freq: 180, to: 60, len: 0.08, wave: 'pulse50', gain: 0.05 }); },
  ricochet: () => tone({ freq: 2400, to: 900, len: 0.12, wave: 'pulse25', gain: 0.02 }),
  boom: () => { burst({ len: 0.9, type: 'lowpass', freq: 500, gain: 0.32 }); tone({ freq: 90, to: 30, len: 0.6, wave: 'tri', gain: 0.14 }); burst({ len: 0.3, type: 'bandpass', freq: 1500, gain: 0.08 }); },
  hoof: (o = {}) => { const hi = Math.floor(o.k || 0) % 2; burst({ len: 0.03, type: 'bandpass', freq: hi ? 1500 : 1100, q: 2, gain: 0.08 }); tone({ freq: hi ? 420 : 340, to: 200, len: 0.04, wave: 'tri', gain: 0.05 }); },
  thud: () => { burst({ len: 0.08, type: 'lowpass', freq: 420, gain: 0.14 }); tone({ freq: 150, to: 80, len: 0.08, wave: 'tri', gain: 0.06 }); },
};

// The engine of the vehicle the player drives: a held hum whose pitch follows the speed
// (level 0..1), off with motor(0). One at a time, under the effects.
let hum = null;
export function motor(level = 0, body = 'sedan') {
  if (!ctx) return;
  if (!level && !hum) return;
  if (!hum) {
    const o = ctx.createOscillator();
    o.setPeriodicWave(waves.pulse25 || waves.tri);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(f).connect(g).connect(sfxBus);
    o.start();
    hum = { o, g, f, idle: 0 };
  }
  const t = ctx.currentTime;
  if (level <= 0) {
    hum.g.gain.setTargetAtTime(0, t, 0.08);
    const old = hum;
    hum = null;
    setTimeout(() => { try { old.o.stop(); } catch { /* already stopped */ } }, 500);
    return;
  }
  // a body's pitch: a number (a cartridge's `hum`, in Hz) or one of the engine's bodies
  const low = typeof body === 'number' ? body : { truck: 34, van: 40, bike: 70, sports: 52 }[body] ?? 46;
  hum.o.frequency.setTargetAtTime(low + level * low * 2.2, t, 0.06);
  hum.f.frequency.setTargetAtTime(400 + level * 900, t, 0.06);
  hum.g.gain.setTargetAtTime(0.018 + level * 0.02, t, 0.06);
}

// Whether an effect exists, so a game can stay silent instead of warning about it.
export const hasSfx = (name) => effects.has(name) || name in BUILTIN;

export function sfx(name, opts) {
  if (!ctx) return;
  const fn = effects.get(name) || BUILTIN[name];
  if (!fn) { console.warn(`missing sfx: ${name}`); return; }
  fn(opts || {}, { tone, burst, ctx, now: ctx.currentTime, dest: sfxBus });
}

// A held ambience (rain, wind, hum) under the music. Returns nothing; ambience(null) stops it.
let amb = null;
export function ambience(name, build) {
  if (!ctx) return;
  if (amb?.name === name) return;
  if (amb) {
    const old = amb;
    old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    setTimeout(() => { old.stop?.(); old.gain.disconnect(); }, 1500);
    amb = null;
  }
  if (!name || !build) return;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(master);
  gain.gain.setTargetAtTime(1, ctx.currentTime, 0.5);
  amb = { name, gain, stop: build({ ctx, dest: gain, noise, tone, burst }) };
}

// ---------- the room ----------

// How much the place rings: 0 outdoors, ~0.25 a stone hall, ~0.45 a cave. size: the
// tail in seconds. Everything — music, steps, voices — goes through it.
export function room(mix = 0, size = 1.2) {
  roomWanted = { mix, size };
  if (!ctx) return;
  if (mix > 0 && Math.abs(size - roomSize) > 0.05) {
    const len = Math.floor(ctx.sampleRate * size);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    roomVerb.buffer = buf;
    roomSize = size;
  }
  roomSend.gain.setTargetAtTime(mix, ctx.currentTime, 0.2);
}

// ---------- sounds in a place ----------

// Ambiences that sit at a spot of the map (a fountain, a river, a forge): each its own
// voice, louder as the player comes near, panned to its side. setSpots on arriving,
// mixSpots every few frames with one { gain, pan } per spot.
let spots = [];
let spotsWanted = [];
export function setSpots(defs) {
  spotsWanted = defs;
  for (const sp of spots) {
    sp.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    setTimeout(() => { sp.stop?.(); sp.gain.disconnect(); }, 1500);
  }
  spots = [];
  if (!ctx) return;
  for (const d of defs) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) gain.connect(pan).connect(master); else gain.connect(master);
    spots.push({ gain, pan, stop: d.build({ ctx, dest: gain, noise, tone, burst }) });
  }
}
export function mixSpots(levels) {
  if (!ctx) return;
  if (!spots.length && spotsWanted.length) setSpots(spotsWanted);
  levels.forEach((l, i) => {
    const sp = spots[i];
    if (!sp) return;
    sp.gain.gain.setTargetAtTime(l.gain, ctx.currentTime, 0.15);
    sp.pan?.pan.setTargetAtTime(l.pan, ctx.currentTime, 0.15);
  });
}

// ---------- rumble ----------

// The phone's vibration, for hits and impacts. Off with the menu's "Vibración"; silent
// where the browser has none (iPhone).
const RUMBLE_KEY = 'luma32.rumble';
export const canRumble = () => typeof navigator !== 'undefined' && 'vibrate' in navigator;
export const rumbleOn = () => localStorage.getItem(RUMBLE_KEY) !== '0';
export function setRumble(on) { localStorage.setItem(RUMBLE_KEY, on ? '1' : '0'); }
export function rumble(pattern = 40) { if (canRumble() && rumbleOn()) try { navigator.vibrate(pattern); } catch { /* not allowed yet */ } }

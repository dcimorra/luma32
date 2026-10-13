// Synthesised sound, nothing to download: a four-voice-and-then-some chiptune
// sequencer for music, plus one-shot effects. Games describe songs as text patterns
// (see README, "Music") and may add their own effects built on `tone` and `burst`.
const MUTE_KEY = 'luma32.muted';

let ctx = null;
let master = null;
let musicBus = null;
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

export function burst({ at, len = 0.05, type = 'highpass', freq = 3000, q = 0.8, gain = 0.1, dest = null, decay = true, rate = 1 }) {
  if (!ctx) return;
  at = at ?? ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = rate;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, at);
  if (decay) g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  else g.gain.setValueAtTime(0, at + len);
  src.connect(f).connect(g).connect(dest || sfxBus);
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
};

function playNote(chan, freq, at, len) {
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

function tokens(str) { return String(str).trim().split(/\s+/).filter(Boolean); }

// Compiles a song once: every pattern channel becomes a list of { step, freq|drum, len }.
function compile(song) {
  if (song._compiled) return song._compiled;
  const out = {};
  for (const [pname, pat] of Object.entries(song.patterns)) {
    const chans = {};
    let length = pat.length || 0;
    const parsed = {};
    for (const [cname, str] of Object.entries(pat)) {
      if (cname === 'length') continue;
      parsed[cname] = tokens(str);
      length = Math.max(length, parsed[cname].length);
    }
    for (const [cname, toks] of Object.entries(parsed)) {
      const events = [];
      const drum = song.channels[cname]?.inst === 'drums';
      for (let rep = 0; rep < length; rep += toks.length) {
        for (let i = 0; i < toks.length && rep + i < length; i++) {
          const tok = toks[i];
          if (tok === '-' || tok === '.') continue;
          if (drum) { events.push({ step: rep + i, drum: tok }); continue; }
          const freq = noteFreq(tok);
          if (!freq) continue;
          let len = 1;
          while (i + len < toks.length && toks[i + len] === '-') len++;
          events.push({ step: rep + i, freq, len });
        }
      }
      chans[cname] = events;
    }
    out[pname] = { length, chans };
  }
  song._compiled = out;
  return out;
}

export function defineSongs(defs) { for (const [k, v] of Object.entries(defs)) songs.set(k, v); }
export function defineEffects(defs) { for (const [k, v] of Object.entries(defs)) effects.set(k, v); }
export const currentSong = () => wanted?.name ?? null;

// The definition of a song by name (to chart a rhythm game from its notes), or null.
export const songDef = (name) => songs.get(name) ?? null;

// Where the playing song is, for anything that has to stay in time with it: `step` counts
// steps since the song's first one (fractional, never wraps, ignores swing) and `time`
// the seconds since then. null when nothing is playing or audio is still locked.
export function songClock() {
  if (!ctx || !playing) return null;
  const time = ctx.currentTime - (ctx.outputLatency || 0) - playing.startAt;
  return { name: playing.name, time, step: time / playing.stepDur, stepDur: playing.stepDur, bpm: playing.bpm };
}

// Plays a song by name (null: silence). The same song does not restart.
export function music(name, opts = {}) {
  if (wanted?.name === name && playing?.name === name) return;
  wanted = name ? { name, opts } : null;
  if (!ctx) return;
  stopMusic(opts.fade ?? 0.4);
  if (!name) return;
  const song = songs.get(name);
  if (!song) { console.warn(`missing song: ${name}`); return; }
  const pats = compile(song);
  const order = song.song || Object.keys(song.patterns);
  const stepDur = 60 / song.bpm / (song.steps ?? 4);
  const bus = ctx.createGain();
  // opts.fadeIn (seconds): the new song rises while the old one fades, a crossfade
  if (opts.fadeIn) {
    bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(song.volume ?? 1, ctx.currentTime + opts.fadeIn);
  } else bus.gain.value = song.volume ?? 1;
  bus.connect(musicBus);
  const prev = musicBus;
  let idx = 0;
  let step = 0;
  let nextAt = ctx.currentTime + 0.08;
  const swing = song.swing ?? 0;
  const state = { name, bus, stopped: false, startAt: nextAt, stepDur, bpm: song.bpm };
  const tick = () => {
    if (state.stopped) return;
    while (nextAt < ctx.currentTime + 0.2) {
      const pat = pats[order[idx]];
      for (const [cname, events] of Object.entries(pat.chans)) {
        const chan = song.channels[cname] || {};
        if (chan.mute || (chan.layer && !layers.has(chan.layer))) continue;
        for (const ev of events) {
          if (ev.step !== step) continue;
          const at = nextAt + (step % 2 ? swing * stepDur : 0);
          // route this note through the song bus
          musicBusSwap(bus, () => {
            if (ev.drum) for (const d of ev.drum) DRUMS[d]?.(at, chan.vol ?? 1, bus);
            else playNote(chan, ev.freq * Math.pow(2, (chan.transpose ?? 0) / 12), at, ev.len * stepDur * (chan.gate ?? 0.92));
          });
        }
      }
      nextAt += stepDur;
      step++;
      if (step >= pat.length) {
        step = 0;
        idx++;
        if (idx >= order.length) {
          if (song.once) { state.stopped = true; return; }
          idx = song.loop ?? 0;
        }
      }
    }
  };
  state.timer = setInterval(tick, 25);
  tick();
  playing = state;
  void prev;
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
};

// Whether an effect exists, so a game can stay silent instead of warning about it.
export const hasSfx = (name) => effects.has(name) || name in BUILTIN;

export function sfx(name, opts) {
  if (!ctx) return;
  const fn = effects.get(name) || BUILTIN[name];
  if (!fn) { console.warn(`missing sfx: ${name}`); return; }
  fn(opts || {}, { tone, burst, ctx, now: ctx.currentTime });
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

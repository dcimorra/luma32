// What is in the air over a map, and the dark with its lights. Drawn over the world each
// frame with no state: every particle's place is a function of its index, the frame and
// the camera, so nothing piles up and a map looks the same however long it has been open.
import { SCREEN_W, SCREEN_H, TILE, canvas } from './gfx.js';

// Presets: count per screen, speed (px/frame), drift, size, colour, how far it follows
// the camera (1 = stuck to the ground, 0 = stuck to the screen).
const KINDS = {
  rain: { n: 70, vx: -1.2, vy: 5, len: 5, color: 'rgba(190,210,240,0.55)', par: 0.4 },
  storm: { n: 140, vx: -2.6, vy: 7, len: 7, color: 'rgba(200,215,245,0.6)', par: 0.4 },
  snow: { n: 60, vx: -0.25, vy: 0.45, size: 1, sway: 0.6, color: 'rgba(255,255,255,0.9)', par: 0.7 },
  blizzard: { n: 150, vx: -2.2, vy: 1.1, size: 1, sway: 0.4, color: 'rgba(240,245,255,0.85)', par: 0.5 },
  leaves: { n: 14, vx: 0.45, vy: 0.35, size: 2, sway: 1.2, color: ['#c86a2a', '#d8a040', '#8a9a3a'], par: 0.8 },
  petals: { n: 18, vx: 0.4, vy: 0.3, size: 2, sway: 1, color: ['#f0b8c8', '#f8d8e0'], par: 0.8 },
  ash: { n: 40, vx: 0.15, vy: 0.25, size: 1, sway: 0.5, color: ['rgba(90,90,90,0.8)', 'rgba(200,90,40,0.8)'], par: 0.8 },
  dust: { n: 24, vx: 0.08, vy: -0.03, size: 1, sway: 0.35, color: 'rgba(255,240,200,0.45)', par: 0.9 },
  fireflies: { n: 12, vx: 0, vy: 0, size: 1, sway: 3, color: '#f8f070', blink: true, glow: true, par: 1 },
  // banks of mist drifting low over the ground: wide, faint, stepped at the edge
  mist: { n: 8, vx: 0.12, vy: 0, bank: [104, 16], sway: 0.5, color: 'rgba(225,232,240,0.14)', par: 0.85 },
};

const hash = (i, k) => {
  let h = Math.imul(i * 374761393 + k * 668265263, 1274126177);
  h ^= h >>> 13;
  return ((Math.imul(h, 1103515245) >>> 0) % 10000) / 10000;
};

// map.weather: 'rain' | 'snow' | … | { kind, density, wind } | (api, engine) => one of those
export function resolveWeather(w, api, e) {
  if (typeof w === 'function') w = w(api, e);
  if (!w) return null;
  if (typeof w === 'string') w = { kind: w };
  const base = KINDS[w.kind];
  return base ? { ...base, ...w, n: Math.round(base.n * (w.density ?? 1)) } : null;
}

export function drawWeather(ctx, w, cam, f, { glowOnly = false } = {}) {
  if (!w || !!w.glow !== glowOnly) return;
  if (w.bank) { drawBanks(ctx, w, cam, f); return; }
  const W = SCREEN_W + 16;
  const H = SCREEN_H + 16;
  const vx = w.vx + (w.wind ?? 0);
  for (let i = 0; i < w.n; i++) {
    const sp = 0.6 + hash(i, 3) * 0.8;
    let x = hash(i, 1) * W + vx * sp * f - cam.x * w.par;
    let y = hash(i, 2) * H + w.vy * sp * f - cam.y * w.par;
    if (w.sway) x += Math.sin(f / 40 + i) * w.sway * 4;
    x = ((x % W) + W) % W - 8;
    y = ((y % H) + H) % H - 8;
    if (w.blink && Math.sin(f / 25 + i * 2.1) < 0.2) continue;
    const c = Array.isArray(w.color) ? w.color[i % w.color.length] : w.color;
    ctx.fillStyle = c;
    if (w.len) {
      // a streak along the fall
      for (let k = 0; k < w.len; k++) ctx.fillRect(Math.round(x - (vx / w.vy) * k), Math.round(y - k), 1, 1);
    } else {
      ctx.fillRect(Math.round(x), Math.round(y), w.size, w.size);
      if (w.glow) { ctx.globalAlpha = 0.3; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3); ctx.globalAlpha = 1; }
    }
  }
}

// Mist: each bank an ellipse of a few stacked translucent rows (denser in the middle),
// wrapping round the screen with the same no-state rule as the particles.
function drawBanks(ctx, w, cam, f) {
  const [bw, bh] = w.bank;
  const W = SCREEN_W + bw * 2;
  const H = SCREEN_H + bh * 2;
  const vx = w.vx + (w.wind ?? 0);
  const c = Array.isArray(w.color) ? w.color : [w.color];
  for (let i = 0; i < w.n; i++) {
    const sp = 0.6 + hash(i, 3) * 0.8;
    const rw = Math.round(bw * (0.7 + hash(i, 4) * 0.6) / 2);
    let x = hash(i, 1) * W + vx * sp * f - cam.x * w.par;
    let y = hash(i, 2) * H - cam.y * w.par + Math.sin(f / 90 + i) * w.sway * 4;
    x = ((x % W) + W) % W - bw;
    y = ((y % H) + H) % H - bh;
    ctx.fillStyle = c[i % c.length];
    for (const k of [1, 0.66, 0.33]) {
      const ry = Math.max(1, Math.round((bh / 2) * k));
      for (let j = -ry; j <= ry; j += 2) {
        const hw = Math.round(rw * k * Math.sqrt(1 - (j / (ry + 1)) ** 2));
        ctx.fillRect(Math.round(x - hw), Math.round(y + j), hw * 2, 2);
      }
    }
  }
}

// The dark: map.dark = { color, alpha } (or a function of the api giving it, or null),
// lit by circles from props with `light`, actors with `light` and map.lights. Rings are
// stepped, not smooth, like the hardware did it: lit, half-lit, dark.
let shadow = null;
export function drawDark(ctx, dark, lights, f) {
  if (!dark || !(dark.alpha > 0)) return;
  shadow ||= canvas(SCREEN_W, SCREEN_H);
  const s = shadow.getContext('2d');
  s.globalCompositeOperation = 'source-over';
  s.clearRect(0, 0, SCREEN_W, SCREEN_H);
  s.globalAlpha = dark.alpha;
  s.fillStyle = dark.color || '#080c20';
  s.fillRect(0, 0, SCREEN_W, SCREEN_H);
  s.globalAlpha = 1;
  s.globalCompositeOperation = 'destination-out';
  for (const l of lights) {
    const r = Math.max(4, l.r + (l.flicker ? Math.round(Math.sin(f / 5 + l.x) * l.flicker) : 0));
    // `steps`: more rings, a softer falloff (still stepped, like the hardware); default two
    const n = Math.max(2, Math.min(8, l.steps | 0 || 2));
    if (n === 2) { ring(s, l.x, l.y, r, 0.5); ring(s, l.x, l.y, Math.round(r * 0.7), 1); continue; }
    // each ring takes away its share of what is left, so the dark falls off evenly
    for (let k = 0; k < n; k++) ring(s, l.x, l.y, Math.round(r * (1 - (0.6 * k) / (n - 1))), 1 - (n - k - 1) / (n - k));
  }
  ctx.drawImage(shadow, 0, 0);
  // the warm colour of each light on what it touches
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    if (!l.color) continue;
    ctx.globalAlpha = l.glow ?? 0.12;
    ctx.fillStyle = l.color;
    disc(ctx, l.x, l.y, Math.round(l.r * 0.7));
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function ring(s, x, y, r, a) {
  s.globalAlpha = a;
  s.fillStyle = '#000';
  disc(s, x, y, r);
  s.globalAlpha = 1;
}

// A pixel-stepped filled circle (no anti-aliasing at the edge).
function disc(c, x, y, r) {
  x = Math.round(x); y = Math.round(y);
  for (let j = -r; j <= r; j++) {
    const w = Math.floor(Math.sqrt(r * r - j * j));
    c.fillRect(x - w, y + j, w * 2 + 1, 1);
  }
}

// Lights on screen, in screen pixels: from props (def.light), actors (def.light) and the map.
//   light: { r: 40, color: '#ffb050', flicker: 2, dx, dy }  (dx, dy from the top-left of the cell)
export function gatherLights(world, cx, cy) {
  const out = [];
  const add = (l, x, y) => out.push({ ...l, x: x - cx, y: y - cy });
  for (const p of world.props) {
    const l = p.def.light;
    if (!l || p.hidden) continue;
    add(l, p.x * TILE + (l.dx ?? (p.w * TILE) / 2), (p.y + 1 - p.h) * TILE + (l.dy ?? (p.h * TILE) / 2) - world.elev(p.x, p.y));
  }
  for (const a of world.actors) {
    const l = a.def.light || a.light;
    if (!l || !a.visible) continue;
    add(l, a.px + 8 + (l.dx ?? 0), a.py - a.ez + (l.dy ?? 4));
  }
  let extra = world.map.lights;
  if (typeof extra === 'function') extra = extra(world.api);
  for (const l of extra || []) add(l, l.x * TILE + (l.dx ?? 8), l.y * TILE + (l.dy ?? 8) - world.elev(l.x, l.y));
  return out.filter((l) => l.x + l.r > 0 && l.y + l.r > 0 && l.x - l.r < SCREEN_W && l.y - l.r < SCREEN_H);
}

// The time of day (README "Day and night"). A game with `clock` has hours that pass while
// the player plays, kept in the save, and outdoor maps that light themselves by them:
// dawn, day, dusk and night, with the dark lit by lamps, people and headlights.
//
//   clock: { start: 9, speed: 1, show: true,            // hour of a new game; game minutes a second
//            night: { color: '#0a1030', alpha: 0.6, grade: '#b0b8e0' }, dusk: '#ffb890', dawn: '#d8c8f0' }
//   map:   clock: false                                  // an interior: the hour doesn't show here
//   api.clock → { day, hour, minute, minutes }; api.setClock(21, 30); api.clockLabel()
//
// A map's own `grade` or `dark` always wins over the clock's.
import { mix } from './gfx.js';
import { drawText, measure } from './font.js';
import { SCREEN_W } from './gfx.js';

const DAY = 24 * 60;

export const clockConf = (world) => {
  const c = world.game.clock;
  if (!c) return null;
  return c === true ? {} : c;
};

// Minutes since the first day's midnight, started at `start` on a new game.
export function clockNow(world) {
  const c = clockConf(world);
  if (!c) return null;
  if (world.save.clock == null) world.save.clock = (c.start ?? 9) * 60;
  return world.save.clock;
}

export function tickClock(world) {
  const c = clockConf(world);
  if (!c || !world.onTop) return;
  const now = clockNow(world);
  world.save.clock = now + (c.speed ?? 1) / 60;
}

export function clockInfo(world) {
  const now = clockNow(world);
  if (now == null) return null;
  const m = Math.floor(now) % DAY;
  return { day: Math.floor(now / DAY) + 1, hour: Math.floor(m / 60), minute: m % 60, minutes: m };
}

// Moves the clock forward to that hour (today if still ahead, otherwise tomorrow).
export function setClock(world, hour, minute = 0) {
  const now = clockNow(world);
  if (now == null) return;
  const day = Math.floor(now / DAY);
  let t = day * DAY + hour * 60 + minute;
  if (t < now) t += DAY;
  world.save.clock = t;
}

const smooth = (k) => k * k * (3 - 2 * k);
const span = (m, a, b) => Math.max(0, Math.min(1, (m - a) / (b - a)));

// How dark it is now, 0 (day) to 1 (night), and the colour over the day.
function phase(world) {
  const c = clockConf(world);
  const i = clockInfo(world);
  const m = i.minutes;
  const n = c.night || {};
  const night = n.grade || '#b0b8e0';
  const dusk = c.dusk || '#ffb890';
  const dawn = c.dawn || '#d8c8f0';
  // dawn, day, dusk and night begin at these hours (`hours` on the clock changes them:
  // a winter, a far north); by default 5:00, 7:30, 18:00 and 21:00
  const hr = { dawn: 5, day: 7.5, dusk: 18, night: 21, ...c.hours };
  const [a, b, d, e] = [hr.dawn * 60, hr.day * 60, hr.dusk * 60, hr.night * 60];
  if (m < a || m >= e) return { dark: 1, grade: night };
  if (m < b) {
    const k = smooth(span(m, a, b));
    return { dark: 1 - k, grade: k < 0.5 ? mix(night, dawn, k * 2) : mix(dawn, '#ffffff', k * 2 - 1) };
  }
  if (m < d) return { dark: 0, grade: null };
  const k = smooth(span(m, d, e));
  return { dark: Math.max(0, k * 2 - 1), grade: k < 0.5 ? mix('#ffffff', dusk, k * 2) : mix(dusk, night, k * 2 - 1) };
}

const outdoors = (world) => !!clockConf(world) && world.map.clock !== false;

export function clockGrade(world) {
  if (!outdoors(world)) return null;
  return phase(world).grade;
}

export function clockDark(world) {
  if (!outdoors(world)) return null;
  const k = phase(world).dark;
  if (k <= 0.01) return null;
  const n = clockConf(world).night || {};
  return { color: n.color || '#0a1030', alpha: (n.alpha ?? 0.6) * k };
}

export const isNight = (world) => outdoors(world) && phase(world).dark > 0.3;

export function clockLabel(world) {
  const i = clockInfo(world);
  return i ? `${String(i.hour).padStart(2, '0')}:${String(i.minute).padStart(2, '0')}` : '';
}

// The hour in a corner (`show: true`), under the minimap when there is one.
export function drawClock(world, ctx) {
  const c = clockConf(world);
  if (!c?.show) return;
  const label = clockLabel(world);
  const w = measure(label) + 8;
  const mm = world.map.minimap ?? world.game.minimap;
  const r = mm ? (mm === true ? 26 : mm.r ?? 26) : 0;
  const x = SCREEN_W - w - 4 - (mm ? r - Math.round(w / 2) : 0);
  const y = mm ? 4 + r * 2 + 3 : 4;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, w, 11);
  drawText(ctx, label, x + 4, y + 2, '#ffffff');
}

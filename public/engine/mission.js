// Missions: jobs taken at a marker on the map, a chain of steps, a clock if they want one,
// failed and tried again (README "Missions"). A shape the cartridge may use or ignore:
// what a step asks, what fails it and what it pays are the cartridge's functions.
//
//   missions: {
//     delivery: {
//       name: 'mission.delivery',                       // locale key: shown on start and end
//       marker: { map: 'city', x: 12, y: 8, color: '#f0c030' },
//       when: (api) => api.is('met_boss'),              // offered only then
//       start: async (api) => {},                       // a scene before the first step
//       steps: [
//         { objective: 'mission.delivery.car', at: [20, 4], done: (api) => !!api.driving,
//           begin: async (api) => {}, time: 60 },      // seconds, optional
//         { objective: 'mission.delivery.drop', at: [3, 30], done: (api) => api.nearCell(3, 30, 1) },
//       ],
//       fail: (api) => api.driving?.wreck,              // any step; true fails it
//       reward: async (api) => { api.inc('money', 500); },
//     },
//   }
//
// It is not resumed after a reload (the marker is there again). Done missions are flags:
// `mission.<id>`. api.mission() is the one under way ({ id, step } or null);
// api.startMission(id), api.failMission(), api.passMission().
import { TILE, SCREEN_W, SCREEN_H } from './gfx.js';
import { drawText, measure } from './font.js';
import { banner } from './ui.js';
import { t } from './i18n.js';
import { sfx } from './audio.js';

// The markers to show on this map: missions offered and not under way.
export function missionMarks(world) {
  const all = world.game.missions;
  if (!all || world.save.mission) return [];
  const out = [];
  for (const [id, m] of Object.entries(all)) {
    const k = m.marker;
    if (!k || (k.map && k.map !== world.mapId) || world.save.flags[`mission.${id}`]) continue;
    if (m.when && !m.when(world.api)) continue;
    out.push({ id, x: k.x, y: k.y, color: k.color || '#f0c030' });
  }
  return out;
}

export function startMission(world, id) {
  const m = world.game.missions?.[id];
  if (!m) { world.lint(`mission:${id}`, `no mission named ${id} in game.missions.`); return; }
  world.save.mission = { id, step: -1 };
  sfx('start');
  if (m.name) banner(world.engine, world.api.text(m.name));
  world.run(async (api) => {
    if (m.start) await m.start(api);
    await nextStep(world);
  });
}

async function nextStep(world) {
  const s = world.save.mission;
  if (!s) return;
  const m = world.game.missions[s.id];
  s.step++;
  const step = m.steps?.[s.step];
  if (!step) { await passMission(world); return; }
  s.clock = step.time ? step.time * 60 : null;
  world.api.objective(step.objective || null, step.at ?? false);
  if (step.begin) await step.begin(world.api);
}

export async function passMission(world) {
  const s = world.save.mission;
  if (!s) return;
  const m = world.game.missions[s.id];
  delete world.save.mission;
  world.save.flags[`mission.${s.id}`] = true;
  world.api.objective(null, false);
  sfx('item');
  banner(world.engine, t('console.city.passed', { name: m.name ? world.api.text(m.name) : '' }));
  if (m.reward) await m.reward(world.api);
}

export async function failMission(world, why = null) {
  const s = world.save.mission;
  if (!s) return;
  const m = world.game.missions[s.id];
  delete world.save.mission;
  world.api.objective(null, false);
  sfx('error');
  banner(world.engine, why ? world.api.text(why) : t('console.city.failed'));
  if (m.onFail) await m.onFail(world.api);
}

// Every frame with control: a marker stepped on starts its mission; the one under way
// checks its step, its clock and what fails it.
export function tickMissions(world, e) {
  const all = world.game.missions;
  if (!all) return;
  const s = world.save.mission;
  const api = world.api;
  if (!s) {
    const p = world.player;
    for (const k of missionMarks(world)) {
      if (p.x === k.x && p.y === k.y && (!world.driving || world.driving.speed < 1.5)) { startMission(world, k.id); return; }
    }
    return;
  }
  if (s.step < 0 || world.busy) return;
  const m = all[s.id];
  const step = m.steps[s.step];
  if (!step) return;
  if (s.clock != null && --s.clock <= 0) { world.run(() => failMission(world, step.timeout || m.timeout || 'console.city.time_up')); return; }
  const failed = step.fail?.(api) || m.fail?.(api);
  if (failed) { world.run(() => failMission(world, typeof failed === 'string' ? failed : null)); return; }
  if (step.done?.(api)) world.run(() => nextStep(world));
}

// A column of light on each marker's cell.
export function drawMissionMarks(world, ctx, cx, cy, e) {
  for (const k of missionMarks(world)) {
    const x = k.x * TILE - cx;
    const y = k.y * TILE - cy;
    if (x < -16 || y < -40 || x > SCREEN_W + 16 || y > SCREEN_H + 40) continue;
    const r = 5 + Math.sin(e.frame / 10) * 1.5;
    ctx.fillStyle = k.color;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x + 8 - r, y + 8 - r / 2, r * 2, r);
    ctx.globalAlpha = 0.18;
    ctx.fillRect(x + 5, y - 24, 6, 32);
    ctx.globalAlpha = 1;
    ctx.fillRect(x + 7, y - 20 + Math.round(Math.sin(e.frame / 12) * 2), 2, 2);
  }
}

// The clock of a step with `time`, top centre.
export function drawMissionHud(world, ctx) {
  const s = world.save.mission;
  if (!s || s.clock == null) return;
  const secs = Math.max(0, Math.ceil(s.clock / 60));
  const label = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const w = measure(label) + 8;
  const x = Math.round((SCREEN_W - w) / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, 3, w, 11);
  drawText(ctx, label, x + 4, 5, secs <= 10 && Math.floor(world.engine.frame / 15) % 2 ? '#ff6060' : '#ffffff');
}

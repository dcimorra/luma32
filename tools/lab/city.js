// The lab's city: a grid of streets for the engine's vehicles, traffic, pavement, pursuit,
// minimap and missions (engine/vehicle.js, city.js, traffic.js, pursuit.js, minimap.js,
// mission.js). Built by code: two-lane streets every 14 cells, a ring road round the edge
// (so no lane ends anywhere), junctions with signals, zebras beside each junction,
// pavement along every street, and blocks of rooftops, a park and a car park.
//
// In it: the player's own car (kept in the save where it is left), traffic and people
// that come and go round the camera, B shoots, a mission at the yellow light, and from
// the dev menu a police car that gives chase.

const W = 60;
const H = 46;
const ROADS_X = [1, 15, 29, 43, 57];
const ROADS_Y = [1, 15, 29, 43];

const ASPHALT = '#4a4a54';
const ASPHALT_HI = '#56565f';
const LINE = '#d8b040';

const asphalt = (p) => { p.fill(ASPHALT); p.noise(0, 0, 16, 16, [ASPHALT_HI, '#424249'], 0.08); };
export const cityTiles = {
  lane_up: { lane: 'up', step: 'hard', mapColor: '#3a3a42', draw(p) { asphalt(p); p.vline(0, 0, 16, LINE); } },
  lane_down: { lane: 'down', step: 'hard', mapColor: '#3a3a42', draw(p) { asphalt(p); p.vline(15, 0, 16, LINE); } },
  lane_left: { lane: 'left', step: 'hard', mapColor: '#3a3a42', draw(p) { asphalt(p); p.hline(0, 15, 16, LINE); } },
  lane_right: { lane: 'right', step: 'hard', mapColor: '#3a3a42', draw(p) { asphalt(p); p.hline(0, 0, 16, LINE); } },
  junction: { lane: 'cross', step: 'hard', mapColor: '#3a3a42', draw(p) { asphalt(p); } },
  zebra_up: { lane: 'up', crosswalk: true, step: 'hard', mapColor: '#3a3a42', draw(p) { asphalt(p); for (let x = 1; x < 16; x += 4) p.rect(x, 2, 2, 12, '#e8e8e8'); } },
  zebra_down: { lane: 'down', crosswalk: true, step: 'hard', mapColor: '#3a3a42', draw(p) { asphalt(p); for (let x = 1; x < 16; x += 4) p.rect(x, 2, 2, 12, '#e8e8e8'); } },
  zebra_left: { lane: 'left', crosswalk: true, step: 'hard', mapColor: '#3a3a42', draw(p) { asphalt(p); for (let y = 1; y < 16; y += 4) p.rect(2, y, 12, 2, '#e8e8e8'); } },
  zebra_right: { lane: 'right', crosswalk: true, step: 'hard', mapColor: '#3a3a42', draw(p) { asphalt(p); for (let y = 1; y < 16; y += 4) p.rect(2, y, 12, 2, '#e8e8e8'); } },
  pave: { sidewalk: true, step: 'hard', mapColor: '#9a968e', draw(p) { p.fill('#a8a49c'); p.hline(0, 0, 16, '#8c887e'); p.vline(0, 0, 16, '#8c887e'); p.hline(0, 8, 16, '#98948a'); p.vline(8, 0, 16, '#98948a'); } },
  lot: { step: 'hard', mapColor: '#55555e', draw(p) { p.fill('#5a5a64'); p.noise(0, 0, 16, 16, ['#64646e'], 0.06); p.vline(0, 2, 12, '#d8d8d8'); } },
  park: { drive: { max: 0.5, grip: 0.7 }, mapColor: '#4a8a40', draw(p) { p.fill('#5a9a4a'); p.noise(0, 0, 16, 16, ['#74b65e', '#3e7a34'], 0.15); } },
  roof_a: { solid: true, mapColor: '#6a5a50', draw(p) { p.fill('#7a6a5e'); p.rect(0, 0, 16, 1, '#5a4c44'); p.noise(1, 1, 14, 14, ['#86766a'], 0.08); } },
  roof_b: { solid: true, mapColor: '#505868', draw(p) { p.fill('#5e6878'); p.rect(0, 0, 16, 1, '#465060'); p.rect(5, 5, 4, 3, '#8a929e'); p.hline(5, 8, 4, '#3a4250'); } },
  roof_c: { solid: true, mapColor: '#7a4a40', draw(p) { p.fill('#8a5448'); for (let y = 2; y < 16; y += 4) p.hline(0, y, 16, '#743e34'); } },
  tree: { size: [1, 2], foot: [1, 1], mapColor: '#2e6a2a', draw(p) { p.rect(7, 22, 2, 9, '#5a3a22'); p.rect(2, 4, 12, 16, '#2e6e2a'); p.rect(4, 2, 8, 2, '#3e8a36'); p.rect(3, 6, 4, 4, '#58a048'); } },
  streetlamp: { size: [1, 2], foot: [1, 1], mapColor: '#9a968e', light: { r: 38, color: '#ffd890', dy: 8 },
    draw(p) { p.rect(7, 6, 2, 26, '#3a3a44'); p.rect(4, 3, 8, 3, '#3a3a44'); p.rect(5, 6, 6, 1, '#fff0b0'); } },
  hydrant: { mapColor: '#c03030', draw(p) { p.rect(6, 8, 4, 6, '#c03030'); p.rect(5, 10, 6, 2, '#a02020'); p.rect(6, 7, 4, 1, '#e05050'); } },
};

export const cityDolls = {
  cit1: { skin: '#e8b48c', hair: '#3a2a1a', hairStyle: 'short', top: '#4a6a8a', bottom: '#2a3040' },
  cit2: { skin: '#c48c64', hair: '#1e1612', hairStyle: 'ponytail', top: '#c05a6a', bottom: '#3a3a4a' },
  cit3: { skin: '#8a5a3a', hair: '#141010', hairStyle: 'buzz', top: '#e0c050', bottom: '#30303a' },
  cit4: { skin: '#f0c8a8', hair: '#c8a060', hairStyle: 'bob', top: '#5a9a6a', bottom: '#5a4a3a', dress: true },
  cit5: { skin: '#d8a080', hair: '#5a3a28', hairStyle: 'curly', top: '#7a5aa0', bottom: '#2a2a30', glasses: true },
  cit6: { skin: '#a87050', hair: '#d8d8d0', hairStyle: 'receding', top: '#8a8a90', bottom: '#3a3a40', coat: '#5a5048' },
};

// ---------- the ground ----------

function build() {
  const g = Array.from({ length: H }, () => Array(W).fill('roof_a'));
  const isRoadX = (x) => ROADS_X.some((c) => x === c || x === c + 1);
  const isRoadY = (y) => ROADS_Y.some((r) => y === r || y === r + 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const rx = isRoadX(x);
      const ry = isRoadY(y);
      if (rx && ry) g[y][x] = 'junction';
      // southbound on the west lane, northbound on the east: traffic keeps to the right
      else if (rx) g[y][x] = ROADS_X.includes(x) ? 'lane_down' : 'lane_up';
      else if (ry) g[y][x] = ROADS_Y.includes(y) ? 'lane_left' : 'lane_right';
    }
  }
  // zebras on the lane cells beside each junction
  for (const c of ROADS_X) for (const r of ROADS_Y) {
    for (const y of [r - 1, r + 2]) for (const x of [c, c + 1]) if (g[y]?.[x]?.startsWith('lane_')) g[y][x] = g[y][x].replace('lane_', 'zebra_');
    for (const x of [c - 1, c + 2]) for (const y of [r, r + 1]) if (g[y]?.[x]?.startsWith('lane_')) g[y][x] = g[y][x].replace('lane_', 'zebra_');
  }
  // pavement along every street
  const road = (x, y) => g[y]?.[x] && /^(lane|junction|zebra)/.test(g[y][x]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (road(x, y)) continue;
    let by = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (road(x + dx, y + dy)) by = true;
    if (by) g[y][x] = 'pave';
  }
  // the edge of the world: rooftops
  for (let x = 0; x < W; x++) { g[0][x] = 'roof_b'; g[H - 1][x] = 'roof_b'; }
  for (let y = 0; y < H; y++) { g[y][0] = 'roof_b'; g[y][W - 1] = 'roof_b'; }
  // blocks: rooftops of three kinds, a park and a car park
  let k = 0;
  for (let i = 0; i < ROADS_X.length - 1; i++) for (let j = 0; j < ROADS_Y.length - 1; j++) {
    const x0 = ROADS_X[i] + 3;
    const x1 = ROADS_X[i + 1] - 2;
    const y0 = ROADS_Y[j] + 3;
    const y1 = ROADS_Y[j + 1] - 2;
    const kind = k++ % 6;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (kind === 2) g[y][x] = 'park';
      else if (kind === 4) g[y][x] = 'lot';
      else {
        // two buildings a block, split by an alley of pavement
        const mid = Math.floor((x0 + x1) / 2);
        g[y][x] = x === mid ? 'pave' : ['roof_a', 'roof_b', 'roof_c'][(x < mid ? kind : kind + 1) % 3];
      }
    }
    // the car park opens onto the street below it
    if (kind === 4) for (const x of [x0 + 3, x0 + 4]) { g[y1 + 1][x] = 'lot'; }
  }
  return g;
}

const GROUND = build();
const CHARS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ids = [...new Set(GROUND.flat())];
const legend = Object.fromEntries(ids.map((id, i) => [CHARS[i], id]));
const back = Object.fromEntries(Object.entries(legend).map(([c, id]) => [id, c]));

// trees in the parks, hydrants on some corners
const props = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (GROUND[y][x] === 'park' && (x * 7 + y * 3) % 5 === 0 && GROUND[y - 1]?.[x] === 'park') props.push({ t: 'tree', x, y });
}
for (const c of ROADS_X.slice(1, -1)) for (const r of ROADS_Y.slice(1, -1)) {
  props.push({ t: 'hydrant', x: c - 1, y: r - 1 });
  props.push({ t: 'streetlamp', x: c + 2, y: r + 2 });
}

// The car park's first cell, where the player's car waits.
const LOT = (() => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (GROUND[y][x] === 'lot') return [x + 1, y + 1]; return [5, 5]; })();
export const CITY_START = [ROADS_X[1] + 3, ROADS_Y[1] - 1];

export const cityMap = {
  name: 'place.city',
  movement: 'free',
  run: false,             // B shoots here
  hint: true,
  legend,
  ground: GROUND.map((row) => row.map((id) => back[id]).join('')),
  props,
  signals: { green: 5000, amber: 1200 },
  roads: { speed: 1.6 },
  population: { cars: 9, people: 14, dolls: Object.keys(cityDolls), vehicles: ['sedan', 'sedan', 'compact', 'van', 'taxi', 'truck'] },
  minimap: true,
  sim: { radius: 420 },
  camera: { lead: 16 },
  async enter(api) {
    api.save.cityHp ??= 100;
    api.addVehicle({ id: 'mine', keep: true, body: 'sports', color: '#e03040', x: LOT[0], y: LOT[1], dir: 'up' });
    api.addVehicle({ body: 'van', color: '#e8e8e8', x: LOT[0] + 2, y: LOT[1], dir: 'up' });
    api.addVehicle({ body: 'compact', color: '#30a050', x: LOT[0] + 4, y: LOT[1], dir: 'up', locked: true });
    // of other times: a carriage, a cart and a car of the 1920s
    api.addVehicle({ body: 'carriage', color: '#2a3a5a', x: LOT[0] + 6, y: LOT[1] + 1, dir: 'up' });
    api.addVehicle({ body: 'cart', x: LOT[0] + 8, y: LOT[1] + 1, dir: 'up' });
    api.addVehicle({ body: 'vintage', color: '#2a4a3a', x: LOT[0] + 2, y: LOT[1] + 4, dir: 'up' });
    api.addVehicle({ body: 'biplane', x: LOT[0] + 5, y: LOT[1] + 5, dir: 'up' });
  },
  update(api, e, control) {
    if (control && !api.driving && api.input.pressed('b')) api.shoot({ from: 'player', damage: 25 });
  },
  // the player's health is the cartridge's: the engine only says what hit them
  onDamage(api, { target, amount }) {
    if (target === 'player') api.save.cityHp = Math.max(0, Math.round((api.save.cityHp ?? 100) - amount));
  },
  hud(ctx, api) {
    const hp = api.save.cityHp ?? 100;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(2, 2, 58, 11);
    ctx.fillStyle = '#1c1830'; ctx.fillRect(4, 4, 54, 7);
    ctx.fillStyle = '#d84838'; ctx.fillRect(5, 5, Math.round(52 * hp / 100), 5);
    const v = api.driving;
    if (v) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(2, 14, 58, 7);
      ctx.fillStyle = '#40c060'; ctx.fillRect(4, 16, Math.round(54 * Math.max(0, v.hp) / v.maxHp), 3);
    }
  },
};

// A body of the lab's own (engine/vehicle.js `game.vehicles`): a biplane that takes off
// once going, flies over everything and lands when it slows. The engine knows no plane.
export const cityVehicles = {
  biplane: {
    w: 22, l: 18, on: 'air', height: 22, takeoff: true, frames: 2, hum: 64,
    accel: 0.05, max: 4, reverse: 0.4, brake: 0.06, grip: 0.9, turn: 0.04, mass: 1, hp: 80, seats: 2,
    paint(p, { frame, state }) {
      const body = state === 2 ? '#3a3436' : '#d8b040';
      const wing = state === 2 ? '#2a2628' : '#c03030';
      p.rect(0, 5, 22, 5, '#1c1830'); p.rect(1, 6, 20, 3, wing);          // the wings
      p.rect(9, 1, 4, 16, '#1c1830'); p.rect(10, 2, 2, 14, body);         // the fuselage
      p.rect(6, 14, 10, 3, '#1c1830'); p.rect(7, 15, 8, 1, wing);         // the tail
      p.rect(10, 7, 2, 2, '#3a4a62');                                     // the pilot
      // the propeller, turning
      if (frame) p.rect(7, 0, 8, 1, '#e8e8e8'); else p.rect(10, 0, 2, 1, '#e8e8e8');
    },
  },
};

export const cityMissions = {
  courier: {
    name: 'mission.courier',
    marker: { map: 'city', x: CITY_START[0] + 4, y: CITY_START[1], color: '#f0c030' },
    steps: [
      { objective: 'mission.courier_car', at: { map: 'city', x: LOT[0], y: LOT[1] }, done: (api) => !!api.driving },
      { objective: 'mission.courier_drop', at: { map: 'city', x: ROADS_X[3] + 1, y: ROADS_Y[2] + 1 }, time: 75,
        done: (api) => { const p = api.where('player'); return Math.hypot(p.x - (ROADS_X[3] + 1.5) * 16, p.y - (ROADS_Y[2] + 1.5) * 16) < 24; } },
    ],
    fail: (api) => (api.driving?.wreck ? 'mission.courier_wreck' : false),
    async reward(api) { api.inc('cash', 500); },
  },
};

export const cityJumps = [
  { label: 'city', run: async (api) => { await api.warp('city', CITY_START[0], CITY_START[1], 'down'); } },
  { label: 'city, at the wheel', run: async (api) => { await api.warp('city', LOT[0], LOT[1] + 2, 'up'); api.board('mine'); } },
  { label: 'city, night', run: async (api) => { api.setClock(22); await api.warp('city', LOT[0], LOT[1] + 2, 'up'); api.board('mine'); } },
  { label: 'city, police chase', run: async (api) => {
    await api.warp('city', LOT[0], LOT[1] + 2, 'up');
    api.board('mine');
    const cop = api.addVehicle({ body: 'police', x: ROADS_X[1], y: ROADS_Y[1] + 4, dir: 'down', always: true });
    api.drive(cop, { chase: 'player' });
  } },
];

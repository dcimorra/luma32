// Zaragoza inside its ring roads, imported from OpenStreetMap (tools/osm-city.mjs →
// ./zaragoza-map.js): a whole city on one map, for the engine's streets as a graph
// (engine/roadgraph.js) with the asphalt drawn from it, buildings raised by their storeys
// (README "Heights"), traffic and pavement round the camera, the minimap and the map
// screen at that size, and its landmarks drawn over their real outlines: the Pilar, the
// Seo, the Aljafería, every church and museum. Starts by the Pilar.
// Map data © OpenStreetMap contributors (ODbL).
import city from './zaragoza-map.js';
import { cityDolls } from './city.js';

const PAVE = '#aaa69e';
const LEVEL = 6;            // pixels a storey step (README "Heights")
const LANDMARK_H = 3;       // the height a landmark's outline is raised to, all of it

// A roof and the wall under it: windows a row a level, the wall a shade of the roof.
const roof = (base, hi, lo, wall, glass = '#3a4a62') => ({
  solid: true, auto: true, mapColor: base,
  draw(p, f, m) { p.fill(base); p.noise(1, 1, 14, 14, [hi], 0.06); p.edge(m, { color: lo, width: 1 }); },
  side(p, f, h) {
    p.fill(wall);
    for (let y = 1; y + 3 <= h; y += LEVEL) { p.rect(2, y + 1, 4, 3, glass); p.rect(10, y + 1, 4, 3, glass); p.px(2, y + 1, '#6a7a92'); p.px(10, y + 1, '#6a7a92'); }
    p.vline(0, 0, h, lo);
  },
});

export const zaragozaTiles = {
  osm_ground: { mapColor: '#b0a894', draw(p) { p.fill('#b8b09c'); p.noise(0, 0, 16, 16, ['#c4bca8', '#aaa290'], 0.1); } },
  osm_park: { drive: { max: 0.5, grip: 0.7 }, mapColor: '#5a9a4a', draw(p) { p.fill('#5a9a4a'); p.noise(0, 0, 16, 16, ['#74b65e', '#3e7a34'], 0.15); } },
  osm_trees: { drive: { max: 0.35, grip: 0.6 }, mapColor: '#2e6a2a', draw(p) { p.fill('#3e7a34'); p.rect(2, 2, 6, 6, '#2e6a2a'); p.rect(9, 8, 6, 6, '#2e6a2a'); p.px(3, 3, '#58a048'); p.px(10, 9, '#58a048'); } },
  osm_sand: { drive: { max: 0.6, grip: 0.7 }, mapColor: '#d0c090', draw(p) { p.fill('#d8c890'); p.noise(0, 0, 16, 16, ['#e8dca8', '#c0b078'], 0.12); } },
  osm_water: { medium: 'water', step: 'water', dust: false, frames: 2, auto: true, mapColor: '#3a78b8', draw(p, f, m) {
    p.fill('#3a78b8'); p.hline(2 + f * 4, 5, 5, '#6aa8e0'); p.hline(9 - f * 3, 11, 4, '#5a98d0');
    p.edge(m, { color: '#8a8270', width: 2 });
  } },
  osm_plaza: { sidewalk: true, step: 'hard', mapColor: '#c8c0b0', draw(p) { p.fill('#ccc4b4'); p.hline(0, 0, 16, '#b4ac9c'); p.vline(0, 0, 16, '#b4ac9c'); } },
  osm_parking: { step: 'hard', mapColor: '#6a6a72', draw(p) { p.fill('#5e5e68'); p.vline(0, 3, 10, '#d8d8d8'); } },
  osm_bld1: roof('#a85a48', '#b86a58', '#7a3e30', '#c8a888'),
  osm_bld2: roof('#7e828c', '#8e929c', '#5a5e68', '#b8b4ac'),
  osm_bld3: roof('#b8a07a', '#c8b08a', '#8a7656', '#d8c8a8'),
  osm_monument: { solid: true, auto: true, mapColor: '#e0c060', draw(p, f, m) {
    p.fill('#d0b468'); p.edge(m, { color: '#7a6230', width: 1 });
  }, side(p, f, h) {
    // stone with an arch a cell
    p.fill('#c8b080'); p.rect(5, Math.max(1, h - 9), 6, 9, '#5a4a38'); p.rect(6, Math.max(0, h - 10), 4, 1, '#5a4a38'); p.vline(0, 0, h, '#8a7656');
  } },
  osm_rail: { drive: { max: 0.6 }, step: 'hard', mapColor: '#7a7068', draw(p) { p.fill('#8a8078'); p.vline(4, 0, 16, '#5a5250'); p.vline(11, 0, 16, '#5a5250'); for (let y = 1; y < 16; y += 4) p.hline(2, y, 12, '#6a5a48'); } },
  // the street's cells are kerb: the engine paints the asphalt over them from the graph
  osm_road: { step: 'hard', mapColor: '#3a3a42', draw(p) { p.fill('#9a968e'); p.noise(0, 0, 16, 16, ['#8e8a82'], 0.05); } },
  osm_crossing: { crosswalk: true, step: 'hard', mapColor: '#3a3a42', draw(p) { p.fill('#9a968e'); } },
  osm_pave: { sidewalk: true, step: 'hard', mapColor: '#9a968e', draw(p) { p.fill(PAVE); p.hline(0, 0, 16, '#8e8a82'); p.vline(0, 0, 16, '#8e8a82'); } },
};

// ---------- landmarks ----------

const inside = (poly, x, y) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) c = !c;
  }
  return c;
};
const LANDMARKS = city.landmarks.map((l) => {
  const xs = l.poly.map((p) => p[0]);
  const ys = l.poly.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs));
  const y0 = Math.floor(Math.min(...ys));
  return { ...l, x0, y0, w: Math.ceil(Math.max(...xs)) - x0, h: Math.ceil(Math.max(...ys)) - y0 };
});
// a landmark's outline stands at one height, so the art laid over its roof lines up
const heights = city.heights.map((r) => [...r]);
for (const l of LANDMARKS) {
  for (let y = l.y0; y < l.y0 + l.h; y++) for (let x = l.x0; x < l.x0 + l.w; x++) {
    if (heights[y]?.[x] !== undefined && heights[y][x] !== '0' && inside(l.poly, x + 0.5, y + 0.5)) heights[y][x] = String(LANDMARK_H);
  }
}
const HEIGHTS = heights.map((r) => r.join(''));

// The art of one landmark, painted pixel by pixel in the building's own frame (along its
// longest wall: the Pilar stands at an angle), cut to its outline with a dark rim.
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const GLAZE = ['#2e8a4a', '#e8c030', '#f0f0e8', '#2a5ab0'].map(hex);
function frameOf(poly) {
  let best = 0; let ang = 0;
  for (let i = 1; i < poly.length; i++) {
    const dx = poly[i][0] - poly[i - 1][0]; const dy = poly[i][1] - poly[i - 1][1];
    const l = Math.hypot(dx, dy);
    if (l > best) { best = l; ang = Math.atan2(dy, dx); }
  }
  const c = Math.cos(ang); const s = Math.sin(ang);
  const us = poly.map(([x, y]) => x * c + y * s);
  const vs = poly.map(([x, y]) => -x * s + y * c);
  const u0 = Math.min(...us); const u1 = Math.max(...us); const v0 = Math.min(...vs); const v1 = Math.max(...vs);
  // u along the long side, v across, both from the middle; L and B the length and breadth
  const flip = u1 - u0 < v1 - v0;
  return { c, s, cu: (u0 + u1) / 2, cv: (v0 + v1) / 2, L: Math.max(u1 - u0, v1 - v0), B: Math.min(u1 - u0, v1 - v0), flip };
}
function shaderOf(l, f) {
  const { L, B } = f;
  const name = l.name;
  if (/Basílica.*Pilar/.test(name)) {
    // brick, eleven glazed domes, a tower at each corner
    const domes = [[0, 0, 0.1 * L], [-0.22 * L, 0, 0.06 * L], [0.22 * L, 0, 0.06 * L]];
    for (const du of [-0.12, 0.12, -0.33, 0.33]) for (const dv of [-0.27, 0.27]) domes.push([du * L, dv * B, 0.045 * L]);
    const ts = 0.09 * B;
    const towers = [[-0.5 * L + ts, -0.5 * B + ts], [0.5 * L - ts, -0.5 * B + ts], [-0.5 * L + ts, 0.5 * B - ts], [0.5 * L - ts, 0.5 * B - ts]];
    return (u, v) => {
      for (const [tu, tv] of towers) {
        const du = Math.abs(u - tu); const dv = Math.abs(v - tv);
        if (du < ts && dv < ts) return du > ts - 1.5 || dv > ts - 1.5 ? [58, 48, 32] : du < ts * 0.45 && dv < ts * 0.45 ? hex('#a8763a') : hex('#e8dcc0');
      }
      for (const [du0, dv0, r] of domes) {
        const d = Math.hypot(u - du0, v - dv0);
        if (d > r) continue;
        if (d > r - 1.2) return [58, 48, 32];
        if (d < 2) return hex('#e0c060');
        const ring = Math.floor((d / r) * 4);
        const ray = Math.floor(((Math.atan2(v - dv0, u - du0) + Math.PI) / (Math.PI * 2)) * 16);
        const c = GLAZE[(ring + ray) % 4];
        return u - du0 < -r * 0.3 && v - dv0 < -r * 0.3 ? c.map((x) => Math.min(255, x + 30)) : c;
      }
      return (Math.floor(u / 3) + Math.floor(v / 3)) % 2 ? hex('#c8946a') : hex('#be8a60');
    };
  }
  if (/Aljafer|castle/i.test(name + l.kind)) {
    // walls round a garden courtyard, square towers along them
    return (u, v) => {
      const eu = 0.5 * L - Math.abs(u); const ev = 0.5 * B - Math.abs(v);
      const wall = Math.min(eu, ev);
      if (wall < 10) {
        const along = eu < ev ? v : u;
        const tower = Math.abs(((along + 1000) % 40) - 20) < 7;
        if (tower) return wall < 1.2 ? [58, 48, 32] : hex('#d4b488');
        return wall < 1.2 || wall > 8.8 ? hex('#8a6a48') : (Math.floor(along / 3) % 2 ? hex('#c4a478') : hex('#bc9c70'));
      }
      return (Math.floor(u / 6) + Math.floor(v / 6)) % 5 === 0 ? hex('#4a7a3a') : hex('#6a9a4a');
    };
  }
  if (/cathedral|church|place_of_worship|basilica/.test(l.kind) || /Iglesia|Parroquia|Catedral|San |Santa /.test(name)) {
    // a pitched roof along the nave, a bell tower at one end (mudéjar brick and glaze for the Seo)
    const seo = /Salvador/.test(name);
    const ts = Math.max(5, 0.16 * L);
    return (u, v) => {
      if (u > 0.5 * L - 2 * ts && Math.abs(v) < ts) {
        const du = u - (0.5 * L - ts); const edge = Math.max(Math.abs(du), Math.abs(v)) > ts - 1.2;
        if (edge) return [58, 48, 32];
        if (seo) return (Math.floor(du / 2) + Math.floor(v / 2)) % 3 === 0 ? hex('#2e8a4a') : hex('#b8784a');
        return Math.max(Math.abs(du), Math.abs(v)) < ts * 0.4 ? hex('#8a7050') : hex('#d8c8a0');
      }
      if (Math.abs(v) < 1) return hex('#6a5438');
      const lit = v < 0;
      return Math.floor(u / 3) % 2 ? hex(lit ? '#c8ac80' : '#a88e64') : hex(lit ? '#bea276' : '#9e845a');
    };
  }
  // a museum, a hall: a flat roof with skylights
  return (u, v) => ((((u + 1000) % 12) < 6 && ((v + 1000) % 10) < 4) ? hex('#7a9ab8') : hex('#c8bca0'));
}
function paintLandmark(l) {
  const W = l.w * 16;
  const H = l.h * 16;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  const poly = l.poly.map(([x, y]) => [(x - l.x0) * 16, (y - l.y0) * 16]);
  const f = frameOf(poly);
  const shade = shaderOf(l, f);
  const at = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) at[y * W + x] = inside(poly, x + 0.5, y + 0.5) ? 1 : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x;
    if (!at[k]) continue;
    const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1 || !at[k - 1] || !at[k + 1] || !at[k - W] || !at[k + W];
    let u = (x + 0.5) * f.c + (y + 0.5) * f.s - f.cu;
    let v = -(x + 0.5) * f.s + (y + 0.5) * f.c - f.cv;
    if (f.flip) [u, v] = [v, u];
    const col = edge ? [58, 48, 32] : shade(u, v);
    d[k * 4] = col[0]; d[k * 4 + 1] = col[1]; d[k * 4 + 2] = col[2]; d[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
const art = new Map();

// ---------- the map ----------

// where to start: the pavement nearest the Pilar
const at = (x, y) => city.legend[city.ground[y]?.[x]];
function nearest(x, y, ok) {
  for (let r = 0; r < 60; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (ok(at(x + dx, y + dy))) return [x + dx, y + dy];
  }
  return [x, y];
}
const PILAR = LANDMARKS.find((l) => /Basílica.*Pilar/.test(l.name));
const pilar = PILAR ? { x: PILAR.x0 + Math.floor(PILAR.w / 2), y: PILAR.y0 + PILAR.h } : { x: Math.floor(city.w / 2), y: Math.floor(city.h / 2) };
export const ZGZ_START = nearest(pilar.x, pilar.y + 2, (t) => t === 'osm_pave' || t === 'osm_plaza');
// the car waits on the pavement by the kerb, out of the traffic's way
const CAR = (() => {
  const [x, y] = nearest(ZGZ_START[0], ZGZ_START[1], (t) => t === 'osm_road');
  return nearest(x, y, (t) => t === 'osm_pave');
})();
const SIGHTS = LANDMARKS.filter((l) => /Basílica.*Pilar|Catedral del Salvador|Aljafer|Lonja|San Pablo|Pablo Serrano|Magdalena/.test(l.name));

export const zaragozaMap = {
  name: 'place.zaragoza',
  movement: 'free',
  run: false,
  legend: city.legend,
  ground: city.ground,
  heights: HEIGHTS,
  level: LEVEL,
  roads: { speed: 1.8, graph: city.roads.graph, surface: { asphalt: '#4a4a54' } },
  signals: { green: 6000, amber: 1500 },
  population: { cars: 14, people: 18, dolls: Object.keys(cityDolls), vehicles: ['sedan', 'sedan', 'compact', 'compact', 'van', 'taxi', 'bike'] },
  minimap: { r: 28 },
  sim: { radius: 520 },
  camera: { lead: 16 },
  async enter(api) {
    api.addVehicle({ id: 'zgz_car', keep: true, body: 'sedan', color: '#e8e8e8', x: CAR[0], y: CAR[1], dir: 'right' });
    for (const l of SIGHTS) api.blip(`sight:${l.name}`, { at: [l.x0 + Math.floor(l.w / 2), l.y0 + Math.floor(l.h / 2)], color: '#e0c060' });
  },
  // the landmarks over their raised roofs
  above(ctx, api, cam) {
    const vw = ctx.canvas.width;
    const vh = ctx.canvas.height;
    const lift = LANDMARK_H * LEVEL;
    for (const l of LANDMARKS) {
      const x = l.x0 * 16 - cam.x;
      const y = l.y0 * 16 - cam.y - lift;
      if (x > vw || y > vh || x + l.w * 16 < 0 || y + l.h * 16 < 0) continue;
      let c = art.get(l);
      if (!c) art.set(l, (c = paintLandmark(l)));
      ctx.drawImage(c, Math.round(x), Math.round(y));
    }
  },
  update(api, e, control) {
    if (control && !api.driving && api.input.pressed('b')) api.shoot({ from: 'player', damage: 25 });
  },
};

export const zaragozaJumps = [
  { label: 'zaragoza', run: async (api) => { await api.warp('zaragoza', ZGZ_START[0], ZGZ_START[1], 'down'); } },
  { label: 'zaragoza, at the wheel', run: async (api) => { await api.warp('zaragoza', ZGZ_START[0], ZGZ_START[1], 'down'); api.board('zgz_car'); } },
];

export const ZGZ_ATTRIBUTION = city.attribution;

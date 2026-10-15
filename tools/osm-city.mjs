// Turns an OpenStreetMap download (tools/osm-fetch.mjs) into a LUMA 32 map: the ground
// as cells (streets, pavement, buildings, parks, water, railways, squares, car parks,
// zebra crossings), the streets as a graph the traffic drives (engine/roadgraph.js) with
// their lanes, one-ways and signals, and the named places. README "A city from
// OpenStreetMap".
//
//   node tools/osm-city.mjs <osm.json> <south,west,north,east> <out.js> [--scale 6] [--name zaragoza]
//
// --scale: metres a cell (16 pixels). Streets are drawn wider than they are (a lane is
// LANE pixels, so a car fits), and the buildings beside them give way.
// The output is a module: `export default { w, h, legend, ground, roads, places, attribution }`,
// its rows run-length encoded and decoded on load. The legend names the cartridge's tiles
// `osm_<class>`: it brings their art (tools/lab/zaragoza.js has a set).
//
// The data is © OpenStreetMap contributors, under the ODbL: the game says so in its credits.
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [src, bboxArg, out] = args;
if (!src || !bboxArg || !out) {
  console.error('usage: node tools/osm-city.mjs <osm.json> <south,west,north,east> <out.js> [--scale 6]');
  process.exit(1);
}
const SCALE = Number(opt('scale', 6));
const TILE = 16;
const LANE = 14;                     // engine/roadgraph.js
const [south, west, north, east] = bboxArg.split(',').map(Number);
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);

// ---------- reading ----------

const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const nodes = new Map();
const ways = new Map();
const rels = [];
for (const e of raw.elements) {
  // a node comes twice (with its tags, then bare as part of a way): keep the tags
  if (e.type === 'node') { if (!nodes.get(e.id)?.tags) nodes.set(e.id, e); }
  else if (e.type === 'way') ways.set(e.id, e);
  else if (e.type === 'relation') rels.push(e);
}
log(`${nodes.size} nodes, ${ways.size} ways, ${rels.length} relations`);

// metres from the north-west corner, then cells
const lat0 = (south + north) / 2;
const MX = 111320 * Math.cos((lat0 * Math.PI) / 180);
const MY = 110540;
const W = Math.ceil(((east - west) * MX) / SCALE);
const H = Math.ceil(((north - south) * MY) / SCALE);
const cellOf = (n) => [((n.lon - west) * MX) / SCALE, ((north - n.lat) * MY) / SCALE];
const pxOf = (n) => { const [x, y] = cellOf(n); return [Math.round(x * TILE), Math.round(y * TILE)]; };
const inside = (n) => n.lat >= south && n.lat <= north && n.lon >= west && n.lon <= east;
log(`map ${W} × ${H} cells (${(W * H / 1e6).toFixed(2)} M) at ${SCALE} m a cell`);

// ---------- the ground ----------

const C = { ground: 0, park: 1, water: 2, plaza: 3, parking: 4, bld1: 5, bld2: 6, bld3: 7, monument: 8, rail: 9, road: 10, pave: 11, crossing: 12, sand: 13, trees: 14 };
const NAMES = Object.keys(C);
const grid = new Uint8Array(W * H);
const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) grid[y * W + x] = c; };

// storeys of the building on each cell (0: none)
const storeys = new Uint8Array(W * H);

// a polygon filled on cell centres, scanline by scanline: each cell inside goes to fn
function cells(poly, fn) {
  if (poly.length < 3) return;
  let y0 = Infinity; let y1 = -Infinity;
  for (const [, y] of poly) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) {
    const cy = y + 0.5;
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) * (xj - xi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(W - 1, Math.floor(xs[k + 1] - 0.5)); x++) fn(y * W + x);
    }
  }
}

function fill(poly, c, only = null) {
  if (poly.length < 3) return;
  let y0 = Infinity; let y1 = -Infinity;
  for (const [, y] of poly) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) {
    const cy = y + 0.5;
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) * (xj - xi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(W - 1, Math.floor(xs[k + 1] - 0.5)); x++) {
        if (only && !only.has(grid[y * W + x])) continue;
        grid[y * W + x] = c;
      }
    }
  }
}

// a thick line: every cell whose centre is within `half` cells of a segment
function stroke(line, half, c, only = null) {
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - half));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + half));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - half));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + half));
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
      const qx = ax + dx * t - px;
      const qy = ay + dy * t - py;
      if (qx * qx + qy * qy > half * half) continue;
      if (only && !only.has(grid[y * W + x])) continue;
      grid[y * W + x] = c;
    }
  }
}

const line = (w) => w.nodes.map((id) => nodes.get(id)).filter(Boolean).map(cellOf);
const closed = (w) => w.nodes.length > 3 && w.nodes[0] === w.nodes[w.nodes.length - 1];
const hash = (n) => { let h = n % 2147483647; h = (h * 16807) % 2147483647; return h; };

// the outer rings of a multipolygon, joined from their ways
function rings(rel) {
  const parts = rel.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => ways.get(m.ref)).filter(Boolean).map((w) => [...w.nodes]);
  const out = [];
  while (parts.length) {
    let ring = parts.shift();
    let grew = true;
    while (ring[0] !== ring[ring.length - 1] && grew) {
      grew = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const end = ring[ring.length - 1];
        if (p[0] === end) ring = ring.concat(p.slice(1));
        else if (p[p.length - 1] === end) ring = ring.concat([...p].reverse().slice(1));
        else continue;
        parts.splice(i, 1);
        grew = true;
        break;
      }
    }
    out.push(ring.map((id) => nodes.get(id)).filter(Boolean).map(cellOf));
  }
  return out;
}

const area = (t) => {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.water || t.landuse === 'reservoir' || t.landuse === 'basin') return C.water;
  if (t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'grass' || t.landuse === 'recreation_ground' || t.leisure === 'pitch' || t.landuse === 'meadow' || t.landuse === 'village_green' || t.natural === 'grassland' || t.leisure === 'playground') return C.park;
  if (t.landuse === 'forest' || t.natural === 'wood' || t.natural === 'scrub') return C.trees;
  if (t.natural === 'sand' || t.natural === 'beach' || t.natural === 'bare_rock' || t.landuse === 'construction' || t.landuse === 'brownfield') return C.sand;
  if (t.amenity === 'parking') return C.parking;
  if (t.place === 'square' || t.highway === 'pedestrian' || (t.area === 'yes' && t.highway === 'footway')) return C.plaza;
  return null;
};
const building = (t, id) => {
  if (t.historic || t.building === 'church' || t.building === 'cathedral' || t.amenity === 'place_of_worship' || t.tourism === 'attraction' || t.building === 'castle') return C.monument;
  return [C.bld1, C.bld2, C.bld3][hash(id) % 3];
};

// land first (parks, water, squares), then buildings over it
for (const w of ways.values()) {
  const t = w.tags || {};
  if (!closed(w)) continue;
  const c = area(t);
  if (c !== null) fill(line(w), c);
}
for (const r of rels) {
  const t = r.tags || {};
  const c = t.building ? null : area(t);
  if (c !== null) for (const ring of rings(r)) fill(ring, c);
}
// rivers drawn as lines where no area says it
for (const w of ways.values()) {
  const t = w.tags || {};
  if (t.waterway === 'river') stroke(line(w), 40 / SCALE / 2, C.water, new Set([C.ground, C.park, C.trees, C.sand]));
  if (t.waterway === 'canal' || t.waterway === 'stream') stroke(line(w), Math.max(0.5, 8 / SCALE / 2), C.water, new Set([C.ground, C.park, C.trees, C.sand]));
}
// how many storeys: building:levels, or height at 3 m a storey, or a guess the size of
// the city's usual blocks
const floorsOf = (t, id) => {
  const lv = Number.parseFloat(t['building:levels']);
  if (lv > 0) return lv + (Number.parseFloat(t['roof:levels']) || 0);
  const h = Number.parseFloat(t.height);
  if (h > 0) return h / 3;
  return 3 + (hash(id) % 4);
};
const raise = (poly, n) => cells(poly, (i) => { storeys[i] = Math.max(storeys[i], Math.min(255, Math.round(n))); });
// the named landmarks, outlined, for the cartridge's own art over them
const landmarks = [];
const landmark = (t, id, polys) => {
  if (!t.name || !(t.historic || t.building === 'church' || t.building === 'cathedral' || t.building === 'basilica' || t.amenity === 'place_of_worship' || t.tourism === 'attraction' || t.building === 'castle' || t.tourism === 'museum')) return;
  const poly = polys.sort((a, b) => b.length - a.length)[0];
  if (!poly || poly.length < 4) return;
  let n = 0;
  cells(poly, () => n++);
  if (n < 12) return;
  landmarks.push({ name: t.name, kind: t.building === 'yes' ? t.historic || t.tourism || t.amenity : t.building || t.historic, poly: poly.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]) });
};
for (const w of ways.values()) {
  const t = w.tags || {};
  if (!(t.building || t['building:part']) || !closed(w) || t.building === 'roof' || t.location === 'underground') continue;
  const poly = line(w);
  if (t.building) fill(poly, building(t, w.id));
  raise(poly, floorsOf(t, w.id));
  if (t.building) landmark(t, w.id, [poly]);
}
for (const r of rels) {
  if (!r.tags?.building) continue;
  const rs = rings(r);
  for (const ring of rs) { fill(ring, building(r.tags, r.id)); raise(ring, floorsOf(r.tags, r.id)); }
  landmark(r.tags, r.id, rs);
}
log('areas and buildings');

// ---------- streets ----------

const DRIVE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const FOOT = new Set(['footway', 'pedestrian', 'path', 'steps', 'cycleway', 'track', 'bridleway']);

function lanesOf(t) {
  const hw = t.highway.replace('_link', '');
  const one = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' || t.junction === 'circular' || hw === 'motorway' ? 1 : t.oneway === '-1' ? -1 : 0;
  let total = Number.parseInt(t.lanes, 10);
  const big = hw === 'motorway' || hw === 'trunk' || hw === 'primary';
  if (!total) total = one ? (big ? 2 : 1) : big ? 4 : 2;
  if (t.highway.endsWith('_link') || hw === 'service') total = one ? 1 : 2;
  let fwd = Number.parseInt(t['lanes:forward'], 10);
  let back = Number.parseInt(t['lanes:backward'], 10);
  if (one) { fwd = total; back = 0; } else { fwd ||= Math.max(1, Math.ceil(total / 2)); back ||= Math.max(1, total - fwd); }
  fwd = Math.min(3, fwd); back = Math.min(3, back);
  return one === -1 ? { fwd: back || fwd, back: 0, reverse: true } : { fwd, back };
}

const SOFT = new Set([C.ground, C.park, C.trees, C.sand, C.parking, C.plaza, C.bld1, C.bld2, C.bld3, C.water, C.pave, C.rail]);
// railways (not trams: those run in the street) under the streets
for (const w of ways.values()) {
  const t = w.tags || {};
  if ((t.railway === 'rail' || t.railway === 'light_rail') && !t.tunnel && t.layer !== '-1') stroke(line(w), 0.6, C.rail, new Set([C.ground, C.park, C.trees, C.sand, C.parking]));
}
// footways and squares: pavement
for (const w of ways.values()) {
  const t = w.tags || {};
  if (!t.highway || !FOOT.has(t.highway) || t.tunnel === 'yes' || (t.layer && Number(t.layer) < 0)) continue;
  if (closed(w) && (t.area === 'yes' || t.highway === 'pedestrian')) continue;
  stroke(line(w), 0.55, C.pave, new Set([C.ground, C.park, C.trees, C.sand, C.parking]));
}
// streets, wider than they are: a lane is LANE pixels; monuments keep their ground
const drivable = [];
for (const w of ways.values()) {
  const t = w.tags || {};
  if (!t.highway || !DRIVE.has(t.highway) || t.area === 'yes' || t.tunnel === 'yes' || (t.layer && Number(t.layer) < 0)) continue;
  if (t.access === 'no' || t.access === 'private' || t.service === 'parking_aisle' || t.service === 'driveway') continue;
  const l = lanesOf(t);
  drivable.push({ w, l });
  const half = (((l.fwd + l.back) * LANE) / TILE + 0.6) / 2;
  stroke(line(w), half, C.road, SOFT);
}
log(`${drivable.length} streets drawn`);
// pavement along every street, where nothing else is
const road = (x, y) => x >= 0 && y >= 0 && x < W && y < H && grid[y * W + x] === C.road;
const PAVE_ON = new Set([C.ground, C.park, C.trees, C.sand, C.bld1, C.bld2, C.bld3]);
const pave = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!PAVE_ON.has(grid[y * W + x])) continue;
  if (road(x - 1, y) || road(x + 1, y) || road(x, y - 1) || road(x, y + 1) || road(x - 1, y - 1) || road(x + 1, y + 1) || road(x - 1, y + 1) || road(x + 1, y - 1)) pave.push(y * W + x);
}
for (const i of pave) grid[i] = C.pave;
// zebra crossings where the map has them: a band across the street, kerb to kerb
const across = new Map();   // node id → { dx, dy, half } of the street it is on
for (const { w, l } of drivable) {
  for (let i = 0; i < w.nodes.length; i++) {
    const n = nodes.get(w.nodes[i]);
    if (n?.tags?.highway !== 'crossing') continue;
    const a = nodes.get(w.nodes[Math.max(0, i - 1)]);
    const b = nodes.get(w.nodes[Math.min(w.nodes.length - 1, i + 1)]);
    if (!a || !b) continue;
    const [ax, ay] = cellOf(a);
    const [bx, by] = cellOf(b);
    const d = Math.hypot(bx - ax, by - ay) || 1;
    across.set(n.id, { dx: (bx - ax) / d, dy: (by - ay) / d, half: (((l.fwd + l.back) * LANE) / TILE + 0.6) / 2 });
  }
}
// and for the engine to paint (roadgraph.js): [x, y, angle of the street, its width] in pixels
const zebras = [];
for (const [id, a] of across) {
  const [x, y] = cellOf(nodes.get(id));
  zebras.push([Math.round(x * TILE), Math.round(y * TILE), Math.round(Math.atan2(a.dy, a.dx) * 1000) / 1000, Math.round(a.half * 2 * TILE - 0.6 * TILE)]);
  const r = a.half + 0.8;
  stroke([[x + a.dy * r, y - a.dx * r], [x - a.dy * r, y + a.dx * r]], 0.5, C.crossing, new Set([C.road]));
}
log('pavement and crossings');

// ---------- the graph ----------

// a node of the graph where streets meet or end; the rest are bends of an edge
const uses = new Map();
for (const { w } of drivable) for (const id of w.nodes) uses.set(id, (uses.get(id) || 0) + 1);
const gNodes = [];
const gIndex = new Map();
const gNode = (id) => {
  let i = gIndex.get(id);
  if (i === undefined) { const n = nodes.get(id); const [x, y] = pxOf(n); i = gNodes.length; gNodes.push([x, y]); gIndex.set(id, i); }
  return i;
};
const names = [];
const nameIx = new Map();
const nameOf = (s) => { if (!s) return undefined; let i = nameIx.get(s); if (i === undefined) { i = names.length; names.push(s); nameIx.set(s, i); } return i; };
// fewer bends: points closer than a pixel to the line between their neighbours go
function simplify(pts, eps = 1.5) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1; let bd = eps;
    const [ax, ay] = pts[a]; const [bx, by] = pts[b];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / l;
      if (d > bd) { bd = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const edges = [];
for (const { w, l } of drivable) {
  const t = w.tags;
  let ids = w.nodes;
  if (l.reverse) ids = [...ids].reverse();
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const a = gNode(run[0]);
      const b = gNode(run[run.length - 1]);
      const pts = simplify(run.map((id) => pxOf(nodes.get(id))));
      const via = [];
      for (const [x, y] of pts.slice(1, -1)) via.push(x, y);
      const length = pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
      if (a !== b && length > 2) edges.push({ a, b, fwd: l.fwd, back: l.back, ...(via.length ? { via } : {}), ...(t.name ? { name: nameOf(t.name) } : {}) });
    }
  };
  for (const id of ids) {
    const n = nodes.get(id);
    if (!n || !inside(n)) { flush(); run = []; continue; }
    run.push(id);
    // a junction (another street uses it) ends this edge and starts the next
    if (run.length > 1 && uses.get(id) > 1) { flush(); run = [id]; }
  }
  flush();
}
// signals: on the junction itself, or the nearest junction within 30 metres
const degree = new Map();
for (const e of edges) { degree.set(e.a, (degree.get(e.a) || 0) + 1); degree.set(e.b, (degree.get(e.b) || 0) + 1); }
const junctions = [...degree].filter(([, d]) => d >= 3).map(([i]) => i);
const signalled = new Set();
const reach = (30 / SCALE) * TILE;
for (const n of nodes.values()) {
  if (n.tags?.highway !== 'traffic_signals' || !inside(n)) continue;
  const [x, y] = pxOf(n);
  let best = -1; let bd = reach * reach;
  for (const j of junctions) {
    const d = (gNodes[j][0] - x) ** 2 + (gNodes[j][1] - y) ** 2;
    if (d < bd) { bd = d; best = j; }
  }
  if (best >= 0) signalled.add(best);
}
for (const j of signalled) gNodes[j].push({ signal: true });
log(`graph: ${gNodes.length} nodes, ${edges.length} edges, ${signalled.size} junctions with signals`);

// ---------- named places ----------

const places = [];
const seenPlace = new Set();
const centre = (w) => { const pts = w.nodes.map((id) => nodes.get(id)).filter(Boolean); const lat = pts.reduce((s, n) => s + n.lat, 0) / pts.length; const lon = pts.reduce((s, n) => s + n.lon, 0) / pts.length; return { lat, lon }; };
for (const e of [...nodes.values(), ...ways.values()]) {
  const t = e.tags;
  if (!t?.name || !(t.tourism || t.historic) || seenPlace.has(t.name)) continue;
  const at = e.type === 'node' ? e : centre(e);
  if (!inside(at)) continue;
  seenPlace.add(t.name);
  const [x, y] = cellOf(at);
  places.push({ name: t.name, kind: t.historic || t.tourism, x: Math.floor(x), y: Math.floor(y) });
}

// ---------- writing ----------

const CH = 'abcdefghijklmnopq';
const legend = Object.fromEntries(NAMES.map((n, i) => [CH[i], `osm_${n}`]));
// each row as runs: "<count><char>" ("12a3k")
const rows = [];
for (let y = 0; y < H; y++) {
  let s = '';
  let x = 0;
  while (x < W) {
    const c = grid[y * W + x];
    let n = 1;
    while (x + n < W && grid[y * W + x + n] === c) n++;
    s += (n > 1 ? n : '') + CH[c];
    x += n;
  }
  rows.push(s);
}
// heights: storeys in steps of --storeys (2.5) up to --max-height (4), on buildings only;
// a building taller in the city than the street is wide would hide the street behind it
const PER = Number(opt('storeys', 2.5));
const MAXH = Number(opt('max-height', 4));
const BUILT = new Set([C.bld1, C.bld2, C.bld3, C.monument]);
const hrows = [];
for (let y = 0; y < H; y++) {
  let s = '';
  let x = 0;
  const hAt = (x) => (BUILT.has(grid[y * W + x]) ? Math.max(1, Math.min(MAXH, Math.ceil(storeys[y * W + x] / PER))) : 0);
  while (x < W) {
    const v = hAt(x);
    let n = 1;
    while (x + n < W && hAt(x + n) === v) n++;
    s += (n > 1 ? n : '') + String.fromCharCode(65 + v);
    x += n;
  }
  hrows.push(s);
}
const stats = {};
for (const c of grid) stats[NAMES[c]] = (stats[NAMES[c]] || 0) + 1;
const body = `// ${opt('name', 'city')} from OpenStreetMap, made by tools/osm-city.mjs: do not edit, run it again.
// bbox ${bboxArg}, ${SCALE} m a cell, ${W} × ${H} cells. © OpenStreetMap contributors (ODbL).
const rle = ${JSON.stringify(rows)};
const ground = rle.map((r) => r.replace(/(\\d+)(\\D)/g, (m, n, c) => c.repeat(+n)));
// heights are letters in the file (A = 0), so the counts stay digits
const hrle = ${JSON.stringify(hrows)};
const heights = hrle.map((r) => r.replace(/(\\d+)(\\D)/g, (m, n, c) => c.repeat(+n)).replace(/[A-J]/g, (c) => c.charCodeAt(0) - 65));
const names = ${JSON.stringify(names)};
const edges = ${JSON.stringify(edges)};
for (const e of edges) if (e.name !== undefined) e.name = names[e.name];
export default {
  w: ${W}, h: ${H}, scale: ${SCALE},
  legend: ${JSON.stringify(legend)},
  ground,
  heights,
  roads: { graph: { nodes: ${JSON.stringify(gNodes)}, edges, crossings: ${JSON.stringify(zebras)} } },
  places: ${JSON.stringify(places)},
  landmarks: ${JSON.stringify(landmarks)},
  attribution: '© OpenStreetMap contributors',
};
`;
fs.writeFileSync(out, body);
log(`${out}: ${(body.length / 1e6).toFixed(2)} MB; cells ${JSON.stringify(stats)}; ${places.length} places, ${landmarks.length} landmarks`);

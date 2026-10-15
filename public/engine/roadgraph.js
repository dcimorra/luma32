// Streets as lines, any angle (README "Streets as a graph"): what a real city needs, where
// tile lanes (engine/traffic.js) only go north, south, east and west. A map gives the
// streets' centre lines and the engine lays out the lanes along them, curves and
// diagonals included; traffic follows the lanes and turns across junctions on arcs.
//
//   roads: { speed: 1.6, graph: {
//     nodes: [[x, y], [x, y, { signal: true }], …],          // map pixels
//     edges: [{ a: 0, b: 1, fwd: 2, back: 2, via: [x, y, x, y], name: 'Paseo…' }, …] } }
//
// `fwd` lanes go from a to b, `back` from b to a (0: one way); `via` are the bends between.
// Lanes are LANE pixels wide, driven on the right of the centre line. A node where three or
// more streets meet is a junction: the lanes stop short of it by its radius, and with
// `signal` it lets one axis through at a time. Only the biggest part of the network that
// can be driven round and round (strongly connected) gets traffic; dead ends and lone
// car parks are left to the player.
import { TILE, SCREEN_W, SCREEN_H } from './gfx.js';
import { wrapAngle } from './vehicle.js';

export const LANE = 14;          // pixels a lane is wide
const CHUNK = 256;               // pixels a side of a bucket of the spatial index
const ck = (x, y) => Math.floor(x / CHUNK) * 65536 + Math.floor(y / CHUNK);

const len = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };

// A polyline moved sideways by d pixels (to the right of its direction, y down).
function offset(pts, d) {
  if (!d) return pts.map((p) => [p[0], p[1]]);
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    // at a bend, the corner moves further so the lane keeps its width (capped)
    let k = 1;
    if (i > 0 && i < n - 1) {
      const ux = pts[i][0] - pts[i - 1][0];
      const uy = pts[i][1] - pts[i - 1][1];
      const ul = Math.hypot(ux, uy) || 1;
      const cos = (ux / ul) * dx + (uy / ul) * dy;
      k = Math.min(2, 1 / Math.max(0.5, cos));
    }
    out.push([pts[i][0] - dy * d * k, pts[i][1] + dx * d * k]);
  }
  return out;
}

// The polyline without its first `a` and last `b` pixels (short ones keep their middle).
function trim(pts, a, b) {
  const total = len(pts);
  if (total < a + b + 4) {
    const k = Math.max(0, (total - 4) / Math.max(1, a + b));
    a *= k; b *= k;
  }
  const at = (dist) => {
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (s + l >= dist) { const t = l ? (dist - s) / l : 0; return { i, p: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t] }; }
      s += l;
    }
    return { i: pts.length - 1, p: pts[pts.length - 1] };
  };
  const s = at(a);
  const e = at(total - b);
  const out = [s.p];
  for (let i = s.i; i < e.i; i++) out.push(pts[i]);
  out.push(e.p);
  return out;
}

// Points every `step` pixels along a polyline (for following it smoothly).
function resample(pts, step = 8) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const l = Math.hypot(x1 - x0, y1 - y0);
    let d = step - carry;
    while (d < l) { out.push([x0 + ((x1 - x0) * d) / l, y0 + ((y1 - y0) * d) / l]); d += step; }
    carry = l - (d - step);
  }
  const last = pts[pts.length - 1];
  const prev = out[out.length - 1];
  if (Math.hypot(last[0] - prev[0], last[1] - prev[1]) > 1) out.push(last);
  return out;
}

export function buildGraph(def) {
  const nodes = def.nodes.map(([x, y, o], id) => ({ id, x, y, signal: !!o?.signal, out: [], in: [], edges: [], r: 0, phase: (id * 97) % 400 }));
  const edges = def.edges.map((e, id) => {
    const pts = [[nodes[e.a].x, nodes[e.a].y]];
    const v = e.via || [];
    for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
    pts.push([nodes[e.b].x, nodes[e.b].y]);
    const ed = { id, a: e.a, b: e.b, fwd: e.fwd ?? 1, back: e.back ?? (e.oneway ? 0 : 1), pts, name: e.name || null };
    nodes[e.a].edges.push(ed);
    nodes[e.b].edges.push(ed);
    return ed;
  });
  // how far from a junction's centre its lanes stop: half the widest street through it
  for (const n of nodes) {
    if (n.edges.length < 3) continue;
    n.r = Math.max(...n.edges.map((e) => ((e.fwd + e.back) * LANE) / 2)) + 3;
  }
  const lanes = [];
  for (const e of edges) {
    const cut = (pts, from, to) => trim(pts, nodes[from].r, nodes[to].r);
    for (const [dir, n] of [[1, e.fwd], [-1, e.back]]) {
      const base = dir > 0 ? e.pts : [...e.pts].reverse();
      const from = dir > 0 ? e.a : e.b;
      const to = dir > 0 ? e.b : e.a;
      for (let i = 0; i < n; i++) {
        // two-way: lanes on the right of the centre line; one-way: centred on it
        const d = e.back > 0 && e.fwd > 0 ? (i + 0.5) * LANE : (i - (n - 1) / 2) * LANE;
        const pts = resample(cut(offset(base, d), from, to));
        const lane = { id: lanes.length, edge: e, from, to, idx: i, n, pts, len: len(pts), main: false };
        lanes.push(lane);
        nodes[from].out.push(lane);
        nodes[to].in.push(lane);
      }
    }
    // what the engine draws on the asphalt: the centre line, trimmed like the lanes
    e.mid = cut(e.pts, e.a, e.b);
  }
  // the biggest part that can be driven round and round (Tarjan, iterative)
  const index = new Int32Array(nodes.length).fill(-1);
  const low = new Int32Array(nodes.length);
  const on = new Uint8Array(nodes.length);
  const comp = new Int32Array(nodes.length).fill(-1);
  const stack = [];
  let counter = 0;
  let comps = 0;
  for (const root of nodes) {
    if (index[root.id] >= 0) continue;
    const work = [[root.id, 0]];
    while (work.length) {
      const top = work[work.length - 1];
      const [v, i] = top;
      if (i === 0) { index[v] = low[v] = counter++; stack.push(v); on[v] = 1; }
      const outs = nodes[v].out;
      if (i < outs.length) {
        top[1]++;
        const w = outs[i].to;
        if (index[w] < 0) work.push([w, 0]);
        else if (on[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      if (low[v] === index[v]) {
        let w;
        do { w = stack.pop(); on[w] = 0; comp[w] = comps; } while (w !== v);
        comps++;
      }
      work.pop();
      if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
    }
  }
  const size = new Map();
  for (const c of comp) size.set(c, (size.get(c) || 0) + 1);
  let best = -1;
  let bestN = 0;
  for (const [c, n] of size) if (n > bestN) { bestN = n; best = c; }
  for (const l of lanes) l.main = comp[l.from] === best && comp[l.to] === best;
  // signals: each lane coming in belongs to one of two axes
  for (const n of nodes) {
    if (!n.signal || !n.in.length) continue;
    const ang = (l) => { const p = l.pts; const a = p[Math.max(0, p.length - 2)]; const b = p[p.length - 1]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
    const axis = ang(n.in[0]);
    n.group = new Map();
    for (const l of n.in) {
      const d = Math.abs(((((ang(l) - axis) % Math.PI) + Math.PI) % Math.PI));
      n.group.set(l, d < Math.PI / 4 || d > (3 * Math.PI) / 4 ? 0 : 1);
    }
  }
  // spatial index: where cars may appear, the nodes (for routes) and the edges (to draw)
  const spawns = new Map();
  const nodeAt = new Map();
  const edgeAt = new Map();
  const push = (m, k, v) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
  for (const l of lanes) {
    if (!l.main) continue;
    for (let i = 0; i < l.pts.length - 2; i += 10) push(spawns, ck(l.pts[i][0], l.pts[i][1]), { lane: l, i });
  }
  for (const n of nodes) push(nodeAt, ck(n.x, n.y), n);
  // an edge in every chunk its asphalt touches: sampled along it, its half-width round
  for (const e of edges) {
    const ks = new Set();
    const half = ((e.fwd + e.back) * LANE) / 2 + 4;
    for (let i = 1; i < e.pts.length; i++) {
      const [x0, y0] = e.pts[i - 1];
      const [x1, y1] = e.pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 32));
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const y = y0 + ((y1 - y0) * k) / n;
        for (const [dx, dy] of [[-half, -half], [half, -half], [-half, half], [half, half]]) ks.add(ck(x + dx, y + dy));
      }
    }
    for (const k of ks) push(edgeAt, k, e);
  }
  const crossings = (def.crossings || []).map(([x, y, a, w]) => ({ x, y, a, w }));
  const crossAt = new Map();
  for (const c of crossings) for (const [dx, dy] of [[-c.w, -c.w], [c.w, -c.w], [-c.w, c.w], [c.w, c.w]]) { const k = ck(c.x + dx / 2, c.y + dy / 2); if (!crossAt.get(k)?.includes(c)) push(crossAt, k, c); }
  return { nodes, edges, lanes, spawns, nodeAt, edgeAt, crossAt, surfaces: new Map() };
}

export function inChunks(map, r) {
  const out = [];
  const x0 = Math.floor(r.x / CHUNK);
  const y0 = Math.floor(r.y / CHUNK);
  const x1 = Math.floor((r.x + r.w) / CHUNK);
  const y1 = Math.floor((r.y + r.h) / CHUNK);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (const v of map.get(x * 65536 + y) || []) out.push(v);
  return out;
}

export function nearestNode(g, x, y, onlyMain = true) {
  for (let r = 0; r < 6; r++) {
    const list = inChunks(g.nodeAt, { x: x - r * CHUNK, y: y - r * CHUNK, w: r * 2 * CHUNK, h: r * 2 * CHUNK });
    let best = null;
    let bd = Infinity;
    for (const n of list) {
      if (onlyMain && !n.out.some((l) => l.main)) continue;
      const d = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    if (best) return best;
  }
  return null;
}

// The nearest point of a lane within `r` pixels: where a car knocked off it rejoins.
export function nearestLane(g, x, y, r = 24) {
  let best = null;
  let bd = r * r;
  for (const { lane: l } of inChunks(g.spawns, { x: x - CHUNK / 2, y: y - CHUNK / 2, w: CHUNK, h: CHUNK })) {
    for (let i = 0; i < l.pts.length - 1; i++) {
      const d = (l.pts[i][0] - x) ** 2 + (l.pts[i][1] - y) ** 2;
      if (d < bd) { bd = d; best = { lane: l, i }; }
    }
  }
  return best;
}

export function signalAt(world, node, lane) {
  if (!node.signal || !node.group) return 'green';
  const conf = world.map.signals || {};
  const green = (conf.green ?? 6000) / 16.67;
  const amber = (conf.amber ?? 1200) / 16.67;
  const t = (world.engine.frame + node.phase * 7) % (2 * (green + amber));
  const open = t < green + amber ? 0 : 1;
  if ((node.group.get(lane) ?? 0) !== open) return 'red';
  return t % (green + amber) < green ? 'green' : 'amber';
}

// The way out of a node after arriving by `lane`: any lane leaving it but back the way it
// came (unless there is nothing else), in the driven-round part when there is one.
function nextLane(node, lane) {
  let opts = node.out.filter((l) => l.edge !== lane?.edge);
  if (!opts.length) opts = node.out;
  const main = opts.filter((l) => l.main);
  if (main.length) opts = main;
  if (!opts.length) return null;
  const byEdge = [...new Set(opts.map((l) => l.edge))];
  const e = byEdge[Math.floor(Math.random() * byEdge.length)];
  const same = opts.filter((l) => l.edge === e);
  return same.find((l) => l.idx === Math.min(lane?.idx ?? 0, same.length - 1)) || same[0];
}

// The points of a lane from point i on, the last one marked as its end at the node.
function lanePoints(lane, i = 0) {
  const out = lane.pts.slice(i).map(([x, y]) => ({ x, y }));
  out[out.length - 1].end = lane;
  return out;
}

// A car on lane `lane` at its point `i`.
export function placeOnLane(v, lane, i) {
  const p = lane.pts[i];
  const q = lane.pts[Math.min(lane.pts.length - 1, i + 1)];
  v.cx = p[0];
  v.cy = p[1];
  v.angle = Math.atan2(q[1] - p[1], q[0] - p[0]);
  v.ai.q = lanePoints(lane, i + 1);
  v.ai.lane = lane;
}

// Keeps a few points ahead queued: after a lane's end, an arc across the junction
// (through near its centre) to the start of the next lane.
function extend(g, ai) {
  while (ai.q.length < 6 && ai.lane) {
    const node = g.nodes[ai.lane.to];
    const next = nextLane(node, ai.lane);
    if (!next) { ai.lane = null; return; }
    const e = ai.lane.pts[ai.lane.pts.length - 1];
    const s = next.pts[0];
    // a quadratic curve with the node pulled toward the middle as its control point
    const c = [(node.x * 2 + e[0] + s[0]) / 4, (node.y * 2 + e[1] + s[1]) / 4];
    const d = Math.hypot(s[0] - e[0], s[1] - e[1]);
    const n = Math.max(1, Math.round(d / 8));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const u = 1 - t;
      ai.q.push({ x: u * u * e[0] + 2 * u * t * c[0] + t * t * s[0], y: u * u * e[1] + 2 * u * t * c[1] + t * t * s[1] });
    }
    ai.q.push(...lanePoints(next));
    ai.lane = next;
  }
}

// One frame of a car on the graph: like traffic on tile lanes (traffic.js), it keeps its
// distance, stops at red before the junction and edges through a jam that lasts.
export function graphTick(world, v, g, look) {
  const ai = v.ai;
  const city = world.city;
  if (ai.stunned > 0) {
    ai.stunned--;
    const hit = v.coast();
    if (hit > 1.2) city.crashed(v, hit, null);
    if (ai.stunned === 0) {
      const at = !v.wreck && nearestLane(g, v.cx, v.cy, 20);
      if (at) placeOnLane(v, at.lane, Math.min(at.i, at.lane.pts.length - 2));
      else { v.ai = null; v.driver = null; }
    }
    return;
  }
  if (!ai.q?.length) {
    const at = nearestLane(g, v.cx, v.cy, 20);
    if (!at) { v.ai = null; v.driver = null; return; }
    placeOnLane(v, at.lane, Math.min(at.i, at.lane.pts.length - 2));
  }
  extend(g, ai);
  if (!ai.q.length) { ai.speed = 0; ai.held = (ai.held || 0) + 1; return; }
  let limit = ai.cruise ?? world.map.roads?.speed ?? 1.6;
  // the end of the lane it is on: a red light there stops it at the line
  let dist = Math.hypot(ai.q[0].x - v.cx, ai.q[0].y - v.cy);
  let toEnd = dist;
  for (let i = 0; i < ai.q.length; i++) {
    if (i) toEnd += Math.hypot(ai.q[i].x - ai.q[i - 1].x, ai.q[i].y - ai.q[i - 1].y);
    const p = ai.q[i];
    if (!p.end) continue;
    const node = g.nodes[p.end.to];
    const light = signalAt(world, node, p.end);
    if ((light === 'red' || (light === 'amber' && toEnd > 14)) && toEnd < 60) limit = Math.min(limit, Math.max(0, (toEnd - 4) * 0.08));
    break;
  }
  if (ai.held > 720) { ai.push = 60; ai.held = 0; }
  if (ai.push > 0) ai.push--;
  const ahead = look(v, 26, ai.push > 0);
  if (ahead < 26) limit = Math.min(limit, Math.max(0, (ahead - 9) * 0.1));
  ai.speed = ai.speed ?? 0;
  ai.speed += Math.max(-0.15, Math.min(0.05, limit - ai.speed));
  if (ai.speed < 0.01) ai.speed = 0;
  if (ahead < 16 && ai.speed === 0) {
    ai.held = (ai.held || 0) + (city.blocker && !city.blocker.driver ? 6 : 1);
    if (ai.held % 150 === 90) city.honk(v);
  } else ai.held = 0;
  // along the queued points
  let left = ai.speed;
  while (left > 0 && ai.q.length) {
    const p = ai.q[0];
    const dx = p.x - v.cx;
    const dy = p.y - v.cy;
    const d = Math.hypot(dx, dy);
    if (d <= left) { v.cx = p.x; v.cy = p.y; left -= d; ai.q.shift(); continue; }
    v.cx += (dx / d) * left;
    v.cy += (dy / d) * left;
    left = 0;
  }
  const p = ai.q[0];
  if (p) {
    const want = Math.atan2(p.y - v.cy, p.x - v.cx);
    if (Math.hypot(p.x - v.cx, p.y - v.cy) > 0.5) v.angle = wrapAngle(v.angle + Math.max(-0.12, Math.min(0.12, wrapAngle(want - v.angle))));
  }
  v.vx = Math.cos(v.angle) * ai.speed;
  v.vy = Math.sin(v.angle) * ai.speed;
}

// ---------- the asphalt, drawn from the graph ----------

const rgbaOf = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (255 << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255);
};
const shadeOf = (c, k) => {
  const r = c & 255; const gg = (c >> 8) & 255; const b = (c >> 16) & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (255 << 24) | (f(b) << 16) | (f(gg) << 8) | f(r);
};

// One chunk of streets, painted once and kept: the asphalt of every edge through it as
// strips with round joins (exact to the pixel, no smoothing), then its markings and zebras.
function surfaceChunk(g, kx, ky, conf) {
  const S = CHUNK;
  const ox = kx * S;
  const oy = ky * S;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const cg = c.getContext('2d');
  const img = cg.createImageData(S, S);
  const px = new Uint32Array(img.data.buffer);
  const base = rgbaOf(conf.asphalt || '#4a4a54');
  const tones = [base, shadeOf(base, 1.08), shadeOf(base, 0.93)];
  const asphalt = (x, y) => { const h = ((x + ox) * 73856093) ^ ((y + oy) * 19349663); return tones[(h >>> 4) % 23 === 0 ? 1 : (h >>> 9) % 19 === 0 ? 2 : 0]; };
  const put = (x, y, col) => { if (x >= 0 && y >= 0 && x < S && y < S) px[y * S + x] = typeof col === 'function' ? col(x, y) : col; };
  // a convex polygon, scanline by scanline on pixel centres
  const poly = (pts, col) => {
    let y0 = Infinity; let y1 = -Infinity;
    for (const [, y] of pts) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(S - 1, Math.ceil(y1)); y++) {
      const cy = y + 0.5;
      let a = Infinity; let b = -Infinity;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i]; const [xj, yj] = pts[j];
        if ((yi > cy) === (yj > cy)) continue;
        const x = xi + ((cy - yi) * (xj - xi)) / (yj - yi);
        a = Math.min(a, x); b = Math.max(b, x);
      }
      for (let x = Math.max(0, Math.ceil(a - 0.5)); x <= Math.min(S - 1, Math.floor(b - 0.5)); x++) put(x, y, col);
    }
  };
  const disc = (x0, y0, r, col) => {
    for (let y = Math.max(0, Math.floor(y0 - r)); y <= Math.min(S - 1, Math.ceil(y0 + r)); y++) {
      const dy = y + 0.5 - y0;
      if (dy * dy > r * r) continue;
      const w = Math.sqrt(r * r - dy * dy);
      for (let x = Math.max(0, Math.ceil(x0 - w - 0.5)); x <= Math.min(S - 1, Math.floor(x0 + w - 0.5)); x++) put(x, y, col);
    }
  };
  const line = (pts, col, dash) => {
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const l = Math.hypot(x1 - x0, y1 - y0);
      for (let t = 0; t < l; t += 1, s += 1) {
        if (dash && s % 10 > 5) continue;
        put(Math.round(x0 + ((x1 - x0) * t) / l - ox), Math.round(y0 + ((y1 - y0) * t) / l - oy), col);
      }
    }
  };
  const rect = { x: ox, y: oy, w: S, h: S };
  const list = [...new Set(inChunks(g.edgeAt, rect))];
  for (const e of list) {
    const r = ((e.fwd + e.back) * LANE) / 2 + 2;
    const pts = e.pts.map(([x, y]) => [x - ox, y - oy]);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const l = Math.hypot(x1 - x0, y1 - y0) || 1;
      const nx = (-(y1 - y0) / l) * r;
      const ny = ((x1 - x0) / l) * r;
      poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], asphalt);
    }
    for (const [x, y] of pts) disc(x, y, r, asphalt);
  }
  const yellow = rgbaOf(conf.line || '#d8b040');
  const white = rgbaOf(conf.dash || '#e8e8e8');
  for (const e of list) {
    if (e.fwd && e.back) line(e.mid, yellow, false);
    for (const [dir, n] of [[1, e.fwd], [-1, e.back]]) {
      if (n < 2) continue;
      const b = dir > 0 ? e.mid : [...e.mid].reverse();
      for (let i = 1; i < n; i++) line(offset(b, e.back > 0 && e.fwd > 0 ? i * LANE : (i - n / 2) * LANE), white, true);
    }
  }
  // zebras: white bars along the street, side by side across it
  for (const z of [...new Set(inChunks(g.crossAt, rect))]) {
    const ax = Math.cos(z.a); const ay = Math.sin(z.a);
    const bx = -ay; const by = ax;
    for (let k = -z.w / 2 + 2; k < z.w / 2 - 1; k += 4) {
      const cx0 = z.x - ox + bx * k;
      const cy0 = z.y - oy + by * k;
      poly([[cx0 - ax * 5, cy0 - ay * 5], [cx0 + ax * 5, cy0 + ay * 5], [cx0 + ax * 5 + bx * 2, cy0 + ay * 5 + by * 2], [cx0 - ax * 5 + bx * 2, cy0 - ay * 5 + by * 2]], white);
    }
  }
  cg.putImageData(img, 0, 0);
  return c;
}

// The streets' surface round the camera, from the chunks kept (the oldest dropped past 64).
export function drawSurface(world, g, ctx, cx, cy, conf) {
  const x0 = Math.floor(cx / CHUNK);
  const y0 = Math.floor(cy / CHUNK);
  const x1 = Math.floor((cx + SCREEN_W) / CHUNK);
  const y1 = Math.floor((cy + SCREEN_H) / CHUNK);
  for (let ky = y0; ky <= y1; ky++) for (let kx = x0; kx <= x1; kx++) {
    const k = kx * 65536 + ky;
    let c = g.surfaces.get(k);
    if (!c) {
      c = surfaceChunk(g, kx, ky, conf);
      g.surfaces.set(k, c);
      if (g.surfaces.size > 64) g.surfaces.delete(g.surfaces.keys().next().value);
    }
    ctx.drawImage(c, kx * CHUNK - cx, ky * CHUNK - cy);
  }
}

// The asphalt's markings, drawn from the graph: a line down the middle of two-way streets,
// dashes between lanes going the same way, and the lights at the stop lines. With
// `roads.surface` the asphalt itself too (and its markings in it).
export function drawGraph(world, g, ctx, cx, cy, e) {
  const view = { x: cx - 32, y: cy - 32, w: SCREEN_W + 64, h: SCREEN_H + 64 };
  const surface = world.map.roads?.surface;
  if (surface) drawSurface(world, g, ctx, Math.round(cx), Math.round(cy), surface === true ? {} : surface);
  const seen = new Set();
  const plot = (pts, color, dash) => {
    ctx.fillStyle = color;
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const l = Math.hypot(x1 - x0, y1 - y0);
      for (let t = 0; t < l; t += 1, s += 1) {
        if (dash && s % 10 > 5) continue;
        ctx.fillRect(Math.round(x0 + ((x1 - x0) * t) / l - cx), Math.round(y0 + ((y1 - y0) * t) / l - cy), 1, 1);
      }
    }
  };
  for (const ed of surface ? [] : inChunks(g.edgeAt, view)) {
    if (seen.has(ed)) continue;
    seen.add(ed);
    if (ed.fwd && ed.back) plot(ed.mid, '#d8b040', false);
    for (const [dir, n] of [[1, ed.fwd], [-1, ed.back]]) {
      if (n < 2) continue;
      const base = dir > 0 ? ed.mid : [...ed.mid].reverse();
      for (let i = 1; i < n; i++) {
        const d = ed.back > 0 && ed.fwd > 0 ? i * LANE : (i - n / 2) * LANE;
        plot(offset(base, d), 'rgba(232,232,232,0.8)', true);
      }
    }
  }
  if (!world.map.signals) return;
  const col = { red: '#e83030', amber: '#f0b020', green: '#40d060' };
  for (const n of inChunks(g.nodeAt, view)) {
    if (!n.signal || !n.group) continue;
    for (const l of n.in) {
      const p = l.pts[l.pts.length - 1];
      ctx.fillStyle = '#1c1830';
      ctx.fillRect(Math.round(p[0] - cx - 2), Math.round(p[1] - cy - 2), 4, 4);
      ctx.fillStyle = col[signalAt(world, n, l)];
      ctx.fillRect(Math.round(p[0] - cx - 1), Math.round(p[1] - cy - 1), 2, 2);
    }
  }
}

// The way by road between two points (Dijkstra over the lanes): the streets' lines.
export function graphRoute(g, from, to) {
  const a = nearestNode(g, from.x, from.y);
  const b = nearestNode(g, to.x, to.y);
  if (!a || !b) return null;
  const dist = new Float64Array(g.nodes.length).fill(Infinity);
  const via = new Array(g.nodes.length).fill(null);
  dist[a.id] = 0;
  // a binary heap of [dist, node]
  const heap = [[0, a.id]];
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    if (u === b.id) break;
    for (const l of g.nodes[u].out) {
      const nd = d + l.len + 1;
      if (nd < dist[l.to]) { dist[l.to] = nd; via[l.to] = l; push([nd, l.to]); }
    }
  }
  if (!via[b.id] && a !== b) return null;
  const segs = [];
  for (let n = b.id; via[n] && segs.length < 5000; n = via[n].from) segs.push(via[n].edge.pts);
  return segs;
}

export { CHUNK };
void TILE;

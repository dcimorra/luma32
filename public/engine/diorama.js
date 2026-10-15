// The world as a diorama, for the modern look (engine/hd.js): the same map, the same
// tiles and the same people, built in three dimensions from what the map already says.
//
// The ground lies flat. A wall is told apart from the ground by what the 3/4 art already
// does: a solid cell with walkable ground right below it is a wall's face, drawn as seen
// from the front, and the solid cells above it are the wall's top, seen from above. So a
// run of solid cells down a column becomes a block: its face stood up at its south edge,
// as tall as its face rows, and its top laid over it. A solid run with no face (the side
// walls of a room) takes the height most walls have; one with walkable ground to its north
// (the wall nearest the camera) is cut down low, as a set is cut away so a scene can be
// seen. Heights (README "Heights") rise as they are. Props and people stand up as cards.
//
// Every face samples one picture: the map drawn flat with its neighbours (`picture`), so a
// wall's face is its own face tile and its top its own top tile. Coordinates are the
// current map's, neighbours included (they sit at their offsets, as the world has them).
import { TILE } from './gfx.js';

const LOW = 4;        // a wall between the camera and the floor, cut down to this
const LIE = 8;        // how tall a prop lying down stands (a bed)
const MAX_FACE = 6;   // rows of face at most: past that it is a façade drawn flat

const RISE = 8;       // how much a flight of stairs climbs per cell
const TREADS = 4;     // steps per cell

// Which way a flight of stairs climbs: 'north' (as 3/4 art draws one going up), 'east'
// or 'west' (a flight seen from the side), or null. A tile's own `stairs` says it
// ('up' or true for north, 'east', 'west', false for flat); else its id: stairs and not
// down climb north (a flight's _l / _r tiles are its edges, not a flight to the side).
export function stairsOf(id, d) {
  if (!d || d.solid) return null;
  if (d.stairs !== undefined) return d.stairs === true || d.stairs === 'up' ? 'north' : d.stairs === 'east' || d.stairs === 'west' ? d.stairs : null;
  if (!/stair|escal/i.test(id) || /down|_dn|baj|foot|sign|door/i.test(id)) return null;
  return 'north';
}

const isWall = (d) => !!d && !!d.solid && !d.low && !d.medium && !d.reflect && !d.flat && !d.top;

// The cells the diorama covers, in tiles: the map and every neighbour across its edges,
// and a map's `skirt` (cells) all round: past its edges the ground goes on, each cell
// its nearest edge cell's tile, so a low camera sees land and sea, not the cut.
export function regionOf(world) {
  const r = { x0: 0, y0: 0, x1: world.w, y1: world.h };
  for (const n of world.neighbours || []) {
    r.x0 = Math.min(r.x0, n.ox);
    r.y0 = Math.min(r.y0, n.oy);
    r.x1 = Math.max(r.x1, n.ox + n.w);
    r.y1 = Math.max(r.y1, n.oy + n.h);
  }
  const k = Math.max(0, Math.min(24, world.map.skirt | 0));
  r.skirt = k;
  r.x0 -= k; r.y0 -= k; r.x1 += k; r.y1 += k;
  r.w = r.x1 - r.x0;
  r.h = r.y1 - r.y0;
  return r;
}

// The cell whose tile a cell of the region shows: itself, or, in the skirt, the nearest
// cell of the map.
function source(world, R, x, y) {
  if (!R.skirt || world.tileAt(x, y)) return [x, y];
  if (world.neighbourAt(x, y)) return [x, y];
  return [Math.max(0, Math.min(world.w - 1, x)), Math.max(0, Math.min(world.h - 1, y))];
}
export const tileOf = (world, R, x, y) => { const [sx, sy] = source(world, R, x, y); return world.tileAt(sx, sy); };

// The ground's fingerprint: rebuild when a tile changes (a door opens) or the map does.
export function groundKey(world, R) {
  let h = 0;
  const ids = (world.dioramaIds ||= new Map());
  for (let y = R.y0; y < R.y1; y++) {
    for (let x = R.x0; x < R.x1; x++) {
      const t = tileOf(world, R, x, y);
      let k = ids.get(t);
      if (k === undefined) { k = ids.size + 1; ids.set(t, k); }
      h = (Math.imul(h, 31) + k) | 0;
      if (world.raised) h = (Math.imul(h, 7) + world.heightAt(x, y)) | 0;
    }
  }
  return `${world.mapId}:${R.x0},${R.y0},${R.w}x${R.h}:${h}`;
}

// The region drawn flat: ground tiles, then the props that lie on it (rugs, puddles).
export function picture(world, R, frame, make) {
  const c = make(R.w * TILE, R.h * TILE);
  const ctx = c.getContext('2d');
  for (let y = R.y0; y < R.y1; y++) {
    for (let x = R.x0; x < R.x1; x++) {
      const [sx, sy] = source(world, R, x, y);
      const id = world.tileAt(sx, sy);
      if (!id) continue;
      const d = world.game.tiles[id];
      ctx.drawImage(world.tiles.image(id, frame, d.auto ? world.edgeMask(sx, sy, d.auto === true ? id : d.auto) : 0), (x - R.x0) * TILE, (y - R.y0) * TILE);
    }
  }
  for (const [list, ox, oy] of [[world.props, 0, 0], ...(world.neighbours || []).map((n) => [n.props, n.ox, n.oy])]) {
    for (const p of list) {
      if (p.hidden || !p.def.flat) continue;
      const img = world.tiles.image(p.t, frame + (p.phase || 0));
      ctx.drawImage(img, (p.x + ox - R.x0) * TILE, (p.y + oy + 1 - R.y0) * TILE - img.height);
    }
  }
  return c;
}

// The static geometry: interleaved x y z u v nx ny nz, in map pixels (x east, y up, z
// south), u v in the region's picture.
export function buildStatic(world, R) {
  const PW = R.w * TILE;
  const PH = R.h * TILE;
  const OX = R.x0 * TILE;
  const OY = R.y0 * TILE;
  const out = [];
  const inR = (x, y) => x >= R.x0 && y >= R.y0 && x < R.x1 && y < R.y1;
  const id = (x, y) => (inR(x, y) ? tileOf(world, R, x, y) : null);
  const def = (x, y) => { const i = id(x, y); return i ? world.game.tiles[i] : null; };
  const wall = (x, y) => isWall(def(x, y));
  const elev = (x, y) => (world.raised ? world.elev(x, y) : 0);

  const quad = (a, b, c, d, ua, ub, uc, ud, n) => {
    for (const [p, u] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]) out.push(p[0], p[1], p[2], (u[0] - OX) / PW, (u[1] - OY) / PH, n[0], n[1], n[2]);
  };
  // texture corners of a cell, in picture pixels (inset a hair: nearest sampling at an
  // exact edge may pick the neighbour)
  const E = 0.02;
  const cellUv = (x, y) => [[x * TILE + E, y * TILE + E], [(x + 1) * TILE - E, y * TILE + E], [(x + 1) * TILE - E, (y + 1) * TILE - E], [x * TILE + E, (y + 1) * TILE - E]];

  // which tiles are faces: those seen with walkable ground below them somewhere
  const faces = new Set();
  for (let y = R.y0; y < R.y1 - 1; y++) for (let x = R.x0; x < R.x1; x++) if (wall(x, y) && id(x, y + 1) && !wall(x, y + 1)) faces.add(id(x, y));

  const runs = [];
  for (let x = R.x0; x < R.x1; x++) {
    let y = R.y0;
    while (y < R.y1) {
      if (!wall(x, y)) { y++; continue; }
      const r0 = y;
      while (y < R.y1 && wall(x, y)) y++;
      runs.push({ x, r0, r1: y - 1 });
    }
  }
  // which tiles are tops: those seen at the top of a wall, or along a side wall (a run
  // that does not end on walkable ground). A face rises from the bottom of a run up to
  // the first top tile: one row for a wall, every storey for a façade under its roof.
  const tops = new Set();
  const front = (x, r1) => !!id(x, r1 + 1) && faces.has(id(x, r1));
  for (const r of runs) {
    tops.add(id(r.x, r.r0));
    if (!front(r.x, r.r1)) for (let y = r.r0; y <= r.r1; y++) tops.add(id(r.x, y));
  }
  const tally = new Map();
  for (const r of runs) {
    const { x, r0, r1 } = r;
    let F = 0;
    if (front(x, r1)) {
      F = 1;
      while (F < r1 - r0 + 1 && F < MAX_FACE && !tops.has(id(x, r1 - F))) F++;
      // the end of a side wall over a doorway, with no wall face beside it: one row
      const beside = (nx) => wall(nx, r1) && id(nx, r1 + 1) && !wall(nx, r1 + 1);
      if (F > 1 && !beside(x - 1) && !beside(x + 1)) F = 1;
    }
    r.F = F;
    if (F) tally.set(F, (tally.get(F) || 0) + 1);
  }
  const usualF = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] || 1;
  const height = new Float32Array(R.w * R.h);
  for (const r of runs) {
    const north = id(r.x, r.r0 - 1) && !wall(r.x, r.r0 - 1);
    r.H = r.F ? r.F * TILE : north ? LOW : usualF * TILE;
    for (let y = r.r0; y <= r.r1; y++) height[(y - R.y0) * R.w + r.x - R.x0] = r.H;
  }
  const hAt = (x, y) => (inR(x, y) ? height[(y - R.y0) * R.w + x - R.x0] : 0);

  for (const r of runs) {
    const { x, r0, r1, F, H } = r;
    const x0 = x * TILE;
    const x1 = x0 + TILE;
    const topped = r1 - F >= r0;
    // the face's rows in the picture (or the bottom row of the run, carried, if none)
    const fv0 = F ? (r1 - F + 1) * TILE + E : (r1 + 1) * TILE - 0.5;
    const fv1 = F ? (r1 + 1) * TILE - E : (r1 + 1) * TILE - 0.5;
    for (let y = r0; y <= r1; y++) {
      const z0 = y * TILE;
      const z1 = z0 + TILE;
      // the top: the run's top tiles, pushed back over the face rows they stood above
      const s = topped ? Math.min(r1 - F, Math.max(r0, y - F)) : r0;
      const uv = topped ? cellUv(x, s) : (() => { const v = r0 * TILE + 0.5; return [[x0 + E, v], [x1 - E, v], [x1 - E, v], [x0 + E, v]]; })();
      quad([x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1], uv[0], uv[1], uv[2], uv[3], [0, 1, 0]);
      // the sides, where the neighbour is lower: the face's edge column, carried along
      for (const dx of [-1, 1]) {
        const hn = hAt(x + dx, y);
        if (hn >= H) continue;
        const ex = dx < 0 ? x0 : x1;
        const u = dx < 0 ? x0 + 0.5 : x1 - 0.5;
        const va = fv0;
        const vb = fv0 + (fv1 - fv0) * (1 - hn / H);
        const a = dx < 0 ? [ex, H, z0] : [ex, H, z1];
        const b = dx < 0 ? [ex, H, z1] : [ex, H, z0];
        const c = dx < 0 ? [ex, hn, z1] : [ex, hn, z0];
        const d = dx < 0 ? [ex, hn, z0] : [ex, hn, z1];
        quad(a, b, c, d, [u, va], [u, va], [u, vb], [u, vb], [dx, 0, 0]);
      }
    }
    // the face, stood up at the run's south edge
    const z = (r1 + 1) * TILE;
    const hs = hAt(x, r1 + 1);
    if (hs < H) quad([x0, H, z], [x1, H, z], [x1, hs, z], [x0, hs, z], [x0 + E, fv0], [x1 - E, fv0], [x1 - E, fv1], [x0 + E, fv1], [0, 0, 1]);
  }

  // stairs: each run of stair cells along the way it climbs is a flight of steps, its
  // treads and risers the tile's own pixels; whoever stands on it climbs it (stairLift)
  const way = (x, y) => stairsOf(id(x, y), def(x, y));
  const flights = new Map();
  const depth = TILE / TREADS;
  const side = (x, y) => !way(x, y) && !wall(x, y);
  for (let x = R.x0; x < R.x1; x++) {
    let y = R.y0;
    while (y < R.y1) {
      if (way(x, y) !== 'north') { y++; continue; }
      const r0 = y;
      while (y < R.y1 && way(x, y) === 'north') y++;
      const r1 = y - 1;
      const n = r1 - r0 + 1;
      for (let k = r0; k <= r1; k++) flights.set(`${x},${k}`, { dir: 'north', lo: (r1 + 1) * TILE, top: n * RISE });
      const x0 = x * TILE;
      const x1 = x0 + TILE;
      for (let i = 0; i < n * TREADS; i++) {
        // step i from the bottom: its tread at height (i + 1) * rise, its riser in front
        const zb = (r1 + 1) * TILE - i * depth;
        const zt = zb - depth;
        const yb = (i * RISE) / TREADS;
        const yt = ((i + 1) * RISE) / TREADS;
        const v0 = zt + E;
        const v1 = zb - E;
        quad([x0, yt, zt], [x1, yt, zt], [x1, yt, zb], [x0, yt, zb], [x0 + E, v0], [x1 - E, v0], [x1 - E, v1], [x0 + E, v1], [0, 1, 0]);
        quad([x0, yt, zb], [x1, yt, zb], [x1, yb, zb], [x0, yb, zb], [x0 + E, v1 - 0.5], [x1 - E, v1 - 0.5], [x1 - E, v1 - 0.5], [x0 + E, v1 - 0.5], [0, 0, 1]);
        const cy = Math.floor((zt + 0.1) / TILE);
        for (const dx of [-1, 1]) {
          if (!side(x + dx, cy)) continue;
          const ex = dx < 0 ? x0 : x1;
          const u = dx < 0 ? x0 + 0.5 : x1 - 0.5;
          quad([ex, yt, zt], [ex, yt, zb], [ex, 0, zb], [ex, 0, zt], [u, v0], [u, v1], [u, v1], [u, v0], [dx, 0, 0]);
        }
      }
    }
  }
  // flights seen from the side: each row's run climbs east or west
  for (let y = R.y0; y < R.y1; y++) {
    let x = R.x0;
    while (x < R.x1) {
      const d = way(x, y);
      if (d !== 'east' && d !== 'west') { x++; continue; }
      const c0 = x;
      while (x < R.x1 && way(x, y) === d) x++;
      const c1 = x - 1;
      const n = c1 - c0 + 1;
      const lo = d === 'east' ? c0 * TILE : (c1 + 1) * TILE;
      for (let k = c0; k <= c1; k++) flights.set(`${k},${y}`, { dir: d, lo, top: n * RISE });
      const z0 = y * TILE;
      const z1 = z0 + TILE;
      const s = d === 'east' ? 1 : -1;
      for (let i = 0; i < n * TREADS; i++) {
        // step i from the low end: xa its riser's edge, xb its far edge
        const xa = lo + s * i * depth;
        const xb = xa + s * depth;
        const yb = (i * RISE) / TREADS;
        const yt = ((i + 1) * RISE) / TREADS;
        const [l, rr] = xa < xb ? [xa, xb] : [xb, xa];
        quad([l, yt, z0], [rr, yt, z0], [rr, yt, z1], [l, yt, z1], [l + E, z0 + E], [rr - E, z0 + E], [rr - E, z1 - E], [l + E, z1 - E], [0, 1, 0]);
        const u = xa + s * 0.5;
        quad([xa, yt, z1], [xa, yt, z0], [xa, yb, z0], [xa, yb, z1], [u, z1 - E], [u, z0 + E], [u, z0 + E], [u, z1 - E], [-s, 0, 0]);
        const cx = Math.floor((Math.min(xa, xb) + 0.1) / TILE);
        if (side(cx, y + 1)) quad([l, yt, z1], [rr, yt, z1], [rr, 0, z1], [l, 0, z1], [l + E, z1 - 0.5], [rr - E, z1 - 0.5], [rr - E, z1 - 0.5], [l + E, z1 - 0.5], [0, 0, 1]);
      }
    }
  }
  world.dioramaStairs = flights;

  // the ground, and the faces of raised ground (README "Heights")
  for (let y = R.y0; y < R.y1; y++) {
    for (let x = R.x0; x < R.x1; x++) {
      if (!id(x, y) || wall(x, y) || flights.has(`${x},${y}`)) continue;
      const e = elev(x, y);
      const x0 = x * TILE;
      const x1 = x0 + TILE;
      const z0 = y * TILE;
      const z1 = z0 + TILE;
      const uv = cellUv(x, y);
      quad([x0, e, z0], [x1, e, z0], [x1, e, z1], [x0, e, z1], uv[0], uv[1], uv[2], uv[3], [0, 1, 0]);
      if (!e) continue;
      const v = (y + 1) * TILE - 0.5;
      const es = id(x, y + 1) ? elev(x, y + 1) : 0;
      if (es < e) quad([x0, e, z1], [x1, e, z1], [x1, es, z1], [x0, es, z1], [x0 + E, v], [x1 - E, v], [x1 - E, v], [x0 + E, v], [0, 0, 1]);
      for (const dx of [-1, 1]) {
        const en = id(x + dx, y) ? elev(x + dx, y) : 0;
        if (en >= e || wall(x + dx, y)) continue;
        const ex = dx < 0 ? x0 : x1;
        const u = dx < 0 ? x0 + 0.5 : x1 - 0.5;
        quad([ex, e, z0], [ex, e, z1], [ex, en, z1], [ex, en, z0], [u, z0 + E], [u, z1 - E], [u, z1 - E], [u, z0 + E], [dx, 0, 0]);
      }
    }
  }
  return new Float32Array(out);
}

// What stands up this frame: props, the tops of tiles (a tree's crown, tall grass), people
// and the entities that are people too (passers-by), as cards facing the camera.
// { img, x (left), z (where it stands), y (how far up), w, h, lie?, body? }
export function gatherCards(world, frame, R) {
  const out = [];
  const animF = Math.floor(frame / (world.map.animRate || 20));
  const elev = (x, y) => (world.raised ? world.elev(x, y) : 0);
  const props = (list, ox, oy) => {
    for (const p of list) {
      if (p.hidden || p.def.flat) continue;
      const img = world.tiles.image(p.t, animF + (p.phase || 0));
      if (!img) continue;
      const x = (p.x + ox) * TILE;
      const z = (p.y + oy + 1) * TILE;
      const y = elev(p.x + ox, p.y + oy);
      // drawn from above (its whole picture is the ground it stands on: a bed, a table
      // seen from the top): it lies down, a low block with its picture on top
      const [, fh = 1, , dy = 0] = p.foot || [];
      if (p.h >= 2 && fh >= p.h && !dy) out.push({ img, lie: LIE, x, z, y, w: img.width, h: img.height });
      // standing (a carriage, a tree, a shelf): a body as deep as the ground it takes, to
      // a point; the centre a little behind the cell's edge so its front stays in it
      else {
        const depth = Math.max(6, Math.min(16, fh * TILE * 0.75));
        out.push({ img, x, z: z - depth / 2 - 0.5, y, w: img.width, h: img.height, body: true, depth });
      }
    }
  };
  props(world.props, 0, 0);
  for (const n of world.neighbours || []) props(n.props, n.ox, n.oy);
  // a tile's top layer stands at its cell's south edge: it hides the one in the cell, not
  // the head of whoever is in front
  if (world.hasTops ??= Object.values(world.game.tiles).some((d) => d.top)) {
    for (let y = R.y0; y < R.y1; y++) {
      for (let x = R.x0; x < R.x1; x++) {
        const id = world.tileAt(x, y);
        if (!id || !world.game.tiles[id].top) continue;
        const img = world.tiles.top(id, animF);
        out.push({ img, x: x * TILE, z: (y + 1) * TILE - 4.5, y: elev(x, y), w: img.width, h: img.height, body: true, depth: 8 });
      }
    }
  }
  const body = (a, x, y, ez = 0) => {
    const img = a.image();
    if (!img) return;
    out.push({ img, x: x + (TILE - img.width) / 2, z: y + 11, y: ez + stairLift(world, x + 8, y + 12), w: img.width, h: img.height, body: true });
  };
  for (const a of world.actors) {
    if (!a.visible || (a.alpha ?? 1) <= 0) continue;
    body(a, Math.round(a.px) + (a.ox || 0), Math.round(a.py) + (a.oy || 0), world.raised ? a.ez : 0);
  }
  for (const n of world.neighbours || []) for (const a of n.actors) body(a, (a.x + n.ox) * TILE, (a.y + n.oy) * TILE);
  return out;
}

// How high the stairs under a point of the map (map pixels) lift whoever stands there.
export function stairLift(world, px, pz) {
  const f = world.dioramaStairs?.get(`${Math.floor(px / TILE)},${Math.floor(pz / TILE)}`);
  if (!f) return 0;
  const along = f.dir === 'north' ? f.lo - pz : f.dir === 'east' ? px - f.lo : f.lo - px;
  return Math.max(0, Math.min(f.top, (along / TILE) * RISE));
}

// A person (or an animal) with a body, not a card: every pixel of the sprite a little
// block, thickest in the middle of the figure and thin at its outline (its distance to
// the edge), so the front and the back have relief, the sun shapes them, and the top of
// a head or a shoulder shows from the camera. Local coordinates: x 0..width, y up from
// the feet, z centred on the card's plane; u v at the centre of the pixel each face is.
export function bodyMesh(img, DEPTH = 8) {
  const w = img.width;
  const h = img.height;
  const data = img.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] >= 128;
  // distance to the outline, in pixels (1 at the edge)
  const dist = new Int16Array(w * h);
  let queue = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!solid(x, y)) continue;
    if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)) { dist[y * w + x] = 1; queue.push([x, y]); }
  }
  while (queue.length) {
    const next = [];
    for (const [x, y] of queue) {
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (!solid(nx, ny) || dist[ny * w + nx]) continue;
        dist[ny * w + nx] = dist[y * w + x] + 1;
        next.push([nx, ny]);
      }
    }
    queue = next;
  }
  // half the thickness of each pixel: a rounded profile, not a slab
  const half = (x, y) => (solid(x, y) ? Math.min(DEPTH, 1.5 + Math.sqrt(dist[y * w + x] - 1) * 2.6 * (DEPTH / 8)) / 2 : 0);
  const out = [];
  const quad = (a, b, c, d, u, v, n) => {
    for (const p of [a, b, c, a, c, d]) out.push(p[0], p[1], p[2], u, v, n[0], n[1], n[2]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = half(x, y);
      if (!d) continue;
      const u = (x + 0.5) / w;
      const v = (y + 0.5) / h;
      const y0 = h - 1 - y;
      const y1 = h - y;
      // front and back
      quad([x, y1, d], [x + 1, y1, d], [x + 1, y0, d], [x, y0, d], u, v, [0, 0, 1]);
      quad([x + 1, y1, -d], [x, y1, -d], [x, y0, -d], [x + 1, y0, -d], u, v, [0, 0, -1]);
      // the steps to thinner neighbours, both sides of the card
      const up = half(x, y - 1);
      if (up < d) {
        quad([x, y1, -d], [x + 1, y1, -d], [x + 1, y1, -up], [x, y1, -up], u, v, [0, 1, 0]);
        quad([x, y1, up], [x + 1, y1, up], [x + 1, y1, d], [x, y1, d], u, v, [0, 1, 0]);
      }
      const down = half(x, y + 1);
      if (down < d) {
        quad([x, y0, d], [x + 1, y0, d], [x + 1, y0, down], [x, y0, down], u, v, [0, -1, 0]);
        quad([x, y0, -down], [x + 1, y0, -down], [x + 1, y0, -d], [x, y0, -d], u, v, [0, -1, 0]);
      }
      for (const dx of [-1, 1]) {
        const s = half(x + dx, y);
        if (s >= d) continue;
        const ex = dx < 0 ? x : x + 1;
        quad([ex, y1, s], [ex, y1, d], [ex, y0, d], [ex, y0, s], u, v, [dx, 0, 0]);
        quad([ex, y1, -d], [ex, y1, -s], [ex, y0, -s], [ex, y0, -d], u, v, [dx, 0, 0]);
      }
    }
  }
  return new Float32Array(out);
}

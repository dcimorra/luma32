// The minimap and the map screen (README "Minimap"). Drawn from the map itself: each
// tile's colour (its `mapColor`, or the average of its picture), solid props darker. On
// it: the player (an arrow), the objective (clamped to the edge when far), the route there
// by road while driving, police, mission markers and the cartridge's own blips.
//
//   game or map: minimap: true | { r: 26, corner: 'tr' | 'tl' | 'br' | 'bl', scale: 1 }
//   api.blip('shop', { at: [x, y] | 'ana' | entity, color: '#40c0ff' }); api.blip('shop', null)
import { SCREEN_W, SCREEN_H, TILE, canvas } from './gfx.js';
import { guidePoint } from './guide.js';
import { getTheme } from './ui.js';
import { drawText } from './font.js';
import { t } from './i18n.js';
import { sfx } from './audio.js';
import { missionMarks } from './mission.js';
import { graphRoute } from './roadgraph.js';

const colours = new WeakMap();   // game → (tile id → colour)

function tileColour(world, id) {
  let map = colours.get(world.game);
  if (!map) colours.set(world.game, (map = new Map()));
  if (map.has(id)) return map.get(id);
  const d = world.game.tiles[id] || {};
  let c = d.mapColor;
  if (!c) {
    const img = world.tiles.image(id, 0, 0);
    const data = img.getContext('2d').getImageData(0, 0, img.width, img.height).data;
    let r = 0; let g = 0; let b = 0; let n = 0;
    for (let i = 0; i < data.length; i += 4) { if (data[i + 3] < 128) continue; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    c = n ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` : '#000000';
  }
  map.set(id, c);
  return c;
}

// The whole map, one pixel a cell. Painted again when a tile or a prop changes.
export function mapPicture(world) {
  const key = `${world.mapId}|${world.mapEdits || 0}`;
  if (world.mapPic?.key === key) return world.mapPic.c;
  const c = canvas(world.w, world.h);
  const g = c.getContext('2d');
  // pixel by pixel into one buffer: a city is a million cells
  const img = g.createImageData(world.w, world.h);
  const px = new Uint32Array(img.data.buffer);
  const rgba = new Map();
  const probe = canvas(1, 1).getContext('2d', { willReadFrequently: true });
  const colourOf = (id) => {
    let v = rgba.get(id);
    if (v !== undefined) return v;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = tileColour(world, id);
    probe.fillRect(0, 0, 1, 1);
    const [r, gg, b] = probe.getImageData(0, 0, 1, 1).data;
    v = (255 << 24) | (b << 16) | (gg << 8) | r;
    rgba.set(id, v);
    return v;
  };
  for (let y = 0; y < world.h; y++) {
    const row = world.ground[y];
    for (let x = 0; x < world.w; x++) {
      const id = row[x];
      if (id) px[y * world.w + x] = colourOf(id);
    }
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (const p of world.props) {
    if (p.hidden || p.def.solid === false || p.def.flat) continue;
    const [fw, fh] = p.foot || [1, 1];
    g.fillRect(p.x, p.y - fh + 1, fw || 1, fh || 1);
  }
  world.mapPic = { key, c };
  return c;
}

// The way by road from the player's cell to the goal's, while driving: breadth first
// over lane cells (any open cell when the map has no lanes), kept half a second.
function route(world, goal) {
  const v = world.driving;
  const roads = world.city.roads;
  if (!v || !goal) return null;
  const sx = Math.floor(v.cx / TILE);
  const sy = Math.floor(v.cy / TILE);
  const key = `${world.mapId}|${sx},${sy}|${goal.x},${goal.y}`;
  if (world.routeCache?.key === key || (world.routeCache && world.engine.frame - world.routeCache.at < 30 && world.routeCache.goal === `${goal.x},${goal.y}`)) return world.routeCache.path;
  const { w, h } = world;
  const ok = (x, y) => x >= 0 && y >= 0 && x < w && y < h && (roads?.lanes.length ? roads.lane.has(y * w + x) : !world.solidAt(x, y));
  const prev = new Map([[sy * w + sx, -1]]);
  const q = [[sx, sy]];
  let end = null;
  let bestD = Infinity;
  while (q.length && prev.size < 6000) {
    const [x, y] = q.shift();
    const d = Math.abs(x - goal.x) + Math.abs(y - goal.y);
    if (d < bestD) { bestD = d; end = [x, y]; }
    if (d === 0) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const k = ny * w + nx;
      if (prev.has(k) || !ok(nx, ny)) continue;
      prev.set(k, y * w + x);
      q.push([nx, ny]);
    }
  }
  const path = [];
  if (end) {
    let k = end[1] * w + end[0];
    while (k !== -1 && path.length < 2000) { path.push([k % w, Math.floor(k / w)]); k = prev.get(k); }
  }
  world.routeCache = { key, at: world.engine.frame, goal: `${goal.x},${goal.y}`, path };
  return path;
}

// Everything that shows as a dot: [x, y] in cells (fractional), colour, and whether it
// stays on the edge when out of range.
function dots(world, e) {
  const out = [];
  for (const en of world.entities) {
    if (en.removed) continue;
    if (en.kind === 'vehicle' && en.siren && Math.floor(e.frame / 8) % 2) out.push({ x: en.cx / TILE, y: en.cy / TILE, color: Math.floor(e.frame / 16) % 2 ? '#ff4040' : '#4060ff' });
    else if (en.blip) out.push({ x: (en.cx ?? en.x + (en.w ?? 16) / 2) / TILE, y: (en.cy ?? en.y + (en.h ?? 16) / 2) / TILE, color: en.blip, edge: true });
  }
  for (const [, b] of world.city.blips) {
    const at = b.at;
    let p = null;
    if (Array.isArray(at)) p = { x: at[0] + 0.5, y: at[1] + 0.5 };
    else if (typeof at === 'string') { const a = world.actor(at); if (a) p = { x: a.px / TILE + 0.5, y: a.py / TILE + 0.5 }; }
    else if (at && !at.removed) p = { x: (at.cx ?? at.x + 8) / TILE, y: (at.cy ?? at.y + 8) / TILE };
    if (p) out.push({ ...p, color: b.color || '#40c0ff', edge: b.edge !== false });
  }
  for (const m of missionMarks(world)) out.push({ x: m.x + 0.5, y: m.y + 0.5, color: m.color, edge: true, big: true });
  const g = guidePoint(world);
  if (g && world.save.objective) out.push({ x: g.x + (g.w || 1) / 2, y: g.y + (g.h || 1) / 2, color: getTheme().accent || '#f0c030', edge: true, big: true, goal: g });
  return out;
}

// The way by the street graph to the goal, kept half a second.
function graphPath(world, goal) {
  const v = world.driving;
  const c = world.routeCache;
  const key = `${goal.x | 0},${goal.y | 0}`;
  if (c?.graph && c.goal === key && world.engine.frame - c.at < 30) return c.segs;
  const segs = graphRoute(world.city.graph, { x: v.cx, y: v.cy }, { x: goal.x * TILE, y: goal.y * TILE });
  world.routeCache = { graph: true, goal: key, at: world.engine.frame, segs };
  return segs;
}

let scratch = null;

export function drawMinimap(world, ctx, e) {
  let conf = world.map.minimap ?? world.game.minimap;
  if (!conf) return;
  if (conf === true) conf = {};
  const r = conf.r ?? 26;
  const scale = conf.scale ?? 1;
  const size = r * 2;
  if (!scratch || scratch.width !== size) scratch = canvas(size, size);
  const g = scratch.getContext('2d');
  g.globalCompositeOperation = 'source-over';
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#101018';
  g.fillRect(0, 0, size, size);
  const v = world.driving;
  const p = world.player;
  const px = v ? v.cx / TILE : (p.px + 8) / TILE;
  const py = v ? v.cy / TILE : (p.py + 12) / TILE;
  const ox = Math.round(r - px * scale);
  const oy = Math.round(r - py * scale);
  g.drawImage(mapPicture(world), ox, oy, world.w * scale, world.h * scale);
  const list = dots(world, e);
  const goal = list.find((d) => d.goal);
  const segs = goal && world.city.graph && world.driving ? graphPath(world, goal) : null;
  if (segs) {
    g.fillStyle = getTheme().accent || '#f0c030';
    for (const pts of segs) {
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        const n = Math.max(1, Math.ceil((Math.hypot(x1 - x0, y1 - y0) / TILE) * scale));
        for (let k = 0; k <= n; k++) g.fillRect(Math.round(ox + ((x0 + ((x1 - x0) * k) / n) / TILE) * scale), Math.round(oy + ((y0 + ((y1 - y0) * k) / n) / TILE) * scale), 1, 1);
      }
    }
  }
  const path = !segs && goal && route(world, { x: Math.floor(goal.x), y: Math.floor(goal.y) });
  if (path) {
    g.fillStyle = getTheme().accent || '#f0c030';
    for (const [x, y] of path) g.fillRect(ox + x * scale + (scale > 1 ? scale / 2 - 0.5 : 0), oy + y * scale + (scale > 1 ? scale / 2 - 0.5 : 0), 1, 1);
  }
  for (const d of list) {
    let x = ox + d.x * scale;
    let y = oy + d.y * scale;
    const dx = x - r;
    const dy = y - r;
    const dist = Math.hypot(dx, dy);
    if (dist > r - 3) {
      if (!d.edge) continue;
      x = r + (dx / dist) * (r - 3);
      y = r + (dy / dist) * (r - 3);
    }
    const s = d.big ? 3 : 2;
    g.fillStyle = '#000000';
    g.fillRect(Math.round(x - s / 2) - 1, Math.round(y - s / 2) - 1, s + 2, s + 2);
    g.fillStyle = d.color;
    g.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
  }
  // the player: an arrow the way they face or drive
  const a = v ? v.angle : { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[p.dir] ?? 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  g.fillStyle = '#ffffff';
  for (const [u, w2] of [[3, 0], [2, 0], [1, 0], [0, 0], [1, 1], [1, -1], [0, 1], [0, -1], [-1, 2], [-1, -2], [-1, 0], [0, 2], [0, -2]]) {
    g.fillRect(Math.round(r + c * u - s * w2), Math.round(r + s * u + c * w2), 1, 1);
  }
  // round it off
  g.globalCompositeOperation = 'destination-in';
  g.beginPath();
  g.arc(r, r, r - 1, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  const corner = conf.corner || 'tr';
  const x0 = corner.includes('l') ? 4 : SCREEN_W - size - 4;
  const y0 = corner.includes('b') ? SCREEN_H - size - 4 : 4;
  ctx.fillStyle = '#1c1830';
  ctx.beginPath();
  ctx.arc(x0 + r, y0 + r, r + 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(scratch, x0, y0);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x0 + r, y0 + r, r - 0.5, 0, Math.PI * 2);
  ctx.stroke();
}

// The whole map on screen, from the pause menu: the d-pad moves round a map bigger than
// the screen, any of A, B or START closes it.
export class MapScreen {
  constructor(world) {
    this.world = world;
    this.opaque = true;
    this.pointer = true;
    const pic = mapPicture(world);
    // the whole map fits (shrunk if it must: a city); A switches to a closer look
    const fit = Math.min((SCREEN_W - 8) / pic.width, (SCREEN_H - 24) / pic.height);
    this.fit = fit >= 1 ? Math.min(4, Math.floor(fit)) : fit;
    this.close = Math.max(2, this.fit * 4 >= 1 ? Math.min(4, Math.ceil(this.fit * 4)) : 1);
    this.scale = this.fit;
    const v = world.driving;
    const p = world.player;
    this.cx = v ? v.cx / TILE : p.x + 0.5;
    this.cy = v ? v.cy / TILE : p.y + 0.5;
  }

  update(e) {
    const inp = e.input;
    const sp = 2 / this.scale;
    if (inp.held('left')) this.cx -= sp;
    if (inp.held('right')) this.cx += sp;
    if (inp.held('up')) this.cy -= sp;
    if (inp.held('down')) this.cy += sp;
    const w = this.world;
    this.cx = Math.max(0, Math.min(w.w, this.cx));
    this.cy = Math.max(0, Math.min(w.h, this.cy));
    if (inp.pressed('a') && this.fit < 2) { this.scale = this.scale === this.fit ? this.close : this.fit; sfx('cursor'); return; }
    if (inp.pressed('a') || inp.pressed('b') || inp.pressed('start') || inp.pointer?.back || inp.pointer?.clicked) { sfx('cancel'); this.done(null); }
  }

  draw(ctx, e) {
    const w = this.world;
    const pic = mapPicture(w);
    const s = this.scale;
    ctx.fillStyle = '#0c0a14';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    const fitsX = pic.width * s <= SCREEN_W - 8;
    const fitsY = pic.height * s <= SCREEN_H - 24;
    const ox = Math.round(fitsX ? (SCREEN_W - pic.width * s) / 2 : SCREEN_W / 2 - this.cx * s);
    const oy = Math.round(fitsY ? 16 + (SCREEN_H - 24 - pic.height * s) / 2 : (SCREEN_H + 8) / 2 - this.cy * s);
    ctx.imageSmoothingEnabled = s < 1;
    ctx.drawImage(pic, ox, oy, pic.width * s, pic.height * s);
    ctx.imageSmoothingEnabled = false;
    for (const d of dots(w, e)) {
      const sz = d.big ? 4 : 3;
      ctx.fillStyle = '#000000';
      ctx.fillRect(Math.round(ox + d.x * s - sz / 2) - 1, Math.round(oy + d.y * s - sz / 2) - 1, sz + 2, sz + 2);
      ctx.fillStyle = d.color;
      ctx.fillRect(Math.round(ox + d.x * s - sz / 2), Math.round(oy + d.y * s - sz / 2), sz, sz);
    }
    const v = w.driving;
    const px = v ? v.cx / TILE : w.player.x + 0.5;
    const py = v ? v.cy / TILE : w.player.y + 0.5;
    if (Math.floor(e.frame / 15) % 2) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(ox + px * s) - 2, Math.round(oy + py * s) - 2, 5, 5);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, SCREEN_W, 13);
    const name = w.map.name ? w.api.text(w.map.name) : t('console.menu.map');
    drawText(ctx, name, 4, 3, '#ffffff');
  }
}

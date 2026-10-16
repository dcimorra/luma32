// First person: the same map seen from the player's eyes (README "First person"). A
// third view of the world, beside the classic 3/4 view and the diorama: `view: 'first'`
// on the game or a map. Nothing in the data changes: the ground is the floor, solid
// tiles stand up as walls with their own picture, props and people are sprites standing
// where they stand, `dark` is the fog of the place, every light cuts it, and a light on
// the player with a `cone` is a torch. The world keeps its rules: cells, warps, triggers,
// spots, scripts; only the picture and the way of walking are this file's.
//
// A raycaster, as the GBA's first-person games were: one ray a screen column for the
// walls, a row at a time for the floor and the ceiling, sprites sorted by distance and
// cut by the walls in front of them. All of it on the 240×160 buffer, in pixels.
import { SCREEN_W, SCREEN_H, TILE, canvas, hex } from './gfx.js';

export const HEADING = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };
export const headingOf = (dir) => HEADING[dir] ?? 0;
// The four-way direction a heading faces: what everything that reads `dir` keeps seeing.
export function dirOf(h) {
  const a = ((h % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (a < Math.PI / 4 || a >= Math.PI * 7 / 4) return 'up';
  if (a < Math.PI * 3 / 4) return 'right';
  if (a < Math.PI * 5 / 4) return 'down';
  return 'left';
}
// A heading as a unit vector: up is north (-y), right is east (+x).
export const forward = (h) => [Math.sin(h), -Math.cos(h)];

const FOV = (66 * Math.PI) / 180;
const EYE = 16;            // the eyes, in map pixels over the floor
const MAX_DEPTH = 40;      // cells a ray walks at most

// A tile's picture as pixels, once per (image). Pictures are small; the cache is by canvas.
const texels = new WeakMap();
function pixelsOf(img) {
  let t = texels.get(img);
  if (t) return t;
  const w = img.width;
  const h = img.height;
  const data = new Uint32Array(img.getContext('2d').getImageData(0, 0, w, h).data.buffer);
  t = { w, h, data };
  texels.set(img, t);
  return t;
}

const smooth = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

export class FirstPerson {
  constructor(world) {
    this.world = world;
    this.out = canvas(SCREEN_W, SCREEN_H);
    this.img = this.out.getContext('2d').createImageData(SCREEN_W, SCREEN_H);
    this.px = new Uint32Array(this.img.data.buffer);
    this.zbuf = new Float32Array(SCREEN_W);
    this.tmp = canvas(SCREEN_W, SCREEN_H);
    this.mask = canvas(SCREEN_W, SCREEN_H);
    this.D = SCREEN_W / 2 / Math.tan(FOV / 2);   // the projection plane, in screen pixels
    this.floorKey = null;
  }

  // The player's eyes: the middle of their box, and the way they face.
  eye() {
    const w = this.world;
    const p = w.player;
    const b = w.box(p);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2, h: p.heading ?? headingOf(p.dir) };
  }

  // How tall the walls are, in map pixels (two cells by default).
  get wallH() { return this.world.map.wallHeight ?? this.world.game.wallHeight ?? TILE * 2; }

  // A point of the map (x, east; y, up from the floor; z, south) on the screen, with its
  // depth and the scale things there are drawn at; null behind the camera.
  project(x, y, z) {
    const e = this.eye();
    const [fx, fy] = forward(e.h);
    const dx = x - e.x;
    const dz = z - e.y;
    const depth = dx * fx + dz * fy;
    if (depth < 1) return null;
    const right = dx * -fy + dz * fx;
    const s = this.D / depth;
    return { x: SCREEN_W / 2 + right * s, y: SCREEN_H / 2 + (EYE - y) * s, depth, scale: s };
  }

  // Is this cell a wall to look at? Off the map is; water (a medium, a reflecting tile,
  // a watery step), low things and flat things are floor, and a tile says it outright
  // with `wall: false` (a chasm that blocks but doesn't stand) or `wall: 'id'` (the tile
  // whose picture its wall shows). What stops the player's feet is the world's business.
  wallAt(x, y) {
    const w = this.world;
    const id = w.tileAt(x, y);
    if (!id) return w.neighbourAt?.(x, y) ? null : 'void';
    const d = w.game.tiles[id];
    if (d.wall === false || !d.solid || d.medium || d.low || d.flat || d.reflect || d.step === 'water') return null;
    return d.wall || id;
  }

  // The lights of the place, in map pixels: props, people, the map's own, and the player's
  // torch (a light with `cone`, the width of its beam in radians).
  lights(frame) {
    const w = this.world;
    const out = [];
    const add = (l, x, y) => {
      if (!l) return;
      const r = (l.r || 40) * (l.flicker ? 1 + Math.sin(frame / 5 + x) * 0.02 * l.flicker : 1);
      const c = hex(l.color || '#ffd890');
      out.push({ x, y, r, color: [c[0] / 255, c[1] / 255, c[2] / 255], cone: l.cone || 0, heading: 0 });
    };
    for (const p of w.props) if (!p.hidden && p.def.light) add(p.def.light, p.x * TILE + (p.def.light.dx ?? (p.w * TILE) / 2), (p.y + 1 - p.h) * TILE + (p.def.light.dy ?? (p.h * TILE) / 2));
    for (const a of w.actors) {
      const l = a.def.light || a.light;
      if (!l || !a.visible) continue;
      add(l, a.px + 8 + (l.dx ?? 0), a.py + 8 + (l.dy ?? 0));
      if (l.cone) out[out.length - 1].heading = a.heading ?? headingOf(a.dir);
    }
    let extra = w.map.lights;
    if (typeof extra === 'function') extra = extra(w.api);
    for (const l of extra || []) add(l, l.x * TILE + (l.dx ?? 8), l.y * TILE + (l.dy ?? 8));
    return out;
  }

  // How lit a point of the map is, 0 to 1, and the colour its lights give it.
  litAt(x, y, lights, tint) {
    let k = 0;
    tint[0] = tint[1] = tint[2] = 0;
    for (const l of lights) {
      const dx = x - l.x;
      const dy = y - l.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= l.r) continue;
      let s = smooth(1 - d / l.r) * 1.3;
      if (l.cone) {
        // the beam: full in the middle, soft at its edge, nothing behind
        let a = Math.atan2(dx, -dy) - l.heading;
        a = Math.abs(((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
        s *= smooth(1 - (a - l.cone * 0.3) / (l.cone * 0.2));
      }
      if (s <= 0) continue;
      k += s;
      tint[0] += l.color[0] * s; tint[1] += l.color[1] * s; tint[2] += l.color[2] * s;
    }
    return k > 1 ? 1 : k;
  }

  // The floor as one picture of the map (ground, autotile edges and the props that lie on
  // it), as pixels, again when the ground or its animation changes.
  floor(animF) {
    const w = this.world;
    const big = w.w * w.h > 128 * 128;
    const key = `${w.mapId}:${big ? 0 : animF}:${w.props.length}:${w.groundVersion || 0}`;
    if (key !== this.floorKey) {
      this.floorKey = key;
      this.floorPix = pixelsOf(w.mapImage(big ? 0 : animF, { props: 'flat' }));
    }
    return this.floorPix;
  }

  draw(ctx, e) {
    const w = this.world;
    const W = SCREEN_W;
    const H = SCREEN_H;
    const px = this.px;
    const zbuf = this.zbuf;
    const eye = this.eye();
    const [fx, fy] = forward(eye.h);
    const rx = -fy;        // to the right of the view
    const ry = fx;
    const D = this.D;
    const WH = this.wallH;
    const animF = Math.floor(e.frame / (w.map.animRate || 20));
    const half = H / 2;

    // the light of the place: the hour's or the map's grade and dark, and every light
    const grade = w.map.grade === undefined ? w.clockGradeNow() : typeof w.map.grade === 'function' ? w.map.grade(w.api, e) : w.map.grade;
    const dark = w.map.dark === undefined ? w.clockDarkNow() : typeof w.map.dark === 'function' ? w.map.dark(w.api, e) : w.map.dark;
    const g = grade ? hex(grade).map((v) => v / 255) : [1, 1, 1];
    const fogA = dark?.alpha > 0 ? dark.alpha : 0;
    const fogC = hex(dark?.color || '#000000').map((v) => v / 255);
    const far = (w.map.fog ?? w.game.fog ?? (fogA ? 7 : 24)) * TILE;
    const lights = fogA ? this.lights(e.frame) : [];
    const tint = [0, 0, 0];
    // the sky, or the ceiling: a tile's picture overhead, a colour, or the map's sky
    const sky = typeof w.map.sky === 'function' ? w.map.sky(w.api, e) : w.map.sky;
    const ceilId = w.map.ceiling ?? w.game.ceiling ?? null;
    const ceil = ceilId && w.game.tiles[ceilId] ? pixelsOf(w.tiles.image(ceilId, animF)) : null;
    const skyTop = hex(sky?.[0] || w.map.void || '#000000').map((v) => v / 255);
    const skyBot = hex(sky?.[sky.length - 1] || w.map.void || '#000000').map((v) => v / 255);
    const floorPix = this.floor(animF);
    const mapW = w.w * TILE;
    const mapH = w.h * TILE;

    // a pixel: the picture's colour, lit by the place and the lights, then the fog
    const shade = (t, k, dist, lit, tr, tg, tb) => {
      let r = (t & 255) / 255 * g[0] * k;
      let gg = ((t >> 8) & 255) / 255 * g[1] * k;
      let b = ((t >> 16) & 255) / 255 * g[2] * k;
      if (lit > 0) { r += tr * 0.25; gg += tg * 0.25; b += tb * 0.25; }
      let f = dist / far;
      f = (f > 1 ? 1 : f) * (fogA || 0.35);
      if (fogA) { f *= 1 - lit; const q = 1 - f; r = r * q + fogC[0] * f; gg = gg * q + fogC[1] * f; b = b * q + fogC[2] * f; }
      else { const q = 1 - f; r = r * q + skyBot[0] * f; gg = gg * q + skyBot[1] * f; b = b * q + skyBot[2] * f; }
      return 0xff000000 | ((b > 1 ? 255 : (b * 255) | 0) << 16) | ((gg > 1 ? 255 : (gg * 255) | 0) << 8) | (r > 1 ? 255 : (r * 255) | 0);
    };

    // the sky, row by row, from the top down to the horizon
    for (let y = 0; y < half; y++) {
      const k = y / half;
      const r = skyTop[0] + (skyBot[0] - skyTop[0]) * k;
      const gg = skyTop[1] + (skyBot[1] - skyTop[1]) * k;
      const b = skyTop[2] + (skyBot[2] - skyTop[2]) * k;
      const c = 0xff000000 | ((b * 255) << 16) | ((gg * 255) << 8) | (r * 255);
      px.fill(c, y * W, y * W + W);
    }

    // the floor and the ceiling: each row is one distance, each column one point of it
    const cols = new Float32Array(W * 3);   // ray direction and its stretch per column
    for (let x = 0; x < W; x++) {
      const a = Math.atan((x - W / 2 + 0.5) / D);
      cols[x * 3] = Math.sin(eye.h + a);
      cols[x * 3 + 1] = -Math.cos(eye.h + a);
      cols[x * 3 + 2] = 1 / Math.cos(a);
    }
    for (let y = half; y < H; y++) {
      const rowD = (EYE * D) / (y - half + 0.5);
      const cy = half - 1 - (y - half);   // the ceiling row this floor row mirrors
      const ceilD = ((WH - EYE) * D) / (y - half + 0.5);
      for (let x = 0; x < W; x++) {
        const d = rowD * cols[x * 3 + 2];
        const mx = eye.x + cols[x * 3] * d;
        const my = eye.y + cols[x * 3 + 1] * d;
        let t = 0xff000000;
        if (mx >= 0 && my >= 0 && mx < mapW && my < mapH) t = floorPix.data[(my | 0) * floorPix.w + (mx | 0)];
        const lit = lights.length ? this.litAt(mx, my, lights, tint) : 0;
        px[y * W + x] = shade(t, 1, d, lit, tint[0], tint[1], tint[2]);
        if (ceil) {
          const cd = ceilD * cols[x * 3 + 2];
          const cx = eye.x + cols[x * 3] * cd;
          const cz = eye.y + cols[x * 3 + 1] * cd;
          const tc = ceil.data[(((cz | 0) % ceil.h + ceil.h) % ceil.h) * ceil.w + (((cx | 0) % ceil.w + ceil.w) % ceil.w)];
          const litc = lights.length ? this.litAt(cx, cz, lights, tint) : 0;
          px[cy * W + x] = shade(tc, 0.8, cd, litc, tint[0], tint[1], tint[2]);
        }
      }
    }

    // the walls: one ray a column, through the grid, to the first wall
    const cellX = eye.x / TILE;
    const cellY = eye.y / TILE;
    for (let x = 0; x < W; x++) {
      const dx = cols[x * 3];
      const dy = cols[x * 3 + 1];
      let mx = Math.floor(cellX);
      let my = Math.floor(cellY);
      const ddx = dx === 0 ? 1e30 : Math.abs(1 / dx);
      const ddy = dy === 0 ? 1e30 : Math.abs(1 / dy);
      const sx = dx < 0 ? -1 : 1;
      const sy = dy < 0 ? -1 : 1;
      let sideX = dx < 0 ? (cellX - mx) * ddx : (mx + 1 - cellX) * ddx;
      let sideY = dy < 0 ? (cellY - my) * ddy : (my + 1 - cellY) * ddy;
      let side = 0;
      let wall = null;
      for (let n = 0; n < MAX_DEPTH; n++) {
        if (sideX < sideY) { sideX += ddx; mx += sx; side = 0; } else { sideY += ddy; my += sy; side = 1; }
        wall = this.wallAt(mx, my);
        if (wall) break;
      }
      if (!wall) { zbuf[x] = 1e9; continue; }
      // the distance along the view (not the ray), so walls stay straight
      const perp = (side === 0 ? sideX - ddx : sideY - ddy) * TILE / cols[x * 3 + 2];
      zbuf[x] = perp;
      const hitX = eye.x + dx * perp * cols[x * 3 + 2];
      const hitY = eye.y + dy * perp * cols[x * 3 + 2];
      const along = side === 0 ? hitY : hitX;
      const tex = wall === 'void' ? null : pixelsOf(w.tiles.image(wall, animF));
      let u = along - Math.floor(along / TILE) * TILE;
      if ((side === 0 && dx > 0) || (side === 1 && dy < 0)) u = TILE - 1 - u;
      const s = D / perp;
      const top = half - (WH - EYE) * s;
      const bot = half + EYE * s;
      const y0 = Math.max(0, Math.ceil(top));
      const y1 = Math.min(H, Math.ceil(bot));
      const k = side === 1 ? 1 : 0.78;
      const lit = lights.length ? this.litAt(hitX, hitY, lights, tint) : 0;
      const tu = tex ? ((u * tex.w) / TILE) | 0 : 0;
      for (let y = y0; y < y1; y++) {
        let t = 0xff202028;
        if (tex) {
          const v = ((y - top) / (bot - top)) * WH;   // map pixels down the wall, the picture repeated
          t = tex.data[((v | 0) % tex.h) * tex.w + tu];
          if (!(t & 0xff000000)) t = 0xff202028;
        }
        px[y * W + x] = shade(t, k, perp, lit, tint[0], tint[1], tint[2]);
      }
    }
    this.out.getContext('2d').putImageData(this.img, 0, 0);
    ctx.drawImage(this.out, 0, 0);

    // the sprites: props standing and people, far ones first, each column cut by the walls
    const list = [];
    for (const p of w.props) {
      if (p.hidden || p.def.flat) continue;
      const img = w.tiles.image(p.t, animF + (p.phase || 0));
      const [, fh = 1, , dy = 0] = p.foot || [];
      list.push({ img, x: (p.x + p.w / 2) * TILE, z: (p.y + 1 - dy - fh / 2) * TILE, w: img.width, h: img.height, alpha: 1 });
    }
    for (const a of w.actors) {
      if (a === w.player || !a.visible || (a.alpha ?? 1) <= 0) continue;
      const img = a.image();
      if (!img) continue;
      list.push({ img, x: a.px + 8 + a.ox, z: a.py + 12 + a.oy, w: img.width, h: img.height, alpha: a.alpha ?? 1, lift: (a.lift || 0) + (a.alt || 0), actor: a });
    }
    for (const sp of list) {
      const dx = sp.x - eye.x;
      const dz = sp.z - eye.y;
      sp.depth = dx * fx + dz * fy;
      sp.right = dx * rx + dz * ry;
    }
    list.sort((a, b) => b.depth - a.depth);
    const tctx = this.tmp.getContext('2d');
    const mctx = this.mask.getContext('2d');
    for (const sp of list) {
      if (sp.depth < 2) continue;
      const s = D / sp.depth;
      const sw = sp.w * s;
      const sh = sp.h * s;
      const left = W / 2 + sp.right * s - sw / 2;
      const bot = half + (EYE - (sp.lift || 0)) * s;
      const top = bot - sh;
      const x0 = Math.max(0, Math.floor(left));
      const x1 = Math.min(W, Math.ceil(left + sw));
      if (x1 <= x0 || top > H || bot < 0) continue;
      tctx.clearRect(x0, 0, x1 - x0, H);
      tctx.imageSmoothingEnabled = false;
      // its shape, drawn beside it: what the light below is cut back to
      if (grade) { mctx.clearRect(x0, 0, x1 - x0, H); mctx.imageSmoothingEnabled = false; }
      let any = false;
      for (let x = x0; x < x1; x++) {
        if (zbuf[x] <= sp.depth) continue;
        const u = Math.min(sp.w - 1, Math.floor((x - left) / s));
        tctx.drawImage(sp.img, u, 0, 1, sp.h, x, top, 1, sh);
        if (grade) mctx.drawImage(sp.img, u, 0, 1, sp.h, x, top, 1, sh);
        any = true;
      }
      if (!any) continue;
      // the place's light over it (multiplied, then cut back to its own shape), then the
      // fog over it and the light on it, as on the wall beside it
      const lit = lights.length ? this.litAt(sp.x, sp.z, lights, tint) : 0;
      let f = Math.min(1, sp.depth / far) * (fogA || 0.35);
      if (fogA) f *= 1 - lit;
      if (grade) {
        tctx.globalCompositeOperation = 'multiply';
        tctx.fillStyle = grade;
        tctx.fillRect(x0, Math.floor(top), x1 - x0, Math.ceil(sh) + 1);
        tctx.globalCompositeOperation = 'destination-in';
        tctx.drawImage(this.mask, 0, 0);
      }
      tctx.globalCompositeOperation = 'source-atop';
      tctx.globalAlpha = f;
      tctx.fillStyle = fogA ? dark.color || '#000' : `rgb(${skyBot.map((v) => Math.round(v * 255)).join(',')})`;
      tctx.fillRect(x0, top, x1 - x0, sh);
      tctx.globalAlpha = 1;
      tctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = sp.alpha;
      ctx.drawImage(this.tmp, x0, Math.max(0, Math.floor(top)), x1 - x0, Math.ceil(sh) + 1, x0, Math.max(0, Math.floor(top)), x1 - x0, Math.ceil(sh) + 1);
      ctx.globalAlpha = 1;
      sp.actor && (sp.actor.fpBox = { x: left, y: top, w: sw, h: sh, depth: sp.depth });
    }
  }
}

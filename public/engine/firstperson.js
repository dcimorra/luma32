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
import { SCREEN_W, SCREEN_H, TILE, canvas, hex, pixels } from './gfx.js';
import { changed } from './host.js';

// The player's own choice, kept per game and per device: any map the cartridge leaves to
// them is seen from above ('top'), from the eyes ('first') or from just behind and over the
// player ('third'); and in third person, how far behind the player's middle the camera is
// and how high, in map pixels, five steps of each (the middle one by default). The view is
// tipped down to keep the player framed, their feet on one row near the bottom of the
// screen: the modern look tilts its camera by that angle (`tilt`), the raycaster cannot
// tilt, so it lowers the horizon by as many screen pixels (`pitch`). ?fp=1 / ?fp=3 / ?fp=0
// (testing) win over the view kept.
export const VIEWS = ['top', 'first', 'third'];
export const THIRD_STEPS = { far: [64, 84, 108, 136, 170], high: [40, 50, 60, 74, 92] };
const FEET_ROW = 146;
const TESTING = (() => { const q = new URLSearchParams(location.search).get('fp'); return q === null ? null : { 1: 'first', 3: 'third' }[q] || 'top'; })();
// Kept as `luma32.<game>.camera`, which goes to the account with the saves (host.js), so a
// device that loses its storage (Safari does) gets it back; `at` says which copy is newer.
const kept = new Map();   // game id -> { view, far, high, at }
const keyOf = (game) => `luma32.${game}.camera`;
function prefs(game) {
  let p = kept.get(game);
  if (p) return p;
  p = { view: 'top', far: 2, high: 2 };
  try { Object.assign(p, JSON.parse(localStorage.getItem(keyOf(game)) ?? localStorage.getItem(`luma32.camera.${game}`)) || {}); } catch { /* the default */ }
  if (!VIEWS.includes(p.view)) p.view = 'top';
  for (const k of ['far', 'high']) p[k] = Math.max(0, Math.min(THIRD_STEPS[k].length - 1, p[k] | 0));
  if (TESTING) p.view = TESTING;
  kept.set(game, p);
  return p;
}
function keep(game, change) {
  const p = Object.assign(prefs(game), change, { at: Date.now() });
  try {
    localStorage.setItem(keyOf(game), JSON.stringify(p));
    localStorage.removeItem(`luma32.camera.${game}`);
    changed(keyOf(game));
  } catch { /* a comfort */ }
}
export const viewChoice = (game) => prefs(game).view;
export const setViewChoice = (game, v) => keep(game, { view: VIEWS.includes(v) ? v : 'top' });
export const nextView = (v) => VIEWS[(VIEWS.indexOf(v) + 1) % VIEWS.length];
export const thirdCamera = (game) => prefs(game);
export const setThirdCamera = (game, key, step) => keep(game, { [key]: Math.max(0, Math.min(THIRD_STEPS[key].length - 1, step)) });

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
const PLANE = SCREEN_W / 2 / Math.tan(FOV / 2);                    // the projection plane, in screen pixels
const FEET_ANGLE = Math.atan((FEET_ROW - SCREEN_H / 2) / PLANE);   // the feet's row, as an angle under the view's axis

// A tile's picture as pixels, once per (image). Pictures are small; the cache is by canvas.
const texels = new WeakMap();
function pixelsOf(img) {
  let t = texels.get(img);
  if (t) return t;
  const w = img.width;
  const h = img.height;
  const data = new Uint32Array(pixels(img).data.buffer);
  t = { w, h, data };
  texels.set(img, t);
  return t;
}

// Is this cell a wall to look at? Off the map is; water (a medium, a reflecting tile,
// a watery step), low things and flat things are floor, and a tile says it outright
// with `wall: false` (a chasm that blocks but doesn't stand) or `wall: 'id'` (the tile
// whose picture its wall shows). What stops the player's feet is the world's business.
function wallCell(w, x, y) {
  const id = w.tileAt(x, y);
  if (!id) return w.neighbourAt?.(x, y) ? null : 'void';
  const d = w.game.tiles[id];
  if (d.wall === false || !d.solid || d.medium || d.low || d.flat || d.reflect || d.step === 'water') return null;
  return d.wall || id;
}

// What the third-person camera cannot stand inside: something big that stops the feet (a
// building, a tent, a carriage: three cells wide or tall, or what says `roof`). Past one it
// may be (what is between thins out round the player, hd.js); smaller things it ignores.
function bigAt(w, cx, cy) {
  const p = w.propAt(cx, cy);
  if (!p || p.hidden || p.def.flat) return false;
  return p.def.roof !== undefined || p.w >= 3 || p.h >= 3;
}

// Where the camera stands: the player's eyes, or in third person behind and over them.
// x, y: map pixels on the floor; h: the heading the view looks along; eye: its height over
// the floor; lift: the ground's own height under the player (README "Heights"), which the
// modern look adds; back: how far behind the player it stands; tilt: how far it looks down
// (radians) so the player's feet sit on FEET_ROW; pitch: the same as screen pixels of
// horizon, for the raycaster.
//
// In third person the camera follows the player's heading with a little lag, so a turn
// swings the view round instead of snapping it, and it stands as far back as the chosen
// distance lets it: never past a wall behind (the classic look cannot see through one),
// never inside a building. Pushed in by one, it climbs: it keeps its distance from the
// player, from higher up, so they stay the same size on the screen and a corner turns the
// view towards one from above instead of swallowing them. It comes in at once (never into
// a wall) and goes back out gently.
export function viewpoint(w) {
  const p = w.player;
  const b = w.box(p);
  const x = b.x + b.w / 2;
  const y = b.y + b.h / 2;
  const lift = w.raised ? p.ez || 0 : 0;
  const h = p.heading ?? headingOf(p.dir);
  if (!w.thirdPerson) return { x, y, h, eye: EYE, lift, back: 0, pitch: 0, tilt: 0 };
  const wallH = w.map.wallHeight ?? w.game.wallHeight ?? TILE * 2;
  const ceiled = !!(w.map.ceiling ?? w.game.ceiling);
  const third = thirdCamera(w.game.id);
  const far = THIRD_STEPS.far[third.far];
  // under a ceiling the camera stays under it
  const high = ceiled ? Math.min(THIRD_STEPS.high[third.high], wallH - 4) : THIRD_STEPS.high[third.high];
  // the camera's own state, moved once a frame (the view asks several times in one); new
  // on another map or after a jump
  const frame = w.engine.frame;
  let s = w.thirdCam;
  if (!s || s.map !== w.mapId || Math.hypot(s.x - x, s.y - y) > 48) s = w.thirdCam = { map: w.mapId, frame: -1, h, back: far, eye: high, x, y };
  if (s.frame !== frame) {
    s.frame = frame;
    s.x = x;
    s.y = y;
    // the heading: the shortest way round, a fifth of what is left each frame
    let d = h - s.h;
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    s.h = Math.abs(d) < 0.002 ? h : s.h + d * 0.2;
    const [fx, fy] = forward(s.h);
    const cellAt = (k) => [Math.floor((x - fx * k) / TILE), Math.floor((y - fy * k) / TILE)];
    // in the modern look's diorama (engine/diorama.js, `third`) a wall well under the
    // camera's height does not stop it: it looks over it, from past the map's edge if need
    // be (the skirt goes on there), as a room is seen over its near wall. The raycaster
    // cannot see over one, and never leaves the map.
    const over = w.engine.hdFrame?.third ? w.dioramaWallH : null;
    const blocks = (cx, cy) => { const c = wallCell(w, cx, cy); return !!c && (!over || over(cx, cy) + 28 > high); };
    let back = 0;
    while (back < far && !blocks(...cellAt(back + 6))) back += 2;
    while (back > 30 && bigAt(w, ...cellAt(back))) back -= 2;
    s.back = back < s.back ? back : Math.min(back, s.back + 2);
    // pushed in, it climbs, the same distance from the player
    const dist = Math.hypot(far, high);
    let eye = Math.sqrt(Math.max(0, dist * dist - s.back * s.back));
    if (ceiled) eye = Math.min(eye, wallH - 4);
    s.eye = Math.max(high, eye);
  }
  const [fx, fy] = forward(s.h);
  // the view tipped down so the feet sit on their row: as an angle for a camera that tilts,
  // and as the rows the raycaster's horizon goes down (it cannot tilt, only shift)
  const tilt = Math.max(0, Math.atan2(s.eye, Math.max(s.back, 1)) - FEET_ANGLE);
  const pitch = Math.max(0, Math.min(SCREEN_H, Math.round(SCREEN_H / 2 - (FEET_ROW - (s.eye * PLANE) / Math.max(s.back, 12)))));
  return { x: x - fx * s.back, y: y - fy * s.back, h: s.h, eye: s.eye, lift, back: s.back, pitch, tilt };
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
    this.D = PLANE;
    this.floorKey = null;
  }

  // Where the camera is (viewpoint above), and the row of the horizon: lowered in third
  // person, so the view looks down a little.
  eye() { return viewpoint(this.world); }
  horizon(e = this.eye()) { return SCREEN_H / 2 - e.pitch; }

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
    return { x: SCREEN_W / 2 + right * s, y: this.horizon(e) + (e.eye - y) * s, depth, scale: s };
  }

  wallAt(x, y) { return wallCell(this.world, x, y); }

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
    const half = this.horizon(eye);
    const EYE = eye.eye;

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
    for (let y = Math.max(0, half); y < H; y++) {
      const rowD = (EYE * D) / (y - half + 0.5);
      const cy = half - 1 - (y - half);   // the ceiling row this floor row mirrors (none past the top)
      const ceilD = ((WH - EYE) * D) / (y - half + 0.5);
      for (let x = 0; x < W; x++) {
        const d = rowD * cols[x * 3 + 2];
        const mx = eye.x + cols[x * 3] * d;
        const my = eye.y + cols[x * 3 + 1] * d;
        let t = 0xff000000;
        if (mx >= 0 && my >= 0 && mx < mapW && my < mapH) t = floorPix.data[(my | 0) * floorPix.w + (mx | 0)];
        const lit = lights.length ? this.litAt(mx, my, lights, tint) : 0;
        px[y * W + x] = shade(t, 1, d, lit, tint[0], tint[1], tint[2]);
        if (ceil && cy >= 0) {
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
      // the player's own body is not before their eyes; in third person it is, ahead
      if ((a === w.player && !w.thirdPerson) || !a.visible || (a.alpha ?? 1) <= 0) continue;
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
    // in third person the player is drawn last: nothing standing between hides them
    if (w.thirdPerson) list.sort((a, b) => (a.actor === w.player) - (b.actor === w.player));
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
      // the player in third person is never hidden by a wall's corner between them and the camera
      const always = sp.actor === w.player;
      for (let x = x0; x < x1; x++) {
        if (zbuf[x] <= sp.depth && !always) continue;
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

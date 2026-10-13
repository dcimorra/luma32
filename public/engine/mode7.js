// Mode 7: a flat picture laid on the ground and seen in perspective, the way the GBA's
// affine backgrounds gave flights, sailing, races and world maps (README "Mode 7"). It
// draws; it decides nothing: who steers, how fast and what happens is the cartridge's.
//   const m7 = new Mode7({ ground: canvas, wrap: true, sky: ['#203048', '#a0c0e0'] });
//   m7.cam = { x, y, angle, height: 40, horizon: 40 };   // ground pixels, radians
//   m7.draw(ctx);                                          // sky, then the ground
//   m7.sprite(ctx, img, x, y, { z });                      // something standing there
// `api.flyover(opts)` (engine/world.js) is the ready-made one: the current map from the
// air, the camera gliding from one cell to another.
import { SCREEN_W, SCREEN_H, canvas, hex } from './gfx.js';

export class Mode7 {
  // ground: a canvas (or an image) in ground pixels. wrap: it repeats for ever (sea, sky);
  // otherwise outside it is `outside` (a colour). fog: { color, far, from } fades the ground
  // into `color` from `from` × `far` to `far` ground pixels away (`far`: 16 camera
  // heights). fov: the width of the view, in radians.
  constructor({ ground, wrap = false, outside = '#000000', sky = null, fog = null, fov = 1.2 } = {}) {
    this.wrap = wrap;
    this.outside = hex(outside);
    this.sky = sky;
    this.fog = fog && { color: hex(fog.color || '#ffffff'), from: fog.from ?? 0.4, far: fog.far ?? null };
    this.fov = fov;
    this.cam = { x: 0, y: 0, angle: 0, height: 32, horizon: 40 };
    this.out = canvas(SCREEN_W, SCREEN_H);
    this.octx = this.out.getContext('2d');
    this.setGround(ground);
  }

  // A new ground picture, or the same one painted again (call it after changing it).
  setGround(ground) {
    if (!ground) return;
    const w = ground.width;
    const h = ground.height;
    const c = ground.getContext ? ground : (() => { const k = canvas(w, h); k.getContext('2d').drawImage(ground, 0, 0); return k; })();
    this.gw = w;
    this.gh = h;
    this.texels = new Uint32Array(c.getContext('2d').getImageData(0, 0, w, h).data.buffer);
  }

  // Ground pixels per screen pixel along the view's centre line, and its sides.
  basis() {
    const { angle } = this.cam;
    const half = Math.tan(this.fov / 2);
    return { fx: Math.sin(angle), fy: -Math.cos(angle), rx: Math.cos(angle) * half, ry: Math.sin(angle) * half };
  }

  // Where a ground point (and `z` pixels above it) lands on screen, and how big things
  // there are drawn (1 = as on the flat map). Null behind the camera or past the horizon.
  project(x, y, z = 0) {
    const { cam } = this;
    const { fx, fy, rx, ry } = this.basis();
    const dx = x - cam.x;
    const dy = y - cam.y;
    const depth = dx * fx + dy * fy;
    if (depth < 1) return null;
    const side = (dx * rx + dy * ry) / (rx * rx + ry * ry);
    const focal = (SCREEN_W / 2) / Math.hypot(rx, ry);
    const scale = focal / depth;
    return { x: SCREEN_W / 2 + (side / depth) * (SCREEN_W / 2), y: cam.horizon + (cam.height - z) * scale, scale, depth };
  }

  draw(ctx) {
    const { cam } = this;
    const hz = Math.max(0, Math.min(SCREEN_H - 1, Math.round(cam.horizon)));
    this.drawSky(ctx, hz);
    const rows = SCREEN_H - hz;
    if (rows <= 0) return;
    const img = this.octx.createImageData(SCREEN_W, rows);
    const px = new Uint32Array(img.data.buffer);
    const { fx, fy, rx, ry } = this.basis();
    const focal = (SCREEN_W / 2) / Math.hypot(rx, ry);
    const [or, og, ob] = this.outside;
    const outside = (255 << 24) | (ob << 16) | (og << 8) | or;
    const T = this.texels;
    const W = this.gw;
    const H = this.gh;
    const fog = this.fog;
    const far = fog ? fog.far ?? cam.height * 16 : 0;
    for (let j = 0; j < rows; j++) {
      // the screen row j below the horizon sees the ground at this depth
      const depth = (cam.height * focal) / (j + 0.5);
      const cx = cam.x + fx * depth;
      const cy = cam.y + fy * depth;
      // from the row's left end to its right end, one step a pixel
      const sx = (rx * depth * 2) / SCREEN_W;
      const sy = (ry * depth * 2) / SCREEN_W;
      let u = cx - rx * depth;
      let v = cy - ry * depth;
      const k = fog ? Math.max(0, Math.min(1, (depth / far - fog.from) / (1 - fog.from))) : 0;
      const row = j * SCREEN_W;
      for (let i = 0; i < SCREEN_W; i++, u += sx, v += sy) {
        let tx = Math.floor(u);
        let ty = Math.floor(v);
        let c;
        if (this.wrap) { tx = ((tx % W) + W) % W; ty = ((ty % H) + H) % H; c = T[ty * W + tx]; }
        else c = tx < 0 || ty < 0 || tx >= W || ty >= H ? outside : T[ty * W + tx];
        if (k > 0) {
          const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
          c = (255 << 24) | ((b + (fog.color[2] - b) * k) << 16) | ((g + (fog.color[1] - g) * k) << 8) | (r + (fog.color[0] - r) * k);
        }
        px[row + i] = c | (255 << 24);
      }
    }
    this.octx.putImageData(img, 0, 0);
    ctx.drawImage(this.out, 0, 0, SCREEN_W, rows, 0, hz, SCREEN_W, rows);
  }

  // Above the horizon: the cartridge's `sky(ctx, cam, horizon)`, a colour, or [top, bottom].
  drawSky(ctx, hz) {
    const s = this.sky;
    if (typeof s === 'function') { s(ctx, this.cam, hz); return; }
    if (Array.isArray(s)) {
      const [a, b] = s.map(hex);
      for (let y = 0; y < hz; y++) {
        const t = hz > 1 ? y / (hz - 1) : 1;
        ctx.fillStyle = `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
        ctx.fillRect(0, y, SCREEN_W, 1);
      }
      return;
    }
    ctx.fillStyle = s || '#000000';
    ctx.fillRect(0, 0, SCREEN_W, hz);
  }

  // Something standing on the ground at (x, y), `z` pixels up, drawn at the size the
  // distance gives it, its feet on the spot. Draw far ones first: `sprites` sorts them.
  sprite(ctx, img, x, y, { z = 0, scale = 1, shadow = true } = {}) {
    const p = this.project(x, y, z);
    if (!p || p.scale <= 0.02) return null;
    const k = p.scale * scale;
    const w = Math.max(1, Math.round(img.width * k));
    const h = Math.max(1, Math.round(img.height * k));
    if (shadow && z > 0) {
      const g = this.project(x, y, 0);
      if (g) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(Math.round(g.x - w / 3), Math.round(g.y - 1), Math.max(1, Math.round(w * 2 / 3)), Math.max(1, Math.round(2 * k))); }
    }
    ctx.drawImage(img, Math.round(p.x - w / 2), Math.round(p.y - h), w, h);
    return p;
  }

  // Many at once, the far ones first: [{ img, x, y, z, scale }].
  sprites(ctx, list) {
    const keyed = list.map((s) => ({ s, p: this.project(s.x, s.y, s.z || 0) })).filter((o) => o.p);
    keyed.sort((a, b) => b.p.depth - a.p.depth);
    for (const { s } of keyed) this.sprite(ctx, s.img, s.x, s.y, s);
  }
}

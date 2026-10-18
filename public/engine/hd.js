// The modern look (a setting, on unless the player chose classic): the same world, the
// same pixel art and the same rules, shown as a diorama in three dimensions.
// engine/diorama.js builds the map from what it already says (ground, walls with their
// faces stood up, heights, props and people as cards); this draws it with WebGL 2 under a
// perspective camera (or one straight over the map, as the classic screen frames it): a sun that casts shadows, the map's lights, depth of field from the
// real depth, a bloom, and the console's own drawing (dialogue, menus, HUD, fades) flat on top, at the screen's
// resolution. Nothing a cartridge writes changes: a game cannot tell which look it is in.
import { buildStatic, gatherCards, groundKey, animates, bodyMesh, picture } from './diorama.js';
import { forward, viewpoint } from './thirdperson.js';
import { canvas, TILE } from './gfx.js';

const KEY = 'luma32.gfx';
const MAX_LIGHTS = 16;

// The camera: how far it leans from straight down, its field of view, and how much of
// the map it takes in across, at the player, in map pixels (the classic screen's width).
const PITCH_DEG = 40;                  // from the horizon
const FOV_Y = (24 * Math.PI) / 180;
const ACROSS = 236;
// Light travels this way: down, towards the east and the north, so shadows fall behind
// things and the faces of walls, which look south, are lit.
const SUN = norm([0.45, -1, -0.5]);
// the sun's depth: 1024 is a map pixel every 0.6 of a texel over the span, plenty for
// pixel art (2048 was four times the fragments of the screen itself, every frame, on a phone)
const SHADOW_SIZE = 1024;
const SHADOW_SPAN = 300;               // map pixels around the camera's target
const DECAL_SIDE = 64;                 // the floor's picture reaches this far past the view
const DECAL_TOP = 200;                 // and this far above it
// The region's picture is drawn whole for each frame of animation up to this many cells
// (128 x 128: a 2048-pixel square); past it only the cells the camera sees are: from
// above, where the screen's corners fall on the ground; from the ground, this many cells
// all round the player
const WHOLE_PICTURE = 128 * 128;
const ANIM_GROUND = 40;
// third person: how wide the camera sees (the raycaster's width of view, engine/thirdperson.js),
// how much the far distance softens past the player, and from how far (times their distance
// from the camera) to where it is softest
const GROUND_FOV = (66 * Math.PI) / 180;
const TP_DOF = 0.55;
const TP_DOF_RANGE = [0.7, 2.6, 0.45, 0.75];   // and nearer than the player: a companion at their heels stays sharp
const TOP_DOF_RANGE = [0.06, 0.4, 0.1, 0.3];

const COARSE = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;

let supported;
export function hdSupported() {
  if (supported === undefined) {
    try { supported = !!window.WebGL2RenderingContext && !!document.createElement('canvas').getContext('webgl2'); } catch { supported = false; }
  }
  return supported;
}

// ?hd=1 / ?hd=0 (testing) wins over the stored setting; with none stored, the modern look.
// Read once: the world asks often.
let on = (() => {
  const q = new URLSearchParams(location.search).get('hd');
  if (q !== null) return q === '1';
  try { return localStorage.getItem(KEY) !== 'classic'; } catch { return true; }
})();
export const hdOn = () => on;
export function setHd(v, { keep = true } = {}) {
  on = !!v;
  if (keep) try { localStorage.setItem(KEY, on ? 'modern' : 'classic'); } catch { /* a comfort */ }
}

// The view from above, straight over the map (since 1.27): the classic screen's own
// framing, the ground flat and every face as its 3/4 art draws it, with the modern look's
// light. Else leaning, in perspective. Kept per device; ?hdtop=1 / ?hdtop=0 for testing.
const ANGLE_KEY = 'luma32.gfx.angle';
let overhead = (() => {
  const q = new URLSearchParams(location.search).get('hdtop');
  if (q !== null) return q === '1';
  try { return localStorage.getItem(ANGLE_KEY) === 'overhead'; } catch { return false; }
})();
export const hdOverhead = () => overhead;
export function setHdOverhead(v) {
  overhead = !!v;
  try { localStorage.setItem(ANGLE_KEY, overhead ? 'overhead' : 'tilted'); } catch { /* a comfort */ }
}

// ---------- shaders ----------

const SCENE_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUv;
layout(location = 2) in vec3 aN;
uniform mat4 uVP;
uniform mat4 uLightVP;
uniform vec3 uOffset;   // where a body stands (zero for the map and the cards)
uniform bool uLie;      // a body seen from above (a vehicle): its picture lies on the ground
uniform vec2 uTurn;     // from the ground: cos and sin of the turn a body makes to face the camera
uniform float uPivot;   // and the middle of its width, which it turns about
out vec2 vUv;
out vec3 vN;
out vec3 vP;
out vec4 vL;
void main() {
  vec3 a = aPos;
  vec3 n = aN;
  if (uLie) { a = vec3(aPos.x, aPos.z * 1.4 + 5.0, -aPos.y); n = vec3(aN.x, aN.z, -aN.y); }
  if (uTurn.y != 0.0 || uTurn.x != 1.0) {
    float lx = a.x - uPivot;
    a = vec3(uPivot + lx * uTurn.x - a.z * uTurn.y, a.y, lx * uTurn.y + a.z * uTurn.x);
    n = vec3(n.x * uTurn.x - n.z * uTurn.y, n.y, n.x * uTurn.y + n.z * uTurn.x);
  }
  vec3 p = a + uOffset;
  vUv = aUv; vN = n; vP = p;
  vL = uLightVP * vec4(p, 1.0);
  gl_Position = uVP * vec4(p, 1.0);
}`;

const SCENE_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform highp sampler2D uShadow;
uniform vec3 uToSun;
uniform vec3 uSun;
uniform vec3 uAmbient;
uniform vec3 uGrade;
uniform vec4 uDark;
uniform int uN;
uniform bool uDecal;    // the floor's picture: blended, not cut out
uniform vec4 uLight[${MAX_LIGHTS}];      // x y z (map pixels), radius
uniform vec4 uLightColor[${MAX_LIGHTS}]; // rgb, strength
uniform vec4 uLightDir[${MAX_LIGHTS}];   // a torch: the way it points (x z) and the cosine of its half angle; w 0 for a lamp
uniform vec3 uEye;      // from the ground: where the fog is measured from (the player)
uniform float uFogFar;  // and how far the dark reaches its full (0: the dark is everywhere, as in the classic look)
uniform vec3 uSeeFrom;  // third person: the camera, and the player it must always see:
uniform vec3 uSeeTo;    // whatever stands between them thins out round the line between,
uniform float uSee;     // this wide at the player (map pixels; 0 off)
uniform float uThin;    // how much of what is drawn may go: all but a little of a wall or a tree, half of a person at the player's heels (a figure, not dust), none of the player
uniform float uNear;    // from the ground: a body or a card this near the camera (map pixels) thins out to nothing, so a companion at the eyes never fills the screen; wider for the player, who goes when a cornered camera (under a ceiling) comes over their shoulder (0 off)
in vec2 vUv;
in vec3 vN;
in vec3 vP;
in vec4 vL;
out vec4 outColor;

// Pixel art under a perspective camera: each texel a crisp square, its edges blended
// over one screen pixel (the texture is filtered, the sample snaps to texel centres and
// only crosses between two of them within a pixel's width). Nearest sampling gave
// stair-stepped edges along every slanted line, and they crawled as the camera moved.
vec4 pix(sampler2D t, vec2 uv) {
  vec2 size = vec2(textureSize(t, 0));
  vec2 tx = uv * size;
  vec2 fw = max(fwidth(tx), vec2(1e-4));
  vec2 f = clamp((fract(tx - 0.5) - 0.5) / fw + 0.5, 0.0, 1.0);
  vec4 c = texture(t, (floor(tx - 0.5) + 0.5 + f) / size);
  // the pictures are premultiplied, so a see-through edge blends to nothing, not to black
  c.rgb /= max(c.a, 0.001);
  return c;
}

float lit() {
  vec3 p = vL.xyz / vL.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  float s = 0.0;
  vec2 t = vec2(1.0 / ${SHADOW_SIZE}.0);
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
    s += p.z - 0.0015 > texture(uShadow, p.xy + vec2(i, j) * t * 1.5).r ? 0.0 : 1.0;
  return s / 9.0;
}

// A 4x4 ordered dither, 0 to 1: what thins out loses pixels in a fine, even pattern.
float bayer(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i.y * 4 + i.x]) + 0.5) / 16.0;
}

void main() {
  vec4 t = pix(uTex, vUv);
  if (t.a < (uDecal ? 0.01 : 0.5)) discard;
  // third person: what stands between the camera and the player (not the ground under
  // them) thins out round the line between, so a building never swallows them
  if (uSee > 0.0 && uThin > 0.0 && vP.y > 3.0) {
    vec3 ab = uSeeTo - uSeeFrom;
    float len = length(ab);
    vec3 d = ab / len;
    float along = dot(vP - uSeeFrom, d);
    if (along > 0.0 && along < len - 4.0) {
      float r = uSee * (0.35 + 0.65 * along / len);
      float k = 1.0 - smoothstep(r * 0.55, r, length(vP - uSeeFrom - d * along));
      if (k * uThin > bayer(gl_FragCoord.xy)) discard;
    }
  }
  if (uNear > 0.0 && vP.y > 3.0) {
    float k = 1.0 - smoothstep(uNear * 0.45, uNear, distance(vP, uSeeFrom));
    if (k * 0.92 > bayer(gl_FragCoord.xy)) discard;
  }
  vec3 n = normalize(vN);
  float sun = max(dot(n, uToSun), 0.0) * lit();
  vec3 col = t.rgb * (uAmbient + uSun * sun) * uGrade;
  // the map's lights: a smooth falloff to the radius, brighter at the heart, so a lamp
  // reads as a lamp at night and its colour spills on what it touches (and blooms)
  vec3 glow = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uN) break;
    float k = clamp(1.0 - distance(vP, uLight[i].xyz) / uLight[i].w, 0.0, 1.0);
    k = k * k * (3.0 - 2.0 * k);
    if (uLightDir[i].w > 0.0) {
      // a beam: full along its way, soft at its edge, nothing behind
      vec2 to = normalize(vP.xz - uLight[i].xz);
      float c = dot(to, uLightDir[i].xy);
      k *= smoothstep(uLightDir[i].w, uLightDir[i].w + (1.0 - uLightDir[i].w) * 0.5, c);
    }
    glow += uLightColor[i].rgb * k * uLightColor[i].a;
  }
  float reach = clamp(max(glow.r, max(glow.g, glow.b)) * 1.8, 0.0, 1.0);
  float da = uDark.a * (uFogFar > 0.0 ? smoothstep(0.0, uFogFar, distance(vP, uEye)) : 1.0);
  col = mix(col, uDark.rgb, da * (1.0 - reach));
  col += t.rgb * glow * 1.1 + glow * 0.2;
  outColor = vec4(col, uDecal ? t.a : 1.0);
}`;

const SHADOW_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
in vec2 vUv;
in vec3 vN;
in vec3 vP;
in vec4 vL;
out vec4 outColor;
void main() { if (texture(uTex, vUv).a < 0.5) discard; outColor = vec4(1.0); }`;

const POST_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const POST_FS = `#version 300 es
precision highp float;
uniform sampler2D uColor;
uniform highp sampler2D uDepth;
uniform sampler2D uUi;
uniform sampler2D uBack;
uniform bool uHasBack;
uniform vec2 uOut;
uniform vec2 uClip;     // near, far
uniform bool uOrtho;    // the camera straight over the map: its depth is linear
uniform float uFocus;   // the distance in focus: the camera's target
uniform float uDof;     // how much what is off the focus softens
uniform vec4 uDofRange; // off the focus (times it) where the softening starts and where it is full: past it (xy), before it (zw)
uniform vec3 uHaze;     // the colour of the distance: the sky's foot, or the dark
uniform float uMosaic;  // a fade in blocks (engine.js): their size in screen pixels, or 0
out vec4 outColor;

float dist(vec2 uv) {
  if (uOrtho) return uClip.x + texture(uDepth, uv).r * (uClip.y - uClip.x);
  float z = texture(uDepth, uv).r * 2.0 - 1.0;
  return 2.0 * uClip.x * uClip.y / (uClip.y + uClip.x - z * (uClip.y - uClip.x));
}

vec3 soft(vec2 uv, float lod) {
  vec2 o = exp2(lod) * 0.7 / uOut;
  return 0.25 * (textureLod(uColor, uv + vec2(o.x, o.y), lod).rgb + textureLod(uColor, uv + vec2(-o.x, o.y), lod).rgb
    + textureLod(uColor, uv + vec2(o.x, -o.y), lod).rgb + textureLod(uColor, uv + vec2(-o.x, -o.y), lod).rgb);
}

vec4 sharp(sampler2D t, vec2 uv, vec2 size, vec2 px) {
  vec2 tx = uv * size;
  vec2 f = clamp((fract(tx - 0.5) - 0.5) / px + 0.5, 0.0, 1.0);
  return textureLod(t, (floor(tx - 0.5) + 0.5 + f) / size, 0.0);
}

// Where things meet, a little less light reaches: the foot of a wall, under someone's
// feet, the inside of a corner. Read off the depth: a pixel with nearer neighbours all
// round sits in a hollow. Twelve taps in a ring, kept small so it is a contact shade,
// not a halo.
float hollow(vec2 uv, float d) {
  float r = 0.011 * uOut.y / uOut.x;
  float occ = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236;
    vec2 o = vec2(cos(a) * r, sin(a) * 0.011);
    float s = dist(uv + o);
    float dz = d - s;
    occ += smoothstep(0.004, 0.02, dz / uFocus) * smoothstep(0.12, 0.03, dz / uFocus);
  }
  return occ / 12.0;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uOut;
  if (uMosaic > 1.0) uv = (floor(gl_FragCoord.xy / uMosaic) + 0.5) * uMosaic / uOut;
  vec3 col = textureLod(uColor, uv, 0.0).rgb;
  bool empty = uHasBack && texture(uDepth, uv).r >= 0.99999;
  // depth of field: what is nearer or further than the player softens
  float d = dist(uv);
  float off = (d - uFocus) / uFocus;
  float blur = (off > 0.0 ? smoothstep(uDofRange.x, uDofRange.y, off) : smoothstep(uDofRange.z, uDofRange.w, -off) * 0.6) * uDof;
  if (blur > 0.01) col = mix(col, soft(uv, 1.0 + blur * 2.2), smoothstep(0.0, 0.5, blur));
  if (!empty && uMosaic <= 1.0) col *= 1.0 - 0.45 * hollow(uv, d);
  // the distance: what is far takes the colour of the air between
  if (!empty) col = mix(col, uHaze, 0.3 * smoothstep(1.6, 4.5, d / uFocus));
  // nothing drawn here: the far layers (or the map's sky), soft as distance is
  if (empty) col = textureLod(uBack, vec2(uv.x, 1.0 - uv.y), 0.0).rgb;
  // bloom
  vec3 b = 0.5 * (soft(uv, 3.5) + soft(uv, 5.0));
  col += max(b - 0.78, 0.0) * 0.55;
  // grade and vignette
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 1.1);
  col *= mix(vec3(0.94, 0.97, 1.06), vec3(1.05, 1.0, 0.94), smoothstep(0.2, 0.8, lum));
  vec2 v = (uv - 0.5) * vec2(1.0, 1.1);
  col *= 1.0 - 0.35 * dot(v, v);
  // the console's own drawing, flat and sharp, over everything (premultiplied)
  vec2 s = vec2(uv.x, 1.0 - uv.y);
  vec4 ui = sharp(uUi, s, vec2(240.0, 160.0), vec2(240.0, 160.0) / uOut);
  outColor = vec4(clamp(col, 0.0, 1.0) * (1.0 - ui.a) + ui.rgb, 1.0);
}`;

// ---------- the renderer ----------

export class Hd {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
    if (!gl) return;
    this.scene = program(gl, SCENE_VS, SCENE_FS);
    this.shadowProg = program(gl, SCENE_VS, SHADOW_FS);
    this.post = program(gl, POST_VS, POST_FS);

    this.tri = gl.createVertexArray();
    gl.bindVertexArray(this.tri);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.staticGeo = geometry(gl);
    this.cardGeo = geometry(gl);
    // filtered: the scene shader snaps to texel centres itself (pix), so pixels stay
    // crisp and only their edges blend
    this.mapTex = texture(gl, gl.LINEAR, gl.LINEAR_MIPMAP_LINEAR);
    this.cardTex = texture(gl, gl.LINEAR, gl.LINEAR);
    this.uiTex = texture(gl, gl.LINEAR, gl.LINEAR);

    // the sun's view of the depth
    this.shadowTex = depthTexture(gl, SHADOW_SIZE, SHADOW_SIZE);
    this.shadowFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.decal = document.createElement('canvas');
    this.decalTex = texture(gl, gl.LINEAR, gl.LINEAR);
    this.decalGeo = geometry(gl);
    this.back = canvas(240, 160);
    this.backTex = texture(gl, gl.LINEAR, gl.LINEAR);
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    // the most pixels the region's picture may have: on a phone or a tablet, 4096 x 4096.
    // iOS refuses a bigger canvas (16,777,216 pixels) and the tab goes down with it; a city's
    // districts joined edge to edge (6240 x 4480) passed maxTex and closed the game there
    this.maxPicture = COARSE?.matches ? 4096 * 4096 : Infinity;
    this.bodies = new WeakMap();
    this.bodyList = [];
    this.atlas = document.createElement('canvas');
    // big enough for a street of buildings; past it, a card is left out (a warning says so)
    this.atlasSize = 2048;
    this.atlas.width = this.atlas.height = this.atlasSize;
    this.lights = new Float32Array(MAX_LIGHTS * 4);
    this.colors = new Float32Array(MAX_LIGHTS * 4);
    this.dirs = new Float32Array(MAX_LIGHTS * 4);
    this.ok = true;
  }

  // The canvas is as big as the screen it is shown on, up to about 1.6 million pixels; on
  // a phone (a coarse pointer, the short side under 600 CSS pixels, as engine/shell.js
  // tells one) up to 0.7 million: pixel art needs no more, and every pass below runs once
  // per pixel of it, sixty times a second, on a battery.
  size(w, h) {
    const phone = COARSE?.matches && Math.min(innerWidth, innerHeight) < 600;
    const k = Math.min(1, Math.sqrt((phone ? 0.7e6 : 1.6e6) / (w * h)));
    w = Math.round(w * k);
    h = Math.round(h * k);
    if (this.canvas.width === w && this.canvas.height === h && this.colorTex) return;
    this.canvas.width = w;
    this.canvas.height = h;
    const gl = this.gl;
    if (this.colorTex) { gl.deleteTexture(this.colorTex); gl.deleteTexture(this.depthTex); gl.deleteFramebuffer(this.fb); }
    this.colorTex = texture(gl, gl.LINEAR, gl.LINEAR_MIPMAP_LINEAR);
    gl.texStorage2D(gl.TEXTURE_2D, 1 + Math.floor(Math.log2(Math.max(w, h))), gl.RGBA8, w, h);
    this.depthTex = depthTexture(gl, w, h);
    this.fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // The camera on the world's own camera: at the middle of what it would show.
  // A script may turn it (world.cam3d, api.view3d: yaw, pitch, zoom), and a zoom of the
  // visual effects (api.zoom) is a dolly towards its point.
  aim(world, aspect = this.cam?.aspect ?? 1.5) {
    if (world.thirdPerson) return this.behind(world, aspect);
    let tx = world.cam.x + world.viewW / 2;
    let tz = world.cam.y + world.viewH / 2;
    const v = world.cam3d || {};
    let zoom = v.zoom ?? 1;
    const fx = world.vfx;
    if (fx && fx.zoom > 1.001) {
      const p = fx.point(fx.zoomAt);
      const k = Math.min(1, (fx.zoom - 1) * 1.5);
      if (p) { tx += (p.x - tx) * k; tz += (p.y + 8 - tz) * k; }
      zoom *= fx.zoom;
    }
    // straight over the map, unless a script is shooting the diorama as a film (api.view3d)
    const film = (v.yaw ?? 0) !== 0 || (v.pitch ?? PITCH_DEG) !== PITCH_DEG;
    if (overhead && !film) return this.over(tx, tz, aspect, world.viewW / 2 / Math.max(0.2, zoom));
    return this.camera(tx, tz, aspect, { yaw: v.yaw ?? 0, pitch: v.pitch ?? PITCH_DEG, zoom });
  }

  // The view from above: an orthographic camera at 45 degrees, squeezed down the screen by
  // as much as it leans, so a step north on the ground and a step up a wall are each a
  // pixel up the screen, as the 3/4 art draws them. The ground lies as in the classic look
  // (the point it looks at is the middle of the classic screen) and a wall's face, stood up
  // at its south edge, covers the rows its picture takes (diorama.js pushes the tops back
  // over them). `across`: half the width it takes in, in map pixels.
  over(tx, tz, aspect, across) {
    const k = Math.SQRT1_2;
    const dist = 370;                  // what the hollows and the haze are measured against
    const target = [tx, 0, tz];
    const eye = [tx, dist * k, tz + dist * k];
    const hw = across;
    const hh = (across / aspect) * k;
    const near = 20;
    const far = dist * 3;
    const view = lookAt(eye, target, [0, 1, 0]);
    const proj = ortho(-hw, hw, -hh, hh, near, far);
    this.cam = { eye, target, dist, near, far, aspect, vp: mul(proj, view), ortho: [hw, hh] };
    return this.cam;
  }

  // The camera looking at a point of the map (map pixels, the ground under the player),
  // from `yaw` degrees round it (0: from the south), `pitch` degrees over the horizon.
  camera(tx, tz, aspect, { yaw = 0, pitch = PITCH_DEG, zoom = 1 } = {}) {
    const fovX = 2 * Math.atan(Math.tan(FOV_Y / 2) * aspect);
    const dist = ACROSS / 2 / Math.tan(fovX / 2) / Math.max(0.2, zoom);
    const target = [tx, 8, tz];
    const pr = (pitch * Math.PI) / 180;
    const yr = (yaw * Math.PI) / 180;
    const h = dist * Math.cos(pr);
    const eye = [tx + h * Math.sin(yr), 8 + dist * Math.sin(pr), tz + h * Math.cos(yr)];
    const near = Math.max(4, dist * 0.2);
    const far = dist * 8;
    const view = lookAt(eye, target, [0, 1, 0]);
    const proj = perspective(FOV_Y, aspect, near, far);
    this.cam = { eye, target, dist, near, far, aspect, vp: mul(proj, view) };
    return this.cam;
  }

  // Third person: the camera from behind and over the player (viewpoint), on the ground's
  // own height under them, looking the way they face with the raycaster's width of view
  // (engine/thirdperson.js), tipped down by the viewpoint's tilt so their feet keep their
  // row; the player is what is in focus.
  behind(world, aspect) {
    const v = viewpoint(world);
    const [fx, fz] = forward(v.h);
    const eye = [v.x, v.lift + v.eye, v.y];
    const ct = Math.cos(v.tilt);
    const st = Math.sin(v.tilt);
    const dist = Math.max(24, Math.hypot(v.back, v.eye));
    const target = [eye[0] + fx * ct * dist, eye[1] - st * dist, eye[2] + fz * ct * dist];
    const fovY = 2 * Math.atan(Math.tan(GROUND_FOV / 2) / aspect);
    const near = 2;
    const far = 4000;
    const view = lookAt(eye, target, [0, 1, 0]);
    const proj = perspective(fovY, aspect, near, far);
    this.cam = { eye, target, dist, near, far, aspect, vp: mul(proj, view), ground: true, heading: v.h };
    return this.cam;
  }

  // The cells of the region the camera sees the ground in (hd.render: a frame of
  // animation), a little past the screen's edges, or null.
  seenCells(world, R, ground) {
    let x0;
    let y0;
    let x1;
    let y1;
    const corners = ground ? [] : [[0, 0], [240, 0], [0, 160], [240, 160]].map(([sx, sy]) => this.pick(sx, sy));
    if (corners.length && corners.every(Boolean)) {
      // raised ground and what stands on it reach a little past where the corners fall
      const m = 2 + Math.ceil((world.maxElev || 0) / TILE);
      x0 = Math.floor(Math.min(...corners.map((p) => p.x)) / TILE) - m;
      x1 = Math.ceil(Math.max(...corners.map((p) => p.x)) / TILE) + m;
      y0 = Math.floor(Math.min(...corners.map((p) => p.y)) / TILE) - m;
      y1 = Math.ceil(Math.max(...corners.map((p) => p.y)) / TILE) + m + 4;
    } else {
      const pl = world.player;
      const cx = Math.floor((pl ? pl.px + TILE / 2 : world.cam.x + world.viewW / 2) / TILE);
      const cy = Math.floor((pl ? pl.py + TILE / 2 : world.cam.y + world.viewH / 2) / TILE);
      x0 = cx - ANIM_GROUND; x1 = cx + ANIM_GROUND; y0 = cy - ANIM_GROUND; y1 = cy + ANIM_GROUND;
    }
    const win = { x0: Math.max(R.x0, x0), y0: Math.max(R.y0, y0), x1: Math.min(R.x1, x1), y1: Math.min(R.y1, y1) };
    return win.x1 > win.x0 && win.y1 > win.y0 ? win : null;
  }

  // Where a point of the map (map pixels, y up) is on the 240x160 screen.
  project(x, y, z) {
    const m = this.cam.vp;
    const v = [0, 1, 2, 3].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
    return { x: ((v[0] / v[3] + 1) / 2) * 240, y: ((1 - v[1] / v[3]) / 2) * 160 };
  }

  // Where a point of the 240x160 screen lands on the ground, in map pixels.
  pick(sx, sy) {
    const c = this.cam;
    if (!c) return null;
    const f = norm(sub(c.target, c.eye));
    const r = norm(cross(f, [0, 1, 0]));
    const u = cross(r, f);
    const ty = Math.tan(FOV_Y / 2);
    const nx = (sx / 240) * 2 - 1;
    const ny = 1 - (sy / 160) * 2;
    if (c.ortho) {
      // every ray the same way, from its own point of the screen
      const o = add(c.eye, add(scale(r, nx * c.ortho[0]), scale(u, ny * c.ortho[1])));
      const t = -o[1] / f[1];
      return { x: o[0] + f[0] * t, y: o[2] + f[2] * t };
    }
    const d = add(f, add(scale(r, nx * ty * c.aspect), scale(u, ny * ty)));
    if (d[1] >= 0) return null;
    const t = -c.eye[1] / d[1];
    return { x: c.eye[0] + d[0] * t, y: c.eye[2] + d[2] * t };
  }

  // frame: { world, frame, region, walls, third } (world.drawHd): `walls` builds a map
  // made for the ground view as the raycaster stands it (walls with every face, a
  // ceiling), `third` an ordinary map as the diorama seen from any side; ui: the 240x160
  // buffer with the console's drawing.
  render({ world, frame, region: R, walls = false, third = false }, ui) {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const e = world.engine;
    const ground = walls || third;   // seen from the ground: the camera turns with the player

    // the region's picture and its geometry, again when a tile or the animation changes
    const key = `${groundKey(world, R)}${walls ? ':walls' : third ? ':third' : ''}`;
    if (key !== this.key) {
      this.key = key;
      this.staticCount = upload(gl, this.staticGeo, buildStatic(world, R, { walls, third }));
      this.animF = null;
    }
    this.ground = ground;
    const c = this.aim(world, W / H);
    const animF = Math.floor(frame / (world.map.animRate || 20));
    const propsNow = world.props !== this.propsSeen || world.props.length !== this.propsN;
    if (this.animF === null || propsNow || (animF !== this.animF && R.w * R.h <= WHOLE_PICTURE)) {
      this.animF = animF;
      this.propsSeen = world.props;
      this.propsN = world.props.length;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.mapTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture(world, R, animF, canvas));
      gl.generateMipmap(gl.TEXTURE_2D);
    } else if (animF !== this.animF) {
      // a big region (a map with its neighbours): a frame of animation is drawn again only
      // where the camera sees the ground and sent into the picture there; the rest keeps
      // its frame, as do the smaller pictures the distance samples. The whole picture was
      // tens of megabytes drawn and sent three times a second.
      this.animF = animF;
      const win = animates(world, R, `${key}:${world.props.length}`) && this.seenCells(world, R, ground);
      if (win) {
        const make = (w, h) => {
          if (this.animPic?.width !== w || this.animPic?.height !== h) this.animPic = canvas(w, h);
          return this.animPic;
        };
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.mapTex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, (win.x0 - R.x0) * TILE, (win.y0 - R.y0) * TILE, gl.RGBA, gl.UNSIGNED_BYTE, picture(world, R, animF, make, win));
      }
    }
    const cardList = [...gatherCards(world, frame, R), ...world.hdEntityCards(e)];
    this.cardCount = upload(gl, this.cardGeo, this.cards(cardList));

    // what lies on the floor this frame, over the view and well past its top edge (the
    // camera sees further up than the classic screen; the eyes see further all round)
    const side = ground ? 256 : DECAL_SIDE;
    const dx = Math.round(world.cam.x) - side;
    const dy = Math.round(world.cam.y) - (ground ? side : DECAL_TOP);
    const dw = world.viewW + side * 2;
    const dh = world.viewH + (ground ? side : DECAL_TOP) + side;
    if (this.decal.width !== dw || this.decal.height !== dh) { this.decal.width = dw; this.decal.height = dh; }
    const dctx = this.decal.getContext('2d');
    dctx.clearRect(0, 0, dw, dh);
    dctx.imageSmoothingEnabled = false;
    world.drawHdDecal(dctx, e, dx, dy, dw, dh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.decalTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.decal);
    const ly = 0.3;
    upload(gl, this.decalGeo, new Float32Array([
      dx, ly, dy, 0, 0, 0, 1, 0, dx + dw, ly, dy, 1, 0, 0, 1, 0, dx + dw, ly, dy + dh, 1, 1, 0, 1, 0,
      dx, ly, dy, 0, 0, 0, 1, 0, dx + dw, ly, dy + dh, 1, 1, 0, 1, 0, dx, ly, dy + dh, 0, 1, 0, 1, 0,
    ]));

    // the far layers, where there is no ground (and the sky the ground views get by default)
    this.hasBack = !!world.map.parallax?.length || !!world.hdSky(e);
    if (this.hasBack) {
      const bctx = this.back.getContext('2d');
      world.drawHdBackdrop(bctx, e);
      gl.bindTexture(gl.TEXTURE_2D, this.backTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.back);
    }
    const lightVP = this.sunView(c.target);

    // 1. the sun's depth
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.shadowProg.p);
    gl.uniformMatrix4fv(this.shadowProg.u.uVP, false, lightVP);
    gl.uniformMatrix4fv(this.shadowProg.u.uLightVP, false, lightVP);
    this.drawAll(this.shadowProg, planes(lightVP));

    // 2. the scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, W, H);
    const bg = rgb(world.map.void || '#000000');
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const s = this.scene;
    gl.useProgram(s.p);
    gl.uniformMatrix4fv(s.u.uVP, false, c.vp);
    gl.uniformMatrix4fv(s.u.uLightVP, false, lightVP);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(s.u.uShadow, 1);
    gl.uniform3fv(s.u.uToSun, scale(SUN, -1));
    const look = world.hdLight(frame);
    gl.uniform3fv(s.u.uSun, look.sun);
    gl.uniform3fv(s.u.uAmbient, look.ambient);
    gl.uniform3fv(s.u.uGrade, look.grade);
    gl.uniform4fv(s.u.uDark, look.dark);
    const n = Math.min(MAX_LIGHTS, look.lights.length);
    for (let i = 0; i < n; i++) {
      const l = look.lights[i];
      const f = l.flicker ? 1 + Math.sin(frame * 0.3 + i * 1.7) * 0.04 * l.flicker : 1;
      this.lights.set([l.x, l.z ?? 12, l.y, l.r * 1.4 * f], i * 4);
      const k = rgb(l.color || '#ffd890');
      this.colors.set([k[0], k[1], k[2], l.glow ?? 0.6], i * 4);
      if (l.cone) { const [bx, bz] = forward(l.heading ?? 0); this.dirs.set([bx, bz, Math.cos(l.cone / 2), 1], i * 4); } else this.dirs.set([0, 0, 0, 0], i * 4);
    }
    gl.uniform1i(s.u.uN, n);
    gl.uniform4fv(s.u.uLight, this.lights);
    gl.uniform4fv(s.u.uLightColor, this.colors);
    gl.uniform4fv(s.u.uLightDir, this.dirs);
    // from the ground the dark is a fog that thickens with the distance from the eyes; in
    // third person, from the player, not the camera behind them
    const see = world.thirdPerson && world.player;
    const pl = world.player;
    const at = see ? [pl.px + 8 + (pl.ox || 0), 12 + (world.raised ? pl.ez || 0 : 0), pl.py + 12 + (pl.oy || 0)] : c.eye;
    gl.uniform3fv(s.u.uEye, at);
    gl.uniform1f(s.u.uFogFar, ground ? (world.map.fog ?? world.game.fog ?? 7) * TILE : 0);
    gl.uniform3fv(s.u.uSeeFrom, c.eye);
    if (see) gl.uniform3fv(s.u.uSeeTo, at);
    gl.uniform1f(s.u.uSee, see ? 26 : 0);
    this.near = ground ? 28 : 0;
    this.drawAll(s, planes(c.vp));
    // the floor's picture, blended over it
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1i(s.u.uDecal, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.decalTex);
    gl.bindVertexArray(this.decalGeo.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.uniform1i(s.u.uDecal, 0);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // 3. the screen: depth of field, bloom, the console's drawing
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.backTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.uiTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ui);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const p = this.post;
    gl.useProgram(p.p);
    gl.uniform1i(p.u.uColor, 0);
    gl.uniform1i(p.u.uDepth, 1);
    gl.uniform1i(p.u.uUi, 2);
    gl.uniform1i(p.u.uBack, 3);
    gl.uniform1i(p.u.uHasBack, this.hasBack ? 1 : 0);
    gl.uniform2f(p.u.uOut, W, H);
    gl.uniform2f(p.u.uClip, c.near, c.far);
    gl.uniform1i(p.u.uOrtho, c.ortho ? 1 : 0);
    gl.uniform1f(p.u.uFocus, c.dist);
    // depth of field: round the player from above; from behind them only the far distance
    // softens, a little
    gl.uniform1f(p.u.uDof, ground ? TP_DOF : c.ortho ? 0 : 1);
    gl.uniform4fv(p.u.uDofRange, ground ? TP_DOF_RANGE : TOP_DOF_RANGE);
    gl.uniform3fv(p.u.uHaze, look.haze || [0, 0, 0]);
    // a fade in blocks: the picture itself breaks up here, the colour comes from the buffer
    const fx = e.fx;
    const mosaic = fx.fadeKind === 'mosaic' && fx.fade > 0 && fx.fade < 1 ? Math.round(Math.min(1, fx.fade / 0.75) * 16) * (W / 240) : 0;
    gl.uniform1f(p.u.uMosaic, mosaic);
    gl.viewport(0, 0, W, H);
    gl.bindVertexArray(this.tri);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // `seen`: the planes of what this pass sees (planes()); a body wholly outside them is
  // not drawn. A map with its neighbours stands hundreds of them, each its own mesh of
  // thousands of points, most of them far off the screen and out of the sun's square.
  drawAll(prog, seen = null) {
    const gl = this.gl;
    gl.uniform1i(prog.u.uTex, 0);
    if (prog.u.uThin) gl.uniform1f(prog.u.uThin, 0.85);
    if (prog.u.uNear) gl.uniform1f(prog.u.uNear, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.mapTex);
    gl.bindVertexArray(this.staticGeo.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.staticCount);
    // what stands (cards and bodies) thins out right at the camera
    if (prog.u.uNear) gl.uniform1f(prog.u.uNear, this.near || 0);
    gl.bindTexture(gl.TEXTURE_2D, this.cardTex);
    gl.bindVertexArray(this.cardGeo.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.cardCount);
    // the bodies, each its own mesh and picture, kept while its frame of animation lives
    // from the ground every body turns to face the camera, about the middle of its width
    const turn = this.ground && this.cam?.ground ? this.cam.heading : 0;
    gl.uniform2f(prog.u.uTurn, Math.cos(turn), Math.sin(turn));
    for (const c of this.bodyList) {
      if (seen && !inside(seen, c)) continue;
      const b = this.body(c.img, c.depth, c.shape);
      gl.uniform3f(prog.u.uOffset, c.x, c.y, c.lie ? c.z + c.h : c.z);
      gl.uniform1i(prog.u.uLie, c.lie ? 1 : 0);
      const player = !!c.actor && c.actor === c.actor.world.player;
      if (prog.u.uThin) gl.uniform1f(prog.u.uThin, c.actor ? (player ? 0 : 0.55) : 0.85);
      if (prog.u.uNear && this.near) gl.uniform1f(prog.u.uNear, player ? 48 : this.near);
      gl.uniform1f(prog.u.uPivot, c.lie ? 0 : c.w / 2);
      // a body lying down, or something big that stands as it is (gatherCards), never turns
      if (c.lie || c.still) gl.uniform2f(prog.u.uTurn, 1, 0); else gl.uniform2f(prog.u.uTurn, Math.cos(turn), Math.sin(turn));
      gl.bindTexture(gl.TEXTURE_2D, b.tex);
      gl.bindVertexArray(b.geo.vao);
      gl.drawArrays(gl.TRIANGLES, 0, b.count);
    }
    gl.uniform3f(prog.u.uOffset, 0, 0, 0);
    gl.uniform1i(prog.u.uLie, 0);
    if (prog.u.uThin) gl.uniform1f(prog.u.uThin, 0.85);
    if (prog.u.uNear) gl.uniform1f(prog.u.uNear, 0);
    gl.uniform2f(prog.u.uTurn, 1, 0);
  }

  body(img, depth = 8, shape = 'round') {
    let byShape = this.bodies.get(img);
    if (!byShape) this.bodies.set(img, (byShape = new Map()));
    const key = `${depth}:${shape}`;
    let b = byShape.get(key);
    if (!b) {
      const gl = this.gl;
      b = { geo: geometry(gl), tex: texture(gl, gl.LINEAR, gl.LINEAR) };
      b.count = upload(gl, b.geo, bodyMesh(img, depth, shape));
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      byShape.set(key, b);
    }
    return b;
  }

  sunView(t) {
    const eye = sub(t, scale(SUN, 600));
    const view = lookAt(eye, t, [0, 0, -1]);
    return mul(ortho(-SHADOW_SPAN, SHADOW_SPAN, -SHADOW_SPAN, SHADOW_SPAN, 100, 1100), view);
  }

  // The cards of this frame packed into one picture, and their quads. The same pictures in
  // the same order pack the same way, so the picture is drawn and sent to the GPU again
  // only when they change (a frame of animation, someone new on screen): sending its 16 MB
  // every frame was the modern look's single biggest cost.
  cards(list) {
    const ctx = this.atlas.getContext('2d');
    const S = this.atlasSize;
    const ids = (this.atlasIds ||= new WeakMap());
    let sig = '';
    let fresh = false;
    for (const c of list) if (!c.body) { let k = ids.get(c.img); if (k === undefined) { k = this.atlasN = (this.atlasN || 0) + 1; ids.set(c.img, k); } sig += `${k},`; fresh ||= !!c.fresh; }
    // a `fresh` card is drawn again into the same canvas every frame (world.hdEntityCards)
    const same = !fresh && sig === this.atlasSig;
    this.atlasSig = sig;
    if (!same) ctx.clearRect(0, 0, S, S);
    const placed = new Map();
    let x = 1;
    let y = 1;
    let row = 0;
    const out = [];
    this.bodyList = list.filter((c) => c.body);
    for (const c of list) {
      if (c.body) continue;
      // a prop lying down keeps the block of its own (beds); vehicles are bodies
      let at = placed.get(c.img);
      if (!at) {
        if (x + c.w + 1 > S) { x = 1; y += row + 2; row = 0; }
        if (y + c.h + 1 > S) { if (!this.warnedFull) { this.warnedFull = true; console.warn('[luma] modern look: too many props on screen for one picture; some are left out'); } continue; }
        at = { x, y };
        if (!same) ctx.drawImage(c.img, x, y);
        placed.set(c.img, at);
        x += c.w + 2;
        row = Math.max(row, c.h);
      }
      const u0 = at.x / S;
      const u1 = (at.x + c.w) / S;
      const v0 = at.y / S;
      const v1 = (at.y + c.h) / S;
      const x0 = c.x;
      const x1 = c.x + c.w;
      const y0 = c.y;
      const y1 = c.y + c.h;
      if (c.box) {
        // a box: the façade (the picture under its roof rows) standing at the front, the
        // roof laid on top back to `depth`, the sides the façade's edge columns carried
        const q = (pts, n) => { for (const [px, py, pz, u, v] of pts) out.push(px, py, pz, u, v, ...n); };
        const hf = c.h - c.roof;
        const zf = c.z;
        const zb = c.z - c.depth;
        const yt = c.y + hf;
        const vr = (at.y + c.roof) / S;
        const ul = (at.x + 0.5) / S;
        const ur = (at.x + c.w - 0.5) / S;
        q([[x0, yt, zf, u0, vr], [x1, yt, zf, u1, vr], [x1, c.y, zf, u1, v1], [x0, yt, zf, u0, vr], [x1, c.y, zf, u1, v1], [x0, c.y, zf, u0, v1]], [0, 0, 1]);
        if (c.roof > 0) q([[x0, yt, zb, u0, v0], [x1, yt, zb, u1, v0], [x1, yt, zf, u1, vr], [x0, yt, zb, u0, v0], [x1, yt, zf, u1, vr], [x0, yt, zf, u0, vr]], [0, 1, 0]);
        for (const [ex, u, nx] of [[x0, ul, -1], [x1, ur, 1]]) {
          q([[ex, yt, zb, u, vr], [ex, yt, zf, u, vr], [ex, c.y, zf, u, v1], [ex, yt, zb, u, vr], [ex, c.y, zf, u, v1], [ex, c.y, zb, u, v1]], [nx, 0, 0]);
        }
        // the back, so a turned camera never looks into it
        q([[x1, yt, zb, u0, vr], [x0, yt, zb, u1, vr], [x0, c.y, zb, u1, v1], [x1, yt, zb, u0, vr], [x0, c.y, zb, u1, v1], [x1, c.y, zb, u0, v1]], [0, 0, -1]);
        continue;
      }
      if (c.lie) {
        // a low block: the picture on top, its bottom row and edge columns carried down
        const zt = c.z - c.h;
        const yt = c.y + c.lie;
        const vb = (at.y + c.h - 0.5) / S;
        const ul = (at.x + 0.5) / S;
        const ur = (at.x + c.w - 0.5) / S;
        const q = (pts, n) => { for (const [px, py, pz, u, v] of pts) out.push(px, py, pz, u, v, ...n); };
        q([[x0, yt, zt, u0, v0], [x1, yt, zt, u1, v0], [x1, yt, c.z, u1, v1], [x0, yt, zt, u0, v0], [x1, yt, c.z, u1, v1], [x0, yt, c.z, u0, v1]], [0, 1, 0]);
        q([[x0, yt, c.z, u0, vb], [x1, yt, c.z, u1, vb], [x1, c.y, c.z, u1, vb], [x0, yt, c.z, u0, vb], [x1, c.y, c.z, u1, vb], [x0, c.y, c.z, u0, vb]], [0, 0, 1]);
        for (const [ex, u, nx] of [[x0, ul, -1], [x1, ur, 1]]) {
          q([[ex, yt, zt, u, v0], [ex, yt, c.z, u, v1], [ex, c.y, c.z, u, v1], [ex, yt, zt, u, v0], [ex, c.y, c.z, u, v1], [ex, c.y, zt, u, v0]], [nx, 0, 0]);
        }
        continue;
      }
      const z = c.z;
      if (this.ground && this.cam?.ground) {
        // turned to face the camera, about its middle
        const h = this.cam.heading;
        const rx = Math.cos(h) * (c.w / 2);
        const rz = Math.sin(h) * (c.w / 2);
        const cx = (x0 + x1) / 2;
        const n = [-Math.sin(h), 0.4, Math.cos(h)];
        for (const [sx, py, u, v] of [[-1, y1, u0, v0], [1, y1, u1, v0], [1, y0, u1, v1], [-1, y1, u0, v0], [1, y0, u1, v1], [-1, y0, u0, v1]]) out.push(cx + sx * rx, py, z + sx * rz, u, v, ...n);
        continue;
      }
      const n = [0, 0.6, 0.8];
      for (const [px, py, u, v] of [[x0, y1, u0, v0], [x1, y1, u1, v0], [x1, y0, u1, v1], [x0, y1, u0, v0], [x1, y0, u1, v1], [x0, y0, u0, v1]]) out.push(px, py, z, u, v, ...n);
    }
    if (!same) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.cardTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas);
    }
    return new Float32Array(out);
  }
}

// ---------- GL plumbing ----------

function program(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

function geometry(gl) {
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 20);
  gl.bindVertexArray(null);
  return { vao, buf };
}

function upload(gl, geo, data) {
  gl.bindBuffer(gl.ARRAY_BUFFER, geo.buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  return data.length / 8;
}

function texture(gl, mag, min) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function depthTexture(gl, w, h) {
  const t = texture(gl, gl.NEAREST, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  return t;
}

const colours = new Map();
function rgb(c) {
  let v = colours.get(c);
  if (!v) {
    const h = String(c).replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h.slice(0, 6), 16) || 0;
    v = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    colours.set(c, v);
  }
  return v;
}

// ---------- a little linear algebra (column-major, as GL reads it) ----------

// The six planes of a view (left, right, bottom, top, near, far) from its matrix, each
// normalised (a b c d: a point is in front when a x + b y + c z + d >= 0).
function planes(m) {
  const row = (r) => [m[r], m[4 + r], m[8 + r], m[12 + r]];
  const w = row(3);
  const out = [];
  for (const r of [0, 1, 2]) {
    const a = row(r);
    for (const s of [1, -1]) {
      const p = [w[0] + s * a[0], w[1] + s * a[1], w[2] + s * a[2], w[3] + s * a[3]];
      const l = Math.hypot(p[0], p[1], p[2]) || 1;
      out.push(p.map((v) => v / l));
    }
  }
  return out;
}

// Whether a body (a card of gatherCards) may reach into a view: a ball round all it can
// take up, turned to the camera or lying down, against each plane.
function inside(seen, c) {
  // lying down (SCENE_VS, uLie) its picture runs back from z by its height, its depth
  // stands up a little over y
  const d = c.depth || 8;
  const z = c.lie ? c.z + c.h / 2 : c.z;
  const x = c.x + c.w / 2;
  const y = c.lie ? c.y + 5 : c.y + c.h / 2;
  const r = (c.w + c.h + d * 1.4) / 2 + 8;
  for (const p of seen) if (p[0] * x + p[1] * y + p[2] * z + p[3] < -r) return false;
  return true;
}

function norm(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function perspective(fovy, aspect, n, f) {
  const t = 1 / Math.tan(fovy / 2);
  return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]);
}

function ortho(l, r, b, t, n, f) {
  return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
}

function lookAt(eye, target, up) {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}


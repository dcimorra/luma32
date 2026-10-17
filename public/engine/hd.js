// The modern look (a setting, on unless the player chose classic): the same world, the
// same pixel art and the same rules, shown as a diorama in three dimensions.
// engine/diorama.js builds the map from what it already says (ground, walls with their
// faces stood up, heights, props and people as cards); this draws it with WebGL 2 under a
// perspective camera: a sun that casts shadows, the map's lights, depth of field from the
// real depth, a bloom, and the console's own drawing (dialogue, menus, HUD, fades) flat on top, at the screen's
// resolution. Nothing a cartridge writes changes: a game cannot tell which look it is in.
import { buildStatic, gatherCards, groundKey, bodyMesh, picture } from './diorama.js';
import { forward, viewpoint } from './firstperson.js';
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
const SHADOW_SIZE = 2048;
const SHADOW_SPAN = 300;               // map pixels around the camera's target
const DECAL_SIDE = 64;                 // the floor's picture reaches this far past the view
const DECAL_TOP = 200;                 // and this far above it
// first person: the eyes, in map pixels over the floor, and how wide they see
const FP_EYE = 16;
const FP_FOV = (66 * Math.PI) / 180;
const FP_FOCUS = 100;                  // the sun's shadows and the sharp distance sit this far ahead

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

// ---------- shaders ----------

const SCENE_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUv;
layout(location = 2) in vec3 aN;
uniform mat4 uVP;
uniform mat4 uLightVP;
uniform vec3 uOffset;   // where a body stands (zero for the map and the cards)
uniform bool uLie;      // a body seen from above (a vehicle): its picture lies on the ground
uniform vec2 uTurn;     // first person: cos and sin of the turn a body makes to face the eyes
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
uniform vec3 uEye;      // first person: where the eyes are
uniform float uFogFar;  // and how far the dark reaches its full (0: the dark is everywhere, as in the classic look)
uniform vec3 uSeeFrom;  // third person: the camera, and the player it must always see:
uniform vec3 uSeeTo;    // whatever stands between them thins out round the line between,
uniform float uSee;     // this wide at the player (map pixels; 0 off)
uniform bool uWhole;    // the player's own body: never thinned
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
  if (uSee > 0.0 && !uWhole && vP.y > 3.0) {
    vec3 ab = uSeeTo - uSeeFrom;
    float len = length(ab);
    vec3 d = ab / len;
    float along = dot(vP - uSeeFrom, d);
    if (along > 0.0 && along < len - 4.0) {
      float r = uSee * (0.35 + 0.65 * along / len);
      float k = 1.0 - smoothstep(r * 0.55, r, length(vP - uSeeFrom - d * along));
      if (k * 0.85 > bayer(gl_FragCoord.xy)) discard;
    }
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
uniform float uFocus;   // the distance in focus: the camera's target
uniform float uDof;     // how much what is off the focus softens (0 in first person)
uniform vec3 uHaze;     // the colour of the distance: the sky's foot, or the dark
uniform float uMosaic;  // a fade in blocks (engine.js): their size in screen pixels, or 0
out vec4 outColor;

float dist(vec2 uv) {
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
  float blur = (off > 0.0 ? smoothstep(0.06, 0.4, off) : smoothstep(0.1, 0.3, -off) * 0.6) * uDof;
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

  // The canvas is as big as the screen it is shown on, up to about 1.6 million pixels.
  size(w, h) {
    const k = Math.min(1, Math.sqrt(1.6e6 / (w * h)));
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
    if (world.firstPerson) return this.eyes(world, aspect);
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
    return this.camera(tx, tz, aspect, { yaw: v.yaw ?? 0, pitch: v.pitch ?? PITCH_DEG, zoom });
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

  // First person: the camera at the player's eyes, looking the way they face, with the
  // raycaster's width of view (engine/firstperson.js); what the sun's shadows and the
  // sharp distance are about sits a little way ahead.
  // Third person: the same camera from behind and over the player (viewpoint), tipped
  // down as much as the raycaster's lowered horizon.
  eyes(world, aspect) {
    const v = viewpoint(world);
    const h = v.h;
    const [fx, fz] = forward(h);
    const eye = [v.x, world.thirdPerson ? v.eye : FP_EYE, v.y];
    const drop = (FP_FOCUS * v.pitch) / (120 / Math.tan(FP_FOV / 2));
    const target = [eye[0] + fx * FP_FOCUS, eye[1] - drop, eye[2] + fz * FP_FOCUS];
    const fovY = 2 * Math.atan(Math.tan(FP_FOV / 2) / aspect);
    const near = 2;
    const far = 4000;
    const view = lookAt(eye, target, [0, 1, 0]);
    const proj = perspective(fovY, aspect, near, far);
    this.cam = { eye, target, dist: FP_FOCUS, near, far, aspect, vp: mul(proj, view), first: true, heading: h };
    return this.cam;
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
    const d = add(f, add(scale(r, nx * ty * c.aspect), scale(u, ny * ty)));
    if (d[1] >= 0) return null;
    const t = -c.eye[1] / d[1];
    return { x: c.eye[0] + d[0] * t, y: c.eye[2] + d[2] * t };
  }

  // frame: { world, frame, light }; ui: the 240x160 buffer with the console's drawing.
  render({ world, frame, region: R, first = false }, ui) {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const e = world.engine;

    // the region's picture and its geometry, again when a tile or the animation changes
    const key = `${groundKey(world, R)}${first ? ':first' : ''}`;
    if (key !== this.key) {
      this.key = key;
      this.staticCount = upload(gl, this.staticGeo, buildStatic(world, R, { first }));
      this.animF = null;
    }
    this.first = first;
    const animF = Math.floor(frame / (world.map.animRate || 20));
    if (animF !== this.animF || world.props !== this.propsSeen) {
      this.animF = animF;
      this.propsSeen = world.props;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.mapTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture(world, R, animF, canvas));
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    const c = this.aim(world, W / H);
    // the player's own body is not before their eyes
    const cardList = [...gatherCards(world, frame, R), ...world.hdEntityCards(e)].filter((k) => !first || world.thirdPerson || k.actor !== world.player);
    this.cardCount = upload(gl, this.cardGeo, this.cards(cardList));

    // what lies on the floor this frame, over the view and well past its top edge (the
    // camera sees further up than the classic screen; the eyes see further all round)
    const side = first ? 256 : DECAL_SIDE;
    const dx = Math.round(world.cam.x) - side;
    const dy = Math.round(world.cam.y) - (first ? side : DECAL_TOP);
    const dw = world.viewW + side * 2;
    const dh = world.viewH + (first ? side : DECAL_TOP) + side;
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

    // the far layers, where there is no ground
    this.hasBack = !!world.map.parallax?.length || !!world.map.sky;
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
    this.drawAll(this.shadowProg);

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
    // first person: the dark is a fog that thickens with the distance from the eyes
    gl.uniform3fv(s.u.uEye, c.eye);
    gl.uniform1f(s.u.uFogFar, first ? (world.map.fog ?? world.game.fog ?? 7) * TILE : 0);
    const see = world.thirdPerson && world.player;
    if (see) {
      const p = world.player;
      gl.uniform3fv(s.u.uSeeFrom, c.eye);
      gl.uniform3f(s.u.uSeeTo, p.px + 8 + (p.ox || 0), 12, p.py + 12 + (p.oy || 0));
    }
    gl.uniform1f(s.u.uSee, see ? 26 : 0);
    this.drawAll(s);
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
    gl.uniform1f(p.u.uFocus, c.dist);
    gl.uniform1f(p.u.uDof, first ? 0 : 1);
    gl.uniform3fv(p.u.uHaze, look.haze || [0, 0, 0]);
    // a fade in blocks: the picture itself breaks up here, the colour comes from the buffer
    const fx = e.fx;
    const mosaic = fx.fadeKind === 'mosaic' && fx.fade > 0 && fx.fade < 1 ? Math.round(Math.min(1, fx.fade / 0.75) * 16) * (W / 240) : 0;
    gl.uniform1f(p.u.uMosaic, mosaic);
    gl.viewport(0, 0, W, H);
    gl.bindVertexArray(this.tri);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  drawAll(prog) {
    const gl = this.gl;
    gl.uniform1i(prog.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.mapTex);
    gl.bindVertexArray(this.staticGeo.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.staticCount);
    gl.bindTexture(gl.TEXTURE_2D, this.cardTex);
    gl.bindVertexArray(this.cardGeo.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.cardCount);
    // the bodies, each its own mesh and picture, kept while its frame of animation lives
    // in first person every body turns to face the eyes, about the middle of its width
    const turn = this.first && this.cam?.first ? this.cam.heading : 0;
    gl.uniform2f(prog.u.uTurn, Math.cos(turn), Math.sin(turn));
    for (const c of this.bodyList) {
      const b = this.body(c.img, c.depth, c.shape);
      gl.uniform3f(prog.u.uOffset, c.x, c.y, c.lie ? c.z + c.h : c.z);
      gl.uniform1i(prog.u.uLie, c.lie ? 1 : 0);
      if (prog.u.uWhole) gl.uniform1i(prog.u.uWhole, c.actor && c.actor === c.actor.world.player ? 1 : 0);
      gl.uniform1f(prog.u.uPivot, c.lie ? 0 : c.w / 2);
      // a body lying down, or something big that stands as it is (gatherCards), never turns
      if (c.lie || c.still) gl.uniform2f(prog.u.uTurn, 1, 0); else gl.uniform2f(prog.u.uTurn, Math.cos(turn), Math.sin(turn));
      gl.bindTexture(gl.TEXTURE_2D, b.tex);
      gl.bindVertexArray(b.geo.vao);
      gl.drawArrays(gl.TRIANGLES, 0, b.count);
    }
    gl.uniform3f(prog.u.uOffset, 0, 0, 0);
    gl.uniform1i(prog.u.uLie, 0);
    if (prog.u.uWhole) gl.uniform1i(prog.u.uWhole, 0);
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

  // The cards of this frame packed into one picture, and their quads.
  cards(list) {
    const ctx = this.atlas.getContext('2d');
    const S = this.atlasSize;
    ctx.clearRect(0, 0, S, S);
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
        ctx.drawImage(c.img, x, y);
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
      if (this.first && this.cam?.first) {
        // turned to face the eyes, about its middle
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
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cardTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas);
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


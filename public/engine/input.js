// Eight buttons, three sources: the on-screen pad, the keyboard and any gamepad.
// Games only ever see button names; `pressed` is true on the frame a button goes down.
// On a desktop or a tablet (shell.js, `pointerOn`) there is also the pointer: the mouse or
// a finger on the screen itself, in screen pixels, for the scenes that say `pointer = true`.
export const BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select'];

const KEYS = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  KeyZ: 'a', KeyK: 'a', Space: 'a',
  KeyX: 'b', KeyJ: 'b', Escape: 'b', Backspace: 'b',
  Enter: 'start', KeyP: 'start',
  ShiftLeft: 'select', ShiftRight: 'select', Tab: 'select',
};

const PAD = { 12: 'up', 13: 'down', 14: 'left', 15: 'right', 0: 'a', 1: 'b', 9: 'start', 8: 'select' };

// START or SELECT held this long is the console's own shortcut (`onHoldStart`,
// `onHoldSelect`), not a press.
const HOLD_MS = 700;
const HOLDS = { start: 'onHoldStart', select: 'onHoldSelect' };

export class Input {
  constructor() {
    this.sources = { key: new Set(), touch: new Set(), pad: new Set() };
    this.now = new Set();
    this.before = new Set();
    this.listeners = new Set();
    this.lastSource = 'touch';
    // per holdable button: when it went down and up, since which frame it is held, and
    // whether the hold already fired
    // the direction as a vector at any angle, x right and y down, length up to 1: the touch
    // pad's (shell.js), else a gamepad's left stick, else the arrows held (a diagonal is
    // two). Rebuilt by update(); the four buttons stay as they were, for whoever reads them.
    this.stick = { x: 0, y: 0 };
    this.analog = { touch: null, pad: null };
    this.holds = Object.fromEntries(Object.keys(HOLDS).map((b) => [b, { down: null, up: null, since: null, held: false }]));

    addEventListener('keydown', (e) => {
      const b = KEYS[e.code];
      if (!b || e.metaKey || e.ctrlKey || e.altKey) return;
      // typing in a form over the console (the account dialog) is not playing
      if (e.target.closest?.('input, textarea, select, dialog')) return;
      e.preventDefault();
      this.lastSource = 'key';
      if (this.holds[b] && !this.sources.key.has(b)) this.holds[b].down ??= performance.now();
      this.sources.key.add(b);
      // a key let go before the next frame still counts once
      (this.taps ||= new Set()).add(b);
      this.emit(b);
    });
    addEventListener('keyup', (e) => {
      const b = KEYS[e.code];
      if (!b) return;
      if (this.holds[b]) this.holds[b].up = performance.now();
      this.sources.key.delete(b);
    });
    addEventListener('blur', () => { this.sources.key.clear(); this.sources.touch.clear(); });
    // read by scenes each frame, like the buttons; rebuilt by update()
    this.pointer = { x: -1, y: -1, over: false, down: false, pressed: false, clicked: false, back: false, moved: false, wheel: 0, type: 'mouse' };
    this.pointerOn = false;
    this.pend = { moved: false, pressed: false, clicked: false, back: false, wheel: 0 };
  }

  // The pointer over the canvas, mapped to its 240×160 pixels. A click is a press and a
  // release close together; the right button is `back`. Presses on the on-screen pad or
  // on a dialog over the console are theirs, not the screen's.
  bindPointer(display, w, h) {
    let start = null;
    const at = (ev) => {
      const r = display.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * w;
      const y = ((ev.clientY - r.top) / r.height) * h;
      const p = this.pointer;
      p.over = x >= 0 && y >= 0 && x < w && y < h;
      p.type = ev.pointerType || 'mouse';
      if (Math.floor(x) !== p.x || Math.floor(y) !== p.y) { p.x = Math.floor(x); p.y = Math.floor(y); this.pend.moved = true; }
      return { cx: ev.clientX, cy: ev.clientY };
    };
    const theirs = (ev) => !this.pointerOn || ev.target.closest?.('[data-btn], #dpad, dialog, button, a, input');
    addEventListener('pointermove', (ev) => { if (!theirs(ev)) at(ev); });
    addEventListener('pointerdown', (ev) => {
      if (theirs(ev)) return;
      const c = at(ev);
      if (!this.pointer.over) return;
      if (ev.button === 2) { this.pend.back = true; this.lastSource = 'pointer'; return; }
      if (ev.button !== 0) return;
      start = c;
      this.pointer.down = true;
      this.pend.pressed = true;
      this.lastSource = 'pointer';
    });
    addEventListener('pointerup', (ev) => {
      if (!start || ev.button !== 0) return;
      at(ev);
      // a drag is not a click; a finger may wander a little more than a mouse
      const slop = ev.pointerType === 'mouse' ? 8 : 20;
      if (Math.hypot(ev.clientX - start.cx, ev.clientY - start.cy) < slop) this.pend.clicked = true;
      start = null;
      this.pointer.down = false;
      // a finger that lifts is no longer anywhere
      if (ev.pointerType !== 'mouse') this.leaveAfter = true;
    });
    addEventListener('pointercancel', () => { start = null; this.pointer.down = false; });
    // a finger leaves on every lift, before its click is read: that one goes in update()
    document.documentElement.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') this.pointer.over = false; });
    display.addEventListener('contextmenu', (ev) => ev.preventDefault());
    addEventListener('contextmenu', (ev) => { if (this.pointerOn && !ev.target.closest?.('dialog, input, a')) ev.preventDefault(); });
    addEventListener('wheel', (ev) => { if (!theirs(ev)) this.pend.wheel += Math.sign(ev.deltaY); }, { passive: true });
  }

  // Any first interaction (audio has to be unlocked from inside a user gesture).
  onAny(fn) { this.listeners.add(fn); }
  emit(b) { for (const fn of this.listeners) fn(b); }

  touchDown(b) {
    if (this.holds[b] && !this.sources.touch.has(b)) this.holds[b].down ??= performance.now();
    if (!this.sources.touch.has(b)) this.emit(b);
    this.sources.touch.add(b);
    // a click shorter than a frame (a mouse on the corner button) still counts once
    (this.taps ||= new Set()).add(b);
    this.lastSource = 'touch';
  }
  touchUp(b) {
    if (this.holds[b]) this.holds[b].up = performance.now();
    this.sources.touch.delete(b);
  }

  pollPads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const held = this.sources.pad;
    held.clear();
    this.analog.pad = null;
    for (const gp of pads) {
      if (!gp) continue;
      for (const [i, b] of Object.entries(PAD)) if (gp.buttons[i]?.pressed) held.add(b);
      const [ax = 0, ay = 0] = gp.axes;
      if (Math.hypot(ax, ay) > 0.2) this.analog.pad = { x: ax, y: ay };
      if (ax < -0.5) held.add('left');
      if (ax > 0.5) held.add('right');
      if (ay < -0.5) held.add('up');
      if (ay > 0.5) held.add('down');
    }
    if (held.size) this.lastSource = 'pad';
  }

  // Called once per frame by the engine, before the game updates.
  // START and SELECT reach the game when they are let go, so that holding one can mean
  // something else: held past HOLD_MS it calls its `onHold…` and the game never sees it.
  update() {
    this.pollPads();
    this.before = this.now;
    const raw = new Set([...this.sources.key, ...this.sources.touch, ...this.sources.pad]);
    const pressed = new Set();
    for (const [b, hook] of Object.entries(HOLDS)) {
      const h = this.holds[b];
      if (raw.has(b)) {
        // timed from the moment it went down: the first frames of a game can be slow
        h.since ??= h.down ?? performance.now();
        if (!h.held && performance.now() - h.since >= HOLD_MS) { h.held = true; this[hook]?.(); }
      } else {
        // held and let go with no frame in between (a game still loading) is still a hold
        const long = h.down != null && (h.up ?? performance.now()) - h.down >= HOLD_MS;
        if (long && !h.held) this[hook]?.();
        // let go (or a tap shorter than a frame) before the hold: an ordinary press
        else if ((h.since != null || this.taps?.has(b)) && !h.held) pressed.add(b);
        h.since = h.down = h.up = null;
        h.held = false;
      }
      raw.delete(b);
    }
    for (const b of this.taps || []) if (!HOLDS[b]) raw.add(b);
    for (const b of pressed) {
      raw.add(b);
      this.before.delete(b);
    }
    this.now = raw;
    this.taps?.clear();
    this.stick = this.readStick();
    for (const b of this.now) if (!this.before.has(b)) this.emit(b);
    const p = this.pointer;
    if (this.leaveAfter && !this.pend.clicked) { this.leaveAfter = false; p.over = false; }
    Object.assign(p, this.pend);
    this.pend = { moved: false, pressed: false, clicked: false, back: false, wheel: 0 };
  }

  held(b) { return this.now.has(b); }
  pressed(b) { return this.now.has(b) && !this.before.has(b); }
  released(b) { return !this.now.has(b) && this.before.has(b); }

  // The held direction, preferring the most recent one when two are down.
  // The touch pad says where the thumb points (shell.js): { x, y }, or null let go. Only
  // the angle counts: the pace is always the same, as with the arrows.
  setTouchStick(v) { this.analog.touch = v; }
  readStick() {
    const v = this.analog.touch || this.analog.pad;
    if (v) {
      const d = Math.hypot(v.x, v.y) || 1;
      return { x: v.x / d, y: v.y / d };
    }
    const x = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    const y = (this.held('down') ? 1 : 0) - (this.held('up') ? 1 : 0);
    const k = x && y ? Math.SQRT1_2 : 1;
    return { x: x * k, y: y * k };
  }

  dir() {
    for (const d of ['up', 'down', 'left', 'right']) if (this.pressed(d)) { this.lastDir = d; return d; }
    if (this.lastDir && this.held(this.lastDir)) return this.lastDir;
    for (const d of ['up', 'down', 'left', 'right']) if (this.held(d)) { this.lastDir = d; return d; }
    return null;
  }

  // Forget everything held, so a button pressed in one screen does not leak into the next.
  flush() {
    this.before = new Set([...this.now]);
    Object.assign(this.pointer, { pressed: false, clicked: false, back: false, wheel: 0 });
  }

  // Hit tests for scenes: the pointer is on the screen and inside a rect.
  pointIn(x, y, w, h) {
    const p = this.pointer;
    return this.pointerOn && p.over && p.x >= x && p.y >= y && p.x < x + w && p.y < y + h;
  }
}

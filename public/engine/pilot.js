// A pad nobody holds: the hands of a demo that plays itself, as an arcade cabinet's attract
// mode played its own game. Set on a World (`world.pilot = new Pilot()`), it stands in for
// the player's pad: the world plays as if it had the screen (traffic, entities, the clock
// and the cartridge's own rules go on) and reads every button from here instead of the
// real one, which stays free for whoever wants to stop the demo. The demo's script presses
// the buttons; nothing is moved behind the game's back.
//
//   const pilot = new Pilot();
//   world.pilot = pilot;
//   pilot.hold('right'); pilot.tap('a'); pilot.release();
//   pilot.toward(fromX, fromY, toX, toY)   // the pad at that angle (free movement, a wheel)
//   pilot.stickAt(angle)                    // the same, by angle in radians (0 east)

const DIRS = ['up', 'down', 'left', 'right'];

export class Pilot {
  constructor() {
    this.now = new Set();
    this.before = new Set();
    this.down = new Set();
    this.taps = new Set();
    this.analog = null;
    this.stick = { x: 0, y: 0 };
    this.pointer = { x: -1, y: -1, over: false, down: false, pressed: false, clicked: false, back: false, moved: false, wheel: 0, type: 'mouse' };
    this.pointerOn = false;
  }

  // ---------- the hands ----------

  // Holds buttons down until released (the d-pad's arms, A, B…).
  hold(...buttons) { for (const b of buttons) this.down.add(b); }
  // Lets go of these, or of everything (the stick too).
  release(...buttons) {
    if (!buttons.length) { this.down.clear(); this.analog = null; return; }
    for (const b of buttons) this.down.delete(b);
  }
  // Presses and lets go within one frame: a press the game sees once.
  tap(b) { this.taps.add(b); }
  // The pad pointed at an angle (radians, 0 east, π/2 south), as a thumb on the touch pad.
  stickAt(angle) { this.analog = { x: Math.cos(angle), y: Math.sin(angle) }; }
  // The pad pointed from one point to another (map pixels); null when already there.
  toward(fx, fy, tx, ty) {
    if (Math.hypot(tx - fx, ty - fy) < 0.5) { this.analog = null; return null; }
    this.stickAt(Math.atan2(ty - fy, tx - fx));
    return this.analog;
  }

  // ---------- what the game reads (the shape of engine/input.js) ----------

  update() {
    this.before = this.now;
    this.now = new Set([...this.down, ...this.taps]);
    for (const b of this.taps) this.before.delete(b);
    this.taps.clear();
    if (this.analog) this.stick = { ...this.analog };
    else {
      const x = (this.now.has('right') ? 1 : 0) - (this.now.has('left') ? 1 : 0);
      const y = (this.now.has('down') ? 1 : 0) - (this.now.has('up') ? 1 : 0);
      const k = x && y ? Math.SQRT1_2 : 1;
      this.stick = { x: x * k, y: y * k };
    }
  }
  held(b) { return this.now.has(b); }
  pressed(b) { return this.now.has(b) && !this.before.has(b); }
  released(b) { return !this.now.has(b) && this.before.has(b); }
  dir() {
    for (const d of DIRS) if (this.pressed(d)) { this.lastDir = d; return d; }
    if (this.lastDir && this.held(this.lastDir)) return this.lastDir;
    for (const d of DIRS) if (this.held(d)) { this.lastDir = d; return d; }
    // the stick alone (no arm held): the arm it is nearest
    const { x, y } = this.stick;
    if (!x && !y) return null;
    return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
  }
  flush() { this.before = new Set([...this.now]); }
  pointIn() { return false; }
  // the real pad's bookkeeping, asked of any input
  seen() {}
  onAny() {}
  useButtons() {}
}

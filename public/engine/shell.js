// Wires the drawn handheld to the input: multi-touch, a d-pad you can roll your thumb
// across, and the plastic's colours, which a cartridge may change. Two views: the whole
// handheld, or "full screen", where the plastic goes and the screen takes all the room.
// Only a phone has the handheld. On a desktop or a tablet (`body.is-web`) the screen is the
// page and the pointer plays (input.js); a tablet gets the pad back, over the screen's
// edges, while the scene on top reads only buttons (engine.js, `needs-pad`).
import { t, tv, has } from './i18n.js';
import { theme } from './host.js';

export function bindShell(input) {
  const pressedEls = new Map(); // pointerId -> element (for A/B/start/select)
  const dpad = document.getElementById('dpad');
  const cross = dpad.querySelector('.cross');
  const dpadPointers = new Map(); // pointerId -> direction
  const buzz = () => navigator.vibrate?.(8);

  // the corner menu of a desktop or a tablet is one more START (no data-btn: tests that
  // press [data-btn=start] mean the handheld's)
  for (const el of document.querySelectorAll('[data-btn], .web-menu')) {
    const b = el.dataset.btn || 'start';
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      pressedEls.set(e.pointerId, el);
      el.classList.add('is-down');
      input.touchDown(b);
      buzz();
    });
    const up = (e) => {
      if (pressedEls.get(e.pointerId) !== el) return;
      pressedEls.delete(e.pointerId);
      if (![...pressedEls.values()].includes(el)) {
        el.classList.remove('is-down');
        input.touchUp(b);
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // The d-pad reads the angle from its centre, with a small dead zone, so sliding the
  // thumb from one arm to the next changes direction without lifting it.
  // In full screen the whole left side is the d-pad: a press anywhere reads its direction
  // from the cross's centre, and if the thumb wanders off, the cross follows it, so the
  // thumb never has to find the pad again.
  const origins = new Map(); // pointerId -> { x, y } in full screen
  const dirFrom = (e) => {
    const r = dpad.getBoundingClientRect();
    const o = origins.get(e.pointerId);
    if (o) {
      const reach = cross.offsetWidth * 0.55;
      const dx = e.clientX - o.x;
      const dy = e.clientY - o.y;
      const d = Math.hypot(dx, dy);
      if (d > reach) {
        o.x += dx * (1 - reach / d);
        o.y += dy * (1 - reach / d);
        dpad.style.setProperty('--ox', `${o.x - r.left}px`);
        dpad.style.setProperty('--oy', `${o.y - r.top}px`);
      }
    }
    const x = e.clientX - (o ? o.x : r.left + r.width / 2);
    const y = e.clientY - (o ? o.y : r.top + r.height / 2);
    const dead = o ? cross.offsetWidth * 0.12 : r.width * 0.08;
    if (Math.hypot(x, y) < dead) return null;
    return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
  };
  const setDir = (id, dir) => {
    const before = dpadPointers.get(id);
    if (before === dir) return;
    if (before) input.touchUp(before);
    if (dir) { input.touchDown(dir); dpadPointers.set(id, dir); buzz(); } else dpadPointers.delete(id);
    dpad.className = 'pad pad--dir' + [...new Set(dpadPointers.values())].map((d) => ` is-${d}`).join('') + (origins.size ? ' is-held' : '');
  };
  dpad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dpad.setPointerCapture?.(e.pointerId);
    if (isFull() || isTablet()) {
      const c = cross.getBoundingClientRect();
      origins.set(e.pointerId, { x: c.left + c.width / 2, y: c.top + c.height / 2 });
      dpad.classList.add('is-held');
    }
    setDir(e.pointerId, dirFrom(e));
  });
  dpad.addEventListener('pointermove', (e) => { if (dpadPointers.has(e.pointerId) || e.buttons) setDir(e.pointerId, dirFrom(e)); });
  const release = (e) => {
    origins.delete(e.pointerId);
    if (!origins.size) { dpad.style.removeProperty('--ox'); dpad.style.removeProperty('--oy'); }
    setDir(e.pointerId, null);
  };
  dpad.addEventListener('pointerup', release);
  dpad.addEventListener('pointercancel', release);
  dpad.addEventListener('lostpointercapture', release);
  dpad.addEventListener('contextmenu', (e) => e.preventDefault());

  // a page with the handheld but no full-screen view (the landing) has no toggle
  const toggle = document.getElementById('view-toggle');
  if (toggle) {
    toggle.addEventListener('pointerdown', (e) => e.stopPropagation());
    toggle.addEventListener('click', () => setFull(!isFull()));
    setFull(localStorage.getItem(VIEW_KEY) === 'full');
  }

  // phone, tablet or desktop: at load, and again whenever the window changes shape
  const decide = () => {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const kind = !coarse ? 'desktop' : Math.min(innerWidth, innerHeight) < 600 ? 'phone' : 'tablet';
    if (kind === document.body.dataset.kind) return;
    document.body.dataset.kind = kind;
    const web = kind !== 'phone';
    document.body.classList.toggle('is-web', web);
    document.body.classList.toggle('is-desktop', kind === 'desktop');
    document.body.classList.toggle('is-tablet', kind === 'tablet');
    // full screen is a phone's choice: kept for when this is a phone again
    document.body.classList.toggle('is-full', !web && localStorage.getItem(VIEW_KEY) === 'full');
    input.pointerOn = web;
    requestAnimationFrame(() => dispatchEvent(new Event('resize')));
  };
  decide();
  addEventListener('resize', decide);
  addEventListener('orientationchange', decide);
  matchMedia('(pointer: coarse)').addEventListener?.('change', decide);

  // keep the page itself from scrolling, zooming or selecting under the thumbs
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
}

const VIEW_KEY = 'luma32.view';

export function isFull() { return document.body.classList.contains('is-full'); }
// a desktop or a tablet: no handheld, no view to choose
export function isWeb() { return document.body.classList.contains('is-web'); }
const isTablet = () => document.body.classList.contains('is-tablet');

// A prompt for whoever plays with the pointer: `<key>_click` on a desktop, `<key>_tap` on a
// tablet, when the catalogue has it; the phone's wording (buttons) otherwise.
export function hint(key) {
  const k = document.body.classList.contains('is-desktop') ? `${key}_click` : isTablet() ? `${key}_tap` : null;
  return k && has(k) ? k : key;
}

// Switches between the handheld and full screen, remembered for next time.
export function setFull(on) {
  document.body.classList.toggle('is-full', on && !isWeb());
  localStorage.setItem(VIEW_KEY, on ? 'full' : 'shell');
  const toggle = document.getElementById('view-toggle');
  if (toggle && has('console.shell.view_full')) toggle.setAttribute('aria-label', t(on ? 'console.shell.view_shell' : 'console.shell.view_full'));
  // the canvas sizes itself on resize
  requestAnimationFrame(() => dispatchEvent(new Event('resize')));
}

export function applyShellText() {
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  document.getElementById('view-toggle')?.setAttribute('aria-label', t(isFull() ? 'console.shell.view_shell' : 'console.shell.view_full'));
  const keys = document.getElementById('keys');
  keys.innerHTML = '';
  for (const { key, label } of tv('console.shell.keys') || []) {
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    keys.append(kbd, ` ${label}\u2003`);
  }
}

const DEFAULT_SHELL = {
  body: '#34307a', bodyHi: '#5d58b8', bodyLo: '#1c1948', ink: 'rgba(225,222,255,.78)',
  btn: '#2a2732', btnHi: '#57536a', btnLo: '#121016', accent1: '#ff5d73', accent2: '#5fd0ff', room: '#08080c',
};

// Recolours the plastic. Called with a cartridge's theme.shell, or nothing for the console's own.
export function paintShell(shell = {}) {
  const s = { ...DEFAULT_SHELL, ...shell };
  const root = document.documentElement.style;
  root.setProperty('--body', s.body);
  root.setProperty('--body-hi', s.bodyHi);
  root.setProperty('--body-lo', s.bodyLo);
  root.setProperty('--ink', s.ink);
  root.setProperty('--btn', s.btn);
  root.setProperty('--btn-hi', s.btnHi);
  root.setProperty('--btn-lo', s.btnLo);
  root.setProperty('--accent-1', s.accent1);
  root.setProperty('--accent-2', s.accent2);
  root.setProperty('--room', s.room);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', s.room);
  // the page that frames the console (/play) takes the same colour round it
  theme(s.room);
}

export function led(on) { document.getElementById('led').classList.toggle('is-on', on); }

// Who the console answers to. Two ways to run it:
//
// - **Local** (a checkout of the engine served as static files): the shelf is
//   games/index.json, every game under games/<id>/, saves only in this browser. Nobody
//   logs in.
// - **Hosted**: inside a frame of a page that owns the accounts (luma32.com/play, see
//   public/host/). That page holds the session; this frame never sees it. It hands over
//   who is playing, the shelf, a token that opens this account's game files on this origin,
//   and the account's saves; it takes the saves back to the server and opens the account
//   dialog. Everything goes by postMessage, request and answer (`call`).
//
// The frame is on another origin than the page on purpose: a game is code from wherever
// its player found it, and here it can reach no session and no admin page.
//
// Saves still live in localStorage (this origin's). With an account, every change to a
// save slot or to the lines already read goes up to the server through the page, and on
// boot each slot keeps whichever copy is newer.

// save slots, the lines already read, and the camera the player chose (firstperson.js)
const SYNCED = /^luma32\.[a-z0-9_-]+\.(slot\d+|seen|camera)$/;
const PENDING = 'luma32.pending'; // key -> time of the change, until the server has it
const OWNER = 'luma32.owner';     // whose saves are the synced keys on this device
const HELLO_WAIT = 4000;

let hosted = false;
let me = null;
let locked = false;
let timer = null;
let seq = 0;
const waiting = new Map();
const handlers = {};

// ---------- talking to the page ----------

// Asks the page; resolves with its answer.
function call(method, args) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    parent.postMessage({ luma: 1, id, method, args }, '*');
  });
}

addEventListener('message', (e) => {
  const m = e.data;
  if (e.source !== parent || parent === window || !m || m.luma !== 1) return;
  if (m.re) {
    const w = waiting.get(m.re);
    if (!w) return;
    waiting.delete(m.re);
    if (m.ok) w.resolve(m.value); else w.reject(Object.assign(new Error(m.error || 'host'), { code: m.error }));
    return;
  }
  // the page asks this frame (before logging out: send what is pending, then forget it)
  const fn = handlers[m.method];
  if (!fn) return;
  Promise.resolve().then(() => fn(m.args)).then(
    (value) => parent.postMessage({ luma: 1, re: m.id, ok: true, value }, '*'),
    (err) => parent.postMessage({ luma: 1, re: m.id, ok: false, error: err.code || err.message }, '*'));
});

// ---------- saves ----------

const readPending = () => { try { return JSON.parse(localStorage.getItem(PENDING)) || {}; } catch { return {}; } };
const writePending = (p) => localStorage.setItem(PENDING, JSON.stringify(p));
const atOf = (raw) => { try { return JSON.parse(raw)?.at || 0; } catch { return 0; } };

// Removes this device's copy of an account's saves (they stay in the account), so that
// whoever plays next on this device does not inherit them.
function forget() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) if (SYNCED.test(localStorage.key(i))) keys.push(localStorage.key(i));
  for (const key of keys) localStorage.removeItem(key);
  localStorage.removeItem(PENDING);
  localStorage.removeItem(OWNER);
}

// Called by whoever writes a synced key (save slots, the lines already read).
export function changed(key) {
  if (!me?.email || !SYNCED.test(key)) return;
  const p = readPending();
  p[key] = Date.now();
  writePending(p);
  clearTimeout(timer);
  timer = setTimeout(push, 2000);
}

// Sends what the server does not have yet; true when nothing is left pending.
async function push() {
  if (!me?.email) return true;
  const pending = readPending();
  const keys = Object.keys(pending);
  if (!keys.length) return true;
  const entries = {};
  for (const key of keys) {
    const value = localStorage.getItem(key);
    // a slot carries its own time; deletions and "seen" lists, the time of the change
    entries[key] = { value, at: (value && !key.endsWith('.seen') && atOf(value)) || pending[key] };
  }
  try {
    await call('saves', { entries });
    const now = readPending();
    for (const key of keys) if (now[key] === pending[key]) delete now[key];
    writePending(now);
    return !Object.keys(now).length;
  } catch (err) {
    console.warn(`cloud save: ${err.message}`); // stays pending, goes with the next one
    return false;
  }
}

// Brings this device and the account together: the newer copy of each slot wins, and
// the lines read on either side are added up.
async function merge(saves) {
  const pending = readPending();
  const now = Date.now();
  for (const [key, entry] of Object.entries(saves)) {
    if (!SYNCED.test(key)) continue;
    const local = localStorage.getItem(key);
    if (key.endsWith('.seen')) {
      let mine = [];
      let theirs = [];
      try { mine = JSON.parse(local) || []; } catch { /* broken: theirs wins */ }
      try { theirs = JSON.parse(entry.value) || []; } catch { /* broken: mine wins */ }
      const all = [...new Set([...theirs, ...mine])];
      if (all.length !== theirs.length) pending[key] = now;
      localStorage.setItem(key, JSON.stringify(all));
      continue;
    }
    const localAt = local ? atOf(local) : (pending[key] || 0);
    if (entry.at > localAt) {
      if (entry.value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, entry.value);
      delete pending[key];
    } else if (entry.at < localAt) pending[key] = localAt;
  }
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (SYNCED.test(key) && !saves[key]) pending[key] = now;
  }
  writePending(pending);
  await push();
}

handlers.flush = () => push();
handlers.forget = () => { forget(); };

// ---------- power on ----------

// Who is playing and what is on their shelf. Returns { games: [{ key, id, base, group,
// listed }], groups, wanted }: `base` is the URL of the cartridge's folder.
export async function init() {
  const wanted = new URLSearchParams(location.search).get('game');
  let hello = null;
  if (parent !== window) {
    hello = await Promise.race([call('hello'), new Promise((resolve) => setTimeout(resolve, HELLO_WAIT, null))]).catch(() => null);
  }
  if (!hello) {
    // local: the folder's own shelf, nobody logged in, saves only here
    me = { email: null, local: true };
    const list = await (await fetch('games/index.json', { cache: 'no-cache' })).json();
    const games = (list.games || []).map((g) => ({ key: g.id, id: g.id, base: new URL(g.src || `games/${g.id}/`, location.href).href, group: g.group || null, listed: true }));
    return { games, groups: list.groups || [], wanted };
  }
  hosted = true;
  me = hello.account;
  locked = !!hello.locked;
  // the token becomes this origin's cookie, which every game file is asked for with
  if (hello.token) {
    try {
      await fetch('/files/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: hello.token }) });
      // online, and the cookie says whose: bring every game of this account up to date for offline
      navigator.serviceWorker?.ready.then((reg) => reg.active?.postMessage('refresh'));
    } catch { /* offline: last week's cookie, or the copies kept */ }
  }
  if (me?.email) {
    // saves left by another account (one that could not upload on logging out) are not
    // this one's; saves from before accounts existed (no owner) are, and get uploaded
    const owner = localStorage.getItem(OWNER);
    if (owner && owner !== me.email) forget();
    localStorage.setItem(OWNER, me.email);
    if (hello.saves) await merge(hello.saves).catch((err) => console.warn(`cloud sync: ${err.message}`));
    addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') push(); });
  } else if (localStorage.getItem(OWNER)) forget();
  const shelf = locked ? { games: [], groups: [] } : hello.shelf || { games: [], groups: [] };
  const games = shelf.games.map((g) => ({ ...g, base: new URL(g.src, location.href).href }));
  return { games, groups: shelf.groups || [], wanted: hello.wanted || wanted };
}

// ---------- what the console asks ----------

// The player: { email, trial, … } hosted, { local: true } in a local checkout, null when
// nobody is logged in.
export const account = () => me;
export const isHosted = () => hosted;
export const offlineLocked = () => locked;

// The account dialog is the page's; a local console has none.
let dialogOpen = false;
export function openAccount() {
  if (!hosted || dialogOpen) return;
  dialogOpen = true;
  call('account').catch(() => {}).finally(() => { dialogOpen = false; });
}
export const isOpen = () => dialogOpen;

// The cartridge on screen (its id), or null on the shelf: the page tells the server.
export function playing(id) { if (hosted) call('playing', { game: id }).catch(() => {}); }

// The colour around the console, for the page's own background and status bar.
export function theme(color) { if (hosted) call('theme', { color }).catch(() => {}); }

// Sends a problem report; resolves with the server's answer. Local: nowhere to send it.
export function report(payload) {
  if (!hosted) return Promise.reject(Object.assign(new Error('local'), { code: 'local' }));
  return call('report', payload);
}

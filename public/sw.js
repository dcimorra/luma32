// The console's service worker, on the play origin (the frame /play embeds). The server lets browsers keep scripts and styles for an
// hour, and an installed app does exactly that, so a new engine or cartridge would not
// show for a while. Every request here goes to the network first and asks the server to
// revalidate (a 304 when nothing changed costs next to nothing); the copy kept in Cache
// Storage is for playing offline, and for a connection so slow that waiting on it is
// worse than the copy (after SLOW_MS the copy answers and the network still refreshes it).
//
// Offline means every game, not just what was opened: each time the console opens with
// a connection, the page asks for a refresh and /offline.json lists the page, the engine
// and this account's games (local ones under /games/, packages under /p/) with their ETags. What is missing or changed is fetched, and
// a game no longer listed (access taken away) is dropped.
//
// Offline lasts a day at most: the games kept here are only served while the last time the
// server listed them (/offline.json, which knows the account and what it may play) is less
// than OFFLINE_MAX ago. After that, offline, they answer as missing and the shelf as empty
// until the console connects again (engine/account.js locks the console the same way).
const STORE = 'luma32-v1';
const OFFLINE_MAX = 24 * 3600e3;
const VALIDATED = '/__luma32/validated';
const SLOW_MS = 4000;
const PARALLEL = 6;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const keep = (req, res) => {
  if (!res.ok) return;
  const copy = res.clone();
  caches.open(STORE).then((c) => c.put(req, copy));
};

async function validatedAt() {
  const r = await caches.match(VALIDATED);
  return r ? Number(await r.text()) || 0 : 0;
}

// A game's files, and the shelf, kept from a server visit too long ago (or from a clock
// set back) are not for playing.
const gameFile = (p) => p.startsWith('/games/') || p.startsWith('/p/');

async function stale(url) {
  if (!gameFile(url.pathname)) return false;
  const age = Date.now() - await validatedAt();
  return age < 0 || age > OFFLINE_MAX;
}

// a page opened with ?game= or ?patreon= offline is still the console
const kept = async (req) => {
  const url = new URL(req.url);
  if (await stale(url)) return undefined;
  return caches.match(req, { ignoreVary: true, ignoreSearch: req.mode === 'navigate' });
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // who is logged in and their saves are never answered from a copy
  if (url.pathname.startsWith('/files/') || url.pathname === '/offline.json') return;
  const network = fetch(req, { cache: 'no-cache' }).then((res) => { keep(req, res); return res; });
  e.waitUntil(network.catch(() => {}));
  e.respondWith((async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, SLOW_MS));
    const first = await Promise.race([network.then(() => 'net', () => 'net'), slow.then(() => 'slow')]);
    if (first === 'slow') { const copy = await kept(req); if (copy) return copy; }
    try { return await network; } catch (err) {
      const copy = await kept(req);
      if (copy) return copy;
      throw err;
    }
  })());
});

let refreshing = null;

async function refresh() {
  let list;
  try {
    const res = await fetch('/offline.json', { cache: 'no-store' });
    if (!res.ok) return;
    list = (await res.json()).files;
  } catch { return; } // offline: what is kept stays as it is
  const cache = await caches.open(STORE);
  await cache.put(VALIDATED, new Response(String(Date.now())));
  const queue = [];
  for (const f of list) {
    const have = await cache.match(f.url, { ignoreVary: true });
    if (!have || !f.etag || have.headers.get('ETag') !== f.etag) queue.push(f.url);
  }
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try { const res = await fetch(url, { cache: 'no-cache' }); if (res.ok) await cache.put(url, res); } catch { /* next time */ }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  // games this account no longer has
  const listed = new Set(list.map((f) => f.url));
  for (const req of await cache.keys()) {
    const p = new URL(req.url).pathname;
    if (gameFile(p) && !listed.has(p)) await cache.delete(req);
  }
}

self.addEventListener('message', (e) => {
  if (e.data !== 'refresh') return;
  refreshing ??= refresh().finally(() => { refreshing = null; });
  e.waitUntil(refreshing);
});

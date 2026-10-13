// String catalogue. Visitor-facing text never lives in code: the console reads
// locales/<lang>.json and each cartridge brings its own files. Every cartridge has a
// catalogue of its own — they all use the same keys (meta.title, speakers.*) — and a
// lookup asks the active cartridge first, then the console.
const consoleCatalog = {};
const cartCatalogs = new Map();
let active = null;
export const lang = 'es';

// The cartridge whose strings t() reads; null for the console alone.
export function useCatalog(id) { active = id; }

// Runs fn with another cartridge's strings active (the shelf drawing every label).
export function withCatalog(id, fn) {
  const prev = active;
  active = id;
  try { return fn(); } finally { active = prev; }
}

function merge(into, from) {
  for (const [k, v] of Object.entries(from)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && into[k] && typeof into[k] === 'object') merge(into[k], v);
    else into[k] = v;
  }
}

// Strings that come as data, not as a file (a group a player named): merged like a file's.
export function addStrings(strings, cart) {
  if (!cartCatalogs.has(cart)) cartCatalogs.set(cart, {});
  merge(cartCatalogs.get(cart), strings);
}

// cart: the cartridge id the files belong to; omitted for the console's own strings.
// A game's catalogue comes encoded from the server (server/protect.mjs, encodeJSON): the
// same keystream undoes it.
function decode(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  let s = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + i) >>> 0;
    bytes[i] ^= s & 0xff;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function loadStrings(urls, cart = null) {
  // a missing or broken file costs its own strings, not the whole console
  const parts = await Promise.all(urls.map(async (url) => {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.headers.get('X-Luma-Encoded') ? decode(await res.text()) : await res.json();
    } catch (err) {
      console.error(`strings ${url}: ${err.message}`);
      return {};
    }
  }));
  let into = consoleCatalog;
  if (cart) {
    if (!cartCatalogs.has(cart)) cartCatalogs.set(cart, {});
    into = cartCatalogs.get(cart);
  }
  for (const p of parts) merge(into, p);
}

function find(catalog, key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), catalog);
}

function lookup(key) {
  const cart = active && cartCatalogs.get(active);
  const value = cart ? find(cart, key) : undefined;
  return value !== undefined ? value : find(consoleCatalog, key);
}

export function has(key) { return lookup(key) !== undefined; }

// t('a.b', { n: 1 }) -> interpolated string. A missing key shows itself, so it is easy to spot.
export function t(key, vars = {}) {
  const value = lookup(key);
  if (typeof value !== 'string') {
    if (!Array.isArray(value)) console.warn(`missing string: ${key}`);
    return Array.isArray(value) ? value.join('\n') : key;
  }
  return value.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

// Raw value (arrays, objects) for structured entries.
export function tv(key) {
  const value = lookup(key);
  if (value === undefined) console.warn(`missing string: ${key}`);
  return value;
}

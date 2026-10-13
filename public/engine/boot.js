// Power on: load the console's strings and the cartridge list, show the logo, then
// loop between the shelf and whichever cartridge is inserted.
import { Engine } from './engine.js';
import { Input } from './input.js';
import { loadStrings, t, useCatalog, withCatalog } from './i18n.js';
import { fold } from './search.js';
import { unlock } from './audio.js';
import { bindShell, applyShellText, paintShell, led } from './shell.js';
import { BootLogo, Shelf } from './console.js';
import { runCartridge } from './cart.js';
import { setTheme } from './ui.js';
import { init as initHost, playing } from './host.js';
import { reportTo } from './report.js';

const LAST = 'luma32.last';

async function main() {
  const input = new Input();
  bindShell(input);
  input.onAny(() => unlock());
  addEventListener('pointerdown', () => unlock(), { capture: true });

  await loadStrings(['locales/es.json']);
  applyShellText();
  document.title = t('console.name');

  // before the shelf: whoever hosts the console (host.js) says who plays, which games are
  // theirs and where each lives, and brings their saves
  const list = await initHost();
  const wanted = list.wanted;
  // ?game=<id> also loads a cartridge that is not on the shelf yet (one being built): one
  // of the library's, or a folder of a local checkout
  const entries = list.games.filter((g) => g.listed !== false || g.id === wanted || g.key === wanted);
  if (wanted && /^[a-z0-9_-]+$/.test(wanted) && !entries.some((e) => e.id === wanted || e.key === wanted)) {
    entries.push({ key: wanted, id: wanted, base: new URL(`games/${wanted}/`, location.href).href, extra: true });
  }
  const carts = [];
  for (const entry of entries) {
    // a game that does not load (a package somebody broke, a file missing) costs its own
    // place on the shelf, never the console
    const mod = await import(`${entry.base}game.js`).catch((err) => { console.error(`${entry.key}: ${err.message}`); return null; });
    if (!mod?.default) continue;
    const game = mod.default;
    game.base = entry.base;
    await loadStrings((game.strings || []).map((s) => entry.base + s), entry.key);
    carts.push({ id: entry.key, game, groupId: entry.group || null, entry });
  }
  const shelf = await shelfItems(carts, list.groups || []);

  const engine = new Engine(document.getElementById('screen'), input);
  engine.start();
  window.luma = { engine }; // for poking at a running game from the devtools
  led(true);

  await engine.push(new BootLogo());
  let direct = carts.find((c) => c.id === wanted || c.game.id === wanted);
  for (;;) {
    paintShell();
    setTheme({});
    let id;
    if (direct) { id = direct.id; direct = null; }
    else id = await engine.replaceAll(new Shelf(shelf.items, localStorage.getItem(LAST), shelf.find));
    localStorage.setItem(LAST, id);
    useCatalog(id);
    playing(carts.find((c) => c.id === id).game.id);
    reportTo(carts.find((c) => c.id === id).entry);
    try { await runCartridge(engine, carts.find((c) => c.id === id).game); } finally { useCatalog(null); playing(null); }
  }
}

// The shelf as a tree (engine/groups.js): each cartridge where it is, except those in a
// group, which go inside it, and each group inside its parent, put where its first
// cartridge would be. A group whose art does not load leaves what it holds loose rather
// than hiding it. Also what the search looks in: each cartridge's title and tagline and
// the titles of the groups it is in.
async function shelfItems(carts, groups) {
  const known = new Map();
  for (const { id, kind, parent } of groups) {
    if (!/^[a-z0-9-]+$/.test(id)) continue;
    const base = `groups/${id}/`;
    const mod = await import(`../${base}group.js`).catch((err) => { console.error(err); return null; });
    if (!mod) continue;
    await loadStrings([`${base}locales/es.json`], `group:${id}`);
    known.set(id, { group: true, id, kind: kind === 'collection' ? 'collection' : 'saga', parent: parent || null, art: mod.default, items: [], count: 0 });
  }
  // a parent that is missing, or a loop, puts the group on the shelf itself
  const parentOf = (g) => {
    const seen = new Set([g.id]);
    for (let p = known.get(g.parent); p; p = known.get(p.parent)) { if (seen.has(p.id)) return null; seen.add(p.id); }
    return known.get(g.parent) || null;
  };
  const top = [];
  const placed = new Set();
  // puts a group (and, first, the groups above it) where it goes, once
  const place = (g) => {
    if (placed.has(g.id)) return;
    placed.add(g.id);
    const parent = parentOf(g);
    if (parent) { place(parent); parent.items.push(g); } else top.push(g);
  };
  const search = [];
  for (const c of carts) {
    const g = known.get(c.groupId);
    if (!g) top.push(c); else { place(g); g.items.push(c); }
    // the groups it is in, for counting and for the search
    const chain = [];
    for (let p = g; p; p = parentOf(p)) chain.push(p);
    for (const p of chain) p.count++;
    const words = [c.game.meta?.title, c.game.meta?.tagline].map((k) => (k ? withCatalog(c.id, () => t(k)) : ''))
      .concat(chain.map((p) => withCatalog(`group:${p.id}`, () => `${t('meta.title')} ${t('meta.tagline')}`)));
    search.push({ cart: c, text: fold(words.join(' ')) });
  }
  // groups with nothing in them for this player (all their games are for others) do not show
  const prune = (list) => list.filter((it) => !it.group || it.count > 0).map((it) => (it.group ? Object.assign(it, { items: prune(it.items) }) : it));
  const find = (q) => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return search.filter((s) => words.every((w) => s.text.includes(w))).map((s) => s.cart);
  };
  return { items: prune(top), find };
}

main().catch((err) => {
  console.error(err);
  document.body.dataset.error = String(err);
});

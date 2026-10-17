// The library: every cartridge the console has, the groups they are kept in, and the
// manager that sorts them, groups them, looks at them, installs and removes them — SELECT
// on the shelf. The shelf (console.js) shows the tree `Library` builds; the manager edits
// it and hands it to whoever holds the shelf (host.js: server/serve.mjs in a local
// checkout, the page round the console when hosted), then builds it again.
import { SCREEN_W, SCREEN_H } from './gfx.js';
import { drawText, measure, wrap } from './font.js';
import { List, pointRows, clicked, frame, getTheme, centerX } from './ui.js';
import { sfx } from './audio.js';
import { t, has, withCatalog, loadStrings, addStrings } from './i18n.js';
import { account, isHosted, canManage, library, arrange, install, remove, openAccount, isOpen } from './host.js';
import { imageArt, defaultArt } from './groups.js';
import { fold } from './search.js';
import { openPrompt, prompting } from './prompt.js';
import { hint, isWeb } from './shell.js';

const GROUP_ID = /^[a-z0-9-]{1,40}$/;
const blink = (f, rate = 30) => Math.floor(f / rate) % 2 === 0;

// ---------- loading ----------

// A cartridge from its entry (host.js): its code and its strings. A game that does not
// load (a package somebody broke, a file missing) costs its own place on the shelf, never
// the console. `progress` counts it for the logo.
export async function loadCart(entry, progress = null) {
  const mod = await import(`${entry.base}game.js`).catch((err) => { console.error(`${entry.key}: ${err.message}`); return null; });
  let cart = null;
  if (mod?.default) {
    const game = mod.default;
    game.base = entry.base;
    await loadStrings((game.strings || []).map((s) => entry.base + s), entry.key);
    cart = { id: entry.key, game, groupId: entry.group || null, entry };
  }
  if (progress) progress.done++;
  return cart;
}

// A cartridge's title, in its own words; a group's.
export const titleOf = (it) => (it.group ? withCatalog(`group:${it.id}`, () => t('meta.title')) : withCatalog(it.id, () => t(it.game.meta?.title || it.id)));
export const taglineOf = (it) => (it.group ? withCatalog(`group:${it.id}`, () => t('meta.tagline')) : withCatalog(it.id, () => (it.game.meta?.tagline ? t(it.game.meta.tagline) : '')));

// ---------- the library ----------

export class Library {
  // carts: [{ id, game, groupId, entry }], the shelf's cartridges in its order. groups:
  // as host.js lists them. `items` and `find` come from `rebuild()`.
  constructor(carts, groups) {
    this.carts = carts;
    this.groups = groups.map((g) => ({ ...g }));
    this.arts = new Map();
    this.items = [];
    this.find = () => [];
  }

  // The shelf as a tree (engine/groups.js): each cartridge where it is, except those in a
  // group, which go inside it, and each group inside its parent, put where its first
  // cartridge would be. A group whose art does not load leaves what it holds loose rather
  // than hiding it. Also what the search looks in: each cartridge's title and tagline and
  // the titles of the groups it is in.
  //
  // A group comes two ways. Hosted, as data the player wrote in /play (or here, in the
  // manager): { id, title, tagline, kind, parent } and its art — `cover`, an image they
  // uploaded, or `art`, the house's drawn art in groups/<art>/ — or neither (default
  // colours). Local, as a folder: groups/<id>/ with its group.js and its catalogue.
  async rebuild() {
    const known = new Map();
    for (const g of this.groups) {
      const { id, kind, parent } = g;
      if (typeof id !== 'string' || !GROUP_ID.test(id)) continue;
      const art = await this.artOf(g);
      if (!art) continue;
      known.set(id, { group: true, id, kind: kind === 'collection' ? 'collection' : 'saga', parent: parent || null, art, items: [], count: 0, data: g });
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
    for (const c of this.carts) {
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
    this.items = prune(top);
    this.find = (q) => {
      const words = fold(q).split(/\s+/).filter(Boolean);
      return search.filter((s) => words.every((w) => s.text.includes(w))).map((s) => s.cart);
    };
  }

  // A group's art (and its strings), loaded once however many times the tree is built.
  async artOf(g) {
    const key = `${g.id}|${g.title === undefined ? 'folder' : 'data'}|${g.cover || ''}|${g.art || ''}`;
    if (!this.arts.has(key)) {
      this.arts.set(key, (async () => {
        const houseArt = async (id) => {
          if (!/^[a-z0-9-]+$/.test(id || '')) return null;
          const mod = await import(`../groups/${id}/group.js`).catch((err) => { console.error(err); return null; });
          return mod?.default || null;
        };
        let art = null;
        if (g.title !== undefined) {
          // the house's art brings the words it paints (cover.line1…); the title is the player's
          if (!g.cover && g.art && /^[a-z0-9-]+$/.test(g.art)) await loadStrings([`groups/${g.art}/locales/es.json`], `group:${g.id}`);
          if (g.cover) {
            const img = new Image();
            img.src = new URL(g.cover, location.href).href;
            art = await img.decode().then(() => imageArt(img), (err) => { console.error(`cover ${g.cover}: ${err.message}`); return null; });
          }
          art ??= (await houseArt(g.art)) || defaultArt(g.id);
        } else {
          art = await houseArt(g.id);
          if (art) await loadStrings([`groups/${g.id}/locales/es.json`], `group:${g.id}`);
        }
        return art;
      })());
    }
    const art = await this.arts.get(key);
    // the title is the player's: it may have changed since the art was loaded
    if (g.title !== undefined) addStrings({ meta: { title: g.title, tagline: g.tagline || '' } }, `group:${g.id}`);
    return art;
  }

  // ----- editing the tree (the manager) -----

  // The list an item is in, and the group that list belongs to (null on the shelf itself).
  levelOf(it, list = this.items, group = null) {
    if (list.includes(it)) return { list, group };
    for (const g of list) if (g.group) { const found = this.levelOf(it, g.items, g); if (found) return found; }
    return null;
  }

  // Whether `g` is `it` itself or a group inside it.
  within(it, g) { return it.group && (it === g || it.items.some((x) => this.within(x, g))); }

  // Swaps an item with its neighbour above (-1) or below (+1). True when it moved.
  shift(it, dir) {
    const { list } = this.levelOf(it);
    const i = list.indexOf(it);
    const j = i + dir;
    if (j < 0 || j >= list.length) return false;
    [list[i], list[j]] = [list[j], list[i]];
    return true;
  }

  // Takes an item out of where it is and puts it in a group (null: the shelf), at the end.
  putIn(it, group) {
    if (group && this.within(it, group)) return false;
    const { list } = this.levelOf(it);
    list.splice(list.indexOf(it), 1);
    (group ? group.items : this.items).push(it);
    return true;
  }

  // A new group next to `it`, with `it` inside it. kind: 'saga' | 'collection'.
  newGroup(it, title, kind) {
    const slug = fold(title).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'grupo';
    let id = slug;
    for (let n = 2; this.groups.some((g) => g.id === id); n++) id = `${slug}-${n}`;
    const data = { id, title, tagline: '', kind };
    this.groups.push(data);
    addStrings({ meta: { title, tagline: '' } }, `group:${id}`);
    const node = { group: true, id, kind, parent: null, art: defaultArt(id), items: [], count: 0, data };
    const { list } = this.levelOf(it);
    list.splice(list.indexOf(it), 1, node);
    node.items.push(it);
    return node;
  }

  rename(g, title) { g.data.title = title; addStrings({ meta: { title } }, `group:${g.id}`); }

  // Undoes a group: what it held takes its place.
  ungroup(g) {
    const { list } = this.levelOf(g);
    list.splice(list.indexOf(g), 1, ...g.items);
    this.groups = this.groups.filter((x) => x !== g.data);
  }

  // Every level in alphabetical order (groups and cartridges together).
  sort(list = this.items) {
    list.sort((a, b) => fold(titleOf(a)).localeCompare(fold(titleOf(b))));
    for (const g of list) if (g.group) this.sort(g.items);
  }

  // The tree as it stands, told to whoever holds the shelf; then built again.
  async commit() {
    const games = [];
    const groups = [];
    const walk = (list, parent) => {
      for (const it of list) {
        if (it.group) {
          groups.push({ ...it.data, kind: it.kind, parent: parent?.id || null });
          walk(it.items, it);
        } else games.push({ key: it.id, group: parent?.id || null });
      }
    };
    walk(this.items, null);
    // a folder group with nothing in it stays as it was; an empty group the player made is gone
    for (const g of this.groups) if (!groups.some((x) => x.id === g.id) && g.title === undefined) groups.push({ ...g });
    // every cartridge the tree does not show (a group whose art failed) keeps its place
    for (const c of this.carts) if (!games.some((g) => g.key === c.id)) games.push({ key: c.id, group: c.groupId });
    await arrange({ games, groups });
    const order = new Map(games.map((g, i) => [g.key, i]));
    for (const c of this.carts) c.groupId = games.find((g) => g.key === c.id)?.group || null;
    this.carts.sort((a, b) => order.get(a.id) - order.get(b.id));
    this.groups = groups;
    await this.rebuild();
  }

  // ----- adding and taking away -----

  // Installs a game ({ source } or { zip, name }: host.js) and puts it on the shelf.
  async add(what) {
    const entry = await install(what);
    const cart = await loadCart(entry);
    if (!cart) throw Object.assign(new Error('broken'), { code: 'broken' });
    const was = this.carts.findIndex((c) => c.id === cart.id);
    if (was >= 0) this.carts.splice(was, 1, cart); else this.carts.push(cart);
    await this.rebuild();
    return cart;
  }

  async drop(cart) {
    await remove(cart.id);
    this.carts = this.carts.filter((c) => c !== cart);
    await this.rebuild();
  }
}

// ---------- the room every console screen is in ----------

// A dark room with a slowly drifting grid, and the dark bar at the top.
export function drawRoom(ctx, f) {
  ctx.fillStyle = '#121026';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.fillStyle = '#1c1940';
  const off = Math.floor(f / 3) % 16;
  for (let x = -16 + off; x < SCREEN_W; x += 16) ctx.fillRect(x, 0, 1, SCREEN_H);
  for (let y = -16 + off; y < SCREEN_H; y += 16) ctx.fillRect(0, y, SCREEN_W, 1);
  ctx.fillStyle = '#0c0a1c';
  ctx.fillRect(0, 0, SCREEN_W, 18);
}

const px = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

// A small cartridge, a small saga case or a small box, 8×10, in a row of the manager.
function drawIcon(ctx, x, y, it, sel) {
  if (!it.group) {
    px(ctx, x, y, 8, 10, sel ? '#b8b6c4' : '#8a889a');
    px(ctx, x + 1, y + 2, 6, 5, '#1a1826');
    px(ctx, x + 2, y + 3, 4, 3, it.game.cover ? '#e8445c' : '#3a9ee8');
  } else if (it.kind === 'collection') {
    px(ctx, x, y + 1, 8, 9, sel ? '#c8a878' : '#9a805c');
    px(ctx, x - 1, y, 10, 2, sel ? '#ecd4a8' : '#b89a70');
    px(ctx, x + 1, y + 4, 6, 4, '#0a0918');
  } else {
    px(ctx, x, y, 8, 10, sel ? '#4a4670' : '#34305a');
    px(ctx, x, y, 2, 10, it.art?.spine || '#8a2a4a');
    px(ctx, x + 3, y + 1, 4, 8, '#16142e');
  }
}

// Cuts a line to a width, with an ellipsis.
function fit(str, w) {
  let s = String(str);
  while (measure(s) > w && s.length > 1) s = `${s.slice(0, -2)}…`;
  return s;
}

// ---------- the manager ----------

const ROW_Y = 36;
const ROW_H = 14;
const ROWS = 6;
const STRIP_Y = 20;

// SELECT on the shelf. Up and down walk every cartridge and group, in their order and
// their groups, as one list; A opens what can be done with one (play it, see its sheet,
// move it, put it in a group, take it off); the strip on top installs a game, sorts the
// shelf or opens the account. Resolves with { play: id } to insert a cartridge, or null.
export class Manager {
  constructor(lib, at = null) {
    this.lib = lib;
    this.f = 0;
    this.pointer = true;
    this.sel = 0;
    this.strip = 0;
    this.top = 0;
    this.moving = null;    // the item being moved with up and down
    this.busy = false;     // a change on its way to whoever holds the shelf
    this.notice = null;    // { text, color, until }
    this.hold = 0;
    this.flatten();
    if (at) { const i = this.rows.findIndex((r) => r.it === at); if (i >= 0) this.sel = i; }
    this.scroll();
  }

  // What the strip offers: installing, sorting, and the account (hosted, with one).
  buttons() {
    const b = [{ id: 'install', label: t('console.library.install') }, { id: 'sort', label: t('console.library.sort') }];
    if (isHosted() && !account()?.local) b.push({ id: 'account', label: t('console.library.account') });
    return b;
  }

  // The tree as rows: { it, depth }.
  flatten() {
    const rows = [];
    const walk = (list, depth) => { for (const it of list) { rows.push({ it, depth }); if (it.group) walk(it.items, depth + 1); } };
    walk(this.lib.items, 0);
    this.rows = rows;
    if (this.sel >= rows.length) this.sel = rows.length - 1;
    if (this.sel < -1) this.sel = -1;
    if (!rows.length) this.sel = -1;
  }

  scroll() {
    if (this.sel < 0) return;
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + ROWS) this.top = this.sel - ROWS + 1;
  }

  // Keeps the cursor on an item through a rebuild.
  select(it) {
    this.flatten();
    const i = this.rows.findIndex((r) => r.it === it);
    this.sel = i >= 0 ? i : Math.min(this.sel, this.rows.length - 1);
    this.scroll();
  }

  say(key, vars = {}, color = '#7ee08a', frames = 240) {
    this.notice = { text: t(key, vars), color, until: this.f + frames };
  }

  fail(err) {
    const code = err?.code || err?.message || 'failed';
    const key = has(`console.library.error_${code}`) ? `console.library.error_${code}` : 'console.library.error';
    this.say(key, { code }, '#ff7d8f', 420);
    console.error(err);
  }

  // Runs a change: nothing else answers meanwhile, and what goes wrong is said.
  async run(fn) {
    if (this.busy) return;
    this.busy = true;
    try { await fn(); } catch (err) { this.fail(err); } finally { this.busy = false; }
  }

  // ----- what the pointer did -----

  pointed(inp) {
    const p = inp.pointer;
    if (!p?.clicked && !p?.back && !p?.wheel) return null;
    if (p.back) return 'b';
    if (p.wheel) return p.wheel < 0 ? 'up' : 'down';
    if (!p.over) return null;
    if (p.y < 18) return p.x < SCREEN_W / 2 ? 'b' : null;
    if (p.y >= STRIP_Y && p.y < STRIP_Y + 12) {
      let x = 6;
      for (const [i, b] of this.buttons().entries()) {
        const w = measure(b.label) + 10;
        if (p.x >= x && p.x < x + w) { if (this.sel === -1 && this.strip === i) return 'a'; this.sel = -1; this.strip = i; sfx('cursor'); return null; }
        x += w + 4;
      }
      return null;
    }
    if (p.y >= ROW_Y - 2 && p.y < ROW_Y + ROWS * ROW_H) {
      const r = this.top + Math.floor((p.y - ROW_Y + 2) / ROW_H);
      if (r < this.rows.length) { if (r === this.sel) return 'a'; this.sel = r; sfx('cursor'); }
    }
    return null;
  }

  update(e) {
    this.f++;
    if (this.busy || isOpen() || prompting()) return;
    const inp = e.input;
    const pt = this.pointed(inp);
    const n = this.rows.length;
    // up and down, and held they keep going
    let dir = 0;
    if (inp.pressed('up') || pt === 'up') dir = -1;
    if (inp.pressed('down') || pt === 'down') dir = 1;
    if (inp.held('up') || inp.held('down')) { this.hold++; if (this.hold > 18 && this.hold % 4 === 0) dir = inp.held('up') ? -1 : 1; } else this.hold = 0;
    if (this.moving) {
      if (dir && this.lib.shift(this.moving, dir)) { this.flatten(); this.select(this.moving); sfx('cursor'); }
      if (inp.pressed('a') || pt === 'a') { const it = this.moving; this.moving = null; this.run(async () => { await this.lib.commit(); this.select(it); this.say('console.library.saved'); }); }
      if (inp.pressed('b') || pt === 'b') { this.moving = null; this.run(async () => { await this.lib.rebuild(); this.flatten(); this.scroll(); }); sfx('cancel'); }
      return;
    }
    if (dir) {
      const first = n ? 0 : -1;
      if (this.sel === -1) { if (dir > 0 && n) this.sel = 0; } else if (dir < 0) this.sel = this.sel > first ? this.sel - 1 : -1;
      else this.sel = Math.min(n - 1, this.sel + 1);
      this.scroll();
      sfx('cursor');
    }
    if (this.sel === -1) {
      const b = this.buttons();
      if (inp.pressed('left')) { this.strip = (this.strip + b.length - 1) % b.length; sfx('cursor'); }
      if (inp.pressed('right')) { this.strip = (this.strip + 1) % b.length; sfx('cursor'); }
    } else {
      // left and right page
      if (inp.pressed('left')) { this.sel = Math.max(0, this.sel - ROWS); this.scroll(); sfx('cursor'); }
      if (inp.pressed('right')) { this.sel = Math.min(n - 1, this.sel + ROWS); this.scroll(); sfx('cursor'); }
    }
    if (inp.pressed('b') || pt === 'b') { sfx('cancel'); this.done(null); return; }
    if (inp.pressed('start')) { sfx('cancel'); this.done(null); return; }
    if (inp.pressed('a') || pt === 'a') {
      if (this.sel === -1) this.pressStrip(e, this.buttons()[this.strip].id);
      else this.open(e, this.rows[this.sel].it);
    }
  }

  pressStrip(e, id) {
    if (id === 'account') { sfx('confirm'); openAccount(); return; }
    if (id === 'sort') { sfx('confirm'); this.run(async () => { this.lib.sort(); await this.lib.commit(); this.flatten(); this.scroll(); this.say('console.library.sorted'); }); return; }
    if (id === 'install') { sfx('confirm'); this.install(e); }
  }

  // ----- what can be done with an item -----

  async open(e, it) {
    sfx('confirm');
    const items = it.group
      ? [{ id: 'move', label: t('console.library.action_move') }, { id: 'put', label: t('console.library.action_put') },
        { id: 'rename', label: t('console.library.action_rename'), disabled: it.data.title === undefined }, { id: 'ungroup', label: t('console.library.action_ungroup') }]
      : [{ id: 'play', label: t('console.library.action_play') }, { id: 'sheet', label: t('console.library.action_sheet') },
        { id: 'move', label: t('console.library.action_move') }, { id: 'put', label: t('console.library.action_put') }, { id: 'remove', label: t('console.library.action_remove') }];
    const i = await this.ask(e, items, fit(titleOf(it), 150));
    if (i < 0) return;
    const id = items[i].id;
    if (id === 'play') this.done({ play: it.id });
    else if (id === 'sheet') { if (await e.push(new Sheet(it)) === 'play') this.done({ play: it.id }); }
    else if (id === 'move') { this.moving = it; this.notice = null; sfx('confirm'); }
    else if (id === 'put') this.put(e, it);
    else if (id === 'rename') this.rename(it);
    else if (id === 'ungroup') this.ungroup(e, it);
    else if (id === 'remove') this.remove(e, it);
  }

  ask(e, items, title) {
    const list = new List(items, { title, x: null, y: 20 });
    return e.push(list);
  }

  // Where to put it: the shelf itself, any group it can go in, or a new one.
  async put(e, it) {
    const { group: current } = this.lib.levelOf(it);
    const items = [{ id: 'top', label: t('console.library.put_top'), disabled: !current }];
    const walk = (list, depth) => {
      for (const g of list) {
        if (!g.group) continue;
        items.push({ g, label: `${'  '.repeat(depth)}${fit(titleOf(g), 140 - depth * 8)}`, disabled: g === current || this.lib.within(it, g) });
        walk(g.items, depth + 1);
      }
    };
    walk(this.lib.items, 0);
    items.push({ id: 'new', label: t('console.library.put_new') });
    const i = await this.ask(e, items, t('console.library.put_title'));
    if (i < 0) return;
    if (items[i].id === 'new') { this.newGroup(e, it); return; }
    this.run(async () => {
      this.lib.putIn(it, items[i].g || null);
      await this.lib.commit();
      this.select(it);
      this.say('console.library.saved');
    });
  }

  async newGroup(e, it) {
    const name = await openPrompt({ title: 'console.library.name_title', label: 'console.library.name_label', placeholder: 'console.library.name_placeholder', go: 'console.library.name_go', max: 40 });
    if (!name?.text) return;
    const kinds = [{ id: 'saga', label: t('console.library.kind_saga') }, { id: 'collection', label: t('console.library.kind_collection') }];
    const k = await this.ask(e, kinds, t('console.library.kind_title'));
    if (k < 0) return;
    this.run(async () => {
      const g = this.lib.newGroup(it, name.text, kinds[k].id);
      await this.lib.commit();
      this.select(this.lib.items.length ? this.findGroup(g.id) || it : it);
      this.say('console.library.saved');
    });
  }

  findGroup(id) {
    const walk = (list) => { for (const x of list) { if (x.group) { if (x.id === id) return x; const f = walk(x.items); if (f) return f; } } return null; };
    return walk(this.lib.items);
  }

  async rename(g) {
    const name = await openPrompt({ title: 'console.library.rename_title', label: 'console.library.name_label', go: 'console.library.rename_go', initial: titleOf(g), max: 40 });
    if (!name?.text) return;
    this.run(async () => {
      this.lib.rename(g, name.text);
      await this.lib.commit();
      this.select(this.findGroup(g.id));
      this.say('console.library.saved');
    });
  }

  async ungroup(e, g) {
    const ok = await e.push(new Ask(t('console.library.ungroup_confirm', { title: titleOf(g) }), t('console.library.ungroup_yes'), t('console.library.no')));
    if (!ok) return;
    const first = g.items[0];
    this.run(async () => {
      this.lib.ungroup(g);
      await this.lib.commit();
      this.select(first);
      this.say('console.library.saved');
    });
  }

  async remove(e, it) {
    const ok = await e.push(new Ask(t('console.library.remove_confirm', { title: titleOf(it) }), t('console.library.remove_yes'), t('console.library.no')));
    if (!ok) return;
    this.run(async () => {
      await this.lib.drop(it);
      this.flatten();
      this.scroll();
      this.say('console.library.removed', { title: titleOf(it) });
    });
  }

  // From a GitHub repository (owner/repo, or its address), or a zip chosen on the device.
  async install() {
    const got = await openPrompt({
      title: 'console.library.install_title', label: 'console.library.install_label', placeholder: 'console.library.install_placeholder',
      note: 'console.library.install_note', go: 'console.library.install_go', file: { label: 'console.library.install_file', accept: '.zip,application/zip' }, max: 300,
    });
    if (!got) return;
    this.run(async () => {
      this.say('console.library.installing', {}, '#5fd0ff', 60 * 60);
      const what = got.file ? { zip: await got.file.arrayBuffer(), name: got.file.name } : { source: got.text };
      const cart = await this.lib.add(what);
      this.select(cart);
      this.say('console.library.installed', { title: titleOf(cart) });
    });
  }

  // ----- drawing -----

  draw(ctx) {
    const f = this.f;
    drawRoom(ctx, f);
    const head = t('console.library.title');
    if (isWeb()) { drawText(ctx, '◀', 4, 6, '#8a86c0'); drawText(ctx, head, 14, 6, '#e8e6ff'); } else drawText(ctx, head, 8, 6, '#e8e6ff');
    const n = this.lib.carts.length;
    const count = t(n === 1 ? 'console.library.count_one' : 'console.library.count', { n });
    drawText(ctx, count, SCREEN_W - 8 - measure(count), 6, '#8a86c0');
    // the strip
    let x = 6;
    for (const [i, b] of this.buttons().entries()) {
      const w = measure(b.label) + 10;
      const on = this.sel === -1 && this.strip === i;
      px(ctx, x, STRIP_Y, w, 12, on ? '#ffd25f' : '#2a2660');
      drawText(ctx, b.label, x + 5, STRIP_Y + 3, on ? '#1a1440' : '#a8a4d8');
      x += w + 4;
    }
    // the rows
    if (!this.rows.length) {
      const empty = t('console.library.empty');
      drawText(ctx, empty, centerX(empty), 70, '#a8a4d8');
    }
    for (let r = 0; r < ROWS; r++) {
      const i = this.top + r;
      const row = this.rows[i];
      if (!row) break;
      const y = ROW_Y + r * ROW_H;
      const sel = i === this.sel;
      const moving = row.it === this.moving;
      if (sel) px(ctx, 2, y - 2, SCREEN_W - 4, 13, moving ? '#6a4a10' : '#2a2660');
      const ix = 8 + row.depth * 10;
      drawIcon(ctx, ix, y - 1, row.it, sel);
      const right = row.it.group ? String(row.it.count) : '';
      const label = fit(titleOf(row.it), SCREEN_W - ix - 24 - measure(right) - (moving ? 12 : 0));
      drawText(ctx, label, ix + 12, y, row.it.group ? '#ffd25f' : sel ? '#ffffff' : '#c8c4f0');
      if (moving) drawText(ctx, '↑↓', SCREEN_W - 20, y, '#ffd25f');
      else if (right) drawText(ctx, right, SCREEN_W - 8 - measure(right), y, '#8a86c0');
    }
    // the foot: what the row is, and what the buttons do
    px(ctx, 0, 122, SCREEN_W, 38, '#0c0a1c');
    // more rows above or below: an arrow beside the strip, one on the foot
    if (this.top > 0 && blink(f, 20)) drawText(ctx, '▲', SCREEN_W - 10, STRIP_Y + 1, '#8a86c0');
    if (this.top + ROWS < this.rows.length && blink(f, 20)) drawText(ctx, '▼', SCREEN_W - 10, 123, '#8a86c0');
    const cur = this.sel >= 0 ? this.rows[this.sel]?.it : null;
    let line = '';
    if (cur?.group) line = t(`console.library.group_${cur.kind}${cur.count === 1 ? '_one' : ''}`, { n: cur.count });
    else if (cur) line = taglineOf(cur);
    else line = t(`console.library.strip_${this.buttons()[this.strip].id}`);
    drawText(ctx, fit(line, SCREEN_W - 16), 8, 128, '#a8a4d8');
    const notice = this.notice && this.notice.until > f ? this.notice : null;
    if (this.busy && !notice) { const w = t('console.library.working'); drawText(ctx, w, 8, 142, '#5fd0ff'); }
    else if (notice) drawText(ctx, fit(notice.text, SCREEN_W - 16), 8, 142, notice.color);
    else {
      const key = this.moving ? 'console.library.move_hint' : this.sel === -1 ? 'console.library.strip_hint' : 'console.library.hint';
      drawText(ctx, t(hint(key)), 8, 142, '#5fd0ff');
    }
  }
}

// ---------- a question with two answers ----------

export class Ask {
  constructor(question, yes, no) {
    this.lines = wrap(question, 200);
    this.options = [yes, no];
    this.sel = 1;
    this.pointer = true;
    this.opaque = false;
    this.aboveFade = true;
    this.h = this.lines.length * 12 + 44;
    this.y = Math.round((SCREEN_H - this.h) / 2);
  }

  update(e) {
    const inp = e.input;
    const pt = pointRows(inp, 12, this.y, SCREEN_W - 24, this.h, this.y + 10 + this.lines.length * 12, 13, 2);
    if (inp.pressed('up') || inp.pressed('down') || pt.wheel) { this.sel = 1 - this.sel; sfx('cursor'); }
    if (pt.hover >= 0 && pt.hover !== this.sel) { this.sel = pt.hover; sfx('cursor'); }
    if (inp.pressed('b') || pt.back) { sfx('cancel'); this.done(false); return; }
    if (inp.pressed('a') || pt.pick >= 0) { sfx(this.sel === 0 ? 'confirm' : 'cancel'); this.done(this.sel === 0); }
  }

  draw(ctx) {
    const th = getTheme();
    frame(ctx, 12, this.y, SCREEN_W - 24, this.h);
    this.lines.forEach((l, i) => drawText(ctx, l, 22, this.y + 8 + i * 12, th.text, th.shadow));
    this.options.forEach((label, i) => {
      const ly = this.y + 12 + this.lines.length * 12 + i * 13;
      if (i === this.sel) drawText(ctx, '▶', 24, ly, th.accent, th.shadow);
      drawText(ctx, label, 34, ly, th.text, th.shadow);
    });
  }
}

// ---------- a cartridge's sheet ----------

// Its label big, what it says of itself, its saves, where it came from. A plays it.
export class Sheet {
  constructor(cart) {
    this.cart = cart;
    this.f = 0;
    this.pointer = true;
    this.meta = null;
    // what the package says of itself (luma.json), when it says anything
    fetch(`${cart.game.base}luma.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((m) => { this.meta = m || {}; }).catch(() => { this.meta = {}; });
  }

  saves() {
    const re = new RegExp(`^luma32\\.${this.cart.game.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.slot\\d+$`);
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) if (re.test(localStorage.key(i))) n++;
    return n;
  }

  update(e) {
    this.f++;
    const inp = e.input;
    const p = inp.pointer;
    if (inp.pressed('b') || p?.back || (p?.clicked && p.y < 18)) { sfx('cancel'); this.done(null); return; }
    if (inp.pressed('a') || inp.pressed('start') || clicked(inp)) { sfx('confirm'); this.done('play'); }
  }

  draw(ctx) {
    const f = this.f;
    const { game, entry } = this.cart;
    drawRoom(ctx, f);
    const head = t('console.library.sheet_title');
    if (isWeb()) { drawText(ctx, '◀', 4, 6, '#8a86c0'); drawText(ctx, head, 14, 6, '#e8e6ff'); } else drawText(ctx, head, 8, 6, '#e8e6ff');
    // the label, big
    const lx = 10;
    const ly = 26;
    const lw = 92;
    const lh = 76;
    px(ctx, lx + 3, ly + 3, lw + 2, lh + 2, '#0a0918');
    px(ctx, lx - 2, ly - 2, lw + 4, lh + 4, '#8a889a');
    px(ctx, lx - 1, ly - 1, lw + 2, lh + 2, '#1a1826');
    ctx.save();
    ctx.beginPath();
    ctx.rect(lx, ly, lw, lh);
    ctx.clip();
    px(ctx, lx, ly, lw, lh, '#2a2660');
    withCatalog(this.cart.id, () => game.cover?.(ctx, lx, ly, lw, lh, f));
    ctx.restore();
    drawText(ctx, 'LUMA32', lx + Math.round((lw - measure('LUMA32')) / 2), ly + lh + 6, '#565466');
    // the words
    const tx = 112;
    const tw = SCREEN_W - tx - 6;
    let y = 24;
    for (const l of wrap(titleOf(this.cart), tw).slice(0, 2)) { drawText(ctx, l, tx, y, '#ffffff', '#3a3670'); y += 12; }
    for (const l of wrap(taglineOf(this.cart), tw).slice(0, 3)) { drawText(ctx, l, tx, y, '#a8a4d8'); y += 12; }
    y += 4;
    const facts = [];
    if (game.meta?.rating) facts.push([t('console.library.sheet_rating', { age: game.meta.rating }), '#ff7d8f']);
    const n = this.saves();
    facts.push([t(n === 1 ? 'console.library.sheet_saves_one' : n ? 'console.library.sheet_saves' : 'console.library.sheet_no_saves', { n }), '#c8c4f0']);
    if (this.meta?.author) facts.push([t('console.library.sheet_author', { author: this.meta.author }), '#c8c4f0']);
    if (this.meta?.engine) facts.push([t('console.library.sheet_engine', { v: this.meta.engine }), '#c8c4f0']);
    if (game.version != null) facts.push([t('console.library.sheet_version', { v: game.version }), '#8a86c0']);
    const from = entry?.source || this.meta?.homepage || '';
    for (const [line, color] of facts) { if (y > 112) break; for (const l of wrap(line, tw).slice(0, 2)) { if (y > 112) break; drawText(ctx, l, tx, y, color); y += 12; } }
    // where it came from, on one line however long the address
    if (from && y <= 112) drawText(ctx, fit(t('console.library.sheet_from', { source: from.replace(/^github:/, 'GitHub ').replace(/^https?:\/\/(www\.)?/, '') }), tw), tx, y, '#8a86c0');
    px(ctx, 0, 122, SCREEN_W, 38, '#0c0a1c');
    const key = entry?.key && entry.key !== game.id ? `${game.id} (${entry.key})` : game.id;
    drawText(ctx, fit(t('console.library.sheet_id', { id: key }), SCREEN_W - 16), 8, 128, '#8a86c0');
    if (blink(f)) drawText(ctx, t(hint('console.library.sheet_hint')), 8, 142, '#5fd0ff');
  }
}

// Kit: an inventory. Code to copy into a cartridge and make its own, not a library the
// engine knows: rename it, cut what the game doesn't need, change how it looks. Nothing in
// the console asks a game to use it.
//
// What the player carries lives in the save's flags (`inv.<id>` = how many), so a reload
// restores it and the story reads it like any flag. Items are the game's:
//
//   const ITEMS = {
//     potion: { name: 'item.potion', note: 'item.potion_note', use: async (api) => heal(api, 20) },
//     key:    { name: 'item.key', note: 'item.key_note', keep: true },   // keep: using it doesn't spend it
//   };
//   give(api, 'potion', 2); if (has(api, 'key')) …; await bag(api, ITEMS);
//
// Text: every name and note is a key in the cartridge's catalogue, and so are the bag's
// title and its empty line (`inv.title`, `inv.empty` unless told otherwise).

export const count = (api, id) => api.get(`inv.${id}`) || 0;
export const has = (api, id, n = 1) => count(api, id) >= n;

export function give(api, id, n = 1, { quiet = false } = {}) {
  api.set(`inv.${id}`, count(api, id) + n);
  if (!quiet) api.sfx('item');
}

// Takes n if there are n; false (and nothing taken) if not.
export function take(api, id, n = 1) {
  const c = count(api, id);
  if (c < n) return false;
  api.set(`inv.${id}`, c - n);
  if (api.get(`inv.${id}`) === 0) {
    for (const b of ['x', 'y', 'z']) if (assigned(api, b) === id) assign(api, b, null);
  }
  return true;
}

// The ids the player has, in the order the game lists its items.
export const owned = (api, items) => Object.keys(items).filter((id) => count(api, id) > 0);

// The bag on screen: a scrolling list, A uses (an item with `use`), B closes. `use` returns
// false to say it did nothing (nothing is spent). Resolves with the id used, or null.
export async function bag(api, items, { title = 'inv.title', empty = 'inv.empty', pick = false } = {}) {
  for (;;) {
    const ids = owned(api, items);
    if (!ids.length) { await api.narrate(empty); return null; }
    const k = await api.list(ids.map((id) => ({
      label: items[id].name,
      value: items[id].keep ? '' : `×${count(api, id)}`,
      note: items[id].note,
      disabled: !pick && !items[id].use,
    })), { title });
    if (k < 0) return null;
    const id = ids[k];
    if (pick) return id;
    const it = items[id];
    if ((await it.use(api)) === false) continue;
    if (!it.keep) take(api, id);
    return id;
  }
}

// An item on a button (X, Y or Z, declared in game.js `buttons`): the game reads it in its
// own update and does what the item does.
export const assign = (api, button, id) => api.set(`inv.on.${button}`, id);
export const assigned = (api, button) => api.get(`inv.on.${button}`) || null;

// Save slots per cartridge, in localStorage (and, with an account, on the server: see
// host.js). A save is plain JSON: where the player
// stands, the story flags and the ordered list of choices.
//
// Two versions live in a save: `v`, the engine's format, and `gv`, the cartridge's own
// (its `version`, 0 when it has none). The engine upgrades its format itself; a cartridge
// that changes what its flags mean bumps `version` and writes `migrate(save, from)`.
import { changed } from './host.js';

const VERSION = 1;
// UPGRADES[n] turns a save of engine format n into format n + 1.
const UPGRADES = [];

export class SaveSlot {
  // Slot 1 keeps the key it always had, so saves from before slots still load.
  constructor(gameId, n = 1) {
    this.n = n;
    this.key = n === 1 ? `luma32.${gameId}.slot1` : `luma32.${gameId}.slot${n}`;
  }

  exists() { return !!this.read(); }

  // The stored save in the engine's current format, or null. Cartridge migration is
  // `load` below, which needs the game.
  read() {
    let s;
    try { s = JSON.parse(localStorage.getItem(this.key)); } catch { return null; }
    if (!s || !s.map) return null;
    for (let v = s.v ?? 1; v < VERSION; v++) {
      if (!UPGRADES[v]) return null;
      s = UPGRADES[v](s);
      s.v = v + 1;
    }
    return s.v === VERSION ? s : null;
  }

  // read() plus the cartridge's own migration. A save the cartridge cannot migrate is
  // reported and treated as absent, never loaded half-understood.
  load(game) {
    let s = this.read();
    if (!s) return null;
    const want = game.version ?? 0;
    const have = s.gv ?? 0;
    if (have === want) return s;
    if (have > want || !game.migrate) {
      console.error(`save ${this.key}: cartridge version ${have}, expected ${want}${game.migrate ? '' : ' and no migrate()'}`);
      return null;
    }
    s = game.migrate(s, have);
    if (!s) return null;
    s.gv = want;
    return s;
  }

  write(save, game) {
    localStorage.setItem(this.key, JSON.stringify({ ...save, v: VERSION, gv: game?.version ?? save.gv ?? 0 }));
    changed(this.key);
  }

  clear() { localStorage.removeItem(this.key); changed(this.key); }

  static fresh(game) { return { v: VERSION, gv: game?.version ?? 0, flags: {}, choices: [], objective: null, map: null }; }
}

// Every slot of a cartridge (game.saves, default 1).
export const slotsOf = (game) => Array.from({ length: Math.max(1, game.saves ?? 1) }, (_, i) => new SaveSlot(game.id, i + 1));

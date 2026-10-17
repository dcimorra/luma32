// A local checkout's shelf: public/games/index.json and the game folders under it. What
// tools/add-game.mjs does from the command line and the console's own manager (SELECT on
// the shelf, engine/library.js) does through serve.mjs's API.
//
// index.json: { games: [{ id, src?, group? }], groups: [{ id, kind?, parent?, title?,
// tagline? }] }. A group with a `title` is data the player wrote (default art, or `art`,
// the house's drawn art in public/groups/<art>/); one without is a folder,
// public/groups/<id>/, with its own group.js and catalogue.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip, unpack, describe, parseGithub, fetchGithub } from './packages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GAMES = path.join(ROOT, 'public', 'games');
const INDEX = path.join(GAMES, 'index.json');
const ID = /^[a-z0-9_-]{1,40}$/;
const GROUP_ID = /^[a-z0-9-]{1,40}$/;

const fail = (error, status = 400) => Object.assign(new Error(error), { status });

export function readShelf() {
  let list = { games: [], groups: [] };
  try { list = JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch { /* a new shelf */ }
  if (!Array.isArray(list.games)) list.games = [];
  if (!Array.isArray(list.groups)) list.groups = [];
  return list;
}

function writeShelf(list) {
  fs.mkdirSync(GAMES, { recursive: true });
  fs.writeFileSync(INDEX, `${JSON.stringify(list, null, 2)}\n`);
}

// The shelf as the console sent it back: the same games in a new order and in their
// groups, the groups as the player left them. A game the shelf does not have, or an id
// that is not one, is refused whole: nothing is added or dropped this way.
export function arrange({ games, groups }) {
  if (!Array.isArray(games) || !Array.isArray(groups)) throw fail('bad_shelf');
  const list = readShelf();
  const known = new Map(list.games.map((g) => [g.id, g]));
  const gids = new Set();
  const outGroups = groups.map((g) => {
    if (!g || typeof g !== 'object' || typeof g.id !== 'string' || !GROUP_ID.test(g.id) || gids.has(g.id)) throw fail('bad_group');
    gids.add(g.id);
    const out = { id: g.id };
    if (g.kind === 'collection' || g.kind === 'saga') out.kind = g.kind;
    if (typeof g.parent === 'string' && GROUP_ID.test(g.parent) && g.parent !== g.id) out.parent = g.parent;
    if (typeof g.title === 'string') {
      out.title = g.title.trim().slice(0, 80);
      if (typeof g.tagline === 'string' && g.tagline.trim()) out.tagline = g.tagline.trim().slice(0, 120);
      if (typeof g.art === 'string' && GROUP_ID.test(g.art)) out.art = g.art;
    }
    return out;
  });
  const seen = new Set();
  const outGames = games.map((g) => {
    const id = g?.key ?? g?.id;
    const was = known.get(id);
    if (!was || seen.has(id)) throw fail('bad_game');
    seen.add(id);
    const out = { ...was };
    if (typeof g.group === 'string' && gids.has(g.group)) out.group = g.group; else delete out.group;
    return out;
  });
  // games the console did not mention keep their place at the end
  for (const g of list.games) if (!seen.has(g.id)) outGames.push(g);
  const out = { ...list, games: outGames, groups: outGroups };
  writeShelf(out);
  return out;
}

function place(id, force) {
  const target = path.join(GAMES, id);
  if (fs.lstatSync(target, { throwIfNoEntry: false })) {
    if (!force) throw fail('exists', 409);
    fs.rmSync(target, { recursive: true, force: true });
  }
  return target;
}

// Puts a game on the shelf, with where it came from (shown on its sheet).
function shelve(id, source) {
  const list = readShelf();
  if (!list.games.some((g) => g.id === id)) list.games.push(source ? { id, source } : { id });
  writeShelf(list);
}

// Links a folder on this computer: what is edited there is what plays.
export function installFolder(dir, { force = false } = {}) {
  if (!fs.existsSync(path.join(dir, 'game.js'))) throw fail('no_game_js');
  const files = ['game.js', 'luma.json', 'locales/es/common.json', 'locales/es.json'].filter((p) => fs.existsSync(path.join(dir, p)))
    .map((p) => ({ path: p, data: fs.readFileSync(path.join(dir, p)) }));
  const meta = describe(files);
  fs.mkdirSync(GAMES, { recursive: true });
  fs.symlinkSync(dir, place(meta.id, force), 'dir');
  shelve(meta.id, dir);
  return { ...meta, source: dir };
}

// Unpacks a zip (a file, or a repository as GitHub serves it) into public/games/<id>/:
// only what a game runs on, as luma32.com stores a package. `within`: the folder in it.
export function installZip(zip, { within = '', force = false, source = 'zip' } = {}) {
  const { files } = unpack(readZip(zip), within);
  const meta = describe(files);
  const target = place(meta.id, force);
  fs.mkdirSync(GAMES, { recursive: true });
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(target, f.path)), { recursive: true });
    fs.writeFileSync(path.join(target, f.path), f.data);
  }
  shelve(meta.id, source);
  return { ...meta, source };
}

// A GitHub repository (owner/repo[@ref][/path], or its URL).
export async function installGithub(spec, { force = false } = {}) {
  const gh = parseGithub(spec);
  const zip = await fetchGithub(gh);
  return installZip(zip, { within: gh.path, force, source: `github:${gh.owner}/${gh.repo}${gh.ref ? `@${gh.ref}` : ''}${gh.path ? `/${gh.path}` : ''}` });
}

// Takes a game off the shelf and deletes its folder (a linked folder is only unlinked:
// what it points at stays where it was).
export function removeGame(id) {
  if (!ID.test(id)) throw fail('bad_game');
  const list = readShelf();
  if (!list.games.some((g) => g.id === id)) throw fail('not_found', 404);
  const target = path.join(GAMES, id);
  const st = fs.lstatSync(target, { throwIfNoEntry: false });
  if (st?.isSymbolicLink()) fs.unlinkSync(target);
  else if (st) fs.rmSync(target, { recursive: true, force: true });
  list.games = list.games.filter((g) => g.id !== id);
  writeShelf(list);
}

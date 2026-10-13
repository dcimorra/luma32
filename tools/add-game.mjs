#!/usr/bin/env node
// Puts a game on this checkout's shelf, from wherever it is:
//
//   node tools/add-game.mjs owner/repo              a GitHub repository (its default branch)
//   node tools/add-game.mjs owner/repo@v1.2/games/x  a tag or branch, and the folder in it
//   node tools/add-game.mjs https://github.com/owner/repo/tree/main/x
//   node tools/add-game.mjs ~/Downloads/game.zip    a zip
//   node tools/add-game.mjs ~/src/my-game           a folder on this computer (linked, not
//                                                   copied: what you edit there is what plays)
//
// A zip or a repository is unpacked into public/games/<id>/ (only what a game runs on, as
// luma32.com stores a package: server/packages.mjs); a folder is linked there. Either way
// the game goes into public/games/index.json. --force replaces a game already there.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip, unpack, describe, parseGithub, fetchGithub } from '../server/packages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = path.join(ROOT, 'public', 'games');
const args = process.argv.slice(2);
const force = args.includes('--force');
const what = args.find((a) => !a.startsWith('--'));
if (!what) { console.error('usage: node tools/add-game.mjs <owner/repo[@ref][/path] | github URL | file.zip | folder> [--force]'); process.exit(2); }

function place(id) {
  const target = path.join(GAMES, id);
  if (fs.existsSync(target) || fs.lstatSync(target, { throwIfNoEntry: false })) {
    if (!force) { console.error(`public/games/${id} already exists (--force replaces it)`); process.exit(1); }
    fs.rmSync(target, { recursive: true, force: true });
  }
  return target;
}

function shelve(id, title) {
  const file = path.join(GAMES, 'index.json');
  let list = { games: [], groups: [] };
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* a new shelf */ }
  if (!list.games.some((g) => g.id === id)) list.games.push({ id });
  fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
  console.log(`added "${title}" as public/games/${id}/`);
}

const local = path.resolve(what.replace(/^~(?=\/)/, process.env.HOME || '~'));
fs.mkdirSync(GAMES, { recursive: true });
if (fs.existsSync(local) && fs.statSync(local).isDirectory()) {
  if (!fs.existsSync(path.join(local, 'game.js'))) { console.error(`${what}: no game.js in that folder`); process.exit(1); }
  const files = ['game.js', 'luma.json', 'locales/es/common.json', 'locales/es.json'].filter((p) => fs.existsSync(path.join(local, p)))
    .map((p) => ({ path: p, data: fs.readFileSync(path.join(local, p)) }));
  const meta = describe(files);
  fs.symlinkSync(local, place(meta.id), 'dir');
  shelve(meta.id, meta.title);
} else {
  let zip;
  let within = '';
  if (fs.existsSync(local)) zip = fs.readFileSync(local);
  else {
    const gh = parseGithub(what);
    console.log(`fetching ${gh.owner}/${gh.repo}${gh.ref ? `@${gh.ref}` : ''} from GitHub…`);
    zip = await fetchGithub(gh);
    within = gh.path;
  }
  const { files } = unpack(readZip(zip), within);
  const meta = describe(files);
  const target = place(meta.id);
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(target, f.path)), { recursive: true });
    fs.writeFileSync(path.join(target, f.path), f.data);
  }
  shelve(meta.id, meta.title);
}

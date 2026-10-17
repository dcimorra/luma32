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
// The console does the same from its own shelf (SELECT): server/library.mjs is what both run.
import fs from 'node:fs';
import path from 'node:path';
import { installFolder, installZip, installGithub } from '../server/library.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const what = args.find((a) => !a.startsWith('--'));
if (!what) { console.error('usage: node tools/add-game.mjs <owner/repo[@ref][/path] | github URL | file.zip | folder> [--force]'); process.exit(2); }

const local = path.resolve(what.replace(/^~(?=\/)/, process.env.HOME || '~'));
try {
  let meta;
  if (fs.existsSync(local) && fs.statSync(local).isDirectory()) meta = installFolder(local, { force });
  else if (fs.existsSync(local)) meta = installZip(fs.readFileSync(local), { force, source: what });
  else {
    console.log(`fetching ${what} from GitHub…`);
    meta = await installGithub(what, { force });
  }
  console.log(`added "${meta.title}" as public/games/${meta.id}/`);
} catch (err) {
  // one repository, one game: with several, say which folders there are
  if (err.message === 'several_games') console.error(`more than one game in there: add one by its folder (${err.games.map((g) => `${what.replace(/\/+$/, '')}/${g}`).join(', ')})`);
  else if (err.message === 'exists') console.error(`that game is already in public/games (--force replaces it)`);
  else if (err.message === 'no_game_js') console.error(`${what}: no game.js in there`);
  else console.error(err.status ? `${what}: ${err.message}` : err);
  process.exit(1);
}

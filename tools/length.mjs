// How long a cartridge takes to read: the words of its catalogues (locales/es/**/*.json)
// and the minutes a first-time player spends reading them, at READ_WPM words a minute
// (typed-out boxes, read once). Not part of the site. See the skill's length.md: reading
// is at most half of a game's length; the rest is played.
//   node tools/length.mjs <game-id> [more ids…]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const READ_WPM = Number(process.env.READ_WPM) || 230;
const GAMES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'games');
// keys that are the console's furniture, not the story: shelf labels, speaker names
const SKIP = new Set(['meta', 'speakers']);

function words(node) {
  if (typeof node === 'string') return node.replace(/\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean).length;
  if (Array.isArray(node)) return node.reduce((n, v) => n + words(v), 0);
  if (node && typeof node === 'object') return Object.entries(node).reduce((n, [k, v]) => n + (SKIP.has(k) ? 0 : words(v)), 0);
  return 0;
}

function files(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const f = path.join(dir, d.name);
    return d.isDirectory() ? files(f) : d.name.endsWith('.json') ? [f] : [];
  });
}

const ids = process.argv.slice(2);
if (!ids.length) { console.error('usage: node tools/length.mjs <game-id> [more ids…]'); process.exit(1); }
for (const id of ids) {
  const dir = path.join(GAMES, id, 'locales', 'es');
  const per = files(dir).map((f) => [path.relative(dir, f), words(JSON.parse(fs.readFileSync(f, 'utf8')))]).sort((a, b) => b[1] - a[1]);
  const total = per.reduce((n, [, w]) => n + w, 0);
  console.log(`${id}: ${total} words, about ${Math.round(total / READ_WPM)} min of reading at ${READ_WPM} wpm`);
  if (ids.length === 1) for (const [f, w] of per) console.log(`  ${String(w).padStart(6)}  ${f}`);
}

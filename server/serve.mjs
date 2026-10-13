#!/usr/bin/env node
// Serves public/ as it is, for playing and making games on this computer:
//   node server/serve.mjs            http://localhost:8765/
//   PORT=9000 node server/serve.mjs
// No accounts, no cloud: the shelf is public/games/index.json and saves stay in the
// browser (engine/host.js, "local"). tools/add-game.mjs puts games on the shelf.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFile } from './static.mjs';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || '127.0.0.1';

http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  const p = new URL(req.url, 'http://x').pathname;
  // while making a game, every file is asked for again: an edit shows on reload
  return serveFile(req, res, PUBLIC, p === '/' ? 'index.html' : p, { cache: 'no-cache' });
}).listen(PORT, HOST, () => console.log(`LUMA 32 on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`));

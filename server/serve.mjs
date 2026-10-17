#!/usr/bin/env node
// Serves public/ as it is, for playing and making games on this computer:
//   node server/serve.mjs            http://localhost:8765/
//   PORT=9000 node server/serve.mjs
// No accounts, no cloud: the shelf is public/games/index.json and saves stay in the
// browser (engine/host.js, "local"). tools/add-game.mjs puts games on the shelf, and so
// does the console itself (SELECT on the shelf: engine/library.js), through this API:
//   GET    /api/library        the shelf, as index.json has it
//   PUT    /api/library        { games: [{ key, group }], groups }: a new order, the groups
//   POST   /api/install        { source: "owner/repo" | GitHub URL }, or a zip as the body
//   DELETE /api/games/<id>     takes the game off the shelf and deletes its folder
// Only this computer's browser is meant to reach it: the server listens on 127.0.0.1.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFile } from './static.mjs';
import { readShelf, arrange, installGithub, installZip, removeGame } from './library.mjs';
import { MAX_ZIP } from './packages.mjs';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || '127.0.0.1';

const json = (res, status, value) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

function body(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > max) { reject(Object.assign(new Error('too_big'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function api(req, res, p) {
  // the browser's own page only: a page from elsewhere gets nothing from here
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return json(res, 403, { error: 'origin' });
  if (p === '/api/library' && req.method === 'GET') return json(res, 200, { ...readShelf(), manage: true });
  if (p === '/api/library' && req.method === 'PUT') {
    const shelf = JSON.parse((await body(req, 1 << 20)).toString('utf8'));
    return json(res, 200, arrange(shelf));
  }
  if (p === '/api/install' && req.method === 'POST') {
    const data = await body(req, MAX_ZIP);
    const type = String(req.headers['content-type'] || '');
    let game;
    if (type.startsWith('application/json')) {
      const { source } = JSON.parse(data.toString('utf8'));
      game = await installGithub(source);
    } else game = installZip(data, { source: 'zip' });
    return json(res, 200, { key: game.id, id: game.id, title: game.title, source: game.source, support: game.support });
  }
  const m = /^\/api\/games\/([a-z0-9_-]{1,40})$/.exec(p);
  if (m && req.method === 'DELETE') { removeGame(m[1]); return json(res, 200, { ok: true }); }
  return json(res, 404, { error: 'not_found' });
}

http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p.startsWith('/api/')) {
    return api(req, res, p).catch((err) => {
      if (err instanceof SyntaxError) return json(res, 400, { error: 'bad_json' });
      if (!err.status) console.error(err);
      return json(res, err.status || 500, { error: err.status ? err.message : 'failed', games: err.games });
    });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  // while making a game, every file is asked for again: an edit shows on reload
  return serveFile(req, res, PUBLIC, p === '/' ? 'index.html' : p, { cache: 'no-cache' });
}).listen(PORT, HOST, () => console.log(`LUMA 32 on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`));

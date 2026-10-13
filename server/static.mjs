// Static files with an ETag, so the service worker's revalidation costs a 304.
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

// Scripts and styles may be kept for an hour (the service worker revalidates anyway);
// pages, catalogues and the service worker itself are always asked for again.
function defaultCache(ext) {
  return ext === '.html' || ext === '.json' || ext === '.webmanifest' ? 'no-cache' : 'public, max-age=3600';
}

// The validator of a file: its size and modification time (offline.mjs lists the same one).
export const etagOf = (st) => `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;

export function serveFile(req, res, root, rel, { cache } = {}) {
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { res.writeHead(400); return res.end(); }
  const file = path.join(root, path.normalize(`/${decoded}`));
  if (!file.startsWith(root + path.sep) || decoded.split('/').some((part) => part.startsWith('.') && part.length > 0)) {
    res.writeHead(404); return res.end();
  }
  let st;
  try {
    st = fs.statSync(file);
    if (st.isDirectory()) return serveFile(req, res, root, path.join(rel, 'index.html'), { cache });
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404\n'); }
  const ext = path.extname(file).toLowerCase();
  const name = path.basename(file);
  const etag = etagOf(st);
  const headers = {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': name === 'sw.js' ? 'no-cache' : (cache || defaultCache(ext)),
    ETag: etag,
    'Last-Modified': st.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  headers['Content-Length'] = st.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

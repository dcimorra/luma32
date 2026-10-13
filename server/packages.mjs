// Game packages: a cartridge somebody found on the internet, uploaded as a zip or fetched
// from a GitHub repository, kept once however many accounts have it.
//
// A package is the folder that holds `game.js` (the shallowest one in the zip), with only
// what a game runs on (SERVED in protect.mjs): notes, references, a .git, tests stay out.
// Its id is the hash of its content — every path with the hash of its bytes — not of the
// zip, so the same game zipped twice, or fetched from GitHub after someone uploaded it, is
// one package. Accounts are linked to it (store: library); unlinking the last one deletes it.
//
// Packages live under DATA_DIR/packages/<sha>/ and are served on the play origin at
// /p/<sha>/ (main.mjs): two levels deep, like public/games/<id>/, so a cartridge's
// `../../engine/x.js` imports reach the engine there as they do in a local checkout.
//
// Optional `luma.json` beside game.js: { id, title, author, support, homepage }. Without it
// the id is the one game.js declares and the title its catalogue's meta.title.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { SERVED } from './served.mjs';

export const QUOTA = Number(process.env.LIBRARY_QUOTA_MB || 100) * 1024 * 1024;
// what a zip may hold before it is refused without reading further (zip bombs)
const MAX_ENTRIES = 5000;
const MAX_UNPACKED = 300 * 1024 * 1024;
export const MAX_ZIP = 100 * 1024 * 1024;
// folders of a game that are about making it, not playing it (offline.mjs skips the same)
const SKIP_DIRS = new Set(['refs', 'reports', 'tests', 'test', 'node_modules', '__MACOSX']);
const GAME_ID = /^[a-z0-9_-]{1,40}$/;
export const SHA = /^[a-f0-9]{64}$/;

const fail = (error, status = 400) => Object.assign(new Error(error), { status });
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// The entries of a zip, from its central directory: [{ name, size, read() }]. Stored and
// deflated entries only; no zip64, no encryption (a game is never that big or secret).
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw fail('bad_zip');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || at === 0xffffffff) throw fail('bad_zip');
  if (count > MAX_ENTRIES) throw fail('zip_too_many');
  const out = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw fail('bad_zip');
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const csize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw fail('zip_encrypted');
    if (method !== 0 && method !== 8) throw fail('zip_method');
    out.push({
      name, size,
      read() {
        if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw fail('bad_zip');
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + csize);
        const data = method === 0 ? raw : zlib.inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
        if (data.length !== size) throw fail('bad_zip');
        return data;
      },
    });
  }
  return out;
}

// A path inside a package: relative, forward slashes, no dot-folders, no way out.
function cleanPath(name) {
  const parts = name.replace(/\\/g, '/').split('/').filter((p) => p !== '' && p !== '.');
  if (!parts.length || parts.some((p) => p === '..' || p.startsWith('.') || /[\0-\x1f]/.test(p))) return null;
  return parts.join('/');
}

// The zip's entries as a package: the folder holding the shallowest game.js (inside
// `within` when given, the path a GitHub link pointed at), only what a game runs on.
// Two game.js at the same depth: the first by name, so the same zip always gives the same.
// Returns { files: [{ path, data }], bytes }.
export function unpack(entries, within = '') {
  let clean = entries.map((e) => ({ e, path: cleanPath(e.name) })).filter((x) => x.path);
  // a zip of a folder (and every GitHub zip) has one folder at the top: `within` is below it
  const tops = new Set(clean.map((x) => x.path.split('/')[0]));
  if (tops.size === 1 && clean.every((x) => x.path.includes('/'))) clean = clean.map((x) => ({ ...x, path: x.path.slice(x.path.indexOf('/') + 1) }));
  const prefix = within ? `${within.replace(/^\/+|\/+$/g, '')}/` : '';
  const games = clean.map((x) => x.path).filter((p) => (p === 'game.js' || p.endsWith('/game.js')) && p.startsWith(prefix))
    .sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1));
  if (!games.length) throw fail('no_game_js');
  const root = games[0].slice(0, -'game.js'.length);
  let total = 0;
  const files = [];
  for (const { e, path: p } of clean) {
    if (!p.startsWith(root)) continue;
    const rel = p.slice(root.length);
    const ext = path.extname(rel).toLowerCase();
    if (!SERVED.has(ext) || rel.split('/').slice(0, -1).some((d) => SKIP_DIRS.has(d))) continue;
    total += e.size;
    if (total > MAX_UNPACKED) throw fail('zip_too_big', 413);
    files.push({ path: rel, data: e.read() });
  }
  return { files, bytes: files.reduce((n, f) => n + f.data.length, 0) };
}

// The package's id: what it holds, not how it was zipped.
export function contentHash(files) {
  const lines = files.map((f) => `${f.path}\0${sha256(f.data)}`).sort();
  return sha256(lines.join('\n'));
}

// What the package says about itself: luma.json, else game.js and its catalogue.
export function describe(files) {
  const text = (p) => files.find((f) => f.path === p)?.data.toString('utf8');
  let meta = {};
  try { meta = JSON.parse(text('luma.json') || '{}'); } catch { /* ignored: the fallbacks below */ }
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  let id = str(meta.id, 40);
  if (!GAME_ID.test(id)) id = /\bid\s*:\s*['"]([a-z0-9_-]{1,40})['"]/.exec(text('game.js') || '')?.[1] || '';
  if (!id) throw fail('no_game_id');
  let title = str(meta.title, 80);
  for (const p of ['locales/es/common.json', 'locales/es.json', 'locales/en/common.json', 'locales/en.json']) {
    if (title) break;
    try { title = str(JSON.parse(text(p) || '{}').meta?.title, 80); } catch { /* next */ }
  }
  const url = (v) => (/^https:\/\/[^\s]{1,300}$/.test(str(v, 300)) ? str(v, 300) : '');
  return { id, title: title || id, author: str(meta.author, 80), support: url(meta.support), homepage: url(meta.homepage) };
}

// "owner/repo", "owner/repo@ref", "owner/repo/sub/folder", or a github.com URL
// (…/tree/<ref>/<path>). Returns { owner, repo, ref, path }.
export function parseGithub(spec) {
  const s = String(spec || '').trim().replace(/\.git$/, '');
  let m = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/([^/\s]+)(\/[^\s]*)?)?\/?$/.exec(s);
  if (m) return { owner: m[1], repo: m[2], ref: m[3] || '', path: (m[4] || '').replace(/^\/+|\/+$/g, '') };
  m = /^([\w.-]+)\/([\w.-]+)(?:@([^/\s]+))?(\/[^\s]*)?$/.exec(s);
  if (m) return { owner: m[1], repo: m[2], ref: m[3] || '', path: (m[4] || '').replace(/^\/+|\/+$/g, '') };
  throw fail('bad_github');
}

// The repository's zip as GitHub serves it (the default branch without a ref).
export async function fetchGithub({ owner, repo, ref }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/zipball${ref ? `/${encodeURIComponent(ref)}` : ''}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'luma32', Accept: 'application/vnd.github+json' }, redirect: 'follow', signal: AbortSignal.timeout(60e3) });
  if (res.status === 404) throw fail('github_not_found', 404);
  if (!res.ok) throw fail('github_failed', 502);
  const chunks = [];
  let size = 0;
  for await (const c of res.body) {
    size += c.length;
    if (size > MAX_ZIP) throw fail('zip_too_big', 413);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

// The size of what a folder serves (a local game under public/games), cached a minute.
const sized = new Map();
export function folderBytes(dir) {
  const hit = sized.get(dir);
  if (hit && Date.now() - hit.at < 60e3) return hit.bytes;
  let bytes = 0;
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full); } else if (e.isFile() && SERVED.has(path.extname(e.name).toLowerCase())) bytes += fs.statSync(full).size;
    }
  };
  walk(dir);
  sized.set(dir, { at: Date.now(), bytes });
  return bytes;
}

export class Packages {
  constructor({ dir, store }) {
    this.dir = dir;
    this.store = store;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  pathOf(sha) { return path.join(this.dir, sha); }

  // Adds the package in this zip to the account's library: kept once (a package someone
  // already has is only linked), counted against the account's space either way.
  // usage: bytes the account already uses. Returns the package and whether it was new.
  add(account, zip, { source, within = '', usage }) {
    const { files, bytes } = unpack(readZip(zip), within);
    const sha = contentHash(files);
    if (this.store.inLibrary(account.id, sha)) return { pkg: this.store.packageOf(sha), added: false };
    if (usage + bytes > QUOTA) throw Object.assign(fail('quota', 413), { need: bytes, free: Math.max(0, QUOTA - usage) });
    let pkg = this.store.packageOf(sha);
    if (!pkg) {
      const meta = describe(files);
      const target = this.pathOf(sha);
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      for (const f of files) {
        const out = path.join(tmp, f.path);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, f.data);
      }
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(tmp, target);
      pkg = this.store.addPackage({ sha, ...meta, bytes, files: files.length });
    }
    this.store.link(account.id, sha, source);
    return { pkg, added: true };
  }

  // Takes it out of the account's library; the files go when nobody has it any more.
  remove(accountId, sha) {
    if (!this.store.unlink(accountId, sha)) return false;
    this.sweep();
    return true;
  }

  // Packages nobody has (the last account unlinked it or was deleted), and folders no
  // package row knows (an upload cut half-way), are deleted.
  sweep() {
    for (const sha of this.store.orphanPackages()) { fs.rmSync(this.pathOf(sha), { recursive: true, force: true }); this.store.deletePackage(sha); }
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { return; }
    for (const n of names) if (!SHA.test(n) || !this.store.packageOf(n)) fs.rmSync(path.join(this.dir, n), { recursive: true, force: true });
  }
}

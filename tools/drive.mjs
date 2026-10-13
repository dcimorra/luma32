// One headless browser kept open between commands, for playing a stretch of a game step by
// step without booting it again each time. Not part of the site.
//   node tools/drive.mjs start <name> <url>     opens it (in the background) and waits until ready
//   node tools/drive.mjs <name> '<steps json>'  runs steps (steps.mjs) on that page, prints the output
//   node tools/drive.mjs <name> - < steps.json  the same, steps from stdin
//   node tools/drive.mjs stop <name>            closes it
//   node tools/drive.mjs list                   the ones open now
// It closes itself after DRIVE_IDLE minutes without a command (10 by default) and after
// DRIVE_MAX minutes in all (120), so a forgotten one does not stay open for days. Still:
// stop it when you are done. VP=, DPR=, TOUCH= as in shot.mjs.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { runSteps } from './steps.mjs';

const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const state = (name) => `/tmp/luma-drive-${name}.json`;
const read = (name) => { try { return JSON.parse(fs.readFileSync(state(name), 'utf8')); } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const fail = (msg) => { console.error(msg); process.exit(1); };

async function post(s, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: s.port, method: 'POST', path: '/', headers: { 'x-token': s.token } }, (res) => {
      let out = '';
      res.on('data', (d) => (out += d));
      res.on('end', () => resolve(out));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const [cmd, name, arg] = process.argv.slice(2);

if (cmd === 'serve') await serve(name, arg);
else if (cmd === 'start') {
  if (!NAME.test(name || '') || !arg) fail('usage: drive.mjs start <name> <url>');
  const old = read(name);
  if (old && alive(old.pid)) { process.kill(old.pid, 'SIGTERM'); await new Promise((r) => setTimeout(r, 1500)); }
  fs.rmSync(state(name), { force: true });
  const log = fs.openSync(`/tmp/luma-drive-${name}.log`, 'w');
  // its own session and group: it outlives this command (and the turn that ran it)
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', name, arg], { detached: true, stdio: ['ignore', log, log], env: process.env });
  child.unref();
  for (let i = 0; i < 120 && !read(name); i++) await new Promise((r) => setTimeout(r, 250));
  if (!read(name)) fail(`did not start; see /tmp/luma-drive-${name}.log`);
  console.log(`ready: ${name} (closes after ${Number(process.env.DRIVE_IDLE) || 10} min idle)`);
} else if (cmd === 'stop') {
  const s = read(name);
  if (s && alive(s.pid)) process.kill(s.pid, 'SIGTERM');
  fs.rmSync(state(name), { force: true });
  console.log(`stopped: ${name}`);
} else if (cmd === 'list') {
  for (const f of fs.readdirSync('/tmp').filter((f) => /^luma-drive-.*\.json$/.test(f))) {
    const s = JSON.parse(fs.readFileSync(`/tmp/${f}`, 'utf8'));
    console.log(`${s.name}\t${alive(s.pid) ? 'open' : 'gone'}\t${s.url}\tsince ${new Date(s.since).toISOString()}`);
  }
} else {
  if (!NAME.test(cmd || '') || !name) fail('usage: drive.mjs <name> \'<steps json>\'   (or start / stop / list)');
  const s = read(cmd);
  if (!s || !alive(s.pid)) fail(`no browser "${cmd}" open (it closes itself when idle): drive.mjs start ${cmd} <url>`);
  const body = name === '-' ? fs.readFileSync(0, 'utf8') : name;
  process.stdout.write(await post(s, body));
}

async function serve(name, url) {
  const require = createRequire(import.meta.url);
  const pw = require(process.env.PLAYWRIGHT || 'playwright-core');
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || pw.chromium.executablePath(), args: ['--autoplay-policy=no-user-gesture-required'] });
  let closing = false;
  const close = async (why) => {
    if (closing) return;
    closing = true;
    console.log(`closing: ${why}`);
    if (read(name)?.pid === process.pid) fs.rmSync(state(name), { force: true });
    await browser.close().catch(() => {});
    process.exit(0);
  };
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => close(sig));
  process.on('uncaughtException', (e) => close(`error: ${e.message}`));

  const vp = (process.env.VP || '960x560').split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: Number(process.env.DPR || 1), hasTouch: !!process.env.TOUCH, isMobile: !!process.env.TOUCH });
  const logs = [];
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning' || t.includes('[luma]')) logs.push(`[${m.type()}] ${t}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(url);

  const idleMs = (Number(process.env.DRIVE_IDLE) || 10) * 60e3;
  const maxMs = (Number(process.env.DRIVE_MAX) || 120) * 60e3;
  let idle = setTimeout(() => close('idle'), idleMs);
  setTimeout(() => close('max lifetime'), maxMs);

  const token = crypto.randomBytes(16).toString('hex');
  let busy = Promise.resolve();
  const server = http.createServer(async (req, res) => {
    if (req.headers['x-token'] !== token) { res.writeHead(403); return res.end(); }
    let body = '';
    for await (const c of req) body += c;
    clearTimeout(idle);
    // one command at a time: two scripts pressing keys on one page at once is never meant
    busy = busy.then(async () => {
      const out = [];
      try { await runSteps(page, JSON.parse(body), { prefix: `/tmp/luma-drive-${name}`, say: (l) => out.push(l) }); } catch (e) { out.push(`ERR ${e.message}`); }
      out.push(...logs.splice(0));
      res.end(out.length ? `${out.join('\n')}\n` : '');
    });
    await busy;
    idle = setTimeout(() => close('idle'), idleMs);
  });
  server.listen(0, '127.0.0.1', () => {
    fs.writeFileSync(state(name), JSON.stringify({ name, url, pid: process.pid, port: server.address().port, token, since: Date.now() }), { mode: 0o600 });
    console.log('ready');
  });
}

// Drives the console in headless Chromium and takes screenshots, for checking
// changes by eye. Not part of the site.
//   node tools/shot.mjs <url> <out-prefix> [script.json]
// Needs `npm install` in tools/ once, and Chromium in ~/.cache/ms-playwright
// (`npx playwright-core install chromium`); PLAYWRIGHT= / CHROME= override either.
// script: the steps in steps.mjs. For many commands against one open page, drive.mjs.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { runSteps } from './steps.mjs';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT || 'playwright-core');
const [url, prefix, scriptPath] = process.argv.slice(2);
const script = scriptPath ? JSON.parse(fs.readFileSync(scriptPath, 'utf8')) : [{ wait: 1500 }, { shot: 'a' }];
const exe = process.env.CHROME || pw.chromium.executablePath();

const browser = await pw.chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required'] });
const vp = (process.env.VP || '960x560').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: Number(process.env.DPR || 1), hasTouch: !!process.env.TOUCH, isMobile: !!process.env.TOUCH });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
// a script that hangs must not leave its browser behind: after SHOT_TIMEOUT seconds
// (300 by default) the browser is closed and the run fails
const limit = setTimeout(async () => {
  console.log(`[shot] gave up after ${limit.s} s; browser closed`);
  await browser.close().catch(() => {});
  process.exit(1);
}, (Number(process.env.SHOT_TIMEOUT) || 300) * 1e3);
limit.s = Number(process.env.SHOT_TIMEOUT) || 300;
try {
  await page.goto(url);
  await runSteps(page, script, { prefix });
} finally {
  clearTimeout(limit);
  await browser.close();
}

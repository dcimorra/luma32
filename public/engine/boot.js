// Power on: load the console's strings and the cartridge list, show the logo, then
// loop between the shelf and whichever cartridge is inserted.
import { Engine } from './engine.js';
import { Input } from './input.js';
import { loadStrings, t, useCatalog } from './i18n.js';
import { unlock } from './audio.js';
import { bindShell, applyShellText, paintShell, led } from './shell.js';
import { BootLogo, Shelf } from './console.js';
import { runCartridge } from './cart.js';
import { setTheme } from './ui.js';
import { init as initHost, playing } from './host.js';
import { reportTo } from './report.js';
import { Library, loadCart } from './library.js';

const LAST = 'luma32.last';

async function main() {
  const input = new Input();
  bindShell(input);
  input.onAny(() => unlock());
  addEventListener('pointerdown', () => unlock(), { capture: true });

  await loadStrings(['locales/es.json']);
  applyShellText();
  document.title = t('console.name');

  // the console comes on at once: the logo plays while the cartridges load behind it
  const engine = new Engine(document.getElementById('screen'), input);
  engine.start();
  window.luma = { engine }; // for poking at a running game from the devtools
  led(true);
  const loading = { ready: false, done: 0, total: 0 };
  const loaded = load(loading).finally(() => { loading.ready = true; });
  await engine.push(new BootLogo(loading));
  const { lib, wanted } = await loaded;
  let direct = lib.carts.find((c) => c.id === wanted || c.game.id === wanted);
  for (;;) {
    paintShell();
    input.useButtons();
    setTheme({});
    let id;
    if (direct) { id = direct.id; direct = null; }
    else id = await engine.replaceAll(new Shelf(lib, localStorage.getItem(LAST)));
    localStorage.setItem(LAST, id);
    useCatalog(id);
    const cart = lib.carts.find((c) => c.id === id);
    playing(cart.game.id);
    reportTo(cart.entry);
    try { await runCartridge(engine, cart.game); } finally { useCatalog(null); playing(null); }
  }
}

// Whoever hosts the console (host.js) says who plays, which games are theirs and where
// each lives, and brings their saves; then every cartridge loads, all at once. `progress`
// counts them for the logo.
async function load(progress) {
  const list = await initHost();
  const wanted = list.wanted;
  // ?game=<id> also loads a cartridge that is not on the shelf yet (one being built): one
  // of the library's, or a folder of a local checkout
  const entries = list.games.filter((g) => g.listed !== false || g.id === wanted || g.key === wanted);
  if (wanted && /^[a-z0-9_-]+$/.test(wanted) && !entries.some((e) => e.id === wanted || e.key === wanted)) {
    entries.push({ key: wanted, id: wanted, base: new URL(`games/${wanted}/`, location.href).href, extra: true });
  }
  else if (wanted && !/^[a-z0-9_-]+$/.test(wanted) && !entries.some((e) => e.id === wanted || e.key === wanted)) {
    console.warn(`[luma] ?game=${wanted}: a cartridge id is lowercase letters, digits, - and _ only; the shelf opens instead`);
  }
  progress.total = entries.length;
  // every cartridge loads, all at once (library.js); the shelf keeps the library's order
  const carts = (await Promise.all(entries.map((entry) => loadCart(entry, progress)))).filter(Boolean);
  const lib = new Library(carts, list.groups || []);
  await lib.rebuild();
  return { lib, wanted };
}

main().catch((err) => {
  console.error(err);
  document.body.dataset.error = String(err);
});

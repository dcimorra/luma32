// "Report a problem", from the pause menu: a dialog over the console (HTML, like the
// account's: the phone's keyboard needs a real field) where the player says what happened.
// What they cannot be asked for goes with it on its own: the game and the map, their cell,
// the objective on screen, their save as it is now, a screenshot of the moment before the
// menu opened, and the engine's last warnings.
//
// Where it goes depends on whose the game is. The house's own games (kind 'local' on a
// hosted console) report to the house, which adds reports up by map and, past a number of
// people, opens a repair (server/reports.mjs). A game the player brought is its author's:
// the player says first whether the game or the console is at fault. The game's goes to its
// author — an issue on its GitHub repository written out for them, its support page, or
// the details to copy — and the console's to LUMA 32 (the house when hosted, the engine's
// repository in a local checkout).
import { t } from './i18n.js';
import { report, isHosted } from './host.js';
import { ENGINE_VERSION } from './version.js';

// The engine's last warnings and errors, kept from the start: what it said before the
// player got stuck is often the clue.
const LOG = [];
const keep = (level) => (...args) => {
  LOG.push(`${level}: ${args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`.slice(0, 400));
  if (LOG.length > 40) LOG.shift();
};
for (const level of ['warn', 'error']) {
  const was = console[level].bind(console);
  const log = keep(level);
  console[level] = (...args) => { try { log(...args); } catch { /* never in the way */ } was(...args); };
}
addEventListener('error', (e) => keep('error')(e.message));
addEventListener('unhandledrejection', (e) => keep('error')(e.reason?.message || String(e.reason)));

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter(Boolean)); return n; };

// The engine's own repository: where a local checkout's console problems go.
const ENGINE_REPO = 'dcimorra/luma32';

// The game on screen, as the shelf had it ({ kind, source, support }); set by boot.js.
let target = null;
export function reportTo(entry) { target = entry || null; }

const githubOf = (source) => /^github:([\w.-]+\/[\w.-]+)/.exec(source || '')?.[1] || null;

// The report as text, for an issue or the clipboard: what the author needs to stand where
// the player stood. `room`: how many characters the save may take.
function details(place, kind, text, room = 6000) {
  const d = (k) => t(`console.report.details.${k}`);
  const save = place.save && place.save.length <= room ? `\n\n**${d('save')}**\n\n\`\`\`json\n${place.save}\n\`\`\`` : place.save ? `\n\n**${d('save')}**: ${d('save_too_big')}` : '';
  return `${t(`console.report.kind.${kind}`)}\n\n${text}\n\n`
    + `- **${d('game')}**: ${place.game}\n- **${d('map')}**: ${place.map}\n- **${d('cell')}**: ${place.x}, ${place.y}\n`
    + (place.objective ? `- **${d('objective')}**: ${place.objective}\n` : '')
    + `- **${d('engine')}**: LUMA 32 ${ENGINE_VERSION}\n- **${d('browser')}**: ${navigator.userAgent}\n`
    + (LOG.length ? `\n**${d('log')}**\n\n\`\`\`\n${LOG.slice(-12).join('\n')}\n\`\`\`` : '') + save;
}

function issueUrl(repo, place, kind, text) {
  const title = t('console.report.issue_title', { kind: t(`console.report.kind.${kind}`), map: place.map });
  // a URL past ~8000 characters is refused: the save goes only while it fits
  for (const room of [6000, 2500, 0]) {
    const url = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(details(place, kind, text, room))}`;
    if (url.length < 7800 || !room) return url.slice(0, 7800);
  }
  return null;
}

// Opens the dialog; resolves when it closes, sent or not. `place`: { game, map, x, y,
// objective, save (the slot as stored), shot (a PNG data URL) }.
export function reportProblem(place) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { className: 'account' });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(); });
    const close = el('button', { type: 'button', className: 'account__close', textContent: '×', ariaLabel: t('console.account.close') });
    close.addEventListener('click', () => dialog.close());
    const show = (...kids) => dialog.replaceChildren(el('h2', { textContent: t('console.report.title') }), close, ...kids);
    const button = (label, fn, className = '') => { const b = el('button', { type: 'button', textContent: label, className }); b.addEventListener('click', fn); return b; };
    const backToGame = () => button(t('console.report.back'), () => dialog.close(), 'account__link');

    // the form every way shares: what kind of problem and what happened; `then` does the rest
    const ask = (intro, label, then) => {
      const kind = el('select', { name: 'kind' }, ...['stuck', 'bug', 'other'].map((k) => el('option', { value: k, textContent: t(`console.report.kind.${k}`) })));
      const text = el('textarea', { name: 'text', rows: 5, maxLength: 2000, placeholder: t('console.report.text_placeholder') });
      const msg = el('p', { className: 'account__error', role: 'alert' });
      const send = el('button', { type: 'submit', textContent: label });
      const form = el('form', {}, el('label', {}, t('console.report.kind_label'), kind), el('label', {}, t('console.report.text'), text), send, msg);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        msg.textContent = '';
        if (kind.value !== 'stuck' && !text.value.trim()) { msg.textContent = t('console.report.error.missing_text'); return; }
        send.disabled = true;
        try { await then(kind.value, text.value.trim()); } catch (err) {
          const key = `console.report.error.${err.code}`;
          msg.textContent = t(key) !== key ? t(key) : t('console.report.error.network');
          send.disabled = false;
        }
      });
      show(el('p', { className: 'account__muted', textContent: intro }), form);
      kind.focus();
    };

    // to the house (its own game, or the console when hosted)
    const toHouse = (intro, scope) => ask(intro, t('console.report.send'), async (kind, text) => {
      const body = await report({ ...place, kind, text, log: LOG, ua: navigator.userAgent, ...(scope ? { scope, engine: ENGINE_VERSION } : {}) });
      show(el('p', { className: 'account__notice', textContent: t(scope ? 'console.report.console_received' : body.status === 'reviewing' ? 'console.report.reviewing' : 'console.report.received') }), backToGame());
    });

    // to whoever made the game, by whatever way they gave
    const copyButton = (kind, text) => {
      const b = button(t('console.report.copy'), async () => {
        try { await navigator.clipboard.writeText(details(place, kind, text)); b.textContent = t('console.report.copied'); } catch { /* no clipboard: nothing to say */ }
      }, 'account__secondary');
      return b;
    };
    const toAuthor = () => ask(t('console.report.author_intro'), t('console.report.next'), async (kind, text) => {
      // the author's own word first: the support page their luma.json gives; else, for a game
      // from GitHub, an issue on its repository (a support page on GitHub is that too)
      const repo = githubOf(target?.source);
      const issues = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/?$/.exec(target?.support || '')?.[1];
      if (issues || (repo && !target?.support)) {
        const where = issues || repo;
        const open = button(t('console.report.author_github'), () => window.open(issueUrl(where, place, kind, text), '_blank', 'noopener'));
        show(el('p', { className: 'account__muted', textContent: t('console.report.author_github_note') }), open, copyButton(kind, text), backToGame());
      } else if (target?.support) {
        show(el('a', { className: 'account__patreon', href: target.support, target: '_blank', rel: 'noopener noreferrer', textContent: t('console.report.author_support') }),
          copyButton(kind, text), backToGame());
      } else show(el('p', { className: 'account__muted', textContent: t('console.report.author_none') }), copyButton(kind, text), backToGame());
    });
    const toConsole = () => (isHosted() ? toHouse(t('console.report.console_intro'), 'engine')
      : ask(t('console.report.console_intro'), t('console.report.next'), async (kind, text) => {
        show(el('p', { className: 'account__muted', textContent: t('console.report.author_github_note') }),
          button(t('console.report.author_github'), () => window.open(issueUrl(ENGINE_REPO, place, kind, text), '_blank', 'noopener')), copyButton(kind, text), backToGame());
      }));

    document.body.append(dialog);
    if (isHosted() && target?.kind === 'local') toHouse(t('console.report.intro'), null);
    else {
      show(el('p', { className: 'account__muted', textContent: t('console.report.whose_intro') }),
        el('div', { className: 'account__actions' }, button(t('console.report.whose_game'), toAuthor), button(t('console.report.whose_console'), toConsole, 'account__secondary')));
    }
    dialog.showModal();
  });
}

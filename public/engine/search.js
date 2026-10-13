// The shelf's search box: a dialog over the console (HTML, so the phone's keyboard comes up)
// with one field. As it is typed it says how many games match; Enter, or the button,
// closes it with the words, and the shelf shows those games. Resolves with the words, or
// null when closed without searching.
import { t } from './i18n.js';

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter(Boolean)); return n; };

let open = false;
export const searching = () => open;

// count(q): how many games those words find.
export function openSearch(count, initial = '') {
  open = true;
  return new Promise((resolve) => {
    let result = null;
    const dialog = el('dialog', { className: 'account' });
    dialog.addEventListener('close', () => { dialog.remove(); open = false; resolve(result); });
    const close = el('button', { type: 'button', className: 'account__close', textContent: '×', ariaLabel: t('console.account.close') });
    close.addEventListener('click', () => dialog.close());
    const input = el('input', { type: 'search', name: 'q', value: initial, autocomplete: 'off', enterKeyHint: 'search', placeholder: t('console.search.placeholder') });
    const found = el('p', { className: 'account__muted', role: 'status' });
    const say = () => {
      const q = input.value.trim();
      const n = q ? count(q) : 0;
      found.textContent = !q ? t('console.search.hint') : t(n === 1 ? 'console.search.found_one' : n ? 'console.search.found' : 'console.search.none', { n });
    };
    input.addEventListener('input', say);
    const form = el('form', {}, el('label', {}, t('console.search.label'), input), found, el('button', { type: 'submit', textContent: t('console.search.go') }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      result = input.value.trim();
      dialog.close();
    });
    dialog.append(el('h2', { textContent: t('console.search.title') }), close, form);
    document.body.append(dialog);
    dialog.showModal();
    say();
    input.focus();
  });
}

// Lowercase and without accents, so "pasion" finds "Pasión".
export const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// A dialog over the console that asks for words (HTML, so the phone's keyboard comes
// up), in the account dialog's clothes: one field, a note under it, a button. The shelf's
// manager asks a group's name and where a game comes from with it (library.js).
// Resolves with { text, file } (a file when the dialog offered one and it was chosen), or
// null when closed without answering.
import { t } from './i18n.js';

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter(Boolean)); return n; };

let open = false;
export const prompting = () => open;

// title, label, go: catalogue keys. placeholder, note: keys too, optional. initial: the
// words to start with. file: { label, accept } offers a file instead of the words.
// check(text): what to say under the field as it is typed (a string), optional.
export function openPrompt({ title, label, go, placeholder = null, note = null, initial = '', file = null, check = null, max = 80 }) {
  open = true;
  return new Promise((resolve) => {
    let result = null;
    const dialog = el('dialog', { className: 'account' });
    dialog.addEventListener('close', () => { dialog.remove(); open = false; resolve(result); });
    const close = el('button', { type: 'button', className: 'account__close', textContent: '×', ariaLabel: t('console.account.close') });
    close.addEventListener('click', () => dialog.close());
    const input = el('input', { type: 'text', name: 'q', value: initial, maxLength: max, autocomplete: 'off', enterKeyHint: 'done', placeholder: placeholder ? t(placeholder) : '' });
    const said = el('p', { className: 'account__muted', role: 'status', textContent: note ? t(note) : '' });
    if (check) {
      const say = () => { said.textContent = check(input.value.trim()) || (note ? t(note) : ''); };
      input.addEventListener('input', say);
    }
    let picker = null;
    if (file) {
      picker = el('input', { type: 'file', name: 'file', accept: file.accept || '' });
      picker.addEventListener('change', () => { if (picker.files[0]) { result = { text: '', file: picker.files[0] }; dialog.close(); } });
    }
    const form = el('form', {}, el('label', {}, t(label), input), picker && el('label', {}, t(file.label), picker), said, el('button', { type: 'submit', textContent: t(go) }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      result = { text: input.value.trim(), file: null };
      dialog.close();
    });
    dialog.append(el('h2', { textContent: t(title) }), close, form);
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}

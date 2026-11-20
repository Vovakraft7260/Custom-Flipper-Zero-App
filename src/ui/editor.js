// Full-screen text editor for Flipper files (.txt, .ir, .sub, Bad USB scripts, ...).
import { h, confirmAction, showError, toast } from './dom.js';

export const TEXT_EXTENSIONS = new Set([
  'txt', 'ir', 'sub', 'nfc', 'rfid', 'ibtn', 'js', 'md', 'log', 'csv', 'json', 'ini', 'cfg', 'conf', 'u2f', 'fmf', 'kl', 'keys', 'dict',
]);
export const MAX_EDIT_SIZE = 256 * 1024;

export function isTextFile(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return TEXT_EXTENSIONS.has(ext);
}

/** Opens the editor. save(text) must write the file; resolves when the editor closes. */
export function openEditor(path, text, save) {
  return new Promise((resolve) => {
    let saved = text;
    const area = h('textarea', { spellcheck: false, autocapitalize: 'off', autocomplete: 'off' });
    area.value = text;
    const saveBtn = h('button', { class: 'primary' }, 'save');
    const close = async () => {
      if (area.value !== saved && !(await confirmAction('Discard unsaved changes?', 'discard', true))) return;
      el.remove();
      resolve();
    };
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'saving…';
      try {
        await save(area.value);
        saved = area.value;
        toast('saved to flipper');
      } catch (e) {
        showError(e);
      }
      saveBtn.disabled = false;
      saveBtn.textContent = 'save';
    };
    const el = h(
      'div',
      { class: 'editor' },
      h('div', { class: 'row' }, h('span', { class: 'grow path' }, path), saveBtn, h('button', { onclick: close }, 'close')),
      area,
    );
    document.body.append(el);
  });
}

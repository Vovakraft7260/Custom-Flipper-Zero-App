// Full-screen text editor for Flipper files (.txt, .ir, .sub, Bad USB scripts, ...).
import { h, confirmAction, showError, toast, pushBack } from './dom.js';

export const TEXT_EXTENSIONS = new Set([
  'txt', 'ir', 'sub', 'nfc', 'rfid', 'ibtn', 'js', 'md', 'log', 'csv', 'json', 'ini', 'cfg', 'conf', 'u2f', 'fmf', 'kl', 'keys', 'dict',
]);
export const MAX_EDIT_SIZE = 256 * 1024;

export function isTextFile(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return TEXT_EXTENSIONS.has(ext);
}

/**
 * Opens the editor. save(text) must write the file; resolves when the editor closes.
 * extraButtons: [{ label, action(text) }] shown next to save (e.g. "run").
 */
export function openEditor(path, text, save, extraButtons = []) {
  return new Promise((resolve) => {
    let saved = text;
    const area = h('textarea', { spellcheck: false, autocapitalize: 'off', autocomplete: 'off' });
    area.value = text;
    const saveBtn = h('button', { class: 'primary' }, 'save');
    const extras = extraButtons.map((b) =>
      h(
        'button',
        {
          onclick: async () => {
            try {
              if (area.value !== saved) {
                await save(area.value);
                saved = area.value;
              }
              const leave = await b.action(area.value);
              if (leave) {
                removeBack();
                el.remove();
                resolve();
              }
            } catch (e) {
              showError(e);
            }
          },
        },
        b.label,
      ),
    );
    let removeBack = () => {};
    const close = async () => {
      removeBack();
      if (area.value !== saved && !(await confirmAction('Discard unsaved changes?', 'discard', true))) {
        removeBack = pushBack(close);
        return;
      }
      el.remove();
      resolve();
    };
    removeBack = pushBack(close);
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
      h('div', { class: 'path' }, path),
      h('div', { class: 'row' }, saveBtn, extras, h('span', { class: 'grow' }), h('button', { onclick: close }, 'close')),
      area,
    );
    document.body.append(el);
  });
}

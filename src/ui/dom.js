// Tiny helpers so the screens stay readable without a framework.

/** h('button', { class: 'x', onclick }, 'text', child) */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

let toastTimer;
export function toast(message, { error = false, ms = 3500 } = {}) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = error ? 'toast error' : 'toast';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function showError(e) {
  console.error(e);
  toast(e?.message || String(e), { error: true, ms: 5000 });
}

/** Bottom sheet. buttons: [{ label, class, action }] — resolves when closed. */
export function sheet(title, buttons, extra) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const close = (v) => {
      overlay.remove();
      resolve(v);
    };
    const overlay = h(
      'div',
      { class: 'overlay', onclick: (e) => e.target === overlay && close(null) },
      h(
        'div',
        { class: 'sheet' },
        title && h('div', { class: 'title' }, title),
        extra,
        buttons.map((b) => h('button', { class: b.class, onclick: () => close(b.value ?? b.label) }, b.label)),
        h('button', { onclick: () => close(null) }, 'cancel'),
      ),
    );
    root.append(overlay);
  });
}

export async function ask(title, initial = '', okLabel = 'ok') {
  const input = h('input', { value: initial, autocapitalize: 'off', autocomplete: 'off', spellcheck: false });
  setTimeout(() => input.focus(), 50);
  const r = await sheet(title, [{ label: okLabel, class: 'primary', value: 'ok' }], input);
  return r === 'ok' ? input.value.trim() : null;
}

export async function confirmAction(title, okLabel = 'yes', danger = false) {
  return (await sheet(title, [{ label: okLabel, class: danger ? 'danger' : 'primary', value: 'ok' }])) === 'ok';
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

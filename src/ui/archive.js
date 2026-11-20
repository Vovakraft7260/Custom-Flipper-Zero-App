// "Saved" view: a category's files as friendly cards (like the official app's archive).
// Tapping a card opens it. Rename and delete live inside the item, behind a confirm,
// so nothing gets deleted by a stray tap.
import { h, showError, toast, sheet, ask, confirmAction, formatBytes } from './dom.js';
import { conn } from '../connection.js';
import { RpcError } from '../flipper/rpc.js';
import { openSignal } from './signals.js';
import { saveToPhone, SAVE_FOLDER } from './save.js';

export const CATEGORIES = {
  subghz: { title: 'sub-ghz', icon: '≋', dir: '/ext/subghz', exts: ['.sub'] },
  nfc: { title: 'nfc', icon: '◉', dir: '/ext/nfc', exts: ['.nfc'] },
  rfid: { title: 'rfid 125k', icon: '▭', dir: '/ext/lfrfid', exts: ['.rfid'] },
  ir: { title: 'infrared', icon: '⟿', dir: '/ext/infrared', exts: ['.ir'] },
  ibutton: { title: 'ibutton', icon: '◎', dir: '/ext/ibutton', exts: ['.ibtn'] },
};
const MAX_DEPTH = 3; // also look inside sub-folders
const FAV_KEY = 'oilrig.favorites';

export function loadFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
function saveFavorites(set) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...set]));
  } catch {
    /* storage blocked */
  }
}

const cache = new Map(); // dir -> items, cleared on refresh
let search = '';

export function resetArchive() {
  cache.clear();
  search = '';
}

/** Finds every matching file under dir (and its sub-folders). */
export async function scanItems(dir, exts) {
  const out = [];
  const walk = async (path, depth) => {
    let entries;
    try {
      entries = await conn.flipper.list(path);
    } catch (e) {
      if (e instanceof RpcError && e.statusName === 'ERROR_STORAGE_NOT_EXIST') return;
      throw e;
    }
    for (const e of entries) {
      const full = `${path}/${e.name}`;
      if (e.isDir) {
        if (depth < MAX_DEPTH && !e.name.startsWith('.') && e.name !== 'assets') await walk(full, depth + 1);
      } else if (exts.some((x) => e.name.toLowerCase().endsWith(x))) {
        out.push({ path: full, name: e.name.replace(/\.[^.]+$/, ''), folder: path.slice(dir.length + 1), size: e.size });
      }
    }
  };
  await walk(dir, 0);
  return out;
}

/**
 * Card grid for one category.
 * opts.onOpen(item) overrides what tapping a card does (used by script tools).
 * opts.extraTop: element shown above the cards (e.g. a "new script" button).
 */
export function archiveView(catId, opts = {}) {
  const cat = opts.cat ?? CATEGORIES[catId];
  const root = h('div');
  const favs = loadFavorites();
  let busy = false;

  const load = async (force = false) => {
    if (force) cache.delete(cat.dir);
    if (!cache.has(cat.dir)) {
      busy = true;
      draw();
      try {
        cache.set(cat.dir, await scanItems(cat.dir, cat.exts));
      } catch (e) {
        showError(e);
        cache.set(cat.dir, []);
      }
      busy = false;
    }
    draw();
  };

  const open = async (item) => {
    if (opts.onOpen) await opts.onOpen(item);
    else await openSignal(item.path, { actions: itemActions(item, () => load(true)) });
    load(true);
  };

  const draw = () => {
    const items = (cache.get(cat.dir) ?? [])
      .filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => Number(favs.has(b.path)) - Number(favs.has(a.path)) || a.name.localeCompare(b.name));
    const input = h('input', { placeholder: `search ${cat.title}…`, value: search, autocapitalize: 'off', autocomplete: 'off' });
    input.oninput = () => {
      search = input.value;
      const pos = input.selectionStart;
      draw();
      const again = root.querySelector('input');
      again.focus();
      again.setSelectionRange(pos, pos);
    };
    const parts = [
      h('div', { class: 'row', style: 'margin-bottom:10px' }, input, h('button', { onclick: () => load(true) }, '⟳')),
      opts.extraTop ?? null,
      busy && h('p', { class: 'muted' }, 'looking for saved items…'),
      !busy && items.length === 0 && h('p', { class: 'muted' }, search ? 'nothing matches' : `nothing saved yet in ${cat.dir}`),
      h(
        'div',
        { class: 'cards' },
        items.map((item) =>
          h(
            'div',
            { class: 'card-item', role: 'button', tabindex: 0, onclick: () => open(item) },
            h('span', { class: 'card-icon' }, cat.icon),
            h('span', { class: 'card-name' }, item.name),
            h('span', { class: 'card-sub muted' }, item.folder || formatBytes(item.size)),
            h(
              'button',
              {
                class: `star${favs.has(item.path) ? ' on' : ''}`,
                'aria-label': 'favorite',
                onclick: (ev) => {
                  ev.stopPropagation();
                  favs.has(item.path) ? favs.delete(item.path) : favs.add(item.path);
                  saveFavorites(favs);
                  draw();
                },
              },
              favs.has(item.path) ? '★' : '☆',
            ),
          ),
        ),
      ),
    ];
    root.replaceChildren(...parts.filter(Boolean)); // drop the false/null placeholders
  };

  load();
  return root;
}

/** The "⋯" menu inside an item: save to phone, rename, delete (with confirm). */
export function itemActions(item, onChanged) {
  return async () => {
    const choice = await sheet(item.path, [
      { label: '⇩ save copy to phone', value: 'save' },
      { label: 'rename', value: 'rename' },
      { label: 'delete…', value: 'delete', class: 'danger' },
    ]);
    const f = conn.flipper;
    try {
      if (choice === 'save') {
        await saveToPhone(item.path.split('/').pop(), await f.read(item.path));
        toast(`saved to Documents/${SAVE_FOLDER}`);
      } else if (choice === 'rename') {
        const ext = item.path.slice(item.path.lastIndexOf('.'));
        const next = await ask(`rename ${item.name}`, item.name, 'rename');
        if (!next || next === item.name) return false;
        if (next.includes('/')) throw new Error('Names cannot contain "/"');
        const newPath = `${item.path.slice(0, item.path.lastIndexOf('/'))}/${next}${ext}`;
        await f.rename(item.path, newPath);
        moveFavorite(item.path, newPath);
        toast('renamed');
        onChanged?.();
        return 'closed';
      } else if (choice === 'delete') {
        if (!(await confirmAction(`Delete "${item.name}" from the Flipper? This can't be undone.`, 'yes, delete it', true))) return false;
        await f.remove(item.path);
        moveFavorite(item.path, null);
        toast('deleted');
        onChanged?.();
        return 'closed';
      }
    } catch (e) {
      showError(e);
    }
    return false;
  };
}

function moveFavorite(from, to) {
  const favs = loadFavorites();
  if (!favs.has(from)) return;
  favs.delete(from);
  if (to) favs.add(to);
  saveFavorites(favs);
}

// Signal library: browse community collections and send files to the Flipper.
import { h, saveScroll, restoreScroll, toast, showError, sheet, confirmAction } from './dom.js';
import { conn } from '../connection.js';
import { RpcError } from '../flipper/rpc.js';
import { parseInfrared, parseSubGhz, keyFileSummary } from '../flipper/flipperformat.js';
import { LIB_CATS, categoryCounts, listFolder, searchEntries, flipperDest } from '../library/catalog.js';
import { getLibrary, getFileText } from '../library/store.js';
import { openSignal } from './signals.js';
import { resetArchive } from './archive.js';

const MAX_CARDS = 300;
let stack = []; // screens: { type: 'cat', cat } | { type: 'folder', cat, src, folder }
let search = '';
let rerender = () => {};

export function openLibrary() {
  stack = [];
  search = '';
}

/** Phone back button: one level up. Returns false at the top. */
export function libraryBack() {
  if (!stack.length) return false;
  stack.pop();
  search = '';
  rerender();
  restoreScroll(scrollMemo[stack.length] ?? 0);
  return true;
}

export function libraryView(rerenderTab) {
  rerender = rerenderTab;
  const root = h('div', {}, h('p', { class: 'muted' }, 'loading library…'));
  getLibrary()
    .then(({ lib, offline, savedAt }) => root.replaceChildren(screen(lib, offline, savedAt)))
    .catch((e) => root.replaceChildren(h('p', { class: 'tip' }, e.message), h('button', { onclick: rerender }, 'try again')));
  return root;
}

const scrollMemo = []; // list position of each screen, to return to it on back

function go(next) {
  scrollMemo[stack.length] = saveScroll();
  stack.push(next);
  search = '';
  rerender();
  restoreScroll(0);
}

function card(icon, name, sub, onclick) {
  return h(
    'div',
    { class: 'card-item', role: 'button', tabindex: 0, onclick },
    h('span', { class: 'card-icon' }, icon),
    h('span', { class: 'card-name' }, name),
    sub && h('span', { class: 'card-sub muted' }, sub),
  );
}

function cards(list) {
  const shown = list.slice(0, MAX_CARDS);
  return [
    h('div', { class: 'cards' }, shown),
    list.length > MAX_CARDS && h('p', { class: 'muted' }, `showing ${MAX_CARDS} of ${list.length}. Search to narrow it down.`),
  ];
}

function screen(lib, offline, savedAt) {
  const top = stack[stack.length - 1];
  const note =
    offline &&
    h('p', { class: 'muted' }, `offline: using the list saved ${savedAt ? new Date(savedAt).toLocaleDateString() : 'earlier'}. Files you opened before still work.`);

  if (!top) {
    const counts = categoryCounts(lib);
    return h(
      'div',
      {},
      note,
      h('p', { class: 'muted' }, 'Community collections. Pick a type, find a file, send it to your Flipper.'),
      h(
        'div',
        { class: 'cards' },
        Object.entries(LIB_CATS)
          .filter(([id]) => counts[id])
          .map(([id, c]) => card(c.icon, c.title, `${counts[id].toLocaleString()} files`, () => go({ type: 'cat', cat: id }))),
      ),
      h('div', { class: 'row', style: 'margin-top:14px' },
        h('span', { class: 'muted' }, `list from ${new Date(lib.generated).toLocaleDateString()}`),
        h('button', { onclick: () => getLibrary({ refresh: true }).then(() => { toast('library list updated'); rerender(); }).catch(showError) }, '⟳ refresh'),
      ),
    );
  }

  const cat = LIB_CATS[top.cat];
  const header = h('div', { class: 'muted', style: 'margin-bottom:8px' },
    top.type === 'cat' ? cat.title : `${cat.title} › ${top.src.name}${top.folder ? ` › ${top.folder.replace(/\//g, ' › ')}` : ''}`);
  const results = h('div');
  const input = h('input', { placeholder: `search all ${cat.title}…`, value: search, autocapitalize: 'off', autocomplete: 'off' });
  const browse = browseList(lib, top);
  const drawResults = () => {
    search = input.value;
    if (!search.trim()) return results.replaceChildren(...browse);
    const found = searchEntries(lib, top.cat, search, MAX_CARDS + 1);
    results.replaceChildren(
      ...(found.length ? cards(found.map(fileCard)) : [h('p', { class: 'muted' }, 'nothing matches')]).filter(Boolean),
    );
  };
  let timer;
  input.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(drawResults, 200);
  };
  drawResults();
  return h('div', {}, note, h('div', { class: 'row', style: 'margin-bottom:10px' }, input), header, results);
}

function browseList(lib, top) {
  if (top.type === 'cat') {
    const sources = lib.sources.filter((s) => s.counts[top.cat]);
    return cards(sources.map((s) => card('▤', s.name, `${s.counts[top.cat].toLocaleString()} files`, () => go({ type: 'folder', cat: top.cat, src: s, folder: '' })))).filter(Boolean);
  }
  const { dirs, files } = listFolder(top.src, top.cat, top.folder);
  return cards([
    ...dirs.map((d) => card('📁', d.name.replace(/_/g, ' '), `${d.count} files`, () => go({ ...top, folder: top.folder ? `${top.folder}/${d.name}` : d.name }))),
    ...files.map(fileCard),
  ]).filter(Boolean);
}

function fileCard(e) {
  return card(LIB_CATS[e.cat].icon, e.title.replace(/_/g, ' '), `${e.src.name}${e.folder ? ` · ${e.folder.split('/').pop()}` : ''}`, () => previewFile(e));
}

function summary(e, text) {
  try {
    if (e.cat === 'ir') {
      const buttons = parseInfrared(text);
      return `${buttons.length} buttons: ${buttons.map((b) => b.name).slice(0, 30).join(', ')}${buttons.length > 30 ? '…' : ''}`;
    }
    if (e.cat === 'subghz') {
      const s = parseSubGhz(text);
      return [s.frequencyText, s.protocol, s.preset].join(' · ');
    }
    if (['nfc', 'rfid', 'ibutton'].includes(e.cat)) return keyFileSummary(e.cat, text).map(([k, v]) => `${k}: ${v}`).join('\n');
  } catch {
    /* fall back to the raw text below */
  }
  return '';
}

async function previewFile(e) {
  let text;
  try {
    toast('downloading…', { ms: 1200 });
    text = await getFileText(e);
  } catch (err) {
    return showError(new Error(`Couldn't download it (offline?). ${err.message}`));
  }
  const dest = flipperDest(e);
  const info = summary(e, text);
  const extra = h(
    'div',
    {},
    h('p', { class: 'muted', style: 'margin:0 0 6px' }, `${e.src.name} (${e.src.license}) · ${e.folder || 'top folder'}`),
    info && h('p', { style: 'white-space:pre-wrap;margin:0 0 6px' }, info),
    h('pre', { class: 'lib-preview' }, text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text),
    h('p', { class: 'muted', style: 'margin:6px 0' }, `goes to ${dest}`),
  );
  const choice = await sheet(e.name, [{ label: '⇪ send to flipper', class: 'primary', value: 'send' }], extra);
  if (choice === 'send') await sendToFlipper(e, text, dest);
}

async function ensureDir(path) {
  try {
    await conn.flipper.mkdir(path);
  } catch (err) {
    if (!(err instanceof RpcError && err.statusName === 'ERROR_STORAGE_EXIST')) throw err;
  }
}

async function sendToFlipper(e, text, dest) {
  if (conn.state !== 'online') return showError(new Error('Connect your Flipper first (device tab).'));
  const f = conn.flipper;
  const dir = dest.slice(0, dest.lastIndexOf('/'));
  const name = dest.slice(dir.length + 1);
  try {
    await ensureDir(dir.slice(0, dir.lastIndexOf('/')));
    await ensureDir(dir);
    const existing = await f.list(dir);
    if (existing.some((x) => x.name === name) && !(await confirmAction(`${name} is already on the Flipper. Replace it?`, 'replace'))) return;
    await f.write(dest, new TextEncoder().encode(text));
    resetArchive();
  } catch (err) {
    return showError(err);
  }
  if (e.cat === 'badusb') return toast(`Sent! Find it under Tools › bad usb (${dir}).`, { ms: 5000 });
  const open = await sheet(`Sent to ${dir}`, [{ label: '▶ open it now', class: 'primary', value: 'open' }]);
  if (open === 'open') await openSignal(dest);
}

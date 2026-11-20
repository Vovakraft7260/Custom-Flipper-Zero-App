// File manager tool: browse the Flipper's storage, upload, download, rename, delete, edit.
// Also used by the signal-folder tools (Sub-GHz, NFC, ...), each starting in its own folder.
import { h, toast, showError, sheet, ask, confirmAction, formatBytes } from './dom.js';
import { conn } from '../connection.js';
import { joinPath, parentPath } from '../flipper/api.js';
import { isTextFile, openEditor, MAX_EDIT_SIZE } from './editor.js';
import { saveToPhone, SAVE_FOLDER } from './save.js';
import { openSignal, signalKind } from './signals.js';

// Which Flipper app opens which file type ("open on flipper").
const OPEN_WITH = {
  sub: 'Sub-GHz',
  nfc: 'NFC',
  rfid: '125 kHz RFID',
  ir: 'Infrared',
  ibtn: 'iButton',
};

let state = newState('/ext');
let currentDraw = null;

function newState(home) {
  return { home, path: home, history: [], entries: null, selecting: false, selected: new Set(), busy: '' };
}

/** Opens the browser in `home` (a fresh start each time a tool is opened). */
export function openFiles(home) {
  state = newState(home);
}

export function filesView() {
  const root = h('div');
  const draw = () => root.replaceChildren(render(draw));
  currentDraw = draw;
  if (state.entries === null) load(draw);
  draw();
  return root;
}

/** Phone back button: leave select mode, then go back through visited folders. */
export function filesBack() {
  if (state.selecting) {
    state.selecting = false;
    state.selected.clear();
    currentDraw?.();
    return true;
  }
  const prev = state.history.pop();
  if (prev === undefined) return false;
  load(currentDraw, prev, false);
  return true;
}

async function load(draw, path = state.path, remember = true) {
  state.busy = 'loading…';
  draw();
  try {
    state.entries = await conn.flipper.list(path);
    if (remember && path !== state.path) state.history.push(state.path);
    state.path = path;
    state.selected.clear();
  } catch (e) {
    showError(e);
    state.entries ??= [];
  }
  state.busy = '';
  draw();
}

function render(draw) {
  const f = conn.flipper;
  const go = (p) => load(draw, p);
  const entries = state.entries ?? [];

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    h('button', { disabled: state.path === '/', onclick: () => go(parentPath(state.path)) }, '↑ up'),
    h('button', { onclick: () => go(state.path) }, '⟳'),
    h('button', { disabled: state.path === '/', onclick: () => newFolder(draw) }, '+ folder'),
    h('button', { disabled: state.path === '/', onclick: () => upload(draw) }, '⇪ upload'),
    h(
      'button',
      {
        class: state.selecting ? 'primary' : '',
        onclick: () => {
          state.selecting = !state.selecting;
          state.selected.clear();
          draw();
        },
      },
      state.selecting ? 'done' : '☐ select',
    ),
  );

  const selectionBar =
    state.selecting &&
    h(
      'div',
      { class: 'toolbar' },
      h('span', { class: 'muted grow', style: 'align-self:center' }, `${state.selected.size} selected`),
      h('button', { disabled: !state.selected.size, onclick: () => downloadMany(draw, [...state.selected]) }, '⇩ save to phone'),
      h('button', { class: 'danger', disabled: !state.selected.size, onclick: () => deleteMany(draw, [...state.selected]) }, '✕ delete'),
    );

  const rows = entries.map((e) => {
    const full = joinPath(state.path, e.name);
    const check =
      state.selecting &&
      h('input', {
        type: 'checkbox',
        checked: state.selected.has(e.name),
        onclick: (ev) => ev.stopPropagation(),
        onchange: (ev) => {
          ev.target.checked ? state.selected.add(e.name) : state.selected.delete(e.name);
          draw();
        },
      });
    return h(
      'div',
      {
        class: `file ${e.isDir ? 'dir' : ''}`,
        onclick: () => {
          if (state.selecting) {
            state.selected.has(e.name) ? state.selected.delete(e.name) : state.selected.add(e.name);
            draw();
          } else if (e.isDir) go(full);
          else if (signalKind(e.name)) openSignal(full).then(() => load(draw));
          else fileActions(draw, e, full);
        },
      },
      check,
      h('span', { class: 'icon' }, e.isDir ? '▸' : '·'),
      h('span', { class: 'name' }, e.name),
      !e.isDir && h('span', { class: 'size' }, formatBytes(e.size)),
      !state.selecting &&
        h(
          'button',
          { class: 'more', onclick: (ev) => (ev.stopPropagation(), e.isDir ? folderActions(draw, e, full) : fileActions(draw, e, full)) },
          '⋯',
        ),
    );
  });

  return h(
    'div',
    {},
    h('div', { class: 'path' }, state.path),
    toolbar,
    selectionBar,
    state.busy && h('p', { class: 'muted' }, state.busy),
    !state.busy && entries.length === 0 && h('p', { class: 'muted' }, 'empty folder'),
    rows,
  );

  async function fileActions(draw, e, full) {
    const ext = e.name.includes('.') ? e.name.split('.').pop().toLowerCase() : '';
    const inBadUsb = /\/badusb\//i.test(full);
    const buttons = [];
    if (signalKind(e.name)) buttons.push({ label: '◉ view / send', value: 'view' });
    if (isTextFile(e.name) && e.size <= MAX_EDIT_SIZE) buttons.push({ label: '✎ edit', value: 'edit' });
    buttons.push({ label: '⇩ save to phone', value: 'save' });
    if (ext === 'fap') buttons.push({ label: '▶ run on flipper', value: 'run' });
    else if (OPEN_WITH[ext] || (inBadUsb && ext === 'txt')) buttons.push({ label: '▶ open on flipper', value: 'open' });
    buttons.push({ label: 'rename', value: 'rename' }, { label: 'delete', value: 'delete', class: 'danger' });

    const choice = await sheet(`${full} · ${formatBytes(e.size)}`, buttons);
    try {
      if (choice === 'view') {
        await openSignal(full);
        load(draw);
      } else if (choice === 'edit') {
        state.busy = 'downloading…';
        draw();
        const bytes = await f.read(full);
        state.busy = '';
        draw();
        await openEditor(full, new TextDecoder().decode(bytes), (text) => f.write(full, new TextEncoder().encode(text)));
        load(draw);
      } else if (choice === 'save') {
        await downloadMany(draw, [e.name]);
      } else if (choice === 'run') {
        await f.startApp(full);
        toast('started on flipper');
      } else if (choice === 'open') {
        await f.startApp(inBadUsb && ext === 'txt' ? 'Bad USB' : OPEN_WITH[ext], full);
        toast('opened on flipper');
      } else if (choice === 'rename') {
        await renameEntry(draw, e.name);
      } else if (choice === 'delete') {
        await deleteMany(draw, [e.name]);
      }
    } catch (err) {
      state.busy = '';
      draw();
      showError(err);
    }
  }
}

async function folderActions(draw, e) {
  const choice = await sheet(joinPath(state.path, e.name), [
    { label: 'rename', value: 'rename' },
    { label: 'delete folder', value: 'delete', class: 'danger' },
  ]);
  try {
    if (choice === 'rename') await renameEntry(draw, e.name);
    if (choice === 'delete') await deleteMany(draw, [e.name]);
  } catch (err) {
    showError(err);
  }
}

async function renameEntry(draw, name) {
  const next = await ask(`rename ${name}`, name, 'rename');
  if (!next || next === name) return;
  if (next.includes('/')) throw new Error('Names cannot contain "/"');
  await conn.flipper.rename(joinPath(state.path, name), joinPath(state.path, next));
  toast('renamed');
  await load(draw);
}

async function newFolder(draw) {
  const name = await ask('new folder name', '', 'create');
  if (!name) return;
  if (name.includes('/')) return showError(new Error('Names cannot contain "/"'));
  try {
    await conn.flipper.mkdir(joinPath(state.path, name));
    await load(draw);
  } catch (e) {
    showError(e);
  }
}

async function deleteMany(draw, names) {
  const entries = state.entries.filter((e) => names.includes(e.name));
  const hasDir = entries.some((e) => e.isDir);
  const label = names.length === 1 ? names[0] : `${names.length} items`;
  if (!(await confirmAction(`Delete ${label}${hasDir ? ' (folders with everything inside)' : ''}? This can't be undone.`, 'delete', true))) return;
  try {
    for (const e of entries) {
      state.busy = `deleting ${e.name}…`;
      draw();
      await conn.flipper.remove(joinPath(state.path, e.name), e.isDir);
    }
    toast('deleted');
  } catch (e) {
    showError(e);
  }
  state.selecting = false;
  await load(draw);
}

async function downloadMany(draw, names) {
  const files = state.entries.filter((e) => names.includes(e.name) && !e.isDir);
  if (files.length < names.length) toast('folders are skipped for now');
  try {
    for (const e of files) {
      const full = joinPath(state.path, e.name);
      const bytes = await conn.flipper.read(full, (n) => {
        state.busy = `downloading ${e.name} ${e.size ? Math.round((n / e.size) * 100) : 100}%`;
        draw();
      });
      await saveToPhone(e.name, bytes);
    }
    if (files.length) toast(`saved to Documents/${SAVE_FOLDER}`);
  } catch (e) {
    showError(e);
  }
  state.busy = '';
  draw();
}

function upload(draw) {
  const input = h('input', { type: 'file', multiple: true, style: 'display:none' });
  input.onchange = async () => {
    let files = [...input.files];
    input.remove();
    const existing = files.filter((file) => state.entries?.some((e) => e.name === file.name));
    if (existing.length && !(await confirmAction(`Replace ${existing.map((x) => x.name).join(', ')} on the Flipper?`, 'replace', true))) {
      files = files.filter((file) => !existing.includes(file));
    }
    try {
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await conn.flipper.write(joinPath(state.path, file.name), bytes, (n) => {
          state.busy = `uploading ${file.name} ${bytes.length ? Math.round((n / bytes.length) * 100) : 100}%`;
          draw();
        });
      }
      if (files.length) toast(`uploaded ${files.length} file${files.length > 1 ? 's' : ''}`);
    } catch (e) {
      showError(e);
    }
    state.busy = '';
    await load(draw);
  };
  document.body.append(input);
  input.click();
}

/** Forget the listing when the connection changes. */
export function resetFiles() {
  state = newState(state.home);
}

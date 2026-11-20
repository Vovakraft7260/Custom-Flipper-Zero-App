// Tools tab: a grid of tools. Each one opens full-screen inside the tab.
import { h, toast, showError, ask, sheet, confirmAction, formatBytes } from './dom.js';
import { conn } from '../connection.js';
import { joinPath } from '../flipper/api.js';
import { RpcError } from '../flipper/rpc.js';
import { openEditor } from './editor.js';
import { filesView, filesBack, openFiles } from './files.js';
import { tvRemoteView, tvRemoteBack, openTvRemote, closeTvRemote } from './tvremote.js';

const BAD_USB_TEMPLATE = `REM New Bad USB script
REM Docs: https://docs.flipper.net/zero/bad-usb
DELAY 1000
GUI r
DELAY 500
STRING notepad
ENTER
DELAY 1000
STRING Hello from 0ilrig Trmnl
`;

const JS_TEMPLATE = `// New Flipper JS script
let notify = require("notification");
notify.success();
print("Hello from 0ilrig Trmnl");
`;

// Tools that are their own screen
const SCRIPT_TOOLS = {
  badusb: {
    title: 'Bad USB scripts',
    dir: '/ext/badusb',
    ext: '.txt',
    template: BAD_USB_TEMPLATE,
    app: 'Bad USB', // "Bad KB" on Momentum, handled by startApp
    runHint: 'Script loaded on the Flipper. Plug it into the computer and press OK to run.',
  },
  js: {
    title: 'JS scripts',
    dir: '/ext/apps/Scripts',
    ext: '.js',
    template: JS_TEMPLATE,
    app: 'JS Runner',
    runHint: 'Script started on the Flipper.',
  },
};

// Tiles shown on the grid. kind "files" opens the file manager in that folder.
const TOOLS = [
  { id: 'files', icon: '/', label: 'file manager', kind: 'files', home: '/ext' },
  { id: 'tvremote', icon: '📺', label: 'tv remote', kind: 'tvremote' },
  { id: 'badusb', icon: '⌨', label: 'bad usb', kind: 'script' },
  { id: 'js', icon: '{ }', label: 'js scripts', kind: 'script' },
  { id: 'subghz', icon: '≋', label: 'sub-ghz', kind: 'files', home: '/ext/subghz' },
  { id: 'nfc', icon: '◉', label: 'nfc', kind: 'files', home: '/ext/nfc' },
  { id: 'rfid', icon: '▭', label: 'rfid 125k', kind: 'files', home: '/ext/lfrfid' },
  { id: 'ir', icon: '⟿', label: 'infrared', kind: 'files', home: '/ext/infrared' },
  { id: 'ibutton', icon: '◎', label: 'ibutton', kind: 'files', home: '/ext/ibutton' },
  { id: 'apps', icon: '▦', label: 'apps (.fap)', kind: 'files', home: '/ext/apps' },
];

let openTool = null; // null = grid
let scriptState = { entries: null, busy: '' };
let rerenderTab = () => {};

/** Called after "run" so the main screen can jump to the remote tab. */
export let onRunScript = () => {};
export function setOnRunScript(fn) {
  onRunScript = fn;
}

export function toolsView(rerender) {
  rerenderTab = rerender;
  if (conn.state !== 'online') {
    return h('div', {}, h('h2', {}, 'tools'), h('p', { class: 'muted' }, 'Connect your Flipper on the device tab first.'));
  }
  if (!openTool) return grid();
  const tool = TOOLS.find((t) => t.id === openTool);
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'row', style: 'margin-bottom:8px' },
      h('button', { onclick: closeTool }, '← tools'),
      h('span', { class: 'muted' }, tool.label),
    ),
    tool.kind === 'files' ? filesView() : tool.kind === 'tvremote' ? tvRemoteView(rerenderTab) : scriptView(SCRIPT_TOOLS[tool.id]),
  );
}

/** Phone back button inside the tools tab. */
export function toolsBack() {
  if (!openTool) return false;
  const tool = TOOLS.find((t) => t.id === openTool);
  if (tool.kind === 'files' && filesBack()) return true;
  if (tool.kind === 'tvremote' && tvRemoteBack()) return true;
  closeTool();
  return true;
}

export function resetTools() {
  openTool = null;
  scriptState = { entries: null, busy: '' };
}

function closeTool() {
  if (openTool === 'tvremote') closeTvRemote();
  openTool = null;
  rerenderTab();
}

function grid() {
  return h(
    'div',
    {},
    h('h2', {}, 'tools'),
    h(
      'div',
      { class: 'tool-grid' },
      TOOLS.map((t) =>
        h(
          'button',
          {
            class: 'tool',
            onclick: () => {
              openTool = t.id;
              if (t.kind === 'files') openFiles(t.home);
              else if (t.kind === 'tvremote') openTvRemote();
              else scriptState = { entries: null, busy: '' };
              rerenderTab();
            },
          },
          h('span', { class: 'tool-icon' }, t.icon),
          h('span', { class: 'tool-label' }, t.label),
        ),
      ),
    ),
  );
}

// ---------- script tools (Bad USB, JS) ----------

function scriptView(cfg) {
  const root = h('div');
  const draw = () => root.replaceChildren(renderScripts(cfg, draw));
  if (scriptState.entries === null) loadScripts(cfg, draw);
  draw();
  return root;
}

async function loadScripts(cfg, draw) {
  scriptState.busy = 'loading…';
  draw();
  try {
    const all = await conn.flipper.list(cfg.dir);
    scriptState.entries = all.filter((e) => !e.isDir && e.name.toLowerCase().endsWith(cfg.ext));
  } catch (e) {
    // Folder missing on this Flipper: it gets created with the first script.
    if (!(e instanceof RpcError && e.statusName === 'ERROR_STORAGE_NOT_EXIST')) showError(e);
    scriptState.entries = [];
  }
  scriptState.busy = '';
  draw();
}

function renderScripts(cfg, draw) {
  const entries = scriptState.entries ?? [];
  return h(
    'div',
    {},
    h('div', { class: 'path' }, cfg.dir),
    h(
      'div',
      { class: 'toolbar' },
      h('button', { class: 'primary', onclick: () => newScript(cfg, draw) }, '+ new script'),
      h('button', { onclick: () => loadScripts(cfg, draw) }, '⟳'),
    ),
    scriptState.busy && h('p', { class: 'muted' }, scriptState.busy),
    !scriptState.busy && entries.length === 0 && h('p', { class: 'muted' }, 'no scripts yet'),
    entries.map((e) =>
      h(
        'div',
        { class: 'file', onclick: () => scriptActions(cfg, draw, e) },
        h('span', { class: 'icon' }, '·'),
        h('span', { class: 'name' }, e.name),
        h('span', { class: 'size' }, formatBytes(e.size)),
      ),
    ),
  );
}

async function newScript(cfg, draw) {
  let name = await ask('script name', '', 'create');
  if (!name) return;
  if (name.includes('/')) return showError(new Error('Names cannot contain "/"'));
  if (!name.toLowerCase().endsWith(cfg.ext)) name += cfg.ext;
  if ((scriptState.entries ?? []).some((e) => e.name === name)) return showError(new Error('A script with that name already exists.'));
  try {
    await ensureDir(cfg.dir);
    const path = joinPath(cfg.dir, name);
    await conn.flipper.write(path, new TextEncoder().encode(cfg.template));
    await editScript(cfg, path, cfg.template);
  } catch (e) {
    showError(e);
  }
  loadScripts(cfg, draw);
}

async function scriptActions(cfg, draw, e) {
  const path = joinPath(cfg.dir, e.name);
  const choice = await sheet(path, [
    { label: '✎ edit', value: 'edit' },
    { label: '▶ run on flipper', value: 'run' },
    { label: 'rename', value: 'rename' },
    { label: 'delete', value: 'delete', class: 'danger' },
  ]);
  try {
    if (choice === 'edit') {
      const text = new TextDecoder().decode(await conn.flipper.read(path));
      await editScript(cfg, path, text);
    } else if (choice === 'run') {
      await run(cfg, path);
    } else if (choice === 'rename') {
      let next = await ask(`rename ${e.name}`, e.name, 'rename');
      if (!next || next === e.name) return;
      if (!next.toLowerCase().endsWith(cfg.ext)) next += cfg.ext;
      await conn.flipper.rename(path, joinPath(cfg.dir, next));
    } else if (choice === 'delete') {
      if (!(await confirmAction(`Delete ${e.name}? This can't be undone.`, 'delete', true))) return;
      await conn.flipper.remove(path);
    }
  } catch (err) {
    showError(err);
  }
  loadScripts(cfg, draw);
}

function editScript(cfg, path, text) {
  return openEditor(path, text, (t) => conn.flipper.write(path, new TextEncoder().encode(t)), [
    {
      label: '▶ run',
      action: async () => {
        await run(cfg, path);
        return true; // close the editor and show the Flipper screen
      },
    },
  ]);
}

async function run(cfg, path) {
  await conn.flipper.startApp(cfg.app, path);
  toast(cfg.runHint, { ms: 5000 });
  onRunScript();
}

async function ensureDir(dir) {
  try {
    await conn.flipper.mkdir(dir);
  } catch (e) {
    if (!(e instanceof RpcError && e.statusName === 'ERROR_STORAGE_EXIST')) throw e;
  }
}

// Tools tab: a grid of tools. Each one opens full-screen inside the tab.
import { h, toast, showError, ask } from './dom.js';
import { conn } from '../connection.js';
import { joinPath } from '../flipper/api.js';
import { RpcError } from '../flipper/rpc.js';
import { openEditor } from './editor.js';
import { filesView, filesBack, openFiles } from './files.js';
import { archiveView, itemActions, resetArchive } from './archive.js';
import { storeView, storeBack, openStore, resetStore } from './store.js';
import { libraryView, libraryBack, openLibrary } from './library.js';
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
    title: 'bad usb scripts',
    icon: '⌨',
    dir: '/ext/badusb',
    ext: '.txt',
    template: BAD_USB_TEMPLATE,
    app: 'Bad USB', // "Bad KB" on Momentum, handled by startApp
    runHint: 'Script loaded on the Flipper. Plug it into the computer and press OK to run.',
  },
  js: {
    title: 'js scripts',
    icon: '{ }',
    dir: '/ext/apps/Scripts',
    ext: '.js',
    template: JS_TEMPLATE,
    app: 'JS Runner',
    runHint: 'Script started on the Flipper.',
  },
};

// Tiles shown on the grid. kind "files" opens the file manager in that folder.
const TOOLS = [
  { id: 'subghz', icon: '≋', label: 'sub-ghz', kind: 'archive', group: 'saved' },
  { id: 'nfc', icon: '◉', label: 'nfc', kind: 'archive', group: 'saved' },
  { id: 'rfid', icon: '▭', label: 'rfid 125k', kind: 'archive', group: 'saved' },
  { id: 'ir', icon: '⟿', label: 'infrared', kind: 'archive', group: 'saved' },
  { id: 'ibutton', icon: '◎', label: 'ibutton', kind: 'archive', group: 'saved' },
  { id: 'badusb', icon: '⌨', label: 'bad usb', kind: 'script', group: 'saved' },
  { id: 'store', icon: '⬇', label: 'app store', kind: 'store', group: 'tools' },
  { id: 'library', icon: '🌐', label: 'signal library', kind: 'library', group: 'tools' },
  { id: 'tvremote', icon: '📺', label: 'tv remote', kind: 'tvremote', group: 'tools' },
  { id: 'js', icon: '{ }', label: 'js scripts', kind: 'script', group: 'tools' },
  { id: 'apps', icon: '▦', label: 'apps folder (advanced)', kind: 'files', home: '/ext/apps', group: 'tools' },
  { id: 'files', icon: '/', label: 'all files (advanced)', kind: 'files', home: '/ext', group: 'tools' },
];

let openTool = null; // null = grid
let rerenderTab = () => {};

/** Called after "run" so the main screen can jump to the remote tab. */
export let onRunScript = () => {};
export function setOnRunScript(fn) {
  onRunScript = fn;
}

export function toolsView(rerender) {
  rerenderTab = rerender;
  // The library works without a Flipper (browse now, send later).
  if (conn.state !== 'online' && openTool !== 'library') {
    openTool = null;
    return h(
      'div',
      {},
      h('h2', {}, 'tools'),
      h('p', { class: 'muted' }, 'Connect your Flipper on the device tab for everything else.'),
      tileGrid(TOOLS.filter((t) => t.id === 'library')),
    );
  }
  if (!openTool) return grid();
  const tool = TOOLS.find((t) => t.id === openTool);
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'row', style: 'margin-bottom:8px' },
      h('button', { onclick: () => toolsBack() }, '← back'),
      h('span', { class: 'muted' }, tool.label),
    ),
    {
      store: () => storeView(rerenderTab),
      library: () => libraryView(rerenderTab),
      files: () => filesView(),
      tvremote: () => tvRemoteView(rerenderTab),
      archive: () => archiveView(tool.id),
      script: () => scriptView(SCRIPT_TOOLS[tool.id]),
    }[tool.kind](),
  );
}

/** Phone back button inside the tools tab. */
export function toolsBack() {
  if (!openTool) return false;
  const tool = TOOLS.find((t) => t.id === openTool);
  if (tool.kind === 'files' && filesBack()) return true;
  if (tool.kind === 'tvremote' && tvRemoteBack()) return true;
  if (tool.kind === 'library' && libraryBack()) return true;
  if (tool.kind === 'store' && storeBack()) return true;
  closeTool();
  return true;
}

export function resetTools() {
  openTool = null;
  resetArchive();
  resetStore();
}

function closeTool() {
  if (openTool === 'tvremote') closeTvRemote();
  openTool = null;
  rerenderTab();
}

function grid() {
  const tiles = (group) => tileGrid(TOOLS.filter((t) => t.group === group));
  return h('div', {}, h('h2', {}, 'saved on flipper'), tiles('saved'), h('h2', {}, 'tools'), tiles('tools'));
}

function tileGrid(list) {
  return h(
    'div',
    { class: 'tool-grid' },
    list.map((t) =>
      h(
        'button',
        {
          class: 'tool',
          onclick: () => {
            openTool = t.id;
            if (t.kind === 'files') openFiles(t.home);
            else if (t.kind === 'tvremote') openTvRemote();
            else if (t.kind === 'library') openLibrary();
            rerenderTab();
          },
        },
        h('span', { class: 'tool-icon' }, t.icon),
        h('span', { class: 'tool-label' }, t.label),
      ),
    ),
  );
}

// ---------- script tools (Bad USB, JS): cards, tap to edit and run ----------

function scriptView(cfg) {
  const cat = { title: cfg.title, icon: cfg.icon, dir: cfg.dir, exts: [cfg.ext] };
  return archiveView(null, {
    cat,
    extraTop: h('button', { class: 'primary', style: 'width:100%;margin-bottom:10px', onclick: () => newScript(cfg) }, '+ new script'),
    onOpen: async (item) => {
      try {
        const text = new TextDecoder().decode(await conn.flipper.read(item.path));
        await editScript(cfg, item.path, text, item);
      } catch (e) {
        showError(e);
      }
    },
  });
}

async function newScript(cfg) {
  let name = await ask('script name', '', 'create');
  if (!name) return;
  if (name.includes('/')) return showError(new Error('Names cannot contain "/"'));
  if (!name.toLowerCase().endsWith(cfg.ext)) name += cfg.ext;
  try {
    await ensureDir(cfg.dir);
    const path = joinPath(cfg.dir, name);
    const existing = await conn.flipper.list(cfg.dir);
    if (existing.some((e) => e.name === name)) return showError(new Error('A script with that name already exists.'));
    await conn.flipper.write(path, new TextEncoder().encode(cfg.template));
    await editScript(cfg, path, cfg.template, { path, name: name.replace(/\.[^.]+$/, '') });
  } catch (e) {
    showError(e);
  }
  resetArchive();
  rerenderTab();
}

function editScript(cfg, path, text, item) {
  return openEditor(path, text, (t) => conn.flipper.write(path, new TextEncoder().encode(t)), [
    {
      label: '▶ run',
      action: async () => {
        await run(cfg, path);
        return true; // close the editor and show the Flipper screen
      },
    },
    {
      label: '⋯',
      action: async () => (await itemActions(item, () => resetArchive())()) === 'closed',
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

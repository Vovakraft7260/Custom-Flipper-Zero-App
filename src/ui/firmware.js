// Firmware installer: pick a firmware and channel, download, copy safely, update.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { h, toast, showError, sheet, formatBytes, moreButton, confirmAction, saveScroll, restoreScroll } from './dom.js';
import { conn } from '../connection.js';
import { http, base64ToBytes } from '../store/http.js';
import { cached } from '../store/cache.js';
import { saveToPhone, SAVE_FOLDER } from './save.js';
import { FIRMWARES, loadChannels, currentFirmware } from '../firmware/sources.js';
import { readPackage, installPackage, sha256Hex } from '../firmware/install.js';
import { connectUsb, usbAvailable } from '../flipper/usb.js';

const FW_DIR = `${SAVE_FOLDER}/firmware`;

let rerender = () => {};
let stack = []; // { type: 'fw', id } | { type: 'work' }
const scrollMemo = [];
let channels = new Map(); // fw id -> { channels, from } | Error
let picked = new Map(); // fw id -> channel id
let current = null; // what the Flipper runs
let job = null;
let usb = null; // { flipper, transport, name } while plugged in

// Firmware goes over USB only (much faster and steadier than Bluetooth).
// The browser demo stands in for a plugged-in Flipper.
const isDemo = () => conn.state === 'online' && /\(demo\)/.test(conn.name);
const target = () => usb?.flipper ?? (isDemo() ? conn.flipper : null);

async function plugIn() {
  try {
    usb = await connectUsb();
    usb.transport.onDisconnect = () => {
      usb = null;
      current = null;
      rerender();
    };
    current = null;
    toast('Flipper connected by USB');
  } catch (e) {
    showError(e);
  }
  rerender();
}

export function openFirmware() {
  stack = [];
}
export function resetFirmware() {
  if (job && !job.finished) return;
  stack = [];
  current = null;
  job = null;
}
export function firmwareBack() {
  if (!stack.length) return false;
  if (job && !job.finished) {
    toast('Still working. Press stop first.');
    return true;
  }
  stack.pop();
  if (stack[stack.length - 1]?.type === 'work') stack.pop();
  job = job?.finished ? null : job;
  rerender();
  restoreScroll(scrollMemo[stack.length] ?? 0);
  return true;
}
function go(next) {
  scrollMemo[stack.length] = saveScroll();
  stack.push(next);
  rerender();
  restoreScroll(0);
}

export function firmwareView(rerenderTab) {
  rerender = rerenderTab;
  const top = stack[stack.length - 1];
  if (top?.type === 'work') return workPage();
  if (top?.type === 'fw') return fwPage(FIRMWARES.find((x) => x.id === top.id));
  return home();
}

// ---------- firmware kept on the phone ----------

async function savedPackages() {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const { files } = await Filesystem.readdir({ path: FW_DIR, directory: Directory.Documents });
    return files.filter((f) => /\.(tgz|tar\.gz|zip)$/i.test(f.name)).sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  } catch {
    return [];
  }
}
async function readSaved(name) {
  const { data } = await Filesystem.readFile({ path: `${FW_DIR}/${name}`, directory: Directory.Documents });
  return typeof data === 'string' ? base64ToBytes(data) : new Uint8Array(await data.arrayBuffer());
}

// ---------- screens ----------

function usbCard() {
  if (target()) {
    return h('p', { class: 'tip' }, usb ? `🔌 Connected by USB (${usb.name}). Keep the cable in until the update is done.` : '🔌 Demo Flipper stands in for USB here.');
  }
  if (!usbAvailable()) return h('p', { class: 'tip' }, 'Firmware installs use a USB-C cable and need the Android app.');
  return h(
    'div',
    { class: 'tip' },
    h('p', {}, 'Firmware installs go over a USB-C cable: fast and steady.'),
    h('p', { class: 'muted' }, '1. Plug the Flipper into your phone (a data cable, not charge-only).'),
    h('p', { class: 'muted' }, '2. Tap connect and allow USB access.'),
    h('button', { class: 'primary', style: 'width:100%', onclick: plugIn }, '🔌 connect by USB'),
  );
}

function home() {
  const now = h('p', { class: 'muted' }, target() ? 'checking your firmware…' : '');
  const showCurrent = () => {
    now.replaceChildren('On your Flipper: ', h('b', {}, current.label || 'unknown'));
  };
  if (current) showCurrent();
  else if (target())
    target()
      .deviceInfo()
      .then((info) => {
        current = currentFirmware(info);
        showCurrent();
        list.replaceChildren(...cards());
      })
      .catch(() => (now.textContent = ''));

  const cards = () =>
    FIRMWARES.map((fw) =>
      h(
        'div',
        { class: 'card-item', role: 'button', onclick: () => go({ type: 'fw', id: fw.id }) },
        h('span', { class: 'card-name' }, fw.name),
        current?.firmware?.id === fw.id && h('span', {}, h('span', { class: 'app-tag installed', style: 'margin-left:0' }, 'on your flipper')),
        h('span', { class: 'card-sub muted' }, fw.about),
      ),
    );
  const list = h('div', { class: 'cards' }, ...cards());

  const fileInput = h('input', { type: 'file', accept: '.tgz,.gz,.zip,application/gzip,application/zip', hidden: true });
  fileInput.onchange = () => {
    const file = fileInput.files?.[0];
    if (file) confirmInstall({ label: file.name, load: async () => new Uint8Array(await file.arrayBuffer()) });
  };

  const saved = h('div', { class: 'cards' });
  savedPackages().then((files) => {
    if (!files.length) return;
    saved.replaceChildren(
      h('h2', { style: 'grid-column:1/-1' }, 'downloaded on this phone'),
      ...files.map((f) =>
        h(
          'div',
          { class: 'card-item', role: 'button', onclick: () => confirmInstall({ label: f.name.replace(/\.(tgz|tar\.gz|zip)$/i, ''), load: () => readSaved(f.name) }) },
          h('span', { class: 'card-name' }, f.name.replace(/\.(tgz|tar\.gz|zip)$/i, '')),
          h('span', { class: 'card-sub muted' }, `${formatBytes(f.size)} · works offline`),
          moreButton(f.name, [
            {
              label: 'delete from phone…',
              danger: true,
              run: async () => {
                if (!(await confirmAction(`Delete ${f.name} from your phone?`, 'delete', true))) return;
                await Filesystem.deleteFile({ path: `${FW_DIR}/${f.name}`, directory: Directory.Documents }).catch(showError);
                rerender();
              },
            },
          ]),
        ),
      ),
    );
  });

  return h(
    'div',
    {},
    usbCard(),
    now,
    h('p', { class: 'muted' }, 'Pick a firmware, then a channel. Your saved files on the SD card stay.'),
    list,
    saved,
    h('button', { style: 'width:100%;margin-top:12px', onclick: () => fileInput.click() }, '⇪ install from a file (.tgz update package)'),
    fileInput,
  );
}

function fwPage(fw) {
  const root = h('div', {}, h('div', { class: 'app-name big' }, fw.name), h('p', { class: 'muted' }, fw.about), !target() && usbCard());
  const body = h('div', {}, h('p', { class: 'muted' }, 'loading versions…'));
  root.append(body);
  const draw = () => {
    const got = channels.get(fw.id);
    if (!got) return;
    if (got instanceof Error) {
      body.replaceChildren(h('p', { class: 'tip' }, got.message), h('button', { onclick: () => (channels.delete(fw.id), rerender()) }, 'try again'));
      return;
    }
    const chosenId = picked.get(fw.id) ?? got.channels[0].id;
    const ch = got.channels.find((c) => c.id === chosenId) ?? got.channels[0];
    const [latest, ...older] = ch.versions;
    const isCurrent = (v) => current?.firmware?.id === fw.id && current.version && v.version.includes(current.version);
    body.replaceChildren(
      h(
        'div',
        { class: 'row', style: 'flex-wrap:wrap;gap:6px;margin-bottom:10px' },
        got.channels.map((c) =>
          h('button', { class: c.id === ch.id ? 'primary' : '', onclick: () => (picked.set(fw.id, c.id), draw()) }, c.title),
        ),
      ),
      h('div', { class: 'app-name' }, latest.version, isCurrent(latest) && h('span', { class: 'app-tag installed' }, 'on flipper')),
      h('div', { class: 'muted', style: 'margin-bottom:8px' }, [latest.date, `from ${got.from}`].filter(Boolean).join(' · ')),
      h('button', { class: 'primary', style: 'width:100%', onclick: () => confirmInstall(fromServer(fw, ch, latest)) }, isCurrent(latest) ? `⟳ install ${latest.version} again` : `⇩ install ${latest.version}`),
      latest.changelog && h('pre', { class: 'changelog' }, latest.changelog.split('\n').slice(0, 40).join('\n')),
      older.length > 0 &&
        h(
          'details',
          {},
          h('summary', { class: 'muted' }, `older versions (${older.length})`),
          ...older.slice(0, 15).map((v) =>
            h('div', { class: 'row', style: 'justify-content:space-between;margin:6px 0' }, h('span', {}, `${v.version} `, h('span', { class: 'muted' }, v.date)), h('button', { onclick: () => confirmInstall(fromServer(fw, ch, v)) }, 'install')),
          ),
        ),
    );
  };
  if (channels.has(fw.id)) draw();
  else
    cached(`fw:${fw.id}`, () => loadChannels(http, fw), (got) => (channels.set(fw.id, got), root.isConnected && draw()), { maxAgeMs: 30 * 60 * 1000 }).catch((e) => {
      channels.set(fw.id, e);
      draw();
    });
  return root;
}

function fromServer(fw, ch, v) {
  const file = `${fw.id}-${v.version}.tgz`.replace(/[^\w.-]/g, '_');
  return {
    label: `${fw.name} ${v.version} (${ch.title.replace(/ \(.*/, '')})`,
    load: async (say) => {
      say('downloading…');
      const bytes = await http.bytes(v.url);
      if (v.sha256) {
        say('checking the download…');
        if ((await sha256Hex(bytes)) !== v.sha256.toLowerCase()) throw new Error('The download is damaged (checksum mismatch). Try again.');
      }
      say('keeping a copy on your phone…');
      await saveToPhone(Capacitor.isNativePlatform() ? `firmware/${file}` : file, bytes).catch(() => {});
      return bytes;
    },
  };
}

async function confirmInstall(source) {
  if (!target()) return toast('Plug the Flipper in by USB and tap connect first.');
  const ok = await sheet(
    `Install ${source.label}?`,
    [{ label: '⇩ install', class: 'primary', value: 'go' }],
    h(
      'p',
      { class: 'muted', style: 'white-space:pre-wrap' },
      'Keep the app open and the cable in. Copying over USB takes a minute or two.\n\n' +
        'If the cable comes out, nothing breaks: plug it back in and install again, it continues where it stopped. ' +
        'The Flipper only updates once every file checked out.\n\nYour saved files stay. A backup first (Tools › sd backup) never hurts.',
    ),
  );
  if (ok !== 'go') return;
  run(source);
}

async function run(source) {
  job = { title: `Installing ${source.label}`, line: 'getting ready…', sent: 0, total: 0, stop: false, finished: false };
  go({ type: 'work' });
  try {
    const bytes = await source.load((t) => ((job.line = t), updateWork()));
    job.line = 'opening the package…';
    updateWork();
    const pkg = await readPackage(bytes);
    job.total = pkg.bytes;
    await installPackage(target(), pkg, {
      progress: (p) => {
        job.sent = p.sent;
        job.line = `${p.step === 'checking' ? 'checking' : 'copying'} ${p.file.split('/').pop()} · ${formatBytes(p.sent)} of ${formatBytes(p.total)}`;
        updateWork();
      },
      shouldStop: () => job.stop,
    });
    job.title = 'Your Flipper is updating ✓';
    job.result = [
      'All files arrived and checked out. The Flipper restarted into its updater and shows the progress on its screen.',
      'It takes a few minutes and restarts by itself when done. You can unplug it once it shows the normal screen again.',
    ];
    current = null;
  } catch (e) {
    job.title = job.stop ? 'Stopped' : "Couldn't finish";
    job.result = [e.message, 'Your Flipper was not changed. Install again to continue where it stopped.'];
  }
  job.finished = true;
  rerender();
}

let workEls = null;
function updateWork() {
  if (!workEls || !job) return;
  workEls.line.textContent = job.line;
  if (job.total) {
    workEls.bar.max = job.total;
    workEls.bar.value = job.sent;
  }
}

function workPage() {
  if (!job) return h('p', { class: 'muted' }, '…');
  if (job.finished) {
    workEls = null;
    return h('div', {}, h('h2', {}, job.title), ...job.result.map((l) => h('p', { class: 'muted' }, l)), h('button', { class: 'primary', style: 'width:100%', onclick: () => firmwareBack() }, 'ok'));
  }
  workEls = { line: h('p', { class: 'muted', style: 'word-break:break-all;min-height:2.6em' }), bar: h('progress', { style: 'width:100%' }) };
  updateWork();
  return h(
    'div',
    {},
    h('h2', {}, job.title),
    workEls.bar,
    workEls.line,
    h('p', { class: 'tip' }, 'Keep the app open and the cable plugged in.'),
    h('button', { class: 'danger', style: 'width:100%', onclick: () => ((job.stop = true), (job.line = 'stopping after this file…'), updateWork()) }, 'stop'),
  );
}

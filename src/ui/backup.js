// Backup tool: copy the Flipper's SD card into one .zip on the phone, and put it back.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { h, toast, showError, confirmAction, formatBytes, sheet, moreButton } from './dom.js';
import { conn } from '../connection.js';
import { saveToPhone, SAVE_FOLDER } from './save.js';
import { base64ToBytes } from '../store/http.js';
import { scanFiles, groupByFolder, makeBackup, readBackup, restoreBackup, backupName } from '../backup/backup.js';

const BACKUP_DIR = `${SAVE_FOLDER}/backups`;

let rerender = () => {};
let screen = 'home'; // home | pick | work
let groups = null; // scanned folders
let picked = new Set();
let job = null; // { title, line, done, total, stop, finished, result }

export function openBackup() {
  screen = 'home';
}
export function resetBackup() {
  if (job && !job.finished) return;
  screen = 'home';
  groups = null;
  job = null;
}
export function backupBack() {
  if (screen === 'home') return false;
  if (job && !job.finished) {
    toast('Still working. Press stop first.');
    return true;
  }
  screen = 'home';
  job = null;
  rerender();
  return true;
}

export function backupView(rerenderTab) {
  rerender = rerenderTab;
  if (screen === 'pick') return pickPage();
  if (screen === 'work') return workPage();
  return home();
}

// ---------- saved backups on the phone ----------

async function listBackups() {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const { files } = await Filesystem.readdir({ path: BACKUP_DIR, directory: Directory.Documents });
    return files.filter((f) => f.name.endsWith('.zip')).sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  } catch {
    return [];
  }
}

async function readSaved(name) {
  const { data } = await Filesystem.readFile({ path: `${BACKUP_DIR}/${name}`, directory: Directory.Documents });
  return typeof data === 'string' ? base64ToBytes(data) : new Uint8Array(await data.arrayBuffer());
}

// ---------- screens ----------

function home() {
  const fileInput = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true });
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (file) startRestore(file.name, () => file.arrayBuffer().then((b) => new Uint8Array(b)));
  };
  const list = h('div', { class: 'cards' }, h('p', { class: 'muted' }, 'looking for backups…'));
  listBackups().then((files) => {
    list.replaceChildren(
      ...(files.length
        ? files.map((f) =>
            h(
              'div',
              { class: 'card-item' },
              h('span', { class: 'card-name' }, f.name.replace(/^flipper-backup-/, '').replace(/\.zip$/, '')),
              h('span', { class: 'card-sub muted' }, formatBytes(f.size)),
              moreButton(f.name, [
                {
                  label: 'delete this backup…',
                  danger: true,
                  run: async () => {
                    if (!(await confirmAction(`Delete the backup ${f.name} from your phone?`, 'delete', true))) return;
                    await Filesystem.deleteFile({ path: `${BACKUP_DIR}/${f.name}`, directory: Directory.Documents }).catch(showError);
                    rerender();
                  },
                },
              ]),
              h(
                'div',
                { class: 'row' },
                h('button', { class: 'primary', onclick: () => startRestore(f.name, () => readSaved(f.name)) }, 'restore'),
              ),
            ),
          )
        : [h('p', { class: 'muted' }, Capacitor.isNativePlatform() ? 'No backups yet.' : 'Backups are saved as downloads in the browser preview.')]),
    );
  });
  return h(
    'div',
    {},
    h('p', { class: 'muted' }, `Copies the files on your Flipper's SD card into one .zip on your phone (Documents/${BACKUP_DIR}). Works offline.`),
    h('button', { class: 'primary', style: 'width:100%;margin-bottom:8px', onclick: startScan }, '⇩ make a backup'),
    h('button', { style: 'width:100%;margin-bottom:12px', onclick: () => fileInput.click() }, '⇪ restore from a .zip file'),
    fileInput,
    h('h2', {}, 'backups on this phone'),
    list,
  );
}

async function startScan() {
  job = { title: 'Looking at your SD card…', line: '', done: 0, total: 0, stop: false, finished: false };
  screen = 'work';
  rerender();
  try {
    const files = await scanFiles(conn.flipper, '/ext', (d) => {
      job.line = d;
      updateWork();
    });
    groups = groupByFolder(files);
    picked = new Set(groups.filter((g) => !g.skip).map((g) => g.name));
    job = null;
    screen = 'pick';
  } catch (e) {
    showError(e);
    job = null;
    screen = 'home';
  }
  rerender();
}

function pickPage() {
  const total = () => groups.filter((g) => picked.has(g.name)).reduce((n, g) => [n[0] + g.files.length, n[1] + g.bytes], [0, 0]);
  const summary = h('p', { class: 'muted' });
  const showTotal = () => {
    const [n, b] = total();
    summary.textContent = `${n} files, ${formatBytes(b)}`;
  };
  showTotal();
  return h(
    'div',
    {},
    h('h2', {}, 'what to back up'),
    h('p', { class: 'muted' }, 'Apps, asset packs and firmware files are unticked because you can download them again. Tick them if you want them anyway.'),
    h(
      'div',
      { class: 'cards' },
      groups.map((g) => {
        const box = h('input', { type: 'checkbox', checked: picked.has(g.name) });
        box.onchange = () => {
          if (box.checked) picked.add(g.name);
          else picked.delete(g.name);
          showTotal();
        };
        return h(
          'label',
          { class: 'card-item row', style: 'gap:10px;align-items:center' },
          box,
          h('span', { class: 'card-name', style: 'flex:1' }, g.name),
          h('span', { class: 'muted' }, `${g.files.length} ${g.files.length === 1 ? 'file' : 'files'} · ${formatBytes(g.bytes)}`),
        );
      }),
    ),
    summary,
    h('button', { class: 'primary', style: 'width:100%', onclick: startBackup }, 'start backup'),
  );
}

async function startBackup() {
  const files = groups.filter((g) => picked.has(g.name)).flatMap((g) => g.files);
  if (!files.length) return toast('Tick at least one folder.');
  job = { title: 'Backing up…', line: '', done: 0, total: files.length, stop: false, finished: false };
  screen = 'work';
  rerender();
  try {
    const r = await makeBackup(conn.flipper, files, {
      progress: (p) => {
        Object.assign(job, { done: p.done, line: p.path ? `${p.path.split('/').pop()} · ${formatBytes(p.bytes)} of ${formatBytes(p.totalBytes)}` : '' });
        updateWork();
      },
      shouldStop: () => job.stop,
    });
    const name = backupName();
    await saveToPhone(Capacitor.isNativePlatform() ? `backups/${name}` : name, r.zip);
    job.finished = true;
    job.title = 'Backup done ✓';
    job.result = [`${r.count} files (${formatBytes(r.bytes)}) saved as ${name}.`, ...(r.skipped.length ? [`${r.skipped.length} files couldn't be read and were left out:`, ...r.skipped.slice(0, 20)] : [])];
  } catch (e) {
    job.finished = true;
    job.title = job.stop ? 'Backup stopped' : 'Backup failed';
    job.result = [job.stop ? 'Nothing was saved.' : e.message];
  }
  rerender();
}

async function startRestore(name, load) {
  const choice = await sheet(`Put ${name} back on the Flipper?`, [
    { label: 'add missing files only', class: 'primary', value: 'keep' },
    { label: 'replace files that are there', class: 'danger', value: 'replace' },
  ]);
  if (!choice) return;
  if (conn.state !== 'online') return toast('Connect your Flipper first.');
  job = { title: 'Restoring…', line: 'opening the backup', done: 0, total: 0, stop: false, finished: false };
  screen = 'work';
  rerender();
  try {
    const files = await readBackup(await load());
    job.total = files.length;
    const r = await restoreBackup(conn.flipper, files, {
      replace: choice === 'replace',
      progress: (p) => {
        Object.assign(job, { done: p.done, line: p.path });
        updateWork();
      },
      shouldStop: () => job.stop,
    });
    job.finished = true;
    job.title = 'Restore done ✓';
    job.result = [`${r.written} files written.`, ...(r.kept ? [`${r.kept} files were already there and were kept.`] : [])];
  } catch (e) {
    job.finished = true;
    job.title = job.stop ? 'Restore stopped' : 'Restore failed';
    job.result = [job.stop ? 'Files written so far stay on the Flipper.' : e.message];
  }
  rerender();
}

let workEls = null;
function updateWork() {
  if (!workEls || !job) return;
  workEls.line.textContent = job.line;
  if (job.total) {
    workEls.bar.max = job.total;
    workEls.bar.value = job.done;
    workEls.count.textContent = `${job.done} of ${job.total}`;
  }
}

function workPage() {
  if (!job) return h('p', { class: 'muted' }, '…');
  if (job.finished) {
    workEls = null;
    return h(
      'div',
      {},
      h('h2', {}, job.title),
      ...job.result.map((l) => h('p', { class: 'muted', style: 'word-break:break-all' }, l)),
      h('button', { class: 'primary', style: 'width:100%', onclick: () => backupBack() }, 'ok'),
    );
  }
  workEls = {
    line: h('p', { class: 'muted', style: 'word-break:break-all;min-height:2.6em' }),
    bar: h('progress', { style: 'width:100%' }),
    count: h('p', { class: 'muted' }),
  };
  updateWork();
  return h(
    'div',
    {},
    h('h2', {}, job.title),
    workEls.bar,
    workEls.count,
    workEls.line,
    h('p', { class: 'tip' }, 'Keep the app open and the Flipper close by.'),
    h(
      'button',
      {
        class: 'danger',
        style: 'width:100%',
        onclick: () => {
          job.stop = true;
          job.line = 'stopping…';
          updateWork();
        },
      },
      'stop',
    ),
  );
}

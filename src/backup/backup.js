// SD card backup and restore: Flipper files <-> one .zip on the phone.
import { RpcError } from '../flipper/rpc.js';
import { writeZip, readZip } from '../assets/archive.js';

/** Folders left out by default: they can be downloaded again. */
export const SKIP_BY_DEFAULT = ['apps', 'apps_manifests', 'asset_packs', 'update', '.tmp', 'dolphin_custom'];

/** Every file under dir: [{ path, size }]. */
export async function scanFiles(f, dir, onFolder = () => {}) {
  const out = [];
  const walk = async (d) => {
    onFolder(d);
    let entries;
    try {
      entries = await f.list(d);
    } catch (e) {
      if (e instanceof RpcError && e.statusName === 'ERROR_STORAGE_NOT_EXIST') return;
      throw e;
    }
    for (const e of entries) {
      const p = `${d}/${e.name}`;
      if (e.isDir) await walk(p);
      else out.push({ path: p, size: e.size ?? 0 });
    }
  };
  await walk(dir);
  return out;
}

/** Groups scanned files by their top folder in /ext: [{ name, files, bytes, skip }]. */
export function groupByFolder(files, root = '/ext') {
  const groups = new Map();
  for (const file of files) {
    const rest = file.path.slice(root.length + 1);
    const name = rest.includes('/') ? rest.split('/')[0] : '(files in /ext)';
    if (!groups.has(name)) groups.set(name, { name, files: [], bytes: 0, skip: SKIP_BY_DEFAULT.includes(name) });
    const g = groups.get(name);
    g.files.push(file);
    g.bytes += file.size;
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Reads the files from the Flipper and packs them into a zip (paths like "ext/subghz/x.sub").
 * progress({ done, total, bytes, totalBytes, path }); shouldStop() can cancel between files.
 */
export async function makeBackup(f, files, { progress = () => {}, shouldStop = () => false } = {}) {
  const entries = [];
  const totalBytes = files.reduce((n, x) => n + x.size, 0);
  let bytes = 0;
  const skipped = [];
  for (let i = 0; i < files.length; i++) {
    if (shouldStop()) throw new Error('Backup stopped.');
    const file = files[i];
    progress({ done: i, total: files.length, bytes, totalBytes, path: file.path });
    try {
      const data = await f.read(file.path);
      entries.push({ path: file.path.replace(/^\//, ''), data });
      bytes += data.length;
    } catch (e) {
      skipped.push(`${file.path} (${e.message})`);
    }
  }
  progress({ done: files.length, total: files.length, bytes, totalBytes, path: '' });
  return { zip: writeZip(entries), count: entries.length, bytes, skipped };
}

/** Files inside a backup zip that belong on the Flipper. */
export async function readBackup(zipBytes) {
  const files = (await readZip(zipBytes)).filter((x) => /^(ext|int)\//.test(x.path) && !x.path.includes('..'));
  if (!files.length) throw new Error("This zip isn't a Flipper backup (no ext/ folder inside).");
  return files;
}

/**
 * Writes backup files back to the Flipper.
 * replace=false keeps files that are already there.
 */
export async function restoreBackup(f, files, { replace = false, progress = () => {}, shouldStop = () => false } = {}) {
  const made = new Set(['/ext', '/int']);
  const listings = new Map(); // folder -> Set of names already there
  const existing = async (dir) => {
    if (!listings.has(dir)) {
      try {
        listings.set(dir, new Set((await f.list(dir)).map((e) => e.name)));
      } catch {
        listings.set(dir, new Set());
      }
    }
    return listings.get(dir);
  };
  let written = 0;
  let kept = 0;
  for (let i = 0; i < files.length; i++) {
    if (shouldStop()) throw new Error('Restore stopped.');
    const file = files[i];
    const path = `/${file.path}`;
    const dir = path.slice(0, path.lastIndexOf('/'));
    const name = path.slice(dir.length + 1);
    progress({ done: i, total: files.length, path });
    const parts = dir.split('/').filter(Boolean);
    for (let k = 2; k <= parts.length; k++) {
      const d = `/${parts.slice(0, k).join('/')}`;
      if (made.has(d)) continue;
      try {
        await f.mkdir(d);
      } catch (e) {
        if (!(e instanceof RpcError && e.statusName === 'ERROR_STORAGE_EXIST')) throw e;
      }
      made.add(d);
    }
    if (!replace && (await existing(dir)).has(name)) {
      kept++;
      continue;
    }
    await f.write(path, file.data);
    written++;
  }
  progress({ done: files.length, total: files.length, path: '' });
  return { written, kept };
}

export function backupName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `flipper-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.zip`;
}

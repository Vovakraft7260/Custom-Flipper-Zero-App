// Puts a firmware update package on the Flipper and starts it, the same way
// the official app does: unpack to /ext/update/<folder>, check it, reboot into the updater.
import { readArchive } from '../assets/archive.js';
import { RpcError } from '../flipper/rpc.js';
import { md5 } from './md5.js';

export const UPDATE_DIR = '/ext/update';

const PROBLEMS = {
  ManifestPathInvalid: "The Flipper couldn't find the update files.",
  ManifestFolderNotFound: "The Flipper couldn't find the update folder.",
  ManifestInvalid: 'The update package is damaged or not for this Flipper.',
  StageMissing: 'Part of the update package is missing.',
  StageIntegrityError: 'Part of the update package is damaged. Try downloading it again.',
  ManifestPointerError: "The Flipper couldn't start the update.",
  TargetMismatch: 'This firmware is made for a different Flipper model.',
  OutdatedManifestVersion: 'This package is too old for your Flipper.',
  IntFull: "The Flipper's internal memory is full.",
  UnspecifiedError: 'The Flipper refused the update.',
};

export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Files of an update package and the folder name inside it. */
export async function readPackage(bytes) {
  const files = (await readArchive(bytes)).filter((f) => !f.path.split('/').some((s) => s === '..' || s.startsWith('._')));
  const manifest = files.find((f) => /(^|\/)update\.fuf$/.test(f.path));
  if (!manifest) throw new Error("This isn't a Flipper firmware update package (no update.fuf inside).");
  const root = manifest.path.includes('/') ? manifest.path.slice(0, manifest.path.lastIndexOf('/')) : '';
  const folder = (root.split('/').pop() || 'update').replace(/[^\w.-]/g, '_');
  const inside = files
    .filter((f) => (root ? f.path.startsWith(`${root}/`) : true))
    .map((f) => ({ path: root ? f.path.slice(root.length + 1) : f.path, data: f.data }));
  return { folder, files: inside, bytes: inside.reduce((n, f) => n + f.data.length, 0) };
}

async function mkdirOk(f, path) {
  try {
    await f.mkdir(path);
  } catch (e) {
    if (!(e instanceof RpcError && e.statusName === 'ERROR_STORAGE_EXIST')) throw e;
  }
}

/**
 * Sends the package and starts the update. The Flipper restarts at the end.
 * Safe over Bluetooth: every file is checked (MD5) on the Flipper after copying,
 * files already there and correct are skipped (so a dropped connection just
 * continues next time), and nothing on the Flipper changes until all files check out.
 * progress({ sent, total, file, step }); shouldStop() cancels while sending.
 */
export async function installPackage(f, pkg, { progress = () => {}, shouldStop = () => false } = {}) {
  const free = await f.storageInfo('/ext').then((s) => s.free).catch(() => Infinity);
  if (free < pkg.bytes + 1024 * 1024) throw new Error('Not enough free space on the SD card for the update.');
  const base = `${UPDATE_DIR}/${pkg.folder}`;
  await mkdirOk(f, UPDATE_DIR);
  await mkdirOk(f, base); // kept from an earlier try: correct files are reused
  const made = new Set([base]);
  let sent = 0;
  for (const file of pkg.files) {
    if (shouldStop()) throw new Error('Firmware install stopped. Your Flipper was not changed.');
    const parts = file.path.split('/');
    for (let k = 1; k < parts.length; k++) {
      const d = `${base}/${parts.slice(0, k).join('/')}`;
      if (!made.has(d)) {
        await mkdirOk(f, d);
        made.add(d);
      }
    }
    const path = `${base}/${file.path}`;
    const want = md5(file.data);
    const start = sent;
    if ((await f.md5(path)) !== want) {
      for (let attempt = 1; ; attempt++) {
        await f.write(path, file.data, (n) => progress({ sent: start + n, total: pkg.bytes, file: file.path, step: 'copying' }));
        progress({ sent: start + file.data.length, total: pkg.bytes, file: file.path, step: 'checking' });
        if ((await f.md5(path)) === want) break;
        if (attempt >= 3) throw new Error(`${file.path} kept arriving damaged. Nothing was changed on your Flipper. Try again closer to the phone.`);
      }
    }
    sent += file.data.length;
    progress({ sent, total: pkg.bytes, file: file.path, step: 'checked' });
  }
  const result = await f.prepareUpdate(`${base}/update.fuf`);
  if (result !== 'OK') throw new Error(PROBLEMS[result] ?? `The Flipper refused the update (${result}).`);
  await f.reboot('UPDATE');
  return base;
}

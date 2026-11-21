// Asset packs (Momentum): list, download, look inside, install on the Flipper.
import { readArchive } from './archive.js';
import { decodeBm, decodeBmx, sizeFromName } from './bm.js';
import { parseFields } from '../flipper/flipperformat.js';
import { RpcError } from '../flipper/rpc.js';
import { scanFiles } from '../backup/backup.js';
import { readCached } from '../flipper/mirror.js';

export const PACKS_URL = 'https://raw.githubusercontent.com/Vovakraft7260/Custom-Flipper-Zero-App/library-index/packs.json';
export const PACKS_DIR = '/ext/asset_packs';

export function expandPacks(index) {
  if (!index || index.v !== 1) throw new Error('Asset pack list has an unknown format.');
  const raw = (src, path) => `https://raw.githubusercontent.com/${src.repo}/${src.sha}/${path.split('/').map(encodeURIComponent).join('/')}`;
  return index.sources.flatMap((src) =>
    src.packs.map((p) => ({
      ...p,
      source: src.name,
      key: `${src.id}/${p.id}`,
      previewUrls: p.previews.map((f) => raw(src, f)),
      downloadUrl: raw(src, p.tar),
    })),
  );
}

/** Sorts archive files into what a pack contains. Paths are relative to the archive. */
export function packContents(files) {
  const clean = files.filter((f) => !f.path.split('/').some((s) => s.startsWith('.') || s === '__MACOSX'));
  // Pack folder = the folder that holds Anims/Icons/Fonts.
  const roots = new Set();
  for (const f of clean) {
    const parts = f.path.split('/');
    const i = parts.findIndex((s) => ['Anims', 'Icons', 'Fonts'].includes(s));
    if (i >= 1) roots.add(parts.slice(0, i).join('/'));
    else if (i === 0) roots.add('');
  }
  if (roots.size !== 1) throw new Error(roots.size ? 'This archive holds more than one pack.' : "This doesn't look like an asset pack (no Anims, Icons or Fonts folder).");
  const root = [...roots][0];
  const name = root.split('/').pop() || 'Imported pack';
  const inPack = clean
    .filter((f) => (root ? f.path.startsWith(`${root}/`) : true))
    .map((f) => ({ path: root ? f.path.slice(root.length + 1) : f.path, data: f.data }));
  const byPath = new Map(inPack.map((f) => [f.path, f]));
  const dirs = (prefix) => [...new Set(inPack.filter((f) => f.path.startsWith(prefix)).map((f) => f.path.slice(prefix.length).split('/')[0]))];

  const anims = [];
  for (const d of dirs('Anims/')) {
    const meta = byPath.get(`Anims/${d}/meta.txt`);
    if (!meta) continue;
    const m = parseFields(new TextDecoder().decode(meta.data));
    anims.push({
      name: d,
      width: Number(m.Width) || 128,
      height: Number(m.Height) || 64,
      fps: Number(m['Frame rate']) || 2,
      order: (m['Frames order'] || '0').trim().split(/\s+/).map(Number),
      frame: (i) => byPath.get(`Anims/${d}/frame_${i}.bm`)?.data,
    });
  }
  const icons = [];
  for (const f of inPack) {
    if (!f.path.startsWith('Icons/')) continue;
    if (f.path.endsWith('.bmx')) icons.push({ name: f.path.slice(6, -4), still: f.data });
    else if (f.path.endsWith('/meta') && f.data.length >= 16) {
      const dv = new DataView(f.data.buffer, f.data.byteOffset, 16);
      const dir = f.path.slice(0, -5);
      const count = dv.getUint32(12, true);
      icons.push({
        name: dir.slice(6),
        width: dv.getUint32(0, true),
        height: dv.getUint32(4, true),
        fps: dv.getUint32(8, true) || 4,
        frames: Array.from({ length: count }, (_, i) => byPath.get(`${dir}/frame_${String(i).padStart(2, '0')}.bm`)?.data).filter(Boolean),
      });
    }
  }
  const fonts = inPack.filter((f) => f.path.startsWith('Fonts/')).map((f) => f.path.slice(6));
  return { name, files: inPack, anims, icons, fonts };
}

/** Decoded frames for an animation or icon: [{ width, height, pixels }]. */
export function framesOf(item) {
  if (item.still) return [decodeBmx(item.still)];
  if (item.frames) return item.frames.map((b) => decodeBm(b, item.width, item.height));
  const out = [];
  for (const i of item.order) {
    const data = item.frame(i);
    if (data) out.push(decodeBm(data, item.width, item.height));
  }
  return out;
}

export { readArchive, sizeFromName };

async function mkdirOk(f, path) {
  try {
    await f.mkdir(path);
  } catch (e) {
    if (!(e instanceof RpcError && e.statusName === 'ERROR_STORAGE_EXIST')) throw e;
  }
}

/** Copies a pack onto the SD card: /ext/asset_packs/<name>/... */
export async function installPack(f, pack, { step = () => {} } = {}) {
  const base = `${PACKS_DIR}/${pack.name.replace(/[\\/:*?"<>|]/g, '_')}`;
  await mkdirOk(f, PACKS_DIR);
  try {
    await f.remove(base, true); // replace an older copy completely
  } catch {
    /* wasn't there */
  }
  await mkdirOk(f, base);
  const made = new Set([base]);
  let i = 0;
  for (const file of pack.files) {
    const parts = file.path.split('/');
    for (let k = 1; k < parts.length; k++) {
      const d = `${base}/${parts.slice(0, k).join('/')}`;
      if (!made.has(d)) {
        await mkdirOk(f, d);
        made.add(d);
      }
    }
    await f.write(`${base}/${file.path}`, file.data);
    step(`sending to flipper… ${++i} of ${pack.files.length} files`);
  }
  return base;
}

export async function installedPacks(f) {
  try {
    return (await f.list(PACKS_DIR)).filter((e) => e.isDir).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function removePack(f, name) {
  await f.remove(`${PACKS_DIR}/${name}`, true);
}

/** Reads an installed pack back from the SD card so it can be looked at. */
export async function readInstalledPack(f, name, { step = () => {} } = {}) {
  const base = `${PACKS_DIR}/${name}`;
  step('looking at the files…');
  const list = (await scanFiles(f, base)).filter((x) => /\/(Anims|Icons|Fonts)\//.test(x.path));
  const files = [];
  for (const [i, x] of list.entries()) {
    step(`reading from flipper… ${i + 1} of ${list.length} files`);
    files.push({ path: `${name}/${x.path.slice(base.length + 1)}`, data: await readCached(f, x.path, x.size) });
  }
  return packContents(files);
}

/** First frame of a pack's first animation (for a small picture), read cheaply. */
export async function packThumbFrame(f, name) {
  const base = `${PACKS_DIR}/${name}/Anims`;
  const dirs = (await f.list(base)).filter((e) => e.isDir);
  for (const d of dirs.slice(0, 3)) {
    const files = await f.list(`${base}/${d.name}`);
    const meta = files.find((e) => e.name === 'meta.txt');
    const frame = files.find((e) => e.name === 'frame_0.bm');
    if (!meta || !frame) continue;
    const m = parseFields(new TextDecoder().decode(await readCached(f, `${base}/${d.name}/meta.txt`, meta.size)));
    const data = await readCached(f, `${base}/${d.name}/frame_0.bm`, frame.size);
    return decodeBm(data, Number(m.Width) || 128, Number(m.Height) || 64);
  }
  return null;
}

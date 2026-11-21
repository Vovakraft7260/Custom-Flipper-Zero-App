// Downloads the library list and files, and keeps copies on the phone so
// everything already opened still works offline.
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { INDEX_URL, expandIndex, repoPath, rawUrl } from './catalog.js';

const INDEX_FILE = 'library/index.json';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000; // refresh the list weekly

let lib = null; // expanded index in memory
let libSavedAt = 0;

async function readCache(path) {
  try {
    const [r, stat] = await Promise.all([
      Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 }),
      Filesystem.stat({ path, directory: Directory.Data }),
    ]);
    return { text: r.data, mtime: Number(stat.mtime) || 0 };
  } catch {
    return null;
  }
}
async function writeCache(path, text) {
  try {
    await Filesystem.writeFile({ path, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
  } catch {
    /* no space or storage blocked: still works, just not offline */
  }
}

async function download(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  return res.text();
}

/**
 * The library list. Uses the copy on the phone when it's fresh (or when offline).
 * refresh: true forces a new download. Returns { lib, offline, savedAt }.
 */
export async function getLibrary({ refresh = false } = {}) {
  if (!lib) {
    const cached = await readCache(INDEX_FILE);
    if (cached) {
      try {
        lib = expandIndex(JSON.parse(cached.text));
        libSavedAt = cached.mtime;
      } catch {
        lib = null;
      }
    }
  }
  const stale = !lib || refresh || Date.now() - libSavedAt > MAX_AGE_MS;
  if (stale) {
    try {
      const text = await download(INDEX_URL);
      lib = expandIndex(JSON.parse(text));
      libSavedAt = Date.now();
      await writeCache(INDEX_FILE, text);
    } catch (e) {
      if (!lib) throw new Error(`Couldn't load the library. Connect to the internet once to download it. (${e.message})`);
      return { lib, offline: true, savedAt: libSavedAt };
    }
  }
  return { lib, offline: false, savedAt: libSavedAt };
}

function cachePath(e) {
  return `library/files/${e.src.id}/${repoPath(e)}`;
}

/** File text: from the phone if downloaded before, otherwise from GitHub. */
export async function getFileText(e) {
  const cached = await readCache(cachePath(e));
  if (cached) return cached.text;
  const text = await download(rawUrl(e));
  await writeCache(cachePath(e), text);
  return text;
}

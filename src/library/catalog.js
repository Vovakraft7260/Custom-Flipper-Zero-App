// Signal library: turns the downloaded index into browsable, searchable entries.
// Pure functions only (no network, no Flipper), so they're easy to test.

export const INDEX_URL = 'https://raw.githubusercontent.com/Vovakraft7260/Custom-Flipper-Zero-App/library-index/index.json';

export const LIB_CATS = {
  ir: { title: 'infrared', icon: '⟿', ext: '.ir', dest: '/ext/infrared' },
  subghz: { title: 'sub-ghz', icon: '≋', ext: '.sub', dest: '/ext/subghz' },
  nfc: { title: 'nfc', icon: '◉', ext: '.nfc', dest: '/ext/nfc' },
  rfid: { title: 'rfid 125k', icon: '▭', ext: '.rfid', dest: '/ext/lfrfid' },
  ibutton: { title: 'ibutton', icon: '◎', ext: '.ibtn', dest: '/ext/ibutton' },
  badusb: { title: 'bad usb', icon: '⌨', ext: '.txt', dest: '/ext/badusb' },
};

export function catOf(name) {
  const lower = name.toLowerCase();
  for (const [id, c] of Object.entries(LIB_CATS)) if (lower.endsWith(c.ext)) return id;
  return null;
}

/** Index JSON → { sources: [{ id, name, repo, sha, license, cat, entries }] }. */
export function expandIndex(index) {
  if (!index || index.v !== 1 || !Array.isArray(index.sources)) throw new Error('Library list has an unknown format.');
  const sources = index.sources.map((s) => {
    const src = { id: s.id, name: s.name, repo: s.repo, sha: s.sha, license: s.license, root: s.root || '', entries: [] };
    for (const [di, name] of s.files) {
      const cat = catOf(name);
      if (!cat) continue;
      src.entries.push({ src, folder: s.dirs[di] ?? '', name, cat, title: name.replace(/\.[^.]+$/, '') });
    }
    const counts = {};
    for (const e of src.entries) counts[e.cat] = (counts[e.cat] || 0) + 1;
    src.counts = counts;
    return src;
  });
  return { generated: index.generated, sources };
}

/** How many files each category has across all sources. */
export function categoryCounts(lib) {
  const out = {};
  for (const s of lib.sources) for (const [c, n] of Object.entries(s.counts)) out[c] = (out[c] || 0) + n;
  return out;
}

/** Sub-folders and files directly inside `folder` ('' = top) of one source, for one category. */
export function listFolder(src, cat, folder = '') {
  const dirs = new Map();
  const files = [];
  const prefix = folder ? `${folder}/` : '';
  for (const e of src.entries) {
    if (e.cat !== cat) continue;
    if (e.folder === folder) files.push(e);
    else if (!folder || e.folder.startsWith(prefix)) {
      const child = e.folder.slice(prefix.length).split('/')[0];
      dirs.set(child, (dirs.get(child) || 0) + 1);
    }
  }
  const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return {
    dirs: [...dirs].map(([name, count]) => ({ name, count })).sort((a, b) => byName(a.name, b.name)),
    files: files.sort((a, b) => byName(a.name, b.name)),
  };
}

/** Every word must appear in the folder path or file name; file-name matches come first. */
export function searchEntries(lib, cat, query, limit = 150) {
  const words = query.toLowerCase().split(/[\s_\-/]+/).filter(Boolean);
  if (!words.length) return [];
  const norm = (t) => t.toLowerCase().replace(/[_\-]+/g, ' ');
  const hits = [];
  for (const s of lib.sources) {
    for (const e of s.entries) {
      if (e.cat !== cat) continue;
      const name = norm(e.name);
      const hay = `${norm(e.folder)}/${name}`;
      if (words.every((w) => hay.includes(w))) hits.push({ e, score: words.filter((w) => name.includes(w)).length });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score || a.e.name.length - b.e.name.length)
    .slice(0, limit)
    .map((x) => x.e);
}

/** Path of the file inside its GitHub repo. */
export function repoPath(e) {
  return [e.src.root, e.folder, e.name].filter(Boolean).join('/');
}

/** Download address (pinned to the indexed commit, so it never changes under us). */
export function rawUrl(e) {
  const path = repoPath(e).split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${e.src.repo}/${e.src.sha}/${path}`;
}

/** Where the file goes on the Flipper: /ext/<category>/library/<name>. */
export function flipperDest(e) {
  const cat = LIB_CATS[e.cat];
  let name = e.name.replace(/[\\/:*?"<>|]/g, '_');
  // Bad USB payloads are often all called "payload.txt": name them after their folder instead.
  if (e.cat === 'badusb' && /^payload\.txt$/i.test(name) && e.folder) name = `${e.folder.split('/').pop()}.txt`;
  return `${cat.dest}/library/${name}`;
}

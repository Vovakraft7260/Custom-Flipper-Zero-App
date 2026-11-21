// A copy of Flipper files kept on the phone. A file is only read from the
// Flipper again when its size changed, so screens open fast after the first time.

const DB = 'oilrig-mirror';
const STORE = 'files';
const memory = new Map(); // fallback when IndexedDB isn't there (tests)
let dbPromise = null;

function db() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

let deviceName = 'flipper';
/** Each Flipper keeps its own copy (set when connecting). */
export function setMirrorDevice(name) {
  deviceName = name || 'flipper';
}
const device = () => deviceName;
const key = (path) => `${device()}:${path}`;

async function get(k) {
  const d = await db();
  if (!d) return memory.get(k);
  return new Promise((resolve) => {
    const req = d.transaction(STORE).objectStore(STORE).get(k);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

async function put(k, value) {
  const d = await db();
  if (!d) return void memory.set(k, value);
  await new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, k);
    tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
  });
}

/** File contents, from the phone's copy when the size on the Flipper still matches. */
export async function readCached(f, path, size) {
  const k = key(path);
  const saved = await get(k).catch(() => undefined);
  if (saved && size != null && saved.size === size) return saved.data;
  const data = await f.read(path);
  await put(k, { size: data.length, data }).catch(() => {});
  return data;
}

/** Small saved values (lists, device info) per Flipper, in localStorage. */
export function remember(name, value) {
  try {
    localStorage.setItem(`oilrig.mirror.${device()}.${name}`, JSON.stringify(value));
  } catch {
    /* storage full: fine */
  }
}
export function recall(name) {
  try {
    const raw = localStorage.getItem(`oilrig.mirror.${device()}.${name}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

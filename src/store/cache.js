// Remembers catalog answers on the phone so screens show instantly,
// then refreshes them quietly in the background.
const PREFIX = 'oilrig.catalog.';

export function readCache(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null; // { at, data }
  } catch {
    return null;
  }
}

export function writeCache(key, data) {
  const value = JSON.stringify({ at: Date.now(), data });
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Storage full: drop old catalog copies and try once more.
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
      localStorage.setItem(PREFIX + key, value);
    } catch {
      /* can't store: fine, just slower */
    }
  }
}

/**
 * Shows the saved copy right away (if any) and fetches a fresh one when the copy
 * is older than maxAgeMs. show(data, { fresh }) may be called twice.
 * Resolves after the fresh copy (or the error, when nothing was saved).
 */
export async function cached(key, load, show, { maxAgeMs = 10 * 60 * 1000 } = {}) {
  const saved = readCache(key);
  if (saved) show(saved.data, { fresh: false });
  if (saved && Date.now() - saved.at < maxAgeMs) return;
  try {
    const data = await load();
    writeCache(key, data);
    if (!saved || JSON.stringify(saved.data) !== JSON.stringify(data)) show(data, { fresh: true });
  } catch (e) {
    if (!saved) throw e; // offline with a saved copy: keep showing it
  }
}

export function cacheAge(key) {
  const saved = readCache(key);
  return saved ? Date.now() - saved.at : Infinity;
}

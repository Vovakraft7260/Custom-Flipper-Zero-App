// Checks GitHub for a newer 0ilrig Trmnl build and offers it.
// Fully optional: with no internet it silently does nothing.
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export const REPO = 'Vovakraft7260/Custom-Flipper-Zero-App';
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const SKIP_KEY = 'oilrig.skipUpdate';

/** Build number from a release tag like "build-42" (or a "v1.2" tag's body "build 42"). */
export function buildNumber(release) {
  const m = /build[-\s](\d+)/i.exec(release?.tag_name || '') || /build[-\s](\d+)/i.exec(release?.body || '');
  return m ? Number(m[1]) : 0;
}

/** Returns { build, name, url, notes } if the release is newer than currentBuild, else null. */
export function pickUpdate(release, currentBuild) {
  if (!release || release.draft || release.prerelease) return null;
  const build = buildNumber(release);
  if (!build || build <= currentBuild) return null;
  const apk = (release.assets || []).find((a) => /\.apk$/i.test(a.name) && !/debug/i.test(a.name));
  if (!apk) return null;
  return { build, name: release.name || release.tag_name, url: apk.browser_download_url, notes: release.body || '' };
}

/** Looks for an update. Resolves to an update object or null; never throws. */
export async function checkForUpdate({ force = false } = {}) {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const info = await App.getInfo();
    const res = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const update = pickUpdate(await res.json(), Number(info.build) || 0);
    if (!update) return null;
    if (!force && readSkip() === update.build) return null;
    return update;
  } catch {
    return null; // offline or GitHub unreachable: that's fine
  }
}

/** Opens the APK download in the phone's browser; tapping the download installs it. */
export function openUpdate(update) {
  window.location.href = update.url; // Capacitor hands outside links to the browser
}

export function skipUpdate(update) {
  try { localStorage.setItem(SKIP_KEY, String(update.build)); } catch {}
}
function readSkip() {
  try { return Number(localStorage.getItem(SKIP_KEY)) || 0; } catch { return 0; }
}

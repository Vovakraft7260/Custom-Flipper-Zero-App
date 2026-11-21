// Installs, updates and removes catalog apps on the Flipper (like the official app).
import { RpcError } from '../flipper/rpc.js';
import { http as defaultHttp, bytesToBase64 } from './http.js';
import { downloadFap, appPath, manifestPath, buildManifest, parseManifest, MANIFEST_DIR, TMP_DIR } from './catalog.js';

async function ensureDirs(f, path) {
  const parts = path.split('/').filter(Boolean);
  for (let i = 2; i <= parts.length; i++) {
    try {
      await f.mkdir(`/${parts.slice(0, i).join('/')}`);
    } catch (e) {
      if (!(e instanceof RpcError && e.statusName === 'ERROR_STORAGE_EXIST')) throw e;
    }
  }
}

async function removeIfThere(f, path) {
  try {
    await f.remove(path);
  } catch (e) {
    if (!(e instanceof RpcError && e.statusName === 'ERROR_STORAGE_NOT_EXIST')) throw e;
  }
}

/** Apps installed from the catalog (by this app or the official one). */
export async function installedApps(f) {
  let entries;
  try {
    entries = await f.list(MANIFEST_DIR);
  } catch (e) {
    if (e instanceof RpcError && e.statusName === 'ERROR_STORAGE_NOT_EXIST') return [];
    throw e;
  }
  const out = [];
  for (const e of entries) {
    if (e.isDir || !e.name.toLowerCase().endsWith('.fim')) continue;
    try {
      const m = parseManifest(new TextDecoder().decode(await f.read(`${MANIFEST_DIR}/${e.name}`)), e.name);
      if (m) out.push(m);
    } catch {
      /* unreadable manifest: skip it */
    }
  }
  return out.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/**
 * Downloads the build that matches the Flipper's firmware and installs it.
 * step(text) reports progress in plain words.
 */
export async function installApp(f, sdk, app, categoryName, { previous, step = () => {}, http = defaultHttp } = {}) {
  step('downloading…');
  const fap = await downloadFap(http, sdk, app.versionId);
  let iconBase64 = null;
  try {
    if (app.icon) iconBase64 = bytesToBase64(await http.bytes(app.icon));
  } catch {
    /* icon is optional */
  }
  const dest = appPath(categoryName, app.alias);
  const tmp = `${TMP_DIR}/${app.alias}.fap`;
  step('sending to flipper…');
  await ensureDirs(f, TMP_DIR);
  await f.write(tmp, fap, (done) => step(`sending to flipper… ${Math.round((done / Math.max(1, fap.length)) * 100)}%`));
  step('installing…');
  await ensureDirs(f, dest.slice(0, dest.lastIndexOf('/')));
  if (previous && previous.path !== dest) await removeIfThere(f, previous.path);
  await removeIfThere(f, dest);
  await f.rename(tmp, dest);
  await ensureDirs(f, MANIFEST_DIR);
  const manifest = { fullName: app.name, iconBase64, sdkApi: app.buildApi ?? sdk.api, uid: app.id, versionUid: app.versionId, path: dest };
  await f.write(manifestPath(app.alias), new TextEncoder().encode(buildManifest(manifest)));
  return { ...manifest, alias: app.alias };
}

export async function uninstallApp(f, manifest) {
  await removeIfThere(f, manifest.path);
  await removeIfThere(f, manifestPath(manifest.alias));
}

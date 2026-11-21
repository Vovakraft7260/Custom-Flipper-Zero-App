// Flipper app catalog (the same one the official app uses) plus the
// install manifests the Flipper keeps in /ext/apps_manifests.
// Network calls take an `http` object so tests can fake it.
import { parseFields } from '../flipper/flipperformat.js';

export const CATALOG = 'https://catalog.flipperzero.one/api';
export const APPS_DIR = '/ext/apps';
export const MANIFEST_DIR = '/ext/apps_manifests';
export const TMP_DIR = '/ext/.tmp/0ilrig';

/** Hardware target and firmware API from device info, e.g. { target: 'f7', api: '87.1' }. */
export function sdkFromInfo(info = {}) {
  const pick = (...keys) => keys.map((k) => info[k]).find((v) => v !== undefined && v !== '');
  const major = pick('firmware_api_major', 'firmware.api.major');
  const minor = pick('firmware_api_minor', 'firmware.api.minor');
  const hw = pick('hardware_target', 'hardware.target') ?? '7';
  if (major === undefined || minor === undefined) return null;
  return { target: `f${hw}`, api: `${Number(major)}.${Number(minor)}` };
}

function query(params) {
  const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  return q.length ? `?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : '';
}

export async function listCategories(http, sdk) {
  const list = await http.json(`${CATALOG}/v0/0/category${query({ api: sdk?.api, target: sdk?.target })}`);
  return list.map((c) => ({ id: c._id, name: c.name, count: c.applications, icon: c.icon_uri, color: c.color, priority: c.priority }))
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

export function toAppShort(a) {
  const v = a.current_version ?? {};
  return {
    id: a._id,
    alias: a.alias,
    categoryId: a.category_id,
    versionId: v._id,
    version: v.version,
    name: v.name ?? a.alias,
    short: v.short_description ?? '',
    icon: v.icon_uri,
    screenshots: v.screenshots ?? [],
    status: v.status ?? 'READY',
    updatedAt: a.updated_at,
  };
}

/** Apps list. opts: { categoryId, search, offset, limit, sort ('updated_at'|'created_at'|'name'), ids } */
export async function listApps(http, sdk, opts = {}) {
  const sort = opts.sort ?? 'updated_at';
  const body = {
    limit: opts.limit ?? 50,
    offset: opts.offset ?? 0,
    query: opts.search || undefined,
    category_id: opts.categoryId || undefined,
    sort_by: sort,
    sort_order: sort === 'name' ? 1 : -1,
    applications: opts.ids,
    target: sdk?.target,
    api: sdk?.api,
    is_latest_release_version: true,
  };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  const list = await http.json(`${CATALOG}/v0/1/application`, { method: 'POST', body });
  return list.map(toAppShort);
}

export async function getApp(http, sdk, id) {
  const a = await http.json(`${CATALOG}/v0/0/application/${encodeURIComponent(id)}${query({ target: sdk?.target, api: sdk?.api })}`);
  const v = a.current_version ?? {};
  return {
    ...toAppShort(a),
    description: v.description ?? '',
    changelog: v.changelog ?? '',
    buildApi: v.current_build?.sdk?.api ?? null,
    sizeBytes: v.current_build?.metadata?.length ?? v.current_build?.metadata?.size_bytes ?? null,
    sourceUrl: v.links?.source_code?.uri ?? v.links?.source_code?.url ?? null,
  };
}

export function downloadFap(http, sdk, versionId) {
  return http.bytes(`${CATALOG}/v0/0/application/version/${encodeURIComponent(versionId)}/build/compatible${query({ target: sdk.target, api: sdk.api })}`);
}

/** Plain-language reason an app can't be installed, or null if it can. */
export function statusProblem(status) {
  return {
    READY: null,
    BUILD_RUNNING: 'Being built for your firmware right now. Try again in a few minutes.',
    UNSUPPORTED_APPLICATION: "This app doesn't support your Flipper's firmware.",
    FLIPPER_OUTDATED: 'Needs a newer firmware on your Flipper.',
    UNSUPPORTED_SDK: "Not available for your firmware's app API version.",
  }[status] ?? null;
}

/** Folder name on the SD card for a catalog category. */
export function categoryFolder(name) {
  return String(name || 'Misc').replace(/[\\/:*?"<>|]/g, '_');
}

export function appPath(categoryName, alias) {
  return `${APPS_DIR}/${categoryFolder(categoryName)}/${alias}.fap`;
}

export function manifestPath(alias) {
  return `${MANIFEST_DIR}/${alias}.fim`;
}

/** Same manifest format as the official app, so both apps see each other's installs. */
export function buildManifest(m) {
  const lines = ['Filetype: Flipper Application Installation Manifest', 'Version: 1', `Full Name: ${m.fullName}`];
  if (m.iconBase64) lines.push(`Icon: ${m.iconBase64}`);
  if (m.sdkApi) lines.push(`Version Build API: ${m.sdkApi}`);
  lines.push(`UID: ${m.uid}`, `Version UID: ${m.versionUid}`, `Path: ${m.path}`);
  return `${lines.join('\n')}\n`;
}

export function parseManifest(text, fileName) {
  const f = parseFields(text);
  if (!f.UID || !f['Version UID'] || !f.Path) return null;
  const alias = fileName.replace(/\.fim$/i, '');
  return { alias, uid: f.UID, versionUid: f['Version UID'], path: f.Path, fullName: f['Full Name'] || alias, sdkApi: f['Version Build API'] || null };
}

/** Installed apps that have a newer catalog version. */
export function findUpdates(installed, catalogApps) {
  const byId = new Map(catalogApps.map((a) => [a.id, a]));
  return installed
    .map((m) => ({ manifest: m, app: byId.get(m.uid) }))
    .filter((x) => x.app && x.app.versionId && x.app.versionId !== x.manifest.versionUid);
}

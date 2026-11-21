// App store: browse the Flipper app catalog, install / update / remove apps.
import { h, toast, showError, confirmAction } from './dom.js';
import { conn } from '../connection.js';
import { http } from '../store/http.js';
import { sdkFromInfo, listCategories, listApps, getApp, findUpdates, statusProblem } from '../store/catalog.js';
import { installApp, installedApps, uninstallApp } from '../store/installer.js';

const PAGE = 40;
let stack = []; // { type: 'list', categoryId, title } | { type: 'app', id } | { type: 'installed' }
let rerender = () => {};
let sdk; // undefined = not read yet, null = unknown firmware API
let categories = null;
let installed = null; // manifests on the Flipper
let busy = null; // alias of the app being installed
let search = '';

export function openStore() {
  stack = [];
  search = '';
}

export function resetStore() {
  stack = [];
  sdk = undefined;
  categories = null;
  installed = null;
}

export function storeBack() {
  if (!stack.length) return false;
  stack.pop();
  rerender();
  return true;
}

function go(next) {
  stack.push(next);
  rerender();
}

async function ensureBasics() {
  if (sdk === undefined) sdk = sdkFromInfo(await conn.flipper.deviceInfo());
  if (!categories) categories = await listCategories(http, sdk);
  if (!installed) installed = await installedApps(conn.flipper);
}

export function storeView(rerenderTab) {
  rerender = rerenderTab;
  const root = h('div', {}, h('p', { class: 'muted' }, 'loading app store…'));
  ensureBasics()
    .then(() => {
      const top = stack[stack.length - 1];
      const view = !top ? home() : top.type === 'list' ? appList(top) : top.type === 'app' ? appDetails(top.id) : installedView();
      root.replaceChildren(view);
    })
    .catch((e) =>
      root.replaceChildren(
        h('p', { class: 'tip' }, `Couldn't reach the app catalog. Check your internet connection. (${e.message})`),
        h('button', { onclick: rerender }, 'try again'),
      ),
    );
  return root;
}

const categoryName = (id) => categories?.find((c) => c.id === id)?.name ?? 'Misc';
const installedFor = (appId) => installed?.find((m) => m.uid === appId);

function icon(url, big = false) {
  return h('span', { class: `app-icon${big ? ' big' : ''}` }, url ? h('img', { src: url, alt: '', loading: 'lazy' }) : '▦');
}

function home() {
  const input = h('input', { placeholder: 'search apps…', value: search, autocapitalize: 'off', autocomplete: 'off', enterkeyhint: 'search' });
  const doSearch = () => {
    search = input.value.trim();
    if (search) go({ type: 'list', search, title: `"${search}"` });
  };
  input.onkeydown = (e) => e.key === 'Enter' && doSearch();
  return h(
    'div',
    {},
    !sdk && h('p', { class: 'tip' }, "Couldn't read your firmware's app version, so some apps may not run."),
    h('div', { class: 'row', style: 'margin-bottom:10px' }, input, h('button', { onclick: doSearch }, '⌕')),
    h(
      'div',
      { class: 'cards', style: 'margin-bottom:10px' },
      h('div', { class: 'card-item', role: 'button', onclick: () => go({ type: 'installed' }) },
        h('span', { class: 'card-icon' }, '✓'), h('span', { class: 'card-name' }, 'installed'), h('span', { class: 'card-sub muted' }, `${installed.length} apps · check updates`)),
      h('div', { class: 'card-item', role: 'button', onclick: () => go({ type: 'list', title: 'newest updates' }) },
        h('span', { class: 'card-icon' }, '★'), h('span', { class: 'card-name' }, 'recently updated'), h('span', { class: 'card-sub muted' }, 'all categories')),
    ),
    h('h2', {}, 'categories'),
    h(
      'div',
      { class: 'cards' },
      categories.map((c) =>
        h('div', { class: 'card-item', role: 'button', onclick: () => go({ type: 'list', categoryId: c.id, title: c.name }) },
          h('span', { class: 'card-icon' }, c.icon ? h('img', { src: c.icon, alt: '', class: 'cat-icon' }) : '▦'),
          h('span', { class: 'card-name' }, c.name),
          h('span', { class: 'card-sub muted' }, `${c.count} apps`)),
      ),
    ),
    h('p', { class: 'muted', style: 'margin-top:14px' }, `Apps from the official Flipper catalog${sdk ? `, built for your firmware (API ${sdk.api})` : ''}.`),
  );
}

function appRow(a) {
  const mine = installedFor(a.id);
  const tag = mine ? (mine.versionUid !== a.versionId ? 'update' : 'installed') : '';
  return h(
    'div',
    { class: 'app-row', role: 'button', onclick: () => go({ type: 'app', id: a.id }) },
    icon(a.icon),
    h('div', { class: 'app-text' }, h('div', { class: 'app-name' }, a.name, tag && h('span', { class: `app-tag ${tag}` }, tag)), h('div', { class: 'muted app-short' }, a.short)),
  );
}

function appList(top) {
  const root = h('div');
  const list = h('div');
  const more = h('button', { style: 'width:100%;margin-top:10px', hidden: true }, 'load more');
  let offset = 0;
  const load = async () => {
    more.disabled = true;
    more.textContent = 'loading…';
    try {
      const page = await listApps(http, sdk, { categoryId: top.categoryId, search: top.search, offset, limit: PAGE, sort: top.search ? 'name' : 'updated_at' });
      offset += page.length;
      list.append(...page.map(appRow));
      if (!offset) list.append(h('p', { class: 'muted' }, 'no apps found'));
      more.hidden = page.length < PAGE;
    } catch (e) {
      showError(e);
    }
    more.disabled = false;
    more.textContent = 'load more';
  };
  more.onclick = load;
  load();
  root.append(h('div', { class: 'muted', style: 'margin-bottom:8px' }, top.title), list, more);
  return root;
}

function appDetails(id) {
  const root = h('div', {}, h('p', { class: 'muted' }, 'loading…'));
  getApp(http, sdk, id)
    .then((app) => {
      const draw = () => root.replaceChildren(detailsBody(app, draw));
      draw();
    })
    .catch((e) => root.replaceChildren(h('p', { class: 'tip' }, `Couldn't load this app. (${e.message})`)));
  return root;
}

function detailsBody(app, redraw) {
  const mine = installedFor(app.id);
  const problem = statusProblem(app.status);
  const status = h('div', { class: 'muted', style: 'min-height:1.4em' }, busy === app.alias ? 'working…' : '');
  const run = async (fn) => {
    if (busy) return toast('Another app is installing, please wait.');
    busy = app.alias;
    redraw();
    try {
      await fn((text) => (status.textContent = text));
    } catch (e) {
      showError(e);
    }
    busy = null;
    redraw();
  };
  const install = () =>
    run(async (step) => {
      const m = await installApp(conn.flipper, sdk, app, categoryName(app.categoryId), { previous: mine, step });
      installed = [...installed.filter((x) => x.uid !== app.id), m];
      toast(mine ? `${app.name} updated` : `${app.name} installed`);
    });
  const remove = async () => {
    if (!(await confirmAction(`Remove ${app.name} from the Flipper?`, 'yes, remove it', true))) return;
    run(async () => {
      await uninstallApp(conn.flipper, mine);
      installed = installed.filter((x) => x.uid !== app.id);
      toast(`${app.name} removed`);
    });
  };
  const open = () =>
    run(async () => {
      await conn.flipper.startApp(mine.path);
      toast(`${app.name} opened on the Flipper`);
    });

  const working = busy === app.alias;
  const buttons = problem
    ? [h('p', { class: 'tip' }, problem)]
    : !mine
      ? [h('button', { class: 'primary', disabled: working, onclick: install }, '⇩ install')]
      : [
          mine.versionUid !== app.versionId && h('button', { class: 'primary', disabled: working, onclick: install }, `⇧ update to ${app.version}`),
          h('button', { disabled: working, onclick: open }, '▶ open on flipper'),
          h('button', { class: 'danger', disabled: working, onclick: remove }, 'remove'),
        ];
  return h(
    'div',
    {},
    h('div', { class: 'app-head' }, icon(app.icon, true), h('div', {}, h('div', { class: 'app-name big' }, app.name), h('div', { class: 'muted' }, `v${app.version} · ${categoryName(app.categoryId)}${mine ? ' · installed' : ''}`))),
    h('div', { class: 'app-buttons' }, buttons.filter(Boolean)),
    status,
    app.screenshots.length > 0 && h('div', { class: 'shots' }, app.screenshots.map((s) => h('img', { src: s, alt: 'screenshot', loading: 'lazy' }))),
    h('p', { style: 'white-space:pre-wrap' }, app.description || app.short),
    app.changelog && h('details', {}, h('summary', {}, "what's new"), h('p', { style: 'white-space:pre-wrap' }, app.changelog)),
    app.sourceUrl && h('p', { class: 'muted' }, 'source: ', h('a', { href: app.sourceUrl, target: '_blank', rel: 'noopener' }, app.sourceUrl.replace(/^https?:\/\//, ''))),
  );
}

function installedView() {
  const root = h('div', {}, h('p', { class: 'muted' }, 'checking for updates…'));
  const draw = (updates, appsById) => {
    root.replaceChildren(
      h('div', { class: 'muted', style: 'margin-bottom:8px' }, `installed from the catalog: ${installed.length}`),
      updates.length > 0 &&
        h('button', {
          class: 'primary',
          style: 'width:100%;margin-bottom:10px',
          onclick: () => updateAll(updates, root),
        }, `⇧ update all (${updates.length})`),
      installed.length === 0 && h('p', { class: 'muted' }, 'Nothing installed from the catalog yet.'),
      ...installed.map((m) => {
        const a = appsById.get(m.uid);
        return appRow(a ?? { id: m.uid, name: m.fullName, short: m.path, versionId: m.versionUid });
      }),
    );
  };
  (async () => {
    let apps = [];
    try {
      installed = await installedApps(conn.flipper);
      if (installed.length) apps = await listApps(http, sdk, { ids: installed.map((m) => m.uid), limit: 500 });
    } catch (e) {
      showError(e);
    }
    draw(findUpdates(installed, apps), new Map(apps.map((a) => [a.id, a])));
  })();
  return root;
}

async function updateAll(updates, root) {
  if (busy) return;
  busy = 'all';
  const status = h('p', { class: 'muted' });
  root.prepend(status);
  let done = 0;
  for (const { manifest, app } of updates) {
    if (statusProblem(app.status)) continue;
    try {
      const full = await getApp(http, sdk, app.id);
      await installApp(conn.flipper, sdk, full, categoryName(full.categoryId), {
        previous: manifest,
        step: (t) => (status.textContent = `${full.name}: ${t}`),
      });
      done++;
    } catch (e) {
      showError(e);
    }
  }
  busy = null;
  installed = null;
  toast(`${done} app${done === 1 ? '' : 's'} updated`);
  installed = await installedApps(conn.flipper).catch(() => []);
  rerender();
}

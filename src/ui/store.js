// App store: browse the Flipper app catalog, install / update / remove apps.
import { h, saveScroll, restoreScroll, toast, showError, confirmAction } from './dom.js';
import { conn } from '../connection.js';
import { http } from '../store/http.js';
import { sdkFromInfo, listCategories, listApps, getApp, findUpdates, statusProblem } from '../store/catalog.js';
import { installApp, installedApps, uninstallApp, fapsOnFlipper } from '../store/installer.js';
import { cached, cacheAge, writeCache } from '../store/cache.js';

const PAGE = 40;
let stack = []; // { type: 'list', categoryId, title } | { type: 'app', id } | { type: 'installed' }
let rerender = () => {};
let sdk; // undefined = not read yet, null = unknown firmware API
let categories = null;
let installed = null; // manifests on the Flipper
let onFlipper = new Map(); // alias -> .fap path, every app on the SD card
let prefetched = false;
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
  onFlipper = new Map();
}

export function storeBack() {
  if (!stack.length) return false;
  stack.pop();
  rerender();
  restoreScroll(scrollMemo[stack.length] ?? 0);
  return true;
}

const scrollMemo = []; // list position of each screen, to return to it on back

function go(next) {
  scrollMemo[stack.length] = saveScroll();
  stack.push(next);
  rerender();
  restoreScroll(0);
}

const sdkKey = () => (sdk ? `${sdk.target}-${sdk.api}` : 'any');
const listKey = (o) => `list:${sdkKey()}:${o.categoryId ?? ''}:${o.search ?? ''}:${o.sort}:${o.offset}`;

async function ensureBasics() {
  if (sdk === undefined) sdk = sdkFromInfo(await conn.flipper.deviceInfo());
  if (!categories) {
    await cached(`cats:${sdkKey()}`, () => listCategories(http, sdk), (c) => (categories = c), { maxAgeMs: 6 * 3600 * 1000 });
  }
  if (!installed) {
    installed = await installedApps(conn.flipper);
    onFlipper = await fapsOnFlipper(conn.flipper).catch(() => new Map());
  }
  if (!prefetched) {
    prefetched = true;
    prefetchLists(); // in the background
  }
}

/** Quietly saves the first page of every category so they open instantly. */
async function prefetchLists() {
  const jobs = [{ sort: 'updated_at' }, ...categories.map((c) => ({ categoryId: c.id, sort: 'updated_at' }))];
  for (const j of jobs) {
    const o = { ...j, offset: 0 };
    if (cacheAge(listKey(o)) < 3600 * 1000) continue;
    try {
      writeCache(listKey(o), await listApps(http, sdk, { ...o, limit: PAGE }));
    } catch {
      return; // offline or catalog trouble: try again next time
    }
  }
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
    queueBanner(),
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
        h('div', { class: 'card-item', role: 'button', onclick: () => go({ type: 'list', categoryId: c.id, title: c.name, fromCategory: true }) },
          h('span', { class: 'card-icon' }, c.icon ? h('img', { src: c.icon, alt: '', class: 'cat-icon' }) : '▦'),
          h('span', { class: 'card-name' }, c.name),
          h('span', { class: 'card-sub muted' }, `${c.count} apps`)),
      ),
    ),
    h('p', { class: 'muted', style: 'margin-top:14px' }, `Apps from the official Flipper catalog${sdk ? `, built for your firmware (API ${sdk.api})` : ''}.`),
  );
}

function appRow(a, { showCategory = false } = {}) {
  const mine = installedFor(a.id);
  const tag = mine ? (mine.versionUid !== a.versionId ? 'update' : 'installed') : onFlipper.has(a.alias) ? 'on flipper' : '';
  const cat = showCategory && a.categoryId && categories?.find((c) => c.id === a.categoryId)?.name;
  return h(
    'div',
    { class: 'app-row', role: 'button', onclick: () => go({ type: 'app', id: a.id }) },
    icon(a.icon),
    h('div', { class: 'app-text' }, h('div', { class: 'app-name' }, a.name, tag && h('span', { class: `app-tag ${tag.replace(' ', '-')}` }, tag), cat && h('span', { class: 'app-tag cat' }, cat)), h('div', { class: 'muted app-short' }, a.short)),
  );
}

/** Dropdown to show only one category. */
function categoryPicker(selected, onPick, only) {
  const sel = h(
    'select',
    { class: 'cat-picker', onchange: () => onPick(sel.value) },
    h('option', { value: '' }, 'all categories'),
    categories.filter((c) => !only || only.has(c.id)).map((c) => h('option', { value: c.id, selected: c.id === selected }, c.name)),
  );
  return sel;
}

function appList(top) {
  const root = h('div');
  const list = h('div', {}, h('p', { class: 'muted' }, 'loading…'));
  const more = h('button', { style: 'width:100%;margin-top:10px', hidden: true }, 'load more');
  const sort = top.search ? 'name' : 'updated_at';
  const pages = []; // pages[i] = apps on page i
  const draw = () => {
    const all = pages.flat();
    const showCategory = !top.categoryId;
    list.replaceChildren(...(all.length ? all.map((a) => appRow(a, { showCategory })) : [h('p', { class: 'muted' }, 'no apps found')]));
    more.hidden = (pages[pages.length - 1]?.length ?? 0) < PAGE;
  };
  const load = async (i) => {
    more.disabled = true;
    more.textContent = 'loading…';
    const o = { categoryId: top.categoryId, search: top.search, sort, offset: i * PAGE };
    try {
      await cached(listKey(o), () => listApps(http, sdk, { ...o, limit: PAGE }), (apps) => {
        pages[i] = apps;
        draw();
      });
    } catch (e) {
      showError(e);
      if (!pages.length) list.replaceChildren(h('p', { class: 'muted' }, "Couldn't load the list. Check your internet connection."));
    }
    more.disabled = false;
    more.textContent = 'load more';
  };
  more.onclick = async () => {
    await load(pages.length);
    top.pages = pages.length; // so going back shows the same pages
  };
  (async () => {
    for (let i = 0; i < (top.pages || 1); i++) await load(i);
  })();
  const picker = categoryPicker(top.categoryId, (id) => {
    stack[stack.length - 1] = { ...top, categoryId: id || undefined };
    rerender();
  });
  root.append(h('div', { class: 'row', style: 'margin-bottom:8px' }, h('span', { class: 'muted' }, top.title), top.fromCategory ? null : picker), queueBanner(), list, more);
  return root;
}

function appDetails(id) {
  const root = h('div', {}, h('p', { class: 'muted' }, 'loading…'));
  cached(`app:${sdkKey()}:${id}`, () => getApp(http, sdk, id), (app) => {
    const draw = () => root.replaceChildren(detailsBody(app, draw));
    draw();
  }, { maxAgeMs: 0 }).catch((e) => root.replaceChildren(h('p', { class: 'tip' }, `Couldn't load this app. (${e.message})`)));
  return root;
}

function detailsBody(app, redraw) {
  const mine = installedFor(app.id);
  const problem = statusProblem(app.status);
  const status = h('div', { class: 'muted', style: 'min-height:1.4em' }, busy === app.alias ? 'working…' : '');
  const run = async (fn) => {
    if (busy || updateQueue.running) return toast('Another app is installing, please wait.');
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
      onFlipper.set(app.alias, m.path);
      toast(mine ? `${app.name} updated` : `${app.name} installed`);
    });
  const remove = async () => {
    if (!(await confirmAction(`Remove ${app.name} from the Flipper?`, 'yes, remove it', true))) return;
    run(async () => {
      await uninstallApp(conn.flipper, mine);
      installed = installed.filter((x) => x.uid !== app.id);
      onFlipper.delete(app.alias);
      toast(`${app.name} removed`);
    });
  };
  const bundledPath = !mine ? onFlipper.get(app.alias) : null;
  const open = () =>
    run(async () => {
      await conn.flipper.startApp(mine?.path ?? bundledPath);
      toast(`${app.name} opened on the Flipper`);
    });

  const working = busy === app.alias;
  const buttons = problem
    ? [h('p', { class: 'tip' }, problem)]
    : !mine
      ? [
          h('button', { class: 'primary', disabled: working, onclick: install }, bundledPath ? '⇩ install catalog version' : '⇩ install'),
          bundledPath && h('button', { disabled: working, onclick: open }, '▶ open on flipper'),
        ]
      : [
          mine.versionUid !== app.versionId && h('button', { class: 'primary', disabled: working, onclick: install }, `⇧ update to ${app.version}`),
          h('button', { disabled: working, onclick: open }, '▶ open on flipper'),
          h('button', { class: 'danger', disabled: working, onclick: remove }, 'remove'),
        ];
  return h(
    'div',
    {},
    h('div', { class: 'app-head' }, icon(app.icon, true), h('div', {}, h('div', { class: 'app-name big' }, app.name), h('div', { class: 'muted' }, `v${app.version} · ${categoryName(app.categoryId)}${mine ? ' · installed' : bundledPath ? ' · already on your flipper' : ''}`))),
    h('div', { class: 'app-buttons' }, buttons.filter(Boolean)),
    status,
    app.screenshots.length > 0 && h('div', { class: 'shots' }, app.screenshots.map((s) => h('img', { src: s, alt: 'screenshot', loading: 'lazy' }))),
    h('p', { style: 'white-space:pre-wrap' }, app.description || app.short),
    app.changelog && h('details', {}, h('summary', {}, "what's new"), h('p', { style: 'white-space:pre-wrap' }, app.changelog)),
    app.sourceUrl && h('p', { class: 'muted' }, 'source: ', h('a', { href: app.sourceUrl, target: '_blank', rel: 'noopener' }, app.sourceUrl.replace(/^https?:\/\//, ''))),
  );
}

let installedFilter = { categoryId: '', updatesOnly: false };
let catalogInfo = new Map(); // uid -> catalog app, for installed apps

function installedView() {
  const root = h('div');
  const draw = (checking) => {
    const updates = findUpdates(installed, [...catalogInfo.values()]);
    if (!checking && updates.length === 0) installedFilter.updatesOnly = false; // nothing left to filter for
    const updatable = new Set(updates.map((u) => u.manifest.uid));
    const cats = new Set([...catalogInfo.values()].map((a) => a.categoryId));
    const shown = installed.filter((m) => {
      const a = catalogInfo.get(m.uid);
      if (installedFilter.updatesOnly && !updatable.has(m.uid)) return false;
      if (installedFilter.categoryId && a?.categoryId !== installedFilter.categoryId) return false;
      return true;
    });
    const toggle = h('button', {
      class: installedFilter.updatesOnly ? 'primary' : '',
      onclick: () => {
        installedFilter = { ...installedFilter, updatesOnly: !installedFilter.updatesOnly };
        draw(checking);
      },
    }, `updates ready (${updates.length})`);
    const picker = categoryPicker(installedFilter.categoryId, (id) => {
      installedFilter = { ...installedFilter, categoryId: id };
      draw(checking);
    }, cats);
    root.replaceChildren(
      ...[
        h('div', { class: 'muted', style: 'margin-bottom:8px' }, `installed from the catalog: ${installed.length}${checking ? ' · checking for updates…' : ''}`),
        h('div', { class: 'row', style: 'margin-bottom:10px;flex-wrap:wrap' }, toggle, picker),
        queueBanner(),
        updates.length > 0 && !updateQueue.running &&
          h('button', { class: 'primary', style: 'width:100%;margin-bottom:10px', onclick: () => startUpdates(updates) }, `⇧ update all (${updates.length})`),
        installed.length === 0 && h('p', { class: 'muted' }, 'Nothing installed from the catalog yet.'),
        installed.length > 0 && shown.length === 0 && h('p', { class: 'muted' }, 'Nothing matches this filter.'),
        ...shown.map((m) => appRow(catalogInfo.get(m.uid) ?? { id: m.uid, name: m.fullName, short: m.path, versionId: m.versionUid }, { showCategory: true })),
      ].filter(Boolean),
    );
  };
  draw(true);
  (async () => {
    try {
      installed = await installedApps(conn.flipper);
      draw(true);
      if (installed.length) {
        await cached(`installed:${sdkKey()}:${installed.map((m) => m.uid).sort().join(',')}`,
          () => listApps(http, sdk, { ids: installed.map((m) => m.uid), limit: 500 }),
          (apps) => {
            catalogInfo = new Map(apps.map((a) => [a.id, a]));
            draw(true);
          }, { maxAgeMs: 0 });
      }
    } catch (e) {
      showError(e);
    }
    if (root.isConnected) draw(false);
  })();
  return root;
}

// ---------- updates that keep running while you browse ----------

const updateQueue = { running: false, items: [], index: 0, done: 0, failed: [], text: '' };
const banners = new Set(); // banner elements currently on screen

function queueBanner() {
  if (!updateQueue.running) return null;
  const el = h('div', { class: 'tip queue-banner' });
  banners.add(el);
  paintBanners();
  return el;
}

function paintBanners() {
  const q = updateQueue;
  for (const el of [...banners]) {
    if (!el.isConnected && el.dataset.painted) {
      banners.delete(el);
      continue;
    }
    el.dataset.painted = '1';
    el.textContent = `updating ${Math.min(q.index + 1, q.items.length)} of ${q.items.length}: ${q.text}`;
  }
}

function startUpdates(updates) {
  if (updateQueue.running) return;
  Object.assign(updateQueue, { running: true, items: updates, index: 0, done: 0, failed: [], text: 'starting…' });
  rerender();
  (async () => {
    for (let i = 0; i < updates.length; i++) {
      const { manifest, app } = updates[i];
      updateQueue.index = i;
      updateQueue.text = app.name;
      paintBanners();
      try {
        if (statusProblem(app.status)) throw new Error(statusProblem(app.status));
        const full = await getApp(http, sdk, app.id);
        const m = await installApp(conn.flipper, sdk, full, categoryName(full.categoryId), {
          previous: manifest,
          step: (t) => {
            updateQueue.text = `${full.name}: ${t}`;
            paintBanners();
          },
        });
        installed = [...installed.filter((x) => x.uid !== m.uid), m];
        updateQueue.done++;
      } catch (e) {
        updateQueue.failed.push(`${app.name} (${e.message})`);
        if (conn.state !== 'online') break; // Flipper gone: stop
      }
    }
    const { done, failed } = updateQueue;
    updateQueue.running = false;
    banners.clear();
    toast(
      `${done} app${done === 1 ? '' : 's'} updated${failed.length ? `. Not updated: ${failed.join(', ')}` : ''}`,
      { error: failed.length > 0, ms: failed.length ? 8000 : 3500 },
    );
    rerender();
  })();
}

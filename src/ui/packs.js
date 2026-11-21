// Asset packs: browse Momentum packs, look inside (animations + icons), install.
import { h, toast, showError, confirmAction, saveScroll, restoreScroll, moreButton } from './dom.js';
import { conn } from '../connection.js';
import { cached } from '../store/cache.js';
import { remember, recall } from '../flipper/mirror.js';
import { PACKS_URL, expandPacks, packContents, framesOf, readArchive, installPack, installedPacks, removePack, readInstalledPack, packThumbFrame } from '../assets/packs.js';

let stack = []; // { type: 'pack', key } | { type: 'inside', key } | { type: 'local', pack } | { type: 'flipper', name }
const scrollMemo = [];
let rerender = () => {};
let packs = null;
let onFlipper = null; // folder names in /ext/asset_packs
const downloaded = new Map(); // key -> pack contents
const thumbs = new Map(); // installed pack name -> Promise<frame|null>
let busy = null;

export function openPacks() {
  stack = [];
}
export function resetPacks() {
  stack = [];
  onFlipper = null;
}
export function packsBack() {
  if (!stack.length) return false;
  stack.pop();
  rerender();
  restoreScroll(scrollMemo[stack.length] ?? 0);
  return true;
}
function go(next) {
  scrollMemo[stack.length] = saveScroll();
  stack.push(next);
  rerender();
  restoreScroll(0);
}

export function packsView(rerenderTab) {
  rerender = rerenderTab;
  const root = h('div', {}, h('p', { class: 'muted' }, 'loading asset packs…'));
  (async () => {
    if (!packs) {
      await cached('packs', async () => {
        const res = await fetch(PACKS_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        return res.json();
      }, (index) => {
        packs = expandPacks(index);
        if (root.isConnected) rerender();
      }, { maxAgeMs: 6 * 3600 * 1000 });
    }
    if (!onFlipper && conn.state === 'online') {
      const saved = recall('packs');
      const fresh = installedPacks(conn.flipper).then((list) => {
        const changed = JSON.stringify(list) !== JSON.stringify(onFlipper);
        onFlipper = list;
        remember('packs', list);
        if (changed && saved && root.isConnected) rerender();
      });
      if (saved) onFlipper = saved; // show last known list now, check quietly
      else await fresh;
    }
    onFlipper ??= [];
    const top = stack[stack.length - 1];
    root.replaceChildren(
      !top
        ? home()
        : top.type === 'pack'
          ? packPage(packs.find((p) => p.key === top.key))
          : top.type === 'inside'
            ? insidePage(top.key)
            : top.type === 'flipper'
              ? flipperPage(top.name)
              : localPage(top.pack),
    );
  })().catch((e) => root.replaceChildren(h('p', { class: 'tip' }, `Couldn't load asset packs. Check your internet connection. (${e.message})`), h('button', { onclick: rerender }, 'try again')));
  return root;
}

// ---------- drawing Flipper images ----------

/** A canvas that plays 1-bit frames (orange screen, dark pixels), like the Flipper. */
export function pixelCanvas(frames, fps = 4, scale = 3) {
  const { width, height } = frames[0];
  const c = h('canvas', { width: width * scale, height: height * scale, class: 'pixel-canvas' });
  const ctx = c.getContext('2d');
  let i = 0;
  const draw = () => {
    const f = frames[i % frames.length];
    ctx.fillStyle = '#ff8200';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) if (f.pixels[y * f.width + x]) ctx.fillRect(x * scale, y * scale, scale, scale);
  };
  draw();
  if (frames.length > 1) {
    const timer = setInterval(() => {
      if (!c.isConnected && i > 0) return clearInterval(timer);
      if (document.hidden || !c.isConnected) return; // don't animate off screen
      i++;
      draw();
    }, 1000 / Math.max(1, Math.min(fps, 30)));
  }
  return c;
}

// ---------- screens ----------

const isOnFlipper = (name) => onFlipper?.includes(name);
const folderName = (p) => p.folder ?? null; // known after download

function home() {
  const fileInput = h('input', { type: 'file', accept: '.zip,.tar.gz,.tgz,.tar,application/zip,application/gzip', hidden: true });
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const pack = packContents(await readArchive(new Uint8Array(await file.arrayBuffer())));
      go({ type: 'local', pack });
    } catch (e) {
      showError(e);
    }
  };
  return h(
    'div',
    {},
    h('p', { class: 'muted' }, 'Custom animations, passport pictures and icons for Momentum. After installing, pick the pack on the Flipper in Momentum settings › Interface › Graphics.'),
    h('button', { style: 'width:100%;margin-bottom:12px', onclick: () => fileInput.click() }, '⇪ install a pack from a file (.zip / .tar.gz)'),
    fileInput,
    onFlipper?.length > 0 &&
      h('div', {}, h('h2', {}, 'on your flipper'), h('div', { class: 'cards' }, onFlipper.map((n) => installedCard(n)))),
    h('h2', {}, `browse (${packs.length})`),
    h(
      'div',
      { class: 'cards' },
      packs.map((p) =>
        h(
          'div',
          { class: 'card-item pack-card', role: 'button', onclick: () => go({ type: 'pack', key: p.key }) },
          p.previewUrls[0] && h('img', { src: p.previewUrls[0], alt: '', loading: 'lazy', class: 'pack-thumb' }),
          h('span', { class: 'card-name' }, p.name),
          h('span', { class: 'card-sub muted' }, p.author ? `by ${p.author}` : p.source),
        ),
      ),
    ),
  );
}

/** Small picture of an installed pack (its first animation), read once and kept on the phone. */
function installedThumb(name) {
  const slot = h('div', { class: 'pack-thumb' });
  if (!thumbs.has(name)) thumbs.set(name, packThumbFrame(conn.flipper, name).catch(() => null));
  thumbs.get(name).then((frame) => {
    if (frame) slot.replaceChildren(pixelCanvas([frame], 1, 1));
    else slot.textContent = '✓';
  });
  return slot;
}

function installedCard(name) {
  return h(
    'div',
    { class: 'card-item pack-card', role: 'button', onclick: () => go({ type: 'flipper', name }) },
    installedThumb(name),
    h('span', { class: 'card-name' }, name),
    h('span', { class: 'card-sub muted' }, 'tap to look inside'),
    moreButton(name, [
      { label: '🔍 look inside', run: () => go({ type: 'flipper', name }) },
      {
        label: 'remove from flipper…',
        danger: true,
        run: async () => {
          if (!(await confirmAction(`Remove the "${name}" pack from the Flipper?`, 'yes, remove it', true))) return;
          try {
            await removePack(conn.flipper, name);
            downloaded.delete(`flipper/${name}`);
            onFlipper = onFlipper.filter((n) => n !== name);
            remember('packs', onFlipper);
            thumbs.delete(name);
            toast('pack removed');
            rerender();
          } catch (e) {
            showError(e);
          }
        },
      },
    ]),
  );
}

async function getContents(p) {
  if (!downloaded.has(p.key)) {
    const res = await fetch(p.downloadUrl);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    downloaded.set(p.key, packContents(await readArchive(new Uint8Array(await res.arrayBuffer()))));
  }
  const c = downloaded.get(p.key);
  p.folder = c.name;
  return c;
}

function installButtons(getPack, label) {
  const status = h('div', { class: 'muted', style: 'min-height:1.4em' });
  const btn = h('button', { class: 'primary' }, label);
  btn.onclick = async () => {
    if (conn.state !== 'online') return showError(new Error('Connect your Flipper first (device tab).'));
    if (busy) return toast('Another pack is installing, please wait.');
    busy = true;
    btn.disabled = true;
    try {
      status.textContent = 'downloading…';
      const pack = await getPack();
      await installPack(conn.flipper, pack, { step: (t) => (status.textContent = t) });
      downloaded.delete(`flipper/${pack.name}`);
      onFlipper = [...new Set([...(onFlipper ?? []), pack.name])].sort();
      remember('packs', onFlipper);
      thumbs.delete(pack.name);
      status.textContent = '';
      toast(`Installed! On the Flipper: Momentum settings › Interface › Graphics › ${pack.name}`, { ms: 7000 });
      rerender();
    } catch (e) {
      status.textContent = '';
      showError(e);
    }
    busy = null;
    btn.disabled = false;
  };
  return [btn, status];
}

function packPage(p) {
  if (!p) return h('p', { class: 'muted' }, 'Pack not found.');
  const installed = folderName(p) && isOnFlipper(folderName(p));
  const [btn, status] = installButtons(() => getContents(p), installed ? '⟳ reinstall' : '⇩ install on flipper');
  return h(
    'div',
    {},
    h('div', { class: 'app-name big' }, p.name, installed && h('span', { class: 'app-tag installed' }, 'installed')),
    h('div', { class: 'muted', style: 'margin-bottom:10px' }, [p.author && `by ${p.author}`, p.source].filter(Boolean).join(' · ')),
    h('div', { class: 'app-buttons' }, btn, h('button', { onclick: () => go({ type: 'inside', key: p.key }) }, '🔍 look inside')),
    status,
    h('div', { class: 'pack-previews' }, p.previewUrls.map((u) => h('img', { src: u, alt: 'preview', loading: 'lazy' }))),
    p.description && h('p', { style: 'white-space:pre-wrap' }, p.description),
    p.sourceUrl && h('p', { class: 'muted' }, 'made by: ', h('a', { href: p.sourceUrl, target: '_blank', rel: 'noopener' }, p.sourceUrl.replace(/^https?:\/\//, '').slice(0, 60))),
  );
}

function insidePage(key) {
  const p = packs.find((x) => x.key === key);
  const root = h('div', {}, h('p', { class: 'muted' }, 'downloading the pack to look inside…'));
  getContents(p)
    .then((c) => root.replaceChildren(h('div', { class: 'app-name big', style: 'margin-bottom:8px' }, p.name), contentsView(c)))
    .catch((e) => root.replaceChildren(h('p', { class: 'tip' }, `Couldn't download it. (${e.message})`)));
  return root;
}

function flipperPage(name) {
  const key = `flipper/${name}`;
  const status = h('p', { class: 'muted' }, 'reading the pack from your flipper…');
  const root = h('div', {}, h('div', { class: 'app-name big' }, name, h('span', { class: 'app-tag installed' }, 'on flipper')), status);
  (async () => {
    if (!downloaded.has(key)) downloaded.set(key, await readInstalledPack(conn.flipper, name, { step: (t) => (status.textContent = t) }));
    status.textContent = 'Pick it on the Flipper in Momentum settings › Interface › Graphics.';
    root.append(contentsView(downloaded.get(key)));
  })().catch((e) => (status.textContent = `Couldn't read it. (${e.message})`));
  return root;
}

function localPage(pack) {
  const installed = isOnFlipper(pack.name);
  const [btn, status] = installButtons(async () => pack, installed ? '⟳ replace the one on the flipper' : '⇩ install on flipper');
  return h(
    'div',
    {},
    h('div', { class: 'app-name big' }, pack.name),
    h('div', { class: 'muted', style: 'margin-bottom:10px' }, `from your phone · ${pack.files.length} files`),
    h('div', { class: 'app-buttons' }, btn),
    status,
    contentsView(pack),
  );
}

/** Every animation (playing) and icon in a pack. */
function contentsView(c) {
  const safe = (item, scale) => {
    try {
      const frames = framesOf(item);
      return frames.length ? pixelCanvas(frames, item.fps, scale) : h('span', { class: 'muted' }, 'no frames');
    } catch (e) {
      return h('span', { class: 'muted' }, `can't show: ${e.message}`);
    }
  };
  return h(
    'div',
    {},
    h('h2', {}, `animations (${c.anims.length})`),
    c.anims.length === 0 && h('p', { class: 'muted' }, 'none'),
    ...c.anims.map((a) => h('div', { class: 'pack-item' }, safe(a, 2), h('div', { class: 'muted pack-label' }, a.name.replace(/_/g, ' ')))),
    h('h2', {}, `icons (${c.icons.length})`),
    c.icons.length === 0 && h('p', { class: 'muted' }, 'none'),
    h('div', { class: 'pack-icons' }, c.icons.map((i) => h('div', { class: 'pack-item' }, safe(i, 2), h('div', { class: 'muted pack-label' }, i.name.split('/').pop().replace(/_/g, ' '))))),
    c.fonts.length > 0 && h('p', { class: 'muted' }, `fonts: ${c.fonts.join(', ')}`),
  );
}

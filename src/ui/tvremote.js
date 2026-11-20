// Universal TV remote: pick a brand, get a full remote (OK, arrows, numbers, menu...).
// Codes come bundled with the app (Flipper-IRDB), so it works offline.
import { h, showError, toast } from './dom.js';
import { conn } from '../connection.js';
import { BUTTONS } from '../remote/buttons.js';
import { RemoteSender } from '../remote/sender.js';

const SAVED_KEY = 'oilrig.tvRemote';
const SCAN_GAP_MS = 900;

let brands = null; // loaded on first use (big table)
let sender = null;
let view = 'picker'; // 'picker' | 'remote' | 'scan'
let choice = loadChoice(); // { brand, set }
let search = '';
let rerender = () => {};

function loadChoice() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) || 'null');
  } catch {
    return null;
  }
}
function saveChoice() {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(choice));
  } catch {
    /* storage blocked */
  }
}

async function ensureBrands() {
  if (!brands) brands = (await import('../remote/tv-codes.js')).default;
  return brands;
}

function getSender() {
  if (!sender || sender.f !== conn.flipper) sender = new RemoteSender(conn.flipper);
  return sender;
}

/** Called when the remote tool is opened from the tools grid. */
export function openTvRemote() {
  view = choice ? 'remote' : 'picker';
}

/** Phone back button. Returns true if handled here. */
export function tvRemoteBack() {
  if (view === 'scan') {
    stopScan?.();
    view = 'picker';
    rerender();
    return true;
  }
  if (view === 'remote') {
    view = 'picker';
    rerender();
    return true;
  }
  return false;
}

/** Leaving the tool: close the Infrared app on the Flipper. */
export function closeTvRemote() {
  stopScan?.();
  sender?.close();
}

export function tvRemoteView(rerenderTab) {
  rerender = rerenderTab;
  const root = h('div', {}, h('p', { class: 'muted' }, 'loading codes…'));
  ensureBrands()
    .then(() => root.replaceChildren(view === 'remote' && choice ? remoteScreen() : view === 'scan' ? scanScreen() : pickerScreen()))
    .catch(showError);
  return root;
}

// ---------- brand picker ----------

function pickerScreen() {
  const list = h('div');
  const input = h('input', { placeholder: 'search brand…', value: search, autocapitalize: 'off', autocomplete: 'off' });
  const draw = () => {
    const q = search.trim().toLowerCase();
    list.replaceChildren(
      ...brands
        .filter((b) => !q || b.name.toLowerCase().includes(q))
        .map((b) =>
          h(
            'button',
            {
              class: `device${choice?.brand === b.name ? ' flipper' : ''}`,
              onclick: () => {
                choice = { brand: b.name, set: 0 };
                saveChoice();
                view = 'remote';
                rerender();
              },
            },
            h('span', { class: 'name' }, b.name),
            h('span', { class: 'muted' }, `${b.sets.length} code set${b.sets.length > 1 ? 's' : ''}`),
          ),
        ),
    );
  };
  input.oninput = () => {
    search = input.value;
    draw();
  };
  draw();
  return h(
    'div',
    {},
    h('h2', {}, 'tv brand'),
    h(
      'button',
      { class: 'primary', style: 'width:100%;margin-bottom:12px', onclick: () => ((view = 'scan'), rerender()) },
      "don't know the brand? find it",
    ),
    input,
    h('div', { style: 'margin-top:10px' }, list),
  );
}

// ---------- the remote ----------

function currentSet() {
  const brand = brands.find((b) => b.name === choice.brand) ?? brands[0];
  const setIndex = Math.min(choice.set ?? 0, brand.sets.length - 1);
  return { brand, setIndex, set: brand.sets[setIndex] };
}

function remoteScreen() {
  const { brand, setIndex, set } = currentSet();
  const status = h('div', { class: 'signal-status muted' }, 'point the Flipper at the TV');
  const entries = Object.entries(set.keys).map(([name, code]) => ({ name, code }));

  let ready = null;
  const prepare = () => (ready ??= getSender().load(entries));
  let chain = Promise.resolve();

  const press = (id, el) => {
    if (!set.keys[id]) return;
    el.classList.add('pressed');
    navigator.vibrate?.(15);
    status.textContent = `sending ${id.replace(/^n/, '')}…`;
    status.className = 'signal-status busy';
    chain = chain
      .then(prepare)
      .then(() => getSender().send(id))
      .then(() => {
        status.textContent = `sent ${BUTTONS.find((b) => b.id === id).title}`;
        status.className = 'signal-status ok';
      })
      .catch((e) => {
        ready = null;
        status.textContent = 'send failed';
        status.className = 'signal-status bad';
        showError(e);
      })
      .finally(() => el.classList.remove('pressed'));
  };

  const btn = (id, cls = '') => {
    const def = BUTTONS.find((b) => b.id === id);
    const has = Boolean(set.keys[id]);
    const el = h('button', { class: `rb ${cls} rb-${id}`, disabled: !has, title: def.title, 'aria-label': def.title }, def.label);
    el.onclick = () => press(id, el);
    return el;
  };

  const switchSet = (delta) => {
    choice.set = (setIndex + delta + brand.sets.length) % brand.sets.length;
    saveChoice();
    rerender();
  };

  return h(
    'div',
    { class: 'tvr' },
    h(
      'div',
      { class: 'row' },
      h('button', { onclick: () => ((view = 'picker'), rerender()) }, `${brand.name} ▾`),
      h('span', { class: 'grow' }),
      brand.sets.length > 1 && h('button', { onclick: () => switchSet(-1) }, '‹'),
      brand.sets.length > 1 && h('span', { class: 'muted' }, `codes ${setIndex + 1}/${brand.sets.length}`),
      brand.sets.length > 1 && h('button', { onclick: () => switchSet(1) }, '›'),
    ),
    status,
    h('div', { class: 'rrow' }, btn('power', 'power'), btn('source'), btn('mute')),
    h(
      'div',
      { class: 'dpad' },
      h('span'), btn('up'), h('span'),
      btn('left'), btn('ok', 'okb'), btn('right'),
      h('span'), btn('down'), h('span'),
    ),
    h('div', { class: 'rrow' }, btn('back'), btn('home'), btn('menu'), btn('exit')),
    h(
      'div',
      { class: 'rockers' },
      h('div', { class: 'rocker' }, btn('vol_up'), h('span', { class: 'muted' }, 'VOL'), btn('vol_dn')),
      h('div', { class: 'rrow col' }, btn('info'), btn('guide'), btn('list')),
      h('div', { class: 'rocker' }, btn('ch_up'), h('span', { class: 'muted' }, 'CH'), btn('ch_dn')),
    ),
    h('div', { class: 'numpad' }, ...'123456789'.split('').map((d) => btn(`n${d}`)), btn('prev_ch'), btn('n0'), btn('subtitle')),
    h('div', { class: 'rrow' }, btn('rew'), btn('play'), btn('pause'), btn('stop'), btn('ff')),
    h('div', { class: 'rrow' }, btn('red', 'c-red'), btn('green', 'c-green'), btn('yellow', 'c-yellow'), btn('blue', 'c-blue')),
    h('div', { class: 'rrow' }, btn('netflix', 'app'), btn('youtube', 'app'), btn('prime', 'app')),
    h(
      'p',
      { class: 'muted', style: 'font-size:12px;text-align:center' },
      `Greyed-out buttons aren't in this code set. If the TV doesn't react, try the next code set (‹ ›). Codes: ${set.from}.`,
    ),
  );
}

// ---------- find my brand ----------

let stopScan = null;

function scanScreen() {
  const keyOptions = ['power', 'mute', 'vol_up', 'ok', 'menu'];
  let key = 'power';
  const status = h('p', {}, 'Point the Flipper at the TV, pick a button and press start.');
  const current = h('div', { class: 'scan-current' }, '—');
  const startBtn = h('button', { class: 'primary' }, '▶ start');
  const workedBtn = h('button', { class: 'hold-send', disabled: true }, 'it reacted!');
  const keyRow = h(
    'div',
    { class: 'row wrap' },
    keyOptions.map((k) =>
      h(
        'button',
        {
          class: k === key ? 'primary' : '',
          onclick: (e) => {
            key = k;
            keyRow.querySelectorAll('button').forEach((b) => b.classList.toggle('primary', b === e.target));
          },
        },
        BUTTONS.find((b) => b.id === k).title,
      ),
    ),
  );

  let candidates = [];
  let pos = 0;
  let running = false;

  stopScan = () => {
    running = false;
    startBtn.textContent = pos > 0 && pos < candidates.length ? '▶ continue' : '▶ start';
  };

  const run = async () => {
    if (running) return stopScan();
    if (!candidates.length || candidates.key !== key) {
      candidates = [];
      for (const b of brands) b.sets.forEach((s, i) => s.keys[key] && candidates.push({ brand: b.name, set: i, code: s.keys[key] }));
      candidates.key = key;
      pos = 0;
      // One file with this button for every brand, uploaded once
      await getSender().load(candidates.map((c, i) => ({ name: `${key}_${i}`, code: c.code })));
    }
    running = true;
    startBtn.textContent = '❚❚ pause';
    workedBtn.disabled = false;
    while (running && pos < candidates.length) {
      const c = candidates[pos];
      current.textContent = `${c.brand} · codes ${c.set + 1}`;
      status.textContent = `trying ${pos + 1} of ${candidates.length}`;
      try {
        await getSender().sendIndex(pos);
      } catch (e) {
        showError(e);
        stopScan();
        return;
      }
      pos++;
      await new Promise((r) => setTimeout(r, SCAN_GAP_MS));
    }
    if (pos >= candidates.length) {
      status.textContent = 'Tried every code. Try another button, or move closer to the TV.';
      pos = 0;
    }
    stopScan();
  };

  startBtn.onclick = () => run().catch((e) => (showError(e), stopScan()));
  workedBtn.onclick = () => {
    stopScan();
    // The code that worked is the one just sent (or the one before, if the TV was slow).
    const hit = candidates[Math.max(0, pos - 1)];
    if (!hit) return;
    choice = { brand: hit.brand, set: hit.set };
    saveChoice();
    toast(`Found it: ${hit.brand}. If buttons don't work, try the code set before it.`, { ms: 6000 });
    view = 'remote';
    rerender();
  };

  return h(
    'div',
    {},
    h('h2', {}, 'find my tv brand'),
    status,
    h('p', { class: 'muted', style: 'font-size:12px' }, 'button to try:'),
    keyRow,
    current,
    h('div', { class: 'row' }, startBtn),
    workedBtn,
  );
}


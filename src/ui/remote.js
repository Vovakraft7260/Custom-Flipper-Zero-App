// Remote tab: live Flipper screen + buttons. Hold a button for a long press.
import { h, showError, toast, sheet, ask } from './dom.js';
import { conn } from '../connection.js';
import { decodeFrame, isVertical, SCREEN_W, SCREEN_H } from '../flipper/screen.js';

const LONG_PRESS_MS = 500;
const KEY_ICON = { UP: '▲', DOWN: '▼', LEFT: '◀', RIGHT: '▶', OK: '●', BACK: '↩' };

// Built-in apps (names as the Flipper knows them). "Bad USB" also finds Momentum's "Bad KB".
const BUILTIN_APPS = [
  'Sub-GHz', '125 kHz RFID', 'NFC', 'Infrared', 'iButton', 'Bad USB', 'GPIO', 'U2F',
  'Sub-GHz Remote', 'Clock', 'Snake Game', 'Archive',
].map((name) => ({ label: name, name }));
const DEFAULT_QUICK = ['Sub-GHz', '125 kHz RFID', 'NFC', 'Infrared', 'iButton', 'Bad USB'].map((name) => ({ label: name, name }));
const QUICK_KEY = 'oilrig.quickApps';

function loadQuick() {
  try {
    const v = JSON.parse(localStorage.getItem(QUICK_KEY) || 'null');
    if (Array.isArray(v)) return v;
  } catch {
    /* storage blocked */
  }
  return DEFAULT_QUICK;
}
function saveQuick(list) {
  try {
    localStorage.setItem(QUICK_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: list only lasts this session */
  }
}

let stopCurrent = null;

/** Stop streaming (called when leaving the tab). */
export async function stopRemote() {
  const s = stopCurrent;
  stopCurrent = null;
  await s?.();
}

export function remoteView(rerender) {
  if (conn.state !== 'online') {
    return h('div', {}, h('h2', {}, 'remote'), h('p', { class: 'muted' }, 'Connect your Flipper on the device tab first.'));
  }
  const f = conn.flipper;
  const canvas = h('canvas', { class: 'screen', width: SCREEN_W, height: SCREEN_H });
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SCREEN_W, SCREEN_H);
  ctx.fillStyle = '#ff8200';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  const off = f.onScreenFrame((frame) => {
    if (!frame.data?.length) return;
    decodeFrame(frame.data, frame.orientation ?? 0, img.data);
    if (isVertical(frame.orientation ?? 0)) {
      // Rotate 90° so a Flipper held upright looks upright on the phone
      if (canvas.width !== SCREEN_H) {
        canvas.width = SCREEN_H;
        canvas.height = SCREEN_W;
        canvas.classList.add('vertical');
      }
      const tmp = new OffscreenCanvas(SCREEN_W, SCREEN_H);
      tmp.getContext('2d').putImageData(img, 0, 0);
      ctx.save();
      ctx.translate(SCREEN_H, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(tmp, 0, 0);
      ctx.restore();
    } else {
      if (canvas.width !== SCREEN_W) {
        canvas.width = SCREEN_W;
        canvas.height = SCREEN_H;
        canvas.classList.remove('vertical');
      }
      ctx.putImageData(img, 0, 0);
    }
  });

  f.startScreenStream().catch(showError);
  stopCurrent = async () => {
    off();
    try {
      await f.stopScreenStream();
    } catch {
      /* already disconnected */
    }
  };

  // ---- button queue: presses are sent one after another, in order, and shown on screen ----
  const queueRow = h('div', { class: 'input-queue', 'aria-live': 'polite' });
  let chain = Promise.resolve();
  const enqueue = (key, long) => {
    const chip = h('span', { class: `chip${long ? ' long' : ''}` }, KEY_ICON[key], long ? '⋯' : '');
    queueRow.append(chip);
    chain = chain
      .then(async () => {
        chip.classList.add('sending');
        await f.pressButton(key, long);
      })
      .catch(showError)
      .finally(() => {
        chip.classList.add('done');
        setTimeout(() => chip.remove(), 250);
      });
  };

  const btn = (label, key, cls = '') => {
    const b = h('button', { class: cls, 'aria-label': key.toLowerCase() }, label);
    let timer = null;
    let longSent = false;
    const down = (e) => {
      e.preventDefault();
      b.classList.add('pressed');
      longSent = false;
      timer = setTimeout(() => {
        longSent = true;
        enqueue(key, true);
        navigator.vibrate?.(30);
      }, LONG_PRESS_MS);
    };
    const up = (e) => {
      e.preventDefault();
      b.classList.remove('pressed');
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      if (!longSent) {
        enqueue(key, false);
        navigator.vibrate?.(10);
      }
    };
    const cancel = () => {
      b.classList.remove('pressed');
      clearTimeout(timer);
      timer = null;
    };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', cancel);
    b.addEventListener('pointercancel', cancel);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  };

  const quick = loadQuick();
  const blank = () => h('span');
  return h(
    'div',
    {},
    h('div', { class: 'screen-wrap' }, canvas),
    queueRow,
    h(
      'div',
      { class: 'pad' },
      blank(), btn('▲', 'UP'), blank(),
      btn('◀', 'LEFT'), btn('●', 'OK', 'ok'), btn('▶', 'RIGHT'),
      blank(), btn('▼', 'DOWN'), blank(),
    ),
    h('div', { class: 'pad-extra' }, btn('↩ back', 'BACK')),
    h('p', { class: 'muted', style: 'text-align:center;font-size:12px' }, 'tap = press · hold = long press'),
    h(
      'div',
      { class: 'row' },
      h('h2', { class: 'grow' }, 'quick launch'),
      h('button', { onclick: () => editQuick(quick).then((changed) => changed && rerender()) }, '✎ edit'),
    ),
    quick.length === 0 && h('p', { class: 'muted' }, 'No apps picked. Tap edit to add some.'),
    h(
      'div',
      { class: 'row wrap' },
      quick.map((app) =>
        h(
          'button',
          {
            onclick: () =>
              f
                .startApp(app.name)
                .then(() => toast(`${app.label} started`))
                .catch(showError),
          },
          app.label,
        ),
      ),
    ),
  );
}

/** Lets the user pick built-in apps, installed .fap apps, or type a name. */
async function editQuick(current) {
  const chosen = new Map(current.map((a) => [a.name, a]));
  const listEl = h('div', { class: 'pick-list' });
  const options = [...BUILTIN_APPS];
  const draw = () => {
    const all = [...options, ...current.filter((a) => !options.some((o) => o.name === a.name))];
    listEl.replaceChildren(
      ...all.map((app) =>
        h(
          'label',
          { class: 'pick' },
          h('input', {
            type: 'checkbox',
            checked: chosen.has(app.name),
            onchange: (e) => (e.target.checked ? chosen.set(app.name, app) : chosen.delete(app.name)),
          }),
          h('span', { class: 'grow' }, app.label),
          app.name.endsWith('.fap') && h('span', { class: 'muted' }, 'fap'),
        ),
      ),
    );
  };
  draw();
  const status = h('p', { class: 'muted' }, 'looking for installed apps…');
  findFaps()
    .then((faps) => {
      for (const fap of faps) if (!options.some((o) => o.name === fap.name)) options.push(fap);
      status.textContent = `${faps.length} installed apps found`;
      draw();
    })
    .catch(() => (status.textContent = "couldn't list installed apps"));

  const choice = await sheet('quick launch apps', [
    { label: 'save', class: 'primary', value: 'save' },
    { label: '+ add by name', value: 'add' },
  ], h('div', {}, status, listEl));
  if (choice === 'add') {
    const name = await ask('Flipper app name or .fap path', '', 'add');
    if (name) {
      chosen.set(name, { label: name.split('/').pop().replace(/\.fap$/i, ''), name });
      saveQuick(keepOrder(current, chosen));
      return true;
    }
    return false;
  }
  if (choice !== 'save') return false;
  saveQuick(keepOrder(current, chosen));
  return true;
}

// Keep the old order, append newly picked apps at the end.
function keepOrder(current, chosen) {
  const out = current.filter((a) => chosen.has(a.name));
  for (const a of chosen.values()) if (!out.some((o) => o.name === a.name)) out.push(a);
  return out;
}

/** Lists .fap files in /ext/apps/<category>/. */
async function findFaps() {
  const f = conn.flipper;
  const out = [];
  const cats = (await f.list('/ext/apps')).filter((e) => e.isDir);
  for (const cat of cats) {
    const dir = `/ext/apps/${cat.name}`;
    for (const e of await f.list(dir).catch(() => [])) {
      if (!e.isDir && e.name.toLowerCase().endsWith('.fap')) {
        out.push({ label: e.name.replace(/\.fap$/i, ''), name: `${dir}/${e.name}` });
      }
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

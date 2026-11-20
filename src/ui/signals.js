// Signal viewer: opens .ir / .sub / .nfc / .rfid / .ibtn files nicely, and sends them from the phone.
import { h, showError, pushBack } from './dom.js';
import { conn } from '../connection.js';
import { parseInfrared, parseSubGhz, keyFileSummary, rawDurationMs } from '../flipper/flipperformat.js';
import { Emulator, SUBGHZ_MIN_SEND_MS } from '../flipper/emulate.js';
import { openEditor } from './editor.js';

const KIND_BY_EXT = { ir: 'ir', sub: 'subghz', nfc: 'nfc', rfid: 'rfid', ibtn: 'ibutton' };
const TITLES = { ir: 'infrared remote', subghz: 'sub-ghz', nfc: 'nfc', rfid: 'rfid 125 kHz', ibutton: 'ibutton' };

export function signalKind(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return KIND_BY_EXT[ext] ?? null;
}

/** Opens the viewer for a signal file. Resolves when it is closed. */
export function openSignal(path) {
  const kind = signalKind(path);
  const f = conn.flipper;
  const emulator = new Emulator(f, kind, path);
  return new Promise((resolve) => {
    const body = h('div', { class: 'signal-body' }, h('p', { class: 'muted' }, 'loading…'));
    const statusLine = h('div', { class: 'signal-status muted' });
    let removeBack = () => {};
    let text = '';

    const close = async () => {
      removeBack();
      el.remove();
      resolve();
      await emulator.release();
      await emulator.stop();
    };

    const editText = async () => {
      await emulator.stop();
      await openEditor(path, text, async (t) => {
        await f.write(path, new TextEncoder().encode(t));
        text = t;
      });
      draw();
    };

    const setStatus = (msg, cls = 'muted') => {
      statusLine.textContent = msg;
      statusLine.className = `signal-status ${cls}`;
    };

    const draw = () => {
      try {
        const views = { ir: irView, subghz: subGhzView, nfc: keyView, rfid: keyView, ibutton: keyView };
        body.replaceChildren(views[kind](text, { emulator, setStatus, kind }));
      } catch (e) {
        body.replaceChildren(h('p', { class: 'muted' }, `Couldn't read this file: ${e.message}`));
      }
    };

    const el = h(
      'div',
      { class: 'editor signal' },
      h(
        'div',
        { class: 'row' },
        h('button', { onclick: close }, '←'),
        h('div', { class: 'grow' }, h('div', { class: 'muted', style: 'font-size:12px' }, TITLES[kind]), h('div', { class: 'path' }, path.split('/').pop())),
        h('button', { onclick: editText }, '✎ text'),
      ),
      statusLine,
      body,
    );
    removeBack = pushBack(close);
    document.body.append(el);

    f.read(path)
      .then((bytes) => {
        text = new TextDecoder().decode(bytes);
        draw();
      })
      .catch((e) => {
        showError(e);
        close();
      });
  });
}

// ---------- Infrared: the file becomes a remote ----------

const IR_ICONS = [
  [/^power|^pwr|on.?off/i, '⏻'],
  [/vol.*(up|\+)|vol_?\+/i, 'VOL ＋'],
  [/vol.*(d(ow)?n|-)/i, 'VOL －'],
  [/ch.*(up|next|\+)/i, 'CH ＋'],
  [/ch.*(d(ow)?n|prev|-)/i, 'CH －'],
  [/^mute/i, '🔇'],
  [/^up$/i, '▲'],
  [/^down$/i, '▼'],
  [/^left$/i, '◀'],
  [/^right$/i, '▶'],
  [/^(ok|enter|select)$/i, '●'],
  [/^(play|pause)/i, '⏯'],
];
const irIcon = (name) => IR_ICONS.find(([re]) => re.test(name))?.[1] ?? null;

function irView(text, { emulator, setStatus }) {
  const signals = parseInfrared(text);
  if (!signals.length) return h('p', { class: 'muted' }, 'No buttons in this file yet.');
  let chain = Promise.resolve();
  const send = (sig, index, btn) => {
    btn.classList.add('pressed');
    navigator.vibrate?.(15);
    setStatus(`sending ${sig.name}…`, 'busy');
    chain = chain
      .then(() => emulator.sendIr(index, sig.name))
      .then(() => setStatus(`sent ${sig.name}`, 'ok'))
      .catch((e) => {
        setStatus('send failed', 'bad');
        showError(e);
      })
      .finally(() => btn.classList.remove('pressed'));
  };
  return h(
    'div',
    {},
    h('p', { class: 'muted', style: 'font-size:12px' }, `${signals.length} buttons · point the Flipper at the device and tap`),
    h(
      'div',
      { class: 'ir-grid' },
      signals.map((sig, i) => {
        const icon = irIcon(sig.name);
        const b = h(
          'button',
          { class: `ir-btn${/^power|^pwr/i.test(sig.name) ? ' power' : ''}` },
          icon && h('span', { class: 'ir-icon' }, icon),
          h('span', { class: 'ir-name' }, sig.name.replace(/_/g, ' ')),
        );
        b.onclick = () => send(sig, i, b);
        return b;
      }),
    ),
  );
}

// ---------- Sub-GHz: details, waveform, hold to send ----------

function subGhzView(text, { emulator, setStatus }) {
  const s = parseSubGhz(text);
  const rows = [
    ['frequency', s.frequencyText],
    ['modulation', s.preset],
    ['protocol', s.protocol],
    s.bits && ['bits', s.bits],
    s.key && ['key', s.key],
    s.te && ['te', `${s.te} µs`],
    s.raw && ['length', `${rawDurationMs(s.raw).toFixed(1)} ms · ${s.raw.length} pulses`],
  ].filter(Boolean);

  const sendBtn = h('button', { class: 'hold-send' }, 'hold to send');
  let pressedAt = 0;
  let pressing = null;
  const down = (e) => {
    e.preventDefault();
    if (pressing) return;
    sendBtn.classList.add('pressed');
    sendBtn.textContent = 'sending…';
    setStatus(`transmitting on ${s.frequencyText}`, 'busy');
    navigator.vibrate?.(20);
    pressing = emulator.press().then(
      () => (pressedAt = Date.now()),
      (err) => {
        setStatus('send failed', 'bad');
        showError(err);
        throw err;
      },
    );
  };
  const up = async (e) => {
    e?.preventDefault();
    if (!pressing) return;
    const p = pressing;
    try {
      await p;
      const left = SUBGHZ_MIN_SEND_MS - (Date.now() - pressedAt);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      await emulator.release();
      setStatus('sent', 'ok');
    } catch {
      /* already shown */
    }
    pressing = null;
    sendBtn.classList.remove('pressed');
    sendBtn.textContent = 'hold to send';
  };
  sendBtn.addEventListener('pointerdown', down);
  sendBtn.addEventListener('pointerup', up);
  sendBtn.addEventListener('pointerleave', up);
  sendBtn.addEventListener('pointercancel', up);
  sendBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  return h(
    'div',
    {},
    kv(rows),
    s.raw && waveform(s.raw),
    sendBtn,
    h('p', { class: 'muted', style: 'font-size:12px;text-align:center' }, 'Only send signals you own or are allowed to use. Some frequencies are blocked by region.'),
  );
}

/** Draws a RAW recording as a square wave (high = positive durations, low = negative). */
function waveform(raw) {
  const W = 1000;
  const H = 120;
  const canvas = h('canvas', { class: 'wave', width: W, height: H });
  const ctx = canvas.getContext('2d');
  const total = raw.reduce((n, d) => n + Math.abs(d), 0) || 1;
  ctx.fillStyle = '#0f1314';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#ff8200';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const hi = 20;
  const lo = H - 20;
  let x = 0;
  ctx.moveTo(0, lo);
  for (const d of raw) {
    const y = d > 0 ? hi : lo;
    ctx.lineTo(x, y);
    x += (Math.abs(d) / total) * W;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  return h('div', { class: 'wave-wrap' }, canvas);
}

// ---------- NFC / RFID / iButton: details + emulate ----------

function keyView(text, { emulator, setStatus, kind }) {
  const rows = keyFileSummary(kind, text);
  const btn = h('button', { class: 'hold-send' }, '▶ emulate');
  let on = false;
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      if (!on) {
        await emulator.start();
        on = true;
        btn.textContent = '■ stop emulating';
        btn.classList.add('pressed');
        setStatus('emulating · hold the Flipper to the reader', 'busy');
      } else {
        await emulator.stop();
        on = false;
        btn.textContent = '▶ emulate';
        btn.classList.remove('pressed');
        setStatus('stopped');
      }
    } catch (e) {
      setStatus('failed', 'bad');
      showError(e);
    }
    btn.disabled = false;
  };
  return h('div', {}, rows.length ? kv(rows) : h('p', { class: 'muted' }, 'No details found in this file.'), btn);
}

function kv(pairs) {
  return h('div', { class: 'card kv' }, pairs.flatMap(([k, v]) => [h('span', { class: 'k' }, k), h('span', { class: 'v' }, v)]));
}


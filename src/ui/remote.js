// Remote tab: live Flipper screen + buttons. Hold a button for a long press.
import { h, showError, toast } from './dom.js';
import { conn } from '../connection.js';
import { decodeFrame, isVertical, SCREEN_W, SCREEN_H } from '../flipper/screen.js';

const LONG_PRESS_MS = 500;
const QUICK_APPS = ['Sub-GHz', '125 kHz RFID', 'NFC', 'Infrared', 'iButton', 'Bad USB', 'GPIO', 'U2F'];

let stopCurrent = null;

/** Stop streaming (called when leaving the tab). */
export async function stopRemote() {
  const s = stopCurrent;
  stopCurrent = null;
  await s?.();
}

export function remoteView() {
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
    const vertical = isVertical(frame.orientation ?? 0);
    if (vertical) {
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

  const btn = (label, key, cls = '') => {
    const b = h('button', { class: cls, 'aria-label': key.toLowerCase() }, label);
    let timer = null;
    let longSent = false;
    const down = (e) => {
      e.preventDefault();
      longSent = false;
      timer = setTimeout(() => {
        longSent = true;
        f.pressButton(key, true).catch(showError);
        navigator.vibrate?.(30);
      }, LONG_PRESS_MS);
    };
    const up = (e) => {
      e.preventDefault();
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      if (!longSent) {
        f.pressButton(key).catch(showError);
        navigator.vibrate?.(10);
      }
    };
    const cancel = () => {
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

  const blank = () => h('span');
  return h(
    'div',
    {},
    h('div', { class: 'screen-wrap' }, canvas),
    h(
      'div',
      { class: 'pad' },
      blank(), btn('▲', 'UP'), blank(),
      btn('◀', 'LEFT'), btn('●', 'OK', 'ok'), btn('▶', 'RIGHT'),
      blank(), btn('▼', 'DOWN'), blank(),
    ),
    h('div', { class: 'pad-extra' }, btn('↩ back', 'BACK')),
    h('p', { class: 'muted', style: 'text-align:center;font-size:12px' }, 'tap = press · hold = long press'),
    h('h2', {}, 'launch app'),
    h(
      'div',
      { class: 'row wrap' },
      QUICK_APPS.map((name) =>
        h(
          'button',
          {
            onclick: () =>
              f
                .startApp(name)
                .then(() => toast(`${name} started`))
                .catch(showError),
          },
          name,
        ),
      ),
    ),
  );
}

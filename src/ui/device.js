// Device tab: find and connect a Flipper, then show its info.
import { h, showError, formatBytes } from './dom.js';
import { Capacitor } from '@capacitor/core';
import { conn, connectTo, connectDemo, disconnect, lastDevice } from '../connection.js';
import { startScan, stopScan, bondedFlippers } from '../flipper/ble.js';

const REPAIR_TIP =
  "Can't connect? Re-pair: on the Flipper go to Settings > Bluetooth > Forget all paired devices, " +
  'remove the Flipper in your phone\'s Bluetooth settings, then connect again here. ' +
  'This often fixes problems after switching firmware (for example to Momentum).';

export function deviceView(rerender) {
  if (conn.state === 'online') return connectedView(rerender);
  return scanView(rerender);
}

function scanView(rerender) {
  const found = new Map();
  const list = h('div');
  const scanBtn = h('button', { class: 'primary' }, 'scan for flipper');
  let scanning = false;

  const draw = () => {
    list.replaceChildren(
      ...[...found.values()]
        .sort((a, b) => Number(b.isFlipper) - Number(a.isFlipper) || (b.rssi ?? -999) - (a.rssi ?? -999))
        .filter((d) => d.isFlipper || d.name) // hide nameless strangers
        .map((d) =>
          h(
            'button',
            { class: `device ${d.isFlipper ? 'flipper' : ''}`, onclick: () => pick(d) },
            h('span', { class: 'name' }, d.name || d.id),
            h('span', { class: 'muted' }, d.rssi ? `${d.rssi} dBm` : 'paired'),
          ),
        ),
    );
  };

  const pick = async (d) => {
    await stopScan();
    scanning = false;
    try {
      await connectTo(d);
    } catch (e) {
      showError(e);
    }
    rerender();
  };

  scanBtn.onclick = async () => {
    if (scanning) {
      await stopScan();
      scanning = false;
      scanBtn.textContent = 'scan for flipper';
      return;
    }
    try {
      scanning = true;
      scanBtn.textContent = 'stop scan';
      await startScan((d) => {
        found.set(d.id, { ...found.get(d.id), ...d });
        draw();
      });
      setTimeout(async () => {
        if (!scanning) return;
        await stopScan();
        scanning = false;
        scanBtn.textContent = 'scan for flipper';
      }, 15000);
    } catch (e) {
      scanning = false;
      scanBtn.textContent = 'scan for flipper';
      showError(e);
    }
  };

  // Show already-paired Flippers and the last one used right away.
  (async () => {
    try {
      for (const d of await bondedFlippers()) found.set(d.id, d);
    } catch {
      /* not available on this platform */
    }
    const last = lastDevice();
    if (last && !found.has(last.id)) found.set(last.id, { ...last, isFlipper: true });
    draw();
  })();

  return h(
    'div',
    {},
    h('h2', {}, 'connect'),
    conn.state === 'connecting'
      ? h('p', {}, `connecting to ${conn.name}… if the Flipper shows a PIN, confirm it on your phone.`)
      : h('p', { class: 'muted' }, 'Turn on Bluetooth on the Flipper (Settings > Bluetooth), then scan.'),
    scanBtn,
    h('h2', {}, 'devices'),
    list,
    conn.lastError && h('div', { class: 'tip' }, `${conn.lastError}. ${REPAIR_TIP}`),
    !Capacitor.isNativePlatform() &&
      h('p', { style: 'margin-top:24px' }, h('button', { onclick: () => connectDemo().then(rerender) }, 'try demo (no flipper needed)')),
  );
}

function connectedView(rerender) {
  const info = h('div', { class: 'card' }, h('span', { class: 'muted' }, 'reading device info…'));
  const storage = h('div', { class: 'card' }, h('span', { class: 'muted' }, 'reading storage…'));
  const all = h('div');

  (async () => {
    const f = conn.flipper;
    try {
      const [dev, power] = [await f.deviceInfo(), await f.powerInfo().catch(() => ({}))];
      const fw = [dev.firmware_origin_fork, dev.firmware_version, dev.firmware_branch && `(${dev.firmware_branch})`]
        .filter(Boolean)
        .join(' ');
      const battery = power.charge_level ?? dev.charge_level;
      info.replaceChildren(
        kv([
          ['name', dev.hardware_name || conn.name],
          ['firmware', fw || '?'],
          ['hardware', [dev.hardware_model, dev.hardware_ver && `v${dev.hardware_ver}`].filter(Boolean).join(' ') || '?'],
          ['battery', battery !== undefined ? `${battery}%${power.charge_state ? ` · ${power.charge_state}` : ''}` : '?'],
          ['protobuf', dev.protobuf_version_major ? `${dev.protobuf_version_major}.${dev.protobuf_version_minor}` : '?'],
        ]),
      );
      all.replaceChildren(
        h(
          'details',
          { class: 'card' },
          h('summary', { class: 'muted' }, 'all device details'),
          kv(Object.entries({ ...dev, ...power }).sort(([a], [b]) => a.localeCompare(b))),
        ),
      );
    } catch (e) {
      info.replaceChildren(h('span', { class: 'muted' }, `could not read info: ${e.message}`));
    }
    try {
      const rows = [];
      for (const [label, path] of [
        ['sd card', '/ext'],
        ['internal', '/int'],
      ]) {
        try {
          const s = await f.storageInfo(path);
          rows.push(storageRow(label, s));
        } catch {
          rows.push(h('div', { class: 'muted' }, `${label}: not available`));
        }
      }
      storage.replaceChildren(...rows);
    } catch (e) {
      storage.replaceChildren(h('span', { class: 'muted' }, e.message));
    }
  })();

  return h(
    'div',
    {},
    h('h2', {}, 'flipper'),
    info,
    h('h2', {}, 'storage'),
    storage,
    all,
    h(
      'div',
      { class: 'row', style: 'margin-top:16px' },
      h(
        'button',
        {
          class: 'danger',
          onclick: async () => {
            await disconnect();
            rerender();
          },
        },
        'disconnect',
      ),
    ),
  );
}

function storageRow(label, { total, free }) {
  const used = total - free;
  const pct = total ? Math.round((used / total) * 100) : 0;
  return h(
    'div',
    { style: 'margin-bottom:10px' },
    h('div', { class: 'row' }, h('span', { class: 'grow' }, label), h('span', { class: 'muted' }, `${formatBytes(free)} free of ${formatBytes(total)}`)),
    h('div', { class: 'bar' }, h('div', { style: `width:${pct}%` })),
  );
}

function kv(pairs) {
  return h(
    'div',
    { class: 'kv' },
    pairs.flatMap(([k, v]) => [h('span', { class: 'k' }, k), h('span', { class: 'v' }, v)]),
  );
}

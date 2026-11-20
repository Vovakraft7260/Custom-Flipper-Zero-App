// Bluetooth transport: talks to the Flipper's serial service through the
// Capacitor Bluetooth LE plugin (no browser involved on Android).
import { BleClient, ConnectionPriority } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';

// Same UUIDs the official Flipper app uses.
export const SERIAL_SERVICE = '8fe5b3d5-2e7f-4a98-2a48-7acc60fe0000';
const RX_CHAR = '19ed82ae-ed21-4c9d-4145-228e61fe0000'; // Flipper -> phone (notify)
const TX_CHAR = '19ed82ae-ed21-4c9d-4145-228e62fe0000'; // phone -> Flipper (write)
const OVERFLOW_CHAR = '19ed82ae-ed21-4c9d-4145-228e63fe0000'; // free space in Flipper's receive buffer
const FLIPPER_MAC_PREFIX = '80:E1:26:';

let initialized = false;
async function ensureInit() {
  if (initialized) return;
  await BleClient.initialize({ androidNeverForLocation: true });
  initialized = true;
}

export function looksLikeFlipper(device, localName) {
  const name = device.name || localName || '';
  return name.startsWith('Flipper') || (device.deviceId || '').toUpperCase().startsWith(FLIPPER_MAC_PREFIX);
}

/** Scans for nearby devices. Flippers are flagged; others are kept so renamed ones still show. */
export async function startScan(onDevice) {
  await ensureInit();
  if (!(await BleClient.isEnabled())) {
    try {
      await BleClient.requestEnable();
    } catch {
      throw new Error('Bluetooth is off. Turn it on and try again.');
    }
  }
  await BleClient.requestLEScan({ allowDuplicates: false }, (r) => {
    onDevice({
      id: r.device.deviceId,
      name: r.device.name || r.localName || '',
      rssi: r.rssi,
      isFlipper: looksLikeFlipper(r.device, r.localName),
    });
  });
}

export async function stopScan() {
  try {
    await BleClient.stopLEScan();
  } catch {
    /* not scanning */
  }
}

/** Devices already paired in Android settings (Android only). */
export async function bondedFlippers() {
  await ensureInit();
  if (Capacitor.getPlatform() !== 'android') return [];
  const list = await BleClient.getBondedDevices();
  return list.filter((d) => looksLikeFlipper(d)).map((d) => ({ id: d.deviceId, name: d.name || d.deviceId, isFlipper: true }));
}

export class BleTransport {
  constructor(deviceId) {
    this.deviceId = deviceId;
    this.onData = () => {};
    this.onDisconnect = () => {};
    this.chunkSize = 20;
    this.remaining = 0;
    this.queue = Promise.resolve();
    this.bufferWaiters = [];
    this.connected = false;
  }

  async connect() {
    await ensureInit();
    const id = this.deviceId;
    if (Capacitor.getPlatform() === 'android' && !(await BleClient.isBonded(id))) {
      // The Flipper shows a PIN, Android asks you to confirm it.
      await BleClient.createBond(id, { timeout: 60000 });
    }
    await BleClient.connect(
      id,
      () => {
        this.connected = false;
        this._wakeWaiters();
        this.onDisconnect();
      },
      { timeout: 30000 },
    );
    this.connected = true;
    try {
      this.chunkSize = Math.max(20, (await BleClient.getMtu(id)) - 3);
    } catch {
      this.chunkSize = 20;
    }
    try {
      await BleClient.requestConnectionPriority(id, ConnectionPriority.CONNECTION_PRIORITY_HIGH);
    } catch {
      /* optional */
    }
    await BleClient.startNotifications(id, SERIAL_SERVICE, RX_CHAR, (dv) => this.onData(copyBytes(dv)));
    this._setRemaining(await BleClient.read(id, SERIAL_SERVICE, OVERFLOW_CHAR));
    await BleClient.startNotifications(id, SERIAL_SERVICE, OVERFLOW_CHAR, (dv) => this._setRemaining(dv));
  }

  async disconnect() {
    this.connected = false;
    try {
      await BleClient.disconnect(this.deviceId);
    } catch {
      /* already gone */
    }
  }

  /** Queue bytes for sending. Respects the Flipper's buffer so nothing is dropped. */
  send(bytes) {
    const next = this.queue.catch(() => {}).then(() => this._sendNow(bytes));
    this.queue = next;
    return next;
  }

  async _sendNow(bytes) {
    let off = 0;
    let waits = 0;
    while (off < bytes.length) {
      if (!this.connected) throw new Error('Flipper disconnected');
      if (this.remaining <= 0) {
        if (++waits > 10) throw new Error('Flipper stopped accepting data');
        await this._waitForBuffer();
        continue;
      }
      waits = 0;
      const n = Math.min(bytes.length - off, this.remaining, this.chunkSize);
      const part = bytes.slice(off, off + n);
      await BleClient.write(this.deviceId, SERIAL_SERVICE, TX_CHAR, new DataView(part.buffer));
      off += n;
      this.remaining -= n;
    }
  }

  _setRemaining(dv) {
    if (!dv || dv.byteLength < 4) return;
    this.remaining = dv.getInt32(0, false);
    if (this.remaining > 0) this._wakeWaiters();
  }

  _waitForBuffer() {
    return new Promise((resolve) => {
      const t = setTimeout(async () => {
        // No notification came: ask the Flipper directly.
        try {
          this._setRemaining(await BleClient.read(this.deviceId, SERIAL_SERVICE, OVERFLOW_CHAR));
        } catch {
          /* handled by the send loop */
        }
        resolve();
      }, 3000);
      this.bufferWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  _wakeWaiters() {
    const w = this.bufferWaiters;
    this.bufferWaiters = [];
    w.forEach((fn) => fn());
  }
}

function copyBytes(dv) {
  return new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));
}

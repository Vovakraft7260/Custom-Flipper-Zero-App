// Keeps track of the one Flipper we are connected to.
import { BleTransport } from './flipper/ble.js';
import { Flipper } from './flipper/api.js';
import { demoFlipper } from './flipper/demo.js';
import { setMirrorDevice } from './flipper/mirror.js';

const listeners = new Set();
export const conn = { flipper: null, transport: null, name: '', state: 'offline', lastError: null };

export function onConnChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  listeners.forEach((fn) => fn(conn));
}

const LAST_DEVICE_KEY = 'oilrig.lastDevice';
export function lastDevice() {
  try {
    return JSON.parse(localStorage.getItem(LAST_DEVICE_KEY) || 'null');
  } catch {
    return null;
  }
}

export async function connectTo(device) {
  if (conn.transport) await disconnect();
  conn.state = 'connecting';
  conn.name = device.name || device.id;
  setMirrorDevice(conn.name);
  conn.lastError = null;
  emit();
  const transport = new BleTransport(device.id);
  try {
    await transport.connect();
    const flipper = new Flipper(transport);
    transport.onDisconnect = () => {
      flipper.rpc.failAll(new Error('Flipper disconnected'));
      if (conn.transport === transport) {
        conn.flipper = null;
        conn.transport = null;
        conn.state = 'offline';
        conn.lastError = 'Connection lost';
        emit();
      }
    };
    await flipper.ping();
    conn.transport = transport;
    conn.flipper = flipper;
    conn.state = 'online';
    try {
      localStorage.setItem(LAST_DEVICE_KEY, JSON.stringify({ id: device.id, name: conn.name }));
    } catch {
      /* storage blocked */
    }
  } catch (e) {
    await transport.disconnect();
    conn.state = 'offline';
    conn.lastError = e?.message || String(e);
    emit();
    throw e;
  }
  emit();
}

/** Browser preview only: a pretend Flipper so the screens can be tried without hardware. */
export async function connectDemo() {
  if (conn.transport) await disconnect();
  const transport = demoFlipper();
  conn.transport = transport;
  conn.flipper = new Flipper(transport);
  conn.name = 'Flipper Rig0 (demo)';
  setMirrorDevice(conn.name);
  conn.state = 'online';
  conn.lastError = null;
  emit();
}

export async function disconnect() {
  const t = conn.transport;
  conn.transport = null;
  conn.flipper?.rpc.failAll(new Error('Disconnected'));
  conn.flipper = null;
  conn.state = 'offline';
  emit();
  await t?.disconnect();
}

// Flipper over a USB-C cable (Android only). The Flipper's USB port is a serial
// console: we wait for its prompt, switch it to RPC with "start_rpc_session",
// and from then on speak the same protobuf as over Bluetooth.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { base64ToBytes, bytesToBase64 } from '../store/http.js';
import { Flipper } from './api.js';

const UsbSerial = registerPlugin('UsbSerial');

export const usbAvailable = () => Capacitor.getPlatform() === 'android';

export class UsbTransport {
  constructor() {
    this.onData = () => {};
    this.onDisconnect = () => {};
    this.connected = false;
    this.rpc = false;
    this.text = '';
    this.handles = [];
    this.queue = Promise.resolve();
  }

  async connect() {
    this.handles.push(
      await UsbSerial.addListener('data', ({ data }) => {
        const bytes = base64ToBytes(data);
        if (this.rpc) this.onData(bytes);
        else this.text += new TextDecoder().decode(bytes);
      }),
      await UsbSerial.addListener('disconnected', () => {
        this.connected = false;
        this.onDisconnect();
      }),
    );
    const { name } = await UsbSerial.connect({});
    this.name = name;
    this.connected = true;
    // Wake the console and wait for its prompt, then start RPC.
    if (!(await this._waitText('>: ', 1500))) {
      await this._raw('\r\n');
      if (!(await this._waitText('>: ', 3000))) throw new Error("The Flipper didn't answer on USB. Close qFlipper or other apps using it and try again.");
    }
    this.text = '';
    await this._raw('start_rpc_session\r');
    if (!(await this._waitText('start_rpc_session\r\n', 3000)) && !(await this._waitText('\n', 500))) {
      throw new Error("The Flipper didn't switch to app mode on USB.");
    }
    this.text = '';
    this.rpc = true;
  }

  async _waitText(needle, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (this.text.includes(needle)) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return this.text.includes(needle);
  }

  _raw(text) {
    return UsbSerial.write({ data: bytesToBase64(new TextEncoder().encode(text)) });
  }

  send(bytes) {
    const next = this.queue.catch(() => {}).then(() => {
      if (!this.connected) throw new Error('Flipper unplugged');
      return UsbSerial.write({ data: bytesToBase64(bytes) });
    });
    this.queue = next;
    return next;
  }

  async setPowerSaving() {}

  async disconnect() {
    this.connected = false;
    for (const h of this.handles.splice(0)) await h.remove().catch(() => {});
    await UsbSerial.disconnect().catch(() => {});
  }
}

/** Opens a USB connection and returns a Flipper to talk to. */
export async function connectUsb() {
  const transport = new UsbTransport();
  try {
    await transport.connect();
  } catch (e) {
    await transport.disconnect();
    throw e;
  }
  const flipper = new Flipper(transport);
  return { flipper, transport, name: transport.name };
}

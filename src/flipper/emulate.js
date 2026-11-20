// Sends / emulates a saved signal from the phone, the same way the official app does:
// open the Flipper app in RPC mode, load the file, then "press" its button.
import { RpcError } from './rpc.js';

const APP_FOR = {
  ir: 'Infrared',
  subghz: 'Sub-GHz',
  nfc: 'NFC',
  rfid: '125 kHz RFID',
  ibutton: 'iButton',
};
const APP_START_WAIT_MS = 3000;
export const SUBGHZ_MIN_SEND_MS = 500;

export class Emulator {
  constructor(flipper, kind, path) {
    this.f = flipper;
    this.kind = kind;
    this.path = path;
    this.open = false;
  }

  /** Opens the right Flipper app and loads the file. */
  async start() {
    if (this.open) return;
    const rpc = this.f.rpc;
    let started;
    const appStarted = new Promise((resolve) => {
      started = resolve;
    });
    const off = rpc.onEvent((m) => {
      if (m.app_state_response && (m.app_state_response.state ?? 0) === 1) started();
    });
    try {
      await rpc.request({ app_start_request: { name: APP_FOR[this.kind], args: 'RPC' } });
      await Promise.race([appStarted, sleep(APP_START_WAIT_MS)]);
    } finally {
      off();
    }
    this.open = true;
    await rpc.request({ app_load_file_request: { path: this.path } }).catch(async (e) => {
      await this.stop();
      throw e;
    });
  }

  /** Infrared: sends one button of the remote (by its position in the file). */
  async sendIr(index, name) {
    await this.start();
    const minor = await this.f.protobufMinor();
    try {
      if (minor >= 25) {
        await this.f.rpc.request({ app_button_press_release_request: { index, args: name } });
      } else {
        await this.f.rpc.request({ app_button_press_request: minor >= 21 ? { index } : { args: name } });
        await sleep(300);
        await this.f.rpc.request({ app_button_release_request: {} });
      }
    } catch (e) {
      throw await this._explain(e);
    }
  }

  /** Sub-GHz: starts transmitting. Call release() to stop. */
  async press() {
    await this.start();
    try {
      await this.f.rpc.request({ app_button_press_request: {} });
    } catch (e) {
      throw await this._explain(e);
    }
  }

  async release() {
    if (!this.open) return;
    await this.f.rpc.request({ app_button_release_request: {} }).catch(() => {});
  }

  /** Closes the Flipper app (stops NFC/RFID/iButton emulation). */
  async stop() {
    if (!this.open) return;
    this.open = false;
    await this.f.rpc.request({ app_exit_request: {} }).catch(() => {});
  }

  // The Flipper keeps a text reason for app errors (e.g. a blocked frequency).
  async _explain(e) {
    if (!(e instanceof RpcError)) return e;
    try {
      const [res] = await this.f.rpc.request({ app_get_error_request: {} });
      const text = res.app_get_error_response?.text;
      if (text) return new Error(`Flipper: ${text}`);
    } catch {
      /* no extra info */
    }
    return e;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sends universal-remote buttons: writes a small .ir file to the Flipper once,
// then presses buttons in it through the Infrared app (same as viewing a remote).
import { buildIrFile } from './irfile.js';
import { Emulator } from '../flipper/emulate.js';
import { RpcError } from '../flipper/rpc.js';

export const REMOTE_DIR = '/ext/apps_data/0ilrig';
export const REMOTE_PATH = `${REMOTE_DIR}/remote.ir`;

export class RemoteSender {
  constructor(flipper) {
    this.f = flipper;
    this.loadedText = null;
    this.emulator = null;
    this.names = [];
  }

  /** Makes sure the Flipper has exactly these buttons loaded. */
  async load(entries) {
    const text = buildIrFile(entries);
    this.names = entries.map((e) => e.name);
    if (text === this.loadedText) return;
    await this.close();
    for (const dir of ['/ext/apps_data', REMOTE_DIR]) {
      try {
        await this.f.mkdir(dir);
      } catch (e) {
        if (!(e instanceof RpcError && e.statusName === 'ERROR_STORAGE_EXIST')) throw e;
      }
    }
    await this.f.write(REMOTE_PATH, new TextEncoder().encode(text));
    this.loadedText = text;
    this.emulator = new Emulator(this.f, 'ir', REMOTE_PATH);
  }

  async send(name) {
    const index = this.names.indexOf(name);
    if (index < 0 || !this.emulator) throw new Error(`No code for ${name}`);
    await this.emulator.sendIr(index, name);
  }

  async sendIndex(index) {
    await this.emulator.sendIr(index, this.names[index]);
  }

  /** Closes the Infrared app on the Flipper. */
  async close() {
    await this.emulator?.stop();
  }
}

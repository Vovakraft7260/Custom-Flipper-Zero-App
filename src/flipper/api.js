// Friendly Flipper commands built on the RPC layer.
import { FlipperRpc, RpcError } from './rpc.js';
import { FileType, InputKey, InputType } from './proto.js';

export const MAX_FILE_CHUNK = 512; // same chunk size the official app uses

// Same app, different names depending on the firmware.
const APP_ALIASES = {
  'Bad USB': ['Bad USB', 'Bad KB'],
  'Bad KB': ['Bad KB', 'Bad USB'],
};

export class Flipper {
  constructor(transport) {
    this.rpc = new FlipperRpc(transport);
  }

  ping() {
    return this.rpc.request({ system_ping_request: { data: new Uint8Array([1, 2, 3]) } });
  }

  /** All key/value pairs the Flipper reports (firmware, hardware, radio, ...). */
  async deviceInfo() {
    return keyValues(await this.rpc.request({ system_device_info_request: {} }), 'system_device_info_response');
  }

  /** Battery and charging details. */
  async powerInfo() {
    return keyValues(await this.rpc.request({ system_power_info_request: {} }), 'system_power_info_response');
  }

  async storageInfo(path) {
    const [res] = await this.rpc.request({ storage_info_request: { path } });
    const info = res.storage_info_response ?? {};
    return { total: Number(info.total_space ?? 0), free: Number(info.free_space ?? 0) };
  }

  /** Lists a folder. Returns [{ name, isDir, size }], folders first. */
  async list(path) {
    const parts = await this.rpc.request({ storage_list_request: { path } });
    const files = parts.flatMap((p) => p.storage_list_response?.file ?? []);
    return files
      .map((f) => ({ name: f.name, isDir: (f.type ?? 0) === FileType.DIR, size: f.size ?? 0 }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  }

  /** Downloads a file. onProgress(bytesSoFar) is called for every chunk. */
  async read(path, onProgress) {
    let received = 0;
    const parts = await this.rpc.request(
      { storage_read_request: { path } },
      {
        onPart: (p) => {
          received += p.storage_read_response?.file?.data?.length ?? 0;
          onProgress?.(received);
        },
      },
    );
    const chunks = parts.map((p) => p.storage_read_response?.file?.data ?? new Uint8Array(0));
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  /** Uploads a file (replaces it if it exists). */
  async write(path, data, onProgress) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const parts = [];
    for (let off = 0; off < bytes.length || parts.length === 0; off += MAX_FILE_CHUNK) {
      parts.push({ storage_write_request: { path, file: { data: bytes.subarray(off, off + MAX_FILE_CHUNK) } } });
    }
    await this.rpc.request(parts, {
      onSent: (done) => onProgress?.(Math.min(bytes.length, done * MAX_FILE_CHUNK)),
    });
  }

  async remove(path, recursive = false) {
    await this.rpc.request({ storage_delete_request: { path, recursive } });
  }

  async mkdir(path) {
    await this.rpc.request({ storage_mkdir_request: { path } });
  }

  async rename(oldPath, newPath) {
    await this.rpc.request({ storage_rename_request: { old_path: oldPath, new_path: newPath } });
  }

  /**
   * Starts a Flipper app, e.g. startApp('Infrared') or a .fap path.
   * Tries known alternative names (Momentum calls Bad USB "Bad KB").
   */
  async startApp(name, args = '') {
    const names = APP_ALIASES[name] ?? [name];
    let lastError;
    for (const n of names) {
      try {
        await this.rpc.request({ app_start_request: { name: n, args } });
        return n;
      } catch (e) {
        lastError = e;
        if (!(e instanceof RpcError) || e.statusName === 'ERROR_APP_SYSTEM_LOCKED') throw e;
      }
    }
    throw lastError;
  }

  async startScreenStream() {
    await this.rpc.request({ gui_start_screen_stream_request: {} });
  }

  async stopScreenStream() {
    await this.rpc.request({ gui_stop_screen_stream_request: {} });
  }

  /** Called with each ScreenFrame { data, orientation } while streaming. */
  onScreenFrame(fn) {
    return this.rpc.onEvent((m) => {
      if (m.gui_screen_frame) fn(m.gui_screen_frame);
    });
  }

  /** Presses a button like a person would: press, short/long, release. */
  async pressButton(key, long = false) {
    const k = InputKey[key];
    if (k === undefined) throw new Error(`Unknown button ${key}`);
    const send = (type) => this.rpc.request({ gui_send_input_event_request: { key: k, type } });
    await send(InputType.PRESS);
    await send(long ? InputType.LONG : InputType.SHORT);
    await send(InputType.RELEASE);
  }
}

function keyValues(parts, field) {
  const out = {};
  for (const p of parts) {
    const kv = p[field];
    if (kv?.key) out[kv.key] = kv.value ?? '';
  }
  return out;
}

export function joinPath(dir, name) {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`;
}

export function parentPath(path) {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

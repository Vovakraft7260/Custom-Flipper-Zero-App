// Request/response layer on top of a byte transport (Bluetooth for now, USB later).
// A transport must provide: send(Uint8Array) -> Promise, and set .onData(Uint8Array).
import { encodeMain, commandStatusName } from './proto.js';
import { FrameDecoder } from './framing.js';

const DEFAULT_TIMEOUT_MS = 15000;

export class RpcError extends Error {
  constructor(status) {
    super(`Flipper replied ${commandStatusName(status)}`);
    this.status = status;
    this.statusName = commandStatusName(status);
  }
}

export class FlipperRpc {
  constructor(transport, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.decoder = new FrameDecoder((m) => this._onMessage(m));
    transport.onData = (bytes) => this.decoder.push(bytes);
  }

  /** Listen to messages the Flipper sends on its own (like screen frames). */
  onEvent(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Send one request and collect every response part until has_next is false.
   * `content` is a single Main oneof, e.g. { storage_list_request: { path: '/ext' } }.
   * Pass an array to send a multi-part request (e.g. a file write in chunks).
   * onPart(msg) runs for each response part, onSent(done, total) after each sent part.
   */
  request(content, { onPart, onSent } = {}) {
    const parts = Array.isArray(content) ? content : [content];
    const id = this._takeId();
    return new Promise((resolve, reject) => {
      const entry = {
        responses: [],
        onPart,
        resolve,
        reject,
        timer: null,
      };
      entry.arm = () => {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('Flipper did not answer in time'));
        }, this.timeoutMs);
      };
      this.pending.set(id, entry);
      entry.arm();

      const frames = parts.map((part, i) =>
        encodeMain({ command_id: id, has_next: i < parts.length - 1, ...part }),
      );
      (async () => {
        for (let i = 0; i < frames.length; i++) {
          await this.transport.send(frames[i]);
          entry.arm(); // big uploads: keep the timer alive while we are still sending
          onSent?.(i + 1, frames.length);
        }
      })().catch((e) => {
        this._finish(id, e);
      });
    });
  }

  /** Reject everything still waiting, e.g. after a disconnect. */
  failAll(err) {
    for (const id of [...this.pending.keys()]) this._finish(id, err);
    this.decoder.reset();
  }

  _takeId() {
    const id = this.nextId;
    this.nextId = this.nextId >= 0xfffffff0 ? 1 : this.nextId + 1;
    return id;
  }

  _onMessage(msg) {
    const entry = msg.command_id ? this.pending.get(msg.command_id) : null;
    if (!entry) {
      for (const fn of this.listeners) fn(msg);
      return;
    }
    if (msg.command_status !== 0) {
      this._finish(msg.command_id, new RpcError(msg.command_status));
      return;
    }
    entry.responses.push(msg);
    entry.onPart?.(msg);
    if (msg.has_next) {
      entry.arm();
    } else {
      this._finish(msg.command_id, null);
    }
  }

  _finish(id, err) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (err) entry.reject(err);
    else entry.resolve(entry.responses);
  }
}

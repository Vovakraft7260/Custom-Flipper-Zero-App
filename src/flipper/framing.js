// Splits the incoming Bluetooth byte stream into separate RPC messages.
// Each message is: varint length + protobuf body. Messages can arrive split
// across several Bluetooth packets, or several in one packet.
import { decodeMain } from './proto.js';

export class FrameDecoder {
  constructor(onMessage, onError = (e) => console.error(e)) {
    this.onMessage = onMessage;
    this.onError = onError;
    this.buf = new Uint8Array(0);
  }

  push(chunk) {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;

    for (;;) {
      const header = readVarint(this.buf);
      if (!header) return; // need more bytes for the length
      const { value: len, size } = header;
      if (this.buf.length < size + len) return; // need more bytes for the body
      const body = this.buf.subarray(size, size + len);
      this.buf = this.buf.slice(size + len);
      let msg;
      try {
        msg = decodeMain(body);
      } catch (e) {
        this.onError(e);
        continue;
      }
      this.onMessage(msg);
    }
  }

  reset() {
    this.buf = new Uint8Array(0);
  }
}

/** Reads a protobuf varint from the start of buf. Returns null if incomplete. */
export function readVarint(buf) {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < buf.length && i < 5; i++) {
    const b = buf[i];
    value += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return { value, size: i + 1 };
    shift += 7;
  }
  if (buf.length >= 5) throw new Error('Invalid message length prefix');
  return null;
}

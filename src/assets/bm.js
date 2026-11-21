// Flipper image files: .bm (one frame, maybe heatshrink-compressed) and
// .bmx (width + height header, then .bm data). Decoded to 1-bit pixel rows.

/** Heatshrink decoder (Flipper uses window 8, lookahead 4). */
export function heatshrinkDecode(input, windowBits = 8, lookaheadBits = 4, maxOut = 1 << 20) {
  const out = [];
  let pos = 0;
  let bit = 0x80;
  const readBits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (pos >= input.length) return -1;
      v = (v << 1) | (input[pos] & bit ? 1 : 0);
      bit >>= 1;
      if (!bit) {
        bit = 0x80;
        pos++;
      }
    }
    return v;
  };
  while (out.length < maxOut) {
    const tag = readBits(1);
    if (tag < 0) break;
    if (tag === 1) {
      const b = readBits(8);
      if (b < 0) break;
      out.push(b);
    } else {
      const idx = readBits(windowBits);
      if (idx < 0) break;
      const cnt = readBits(lookaheadBits);
      if (cnt < 0) break;
      const from = out.length - (idx + 1);
      // The window starts filled with zeros, so references before the start give 0.
      for (let i = 0; i <= cnt; i++) out.push(from + i < 0 ? 0 : out[from + i]);
    }
  }
  return new Uint8Array(out);
}

/** Raw XBM-style rows from a .bm file body. */
export function bmData(bytes) {
  if (!bytes.length) throw new Error('Empty image');
  if (bytes[0] === 0x00) return bytes.subarray(1);
  if (bytes[0] === 0x01) {
    const len = bytes[2] | (bytes[3] << 8);
    return heatshrinkDecode(bytes.subarray(4, 4 + len));
  }
  throw new Error('Unknown image format');
}

/** { width, height, pixels } where pixels[y * width + x] = 1 for a dark pixel. */
export function decodeBm(bytes, width, height) {
  const data = bmData(bytes);
  const stride = Math.ceil(width / 8);
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byte = data[y * stride + (x >> 3)] ?? 0;
      pixels[y * width + x] = (byte >> (x & 7)) & 1;
    }
  }
  return { width, height, pixels };
}

export function decodeBmx(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = dv.getUint32(0, true);
  const height = dv.getUint32(4, true);
  return decodeBm(bytes.subarray(8), width, height);
}

/** Size from a name like "passport_okay_46x49.bmx" or "Foo_128x64". */
export function sizeFromName(name) {
  const m = /(\d+)x(\d+)(?:\.\w+)?$/.exec(name);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

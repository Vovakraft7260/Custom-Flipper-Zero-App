// Decodes a Flipper screen frame (128x64, 1 bit per pixel) into RGBA pixels.
// Layout: 8 rows of 128 bytes; each byte holds 8 vertical pixels, lowest bit on top.
import { ScreenOrientation } from './proto.js';

export const SCREEN_W = 128;
export const SCREEN_H = 64;

export function isPixelSet(data, x, y) {
  return (data[(y >> 3) * SCREEN_W + x] & (1 << (y & 7))) !== 0;
}

/**
 * Fills `out` (Uint8ClampedArray of 128*64*4) with RGBA.
 * on/off are [r,g,b] colours for lit and background pixels.
 */
export function decodeFrame(data, orientation, out, on = [0, 0, 0], off = [255, 130, 0]) {
  const flip = orientation === ScreenOrientation.HORIZONTAL_FLIP || orientation === ScreenOrientation.VERTICAL_FLIP;
  for (let y = 0; y < SCREEN_H; y++) {
    for (let x = 0; x < SCREEN_W; x++) {
      const c = isPixelSet(data, x, y) ? on : off;
      const px = flip ? SCREEN_W - 1 - x : x;
      const py = flip ? SCREEN_H - 1 - y : y;
      const i = (py * SCREEN_W + px) * 4;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = 255;
    }
  }
  return out;
}

/** True when the Flipper is held upright, so the picture should be rotated 90°. */
export const isVertical = (orientation) =>
  orientation === ScreenOrientation.VERTICAL || orientation === ScreenOrientation.VERTICAL_FLIP;

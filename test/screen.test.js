import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFrame, isPixelSet, SCREEN_W, SCREEN_H } from '../src/flipper/screen.js';
import { ScreenOrientation } from '../src/flipper/proto.js';

test('pixel layout: byte = 8 vertical pixels, low bit on top', () => {
  const data = new Uint8Array(1024);
  data[0] = 0b00000001; // (0,0)
  data[SCREEN_W + 5] = 0b00000100; // (5, 8+2)
  assert.ok(isPixelSet(data, 0, 0));
  assert.ok(!isPixelSet(data, 0, 1));
  assert.ok(isPixelSet(data, 5, 10));
});

test('flipped orientation mirrors the picture', () => {
  const data = new Uint8Array(1024);
  data[0] = 1;
  const out = decodeFrame(data, ScreenOrientation.HORIZONTAL_FLIP, new Uint8ClampedArray(SCREEN_W * SCREEN_H * 4));
  const last = (SCREEN_W * SCREEN_H - 1) * 4;
  assert.deepEqual([...out.slice(last, last + 3)], [0, 0, 0]);
  assert.deepEqual([...out.slice(0, 3)], [255, 130, 0]);
});

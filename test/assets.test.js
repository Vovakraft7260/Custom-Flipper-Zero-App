import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { heatshrinkDecode, decodeBm, decodeBmx, sizeFromName } from '../src/assets/bm.js';
import { readArchive, writeZip, readZip, crc32 } from '../src/assets/archive.js';

test('heatshrink: literals and back-references (also into the zero window)', () => {
  // bits: 1 'A'(0x41) | 0 idx=0 cnt=2 -> "AAA" | 0 idx=255 cnt=0 -> reads before start = 0
  const bits = '1' + '01000001' + '0' + '00000000' + '0010' + '0' + '11111111' + '0000';
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') bytes[i >> 3] |= 0x80 >> (i & 7);
  assert.deepEqual([...heatshrinkDecode(bytes)], [0x41, 0x41, 0x41, 0x41, 0]);
});

test('decodes raw .bm and .bmx images', () => {
  // 10x2 image, raw: row stride 2 bytes, LSB first
  const raw = new Uint8Array([0x00, 0b00000101, 0b10, 0xff, 0x00]);
  const img = decodeBm(raw, 10, 2);
  assert.deepEqual([...img.pixels.subarray(0, 10)], [1, 0, 1, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual([...img.pixels.subarray(10, 18)], [1, 1, 1, 1, 1, 1, 1, 1]);
  const bmx = new Uint8Array([10, 0, 0, 0, 2, 0, 0, 0, ...raw]);
  assert.equal(decodeBmx(bmx).width, 10);
  assert.deepEqual(sizeFromName('passport_okay_46x49.bmx'), { width: 46, height: 49 });
});

test('reads .tar.gz and .zip archives, and writes zips that read back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arch-'));
  mkdirSync(join(dir, 'Pack', 'Anims'), { recursive: true });
  writeFileSync(join(dir, 'Pack', 'Anims', 'manifest.txt'), 'Filetype: Flipper Animation Manifest\n');
  writeFileSync(join(dir, 'Pack', 'a b.bin'), Buffer.from([1, 2, 3]));
  execFileSync('tar', ['czf', join(dir, 'p.tgz'), '-C', dir, 'Pack']);
  const tar = await readArchive(new Uint8Array(readFileSync(join(dir, 'p.tgz'))));
  assert.deepEqual(tar.map((f) => f.path).sort(), ['Pack/Anims/manifest.txt', 'Pack/a b.bin']);
  const zipped = writeZip([{ path: 'x/y.txt', data: new TextEncoder().encode('hello') }, { path: 'z.bin', data: new Uint8Array([9]) }]);
  const back = await readZip(zipped);
  assert.equal(new TextDecoder().decode(back[0].data), 'hello');
  assert.equal(back[1].data[0], 9);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  try {
    execFileSync('python3', ['-c', `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None`, writeTmp(dir, zipped)]);
  } catch (e) {
    assert.fail('python could not read our zip: ' + e.message);
  }
});

function writeTmp(dir, bytes) {
  const p = join(dir, 'out.zip');
  writeFileSync(p, bytes);
  return p;
}

test('reads a real Momentum pack and decodes its frames', async () => {
  const { packContents, framesOf } = await import('../src/assets/packs.js');
  const dir = mkdtempSync(join(tmpdir(), 'pack-'));
  const root = join(dir, 'My Pack');
  mkdirSync(join(root, 'Anims', 'Wave_128x64'), { recursive: true });
  mkdirSync(join(root, 'Icons', 'Passport'), { recursive: true });
  writeFileSync(join(root, 'Anims', 'manifest.txt'), 'Filetype: Flipper Animation Manifest\nVersion: 1\n');
  writeFileSync(join(root, 'Anims', 'Wave_128x64', 'meta.txt'), 'Width: 8\nHeight: 1\nFrame rate: 2\nFrames order: 0 1 0\n');
  writeFileSync(join(root, 'Anims', 'Wave_128x64', 'frame_0.bm'), Buffer.from([0, 0b1]));
  writeFileSync(join(root, 'Anims', 'Wave_128x64', 'frame_1.bm'), Buffer.from([0, 0b10]));
  writeFileSync(join(root, 'Icons', 'Passport', 'face_8x1.bmx'), Buffer.from([8, 0, 0, 0, 1, 0, 0, 0, 0, 0xff]));
  execFileSync('tar', ['czf', join(dir, 'p.tgz'), '-C', dir, 'My Pack']);
  const files = await readArchive(new Uint8Array(readFileSync(join(dir, 'p.tgz'))));
  const pack = packContents(files);
  assert.equal(pack.name, 'My Pack');
  assert.equal(pack.anims.length, 1);
  const frames = framesOf(pack.anims[0]);
  assert.equal(frames.length, 3);
  assert.equal(frames[1].pixels[1], 1);
  assert.equal(framesOf(pack.icons[0])[0].pixels.reduce((a, b) => a + b), 8);
  assert.ok(pack.files.some((f) => f.path === 'Anims/manifest.txt'));
});

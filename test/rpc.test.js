import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Flipper } from '../src/flipper/api.js';
import { RpcError } from '../src/flipper/rpc.js';
import { FrameDecoder, readVarint } from '../src/flipper/framing.js';
import { encodeMain, InputKey, InputType } from '../src/flipper/proto.js';
import { FakeFlipper } from '../src/flipper/demo.js';

test('varint reader handles multi-byte and partial lengths', () => {
  assert.deepEqual(readVarint(new Uint8Array([0x05])), { value: 5, size: 1 });
  assert.deepEqual(readVarint(new Uint8Array([0xac, 0x02])), { value: 300, size: 2 });
  assert.equal(readVarint(new Uint8Array([0xac])), null);
});

test('frame decoder splits several messages in one packet', () => {
  const got = [];
  const d = new FrameDecoder((m) => got.push(m));
  const a = encodeMain({ command_id: 1, empty: {} });
  const b = encodeMain({ command_id: 2, has_next: true, empty: {} });
  const both = new Uint8Array([...a, ...b]);
  d.push(both.slice(0, 3));
  d.push(both.slice(3));
  assert.deepEqual(got.map((m) => [m.command_id, m.has_next]), [[1, false], [2, true]]);
});

test('device info merges multi-part answers', async () => {
  const f = new Flipper(new FakeFlipper());
  assert.deepEqual(await f.deviceInfo(), { hardware_name: 'Rig0', firmware_origin_fork: 'Momentum' });
});

test('list returns folders first, across several responses', async () => {
  const fake = new FakeFlipper();
  fake.dirs.add('/ext/subghz');
  fake.files.set('/ext/a.txt', new Uint8Array(3));
  const f = new Flipper(fake);
  assert.deepEqual(await f.list('/ext'), [
    { name: 'infrared', isDir: true, size: 0 },
    { name: 'subghz', isDir: true, size: 0 },
    { name: 'a.txt', isDir: false, size: 3 },
  ]);
});

test('errors from the Flipper become RpcError', async () => {
  const f = new Flipper(new FakeFlipper());
  await assert.rejects(f.list('/nope'), (e) => e instanceof RpcError && e.statusName === 'ERROR_STORAGE_NOT_EXIST');
});

test('upload in chunks then download gives the same bytes', async () => {
  const fake = new FakeFlipper();
  const f = new Flipper(fake);
  const data = new Uint8Array(1300).map((_, i) => i % 251);
  const progress = [];
  await f.write('/ext/big.bin', data, (n) => progress.push(n));
  assert.deepEqual(progress, [512, 1024, 1300]);
  const writeParts = fake.received.filter((m) => m.content === 'storage_write_request');
  assert.equal(writeParts.length, 3);
  assert.deepEqual(writeParts.map((m) => m.has_next), [true, true, false]);
  assert.deepEqual(await f.read('/ext/big.bin'), data);
});

test('empty file upload still sends one part', async () => {
  const fake = new FakeFlipper();
  await new Flipper(fake).write('/ext/empty.txt', new Uint8Array(0));
  assert.equal(fake.files.get('/ext/empty.txt').length, 0);
});

test('button press sends press, short, release', async () => {
  const fake = new FakeFlipper();
  await new Flipper(fake).pressButton('OK');
  assert.deepEqual(
    fake.inputs.map((i) => [i.key ?? 0, i.type ?? 0]),
    [[InputKey.OK, InputType.PRESS], [InputKey.OK, InputType.SHORT], [InputKey.OK, InputType.RELEASE]],
  );
});

test('screen frames without a pending request go to listeners', async () => {
  const fake = new FakeFlipper();
  const f = new Flipper(fake);
  const frames = [];
  f.onScreenFrame((fr) => frames.push(fr));
  fake.reply({ command_id: 0, gui_screen_frame: { data: new Uint8Array(1024).fill(1) } });
  assert.equal(frames.length, 1);
  assert.equal(frames[0].data.length, 1024);
});

test('startApp falls back to Momentum app names (Bad USB -> Bad KB)', async () => {
  const fake = new FakeFlipper();
  const orig = fake.handle.bind(fake);
  fake.handle = (m) => {
    if (m.content === 'app_start_request' && m.app_start_request.name === 'Bad USB') {
      fake.received.push(m);
      return fake.reply({ command_id: m.command_id, command_status: 15, empty: {} });
    }
    orig(m);
  };
  const used = await new Flipper(fake).startApp('Bad USB', '/ext/badusb/a.txt');
  assert.equal(used, 'Bad KB');
});

test('startApp does not retry when another app is open', async () => {
  const fake = new FakeFlipper();
  fake.handle = (m) => fake.reply({ command_id: m.command_id, command_status: 17, empty: {} });
  await assert.rejects(new Flipper(fake).startApp('Bad USB'), /Another app is open/);
});

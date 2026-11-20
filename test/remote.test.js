import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIrFile } from '../src/remote/irfile.js';
import { parseInfrared } from '../src/flipper/flipperformat.js';
import { RemoteSender, REMOTE_PATH } from '../src/remote/sender.js';
import { Flipper } from '../src/flipper/api.js';
import { FakeFlipper } from '../src/flipper/demo.js';
import brands from '../src/remote/tv-codes.js';

test('built .ir file reads back with the same buttons', () => {
  const text = buildIrFile([
    { name: 'ok', code: { p: 'Samsung32', a: '07 00 00 00', c: '68 00 00 00' } },
    { name: 'power', code: { f: 38000, d: 0.33, r: '9000 4500 560 560' } },
  ]);
  const s = parseInfrared(text);
  assert.deepEqual(s.map((x) => [x.name, x.type]), [['ok', 'parsed'], ['power', 'raw']]);
  assert.equal(s[0].command, '68 00 00 00');
  assert.equal(s[1].duty_cycle, '0.330000');
});

test('every bundled code set has power and valid codes', () => {
  assert.ok(brands.length > 50);
  for (const b of brands) {
    for (const set of b.sets) {
      assert.ok(set.keys.power, `${b.name} ${set.from} has no power`);
      for (const code of Object.values(set.keys)) assert.ok((code.p && code.a && code.c) || (code.f && code.r));
    }
  }
  const samsung = brands.find((b) => b.name === 'Samsung');
  assert.ok(samsung.sets[0].keys.ok, 'Samsung has OK');
});

test('sender uploads once, then presses by index', async () => {
  const fake = new FakeFlipper();
  fake.dirs.add('/ext/apps_data');
  const r = new RemoteSender(new Flipper(fake));
  const entries = [
    { name: 'power', code: { p: 'NEC', a: '04 00 00 00', c: '08 00 00 00' } },
    { name: 'ok', code: { p: 'NEC', a: '04 00 00 00', c: '44 00 00 00' } },
  ];
  await r.load(entries);
  await r.send('ok');
  await r.load(entries); // same buttons: no new upload
  await r.send('power');
  const writes = fake.received.filter((m) => m.content === 'storage_write_request');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].storage_write_request.path, REMOTE_PATH);
  const presses = fake.received.filter((m) => m.content === 'app_button_press_release_request');
  assert.deepEqual(presses.map((m) => m.app_button_press_release_request.index ?? 0), [1, 0]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Flipper } from '../src/flipper/api.js';
import { Emulator } from '../src/flipper/emulate.js';
import { FakeFlipper } from '../src/flipper/demo.js';

const sent = (fake) => fake.received.map((m) => m.content);

test('IR send: open app in RPC mode, load file, press-release by index', async () => {
  const fake = new FakeFlipper();
  const f = new Flipper(fake);
  const em = new Emulator(f, 'ir', '/ext/infrared/tv.ir');
  await em.sendIr(1, 'Vol_up');
  await em.sendIr(0, 'Power'); // app stays open between presses
  await em.stop();
  assert.deepEqual(sent(fake), [
    'app_start_request',
    'app_load_file_request',
    'system_protobuf_version_request',
    'app_button_press_release_request',
    'app_button_press_release_request',
    'app_exit_request',
  ]);
  const start = fake.received[0].app_start_request;
  assert.deepEqual([start.name, start.args], ['Infrared', 'RPC']);
  assert.equal(fake.received[3].app_button_press_release_request.index, 1);
});

test('Sub-GHz: press then release', async () => {
  const fake = new FakeFlipper();
  const em = new Emulator(new Flipper(fake), 'subghz', '/ext/subghz/a.sub');
  await em.press();
  await em.release();
  await em.stop();
  assert.deepEqual(sent(fake), ['app_start_request', 'app_load_file_request', 'app_button_press_request', 'app_button_release_request', 'app_exit_request']);
  assert.equal(fake.received[0].app_start_request.name, 'Sub-GHz');
});

test('send errors include the Flipper reason', async () => {
  const fake = new FakeFlipper();
  const orig = fake.handle.bind(fake);
  fake.handle = (m) => {
    if (m.content === 'app_button_press_request') return fake.reply({ command_id: m.command_id, command_status: 22, empty: {} });
    if (m.content === 'app_get_error_request') return fake.reply({ command_id: m.command_id, app_get_error_response: { code: 1, text: 'Frequency blocked in your region' } });
    orig(m);
  };
  const em = new Emulator(new Flipper(fake), 'subghz', '/ext/subghz/a.sub');
  await assert.rejects(em.press(), /Frequency blocked/);
});

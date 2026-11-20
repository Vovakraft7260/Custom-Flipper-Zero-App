import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInfrared, parseSubGhz, keyFileSummary, rawDurationMs } from '../src/flipper/flipperformat.js';

const IR = `Filetype: IR signals file
Version: 1
#
name: Power
type: parsed
protocol: NEC
address: 07 00 00 00
command: 02 00 00 00
#
name: Vol_up
type: raw
frequency: 38000
duty_cycle: 0.330000
data: 9024 4512 579 552
`;

test('IR file becomes a list of buttons', () => {
  const s = parseInfrared(IR);
  assert.equal(s.length, 2);
  assert.deepEqual([s[0].name, s[0].protocol], ['Power', 'NEC']);
  assert.deepEqual([s[1].name, s[1].type, s[1].frequency], ['Vol_up', 'raw', '38000']);
});

test('Sub-GHz key file', () => {
  const s = parseSubGhz(`Filetype: Flipper SubGhz Key File
Version: 1
Frequency: 433920000
Preset: FuriHalSubGhzPresetOok650Async
Protocol: Princeton
Bit: 24
Key: 00 00 00 00 00 95 D5 D4
TE: 400
`);
  assert.equal(s.frequencyText, '433.92 MHz');
  assert.equal(s.preset, 'AM650');
  assert.equal(s.protocol, 'Princeton');
  assert.equal(s.isRaw, false);
  assert.equal(s.bits, '24');
});

test('Sub-GHz RAW joins all RAW_Data lines', () => {
  const s = parseSubGhz(`Filetype: Flipper SubGhz RAW File
Frequency: 315000000
Preset: FuriHalSubGhzPreset2FSKDev476Async
Protocol: RAW
RAW_Data: 500 -1000 500
RAW_Data: -2000 1000
`);
  assert.equal(s.isRaw, true);
  assert.deepEqual(s.raw, [500, -1000, 500, -2000, 1000]);
  assert.equal(rawDurationMs(s.raw), 5);
  assert.equal(s.preset, 'FM476');
});

test('NFC summary picks the useful fields', () => {
  const sum = keyFileSummary('nfc', 'Filetype: Flipper NFC device\nDevice type: NTAG215\nUID: 04 85 92\nATQA: 00 44\nSAK: 00\n');
  assert.deepEqual(sum, [['type', 'NTAG215'], ['uid', '04 85 92'], ['atqa', '00 44'], ['sak', '00']]);
});

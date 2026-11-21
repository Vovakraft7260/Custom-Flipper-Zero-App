import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Flipper } from '../src/flipper/api.js';
import { FakeFlipper } from '../src/flipper/demo.js';
import { scanFiles, groupByFolder, makeBackup, readBackup, restoreBackup, backupName } from '../src/backup/backup.js';

function seeded() {
  const fake = new FakeFlipper();
  fake.files.clear();
  fake.dirs.clear();
  for (const d of ['/ext', '/ext/subghz', '/ext/subghz/garage', '/ext/apps', '/ext/nfc']) fake.dirs.add(d);
  fake.files.set('/ext/subghz/garage/door.sub', new TextEncoder().encode('Filetype: Flipper SubGhz Key File\n'));
  fake.files.set('/ext/nfc/card.nfc', new TextEncoder().encode('Filetype: Flipper NFC device\n'));
  fake.files.set('/ext/apps/game.fap', new Uint8Array([1, 2, 3]));
  fake.files.set('/ext/notes.txt', new TextEncoder().encode('hi'));
  return fake;
}

test('backs up the chosen folders and restores them', async () => {
  const fake = seeded();
  const f = new Flipper(fake);
  const files = await scanFiles(f, '/ext');
  const groups = groupByFolder(files);
  assert.deepEqual(groups.map((g) => [g.name, g.files.length, g.skip]), [['(files in /ext)', 1, false], ['apps', 1, true], ['nfc', 1, false], ['subghz', 1, false]]);
  const chosen = groups.filter((g) => !g.skip).flatMap((g) => g.files);
  const { zip, count } = await makeBackup(f, chosen);
  assert.equal(count, 3);
  assert.match(backupName(new Date(2026, 0, 2, 3, 4)), /flipper-backup-2026-01-02-0304\.zip/);

  // Wipe and restore onto a fresh Flipper
  const fresh = new FakeFlipper();
  fresh.files.clear();
  fresh.dirs.clear();
  fresh.dirs.add('/ext');
  fresh.files.set('/ext/notes.txt', new TextEncoder().encode('newer'));
  const back = await readBackup(zip);
  const r = await restoreBackup(new Flipper(fresh), back, { replace: false });
  assert.deepEqual(r, { written: 2, kept: 1 });
  assert.equal(new TextDecoder().decode(fresh.files.get('/ext/subghz/garage/door.sub')).slice(0, 8), 'Filetype');
  assert.equal(new TextDecoder().decode(fresh.files.get('/ext/notes.txt')), 'newer');
  await restoreBackup(new Flipper(fresh), back, { replace: true });
  assert.equal(new TextDecoder().decode(fresh.files.get('/ext/notes.txt')), 'hi');
});

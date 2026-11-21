import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandIndex, listFolder, searchEntries, rawUrl, flipperDest, categoryCounts, catOf } from '../src/library/catalog.js';

const index = {
  v: 1,
  generated: '2026-11-21T00:00:00Z',
  sources: [
    { id: 'irdb', name: 'IRDB', repo: 'a/irdb', sha: 'abc', license: 'CC0', root: '', dirs: ['TVs/Samsung', 'TVs/LG', 'ACs'], files: [[0, 'Samsung_TV.ir'], [0, 'Samsung 2.ir'], [1, 'LG.ir'], [2, 'Daikin.ir'], [2, 'notes.md']] },
    { id: 'bad', name: 'Bad', repo: 'b/bad', sha: 'def', license: 'GPL', root: 'Payloads', dirs: ['Wifi-Grab'], files: [[0, 'payload.txt']] },
  ],
};
const lib = expandIndex(index);

test('categories and counts', () => {
  assert.equal(catOf('x.SUB'), 'subghz');
  assert.deepEqual(categoryCounts(lib), { ir: 4, badusb: 1 });
});

test('folder browsing', () => {
  const top = listFolder(lib.sources[0], 'ir');
  assert.deepEqual(top.dirs.map((d) => [d.name, d.count]), [['ACs', 1], ['TVs', 3]]);
  const tvs = listFolder(lib.sources[0], 'ir', 'TVs');
  assert.deepEqual(tvs.dirs.map((d) => d.name), ['LG', 'Samsung']);
  assert.deepEqual(listFolder(lib.sources[0], 'ir', 'TVs/Samsung').files.map((f) => f.name), ['Samsung 2.ir', 'Samsung_TV.ir']);
});

test('search matches all words in path', () => {
  assert.deepEqual(searchEntries(lib, 'ir', 'samsung tv').map((e) => e.name), ['Samsung_TV.ir', 'Samsung 2.ir']);
  assert.equal(searchEntries(lib, 'ir', 'tv lg')[0].name, 'LG.ir');
  assert.deepEqual(searchEntries(lib, 'ir', 'daikin').map((e) => e.name), ['Daikin.ir']);
  assert.deepEqual(searchEntries(lib, 'ir', '  '), []);
});

test('urls and flipper paths', () => {
  const sam = searchEntries(lib, 'ir', 'samsung 2')[0];
  assert.equal(rawUrl(sam), 'https://raw.githubusercontent.com/a/irdb/abc/TVs/Samsung/Samsung%202.ir');
  assert.equal(flipperDest(sam), '/ext/infrared/library/Samsung 2.ir');
  const bad = lib.sources[1].entries[0];
  assert.equal(rawUrl(bad), 'https://raw.githubusercontent.com/b/bad/def/Payloads/Wifi-Grab/payload.txt');
  assert.equal(flipperDest(bad), '/ext/badusb/library/Wifi-Grab.txt');
});

test('rejects unknown index format', () => {
  assert.throws(() => expandIndex({ v: 9 }));
});

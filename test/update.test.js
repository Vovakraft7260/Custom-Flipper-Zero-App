import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickUpdate, buildNumber } from '../src/update.js';

const release = (tag, assets = ['0ilrig-trmnl-0.6.12.apk'], extra = {}) => ({
  tag_name: tag,
  name: `0ilrig Trmnl ${tag}`,
  assets: assets.map((name) => ({ name, browser_download_url: `https://x/${name}` })),
  ...extra,
});

test('reads build number from tag', () => {
  assert.equal(buildNumber(release('build-12')), 12);
  assert.equal(buildNumber(release('v1.0', [], { body: 'build 30' })), 30);
  assert.equal(buildNumber(release('nope')), 0);
});

test('offers only newer, signed, published builds', () => {
  assert.equal(pickUpdate(release('build-12'), 11).url, 'https://x/0ilrig-trmnl-0.6.12.apk');
  assert.equal(pickUpdate(release('build-12'), 12), null);
  assert.equal(pickUpdate(release('build-12', ['a-debug.apk']), 1), null);
  assert.equal(pickUpdate(release('build-12', [], {}), 1), null);
  assert.equal(pickUpdate(release('build-12', undefined, { prerelease: true }), 1), null);
  assert.equal(pickUpdate(null, 1), null);
});

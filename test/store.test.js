import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Flipper } from '../src/flipper/api.js';
import { FakeFlipper } from '../src/flipper/demo.js';
import { sdkFromInfo, listApps, getApp, buildManifest, parseManifest, findUpdates, appPath, statusProblem } from '../src/store/catalog.js';
import { installApp, installedApps, uninstallApp } from '../src/store/installer.js';

const shortApp = {
  _id: 'app1', alias: 'snake_game', category_id: 'cat1', updated_at: '2026-01-01',
  current_version: { _id: 'ver2', version: '1.2', name: 'Snake', short_description: 'Eat apples', icon_uri: 'https://x/icon.png', screenshots: ['https://x/s1.png'], status: 'READY' },
};

function fakeHttp() {
  const calls = [];
  return {
    calls,
    async json(url, opts) {
      calls.push({ url, ...opts });
      if (url.endsWith('/v0/1/application')) return [shortApp];
      if (url.includes('/v0/0/application/app1')) return { ...shortApp, current_version: { ...shortApp.current_version, description: 'Long text', changelog: 'fixes', current_build: { sdk: { api: '87.1' } }, links: { source_code: { uri: 'https://github.com/x' } } } };
      throw new Error('unexpected ' + url);
    },
    async bytes(url) {
      calls.push({ url });
      if (url.includes('/build/compatible')) return new Uint8Array([1, 2, 3, 4, 5]);
      if (url.endsWith('icon.png')) return new Uint8Array([9, 9]);
      throw new Error('unexpected ' + url);
    },
  };
}

test('reads firmware API from device info', () => {
  assert.deepEqual(sdkFromInfo({ firmware_api_major: '87', firmware_api_minor: '1', hardware_target: '7' }), { target: 'f7', api: '87.1' });
  assert.equal(sdkFromInfo({}), null);
});

test('lists and details apps with the firmware API', async () => {
  const http = fakeHttp();
  const sdk = { target: 'f7', api: '87.1' };
  const [a] = await listApps(http, sdk, { search: 'snake', categoryId: 'cat1' });
  assert.equal(a.name, 'Snake');
  assert.equal(a.versionId, 'ver2');
  const body = http.calls[0].body;
  assert.equal(body.api, '87.1');
  assert.equal(body.query, 'snake');
  assert.equal(body.is_latest_release_version, true);
  const d = await getApp(http, sdk, 'app1');
  assert.equal(d.buildApi, '87.1');
  assert.equal(d.sourceUrl, 'https://github.com/x');
  assert.match(http.calls[1].url, /application\/app1\?target=f7&api=87\.1$/);
});

test('manifest round trip and update detection', () => {
  const text = buildManifest({ fullName: 'Snake', sdkApi: '87.1', uid: 'app1', versionUid: 'ver1', path: '/ext/apps/Games/snake_game.fap' });
  const m = parseManifest(text, 'snake_game.fim');
  assert.deepEqual(m, { alias: 'snake_game', uid: 'app1', versionUid: 'ver1', path: '/ext/apps/Games/snake_game.fap', fullName: 'Snake', sdkApi: '87.1' });
  const ups = findUpdates([m], [{ id: 'app1', versionId: 'ver2' }]);
  assert.equal(ups.length, 1);
  assert.equal(findUpdates([m], [{ id: 'app1', versionId: 'ver1' }]).length, 0);
  assert.equal(statusProblem('READY'), null);
  assert.ok(statusProblem('FLIPPER_OUTDATED'));
});

test('installs, lists and removes an app on the Flipper', async () => {
  const fake = new FakeFlipper();
  const f = new Flipper(fake);
  const http = fakeHttp();
  const sdk = { target: 'f7', api: '87.1' };
  const app = await getApp(http, sdk, 'app1');
  const steps = [];
  await installApp(f, sdk, app, 'Games', { http, step: (s) => steps.push(s) });
  const dest = appPath('Games', 'snake_game');
  assert.deepEqual([...fake.files.get(dest)], [1, 2, 3, 4, 5]);
  assert.ok(steps.includes('installing…'));
  const [m] = await installedApps(f);
  assert.equal(m.uid, 'app1');
  assert.equal(m.path, dest);
  assert.ok(new TextDecoder().decode(fake.files.get('/ext/apps_manifests/snake_game.fim')).includes('Icon: CQk='));
  await uninstallApp(f, m);
  assert.equal(fake.files.has(dest), false);
  assert.deepEqual(await installedApps(f), []);
});

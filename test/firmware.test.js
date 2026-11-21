import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDirectory, parseGithubReleases, currentFirmware, loadChannels, FIRMWARES } from '../src/firmware/sources.js';
import { readPackage, installPackage, sha256Hex } from '../src/firmware/install.js';
import { Flipper } from '../src/flipper/api.js';
import { FakeFlipper } from '../src/flipper/demo.js';
import { writeZip } from '../src/assets/archive.js';

const dir = {
  channels: [
    { id: 'development', title: 'Dev', versions: [{ version: 'abc123', changelog: 'x', timestamp: 1700000000, files: [{ url: 'https://u/dev.tgz', target: 'f7', type: 'update_tgz', sha256: 'aa' }, { url: 'https://u/dev.dfu', target: 'f7', type: 'full_dfu' }] }] },
    { id: 'release', title: 'Release', versions: [{ version: 'mntm-010', changelog: 'y', timestamp: 1700000000, files: [{ url: 'https://u/rel.tgz', target: 'f7', type: 'update_tgz', sha256: 'bb' }] }] },
    { id: 'empty', versions: [{ version: 'z', files: [{ type: 'full_dfu', target: 'f7' }] }] },
  ],
};

test('reads update server lists into channels, stable first', () => {
  const ch = parseDirectory(dir);
  assert.deepEqual(ch.map((c) => [c.id, c.title, c.versions[0].url]), [
    ['release', 'stable', 'https://u/rel.tgz'],
    ['development', 'dev (newest, may have bugs)', 'https://u/dev.tgz'],
  ]);
  assert.equal(ch[0].versions[0].date, '2023-11-14');
});

test('reads GitHub releases as stable and release candidate', () => {
  const ch = parseGithubReleases([
    { tag_name: 'v2-rc', prerelease: true, assets: [{ name: 'flipper-z-f7-update-v2-rc.tgz', browser_download_url: 'https://g/rc.tgz' }] },
    { tag_name: 'v1', prerelease: false, assets: [{ name: 'flipper-z-f7-update-v1.tgz', browser_download_url: 'https://g/v1.tgz', digest: 'sha256:cc' }, { name: 'sdk.zip' }] },
    { tag_name: 'draft', draft: true, assets: [{ name: 'update.tgz' }] },
  ]);
  assert.deepEqual(ch.map((c) => [c.id, c.versions.map((v) => v.version)]), [['release', ['v1']], ['release-candidate', ['v2-rc']]]);
  assert.equal(ch[0].versions[0].sha256, 'cc');
});

test('falls back to GitHub when the update server fails', async () => {
  const http = {
    json: async (url) => {
      if (url.includes('api.github.com')) return [{ tag_name: 'v1', assets: [{ name: 'flipper-z-f7-update-v1.tgz', browser_download_url: 'x' }] }];
      throw new Error('offline');
    },
  };
  const r = await loadChannels(http, FIRMWARES[0]);
  assert.equal(r.from, 'GitHub');
});

test('knows which firmware is running', () => {
  assert.equal(currentFirmware({ firmware_origin_fork: 'Momentum', firmware_version: 'mntm-010' }).firmware.id, 'momentum');
  assert.equal(currentFirmware({ firmware_origin_fork: 'Official', firmware_version: '1.3.4' }).firmware.id, 'official');
  assert.equal(currentFirmware({ firmware_origin_fork: 'Unleashed' }).firmware.id, 'unleashed');
});

test('sends an update package and starts the update', async () => {
  const pkgBytes = writeZip([
    { path: 'f7-update-mntm-010/update.fuf', data: new TextEncoder().encode('Filetype: Flipper firmware upgrade configuration\n') },
    { path: 'f7-update-mntm-010/firmware.dfu', data: new Uint8Array(3000).fill(7) },
    { path: 'f7-update-mntm-010/res/a.txt', data: new TextEncoder().encode('hi') },
  ]);
  assert.equal((await sha256Hex(new Uint8Array([1]))).length, 64);
  const pkg = await readPackage(pkgBytes);
  assert.equal(pkg.folder, 'f7-update-mntm-010');
  const fake = new FakeFlipper();
  const f = new Flipper(fake);
  let last;
  const base = await installPackage(f, pkg, { progress: (p) => (last = p) });
  assert.equal(base, '/ext/update/f7-update-mntm-010');
  assert.equal(fake.files.get(`${base}/firmware.dfu`).length, 3000);
  assert.equal(new TextDecoder().decode(fake.files.get(`${base}/res/a.txt`)), 'hi');
  assert.equal(last.sent, last.total);
  const upd = fake.received.find((m) => m.content === 'system_update_request');
  assert.equal(upd.system_update_request.update_manifest, `${base}/update.fuf`);
  assert.ok(fake.received.some((m) => m.content === 'system_reboot_request' && m.system_reboot_request.mode === 2));
});

test('refuses archives that are not firmware', async () => {
  await assert.rejects(readPackage(writeZip([{ path: 'x.txt', data: new Uint8Array(1) }])), /update\.fuf/);
});

test('skips files already copied correctly and recopies damaged ones', async () => {
  const pkg = await readPackage(writeZip([
    { path: 'u/update.fuf', data: new TextEncoder().encode('m') },
    { path: 'u/firmware.dfu', data: new Uint8Array(1500).fill(3) },
  ]));
  const fake = new FakeFlipper();
  fake.dirs.add('/ext/update');
  fake.dirs.add('/ext/update/u');
  fake.files.set('/ext/update/u/update.fuf', new TextEncoder().encode('m')); // left from a dropped try
  fake.files.set('/ext/update/u/firmware.dfu', new Uint8Array(1500).fill(9)); // wrong content
  await installPackage(new Flipper(fake), pkg);
  const writes = fake.received.filter((m) => m.content === 'storage_write_request').map((m) => m.storage_write_request.path);
  assert.ok(!writes.includes('/ext/update/u/update.fuf'));
  assert.ok(writes.includes('/ext/update/u/firmware.dfu'));
  assert.equal(fake.files.get('/ext/update/u/firmware.dfu')[0], 3);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
Object.defineProperty(globalThis.localStorage, 'keys', { value: () => [...store.keys()] });
const { cached } = await import('../src/store/cache.js');

test('shows saved copy first, then fresh data once', async () => {
  const shown = [];
  await cached('k', async () => [1], (d, m) => shown.push([d, m.fresh]));
  assert.deepEqual(shown, [[[1], true]]);
  shown.length = 0;
  await cached('k', async () => [2], (d, m) => shown.push([d, m.fresh]), { maxAgeMs: 0 });
  assert.deepEqual(shown, [[[1], false], [[2], true]]);
  shown.length = 0;
  await cached('k', async () => { throw new Error('offline'); }, (d, m) => shown.push([d, m.fresh]), { maxAgeMs: 0 });
  assert.deepEqual(shown, [[[2], false]]);
  await assert.rejects(cached('other', async () => { throw new Error('offline'); }, () => {}));
});

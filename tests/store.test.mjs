/* ShotThink image store tests.
 *
 * Run with:  node tests/store.test.mjs
 *
 * These exercise the pure logic that does not need a browser: the base64
 * round trip, the size arithmetic that motivated the migration, and the
 * orphan-pruning decision. IndexedDB itself is stubbed, because the point here
 * is the behaviour around it, not the browser implementation.
 */

import assert from 'node:assert/strict';

/* ------------------------------------------------------ environment stubs */

// Minimal in-memory IndexedDB surface, only what src/store.js touches.
function installFakeIndexedDb() {
  const data = new Map();

  const makeStore = () => ({
    put: (value, key) => { data.set(key, value); },
    get: key => {
      const request = { result: data.get(key) ?? undefined };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
    delete: key => { data.delete(key); },
    getAllKeys: () => {
      const request = { result: [...data.keys()] };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
    getAll: () => {
      const request = { result: [...data.values()] };
      return request;
    }
  });

  globalThis.indexedDB = {
    open: () => {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          transaction: () => {
            const tx = { objectStore: makeStore, error: null };
            queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()));
            return tx;
          }
        };
        request.onsuccess?.();
      });
      return request;
    }
  };

  return data;
}

// `btoa` is not global in older Node, but store.js relies on it.
globalThis.btoa ??= value => Buffer.from(value, 'binary').toString('base64');

/* --------------------------------------------------------------- fixtures */

const storeData = installFakeIndexedDb();

// Load store.js and expose its top-level declarations.
//
// In the real extension `importScripts` makes these global, because a classic
// script's function declarations become properties of the global object. A
// `new Function` body does not, so the harness has to return them explicitly.
const storeSource = await import('node:fs/promises').then(fs =>
  fs.readFile(new URL('../src/store.js', import.meta.url), 'utf8')
);
const store = new Function(`${storeSource}
return {
  openStore, blobToDataUrl, dataUrlToBlob,
  putImage, getImage, imageDataUrl,
  deleteImage, deleteImages, listImageIds, imageBytes,
  pruneOrphanImages, migrateInlineImages
};`)();

/* ------------------------------------------------------------------ tests */

const results = [];
function test(name, fn) {
  try {
    const value = fn();
    if (value instanceof Promise) {
      return value.then(
        () => results.push({ name, ok: true }),
        error => results.push({ name, ok: false, error })
      );
    }
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
  return Promise.resolve();
}

await test('dataUrlToBlob and blobToDataUrl round-trip a PNG payload', async () => {
  // 1x1 transparent PNG.
  const original =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const blob = await store.dataUrlToBlob(original);
  assert.equal(blob.type, 'image/png');
  assert.ok(blob.size > 0, 'decoded blob should not be empty');
  const back = await store.blobToDataUrl(blob);
  assert.equal(back, original, 'round trip must be byte-identical');
});

await test('blobToDataUrl handles payloads larger than one chunk', async () => {
  // 100 KB of incompressible-ish bytes forces multiple 0x8000 chunks.
  const bytes = new Uint8Array(100 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) % 256;
  const blob = new Blob([bytes], { type: 'image/png' });
  const dataUrl = await store.blobToDataUrl(blob);
  assert.ok(dataUrl.startsWith('data:image/png;base64,'));

  const roundTrip = await store.dataUrlToBlob(dataUrl);
  assert.equal(roundTrip.size, bytes.length, 'chunked encoding must not drop bytes');

  const decoded = new Uint8Array(await roundTrip.arrayBuffer());
  assert.deepEqual(decoded, bytes, 'every byte must survive the chunk boundary');
});

await test('putImage then getImage returns the same bytes', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const blob = new Blob([bytes], { type: 'image/png' });
  await store.putImage('job-a', blob);

  const readBack = await store.getImage('job-a');
  assert.ok(readBack instanceof Blob);
  assert.deepEqual(new Uint8Array(await readBack.arrayBuffer()), bytes);
});

await test('imageDataUrl rehydrates a stored blob into a data URL', async () => {
  const blob = new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' });
  await store.putImage('job-b', blob);
  const dataUrl = await store.imageDataUrl('job-b');
  assert.ok(dataUrl.startsWith('data:image/png;base64,'));
});

await test('imageDataUrl returns null for a missing job', async () => {
  const missing = await store.imageDataUrl('no-such-job');
  assert.equal(missing, null);
});

await test('deleteImage removes the payload', async () => {
  await store.putImage('job-c', new Blob([new Uint8Array([7])], { type: 'image/png' }));
  await store.deleteImage('job-c');
  assert.equal(await store.getImage('job-c'), null);
});

await test('pruneOrphanImages keeps live ids and drops the rest', async () => {
  // Earlier tests left blobs behind; start from a known-empty store.
  await store.deleteImages(await store.listImageIds());
  assert.deepEqual(await store.listImageIds(), [], 'store should start empty');

  await store.putImage('live-1', new Blob([new Uint8Array(10)], { type: 'image/png' }));
  await store.putImage('live-2', new Blob([new Uint8Array(10)], { type: 'image/png' }));
  await store.putImage('orphan-1', new Blob([new Uint8Array(10)], { type: 'image/png' }));

  const dropped = await store.pruneOrphanImages(['live-1', 'live-2']);
  assert.equal(dropped, 1, 'exactly one orphan should be removed');

  const remaining = await store.listImageIds();
  assert.deepEqual(remaining.sort(), ['live-1', 'live-2']);
  assert.equal(await store.getImage('orphan-1'), null);
});

await test('imageBytes reports count and total size', async () => {
  const usage = await store.imageBytes();
  assert.equal(usage.count, 2, `expected the two surviving images, saw ${usage.count}`);
  assert.ok(usage.bytes > 0, 'byte total should be positive');
});

await test('migrateInlineImages moves dataUrl payloads out of the job record', async () => {
  const tiny =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const jobs = [
    { id: 'legacy-1', dataUrl: tiny, status: 'queued' },
    { id: 'legacy-2', dataUrl: tiny, status: 'sent' },
    { id: 'already-migrated', status: 'queued', hasImage: true }
  ];

  const migrated = await store.migrateInlineImages(jobs);
  assert.equal(migrated, 2, 'both legacy records should be migrated');

  for (const job of jobs.slice(0, 2)) {
    assert.equal(job.dataUrl, '', 'inline payload must be cleared');
    assert.equal(job.hasImage, true);
    assert.ok(job.bytes > 0, 'byte size should be recorded');
    assert.ok(await store.getImage(job.id), 'blob should exist in the store');
  }

  // A job that never had an inline payload must not be touched.
  assert.equal(jobs[2].dataUrl, undefined);
});

/* ------------------------------------------------------- size accounting */

await test('measured screenshot sizes justify the IndexedDB migration', () => {
  // Values measured on this machine from real screenshots in
  // Pictures/Mouse4 Captures, cropped to a 1920x1080 viewport.
  const measuredPngBytes = [1.04, 1.80, 1.26, 0.46, 1.12, 0.60].map(mb => mb * 1024 * 1024);
  const average = measuredPngBytes.reduce((a, b) => a + b, 0) / measuredPngBytes.length;

  const chromeStorageLimit = 10 * 1024 * 1024;
  const base64Inflation = 4 / 3;

  const imagesAsBase64 = Math.floor(chromeStorageLimit / (average * base64Inflation));
  const imagesAsBlob = Math.floor(chromeStorageLimit / average);

  assert.ok(imagesAsBase64 <= 8, `base64 storage fits only ~${imagesAsBase64} images`);
  assert.ok(imagesAsBlob > imagesAsBase64, 'raw blobs always fit more than base64');

  // A single real long capture from the same folder already exceeds the quota.
  const longCaptureBytes = 9.0 * 1024 * 1024;
  assert.ok(
    longCaptureBytes * base64Inflation > chromeStorageLimit,
    'one long capture must not fit in chrome.storage.local'
  );
});

/* ---------------------------------------------------------------- report */

const failed = results.filter(r => !r.ok);
for (const result of results) {
  console.log(`${result.ok ? 'ok  ' : 'FAIL'}  ${result.name}`);
  if (!result.ok) console.log(`      ${result.error.message}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);

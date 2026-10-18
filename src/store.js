/* ShotThink image store.
 *
 * Why this exists
 * ---------------
 * `chrome.storage.local` caps at 10 MB and only holds text, so an image has to
 * be base64-encoded (+33%) before it can be stored. Measured against real
 * screenshots on this machine, a plain 1920x1080 page is about 1.05 MB as PNG
 * and about 1.39 MB once base64-encoded. That is roughly seven images before
 * the quota is gone, and a single stitched long capture is already 9 MB.
 *
 * IndexedDB keeps the original bytes: no inflation, and no 10 MB ceiling. So
 * `chrome.storage.local` is left holding only the small metadata that routing
 * needs (id, status, day, conversation URL).
 *
 * The queue therefore looks like:
 *
 *   chrome.storage.local -> jobs: [{ id, name, status, day, url, bytes }]
 *   IndexedDB            -> images: id -> Blob
 *
 * `sender.js` is unchanged: the worker rehydrates `job.dataUrl` in memory just
 * before handing the job over, so the content script still sees what it expects.
 */

const STORE_DB = 'shotthink';
const STORE_VERSION = 1;
const STORE_IMAGES = 'images';

let storeDbPromise = null;

function openStore() {
  if (storeDbPromise) return storeDbPromise;
  storeDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(STORE_DB, STORE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error('无法打开本地图片存储。'));
    request.onblocked = () => reject(Error('本地图片存储被其他标签页占用，请关闭旧的 ShotThink 页面。'));
  });
  // A failed open must not be cached, or every later call fails the same way.
  storeDbPromise.catch(() => { storeDbPromise = null; });
  return storeDbPromise;
}

function runTransaction(mode, fn) {
  return openStore().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, mode);
    const store = tx.objectStore(STORE_IMAGES);
    let result;
    try {
      result = fn(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || Error('本地图片存储写入失败。'));
    tx.onabort = () => reject(tx.error || Error('本地图片存储操作已中止。'));
  }));
}

/* ------------------------------------------------------------ conversions */

/**
 * Base64-encode a Blob.
 *
 * `FileReader` is not reliably present in every worker context, so this walks
 * the bytes directly. Chunking keeps `String.fromCharCode` from overflowing the
 * call stack on a multi-megabyte image.
 */
async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunk));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

/* ---------------------------------------------------------------- public */

async function putImage(id, blob) {
  await runTransaction('readwrite', store => store.put(blob, id));
  return blob.size;
}

async function getImage(id) {
  return openStore().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const request = tx.objectStore(STORE_IMAGES).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || Error('无法读取本地图片。'));
  }));
}

/** Rehydrate a stored image into the data URL that `sender.js` expects. */
async function imageDataUrl(id) {
  const blob = await getImage(id);
  if (!blob) return null;
  return blobToDataUrl(blob);
}

async function deleteImage(id) {
  await runTransaction('readwrite', store => store.delete(id));
}

async function deleteImages(ids) {
  if (!ids.length) return;
  await runTransaction('readwrite', store => {
    for (const id of ids) store.delete(id);
  });
}

async function listImageIds() {
  return openStore().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const request = tx.objectStore(STORE_IMAGES).getAllKeys();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || Error('无法列出本地图片。'));
  }));
}

/** Total bytes currently held, for the queue guard and the options page. */
async function imageBytes() {
  return openStore().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const store = tx.objectStore(STORE_IMAGES);
    const keys = store.getAllKeys();
    const values = store.getAll();
    tx.oncomplete = () => {
      const sizes = (values.result || []).map(blob => blob?.size || 0);
      resolve({ count: sizes.length, bytes: sizes.reduce((n, size) => n + size, 0) });
    };
    tx.onerror = () => reject(tx.error || Error('无法统计本地图片占用。'));
    void keys;
  }));
}

/**
 * Drop images that no live job refers to.
 *
 * Interrupted runs can leave a Blob behind after its job was already sent,
 * archived, or cleared. Called on startup so the store cannot grow forever.
 */
async function pruneOrphanImages(activeIds) {
  const keep = new Set(activeIds);
  const stored = await listImageIds();
  const stale = stored.filter(id => !keep.has(id));
  await deleteImages(stale);
  return stale.length;
}

/**
 * Move any legacy `dataUrl` payloads out of `chrome.storage.local`.
 *
 * Earlier builds kept the bitmap inside the job record. Anyone upgrading would
 * otherwise carry the old quota problem forward.
 */
async function migrateInlineImages(jobs) {
  const legacy = jobs.filter(job => typeof job.dataUrl === 'string' && job.dataUrl.startsWith('data:'));
  if (!legacy.length) return 0;
  for (const job of legacy) {
    try {
      const blob = await dataUrlToBlob(job.dataUrl);
      job.bytes = await putImage(job.id, blob);
      job.hasImage = true;
    } catch (error) {
      console.error('ShotThink could not migrate an inline image', job.id, error);
      continue;
    } finally {
      job.dataUrl = '';
    }
  }
  return legacy.length;
}

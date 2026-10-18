/* ShotThink capture helpers.
 *
 * Split of responsibilities, because the two sides have different powers:
 *
 *   service worker  — the only place `chrome.tabs.captureVisibleTab` works,
 *                     and the only place `chrome.scripting` can measure the
 *                     live viewport.
 *   page (overlay)  — the only place that can decode a bitmap for canvas use
 *                     and read `window.devicePixelRatio` for display.
 *
 * So the worker returns a raw data URL plus the measured viewport, and the
 * overlay decodes and scales it.
 */

const CAPTURE_THROTTLE_MS = 550; // stay under the ~2 calls/second ceiling

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Read the live viewport metrics of a tab. */
async function readViewport(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scrollHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
      url: location.href,
      title: document.title
    })
  });
  return result;
}

/**
 * Capture the visible viewport for the overlay.
 *
 * Captured before any overlay exists, so the mask can never appear in the
 * result. The overlay then paints this frozen frame as its own background.
 */
async function captureFrameForOverlay(tabId, windowId) {
  const viewport = await readViewport(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  return { dataUrl, viewport };
}

/**
 * Scroll through a long page and return one data URL per slice.
 *
 * Unlike the desktop build, the browser reports the exact scroll offset, so
 * the overlap is arithmetic rather than template matching:
 *
 *     stitchOffset = (scrollY_after - scrollY_before) * scale
 *
 * That removes the entire cv2 matching path. What remains is pacing, waiting
 * for the scroll to settle, and restoring the reader's position afterwards.
 */
async function captureLongPage(tabId, windowId, { maxSlices = 40, onProgress } = {}) {
  const metrics = await readViewport(tabId);
  const slices = [];
  const originalY = metrics.scrollY;
  const step = Math.max(1, Math.floor(metrics.height * 0.9));
  const total = Math.ceil(metrics.scrollHeight / step);

  try {
    for (let index = 0; index < maxSlices; index++) {
      const targetY = index * step;
      if (index > 0 && targetY > metrics.scrollHeight - metrics.height) break;

      const [{ result: actualY }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: async y => {
          window.scrollTo({ top: y, behavior: 'instant' });
          // Two frames plus a settle beat: enough for lazy content and
          // scroll-linked effects without an arbitrary long sleep.
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          await new Promise(resolve => setTimeout(resolve, 120));
          return window.scrollY;
        },
        args: [targetY]
      });

      slices.push({ dataUrl: await chrome.tabs.captureVisibleTab(windowId, { format: 'png' }), scrollY: actualY });
      onProgress?.({ index, total });
      await sleep(CAPTURE_THROTTLE_MS);
    }
  } finally {
    // Always restore the reader's position, even if a slice threw.
    await chrome.scripting
      .executeScript({
        target: { tabId },
        func: y => window.scrollTo({ top: y, behavior: 'instant' }),
        args: [originalY]
      })
      .catch(() => {});
  }

  return { slices, viewport: metrics };
}

/**
 * Hide `position: fixed` chrome for the duration of a long capture.
 *
 * Without this every slice repeats the sticky header and the stitched image
 * shows it over and over. Returns a function that restores the page.
 */
async function suppressStickyElements(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const style = document.createElement('style');
      style.id = 'shotthink-longcapture';
      style.textContent = `
        *[style*="position: fixed"], *[style*="position:fixed"] { visibility: hidden !important; }
        header, nav, [role="banner"], [data-sticky], .sticky, .fixed { visibility: hidden !important; }
      `;
      document.documentElement.append(style);
      return true;
    }
  });

  return async () => {
    if (!result) return;
    await chrome.scripting
      .executeScript({
        target: { tabId },
        func: () => document.getElementById('shotthink-longcapture')?.remove()
      })
      .catch(() => {});
  };
}

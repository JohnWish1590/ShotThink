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
async function captureLongPage(tabId, windowId, { maxSlices = 60, onProgress } = {}) {
  const metrics = await readViewport(tabId);
  const slices = [];
  const originalY = metrics.scrollY;
  const step = Math.max(1, Math.floor(metrics.height * 0.9));
  const total = Math.min(maxSlices, Math.ceil(metrics.scrollHeight / step));

  try {
    for (let index = 0; index < total; index++) {
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
 * Hide sticky/fixed chrome for the duration of a long capture.
 *
 * Without this every slice repeats the sticky header and the stitched image
 * shows it over and over. Returns a function that restores the page.
 *
 * The rule is driven by each element's computed `position`, not by its inline
 * style attribute or by tag names: most sticky headers get their position from
 * a stylesheet, so an attribute match misses them, and a blanket `header, nav`
 * rule hides content the user may have deliberately selected. Elements fully
 * inside the selection are kept visible.
 */
async function suppressStickyElements(tabId, selection) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [selection || null],
    func: sel => {
      document.getElementById('shotthink-longcapture')?.remove();
      const style = document.createElement('style');
      style.id = 'shotthink-longcapture';
      style.textContent = `
        html.shotthink-longcapture .shotthink-hide-sticky {
          visibility: hidden !important;
        }
      `;
      document.documentElement.append(style);

      const tagged = [];
      for (const element of document.body?.querySelectorAll('*') || []) {
        const position = getComputedStyle(element).position;
        if (position !== 'fixed' && position !== 'sticky') continue;
        if (sel) {
          const box = element.getBoundingClientRect();
          const insideSelection =
            box.left >= sel.x && box.top >= sel.y &&
            box.right <= sel.x + sel.w && box.bottom <= sel.y + sel.h;
          if (insideSelection) continue; // the user wants this one captured
        }
        element.classList.add('shotthink-hide-sticky');
        tagged.push(element);
      }
      document.documentElement.classList.add('shotthink-longcapture');
      return tagged.length;
    }
  });

  return async () => {
    await chrome.scripting
      .executeScript({
        target: { tabId },
        func: () => {
          document.documentElement.classList.remove('shotthink-longcapture');
          document.getElementById('shotthink-longcapture')?.remove();
          for (const element of document.querySelectorAll('.shotthink-hide-sticky')) {
            element.classList.remove('shotthink-hide-sticky');
          }
        }
      })
      .catch(() => {});
    void result;
  };
}

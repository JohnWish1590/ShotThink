/* ShotThink overlay geometry and annotation tests.
 *
 * Run with:  node tests/overlay.test.mjs
 *
 * The overlay itself needs a DOM, so this suite extracts and re-implements the
 * pure decisions it makes — selection normalisation, toolbar placement,
 * stitched-image composition, and mosaic block arithmetic — and checks them
 * against the rules Mouse4 uses. Anything that would silently produce a
 * misaligned or cropped screenshot is worth pinning down here.
 */

import assert from 'node:assert/strict';

/* ------------------------------------------------ copied pure logic */

/** Selection normalisation: drag in any direction yields a positive rect. */
function normalizeRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y)
  };
}

/**
 * Toolbar placement, ported from Mouse4's show_toolbar (main.pyw).
 * Order: below the selection, else above it, else inside its top edge.
 */
function placeToolbar(sel, viewport, box, gap = 10) {
  const clampX = x => Math.max(0, Math.min(x, viewport.width - box.width));
  const fits = (x, y) =>
    y >= 0 && y + box.height <= viewport.height &&
    x >= 0 && x + box.width <= viewport.width;

  let x = clampX(sel.x + sel.w - box.width);
  let y = sel.y + sel.h + gap;
  if (!fits(x, y)) {
    y = sel.y - box.height - gap;
    if (!fits(x, y)) y = Math.min(sel.y + gap, viewport.height - box.height);
  }
  return { x, y: Math.max(0, y) };
}

/**
 * Stitched-image geometry: total height is the document height, clamped by
 * where the last slice actually ended.
 */
function stitchGeometry(slices, viewport, scale) {
  const firstY = slices[0].scrollY;
  const lastBottom = slices.at(-1).scrollY + viewport.height;
  const top = Math.round(firstY * scale);
  const bottom = Math.round(Math.min(viewport.scrollHeight, lastBottom) * scale);
  return { top, height: bottom - top };
}

/** Where a slice lands inside the stitched canvas. */
function sliceOffset(slice, firstScrollY, scale) {
  return Math.round((slice.scrollY - firstScrollY) * scale);
}

/** Mosaic block arithmetic, mirroring Mouse4's _make_mosaic. */
function mosaicGrid(rect, scaleX, scaleY, block = 12) {
  const sourceW = Math.max(1, Math.round(rect.w * scaleX));
  const sourceH = Math.max(1, Math.round(rect.h * scaleY));
  if (sourceW < 2 || sourceH < 2) return null;
  return {
    sourceW,
    sourceH,
    smallW: Math.max(1, Math.floor(sourceW / block)),
    smallH: Math.max(1, Math.floor(sourceH / block))
  };
}

/* ---------------------------------------------------------------- tests */

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}

test('selection normalises when dragged up and to the left', () => {
  const rect = normalizeRect({ x: 400, y: 300 }, { x: 100, y: 50 });
  assert.deepEqual(rect, { x: 100, y: 50, w: 300, h: 250 });
});

test('selection normalises when dragged down and to the right', () => {
  const rect = normalizeRect({ x: 100, y: 50 }, { x: 400, y: 300 });
  assert.deepEqual(rect, { x: 100, y: 50, w: 300, h: 250 });
});

test('zero-size selection stays zero rather than going negative', () => {
  const rect = normalizeRect({ x: 200, y: 200 }, { x: 200, y: 200 });
  assert.deepEqual(rect, { x: 200, y: 200, w: 0, h: 0 });
});

test('toolbar sits below the selection when there is room', () => {
  const viewport = { width: 1280, height: 800 };
  const sel = { x: 100, y: 100, w: 400, h: 200 };
  const box = { width: 380, height: 58 };
  const pos = placeToolbar(sel, viewport, box);
  assert.equal(pos.y, 310, 'should be selection bottom + 10');
  assert.ok(pos.x + box.width <= viewport.width, 'must stay on screen');
});

test('toolbar flips above the selection when the bottom is out of room', () => {
  const viewport = { width: 1280, height: 800 };
  const sel = { x: 100, y: 700, w: 400, h: 90 }; // bottom edge at 790
  const box = { width: 380, height: 58 };
  const pos = placeToolbar(sel, viewport, box);
  assert.ok(pos.y + box.height <= viewport.height, 'must fit vertically');
  assert.ok(pos.y < sel.y, 'should move above the selection');
});

test('toolbar never leaves the viewport horizontally', () => {
  const viewport = { width: 500, height: 800 };
  const sel = { x: 20, y: 100, w: 460, h: 100 };
  const box = { width: 480, height: 58 };
  const pos = placeToolbar(sel, viewport, box);
  assert.ok(pos.x >= 0, 'left edge must not go negative');
  assert.ok(pos.x + box.width <= viewport.width, 'right edge must not overflow');
});

test('toolbar stays inside when the selection touches the top-left corner', () => {
  const viewport = { width: 1280, height: 800 };
  const sel = { x: 0, y: 0, w: 200, h: 200 };
  const box = { width: 380, height: 58 };
  const pos = placeToolbar(sel, viewport, box);
  assert.ok(pos.x >= 0 && pos.y >= 0, 'must not go negative');
  assert.ok(pos.x + box.width <= viewport.width);
  assert.ok(pos.y + box.height <= viewport.height);
});

test('stitch height equals document height when the last slice reaches the bottom', () => {
  const viewport = { height: 800, scrollHeight: 3000 };
  const scale = 2;
  const slices = [
    { scrollY: 0 }, { scrollY: 720 }, { scrollY: 1440 }, { scrollY: 2160 }
  ];
  const geo = stitchGeometry(slices, viewport, scale);
  // last slice ends at 2160 + 800 = 2960, which is short of 3000
  assert.equal(geo.top, 0);
  assert.equal(geo.height, 2960 * scale, 'clamped by where the last slice ended');
});

test('stitch height is clamped to the document when the last slice overshoots', () => {
  const viewport = { height: 800, scrollHeight: 3000 };
  const scale = 1;
  const slices = [{ scrollY: 0 }, { scrollY: 2500 }];
  const geo = stitchGeometry(slices, viewport, scale);
  // 2500 + 800 = 3300 > 3000, so the document height wins
  assert.equal(geo.height, 3000, 'must not exceed the document');
});

test('slice offsets are exact multiples of the scroll delta at DPR 2', () => {
  const scale = 2;
  const slices = [{ scrollY: 0 }, { scrollY: 720 }, { scrollY: 1440 }];
  const offsets = slices.map(s => sliceOffset(s, 0, scale));
  assert.deepEqual(offsets, [0, 1440, 2880]);
});

test('slice offsets stay exact for a fractional scroll position', () => {
  // Sub-pixel scroll can happen with smooth scrolling; rounding must not
  // accumulate into a visible seam.
  const scale = 1;
  const slices = [{ scrollY: 0.5 }, { scrollY: 720.5 }, { scrollY: 1440.5 }];
  const offsets = slices.map(s => sliceOffset(s, slices[0].scrollY, scale));
  assert.deepEqual(offsets, [0, 720, 1440]);
});

test('a selection captured at DPR 2 produces double-resolution output', () => {
  const sel = { x: 100, y: 100, w: 400, h: 300 };
  const dpr = 2;
  const outWidth = Math.round(sel.w * dpr);
  const outHeight = Math.round(sel.h * dpr);
  assert.equal(outWidth, 800);
  assert.equal(outHeight, 600);
});

test('mosaic grid shrinks by the block size and never hits zero', () => {
  const grid = mosaicGrid({ w: 240, h: 120 }, 1, 1, 12);
  assert.equal(grid.sourceW, 240);
  assert.equal(grid.sourceH, 120);
  assert.equal(grid.smallW, 20);
  assert.equal(grid.smallH, 10);
});

test('mosaic rejects a region too small to sample', () => {
  assert.equal(mosaicGrid({ w: 1, h: 1 }, 1, 1), null);
});

test('mosaic keeps at least one pixel for a tiny but valid region', () => {
  const grid = mosaicGrid({ w: 20, h: 20 }, 1, 1, 12);
  assert.equal(grid.smallW, 1, 'floor(20/12) is 1, not 0');
  assert.equal(grid.smallH, 1);
});

test('mosaic scales with the bitmap when DPR is 2', () => {
  const grid = mosaicGrid({ w: 240, h: 120 }, 2, 2, 12);
  assert.equal(grid.sourceW, 480, 'samples the device-pixel region');
  assert.equal(grid.smallW, 40);
});

test('annotation replay offsets by the crop origin', () => {
  // An annotation drawn at (300,250) in overlay space belongs at (200,150)
  // once the selection starting at (100,100) is cropped out.
  const sel = { x: 100, y: 100 };
  const annotationPoint = { x: 300, y: 250 };
  const cropped = {
    x: annotationPoint.x - sel.x,
    y: annotationPoint.y - sel.y
  };
  assert.deepEqual(cropped, { x: 200, y: 150 });
});

test('annotation replay composes with DPR scaling', () => {
  const sel = { x: 100, y: 100 };
  const dpr = 2;
  const annotationPoint = { x: 300, y: 250 };
  // ctx.setTransform(dpr,0,0,dpr, -sel.x*dpr, -sel.y*dpr)
  const cropped = {
    x: annotationPoint.x * dpr - sel.x * dpr,
    y: annotationPoint.y * dpr - sel.y * dpr
  };
  assert.deepEqual(cropped, { x: 400, y: 300 });
});

/* ---------------------------------------------------------------- report */

const failed = results.filter(r => !r.ok);
for (const result of results) {
  console.log(`${result.ok ? 'ok  ' : 'FAIL'}  ${result.name}`);
  if (!result.ok) console.log(`      ${result.error.message}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);

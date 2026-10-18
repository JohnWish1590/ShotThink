/* ShotThink overlay: region selection and annotation.
 *
 * Ported in spirit from Mouse4's SnippingWindow (main.pyw). The annotation
 * model is unchanged — Mouse4 already stored annotations as plain data, so it
 * maps onto canvas one-to-one.
 *
 *   { type, color, start, end, rect, path, text, size }
 *
 * Rendered with the same primitives Mouse4 used:
 *
 *   drawRect      -> ctx.strokeRect
 *   drawEllipse   -> ctx.ellipse
 *   drawPath      -> moveTo / lineTo
 *   draw_arrow    -> line + arrowhead polygon
 *   mosaic        -> downscale, then upscale with smoothing off
 *   text          -> ctx.fillText with a bold UI font
 *
 * STATUS: M1 skeleton. Region selection, rectangle, ellipse, arrow, pen and
 * mosaic are implemented. Text entry, the styled toolbar, long capture and the
 * send action are wired as clearly marked TODOs. Not yet verified in a live
 * browser.
 */
(() => {
  if (globalThis.shotThinkOverlay) {
    // Already injected on this page; just reopen.
    globalThis.shotThinkOverlay.open();
    return;
  }

  const COLORS = ['#FF3B30', '#FFCC00', '#34C759', '#2997FF', '#00FFFF', '#FF2D95', '#FFFFFF', '#000000'];
  const MASK = 'rgba(0,0,0,0.45)';
  const SELECTION = '#2997FF';
  const MIN_SELECTION = 10;
  const DOUBLE_CLICK_MS = 320;

  const state = {
    frame: null,          // { bitmap, dataUrl, viewport, scale }
    annotations: [],      // finished items
    drafting: null,       // item currently being dragged
    mode: null,           // 'rect' | 'ellipse' | 'arrow' | 'pen' | 'mosaic' | 'text'
    color: COLORS[0],
    selection: null,      // { x, y, w, h } in CSS pixels
    selecting: false,
    anchor: null,
    lastClickAt: 0,
    lastClickPos: null,
    open: false
  };

  /* ------------------------------------------------------------------ DOM */

  let root = null;
  let canvas = null;
  let ctx = null;

  function buildDom() {
    root = document.createElement('div');
    root.id = 'shotthink-root';
    root.setAttribute('data-shotthink', '1');

    canvas = document.createElement('canvas');
    canvas.id = 'shotthink-canvas';
    root.append(canvas);

    const style = document.createElement('style');
    style.textContent = `
      #shotthink-root {
        position: fixed; inset: 0; z-index: 2147483647;
        cursor: crosshair; margin: 0; padding: 0;
        font: 13px/1.4 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
        -webkit-user-select: none; user-select: none;
      }
      #shotthink-canvas { position: absolute; inset: 0; display: block; }
    `;
    root.append(style);
    document.documentElement.append(root);
  }

  function teardown() {
    root?.remove();
    root = canvas = ctx = null;
    state.open = false;
    state.annotations = [];
    state.drafting = null;
    state.selection = null;
    state.selecting = false;
    state.anchor = null;
    state.frame = null;
  }

  /* --------------------------------------------------------------- render */

  function resizeCanvas() {
    if (!canvas || !state.frame) return;
    const { viewport, scale } = state.frame;
    const dpr = window.devicePixelRatio || 1;
    // Canvas backing store follows the *device* pixels the capture produced,
    // so annotation coordinates and bitmap pixels share one space.
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    void scale;
    draw();
  }

  function draw() {
    if (!ctx || !state.frame) return;
    const { viewport, bitmap } = state.frame;

    ctx.clearRect(0, 0, viewport.width, viewport.height);
    ctx.drawImage(bitmap, 0, 0, viewport.width, viewport.height);

    const sel = state.selection;
    if (!sel) {
      ctx.fillStyle = MASK;
      ctx.fillRect(0, 0, viewport.width, viewport.height);
      return;
    }

    // Dim everything except the selection, then redraw the selection undimmed.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, viewport.width, viewport.height);
    ctx.rect(sel.x, sel.y, sel.w, sel.h);
    ctx.fillStyle = MASK;
    ctx.fill('evenodd');
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(sel.x, sel.y, sel.w, sel.h);
    ctx.clip();
    ctx.drawImage(bitmap, 0, 0, viewport.width, viewport.height);

    for (const item of state.annotations) drawItem(item);
    if (state.drafting) drawItem(state.drafting);
    ctx.restore();

    ctx.strokeStyle = SELECTION;
    ctx.lineWidth = 2;
    ctx.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w - 1, sel.h - 1);

    drawSizeLabel(sel);
  }

  function drawItem(item) {
    ctx.save();
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    switch (item.type) {
      case 'rect':
        ctx.strokeRect(item.rect.x, item.rect.y, item.rect.w, item.rect.h);
        break;
      case 'ellipse': {
        const { x, y, w, h } = item.rect;
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'arrow':
        drawArrow(item.start, item.end);
        break;
      case 'pen':
        if (item.path?.length > 1) {
          ctx.beginPath();
          ctx.moveTo(item.path[0].x, item.path[0].y);
          for (const point of item.path.slice(1)) ctx.lineTo(point.x, point.y);
          ctx.stroke();
        }
        break;
      case 'mosaic':
        if (item.pattern) {
          ctx.drawImage(item.pattern, item.rect.x, item.rect.y, item.rect.w, item.rect.h);
        } else {
          // During the drag, cover with a safe block until the pixels are sampled.
          ctx.fillStyle = 'rgba(20,20,20,0.86)';
          ctx.fillRect(item.rect.x, item.rect.y, item.rect.w, item.rect.h);
        }
        break;
      case 'text':
        ctx.font = `bold ${item.size || 24}px "Microsoft YaHei", sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(item.text, item.start.x, item.start.y);
        break;
    }
    ctx.restore();
  }

  function drawArrow(start, end) {
    const head = Math.max(10, Math.min(18, Math.hypot(end.x - start.x, end.y - start.y) * 0.28));
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 7), end.y - head * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 7), end.y - head * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }

  function drawSizeLabel(sel) {
    const text = `${Math.round(sel.w)} x ${Math.round(sel.h)}`;
    ctx.save();
    ctx.font = 'bold 11px -apple-system, "Segoe UI", sans-serif';
    const pad = 10;
    const width = ctx.measureText(text).width + pad * 2;
    const height = 20;
    let left = sel.x + (sel.w - width) / 2;
    left = Math.max(4, Math.min(left, state.frame.viewport.width - width - 4));
    const top = sel.y + 8;
    ctx.fillStyle = 'rgba(0,0,0,0.67)';
    ctx.beginPath();
    ctx.roundRect(left, top, width, height, height / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + pad, top + height / 2 + 0.5);
    ctx.restore();
  }

  /* --------------------------------------------------------------- mosaic */

  /**
   * Sample the frozen bitmap and build a pixelated tile.
   * Mirrors Mouse4's `_make_mosaic`: shrink with smoothing, grow without it.
   */
  function buildMosaicPattern(rect, block = 12) {
    const { bitmap } = state.frame;
    const scaleX = bitmap.width / state.frame.viewport.width;
    const scaleY = bitmap.height / state.frame.viewport.height;
    const sourceW = Math.max(1, Math.round(rect.w * scaleX));
    const sourceH = Math.max(1, Math.round(rect.h * scaleY));
    if (sourceW < 2 || sourceH < 2) return null;

    const smallW = Math.max(1, Math.floor(sourceW / block));
    const smallH = Math.max(1, Math.floor(sourceH / block));

    const small = document.createElement('canvas');
    small.width = smallW;
    small.height = smallH;
    const smallCtx = small.getContext('2d');
    smallCtx.drawImage(
      bitmap,
      Math.round(rect.x * scaleX), Math.round(rect.y * scaleY), sourceW, sourceH,
      0, 0, smallW, smallH
    );

    const tile = document.createElement('canvas');
    tile.width = Math.round(rect.w);
    tile.height = Math.round(rect.h);
    const tileCtx = tile.getContext('2d');
    tileCtx.imageSmoothingEnabled = false;
    tileCtx.drawImage(small, 0, 0, smallW, smallH, 0, 0, tile.width, tile.height);
    return tile;
  }

  /* --------------------------------------------------------------- events */

  function pointFrom(event) {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function normalizeRect(start, end) {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      w: Math.abs(end.x - start.x),
      h: Math.abs(end.y - start.y)
    };
  }

  function onPointerDown(event) {
    if (event.button === 2) {
      // Right click: drop the current tool, then leave.
      if (state.mode) { setMode(null); return; }
      teardown();
      return;
    }
    if (event.button !== 0) return;
    const point = pointFrom(event);

    if (state.selection && state.mode) {
      state.drafting = {
        type: state.mode,
        color: state.color,
        start: point,
        end: point,
        rect: { x: point.x, y: point.y, w: 0, h: 0 },
        path: state.mode === 'pen' ? [point] : undefined
      };
      draw();
      return;
    }

    if (state.selection && !state.mode) {
      const sel = state.selection;
      const inside = point.x >= sel.x && point.x <= sel.x + sel.w &&
                     point.y >= sel.y && point.y <= sel.y + sel.h;
      if (inside) {
        const now = Date.now();
        const near = state.lastClickPos &&
          Math.abs(point.x - state.lastClickPos.x) + Math.abs(point.y - state.lastClickPos.y) <= 6;
        if (now - state.lastClickAt < DOUBLE_CLICK_MS && near) {
          void confirmCapture();
          return;
        }
        state.lastClickAt = now;
        state.lastClickPos = point;
        return;
      }
      // Clicking outside starts a fresh selection and clears annotations,
      // matching Mouse4's behaviour.
      state.annotations = [];
    }

    state.selecting = true;
    state.anchor = point;
    state.selection = { x: point.x, y: point.y, w: 0, h: 0 };
    draw();
  }

  function onPointerMove(event) {
    if (!canvas) return;
    const point = pointFrom(event);

    if (state.drafting) {
      state.drafting.end = point;
      state.drafting.rect = normalizeRect(state.drafting.start, point);
      if (state.drafting.type === 'pen') state.drafting.path.push(point);
      draw();
      return;
    }

    if (state.selecting) {
      state.selection = normalizeRect(state.anchor, point);
      draw();
    }
  }

  function onPointerUp() {
    if (state.drafting) {
      const item = state.drafting;
      state.drafting = null;
      if (item.type === 'mosaic') item.pattern = buildMosaicPattern(item.rect);
      if (item.rect.w > 1 || item.rect.h > 1 || item.type === 'pen') {
        state.annotations.push(item);
      }
      draw();
      return;
    }

    if (state.selecting) {
      state.selecting = false;
      const sel = state.selection;
      if (!sel || sel.w < MIN_SELECTION || sel.h < MIN_SELECTION) {
        state.selection = null;
      }
      draw();
    }
  }

  function setMode(mode) {
    state.mode = state.mode === mode ? null : mode;
    root?.setAttribute('data-mode', state.mode || '');
    canvas.style.cursor = state.mode ? 'crosshair' : 'default';
    draw();
  }

  function undo() {
    state.annotations.pop();
    draw();
  }

  /* ---------------------------------------------------------------- export */

  /** Composite the selection plus annotations into a standalone canvas. */
  function renderResult() {
    const sel = state.selection;
    if (!sel) return null;
    const { bitmap, viewport } = state.frame;
    const dpr = window.devicePixelRatio || 1;

    const out = document.createElement('canvas');
    out.width = Math.round(sel.w * dpr);
    out.height = Math.round(sel.h * dpr);
    const outCtx = out.getContext('2d');

    // Draw the frozen bitmap offset so the selection lands at the origin.
    outCtx.drawImage(
      bitmap,
      Math.round(sel.x * dpr), Math.round(sel.y * dpr), Math.round(sel.w * dpr), Math.round(sel.h * dpr),
      0, 0, out.width, out.height
    );

    // Replay annotations in the same coordinate space, shifted by the crop.
    outCtx.save();
    outCtx.setTransform(dpr, 0, 0, dpr, -sel.x * dpr, -sel.y * dpr);
    outCtx.strokeStyle = '#000';
    for (const item of state.annotations) {
      const previous = ctx;
      ctx = outCtx;
      drawItem(item);
      ctx = previous;
    }
    outCtx.restore();

    void viewport;
    return out;
  }

  async function confirmCapture() {
    const result = renderResult();
    if (!result) return;
    const png = result.toDataURL('image/png');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    teardown();
    // TODO(M3): offer copy / download / send from the toolbar before this.
    await chrome.runtime.sendMessage({
      type: 'enqueueCapture',
      dataUrl: png,
      name: `shotthink-${stamp}.png`
    });
  }

  /* ------------------------------------------------------------------ open */

  async function open(windowId) {
    if (state.open) return;
    state.open = true;

    let reply;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'captureFrame', windowId });
    } catch (error) {
      console.error('ShotThink could not capture the frame', error);
      state.open = false;
      return;
    }
    if (!reply?.ok) {
      console.error('ShotThink capture refused:', reply?.error);
      state.open = false;
      return;
    }

    const response = await fetch(reply.dataUrl);
    const bitmap = await createImageBitmap(await response.blob());

    // The bitmap is device pixels; the overlay lays out in CSS pixels. Measure
    // the ratio instead of assuming it, because Chrome has changed this.
    const scale = reply.viewport.width ? bitmap.width / reply.viewport.width : 1;
    state.frame = { bitmap, dataUrl: reply.dataUrl, viewport: reply.viewport, scale };
    state.annotations = [];
    state.selection = null;
    state.mode = null;
    state.drafting = null;

    buildDom();
    resizeCanvas();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    window.addEventListener('resize', resizeCanvas, { passive: true });

    // TODO(M2): mount the toolbar with the Mouse4 palette and icon set.
    void COLORS; void setMode; void undo;
  }

  globalThis.shotThinkOverlay = { open, teardown };

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type !== 'shotthink:capture') return;
    open(message.windowId).then(() => reply({ ok: true }), error => reply({ ok: false, error: error.message }));
    return true;
  });
})();

/* ShotThink overlay: region selection, annotation, toolbar, long capture.
 *
 * The UI is a direct port of Mouse4's SnippingToolBar (ui/toolbar.py) and
 * SnippingWindow (main.pyw). Structure, palette, radii and icon geometry are
 * copied rather than reinterpreted, so the two tools feel identical.
 *
 * Annotation model (unchanged from Mouse4, maps 1:1 onto canvas):
 *
 *   { type, color, start, end, rect, path, text, size }
 *
 *   drawRect    -> ctx.strokeRect
 *   drawEllipse -> ctx.ellipse
 *   drawPath    -> moveTo / lineTo
 *   draw_arrow  -> line + arrowhead polygon
 *   mosaic      -> downscale, then upscale with smoothing off
 *   text        -> ctx.fillText with a bold UI font
 */
(() => {
  if (globalThis.shotThinkOverlay) {
    globalThis.shotThinkOverlay.open();
    return;
  }

  /* --------------------------------------------------------- theme constants
   * Copied from Mouse4/ui/theme.py so the two products look the same.
   * The pin button is omitted: a web page cannot pin a window to the desktop.
   */

  const ACCENT = '#2997FF';
  const PALETTE = ['#FF3B30', '#FFCC00', '#34C759', '#2997FF', '#00FFFF', '#FF2D95', '#FFFFFF', '#000000'];
  const FONT_SIZES = [12, 16, 20, 24, 32, 40, 48, 64, 80, 96];
  const MASK = 'rgba(0,0,0,0.45)';
  const MIN_SELECTION = 10;
  const DOUBLE_CLICK_MS = 320;

  /* i18n.js is injected first, but the overlay must never hard-fail if a stale
     tab still has an older build cached. Fall back to the raw string. */
  const t = text =>
    typeof globalThis.shotThinkText === 'function' ? globalThis.shotThinkText(text) : text;

  const BTN_COLORS = {
    undo: '#D98585',
    long: '#7AA2F7',
    ok: '#68DC8C',
    ai: '#9BE7B0',
    cancel: '#9DA9BF'
  };

  /* SVG paths copied from Mouse4/ui/theme.py APPLE_SVGS. */
  const SVG = {
    rect: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    ellipse: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path d="M6 18 L18 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 6 H18 V14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pen: '<svg viewBox="0 0 24 24"><path d="M4 15 C7 7, 9.5 19, 12.5 11.5 S17.5 6, 20 13.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    text: '<svg viewBox="0 0 24 24"><path d="M4 6 H20 V9.5 H14 V18 H10 V9.5 H4 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    mosaic: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 10h16M10 4v16M15 4v16M4 15h16" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M7 6 A8 8 0 1 1 7 18 M7 6 L4 3 M7 6 L10 3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    long: '<svg viewBox="0 0 24 24"><path d="M12 4 V20 M8 8 L12 4 L16 8 M8 16 L12 20 L16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ok: '<svg viewBox="0 0 24 24"><path d="M5 13 L10 18 L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ai: '<svg viewBox="0 0 24 24"><path d="M2.8 18 L6.8 6 H10.5 L14.5 18 M4.2 14 H13.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 6 V18 M16.2 6 H19.8 M16.2 18 H19.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    cancel: '<svg viewBox="0 0 24 24"><path d="M7.5 7.5 L16.5 16.5 M16.5 7.5 L7.5 16.5" transform="translate(0 -3)" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
  };

  /* ------------------------------------------------------------------ state */

  const state = {
    frame: null,
    annotations: [],
    drafting: null,
    mode: null,
    color: PALETTE[0],
    fontSize: 24,
    selection: null,
    selecting: false,
    anchor: null,
    lastClickAt: 0,
    lastClickPos: null,
    open: false,
    longCapture: false,
    busy: false,
    windowId: null
  };

  let root = null;
  let canvas = null;
  let ctx = null;
  let toolbar = null;
  let colorsPanel = null;
  let textInput = null;
  let toast = null;

  /* --------------------------------------------------------------- DOM setup */

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
        margin: 0; padding: 0; cursor: crosshair;
        font: 13px/1.4 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
        -webkit-user-select: none; user-select: none;
      }
      /* During long capture the shield stays interactive so the page cannot be
         clicked while slices are being taken. Scrolling is driven
         programmatically by captureLongPage, not by wheel events. */
      #shotthink-canvas { position: absolute; inset: 0; display: block; }

      /* Toolbar: Mouse4 APPLE_THEME['toolbar_css'] */
      .st-toolbar {
        position: fixed; display: flex; align-items: center; gap: 3px;
        padding: 7px 8px;
        background: rgba(24,24,27,0.97);
        border: 1px solid rgba(255,255,255,0.14);
        border-radius: 17px;
        box-shadow: 0 10px 34px rgba(0,0,0,0.45);
        pointer-events: auto;
      }
      .st-toolbar button {
        display: flex; align-items: center; justify-content: center;
        width: 42px; height: 42px; padding: 0; margin: 0;
        background: transparent; border: none; border-radius: 11px;
        color: #E5E5EA; cursor: pointer;
      }
      .st-toolbar button:hover { background: rgba(255,255,255,0.12); color: #fff; }
      .st-toolbar button[data-active="1"] { background: rgba(41,151,255,0.30); color: ${ACCENT}; }
      .st-toolbar button:disabled { opacity: .38; cursor: default; }
      .st-toolbar button:disabled:hover { background: transparent; }
      .st-toolbar svg { width: 24px; height: 24px; display: block; }

      /* Result buttons keep Mouse4's per-action colours. */
      .st-toolbar button[data-kind] { border-radius: 11px; }
      .st-toolbar button[data-kind="undo"]   { background: ${BTN_COLORS.undo};   color: #210F12; }
      .st-toolbar button[data-kind="long"]   { background: ${BTN_COLORS.long};   color: #101827; }
      .st-toolbar button[data-kind="ok"]     { background: ${BTN_COLORS.ok};     color: #07140B; }
      .st-toolbar button[data-kind="ai"]     { background: ${BTN_COLORS.ai};     color: #07140B; }
      .st-toolbar button[data-kind="cancel"] { background: ${BTN_COLORS.cancel}; color: #151A28; }
      .st-toolbar button[data-kind]:hover { filter: brightness(1.08); }

      .st-sep { width: 1px; height: 26px; background: rgba(255,255,255,0.18); margin: 0 2px; }

      /* Colour panel: Mouse4 APPLE_THEME['panel_css'] + combo_css */
      .st-colors {
        position: fixed; display: flex; align-items: center; gap: 10px;
        padding: 6px 10px;
        background: rgba(24,24,27,0.96);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 14px;
        box-shadow: 0 8px 26px rgba(0,0,0,0.4);
        pointer-events: auto;
      }
      .st-colors select {
        width: 68px; padding: 3px 6px;
        background: rgba(255,255,255,0.10); color: #fff;
        border: 1px solid rgba(255,255,255,0.18); border-radius: 8px;
        font: inherit;
      }
      .st-colors select option { background: #2b2b2b; color: #fff; }
      .st-swatch {
        width: 24px; height: 24px; padding: 0; border-radius: 12px;
        border: 2px solid rgba(255,255,255,0.35);
        cursor: pointer;
      }
      .st-swatch[data-active="1"] { outline: 2px solid #fff; outline-offset: 1px; }

      /* Inline text entry: Mouse4 OverlayInput */
      .st-input {
        position: fixed; min-width: 60px;
        background: rgba(255,255,255,0.06);
        border: 2px solid #fff; border-radius: 4px;
        padding: 1px 4px; outline: none; resize: none;
        font-weight: bold; font-family: "Microsoft YaHei", sans-serif;
        line-height: 1.25; overflow: hidden; white-space: pre;
        pointer-events: auto;
      }

      /* Long-capture progress */
      .st-toast {
        position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%);
        padding: 9px 18px; border-radius: 10px;
        background: rgba(24,24,27,0.96); color: #E5E5EA;
        border: 1px solid rgba(255,255,255,0.14);
        font-size: 13px; font-weight: 600; white-space: nowrap;
        pointer-events: none;
      }
    `;
    root.append(style);
    document.documentElement.append(root);
  }

  function teardown() {
    cancelTextInput();
    root?.remove();
    root = canvas = ctx = toolbar = colorsPanel = textInput = toast = null;
    Object.assign(state, {
      annotations: [], drafting: null, mode: null, selection: null,
      selecting: false, anchor: null, frame: null, open: false,
      longCapture: false, busy: false, lastClickAt: 0, lastClickPos: null
    });
  }

  /* ---------------------------------------------------------------- toolbar */

  function iconButton(svg, title, { kind, onClick, id } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = t(title);
    button.setAttribute('aria-label', t(title));
    if (kind) button.dataset.kind = kind;
    if (id) button.dataset.id = id;
    button.innerHTML = svg;
    button.addEventListener('click', event => {
      event.stopPropagation();
      onClick?.(button);
    });
    return button;
  }

  function buildToolbar() {
    toolbar = document.createElement('div');
    toolbar.className = 'st-toolbar';

    const toolDefs = [
      ['rect', SVG.rect, '矩形'],
      ['ellipse', SVG.ellipse, '椭圆'],
      ['arrow', SVG.arrow, '箭头'],
      ['pen', SVG.pen, '画笔'],
      ['text', SVG.text, '文字'],
      ['mosaic', SVG.mosaic, '马赛克']
    ];
    for (const [mode, svg, title] of toolDefs) {
      toolbar.append(iconButton(svg, title, { id: `tool-${mode}`, onClick: () => setMode(mode) }));
    }

    toolbar.append(separator());

    toolbar.append(iconButton(SVG.undo, '撤销', {
      kind: 'undo',
      onClick: () => { undo(); }
    }));

    toolbar.append(separator());

    toolbar.append(iconButton(SVG.long, '长截图', {
      kind: 'long',
      onClick: () => void runLongCapture()
    }));
    toolbar.append(iconButton(SVG.ok, '保存并复制', {
      kind: 'ok',
      onClick: () => void saveAndCopy()
    }));
    toolbar.append(iconButton(SVG.ai, '发送给 AI', {
      kind: 'ai',
      onClick: () => void sendToAi()
    }));
    toolbar.append(iconButton(SVG.cancel, '取消', {
      kind: 'cancel',
      onClick: () => teardown()
    }));

    root.append(toolbar);

    colorsPanel = document.createElement('div');
    colorsPanel.className = 'st-colors';
    colorsPanel.hidden = true;

    const select = document.createElement('select');
    select.setAttribute('aria-label', t('文字'));
    for (const size of FONT_SIZES) {
      const option = document.createElement('option');
      option.value = String(size);
      option.textContent = String(size);
      select.append(option);
    }
    select.value = String(state.fontSize);
    select.addEventListener('change', () => {
      state.fontSize = Number(select.value);
      if (textInput) textInput.style.fontSize = `${state.fontSize}px`;
    });
    colorsPanel.append(select);

    for (const color of PALETTE) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'st-swatch';
      swatch.style.background = color;
      swatch.dataset.color = color;
      swatch.setAttribute('aria-label', color);
      swatch.addEventListener('click', () => {
        state.color = color;
        for (const other of colorsPanel.querySelectorAll('.st-swatch')) {
          other.dataset.active = other.dataset.color === color ? '1' : '0';
        }
      });
      colorsPanel.append(swatch);
    }
    colorsPanel.querySelector('.st-swatch').dataset.active = '1';

    root.append(colorsPanel);
  }

  function separator() {
    const line = document.createElement('div');
    line.className = 'st-sep';
    return line;
  }

  /**
   * Place the toolbar the way Mouse4's show_toolbar does:
   * below the selection, else above it, else inside its top edge.
   */
  function positionToolbar() {
    if (!toolbar || !state.selection) return;
    const sel = state.selection;
    const { width: vw, height: vh } = state.frame.viewport;
    const box = toolbar.getBoundingClientRect();
    const w = box.width || 380;
    const h = box.height || 58;
    const gap = 10;

    const clampX = x => Math.max(0, Math.min(x, vw - w));
    const fits = (x, y) => y >= 0 && y + h <= vh && x >= 0 && x + w <= vw;

    let x = clampX(sel.x + sel.w - w);
    let y = sel.y + sel.h + gap;                       // 1) below
    if (!fits(x, y)) {
      y = sel.y - h - gap;                             // 2) above
      if (!fits(x, y)) y = Math.min(sel.y + gap, vh - h); // 3) inside the top
    }
    toolbar.style.left = `${x}px`;
    toolbar.style.top = `${Math.max(0, y)}px`;

    // Colour panel sits directly under the toolbar, kept on screen.
    const panelBox = colorsPanel.getBoundingClientRect();
    const pw = panelBox.width || 400;
    const ph = panelBox.height || 40;
    const px = clampX(x);
    let py = y + h + 6;
    if (py + ph > vh) py = Math.max(0, y - ph - 6);
    colorsPanel.style.left = `${px}px`;
    colorsPanel.style.top = `${py}px`;
  }

  function refreshToolbar() {
    if (!toolbar) return;
    for (const [mode, id] of [['rect', 'tool-rect'], ['ellipse', 'tool-ellipse'], ['arrow', 'tool-arrow'],
                              ['pen', 'tool-pen'], ['text', 'tool-text'], ['mosaic', 'tool-mosaic']]) {
      const button = toolbar.querySelector(`[data-id="${id}"]`);
      if (button) button.dataset.active = state.mode === mode ? '1' : '0';
    }
    const showColors = Boolean(state.mode);
    colorsPanel.hidden = !showColors;
    // Mouse4 shows the colour swatches for every tool, and the size selector
    // only for text (toolbar.py: setVisible(mode is not None) / == 'text').
    const sizeSelect = colorsPanel.querySelector('select');
    if (sizeSelect) sizeSelect.style.display = state.mode === 'text' ? '' : 'none';

    // During long capture Mouse4 disables every tool except finish/cancel.
    // Set both directions, otherwise the buttons stay dead after a capture.
    for (const button of toolbar.querySelectorAll('button')) {
      if (!state.longCapture) { button.disabled = false; continue; }
      const kind = button.dataset.kind;
      button.disabled = !(kind === 'ok' || kind === 'cancel');
    }
    positionToolbar();
  }

  /* ----------------------------------------------------------------- render */

  function resizeCanvas() {
    if (!canvas || !state.frame) return;
    const { viewport } = state.frame;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    if (!ctx || !state.frame) return;
    const { viewport, bitmap } = state.frame;

    ctx.clearRect(0, 0, viewport.width, viewport.height);

    // Long capture shows the live page through the selection, so the frozen
    // bitmap is not painted at all (Mouse4 does the same).
    if (!state.longCapture) {
      ctx.drawImage(bitmap, 0, 0, viewport.width, viewport.height);
    }

    const sel = state.selection;
    if (!sel) {
      if (!state.longCapture) {
        ctx.fillStyle = MASK;
        ctx.fillRect(0, 0, viewport.width, viewport.height);
      }
      return;
    }

    if (state.longCapture) {
      // Dim outside, leave the selection transparent so scrolling is visible.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, viewport.width, viewport.height);
      ctx.rect(sel.x, sel.y, sel.w, sel.h);
      ctx.fillStyle = MASK;
      ctx.fill('evenodd');
      ctx.restore();

      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w - 1, sel.h - 1);
      return;
    }

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

    ctx.strokeStyle = ACCENT;
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

  /* ----------------------------------------------------------------- mosaic */

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
    small.getContext('2d').drawImage(
      bitmap,
      Math.round(rect.x * scaleX), Math.round(rect.y * scaleY), sourceW, sourceH,
      0, 0, smallW, smallH
    );

    const tile = document.createElement('canvas');
    tile.width = Math.max(1, Math.round(rect.w));
    tile.height = Math.max(1, Math.round(rect.h));
    const tileCtx = tile.getContext('2d');
    tileCtx.imageSmoothingEnabled = false;
    tileCtx.drawImage(small, 0, 0, smallW, smallH, 0, 0, tile.width, tile.height);
    return tile;
  }

  /* ------------------------------------------------------------- text entry */

  function startTextInput(point) {
    cancelTextInput();
    const input = document.createElement('textarea');
    input.className = 'st-input';
    input.rows = 1;
    input.style.left = `${point.x}px`;
    input.style.top = `${point.y}px`;
    input.style.color = state.color;
    input.style.fontSize = `${state.fontSize}px`;
    input.style.borderColor = state.color;
    input.spellcheck = false;

    const grow = () => {
      input.style.width = 'auto';
      input.style.width = `${Math.max(60, measureTextWidth(input.value, state.fontSize) + 20)}px`;
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight}px`;
    };

    input.addEventListener('input', grow);
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { cancelTextInput(); return; }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        commitTextInput();
      }
    });
    input.addEventListener('pointerdown', event => event.stopPropagation());

    root.append(input);
    textInput = input;
    grow();
    input.focus();
  }

  function measureTextWidth(text, size) {
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = `bold ${size}px "Microsoft YaHei", sans-serif`;
    return probe.measureText(text || '').width;
  }

  function commitTextInput() {
    if (!textInput) return;
    const value = textInput.value.trim();
    const left = parseFloat(textInput.style.left) || 0;
    const top = parseFloat(textInput.style.top) || 0;
    cancelTextInput();
    if (!value) return;
    state.annotations.push({
      type: 'text',
      text: value,
      start: { x: left, y: top },
      color: state.color,
      size: state.fontSize
    });
    draw();
  }

  function cancelTextInput() {
    textInput?.remove();
    textInput = null;
  }

  /* ---------------------------------------------------------------- events */

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
    if (state.busy) return;
    if (event.button === 2) {
      if (textInput) { cancelTextInput(); return; }
      if (state.mode) { setMode(null); return; }
      teardown();
      return;
    }
    if (event.button !== 0) return;
    const point = pointFrom(event);

    if (state.longCapture) return; // selection is fixed during long capture

    if (state.selection && state.mode) {
      if (state.mode === 'text') {
        if (textInput) commitTextInput();
        startTextInput(point);
        return;
      }
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
          void sendToAi();
          return;
        }
        state.lastClickAt = now;
        state.lastClickPos = point;
        return;
      }
      state.annotations = [];
    }

    cancelTextInput();
    state.selecting = true;
    state.anchor = point;
    state.selection = { x: point.x, y: point.y, w: 0, h: 0 };
    toolbar.hidden = true;
    colorsPanel.hidden = true;
    draw();
  }

  function onPointerMove(event) {
    if (!canvas || state.busy) return;
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
      if (item.rect.w > 1 || item.rect.h > 1) state.annotations.push(item);
      draw();
      return;
    }

    if (state.selecting) {
      state.selecting = false;
      const sel = state.selection;
      if (!sel || sel.w < MIN_SELECTION || sel.h < MIN_SELECTION) {
        state.selection = null;
        draw();
        return;
      }
      draw();
      toolbar.hidden = false;
      refreshToolbar();
    }
  }

  function setMode(mode) {
    if (state.longCapture) return;
    state.mode = state.mode === mode ? null : mode;
    if (state.mode !== 'text') cancelTextInput();
    canvas.style.cursor = state.mode ? 'crosshair' : 'default';
    // Keep the chosen swatch highlighted across tool switches.
    for (const swatch of colorsPanel.querySelectorAll('.st-swatch')) {
      swatch.dataset.active = swatch.dataset.color === state.color ? '1' : '0';
    }
    refreshToolbar();
    draw();
  }

  function undo() {
    state.annotations.pop();
    draw();
  }

  /* ---------------------------------------------------------------- export */

  function renderResult() {
    const sel = state.selection;
    if (!sel) return null;
    const { bitmap } = state.frame;
    const dpr = window.devicePixelRatio || 1;

    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(sel.w * dpr));
    out.height = Math.max(1, Math.round(sel.h * dpr));
    const outCtx = out.getContext('2d');

    outCtx.drawImage(
      bitmap,
      Math.round(sel.x * dpr), Math.round(sel.y * dpr),
      Math.round(sel.w * dpr), Math.round(sel.h * dpr),
      0, 0, out.width, out.height
    );

    // Replay annotations in the same space, shifted by the crop offset.
    const previous = ctx;
    ctx = outCtx;
    outCtx.save();
    outCtx.setTransform(dpr, 0, 0, dpr, -sel.x * dpr, -sel.y * dpr);
    for (const item of state.annotations) drawItem(item);
    outCtx.restore();
    ctx = previous;

    return out;
  }

  function stamp() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
           `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  async function saveAndCopy() {
    if (state.busy) return;
    const result = renderResult();
    if (!result) return;
    state.busy = true;
    try {
      const blob = await new Promise(resolve => result.toBlob(resolve, 'image/png'));
      if (!blob) throw Error('导出图片失败。');

      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      } catch (error) {
        // Clipboard writes need a user gesture and can be blocked; the
        // download still succeeds, so this is not fatal.
        console.warn('ShotThink could not copy to clipboard', error);
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `shotthink-${stamp()}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      teardown();
    } catch (error) {
      console.error('ShotThink save failed', error);
      state.busy = false;
    }
  }

  async function sendToAi() {
    if (state.busy) return;
    const result = renderResult();
    if (!result) return;
    state.busy = true;
    try {
      const dataUrl = result.toDataURL('image/png');
      teardown();
      const reply = await chrome.runtime.sendMessage({
        type: 'enqueueCapture',
        dataUrl,
        name: `shotthink-${stamp()}.png`
      });
      if (!reply?.ok) console.error('ShotThink send refused:', reply?.error);
    } catch (error) {
      console.error('ShotThink send failed', error);
      state.busy = false;
    }
  }

  /* ------------------------------------------------------------ long capture */

  function showToast(text) {
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'st-toast';
      root.append(toast);
    }
    toast.textContent = text;
    toast.hidden = false;
  }

  function hideToast() {
    if (toast) toast.hidden = true;
  }

  /**
   * Scroll-stitch the selection into one tall image.
   *
   * Mouse4 needs cv2 template matching here because a desktop program cannot
   * read the real scroll offset. In a browser `window.scrollY` is exact, so the
   * overlap is arithmetic and the whole matcher disappears.
   */
  async function runLongCapture() {
    if (state.busy || state.longCapture) return;
    const sel = state.selection;
    if (!sel) return;

    state.busy = true;
    state.longCapture = true;
    cancelTextInput();
    refreshToolbar();
    draw();
    showToast(t('页面正在滚动，请稍候。'));

    try {
      const reply = await chrome.runtime.sendMessage({
        type: 'captureLongPage',
        windowId: state.windowId,
        // Pass the selection so sticky elements the user deliberately framed
        // are kept, while page chrome outside it is hidden.
        selection: { x: sel.x, y: sel.y, w: sel.w, h: sel.h }
      });
      if (!reply?.ok) throw Error(reply?.error || '长截图失败。');

      const { slices, viewport } = reply;
      if (!slices?.length) throw Error('没有采集到任何内容。');

      // Decode every slice, then composite by measured scroll offset.
      const bitmaps = [];
      for (const slice of slices) {
        const response = await fetch(slice.dataUrl);
        bitmaps.push(await createImageBitmap(await response.blob()));
      }

      const dpr = window.devicePixelRatio || 1;
      const bitmapScale = bitmaps[0].width / viewport.width;
      const documentHeight = viewport.scrollHeight;

      const stitched = document.createElement('canvas');
      stitched.width = Math.round(sel.w * bitmapScale);
      const lastBottom = slices.at(-1).scrollY + viewport.height;
      stitched.height = Math.round(Math.min(documentHeight, lastBottom) * bitmapScale) -
                        Math.round(slices[0].scrollY * bitmapScale);
      const stitchCtx = stitched.getContext('2d');

      slices.forEach((slice, index) => {
        const bitmap = bitmaps[index];
        // Source rectangle inside this slice, in bitmap pixels.
        const sourceX = Math.round(sel.x * bitmapScale);
        const sourceW = Math.round(sel.w * bitmapScale);
        const y = Math.round((slice.scrollY - slices[0].scrollY) * bitmapScale);
        const available = stitched.height - y;
        if (available <= 0) return;
        const sourceH = Math.min(bitmap.height, available);
        stitchCtx.drawImage(bitmap, sourceX, 0, sourceW, sourceH, 0, y, sourceW, sourceH);
      });

      hideToast();

      // Replace the overlay content with the stitched result so the user can
      // annotate it and then save or send exactly as with a normal capture.
      const stitchedBitmap = await createImageBitmap(stitched);
      state.frame = {
        bitmap: stitchedBitmap,
        viewport: { width: stitched.width / dpr, height: stitched.height / dpr, scrollHeight: stitched.height },
        scale: dpr
      };
      state.longCapture = false;
      state.busy = false;
      state.annotations = [];
      state.selection = { x: 0, y: 0, w: stitched.width / dpr, h: stitched.height / dpr };
      state.mode = null;

      resizeCanvas();
      // A tall stitched image cannot be shown at 1:1 in the viewport, so scale
      // the canvas down to fit while keeping coordinates in image space.
      fitTallCanvas();
      refreshToolbar();
      draw();
    } catch (error) {
      console.error('ShotThink long capture failed', error);
      hideToast();
      state.longCapture = false;
      state.busy = false;
      refreshToolbar();
      draw();
    }
  }

  /** Scale a very tall stitched result down so the whole image is visible. */
  function fitTallCanvas() {
    if (!canvas || !state.frame) return;
    const { viewport } = state.frame;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fit = Math.min(1, vw / viewport.width, vh / viewport.height);
    canvas.style.width = `${viewport.width * fit}px`;
    canvas.style.height = `${viewport.height * fit}px`;
    canvas.style.left = `${(vw - viewport.width * fit) / 2}px`;
    canvas.style.top = `${(vh - viewport.height * fit) / 2}px`;
  }

  /* ------------------------------------------------------------------ open */

  async function open(windowId) {
    if (state.open) return;
    state.open = true;
    state.windowId = windowId;

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
    const scale = reply.viewport.width ? bitmap.width / reply.viewport.width : 1;

    state.frame = { bitmap, dataUrl: reply.dataUrl, viewport: reply.viewport, scale };

    buildDom();
    buildToolbar();
    resizeCanvas();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    window.addEventListener('resize', resizeCanvas, { passive: true });

    // Escape cancels, matching Mouse4.
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (textInput) { cancelTextInput(); return; }
      teardown();
    }, { capture: true });
  }

  globalThis.shotThinkOverlay = { open, teardown };

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === 'shotthink:longProgress') {
      if (toast && state.longCapture) {
        toast.textContent = `${t('准备截图…')} ${message.index + 1}/${message.total}`;
      }
      return;
    }
    if (message.type !== 'shotthink:capture') return;
    open(message.windowId).then(
      () => reply({ ok: true }),
      error => reply({ ok: false, error: error.message })
    );
    return true;
  });
})();

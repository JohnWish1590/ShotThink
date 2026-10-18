# ShotThink — Design

This document is the implementation plan. It is written so a later session can continue without re-deriving the analysis.

## 1. Where this came from

ShotThink is a browser-only port of the "send screenshot to AI" feature that already ships inside [Mouse4](https://github.com/JohnWish1590/Mouse4), a Windows PyQt6 screenshot tool.

Reading the Mouse4 source (`D:\SynologyDrive\CODING\Mouse4`) established one important fact: **the delivery half is already a Chrome extension.** Of the ~1000 lines in `chrome-extension/`, the desktop program is only responsible for capture and annotation. Everything downstream already runs in the browser.

| Mouse4 module | Lines | Runs in | Reusable |
|---|---|---|---|
| `chrome-extension/sender.js` | 297 | browser | yes, unchanged |
| `chrome-extension/daily.js` | 182 | browser | yes, unchanged |
| `chrome-extension/background.js` | 377 | browser | yes, ~95% |
| `chrome-extension/native_bridge.js` | 99 | browser | replaced by an in-extension provider |
| `features/chatgpt_native_host.py` | 150 | desktop | deleted |
| `features/chrome_integration.py` | 41 | desktop | deleted |
| `features/chatgpt_sender.py` | 88 | desktop | deleted |
| `main.pyw` capture window | ~500 | desktop | logic ported, code rewritten |

So ShotThink is not a rewrite. It replaces the capture source and drops the native-messaging bridge.

## 2. Architecture

```
   user clicks the toolbar icon or presses Ctrl+Shift+S
                      │
                      ▼
   capture.js ── captureVisibleTab ──► frozen bitmap (device pixels)
                      │
                      ▼
   overlay.js ── full-viewport canvas, frozen bitmap as background
                      │  region select + annotations (pure data model)
                      ▼
   composited PNG dataUrl
                      │
                      ▼
   jobs[] in chrome.storage.local (or IndexedDB for the bitmap)
                      │
                      ▼
   background.js processQueue() ── sender.js ── daily.js
                      │            (unchanged from Mouse4)
                      ▼
   ChatGPT conversation, one per day, named YYYY-MM-DD
```

Capture happens **before** the overlay is drawn. The overlay then uses the captured bitmap as its own background. This removes the race where the mask itself appears in the screenshot, and it matches the "frozen frame" feel of the desktop version.

## 3. Files

| File | Responsibility | Status |
|---|---|---|
| `manifest.json` | MV3 manifest, minimal permissions | done |
| `src/background.js` | queue, daily routing, receipt checks | to port from Mouse4 |
| `src/sender.js` | upload + insert instructions + submit | to port, unchanged |
| `src/daily.js` | one chat per day, rename to date | to port, unchanged |
| `src/i18n.js` | zh/en strings | to port, rebrand |
| `src/capture.js` | `captureVisibleTab` wrapper, DPR math | done |
| `src/store.js` | IndexedDB image store, migration, orphan pruning | done |
| `tests/store.test.mjs` | storage layer tests | done, 10/10 |
| `src/overlay.js` | region select + annotation canvas | todo |
| `src/overlay.css` | overlay and toolbar styling | todo |
| `src/toolbar.js` | toolbar DOM, inline SVG icons | todo |
| `src/longcapture.js` | scroll + stitch | todo |
| `ui/options.html` | settings and send history | todo |

## 4. Porting notes

### 4.1 Annotation model

Mouse4 already stores annotations as plain data, which maps directly onto canvas:

```js
{type: 'rect'|'ellipse'|'arrow'|'pen'|'text'|'mosaic',
 color: '#ff3b30', rect: {x,y,w,h}, start: {x,y}, end: {x,y},
 path: [{x,y}, ...], text: '...', size: 24}
```

Rendering maps 1:1:

| Mouse4 (Qt) | Canvas |
|---|---|
| `p.drawRect(item.rect)` | `ctx.strokeRect` |
| `p.drawEllipse(item.rect)` | `ctx.ellipse` |
| `p.drawPath(item.path)` | `moveTo` + `lineTo` |
| `draw_arrow` | `moveTo` + arrowhead polygon |
| `p.drawImage(rect, pixmap)` (mosaic) | downscale then upscale with `imageSmoothingEnabled = false` |
| `p.setFont(...); p.drawText(...)` | `ctx.font = 'bold 24px "Microsoft YaHei"'` |

Mosaic in Mouse4 is `scale down by block_size, then scale back up with FastTransformation`. The canvas equivalent is identical.

### 4.2 Toolbar

`Mouse4/ui/theme.py` holds `APPLE_SVGS`, a dict of `currentColor` SVG strings. They can be inlined into HTML directly — no icon font, no image export. The colour palette is:

```
['#FF3B30', '#FFCC00', '#34C759', '#2997FF', '#00FFFF', '#FF2D95', '#FFFFFF', '#000000']
```

Result-button colours: undo `#D98585`, pin `#E4BD64`, ok `#68DC8C`, cancel `#9DA9BF`, long `#7AA2F7`, ai `#9BE7B0`. Toolbar surface `rgba(24,24,27,0.97)`, radius 17px.

ShotThink drops the pin button (no desktop pinning in a browser) and keeps the rest.

### 4.3 Long capture

Mouse4 spends 261 lines in `features/long_screenshot.py` on cv2 template matching, because a desktop program cannot read the real scroll offset. A browser can:

```
stitch offset = (scrollY_after - scrollY_before) * devicePixelRatio
```

That is exact. So:

- `estimate_vertical_shift`, `_relaxed_vertical_shift`, `find_vertical_overlap`, and the whole cv2/numpy dependency **disappear**.
- `scrollend` + `requestAnimationFrame` replace the dozen stability-state variables.
- Sticky headers must be handled by injecting CSS during capture (`position: fixed` → hidden or offset).
- Virtualised lists (feeds that destroy off-screen nodes) cannot be captured; detect and warn.

Hard limits: `captureVisibleTab` is throttled to roughly 2 calls per second, so a 20-viewport page takes at least 10 seconds.

## 5. Known risks

### P0 — storage quota (resolved)

Mouse4's queue caps images at 8,000,000 base64 characters (~6 MB binary) while `chrome.storage.local` defaults to 10 MB. In the desktop build the bitmap lives on disk and the queue only relays it, so the cap is harmless. In a pure extension the `dataUrl` **is** the storage.

Measured against real screenshots on this machine (`Pictures/Mouse4 Captures`, cropped to a 1920×1080 viewport):

| Sample | PNG | as base64 |
|---|---|---|
| 1 | 1.04 MB | 1.38 MB |
| 2 | 1.80 MB | 2.40 MB |
| 3 | 1.26 MB | 1.68 MB |
| 4 | 0.46 MB | 0.61 MB |
| 5 | 1.12 MB | 1.49 MB |
| 6 | 0.60 MB | 0.80 MB |
| **mean** | **1.05 MB** | **1.39 MB** |

So 10 MB held roughly seven ordinary screenshots, and one real long capture from the same folder is already 9.0 MB (3784×18051) or 9.3 MB (2170×34742) — **a single long capture could not be stored at all**.

Resolution: images moved to **IndexedDB** (`src/store.js`). No base64 inflation, no 10 MB ceiling. `chrome.storage.local` now holds only routing metadata. `sender.js` is untouched — the worker rehydrates `job.dataUrl` in memory immediately before a send, so the content script still sees the shape it expects.

Supporting pieces:

- `reconcileImageStore()` runs on worker start: migrates any legacy inline `dataUrl`, then prunes orphaned blobs.
- `deleteImage` is called on confirmed send, on `clearJob`, and on `clear`.
- A failed metadata write deletes the blob it just wrote, so no leak on that path.
- Tests: `node tests/store.test.mjs` (10 cases, including chunked base64 round-trip and the size arithmetic above).

### P0 — MV3 service worker lifetime

`background.js` contains `waitFor(() => !generating(), 150000)` — a 150-second wait inside a service worker, which is killed after ~30 seconds of inactivity. Mouse4 survives this via `repairKnownUnsent` (mark uncertain, never resend), so it surfaces as occasional "needs review" items. Moving long waits into the content script (`sender.js`, which is not killed) is the fix.

### P1 — capture/overlay ordering

Capture first, then draw the overlay on top of the frozen bitmap. Never the reverse.

### P1 — DPR math

`captureVisibleTab` returns device pixels; the overlay works in CSS pixels. Verify empirically on the target Chrome version rather than trusting documentation — a 10-line probe is cheaper than a wrong assumption.

### P1 — pages that cannot be captured

`chrome://*`, the Chrome Web Store, and the built-in PDF viewer reject content scripts. DRM video renders black. Cross-origin iframes are captured in the bitmap but cannot be annotated individually. All of these must fail gracefully.

### P2 — scrolling container

Many web apps (Notion, Feishu, Gmail) scroll an inner `overflow: auto` element, not `document.scrollingElement`. Resolve the container by walking up from the selected element to the nearest scrollable ancestor. This is new logic, not a port.

## 6. Distribution

Store review splits the product in two:

| Capability | Permissions | Review risk |
|---|---|---|
| Capture, annotate, copy/download | `activeTab`, `scripting` | low |
| Selected text → AI | `contextMenus` | low |
| Auto-upload and auto-submit to chatgpt.com | `host_permissions: chatgpt.com` | **high** |

Consequences:

- Never request `<all_urls>`. `activeTab` is granted by the toolbar click and the keyboard command, which is enough for both `captureVisibleTab` and `scripting`.
- Do not request `debugger`. It shows a "being debugged" banner and demands strong justification.
- Automated submission to a third-party site carries real policy risk. Keep the unpacked/self-distributed channel as the primary path; treat store publication as a separate decision.

## 7. Milestones

| # | Content | Estimate |
|---|---|---|
| M1 | capture + overlay region select + copy/download, no AI | ~350 lines |
| M2 | full annotation set + toolbar UI | ~700 lines |
| M3 | wire into ported `background.js`, capture → dated chat | ~150 lines |
| M4 | long capture: scroll stitch, sticky handling, virtualised detection | ~250 lines |
| M5 | IndexedDB storage, worker keepalive, JPEG output | storage **done**; keepalive and JPEG output remain |

Total roughly 1400 new lines, because ~856 lines of delivery logic carry over.

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
| `src/background.js` | queue, daily routing, receipt checks, capture dispatch | done |
| `src/sender.js` | upload + insert instructions + submit | done, unchanged from Mouse4 |
| `src/daily.js` | one chat per day, rename to date | done |
| `src/i18n.js` | zh/en strings | done |
| `src/capture.js` | `captureVisibleTab` wrapper, DPR math, long capture, sticky suppression | done |
| `src/store.js` | IndexedDB image store, migration, orphan pruning | done |
| `src/overlay.js` | region select, annotation canvas, Mouse4 toolbar, text entry, long capture | done |
| `tests/store.test.mjs` | storage layer tests | done, 10/10 |
| `tests/overlay.test.mjs` | geometry and annotation tests | done, 18/18 |
| `tests/queue.test.mjs` | settlement and handoff tests | done, 15/15 |
| `ui/options.html` + `options.js` | settings and send history | done |

### 3.1 UI parity with Mouse4

The overlay UI is a direct port, not a reinterpretation. Copied from
`Mouse4/ui/theme.py` and `Mouse4/ui/toolbar.py`:

- `APPLE_SVGS` icon paths, inlined as SVG strings
- the 8-colour palette and `DEFAULT_TEXT_FONT_SIZES`
- toolbar surface `rgba(24,24,27,0.97)`, radius 17px, 42px buttons, 11px radius
- result-button colours: undo `#D98585`, long `#7AA2F7`, ok `#68DC8C`, ai `#9BE7B0`, cancel `#9DA9BF`
- the `show_toolbar` placement order: below → above → inside the top edge
- colour swatches shown for every tool, the size selector only for text
- `OverlayInput` becomes an auto-growing `<textarea>` with Enter to commit

One button is omitted: **pin**, because a web page cannot pin a window above
the desktop. That is a platform limit, not a shortcut.

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

### P0 — MV3 service worker lifetime (resolved)

`background.js` contained `waitFor(() => !generating(), 150000)` — a 150-second
wait reached through `chrome.tabs.sendMessage`. Chrome kills an idle MV3 worker
after about 30 seconds, and an outstanding `await` does not count as activity,
so a long ChatGPT answer could take the worker down mid-send. The job then
stranded as `uncertain`, which is safe but confusing.

Resolution: **the page owns the wait.**

- `sender.js` wraps each send in `report()`, writing the outcome to the worker
  itself via a `jobResult` message. A content script has no idle lifetime, so a
  150-second wait is fine there.
- The worker waits at most `SEND_REPLY_TIMEOUT_MS` (20s). On timeout it records
  `pendingSince` and stops. The job stays in flight and is not retried.
- `reconcilePendingJobs()` runs on a 1-minute alarm. It settles a job as
  `uncertain` only when it is past `PENDING_JOB_TTL_MS` (10 min) **and** its tab
  no longer exists. A tab that still exists might yet report, so it is left
  alone.
- `jobResult` kicks `processQueue()` so the queue continues even though the
  worker stopped waiting.

The invariant that matters: **a send whose outcome is unknown is never retried
automatically.** Duplicating a screenshot in the user's chat is worse than
asking them to check. Tests: `node tests/queue.test.mjs` (15 cases).

### P1 — capture/overlay ordering

Capture first, then draw the overlay on top of the frozen bitmap. Never the reverse.

### P1 — DPR math

`captureVisibleTab` returns device pixels; the overlay works in CSS pixels. Verify empirically on the target Chrome version rather than trusting documentation — a 10-line probe is cheaper than a wrong assumption.

### P1 — pages that cannot be captured

`chrome://*`, the Chrome Web Store, and the built-in PDF viewer reject content scripts. DRM video renders black. Cross-origin iframes are captured in the bitmap but cannot be annotated individually. All of these must fail gracefully.

### P2 — scrolling container

Many web apps (Notion, Feishu, Gmail) scroll an inner `overflow: auto` element, not `document.scrollingElement`. Resolve the container by walking up from the selected element to the nearest scrollable ancestor. This is new logic, not a port.

## 6. Distribution

### 6.0 Connection model — decided: no API key, ever

ShotThink talks to ChatGPT the same way Mouse4 does: it drives the ordinary
web page in the user's own browser, using the session the user already has.
No OAuth, no API key, no cookie reading, no private endpoint.

This is a **product decision, not a technical shortcut**. The selling point is
that ShotThink costs the user nothing beyond the ChatGPT subscription they
already pay for. An API key would invert that: it would require a platform
account, a credit card, per-token billing, and would only reach the models the
API exposes. The web page reaches whatever the subscription includes.

Consequences that must be treated as load-bearing, not as nice-to-have:

- **Reliability is the entire value proposition.** Because delivery depends on
  DOM structure and a background tab, a broken send does not read as "OpenAI
  changed their page"; it reads as "this extension is broken". Every guard
  below exists for that reason.
- **Never silently guess.** When a selector is not confirmed, stop and report.
  A skipped screenshot is recoverable; a duplicated or mislabelled one is not.
- **A failed send is not a retry.** The job is marked `uncertain` and the user
  is asked to check the conversation. Resending is the user's decision.
- **The store channel is off the table.** Automated submission carries real
  Terms-of-Service risk, and store review treats "automates a third-party
  site" harshly. Distribution stays self-hosted / unpacked.

Explicitly rejected alternatives:

| Alternative | Why rejected |
|---|---|
| OpenAI API key | Costs the user money, needs billing setup, limited model set. Kills the free-for-subscribers selling point. |
| ChatGPT internal `/backend-api` | Stable and fast, but clearly violates the Terms of Service. Not acceptable. |
| Reading session cookies | Unnecessary — the page already carries the session. Also a security liability. |

### 6.1 Store review

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
| M1 | capture + overlay region select + copy/download, no AI | done |
| M2 | full annotation set + toolbar UI | done |
| M3 | wire into ported `background.js`, capture → dated chat | done |
| M4 | long capture: scroll stitch, sticky handling, virtualised detection | done, virtualised detection remains |
| M5 | IndexedDB storage, worker keepalive, JPEG output | **done**; JPEG output remains |

Total roughly 1400 new lines, because ~856 lines of delivery logic carry over.

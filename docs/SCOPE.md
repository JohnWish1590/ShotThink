# ShotThink — Scope

What ShotThink keeps, and what it deliberately drops compared with the Mouse4 desktop tool.

## Kept

| Capability | Source in Mouse4 | Note |
|---|---|---|
| Region screenshot | `main.pyw` `SnippingWindow` | reimplemented with `captureVisibleTab` |
| Rectangle / ellipse / arrow / pen / text / mosaic | `draw_item`, `draw_arrow`, `_make_mosaic` | data model ports 1:1 to canvas |
| Undo | `undo_drawing` | pop from the annotation array |
| Long-page capture | `features/long_screenshot.py` | replaced with exact `scrollY` stitching |
| One chat per day, auto-named `YYYY-MM-DD` | `chrome-extension/daily.js` | unchanged |
| Selected text → AI via right-click | `background.js` context menu | unchanged |
| Clipboard copy | `_copy_to_clipboard` | `navigator.clipboard.write(ClipboardItem)` |
| Queue, receipt verification, no-duplicate resend | `background.js`, `sender.js` | unchanged |

## Dropped

| Dropped | Reason |
|---|---|
| Pinning an image above the desktop | A web page cannot create a top-most native window |
| Global hotkey (system-wide) | `chrome.commands` only fires while Chrome has focus; the toolbar click replaces it |
| Capturing non-browser apps | Hard product boundary — WeChat, Excel, PDF readers are out of reach |
| Mixed-DPI multi-monitor stitching | No longer needed; the browser renders one DPR-correct bitmap per tab |
| Aliyun translation + DPAPI key storage | Translation is delegated to the already-connected ChatGPT account, so no second API key exists to protect |
| Native messaging host (`Mouse4-ChatGPT-Bridge.exe`) | The extension owns its own queue |
| Licensing / trial / activation | No desktop binary to protect |
| Watchdog, sleep-resume recovery, single-instance mutex | Chrome manages the process lifecycle |

## Deliberate product trade-off

ShotThink is **not** a replacement for Mouse4. It is a narrower product that needs no installation:

- Mouse4 covers the whole desktop, pins images, and works offline-ish — but requires a Windows install, a native bridge, and a licence.
- ShotThink covers only browser content — but installs as an unpacked folder, holds no API key, and needs no account beyond the ChatGPT login you already have.

Both share the same delivery logic, so a fix in one generally applies to the other.

## Non-goals

- Becoming a general-purpose screenshot suite for the desktop.
- Supporting browsers other than Chromium (the `captureVisibleTab` and `scripting` APIs are Chromium-specific as used here).
- Automated interaction with ChatGPT beyond uploading one image and pressing send.
- Reading cookies, session tokens, or any credential.

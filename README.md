# ShotThink

**Capture. Annotate. Ask.**

ShotThink is a Chrome extension that turns a browser screenshot into a question for your own ChatGPT account. Capture a region, mark it up, and the image plus your standing instructions land in a dated ChatGPT conversation. No desktop app, no API key, no separate subscription.

> Naming: `ShotThink` is the sibling of [ClipThink](https://github.com/JohnWish1590/clipthink) — same idea, different source material. ClipThink thinks about what you copy. ShotThink thinks about what you see.

---

## Status

**M1–M4 implemented, not yet verified in a live browser.** Region capture, the
full annotation set, the Mouse4-style toolbar, long-page stitching, and the
send path are all written. What remains is service-worker keepalive, JPEG
output for oversized captures, and virtualised-list detection.

See [docs/DESIGN.md](docs/DESIGN.md) for the plan and [docs/SCOPE.md](docs/SCOPE.md)
for what is deliberately excluded.

## What it will do

| Capability | Notes |
|---|---|
| Region capture of the visible page | `chrome.tabs.captureVisibleTab`, DPR-aware |
| Annotation | rectangle, ellipse, arrow, pen, text, mosaic, undo |
| Long-page capture | scroll + stitch using exact `scrollY`, no image matching |
| One chat per day | auto-named `YYYY-MM-DD`, later captures append |
| Selected text → AI | right-click menu, no clipboard reading |
| Translation | delegated to the connected ChatGPT account, not a separate API |

## What it will not do

- Capture anything outside the browser (WeChat, Excel, PDF readers)
- Pin an image above the desktop
- Register a system-wide hotkey
- Support mixed-DPI multi-monitor stitching (the browser handles DPR itself)

## Install (development)

The extension is not on the Chrome Web Store. Load it unpacked:

1. Open `chrome://extensions/` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Sign in to [chatgpt.com](https://chatgpt.com) in the same browser profile.

The background tab that performs delivery must stay open. ShotThink never reads cookies, never calls a private API, and never asks for your OpenAI credentials.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Capture and annotate only the tab you explicitly invoke it on |
| `scripting` | Inject the overlay into that tab |
| `storage` | Queue metadata, daily-chat mapping, and settings |
| `contextMenus` | The "Send to AI" item for selected text |
| `host_permissions: chatgpt.com` | Upload the image and press send on your behalf |

`activeTab` is granted by your click or the keyboard command, so ShotThink never holds standing access to every site you visit.

Captured images are stored in IndexedDB rather than `chrome.storage.local`. Chrome caps the latter at 10 MB and only holds text, so an image would have to be base64-encoded (+33%) first — roughly seven ordinary screenshots, and not even one long capture. IndexedDB keeps the original bytes and has no comparable ceiling.

## Tests

```bash
node tests/store.test.mjs     # 10 cases: IndexedDB layer, base64 chunking, migration
node tests/overlay.test.mjs   # 18 cases: selection, toolbar placement, stitching, mosaic
node tests/queue.test.mjs     # 15 cases: settlement, handoff, no-duplicate-retry
```

## How it connects to ChatGPT

It does not connect — it drives the page. ShotThink uses the ChatGPT session
already signed in to your browser, operating the ordinary page controls: pick
the file input, write the instructions into the editor, click send.

No API key, no OAuth, no cookie access. Requests are issued by the browser with
the browser's own session.

This is deliberate. The point is that ShotThink costs nothing beyond the
subscription you already have. An API key would require a platform account and
per-token billing, and would only reach the models the API exposes.

The trade-off is that delivery depends on ChatGPT's page structure and on a
background tab staying open. So the design rule throughout is: **when a
selector is not confirmed, stop and report rather than guess.** A skipped
screenshot is recoverable; a duplicated one is not.

## License

Not yet chosen. Treat this repository as all-rights-reserved until a `LICENSE` file is added.

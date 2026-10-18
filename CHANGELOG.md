# Changelog

All notable changes to ShotThink.

Version numbers follow [Semantic Versioning](https://semver.org/):

- **MAJOR** — incompatible changes that require the user to act (data migration,
  permission changes, dropped features).
- **MINOR** — new features, backwards compatible.
- **PATCH** — bug fixes and internal changes only.

The version must be bumped in `manifest.json` on every user-visible change:
Chrome only reloads an unpacked extension's code when that number changes.

---

## [1.1.0] - 2026-10-18

### Added

- **Shortcut section on the options page.** It shows the shortcut that is
  actually bound and has a button that opens `chrome://extensions/shortcuts`.

  This is a button rather than a plain link because neither obvious route works:
  an `<a href="chrome://...">` is blocked by the renderer, and MV3 has no
  `chrome.commands.update`, so an extension cannot change its own shortcut.
  `chrome.tabs.create` from an extension page is the one route that opens it.

  An unbound command is reported as "not bound" rather than left blank, since a
  missing shortcut is the most common reason the keyboard route silently fails.

## [1.0.0] - 2026-10-18

First public release. Free for anyone to download and use.

### Capture

- Region capture of the visible page via `chrome.tabs.captureVisibleTab`,
  DPR-aware so the output matches what is on screen at any display scaling.
- Annotation: rectangle, ellipse, arrow, pen, text and mosaic, with undo.
- Text annotation opens where the mouse is, sized to the selection, and wraps
  the same way the canvas draws it.
- Long capture: scrolls the page, samples each viewport, and stitches by exact
  `scrollY`. Sticky headers are suppressed for the duration so they do not repeat
  in every slice.
- Save to a PNG download, copy to the clipboard, or send to ChatGPT.

### Delivery

- Sends to the ChatGPT account already signed in to the browser. No API key, no
  OAuth, no cookie access, no subscription — this is why the extension is free.
- One conversation per day, named `YYYY-MM-DD`, with later captures appended.
- Selected text can be sent through the right-click menu.
- Queue survives a closed browser; delivery resumes when Chrome reopens.

### Safety

- A send whose outcome is unknown is never retried automatically. It is marked
  `uncertain` and the user checks the conversation. A duplicate screenshot in
  someone's chat is worse than asking them to look.
- An existing draft is never overwritten.
- A previous answer that is still generating pauses the queue instead of being
  interrupted.
- Restricted pages (`chrome://`, the Web Store, the PDF viewer) are detected
  before injection is attempted.

### Interface

- Chinese and English, defaulting to the browser language with a manual override.
- Light, dark, and follow-system themes.
- Toolbar size: 22 / 26 / 31 px.
- Annotation colour and font size are remembered between captures.

### Notes

- Distribution is self-hosted / unpacked. The extension automates a third-party
  site, so store review is not the right channel for it.
- Requires a Chromium browser. Firefox is not supported.

---

## Development history before 1.0.0

These were internal iterations, not public releases. They are recorded here
because the changelog is also the design history.

### 0.9.0

- Fixed: switching the interface language back did not restore the original
  text, because translation overwrote text nodes in place. Sources are now
  cached and every call translates from the cache.
- Fixed: stale "date naming unfinished" warnings persisted on old job records.
- Added: `nameDaily` asks the page whether the title is already correct before
  recording a failure.

### 0.8.0

- Fixed: a completed rename was reported as failed. The title is now checked on
  entry and again after waiting; a visible Rename item counts as an open menu;
  the document title, header, or sidebar row each confirm completion.
- Fixed: explanatory notes stayed Chinese in the English UI.
- Fixed: short translation keys (`标签页`, `是`, `权限`) were substring-replaced
  inside longer sentences. They moved to a whole-string-only table.
- Added: `data-i18n` so a sentence containing inline markup translates as a
  whole.

### 0.7.0

- Fixed: committed text reflowed differently from the editor. The editor records
  its wrap width and the canvas wraps at the same point.
- Changed: the editor frame follows the annotation colour instead of a fixed
  blue.
- Added: default analysis rules in both languages, a rule-language switch
  independent of the interface language, and a reset button.

### 0.6.0

- Fixed: the editor opened at a fixed centre instead of the mouse position.
- Fixed: the editor was invisible on a white page; a thin frame and a 6% fill
  were restored.

### 0.5.0

- Fixed: picking the text tool opens the editor immediately, with the caret in
  it.
- Fixed: canvas text sat too low (`textBaseline` was `'top'`).
- Changed: the editor became transparent and centred.

### 0.4.0

- Fixed: the text colour in the editor did not match what was committed.
- Fixed: characters rendered with gaps (`white-space: pre` preserved soft wraps).
- Changed: toolbar default 22px; annotation font sizes `[12…48]` defaulting to
  16px; colour and size remembered.

### 0.3.0

- Added: language switch, theme switch, toolbar size setting.
- Fixed: the send-history row collapsed the "open chat" link to one character.

### 0.2.0

- Fixed: a failed capture produced no visible response. Failures now set a badge
  and are surfaced on a diagnostics page.
- Fixed: `.st-toolbar { display: flex }` overrode `[hidden]`, so the toolbar and
  colour panel appeared before any selection.
- Fixed: the toolbar was oversized on a scaled display.
- Fixed: `Ctrl+Shift+S` is reserved by Chrome for "Save page as"; the default
  became `Alt+Shift+S`.

### 0.1.0

- Initial scaffold: MV3 manifest, queue and daily routing ported from Mouse4,
  IndexedDB image store, region capture with the full annotation set, Mouse4-style
  toolbar, scroll-stitched long capture.

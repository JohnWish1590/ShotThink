# Changelog

All notable changes to ShotThink. The version here must match
`manifest.json`; Chrome only reloads an unpacked extension's code when that
number changes, so every user-visible fix bumps it.

## [0.3.0] - 2026-10-18

### Added

- **Language switch.** Chinese and English, with the browser language as the
default and an explicit override stored as `uiLanguage`. Both extension pages
share the switch via `ui/prefs.js`; the language buttons themselves are marked
`data-no-i18n` so "中文" stays readable in English mode.
- **Theme switch.** Light, dark, and follow-system. Tokens live in
`ui/base.css` under `:root` and `:root[data-theme="light"]`; `system` is
resolved in JS against `prefers-color-scheme` with a live listener.
- **Toolbar size setting.** 26 / 28 / 31 px, defaulting to 28. `--st-scale` now
carries the button edge length directly, so every other dimension is a
fraction of it and one setting drives the whole toolbar. Verified: 26→26px,
28→28px, 31→31px, icon always 52% of the button.

### Fixed

- **The send-history row was unreadable.** The "open chat" link sat in the same
flex container as the filename, so it collapsed into a one-character-wide
column (see the 0.2.0 screenshot). Job rows are now wrapping block children and
the link never shrinks.
- **The options page still advertised `Ctrl+Shift+S`** in its intro text after
the shortcut moved to `Alt+Shift+S`.
- **Extension pages reported the wrong reason.** Clicking the icon on
`chrome-extension://…/options.html` said "this page cannot be captured". It now
says the extension's own pages cannot be captured, which is the actual rule.
- **Translated paragraphs containing inline markup were skipped.** The intro
sentence has a `<kbd>` inside it, so the text walker never matched it. Partial
strings are now in the translation table and each text node is matched alone.

### Changed

- Options and diagnostics share `ui/base.css` and `ui/prefs.js` instead of
duplicating their theme and language logic.

## [0.2.0] - 2026-10-18

### Fixed

- **Capture never started.** A failed capture produced no visible response at
  all: the fallback used `alert()` injected into the page, which needs the very
  permission that had just been denied. A failure now always shows a red `!`
  badge, a tooltip with the reason, and an entry the new diagnostics page reads.
- **Toolbar appeared before any selection.** `.st-toolbar { display: flex }`
  overrides the browser default `[hidden] { display: none }`, so the `hidden`
  attribute did nothing. The toolbar now starts hidden and appears only after a
  region is dragged out, matching Mouse4.
- **Colour panel was always visible.** Same `display: flex` vs `[hidden]`
  problem. It now appears only after a drawing tool is selected, and the size
  selector only for text — as `set_draw_mode` does in Mouse4.
- **Toolbar was too large on a scaled display.** The buttons were hard-coded at
  42 CSS px. Mouse4's `adapt_to_screen` scales by `logicalDotsPerInch / 144`,
  which in CSS pixels resolves to a constant `46 * 96 / 144 = 30.7` regardless
  of display scaling. Measured: 31 CSS px at devicePixelRatio 1, 1.5, 1.875 and
  2.
- **`Ctrl+Shift+S` did not work.** Chrome reserves it for "Save page as", so the
  suggested key was silently dropped. The default is now `Alt+Shift+S`. MV3 has
  no `chrome.commands.update`, so the diagnostics page links to
  `chrome://extensions/shortcuts` when the command is unbound.

### Added

- `ui/diagnose.html`: shows the extension version, whether the current tab is
  capturable, the last recorded failure, the actually-bound shortcut, and the
  granted permissions. Includes a one-click "reload this tab" button, which is
  the real fix for the most common cause of a silent failure.
- Restricted URLs (`chrome://`, the Web Store, `about:`, the PDF viewer) are
  detected up front from the tab URL instead of being discovered by a failed
  injection.

## [0.1.0] - 2026-10-18

### Added

- Initial scaffold: MV3 manifest, ported queue and daily routing from Mouse4,
  IndexedDB image store, region capture with the full Mouse4 annotation set,
  Mouse4-style toolbar, and scroll-stitched long capture.

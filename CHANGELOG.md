# Changelog

All notable changes to ShotThink. The version here must match
`manifest.json`; Chrome only reloads an unpacked extension's code when that
number changes, so every user-visible fix bumps it.

## [0.6.0] - 2026-10-18

### Fixed

- **The editor opened at a fixed centre, not where the mouse was.** The pointer
position is now tracked on every move, so choosing the text tool opens the
editor at the spot the user is pointing at. Falls back to the selection centre,
then the viewport centre.
- **The editor was invisible on a white page.** Removing the frame in 0.5.0 went
too far: with no border and no fill, the caret could not be found on light
content. The editor now has a thin blue border plus a dark outer ring, so it
reads on both light and dark backgrounds, with a very faint fill (10% grey) to
locate the caret without covering the content underneath.

### Notes

- The editor is kept off the toolbar and the colour panel, and clamped inside
the viewport, so it never opens on top of the buttons or gets clipped.
- This is a deliberate middle ground between 0.4.0's opaque dark box (which
covered the page) and 0.5.0's fully transparent editor (which had no visible
caret).

## [0.5.0] - 2026-10-18

### Fixed

- **Picking the text tool now opens the editor immediately.** Choosing T used to
only arm the tool; the user then had to click the canvas, which was not
obvious. The editor now opens at the centre of the selection (or the viewport
when there is none) with the caret already in it, so typing can start at once.
Clicking elsewhere while the tool is active still moves it.
- **Canvas text sat too low.** `textBaseline` was `'top'`, so the drawn text
hung below the point the user clicked. It is now `'middle'`, matching the
editor's own vertical centring, which also stops the text jumping when the
editor is committed.
- **The editor was centred on its corner, not on the click.** The box is now
centred on the point in both axes, and the commit records that point from
`dataset.originX/Y` rather than from the box's top-left corner.

### Changed

- **Text editor restyled: transparent, frameless, centred.** The white-framed
dark box from 0.4.0 was rejected — it covered the content underneath and read
as a dialog rather than an annotation. The editor is now plain bold text at the
annotation colour with a native caret, so what is typed looks like what will be
committed. `line-height: 1` makes the textarea's line box match the canvas
line box exactly.

## [0.4.0] - 2026-10-18

### Fixed

- **The text colour in the editor did not match what got committed.** Two bugs
combined: clicking a swatch updated `state.color` but never touched the open
`<textarea>`, and `commitTextInput` then read `state.color` instead of what the
box displayed. So the editor showed red, and changing to blue before pressing
Enter saved blue. The editor now owns its colour: swatches push it onto the
element and the commit reads it back from `dataset.color`.
- **The first click with the text tool did nothing.** Opening the editor required
three conditions — a selection, the text tool active, and then a click inside
the selection. Now the text tool works before any region exists: pick T, click,
type.
- **Characters rendered with gaps between them.** `white-space: pre` preserved
the soft-wrap breaks a textarea inserts. Changed to `pre-wrap`, and the box is
measured with the same font the canvas uses.

### Changed

- **Text editor restyled to WeChat's pattern:** white frame, dark translucent
fill, annotation colour as the text colour. The dark fill is what makes it
readable over both white and black page content; the white frame carries the
identity; the coloured text shows exactly what will be committed.
- **Toolbar default is now 22px** (was 31). Options are 22 / 26 / 31. Live
feedback across three rounds: 31 read as oversized, 26 was still large, 22 puts
the icon near body-text height. Icons remain 52% of the button (11px at 22px).
- **Annotation font sizes** are now `[12, 16, 20, 24, 32, 40, 48]` with 16px as
the default, matching ordinary body text. Mouse4's 24 was sized for a desktop
tool.
- **Colour and font size are remembered** between captures (`annotateColor`,
`annotateFontSize`), with black as the first-run colour.

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

/* ShotThink UI regression tests.
 *
 * Run with:  node tests/ui.test.mjs
 *
 * These pin the four defects reported after the first live install:
 *
 *   1. the toolbar showed before any region was selected
 *   2. the colour panel showed before any tool was selected
 *   3. toolbar buttons were too large on a scaled display
 *   4. the suggested shortcut was one Chrome reserves
 *
 * Each of those came from a plausible-looking value rather than a logic error,
 * so they are easy to reintroduce.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = name => fs.readFile(new URL(`../${name}`, import.meta.url), 'utf8');

const overlay = await read('src/overlay.js');
const manifest = JSON.parse(await read('manifest.json'));
const diagnose = await read('ui/diagnose.js');
const background = await read('src/background.js');

/* ---------------------------------------------------------------- helpers */

const results = [];
const pendingTests = [];
function test(name, fn) {
  pendingTests.push((async () => {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error });
    }
  })());
}

/** Every dimension driven by --st-scale in the stylesheet. */
function scaledValues(source) {
  return [...source.matchAll(/calc\(var\(--st-scale\)\s*\*\s*([\d.]+)px\)/g)].map(m => Number(m[1]));
}

/**
 * Mouse4's adapt_to_screen: side = round(46 * logicalDotsPerInch / 144).
 * In CSS pixels the devicePixelRatio cancels, so this is a constant.
 */
function mouse4ButtonCssPx() {
  return Math.round(46 * 96 / 144);
}

/* ------------------------------------------------------- visibility bugs */

test('the toolbar is created hidden', () => {
  // Regression: .st-toolbar { display: flex } overrides [hidden], so without an
  // explicit rule the toolbar is visible from the moment it is created.
  assert.match(
    overlay,
    /toolbar\.hidden\s*=\s*true/,
    'buildToolbar must set toolbar.hidden = true'
  );
});

test('the stylesheet honours [hidden] despite display: flex', () => {
  assert.match(
    overlay,
    /\.st-toolbar\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/,
    'a [hidden] rule with !important is required because flex overrides it'
  );
  assert.match(
    overlay,
    /\.st-colors\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/,
    'the colour panel needs the same rule'
  );
});

test('the colour panel starts hidden', () => {
  assert.match(overlay, /colorsPanel\.hidden\s*=\s*true/);
});

test('the colour panel only shows once a tool is active', () => {
  // Regression: it used to be shown whenever a selection existed.
  assert.match(
    overlay,
    /colorsPanel\.hidden\s*=\s*!toolActive/,
    'visibility must follow the active tool, not the selection'
  );
  assert.match(
    overlay,
    /const toolActive\s*=\s*Boolean\(state\.mode\)/,
    'toolActive must be derived from state.mode'
  );
});

test('the size selector is only shown for the text tool', () => {
  assert.match(
    overlay,
    /sizeSelect\.style\.display\s*=\s*state\.mode\s*===\s*'text'\s*\?\s*''\s*:\s*'none'/
  );
});

test('the toolbar is revealed only after a valid selection', () => {
  // onPointerUp sets toolbar.hidden = false; onPointerDown hides it again.
  const reveal = overlay.indexOf('toolbar.hidden = false');
  const hide = overlay.indexOf('toolbar.hidden = true');
  assert.ok(reveal > 0, 'selection completion must reveal the toolbar');
  assert.ok(hide > 0, 'starting a selection must hide it');
});

/* ------------------------------------------------------------ sizing bug */

test('toolbar dimensions are expressed through --st-scale', () => {
  // Regression: hard-coded 42px buttons looked oversized on a scaled display.
  assert.match(overlay, /--st-scale/);
  const values = scaledValues(overlay);
  assert.ok(values.length >= 6, `expected several scaled dimensions, saw ${values.length}`);
});

test('the scale factor does not depend on devicePixelRatio', () => {
  // CSS pixels already encode OS scaling. Dividing by dpr again shrinks the
  // toolbar on exactly the displays that need it normal-sized.
  const block = overlay.slice(overlay.indexOf('const scale ='));
  const line = block.slice(0, block.indexOf(';') + 1);
  assert.ok(!/devicePixelRatio/.test(line), `scale must not use dpr: ${line.trim()}`);
});

test('the scale factor reproduces Mouse4 proportions', () => {
  const scale = 96 / 144;
  const buttonPx = Math.round(46 * scale);
  assert.equal(buttonPx, mouse4ButtonCssPx(), 'button must match Mouse4 adapt_to_screen');
  assert.equal(buttonPx, 31, 'known good value on every DPR tested');
});

test('--st-scale carries the button edge length directly', () => {
  // The setting is a pixel value (26 / 28 / 31), so the variable is that number
  // and the button multiplies by 1px. This keeps one setting driving every
  // other dimension as a fraction of it.
  const block = overlay.slice(overlay.indexOf('.st-toolbar button {'));
  const width = block.match(/width:\s*calc\(var\(--st-scale\)\s*\*\s*([\d.]+)px\)/);
  assert.ok(width, 'button width must use the scale variable');
  assert.equal(Number(width[1]), 1, 'button width must equal --st-scale exactly');
  assert.match(overlay, /setProperty\('--st-scale',\s*String\(buttonPx\)\)/);
});

test('the icon keeps Mouse4 proportion of the button', () => {
  // Mouse4/ui/toolbar.py: side = round(46 * scale), icon_side = round(24 * scale)
  const block = overlay.slice(overlay.indexOf('.st-toolbar svg'));
  const width = block.match(/width:\s*calc\(var\(--st-scale\)\s*\*\s*([\d.]+)px\)/);
  assert.ok(width, 'icon size must use the scale variable');
  const ratio = Number(width[1]);
  assert.ok(Math.abs(ratio - 24 / 46) < 0.01, `icon ratio should be 24/46, saw ${ratio}`);
});

test('the default toolbar size is 22px', () => {
  // 31 (Mouse4's adapt_to_screen result) read as oversized, then 26 was still
  // large; 22 puts the icon near body-text height.
  assert.match(overlay, /const DEFAULT_BUTTON_PX = 22/);
  assert.match(overlay, /const BASE_BUTTON_PX = 22/);
});

test('toolbar size options are 22 / 26 / 31', async () => {
  const html = await read('ui/options.html');
  const values = [...html.matchAll(/data-scale="(\d+)"/g)].map(m => Number(m[1]));
  assert.deepEqual(values, [22, 26, 31]);
});

/* ------------------------------------------------------- text annotation */

test('the text tool opens an editor without requiring a selection', () => {
  // Regression: the first click did nothing because a selection was required
  // first, so users had to click twice.
  assert.match(
    overlay,
    /state\.mode === 'text' && !state\.selection/,
    'the text tool must work before a region exists'
  );
});

test('the editor is focused as soon as it opens', () => {
  assert.match(overlay, /input\.focus\(\)/);
});

test('the editor uses a white frame on a dark fill', async () => {
  // WeChat-style: readable over both white and black page content.
  const css = overlay.slice(overlay.indexOf('.st-input {'));
  const block = css.slice(0, css.indexOf('}'));
  assert.match(block, /border:\s*2px solid #ffffff/i, 'frame must be white');
  assert.match(block, /background:\s*rgba\(0,\s*0,\s*0,\s*0?\.7/, 'fill must be dark translucent');
});

test('the editor text colour follows the selected swatch', () => {
  // Regression: the box showed one colour while the commit recorded another.
  assert.match(overlay, /function applyInputColor/, 'colour must be applied through one path');
  assert.match(overlay, /if \(textInput\) applyInputColor\(textInput, color\)/,
    'clicking a swatch must update an open editor');
});

test('committing reads the colour from the element, not from state', () => {
  // The element is the source of truth for what the user saw.
  assert.match(overlay, /textInput\.dataset\.color/);
});

test('the editor does not preserve soft-wrap whitespace', () => {
  // `white-space: pre` preserved the breaks a textarea inserts, which rendered
  // as spaces between characters.
  const css = overlay.slice(overlay.indexOf('.st-input {'));
  const block = css.slice(0, css.indexOf('}'));
  assert.match(block, /white-space:\s*pre-wrap/, 'must be pre-wrap, not pre');
  assert.ok(!/white-space:\s*pre\s*;/.test(block), 'plain pre must not be used');
});

test('annotation font sizes start small and default to 16', () => {
  assert.match(overlay, /const FONT_SIZES = \[12, 16, 20, 24, 32, 40, 48\]/);
  assert.match(overlay, /const DEFAULT_FONT_SIZE = 16/);
});

test('the first-run annotation colour is black', () => {
  assert.match(overlay, /color: PALETTE\[PALETTE\.length - 1\]/);
});

test('colour and font size are remembered between captures', () => {
  assert.match(background, /annotateColor/);
  assert.match(background, /annotateFontSize/);
  assert.match(overlay, /saveAnnotatePrefs/);
});

/* --------------------------------------------------------- shortcut bugs */

test('the suggested shortcut is not one Chrome reserves', () => {
  const shortcut = manifest.commands?.capture?.suggested_key?.default;
  assert.ok(shortcut, 'a default shortcut must be suggested');
  // Ctrl+Shift+S is "Save page as"; Chrome drops it and the command ends up
  // unbound with no error.
  assert.notEqual(shortcut, 'Ctrl+Shift+S');
  assert.equal(shortcut, 'Alt+Shift+S');
});

test('the capture command is declared', () => {
  assert.ok(manifest.commands?.capture, 'manifest must declare the capture command');
  assert.ok(manifest.commands.capture.description);
});

test('the diagnostics page reports the bound shortcut', () => {
  assert.match(diagnose, /chrome\.commands\.getAll\(\)/);
  assert.match(diagnose, /chrome:\/\/extensions\/shortcuts/, 'must link to the shortcuts page');
});

test('the diagnostics page warns about a reserved binding', () => {
  // A user can still set Ctrl+Shift+S by hand; it will not fire.
  assert.match(diagnose, /Ctrl\+Shift\+S/);
});

test('the manifest version is visible to the user', () => {
  // Without a visible version, a reload that did not pick up new code is
  // indistinguishable from a fix that did not work.
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(diagnose, /getManifest\(\)\.version/);
  assert.match(diagnose, /\$\('version'\)/);
});

test('the manifest version was bumped past the first scaffold', () => {
  const [major, minor] = manifest.version.split('.').map(Number);
  assert.ok(major > 0 || minor >= 2, `expected >= 0.2.0, saw ${manifest.version}`);
});

/* ------------------------------------------------------------ reporting */

test('a failed capture reports through the badge, not an injected alert', () => {
  // Regression: the old fallback called alert() inside the page, which needs
  // the permission that just failed, so nothing was ever shown.
  assert.match(background, /setBadgeText/);
  assert.ok(
    !/func:\s*message\s*=>\s*alert\(message\)/.test(background),
    'the alert() fallback must be gone'
  );
});

test('failure is surfaced via the badge and storage', () => {
  assert.match(background, /setBadgeText/);
  assert.match(background, /lastCaptureError/);
});

test('restricted URLs are detected before injection is attempted', () => {
  assert.match(background, /function isRestrictedUrl/);
  assert.match(background, /chromewebstore/);
  // The check must run before executeScript, or the user gets the generic
  // "cannot access" error instead of the specific one.
  const check = background.indexOf('isRestrictedUrl(url)');
  const inject = background.indexOf("files: ['src/i18n.js'");
  assert.ok(check > 0, 'isRestrictedUrl must be called');
  assert.ok(inject > 0, 'injection call must exist');
  assert.ok(check < inject, 'restricted check must precede injection');
});

test('a missing activeTab grant is not reported as an uncapturable page', () => {
  // These are different causes and need different advice: one means reload the
  // tab, the other means the page can never be captured.
  assert.match(background, /Cannot access contents/);
  assert.match(background, /刷新/);
});

/* ------------------------------------------------------- language / theme */

test('language defaults to the browser locale', async () => {
  // Requirement: a Chinese browser shows Chinese, anything else shows English,
  // but the user can override either way.
  assert.match(background, /shotThinkLang/);
  const i18n = await read('src/i18n.js');
  assert.match(i18n, /getUILanguage/, 'must read the browser language');
  assert.match(i18n, /shotThinkSetLanguage/, 'must allow an explicit override');
});

test('both extension pages offer a language switch', async () => {
  for (const page of ['ui/options.html', 'ui/diagnose.html']) {
    const html = await read(page);
    assert.match(html, /data-lang="zh"/, `${page} needs a Chinese option`);
    assert.match(html, /data-lang="en"/, `${page} needs an English option`);
  }
});

test('both extension pages offer a theme switch', async () => {
  for (const page of ['ui/options.html', 'ui/diagnose.html']) {
    const html = await read(page);
    assert.match(html, /data-theme-opt="light"/, `${page} needs light`);
    assert.match(html, /data-theme-opt="dark"/, `${page} needs dark`);
    assert.match(html, /data-theme-opt="system"/, `${page} needs follow-system`);
  }
});

test('the stylesheet defines both themes', async () => {
  const css = await read('ui/base.css');
  assert.match(css, /:root\[data-theme="light"\]/, 'light theme tokens are required');
  assert.match(css, /--bg:/, 'shared tokens are required');
});

test('the language switch itself is not translated', async () => {
  // data-no-i18n keeps "中文" readable when the UI is in English.
  for (const page of ['ui/options.html', 'ui/diagnose.html']) {
    const html = await read(page);
    assert.match(html, /data-no-i18n/, `${page} must protect the language switch`);
  }
});

/* ---------------------------------------------------------------- report */

await Promise.all(pendingTests);

const failed = results.filter(r => !r.ok);
for (const result of results) {
  console.log(`${result.ok ? 'ok  ' : 'FAIL'}  ${result.name}`);
  if (!result.ok) console.log(`      ${result.error.message}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);

/* ShotThink diagnostics page.
 *
 * Answers the question "why did nothing happen when I clicked the icon?"
 * without requiring the user to open devtools. Everything here reads only the
 * extension's own state and the current tab's URL, never page content.
 */

const $ = id => document.getElementById(id);

function row(label, value, state) {
  const div = document.createElement('div');
  div.className = 'row';
  const k = document.createElement('span');
  k.className = 'k';
  k.textContent = label;
  const v = document.createElement('span');
  v.className = 'v' + (state ? ` ${state}` : '');
  v.textContent = value;
  div.append(k, v);
  return div;
}

function isRestricted(url = '') {
  return /^(chrome|edge|about|devtools|view-source|chrome-extension|chrome-untrusted|chrome-search):/i.test(url) ||
    /^https:\/\/chromewebstore\.google\.com\//i.test(url) ||
    /^https:\/\/chrome\.google\.com\/webstore\//i.test(url);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function render() {
  const checks = $('checks');
  checks.replaceChildren();

  // Version first, so a reload that did not pick up new code is obvious.
  const version = chrome.runtime.getManifest().version;
  $('version').textContent = `v${version}`;

  // 1. Manifest / worker alive. If this page rendered, the worker answered.
  checks.append(row('扩展版本', `v${version}`, 'ok'));
  checks.append(row('扩展后台', '已运行', 'ok'));

  // 2. Which tab would be captured.
  let tab;
  try {
    tab = await activeTab();
  } catch (error) {
    checks.append(row('当前标签页', `无法读取：${error.message}`, 'err'));
  }

  let verdict = { text: '', state: 'ok' };

  if (tab) {
    checks.append(row('标签页', tab.url || '(未知)', ''));
    const restricted = isRestricted(tab.url);
    checks.append(row(
      '可截图',
      restricted ? '否 — 浏览器禁止在此类页面注入脚本' : '是',
      restricted ? 'err' : 'ok'
    ));
    if (restricted) {
      verdict = { text: '当前标签页无法截图。请切换到普通网页（http/https）后再试。', state: 'err' };
    }
  }

  // 3. Stored failure, written by the worker when a capture attempt failed.
  // A recorded failure is more specific than "this looks capturable", so it
  // takes precedence over the URL-based guess above.
  const { lastCaptureError } = await chrome.storage.local.get('lastCaptureError');
  const box = $('lastError');
  box.replaceChildren();
  if (lastCaptureError) {
    box.append(row('时间', new Date(lastCaptureError.at).toLocaleString()));
    box.append(row('原因', lastCaptureError.message, 'err'));
    const permissionish = /权限|刷新|Cannot access/i.test(lastCaptureError.message);
    verdict = {
      text: permissionish
        ? '上次失败是因为扩展还没拿到这个标签页的访问权限。先点“刷新当前标签页”，加载完再点图标或按 Ctrl+Shift+S。'
        : lastCaptureError.message,
      state: permissionish ? 'warn' : 'err'
    };
  } else {
    box.append(row('无记录', '还没有失败的截图尝试'));
  }

  // 4. Permissions actually granted.
  const manifest = chrome.runtime.getManifest();
  const perms = $('perms');
  perms.replaceChildren();
  perms.append(row('permissions', (manifest.permissions || []).join(', ')));
  perms.append(row('host_permissions', (manifest.host_permissions || []).join(', ') || '(无)'));
  perms.append(row(
    'activeTab 说明',
    '点图标或按快捷键时临时授权当前标签页，不会长期访问所有网站'
  ));

  // 5. The shortcut that is actually bound. `Ctrl+Shift+S` is not usable:
  // Chrome reserves it for "Save page as", so a manifest suggestion for it is
  // silently dropped and the command ends up unbound. MV3 has no
  // `chrome.commands.update`, so the user has to set it on the shortcuts page.
  try {
    const commands = await chrome.commands.getAll();
    const capture = commands.find(c => c.name === 'capture');
    const bound = capture?.shortcut || '';
    if (bound) {
      perms.append(row('截图快捷键', bound, 'ok'));
    } else {
      perms.append(row('截图快捷键', '未绑定', 'err'));
      const fix = document.createElement('div');
      fix.className = 'row';
      const label = document.createElement('span');
      label.className = 'k';
      label.textContent = '去设置';
      const link = document.createElement('a');
      link.className = 'v';
      link.textContent = 'chrome://extensions/shortcuts';
      link.href = '#';
      link.addEventListener('click', event => {
        event.preventDefault();
        void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      });
      fix.append(label, link);
      perms.append(fix);
      if (!verdict.text) {
        verdict = {
          text: '截图快捷键没有绑定。点上面的链接设置一个（例如 Alt+Shift+S），或者直接点工具栏图标。',
          state: 'warn'
        };
      }
    }
    // A reserved combination silently fails to bind, so warn about it by name.
    if (bound === 'Ctrl+Shift+S') {
      perms.append(row('提示', 'Ctrl+Shift+S 被 Chrome 的“另存为”占用，可能不生效', 'warn'));
    }
  } catch (error) {
    perms.append(row('截图快捷键', `无法读取：${error.message}`, 'warn'));
  }

  if (!verdict.text) {
    verdict = { text: '没有发现阻止截图的问题。如果点击仍然无反应，刷新标签页后再试。', state: 'ok' };
  }
  const v = $('verdict');
  v.textContent = verdict.text;
  v.className = 'verdict ' + verdict.state;
}

$('reload').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab?.id) return;
  // Reloading is the actual fix for the most common cause: the tab existed
  // before the extension was installed, so no content script can reach it.
  await chrome.tabs.reload(tab.id);
  const v = $('verdict');
  v.textContent = '已刷新。等页面加载完成后，点扩展图标或按 Ctrl+Shift+S 再试一次。';
  v.className = 'verdict ok';
});

$('clear').addEventListener('click', async () => {
  await chrome.storage.local.remove('lastCaptureError');
  void render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.lastCaptureError) void render();
});

(async () => {
  if (typeof shotThinkLocalizePage === 'function') shotThinkLocalizePage();
  await render();
})();

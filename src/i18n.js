/* ShotThink UI language.
 *
 * Language is a stored preference, not a property of the browser locale:
 * `uiLanguage` is 'zh' or 'en', defaulting to the browser language on first
 * run. Pages call `shotThinkApplyLanguage` after reading it from storage.
 *
 * The overlay runs in a page context where storage is not available, so it
 * receives the resolved language through `shotThinkSetLanguage`.
 */

globalThis.shotThinkEnglish = {
  // Product
  'ShotThink 截图分析': 'ShotThink Screenshot Analysis',
  '每天一个聊天': 'One chat per day',
  '界面': 'Interface',
  '界面语言': 'Interface language',
  '主题': 'Theme',
  '浅色': 'Light',
  '深色': 'Dark',
  '跟随系统': 'Follow system',
  '工具栏大小': 'Toolbar size',
  '紧凑': 'Compact',
  '标准': 'Standard',
  '宽松': 'Roomy',
  '截图时工具栏上每个按钮的边长，对应 26 / 28 / 31 像素。显示缩放较高时选“紧凑”。':
    'Edge length of each toolbar button during capture: 26, 28 or 31 pixels. Pick Compact on a display with high scaling.',

  '点击工具栏图标或按 ': 'Click the toolbar icon, or press ',
  ' 框选网页内容，标注后发送到你自己已登录的 ChatGPT 账号。':
    ' to select part of a page, annotate it, and send it to your own signed-in ChatGPT account.',

  // Capture
  '框选要发送的区域': 'Select the area to send',
  '准备截图…': 'Preparing screenshot…',
  '截图失败，请刷新页面后重试。': 'Capture failed. Reload the page and try again.',
  '此页面无法截图。': 'This page cannot be captured.',
  '扩展自身的页面无法截图。请切换到普通网页后再试。':
    'Extension pages cannot be captured. Switch to a normal web page and try again.',
  '还没有权限访问这个标签页。请刷新页面，或先点一下页面再按快捷键。':
    'No access to this tab yet. Reload the page, or click on it before pressing the shortcut.',
  '页面正在滚动，请稍候。': 'The page is still scrolling. Please wait.',

  // Annotation
  '矩形': 'Rectangle',
  '椭圆': 'Ellipse',
  '箭头': 'Arrow',
  '画笔': 'Pen',
  '文字': 'Text',
  '马赛克': 'Mosaic',
  '撤销': 'Undo',
  '长截图': 'Long capture',
  '保存并复制': 'Save and copy',
  '发送给 AI': 'Send to AI',
  '取消': 'Cancel',

  // Send
  '发送记录': 'Send history',
  '还没有发送记录。截一张图开始。': 'No captures yet. Take one to get started.',
  '排队中': 'Queued',
  '准备日期聊天': 'Preparing daily chat',
  '上传截图': 'Uploading screenshot',
  '正在写入文字': 'Writing selected text',
  '正在确认发送': 'Confirming delivery',
  '已确认发送': 'Sent',
  '已转人工处理': 'Moved to manual review',
  '待人工核对，未自动重发': 'Manual check required; not resent',
  '人工处理': 'Manual review',
  '显示全部': 'Show all',
  '清除记录': 'Clear record',
  '确认后清除': 'Confirm and clear',
  '清理已发送记录': 'Clear sent records',
  ' 查看对话': ' Open chat',
  '查看对话': 'Open chat',

  // Selected text
  '发送到AI': 'Send to AI',
  '浏览器选中文字': 'Selected browser text',
  '选中文字过长，请分段发送。': 'The selected text is too long. Send it in smaller sections.',

  // Guard rails
  '发现已有草稿，已停止，避免覆盖。': 'Existing draft found. Sending stopped to preserve it.',
  '上一条回答尚未结束，任务已暂停，不会插入或打断回答。': 'Previous response has not finished. Task paused.',
  '找不到聊天输入框，请检查是否登录，或页面结构是否变化。': 'Could not find the chat composer. Check sign-in or page layout.',
  '没有确认到截图附件，已停止，防止只发送文字。': 'Image attachment not confirmed. Sending stopped.',
  '提交前无法确认 Chat 模式，已停止，未发送；请检查页面草稿。': 'Chat mode could not be confirmed before submission. Nothing was sent; check the draft.',
  '已尝试发送，但无法确认截图和规则入库。请查看标签页，不要重复发送。': 'Submission attempted but delivery could not be confirmed. Check the chat tab before retrying.',
  '发送结果未知。': 'Delivery is uncertain.',
  '发送进程中断，请查看对应标签页；不会自动重发。': 'Sending interrupted. Check the chat tab; nothing will be resent automatically.',
  '此项不会自动重发，后续任务继续发送。': 'This item will not be resent automatically. Later tasks continue.',
  '可能已经发送；确认对应对话后再清除。': 'It may have been sent. Check the conversation before clearing it.',
  '请先确认对应对话，清除后不会自动重发。': 'Check the conversation first. Clearing will not resend the screenshot.',
  '发送队列已满，请先清理完成记录。': 'Queue is full. Clear finished records first.',
  '页面跳转到登录或验证页，请在新标签页手动完成登录。': 'Complete sign-in or verification in the chat tab.',
  '页面加载超时，请检查网络及新标签页。': 'Page load timed out. Check your connection and the chat tab.',
  '需要在 ChatGPT 官方页面登录。': 'Sign in on the official ChatGPT page.',
  '截图数据无效，未发送。': 'Invalid screenshot data; not sent.',
  '截图超过 50 MB，未发送。': 'Screenshot exceeds 50 MB; not sent.',

  // Storage
  '浏览器发送队列已满，请先核对并清理旧记录。': 'Browser queue is full. Check and clear old records first.',
  '图片存储空间不足，请清理旧记录。': 'Image storage is full. Clear old records first.',
  '本地图片': 'Local images',

  // Options page
  '分析规则': 'Analysis instructions',
  '默认规则语言': 'Default rule language',
  '恢复默认规则': 'Reset to default',
  '已恢复默认规则。': 'Default rules restored.',
  '规则已随界面语言更新。': 'Rules updated to match the interface language.',
  '规则语言已切换；已保留你修改过的规则。': 'Rule language switched; your edited rules were kept.',
  '保存': 'Save',
  '已保存。': 'Saved.',
  '已发送记录已清理。': 'Sent records cleared.',
  '已移出人工处理；原始截图和诊断信息仍保留。': 'Removed from manual review. The original screenshot and diagnostics are retained.',
  '检查不会重新发送。': 'Checking does not resend images.',
  '检查待核对消息': 'Check uncertain messages',
  '截图无法启动？': 'Capture will not start?',
  '恢复发送': 'Resume sending',
  '发送遇到问题': 'Troubleshooting',
  '不支持的请求。': 'Unsupported request.',

  // Diagnostics
  'ShotThink 诊断': 'ShotThink Diagnostics',
  '截图无法启动时，先在这里看原因。这个页面只读取本扩展自己的状态，不读取网页内容。':
    'When a capture will not start, look here first. This page reads only the extension\'s own state, never page content.',
  '扩展状态': 'Extension status',
  '最近一次失败': 'Last failure',
  '权限': 'Permissions',
  '扩展版本': 'Version',
  '扩展后台': 'Background worker',
  '已运行': 'Running',
  '当前标签页': 'Current tab',
  '标签页': 'Tab',
  '可截图': 'Capturable',
  '是': 'Yes',
  '否 — 浏览器禁止在此类页面注入脚本': 'No — the browser blocks scripts on this kind of page',
  '时间': 'Time',
  '原因': 'Reason',
  '无记录': 'No record',
  '还没有失败的截图尝试': 'No failed capture yet',
  'activeTab 说明': 'About activeTab',
  '点图标或按快捷键时临时授权当前标签页，不会长期访问所有网站':
    'Grants the current tab when you click the icon or press the shortcut. No standing access to every site.',
  '截图快捷键': 'Capture shortcut',
  '未绑定': 'Not bound',
  '去设置': 'Set it up',
  '提示': 'Note',
  'Ctrl+Shift+S 被 Chrome 的“另存为”占用，可能不生效':
    'Ctrl+Shift+S is reserved by Chrome for "Save page as" and may not fire',
  '截图快捷键没有绑定。点上面的链接设置一个（例如 Alt+Shift+S），或者直接点工具栏图标。':
    'The capture shortcut is not bound. Use the link above to set one (Alt+Shift+S, for example), or just click the toolbar icon.',
  '刷新当前标签页': 'Reload this tab',
  '清除记录': 'Clear record',
  '已刷新。等页面加载完成后，点扩展图标或按 Ctrl+Shift+S 再试一次。':
    'Reloaded. Once the page finishes loading, click the icon or press Alt+Shift+S.',
  '正在检查…': 'Checking…',
  '没有发现阻止截图的问题。如果点击仍然无反应，刷新标签页后再试。':
    'Nothing is blocking capture. If clicking still does nothing, reload the tab and try again.',
  '当前标签页无法截图。请切换到普通网页（http/https）后再试。':
    'This tab cannot be captured. Switch to a normal web page (http/https) and try again.',
  '上次失败是因为扩展还没拿到这个标签页的访问权限。先点“刷新当前标签页”，加载完再点图标或按 Alt+Shift+S。':
    'The last attempt failed because the extension had no access to this tab yet. Click "Reload this tab", then use the icon or Alt+Shift+S once it has loaded.',
  '无法读取': 'Could not read'
};

/* Resolved language for this context. */
globalThis.shotThinkLang = /^zh\b/i.test(
  (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage?.()) || 'en'
) ? 'zh' : 'en';

/* Kept for call sites that only need a boolean. */
Object.defineProperty(globalThis, 'shotThinkChinese', {
  get: () => globalThis.shotThinkLang === 'zh',
  configurable: true
});

globalThis.shotThinkSetLanguage = lang => {
  globalThis.shotThinkLang = lang === 'en' ? 'en' : 'zh';
};

globalThis.shotThinkText = text => {
  if (globalThis.shotThinkLang === 'zh' || typeof text !== 'string') return text;
  if (Object.hasOwn(shotThinkEnglish, text)) return shotThinkEnglish[text];
  for (const [zh, en] of Object.entries(shotThinkEnglish).sort((a, b) => b[0].length - a[0].length)) {
    text = text.split(zh).join(en);
  }
  return text;
};

/* Rewrite every text node and label in place. Elements marked data-no-i18n are
 * skipped: the language switch itself must not be translated.
 *
 * Text nodes are translated individually, so a paragraph containing inline
 * markup (a <kbd> shortcut, a <code> path) keeps its structure. Each fragment
 * is matched on its own, which is why partial strings are also in the table. */
globalThis.shotThinkLocalizePage = () => {
  document.documentElement.lang = globalThis.shotThinkLang === 'zh' ? 'zh-CN' : 'en';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement?.closest('script,textarea,[data-no-i18n]')) continue;
    node.textContent = shotThinkText(node.textContent);
  }
  for (const element of document.querySelectorAll('[aria-label],[title],[placeholder]')) {
    if (element.closest('[data-no-i18n]')) continue;
    for (const attribute of ['aria-label', 'title', 'placeholder']) {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, shotThinkText(value));
    }
  }
};

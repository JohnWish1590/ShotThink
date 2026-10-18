/* ShotThink UI language: Chinese Chrome gets Chinese, everything else English.
   Ported from Mouse4's chrome-extension/i18n.js and rebranded. */
globalThis.shotThinkChinese = /^zh\b/i.test(chrome.i18n.getUILanguage());

const shotThinkEnglish = {
  // Product
  'ShotThink · 截图、分析，继续你的工作。': 'ShotThink · Capture, analyze, and keep working.',
  'ShotThink 截图分析': 'ShotThink Screenshot Analysis',
  '每天一个聊天': 'One chat per day',

  // Capture
  '框选要发送的区域': 'Select the area to send',
  '准备截图…': 'Preparing screenshot…',
  '截图失败，请刷新页面后重试。': 'Capture failed. Reload the page and try again.',
  '此页面无法截图。': 'This page cannot be captured.',
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

  // Storage
  '浏览器发送队列已满，请先核对并清理旧记录。': 'Browser queue is full. Check and clear old records first.',
  '图片存储空间不足，请清理旧记录。': 'Image storage is full. Clear old records first.',

  // Options page
  '分析规则': 'Analysis instructions',
  '保存': 'Save',
  '已保存。': 'Saved.',
  '连接状态': 'Connection status',
  '已连接 ChatGPT。': 'ChatGPT connected.',
  '未检测到 ChatGPT 登录。': 'No ChatGPT sign-in detected.',
  '从此页面发送图片': 'Send images from this page',
  '选择图片': 'Choose images',
  '发送给 ChatGPT': 'Send to ChatGPT',
  '发送遇到问题': 'Troubleshooting',
  '检查待核对消息': 'Check uncertain messages',
  '检查不会重新发送。': 'Checking does not resend images.',
  '不支持的请求。': 'Unsupported request.'
};

globalThis.shotThinkText = text => {
  if (shotThinkChinese || typeof text !== 'string') return text;
  if (Object.hasOwn(shotThinkEnglish, text)) return shotThinkEnglish[text];
  for (const [zh, en] of Object.entries(shotThinkEnglish).sort((a, b) => b[0].length - a[0].length)) {
    text = text.split(zh).join(en);
  }
  return text;
};

globalThis.shotThinkLocalizePage = () => {
  document.documentElement.lang = shotThinkChinese ? 'zh-CN' : 'en';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.parentElement.closest('script,textarea')) node.textContent = shotThinkText(node.textContent);
  }
  for (const element of document.querySelectorAll('[aria-label]')) {
    element.setAttribute('aria-label', shotThinkText(element.getAttribute('aria-label')));
  }
};

/* ShotThink landing page i18n.
 *
 * Both languages live in this file so the page itself stays a single HTML
 * document. Text is applied by data-i18n keys rather than by swapping innerHTML:
 * that keeps links, <code> and <strong> in the markup instead of in strings.
 *
 * Language resolution order: stored choice, then ?lang= query, then the
 * browser language, then English.
 */

const I18N = {
  en: {
    'meta.title': 'ShotThink — Capture, annotate, ask. Free Chrome extension.',
    'meta.desc': 'A free Chrome extension that sends a browser screenshot to your own ChatGPT conversation. No API key, no subscription, no per-request billing.',

    'nav.features': 'Features',
    'nav.install': 'Install',
    'nav.safety': 'Safety',
    'nav.faq': 'FAQ',
    'nav.download': 'Download',
    'nav.lang': '中文',

    'hero.h1': 'Capture. Annotate. <em>Ask.</em>',
    'hero.lead': 'A Chrome extension that sends a browser screenshot straight into your own ChatGPT conversation. Capture a region, mark it up, and it lands in a dated chat with your standing instructions attached.',
    'hero.cta': 'Download for Chrome',
    'hero.source': 'View source',
    'hero.note': '<strong>Free.</strong> No API key, no subscription, no per-request billing. MIT licensed.',
    'hero.alt': 'Selecting a region, annotating it with a rectangle and arrow, and sending it to ChatGPT',

    'free.h2': 'Why it costs nothing',
    'free.p1': 'ShotThink does not call the OpenAI API. It drives the ChatGPT page you are already signed in to: it picks the file input, writes your instructions into the editor, and clicks send.',
    'free.p2': 'So it spends <strong>whatever your existing subscription already covers</strong>, instead of billing you per token. There is no key to obtain and nothing to top up.',
    'free.p3': "The trade-off is that delivery depends on ChatGPT's page structure and on a background tab staying open. Every guard in the tool exists because of that.",

    'features.h2': 'What it does',
    'features.sub': 'Everything a screenshot tool needs, nothing it does not.',
    'f1.h': 'Region capture',
    'f1.p': 'Pixel-accurate at any display scaling, including 125% and 150% Windows scaling.',
    'f2.h': 'Six annotation tools',
    'f2.p': 'Rectangle, ellipse, arrow, pen, text and mosaic, with undo. Colours and font size are remembered.',
    'f3.h': 'Text that previews itself',
    'f3.p': 'Opens where your mouse is, wraps at the selection edge, and draws exactly as it looked while typing.',
    'f4.h': 'Long capture',
    'f4.p': 'Scrolls the page and stitches by exact scroll position. Sticky headers are suppressed so they do not repeat.',
    'f5.h': 'One chat per day',
    'f5.p': 'Each day gets a conversation named <code>YYYY-MM-DD</code>. Later captures append to it, numbered.',
    'f6.h': 'Selected text',
    'f6.p': 'Right-click any selected text → Send to AI. No clipboard reading, no global keyboard hooks.',

    'install.h2': 'Install',
    'install.sub': 'ShotThink is not on the Chrome Web Store — it automates a third-party site, which is a poor fit for store review. Installing it takes about a minute.',
    'i1.h': 'Download and unzip',
    'i1.p': 'into a folder you will keep.',
    'i2.h': 'Open <code>chrome://extensions/</code>',
    'i2.p': 'and turn on <strong>Developer mode</strong> in the top right.',
    'i3.h': 'Click “Load unpacked”',
    'i3.p': 'and select the folder you unzipped.',
    'i4.h': 'Sign in to chatgpt.com',
    'i4.p': 'in the same browser profile. ShotThink uses that session; it never reads your credentials.',
    'i5.h': 'Press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>',
    'i5.p': 'or click the toolbar icon. <code>Ctrl+Shift+S</code> is reserved by Chrome for “Save page as”, so it cannot be used.',

    'safety.h2': 'Safety',
    'safety.sub': 'These are not edge cases bolted on afterwards. They are the reason the tool is usable at all.',
    's1': '<strong>A send whose outcome is unknown is never retried automatically.</strong> It is marked uncertain and you check the conversation. A duplicate screenshot in your chat is worse than asking you to look.',
    's2': '<strong>An existing draft is never overwritten.</strong> If the composer already has text in it, the send stops and tells you.',
    's3': '<strong>A generating answer is never interrupted.</strong> The queue waits for it to finish rather than cutting in.',
    's4': "<strong>Restricted pages are detected before injection.</strong> <code>chrome://</code>, the Web Store, the PDF viewer and the extension's own pages cannot be captured; the tool says so instead of failing silently.",

    'perm.h2': 'Permissions',
    'perm.sub': 'No <code>&lt;all_urls&gt;</code>. No <code>debugger</code>. No cookie access.',
    'perm.th1': 'Permission',
    'perm.th2': 'Why',
    'perm.r1': 'Capture and annotate only the tab you invoke it on. Granted by your click or shortcut — never standing access to every site.',
    'perm.r2': 'Inject the overlay into that tab.',
    'perm.r3': 'Queue metadata, the daily-chat mapping, and your settings.',
    'perm.r4': 'The “Send to AI” item for selected text.',
    'perm.r5': 'Settle jobs whose page died mid-send.',
    'perm.r6': 'Upload the image and press send on your behalf.',

    'faq.h2': 'Questions',
    'q1.h': 'Does it work with a free ChatGPT account?',
    'q1.p': 'Yes. It uses whatever the browser is signed in to. If the web page works, ShotThink works.',
    'q2.h': 'Will my screenshots be sent to your server?',
    'q2.p': 'No. There is no server. The image goes from your browser to chatgpt.com and nowhere else.',
    'q3.h': "Why can't it capture WeChat or Excel?",
    'q3.p': 'A browser extension can only see browser content. For the whole desktop, the same author makes <a href="https://github.com/JohnWish1590/Mouse4">Mouse4</a>, a Windows tool.',
    'q4.h': 'What happens if ChatGPT changes its page?',
    'q4.p': 'Sending pauses and tells you, rather than guessing. The selectors are redundant and the failure is visible, so an update can fix it quickly.',
    'q5.h': 'Do I need to keep a ChatGPT tab open?',
    'q5.p': 'Yes. It runs in the background and does not need to be in front, but closing it stops delivery.',
    'q6.h': 'Is Firefox supported?',
    'q6.p': "No. The extension relies on Chromium's <code>captureVisibleTab</code> and <code>scripting</code> behaviour.",

    'get.h2': 'Get it',
    'get.sub': 'Free, MIT licensed, and about 80 KB.',
    'get.download': 'Download v1.0.0',
    'get.source': 'Source on GitHub',
    'get.changelog': 'Changelog',

    'footer.tag': 'ShotThink · Capture, annotate, ask.',
    'footer.license': 'MIT License'
  },

  zh: {
    'meta.title': 'ShotThink — 截图，然后思考。免费 Chrome 插件',
    'meta.desc': '免费的 Chrome 插件：框选网页内容，标注后发送到你自己已登录的 ChatGPT 对话。不需要 API Key，不需要额外订阅，不按次计费。',

    'nav.features': '功能',
    'nav.install': '安装',
    'nav.safety': '安全',
    'nav.faq': '常见问题',
    'nav.download': '下载',
    'nav.lang': 'EN',

    'hero.h1': '截图。标注。<em>提问。</em>',
    'hero.lead': '一个 Chrome 插件：框选网页内容，直接发送到你自己已登录的 ChatGPT 对话。标注完，图片连同你的固定分析规则一起进入当天的对话。',
    'hero.cta': '下载 Chrome 版',
    'hero.source': '查看源码',
    'hero.note': '<strong>免费。</strong>不需要 API Key，不需要订阅，不按次计费。MIT 许可。',
    'hero.alt': '框选区域、用矩形和箭头标注，然后发送给 ChatGPT',

    'free.h2': '为什么免费',
    'free.p1': 'ShotThink 不调用 OpenAI API。它操作的是你已经登录的 ChatGPT 网页：找到上传控件、把分析规则写进编辑器、点发送。',
    'free.p2': '所以你用的是什么额度，它就用什么额度——<strong>不额外消耗你的 API 配额</strong>。不需要申请 key，不需要充值。',
    'free.p3': '代价是：能否发送成功取决于 ChatGPT 的页面结构，以及后台标签页是否保持打开。工具里所有的失败保护都是为了应对这个代价。',

    'features.h2': '能做什么',
    'features.sub': '截图工具该有的都有，不该有的都没有。',
    'f1.h': '区域截图',
    'f1.p': '按显示缩放自动适配，125%、150% 缩放下也像素级准确。',
    'f2.h': '六种标注工具',
    'f2.p': '矩形、椭圆、箭头、画笔、文字、马赛克，支持撤销。颜色和字号会记住上次的选择。',
    'f3.h': '文字所见即所得',
    'f3.p': '在鼠标位置弹出，到选区边缘才折行，提交后和输入时完全一致。',
    'f4.h': '长截图',
    'f4.p': '自动滚动并按精确位置拼接。粘性页头会被临时隐藏，不会每屏重复。',
    'f5.h': '每天一个对话',
    'f5.p': '每天的对话自动命名为 <code>YYYY-MM-DD</code>，后续截图按序号追加。',
    'f6.h': '选中文字',
    'f6.p': '右键任意选中文字 → 发送到AI。不读取剪贴板，不监听全局键盘。',

    'install.h2': '安装',
    'install.sub': 'ShotThink 没有上架 Chrome 商店——它会自动操作第三方网站，不适合走商店审核。安装大约一分钟。',
    'i1.h': '下载并解压',
    'i1.p': '到一个你会长期保留的文件夹。',
    'i2.h': '打开 <code>chrome://extensions/</code>',
    'i2.p': '打开右上角的<strong>开发者模式</strong>。',
    'i3.h': '点「加载已解压的扩展程序」',
    'i3.p': '选择刚才解压出来的文件夹。',
    'i4.h': '登录 chatgpt.com',
    'i4.p': '在同一个浏览器里登录。ShotThink 使用这个登录状态，从不读取你的凭据。',
    'i5.h': '按 <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>',
    'i5.p': '或点工具栏图标。<code>Ctrl+Shift+S</code> 被 Chrome 的「网页另存为」占用，用不了。',

    'safety.h2': '安全设计',
    'safety.sub': '这些不是事后补的补丁，而是这个工具能用的前提。',
    's1': '<strong>结果不确定时绝不自动重发。</strong>标记为待核对，让你去确认。在你和 AI 的对话里多出一张截图，比让你多看一眼更糟。',
    's2': '<strong>已有草稿不会被覆盖。</strong>如果输入框里已经有文字，发送会停下并告诉你。',
    's3': '<strong>上一条回答不会被中断。</strong>队列会等它结束，而不是插进去。',
    's4': '<strong>受限页面提前识别。</strong><code>chrome://</code>、扩展商店、PDF 查看器、插件自己的页面都截不了，工具会明确说明而不是静默失败。',

    'perm.h2': '权限',
    'perm.sub': '没有 <code>&lt;all_urls&gt;</code>，没有 <code>debugger</code>，不读取 Cookie。',
    'perm.th1': '权限',
    'perm.th2': '用途',
    'perm.r1': '只在你主动触发时临时授权当前标签页，不会长期访问所有网站。',
    'perm.r2': '把标注层注入那个标签页。',
    'perm.r3': '队列元数据、日期对话映射、你的设置。',
    'perm.r4': '选中文字的「发送到AI」菜单项。',
    'perm.r5': '清理发送中途页面崩溃留下的任务。',
    'perm.r6': '上传图片并替你点击发送。',

    'faq.h2': '常见问题',
    'q1.h': '免费 ChatGPT 账号能用吗？',
    'q1.p': '能。它用的是浏览器当前的登录状态。网页能正常用，ShotThink 就能用。',
    'q2.h': '截图会被发到你们的服务器吗？',
    'q2.p': '不会。没有服务器。图片只从你的浏览器发往 chatgpt.com，不经过任何其他地方。',
    'q3.h': '为什么截不了微信或 Excel？',
    'q3.p': '浏览器插件只能看到浏览器里的内容。要截整个桌面，同一个作者做了 <a href="https://github.com/JohnWish1590/Mouse4">Mouse4</a>，一个 Windows 工具。',
    'q4.h': '如果 ChatGPT 改版了怎么办？',
    'q4.p': '发送会暂停并告诉你，而不是瞎猜。选择器有多重冗余，失败也会显示出来，所以更新能很快修好。',
    'q5.h': '需要一直开着 ChatGPT 标签页吗？',
    'q5.p': '需要。它在后台运行，不需要切到前台，但关掉就停止发送了。',
    'q6.h': '支持 Firefox 吗？',
    'q6.p': '不支持。插件依赖 Chromium 的 <code>captureVisibleTab</code> 和 <code>scripting</code> 行为。',

    'get.h2': '获取',
    'get.sub': '免费，MIT 许可，约 80 KB。',
    'get.download': '下载 v1.0.0',
    'get.source': 'GitHub 源码',
    'get.changelog': '更新日志',

    'footer.tag': 'ShotThink · 截图，标注，提问。',
    'footer.license': 'MIT 许可'
  }
};

(function () {
  const STORAGE_KEY = 'shotthink-lang';

  function resolveLanguage() {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('lang');
    if (fromQuery === 'zh' || fromQuery === 'en') return fromQuery;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'zh' || stored === 'en') return stored;
    } catch {}

    // Default to Chinese for Chinese browsers, English otherwise — the same
    // rule the extension itself follows.
    return /^zh\b/i.test(navigator.language || '') ? 'zh' : 'en';
  }

  let lang = resolveLanguage();

  function apply(next) {
    lang = next;
    const dict = I18N[lang];
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

    for (const element of document.querySelectorAll('[data-i18n]')) {
      const key = element.getAttribute('data-i18n');
      const value = dict[key];
      if (value === undefined) continue;
      // innerHTML so inline <em>, <code>, <kbd> and <strong> survive.
      element.innerHTML = value;
    }

    document.title = dict['meta.title'];
    document.querySelector('meta[name="description"]')?.setAttribute('content', dict['meta.desc']);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', dict['meta.title']);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', dict['meta.desc']);
    const gif = document.getElementById('demo-gif');
    if (gif) {
      gif.setAttribute('alt', dict['hero.alt']);
      // The two GIFs carry their own caption cards, so the image has to follow
      // the page language rather than staying English on a Chinese page.
      const want = lang === 'zh' ? 'demo.gif' : 'demo-en.gif';
      if (!gif.src.endsWith(want)) gif.src = want;
    }

    const toggle = document.getElementById('lang-toggle');
    if (toggle) {
      toggle.textContent = dict['nav.lang'];
      toggle.setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : '切换到中文');
    }

    try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('#lang-toggle')) return;
    event.preventDefault();
    apply(lang === 'zh' ? 'en' : 'zh');
  });

  apply(lang);
})();

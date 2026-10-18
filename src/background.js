importScripts('i18n.js', 'rules.js', 'daily.js', 'capture.js', 'store.js');

/* ShotThink background service worker.
 *
 * Ported from Mouse4's chrome-extension/background.js. The native-messaging
 * bridge is gone: jobs now originate inside the extension (capture.js) instead
 * of arriving from a desktop program. Everything downstream — the daily-chat
 * routing, the queue, the receipt checks — is unchanged.
 */

let working = false;
let workRequested = false;
let writes = Promise.resolve();

const mutate = fn => {
  const next = writes.then(async () => {
    const { jobs = [] } = await chrome.storage.local.get('jobs');
    const result = fn(jobs);
    await chrome.storage.local.set({ jobs });
    return result;
  });
  writes = next.catch(() => {});
  return next;
};

const isManualJob = job => ['failed', 'uncertain'].includes(job?.status);

/* How long the worker is willing to hold a `tabs.sendMessage` open.
   The page keeps working after this; the worker just stops waiting. */
const SEND_REPLY_TIMEOUT_MS = 20_000;

/* A job whose page never reported back is settled as uncertain after this. */
const PENDING_JOB_TTL_MS = 10 * 60_000;
const RECONCILE_ALARM = 'shotthink-reconcile';

/* Images live in IndexedDB, not in chrome.storage.local. See src/store.js for
   the measurements behind that decision. The queue keeps only metadata. */
const IMAGE_QUEUE_LIMIT = 30;
const IMAGE_BYTES_LIMIT = 400 * 1024 * 1024;

async function setQueuePaused(error) {
  await chrome.storage.local.set({
    queuePaused: true,
    queuePauseReason: error?.message || '队列已暂停，请检查。'
  });
}
async function clearQueuePaused() {
  await chrome.storage.local.set({ queuePaused: false, queuePauseReason: '' });
}
async function queueIsPaused() {
  const { queuePaused = false } = await chrome.storage.local.get('queuePaused');
  return queuePaused;
}

/* ---------------------------------------------------------------- capture */

const CAPTURE_MESSAGE = 'shotthink:capture';

/*
 * Pages where no content script can ever run. Detected up front so the user
 * gets a specific message instead of a silent no-op.
 */
function isRestrictedUrl(url = '') {
  return /^(chrome|edge|about|devtools|view-source|chrome-extension|chrome-untrusted|chrome-search):/i.test(url) ||
    /^https:\/\/chromewebstore\.google\.com\//i.test(url) ||
    /^https:\/\/chrome\.google\.com\/webstore\//i.test(url);
}

chrome.action.onClicked.addListener(tab => {
  if (!tab?.id) return;
  void startCapture(tab.id, tab.url);
});

if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== 'capture') return;
    if (tab?.id) { void startCapture(tab.id, tab.url); return; }
    // Some Chrome versions omit the tab argument for commands.
    void chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      const current = tabs[0];
      if (current?.id) void startCapture(current.id, current.url);
    });
  });
}

/**
 * Show a message the user can actually see.
 *
 * The previous version fell back to `alert()` injected into the page, which
 * needs the very permission that just failed, so a failure produced nothing at
 * all on screen. The badge and the stored status do not need page access.
 */
async function reportCaptureFailure(tabId, message) {
  try {
    await chrome.action.setBadgeText({ tabId, text: '!' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#D98585' });
    await chrome.action.setTitle({ tabId, title: `ShotThink: ${message}` });
  } catch {
    // setBadgeText also fails on restricted tabs; the status below still lands.
  }
  await chrome.storage.local.set({ lastCaptureError: { message, at: Date.now() } });

  // Best-effort in-page notice; harmless if the page cannot be scripted.
  await chrome.scripting
    .executeScript({
      target: { tabId },
      func: text => {
        const box = document.createElement('div');
        box.textContent = text;
        box.setAttribute('style', [
          'position:fixed', 'top:24px', 'left:50%', 'transform:translateX(-50%)',
          'z-index:2147483647', 'padding:12px 20px', 'border-radius:10px',
          'background:rgba(24,24,27,0.97)', 'color:#E5E5EA',
          'font:600 14px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
          'border:1px solid rgba(255,255,255,0.16)', 'box-shadow:0 10px 30px rgba(0,0,0,.45)'
        ].join(';'));
        document.documentElement.append(box);
        setTimeout(() => box.remove(), 4000);
      },
      args: [message]
    })
    .catch(() => {});
}

async function clearCaptureFailure(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: '' });
    await chrome.action.setTitle({ tabId, title: 'ShotThink — capture' });
  } catch {}
}

async function startCapture(tabId, tabUrl) {
  let url = tabUrl;
  if (!url) {
    try {
      url = (await chrome.tabs.get(tabId))?.url;
    } catch {}
  }

  // The extension's own pages can never be scripted. Check this before the
  // generic restricted-URL branch, which also matches chrome-extension:, so the
  // user gets the specific reason instead of "this page cannot be captured".
  if (/^chrome-extension:\/\//i.test(url || '')) {
    await reportCaptureFailure(tabId, shotThinkText('扩展自身的页面无法截图。请切换到普通网页后再试。'));
    return;
  }

  if (isRestrictedUrl(url)) {
    await reportCaptureFailure(tabId, shotThinkText('此页面无法截图。'));
    return;
  }

  try {
    // i18n.js must land before overlay.js: the overlay calls shotThinkText()
    // while building its toolbar, and would otherwise throw on first paint.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/i18n.js', 'src/overlay.js']
    });
    const tab = await chrome.tabs.get(tabId);
    const reply = await chrome.tabs.sendMessage(tabId, {
      type: CAPTURE_MESSAGE,
      windowId: tab.windowId
    });
    if (reply?.ok) {
      await clearCaptureFailure(tabId);
    } else {
      await reportCaptureFailure(tabId, reply?.error || shotThinkText('截图失败，请刷新页面后重试。'));
    }
  } catch (error) {
    const raw = error?.message || '';
    // Distinguish the two very different causes. "Cannot access contents" on a
    // normal http(s) page almost always means the activeTab grant was not
    // applied — the user clicked before the page finished loading, the tab was
    // opened before the extension was installed, or the command fired without
    // a tab argument. Telling them "this page cannot be captured" would be
    // wrong and unhelpful.
    const message = /Cannot access contents|must request permission/i.test(raw)
      ? shotThinkText('还没有权限访问这个标签页。请刷新页面，或先点一下页面再按快捷键。')
      : /permission/i.test(raw)
        ? shotThinkText('此页面无法截图。')
        : `${shotThinkText('截图失败，请刷新页面后重试。')} ${raw}`;
    console.error('ShotThink capture could not start', error);
    await reportCaptureFailure(tabId, message);
  }
}

/* ------------------------------------------------------- selected text menu */

const TEXT_MENU_ID = 'shotthink-send-selected-text';

const defaultTextRules = () =>
  shotThinkChinese
    ? '请分析选中的文字：先给出简短结论，区分事实、推断和待核实信息；检查数字和逻辑；看不清或缺少上下文时明确说明，不要编造。'
    : 'Analyze the selected text: start with a brief conclusion, distinguish facts, inferences, and items to verify; check numbers and logic; state clearly when context is missing; do not invent details.';

async function installTextContextMenu() {
  if (!chrome.contextMenus?.create) return;
  try { await chrome.contextMenus.remove(TEXT_MENU_ID); } catch {}
  try {
    await chrome.contextMenus.create({
      id: TEXT_MENU_ID,
      title: shotThinkText('发送到AI'),
      contexts: ['selection'],
      documentUrlPatterns: ['http://*/*', 'https://*/*']
    });
  } catch (error) {
    console.error('ShotThink text context menu setup failed', error);
  }
}

async function textRules() {
  const { rules = '', jobs = [] } = await chrome.storage.local.get(['rules', 'jobs']);
  if (typeof rules === 'string' && rules.trim()) return rules.trim();
  const previous = [...jobs].reverse().find(job => typeof job.rules === 'string' && job.rules.trim());
  return previous?.rules?.trim() || defaultTextRules();
}

/**
 * The rule text to attach to a capture.
 *
 * Stored setting wins. Otherwise the built-in default is used in the current
 * interface language, so an English interface does not send Chinese
 * instructions to ChatGPT.
 */
async function captureRules(override) {
  if (typeof override === 'string' && override.trim()) return override.trim();
  const { rules = '' } = await chrome.storage.local.get('rules');
  if (typeof rules === 'string' && rules.trim()) return rules.trim();
  return shotThinkDefaultRulesFor(shotThinkLang);
}

/** The built-in rule text for the current interface language. */
function defaultCaptureRules() {
  return shotThinkDefaultRulesFor(shotThinkLang);
}

async function enqueueSelectedText(info, tab) {
  const text = String(info.selectionText || '').trim();
  if (!text || !tab?.id || !/^https?:\/\//i.test(tab.url || '')) return;
  if (text.length > 50000) throw Error('选中文字过长，请分段发送。');
  const rules = await textRules();
  await mutate(jobs => {
    const activeJobs = jobs.filter(job => !job.archived);
    if (activeJobs.length >= 30) throw Error('发送队列已满，请先清理完成记录。');
    jobs.push({
      id: crypto.randomUUID(),
      name: shotThinkChinese ? '浏览器选中文字' : 'Selected browser text',
      inputType: 'text',
      text,
      rules,
      status: 'queued',
      created: Date.now()
    });
  });
  void processQueue();
}

if (chrome.contextMenus?.onClicked?.addListener) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== TEXT_MENU_ID) return;
    void enqueueSelectedText(info, tab).catch(error =>
      console.error('ShotThink selected-text send failed', error)
    );
  });
}

/* Startup work: the menu has to exist, and the image store may need repair. */
function onWorkerStart() {
  void installTextContextMenu();
  void reconcileImageStore();
  void reconcilePendingJobs();
  void clearStaleNamingWarnings();
}

/**
 * Settle jobs that the worker stopped waiting for.
 *
 * Two outcomes are possible for an in-flight job:
 *
 *   - The page finished and wrote `jobResult`, so the job already moved on.
 *     Nothing to do.
 *   - The page died (tab closed, navigation, crash) and never reported. The
 *     job is stuck in `preparing`/`uploading`/`sending`. Because the send may
 *     have reached the server, it must become `uncertain`, never `failed`
 *     with an automatic retry.
 *
 * Runs on an alarm so a worker that was killed mid-send is cleaned up even if
 * the user never reopens the popup or options page.
 */
async function reconcilePendingJobs() {
  try {
    const { jobs = [] } = await chrome.storage.local.get('jobs');
    const now = Date.now();
    const stranded = jobs.filter(job =>
      !job.archived &&
      ['preparing', 'uploading', 'sending'].includes(job.status) &&
      now - (job.pendingSince || job.created || now) > PENDING_JOB_TTL_MS
    );
    if (!stranded.length) return 0;

    for (const job of stranded) {
      // A tab that still exists may yet report; only settle when it is gone.
      if (job.tabId) {
        try {
          await chrome.tabs.get(job.tabId);
          continue;
        } catch {
          // Tab is gone, so nothing will ever report for it.
        }
      }
      await mutate(stored => {
        const record = stored.find(j => j.id === job.id);
        if (!record) return;
        record.status = 'uncertain';
        record.manual = true;
        record.submissionAttempted = true;
        record.error = '发送进程中断，请查看对应标签页；不会自动重发。';
      });
      await markDailyUncertain({ ...job, day: job.day || job.captureDate }).catch(() => {});
    }
    return stranded.length;
  } catch (error) {
    console.error('ShotThink could not reconcile pending jobs', error);
    return 0;
  }
}

if (chrome.alarms?.create) {
  chrome.alarms.create(RECONCILE_ALARM, { periodInMinutes: 1 });
}
if (chrome.alarms?.onAlarm?.addListener) {
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name !== RECONCILE_ALARM) return;
    void reconcilePendingJobs();
    void reconcileImageStore();
  });
}

if (chrome.runtime.onInstalled?.addListener) chrome.runtime.onInstalled.addListener(onWorkerStart);
if (chrome.runtime.onStartup?.addListener) chrome.runtime.onStartup.addListener(onWorkerStart);
onWorkerStart();

/* ------------------------------------------------------- message handling */

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const run = async () => {
    /* The overlay asks for the frozen viewport bitmap it will paint on.
       UI preferences ride along so the overlay does not need its own storage
       access, which it cannot have from the page context. */
    if (message.type === 'captureFrame' && sender.tab?.id) {
      const windowId = message.windowId ?? sender.tab.windowId;
      const frame = await captureFrameForOverlay(sender.tab.id, windowId);
      const {
        uiLanguage = '', toolbarScale = 22, annotateColor = '', annotateFontSize = 16
      } = await chrome.storage.local.get([
        'uiLanguage', 'toolbarScale', 'annotateColor', 'annotateFontSize'
      ]);
      return {
        ok: true,
        ...frame,
        prefs: {
          language: uiLanguage === 'en' || uiLanguage === 'zh' ? uiLanguage : shotThinkLang,
          toolbarScale,
          // The annotation colour and size are remembered between captures, so
          // the user does not re-pick them every time.
          annotateColor: typeof annotateColor === 'string' && /^#[0-9a-f]{6}$/i.test(annotateColor)
            ? annotateColor
            : '',
          annotateFontSize: Number(annotateFontSize) || 16
        }
      };
    }

    /* Long capture: scroll, sample, and hand the slices back to the overlay. */
    if (message.type === 'captureLongPage' && sender.tab?.id) {
      const windowId = message.windowId ?? sender.tab.windowId;
      const restore = await suppressStickyElements(sender.tab.id, message.selection);
      try {
        const result = await captureLongPage(sender.tab.id, windowId, {
          maxSlices: message.maxSlices,
          onProgress: progress => {
            void chrome.tabs
              .sendMessage(sender.tab.id, { type: 'shotthink:longProgress', ...progress })
              .catch(() => {});
          }
        });
        return { ok: true, ...result };
      } finally {
        await restore();
      }
    }

    /* The overlay hands back a finished PNG after the user confirms. */
    if (message.type === 'enqueueCapture' && sender.tab?.id) {
      const { dataUrl, name } = message;
      if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl || '')) {
        throw Error('截图数据无效，未发送。');
      }

      const blob = await dataUrlToBlob(dataUrl);
      if (blob.size > 50 * 1024 * 1024) throw Error('截图超过 50 MB，未发送。');

      // Resolve the analysis instructions: explicit override, then the saved
      // setting, then the built-in default in the interface language.
      const rules = await captureRules(message.rules);

      const { jobs = [] } = await chrome.storage.local.get('jobs');
      const activeJobs = jobs.filter(job => !job.archived);
      if (activeJobs.length >= IMAGE_QUEUE_LIMIT) {
        throw Error('发送队列已满，请先清理完成记录。');
      }

      // IndexedDB holds the bytes; the job record holds only routing metadata.
      // The byte budget is generous because it is no longer competing with a
      // 10 MB text quota, but it still stops an unbounded backlog.
      const id = crypto.randomUUID();
      const usage = await imageBytes();
      if (usage.bytes + blob.size > IMAGE_BYTES_LIMIT) {
        throw Error('图片存储空间不足，请清理旧记录。');
      }

      await putImage(id, blob);
      try {
        await mutate(stored => {
          stored.push({
            id,
            name: name || 'shotthink.png',
            rules,
            status: 'queued',
            created: Date.now(),
            hasImage: true,
            bytes: blob.size
          });
        });
      } catch (error) {
        // Never leave a Blob behind when the metadata write fails.
        await deleteImage(id).catch(() => {});
        throw error;
      }

      void processQueue();
      return { ok: true, id };
    }

    if (message.type === 'progress' && sender.tab && new URL(sender.url).origin === 'https://chatgpt.com') {
      await mutate(jobs => {
        const job = jobs.find(j => j.id === message.id && j.tabId === sender.tab.id);
        if (job && ['preparing', 'uploading', 'sending'].includes(message.status)) job.status = message.status;
      });
      return { ok: true };
    }

    /*
     * The content script reports its own outcome.
     *
     * It owns the long waits (a previous answer can take minutes) because a
     * service worker is killed after ~30s idle while a content script is not.
     * Writing the result here, from the page, is what keeps a long send from
     * being stranded as "uncertain" when the worker dies mid-await.
     */
    if (message.type === 'jobResult' && sender.tab && new URL(sender.url).origin === 'https://chatgpt.com') {
      const { jobs = [] } = await chrome.storage.local.get('jobs');
      const job = jobs.find(j => j.id === message.id && j.tabId === sender.tab.id);
      if (!job) return { ok: true, ignored: true };

      if (message.ok) {
        try {
          await saveDailyReceipt(job, message.url);
        } catch (error) {
          // Delivery is confirmed; only the day mapping failed. Keep the job.
          await mutate(stored => {
            const record = stored.find(j => j.id === job.id);
            if (record) record.warning = error.message;
          });
        }
        await mutate(stored => {
          const record = stored.find(j => j.id === job.id);
          if (!record) return;
          Object.assign(record, {
            status: 'sent', manual: false, url: message.url,
            dataUrl: '', text: '', error: '', completed: Date.now()
          });
        });
        await deleteImage(job.id).catch(() => {});
        void nameDaily({ ...job, url: message.url }).catch(() => {});
      } else {
        const attempted = message.submissionAttempted === true || job.status === 'sending';
        await mutate(stored => {
          const record = stored.find(j => j.id === job.id);
          if (!record) return;
          record.status = attempted ? 'uncertain' : 'failed';
          record.manual = true;
          record.submissionAttempted = attempted;
          record.error = message.error || '发送结果未知。';
        });
        if (attempted) {
          await markDailyUncertain({ ...job, day: job.day || job.captureDate }).catch(() => {});
        }
      }
      // The worker may have stopped waiting for this job, so nothing else would
      // move the queue along. Kick it once the outcome is recorded.
      void processQueue();
      return { ok: true };
    }

    if (message.type === 'insertPrompt' && sender.tab && new URL(sender.url).origin === 'https://chatgpt.com') {
      const { jobs = [] } = await chrome.storage.local.get('jobs');
      const job = jobs.find(j => j.id === message.id && j.tabId === sender.tab.id && j.status === 'uploading');
      if (!job) throw Error('任务与当前标签页不匹配。');
      const prompt = promptFor(job);
      const execution = await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        func: async prompt => {
          try {
            const findInput = () => {
              const inputs = [
                ...document.querySelectorAll(
                  '.ProseMirror[contenteditable="true"],#prompt-textarea[contenteditable="true"],textarea,[contenteditable="true"][role="textbox"]'
                )
              ].filter(el =>
                el.getClientRects().length &&
                el.getAttribute('aria-hidden') !== 'true' &&
                !['hidden', 'collapse'].includes(getComputedStyle(el).visibility) &&
                getComputedStyle(el).display !== 'none'
              );
              return inputs.find(el => el.getAttribute('contenteditable') === 'true') || inputs[0];
            };
            let input = findInput();
            if (!input) throw Error('找不到编辑器。');
            const text = () => (input.value ?? input.innerText ?? '').trim();
            if (text() === prompt) return { ok: true, method: 'existing-matching-prompt' };
            if (text()) throw Error('编辑器已有草稿，停止写入。');
            input.focus();
            await new Promise(resolve => setTimeout(resolve, 100));
            input = findInput();
            if (!input) throw Error('编辑器在获得焦点后消失，停止写入。');
            if (text() === prompt) return { ok: true, method: 'existing-matching-prompt' };
            if (text()) throw Error('编辑器获得焦点后出现草稿，停止写入。');
            let method = 'native-input';
            if (input.editor?.commands?.setContent) {
              input.editor.commands.setContent(
                prompt.split('\n').map(line => ({
                  type: 'paragraph',
                  content: line ? [{ type: 'text', text: line }] : []
                })),
                true
              );
              method = 'editor-command';
            } else if (input.tagName === 'TEXTAREA') {
              Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, prompt);
              input.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              const range = document.createRange();
              range.selectNodeContents(input);
              const selection = window.getSelection();
              selection.removeAllRanges();
              selection.addRange(range);
              const clipboard = new DataTransfer();
              clipboard.setData('text/plain', prompt);
              input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
              await new Promise(resolve => setTimeout(resolve, 100));
              if (!text().includes(prompt.split('\n').at(-1))) {
                if (!document.execCommand('insertText', false, prompt)) throw Error('网页编辑器拒绝文字写入。');
                method = 'page-world-insertText';
              } else {
                method = 'page-world-paste';
              }
            }
            await new Promise(resolve => setTimeout(resolve, 350));
            input = findInput();
            if (!input) return { ok: false, method, detail: 'current editor missing' };
            const editorText = input.editor?.state?.doc?.textContent;
            return {
              ok: text().includes(prompt.split('\n').at(-1)) &&
                (editorText === undefined || editorText.includes(prompt.split('\n').at(-1))),
              method,
              detail: JSON.stringify({
                tag: input.tagName,
                connected: input.isConnected,
                domLength: text().length,
                domMatches: text().includes(prompt.split('\n').at(-1)),
                stateMatches: editorText === undefined ? null : editorText.includes(prompt.split('\n').at(-1))
              })
            };
          } catch (error) {
            return { ok: false, detail: error.message };
          }
        },
        args: [prompt]
      });
      const result = execution[0]?.result;
      if (!result?.ok) {
        throw Error(`网页编辑器没有确认规则文字，停止发送。${result?.detail || JSON.stringify(execution)}`);
      }
      await mutate(stored => {
        stored.find(j => j.id === job.id).inputMethod = result.method;
      });
      return result;
    }

    if (message.type === 'resetFailedDraft' && sender.tab && new URL(sender.url).origin === 'https://chatgpt.com') {
      const { jobs = [] } = await chrome.storage.local.get('jobs');
      if (!jobs.some(j => j.id === message.id && j.tabId === sender.tab.id && j.status === 'preparing')) {
        throw Error('任务与草稿页面不匹配，未改动。');
      }
      const allowed = jobs.filter(j => j.status === 'failed').map(promptFor);
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        args: [allowed],
        func: async allowed => {
          const inputs = [...document.querySelectorAll('.ProseMirror[contenteditable="true"],textarea')]
            .filter(el => el.getClientRects().length);
          const input = inputs.find(el => el.getAttribute('contenteditable') === 'true') || inputs[0];
          const text = () => (input?.value ?? input?.innerText ?? '').trim();
          const normalize = value => value.replace(/\s+/g, '').trim();
          if (!input || !allowed.some(value => normalize(value) === normalize(text()))) {
            return { ok: false, error: '草稿不属于已核对的 ShotThink 失败任务，未改动。' };
          }
          const form = input.closest('form') || input.parentElement.parentElement;
          if (input.editor?.commands?.clearContent) {
            input.editor.commands.clearContent(true);
          } else if (input.tagName === 'TEXTAREA') {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '');
            input.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            input.focus();
            const range = document.createRange();
            range.selectNodeContents(input);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            if (!document.execCommand('delete')) return { ok: false, error: '网页未接受旧失败草稿清理。' };
          }
          for (const button of form.querySelectorAll('button')) {
            if (/^(remove|delete).*(file|attachment|image)|^(移除|删除).*(文件|图片|附件)/i.test(button.getAttribute('aria-label') || '')) {
              button.click();
            }
          }
          await new Promise(resolve => setTimeout(resolve, 200));
          return { ok: !text() };
        }
      });
      return result;
    }

    if (message.type === 'resume' && sender.url === chrome.runtime.getURL('ui/options.html')) {
      await clearQueuePaused();
      void processQueue();
      return { ok: true };
    }

    if (message.type === 'clearJob' && sender.url === chrome.runtime.getURL('ui/options.html')) {
      let removedId = null;
      await mutate(jobs => {
        const job = jobs.find(item => item.id === message.id && isManualJob(item) && !item.archived);
        if (!job) throw Error('找不到可移出的人工处理记录。');
        if (job.status === 'uncertain' && message.confirmed !== true) {
          throw Error('结果待核对的任务需要先确认对应对话。');
        }
        job.archived = true;
        job.archivedAt = Date.now();
        removedId = job.id;
      });
      if (removedId) await deleteImage(removedId).catch(() => {});
      return { ok: true };
    }

    if (message.type === 'clear' && sender.url === chrome.runtime.getURL('ui/options.html')) {
      const doomed = [];
      await mutate(jobs => {
        const kept = jobs.filter(j => j.status !== 'sent' || j.archived);
        for (const job of jobs) {
          if (!kept.includes(job) && job.hasImage) doomed.push(job.id);
        }
        jobs.splice(0, jobs.length, ...kept);
      });
      await deleteImages(doomed).catch(() => {});
      return { ok: true };
    }

    if (message.type === 'saveAnnotatePrefs' && sender.tab?.id) {
      const patch = {};
      if (typeof message.color === 'string' && /^#[0-9a-f]{6}$/i.test(message.color)) {
        patch.annotateColor = message.color;
      }
      const size = Number(message.fontSize);
      if ([12, 16, 20, 24, 32, 40, 48].includes(size)) patch.annotateFontSize = size;
      if (Object.keys(patch).length) await chrome.storage.local.set(patch);
      return { ok: true };
    }

    if (message.type === 'storageUsage' && sender.url === chrome.runtime.getURL('ui/options.html')) {
      return { ok: true, ...(await imageBytes()) };
    }

    if (message.type === 'verify' && sender.url === chrome.runtime.getURL('ui/options.html')) {
      const { jobs = [] } = await chrome.storage.local.get('jobs');
      for (const job of jobs.filter(j => j.status === 'uncertain' && j.tabId).reverse()) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: job.tabId }, files: ['src/sender.js'] });
          const receiptType = job.inputType === 'text' ? 'verifyTextReceipt' : 'verifyReceipt';
          const receipt = await chrome.tabs.sendMessage(job.tabId, { type: receiptType, id: job.id });
          if (receipt?.ok) {
            if (job.day) await saveDailyReceipt(job, receipt.url);
            await mutate(stored => Object.assign(stored.find(j => j.id === job.id), {
              status: 'sent', url: receipt.url, dataUrl: '', text: '', error: '', diagnostic: '', completed: Date.now()
            }));
            await deleteImage(job.id).catch(() => {});
            continue;
          }
          await mutate(stored => {
            stored.find(j => j.id === job.id).diagnostic = job.inputType === 'text'
              ? '尚未确认到完整规则与文字，不会自动重发。'
              : '尚未确认到完整规则与截图，不会自动重发。';
          });
        } catch (error) {
          await mutate(stored => {
            stored.find(j => j.id === job.id).diagnostic = `无法检查此标签页：${error.message}`;
          });
        }
      }
      return { ok: true };
    }

    throw Error('不支持的请求。');
  };
  run().then(reply, error => reply({ ok: false, error: shotThinkText(error.message) }));
  return true;
});

/* --------------------------------------------------------------- queue run */

/**
 * Bring the image store in line with the job list on startup.
 *
 * Two things can drift: legacy jobs still carrying an inline `dataUrl`, and
 * orphaned Blobs whose job was already sent, archived, or cleared while the
 * worker was asleep.
 */
async function reconcileImageStore() {
  try {
    const { jobs = [] } = await chrome.storage.local.get('jobs');

    const migrated = await migrateInlineImages(jobs);
    if (migrated) {
      await chrome.storage.local.set({ jobs });
      console.info(`ShotThink moved ${migrated} inline image(s) into IndexedDB`);
    }

    // Keep bytes for anything that might still need to be sent or reviewed.
    const liveIds = jobs
      .filter(job => !job.archived && job.hasImage && ['queued', 'preparing', 'uploading', 'sending', 'failed', 'uncertain'].includes(job.status))
      .map(job => job.id);
    const pruned = await pruneOrphanImages(liveIds);
    if (pruned) console.info(`ShotThink dropped ${pruned} orphaned image(s)`);
  } catch (error) {
    console.error('ShotThink could not reconcile the image store', error);
  }
}

/**
 * Clear naming warnings that were recorded before the rename logic was fixed.
 *
 * The old code reported "date naming unfinished" for conversations that were in
 * fact named correctly. Those warnings are stored on the job records and would
 * otherwise sit there forever, since a job is only rewritten on a new send.
 *
 * Only the exact stale message is cleared; a genuine naming failure from the
 * current code is left alone.
 */
const STALE_NAMING_WARNINGS = [
  '截图已发送；日期命名未完成：当前聊天的操作菜单未展开，日期命名未完成。',
  '截图已发送；日期命名未完成：网页未确认日期标题。'
];

async function clearStaleNamingWarnings() {
  const stale = new Set(STALE_NAMING_WARNINGS);
  const cleaned = await mutate(jobs => {
    let count = 0;
    for (const job of jobs) {
      if (job.warning && stale.has(job.warning)) {
        job.warning = '';
        count++;
      }
    }
    return count;
  });
  if (cleaned) {
    // The day records carry the same text, and it is re-read on every nameDaily.
    const { days = {} } = await chrome.storage.local.get('days');
    let touched = false;
    for (const entry of Object.values(days)) {
      if (entry.warning && stale.has(entry.warning)) {
        entry.warning = '';
        touched = true;
      }
    }
    if (touched) await chrome.storage.local.set({ days });
    console.info(`ShotThink cleared ${cleaned} stale naming warning(s)`);
  }
  return cleaned;
}

async function repairKnownUnsent() {
  const repaired = await mutate(jobs => {
    for (const job of jobs) {
      if (job.status === 'uncertain' && job.error === '提交前无法确认 Chat 模式，已停止，未发送；请检查页面草稿。') {
        job.status = 'failed';
        job.submissionAttempted = false;
        job.manual = true;
      }
    }
    return jobs.some(job => job.status === 'failed' && job.manual);
  });
  return repaired;
}

async function processQueue() {
  if (working) { workRequested = true; return; }
  if (await queueIsPaused()) return;
  working = true;
  workRequested = false;
  let paused = false;
  const namedDays = new Set();
  try {
    await repairKnownUnsent();
    await mutate(jobs => {
      for (const job of jobs) {
        if (['preparing', 'uploading', 'sending'].includes(job.status)) {
          job.status = 'uncertain';
          job.manual = true;
          job.submissionAttempted = true;
          job.error = '发送进程中断，请查看对应标签页；不会自动重发。';
        }
      }
    });

    while (true) {
      const job = await mutate(jobs => {
        const next = jobs.find(j => !j.archived && j.status === 'queued');
        if (next) next.status = 'preparing';
        return next ? { ...next } : null;
      });
      if (!job) { await repairDailyTitles(namedDays); break; }

      let tab;
      try {
        tab = await prepareDaily(job);
        job.tabId = tab.id;
        await mutate(jobs => { jobs.find(j => j.id === job.id).tabId = tab.id; });
        await waitForTab(tab.id);
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/sender.js'] });
        const { jobs: previousJobs = [] } = await chrome.storage.local.get('jobs');
        job.failedPrompts = previousJobs.filter(j => j.status === 'failed' && j.id !== job.id).map(promptFor);

        // Rehydrate the bitmap from IndexedDB just before handing the job over.
        // sender.js still receives `job.dataUrl`, so the content script is
        // untouched; the image only exists in memory for the length of a send.
        if (job.inputType !== 'text') {
          const dataUrl = await imageDataUrl(job.id);
          if (!dataUrl) {
            throw Error('本地截图已丢失，未发送。');
          }
          job.dataUrl = dataUrl;
        }

        let response;
        try {
          const sendType = job.inputType === 'text' ? 'sendText' : 'sendScreenshot';
          // Bounded wait. The content script may legitimately need minutes to
          // wait out a previous answer, and the worker must not be held that
          // long. If it does not answer in time, the job stays in flight and
          // the reconciler settles it from the outcome the page wrote itself.
          response = await Promise.race([
            chrome.tabs.sendMessage(tab.id, { type: sendType, job }),
            new Promise(resolve => setTimeout(() => resolve({ pending: true }), SEND_REPLY_TIMEOUT_MS))
          ]);
        } catch (channelError) {
          // A navigation can destroy the response channel after submission.
          // Reinject only to inspect the receipt; never repeat the send click.
          try {
            await waitForTab(tab.id);
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/sender.js'] });
            const receiptType = job.inputType === 'text' ? 'verifyTextReceipt' : 'verifyReceipt';
            const receipt = await chrome.tabs.sendMessage(tab.id, { type: receiptType, id: job.id });
            if (receipt?.ok && receipt.url?.startsWith('https://chatgpt.com/c/') &&
                !decodeURIComponent(receipt.url).includes('local-chatgpt:')) {
              response = receipt;
            }
          } catch {}
          if (!response) throw channelError;
        }

        if (response?.pending) {
          // Still running in the page. Leave the job in flight; jobResult or
          // the reconciler will finish it. Do not touch the image.
          job.pendingSince = Date.now();
          await mutate(stored => {
            const record = stored.find(j => j.id === job.id);
            if (record) record.pendingSince = job.pendingSince;
          });
          break;
        }

        if (!response?.ok) {
          const error = Error(response?.error || '发送结果未知。');
          error.submissionAttempted = response?.submissionAttempted;
          error.systemFailure = response?.systemFailure === true;
          throw error;
        }

        await saveDailyReceipt(job, response.url);
        await mutate(jobs => {
          const stored = jobs.find(j => j.id === job.id);
          Object.assign(stored, {
            status: 'sent', manual: false, url: response.url,
            dataUrl: '', text: '', completed: Date.now()
          });
        });
        // The bytes are no longer needed once delivery is confirmed.
        await deleteImage(job.id).catch(() => {});
        job.url = response.url;
        await nameDaily(job);
        namedDays.add(job.day);
      } catch (error) {
        await mutate(jobs => {
          const stored = jobs.find(j => j.id === job.id);
          const attempted = error.submissionAttempted === true ||
            (stored.status === 'sending' && error.submissionAttempted !== false);
          stored.status = attempted ? 'uncertain' : 'failed';
          stored.manual = true;
          stored.submissionAttempted = attempted;
          stored.error = error.message;
          if (tab) stored.url = job.targetUrl || 'https://chatgpt.com/';
        });

        // Remember which day needs review, so a later capture for the same
        // date can report it instead of silently opening a second chat.
        if (error.submissionAttempted !== false) {
          await markDailyUncertain({ ...job, day: job.day || job.captureDate }).catch(() => {});
        }

        if (error.systemFailure === true) {
          await setQueuePaused(error);
          paused = true;
          break;
        }
        // A single task is retained for manual review; later tasks keep moving.
        // Its bytes stay in IndexedDB so the user can inspect what was sent.
      }
    }
  } finally {
    working = false;
    if (workRequested && !paused) void processQueue();
  }
}

async function waitForTab(id) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(id);
    if (tab.status === 'complete') {
      if (!tab.url?.startsWith('https://chatgpt.com/')) {
        const error = Error('页面跳转到登录或验证页，请在新标签页手动完成登录。');
        error.systemFailure = true;
        throw error;
      }
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const error = Error('页面加载超时，请检查网络及新标签页。');
  error.systemFailure = true;
  throw error;
}

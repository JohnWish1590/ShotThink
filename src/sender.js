/* ShotThink content script: drives ordinary ChatGPT page controls only.
   No cookies, no private APIs, no security overrides.
   Ported from Mouse4's chrome-extension/sender.js. */
(() => {
  if (globalThis.shotThinkSenderInstalled === '1.1.0') return;
  if(globalThis.shotThinkSenderListener) chrome.runtime.onMessage.removeListener(globalThis.shotThinkSenderListener);
  globalThis.shotThinkSenderInstalled = '1.1.0';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => el && el.getClientRects().length > 0 && el.getAttribute?.('aria-hidden')!=='true' &&
    (typeof getComputedStyle!=='function' || !['hidden','collapse'].includes(getComputedStyle(el).visibility) && getComputedStyle(el).display!=='none');
  const composer = () => {
    const inputs=[...document.querySelectorAll('.ProseMirror[contenteditable="true"], #prompt-textarea[contenteditable="true"], textarea, [contenteditable="true"][role="textbox"]')].filter(visible);
    return inputs.find(el=>el.getAttribute('contenteditable')==='true') || inputs[0];
  };
  const sendButton = () => [...document.querySelectorAll('button')].find(el => visible(el) && (/send-button|composer-submit/.test(el.dataset.testid || '') || /^(send( message)?|发送(消息)?)$/i.test(el.getAttribute('aria-label') || '')));
  const readText = el => ((el.tagName==='INPUT' || el.tagName==='TEXTAREA') ? el.value : (el.innerText ?? el.textContent ?? '')).trim();
  const messageNodes = () => [...document.querySelectorAll('[data-message-author-role="user"]')];
  const generating = () => [...document.querySelectorAll('button')].some(el=>visible(el) && (/stop-button/.test(el.dataset.testid || '') || /^(stop( generating| response)?|停止(生成|回答)?)$/i.test(el.getAttribute('aria-label') || '')));
  function submittedScreenshot(id) {
    const nodes=[...document.querySelectorAll('[data-message-author-role="user"], [data-testid^="conversation-turn"], article, p, div, span')]
      .filter(el => !el.closest('[contenteditable="true"], textarea') && (el.textContent || '').includes(id));
    for (const node of nodes) {
      for (let parent=node, depth=0; parent && depth<8; parent=parent.parentElement, depth++) {
        if (['MAIN','BODY','HTML'].includes(parent.tagName) || parent.querySelector('[contenteditable="true"],textarea,nav')) break;
        if (parent.querySelector('img,[role="img"]')) return true;
      }
    }
    return false;
  }
  function submittedText(id) {
    return [...document.querySelectorAll('[data-message-author-role="user"], [data-testid^="conversation-turn"], article, p, div, span')]
      .some(el => !el.closest('[contenteditable="true"], textarea') && (el.textContent || '').includes(id));
  }
  const progress = (job, status) => chrome.runtime.sendMessage({type: 'progress', id: job.id, status});

  /*
   * Long waits must not run inside the service worker.
   *
   * Chrome kills an idle MV3 worker after about 30 seconds, and an outstanding
   * `await chrome.tabs.sendMessage` does not count as activity. The 150-second
   * wait for a previous answer to finish used to live behind that call, so a
   * long answer would take the worker down mid-send and strand the job as
   * "uncertain".
   *
   * The content script is not subject to that lifetime, so it owns the wait and
   * reports the outcome itself. The worker only waits a short, bounded time for
   * the reply; anything longer is picked up later by the reconciler.
   */
  const report = (job, patch) =>
    chrome.runtime.sendMessage({ type: 'jobResult', id: job.id, ...patch }).catch(() => {});

  function checkPage() {
    if (location.origin !== 'https://chatgpt.com') throw Error('需要在 ChatGPT 官方页面登录。');
    if (document.querySelector('iframe[src*="challenges.cloudflare.com"], #challenge-running, #challenge-form')) throw Error('页面正在安全验证，请手动完成后重新测试。');
    const alerts = [...document.querySelectorAll('[role="alert"]')].filter(visible).map(readText).join(' ');
    if (alerts) throw Error(`页面提示：${alerts.slice(0, 200)}`);
  }
  async function waitFor(fn, milliseconds, description) {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      checkPage();
      const result = fn();
      if (result) return result;
      await sleep(200);
    }
    throw Error(description);
  }

  function chatMode() {
    const controls=[...document.querySelectorAll('button,[role="tab"],[role="radio"]')].filter(visible);
    const label=el=>(el.textContent || el.getAttribute('aria-label') || '').trim();
    const paired=(el,other)=>{
      for(let parent=el.parentElement,depth=0;parent && depth<3;parent=parent.parentElement,depth++) {
        if(parent===other.parentElement || parent.contains?.(other))return true;
      }
      return false;
    };
    const chat=controls.find(el=>/^(chat|聊天)$/i.test(label(el)) &&
      !el.closest('nav,aside') && controls.some(other=>/^(work|工作)$/i.test(label(other)) && paired(el,other)));
    const selected=el=>el && (['aria-selected','aria-pressed','aria-checked'].some(name=>el.getAttribute(name)==='true') ||
      /^(active|checked)$/.test(el.getAttribute('data-state') || ''));
    const work=chat && controls.find(el=>paired(chat,el) && /^(work|工作)$/i.test(label(el)));
    const input=composer();
    // The editor's accessible label survives typing; empty-placeholder decorations do not.
    const placeholders=input ? [input.getAttribute('aria-label'),input.getAttribute('aria-placeholder'),
      input.getAttribute('placeholder'),input.getAttribute('data-placeholder'),
      ...[...input.querySelectorAll('[data-placeholder]')].map(el=>el.getAttribute('data-placeholder'))].filter(Boolean).join(' ') : '';
    if(selected(work) || /ChatGPT\s+Work/i.test(placeholders))return {state:'work',chat};
    if(selected(chat))return {state:'chat',chat,confirmedControl:true};
    if(/(?:^|\s)(Ask ChatGPT|Ask anything|Message ChatGPT|询问\s*ChatGPT|问问\s*ChatGPT)(?:[.。?？…]*)(?:$|\s)/i.test(placeholders.trim()))return {state:'chat',chat};
    return {state:'unknown',chat};
  }
  async function ensureChatMode() {
    const mode=await waitFor(()=>{const m=chatMode();return m.state!=='unknown' || m.chat ? m : null;},10000,
      '无法确认 Chat 模式，已停止，未上传截图。');
    // A visible switch is the authoritative control. Select Chat even when a
    // stale placeholder claims Chat, then wait for the page to render it.
    if(mode.state==='chat' && (!mode.chat || mode.confirmedControl))return;
    if(!mode.chat)throw Error('当前是 Work，找不到 Chat 切换按钮，已停止，未上传截图。');
    mode.chat.click();
    await sleep(200);
    await waitFor(()=>chatMode().state==='chat',10000,'未能确认切换到 Chat，已停止，未上传截图。');
  }

  const controlLabel = el => [el?.getAttribute?.('aria-label'), el?.getAttribute?.('title'),
    el?.getAttribute?.('data-testid'), el?.getAttribute?.('data-value'), el?.textContent]
    .filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  const selectedControl = el => el && (['aria-selected','aria-pressed','aria-checked'].some(name=>el.getAttribute?.(name)==='true') ||
    /^(active|checked|on)$/.test(el.getAttribute?.('data-state') || ''));
  const instantLabel = value => /(?:\binstant\b|即时)/i.test((value || '').trim());

  function reasoningControl() {
    const candidates=[...document.querySelectorAll('button,[role="button"],[aria-haspopup],[data-testid*="model"],[data-testid*="reason"]')]
      .filter(visible);
    return candidates.find(el=>{
      const label=controlLabel(el);
      const metadata=[el.getAttribute?.('aria-label'),el.getAttribute?.('title'),el.getAttribute?.('data-testid')].filter(Boolean).join(' ');
      const hasModelOrEffort=/(?:gpt|sol|luna|astra|model|reasoning|thinking|effort|intelligence|模型|推理|思考)/i.test(metadata) ||
        /(?:gpt|sol|luna|astra|instant|low|medium|high|max|extra\s+high|light|即时|低|中|高|极高)/i.test(label);
      return hasModelOrEffort && (el.getAttribute?.('aria-haspopup') || /(?:model|reasoning|thinking|effort|模型|推理|思考)/i.test(metadata));
    });
  }

  function instantOption() {
    return [...document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"],[role="radio"],button,[data-value]')]
      .filter(visible).find(el=>instantLabel(controlLabel(el)) || /^instant$/i.test(el.getAttribute?.('data-value') || '') ||
        /^(即时)$/i.test((el.getAttribute?.('data-value') || '').trim()));
  }

  function closeReasoningMenu(trigger) {
    const open=trigger?.getAttribute?.('aria-expanded')==='true' || instantOption() ||
      [...document.querySelectorAll('[role="menu"],[role="listbox"],[data-radix-menu-content]')].some(visible);
    if (trigger && open) { try { trigger.click(); } catch {} }
  }

  async function ensureInstantMode() {
    const trigger=reasoningControl();
    if(!trigger) return false;
    if(instantLabel(controlLabel(trigger))) return true;
    try { trigger.click(); } catch { return false; }
    let option;
    try { option=await waitFor(instantOption,2500,''); } catch { closeReasoningMenu(trigger); return false; }
    try { option.click(); } catch { closeReasoningMenu(trigger); return false; }
    try {
      await waitFor(()=>instantLabel(controlLabel(reasoningControl())) || selectedControl(instantOption()),2500,'');
      return true;
    } catch {
      closeReasoningMenu(trigger);
      return false;
    }
  }

  async function prepareComposer(job) {
    await waitFor(composer, 30000, '找不到聊天输入框，请检查是否登录，或页面结构是否变化。');
    const blankNewChat=!job.targetUrl && location.pathname==='/' && messageNodes().length===0;
    if(job.targetUrl) {
      if(location.href!==job.targetUrl) throw Error('当前页面不是保存的日期对话，已停止。');
    } else if (location.pathname !== '/' || messageNodes().length) throw Error('当前页面不是空白新对话，已停止。');
    await waitFor(()=>!generating(),150000,'上一条回答尚未结束，任务已暂停，不会插入或打断回答。');
    const beforeSwitch=await waitFor(composer,10000,'找不到聊天输入框，请检查是否登录，或页面结构是否变化。');
    if (readText(beforeSwitch)) {
      const normalize=text=>text.replace(/\s+/g,'').trim();
      const ownFailed=!job.targetUrl && (job.failedPrompts || []).some(prompt=>normalize(prompt)===normalize(readText(beforeSwitch)));
      if(!ownFailed)throw Error('发现已有草稿，已停止，避免覆盖。');
      const reset=await chrome.runtime.sendMessage({type:'resetFailedDraft',id:job.id});
      if(!reset?.ok)throw Error(reset?.error || '网页未确认旧失败草稿已清空，已停止。');
      const newChat=[...document.querySelectorAll('button,a')].find(el=>visible(el) &&
        /^(new chat|新聊天)$/i.test((el.getAttribute('aria-label') || el.textContent || '').trim()));
      if(!newChat)throw Error('找不到新聊天按钮，旧失败草稿未改动。');
      newChat.click();
      await waitFor(()=>{const el=composer();return el && !readText(el) && el;},10000,'网页未清空旧失败草稿，已停止。');
    }
    await ensureChatMode();
    if(blankNewChat) await ensureInstantMode();
    const input=await waitFor(composer,10000,'切换后找不到聊天输入框，已停止。');
    if (readText(input)) throw Error('发现已有草稿，已停止，避免覆盖。');
    return input;
  }

  async function send(job) {
    try {
      const result = await performSend(job);
      await report(job, { ok: true, url: result.url });
      return result;
    } catch (error) {
      await report(job, {
        ok: false,
        error: error.message,
        submissionAttempted: error.submissionAttempted === true
      });
      throw error;
    }
  }

  async function performSend(job) {
    await prepareComposer(job);
    const fileInput = await waitFor(() => document.querySelector('input[type="file"]'), 10000, '找不到图片上传控件。');
    await progress(job, 'uploading');
    const blob = await (await fetch(job.dataUrl)).blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], job.name, {type: blob.type}));
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event('change', {bubbles: true}));

    // Require visible attachment evidence as well as an enabled send button.
    // Selectors are intentionally conservative: unknown layouts pause, not submit text-only.
    await waitFor(() => {
      const labels = [...document.querySelectorAll('[data-testid*="attachment"], [data-testid*="file"], [aria-label], [title]')].filter(visible);
      return labels.some(el => [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title')].some(value => value?.includes(job.name)))
        || [...document.querySelectorAll('form img[src^="blob:"], form img[src^="data:image"], [data-testid*="attachment"] img')].some(visible);
    }, 45000, '没有确认到截图附件，已停止，防止只发送文字。');

    const inserted=await chrome.runtime.sendMessage({type:'insertPrompt',id:job.id});
    if(!inserted?.ok) throw Error(inserted?.error || '网页编辑器没有确认规则文字。');
    // Uploading can replace the editor element; never verify a detached old input.
    const currentInput=composer();
    if (!currentInput || !currentInput.isConnected || !readText(currentInput).includes(job.id)) throw Error('无法确认规则写入成功，已停止。');
    let button = await waitFor(() => {
      const button = sendButton();
      const pending = [...document.querySelectorAll('form [role="progressbar"], form progress')].some(visible);
      return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !pending ? button : null;
    }, 45000, '图片上传未完成或发送不可用，已停止。');
    await progress(job, 'sending');
    await ensureChatMode();
    if(chatMode().state!=='chat')throw Error('提交前无法确认 Chat 模式，已停止，未发送；请检查页面草稿。');
    const submitInput=composer();
    button=sendButton();
    if(!submitInput || !readText(submitInput).includes(job.id) || !button || button.disabled || button.getAttribute('aria-disabled')==='true')throw Error('切换 Chat 后发送内容未就绪，未发送。');
    try {
      button.click();
      await waitFor(() => submittedScreenshot(job.id) && /^\/c\/[^/]+/.test(location.pathname) &&
        !decodeURIComponent(location.pathname).includes('local-chatgpt:'), 30000, '已尝试发送，但无法确认截图和规则入库。请查看标签页，不要重复发送。');
    } catch(error) {error.submissionAttempted=true;throw error;}
    return {ok: true, url: location.href};
  }

  async function sendText(job) {
    try {
      const result = await performSendText(job);
      await report(job, { ok: true, url: result.url });
      return result;
    } catch (error) {
      await report(job, {
        ok: false,
        error: error.message,
        submissionAttempted: error.submissionAttempted === true
      });
      throw error;
    }
  }

  async function performSendText(job) {
    await prepareComposer(job);
    await progress(job, 'uploading');
    const inserted=await chrome.runtime.sendMessage({type:'insertPrompt',id:job.id});
    if(!inserted?.ok) throw Error(inserted?.error || '网页编辑器没有确认文字内容。');
    const currentInput=composer();
    if (!currentInput || !currentInput.isConnected || !readText(currentInput).includes(job.id)) throw Error('无法确认文字写入成功，已停止。');
    let button = await waitFor(() => {
      const button = sendButton();
      return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
    }, 45000, '文字输入未完成或发送不可用，已停止。');
    await progress(job, 'sending');
    await ensureChatMode();
    if(chatMode().state!=='chat')throw Error('提交前无法确认 Chat 模式，已停止，未发送；请检查页面草稿。');
    const submitInput=composer();
    button=sendButton();
    if(!submitInput || !readText(submitInput).includes(job.id) || !button || button.disabled || button.getAttribute('aria-disabled')==='true')throw Error('切换 Chat 后发送内容未就绪，未发送。');
    try {
      button.click();
      await waitFor(() => submittedText(job.id) && /^\/c\/[^/]+/.test(location.pathname) &&
        !decodeURIComponent(location.pathname).includes('local-chatgpt:'), 30000, '已尝试发送，但无法确认文字和规则入库。请查看标签页，不要重复发送。');
    } catch(error) {error.submissionAttempted=true;throw error;}
    return {ok: true, url: location.href};
  }

  async function renameDaily(message) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(message.title) || location.href!==message.url) throw Error('日期标题或目标对话不匹配，未改名。');

    /*
     * Check the current title before doing anything.
     *
     * The rename is often already applied by a previous attempt that failed
     * later in the sequence (menu closed by a re-render, tab navigated, etc.).
     * Without this the caller reported "naming failed" for a chat that was
     * already correctly named.
     */
    if (alreadyNamed(message.title)) return {ok: true, alreadyNamed: true};

    await waitFor(()=>!generating(),150000,'回答尚未结束，暂未改名。');
    // The title may have been set while we were waiting.
    if (alreadyNamed(message.title)) return {ok: true, alreadyNamed: true};
    const currentRows=()=>[...document.querySelectorAll('a[href]')].filter(a=>!new URL(a.href).hash && new URL(a.href).pathname===location.pathname && visible(a));
    const rowMenu=link=>{
      for(let row=link,depth=0;row && depth<6;row=row.parentElement,depth++) {
        if([...row.querySelectorAll('a[href]')].some(a=>/\/c\//.test(a.pathname) && a.pathname!==location.pathname))break;
        const button=[...row.querySelectorAll('button')].find(b=>visible(b) && [b.getAttribute('aria-label'),b.getAttribute('title'),b.textContent].some(label=>/^(聊天操作|对话操作|chat options|conversation options|open conversation options)$/i.test((label || '').trim())));
        if(button)return button;
      }
      return null;
    };
    const currentLink=()=>currentRows().find(link=>link.textContent.trim()===message.title) || currentRows()[0];
    if(currentLink()?.textContent.trim()===message.title || document.title===message.title)return {ok:true};
    if(!currentRows().some(link=>rowMenu(link))) {
      const sidebar=[...document.querySelectorAll('button')].find(b=>visible(b) && /^(显示侧边栏|打开侧边栏|show sidebar|open sidebar)$/i.test(b.getAttribute('aria-label') || ''));
      if(sidebar)sidebar.click();
    }
    const menu=await waitFor(()=>{
      for(const link of currentRows()) {const button=rowMenu(link);if(button)return button;}
      const header=document.querySelector('button[data-testid="conversation-options-button"]');
      if(visible(header))return header;
      return null;
    },10000,'找不到当前聊天的重命名菜单。');
    /*
     * Menu-open detection has to be tolerant.
     *
     * ChatGPT's menu is a Radix popover whose aria-expanded is not always
     * present, and a re-render can replace the trigger element after it opened.
     * The reliable signal is whether a Rename item is on screen, so that is
     * checked first.
     */
    const renameItemVisible=()=>[...document.querySelectorAll('[role="menuitem"], [role="menu"] button')]
      .some(el=>visible(el) && /^(rename|重命名)$/i.test(readText(el)));
    const menuOpened=()=>renameItemVisible() ||
      menu?.getAttribute?.('aria-expanded')==='true' ||
      [...document.querySelectorAll('[role="menu"]')].some(visible);
    if(!menuOpened()) {
      // Radix conversation menus open on pointerdown, not HTMLElement.click().
      menu.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,buttons:1,pointerType:'mouse'}));
      menu.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,buttons:0,pointerType:'mouse'}));
      await sleep(200);
      if(!menuOpened())menu.click();
    }
    await waitFor(menuOpened,5000,'当前聊天的操作菜单未展开，日期命名未完成。');
    const rename=await waitFor(()=>[...document.querySelectorAll('[role="menuitem"], [role="menu"] button')].find(el=>visible(el) && /^(rename|重命名)$/i.test(readText(el))),5000,'找不到重命名选项。');
    rename.click();
    const input=await waitFor(()=>[...document.querySelectorAll('[role="dialog"] input, input[type="text"]')].find(el=>visible(el) && !el.closest('form:has(textarea),nav')),5000,'找不到标题编辑框。');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,message.title);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    const dialog=input.closest('[role="dialog"]') || input.closest('form') || input.parentElement.parentElement;
    const save=[...dialog.querySelectorAll('button')].find(b=>visible(b) && /^(save|保存|确认)$/i.test(readText(b)));
    if(save)save.click();
    else {input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));input.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true}));}
    // Accept either signal. The sidebar link can be stale or virtualised while
    // the document title has already updated, so requiring both was a false
    // negative that reported a completed rename as failed.
    await waitFor(()=>alreadyNamed(message.title),10000,'网页未确认日期标题。');
    return {ok:true};
  }

  /** True when the conversation already carries the target title. */
  function alreadyNamed(title) {
    if (document.title === title) return true;
    // The sidebar row for the current conversation.
    const rows=[...document.querySelectorAll('a[href]')].filter(a=>{
      try { return !new URL(a.href).hash && new URL(a.href).pathname===location.pathname && visible(a); }
      catch { return false; }
    });
    if (rows.some(a=>a.textContent.trim()===title)) return true;
    // The header title, which updates before the sidebar does.
    const header=[...document.querySelectorAll('h1,h2,[data-testid*="conversation-title"]')]
      .find(el=>visible(el));
    return !!header && header.textContent.trim()===title;
  }

  const listener=(message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if(message.type==='verifyReceipt') {
      reply({ok:/^\/c\/[^/]+/.test(location.pathname) && !decodeURIComponent(location.pathname).includes('local-chatgpt:') && submittedScreenshot(message.id),url:location.href});
      return;
    }
    if(message.type==='verifyTextReceipt') {
      reply({ok:/^\/c\/[^/]+/.test(location.pathname) && !decodeURIComponent(location.pathname).includes('local-chatgpt:') && submittedText(message.id),url:location.href});
      return;
    }
    if(message.type==='renameDaily') {
      renameDaily(message).then(reply,error=>reply({ok:false,error:error.message}));return true;
    }
    if (message.type !== 'sendScreenshot' && message.type !== 'sendText') return;
    const sendJob = message.type === 'sendText' ? sendText : send;
    sendJob(message.job).then(reply, error => reply({ok: false, error: error.message, submissionAttempted: error.submissionAttempted===true}));
    return true;
  };
  globalThis.shotThinkSenderListener=listener;
  chrome.runtime.onMessage.addListener(listener);
})();

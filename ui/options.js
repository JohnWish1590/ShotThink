/* ShotThink options page: rules, send history, toolbar size.
 *
 * Language and theme are handled by prefs.js so both extension pages behave
 * identically. This file owns everything specific to the options page.
 */

const $ = id => document.getElementById(id);

const STATUS_LABELS = {
  queued: '排队中',
  preparing: '准备日期聊天',
  uploading: '上传截图',
  sending: '正在确认发送',
  sent: '已确认发送',
  failed: '已转人工处理',
  uncertain: '待人工核对，未自动重发'
};

const isManualJob = job => ['failed', 'uncertain'].includes(job.status);

let manualOnly = false;

/* ---------------------------------------------------------- toolbar size */

function paintScale(scale) {
  for (const button of $('scaleSeg').querySelectorAll('[data-scale]')) {
    button.setAttribute('aria-pressed', String(button.dataset.scale === String(scale)));
  }
}

async function loadScale() {
  const { toolbarScale } = await chrome.storage.local.get('toolbarScale');
  paintScale(toolbarScale ?? 22);
}

$('scaleSeg').addEventListener('click', async event => {
  const button = event.target.closest('[data-scale]');
  if (!button) return;
  const scale = Number(button.dataset.scale);
  await chrome.storage.local.set({ toolbarScale: scale });
  paintScale(scale);
});

/* ------------------------------------------------------------------ rules */

async function loadRules() {
  const { rules = '' } = await chrome.storage.local.get('rules');
  $('rules').value = rules;
}

async function saveRules() {
  const rules = $('rules').value.trim();
  await chrome.storage.local.set({ rules });
  $('rulesStatus').textContent = shotThinkText('已保存。');
  setTimeout(() => { $('rulesStatus').textContent = ''; }, 1600);
}

$('save').addEventListener('click', () => void saveRules());

/* ----------------------------------------------------------------- history */

/**
 * One job row.
 *
 * Built as wrapping block children rather than one flex line: the previous
 * version put the "open chat" link in the same container, which squeezed it
 * into a one-character-wide column on a narrow window.
 */
function jobRow(job) {
  const li = document.createElement('li');
  li.className = 'job';

  const name = document.createElement('span');
  name.className = 'job-name';
  const parts = [];
  if (job.day) parts.push(`${job.day} · #${job.ordinal}`);
  parts.push(job.name || '');
  name.textContent = parts.filter(Boolean).join(' · ');
  li.append(name);

  const state = document.createElement('span');
  const status = job.status;
  state.className = 'job-state';
  if (status === 'sent') state.classList.add('ok');
  else if (status === 'failed') state.classList.add('err');
  else if (status === 'uncertain') state.classList.add('warn');
  state.textContent = shotThinkText(
    job.inputType === 'text' && status === 'uploading'
      ? '正在写入文字'
      : STATUS_LABELS[status] || status
  );
  li.append(state);

  if (job.url) {
    const link = document.createElement('a');
    link.className = 'job-link';
    link.textContent = shotThinkText('查看对话');
    link.href = job.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    li.append(link);
  }

  if (isManualJob(job)) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'quiet';
    clear.textContent = shotThinkText(job.status === 'uncertain' ? '确认后清除' : '清除记录');
    clear.addEventListener('click', async () => {
      if (job.status === 'uncertain' && !confirm(shotThinkText('请先确认对应对话，清除后不会自动重发。'))) return;
      clear.disabled = true;
      const reply = await chrome.runtime.sendMessage({ type: 'clearJob', id: job.id, confirmed: true });
      if (!reply.ok) {
        $('notice').textContent = reply.error;
        clear.disabled = false;
      }
    });
    li.append(clear);
  }

  if (job.warning || job.error) {
    const note = document.createElement('span');
    note.className = 'job-note' + (job.error ? ' err' : '');
    note.textContent = job.warning || job.error;
    li.append(note);
  }

  return li;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function render() {
  const { jobs = [], queuePaused = false } = await chrome.storage.local.get(['jobs', 'queuePaused']);
  const active = jobs.filter(job => !job.archived);
  const manual = active.filter(isManualJob);
  const visible = manualOnly ? manual : active;

  const list = $('jobs');
  list.replaceChildren();
  for (const job of [...visible].reverse()) list.append(jobRow(job));

  $('emptyHistory').hidden = visible.length > 0;

  const manualButton = $('manual');
  manualButton.hidden = !manual.length && !manualOnly;
  manualButton.textContent = manualOnly
    ? shotThinkText('显示全部')
    : `${shotThinkText('人工处理')} (${manual.length})`;

  $('resume').hidden = !queuePaused;

  try {
    const usage = await chrome.runtime.sendMessage({ type: 'storageUsage' });
    if (usage?.ok) {
      $('usage').textContent = usage.count
        ? `${shotThinkText('本地图片')}: ${usage.count} · ${formatBytes(usage.bytes)}`
        : '';
    }
  } catch {}
}

/* --------------------------------------------------------------- actions */

$('manual').addEventListener('click', () => {
  manualOnly = !manualOnly;
  void render();
});

$('clear').addEventListener('click', async () => {
  const reply = await chrome.runtime.sendMessage({ type: 'clear' });
  $('notice').textContent = reply.ok ? shotThinkText('已发送记录已清理。') : reply.error;
  void render();
});

$('verify').addEventListener('click', async () => {
  const reply = await chrome.runtime.sendMessage({ type: 'verify' });
  $('notice').textContent = reply.ok
    ? shotThinkText('检查不会重新发送。')
    : reply.error;
  void render();
});

$('resume').addEventListener('click', async () => {
  const reply = await chrome.runtime.sendMessage({ type: 'resume' });
  if (!reply.ok) $('notice').textContent = reply.error;
  void render();
});

$('diagnose').addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('ui/diagnose.html') });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.jobs || changes.queuePaused)) void render();
});

// Re-render on language change so dynamically built rows follow.
document.addEventListener('shotthink:language', () => void render());

/* ------------------------------------------------------------------- boot */

(async () => {
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  await shotThinkLoadPrefs();
  await loadScale();
  await loadRules();
  await render();
})();

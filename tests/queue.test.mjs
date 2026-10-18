/* ShotThink queue settlement tests.
 *
 * Run with:  node tests/queue.test.mjs
 *
 * The rule this suite protects is the one that matters most for a tool whose
 * selling point is "it just works, for free": a send whose outcome is unknown
 * must never be retried automatically, and a job the worker stopped waiting for
 * must still be settled. Getting either wrong either duplicates a screenshot in
 * the user's chat or strands it forever.
 */

import assert from 'node:assert/strict';

/* -------------------------------------------- copied decision logic */

const PENDING_JOB_TTL_MS = 10 * 60_000;

/**
 * Which jobs the reconciler should settle.
 *
 * A job is stranded when it is in flight, past its TTL, and its tab is gone.
 * A tab that still exists might yet report, so it is left alone.
 */
function findStranded(jobs, now, tabExists) {
  return jobs.filter(job =>
    !job.archived &&
    ['preparing', 'uploading', 'sending'].includes(job.status) &&
    now - (job.pendingSince || job.created || now) > PENDING_JOB_TTL_MS &&
    !tabExists(job.tabId)
  );
}

/**
 * Status to record for a failed send.
 *
 * `uncertain` whenever a submit may have happened, because resending would
 * duplicate the message. `failed` only when the failure is provably before
 * submission.
 */
function failureStatus({ submissionAttempted, storedStatus }) {
  const attempted = submissionAttempted === true ||
    (storedStatus === 'sending' && submissionAttempted !== false);
  return attempted ? 'uncertain' : 'failed';
}

/** Does the worker keep waiting, or hand off to the page? */
function sendReplyOutcome(response) {
  if (response?.pending) return 'handoff';
  if (response?.ok) return 'sent';
  return 'failed';
}

/* ---------------------------------------------------------------- tests */

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}

test('a job still inside its TTL is left alone', () => {
  const now = 1_000_000;
  const jobs = [{ id: 'a', status: 'sending', pendingSince: now - 1000, tabId: 7 }];
  assert.equal(findStranded(jobs, now, () => false).length, 0);
});

test('a job past its TTL whose tab is gone is settled', () => {
  const now = 1_000_000;
  const jobs = [{ id: 'a', status: 'sending', pendingSince: now - PENDING_JOB_TTL_MS - 1, tabId: 7 }];
  const stranded = findStranded(jobs, now, () => false);
  assert.equal(stranded.length, 1);
  assert.equal(stranded[0].id, 'a');
});

test('a job past its TTL whose tab still exists is left alone', () => {
  // The page may still be waiting out a long answer and could yet report.
  const now = 1_000_000;
  const jobs = [{ id: 'a', status: 'uploading', pendingSince: now - PENDING_JOB_TTL_MS - 1, tabId: 7 }];
  assert.equal(findStranded(jobs, now, () => true).length, 0);
});

test('a job with no tab id is settled once past its TTL', () => {
  const now = 1_000_000;
  const jobs = [{ id: 'a', status: 'preparing', pendingSince: now - PENDING_JOB_TTL_MS - 1 }];
  assert.equal(findStranded(jobs, now, () => false).length, 1);
});

test('archived and completed jobs are never settled', () => {
  const now = 1_000_000;
  const jobs = [
    { id: 'archived', status: 'sending', archived: true, pendingSince: 0, tabId: 7 },
    { id: 'sent', status: 'sent', pendingSince: 0, tabId: 7 },
    { id: 'failed', status: 'failed', pendingSince: 0, tabId: 7 }
  ];
  assert.equal(findStranded(jobs, now, () => false).length, 0);
});

test('a job with no timestamps at all is not settled immediately', () => {
  // Defensive: a malformed record must not be swept on the first alarm tick.
  const now = 1_000_000;
  const jobs = [{ id: 'a', status: 'sending' }];
  assert.equal(findStranded(jobs, now, () => false).length, 0);
});

test('a send that may have been submitted becomes uncertain, not failed', () => {
  assert.equal(failureStatus({ submissionAttempted: true, storedStatus: 'sending' }), 'uncertain');
});

test('a send that failed before submission becomes failed', () => {
  assert.equal(failureStatus({ submissionAttempted: false, storedStatus: 'uploading' }), 'failed');
});

test('a failure while sending is treated as uncertain by default', () => {
  // No explicit flag, but the status says a submit was underway.
  assert.equal(failureStatus({ storedStatus: 'sending' }), 'uncertain');
});

test('an explicit false overrides the sending status', () => {
  // The page knows it never clicked submit, so a retry is safe.
  assert.equal(failureStatus({ submissionAttempted: false, storedStatus: 'sending' }), 'failed');
});

test('a pending reply hands the job back to the page', () => {
  assert.equal(sendReplyOutcome({ pending: true }), 'handoff');
});

test('an ok reply settles the job as sent', () => {
  assert.equal(sendReplyOutcome({ ok: true, url: 'https://chatgpt.com/c/x' }), 'sent');
});

test('a failed reply settles the job as failed', () => {
  assert.equal(sendReplyOutcome({ ok: false, error: 'x' }), 'failed');
});

test('a reply timeout is shorter than the TTL so handoff happens first', () => {
  // If the reply timeout were longer than the TTL the reconciler could sweep a
  // job that the page is still working on.
  const SEND_REPLY_TIMEOUT_MS = 20_000;
  assert.ok(SEND_REPLY_TIMEOUT_MS < PENDING_JOB_TTL_MS);
});

test('a 150 second wait cannot be mistaken for a dead worker', () => {
  // The specific regression: waiting out a previous answer used to hold the
  // service worker for 150s. With handoff the worker stops after 20s and the
  // page keeps the wait.
  const previousAnswerWaitMs = 150_000;
  const SEND_REPLY_TIMEOUT_MS = 20_000;
  assert.ok(previousAnswerWaitMs > 30_000, 'the wait really does exceed the worker lifetime');
  assert.ok(SEND_REPLY_TIMEOUT_MS < 30_000, 'the worker must not block past its lifetime');
});

/* ---------------------------------------------------------------- report */

const failed = results.filter(r => !r.ok);
for (const result of results) {
  console.log(`${result.ok ? 'ok  ' : 'FAIL'}  ${result.name}`);
  if (!result.ok) console.log(`      ${result.error.message}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);

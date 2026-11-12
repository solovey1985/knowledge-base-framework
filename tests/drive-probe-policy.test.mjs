import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, readWithRetry, reconcile, retentionCandidates } from '../scripts/drive-probe-policy.mjs';

const failure = (status, reason, retryAfter) => ({ response: {
  status, data: { error: { errors: [{ reason }] } },
  headers: new Headers(retryAfter ? { 'Retry-After': retryAfter } : {}),
} });

test('injected invalid_grant, permission and quota errors do not retry', async () => {
  const errors = [
    { response: { status: 400, data: { error: 'invalid_grant' } } },
    failure(401), failure(403, 'storageQuotaExceeded'), failure(403, 'insufficientFilePermissions'),
  ];
  assert.deepEqual(errors.map(classifyError), ['reconnect', 'reconnect', 'quota', 'stop']);
  for (const error of errors) {
    let calls = 0;
    await assert.rejects(readWithRetry(async () => { calls++; throw error; }));
    assert.equal(calls, 1);
  }
});

test('injected rate limits honor Retry-After; transient reads recover with a bound', async () => {
  let calls = 0;
  const delays = [];
  const result = await readWithRetry(async () => {
    calls++;
    if (calls === 1) throw failure(429, undefined, '3');
    if (calls === 2) throw failure(503);
    return 'ok';
  }, { sleep: async ms => delays.push(ms), random: () => 0 });
  assert.equal(result, 'ok');
  assert.deepEqual(delays, [3000, 2000]);
  calls = 0;
  await assert.rejects(readWithRetry(async () => { calls++; throw failure(403, 'userRateLimitExceeded'); },
    { sleep: async () => {}, random: () => 0 }));
  assert.equal(calls, 3);
});

test('long server delay returns unavailable without an early retry', async () => {
  let calls = 0;
  await assert.rejects(readWithRetry(async () => { calls++; throw failure(429, undefined, '120'); }));
  assert.equal(calls, 1);
  await assert.rejects(readWithRetry(async () => { throw failure(429, undefined, 'Wed, 04 Nov 2026 12:00:00 GMT'); },
    { sleep: async () => assert.fail('Date Retry-After must not cause an early retry') }));
});

test('newer payload or reused operation ID is not a confirmed old save', () => {
  const expected = { operationId: 'a', project: { title: 'a' } };
  assert.equal(reconcile(expected, expected), 'confirmed');
  assert.equal(reconcile({ ...expected, project: { title: 'b' } }, expected), 'unknown');
  assert.equal(reconcile({ operationId: 'b', project: { title: 'b' } }, expected), 'unknown');
});

test('retention preserves newest records, never prunes the final backup', () => {
  const records = Array.from({ length: 12 }, (_, i) => ({ id: String(i), createdTime: String(i).padStart(2, '0') }));
  assert.deepEqual(retentionCandidates(records).map(item => item.id), ['1', '0']);
  assert.deepEqual(retentionCandidates(records.slice(0, 1), 1), []);
  assert.throws(() => retentionCandidates(records, 0));
});

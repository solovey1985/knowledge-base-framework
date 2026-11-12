// Prototype policy for STO-01. Production integration belongs to STO-02/03.
export function classifyError(error) {
  const status = error.response?.status;
  const data = error.response?.data;
  const reasons = data?.error?.errors?.map(item => item.reason) ?? [];
  if (data?.error === 'invalid_grant' || status === 401) return 'reconnect';
  if (reasons.includes('storageQuotaExceeded')) return 'quota';
  if (status === 429 || (status === 403 && reasons.some(value =>
    ['rateLimitExceeded', 'userRateLimitExceeded'].includes(value)))) return 'retry';
  if (!status || [500, 502, 503, 504].includes(status)) return 'retry';
  return 'stop';
}

export async function readWithRetry(read, {
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), random = Math.random,
} = {}) {
  // Three attempts; never use this wrapper for an uncertain mutation.
  for (let attempt = 0; ; attempt++) {
    try { return await read(); } catch (error) {
      if (attempt === 2 || classifyError(error) !== 'retry') throw error;
      const raw = error.response?.headers?.get?.('retry-after');
      const requested = raw ? Number(raw) : 0;
      // Conservatively stop for a date/unrecognized value rather than retry early.
      if (raw && (!Number.isFinite(requested) || requested < 0)) throw error;
      const retryAfter = Number.isFinite(requested) ? requested * 1000 : 0;
      const delay = Math.max(1000 * 2 ** attempt + Math.floor(random() * 1000), retryAfter);
      // A long server delay should surface as unavailable, not be retried early.
      if (delay > 30_000) throw error;
      await sleep(delay);
    }
  }
}

export function reconcile(actual, expected) {
  // Compare the operation and complete payload, not just existence or HTTP 409.
  return JSON.stringify(actual) === JSON.stringify(expected) ? 'confirmed' : 'unknown';
}

export function retentionCandidates(backups, keep = 10) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('Invalid retention count');
  // Caller validates schema/root and supplies only verified backup records.
  return [...backups].sort((a, b) => b.createdTime.localeCompare(a.createdTime) ||
    b.id.localeCompare(a.id)).slice(keep);
}

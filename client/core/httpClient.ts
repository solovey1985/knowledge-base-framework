/** Origin-root API routes stay independent of the content base URL. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export function createHttpClient() {
  const requests = new Set<AbortController>();
  return {
    async request<T = any>(path: string, method = 'GET', body?: unknown, csrf = ''): Promise<T> {
      const controller = new AbortController();
      requests.add(controller);
      const timeout = setTimeout(() => controller.abort(), 45000);
      try {
        const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}) },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        const value = await response.json();
        if (!response.ok) throw new ApiError(response.status, value.error?.code || 'request_failed');
        return value;
      } finally { clearTimeout(timeout); requests.delete(controller); }
    },
    dispose: () => { for (const request of requests) request.abort(); requests.clear(); },
  };
}

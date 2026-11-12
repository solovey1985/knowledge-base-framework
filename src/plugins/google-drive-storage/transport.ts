import { OAuth2Client } from 'google-auth-library';
import { StorageError } from '../../core/storage';
import { DriveConfig } from './config';

export interface DriveRequest {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  query?: Record<string, string>;
  data?: unknown;
  headers?: Record<string, string>;
  upload?: boolean;
}
export interface DriveTransport { request(request: DriveRequest): Promise<any> }

export function mapDriveError(error: any): StorageError {
  if (error instanceof StorageError) return error;
  const status = error?.response?.status;
  const body = error?.response?.data;
  const reasons: string[] = body?.error?.errors?.map((item: any) => item.reason) ?? [];
  if (body?.error === 'invalid_grant' || status === 401) return new StorageError('reconnect_required');
  if (reasons.includes('storageQuotaExceeded')) return new StorageError('quota_exceeded');
  if (status === 429 || reasons.some(value => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(value))) {
    return new StorageError('rate_limited');
  }
  if (status === 403) return new StorageError('access_denied');
  if (status === 404) return new StorageError('not_found');
  if (status === 409) return new StorageError('conflict');
  if (status === 400) return new StorageError('invalid_input');
  return new StorageError('unavailable');
}

/** Fixed upstream origin; refresh tokens and raw SDK errors never leave this class. */
export class GoogleDriveTransport implements DriveTransport {
  readonly #oauth: OAuth2Client;
  readonly #limit: number;

  constructor(config: DriveConfig) {
    this.#oauth = new OAuth2Client({ clientId: config.clientId, clientSecret: config.clientSecret,
      transporterOptions: { timeout: 15_000, retry: false } });
    this.#oauth.setCredentials({ refresh_token: config.refreshToken });
    this.#limit = config.maxDocumentBytes + 65_536;
  }

  async request(request: DriveRequest): Promise<any> {
    const base = request.upload ? 'https://www.googleapis.com/upload/drive/v3/' : 'https://www.googleapis.com/drive/v3/';
    const url = new URL(request.path, base);
    if (!url.href.startsWith(base)) throw new StorageError('invalid_input');
    for (const [key, value] of Object.entries(request.query ?? {})) url.searchParams.set(key, value);
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.#oauth.request({ url: url.href, method: request.method,
          data: request.data, headers: request.headers, responseType: 'stream',
          timeout: 15_000, retry: false });
        let bytes = 0;
        const chunks: Buffer[] = [];
        // Bound even a maliciously enlarged remote JSON before parsing it.
        for await (const chunk of result.data as any) {
          const buffer = Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > this.#limit) {
            (result.data as any).destroy();
            throw new StorageError('too_large');
          }
          chunks.push(buffer);
        }
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new StorageError('invalid_document'); }
      } catch (raw: any) {
        // Error bodies can also be streams with responseType=stream. Read a small,
        // bounded body so quota and permission errors keep their stable codes.
        const body = raw?.response?.data;
        if (body?.[Symbol.asyncIterator]) {
          try {
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of body) {
              const buffer = Buffer.from(chunk);
              size += buffer.length;
              if (size > 16_384) { body.destroy(); break; }
              chunks.push(buffer);
            }
            raw.response.data = size <= 16_384 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
          } catch { raw.response.data = {}; }
        }
        const error = mapDriveError(raw);
        if (request.method !== 'GET' || attempt >= 2 || !['rate_limited', 'unavailable'].includes(error.code)) throw error;
        const retryAfter = raw?.response?.headers?.get?.('retry-after');
        const seconds = retryAfter === null || retryAfter === undefined ? 0 : Number(retryAfter);
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30) throw error;
        const delay = Math.max(seconds * 1000, 1000 * 2 ** attempt + Math.floor(Math.random() * 500));
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}

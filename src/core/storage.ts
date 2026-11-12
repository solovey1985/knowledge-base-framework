export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type StorageErrorCode = 'invalid_input' | 'invalid_ticket' | 'not_found' | 'conflict' |
  'access_denied' | 'reconnect_required' | 'quota_exceeded' | 'rate_limited' |
  'unavailable' | 'unknown_result' | 'invalid_document' | 'unsupported_version' | 'too_large';

/** Safe public error: upstream errors may contain Authorization headers. */
export class StorageError extends Error {
  constructor(public readonly code: StorageErrorCode) {
    super(`Storage: ${code}`);
    this.name = 'StorageError';
  }
}

export interface StorageDocument {
  key: string;
  content: JsonValue;
  operationId: string;
  revision: string;
  archived: boolean;
  warnings?: Array<'backup_cleanup_pending'>;
}

export interface StorageBackup {
  ticket: string;
  createdAt: string;
  operationId: string;
  revision: string;
}

export interface StorageProvider {
  readonly id: string;
  initialize(): Promise<void>;
  list(options?: { cursor?: string; archived?: boolean }): Promise<{ items: StorageDocument[]; cursor?: string }>;
  read(key: string): Promise<StorageDocument>;
  /** Persist ticket alongside the draft before create. It is opaque, not a raw file ID. */
  prepareCreate(key: string, operationId: string, content: JsonValue): Promise<string>;
  create(ticket: string, content: JsonValue): Promise<StorageDocument>;
  update(key: string, operationId: string, content: JsonValue): Promise<StorageDocument>;
  archive(key: string, operationId: string): Promise<StorageDocument>;
  /** Unarchives the current document. Restoring a backup is a separate STO-03 operation. */
  restore(key: string, operationId: string): Promise<StorageDocument>;
  listBackups(key: string): Promise<StorageBackup[]>;
  restoreBackup(key: string, ticket: string, operationId: string,
    validate?: (content: JsonValue) => Promise<void>): Promise<StorageDocument>;
  pruneBackups(key: string): Promise<void>;
  /** Read-only reconciliation after a timeout/restart; never replays an old mutation. */
  reconcile(key: string, operationId: string, content: JsonValue, archived?: boolean): Promise<StorageDocument>;
}

export class StorageRegistry {
  readonly #providers = new Map<string, StorageProvider>();

  constructor(providers: StorageProvider[] = []) {
    for (const provider of providers) {
      if (this.#providers.has(provider.id)) throw new Error(`Duplicate storage provider: ${provider.id}`);
      this.#providers.set(provider.id, provider);
    }
  }

  get(id: string): StorageProvider {
    const provider = this.#providers.get(id);
    if (!provider) throw new StorageError('not_found');
    return provider;
  }

  ids(): string[] { return [...this.#providers.keys()]; }
}

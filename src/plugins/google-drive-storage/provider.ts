import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { JsonValue, StorageBackup, StorageDocument, StorageError, StorageProvider } from '../../core/storage';
import { DriveConfig } from './config';
import { DriveRequest, DriveTransport, GoogleDriveTransport, mapDriveError } from './transport';

const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,mimeType,parents,trashed,driveId,size,createdTime,appProperties';
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const KEY = /^[a-zA-Z0-9_-]{1,80}$/;
const OPERATION = /^[a-zA-Z0-9_-]{8,100}$/;

interface Envelope {
  storageVersion: 1;
  key: string;
  operationId: string;
  archived: boolean;
  content: JsonValue;
}

/** Deterministic JSON with a bounded depth; no class instances or lossy JSON values. */
function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new StorageError('invalid_input');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, item => canonical(item, depth + 1)).join(',')}]`;
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new StorageError('invalid_input');
      return `${JSON.stringify(key)}:${canonical((value as any)[key], depth + 1)}`;
    }).join(',')}}`;
  }
  throw new StorageError('invalid_input');
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export class GoogleDriveStorageProvider implements StorageProvider {
  readonly id: string;
  readonly #config: DriveConfig;
  readonly #transport: DriveTransport;
  readonly #marker: string;
  readonly #backupMarker: string;
  #root?: string;
  #initializing?: Promise<void>;

  constructor(config: DriveConfig, transport?: DriveTransport) {
    this.id = config.providerId;
    this.#config = config;
    this.#transport = transport ?? new GoogleDriveTransport(config);
    this.#marker = digest(`${config.workspaceId}:${config.providerId}`);
    this.#backupMarker = digest(`${this.#marker}:backups`);
  }

  toJSON(): { id: string } { return { id: this.id }; }

  async #request(request: DriveRequest): Promise<any> {
    try { return await this.#transport.request(request); }
    catch (error) { throw mapDriveError(error); }
  }

  async initialize(): Promise<void> {
    if (!this.#initializing) {
      this.#initializing = this.#initialize().catch(error => {
        this.#initializing = undefined;
        throw error;
      });
    }
    await this.#initializing;
  }

  async #initialize(): Promise<void> {
    if (this.#config.rootFolderId) {
      this.#root = this.#config.rootFolderId;
    } else {
      const result = await this.#request({ method: 'GET', path: 'files', query: {
        q: `trashed = false and appProperties has { key='kbWorkspace' and value='${this.#marker}' } and mimeType='${FOLDER}'`,
        fields: `files(${FIELDS}),nextPageToken,incompleteSearch`, pageSize: '2', spaces: 'drive',
      } });
      if (result.incompleteSearch || result.nextPageToken || result.files?.length > 1) throw new StorageError('conflict');
      if (!Array.isArray(result.files)) throw new StorageError('invalid_document');
      if (result.files.length) this.#root = result.files[0].id;
      else {
        // A failed/unknown create is never automatically repeated in this call.
        const folder = await this.#request({ method: 'POST', path: 'files', data: {
          name: this.#config.rootFolderName, mimeType: FOLDER, appProperties: { kbWorkspace: this.#marker },
        } });
        this.#root = folder.id;
      }
    }
    await this.#checkRoot();
  }

  async #checkRoot(): Promise<void> {
    if (!this.#root || !ID.test(this.#root)) throw new StorageError('invalid_document');
    const root = await this.#request({ method: 'GET', path: `files/${this.#root}`, query: { fields: FIELDS } });
    if (root.mimeType !== FOLDER || root.trashed || root.driveId || root.appProperties?.kbWorkspace !== this.#marker) {
      throw new StorageError('access_denied');
    }
  }

  async #ready(): Promise<void> { await this.initialize(); await this.#checkRoot(); }

  #validateKey(key: string): void {
    if (typeof key !== 'string' || !KEY.test(key)) throw new StorageError('invalid_input');
  }

  #envelope(key: string, operationId: string, content: JsonValue, archived = false): Envelope {
    this.#validateKey(key);
    if (typeof operationId !== 'string' || !OPERATION.test(operationId)) throw new StorageError('invalid_input');
    const value: Envelope = { storageVersion: 1, key, operationId, archived, content };
    if (Buffer.byteLength(canonical(value)) > this.#config.maxDocumentBytes) throw new StorageError('too_large');
    // Snapshot input before any async work, so caller mutations cannot change a ticket's content.
    return JSON.parse(canonical(value));
  }

  #seal(value: object): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#config.ticketSecret, nonce);
    cipher.setAAD(Buffer.from(`kb-drive-v1:${this.#marker}`));
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString('base64url');
  }

  #open(ticket: string, kind: string): any {
    try {
      if (typeof ticket !== 'string' || ticket.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(ticket)) throw new Error();
      const bytes = Buffer.from(ticket, 'base64url');
      if (bytes.toString('base64url') !== ticket) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.#config.ticketSecret, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(`kb-drive-v1:${this.#marker}`));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
      if (value.kind !== kind || value.root !== this.#root || !Number.isSafeInteger(value.exp) || value.exp <= Date.now()) throw new Error();
      return value;
    } catch { throw new StorageError('invalid_ticket'); }
  }

  #validateMetadata(file: any, key?: string, backup = false, allowLarge = false): void {
    const keyField = backup ? 'kbBackupKey' : 'kbKey';
    if (!file || typeof file.id !== 'string' || !ID.test(file.id) || file.trashed || file.driveId ||
      file.mimeType !== 'application/json' || !Array.isArray(file.parents) || file.parents.length !== 1 ||
      file.parents[0] !== this.#root || file.appProperties?.kbWorkspace !== (backup ? this.#backupMarker : this.#marker) ||
      typeof file.appProperties?.[keyField] !== 'string' || !KEY.test(file.appProperties[keyField]) ||
      (key !== undefined && file.appProperties[keyField] !== key)) throw new StorageError('access_denied');
    if (!/^\d+$/.test(String(file.size)) || (!allowLarge && Number(file.size) > this.#config.maxDocumentBytes)) throw new StorageError('too_large');
  }

  async #find(key: string, allowLarge = false): Promise<any | undefined> {
    this.#validateKey(key);
    const result = await this.#request({ method: 'GET', path: 'files', query: {
      q: `'${this.#root}' in parents and trashed=false and appProperties has { key='kbKey' and value='${key}' }`,
      fields: `files(${FIELDS}),nextPageToken,incompleteSearch`, pageSize: '2', spaces: 'drive',
    } });
    if (!Array.isArray(result.files)) throw new StorageError('invalid_document');
    if (result.incompleteSearch || result.nextPageToken || result.files.length > 1) throw new StorageError('conflict');
    if (result.files[0]) this.#validateMetadata(result.files[0], key, false, allowLarge);
    return result.files[0];
  }

  async #readFile(id: string, key: string, backup = false): Promise<StorageDocument> {
    if (!ID.test(id)) throw new StorageError('invalid_input');
    const file = await this.#request({ method: 'GET', path: `files/${id}`, query: { fields: FIELDS } });
    this.#validateMetadata(file, key, backup);
    const value = await this.#request({ method: 'GET', path: `files/${id}`, query: { alt: 'media' } });
    try {
      if (value?.storageVersion !== undefined && value.storageVersion !== 1) throw new StorageError('unsupported_version');
      if (value?.storageVersion !== 1 || value.key !== key || typeof value.archived !== 'boolean' ||
        Object.keys(value).sort().join(',') !== 'archived,content,key,operationId,storageVersion') throw new Error();
      this.#envelope(key, value.operationId, value.content, value.archived);
    } catch (error) {
      if (error instanceof StorageError && ['too_large', 'unsupported_version'].includes(error.code)) throw error;
      throw new StorageError('invalid_document');
    }
    // Recheck after download: a moved file must not be accepted from another workspace.
    const after = await this.#request({ method: 'GET', path: `files/${id}`, query: { fields: FIELDS } });
    this.#validateMetadata(after, key, backup);
    if (backup && (file.appProperties.kbDigest !== digest(canonical(value)) ||
      after.appProperties.kbDigest !== file.appProperties.kbDigest ||
      after.appProperties.kbSource !== file.appProperties.kbSource)) throw new StorageError('invalid_document');
    return { key, operationId: value.operationId, content: value.content,
      archived: value.archived, revision: digest(canonical(value)) };
  }

  async read(key: string): Promise<StorageDocument> {
    this.#validateKey(key);
    await this.#ready();
    const file = await this.#find(key);
    if (!file) throw new StorageError('not_found');
    return this.#readFile(file.id, key);
  }

  async list(options: { cursor?: string; archived?: boolean } = {}): Promise<{ items: StorageDocument[]; cursor?: string }> {
    if (options.archived !== undefined && typeof options.archived !== 'boolean') throw new StorageError('invalid_input');
    await this.#ready();
    const archived = options.archived ?? false;
    const cursor = options.cursor ? this.#open(options.cursor, 'cursor') : undefined;
    if (cursor && cursor.archived !== archived) throw new StorageError('invalid_ticket');
    const result = await this.#request({ method: 'GET', path: 'files', query: {
      q: `'${this.#root}' in parents and trashed=false and appProperties has { key='kbWorkspace' and value='${this.#marker}' }`,
      fields: `files(${FIELDS}),nextPageToken,incompleteSearch`, pageSize: '25', spaces: 'drive',
      ...(cursor ? { pageToken: cursor.pageToken } : {}),
    } });
    if (!Array.isArray(result.files) || result.incompleteSearch) throw new StorageError('unavailable');
    const items: StorageDocument[] = [];
    for (const file of result.files) {
      this.#validateMetadata(file);
      // Resolve by logical key as well: duplicates must fail instead of selecting one silently.
      const document = await this.read(file.appProperties.kbKey);
      if (document.archived === archived) items.push(document);
    }
    return { items, ...(result.nextPageToken ? { cursor: this.#seal({ kind: 'cursor', root: this.#root,
      archived, pageToken: result.nextPageToken, exp: Date.now() + 3600_000 }) } : {}) };
  }

  async prepareCreate(key: string, operationId: string, content: JsonValue): Promise<string> {
    const envelope = this.#envelope(key, operationId, content);
    await this.#ready();
    if (await this.#find(key)) throw new StorageError('conflict');
    const reserved = await this.#request({ method: 'GET', path: 'files/generateIds', query: { count: '1', space: 'drive', type: 'files' } });
    if (!ID.test(reserved.ids?.[0] ?? '')) throw new StorageError('invalid_document');
    return this.#seal({ kind: 'create', root: this.#root, fileId: reserved.ids[0], key, operationId,
      hash: digest(canonical(envelope)), exp: Date.now() + 14 * 86400_000 });
  }

  async #confirm(id: string, expected: Envelope): Promise<StorageDocument> {
    try {
      const actual = await this.#readFile(id, expected.key);
      if (actual.revision === digest(canonical(expected))) return actual;
    } catch { /* No upstream or document details escape a reconciliation failure. */ }
    throw new StorageError('unknown_result');
  }

  async create(ticket: string, content: JsonValue): Promise<StorageDocument> {
    await this.#ready();
    const claim = this.#open(ticket, 'create');
    const value = this.#envelope(claim.key, claim.operationId, content);
    if (!ID.test(claim.fileId) || digest(canonical(value)) !== claim.hash) throw new StorageError('invalid_ticket');
    const existing = await this.#find(claim.key);
    if (existing) {
      if (existing.id !== claim.fileId) throw new StorageError('conflict');
      return this.#confirm(claim.fileId, value);
    }
    const metadata = { id: claim.fileId, name: `${claim.key}.json`, mimeType: 'application/json',
      parents: [this.#root], appProperties: { kbWorkspace: this.#marker, kbKey: claim.key } };
    await this.#upload(metadata, value);
    return this.#confirm(claim.fileId, value);
  }

  async #upload(metadata: object, value: Envelope): Promise<void> {
    const boundary = `kb_${randomBytes(16).toString('hex')}`;
    const data = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}` +
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${canonical(value)}\r\n--${boundary}--\r\n`;
    try {
      await this.#request({ method: 'POST', path: 'files', upload: true, query: { uploadType: 'multipart' },
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, data });
    } catch (error) {
      if (!(error instanceof StorageError) || !['conflict', 'unavailable'].includes(error.code)) throw error;
    }
  }

  async #replace(key: string, operationId: string, content: JsonValue, archived: boolean,
    allowDamaged = false, expectedFileId?: string): Promise<StorageDocument> {
    const value = this.#envelope(key, operationId, content, archived);
    await this.#ready();
    const file = await this.#find(key, allowDamaged);
    if (!file) throw new StorageError('not_found');
    if (expectedFileId && file.id !== expectedFileId) throw new StorageError('invalid_ticket');
    let before: StorageDocument | undefined;
    try { before = await this.#readFile(file.id, key); }
    catch (error) {
      // Explicit backup restore may recover corruption, but never an unknown future schema.
      if (!allowDamaged || !(error instanceof StorageError) || !['invalid_document', 'too_large'].includes(error.code)) throw error;
    }
    if (before?.operationId === operationId) {
      if (before.revision !== digest(canonical(value))) throw new StorageError('conflict');
      return this.#afterSave(key, before);
    }
    if (before) await this.#saveBackup(file.id, before);
    try {
      await this.#request({ method: 'PATCH', path: `files/${file.id}`, upload: true,
        query: { uploadType: 'media' }, headers: { 'Content-Type': 'application/json' }, data: canonical(value) });
    } catch (error) {
      if (!(error instanceof StorageError) || error.code !== 'unavailable') throw error;
    }
    return this.#afterSave(key, await this.#confirm(file.id, value));
  }

  async #afterSave(key: string, saved: StorageDocument): Promise<StorageDocument> {
    try { await this.pruneBackups(key); return saved; }
    catch { return { ...saved, warnings: ['backup_cleanup_pending'] }; }
  }

  async #saveBackup(sourceId: string, document: StorageDocument): Promise<void> {
    const value = this.#envelope(document.key, document.operationId, document.content, document.archived);
    const reserved = await this.#request({ method: 'GET', path: 'files/generateIds',
      query: { count: '1', space: 'drive', type: 'files' } });
    const id = reserved.ids?.[0];
    if (typeof id !== 'string' || !ID.test(id)) throw new StorageError('invalid_document');
    await this.#upload({ id, name: `backup-${document.key}-${document.revision}.json`,
      mimeType: 'application/json', parents: [this.#root], appProperties: {
        kbWorkspace: this.#backupMarker, kbBackupKey: document.key,
        kbSource: sourceId, kbDigest: document.revision,
      } }, value);
    // Read back the snapshot before allowing the destructive replacement of current JSON.
    const backup = await this.#readFile(id, document.key, true);
    if (backup.revision !== document.revision) throw new StorageError('invalid_document');
  }

  async #backupRecords(key: string, sourceId: string): Promise<Array<{ file: any; document: StorageDocument }>> {
    const records: Array<{ file: any; document: StorageDocument }> = [];
    const seen = new Set<string>();
    const pages = new Set<string>();
    let pageToken: string | undefined;
    do {
      if (pages.has(pageToken ?? '') || pages.size >= 20) throw new StorageError('unavailable');
      pages.add(pageToken ?? '');
      const result = await this.#request({ method: 'GET', path: 'files', query: {
        q: `'${this.#root}' in parents and trashed=false and appProperties has { key='kbBackupKey' and value='${key}' }`,
        fields: `files(${FIELDS}),nextPageToken,incompleteSearch`, pageSize: '100', spaces: 'drive',
        ...(pageToken ? { pageToken } : {}),
      } });
      if (!Array.isArray(result.files) || result.incompleteSearch) throw new StorageError('unavailable');
      for (const file of result.files) {
        this.#validateMetadata(file, key, true);
        if (seen.has(file.id) || file.appProperties.kbSource !== sourceId ||
          typeof file.createdTime !== 'string' || !Number.isFinite(Date.parse(file.createdTime))) throw new StorageError('invalid_document');
        seen.add(file.id);
        if (seen.size > 500) throw new StorageError('unavailable');
        records.push({ file, document: await this.#readFile(file.id, key, true) });
      }
      if (result.nextPageToken === pageToken && pageToken) throw new StorageError('unavailable');
      pageToken = result.nextPageToken;
    } while (pageToken);
    return records.sort((a, b) => b.file.createdTime.localeCompare(a.file.createdTime) || b.file.id.localeCompare(a.file.id));
  }

  async listBackups(key: string): Promise<StorageBackup[]> {
    this.#validateKey(key);
    await this.#ready();
    const file = await this.#find(key, true);
    if (!file) throw new StorageError('not_found');
    return (await this.#backupRecords(key, file.id)).map(record => ({
      createdAt: record.file.createdTime, operationId: record.document.operationId, revision: record.document.revision,
      ticket: this.#seal({ kind: 'backup', root: this.#root, key, sourceId: file.id,
        backupId: record.file.id, hash: record.document.revision, exp: Date.now() + 14 * 86400_000 }),
    }));
  }

  async restoreBackup(key: string, ticket: string, operationId: string,
    validate?: (content: JsonValue) => Promise<void>): Promise<StorageDocument> {
    this.#validateKey(key);
    await this.#ready();
    const claim = this.#open(ticket, 'backup');
    if (claim.key !== key || !ID.test(claim.backupId) || !ID.test(claim.sourceId)) throw new StorageError('invalid_ticket');
    const metadata = await this.#request({ method: 'GET', path: `files/${claim.backupId}`, query: { fields: FIELDS } });
    this.#validateMetadata(metadata, key, true);
    if (metadata.appProperties.kbSource !== claim.sourceId) throw new StorageError('invalid_ticket');
    const backup = await this.#readFile(claim.backupId, key, true);
    if (backup.revision !== claim.hash) throw new StorageError('invalid_ticket');
    // Validate the exact ticket-bound snapshot before any mutation, not after restore.
    await validate?.(backup.content);
    return this.#replace(key, operationId, backup.content, backup.archived, true, claim.sourceId);
  }

  async pruneBackups(key: string): Promise<void> {
    this.#validateKey(key);
    await this.#ready();
    const current = await this.#find(key, true);
    if (!current) throw new StorageError('not_found');
    // Do not prune while the current document is damaged or unconfirmed.
    await this.#readFile(current.id, key);
    const records = await this.#backupRecords(key, current.id);
    for (const record of records.slice(this.#config.backupKeep)) {
      const verified = await this.#readFile(record.file.id, key, true);
      if (verified.revision !== record.document.revision) throw new StorageError('invalid_document');
      await this.#request({ method: 'PATCH', path: `files/${record.file.id}`, data: { trashed: true } });
    }
  }

  async reconcile(key: string, operationId: string, content: JsonValue, archived = false): Promise<StorageDocument> {
    const expected = this.#envelope(key, operationId, content, archived);
    await this.#ready();
    const file = await this.#find(key);
    if (!file) throw new StorageError('unknown_result');
    return this.#confirm(file.id, expected);
  }

  async update(key: string, operationId: string, content: JsonValue): Promise<StorageDocument> {
    const existing = await this.read(key);
    if (existing.archived) throw new StorageError('conflict');
    return this.#replace(key, operationId, content, false);
  }

  async archive(key: string, operationId: string): Promise<StorageDocument> {
    const existing = await this.read(key);
    return this.#replace(key, operationId, existing.content, true);
  }

  async restore(key: string, operationId: string): Promise<StorageDocument> {
    const existing = await this.read(key);
    return this.#replace(key, operationId, existing.content, false);
  }
}

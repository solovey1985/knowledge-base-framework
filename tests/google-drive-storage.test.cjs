const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { GoogleDriveStorageProvider } = require('../lib/plugins/google-drive-storage/provider');
const { resolveDriveConfig } = require('../lib/plugins/google-drive-storage/config');
const { mapDriveError } = require('../lib/plugins/google-drive-storage/transport');
const { resolvePluginsFromSettings, StorageRegistry, KnowledgeBase } = require('../lib');

const folderMime = 'application/vnd.google-apps.folder';
const config = (overrides = {}) => ({ providerId: 'drive', workspaceId: 'site-a', rootFolderName: 'Test',
  maxDocumentBytes: 2048, backupKeep: 10, clientId: 'private-client', clientSecret: 'private-secret',
  refreshToken: 'private-refresh', ticketSecret: Buffer.alloc(32, 1), ...overrides });
const failure = status => ({ response: { status } });
const code = expected => error => error.code === expected;

class FakeDrive {
  files = new Map();
  calls = [];
  next = 0;
  failWrite;
  loseWriteResponse = false;
  pageSize = 25;
  responseVersion;
  intercept;
  async request(r) {
    this.calls.push(structuredClone(r));
    if (this.intercept) await this.intercept(r);
    if (r.path === 'files/generateIds') return { ids: [`file${++this.next}`] };
    if (r.method === 'GET' && r.path === 'files') {
      const q = r.query.q;
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const property = /key='([^']+)' and value='([^']+)'/.exec(q);
      let files = [...this.files.values()].filter(f => !f.trashed &&
        (!parent || f.parents?.includes(parent)) &&
        (!property || f.appProperties?.[property[1]] === property[2]) &&
        (!q.includes(`mimeType='${folderMime}'`) || f.mimeType === folderMime));
      const offset = Number(r.query.pageToken || 0);
      const size = Math.min(Number(r.query.pageSize), this.pageSize);
      const next = files.length > offset + size ? String(offset + size) : undefined;
      files = files.slice(offset, offset + size);
      return { files: structuredClone(files), nextPageToken: next };
    }
    if (r.method === 'POST') {
      if (this.failWrite) throw this.failWrite;
      let metadata = r.data;
      let value;
      if (r.upload) {
        const sections = r.data.split(/--kb_[a-f0-9]+(?:--)?\r\n/).filter(s => s.includes('Content-Type'));
        metadata = JSON.parse(sections[0].split('\r\n\r\n')[1].trim());
        value = JSON.parse(sections[1].split('\r\n\r\n')[1].trim());
      }
      const id = metadata.id || `folder${++this.next}`;
      if (this.files.has(id)) throw failure(409);
      const file = { ...metadata, id, trashed: false,
        createdTime: new Date(1700000000000 + this.next * 1000).toISOString(),
        size: String(Buffer.byteLength(JSON.stringify(value ?? {}))), value };
      this.files.set(id, file);
      if (this.loseWriteResponse) throw failure(503);
      return structuredClone(file);
    }
    const id = r.path.split('/')[1];
    const file = this.files.get(id);
    if (!file) throw failure(404);
    if (r.method === 'PATCH') {
      if (this.failWrite) throw this.failWrite;
      if (!r.upload) { Object.assign(file, r.data); return { id }; }
      file.value = JSON.parse(r.data);
      file.size = String(Buffer.byteLength(r.data));
      if (this.responseVersion) file.value = this.responseVersion;
      if (this.loseWriteResponse) throw failure(503);
      return { id };
    }
    return structuredClone(r.query?.alt === 'media' ? file.value : file);
  }
}

async function fixture(overrides = {}) {
  const drive = new FakeDrive();
  const provider = new GoogleDriveStorageProvider(config(overrides), drive);
  await provider.initialize();
  return { drive, provider, root: [...drive.files.keys()][0] };
}
async function create(provider, key = 'project') {
  const content = { title: 'Test', tasks: [] };
  const ticket = await provider.prepareCreate(key, 'operation-0001', content);
  return { ticket, content, result: await provider.create(ticket, content) };
}

test('config is fail-closed; disabled plugin needs no secrets; serialization hides credentials', () => {
  assert.deepEqual(resolvePluginsFromSettings({ plugins: [{ name: 'googleDriveStorage', enabled: false }] }), []);
  assert.throws(() => resolveDriveConfig({ providerId: '../bad', workspaceId: 'site' }));
  Object.assign(process.env, { TEST_CLIENT: 'private-client', TEST_SECRET: 'private-secret',
    TEST_REFRESH: 'private-refresh', TEST_TICKET: Buffer.alloc(32, 1).toString('base64url') });
  const options = { providerId: 'drive', workspaceId: 'site-a', ticketSecretEnv: 'TEST_TICKET',
    auth: { type: 'oauth', clientIdEnv: 'TEST_CLIENT', clientSecretEnv: 'TEST_SECRET', refreshTokenEnv: 'TEST_REFRESH' } };
  const [plugin] = resolvePluginsFromSettings({ plugins: [{ name: 'googleDriveStorage', options }] });
  assert.equal(plugin.storageProviders[0].id, 'drive');
  assert.equal(plugin.clientAssets, undefined);
  assert.equal(plugin.setupServer, undefined);
  assert.ok(!JSON.stringify(plugin).includes('private-'));
  for (const patch of [{ workspaceId: '' }, { rootFolderId: '../x' }, { maxDocumentBytes: 0 },
    { backupKeep: 0 }, { backupKeep: 101 }, { backupKeep: 1.5 }, { auth: { type: 'key' } }]) {
    assert.throws(() => resolveDriveConfig({ ...options, ...patch }));
  }
});

test('registry is per application, duplicate IDs fail, protected hook receives storage; FileService still reads Git files', async t => {
  const { provider } = await fixture();
  assert.throws(() => new StorageRegistry([provider, provider]));
  assert.throws(() => new StorageRegistry().get('drive'), code('not_found'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-storage-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'note.md'), '# Original');
  let registry;
  const kb = new KnowledgeBase({ contentRootPath: directory, plugins: [
    { id: 'storage', storageProviders: [provider] },
    { id: 'consumer', setupServer: (_app, context) => { registry = context.storage; } },
  ] });
  kb.setupMiddleware(express());
  assert.equal(registry.get('drive'), provider);
  assert.equal(kb.storage.get('drive'), provider);
  const other = new KnowledgeBase({ contentRootPath: directory });
  assert.deepEqual(other.storage.ids(), []);
  assert.equal(fs.readFileSync(path.join(directory, 'note.md'), 'utf8'), '# Original');
  const { FileService } = require('../lib');
  assert.equal(await new FileService(directory).readFile('note.md'), '# Original');
});

test('root creation/discovery and two workspace isolation; missing configured root never creates replacement', async () => {
  const { provider, drive, root } = await fixture();
  await create(provider);
  const restarted = new GoogleDriveStorageProvider(config(), drive);
  assert.equal((await restarted.read('project')).content.title, 'Test');
  assert.equal([...drive.files.values()].filter(f => f.mimeType === folderMime).length, 1);
  const other = new GoogleDriveStorageProvider(config({ workspaceId: 'site-b' }), drive);
  await other.initialize();
  assert.deepEqual((await other.list()).items, []);
  await assert.rejects(other.read('project'), code('not_found'));
  const wrong = new GoogleDriveStorageProvider(config({ workspaceId: 'site-b', rootFolderId: root }), drive);
  await assert.rejects(wrong.initialize(), code('access_denied'));
  const before = drive.calls.filter(c => c.method === 'POST').length;
  await assert.rejects(new GoogleDriveStorageProvider(config({ rootFolderId: 'missing' }), drive).initialize(), code('not_found'));
  assert.equal(drive.calls.filter(c => c.method === 'POST').length, before);
});

test('encrypted ticket survives new provider, rejects tampering, payload changes, other workspace and expiry', async () => {
  const { provider, drive } = await fixture();
  const payload = { title: 'Test' };
  const ticket = await provider.prepareCreate('project', 'operation-0001', payload);
  assert.ok(!Buffer.from(ticket, 'base64url').includes(Buffer.from('file')));
  const restarted = new GoogleDriveStorageProvider(config(), drive);
  await assert.rejects(restarted.create(ticket, { title: 'changed' }), code('invalid_ticket'));
  const altered = ticket.slice(0, 20) + (ticket[20] === 'A' ? 'B' : 'A') + ticket.slice(21);
  await assert.rejects(restarted.create(altered, payload), code('invalid_ticket'));
  const other = new GoogleDriveStorageProvider(config({ workspaceId: 'other' }), drive);
  await assert.rejects(other.create(ticket, payload), code('invalid_ticket'));
  const now = Date.now;
  try {
    Date.now = () => now() + 15 * 86400_000;
    await assert.rejects(restarted.create(ticket, payload), code('invalid_ticket'));
  } finally { Date.now = now; }
  assert.deepEqual((await restarted.create(ticket, payload)).content, payload);
});

test('create retry after commit/timeout confirms exact content; updated document is never replayed by old ticket', async () => {
  const { provider, drive } = await fixture();
  drive.loseWriteResponse = true;
  const { ticket, content } = await create(provider);
  const before = drive.calls.filter(c => c.method === 'POST').length;
  await provider.create(ticket, content);
  assert.equal(drive.calls.filter(c => c.method === 'POST').length, before);
  await provider.update('project', 'operation-0002', { title: 'new' });
  await assert.rejects(provider.create(ticket, content), code('unknown_result'));
  assert.equal((await provider.read('project')).content.title, 'new');
});

test('last write wins; list pagination and logical archive/restore', async () => {
  const { provider, drive } = await fixture();
  await create(provider, 'one');
  await create(provider, 'two');
  await provider.update('one', 'operation-0002', { title: 'A' });
  assert.equal((await provider.update('one', 'operation-0003', { title: 'B' })).content.title, 'B');
  drive.pageSize = 1;
  const first = await provider.list();
  assert.equal(first.items.length, 1);
  assert.ok(first.cursor);
  assert.equal((await provider.list({ cursor: first.cursor })).items.length, 1);
  await assert.rejects(provider.list({ cursor: first.cursor, archived: true }), code('invalid_ticket'));
  await provider.archive('one', 'operation-0004');
  await assert.rejects(provider.update('one', 'operation-0005', {}), code('conflict'));
  assert.equal((await provider.read('one')).archived, true);
  await provider.restore('one', 'operation-0006');
  assert.equal((await provider.read('one')).archived, false);
});

test('foreign parent, shortcut, shared-drive, trashed or unmarked file is rejected before media/write', async () => {
  for (const patch of [
    { parents: ['other'] }, { mimeType: 'application/vnd.google-apps.shortcut' },
    { driveId: 'shared' }, { trashed: true }, { appProperties: { kbKey: 'project' } },
  ]) {
    const { provider, drive } = await fixture();
    await create(provider);
    const file = [...drive.files.values()].find(f => f.value);
    Object.assign(file, patch);
    const writes = drive.calls.filter(c => c.method === 'PATCH').length;
    await assert.rejects(provider.update('project', 'operation-0002', {}));
    assert.equal(drive.calls.filter(c => c.method === 'PATCH').length, writes);
  }
});

test('duplicate keys/roots, malformed schemas, large data and path input fail closed', async () => {
  const { provider, drive, root } = await fixture();
  await create(provider);
  const file = [...drive.files.values()].find(f => f.value);
  drive.files.set('duplicate', { ...file, id: 'duplicate' });
  await assert.rejects(provider.read('project'), code('conflict'));
  drive.files.delete('duplicate');
  file.value.storageVersion = 2;
  await assert.rejects(provider.update('project', 'operation-0002', {}), code('unsupported_version'));
  await assert.rejects(provider.prepareCreate('../escape', 'operation-0002', {}), code('invalid_input'));
  await assert.rejects(provider.prepareCreate('large', 'operation-0002', 'x'.repeat(4096)), code('too_large'));
  await assert.rejects(provider.prepareCreate('nan', 'operation-0002', NaN), code('invalid_input'));
  drive.files.set('rootduplicate', { ...drive.files.get(root), id: 'rootduplicate' });
  await assert.rejects(new GoogleDriveStorageProvider(config(), drive).initialize(), code('conflict'));
});

test('upstream errors map to stable codes without secret-bearing SDK objects', async () => {
  const cases = [
    [{ response: { status: 400, data: { error: 'invalid_grant' } } }, 'reconnect_required'],
    [{ response: { status: 403, data: { error: { errors: [{ reason: 'storageQuotaExceeded' }] } } } }, 'quota_exceeded'],
    [failure(429), 'rate_limited'], [failure(403), 'access_denied'], [failure(503), 'unavailable'],
  ];
  for (const [error, expected] of cases) {
    error.config = { headers: { Authorization: 'private-secret' } };
    const safe = mapDriveError(error);
    assert.equal(safe.code, expected);
    assert.ok(!JSON.stringify(safe).includes('private-secret'));
  }
  const { provider, drive } = await fixture();
  await create(provider);
  drive.failWrite = cases[1][0];
  await assert.rejects(provider.update('project', 'operation-0002', {}), code('quota_exceeded'));
  assert.equal((await provider.read('project')).content.title, 'Test');
});

test('real transport bounds streamed bodies and decodes streamed quota errors without retrying mutations', async t => {
  const { Readable } = require('node:stream');
  const { OAuth2Client } = require('google-auth-library');
  const { GoogleDriveTransport } = require('../lib/plugins/google-drive-storage/transport');
  let calls = 0;
  const mock = t.mock.method(OAuth2Client.prototype, 'request', async () => {
    calls++;
    throw { response: { status: 403, data: Readable.from([JSON.stringify({
      error: { errors: [{ reason: 'storageQuotaExceeded' }] },
    })]) }, config: { headers: { Authorization: 'private-secret' } } };
  });
  const transport = new GoogleDriveTransport(config());
  await assert.rejects(transport.request({ method: 'PATCH', path: 'files/safe' }), code('quota_exceeded'));
  assert.equal(calls, 1);
  mock.mock.mockImplementation(async () => ({ data: Readable.from(['x'.repeat(100_000)]) }));
  await assert.rejects(transport.request({ method: 'GET', path: 'files/safe' }), code('too_large'));
  mock.mock.mockImplementation(async () => ({ data: Readable.from(['not JSON']) }));
  await assert.rejects(transport.request({ method: 'GET', path: 'files/safe' }), code('invalid_document'));
});

test('verified backup precedes write; retention keeps latest two and hides backups from normal list', async () => {
  const { provider, drive } = await fixture({ backupKeep: 2 });
  await create(provider);
  for (let i = 2; i <= 4; i++) await provider.update('project', `operation-000${i}`, { title: `v${i}` });
  const copies = [...drive.files.values()].filter(f => f.appProperties?.kbBackupKey);
  assert.equal(copies.length, 3);
  assert.equal(copies.filter(f => f.trashed).length, 1);
  assert.equal(copies.filter(f => !f.trashed).length, 2);
  assert.deepEqual((await provider.listBackups('project')).map(b => b.operationId), ['operation-0003', 'operation-0002']);
  assert.equal((await provider.list()).items.length, 1);
  const firstMutation = drive.calls.findIndex(c => c.method === 'PATCH' && c.upload);
  const backupId = copies[0].id;
  assert.ok(drive.calls.slice(0, firstMutation).some(c => c.path === `files/${backupId}` && c.query?.alt === 'media'));
  assert.ok(drive.calls.every(c => c.method !== 'DELETE'));
  assert.ok(drive.calls.filter(c => c.method === 'PATCH' && !c.upload).every(c => c.data.trashed === true));
});

test('backup quota or corrupt backup prevents changing current document', async () => {
  for (const corrupt of [false, true]) {
    const { provider, drive } = await fixture();
    const { result } = await create(provider);
    const file = [...drive.files.values()].find(f => f.appProperties?.kbKey === 'project');
    drive.intercept = async r => {
      if (r.method === 'POST' && r.upload && !corrupt) throw { response: { status: 403, data: {
        error: { errors: [{ reason: 'storageQuotaExceeded' }] },
      } } };
      if (corrupt && r.query?.alt === 'media') {
        const target = drive.files.get(r.path.split('/')[1]);
        if (target?.appProperties?.kbBackupKey) target.value.content = { changed: true };
      }
    };
    await assert.rejects(provider.update('project', 'operation-0002', { title: 'new' }),
      code(corrupt ? 'invalid_document' : 'quota_exceeded'));
    assert.equal(file.value.operationId, result.operationId);
    assert.equal(drive.calls.filter(c => c.method === 'PATCH' && c.upload).length, 0);
  }
});

test('cleanup failure returns confirmed Save with warning and can be repaired separately', async () => {
  const { provider, drive } = await fixture({ backupKeep: 1 });
  await create(provider);
  await provider.update('project', 'operation-0002', { title: 'v2' });
  drive.intercept = async r => {
    if (r.method === 'PATCH' && !r.upload) throw failure(503);
  };
  const saved = await provider.update('project', 'operation-0003', { title: 'v3' });
  assert.deepEqual(saved.warnings, ['backup_cleanup_pending']);
  assert.equal((await provider.read('project')).content.title, 'v3');
  drive.intercept = undefined;
  await provider.pruneBackups('project');
  assert.equal((await provider.listBackups('project')).length, 1);
});

test('explicit backup restore repairs corruption after restart; wrong key, tampering and future schema are rejected', async () => {
  const { provider, drive } = await fixture();
  await create(provider);
  await create(provider, 'other');
  await provider.update('project', 'operation-0002', { title: 'new' });
  const [backup] = await provider.listBackups('project');
  assert.deepEqual(Object.keys(backup).sort(), ['createdAt', 'operationId', 'revision', 'ticket']);
  await assert.rejects(provider.restoreBackup('other', backup.ticket, 'operation-restore'), code('invalid_ticket'));
  await assert.rejects(provider.restoreBackup('project', 'raw-file-id', 'operation-restore'), code('invalid_ticket'));
  const file = [...drive.files.values()].find(f => f.appProperties?.kbKey === 'project');
  file.value = { damaged: true };
  await assert.rejects(provider.read('project'), code('invalid_document'));
  const restarted = new GoogleDriveStorageProvider(config(), drive);
  const restored = await restarted.restoreBackup('project', backup.ticket, 'operation-restore');
  assert.equal(restored.content.title, 'Test');
  assert.equal(restored.operationId, 'operation-restore');
  assert.equal((await restarted.listBackups('project')).length, 1); // Damaged JSON was not backed up.
  file.value.storageVersion = 2;
  await assert.rejects(restarted.restoreBackup('project', backup.ticket, 'operation-future'), code('unsupported_version'));
});

test('mutated or moved backup is never restored or pruned', async () => {
  for (const mutation of ['content', 'parent']) {
    const { provider, drive } = await fixture({ backupKeep: 1 });
    await create(provider);
    await provider.update('project', 'operation-0002', { title: 'v2' });
    const [descriptor] = await provider.listBackups('project');
    const backup = [...drive.files.values()].find(f => f.appProperties?.kbBackupKey);
    if (mutation === 'content') backup.value.content = { tampered: true };
    else backup.parents = ['outside'];
    const writes = drive.calls.filter(c => c.method === 'PATCH').length;
    await assert.rejects(provider.restoreBackup('project', descriptor.ticket, 'operation-restore'));
    assert.equal(drive.calls.filter(c => c.method === 'PATCH').length, writes);
    if (mutation === 'content') {
      const saved = await provider.update('project', 'operation-0003', { title: 'v3' });
      assert.deepEqual(saved.warnings, ['backup_cleanup_pending']);
      assert.equal(backup.trashed, false);
    }
  }
});

test('reconcile is read-only after uncertain update; repeat current operation does not add backups', async () => {
  const { provider, drive } = await fixture();
  await create(provider);
  await provider.update('project', 'operation-0002', { title: 'v2' });
  const count = (await provider.listBackups('project')).length;
  await provider.update('project', 'operation-0002', { title: 'v2' });
  assert.equal((await provider.listBackups('project')).length, count);
  await assert.rejects(provider.update('project', 'operation-0002', { title: 'different' }), code('conflict'));
  drive.loseWriteResponse = true;
  await provider.update('project', 'operation-0003', { title: 'v3' });
  const restarted = new GoogleDriveStorageProvider(config(), drive);
  const writes = drive.calls.filter(c => c.method !== 'GET').length;
  assert.equal((await restarted.reconcile('project', 'operation-0003', { title: 'v3' })).content.title, 'v3');
  await assert.rejects(restarted.reconcile('project', 'operation-0002', { title: 'v2' }), code('unknown_result'));
  assert.equal(drive.calls.filter(c => c.method !== 'GET').length, writes);
  assert.equal((await restarted.read('project')).content.title, 'v3');
});

test('business validator runs against bound backup before any Drive mutation', async () => {
  const { provider, drive } = await fixture();
  await create(provider);
  await provider.update('project', 'operation-0002', { title: 'v2' });
  const [backup] = await provider.listBackups('project');
  const writes = drive.calls.filter(c => c.method !== 'GET').length;
  await assert.rejects(provider.restoreBackup('project', backup.ticket, 'operation-restore', async content => {
    assert.equal(content.title, 'Test');
    throw new Error('Rejected business schema');
  }), /Rejected business schema/);
  assert.equal(drive.calls.filter(c => c.method !== 'GET').length, writes);
  assert.equal((await provider.read('project')).content.title, 'v2');
});

test('Work Manager service composes with real Drive provider tickets, LWW and validated recovery', async () => {
  const { WorkManagerService } = require('../lib/plugins/work-manager/service');
  const { provider, drive } = await fixture({ maxDocumentBytes: 65536 });
  const service = new WorkManagerService(provider, async () => true);
  const project = { schemaVersion: 1, id: 'alpha', type: 'project', title: 'Original', notes: '', tasks: [] };
  const { ticket } = await service.prepare('operation-create', project);
  await service.create(ticket, project);
  await service.create(ticket, project);
  assert.equal((await service.list({})).items.length, 1);
  drive.loseWriteResponse = true;
  const updated = { ...project, title: 'Changed' };
  await service.update('alpha', 'operation-update', updated);
  assert.equal((await service.reconcile('alpha', 'operation-update', updated, false)).project.title, 'Changed');
  const { items: [backup] } = await service.backups('alpha');
  const file = [...drive.files.values()].find(f => f.appProperties?.kbKey === 'wm-alpha');
  file.value.content = { ...project, schemaVersion: 2 };
  await assert.rejects(service.restoreBackup('alpha', 'operation-restore', backup.ticket), code('unsupported_version'));
  file.value.content = { damaged: true };
  const restored = await service.restoreBackup('alpha', 'operation-restore', backup.ticket);
  assert.equal(restored.project.title, 'Original');
  const writes = drive.calls.filter(c => c.method !== 'GET').length;
  await assert.rejects(service.reconcile('alpha', 'operation-update', updated, false), code('unknown_result'));
  assert.equal(drive.calls.filter(c => c.method !== 'GET').length, writes);
});

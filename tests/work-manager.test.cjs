const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { KnowledgeBase, workManagerPlugin, passwordAuthPlugin, hashPassword, StorageError, validateProject, resolvePluginsFromSettings } = require('../lib');
const { resolveConfig } = require('../lib/plugins/password-auth/config');
const { createToken, csrfToken, verifyToken } = require('../lib/plugins/password-auth/token-service');
const project = (id = 'alpha') => ({ schemaVersion: 1, id, type: 'project', title: 'Alpha', notes: '', tasks: [] });
const task = (id, blockedBy = []) => ({ id, title: id, status: 'todo', priority: 'normal', dueDate: null, blockedBy, doneWhen: '', docPath: null, spentMinutes: 0 });
let config;
before(async () => {
  Object.assign(process.env, { AUTH_PASSWORD_HASH: await hashPassword('test-password-only'),
    AUTH_SIGNING_SECRET: Buffer.alloc(32, 8).toString('base64url'), AUTH_SESSION_VERSION: '1',
    AUTH_SITE_ID: 'wm-test', AUTH_ORIGIN: 'http://127.0.0.1:31992' });
  config = resolveConfig({ allowInsecureLocalhost: true });
});

// Contract fake: HTTP tests exercise real auth/router/service; Drive semantics have a separate suite.
class MemoryStorage {
  id = 'drive'; docs = new Map(); tickets = new Map(); snapshots = new Map(); writes = 0; fault; warning;
  async initialize() {}
  async read(key) { if (this.fault) throw new StorageError(this.fault); if (!this.docs.has(key)) throw new StorageError('not_found'); return structuredClone(this.docs.get(key)); }
  async list() { if (this.fault) throw new StorageError(this.fault); return { items: [...this.docs.values()].filter(d => !d.archived) }; }
  async prepareCreate(key, operationId, content) { if (this.docs.has(key)) throw new StorageError('conflict'); const ticket = 'opaque-' + this.tickets.size; this.tickets.set(ticket, { key, operationId, content }); return ticket; }
  async create(ticket, content) {
    const claim = this.tickets.get(ticket);
    if (!claim || JSON.stringify(content) !== JSON.stringify(claim.content)) throw new StorageError('invalid_ticket');
    if (this.docs.has(claim.key)) return this.reconcile(claim.key, claim.operationId, content, false);
    return this.save(claim.key, claim.operationId, content, false);
  }
  save(key, operationId, content, archived) { const d = { key, operationId, content: structuredClone(content), archived, revision: 'revision-' + ++this.writes, ...(this.warning ? { warnings: ['backup_cleanup_pending'] } : {}) }; this.docs.set(key, d); return structuredClone(d); }
  async update(key, op, content) { const current = await this.read(key); if (current.archived) throw new StorageError('conflict'); return this.save(key, op, content, false); }
  async archive(key, op) { return this.save(key, op, (await this.read(key)).content, true); }
  async restore(key, op) { return this.save(key, op, (await this.read(key)).content, false); }
  async listBackups(key) { return [{ ticket: key, createdAt: '2026-11-03T00:00:00Z', operationId: 'original-op', revision: 'backup-revision' }]; }
  async restoreBackup(key, ticket, op, validate) { const content = this.snapshots.get(ticket); if (!content) throw new StorageError('invalid_ticket'); await validate(content); return this.save(key, op, content, false); }
  async reconcile(key, op, content, archived) { const d = await this.read(key); if (d.operationId !== op || d.archived !== archived || JSON.stringify(d.content) !== JSON.stringify(content)) throw new StorageError('unknown_result'); return d; }
}
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-wm-'));
  fs.writeFileSync(path.join(root, 'note.md'), '# Unchanged');
  fs.writeFileSync(path.join(root, 'alpha.work-manager.md'), '---\nid: alpha\ntitle: Alpha\ndescription: \"\"\n---\n');
  const store = new MemoryStorage();
  const app = express();
  const kb = new KnowledgeBase({ contentRootPath: root, plugins: [passwordAuthPlugin({ allowInsecureLocalhost: true }),
    { id: 'storage', storageProviders: [store] }, workManagerPlugin({ storageProviderId: 'drive' })] });
  kb.setupMiddleware(app);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => { assert.equal(fs.readFileSync(path.join(root, 'note.md'), 'utf8'), '# Unchanged'); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const token = createToken(config);
  const csrf = csrfToken(config, verifyToken(config, token));
  const request = (method, endpoint, body, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/work-manager' + endpoint, method,
      headers: { Host: '127.0.0.1:31992', Origin: config.origin, Cookie: config.cookieName + '=' + token, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', ...headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject); if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body)); req.end();
  });
  const create = async (p = project()) => { const prepared = await request('POST', '/projects/prepare', { operationId: 'create-op-1', project: p }); assert.equal(prepared.status, 200); return request('POST', '/projects', { ticket: prepared.body.ticket, project: p }); };
  return { store, request, create, root };
}

test('optional plugin fails closed without authentication/provider; disabled config is inert', () => {
  assert.throws(() => new KnowledgeBase({ contentRootPath: '.', plugins: [workManagerPlugin({ storageProviderId: 'drive' })] }), /authentication/);
  assert.deepEqual(resolvePluginsFromSettings({ plugins: [{ name: 'workManager', enabled: false }] }), []);
  assert.throws(() => workManagerPlugin({ storageProviderId: '../drive' }));
  const kb = new KnowledgeBase({ contentRootPath: '.', plugins: [passwordAuthPlugin({ allowInsecureLocalhost: true }), workManagerPlugin({ storageProviderId: 'missing' })] });
  assert.throws(() => kb.setupMiddleware(express()), e => e.code === 'not_found');
});

test('schema rejects unknown fields, dates, IDs, enums, cycles, paths and nonfinite time', () => {
  const base = { ...project(), tasks: [task('a'), task('b', ['a'])] };
  assert.deepEqual(validateProject(base), base);
  const mutations = [p => p.fileId = 'raw', p => p.schemaVersion = 2, p => p.type = 'inbox',
    p => p.tasks[0].blockedBy = ['b'], p => p.tasks[0].blockedBy = ['missing'], p => p.tasks[0].blockedBy = ['b', 'b'],
    p => p.tasks[1].id = 'a', p => p.tasks[0].dueDate = '2025-02-29', p => p.tasks[0].status = 'ready',
    p => p.tasks[0].spentMinutes = Infinity, p => p.tasks[0].spentMinutes = -1, p => p.tasks[0].spentMinutes = 1.1,
    p => p.tasks[0].docPath = '../secret.md', p => p.tasks[0].docPath = 'https://site/note.md',
    p => p.tasks[0].docPath = '%2e%2e/note.md', p => p.tasks[0].docPath = 'x\\note.md',
    p => p.tasks = Array.from({ length: 501 }, (_, i) => task('t' + i))];
  for (const mutate of mutations) { const p = structuredClone(base); mutate(p); assert.throws(() => validateProject(p)); }
  const leap = structuredClone(base); leap.tasks[0].dueDate = '2024-02-29'; validateProject(leap);
  validateProject({ ...project('inbox'), type: 'inbox' });
});

test('HTTP auth/CSRF, malformed requests, raw fields, payload limits and missing project', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('GET', '/projects', undefined, { Cookie: '' })).status, 401);
  assert.equal((await request('POST', '/projects/prepare', {}, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await request('POST', '/projects/prepare', {}, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await request('POST', '/projects/prepare', '{')).status, 400);
  assert.equal((await request('POST', '/projects/prepare', { operationId: 'create-op', project: project(), fileId: 'raw' })).status, 400);
  assert.equal((await request('POST', '/projects/prepare', { operationId: 'create-op', project: { ...project(), MIME: 'text/html' } })).status, 422);
  assert.equal((await request('POST', '/projects/prepare', 'x'.repeat(310000))).status, 413);
  assert.equal((await request('GET', '/projects?fileId=raw')).status, 400);
  assert.equal((await request('GET', '/projects?archived[]=true')).status, 400);
  assert.equal((await request('GET', '/projects/missing')).status, 404);
});

test('HTTP create ticket retry, read/list, stale full replacement, archive/unarchive and warnings', async t => {
  const { request, store } = await fixture(t);
  const p = project();
  const prepared = await request('POST', '/projects/prepare', { operationId: 'create-op', project: p });
  const body = { ticket: prepared.body.ticket, project: p };
  assert.equal((await request('POST', '/projects', body)).status, 201);
  assert.equal((await request('POST', '/projects', body)).status, 201);
  assert.equal(store.writes, 1);
  assert.equal((await request('POST', '/projects/prepare', { operationId: 'create-2', project: p })).status, 409);
  const list = await request('GET', '/projects'); assert.equal(list.body.items[0].id, 'alpha');
  assert.match(list.headers['cache-control'], /no-store/);
  store.warning = true;
  const changed = { ...p, tasks: [{ ...task('a'), title: '<script>literal text</script>' }] };
  let response = await request('PUT', '/projects/alpha', { operationId: 'update-1', project: changed });
  assert.equal(response.status, 200); assert.deepEqual(response.body.warnings, ['backup_cleanup_pending']);
  response = await request('PUT', '/projects/alpha', { operationId: 'update-2', project: p });
  assert.equal(response.body.project.title, 'Alpha');
  assert.equal((await request('POST', '/projects/alpha/archive', { operationId: 'archive-1' })).body.archived, true);
  assert.equal((await request('PUT', '/projects/alpha', { operationId: 'update-3', project: p })).status, 409);
  assert.equal((await request('POST', '/projects/alpha/unarchive', { operationId: 'restore-1' })).body.archived, false);
});

test('future/corrupt project blocks update; invalid backup rejected before mutation; valid recovery allowed', async t => {
  const { request, create, store } = await fixture(t);
  await create();
  store.docs.get('wm-alpha').content.schemaVersion = 2;
  store.snapshots.set('good', project());
  assert.equal((await request('GET', '/projects/alpha')).status, 422);
  assert.equal((await request('PUT', '/projects/alpha', { operationId: 'update-1', project: project() })).status, 422);
  assert.equal((await request('POST', '/projects/alpha/restore-backup', { operationId: 'restore-1', ticket: 'good' })).status, 422);
  assert.equal(store.writes, 1);
  store.docs.get('wm-alpha').content = { broken: true };
  store.snapshots.set('bad', { ...project(), schemaVersion: 9 });
  assert.equal((await request('POST', '/projects/alpha/restore-backup', { operationId: 'restore-2', ticket: 'bad' })).status, 422);
  assert.equal(store.writes, 1);
  assert.equal((await request('POST', '/projects/alpha/restore-backup', { operationId: 'restore-3', ticket: 'good' })).status, 200);
  assert.equal(store.writes, 2);
});

test('notes must exist inside content; deleting dependency with surviving successor is blocked', async t => {
  const { request, create, store } = await fixture(t);
  const p = { ...project(), tasks: [{ ...task('a'), docPath: 'note.md' }, task('b', ['a'])] };
  assert.equal((await create(p)).status, 201);
  const missing = structuredClone(p); missing.tasks[0].docPath = 'missing.md';
  assert.equal((await request('PUT', '/projects/alpha', { operationId: 'update-1', project: missing })).status, 422);
  assert.equal((await request('PUT', '/projects/alpha', { operationId: 'update-2', project: { ...p, tasks: [task('b')] } })).status, 422);
  assert.equal((await request('PUT', '/projects/alpha', { operationId: 'update-3', project: { ...p, id: 'different' } })).status, 422);
  assert.equal(store.writes, 1);
});

test('readonly reconcile confirms exact state; old uncertainty cannot replay writes; storage errors are safe', async t => {
  const { request, create, store } = await fixture(t);
  await create();
  assert.equal((await request('POST', '/projects/alpha/reconcile', { operationId: 'create-op-1', project: project(), archived: false })).status, 200);
  assert.equal((await request('POST', '/projects/alpha/reconcile', { operationId: 'older-op', project: project(), archived: false })).body.error.code, 'unknown_result');
  assert.equal(store.writes, 1);
  for (const [fault, status] of [['rate_limited', 429], ['quota_exceeded', 503], ['reconnect_required', 503], ['unavailable', 503]]) {
    store.fault = fault; const response = await request('GET', '/projects'); assert.equal(response.status, status);
    assert.deepEqual(Object.keys(response.body.error), ['code']);
  }
});

test('HTTP work limit bounds concurrent storage calls and releases slots after failures', async t => {
  const { request, store } = await fixture(t);
  const releases = [];
  store.list = () => new Promise(resolve => releases.push(resolve));
  const pending = Array.from({ length: 4 }, () => request('GET', '/projects'));
  for (let i = 0; i < 100 && releases.length < 4; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(releases.length, 4);
  assert.equal((await request('GET', '/projects')).status, 429);
  for (const release of releases) release({ items: [] });
  assert.ok((await Promise.all(pending)).every(response => response.status === 200));
  store.list = async () => { throw new Error('SECRET SDK RESPONSE'); };
  const failed = await request('GET', '/projects');
  assert.equal(failed.status, 503); assert.deepEqual(failed.body, { error: { code: 'storage_unavailable' } });
  store.list = async () => ({ items: [] });
  assert.equal((await request('GET', '/projects')).status, 200);
});

test('YAML work-manager document uses framework layout; ordinary markdown stays ordinary', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-wm-page-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'projects.work-manager.md'), '---\nid: alpha\ntitle: Alpha\ndescription: \"\"\n---\n');
  fs.writeFileSync(path.join(directory, 'other.md'), '# Ordinary');
  const kb = new KnowledgeBase({ contentRootPath: directory, baseUrl: '/base', plugins: [passwordAuthPlugin({ allowInsecureLocalhost: true }),
    workManagerPlugin({ storageProviderId: 'drive', draftNamespace: 'test-workspace' })] });
  const page = await kb.renderContent('projects.work-manager.md');
  assert.match(page.htmlContent, /data-work-manager/);
  assert.match(page.htmlContent, /data-draft-namespace="test-workspace"/);
  assert.doesNotMatch((await kb.renderContent('other.md')).htmlContent, /data-work-manager/);
  assert.throws(() => workManagerPlugin({ storageProviderId: 'drive', pagePath: '../bad.work-manager.md' }));
  assert.throws(() => workManagerPlugin({ storageProviderId: 'drive', pagePath: 'ordinary.md' }));
  const { TemplateContextBuilder } = require('../lib/services/TemplateContextBuilder');
  const context = new TemplateContextBuilder({ contentRootPath: directory, baseUrl: '/base', customJsFiles: ['custom.js'] }).build(page);
  assert.deepEqual(context.assets.scripts, [{ src: '/base/assets/kb-app.js', module: true }, { src: '/base/custom.js', module: false }]);
  assert.equal(context.navigation.find(n => n.path === 'projects.work-manager.md').href, '/base/projects.work-manager.md');
});

test('persisted draft retains pending ticket and newer edits survive confirmation', () => {
  const { parseDraft, confirmDraft } = require('../lib/plugins/work-manager/draft');
  const snapshot = project();
  const draft = { version: 1, project: { ...snapshot, title: 'Newer edit' }, created: false, dirty: true,
    pending: { kind: 'create', operationId: 'operation-create', project: snapshot, ticket: 'opaque-ticket' } };
  const restored = parseDraft(JSON.stringify(draft));
  assert.equal(restored.pending.ticket, 'opaque-ticket');
  confirmDraft(restored, snapshot, 'revision-1');
  assert.equal(restored.created, true); assert.equal(restored.dirty, true); assert.equal(restored.pending, undefined);
  confirmDraft(restored, restored.project, 'revision-2'); assert.equal(restored.dirty, false);
  assert.equal(parseDraft(JSON.stringify({ ...draft, project: { ...snapshot, title: '' } })).project.title, '');
  assert.throws(() => parseDraft(JSON.stringify({ ...draft, version: 2 })));
});

test('confirmation ignores canonical object key order but preserves newer task edits', () => {
  const { confirmDraft } = require('../lib/plugins/work-manager/draft');
  const original = { ...project(), tasks: [task('a')] };
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ?
    Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const draft = { version: 1, project: original, created: true, dirty: true };
  confirmDraft(draft, canonical(original), 'r1'); assert.equal(draft.dirty, false);
  const old = canonical(original);
  draft.project.tasks[0].title = 'New edit';
  confirmDraft(draft, old, 'r2'); assert.equal(draft.dirty, true);
});

test('incomplete note paths and long text remain recoverable drafts but cannot pass Save validation', () => {
  const { parseDraft } = require('../lib/plugins/work-manager/draft');
  const p = { ...project(), title: 'x'.repeat(201), tasks: [{ ...task('a'), docPath: 'unfinished', dueDate: '2026-' }] };
  const restored = parseDraft(JSON.stringify({ version: 1, created: true, dirty: true, project: p }));
  assert.deepEqual(restored.project, p);
  assert.throws(() => validateProject(restored.project));
});

test('YAML metadata supports quoted/block scalars, rejects aliases, duplicate keys and duplicate project IDs', async t => {
  const { parseProjectMetadata, ProjectCatalog } = require('../lib/plugins/work-manager/content-metadata');
  const raw = '---\nid: sample\ntitle: "Quoted: title"\ndescription: |\n  First line\n  Second line\n---\n# Body';
  assert.equal(parseProjectMetadata(raw).metadata.description, 'First line\nSecond line\n');
  for (const header of ['id: a\nid: b\ntitle: X\ndescription: Y', 'id: a\ntitle: &x hi\ndescription: *x',
    'id: a\ntitle: !custom hi\ndescription: Y', 'id: ../a\ntitle: X\ndescription: Y']) {
    assert.throws(() => parseProjectMetadata('---\n' + header + '\n---\n'));
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-wm-yaml-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'one.work-manager.md'), raw);
  const catalog = new ProjectCatalog(directory);
  assert.equal((await catalog.get('sample')).title, 'Quoted: title');
  fs.renameSync(path.join(directory, 'one.work-manager.md'), path.join(directory, 'renamed.work-manager.md'));
  assert.equal((await catalog.get('sample')).id, 'sample');
  fs.writeFileSync(path.join(directory, 'duplicate.work-manager.md'), raw);
  await assert.rejects(catalog.get('sample'), e => e.code === 'conflict');
});

test('HTTP initializes only a YAML-declared project and rejects client metadata changes', async t => {
  const { request, create } = await fixture(t);
  assert.equal((await request('POST', '/projects/prepare', { operationId: 'create-new', project: project('unknown') })).status, 404);
  assert.equal((await create()).status, 201);
  assert.equal((await request('PUT', '/projects/alpha', { operationId: 'change-title', project: { ...project(), title: 'Client override' } })).status, 422);
  const archivedTask = { ...project(), tasks: [{ ...task('a'), archived: true }] };
  assert.equal((await request('PUT', '/projects/alpha', { operationId: 'archive-task', project: archivedTask })).status, 200);
  assert.equal((await request('GET', '/projects/alpha')).body.project.tasks[0].archived, true);
});
const { taskReadiness, projectProgress, todayTasks, canAddDependency } = require('../lib/plugins/work-manager/planning');

test('planning recomputes readiness after completion/reopening and keeps archived blockers', () => {
  const tasks = [task('a'), task('b', ['a']), task('c', ['b'])];
  assert.equal(taskReadiness(tasks[1], tasks), 'blocked');
  assert.equal(canAddDependency(tasks, 'a', 'c'), false);
  assert.equal(canAddDependency(tasks, 'a', 'a'), false);
  assert.equal(canAddDependency(tasks, 'a', 'missing'), false);
  assert.equal(canAddDependency(tasks, 'c', 'a'), true);
  tasks[0].archived = true;
  assert.equal(taskReadiness(tasks[1], tasks), 'blocked');
  tasks[0].status = 'done';
  assert.equal(taskReadiness(tasks[1], tasks), 'ready');
  tasks[0].status = 'todo';
  assert.equal(taskReadiness(tasks[1], tasks), 'blocked');
});

test('progress excludes archive and empty work is not 100 percent', () => {
  assert.deepEqual(projectProgress([]), { done: 0, total: 0, percent: null });
  const tasks = [task('a'), { ...task('b'), status: 'done' }, { ...task('c'), status: 'done', archived: true }];
  assert.deepEqual(projectProgress(tasks), { done: 1, total: 2, percent: 50 });
  tasks[0].status = 'done';
  assert.equal(projectProgress(tasks).percent, 100);
});

test('Today contains only available active work with stable priority/date/id ordering', () => {
  const tasks = [task('z'), { ...task('b'), dueDate: '2026-11-05' },
    { ...task('a'), dueDate: '2026-11-05' }, { ...task('high'), priority: 'high' },
    task('blocked', ['z']), { ...task('done'), status: 'done' }, { ...task('archive'), archived: true }];
  const before = JSON.stringify(tasks);
  assert.deepEqual(todayTasks(tasks).map(t => t.id), ['high', 'a', 'b', 'z']);
  assert.equal(JSON.stringify(tasks), before);
});

test('HTTP dependency changes retain IDs; cycle and unknown predecessor never reach storage', async t => {
  const { create, request, store } = await fixture(t);
  const p = project(); p.tasks = [task('a'), task('b', ['a'])];
  await create(p);
  const writes = store.writes;
  p.tasks[0].blockedBy = ['b'];
  assert.equal((await request('PUT', '/projects/alpha', { operationId: 'cycle-op-1', project: p })).status, 422);
  p.tasks[0].blockedBy = ['missing'];
  assert.equal((await request('PUT', '/projects/alpha', { operationId: 'unknown-op-1', project: p })).status, 422);
  assert.equal(store.writes, writes);
  p.tasks[0].blockedBy = []; p.tasks[0].status = 'done';
  const saved = await request('PUT', '/projects/alpha', { operationId: 'complete-op-1', project: p });
  assert.equal(saved.status, 200);
  assert.equal(taskReadiness(saved.body.project.tasks[1], saved.body.project.tasks), 'ready');
  p.tasks[0].status = 'todo';
  const reopened = await request('PUT', '/projects/alpha', { operationId: 'reopen-op-1', project: p });
  assert.equal(taskReadiness(reopened.body.project.tasks[1], reopened.body.project.tasks), 'blocked');
  assert.deepEqual(reopened.body.project.tasks.map(t => t.id), ['a', 'b']);
});
test('HTTP permits every task status transition regardless of predecessor status', async t => {
  const { create, request } = await fixture(t);
  const p = project();
  p.tasks = [task('a'), task('b', ['a'])];
  await create(p);
  const statuses = ['todo', 'in_progress', 'done'];
  let operation = 0;
  for (const predecessor of statuses) {
    p.tasks[0].status = predecessor;
    for (const from of statuses) {
      for (const to of statuses) {
        // Persist both ends of each transition, including reopening completed tasks.
        for (const status of [from, to]) {
          p.tasks[1].status = status;
          const saved = await request('PUT', '/projects/alpha', {
            operationId: `status-${++operation}`, project: p,
          });
          assert.equal(saved.status, 200);
          assert.equal(saved.body.project.tasks[1].status, status);
          assert.deepEqual(saved.body.project.tasks[1].blockedBy, ['a']);
          assert.equal(saved.body.project.tasks[0].status, predecessor);
        }
      }
    }
  }
});

const { parseTimer, suggestedMinutes, applyTimer } = require('../lib/plugins/work-manager/timer');

test('timer receipt makes repeated Stop/recovery idempotent and survives draft serialization', () => {
  const draft = { version: 1, created: true, dirty: false, project: project() };
  draft.project.tasks = [task('a')];
  const timer = { version: 1, id: 'interval-1', projectId: 'alpha', taskId: 'a', baseMinutes: 0, startedAt: 1000, stoppedAt: 62000 };
  assert.equal(suggestedMinutes(timer), 2);
  applyTimer(draft, timer, 2);
  const restored = require('../lib/plugins/work-manager/draft').parseDraft(JSON.stringify(draft));
  applyTimer(restored, timer, 2);
  assert.equal(restored.project.tasks[0].spentMinutes, 2);
  assert.equal(restored.dirty, true);
  assert.throws(() => applyTimer(restored, { ...timer, id: 'interval-2' }, -1));
  assert.throws(() => applyTimer(restored, { ...timer, id: 'interval-2' }, 1.5));
  assert.throws(() => applyTimer(restored, { ...timer, projectId: 'other' }, 1));
  assert.throws(() => applyTimer(restored, { ...timer, stoppedAt: undefined }, 1));
});

test('timer wall-clock suggestion is bounded and never applies sleep/clock jumps automatically', () => {
  const timer = { version: 1, id: 'interval-1', projectId: 'alpha', taskId: 'a', baseMinutes: 0, startedAt: 60000, stoppedAt: 0 };
  assert.equal(suggestedMinutes(parseTimer(JSON.stringify(timer))), 0);
  timer.stoppedAt = 3660000;
  assert.equal(suggestedMinutes(timer), 60);
  const draft = { version: 1, created: true, dirty: false, project: project() };
  draft.project.tasks = [task('a')];
  applyTimer(draft, timer, 5); // User reviews and excludes sleep rather than accepting elapsed wall time.
  assert.equal(draft.project.tasks[0].spentMinutes, 5);
  assert.throws(() => parseTimer(JSON.stringify({ ...timer, startedAt: 'invalid' })));
  assert.throws(() => parseTimer(JSON.stringify({ ...timer, stoppedAt: -1 })));
});
test('timer minutes survive unknown Save and reconcile without a second increment', () => {
  const { confirmDraft, parseDraft } = require('../lib/plugins/work-manager/draft');
  const draft = { version: 1, created: true, dirty: false, project: project() };
  draft.project.tasks = [task('a')];
  const timer = { version: 1, id: 'interval-retry', projectId: 'alpha', taskId: 'a', baseMinutes: 0, startedAt: 0, stoppedAt: 60000 };
  applyTimer(draft, timer, 1);
  draft.pending = { kind: 'update', operationId: 'timer-save-op', project: structuredClone(draft.project) };
  const recovered = parseDraft(JSON.stringify(draft)); // 401/outage leaves the persisted draft unchanged.
  applyTimer(recovered, timer, 1);
  confirmDraft(recovered, recovered.pending.project, 'confirmed');
  assert.equal(recovered.project.tasks[0].spentMinutes, 1);
  assert.equal(recovered.dirty, false);
  assert.equal(recovered.pending, undefined);
});

test('old timer cannot increment a Drive-restored total when its local receipt was lost', () => {
  const draft = { version: 1, created: true, dirty: false, project: project() };
  draft.project.tasks = [{ ...task('a'), spentMinutes: 2 }];
  const timer = { version: 1, id: 'old-interval', projectId: 'alpha', taskId: 'a', baseMinutes: 0, startedAt: 0, stoppedAt: 60000 };
  assert.throws(() => applyTimer(draft, timer, 1));
  assert.equal(draft.project.tasks[0].spentMinutes, 2);
});

test('client scripts are emitted only for enabled plugins on matching pages', () => {
  const { TemplateContextBuilder } = require('../lib/services/TemplateContextBuilder');
  const content = { title: 'Test', htmlContent: '<div data-work-manager></div>', navigation: [], breadcrumbs: [], metadata: {} };
  const declaration = { id: 'test', clientEntry: { file: 'kb-plugin-work-manager.js', marker: 'data-work-manager', cssFile: 'kb-icons-work-manager.css' } };
  const build = plugins => new TemplateContextBuilder({ contentRootPath: '.', plugins, baseUrl: '/nested' });
  const disabled = build([]).build(content);
  assert.equal(disabled.assets.scripts.some(script => script.src.includes('plugin-')), false);
  assert.equal(disabled.assets.css.some(file => file.includes('kb-icons-')), false);
  const enabled = build([declaration]).build(content);
  assert.ok(enabled.assets.scripts.some(script => script.src === '/nested/assets/kb-plugin-work-manager.js' && script.module));
  assert.ok(enabled.assets.css.includes('/nested/assets/kb-icons-work-manager.css'));
  assert.equal(build([declaration]).build({ ...content, htmlContent: '<p>ordinary page</p>' }).assets.css.some(file => file.includes('kb-icons-')), false);
  assert.equal(build([declaration]).build({ ...content, htmlContent: '<p>ordinary page</p>' }).assets.scripts.some(script => script.src.includes('plugin-')), false);
  const assets = path.join(__dirname, '../templates/default/assets');
  const core = fs.readFileSync(path.join(assets, 'kb-app.js'), 'utf8');
  assert.doesNotMatch(core, /data-work-manager|react-dom|data-kb-tech-memory/);
  assert.ok(fs.existsSync(path.join(assets, 'kb-plugin-work-manager.js')));
  const coreCss = fs.readFileSync(path.join(assets, 'kb-app.css'), 'utf8');
  const pluginCss = fs.readFileSync(path.join(assets, 'kb-icons-work-manager.css'), 'utf8');
  assert.doesNotMatch(coreCss, /lucide--save/);
  assert.match(pluginCss, /lucide--save/);
  assert.match(coreCss, /lucide--chevron-down/);
  assert.equal(build([declaration]).build({ ...content, htmlContent: '<pre>data-work-manager</pre>' }).assets.scripts.some(script => script.src.includes('plugin-')), false);
});

test('dependency overview lays out prerequisites before successors without reordering data', () => {
  const { dependencyLayout } = require('../lib/plugins/work-manager/dependency-layout');
  const tasks = [task('c', ['b']), task('a'), task('b', ['a']), task('independent')];
  const before = JSON.stringify(tasks);
  const positions = new Map(dependencyLayout(tasks).map(position => [position.id, position]));
  assert.ok(positions.get('a').x < positions.get('b').x);
  assert.ok(positions.get('b').x < positions.get('c').x);
  assert.equal(positions.get('independent').x, positions.get('a').x);
  assert.notEqual(positions.get('independent').y, positions.get('a').y);
  assert.deepEqual(dependencyLayout([]), []);
  assert.equal(JSON.stringify(tasks), before);
  assert.throws(() => dependencyLayout([task('a', ['b']), task('b', ['a'])]));
});

test('manual task time adds whole units and formats day/hour boundaries', () => {
  const { formatDuration, manualMinutes } = require('../lib/plugins/work-manager/duration');
  assert.equal(manualMinutes('1', '2', '15'), 1575);
  assert.equal(formatDuration(30 + manualMinutes('1', '2', '15')), '1 дн 2 год 45 хв');
  assert.equal(formatDuration(1440), '1 дн');
  assert.equal(formatDuration(0), '0 хв');
  for (const invalid of ['-1', '1.5', '1e5', '52560001']) {
    assert.ok(Number.isNaN(manualMinutes('', '', invalid)));
  }
});

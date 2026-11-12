// Explicit operator command. Uses the compiled provider and disposable Drive workspaces.
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { fork } = require('node:child_process');
const { OAuth2Client } = require('google-auth-library');
const { resolvePluginsFromSettings, StorageRegistry } = require('../lib');

const credentialPath = process.argv[2];
const childInput = process.argv[3] === '--child' ? once(process, 'message') : null;
let stage = 'credentials';

function provider(workspaceId, rootFolderId) {
  const plugins = resolvePluginsFromSettings({ plugins: [{ name: 'googleDriveStorage', options: {
    providerId: 'drive', workspaceId, rootFolderId, backupKeep: 2,
    rootFolderName: `Second Brain STO-02-03 TEST ${workspaceId}`,
  } }] });
  return new StorageRegistry(plugins.flatMap(plugin => plugin.storageProviders)).get('drive');
}

async function main() {
  const c = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
  Object.assign(process.env, {
    GOOGLE_DRIVE_CLIENT_ID: c.client_id, GOOGLE_DRIVE_CLIENT_SECRET: c.client_secret,
    GOOGLE_DRIVE_REFRESH_TOKEN: c.refresh_token,
    GOOGLE_DRIVE_TICKET_SECRET: process.env.GOOGLE_DRIVE_TICKET_SECRET || crypto.randomBytes(32).toString('base64url'),
  });
  if (childInput) {
    const [input] = await childInput;
    const p = provider(input.workspaceId);
    const document = input.recoveryTicket
      ? await p.restoreBackup('project', input.recoveryTicket, 'smoke-operation-5')
      : await p.create(input.ticket, input.content);
    assert.deepEqual(document.content, input.content);
    process.send({ ok: true }, () => process.disconnect());
    return;
  }
  const suffix = crypto.randomBytes(8).toString('hex');
  const workspaces = [`smoke-a-${suffix}`, `smoke-b-${suffix}`];
  const oauth = new OAuth2Client(c.client_id, c.client_secret);
  oauth.setCredentials({ refresh_token: c.refresh_token });
  const request = (path, method = 'GET', data) => oauth.request({
    url: `https://www.googleapis.com/drive/v3/${path}`, method, data, retry: false, timeout: 15000,
  });
  const roots = async workspace => {
    const marker = crypto.createHash('sha256').update(`${workspace}:drive`).digest('hex');
    const query = new URLSearchParams({ q: `trashed=false and appProperties has { key='kbWorkspace' and value='${marker}' } and mimeType='application/vnd.google-apps.folder'`, fields: 'files(id)' });
    return (await request(`files?${query}`)).data.files;
  };
  try {
    stage = 'initialize two configured providers';
    const a = provider(workspaces[0]);
    const b = provider(workspaces[1]);
    await a.initialize();
    await b.initialize();
    stage = 'ticket restart';
    const content = { title: 'STO-02 isolated smoke', tasks: [] };
    const ticket = await a.prepareCreate('project', 'smoke-operation-1', content);
    const child = fork(__filename, [credentialPath, '--child'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const exited = once(child, 'exit');
    const timer = setTimeout(() => child.kill(), 90000);
    try {
      const result = new Promise((resolve, reject) => {
        child.once('message', resolve);
        child.once('error', reject);
        child.once('exit', () => reject(new Error('Child exited before confirmation')));
      });
      child.send({ workspaceId: workspaces[0], ticket, content });
      assert.equal((await result).ok, true);
      assert.equal((await exited)[0], 0);
    } finally { clearTimeout(timer); if (child.exitCode === null && !child.killed) child.kill(); }
    assert.deepEqual((await a.create(ticket, content)).content, content);
    console.log('PASS compiled provider create ticket survives new OS process; repeat confirms existing file');
    stage = 'isolation and root pinning';
    assert.deepEqual((await b.list()).items, []);
    await assert.rejects(b.read('project'), error => error.code === 'not_found');
    const [root] = await roots(workspaces[0]);
    const pinned = provider(workspaces[0], root.id);
    assert.deepEqual((await pinned.read('project')).content, content);
    await assert.rejects(provider(workspaces[1], root.id).initialize(), error => error.code === 'access_denied');
    console.log('PASS two workspace isolation; configured root validated, foreign root rejected');
    stage = 'update and archive';
    await a.update('project', 'smoke-operation-2', { title: 'Updated' });
    assert.equal((await a.list()).items[0].content.title, 'Updated');
    await a.archive('project', 'smoke-operation-3');
    assert.equal((await a.list()).items.length, 0);
    assert.equal((await a.list({ archived: true })).items.length, 1);
    await a.restore('project', 'smoke-operation-4');
    assert.equal((await a.read('project')).archived, false);
    console.log('PASS compiled provider list/read/update/logical archive/restore');
    stage = 'backup retention and damaged file recovery';
    const backups = await a.listBackups('project');
    assert.equal(backups.length, 2);
    const restorePoint = backups.find(backup => backup.operationId === 'smoke-operation-2');
    assert.ok(restorePoint);
    const projectQuery = new URLSearchParams({ q: `'${root.id}' in parents and trashed=false and appProperties has { key='kbKey' and value='project' }`, fields: 'files(id)' });
    const [project] = (await request(`files?${projectQuery}`)).data.files;
    // Deliberate corruption only in this run's isolated test workspace.
    await oauth.request({ url: `https://www.googleapis.com/upload/drive/v3/files/${project.id}?uploadType=media`,
      method: 'PATCH', data: '{broken JSON', headers: { 'Content-Type': 'application/json' }, retry: false, timeout: 15000 });
    await assert.rejects(a.read('project'), error => error.code === 'invalid_document');
    const recovery = fork(__filename, [credentialPath, '--child'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const recoveryExit = once(recovery, 'exit');
    const recoveryTimer = setTimeout(() => recovery.kill(), 90000);
    try {
      const evidence = new Promise((resolve, reject) => {
        recovery.once('message', resolve);
        recovery.once('error', reject);
        recovery.once('exit', () => reject(new Error('Recovery exited before confirmation')));
      });
      recovery.send({ workspaceId: workspaces[0], recoveryTicket: restorePoint.ticket, content: { title: 'Updated' } });
      assert.equal((await evidence).ok, true);
      assert.equal((await recoveryExit)[0], 0);
    } finally { clearTimeout(recoveryTimer); if (recovery.exitCode === null && !recovery.killed) recovery.kill(); }
    assert.equal((await a.reconcile('project', 'smoke-operation-5', { title: 'Updated' })).content.title, 'Updated');
    await assert.rejects(a.reconcile('project', 'smoke-operation-2', { title: 'Updated' }), error => error.code === 'unknown_result');
    assert.equal((await a.listBackups('project')).length, 2);
    console.log('PASS provider backup retention=2, corrupt JSON restored in new OS process, stale operation not replayed');
  } finally {
    for (const workspace of workspaces) {
      for (const folder of await roots(workspace)) {
        await request(`files/${folder.id}`, 'PATCH', { trashed: true });
        assert.equal((await request(`files/${folder.id}?fields=trashed`)).data.trashed, true);
      }
    }
    console.log('CLEANUP isolated STO-02 workspaces moved to trash');
  }
}
main().catch(error => {
  console.error(JSON.stringify({ stage, code: error.code || 'failed', failed: true }));
  if (process.connected) process.disconnect();
  process.exitCode = 1;
});

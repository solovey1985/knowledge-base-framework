// Live STO-01 follow-up: isolated files only, no production provider registration.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { OAuth2Client } from 'google-auth-library';
import { readWithRetry, reconcile, retentionCandidates } from './drive-probe-policy.mjs';

const api = 'https://www.googleapis.com/drive/v3/files';
const upload = 'https://www.googleapis.com/upload/drive/v3/files';
const credentialPath = process.argv[2];
const mode = process.argv[3];
const input = mode ? once(process, 'message') : null;
let stage = 'credentials';

async function client() {
  const c = JSON.parse(await readFile(credentialPath, 'utf8'));
  const oauth = new OAuth2Client(c.client_id, c.client_secret);
  oauth.setCredentials({ refresh_token: c.refresh_token });
  return (url, method = 'GET', data, headers) => oauth.request({
    url, method, data, headers, retry: false, timeout: 30000,
  });
}

function multipart(metadata, document) {
  const boundary = `probe_${randomUUID()}`;
  return {
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}` +
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(document)}\r\n--${boundary}--\r\n`,
  };
}

// The client actually times out on HTTP, after the real Google write completed.
// This is a loopback fault-injection boundary, not a Google outage.
async function loseResponseAfterCommit(operation) {
  let settle;
  const committed = new Promise(resolve => { settle = resolve; });
  const bridge = createServer(async (_request, response) => {
    try {
      await operation();
      settle(true);
      // Deliberately withhold the HTTP response until client timeout.
    } catch {
      settle(false);
      response.writeHead(502).end();
    }
  });
  bridge.listen(0, '127.0.0.1');
  await once(bridge, 'listening');
  const controller = new AbortController();
  const watchdog = setTimeout(() => controller.abort(), 35000);
  try {
    const outcome = fetch(`http://127.0.0.1:${bridge.address().port}`, {
      method: 'POST', signal: controller.signal,
    }).then(() => 'response', () => 'timeout');
    assert.equal(await committed, true);
    controller.abort(new DOMException('Injected timeout after commit', 'TimeoutError'));
    assert.equal(await outcome, 'timeout');
  } finally {
    clearTimeout(watchdog);
    bridge.closeAllConnections();
    await new Promise(resolve => bridge.close(resolve));
  }
}

async function childRoundtrip(childMode, id, document) {
  const child = fork(fileURLToPath(import.meta.url), [credentialPath, childMode, id], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const completed = once(child, 'exit');
  const timeout = setTimeout(() => child.kill(), 35000);
  try {
    const message = new Promise((resolve, reject) => {
      child.once('message', resolve);
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Child exited before evidence')));
    });
    child.send(document);
    assert.equal((await message).ok, true);
    // Terminate writer after upstream commit, before application acknowledgment.
    if (childMode === '--write-and-crash') child.kill();
    await completed;
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && !child.killed) child.kill();
  }
}

async function main() {
  const request = await client();
  const read = async id => (await readWithRetry(() => request(`${api}/${id}?alt=media`))).data;
  const write = (id, document) => request(`${upload}/${id}?uploadType=media`, 'PATCH',
    JSON.stringify(document), { 'Content-Type': 'application/json' });
  if (mode) {
    const [document] = await input;
    if (mode === '--write-and-crash') {
      await write(process.argv[4], document);
      process.send({ ok: true });
      return; // Open IPC keeps this writer alive until parent kills it.
    }
    assert.equal(mode, '--read-after-restart');
    assert.equal(reconcile(await read(process.argv[4]), document), 'confirmed');
    process.send({ ok: true }, () => process.disconnect());
    return;
  }

  stage = 'create test workspace';
  const folder = (await request(api, 'POST', {
    name: `Second Brain STO-01 RECOVERY TEST ${new Date().toISOString().replaceAll(':', '-')}`,
    mimeType: 'application/vnd.google-apps.folder', appProperties: { purpose: 'sto-01-recovery-test' },
  })).data;
  console.log(`TEST_FOLDER https://drive.google.com/drive/folders/${folder.id}`);
  try {
    const id = (await request(`${api}/generateIds?count=1&space=drive&type=files`)).data.ids[0];
    const document = { schemaVersion: 1, operationId: randomUUID(), project: { title: 'initial', tasks: [] } };
    const part = multipart({ id, name: 'recovery.json', mimeType: 'application/json', parents: [folder.id] }, document);
    const create = () => request(`${upload}?uploadType=multipart`, 'POST', part.body, part.headers);
    stage = 'create timeout';
    await loseResponseAfterCommit(create);
    await childRoundtrip('--read-after-restart', id, document);
    let duplicateStatus;
    try { await create(); } catch (error) { duplicateStatus = error.response?.status; }
    assert.equal(duplicateStatus, 409);
    assert.equal(reconcile(await read(id), document), 'confirmed');
    console.log('PASS create: real Drive commit -> injected HTTP timeout -> new process read -> retry 409, same JSON');

    stage = 'update timeout';
    const changed = { ...document, operationId: randomUUID(), project: { title: 'updated', tasks: [] } };
    await loseResponseAfterCommit(() => write(id, changed));
    await childRoundtrip('--read-after-restart', id, changed);
    console.log('PASS update: injected HTTP timeout after real commit, new process confirms payload');

    stage = 'process crash';
    const crashed = { ...changed, operationId: randomUUID(), project: { title: 'crashed writer', tasks: [] } };
    await childRoundtrip('--write-and-crash', id, crashed);
    await childRoundtrip('--read-after-restart', id, crashed);
    assert.equal(reconcile(await read(id), changed), 'unknown');
    console.log('PASS killed writer after commit; fresh process confirms save; old operation is unknown, not replayed');

    stage = 'retention and restore';
    const backups = [];
    for (let index = 0; index < 3; index++) {
      const copy = (await request(`${api}/${id}/copy?fields=id,createdTime`, 'POST', {
        name: `backup-${index}.json`, parents: [folder.id],
        appProperties: { purpose: 'sto-01-backup-test', sourceId: id },
      })).data;
      assert.equal(reconcile(await read(copy.id), crashed), 'confirmed');
      backups.push(copy);
    }
    // Exercise the same count policy with keep=2; production default is 10.
    const remove = retentionCandidates(backups, 2);
    assert.equal(remove.length, 1);
    for (const backup of remove) await request(`${api}/${backup.id}`, 'PATCH', { trashed: true });
    const remaining = backups.filter(backup => !remove.some(item => item.id === backup.id));
    for (const backup of backups) {
      const metadata = (await request(`${api}/${backup.id}?fields=trashed`)).data;
      assert.equal(metadata.trashed, remove.some(item => item.id === backup.id));
    }
    await write(id, { damaged: true });
    await write(id, await read(remaining[0].id));
    assert.equal(reconcile(await read(id), crashed), 'confirmed');
    console.log('PASS backup retention 3 -> 2 (trash only), corruption restored from retained JSON');
  } finally {
    // The ID is from this run's successful folder create, never user-supplied.
    await request(`${api}/${folder.id}`, 'PATCH', { trashed: true });
    assert.equal((await request(`${api}/${folder.id}?fields=trashed`)).data.trashed, true);
    console.log('CLEANUP test workspace moved to trash');
  }
}

main().catch(error => {
  console.error(JSON.stringify({ stage, status: error.response?.status ?? null, failed: true }));
  if (process.connected) process.disconnect();
  process.exitCode = 1;
});

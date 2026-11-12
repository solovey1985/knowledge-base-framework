// Operator-only live probe. All writes target a newly created, isolated test folder.
import { readFile } from 'node:fs/promises';
import { OAuth2Client } from 'google-auth-library';
import assert from 'node:assert/strict';

const api = 'https://www.googleapis.com/drive/v3/files';
const upload = 'https://www.googleapis.com/upload/drive/v3/files';
let stage = 'credentials';
async function main() {
  const credentials = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const auth = new OAuth2Client(credentials.client_id, credentials.client_secret);
  auth.setCredentials({ refresh_token: credentials.refresh_token });
  // This fresh process has no cached access token; the SDK must refresh it.
  await auth.getAccessToken();
  console.log('PASS fresh-process refresh');
  const request = async (url, method = 'GET', data, headers) => auth.request({
    url, method, data, headers, retry: false, timeout: 30000,
  });
  const metadata = id => request(`${api}/${id}?fields=id,version,name`);
  const read = id => request(`${api}/${id}?alt=media`);
  const write = (id, value, etag) => request(`${upload}/${id}?uploadType=media`, 'PATCH',
    JSON.stringify(value), { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) });
  const status = async promise => {
    try { return (await promise).status; } catch (error) { return error.response?.status ?? 'network-error'; }
  };

  stage = 'create isolated folder';
  const name = `Second Brain STO-01 TEST ${new Date().toISOString().replaceAll(':', '-')}`;
  const folder = (await request(api, 'POST', {
    name, mimeType: 'application/vnd.google-apps.folder',
    appProperties: { purpose: 'second-brain-sto-01-test' },
  })).data;
  console.log(`TEST_FOLDER https://drive.google.com/drive/folders/${folder.id}`);

  stage = 'create and repeat';
  const ids = (await request(`${api}/generateIds?count=1&space=drive&type=files`)).data.ids;
  const id = ids[0];
  const file = { id, name: 'probe.json', mimeType: 'application/json', parents: [folder.id] };
  await request(api, 'POST', file);
  // Discard the successful create result, then repeat the identical operation.
  // This simulates an unknown result; it does not inject a real network timeout.
  const repeated = await status(request(api, 'POST', file));
  assert.equal(repeated, 409);
  console.log('PASS repeated create with reserved ID: 409');
  const baseline = { schemaVersion: 1, title: 'STO-01 test', tasks: [] };
  await write(id, baseline);
  assert.deepEqual((await read(id)).data, baseline);
  await write(id, { ...baseline, title: 'updated' });
  assert.equal((await read(id)).data.title, 'updated');
  console.log('PASS JSON write/read/update');

  stage = 'conditional write';
  const snapshot = await metadata(id);
  const etag = snapshot.headers.get('etag');
  console.log(`METADATA_ETAG ${Boolean(etag)}`);
  const invalid = await status(write(id, { ...baseline, title: 'invalid conditional write' }, '"invalid-etag"'));
  console.log(`INVALID_IF_MATCH_STATUS ${invalid}`);
  if (etag) {
    await write(id, { ...baseline, title: 'writer A' }, etag);
    const stale = await status(write(id, { ...baseline, title: 'writer B' }, etag));
    console.log(`STALE_IF_MATCH_STATUS ${stale}`);
    const shared = (await metadata(id)).headers.get('etag');
    const race = await Promise.all([
      status(write(id, { ...baseline, title: 'race A' }, shared)),
      status(write(id, { ...baseline, title: 'race B' }, shared)),
    ]);
    console.log(`CONCURRENT_IF_MATCH_STATUSES ${JSON.stringify(race)}`);
  }
  // Unconditional writers provide a control case for lost updates.
  const race = await Promise.all([
    status(write(id, { ...baseline, title: 'unconditional A' })),
    status(write(id, { ...baseline, title: 'unconditional B' })),
  ]);
  console.log(`UNCONDITIONAL_STATUSES ${JSON.stringify(race)}`);
  console.log(`UNCONDITIONAL_FINAL ${(await read(id)).data.title}`);

  stage = 'backup recovery';
  await write(id, baseline);
  const backup = (await request(`${api}/${id}/copy`, 'POST', { name: 'probe.backup.json', parents: [folder.id] })).data;
  await write(id, { damaged: true });
  await write(id, (await read(backup.id)).data);
  assert.deepEqual((await read(id)).data, baseline);
  console.log('PASS recovery from separate backup JSON');

  stage = 'duplicate names and pagination';
  await request(api, 'POST', { name: 'probe.json', mimeType: 'application/json', parents: [folder.id] });
  const found = [];
  let token;
  do {
    const query = new URLSearchParams({ q: `'${folder.id}' in parents and trashed = false`, pageSize: '1', fields: 'nextPageToken,files(id,name)' });
    if (token) query.set('pageToken', token);
    const result = (await request(`${api}?${query}`)).data;
    found.push(...result.files);
    token = result.nextPageToken;
  } while (token);
  assert.equal(found.filter(value => value.name === 'probe.json').length, 2);
  assert.equal(found.length, 3);
  console.log('PASS pagination and duplicate names: 3 files, 2 same names');

  stage = 'trash and restore';
  await request(`${api}/${id}`, 'PATCH', { trashed: true });
  await request(`${api}/${id}`, 'PATCH', { trashed: false });
  assert.deepEqual((await read(id)).data, baseline);
  console.log('PASS test-file trash/restore');
  console.log('DONE Test folder retained for inspection; production files untouched.');
}

main().catch(error => {
  // Google SDK error objects can contain Authorization headers: never log them.
  console.error(JSON.stringify({ stage, status: error.response?.status ?? null, failed: true }));
  process.exitCode = 1;
});

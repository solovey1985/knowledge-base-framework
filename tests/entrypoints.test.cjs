const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp, buildSite, hashPassword } = require('../lib');

async function project(t, plugins) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-entrypoints-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'content'));
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'content', 'index.md'), '# Private fixture sentinel');
  await fs.writeFile(path.join(root, 'kb.config.json'), JSON.stringify({
    contentRootPath: './content', title: 'Fixture', search: { enabled: false }, build: { outputDir: path.join(root, 'site') },
  }));
  await fs.writeFile(path.join(root, 'kb.plugins.json'), JSON.stringify({ plugins }));
  return root;
}

async function listen(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return route => fetch(`http://127.0.0.1:${server.address().port}${route}`, { redirect: 'manual' });
}

async function privateEnvironment(t) {
  const previous = { ...process.env };
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  });
  Object.assign(process.env, {
    AUTH_PASSWORD_HASH: await hashPassword('test-only-entrypoint-password'),
    AUTH_SIGNING_SECRET: Buffer.alloc(32, 3).toString('base64url'),
    AUTH_SESSION_VERSION: '1', AUTH_SITE_ID: 'entrypoint-test', AUTH_ORIGIN: 'https://example.test',
  });
  delete process.env.KB_PLUGINS_CONFIG;
}

test('createApp resolves the project relative to its config file and serves a neutral liveness route', async t => {
  const root = await project(t, []);
  const request = await listen(t, createApp({ configPath: path.join(root, 'kb.config.json') }));
  const health = await request('/healthz');
  assert.equal(health.status, 204);
  assert.equal(await health.text(), '');
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.equal(health.headers.get('x-powered-by'), null);
  assert.match(await (await request('/index.md')).text(), /Private fixture sentinel/);
  assert.equal((await request('/framework-assets/kb-app.js')).status, 200);
});

test('with authentication only liveness is public', async t => {
  await privateEnvironment(t);
  const root = await project(t, [{ name: 'passwordAuth', enabled: true }]);
  const request = await listen(t, createApp({ configPath: path.join(root, 'kb.config.json') }));
  assert.equal((await request('/healthz')).status, 204);
  for (const route of ['/', '/index.md', '/content/index.md', '/framework-assets/kb-app.js', '/assets/x.png']) {
    const response = await request(route);
    // 400: the request Host does not match the configured origin; equally denied.
    assert.ok([302, 400, 401].includes(response.status), `${route}: ${response.status}`);
    assert.doesNotMatch(await response.text(), /Private fixture sentinel/);
  }
});

test('buildSite refuses a private site before cleaning the output directory', async t => {
  await privateEnvironment(t);
  const root = await project(t, [{ name: 'passwordAuth', enabled: true }]);
  await fs.mkdir(path.join(root, 'site'));
  await fs.writeFile(path.join(root, 'site', 'preserve.txt'), 'must survive');
  await assert.rejects(buildSite({ configPath: path.join(root, 'kb.config.json') }), /static export would expose private content/);
  assert.equal(await fs.readFile(path.join(root, 'site', 'preserve.txt'), 'utf8'), 'must survive');

  // The same project without authentication exports normally.
  await fs.writeFile(path.join(root, 'kb.plugins.json'), JSON.stringify({ plugins: [] }));
  await buildSite({ configPath: path.join(root, 'kb.config.json') });
  assert.match(await fs.readFile(path.join(root, 'site', 'index.html'), 'utf8'), /Private fixture sentinel/);
});

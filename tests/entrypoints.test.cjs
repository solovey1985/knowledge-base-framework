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
  t.after(() => app.locals.knowledgeBase.close());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }));
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

test('a document that fails to render answers 500 without details; a missing one answers 404', async t => {
  const root = await project(t, []);
  const failing = { id: 'failing', contentRenderers: [{ id: 'failing-md', matches: file => file.endsWith('broken.md'),
    render: async () => { throw new Error('internal detail'); } }] };
  await fs.writeFile(path.join(root, 'content', 'broken.md'), '# Broken');
  const original = console.error;
  console.error = () => {};
  t.after(() => { console.error = original; });
  const request = await listen(t, createApp({ configPath: path.join(root, 'kb.config.json'), plugins: [failing] }));
  for (const route of ['/broken.md', '/content/broken.md']) {
    const response = await request(route);
    assert.equal(response.status, 500, route);
    assert.doesNotMatch(await response.text(), /internal detail/);
  }
  assert.equal((await request('/content/missing.md')).status, 404);
  assert.equal((await request('/missing.md')).status, 404);
});

test('navigation is scanned once per build and refreshed after invalidation', async t => {
  const root = await project(t, []);
  const { KnowledgeBase } = require('../lib');
  const contentRootPath = path.join(root, 'content');
  const count = kb => {
    const files = kb.getFileService();
    const listing = files.getDirectoryListing.bind(files);
    let calls = 0;
    files.getDirectoryListing = (...args) => { calls++; return listing(...args); };
    return () => calls;
  };

  const build = new KnowledgeBase({ contentRootPath, isStaticSite: true });
  const buildCalls = count(build);
  for (let i = 0; i < 5; i++) await build.renderContent('index.md');
  assert.equal(buildCalls(), 1);

  const server = new KnowledgeBase({ contentRootPath });
  t.after(() => server.close());
  const titles = async () => (await server.renderContent('index.md')).navigation.map(item => item.path);
  assert.deepEqual(await titles(), ['index.md']);
  await fs.writeFile(path.join(contentRootPath, 'added.md'), '# Added');
  server.getNavigationService().invalidate();
  assert.deepEqual(await titles(), ['added.md', 'index.md']);
  const page = await server.renderContent('added.md');
  assert.deepEqual(page.navigation.filter(item => item.isActive).map(item => item.path), ['added.md']);
});

test('live reload is a development option that notifies open pages of content changes', async t => {
  const root = await project(t, []);
  const configPath = path.join(root, 'kb.config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  await fs.writeFile(configPath, JSON.stringify({ ...config, server: { liveReload: true } }));
  const previous = process.env.NODE_ENV;
  t.after(() => { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; });

  process.env.NODE_ENV = 'production';
  const production = createApp({ configPath });
  t.after(() => production.locals.knowledgeBase.close());
  const productionRequest = await listen(t, production);
  assert.doesNotMatch(await (await productionRequest('/index.md')).text(), /__kb\/live/);
  assert.equal((await productionRequest('/__kb/live.js')).status, 404);

  process.env.NODE_ENV = 'development';
  const app = createApp({ configPath });
  t.after(() => app.locals.knowledgeBase.close());
  const request = await listen(t, app);
  assert.match(await (await request('/index.md')).text(), /<script src="\/__kb\/live\.js" defer>/);
  assert.match(await (await request('/__kb/live.js')).text(), /EventSource/);

  // The stream is closed inside the test: an open connection would keep server.close() waiting.
  const controller = new AbortController();
  const stream = await fetch(`${(await request('/healthz')).url.replace('/healthz', '')}/__kb/live`, { signal: controller.signal });
  const reader = stream.body.getReader();
  await reader.read(); // retry preamble
  await fs.writeFile(path.join(root, 'content', 'changed.md'), '# Changed');
  const event = await Promise.race([
    reader.read().then(chunk => Buffer.from(chunk.value).toString()),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 5000)),
  ]);
  controller.abort();
  assert.match(event, /event: change/);
});

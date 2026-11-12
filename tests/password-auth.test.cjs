const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  passwordAuthPlugin,
  hashPassword,
  KnowledgeBase,
  resolvePluginsFromSettings,
  StaticSiteBuilder,
} = require('../lib');
const {
  resolveConfig,
  SESSION_SECONDS,
} = require('../lib/plugins/password-auth/config');
const {
  createToken,
  verifyToken,
  csrfToken,
} = require('../lib/plugins/password-auth/token-service');
const password = 'test-only-long-passphrase';
let config;
before(async () => {
  Object.assign(process.env, {
    AUTH_PASSWORD_HASH: await hashPassword(password),
    AUTH_SIGNING_SECRET: crypto.randomBytes(32).toString('base64url'),
    AUTH_SESSION_VERSION: '1',
    AUTH_SITE_ID: 'test-site',
    AUTH_ORIGIN: 'http://127.0.0.1:31991',
  });
  config = resolveConfig({ allowInsecureLocalhost: true });
});
async function appFixture(
  t,
  { authenticated = true, https = false, autoAdvance = true } = {}
) {
  let now = 0;
  t.mock.method(require('node:perf_hooks').performance, 'now', () => now);
  const app = express();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-auth-'));
  fs.writeFileSync(path.join(root, 'index.md'), '# Private marker');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'private download');
  const previous = process.env.AUTH_ORIGIN;
  if (https) process.env.AUTH_ORIGIN = 'https://private.example';
  const plugins = authenticated
    ? [passwordAuthPlugin({ allowInsecureLocalhost: !https })]
    : [];
  process.env.AUTH_ORIGIN = previous;
  const kb = new KnowledgeBase({ contentRootPath: root, plugins });
  kb.setupSecurity(app);
  app.use('/assets', express.static(root));
  app.use('/framework-assets', express.static(root));
  app.post('/api/write', (_req, res) => res.status(204).end());
  kb.setupMiddleware(app);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, init = {}) =>
    new Promise((resolve, reject) => {
      if (autoAdvance) now += 10_000;
      const req = require('node:http').request(
        base + url,
        {
          method: init.method || 'GET',
          headers: {
            Host: https ? 'private.example' : '127.0.0.1:31991',
            ...init.headers,
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (b) => chunks.push(b));
          res.on('end', () => {
            const headers = new Headers();
            for (let i = 0; i < res.rawHeaders.length; i += 2)
              headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
            resolve(
              new Response(
                [204, 304].includes(res.statusCode)
                  ? null
                  : Buffer.concat(chunks),
                { status: res.statusCode, headers }
              )
            );
          });
        }
      );
      req.on('error', reject);
      if (init.body) req.write(init.body);
      req.end();
    });
  const login = () =>
    request('/auth/login', {
      method: 'POST',
      headers: {
        Origin: https ? 'https://private.example' : config.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });
  return {
    request,
    login,
    advance: (milliseconds) => {
      now += milliseconds;
    },
  };
}
test('configuration fails closed and disabled plugin needs no secrets', () => {
  assert.throws(() => resolveConfig({}), /HTTPS/);
  assert.throws(
    () => resolveConfig({ allowInsecureLocalhost: true, sessionTtlDays: 7 }),
    /14/
  );
  assert.throws(
    () => resolveConfig({ passwordHashEnv: 'ABSENT_TEST_ENV' }),
    /missing/
  );
  assert.deepEqual(
    resolvePluginsFromSettings({
      plugins: [{ name: 'passwordAuth', enabled: false }],
    }),
    []
  );
  assert.equal(
    resolvePluginsFromSettings({
      plugins: [
        { name: 'passwordAuth', options: { allowInsecureLocalhost: true } },
      ],
    })[0].id,
    'password-auth'
  );
  assert.throws(
    () => new KnowledgeBase({ contentRootPath: '.', auth: { enabled: true } }),
    /Legacy/
  );
  const plugin = passwordAuthPlugin({ allowInsecureLocalhost: true });
  assert.throws(
    () =>
      new KnowledgeBase({ contentRootPath: '.', plugins: [plugin, plugin] }),
    /Only one/
  );
  assert.throws(
    () => new StaticSiteBuilder({ contentRootPath: '.', plugins: [plugin] }),
    /static export/
  );
});
test('JWT fixed lifetime, restart, expiry, tampering, site, version, key and algorithm', () => {
  const token = createToken(config);
  const claims = verifyToken(config, token);
  assert.equal(claims.exp - claims.iat, SESSION_SECONDS);
  const restarted = resolveConfig({ allowInsecureLocalhost: true });
  assert.ok(verifyToken(restarted, token));
  assert.equal(csrfToken(restarted, claims), csrfToken(config, claims));
  for (const change of [
    { version: '2' },
    { siteId: 'other' },
    { secret: crypto.randomBytes(32) },
  ])
    assert.equal(verifyToken({ ...config, ...change }, token), null);
  assert.equal(verifyToken(config, token.slice(0, -8) + 'tampered'), null);
  const sign = (changes = {}, algorithm = 'HS256') =>
    jwt.sign(
      {
        iss: config.siteId,
        aud: config.siteId,
        sessionVersion: config.version,
        jti: crypto.randomUUID(),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
        ...changes,
      },
      config.secret,
      { algorithm }
    );
  for (const bad of [
    sign({ aud: 'other' }),
    sign({ iss: 'other' }),
    sign({}, 'HS384'),
    sign({ iat: 1, exp: 1 + SESSION_SECONDS }),
    sign({ exp: Math.floor(Date.now() / 1000) + 60 }),
    sign({ jti: '' }),
    'legacy.payload',
  ])
    assert.equal(verifyToken(config, bad), null);
});
test('anonymous resources, HEAD, Range and encoded aliases are guarded', async (t) => {
  const { request } = await appFixture(t);
  for (const url of [
    '/',
    '/index.md',
    '/content/index.md',
    '/content/secret.txt',
    '/assets/secret.txt',
    '/framework-assets/secret.txt',
    '/search-index.json',
    '/api/write',
    '/content/%73ecret.txt',
    '/%61ssets/secret.txt',
    '/login/',
    '/LOGIN',
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const r = await request(url, {
        method,
        headers: { Range: 'bytes=0-10' },
      });
      assert.equal(r.status, 401, `${method} ${url}`);
      assert.equal(r.headers.get('cache-control'), 'private, no-store');
    }
  }
  assert.equal(
    (await request('/index.md', { headers: { Accept: 'text/html' } })).status,
    303
  );
  assert.equal(
    (await request('/api/write', { headers: { Accept: 'text/html' } })).status,
    401
  );
  assert.equal((await request('/login')).status, 200);
  assert.equal(
    (await request('/login', { headers: { Host: 'evil.example' } })).status,
    400
  );
});
test('login validation, cookie, CSRF, session, private caching, logout and copied token', async (t) => {
  const { request, login } = await appFixture(t);
  const post = (body, headers = {}) =>
    request('/auth/login', {
      method: 'POST',
      headers: {
        Origin: config.origin,
        'Content-Type': 'application/json',
        ...headers,
      },
      body,
    });
  assert.equal((await post(JSON.stringify({ password: 'wrong' }))).status, 401);
  assert.equal((await post('{')).status, 400);
  assert.equal(
    (await post(JSON.stringify({ password, username: 'extra' }))).status,
    400
  );
  assert.equal(
    (
      await post(JSON.stringify({ password }), {
        Origin: 'https://evil.example',
      })
    ).status,
    403
  );
  const r = await login();
  assert.equal(r.status, 204);
  const setCookie = r.headers.get('set-cookie');
  for (const flag of [
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=1209600',
  ])
    assert.ok(setCookie.includes(flag));
  assert.ok(!setCookie.includes('Domain='));
  const Cookie = setCookie.split(';')[0];
  const session = await (
    await request('/auth/session', { headers: { Cookie } })
  ).json();
  assert.ok(session.csrfToken);
  assert.ok(session.expiresAt);
  const asset = await request('/assets/secret.txt', {
    headers: { Cookie, 'If-None-Match': '*' },
  });
  assert.equal(asset.status, 200);
  assert.equal(await asset.text(), 'private download');
  assert.equal(asset.headers.get('cache-control'), 'private, no-store');
  assert.equal(asset.headers.get('etag'), null);
  assert.equal(
    (
      await request('/api/write', {
        method: 'POST',
        headers: { Cookie, Origin: config.origin },
      })
    ).status,
    403
  );
  const headers = {
    Cookie,
    Origin: config.origin,
    'X-CSRF-Token': session.csrfToken,
  };
  assert.equal(
    (await request('/api/write', { method: 'POST', headers })).status,
    204
  );
  assert.equal(
    (
      await request('/logout', {
        method: 'POST',
        headers: { Cookie, Origin: config.origin },
      })
    ).status,
    403
  );
  const logout = await request('/logout', { method: 'POST', headers });
  assert.equal(logout.status, 204);
  assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'));
  assert.equal(
    (await request('/auth/session', { headers: { Cookie } })).status,
    200,
    'stateless logout cannot revoke copied token'
  );
  assert.equal(
    (await request('/auth/session', { headers: { Cookie: 'kb_auth=legacy' } }))
      .status,
    401
  );
  assert.equal(
    (
      await request('/auth/session', {
        headers: { Cookie: Cookie + '; ' + Cookie },
      })
    ).status,
    401
  );
});
test('HTTPS cookie and HTTP limiter startup, burst, replenishment and spoofed IP', async (t) => {
  const { login, request, advance } = await appFixture(t, {
    https: true,
    autoAdvance: false,
  });
  let response = await login();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '10');
  advance(30_000);
  response = await login();
  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie'), /^__Host-kb_session=/);
  assert.ok(response.headers.get('set-cookie').includes('Secure'));
  assert.equal((await login()).status, 204);
  assert.equal((await login()).status, 204);
  assert.equal((await login()).status, 429);
  response = await request('/auth/login', {
    method: 'POST',
    headers: {
      Origin: 'https://private.example',
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.9',
    },
    body: JSON.stringify({ password }),
  });
  assert.equal(response.status, 429);
  advance(9_001);
  response = await login();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '1');
  advance(999);
  assert.equal((await login()).status, 204);
});
test('bucket starts empty after restart, caps idle credit and ignores backwards time', () => {
  const {
    LoginAttemptLimiter,
  } = require('../lib/plugins/password-auth/login-attempt-limiter');
  let now = 0;
  const limiter = new LoginAttemptLimiter(() => now);
  assert.equal(limiter.consume(), 10);
  now = 9999;
  assert.equal(limiter.consume(), 1);
  now = 10000;
  assert.equal(limiter.consume(), 0);
  now = 1000;
  assert.equal(limiter.consume(), 10);
  now = 20000;
  assert.equal(limiter.consume(), 0);
  now = 1000000;
  for (let i = 0; i < 3; i++) assert.equal(limiter.consume(), 0);
  assert.equal(limiter.consume(), 10);
  const restarted = new LoginAttemptLimiter(() => now);
  assert.equal(restarted.consume(), 10);
  now += 10000;
  assert.equal(restarted.consume(), 0);
});
test('framework remains public with no authentication plugin', async (t) => {
  const { request } = await appFixture(t, { authenticated: false });
  assert.equal((await request('/assets/secret.txt')).status, 200);
});

test('token and CSRF survive a fresh Node process', () => {
  const token = createToken(config);
  const result = require('node:child_process').spawnSync(
    process.execPath,
    [
      '-e',
      `const c=require('./lib/plugins/password-auth/config').resolveConfig({allowInsecureLocalhost:true});const s=require('./lib/plugins/password-auth/token-service');const p=s.verifyToken(c,process.env.TEST_AUTH_TOKEN);if(!p)process.exit(1);process.stdout.write(s.csrfToken(c,p));`,
    ],
    {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, TEST_AUTH_TOKEN: token },
      encoding: 'utf8',
    }
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, csrfToken(config, verifyToken(config, token)));
});
test('CLI serve installs authentication before static assets', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-cli-auth-'));
  const probe = require('node:net').createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  fs.mkdirSync(path.join(root, 'content'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(
    path.join(root, 'assets', 'private.txt'),
    'CLI private marker'
  );
  fs.writeFileSync(
    path.join(root, 'kb.config.json'),
    JSON.stringify({ contentRootPath: './content', server: { port } })
  );
  fs.writeFileSync(
    path.join(root, 'kb.plugins.json'),
    JSON.stringify({
      plugins: [
        { name: 'passwordAuth', options: { allowInsecureLocalhost: true } },
      ],
    })
  );
  const child = require('node:child_process').spawn(
    process.execPath,
    [path.resolve(__dirname, '../lib/cli/kb.js'), 'serve'],
    {
      cwd: root,
      env: { ...process.env, AUTH_ORIGIN: `http://127.0.0.1:${port}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  t.after(async () => {
    if (child.exitCode === null) {
      const closed = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await closed;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('CLI startup timed out')),
      10000
    );
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('running at')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`CLI exited ${code}`));
    });
  });
  const response = await fetch(`http://127.0.0.1:${port}/assets/private.txt`);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('an empty login bucket does not block an existing session', async (t) => {
  const { request, login } = await appFixture(t, { autoAdvance: false });
  const cookie = 'kb_session_dev=' + createToken(config);
  assert.equal((await login()).status, 429);
  assert.equal(
    (await request('/auth/session', { headers: { Cookie: cookie } })).status,
    200
  );
});

test('public login page does not disclose the product, site or session lifetime', async (t) => {
  const { request } = await appFixture(t);
  const response = await request('/login');
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.doesNotMatch(
    html,
    /Knowledge Base|Second Brain|Вхід діє|Вхід дійсний|14 днів|test-site|Private marker/i
  );
  assert.match(html, /type="password"/);
});

test('authentication failures share one public body without internal reasons', async (t) => {
  const { request } = await appFixture(t);
  const expected = { error: { message: 'Не вдалося виконати запит.' } };
  const requests = [
    [
      '/auth/login',
      {
        method: 'POST',
        headers: { Origin: config.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong-password' }),
      },
    ],
    [
      '/auth/login',
      {
        method: 'POST',
        headers: { Origin: config.origin, 'Content-Type': 'application/json' },
        body: '{',
      },
    ],
    [
      '/auth/login',
      {
        method: 'POST',
        headers: {
          Origin: 'https://other.example',
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    ],
    ['/auth/session', {}],
    ['/logout', { method: 'POST' }],
  ];
  for (const [url, options] of requests) {
    const response = await request(url, options);
    assert.ok(response.status >= 400);
    assert.deepEqual(await response.json(), expected);
  }
  const { login } = await appFixture(t, { autoAdvance: false });
  const limited = await login();
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), expected);
  const html = await (await request('/login')).text();
  assert.doesNotMatch(
    html,
    /Неправильний пароль|Немає з’єднання|Спробуйте пізніше|invalid_password|rate_limited/
  );
});

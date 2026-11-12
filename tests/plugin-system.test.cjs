const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const lunr = require('lunr');
const {
  KnowledgeBase, buildSite, checkProject, createApp, registerPlugin, resolvePluginsFromSettings,
} = require('../lib');

const example = path.resolve(__dirname, '../docs/examples/plugins/reading-time/index.cjs');

async function project(t, plugins) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-plugin-system-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'content'));
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'content', 'note.md'), '---\ntitle: Front matter title\ntags: [alpha, "#beta"]\n---\n# Heading\n\nSome ==marked== words.');
  await fs.writeFile(path.join(root, 'kb.config.json'), JSON.stringify({
    contentRootPath: './content', title: 'Fixture', baseUrl: '', build: { outputDir: path.join(root, 'site') },
  }));
  await fs.writeFile(path.join(root, 'kb.plugins.json'), JSON.stringify({ plugins }));
  return { root, configPath: path.join(root, 'kb.config.json') };
}

async function listen(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return route => fetch(`http://127.0.0.1:${server.address().port}${route}`);
}

test('built-in names ignore case and separators; unknown names list what is registered', () => {
  for (const name of ['threeDViewer', 'three-d-viewer', 'three_d_viewer', 'ThreeDViewerPlugin', 'threeViewer']) {
    assert.equal(resolvePluginsFromSettings({ plugins: [{ name }] })[0].id, 'three-d-viewer');
  }
  assert.deepEqual(resolvePluginsFromSettings({ plugins: [{ name: 'threeDViewer', enabled: false }] }), []);
  assert.throws(() => resolvePluginsFromSettings({ plugins: [{ name: 'nope' }] }), /Unknown plugin "nope".*work-manager/);
});

test('registerPlugin makes a plugin available by name with its options and config directory', () => {
  const seen = [];
  registerPlugin({ name: 'fixture-registered', create: (options, context) => { seen.push([options, context]); return { id: 'fixture-registered' }; } });
  const plugins = resolvePluginsFromSettings({ plugins: [{ name: 'fixtureRegistered', options: { a: 1 } }] }, '/tmp/somewhere');
  assert.equal(plugins[0].id, 'fixture-registered');
  assert.deepEqual(seen, [[{ a: 1 }, { configDir: path.resolve('/tmp/somewhere') }]]);
  assert.throws(() => registerPlugin({ name: 'broken' }), /needs a name and a create/);
});

test('a module plugin adds Markdown syntax, transforms pages and serves its own client assets', async t => {
  const { configPath } = await project(t, [{ module: example, options: { wordsPerMinute: 100 } }]);
  const request = await listen(t, createApp({ configPath }));
  const page = await (await request('/note.md')).text();
  assert.match(page, /<mark>marked<\/mark>/);
  assert.match(page, /data-reading-time data-minutes="1"/);
  assert.match(page, /<script src="\/plugin-assets\/reading-time\/reading-time\.js" type="module">/);
  assert.match(page, /<link rel="stylesheet" href="\/plugin-assets\/reading-time\/reading-time\.css">/);
  const asset = await request('/plugin-assets/reading-time/reading-time.js');
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /min read/);
  assert.equal((await request('/plugin-assets/reading-time/../../kb.config.json')).status, 404);
  // The listing has no marker element, so the plugin's script is not loaded there.
  assert.doesNotMatch(await (await request('/')).text(), /plugin-assets/);
});

test('front matter names the page, yields tags and is not rendered', async t => {
  const { root } = await project(t, []);
  const page = await new KnowledgeBase({ contentRootPath: path.join(root, 'content') }).renderContent('note.md');
  assert.equal(page.title, 'Front matter title');
  assert.deepEqual(page.metadata.tags, ['alpha', 'beta']);
  assert.doesNotMatch(page.htmlContent, /Front matter title|tags:/);
  await fs.writeFile(path.join(root, 'content', 'rule.md'), '---\nJust a paragraph after a rule\n---\n# Real title');
  const ruled = await new KnowledgeBase({ contentRootPath: path.join(root, 'content') }).renderContent('rule.md');
  assert.equal(ruled.title, 'Real title');
  assert.match(ruled.htmlContent, /Just a paragraph after a rule/);
});

test('static builds copy module plugin assets and link them under the base URL', async t => {
  const { root, configPath } = await project(t, [{ module: example }]);
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  await fs.writeFile(configPath, JSON.stringify({ ...config, baseUrl: '/kb', search: { enabled: false } }));
  await buildSite({ configPath });
  assert.match(await fs.readFile(path.join(root, 'site', 'note.html'), 'utf8'), /src="\/kb\/plugin-assets\/reading-time\/reading-time\.js"/);
  await fs.access(path.join(root, 'site', 'plugin-assets', 'reading-time', 'reading-time.css'));
});

test('relations between plugins are checked when the application is created', async t => {
  const { root } = await project(t, []);
  const contentRootPath = path.join(root, 'content');
  await fs.writeFile(path.join(root, 'needs.cjs'), "module.exports = () => ({ id: 'needs', requiresStorage: ['missing'] });");
  await fs.writeFile(path.join(root, 'kb.plugins.json'), JSON.stringify({ plugins: [{ module: './needs.cjs' }] }));
  assert.match(checkProject({ configPath: path.join(root, 'kb.config.json') }).errors[0], /"needs" needs the storage provider "missing"/);
  assert.throws(() => new KnowledgeBase({ contentRootPath, plugins: [{ id: 'Bad Id', assetsDir: root }] }), /serves assets/);
  const page = await new KnowledgeBase({ contentRootPath, plugins: [{ id: 'full', transformPage: p => ({ ...p, metadata: { ...p.metadata, layout: 'fullscreen' } }) }] })
    .renderContent('note.md');
  const { TemplateContextBuilder } = require('../lib/services/TemplateContextBuilder');
  assert.equal(new TemplateContextBuilder({ contentRootPath }).build(page).page.fullscreen, true);
});

test('plugins contribute search documents; a failing contributor does not break search', async t => {
  const { root } = await project(t, []);
  const original = console.warn;
  console.warn = () => {};
  t.after(() => { console.warn = original; });
  const kb = new KnowledgeBase({ contentRootPath: path.join(root, 'content'), plugins: [
    { id: 'tasks', searchDocuments: () => [{ id: 't1', title: 'Купити цемент', body: 'цемент для фундаменту', url: '/tasks#t1' }] },
    { id: 'broken', searchDocuments: () => { throw new Error('offline'); } },
  ] });
  const payload = await kb.getSearchIndexService().buildAndGetIndex();
  assert.deepEqual(payload.documents.map(doc => doc.id).sort(), ['note.md', 'tasks:t1']);
  assert.equal(lunr.Index.load(payload.index).search('цемент')[0].ref, 'tasks:t1');
});

test('checkProject reports problems per plugin without starting anything', async t => {
  const previous = { ...process.env };
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  });
  for (const key of Object.keys(process.env)) if (key.startsWith('AUTH_') || key === 'KB_PLUGINS_CONFIG') delete process.env[key];

  const valid = await project(t, [{ name: 'threeDViewer' }, { module: example }]);
  assert.deepEqual(checkProject({ configPath: valid.configPath }), { errors: [], warnings: [], plugins: ['three-d-viewer', 'reading-time'] });
  assert.match(checkProject({ configPath: valid.configPath, requireAuthentication: true }).errors[0], /must be private/);

  const broken = await project(t, [
    { name: 'nope' }, { module: './missing.cjs' }, { name: 'passwordAuth' }, { module: example, options: { wordsPerMinute: 'fast' } },
  ]);
  const check = checkProject({ configPath: broken.configPath });
  assert.equal(check.errors.length, 4);
  assert.match(check.errors[0], /Unknown plugin "nope"/);
  assert.match(check.errors[1], /Cannot load plugin module "\.\/missing\.cjs"/);
  assert.match(check.errors[2], /Plugin "passwordAuth": invalid options or missing\/invalid environment variables/);
  assert.doesNotMatch(check.errors[3], /wordsPerMinute/);
  assert.match(checkProject({ configPath: broken.configPath, verbose: true }).errors[3], /wordsPerMinute must be an integer/);
  assert.match(checkProject({ configPath: path.join(broken.root, 'absent.json') }).errors[0], /No configuration file found/);
});

test('formulas pass through Markdown unchanged; prices are not formulas', async () => {
  const { MarkdownRenderer } = require('../lib/services/MarkdownRenderer');
  const render = async source => (await new MarkdownRenderer().render(source)).html;
  const inline = await render('Mass $m_a * m_b$ and $a \\, b$ with `$code$`.');
  assert.match(inline, /\$m_a \* m_b\$/);
  assert.match(inline, /\$a \\, b\$/);
  assert.match(inline, /<code>\$code\$<\/code>/);
  const block = await render('$$\n\\begin{aligned} a &< b \\\\ c_1 &= d_2 \\end{aligned}\n$$\n\nAfter *text*.');
  assert.match(block, /\$\$\n\\begin{aligned} a &amp;&lt; b \\\\ c_1 &amp;= d_2 \\end{aligned}\n\$\$/);
  assert.match(block, /<em>text<\/em>/);
  assert.match(await render('It costs $5 and **not** $10.'), /\$5 and <strong>not<\/strong> \$10/);
});

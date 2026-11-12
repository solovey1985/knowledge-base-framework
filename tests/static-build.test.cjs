const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { StaticSiteBuilder } = require('../lib/builders/StaticSiteBuilder');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-static-build-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const contentRootPath = path.join(root, 'content');
  const outputDir = path.join(root, 'site');
  await fs.mkdir(path.join(contentRootPath, 'authored'), { recursive: true });
  await fs.mkdir(path.join(contentRootPath, 'папка', 'nested'), { recursive: true });
  await fs.writeFile(path.join(contentRootPath, 'authored', 'index.md'), '# Authored marker');
  await fs.writeFile(path.join(contentRootPath, 'authored', 'data.txt'), 'attachment');
  await fs.writeFile(path.join(contentRootPath, 'папка', 'нотатка.md'), '# Note marker');
  await fs.writeFile(path.join(contentRootPath, 'папка', 'nested', 'deep.md'), '# Deep marker');
  const options = { contentRootPath, baseUrl: '/kb', isStaticSite: true, search: { enabled: false }, build: { outputDir } };
  const read = (...parts) => fs.readFile(path.join(outputDir, ...parts), 'utf8');
  return { contentRootPath, outputDir, options, read };
}

test('authored indexes are preserved and every directory without one gets a listing', async t => {
  const { contentRootPath, options, read } = await fixture(t);
  await fs.writeFile(path.join(contentRootPath, 'index.md'), '# Home marker\n\n[Authored](authored/index.md)');
  await new StaticSiteBuilder(options).build();

  const home = await read('index.html');
  assert.match(home, /<h1[^>]*>[\s\S]*?Home marker/);
  assert.match(home, /href="\/kb\/authored\/index\.html"/);
  assert.match(await read('authored', 'index.html'), /<h1[^>]*>[\s\S]*?Authored marker/);
  assert.equal(await read('authored', 'data.txt'), 'attachment');

  const listing = await read('папка', 'index.html');
  assert.doesNotMatch(listing, /Note marker/);
  assert.match(listing, /href="\/kb\/папка\/нотатка\.html"/);
  assert.match(await read('папка', 'nested', 'index.html'), /deep\.html/);

  // A document breadcrumb is a file link; its ancestors stay directories.
  const deep = await read('папка', 'nested', 'deep.html');
  assert.match(deep, /href="\/kb\/папка\/nested\/deep\.html"/);
  assert.match(deep, /href="\/kb\/папка\/nested\/"/);
  for (const html of [home, listing, deep]) assert.doesNotMatch(html, /href="[^"]+\.(md|html)\/"/);
});

test('root without an authored index falls back to the listing', async t => {
  const { options, read } = await fixture(t);
  await new StaticSiteBuilder(options).build();
  assert.match(await read('index.html'), /href="\/kb\/authored\/"/);
});

test('a page that cannot be rendered fails the build', async t => {
  const { options } = await fixture(t);
  const failing = { id: 'failing', contentRenderers: [{ id: 'failing-md', matches: file => file.endsWith('deep.md'),
    render: async () => { throw new Error('injected'); } }] };
  const original = console.error;
  console.error = () => {};
  t.after(() => { console.error = original; });
  await assert.rejects(new StaticSiteBuilder({ ...options, plugins: [failing] }).build(), /Cannot render page: .*deep\.md/);
});

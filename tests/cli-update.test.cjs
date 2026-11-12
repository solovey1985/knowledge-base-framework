const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const framework = require('../package.json');

test('update preserves custom application files and serve invokes its explicit entrypoint', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-cli-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'content'));
  const installed = path.join(root, 'node_modules', framework.name);
  await fs.mkdir(installed, { recursive: true });
  await fs.writeFile(path.join(installed, 'package.json'), JSON.stringify({ version: framework.version }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { [framework.name]: framework.version } }));
  const config = JSON.stringify({ contentRootPath: './content', server: { entrypoint: './local.cjs' } });
  await fs.writeFile(path.join(root, 'kb.config.json'), config);
  await fs.writeFile(path.join(root, 'local.cjs'), "exports.startServer = () => console.log('CUSTOM_BOOTSTRAP_OK');");
  for (const file of ['server.js', 'build.js', 'README.md', 'kb.plugins.json']) {
    await fs.writeFile(path.join(root, file), file === 'kb.plugins.json' ? '{"plugins":[]}' : 'preserve me');
  }
  const cli = path.resolve(__dirname, '../lib/cli/kb.js');
  const update = spawnSync(process.execPath, [cli, 'update'], { cwd: root, encoding: 'utf8' });
  assert.equal(update.status, 0, update.stderr);
  for (const file of ['server.js', 'build.js', 'README.md']) {
    assert.equal(await fs.readFile(path.join(root, file), 'utf8'), 'preserve me');
  }
  assert.equal(await fs.readFile(path.join(root, 'kb.config.json'), 'utf8'), config);
  assert.equal(await fs.readFile(path.join(root, 'kb.plugins.json'), 'utf8'), '{"plugins":[]}');
  const serve = spawnSync(process.execPath, [cli, 'serve'], { cwd: root, encoding: 'utf8' });
  assert.equal(serve.status, 0, serve.stderr);
  assert.match(serve.stdout, /CUSTOM_BOOTSTRAP_OK/);
});

test('update replaces only marked files, never the README, and --dry-run writes nothing', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-cli-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'content'));
  const installed = path.join(root, 'node_modules', framework.name);
  await fs.mkdir(installed, { recursive: true });
  await fs.writeFile(path.join(installed, 'package.json'), JSON.stringify({ version: framework.version }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { [framework.name]: framework.version } }));
  await fs.writeFile(path.join(root, 'kb.config.json'), JSON.stringify({ contentRootPath: './content' }));
  await fs.writeFile(path.join(root, 'kb.plugins.json'), '{"plugins":[]}');
  await fs.writeFile(path.join(root, 'server.js'), '// kb:managed - old generated version\nold();');
  await fs.writeFile(path.join(root, 'build.js'), 'my own build');
  await fs.writeFile(path.join(root, 'README.md'), 'my readme');
  const cli = path.resolve(__dirname, '../lib/cli/kb.js');
  const read = file => fs.readFile(path.join(root, file), 'utf8');

  const preview = spawnSync(process.execPath, [cli, 'update', '--dry-run'], { cwd: root, encoding: 'utf8' });
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /would replace server\.js/);
  assert.match(await read('server.js'), /old\(\)/);
  await assert.rejects(fs.access(path.join(root, 'assets')));

  const update = spawnSync(process.execPath, [cli, 'update'], { cwd: root, encoding: 'utf8' });
  assert.equal(update.status, 0, update.stderr);
  assert.match(await read('server.js'), /^\/\/ kb:managed[^\n]*\n[\s\S]*startServer/);
  assert.equal(await read('build.js'), 'my own build');
  assert.match(update.stdout, /build\.js kept/);
  assert.equal(await read('README.md'), 'my readme');

  const forced = spawnSync(process.execPath, [cli, 'update', '--force'], { cwd: root, encoding: 'utf8' });
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(await read('build.js'), /buildSite/);
  assert.equal(await read('README.md'), 'my readme');
});

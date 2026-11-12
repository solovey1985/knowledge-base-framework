const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FileService } = require('../lib/services/FileService');
const { NavigationService } = require('../lib/services/NavigationService');
const { TemplateContextBuilder } = require('../lib/services/TemplateContextBuilder');
const { TemplateRenderer } = require('../lib/services/TemplateRenderer');

test('folder identity survives empty/depth-limited children and renders independent toggles', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-nav-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'projects', 'nested'), { recursive: true });
  await fs.mkdir(path.join(root, 'empty'));
  await fs.writeFile(path.join(root, 'projects', 'nested', 'note.md'), '# Note');
  const service = new NavigationService(new FileService(root));
  const navigation = await service.generateNavigationMenu('', 3);
  const context = new TemplateContextBuilder({ contentRootPath: root, baseUrl: '/preview' }).build({
    title: 'Test', htmlContent: '<h1>Test</h1>', navigation, breadcrumbs: [], metadata: {},
  });
  const projects = context.navigation.find(item => item.path === 'projects');
  const empty = context.navigation.find(item => item.path === 'empty');
  assert.equal(projects.isDirectory, true);
  assert.equal(empty.isDirectory, true);
  assert.equal(empty.href, '/preview/empty/');
  const html = await new TemplateRenderer().render(context);
  assert.match(html, /data-kb-nav-toggle aria-expanded="false" aria-controls="kb-nav-/);
  assert.match(html, /aria-label="Toggle Projects"/);
  assert.match(html, /data-target-path="projects" href="\/preview\/projects\/"/);
  assert.match(html, /data-kb-nav-children hidden/);
  assert.doesNotMatch(html, /aria-label="Toggle Empty"/);
  const limited = await service.generateNavigationMenu('', 1);
  assert.equal(limited.find(item => item.path === 'projects').isDirectory, true);
});

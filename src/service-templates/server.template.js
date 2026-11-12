const express = require('express');
const fs = require('fs');
const path = require('path');
const { KnowledgeBase, loadPluginsFromFile } = require('@solovey1985/knowledge-base-framework');
const config = require('./kb.config.json');

const app = express();
app.set('trust proxy', 1);

const projectAssetsDir = path.resolve('{{ASSETS_DIR}}');
const frameworkRoot = path.dirname(require.resolve('@solovey1985/knowledge-base-framework/package.json'));
const frameworkAssetsDir = resolveFrameworkAssetsDir(frameworkRoot, projectAssetsDir);

const pluginsConfigPath = path.resolve(process.env.KB_PLUGINS_CONFIG || config.pluginsConfigPath || './kb.plugins.json');
const plugins = loadPluginsFromFile(pluginsConfigPath);

const kb = new KnowledgeBase({
  ...config,
  contentRootPath: path.resolve(config.contentRootPath),
  plugins,
  templates: {
    ...config.templates,
    assetsBasePath: config.templates?.assetsBasePath || '/framework-assets'
  }
});

kb.setupSecurity(app);
app.use('{{ASSETS_URL}}', express.static(projectAssetsDir, { fallthrough: false }));
app.use('/framework-assets', express.static(frameworkAssetsDir, { fallthrough: false }));

kb.setupMiddleware(app);

const PORT = config.server?.port || {{PORT}};
app.listen(PORT, () => {
  console.log(`📚 Knowledge Base running at http://localhost:${PORT}`);
});

function resolveFrameworkAssetsDir(frameworkRoot, fallbackDir) {
  const candidates = [
    path.join(frameworkRoot, 'templates', 'default', 'assets'),
    path.join(frameworkRoot, 'assets'),
    path.join(frameworkRoot, 'lib', 'templates', 'default', 'assets')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'kb-app.js'))) {
      return candidate;
    }
  }

  return fallbackDir;
}

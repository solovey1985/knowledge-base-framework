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

const auth = {
  enabled: process.env.KB_AUTH_ENABLED === 'true' || Boolean(config.auth?.enabled),
  username: process.env.KB_AUTH_USERNAME || config.auth?.username,
  password: process.env.KB_AUTH_PASSWORD || config.auth?.password,
  cookieName: process.env.KB_AUTH_COOKIE_NAME || config.auth?.cookieName || 'kb_auth',
  cookieSecret: process.env.KB_AUTH_COOKIE_SECRET || config.auth?.cookieSecret || '',
  loginPath: process.env.KB_AUTH_LOGIN_PATH || config.auth?.loginPath || '/login',
  logoutPath: process.env.KB_AUTH_LOGOUT_PATH || config.auth?.logoutPath || '/logout'
};

const pluginsConfigPath = path.resolve(process.env.KB_PLUGINS_CONFIG || config.pluginsConfigPath || './kb.plugins.json');
const plugins = loadPluginsFromFile(pluginsConfigPath);

app.use('{{ASSETS_URL}}', express.static(projectAssetsDir, { fallthrough: false }));
app.use('/framework-assets', express.static(frameworkAssetsDir, { fallthrough: false }));

const kb = new KnowledgeBase({
  ...config,
  contentRootPath: path.resolve(config.contentRootPath),
  plugins,
  auth,
  templates: {
    ...config.templates,
    assetsBasePath: config.templates?.assetsBasePath || '/framework-assets'
  }
});

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

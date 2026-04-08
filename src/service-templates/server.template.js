const express = require('express');
const path = require('path');
const { KnowledgeBase } = require('@solovey1985/knowledge-base-framework');
const config = require('./kb.config.json');

const app = express();
app.set('trust proxy', 1);

const projectAssetsDir = path.resolve('{{ASSETS_DIR}}');
const frameworkRoot = path.dirname(require.resolve('@solovey1985/knowledge-base-framework/package.json'));
const frameworkAssetsDir = path.join(frameworkRoot, 'templates', 'default', 'assets');

const auth = {
  enabled: process.env.KB_AUTH_ENABLED === 'true' || Boolean(config.auth?.enabled),
  username: process.env.KB_AUTH_USERNAME || config.auth?.username,
  password: process.env.KB_AUTH_PASSWORD || config.auth?.password,
  cookieName: process.env.KB_AUTH_COOKIE_NAME || config.auth?.cookieName || 'kb_auth',
  cookieSecret: process.env.KB_AUTH_COOKIE_SECRET || config.auth?.cookieSecret || '',
  loginPath: process.env.KB_AUTH_LOGIN_PATH || config.auth?.loginPath || '/login',
  logoutPath: process.env.KB_AUTH_LOGOUT_PATH || config.auth?.logoutPath || '/logout'
};

app.use('{{ASSETS_URL}}', express.static(projectAssetsDir));
app.use('/framework-assets', express.static(frameworkAssetsDir));

const kb = new KnowledgeBase({
  ...config,
  contentRootPath: path.resolve(config.contentRootPath),
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

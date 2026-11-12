// Operator-only UI acceptance host. All writes use an isolated temporary Drive workspace.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { KnowledgeBase, passwordAuthPlugin, hashPassword, googleDriveStoragePlugin, workManagerPlugin } = require('../lib');
(async () => {
  const credentials = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const workspace = 'wm-ui-' + crypto.randomBytes(8).toString('hex');
  Object.assign(process.env, {
    GOOGLE_DRIVE_CLIENT_ID: credentials.client_id, GOOGLE_DRIVE_CLIENT_SECRET: credentials.client_secret,
    GOOGLE_DRIVE_REFRESH_TOKEN: credentials.refresh_token, GOOGLE_DRIVE_TICKET_SECRET: crypto.randomBytes(32).toString('base64url'),
    AUTH_PASSWORD_HASH: await hashPassword('WM-local-test-only-2026'), AUTH_SIGNING_SECRET: crypto.randomBytes(32).toString('base64url'),
    AUTH_SESSION_VERSION: '1', AUTH_SITE_ID: workspace, AUTH_ORIGIN: 'http://127.0.0.1:3011',
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-wm-ui-'));
  fs.writeFileSync(path.join(root, 'projects.work-manager.md'), '---\nid: smoke-project\ntitle: Work Manager tasks\ndescription: Isolated project defined by YAML front matter.\n---\n');
  fs.writeFileSync(path.join(root, 'index.md'), '# Test workspace\n[Projects](projects.work-manager.md)');
  const drive = googleDriveStoragePlugin({ providerId: 'drive', workspaceId: workspace, rootFolderName: 'WM-02 UI TEST ' + workspace, backupKeep: 2 });
  const app = express();
  const kb = new KnowledgeBase({ contentRootPath: root, title: 'Work Manager test', search: { enabled: false },
    templates: { assetsBasePath: '/framework-assets' }, plugins: [passwordAuthPlugin({ allowInsecureLocalhost: true }), drive,
      workManagerPlugin({ storageProviderId: 'drive', draftNamespace: workspace })] });
  kb.setupSecurity(app);
  // Local acceptance only: fault controls never enter the packaged server.
  // "unavailable" rejects before storage; "lost-response" lets a PUT commit,
  // then drops its response to exercise read-only reconciliation in the browser.
  app.use('/api/work-manager', (req, res, next) => {
    const control = process.env.WM_SMOKE_FAULT_FILE;
    const mode = control && fs.existsSync(control) ? fs.readFileSync(control, 'utf8').trim() : '';
    if (mode === 'unavailable') {
      res.status(503).json({ error: { code: 'unavailable' } });
      return;
    }
    if (mode === 'lost-response' && req.method === 'PUT') {
      const json = res.json.bind(res);
      res.json = body => {
        if (res.statusCode < 400) {
          console.log('UI TEST: committed PUT response dropped');
          res.destroy();
          return res;
        }
        return json(body);
      };
    }
    next();
  });
  app.use('/framework-assets', express.static(path.join(__dirname, '../templates/default/assets')));
  kb.setupMiddleware(app);
  const server = app.listen(3011, '127.0.0.1', () => console.log('UI TEST READY http://127.0.0.1:3011/projects.work-manager.md'));
  server.on('error', () => { console.error('UI TEST PORT UNAVAILABLE'); process.exitCode = 1; });
  let closing = false;
  async function close() {
    if (closing) return; closing = true;
    server.close();
    try {
      const auth = new OAuth2Client(credentials.client_id, credentials.client_secret);
      auth.setCredentials({ refresh_token: credentials.refresh_token });
      const marker = crypto.createHash('sha256').update(`${workspace}:drive`).digest('hex');
      const query = new URLSearchParams({ q: `trashed=false and appProperties has { key='kbWorkspace' and value='${marker}' } and mimeType='application/vnd.google-apps.folder'`, fields: 'files(id,name)' });
      const result = await auth.request({ url: 'https://www.googleapis.com/drive/v3/files?' + query, timeout: 15000 });
      for (const folder of result.data.files) {
        if (folder.name !== 'WM-02 UI TEST ' + workspace) throw new Error('Unexpected folder');
        await auth.request({ url: 'https://www.googleapis.com/drive/v3/files/' + folder.id, method: 'PATCH', data: { trashed: true }, timeout: 15000 });
      }
      console.log('UI TEST CLEANUP: isolated Drive folders moved to trash');
    } catch { console.error('UI TEST CLEANUP PENDING for workspace ' + workspace); process.exitCode = 1; }
    fs.rmSync(root, { recursive: true, force: true });
    process.exit(process.exitCode || 0);
  }
  if (process.env.WM_SMOKE_STOP_FILE) setInterval(() => { if (fs.existsSync(process.env.WM_SMOKE_STOP_FILE)) void close(); }, 1000);
  process.on('SIGINT', close);
  process.stdin.on('data', chunk => { if (chunk.toString().includes('stop')) void close(); });
  setTimeout(close, 30 * 60 * 1000);
})().catch(() => { console.error('UI TEST INITIALIZATION FAILED'); process.exitCode = 1; });

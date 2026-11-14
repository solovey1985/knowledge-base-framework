const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

// Each scenario runs in a child process: the regression is a process that never
// exits, which an in-process test cannot observe without hanging the runner.
const LIB = JSON.stringify(path.join(__dirname, '..', 'lib'));

const scenarios = {
  'a ContentWatcher whose root is deleted without close() does not keep the process alive': `
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const { ContentWatcher } = require(path.join(${LIB}, 'services', 'ContentWatcher'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-watcher-'));
    fs.mkdirSync(path.join(root, 'notes'));
    fs.writeFileSync(path.join(root, 'notes', 'a.md'), '# A');
    const watcher = new ContentWatcher(root);
    if (!watcher.start()) process.exit(0); // recursive watching unavailable: nothing to leak
    setTimeout(() => fs.promises.rm(root, { recursive: true, force: true }), 200);
  `,
  'createApp whose content root is deleted without knowledgeBase.close() does not keep the process alive': `
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const { createApp } = require(${LIB});
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-watcher-app-'));
    fs.mkdirSync(path.join(root, 'content'));
    fs.writeFileSync(path.join(root, 'content', 'index.md'), '# Fixture');
    fs.writeFileSync(path.join(root, 'kb.config.json'), JSON.stringify({
      contentRootPath: './content', title: 'Fixture', search: { enabled: false },
    }));
    createApp({ configPath: path.join(root, 'kb.config.json') });
    setTimeout(() => fs.promises.rm(root, { recursive: true, force: true }), 200);
  `,
};

function runToExit(source, timeoutMs) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stderr }); });
  });
}

for (const [name, source] of Object.entries(scenarios)) {
  test(name, async () => {
    const result = await runToExit(source, 10_000);
    assert.equal(result.signal, null, `child did not exit within 10s and was killed\n${result.stderr}`);
    assert.equal(result.code, 0, result.stderr);
  });
}

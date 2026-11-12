const path = require('path');
const { startServer } = require('@solovey1985/knowledge-base-framework');

// The framework owns middleware order, the /healthz liveness route and plugin loading.
// PORT, HOST and KB_PLUGINS_CONFIG may be set in the environment.
if (require.main === module) {
  startServer({ configPath: path.join(__dirname, 'kb.config.json') });
}

module.exports = { startServer };

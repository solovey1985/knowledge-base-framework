const express = require('express');
const path = require('path');
const { KnowledgeBase } = require('@solovey1985/knowledge-base-framework');
const config = require('./kb.config.json');

const app = express();

// Static assets directory (served at {{ASSETS_URL}})
app.use('{{ASSETS_URL}}', express.static('{{ASSETS_DIR}}'));

// Initialize Knowledge Base
const kb = new KnowledgeBase({
  ...config,
  contentRootPath: path.resolve(config.contentRootPath)
});

// Setup Knowledge Base middleware
kb.setupMiddleware(app);

const PORT = config.server.port || {{PORT}};
app.listen(PORT, () => {
  console.log(`📚 Knowledge Base running at http://localhost:${PORT}`);
});

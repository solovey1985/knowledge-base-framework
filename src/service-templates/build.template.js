const path = require('path');
const { buildSite } = require('@solovey1985/knowledge-base-framework');

// Loads the same configuration and plugins as the server. A site that requires
// authentication is never exported, and any page failure fails the build.
buildSite({ configPath: path.join(__dirname, 'kb.config.json') }).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

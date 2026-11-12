const path = require('path');
const { StaticSiteBuilder, loadPluginsFromFile } = require('@solovey1985/knowledge-base-framework');
const config = require('./kb.config.json');

async function build() {
  // Plugins must be loaded here too: the builder refuses to export a site that
  // needs authentication, and plugin renderers produce their pages.
  const pluginsConfigPath = path.resolve(process.env.KB_PLUGINS_CONFIG || config.pluginsConfigPath || './kb.plugins.json');
  const builder = new StaticSiteBuilder({
    ...config,
    plugins: loadPluginsFromFile(pluginsConfigPath),
    contentRootPath: path.resolve(config.contentRootPath),
    isStaticSite: true
  });

  await builder.build();
}

build().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

const path = require('path');
const { StaticSiteBuilder } = require('@solovey1985/knowledge-base-framework');
const config = require('./kb.config.json');

async function build() {
  const builder = new StaticSiteBuilder({
    ...config,
    contentRootPath: path.resolve(config.contentRootPath),
    isStaticSite: true
  });

  await builder.build();
}

build().catch(console.error);

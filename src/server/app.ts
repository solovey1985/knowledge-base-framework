import express, { Express } from 'express';
import { existsSync, readFileSync } from 'fs';
import type { Server } from 'http';
import * as path from 'path';
import { StaticSiteBuilder } from '../builders/StaticSiteBuilder';
import { KnowledgeBaseOptions } from '../core/interfaces';
import { KnowledgeBase } from '../core/KnowledgeBase';
import { KnowledgeBasePlugin } from '../core/plugins';
import { loadPluginsFromFile } from '../plugins/pluginSettings';

const CONFIG_CANDIDATES = ['kb.config.json', 'knowledge-base.config.json', 'config.json'];

export interface ProjectOptions {
  /** Path to kb.config.json. Default: the first known config file in the working directory. */
  configPath?: string;
  /** Configuration object; skips reading configPath. Relative paths resolve against configDir. */
  config?: KnowledgeBaseOptions;
  /** Directory that relative paths in the configuration refer to. Default: the config file's directory. */
  configDir?: string;
  /** Resolved plugins; skips the plugin settings file. */
  plugins?: KnowledgeBasePlugin[];
  /** Plugin settings file; overrides KB_PLUGINS_CONFIG and config.pluginsConfigPath. */
  pluginsConfigPath?: string;
}

export interface StartServerOptions extends ProjectOptions {
  port?: number;
  host?: string;
}

export interface ResolvedProject {
  config: KnowledgeBaseOptions;
  configDir: string;
  plugins: KnowledgeBasePlugin[];
}

/** One resolution of configuration and plugins for the CLI, generated projects and custom hosts. */
export function resolveProject(options: ProjectOptions = {}): ResolvedProject {
  let config = options.config;
  let configDir = options.configDir;

  if (!config) {
    const configPath = options.configPath
      ? path.resolve(options.configPath)
      : CONFIG_CANDIDATES.map(candidate => path.resolve(candidate)).find(candidate => existsSync(candidate));
    if (!configPath || !existsSync(configPath)) {
      throw new Error('No configuration file found. Create kb.config.json or run "kb init".');
    }
    config = JSON.parse(readFileSync(configPath, 'utf-8')) as KnowledgeBaseOptions;
    configDir = configDir || path.dirname(configPath);
  }

  configDir = path.resolve(configDir || process.cwd());
  if (!config.contentRootPath || typeof config.contentRootPath !== 'string') {
    throw new Error('Configuration must include a "contentRootPath" string.');
  }

  const plugins = options.plugins || loadPluginsFromFile(path.resolve(
    configDir,
    options.pluginsConfigPath || process.env.KB_PLUGINS_CONFIG || config.pluginsConfigPath || './kb.plugins.json'
  ));

  return {
    config: { ...config, contentRootPath: path.resolve(configDir, config.contentRootPath) },
    configDir,
    plugins
  };
}

/**
 * Express application with the framework's fixed middleware order:
 * liveness, authentication, static assets, plugin routes, content.
 */
export function createApp(options: ProjectOptions = {}): Express {
  const { config, configDir, plugins } = resolveProject(options);
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const knowledgeBase = new KnowledgeBase({
    ...config,
    plugins,
    templates: {
      ...config.templates,
      assetsBasePath: config.templates?.assetsBasePath || '/framework-assets'
    }
  });

  // Only process liveness is public: no content, configuration or storage diagnostics.
  const healthPath = config.server?.healthPath === undefined ? '/healthz' : config.server.healthPath;
  if (healthPath) {
    app.get(healthPath, (_req, res) => { res.set('Cache-Control', 'no-store').status(204).end(); });
  }

  knowledgeBase.setupSecurity(app);
  const projectAssetsDir = path.resolve(configDir, 'assets');
  app.use('/assets', express.static(projectAssetsDir, { fallthrough: false }));
  app.use('/framework-assets', express.static(resolveFrameworkAssetsDir(projectAssetsDir), { fallthrough: false }));
  knowledgeBase.setupMiddleware(app);

  app.locals.knowledgeBase = knowledgeBase;
  return app;
}

/** PORT and HOST come from the environment first, so hosting platforms need no code changes. */
export function startServer(options: StartServerOptions = {}): Server {
  const project = resolveProject(options);
  const app = createApp({ config: project.config, configDir: project.configDir, plugins: project.plugins });
  const port = Number(options.port ?? process.env.PORT ?? project.config.server?.port ?? 3000);
  const host = options.host ?? process.env.HOST ?? project.config.server?.host;
  const onListening = () => console.log(`📚 Knowledge Base running at http://${host || 'localhost'}:${port}`);
  return host ? app.listen(port, host, onListening) : app.listen(port, onListening);
}

/** Static export. Refuses, before touching the output directory, a site that needs authentication. */
export async function buildSite(options: ProjectOptions = {}): Promise<void> {
  const { config, plugins } = resolveProject(options);
  const builder = new StaticSiteBuilder({ ...config, plugins, isStaticSite: true });
  await builder.build();
}

function resolveFrameworkAssetsDir(fallbackDir: string): string {
  const frameworkRoot = path.resolve(__dirname, '..', '..');
  const candidates = [
    path.join(frameworkRoot, 'templates', 'default', 'assets'),
    path.join(frameworkRoot, 'assets'),
    path.join(frameworkRoot, 'lib', 'templates', 'default', 'assets')
  ];
  return candidates.find(candidate => existsSync(path.join(candidate, 'kb-app.js'))) || fallbackDir;
}

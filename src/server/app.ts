import express, { Express } from 'express';
import { existsSync, readFileSync } from 'fs';
import type { Server } from 'http';
import * as path from 'path';
import { StaticSiteBuilder } from '../builders/StaticSiteBuilder';
import { KnowledgeBaseOptions } from '../core/interfaces';
import { KnowledgeBase } from '../core/KnowledgeBase';
import { KnowledgeBasePlugin } from '../core/plugins';
import { loadPluginsFromFile, PluginSettingsFile, resolvePluginEntries } from '../plugins/pluginSettings';

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

export interface CheckProjectOptions extends Omit<ProjectOptions, 'plugins'> {
  /** Fail when no authentication plugin is enabled (a deployment that must be private). */
  requireAuthentication?: boolean;
  /** Include the plugins' own error messages. Off by default: they may quote configuration values. */
  verbose?: boolean;
}

export interface ProjectCheck {
  errors: string[];
  warnings: string[];
  /** Enabled plugin ids, in load order. */
  plugins: string[];
}

/**
 * Validates configuration, plugin options and the relations between plugins without
 * starting a server and without network requests. Never throws for a project problem.
 */
export function checkProject(options: CheckProjectOptions = {}): ProjectCheck {
  const result: ProjectCheck = { errors: [], warnings: [], plugins: [] };
  let project: ResolvedProject;
  try {
    project = resolveProject({ ...options, plugins: [] });
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    return result;
  }

  const { config, configDir } = project;
  if (!existsSync(config.contentRootPath)) {
    result.errors.push(`Content directory does not exist: ${config.contentRootPath}`);
  }
  if (config.auth?.enabled) {
    result.errors.push('The "auth" block is no longer supported. Enable the passwordAuth plugin instead.');
  }

  const settingsPath = path.resolve(
    configDir,
    options.pluginsConfigPath || process.env.KB_PLUGINS_CONFIG || config.pluginsConfigPath || './kb.plugins.json'
  );
  let settings: PluginSettingsFile = {};
  if (!existsSync(settingsPath)) {
    result.warnings.push(`No plugin settings file at ${settingsPath}; running without plugins.`);
  } else {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as PluginSettingsFile;
      if (!settings || typeof settings !== 'object' || (settings.plugins !== undefined && !Array.isArray(settings.plugins))) {
        throw new Error('"plugins" must be an array');
      }
    } catch (error) {
      result.errors.push(`Invalid plugin settings file ${settingsPath}: ${error instanceof Error ? error.message : error}`);
      return result;
    }
  }

  const plugins: KnowledgeBasePlugin[] = [];
  for (const resolution of resolvePluginEntries(settings, path.dirname(settingsPath))) {
    if (resolution.plugin) {
      plugins.push(resolution.plugin);
      result.plugins.push(resolution.plugin.id);
      continue;
    }
    const message = resolution.error?.message || '';
    const structural = /^(Unknown plugin|Cannot load plugin module|Plugin module|Plugin "module")/.test(message);
    result.errors.push(structural || options.verbose
      ? message
      : `Plugin "${resolution.label}": invalid options or missing/invalid environment variables (use --verbose for the plugin's message).`);
  }

  for (const plugin of plugins) {
    if (plugin.assetsDir && !existsSync(plugin.assetsDir)) {
      result.errors.push(`Plugin "${plugin.id}": assets directory does not exist: ${plugin.assetsDir}`);
    } else if (plugin.assetsDir && plugin.clientEntry && !existsSync(path.join(plugin.assetsDir, plugin.clientEntry.file))) {
      result.errors.push(`Plugin "${plugin.id}": client entry ${plugin.clientEntry.file} is missing from its assets directory.`);
    }
  }

  if (options.requireAuthentication && !plugins.some(plugin => plugin.authentication)) {
    result.errors.push('This deployment must be private, but no authentication plugin is enabled.');
  }

  if (!result.errors.length) {
    try {
      // The constructor checks relations: one authentication provider, plugins that need
      // authentication or a storage provider, asset ids.
      const knowledgeBase = new KnowledgeBase({ ...config, plugins });
      // The server reports a missing provider only when routes are registered; say it here, by name.
      for (const plugin of plugins) {
        for (const providerId of plugin.requiresStorage || []) {
          if (!knowledgeBase.storage.ids().includes(providerId)) {
            result.errors.push(`Plugin "${plugin.id}" needs the storage provider "${providerId}", which no enabled plugin provides.`);
          }
        }
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return result;
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

import fs from 'fs';
import path from 'path';
import { KnowledgeBasePlugin } from '../core/plugins';
import { findPluginDefinition, PluginCreateContext, registeredPluginNames } from '../core/pluginRegistry';
import './builtins';

export interface PluginSettingsEntry {
  /** Registered plugin name. Optional when "module" is given. */
  name?: string;
  /** Path (relative to the settings file) or package name of a module exporting a plugin factory. */
  module?: string;
  enabled?: boolean;
  options?: Record<string, unknown>;
}

export interface PluginSettingsFile {
  plugins?: PluginSettingsEntry[];
}

export interface PluginResolution {
  entry: PluginSettingsEntry;
  /** Display name: the entry name or its module. */
  label: string;
  plugin?: KnowledgeBasePlugin;
  error?: Error;
}

export function loadPluginsFromFile(settingsPath: string): KnowledgeBasePlugin[] {
  const absolutePath = path.resolve(settingsPath);
  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf-8')) as PluginSettingsFile;
  return resolvePluginsFromSettings(parsed, path.dirname(absolutePath));
}

export function resolvePluginsFromSettings(settings: PluginSettingsFile, baseDir: string = process.cwd()): KnowledgeBasePlugin[] {
  return resolvePluginEntries(settings, baseDir).map(resolution => {
    if (resolution.error) throw resolution.error;
    return resolution.plugin!;
  });
}

/** Resolves every enabled entry and reports failures per entry instead of stopping at the first. */
export function resolvePluginEntries(settings: PluginSettingsFile, baseDir: string = process.cwd()): PluginResolution[] {
  const context: PluginCreateContext = { configDir: path.resolve(baseDir) };
  const results: PluginResolution[] = [];
  for (const entry of settings.plugins || []) {
    if (!entry || entry.enabled === false) {
      continue;
    }
    const label = entry.name || entry.module || '(unnamed)';
    try {
      const factory = entry.module ? loadModuleFactory(entry.module, context.configDir) : registeredFactory(entry.name);
      const plugin = factory(entry.options || {}, context);
      if (!plugin || typeof plugin !== 'object' || typeof plugin.id !== 'string' || !plugin.id) {
        throw new Error(`Plugin "${label}" did not return a plugin object with an id.`);
      }
      results.push({ entry, label, plugin });
    } catch (error) {
      results.push({ entry, label, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }
  return results;
}

type PluginFactory = (options: Record<string, unknown>, context: PluginCreateContext) => KnowledgeBasePlugin;

function registeredFactory(name: string | undefined): PluginFactory {
  const definition = name ? findPluginDefinition(name) : undefined;
  if (!definition) {
    throw new Error(`Unknown plugin "${name ?? ''}" in plugin settings. Registered: ${registeredPluginNames().join(', ')}. ` +
      'A plugin of your own is referenced with "module".');
  }
  return (options, context) => definition.create(options, context);
}

/**
 * A module may export the factory itself, { default }, { plugin } or a definition { name, create }.
 * Only modules named in the project's own settings file are loaded.
 */
function loadModuleFactory(specifier: string, baseDir: string): PluginFactory {
  if (typeof specifier !== 'string' || !specifier.trim()) {
    throw new Error('Plugin "module" must be a path or a package name.');
  }
  let loaded: any;
  try {
    const target = specifier.startsWith('.') || path.isAbsolute(specifier)
      ? path.resolve(baseDir, specifier)
      : require.resolve(specifier, { paths: [baseDir] });
    loaded = require(target);
  } catch (error) {
    throw new Error(`Cannot load plugin module "${specifier}": ${error instanceof Error ? error.message : error}`);
  }
  const candidate = loaded?.default ?? loaded;
  const factory = typeof candidate === 'function' ? candidate
    : typeof candidate?.create === 'function' ? candidate.create.bind(candidate)
    : typeof loaded?.plugin === 'function' ? loaded.plugin
    : undefined;
  if (!factory) {
    throw new Error(`Plugin module "${specifier}" must export a factory function (options, context) => plugin.`);
  }
  return factory;
}

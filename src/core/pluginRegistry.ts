import type { KnowledgeBasePlugin } from './plugins';

export interface PluginCreateContext {
  /** Directory of the plugin settings file; relative paths in options resolve against it. */
  configDir: string;
}

export interface PluginDefinition<Options = Record<string, unknown>> {
  /** Canonical kebab-case name, e.g. "work-manager". Matching ignores case, separators and a "Plugin" suffix. */
  name: string;
  aliases?: string[];
  /** Validates options and environment, then returns the plugin. Must not perform network requests. */
  create(options: Options, context: PluginCreateContext): KnowledgeBasePlugin;
}

const definitions = new Map<string, PluginDefinition<any>>();

/** "threeDViewer", "three-d-viewer" and "ThreeDViewerPlugin" are the same name. */
export function pluginNameKey(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/plugin$/, '');
}

/** Makes a plugin available to kb.plugins.json by name. Registering the same name again replaces it. */
export function registerPlugin<Options = Record<string, unknown>>(definition: PluginDefinition<Options>): void {
  if (!definition || typeof definition.create !== 'function' || !pluginNameKey(definition.name)) {
    throw new Error('A plugin definition needs a name and a create() function.');
  }
  for (const name of [definition.name, ...(definition.aliases || [])]) {
    definitions.set(pluginNameKey(name), definition);
  }
}

export function findPluginDefinition(name: string): PluginDefinition<any> | undefined {
  return definitions.get(pluginNameKey(name));
}

export function registeredPluginNames(): string[] {
  return [...new Set([...definitions.values()].map(definition => definition.name))].sort();
}

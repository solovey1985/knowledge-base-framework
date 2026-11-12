export { KnowledgeBase } from './core/KnowledgeBase';
export { FileService } from './services/FileService';
export { NavigationService } from './services/NavigationService';
export { MarkdownRenderer } from './services/MarkdownRenderer';
export { GitService } from './services/GitService';
export { StaticSiteBuilder } from './builders/StaticSiteBuilder';
export { TemplateRenderer } from './services/TemplateRenderer';
export { SearchIndexService } from './services/SearchIndexService';
export { PluginManager } from './services/PluginManager';
export { createApp, startServer, buildSite, resolveProject, checkProject } from './server/app';
export type { ProjectOptions, StartServerOptions, ResolvedProject, CheckProjectOptions, ProjectCheck } from './server/app';
export { interviewPrepPlugin } from './plugins/interviewPrepPlugin';
export { techMemoryPlugin } from './plugins/techMemoryPlugin';
export { threeDViewerPlugin } from './plugins/threeDViewerPlugin';
export { loadPluginsFromFile, resolvePluginsFromSettings, resolvePluginEntries } from './plugins/pluginSettings';
export type { PluginSettingsEntry, PluginSettingsFile, PluginResolution } from './plugins/pluginSettings';
export { registerPlugin, findPluginDefinition, registeredPluginNames } from './core/pluginRegistry';
export type { PluginDefinition, PluginCreateContext } from './core/pluginRegistry';

export * from './core/interfaces';
export * from './core/models';
export * from './core/plugins';

// Re-export for convenience
export type {
  KnowledgeBaseOptions,
  NavigationOptions,
  ServerOptions,
  BuildOptions,
  TemplateOptions,
  SearchOptions
} from './core/interfaces';

export type {
  ContentItem,
  NavigationItem,
  RenderedContent,
  TocItem,
  GitCommitInfo
} from './core/models';

export { passwordAuthPlugin, PasswordAuthOptions } from './plugins/password-auth';
export { hashPassword } from './plugins/password-auth/password-service';
export * from './core/storage';
export { splitFrontMatter, frontMatterTags } from './core/frontMatter';
export { googleDriveStoragePlugin, GoogleDriveStorageOptions } from './plugins/google-drive-storage';
export { workManagerPlugin, WorkManagerOptions } from './plugins/work-manager';
export { notesPlugin, NotesOptions } from './plugins/notes';
export { WorkProject, WorkTask, validateProject } from './plugins/work-manager/model';

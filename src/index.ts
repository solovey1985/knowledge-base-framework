export { KnowledgeBase } from './core/KnowledgeBase';
export { FileService } from './services/FileService';
export { NavigationService } from './services/NavigationService';
export { MarkdownRenderer } from './services/MarkdownRenderer';
export { GitService } from './services/GitService';
export { StaticSiteBuilder } from './builders/StaticSiteBuilder';
export { TemplateRenderer } from './services/TemplateRenderer';
export { SearchIndexService } from './services/SearchIndexService';

export * from './core/interfaces';
export * from './core/models';

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

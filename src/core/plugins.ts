import type { ContentItem, RenderedContent } from './models';
import type { FileService } from '../services/FileService';

export interface PluginClientAssets {
  css?: string[];
  js?: string[];
}

export interface PluginDirectoryRenderInfo {
  href: string;
  targetBlank?: boolean;
  meta?: string;
  section?: string;
  sectionTitle?: string;
}

export interface PluginRenderContext {
  requestPath: string;
  extension: string;
  fileService: FileService;
  readFile: (relativePath: string) => Promise<string>;
  renderMarkdown: (markdown: string, currentPath?: string) => Promise<{ html: string; tableOfContents: import('./models').TocItem[] }>;
  getStats: (relativePath: string) => Promise<{ size: number; lastModified: Date } | null>;
  buildRawContentUrl: (relativePath: string) => string;
  buildFriendlyUrl: (relativePath: string, type: 'directory' | 'markdown' | 'text' | 'app') => string;
  composeContentResponse: (
    targetPath: string,
    title: string,
    html: string,
    description?: string,
    metadata?: Record<string, unknown>
  ) => Promise<RenderedContent>;
}

export interface PluginDirectoryContext {
  entry: ContentItem;
  defaultHref: string;
  friendlyHref: string;
}

export interface ContentRendererPlugin {
  id: string;
  extensions?: string[];
  matches?: (requestPath: string, extension: string) => boolean;
  render: (context: PluginRenderContext) => Promise<RenderedContent | null>;
  renderDirectoryItem?: (context: PluginDirectoryContext) => PluginDirectoryRenderInfo | null;
}

export interface KnowledgeBasePlugin {
  id: string;
  contentRenderers?: ContentRendererPlugin[];
  clientAssets?: PluginClientAssets;
}

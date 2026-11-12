import type { Express, RequestHandler } from 'express';
import type { MarkedExtension } from 'marked';
import type { ContentItem, RenderedContent } from './models';
import type { FileService } from '../services/FileService';
import type { StorageProvider, StorageRegistry } from './storage';

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

/** What a plugin sees when it post-processes a rendered Markdown page. */
export interface PluginPageContext {
  /** Content-relative path of the document, with forward slashes. */
  requestPath: string;
  /** The Markdown source without front matter. */
  markdown: string;
  /** Parsed YAML front matter, or an empty object. */
  frontMatter: Record<string, unknown>;
  fileService: FileService;
  isStaticSite: boolean;
  /** Link to a document of this site, valid in server and static mode. */
  buildDocumentUrl: (relativePath: string) => string;
}

export interface PluginSearchDocument {
  /** Unique within the plugin. */
  id: string;
  title: string;
  /** Plain text to index. */
  body: string;
  /** Where the result leads. */
  url: string;
  snippet?: string;
}

export interface PluginSearchContext {
  fileService: FileService;
  isStaticSite: boolean;
  buildDocumentUrl: (relativePath: string) => string;
}

export interface KnowledgeBasePlugin {
  /** Unique id. Lowercase letters, digits and hyphens when the plugin serves assets. */
  id: string;
  contentRenderers?: ContentRendererPlugin[];
  clientAssets?: PluginClientAssets;
  /**
   * ESM entry, emitted only on a rendered page that contains an element carrying the marker
   * attribute. Built-in plugins name a framework asset (kb-plugin-<name>.js); a plugin with
   * assetsDir names a file inside that directory.
   */
  clientEntry?: { file: string; marker: string; cssFile?: string };
  /** Further entries with their own markers, for a plugin with more than one kind of page. */
  clientEntries?: Array<{ file: string; marker: string; cssFile?: string }>;
  /** Absolute directory served at /plugin-assets/<id>/ (after authentication) and copied by static builds. */
  assetsDir?: string;
  /** marked extensions applied to every Markdown render (custom syntax, tokenizers, renderers). */
  markdownExtensions?: MarkedExtension[];
  /** Post-processes a rendered Markdown document; return the changed page or nothing. */
  transformPage?: (page: RenderedContent, context: PluginPageContext) => Promise<RenderedContent | void> | RenderedContent | void;
  /** Extra documents for the search index. A failure here is logged and never breaks search. */
  searchDocuments?: (context: PluginSearchContext) => Promise<PluginSearchDocument[]> | PluginSearchDocument[];
  /** Called on a server when content files change, so a plugin can drop what it derived from them. */
  onContentChange?: (relativePath: string | null) => void;
  /** Storage provider ids this plugin reads or writes; reported by name in "kb doctor". */
  requiresStorage?: string[];
  /** Runs before all content, API and static routes. At most one authentication provider. */
  authentication?: { middleware: RequestHandler };
  storageProviders?: StorageProvider[];
  /** Writable applications must never silently become public when auth is disabled. */
  requiresAuthentication?: boolean;
  /** Registers protected server routes after authentication. */
  setupServer?: (app: Express, context: { storage: StorageRegistry; contentRootPath: string }) => void;
}

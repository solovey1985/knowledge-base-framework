import { NavigationItem } from './models';

export interface KnowledgeBaseOptions {
  /** The root directory containing the content files */
  contentRootPath: string;
  
  /** The base URL for the application (for static site generation) */
  baseUrl?: string;
  
  /** Whether this is being built as a static site */
  isStaticSite?: boolean;
  
  /** Title of the knowledge base */
  title?: string;
  
  /** Description of the knowledge base */
  description?: string;
  
  /** Author information */
  author?: string;
  
  /** Enable LaTeX math rendering */
  enableMath?: boolean;
  
  /** Enable Mermaid diagram rendering */
  enableMermaid?: boolean;
  
  /** Enable syntax highlighting */
  enableSyntaxHighlighting?: boolean;
  
  /** Custom CSS files to include */
  customCssFiles?: string[];
  
  /** Custom JavaScript files to include */
  customJsFiles?: string[];
  
  /** Navigation configuration */
  navigation?: NavigationOptions;
  
  /** Server configuration */
  server?: ServerOptions;
  
  /** Build configuration */
  build?: BuildOptions;

  /** Template customization options */
  templates?: TemplateOptions;

  /** Search configuration */
  search?: SearchOptions;
}

export interface NavigationOptions {
  /** Maximum depth for automatic navigation generation */
  maxDepth?: number;
  
  /** Whether to show file extensions in navigation */
  showExtensions?: boolean;
  
  /** Files to exclude from navigation */
  excludePatterns?: string[];
  
  /** Custom navigation file name */
  navigationFileName?: string;
  
  /** Custom sorting function for navigation items */
  sortFunction?: (a: NavigationItem, b: NavigationItem) => number;
}

export interface ServerOptions {
  /** Port to run the development server on */
  port?: number;
  
  /** Host to bind the server to */
  host?: string;
  
  /** Enable live reload during development */
  liveReload?: boolean;
  
  /** Watch for file changes */
  watch?: boolean;
}

export interface BuildOptions {
  /** Output directory for static site build */
  outputDir?: string;
  
  /** Deployment target (local, github, custom) */
  target?: 'local' | 'github' | 'custom';
  
  /** Clean output directory before build */
  clean?: boolean;
  
  /** Generate sitemap.xml */
  generateSitemap?: boolean;
  
  /** Generate robots.txt */
  generateRobots?: boolean;
}

export interface TemplateOptions {
  /** Directory containing layout + partial templates */
  directory?: string;

  /** Custom layout filename */
  layout?: string;

  /** Custom partials directory */
  partialsDir?: string;

  /** Override public assets base path */
  assetsBasePath?: string;
}

export interface SearchOptions {
  /** Enable or disable built-in search */
  enabled?: boolean;

  /** Output filename for the search index */
  indexFileName?: string;
}

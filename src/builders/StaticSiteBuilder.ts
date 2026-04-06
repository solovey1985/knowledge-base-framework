import * as fs from 'fs/promises';
import * as path from 'path';
import lunr from 'lunr';
import { KnowledgeBase } from '../core/KnowledgeBase';
import { KnowledgeBaseOptions, TemplateOptions } from '../core/interfaces';
import { FileService } from '../services/FileService';
import { TemplateRenderer, TemplateRenderContext, TemplateRendererOptions } from '../services/TemplateRenderer';

/**
 * Static site builder for knowledge base
 */
interface SearchDocument {
  id: string;
  title: string;
  body: string;
  url: string;
  snippet: string;
}

export class StaticSiteBuilder {
  private knowledgeBase: KnowledgeBase;
  private options: KnowledgeBaseOptions;
  private templateRenderer: TemplateRenderer;

  constructor(options: KnowledgeBaseOptions) {
    // Force static site mode
    this.options = {
      ...options,
      isStaticSite: true
    };
    this.knowledgeBase = new KnowledgeBase(this.options);
    this.templateRenderer = new TemplateRenderer(this.resolveTemplateOptions(this.options.templates));
  }

  /**
   * Build static site
   */
  async build(): Promise<void> {
    console.log('🔨 Building static site...');
    
    const outputDir = this.options.build?.outputDir || './docs';
    
    // Clean output directory if requested
    if (this.options.build?.clean !== false) {
      await this.cleanOutputDirectory(outputDir);
    }

    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });

    // Build all pages
    await this.buildPages(outputDir);

    // Copy assets
    await this.copyAssets(outputDir);

    // Build search index
    await this.buildSearchIndex(outputDir);

    // Generate additional files
    if (this.options.build?.generateSitemap) {
      await this.generateSitemap(outputDir);
    }

    if (this.options.build?.generateRobots) {
      await this.generateRobots(outputDir);
    }

    console.log('✅ Static site build completed!');
  }

  /**
   * Clean output directory
   */
  private async cleanOutputDirectory(outputDir: string): Promise<void> {
    try {
      console.log('🧹 Cleaning output directory...');
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch (error) {
      // Directory might not exist, that's okay
    }
  }

  /**
   * Build all pages recursively
   */
  private async buildPages(outputDir: string, currentPath: string = ''): Promise<void> {
    const fileService = this.knowledgeBase.getFileService();
    
    try {
      const items = await fileService.getDirectoryListing(currentPath);
      
      for (const item of items) {
        if (item.isDirectory) {
          // Create directory in output
          const dirOutputPath = path.join(outputDir, item.path);
          await fs.mkdir(dirOutputPath, { recursive: true });
          
          // Recursively build subdirectory
          await this.buildPages(outputDir, item.path);
          
          // Check for index.md in directory
          const indexPath = path.posix.join(item.path, 'index.md');
          if (await fileService.exists(indexPath)) {
            const content = await this.knowledgeBase.renderContent(item.path);
            if (content) {
          const htmlPath = path.join(outputDir, item.path, 'index.html');
          await this.writeHtmlFile(htmlPath, content);
        }
      }
        } else if (item.extension === '.md') {
          // Build markdown file
          const content = await this.knowledgeBase.renderContent(item.path);
          if (content) {
            const htmlPath = path.join(
              outputDir, 
              item.path.replace(/\.md$/, '.html')
            );
            await fs.mkdir(path.dirname(htmlPath), { recursive: true });
            await this.writeHtmlFile(htmlPath, content);
          }
        } else {
          // Copy other files as-is
          const sourcePath = fileService.getAbsolutePath(item.path);
          const targetPath = path.join(outputDir, item.path);
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.copyFile(sourcePath, targetPath);
        }
      }
      
      // Handle root index
      if (currentPath === '') {
        const content = await this.knowledgeBase.renderContent('');
        if (content) {
          const indexPath = path.join(outputDir, 'index.html');
          await this.writeHtmlFile(indexPath, content);
        }
      }
      
    } catch (error) {
      console.error(`Error building pages for ${currentPath}:`, error);
    }
  }

  /**
   * Write HTML file with template
   */
  private async writeHtmlFile(filePath: string, content: any): Promise<void> {
    const html = await this.templateRenderer.render(this.buildTemplateContext(content));
    await fs.writeFile(filePath, html, 'utf-8');
  }

  private buildTemplateContext(content: any): TemplateRenderContext {
    const baseUrl = this.normalizeBaseUrl(this.options.baseUrl);
    const searchEnabled = this.options.search?.enabled !== false;
    const searchIndexFile = this.options.search?.indexFileName || 'search-index.json';
    const navigation = this.mapNavigationItems(content.navigation || []);
    const breadcrumbs = (content.breadcrumbs || []).map((crumb: any) => ({
      title: crumb.title,
      path: crumb.path,
      href: this.composeHref(crumb.path, true)
    }));

    return {
      site: {
        title: this.options.title,
        description: this.options.description,
        baseUrl
      },
      page: {
        title: content.title || this.options.title,
        description: content.description || this.options.description,
        metadata: content.metadata || {}
      },
      content,
      navigation,
      breadcrumbs,
      assets: this.getAssetContext(baseUrl),
      search: {
        enabled: searchEnabled,
        indexFileName: searchIndexFile
      }
    };
  }

  private mapNavigationItems(items: any[]): any[] {
    if (!items || items.length === 0) {
      return [];
    }

    return items.map(item => {
      const isDirectory = item.children && item.children.length > 0;
      return {
        title: item.title,
        path: item.path,
        href: this.composeHref(item.path, isDirectory),
        isDirectory,
        isActive: item.isActive,
        children: this.mapNavigationItems(item.children || [])
      };
    });
  }

  private composeHref(itemPath: string, isDirectory: boolean): string {
    const normalized = this.normalizeSlashes(itemPath);
    const suffix = isDirectory ? normalized : this.replaceMarkdownExtension(normalized);
    const href = this.joinWithBase(this.options.baseUrl, suffix);
    return isDirectory ? this.ensureTrailingSlash(href) : href;
  }

  private getAssetContext(baseUrl: string): { base: string; css: string[]; js: string[] } {
    const assetBase = this.options.templates?.assetsBasePath
      ? this.normalizePublicPath(this.options.templates.assetsBasePath)
      : this.joinWithBase(baseUrl || '/', 'assets');

    const css: string[] = [
      `${assetBase}/kb-app.css`,
      ...(this.options.customCssFiles || [])
        .map(file => this.normalizePublicPath(file))
        .filter(Boolean)
    ];

    const js: string[] = [
      `${assetBase}/kb-app.js`,
      ...(this.options.customJsFiles || [])
        .map(file => this.normalizePublicPath(file))
        .filter(Boolean)
    ];

    return {
      base: assetBase,
      css,
      js
    };
  }

  private normalizePublicPath(value: string): string {
    if (!value) return '';
    if (this.isHttpUrl(value)) {
      return value;
    }
    return this.joinWithBase(this.options.baseUrl, value);
  }

  private normalizeBaseUrl(value?: string): string {
    if (!value || value === '/') {
      return '';
    }
    let normalized = value.trim();
    if (!this.isHttpUrl(normalized) && !normalized.startsWith('/')) {
      normalized = `/${normalized}`;
    }
    normalized = this.normalizeSlashes(normalized);
    return this.removeTrailingSlash(normalized);
  }

  private joinWithBase(base?: string, suffix?: string): string {
    const normalizedBase = this.normalizeBaseUrl(base);
    const trimmedSuffix = suffix ? this.trimLeadingSlashes(this.normalizeSlashes(suffix)) : '';

    if (this.isHttpUrl(normalizedBase)) {
      const trimmedBase = this.removeTrailingSlash(normalizedBase);
      return trimmedSuffix ? `${trimmedBase}/${trimmedSuffix}` : trimmedBase;
    }

    const parts = [normalizedBase, trimmedSuffix].filter(Boolean);
    if (parts.length === 0) {
      return '/';
    }

    const combined = parts.join('/');
    const normalized = this.collapseSlashes(combined);
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }

  private ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
  }

  private normalizeSlashes(input: string): string {
    return input.split('\\').join('/');
  }

  private trimLeadingSlashes(value: string): string {
    let result = value;
    while (result.startsWith('/')) {
      result = result.substring(1);
    }
    return result;
  }

  private removeTrailingSlash(value: string): string {
    return value.endsWith('/') ? value.slice(0, -1) : value;
  }

  private replaceMarkdownExtension(value: string): string {
    return value.endsWith('.md') ? `${value.slice(0, -3)}html` : value;
  }

  private isHttpUrl(value: string): boolean {
    if (!value) {
      return false;
    }
    const lower = value.toLowerCase();
    return lower.startsWith('http://') || lower.startsWith('https://');
  }

  private collapseSlashes(value: string): string {
    return value.replace(/\/+/g, '/');
  }

  private resolveTemplateOptions(templateOptions?: TemplateOptions): TemplateRendererOptions {
    if (!templateOptions) {
      return {};
    }

    return {
      templatesDir: templateOptions.directory
        ? path.resolve(process.cwd(), templateOptions.directory)
        : undefined,
      layout: templateOptions.layout,
      partialsDir: templateOptions.partialsDir
        ? path.resolve(process.cwd(), templateOptions.partialsDir)
        : undefined
    };
  }

  /**
   * Copy assets to output directory
   */
  private async copyAssets(outputDir: string): Promise<void> {
    console.log('📦 Copying framework assets...');
    
    const frameworkRoot = path.resolve(__dirname, '../../');
    const templateAssetsDir = path.join(frameworkRoot, 'templates', 'default', 'assets');
    const outputAssetsDir = path.join(outputDir, 'assets');
    
    try {
      await fs.mkdir(outputAssetsDir, { recursive: true });
      await this.copyDirectory(templateAssetsDir, outputAssetsDir);

      // Ensure legacy consumers can still access core files from site root
      const criticalFiles = ['kb-app.css', 'kb-app.js'];
      for (const assetName of criticalFiles) {
        const sourcePath = path.join(templateAssetsDir, assetName);
        if (await this.pathExists(sourcePath)) {
          await fs.copyFile(sourcePath, path.join(outputDir, assetName));
        }
      }
      console.log('  ✓ Framework assets copied');
    } catch (error) {
      console.warn('⚠️ Could not copy bundled assets:', error instanceof Error ? error.message : 'Unknown error');
      console.log('   Creating fallback basic styles...');
      
      // Fallback: create basic CSS if framework assets aren't available
      const basicCss = `
/* Basic Knowledge Base Styles - Fallback */
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
  color: #333;
}

#app {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 300px;
  background: #f8f9fa;
  border-right: 1px solid #e9ecef;
  overflow-y: auto;
}

.nav-header {
  padding: 1rem;
  border-bottom: 1px solid #e9ecef;
}

.main-content {
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
}

.content {
  max-width: 800px;
}
`;
      
      await fs.mkdir(outputAssetsDir, { recursive: true });
      await fs.writeFile(path.join(outputAssetsDir, 'kb-app.css'), basicCss, 'utf-8');
      await fs.writeFile(path.join(outputDir, 'kb-app.css'), basicCss, 'utf-8');
    }
  }

  private async buildSearchIndex(outputDir: string): Promise<void> {
    if (this.options.search?.enabled === false) {
      return;
    }

    console.log('🔎 Generating search index...');
    const documents = await this.collectSearchDocuments();
    if (documents.length === 0) {
      console.log('  ⚠️ No markdown documents found for search index.');
      return;
    }

    const index = lunr(function () {
      this.ref('id');
      this.field('title');
      this.field('body');

      documents.forEach(doc => this.add(doc));
    });
    const payload = {
      index: index.toJSON(),
      documents: documents.map(doc => ({
        id: doc.id,
        title: doc.title,
        url: doc.url,
        snippet: doc.snippet
      }))
    };

    const fileName = this.options.search?.indexFileName || 'search-index.json';
    await fs.writeFile(
      path.join(outputDir, fileName),
      JSON.stringify(payload, null, 2),
      'utf-8'
    );
  }

  private async collectSearchDocuments(): Promise<SearchDocument[]> {
    const fileService = this.knowledgeBase.getFileService();
    const markdownFiles = await this.collectMarkdownFiles(fileService);
    const documents: SearchDocument[] = [];

    for (const filePath of markdownFiles) {
      const rendered = await this.knowledgeBase.renderContent(filePath);
      if (!rendered || !rendered.htmlContent) {
        continue;
      }

      const plainText = this.stripHtml(rendered.htmlContent);
      if (!plainText) {
        continue;
      }

      documents.push({
        id: filePath,
        title: rendered.title || this.options.title || filePath,
        body: plainText,
        url: this.composeHref(filePath, false),
        snippet: plainText.slice(0, 280)
      });
    }

    return documents;
  }

  private async collectMarkdownFiles(fileService: FileService, currentPath = ''): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fileService.getDirectoryListing(currentPath);
      for (const entry of entries) {
        if (entry.isDirectory) {
          const nested = await this.collectMarkdownFiles(fileService, entry.path);
          files.push(...nested);
        } else if (entry.extension === '.md') {
          files.push(entry.path);
        }
      }
    } catch (error) {
      console.warn('⚠️ Unable to inspect directory for search index:', error instanceof Error ? error.message : error);
    }

    return files;
  }

  private stripHtml(value: string): string {
    return value
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async copyDirectory(source: string, target: string): Promise<void> {
    const entries = await fs.readdir(source, { withFileTypes: true });
    await fs.mkdir(target, { recursive: true });

    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(sourcePath, targetPath);
      } else {
        await fs.copyFile(sourcePath, targetPath);
      }
    }
  }

  private async pathExists(location: string): Promise<boolean> {
    try {
      await fs.access(location);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate sitemap.xml
   */
  private async generateSitemap(outputDir: string): Promise<void> {
    // Implementation would collect all pages and generate sitemap
    console.log('Generating sitemap...');
  }

  /**
   * Generate robots.txt
   */
  private async generateRobots(outputDir: string): Promise<void> {
    const robots = `User-agent: *
Allow: /

Sitemap: ${this.options.baseUrl}/sitemap.xml`;
    
    await fs.writeFile(path.join(outputDir, 'robots.txt'), robots);
  }
}

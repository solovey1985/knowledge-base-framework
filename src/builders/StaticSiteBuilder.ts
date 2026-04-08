import * as fs from 'fs/promises';
import * as path from 'path';
import { KnowledgeBase } from '../core/KnowledgeBase';
import { KnowledgeBaseOptions, TemplateOptions } from '../core/interfaces';
import { FileService } from '../services/FileService';
import { TemplateRenderer, TemplateRendererOptions } from '../services/TemplateRenderer';
import { TemplateContextBuilder } from '../services/TemplateContextBuilder';
import { SearchIndexService } from '../services/SearchIndexService';

export class StaticSiteBuilder {
  private knowledgeBase: KnowledgeBase;
  private options: KnowledgeBaseOptions;
  private templateRenderer: TemplateRenderer;
  private contextBuilder: TemplateContextBuilder;
  private searchIndexService: SearchIndexService;

  constructor(options: KnowledgeBaseOptions) {
    this.options = {
      ...options,
      isStaticSite: true
    };
    this.knowledgeBase = new KnowledgeBase(this.options);
    this.templateRenderer = new TemplateRenderer(this.resolveTemplateOptions(this.options.templates));
    this.contextBuilder = new TemplateContextBuilder(this.options, this.getStaticAssetsBase());
    this.searchIndexService = new SearchIndexService(
      this.knowledgeBase,
      this.knowledgeBase.getFileService(),
      this.options.search || {},
      this.options.baseUrl || ''
    );
  }

  async build(): Promise<void> {
    console.log('🔨 Building static site...');

    const outputDir = this.options.build?.outputDir || './docs';

    if (this.options.build?.clean !== false) {
      await this.cleanOutputDirectory(outputDir);
    }

    await fs.mkdir(outputDir, { recursive: true });

    await this.buildPages(outputDir);
    await this.copyAssets(outputDir);
    await this.buildSearchIndex(outputDir);

    if (this.options.build?.generateSitemap) {
      await this.generateSitemap(outputDir);
    }

    if (this.options.build?.generateRobots) {
      await this.generateRobots(outputDir);
    }

    console.log('✅ Static site build completed!');
  }

  private async cleanOutputDirectory(outputDir: string): Promise<void> {
    try {
      console.log('🧹 Cleaning output directory...');
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch {
      // Directory might not exist, that's okay
    }
  }

  private async buildPages(outputDir: string, currentPath: string = ''): Promise<void> {
    const fileService = this.knowledgeBase.getFileService();

    try {
      const items = await fileService.getDirectoryListing(currentPath);

      for (const item of items) {
        if (item.isDirectory) {
          const dirOutputPath = path.join(outputDir, item.path);
          await fs.mkdir(dirOutputPath, { recursive: true });

          await this.buildPages(outputDir, item.path);

          const indexPath = path.posix.join(item.path, 'index.md');
          if (await fileService.exists(indexPath)) {
            const content = await this.knowledgeBase.renderContent(item.path);
            if (content) {
              const htmlPath = path.join(outputDir, item.path, 'index.html');
              await this.writeHtmlFile(htmlPath, content);
            }
          }
        } else if (item.extension === '.md') {
          const content = await this.knowledgeBase.renderContent(item.path);
          if (content) {
            const htmlPath = path.join(outputDir, item.path.replace(/\.md$/, '.html'));
            await fs.mkdir(path.dirname(htmlPath), { recursive: true });
            await this.writeHtmlFile(htmlPath, content);
          }
        } else {
          const sourcePath = fileService.getAbsolutePath(item.path);
          const targetPath = path.join(outputDir, item.path);
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.copyFile(sourcePath, targetPath);
        }
      }

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

  private async writeHtmlFile(filePath: string, content: unknown): Promise<void> {
    const html = await this.templateRenderer.render(this.contextBuilder.build(content as Parameters<typeof this.contextBuilder.build>[0]));
    await fs.writeFile(filePath, html, 'utf-8');
  }

  private getStaticAssetsBase(): string {
    const baseUrl = this.options.baseUrl || '';
    if (!baseUrl || baseUrl === '/') {
      return '/assets';
    }
    return `${baseUrl.replace(/\/$/, '')}/assets`;
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

  private async copyAssets(outputDir: string): Promise<void> {
    console.log('📦 Copying framework assets...');

    const frameworkRoot = path.resolve(__dirname, '../../');
    const templateAssetsDir = path.join(frameworkRoot, 'templates', 'default', 'assets');
    const outputAssetsDir = path.join(outputDir, 'assets');

    try {
      await fs.mkdir(outputAssetsDir, { recursive: true });
      await this.copyDirectory(templateAssetsDir, outputAssetsDir);

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
      await this.writeFallbackStyles(outputAssetsDir, outputDir);
    }
  }

  private async writeFallbackStyles(outputAssetsDir: string, outputDir: string): Promise<void> {
    const basicCss = `body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}a{color:#007bff}.kb-shell{display:grid;grid-template-columns:300px 1fr;min-height:100vh}@media(max-width:768px){.kb-shell{grid-template-columns:1fr}}`;
    await fs.mkdir(outputAssetsDir, { recursive: true });
    await fs.writeFile(path.join(outputAssetsDir, 'kb-app.css'), basicCss, 'utf-8');
    await fs.writeFile(path.join(outputDir, 'kb-app.css'), basicCss, 'utf-8');
    console.log('  ✓ Fallback styles written');
  }

  private async buildSearchIndex(outputDir: string): Promise<void> {
    if (!this.searchIndexService.isEnabled()) {
      return;
    }

    const indexFileName = this.searchIndexService.getIndexFileName();
    const outputIndexPath = path.join(outputDir, indexFileName);

    const needsRebuild = await this.needsSearchRebuild(outputDir, indexFileName);
    if (!needsRebuild) {
      console.log('🔎 Search index up to date, skipping rebuild.');
      return;
    }

    await this.searchIndexService.build();

    const payload = await this.searchIndexService.getIndexPayload();
    if (!payload) {
      console.log('  ⚠️ No documents indexed for search.');
      return;
    }

    const outputPayload = {
      index: payload.index,
      documents: payload.documents
    };
    await fs.writeFile(outputIndexPath, JSON.stringify(outputPayload, null, 2), 'utf-8');
    console.log(`  ✓ Search index written to ${indexFileName}`);
  }

  private async needsSearchRebuild(outputDir: string, indexFileName: string): Promise<boolean> {
    const indexPath = path.join(outputDir, indexFileName);
    try {
      const indexStat = await fs.stat(indexPath);
      const contentRoot = this.knowledgeBase.getFileService().getRootPath();
      const latestContent = await this.findLatestContentMtime(contentRoot);
      return latestContent > indexStat.mtime;
    } catch {
      return true;
    }
  }

  private async findLatestContentMtime(dirPath: string): Promise<Date> {
    let latest = new Date(0);

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '.kb' || entry.name.startsWith('.')) continue;
          const nested = await this.findLatestContentMtime(fullPath);
          if (nested > latest) latest = nested;
        } else if (entry.name.endsWith('.md')) {
          const stat = await fs.stat(fullPath);
          if (stat.mtime > latest) latest = stat.mtime;
        }
      }
    } catch {
      // ignore
    }

    return latest;
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
    } catch {
      return false;
    }
  }

  private async generateSitemap(outputDir: string): Promise<void> {
    console.log('🗺️ Generating sitemap...');

    const fileService = this.knowledgeBase.getFileService();
    const baseUrl = this.getSiteUrl();
    const pages: { url: string; lastmod: string }[] = [];

    await this.collectSitemapPages(fileService, '', pages);

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url><loc>${this.escapeXml(baseUrl + p.url)}</loc><lastmod>${p.lastmod}</lastmod></url>`).join('\n')}
</urlset>`;

    await fs.writeFile(path.join(outputDir, 'sitemap.xml'), sitemap, 'utf-8');
    console.log(`  ✓ Sitemap written (${pages.length} pages)`);
  }

  private async collectSitemapPages(fileService: FileService, currentPath: string, pages: { url: string; lastmod: string }[]): Promise<void> {
    try {
      const entries = await fileService.getDirectoryListing(currentPath);

      for (const entry of entries) {
        if (entry.isDirectory) {
          const indexMd = path.posix.join(entry.path, 'index.md');
          if (await fileService.exists(indexMd)) {
            const stat = await fileService.getStats(indexMd);
            const url = entry.path === '' ? '/' : `/${entry.path}/`;
            pages.push({ url, lastmod: stat?.lastModified?.toISOString().split('T')[0] || '' });
          }
          await this.collectSitemapPages(fileService, entry.path, pages);
        } else if (entry.extension === '.md' && entry.name !== 'index.md') {
          const stat = await fileService.getStats(entry.path);
          const url = `/${entry.path.replace(/\.md$/i, '.html')}`;
          pages.push({ url, lastmod: stat?.lastModified?.toISOString().split('T')[0] || '' });
        }
      }
    } catch {
      // ignore inaccessible directories
    }
  }

  private getSiteUrl(): string {
    const base = this.options.baseUrl || '';
    if (base && base !== '/' && (base.startsWith('http://') || base.startsWith('https://'))) {
      return base.replace(/\/$/, '');
    }
    const host = this.options.server?.host || 'localhost';
    const port = this.options.server?.port || 3000;
    return `http://${host}:${port}`;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private async generateRobots(outputDir: string): Promise<void> {
    const siteUrl = this.getSiteUrl();
    const robots = `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml`;

    await fs.writeFile(path.join(outputDir, 'robots.txt'), robots, 'utf-8');
    console.log('  ✓ robots.txt written');
  }
}

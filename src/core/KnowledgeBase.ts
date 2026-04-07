import { Express, Request, Response, NextFunction } from 'express';
import * as path from 'path';
import { KnowledgeBaseOptions, TemplateOptions } from '../core/interfaces';
import { FileService } from '../services/FileService';
import { NavigationService } from '../services/NavigationService';
import { MarkdownRenderer } from '../services/MarkdownRenderer';
import { GitService } from '../services/GitService';
import { RenderedContent } from '../core/models';
import { TemplateRenderer, TemplateRendererOptions } from '../services/TemplateRenderer';
import { TemplateContextBuilder } from '../services/TemplateContextBuilder';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const TEXT_PREVIEW_EXTENSIONS = new Set([
    '.txt', '.log', '.json', '.yml', '.yaml', '.xml', '.csv', '.env', '.ini', '.toml', '.config', '.props', '.targets', '.sln', '.csproj', '.vbproj', '.fsproj', '.js', '.ts', '.tsx', '.jsx', '.py', '.rb', '.java', '.cs', '.go', '.php', '.sh', '.ps1', '.sql', '.html', '.css', '.scss', '.mdx'
]);

/**
 * Main Knowledge Base framework class
 */
export class KnowledgeBase {
    private options: KnowledgeBaseOptions;
    private fileService: FileService;
    private navigationService: NavigationService;
    private markdownRenderer: MarkdownRenderer;
    private gitService: GitService;
    private templateRenderer: TemplateRenderer;
    private templateContextBuilder: TemplateContextBuilder;

    constructor(options: KnowledgeBaseOptions) {
        this.options = this.mergeWithDefaults(options);
        this.fileService = new FileService(this.options.contentRootPath);
        this.navigationService = new NavigationService(this.fileService);
        this.markdownRenderer = new MarkdownRenderer({
            isStaticSite: this.options.isStaticSite || false,
            baseUrl: this.options.baseUrl || ''
        });
        this.gitService = new GitService();
        const assetsOverride = this.options.isStaticSite ? undefined : (this.options.templates?.assetsBasePath || '/assets');
        this.templateRenderer = new TemplateRenderer(this.resolveTemplateOptions(this.options.templates));
        this.templateContextBuilder = new TemplateContextBuilder(this.options, assetsOverride);
    }

    /**
     * Merge options with defaults
     */
    private mergeWithDefaults(options: KnowledgeBaseOptions): KnowledgeBaseOptions {
        return {
            contentRootPath: options.contentRootPath,
            baseUrl: options.baseUrl || '',
            isStaticSite: options.isStaticSite || false,
            title: options.title || 'Knowledge Base',
            description: options.description || 'A markdown-based knowledge base',
            author: options.author || '',
            enableMath: options.enableMath !== false,
            enableMermaid: options.enableMermaid !== false,
            enableSyntaxHighlighting: options.enableSyntaxHighlighting !== false,
            customCssFiles: options.customCssFiles || [],
            customJsFiles: options.customJsFiles || [],
            navigation: {
                maxDepth: options.navigation?.maxDepth || 3,
                showExtensions: options.navigation?.showExtensions || false,
                excludePatterns: options.navigation?.excludePatterns || ['README.md', '.*'],
                navigationFileName: options.navigation?.navigationFileName || 'navigation.json',
                ...options.navigation
            },
            server: {
                port: options.server?.port || 3000,
                host: options.server?.host || 'localhost',
                liveReload: options.server?.liveReload || false,
                watch: options.server?.watch || false,
                ...options.server
            },
            build: {
                outputDir: options.build?.outputDir || './docs',
                target: options.build?.target || 'github',
                clean: options.build?.clean !== false,
                generateSitemap: options.build?.generateSitemap || false,
                generateRobots: options.build?.generateRobots || false,
                ...options.build
            },
            templates: {
                directory: options.templates?.directory,
                layout: options.templates?.layout,
                partialsDir: options.templates?.partialsDir,
                assetsBasePath: options.templates?.assetsBasePath
            },
            search: {
                enabled: options.search?.enabled !== false,
                indexFileName: options.search?.indexFileName || 'search-index.json'
            }
        };
    }

    /**
     * Setup Express middleware for serving content
     */
    setupMiddleware(app: Express): void {
        // Unicode path normalization middleware
        const normalizeUnicodePath = (req: Request, res: Response, next: NextFunction) => {
            if (req.params && req.params[0]) {
                try {
                    let decoded = decodeURIComponent(req.params[0]);
                    if (typeof decoded.normalize === 'function') {
                        decoded = decoded.normalize('NFC');
                    }
                    (req as any).normalizedContentPath = decoded;
                } catch (e) {
                    (req as any).normalizedContentPath = req.params[0];
                }
            }
            next();
        };

        // Content routing middleware
        app.get('/content/*', normalizeUnicodePath, async (req: Request, res: Response, next: NextFunction) => {
            const requestPath = (req as any).normalizedContentPath || req.params[0] || '';

            try {
                const shouldRender = requestPath.endsWith('.md') ||
                    requestPath === '' ||
                    !requestPath.includes('.') ||
                    await this.fileService.isDirectory(requestPath);

                if (shouldRender) {
                    // Render through content handler
                    await this.handleContentRequest(req, res, next);
                } else {
                    // Serve as static file
                    const absolutePath = this.fileService.getAbsolutePath(requestPath);
                    res.sendFile(absolutePath);
                }
            } catch (error) {
                next(error);
            }
        });

        // Index route
        app.get('/', async (req: Request, res: Response) => {
            await this.handleIndexRequest(req, res);
        });

        // Friendly HTML routes
        app.get('*', async (req: Request, res: Response, next: NextFunction) => {
            if (req.path.startsWith('/content') || req.path.startsWith('/assets')) {
                return next();
            }

            const target = await this.mapFriendlyRequestPath(req.path);
            if (target === null) {
                return next();
            }

            try {
                const content = await this.renderContent(target);
                if (content) {
                    const html = await this.templateRenderer.render(this.templateContextBuilder.build(content));
                    res.send(html);
                } else {
                    next();
                }
            } catch (error) {
                next(error);
            }
        });
    }

    /**
     * Handle content requests (markdown rendering)
     */
    private async handleContentRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const requestPath = (req as any).normalizedContentPath || req.params[0] || '';
            const content = await this.renderContent(requestPath);

                if (content) {
                    const html = await this.templateRenderer.render(this.templateContextBuilder.build(content));
                    res.send(html);
                } else {
                    res.status(404).send('Content not found');
                }
        } catch (error) {
            console.error('Error handling content request:', error);
            res.status(500).send('Internal server error');
        }
    }

    /**
     * Handle index requests
     */
    private async handleIndexRequest(req: Request, res: Response): Promise<void> {
        try {
            const content = await this.renderContent('');
            if (content) {
                const html = await this.templateRenderer.render(this.templateContextBuilder.build(content));
                res.send(html);
            } else {
                res.status(404).send('Content not found');
            }
        } catch (error) {
            console.error('Error handling index request:', error);
            res.status(500).send('Internal server error');
        }
    }

    /**
     * Render content for a given path
     */
    async renderContent(requestPath: string): Promise<RenderedContent | null> {
        try {
            const targetPath = requestPath;

            // Directory routes always show listings. Index markdown remains available
            // through its own document path, e.g. /folder/index.html.
            if (!targetPath || await this.fileService.isDirectory(targetPath)) {
                return await this.renderDirectoryListing(targetPath);
            }

            if (!await this.fileService.exists(targetPath)) {
                return null;
            }

            const extension = path.extname(targetPath).toLowerCase();

            if (extension === '.md') {
                return await this.renderMarkdownFile(targetPath, false);
            }

            if (this.isTextPreviewExtension(extension)) {
                return await this.renderTextFile(targetPath);
            }

            if (this.isImageExtension(extension)) {
                return await this.renderImageFile(targetPath);
            }

            return null;

        } catch (error) {
            console.error('Error rendering content:', error);
            return null;
        }
    }

    /**
     * Render directory listing
     */
    private async renderDirectoryListing(dirPath: string): Promise<RenderedContent> {
        const items = await this.fileService.getDirectoryListing(dirPath);
        const directories = items.filter(item => item.isDirectory).sort(this.sortByName);
        const markdownFiles = items.filter(item => !item.isDirectory && item.extension === '.md').sort(this.sortByName);
        const textFiles = items.filter(item => !item.isDirectory && this.isTextPreviewExtension(item.extension)).sort(this.sortByName);
        const imageFiles = items.filter(item => !item.isDirectory && this.isImageExtension(item.extension)).sort(this.sortByName);
        const otherFiles = items
            .filter(item => !item.isDirectory && !markdownFiles.includes(item) && !textFiles.includes(item) && !imageFiles.includes(item))
            .sort(this.sortByName);

        const galleryId = `gallery-${(dirPath || 'root').replace(/[^a-z0-9-]/gi, '-')}`;

        const htmlParts: string[] = [];
        htmlParts.push('<section class="kb-dir" data-kb-directory>');
        htmlParts.push(
            `<header class="kb-dir__header"><div><p class="kb-dir__path">${this.escapeHtml(dirPath || '/')}</p><h1>Folder Contents</h1></div>` +
            `<div class="kb-dir__meta">${items.length} item${items.length === 1 ? '' : 's'}</div></header>`
        );

        const renderSection = (entries: typeof items, type: 'directories' | 'documents' | 'text' | 'images' | 'files', title: string) => {
            if (entries.length === 0) return;
            const galleryAttr = type === 'images' ? ` data-kb-lightbox-gallery="${galleryId}"` : '';
            htmlParts.push(`<section class="kb-dir__section kb-dir__section--${type}">`);
            htmlParts.push(`<h2>${title}</h2>`);
            htmlParts.push(`<div class="kb-dir__grid"${galleryAttr}>`);

            for (const entry of entries) {
                const name = this.escapeHtml(entry.name);
                if (type === 'images') {
                    const imageUrl = this.buildRawContentUrl(entry.path);
                    htmlParts.push(`
                        <div class="kb-dir__entry kb-dir__entry--image">
                            <button class="kb-dir__image-trigger" data-kb-lightbox-trigger data-image-src="${imageUrl}" data-image-name="${name}">
                                <img src="${imageUrl}" alt="${name}" loading="lazy">
                            </button>
                            <div class="kb-dir__entry-meta">
                                <span>${name}</span>
                                <a href="${imageUrl}" target="_blank" rel="noopener">Open original</a>
                            </div>
                        </div>
                    `);
                } else {
                    const meta = entry.isDirectory
                        ? 'Folder'
                        : `${entry.extension.toUpperCase().replace('.', '') || 'FILE'} • ${this.formatBytes(entry.size)}`;
                    const href = entry.isDirectory
                        ? this.buildFriendlyUrl(entry.path, 'directory')
                        : type === 'documents'
                            ? this.buildFriendlyUrl(entry.path, 'markdown')
                            : type === 'text'
                                ? this.buildFriendlyUrl(entry.path, 'text')
                                : this.buildRawContentUrl(entry.path);

                    const targetAttr = (!entry.isDirectory && type === 'files') ? ' target="_blank" rel="noopener"' : '';

                    htmlParts.push(`
                        <div class="kb-dir__entry">
                            <a href="${href}"${targetAttr}>
                                <span class="kb-dir__entry-name">${name}</span>
                            </a>
                            <span class="kb-dir__entry-meta">${meta}</span>
                        </div>
                    `);
                }
            }

            htmlParts.push('</div></section>');
        };

        renderSection(directories, 'directories', 'Folders');
        renderSection(markdownFiles, 'documents', 'Documents');
        renderSection(textFiles, 'text', 'Text & Code');
        renderSection(imageFiles, 'images', 'Images');
        renderSection(otherFiles, 'files', 'Files');

        if (items.length === 0) {
            htmlParts.push('<p class="kb-dir__empty">This folder is empty.</p>');
        }

        htmlParts.push('</section>');

        return this.composeContentResponse(
            dirPath,
            `Directory: ${dirPath || 'Root'}`,
            htmlParts.join(''),
            `Directory listing for ${dirPath || 'root directory'}`,
            { isDirectory: true }
        );
    }

    private async renderMarkdownFile(targetPath: string, isIndex: boolean): Promise<RenderedContent> {
        const markdownContent = await this.fileService.readFile(targetPath);
        const rendered = await this.markdownRenderer.render(markdownContent);
        const navigation = await this.navigationService.generateNavigation(this.options.navigation!, targetPath);
        const breadcrumbs = this.navigationService.generateBreadcrumb(targetPath);
        const gitInfo = this.gitService.getCommitInfoForDisplay();

        return {
            htmlContent: rendered.html,
            title: this.extractTitle(markdownContent) || this.options.title!,
            description: this.options.description!,
            navigation: this.navigationService.filterNavigation(navigation, this.options.navigation!.excludePatterns),
            breadcrumbs,
            tableOfContents: rendered.tableOfContents,
            metadata: {
                path: targetPath,
                isIndex,
                gitInfo,
                lastModified: (await this.fileService.getStats(targetPath))?.lastModified
            }
        };
    }

    private async renderTextFile(targetPath: string): Promise<RenderedContent> {
        const rawContent = await this.fileService.readFile(targetPath);
        const stats = await this.fileService.getStats(targetPath);
        const extension = path.extname(targetPath).replace('.', '');
        const displayName = path.basename(targetPath);
        const downloadUrl = this.buildRawContentUrl(targetPath);
        const escaped = this.escapeHtml(rawContent);
        const html = `
            <div class="kb-file">
              <header class="kb-file__header">
                <div>
                  <p class="kb-file__path">${this.escapeHtml(targetPath)}</p>
                  <h1>${this.escapeHtml(displayName)}</h1>
                </div>
                <div class="kb-file__meta">
                  <span>${extension.toUpperCase()} • ${this.formatBytes(stats?.size || 0)}</span>
                  ${stats?.lastModified ? `<span>Updated ${this.formatDate(stats.lastModified)}</span>` : ''}
                  <a class="kb-file__download" href="${downloadUrl}" download>Download</a>
                </div>
              </header>
              <pre class="kb-file__code"><code class="language-${this.escapeHtml(extension || 'text')}">${escaped}</code></pre>
            </div>
        `;

        return this.composeContentResponse(targetPath, displayName, html, `${displayName} preview`);
    }

    private async renderImageFile(targetPath: string): Promise<RenderedContent> {
        const stats = await this.fileService.getStats(targetPath);
        const displayName = path.basename(targetPath);
        const fileUrl = this.buildRawContentUrl(targetPath);
        const html = `
            <div class="kb-image-detail">
              <div class="kb-image-detail__preview">
                <img src="${fileUrl}" alt="${this.escapeHtml(displayName)}" loading="lazy" />
              </div>
              <div class="kb-image-detail__meta">
                <h1>${this.escapeHtml(displayName)}</h1>
                <dl>
                  <div>
                    <dt>Size</dt>
                    <dd>${this.formatBytes(stats?.size || 0)}</dd>
                  </div>
                  ${stats?.lastModified ? `<div><dt>Updated</dt><dd>${this.formatDate(stats.lastModified)}</dd></div>` : ''}
                </dl>
                <a class="kb-file__download" href="${fileUrl}" target="_blank" rel="noopener">Open original</a>
              </div>
            </div>
        `;

        return this.composeContentResponse(targetPath, displayName, html, `${displayName} image`);
    }

    private async composeContentResponse(targetPath: string, title: string, html: string, description?: string, metadata: Record<string, unknown> = {}): Promise<RenderedContent> {
        const navigation = await this.navigationService.generateNavigation(this.options.navigation!, targetPath);
        const breadcrumbs = this.navigationService.generateBreadcrumb(targetPath);
        const stats = await this.fileService.getStats(targetPath);

        return {
            htmlContent: html,
            title,
            description: description || this.options.description!,
            navigation: this.navigationService.filterNavigation(navigation, this.options.navigation!.excludePatterns),
            breadcrumbs,
            metadata: {
                path: targetPath,
                lastModified: stats?.lastModified,
                ...metadata
            }
        };
    }

    private extractTitle(markdown: string): string | null {
        const lines = markdown.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('# ')) {
                return trimmed.substring(2).trim();
            }
        }
        return null;
    }

    /**
     * Get the configured options
     */
    getOptions(): KnowledgeBaseOptions {
        return { ...this.options };
    }

    /**
     * Get the file service instance
     */
    getFileService(): FileService {
        return this.fileService;
    }

    /**
     * Get the navigation service instance
     */
    getNavigationService(): NavigationService {
        return this.navigationService;
    }

    /**
     * Get the markdown renderer instance
     */
    getMarkdownRenderer(): MarkdownRenderer {
        return this.markdownRenderer;
    }

    /**
     * Get the git service instance
     */
    getGitService(): GitService {
        return this.gitService;
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

    private async mapFriendlyRequestPath(requestPath: string): Promise<string | null> {
        try {
            let decoded = decodeURIComponent(requestPath);
            decoded = decoded.replace(/^\/+/, '');
            if (!decoded) {
                return '';
            }

            if (decoded.endsWith('/')) {
                return decoded.replace(/\/+$/, '');
            }

            if (decoded.toLowerCase().endsWith('.html')) {
                const base = decoded.replace(/\.html?$/i, '');
                if (await this.fileService.exists(base)) {
                    return base;
                }
                if (!path.extname(base)) {
                    const markdownCandidate = `${base}.md`;
                    if (await this.fileService.exists(markdownCandidate)) {
                        return markdownCandidate;
                    }
                }
                return base;
            }

            if (await this.fileService.isDirectory(decoded)) {
                return decoded;
            }

            if (!path.extname(decoded)) {
                const markdownCandidate = `${decoded}.md`;
                if (await this.fileService.exists(markdownCandidate)) {
                    return markdownCandidate;
                }
            }

            return decoded;
        } catch (error) {
            return null;
        }
    }

    private buildFriendlyUrl(relativePath: string, type: 'directory' | 'markdown' | 'text'): string {
        const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        let href = '';
        if (type === 'directory') {
            href = `${normalized}/`.replace(/\/+/g, '/');
        } else if (type === 'markdown') {
            href = normalized.replace(/\.md$/i, '.html');
        } else {
            href = `${normalized}.html`;
        }
        href = href.startsWith('/') ? href : `/${href}`;
        if (this.options.isStaticSite && this.options.baseUrl && this.options.baseUrl !== '/') {
            return `${this.options.baseUrl.replace(/\/$/, '')}${href}`;
        }
        return href;
    }

    private buildRawContentUrl(relativePath: string): string {
        const normalized = relativePath.replace(/\\/g, '/');
        if (this.options.isStaticSite) {
            const base = this.options.baseUrl || '';
            const prefix = base && base !== '/' ? base.replace(/\/$/, '') : '';
            return `${prefix}/${normalized}`.replace(/\/+/g, '/');
        }
        return `/content/${normalized}`;
    }

    private isTextPreviewExtension(extension: string): boolean {
        return TEXT_PREVIEW_EXTENSIONS.has(extension.toLowerCase());
    }

    private isImageExtension(extension: string): boolean {
        return IMAGE_EXTENSIONS.has(extension.toLowerCase());
    }

    private sortByName<T extends { name: string }>(a: T, b: T): number {
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    }

    private formatBytes(bytes: number): string {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        const value = bytes / Math.pow(1024, exponent);
        return `${value.toFixed(value < 10 ? 1 : 0)} ${units[exponent]}`;
    }

    private formatDate(date: Date): string {
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

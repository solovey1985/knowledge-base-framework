import { Express, Request, Response, NextFunction } from 'express';
import * as path from 'path';
import crypto from 'crypto';
import express from 'express';
import { KnowledgeBaseOptions, TemplateOptions } from '../core/interfaces';
import { FileService } from '../services/FileService';
import { NavigationService } from '../services/NavigationService';
import { MarkdownRenderer } from '../services/MarkdownRenderer';
import { GitService } from '../services/GitService';
import { RenderedContent } from '../core/models';
import { TemplateRenderer, TemplateRendererOptions } from '../services/TemplateRenderer';
import { TemplateContextBuilder } from '../services/TemplateContextBuilder';
import { SearchIndexService } from '../services/SearchIndexService';

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
    private searchIndexService: SearchIndexService;

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
        this.searchIndexService = new SearchIndexService(this, this.fileService, this.options.search || {}, this.options.baseUrl || '');
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
                indexFileName: options.search?.indexFileName || 'search-index.json',
                indexFilePath: options.search?.indexFilePath,
                indexUrlPath: options.search?.indexUrlPath,
                titleBoost: options.search?.titleBoost,
                bodyBoost: options.search?.bodyBoost
            },
            auth: {
                enabled: options.auth?.enabled || false,
                username: options.auth?.username || '',
                password: options.auth?.password || '',
                cookieName: options.auth?.cookieName || 'kb_auth',
                cookieSecret: options.auth?.cookieSecret || '',
                loginPath: options.auth?.loginPath || '/login',
                logoutPath: options.auth?.logoutPath || '/logout',
                ...options.auth
            }
        };
    }

    /**
     * Setup Express middleware for serving content
     */
    setupMiddleware(app: Express): void {
        app.use(express.urlencoded({ extended: false }));

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

        const auth = this.options.auth;
        if (auth?.enabled) {
            app.get(auth.loginPath || '/login', (req: Request, res: Response) => {
                const redirect = this.normalizeRedirectTarget(String(req.query.redirect || req.query.next || '/'));
                res.status(200).send(this.renderLoginPage(redirect));
            });

            app.post(auth.loginPath || '/login', (req: Request, res: Response) => {
                const username = String(req.body?.username || '').trim();
                const password = String(req.body?.password || '');
                const redirect = this.normalizeRedirectTarget(String(req.body?.redirect || '/'));

                if (this.verifyCredentials(username, password)) {
                    const token = this.createAuthToken(username);
                    const cookieName = auth.cookieName || 'kb_auth';
                    const cookieValue = `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax${this.isSecureRequest(req) ? '; Secure' : ''}`;
                    res.setHeader('Set-Cookie', cookieValue);
                    res.redirect(302, redirect);
                    return;
                }

                res.status(401).send(this.renderLoginPage(redirect, 'Invalid username or password.'));
            });

            app.post(auth.logoutPath || '/logout', (_req: Request, res: Response) => {
                const cookieName = auth.cookieName || 'kb_auth';
                res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
                res.redirect(302, auth.loginPath || '/login');
            });

            app.use((req: Request, res: Response, next: NextFunction) => {
                const pathname = req.path || '';
                if (pathname.startsWith('/assets') || pathname === auth.loginPath || pathname === auth.logoutPath) {
                    return next();
                }

                if (this.isAuthenticated(req)) {
                    return next();
                }

                if (req.method === 'GET' || req.method === 'HEAD') {
                    const redirect = this.normalizeRedirectTarget(String(req.originalUrl || req.url || '/'));
                    res.status(200).send(this.renderLoginPage(redirect));
                    return;
                }

                res.status(401).send(this.renderLoginPage('/'));
            });
        }

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

        // Search index endpoint
        this.setupSearchEndpoint(app);

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
        htmlParts.push('<section class="kb-dir space-y-8" data-kb-directory>');
        htmlParts.push(
            `<header class="kb-dir__header flex flex-wrap items-end justify-between gap-4 rounded-3xl border border-slate-200 bg-slate-50 p-5"><div><p class="kb-dir__path text-xs uppercase tracking-[0.3em] text-sky-700">${this.escapeHtml(dirPath || '/')}</p><h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Folder Contents</h1></div>` +
            `<div class="kb-dir__meta rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500">${items.length} item${items.length === 1 ? '' : 's'}</div></header>`
        );

        const renderSection = (entries: typeof items, type: 'directories' | 'documents' | 'text' | 'images' | 'files', title: string) => {
            if (entries.length === 0) return;
            const galleryAttr = type === 'images' ? ` data-kb-lightbox-gallery="${galleryId}"` : '';
            htmlParts.push(`<section class="kb-dir__section kb-dir__section--${type} space-y-4">`);
            htmlParts.push(`<h2 class="text-lg font-semibold tracking-tight text-slate-900">${title}</h2>`);
            htmlParts.push(`<div class="kb-dir__grid grid gap-3 sm:grid-cols-2 xl:grid-cols-3"${galleryAttr}>`);

            for (const entry of entries) {
                const name = this.escapeHtml(entry.name);
                if (type === 'images') {
                    const imageUrl = this.buildRawContentUrl(entry.path);
                    htmlParts.push(`
                        <div class="kb-dir__entry kb-dir__entry--image overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg shadow-slate-200/50">
                            <button class="kb-dir__image-trigger block w-full" data-kb-lightbox-trigger data-image-src="${imageUrl}" data-image-name="${name}">
                                <img class="h-56 w-full object-cover" src="${imageUrl}" alt="${name}" loading="lazy">
                            </button>
                            <div class="kb-dir__entry-meta flex items-center justify-between gap-4 px-4 py-3 text-sm text-slate-600">
                                <span class="truncate">${name}</span>
                                <a class="text-sky-700 hover:text-sky-800" href="${imageUrl}" target="_blank" rel="noopener">Open original</a>
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
                        <div class="kb-dir__entry rounded-3xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200/50 transition hover:border-sky-300 hover:bg-slate-50">
                            <a class="block" href="${href}"${targetAttr}>
                                <span class="kb-dir__entry-name block font-medium text-slate-900">${name}</span>
                            </a>
                            <span class="kb-dir__entry-meta mt-2 block text-sm text-slate-500">${meta}</span>
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
            htmlParts.push('<p class="kb-dir__empty rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-slate-500">This folder is empty.</p>');
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
        const rendered = await this.markdownRenderer.render(markdownContent, targetPath);
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
            <div class="kb-file space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50">
              <header class="kb-file__header flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
                <div>
                  <p class="kb-file__path text-xs uppercase tracking-[0.3em] text-sky-700">${this.escapeHtml(targetPath)}</p>
                  <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-900">${this.escapeHtml(displayName)}</h1>
                </div>
                <div class="kb-file__meta flex flex-wrap items-center gap-3 text-sm text-slate-600">
                  <span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">${extension.toUpperCase()} • ${this.formatBytes(stats?.size || 0)}</span>
                  ${stats?.lastModified ? `<span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">Updated ${this.formatDate(stats.lastModified)}</span>` : ''}
                  <a class="kb-file__download rounded-full bg-sky-500 px-4 py-2 font-semibold text-white transition hover:bg-sky-600" href="${downloadUrl}" download>Download</a>
                </div>
              </header>
              <pre class="kb-file__code overflow-x-auto rounded-2xl border border-slate-200 bg-slate-950 p-5 text-sm text-slate-100"><code class="language-${this.escapeHtml(extension || 'text')}">${escaped}</code></pre>
            </div>
        `;

        return this.composeContentResponse(targetPath, displayName, html, `${displayName} preview`);
    }

    private async renderImageFile(targetPath: string): Promise<RenderedContent> {
        const stats = await this.fileService.getStats(targetPath);
        const displayName = path.basename(targetPath);
        const fileUrl = this.buildRawContentUrl(targetPath);
        const html = `
            <div class="kb-image-detail grid gap-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div class="kb-image-detail__preview overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 p-3">
                <img class="h-auto w-full rounded-2xl object-contain" src="${fileUrl}" alt="${this.escapeHtml(displayName)}" loading="lazy" />
              </div>
              <div class="kb-image-detail__meta space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <h1 class="text-3xl font-semibold tracking-tight text-slate-900">${this.escapeHtml(displayName)}</h1>
                <dl class="space-y-3 text-sm text-slate-600">
                  <div class="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <dt class="text-slate-500">Size</dt>
                    <dd>${this.formatBytes(stats?.size || 0)}</dd>
                  </div>
                  ${stats?.lastModified ? `<div class="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3"><dt class="text-slate-500">Updated</dt><dd>${this.formatDate(stats.lastModified)}</dd></div>` : ''}
                </dl>
                <a class="kb-file__download inline-flex rounded-full bg-sky-500 px-4 py-2 font-semibold text-white transition hover:bg-sky-600" href="${fileUrl}" target="_blank" rel="noopener">Open original</a>
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
            href = this.options.isStaticSite ? normalized.replace(/\.md$/i, '.html') : normalized;
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

    private verifyCredentials(username: string, password: string): boolean {
        const auth = this.options.auth;
        if (!auth?.enabled) {
            return true;
        }

        if (!auth.username || !auth.password) {
            return false;
        }

        return this.secureEquals(username, auth.username) && this.secureEquals(password, auth.password);
    }

    private createAuthToken(username: string): string {
        const auth = this.options.auth;
        const secret = auth?.cookieSecret || `${auth?.username || ''}:${auth?.password || ''}`;
        const payload = Buffer.from(username, 'utf8').toString('base64url');
        const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
        return `${payload}.${signature}`;
    }

    private isAuthenticated(req: Request): boolean {
        const auth = this.options.auth;
        if (!auth?.enabled) {
            return true;
        }

        const cookieName = auth.cookieName || 'kb_auth';
        const token = this.getCookieValue(req, cookieName);
        if (!token) {
            return false;
        }

        const secret = auth.cookieSecret || `${auth.username || ''}:${auth.password || ''}`;
        const [payload, signature] = token.split('.');
        if (!payload || !signature) {
            return false;
        }

        const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
        if (!this.secureEquals(signature, expected)) {
            return false;
        }

        try {
            const username = Buffer.from(payload, 'base64url').toString('utf8');
            return auth.username ? this.secureEquals(username, auth.username) : true;
        } catch {
            return false;
        }
    }

    private renderLoginPage(redirectTo: string, errorMessage?: string): string {
        const auth = this.options.auth;
        const title = this.escapeHtml(this.options.title || 'Knowledge Base');
        const loginPath = this.escapeHtml(auth?.loginPath || '/login');
        const logoutPath = this.escapeHtml(auth?.logoutPath || '/logout');
        const safeRedirect = this.escapeHtml(redirectTo || '/');
        const errorHtml = errorMessage
            ? `<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">${this.escapeHtml(errorMessage)}</div>`
            : '';

        return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in • ${title}</title>
  <script>
    window.tailwind = window.tailwind || {};
    window.tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'ui-sans-serif', 'system-ui']
          }
        }
      }
    }
  </script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-slate-50 text-slate-900">
  <main class="flex min-h-screen items-center justify-center p-6">
    <section class="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl shadow-slate-200/60 backdrop-blur">
      <div class="mb-8">
        <p class="text-sm uppercase tracking-[0.3em] text-sky-700">Private access</p>
        <h1 class="mt-3 text-3xl font-semibold tracking-tight text-slate-900">${title}</h1>
        <p class="mt-3 text-sm leading-6 text-slate-500">Sign in to continue.</p>
      </div>
      ${errorHtml}
      <form method="post" action="${loginPath}" class="mt-6 space-y-4">
        <input type="hidden" name="redirect" value="${safeRedirect}">
        <div>
          <label class="mb-2 block text-sm font-medium text-slate-700" for="username">Username</label>
          <input id="username" name="username" autocomplete="username" required class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-sky-500 focus:bg-white" placeholder="Username">
        </div>
        <div>
          <label class="mb-2 block text-sm font-medium text-slate-700" for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-sky-500 focus:bg-white" placeholder="Password">
        </div>
        <button type="submit" class="w-full rounded-2xl bg-sky-500 px-4 py-3 font-semibold text-white transition hover:bg-sky-600">Sign in</button>
      </form>
      <form method="post" action="${logoutPath}" class="mt-4 text-center text-xs text-slate-500">
        <button type="submit" class="underline decoration-slate-300 underline-offset-4">Logout</button>
      </form>
    </section>
  </main>
</body>
</html>`;
    }

    private normalizeRedirectTarget(value: string): string {
        if (!value) {
            return '/';
        }

        const cleaned = value.startsWith('/') ? value : `/${value}`;
        return cleaned.replace(/\s+/g, '');
    }

    private getCookieValue(req: Request, name: string): string | null {
        const header = req.headers.cookie;
        if (!header) {
            return null;
        }

        const parts = header.split(';');
        for (const part of parts) {
            const [key, ...rest] = part.trim().split('=');
            if (key === name) {
                return rest.join('=');
            }
        }

        return null;
    }

    private secureEquals(left: string, right: string): boolean {
        const leftBuffer = Buffer.from(left, 'utf8');
        const rightBuffer = Buffer.from(right, 'utf8');
        if (leftBuffer.length !== rightBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(leftBuffer, rightBuffer);
    }

    private isSecureRequest(req: Request): boolean {
        if (req.secure) {
            return true;
        }

        const forwardedProto = req.headers['x-forwarded-proto'];
        if (typeof forwardedProto === 'string') {
            return forwardedProto.split(',')[0].trim() === 'https';
        }

        return false;
    }

    private setupSearchEndpoint(app: Express): void {
        if (!this.searchIndexService.isEnabled()) {
            return;
        }

        const indexFileName = this.searchIndexService.getIndexFileName();

        app.get(`/${indexFileName}`, async (req: Request, res: Response) => {
            try {
                const payload = await this.searchIndexService.buildAndGetIndex();
                if (!payload) {
                    res.status(404).json({ error: 'Search index not found. Run "kb build" first or add content files.' });
                    return;
                }
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Cache-Control', 'public, max-age=60');
                res.json(payload);
            } catch (error) {
                console.error('Error serving search index:', error);
                res.status(500).json({ error: 'Failed to build search index' });
            }
        });
    }

    getSearchIndexService(): SearchIndexService {
        return this.searchIndexService;
    }

    getTitle(): string {
        return this.options.title || 'Knowledge Base';
    }
}

import { Express, Request, Response, NextFunction } from 'express';
import * as path from 'path';
import express from 'express';
import { KnowledgeBaseOptions, TemplateOptions } from '../core/interfaces';
import { FileService } from '../services/FileService';
import { NavigationService } from '../services/NavigationService';
import { MarkdownRenderer } from '../services/MarkdownRenderer';
import { GitService } from '../services/GitService';
import { ContentItem, RenderedContent } from '../core/models';
import { PluginDirectoryRenderInfo } from '../core/plugins';
import { TemplateRenderer, TemplateRendererOptions } from '../services/TemplateRenderer';
import { TemplateContextBuilder } from '../services/TemplateContextBuilder';
import { SearchIndexService } from '../services/SearchIndexService';
import { PluginManager } from '../services/PluginManager';
import { StorageRegistry } from './storage';
import { frontMatterTags, splitFrontMatter } from './frontMatter';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const TEXT_PREVIEW_EXTENSIONS = new Set([
    '.txt', '.log', '.json', '.yml', '.yaml', '.xml', '.csv', '.env', '.ini', '.toml', '.config', '.props', '.targets', '.sln', '.csproj', '.vbproj', '.fsproj', '.js', '.ts', '.tsx', '.jsx', '.py', '.rb', '.java', '.cs', '.go', '.php', '.sh', '.ps1', '.sql', '.css', '.scss', '.mdx'
]);
const HTML_EXTENSION = '.html';

/**
 * Main Knowledge Base framework class
 */
export class KnowledgeBase {
    readonly storage: StorageRegistry;
    private options: KnowledgeBaseOptions;
    private fileService: FileService;
    private navigationService: NavigationService;
    private markdownRenderer: MarkdownRenderer;
    private gitService: GitService;
    private templateRenderer: TemplateRenderer;
    private templateContextBuilder: TemplateContextBuilder;
    private searchIndexService: SearchIndexService;
    private pluginManager: PluginManager;

    constructor(options: KnowledgeBaseOptions) {
        this.storage = new StorageRegistry((options.plugins || []).flatMap(plugin => plugin.storageProviders || []));
        if (options.auth?.enabled || process.env.KB_AUTH_ENABLED === 'true') {
            throw new Error('Legacy auth is unsupported. Configure the passwordAuth plugin; old cookies are not accepted.');
        }
        const authentication = (options.plugins || []).filter(plugin => plugin.authentication);
        if (authentication.length > 1) throw new Error('Only one authentication plugin is allowed.');
        if (!authentication.length && (options.plugins || []).some(plugin => plugin.requiresAuthentication)) {
            throw new Error('This plugin requires authentication.');
        }
        if (options.isStaticSite && authentication.length) throw new Error('Authentication requires a server; static export would expose private content.');
        for (const plugin of options.plugins || []) {
            if (plugin.assetsDir && (!/^[a-z0-9][a-z0-9-]*$/.test(plugin.id) || !path.isAbsolute(plugin.assetsDir))) {
                throw new Error(`Plugin "${plugin.id}" serves assets: its id must use lowercase letters, digits and hyphens, and assetsDir must be absolute.`);
            }
        }
        this.options = this.mergeWithDefaults(options);
        this.fileService = new FileService(this.options.contentRootPath);
        this.navigationService = new NavigationService(this.fileService);
        this.markdownRenderer = new MarkdownRenderer({
            isStaticSite: this.options.isStaticSite || false,
            baseUrl: this.options.baseUrl || '',
            extensions: (this.options.plugins || []).flatMap(plugin => plugin.markdownExtensions || [])
        });
        this.gitService = new GitService();
        this.pluginManager = new PluginManager(this.options.plugins || []);
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
            plugins: options.plugins || []
        };
    }

    // Avoid installing the same guard twice when the host calls setupSecurity explicitly.
    private securedApps = new WeakSet<Express>();

    /** Call before registering application static files or routes. Also called by setupMiddleware. */
    setupSecurity(app: Express): void {
        if (this.securedApps.has(app)) return;
        for (const plugin of this.options.plugins || []) {
            if (plugin.authentication) app.use(plugin.authentication.middleware);
        }
        this.securedApps.add(app);
    }

    setupMiddleware(app: Express): void {
        this.setupSecurity(app);
        for (const plugin of this.options.plugins || []) plugin.setupServer?.(app, {
            storage: this.storage, contentRootPath: this.options.contentRootPath,
        });
        // After authentication: a private site's plugin assets are private too.
        for (const plugin of this.options.plugins || []) {
            if (plugin.assetsDir) {
                app.use(`/plugin-assets/${plugin.id}`, express.static(plugin.assetsDir, { fallthrough: false }));
            }
        }
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

        // Content routing middleware
        app.get('/content/*', normalizeUnicodePath, async (req: Request, res: Response, next: NextFunction) => {
            const requestPath = (req as any).normalizedContentPath || req.params[0] || '';

            try {
                // HTML files are client-only SPA pages - serve raw immediately
                if (this.isHtmlExtension(requestPath)) {
                    const absolutePath = this.fileService.getAbsolutePath(requestPath);
                    res.sendFile(absolutePath);
                    return;
                }

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
            if (req.path.startsWith('/content') || req.path.startsWith('/assets') || req.path.startsWith('/framework-assets') || req.path.startsWith('/plugin-assets')) {
                return next();
            }

            const target = await this.mapFriendlyRequestPath(req.path);
            if (target === null) {
                return next();
            }

            // HTML files are client-only SPA pages - serve raw without rendering
            if (this.isHtmlExtension(target)) {
                const absolutePath = this.fileService.getAbsolutePath(target);
                res.sendFile(absolutePath);
                return;
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

        // Last: a rendering failure is a server error without internal details.
        app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
            if (res.headersSent) {
                next(error);
                return;
            }
            console.error('Error handling request:', error);
            res.status(500).send('Internal server error');
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
     * Render content for a given path. Null means the path does not exist; a failure
     * to render an existing document is thrown so callers answer 500, not 404.
     */
    async renderContent(requestPath: string): Promise<RenderedContent | null> {
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

        const pluginContent = await this.pluginManager.renderByFileType(targetPath, () => ({
            requestPath: targetPath,
            extension,
            fileService: this.fileService,
            readFile: (relativePath: string) => this.fileService.readFile(relativePath),
            renderMarkdown: (markdown: string, currentPath: string = targetPath) => this.markdownRenderer.render(markdown, currentPath),
            getStats: (relativePath: string) => this.fileService.getStats(relativePath),
            buildRawContentUrl: (relativePath: string) => this.buildRawContentUrl(relativePath),
            buildFriendlyUrl: (relativePath: string, type: 'directory' | 'markdown' | 'text' | 'app') => this.buildFriendlyUrl(relativePath, type),
            composeContentResponse: (contentPath: string, title: string, html: string, description?: string, metadata: Record<string, unknown> = {}) =>
                this.composeContentResponse(contentPath, title, html, description, metadata)
        }));
        if (pluginContent) {
            return pluginContent;
        }

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
    }

    /**
     * Render directory listing
     */
    private async renderDirectoryListing(dirPath: string): Promise<RenderedContent> {
        const items = await this.fileService.getDirectoryListing(dirPath);
        const pluginDecorations = new Map<string, PluginDirectoryRenderInfo>();
        const pluginSectionEntries = new Set<string>();
        const pluginSections = new Map<string, { title: string; entries: ContentItem[] }>();

        for (const item of items) {
            if (item.isDirectory) {
                continue;
            }

            const defaultHref = this.getDefaultDirectoryEntryHref(item, 'files');
            const friendlyHref = this.buildFileRouteUrl(item.path);
            const decoration = this.pluginManager.resolveDirectoryItem(item, defaultHref, friendlyHref);
            if (!decoration) {
                continue;
            }

            pluginDecorations.set(item.path, decoration);
            if (!decoration.section) {
                continue;
            }

            const sectionKey = decoration.section;
            const existing = pluginSections.get(sectionKey);
            if (existing) {
                existing.entries.push(item);
            } else {
                pluginSections.set(sectionKey, {
                    title: decoration.sectionTitle || sectionKey,
                    entries: [item]
                });
            }
            pluginSectionEntries.add(item.path);
        }

        const directories = items.filter(item => item.isDirectory).sort(this.sortByName);
        const markdownFiles = items.filter(item => !item.isDirectory && item.extension === '.md' && !pluginSectionEntries.has(item.path)).sort(this.sortByName);
        const htmlFiles = items.filter(item => !item.isDirectory && this.isHtmlExtension(item.name) && !pluginSectionEntries.has(item.path)).sort(this.sortByName);
        const textFiles = items.filter(item => !item.isDirectory && this.isTextPreviewExtension(item.extension) && !pluginSectionEntries.has(item.path)).sort(this.sortByName);
        const imageFiles = items.filter(item => !item.isDirectory && this.isImageExtension(item.extension) && !pluginSectionEntries.has(item.path)).sort(this.sortByName);
        const otherFiles = items
            .filter(item => !item.isDirectory && !pluginSectionEntries.has(item.path) && !markdownFiles.includes(item) && !htmlFiles.includes(item) && !textFiles.includes(item) && !imageFiles.includes(item))
            .sort(this.sortByName);

        const galleryId = `gallery-${(dirPath || 'root').replace(/[^a-z0-9-]/gi, '-')}`;

        const htmlParts: string[] = [];
        htmlParts.push('<section class="kb-dir space-y-8" data-kb-directory>');
        htmlParts.push(
            `<header class="kb-dir__header flex flex-wrap items-end justify-between gap-4 rounded-3xl border border-slate-200 bg-slate-50 p-5"><div><p class="kb-dir__path text-xs uppercase tracking-[0.3em] text-sky-700">${this.escapeHtml(dirPath || '/')}</p><h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Folder Contents</h1></div>` +
            `<div class="kb-dir__meta rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500">${items.length} item${items.length === 1 ? '' : 's'}</div></header>`
        );

        const renderSection = (entries: typeof items, type: 'directories' | 'documents' | 'apps' | 'text' | 'images' | 'files', title: string) => {
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
                    const pluginDecoration = pluginDecorations.get(entry.path);
                    const entryIcon = this.getDirectoryEntryIcon(entry);
                    const meta = entry.isDirectory
                        ? 'Folder'
                        : pluginDecoration?.meta
                            ? pluginDecoration.meta
                        : entry.extension === '.html'
                            ? 'SPA'
                            : `${entry.extension.toUpperCase().replace('.', '') || 'FILE'} • ${this.formatBytes(entry.size)}`;
                    const href = pluginDecoration?.href
                        ? pluginDecoration.href
                        : entry.isDirectory
                            ? this.buildFriendlyUrl(entry.path, 'directory')
                        : entry.extension === '.html'
                            ? this.buildFriendlyUrl(entry.path, 'app')
                            : type === 'documents'
                                ? this.buildFriendlyUrl(entry.path, 'markdown')
                                : type === 'text'
                                    ? this.buildFriendlyUrl(entry.path, 'text')
                                    : this.buildRawContentUrl(entry.path);

                    const shouldOpenInNewTab = pluginDecoration
                        ? Boolean(pluginDecoration.targetBlank)
                        : (!entry.isDirectory && type === 'files');
                    const targetAttr = shouldOpenInNewTab ? ' target="_blank" rel="noopener"' : '';

                    htmlParts.push(`
                        <div class="kb-dir__entry rounded-3xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200/50 transition hover:border-sky-300 hover:bg-slate-50">
                            <a class="block" href="${href}"${targetAttr}>
                                <span class="kb-dir__entry-name flex items-center gap-2 font-medium text-slate-900">${entryIcon}<span>${name}</span></span>
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
        for (const section of pluginSections.values()) {
            renderSection(section.entries.sort(this.sortByName), 'files', section.title);
        }
        renderSection(htmlFiles, 'apps', 'Apps');
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
        // Front matter is metadata: it names and describes the page but is not rendered as text.
        const { data: frontMatter, body: markdownContent } = splitFrontMatter(await this.fileService.readFile(targetPath));
        const rendered = await this.markdownRenderer.render(markdownContent, targetPath);
        const navigation = await this.navigationService.generateNavigation(this.options.navigation!, targetPath);
        const breadcrumbs = await this.buildBreadcrumbs(targetPath);
        const gitInfo = this.gitService.getCommitInfoForDisplay();
        const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;

        let page: RenderedContent = {
            htmlContent: rendered.html,
            title: text(frontMatter.title) || this.extractTitle(markdownContent) || this.options.title!,
            description: text(frontMatter.description) || this.options.description!,
            navigation: this.navigationService.filterNavigation(navigation, this.options.navigation!.excludePatterns),
            breadcrumbs,
            tableOfContents: rendered.tableOfContents,
            metadata: {
                path: targetPath,
                isIndex,
                gitInfo,
                frontMatter,
                tags: frontMatterTags(frontMatter),
                lastModified: (await this.fileService.getStats(targetPath))?.lastModified
            }
        };

        for (const plugin of this.options.plugins || []) {
            if (!plugin.transformPage) continue;
            page = await plugin.transformPage(page, {
                requestPath: targetPath.split('\\').join('/'),
                markdown: markdownContent,
                frontMatter,
                fileService: this.fileService,
                isStaticSite: this.options.isStaticSite || false,
                buildDocumentUrl: (relativePath: string) => this.buildDocumentUrl(relativePath)
            }) || page;
        }
        return page;
    }

    /** Link to a Markdown document or other content file, valid in server and static mode. */
    buildDocumentUrl(relativePath: string): string {
        return /\.md$/i.test(relativePath) ? this.buildFriendlyUrl(relativePath, 'markdown') : this.buildFileRouteUrl(relativePath);
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
        const breadcrumbs = await this.buildBreadcrumbs(targetPath);
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

    /**
     * Home first, then the path. Home is the authored root index.md when it exists,
     * otherwise the root listing; on the home page itself it is the only, current, item.
     */
    private async buildBreadcrumbs(targetPath: string): Promise<RenderedContent['breadcrumbs']> {
        const normalized = (targetPath || '').split('\\').join('/').replace(/^\/+|\/+$/g, '');
        const homePath = await this.fileService.exists('index.md') ? 'index.md' : '';
        const home = {
            title: this.options.navigation?.homeTitle || 'Home',
            path: homePath,
            children: [],
            order: 0,
            isActive: false,
            isHome: true
        };
        if (!normalized || normalized === homePath) {
            return [{ ...home, isCurrent: true }];
        }
        const trail = this.navigationService.generateBreadcrumb(normalized);
        if (trail.length) {
            trail[trail.length - 1].isCurrent = true;
        }
        return [home, ...trail];
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
            if (typeof decoded.normalize === 'function') {
                decoded = decoded.normalize('NFC');
            }
            decoded = decoded.replace(/^\/+/, '');
            if (!decoded) {
                return '';
            }

            if (decoded.endsWith('/')) {
                return decoded.replace(/\/+$/, '');
            }

            if (decoded.toLowerCase().endsWith('.html')) {
                if (await this.fileService.exists(decoded)) {
                    return decoded;
                }

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

    private buildFriendlyUrl(relativePath: string, type: 'directory' | 'markdown' | 'text' | 'app'): string {
        const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        let href = '';
        if (type === 'directory') {
            href = `${normalized}/`.replace(/\/+/g, '/');
        } else if (type === 'markdown') {
            href = this.options.isStaticSite ? normalized.replace(/\.md$/i, '.html') : normalized;
        } else if (type === 'app') {
            href = this.options.isStaticSite ? normalized.replace(/\.html$/i, '.html') : normalized;
        } else {
            href = `${normalized}.html`;
        }
        href = href.startsWith('/') ? href : `/${href}`;
        if (this.options.isStaticSite && this.options.baseUrl && this.options.baseUrl !== '/') {
            return `${this.options.baseUrl.replace(/\/$/, '')}${href}`;
        }
        return href;
    }

    private buildFileRouteUrl(relativePath: string): string {
        const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        const href = normalized.startsWith('/') ? normalized : `/${normalized}`;
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

    private getDefaultDirectoryEntryHref(entry: ContentItem, sectionType: 'directories' | 'documents' | 'apps' | 'text' | 'images' | 'files'): string {
        if (entry.isDirectory) {
            return this.buildFriendlyUrl(entry.path, 'directory');
        }

        if (entry.extension === '.html') {
            return this.buildFriendlyUrl(entry.path, 'app');
        }

        if (sectionType === 'documents') {
            return this.buildFriendlyUrl(entry.path, 'markdown');
        }

        if (sectionType === 'text') {
            return this.buildFriendlyUrl(entry.path, 'text');
        }

        return this.buildRawContentUrl(entry.path);
    }

    private getDirectoryEntryIcon(entry: ContentItem): string {
        if (entry.isDirectory) {
            return '<span aria-hidden="true" class="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">📁</span>';
        }

        if (entry.path.toLowerCase().endsWith('.interview.md')) {
            return '<span aria-hidden="true" class="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-sky-700">?</span>';
        }

        if (entry.path.toLowerCase().endsWith('.concept.md')) {
            return '<span aria-hidden="true" class="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-violet-200 bg-violet-50 text-violet-700"><svg viewBox="0 0 24 24" class="h-4 w-4 fill-none stroke-current" stroke-width="1.8"><circle cx="12" cy="5" r="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="5" cy="19" r="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="19" cy="19" r="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.2 6.9L6.8 16.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.8 6.9l3.4 9.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 19h9" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
        }

        if (entry.extension === '.md') {
            return '<span aria-hidden="true" class="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">📄</span>';
        }

        if (entry.extension === '.html') {
            return '<span aria-hidden="true" class="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">🌐</span>';
        }

        if (this.isTextPreviewExtension(entry.extension)) {
            return '<span aria-hidden="true" class="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">⌘</span>';
        }

        if (this.isImageExtension(entry.extension)) {
            return '<span aria-hidden="true" class="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">🖼</span>';
        }

        return '<span aria-hidden="true" class="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">•</span>';
    }

    private isTextPreviewExtension(extension: string): boolean {
        return TEXT_PREVIEW_EXTENSIONS.has(extension.toLowerCase());
    }

    private isImageExtension(extension: string): boolean {
        return IMAGE_EXTENSIONS.has(extension.toLowerCase());
    }

    private isHtmlExtension(path: string): boolean {
        return path.toLowerCase().endsWith(HTML_EXTENSION);
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

    private setupSearchEndpoint(app: Express): void {
        if (!this.searchIndexService.isEnabled()) {
            return;
        }

        const indexUrlPath = this.searchIndexService.getIndexUrlPath();

        app.get(`/${indexUrlPath.replace(/^\/+/, '')}`, async (req: Request, res: Response) => {
            try {
                const payload = await this.searchIndexService.buildAndGetIndex();
                if (!payload) {
                    res.status(404).json({ error: 'Search index not found. Run "kb build" first or add content files.' });
                    return;
                }
                res.setHeader('Content-Type', 'application/json');
                // A private site's index must never be stored by shared caches.
                const isPrivate = (this.options.plugins || []).some(plugin => plugin.authentication);
                res.setHeader('Cache-Control', isPrivate ? 'private, no-store' : 'public, max-age=60');
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

    getPluginManager(): PluginManager {
        return this.pluginManager;
    }

    getTitle(): string {
        return this.options.title || 'Knowledge Base';
    }
}

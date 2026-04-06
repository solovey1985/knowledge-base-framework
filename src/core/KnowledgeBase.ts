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
            let targetPath = requestPath;
            let isIndex = false;

            // Handle root path or directory paths
            if (!targetPath || await this.fileService.isDirectory(targetPath)) {
                // Look for index.md in the directory
                const indexPath = targetPath ? path.posix.join(targetPath, 'index.md') : 'index.md';
                if (await this.fileService.exists(indexPath)) {
                    targetPath = indexPath;
                    isIndex = true;
                } else {
                    // Generate directory listing
                    return await this.renderDirectoryListing(targetPath);
                }
            }

            // Check if file exists
            if (!await this.fileService.exists(targetPath)) {
                return null;
            }

            // Read and render markdown
            const markdownContent = await this.fileService.readFile(targetPath);
            const rendered = await this.markdownRenderer.render(markdownContent);

            // Generate navigation and breadcrumbs
            const navigation = await this.navigationService.generateNavigation(
                this.options.navigation!,
                targetPath
            );

            const breadcrumbs = this.navigationService.generateBreadcrumb(targetPath);

            // Get git information
            const gitInfo = this.gitService.getCommitInfoForDisplay();

            return {
                htmlContent: rendered.html,
                title: this.extractTitle(markdownContent) || this.options.title!,
                description: this.options.description!,
                navigation: this.navigationService.filterNavigation(
                    navigation,
                    this.options.navigation!.excludePatterns
                ),
                breadcrumbs,
                tableOfContents: rendered.tableOfContents,
                metadata: {
                    path: targetPath,
                    isIndex,
                    gitInfo,
                    lastModified: (await this.fileService.getStats(targetPath))?.lastModified
                }
            };

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

        let html = '<div class="directory-listing">';
        html += '<h2>Directory Contents</h2>';
        html += '<ul>';

        for (const item of items) {
            const displayName = item.name;
            const link = item.isDirectory
                ? `/content/${item.path}/`
                : `/content/${item.path}`;

            html += `<li class="${item.isDirectory ? 'directory' : 'file'}">`;
            html += `<a href="${link}">${displayName}</a>`;
            if (!item.isDirectory) {
                html += ` <small>(${item.size} bytes)</small>`;
            }
            html += '</li>';
        }

        html += '</ul></div>';

        const navigation = await this.navigationService.generateNavigation(
            this.options.navigation!,
            dirPath
        );

        const breadcrumbs = this.navigationService.generateBreadcrumb(dirPath);

        return {
            htmlContent: html,
            title: `Directory: ${dirPath || 'Root'}`,
            description: `Directory listing for ${dirPath || 'root directory'}`,
            navigation: this.navigationService.filterNavigation(
                navigation,
                this.options.navigation!.excludePatterns
            ),
            breadcrumbs,
            metadata: {
                path: dirPath,
                isDirectory: true
            }
        };
    }

    /**
     * Extract title from markdown content
     */
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
}

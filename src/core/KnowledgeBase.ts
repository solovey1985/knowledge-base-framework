import { Express, Request, Response, NextFunction } from 'express';
import * as path from 'path';
import { KnowledgeBaseOptions } from '../core/interfaces';
import { FileService } from '../services/FileService';
import { NavigationService } from '../services/NavigationService';
import { MarkdownRenderer } from '../services/MarkdownRenderer';
import { GitService } from '../services/GitService';
import { RenderedContent } from '../core/models';

/**
 * Main Knowledge Base framework class
 */
export class KnowledgeBase {
    private options: KnowledgeBaseOptions;
    private fileService: FileService;
    private navigationService: NavigationService;
    private markdownRenderer: MarkdownRenderer;
    private gitService: GitService;

    constructor(options: KnowledgeBaseOptions) {
        this.options = this.mergeWithDefaults(options);
        this.fileService = new FileService(this.options.contentRootPath);
        this.navigationService = new NavigationService(this.fileService);
        this.markdownRenderer = new MarkdownRenderer({
            isStaticSite: this.options.isStaticSite || false,
            baseUrl: this.options.baseUrl || ''
        });
        this.gitService = new GitService();
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
    }

    /**
     * Handle content requests (markdown rendering)
     */
    private async handleContentRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const requestPath = (req as any).normalizedContentPath || req.params[0] || '';
            const content = await this.renderContent(requestPath);

            if (content) {
                res.json(content);
            } else {
                res.status(404).json({ error: 'Content not found' });
            }
        } catch (error) {
            console.error('Error handling content request:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Handle index requests
     */
    private async handleIndexRequest(req: Request, res: Response): Promise<void> {
        try {
            const content = await this.renderContent('');
            res.json(content);
        } catch (error) {
            console.error('Error handling index request:', error);
            res.status(500).json({ error: 'Internal server error' });
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
}
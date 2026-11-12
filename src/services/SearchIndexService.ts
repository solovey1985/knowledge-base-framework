import * as fs from 'fs/promises';
import * as path from 'path';
import lunr from 'lunr';
import { KnowledgeBase } from '../core/KnowledgeBase';
import { FileService } from './FileService';

const unicodeTrimmer: lunr.PipelineFunction = token => token.update(value =>
  value.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
lunr.Pipeline.registerFunction(unicodeTrimmer, 'kbUnicodeTrimmer');

export interface SearchIndexOptions {
  enabled?: boolean;
  indexFileName?: string;
  indexFilePath?: string;
  indexUrlPath?: string;
  titleBoost?: number;
  bodyBoost?: number;
}

interface SearchDocument {
  id: string;
  title: string;
  body: string;
  url: string;
  snippet: string;
}

export class SearchIndexService {
  private knowledgeBase: KnowledgeBase;
  private fileService: FileService;
  private options: Required<SearchIndexOptions>;
  private indexFilePath: string;
  private indexCache?: lunr.Index;
  private documentsCache?: SearchDocument[];
  private baseUrl: string;
  private isStaticSite: boolean;
  private pendingBuild?: Promise<void>;

  constructor(
    knowledgeBase: KnowledgeBase,
    fileService: FileService,
    options: SearchIndexOptions,
    baseUrl: string = ''
  ) {
    this.knowledgeBase = knowledgeBase;
    this.fileService = fileService;
    this.baseUrl = baseUrl;
    this.isStaticSite = knowledgeBase.getOptions().isStaticSite || false;
    this.options = {
      enabled: options.enabled !== false,
      indexFileName: options.indexFileName || 'search-index.json',
      indexFilePath: options.indexFilePath || '.kb-search-index.json',
      indexUrlPath: options.indexUrlPath || options.indexFileName || 'search-index.json',
      titleBoost: options.titleBoost ?? 10,
      bodyBoost: options.bodyBoost ?? 1
    };
    this.indexFilePath = path.resolve(fileService.getRootPath(), this.options.indexFilePath);
  }

  isEnabled(): boolean {
    return this.options.enabled;
  }

  getIndexFileName(): string {
    return this.options.indexFileName;
  }

  getIndexFilePath(): string {
    return this.indexFilePath;
  }

  getIndexUrlPath(): string {
    return this.options.indexUrlPath;
  }

  async needsRebuild(): Promise<boolean> {
    if (!this.options.enabled) {
      return false;
    }

    // In dynamic server mode, rebuild once per process start so a deployed but stale
    // cached index file never wins purely because of checkout mtimes.
    if (!this.isStaticSite && (!this.indexCache || !this.documentsCache)) {
      return true;
    }

    try {
      const indexStat = await fs.stat(this.indexFilePath);
      const contentDir = this.fileService.getRootPath();
      const latestContent = await this.findLatestContentMtime(contentDir);
      return latestContent >= indexStat.mtime;
    } catch {
      return true;
    }
  }

  async build(): Promise<void> {
    // Browser retries and concurrent readers share one build, including failures.
    if (!this.pendingBuild) {
      this.pendingBuild = this.buildIndex().finally(() => { this.pendingBuild = undefined; });
    }
    return this.pendingBuild;
  }

  private async buildIndex(): Promise<void> {
    if (!this.options.enabled) {
      return;
    }

    console.log('🔎 Building search index...');
    const documents = await this.collectSearchDocuments();
    const options = this.options;
    const index = lunr(function () {
      this.ref('id');
      this.field('title', { boost: options.titleBoost });
      this.field('body', { boost: options.bodyBoost });
      // Lunr's default ASCII trimmer removes entire Ukrainian words.
      this.pipeline.remove(lunr.trimmer);
      this.pipeline.before(lunr.stopWordFilter, unicodeTrimmer);

      documents.forEach(doc => this.add(doc));
    });

    const payload = {
      index: index.toJSON(),
      documents: documents.map(doc => ({
        id: doc.id,
        title: doc.title,
        url: doc.url,
        snippet: doc.snippet
      })),
      meta: {
        generated: new Date().toISOString(),
        documentCount: documents.length
      }
    };

    await fs.mkdir(path.dirname(this.indexFilePath), { recursive: true });
    await fs.writeFile(
      this.indexFilePath,
      JSON.stringify(payload, null, 2),
      'utf-8'
    );

    this.indexCache = index;
    this.documentsCache = documents;
    console.log(`  ✅ Search index built with ${documents.length} documents.`);
  }

  async getIndexPayload(): Promise<{ index: object; documents: SearchDocument[] } | null> {
    if (!this.options.enabled) {
      return null;
    }

    try {
      if (this.indexCache && this.documentsCache) {
        return {
          index: this.indexCache.toJSON(),
          documents: this.documentsCache
        };
      }

      const content = await fs.readFile(this.indexFilePath, 'utf-8');
      const payload = JSON.parse(content);
      return {
        index: payload.index,
        documents: payload.documents
      };
    } catch {
      return null;
    }
  }

  async buildAndGetIndex(): Promise<{ index: object; documents: SearchDocument[] } | null> {
    if (await this.needsRebuild()) {
      await this.build();
    }
    return this.getIndexPayload();
  }

  private async collectSearchDocuments(): Promise<SearchDocument[]> {
    const markdownFiles = await this.collectMarkdownFiles();
    const documents: SearchDocument[] = [];

    for (const filePath of markdownFiles) {
      // Search indexes authored Markdown, not page chrome or live plugin state.
      // Full page rendering repeats navigation scans and synchronous Git commands.
      const markdown = await this.fileService.readFile(filePath);
      const rendered = await this.knowledgeBase.getMarkdownRenderer().render(markdown, filePath);
      const plainText = this.stripHtml(rendered.html);
      if (!plainText) {
        continue;
      }

      documents.push({
        id: filePath,
        title: markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(filePath, '.md'),
        body: plainText,
        url: this.getDocumentUrl(filePath),
        snippet: plainText.slice(0, 280)
      });
    }

    return documents;
  }

  private async collectMarkdownFiles(currentPath: string = ''): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await this.fileService.getDirectoryListing(currentPath);
      for (const entry of entries) {
        if (entry.isDirectory) {
          const nested = await this.collectMarkdownFiles(entry.path);
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

  private async findLatestContentMtime(dirPath: string): Promise<Date> {
    let latest = new Date(0);

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '.kb') continue;
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

  private getDocumentUrl(markdownPath: string): string {
    const normalized = markdownPath.replace(/\\/g, '/');
    const documentPath = this.isStaticSite ? normalized.replace(/\.md$/i, '.html') : normalized;
    const base = this.baseUrl || '';
    if (this.isStaticSite) {
      if (!base || base === '/') {
        return `/${documentPath}`;
      }
      return `${base.replace(/\/$/, '')}/${documentPath}`;
    }

    const contentUrl = `/content/${documentPath}`.replace(/\/+/g, '/');
    if (!base || base === '/') {
      return contentUrl;
    }
    return `${base.replace(/\/$/, '')}${contentUrl}`;
  }

  private stripHtml(value: string): string {
    return value
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

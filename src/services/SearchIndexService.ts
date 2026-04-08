import * as fs from 'fs/promises';
import * as path from 'path';
import lunr from 'lunr';
import { KnowledgeBase } from '../core/KnowledgeBase';
import { FileService } from './FileService';

export interface SearchIndexOptions {
  enabled?: boolean;
  indexFileName?: string;
  indexFilePath?: string;
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
      titleBoost: options.titleBoost ?? 10,
      bodyBoost: options.bodyBoost ?? 1
    };
    this.indexFilePath = path.join(fileService.getRootPath(), this.options.indexFilePath);
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

  async needsRebuild(): Promise<boolean> {
    if (!this.options.enabled) {
      return false;
    }

    try {
      const indexStat = await fs.stat(this.indexFilePath);
      const contentDir = this.fileService.getRootPath();
      const latestContent = await this.findLatestContentMtime(contentDir);
      return latestContent > indexStat.mtime;
    } catch {
      return true;
    }
  }

  async build(): Promise<void> {
    if (!this.options.enabled) {
      return;
    }

    console.log('🔎 Building search index...');
    const documents = await this.collectSearchDocuments();
    if (documents.length === 0) {
      console.log('  ⚠️ No markdown documents found for search index.');
      return;
    }

    const index = lunr(function () {
      this.ref('id');
      this.field('title', { boost: 10 });
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
        title: rendered.title || this.knowledgeBase.getTitle() || filePath,
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

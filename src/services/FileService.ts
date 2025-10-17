import * as fs from 'fs/promises';
import * as path from 'path';
import { ContentItem } from '../core/models';

/**
 * Service responsible for file system operations (Single Responsibility)
 */
export class FileService {
  private contentDir: string;

  constructor(contentDirectory: string) {
    this.contentDir = contentDirectory;
  }

  /**
   * Get directory listing with file types
   */
  async getDirectoryListing(relativePath: string = ''): Promise<ContentItem[]> {
    const fullPath = path.join(this.contentDir, relativePath);
    
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      
      const items: ContentItem[] = [];
      
      for (const entry of entries) {
        const itemPath = path.posix.join(relativePath, entry.name).replace(/\\/g, '/');
        const fullItemPath = path.join(fullPath, entry.name);
        const stats = await fs.stat(fullItemPath);
        
        const item: ContentItem = {
          path: itemPath,
          name: entry.name,
          isDirectory: entry.isDirectory(),
          extension: entry.isFile() ? path.extname(entry.name) : '',
          lastModified: stats.mtime,
          size: entry.isFile() ? stats.size : 0,
          children: [],
        };
        
        items.push(item);
      }
      
      return items;
    } catch (error) {
      throw new Error(`Cannot read directory: ${relativePath}`);
    }
  }

  /**
   * Get directory tree recursively
   */
  async getDirectoryTree(relativePath: string = '', maxDepth: number = 3, currentDepth: number = 0): Promise<ContentItem[]> {
    if (currentDepth >= maxDepth) {
      return [];
    }

    const items = await this.getDirectoryListing(relativePath);
    
    for (const item of items) {
      if (item.isDirectory) {
        item.children = await this.getDirectoryTree(item.path, maxDepth, currentDepth + 1);
      }
    }
    
    return items;
  }

  /**
   * Check if path is a directory
   */
  async isDirectory(relativePath: string): Promise<boolean> {
    const fullPath = path.join(this.contentDir, relativePath);
    
    try {
      const stats = await fs.stat(fullPath);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if path is a file
   */
  async isFile(relativePath: string): Promise<boolean> {
    const fullPath = path.join(this.contentDir, relativePath);
    
    try {
      const stats = await fs.stat(fullPath);
      return stats.isFile();
    } catch (error) {
      return false;
    }
  }

  /**
   * Read file content
   */
  async readFile(relativePath: string): Promise<string> {
    const fullPath = path.join(this.contentDir, relativePath);
    
    try {
      return await fs.readFile(fullPath, 'utf-8');
    } catch (error) {
      throw new Error(`Cannot read file: ${relativePath}`);
    }
  }

  /**
   * Write file content
   */
  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.contentDir, relativePath);
    const dir = path.dirname(fullPath);
    
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
    } catch (error) {
      throw new Error(`Cannot write file: ${relativePath}`);
    }
  }

  /**
   * Check if path exists
   */
  async exists(relativePath: string): Promise<boolean> {
    const fullPath = path.join(this.contentDir, relativePath);
    
    try {
      await fs.access(fullPath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get file stats
   */
  async getStats(relativePath: string): Promise<{ size: number; lastModified: Date } | null> {
    const fullPath = path.join(this.contentDir, relativePath);
    
    try {
      const stats = await fs.stat(fullPath);
      return {
        size: stats.size,
        lastModified: stats.mtime
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get the absolute path for a relative path
   */
  getAbsolutePath(relativePath: string): string {
    return path.join(this.contentDir, relativePath);
  }

  /**
   * Get the content directory
   */
  getContentDirectory(): string {
    return this.contentDir;
  }
}
import { FileService } from './FileService';
import { NavigationItem } from '../core/models';
import { NavigationOptions } from '../core/interfaces';

export interface NavigationGenerationOptions {
  defaultExpanded?: boolean;
  expandRootLevel?: boolean;
  currentPath?: string;
}

/**
 * Service responsible for navigation and menu generation (Single Responsibility)
 */
export class NavigationService {
  private fileService: FileService;

  constructor(fileService: FileService) {
    this.fileService = fileService;
  }

  /**
   * Generate navigation menu from directory structure
   */
  async generateNavigationMenu(
    rootPath: string = '', 
    maxDepth: number = 3, 
    currentDepth: number = 0, 
    currentPath: string = '', 
    options: NavigationGenerationOptions = {}
  ): Promise<NavigationItem[]> {
    const { defaultExpanded = false, expandRootLevel = true } = options;
    
    if (currentDepth >= maxDepth) return [];

    try {
      const entries = await this.fileService.getDirectoryListing(rootPath);
      const navigation: NavigationItem[] = [];

      for (const entry of entries) {
        if (entry.isDirectory) {
          const subNav = await this.generateNavigationMenu(
            entry.path, 
            maxDepth, 
            currentDepth + 1,
            currentPath,
            options
          );
          
          // Determine if folder should be expanded
          let isExpanded: boolean;
          if (currentPath) {
            // Dynamic server mode - expand if in active path
            isExpanded = currentPath.startsWith(entry.path);
          } else {
            // Static site mode - use default behavior
            isExpanded = currentDepth === 0 ? expandRootLevel : defaultExpanded;
          }
          
          const isActive = currentPath === entry.path;
          
          navigation.push({
            title: this.formatFileName(entry.name),
            path: entry.path,
            children: subNav,
            order: 0,
            isActive: isActive
          });
        } else if (entry.extension === '.md') {
          const isActive = currentPath === entry.path;
          
          navigation.push({
            title: this.formatFileName(entry.name),
            path: entry.path,
            children: [],
            order: 0,
            isActive: isActive
          });
        }
      }

      return navigation.sort(this.sortNavigationItems.bind(this));
    } catch (error) {
      console.warn(`Could not generate navigation for ${rootPath}:`, (error as Error).message);
      return [];
    }
  }

  /**
   * Generate breadcrumb navigation
   */
  generateBreadcrumb(path: string): NavigationItem[] {
    if (!path || path === '/') return [];

    const parts = path.split('/').filter(part => part.length > 0);
    const breadcrumb: NavigationItem[] = [];
    let currentPath = '';

    for (const part of parts) {
      currentPath += '/' + part;
      breadcrumb.push({
        title: this.formatFileName(part),
        path: currentPath.substring(1), // Remove leading slash
        children: [],
        order: 0,
        isActive: false
      });
    }

    return breadcrumb;
  }

  /**
   * Generate navigation based on configuration
   */
  async generateNavigation(config: NavigationOptions, currentPath?: string): Promise<NavigationItem[]> {
    const options: NavigationGenerationOptions = {
      currentPath,
      defaultExpanded: false,
      expandRootLevel: true
    };

    return this.generateNavigationMenu('', config.maxDepth || 3, 0, currentPath || '', options);
  }

  /**
   * Filter navigation items by exclude patterns
   */
  filterNavigation(navigation: NavigationItem[], excludePatterns: string[] = []): NavigationItem[] {
    if (excludePatterns.length === 0) return navigation;

    return navigation.filter(item => {
      // Check if item matches any exclude pattern
      const shouldExclude = excludePatterns.some(pattern => {
        if (pattern.startsWith('*')) {
          const extension = pattern.substring(1);
          return item.path.endsWith(extension);
        } else if (pattern.startsWith('.')) {
          return item.title.startsWith('.');
        } else {
          return item.title.toLowerCase().includes(pattern.toLowerCase()) ||
                 item.path.toLowerCase().includes(pattern.toLowerCase());
        }
      });

      if (shouldExclude) return false;

      // Recursively filter children
      if (item.children.length > 0) {
        item.children = this.filterNavigation(item.children, excludePatterns);
      }

      return true;
    });
  }

  /**
   * Format filename for display
   */
  private formatFileName(filename: string): string {
    return filename
      .replace(/\.md$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }

  /**
   * Sort navigation items (directories first, then alphabetically)
   */
  private sortNavigationItems(a: NavigationItem, b: NavigationItem): number {
    // If both have explicit order, use that
    if (a.order !== 0 || b.order !== 0) {
      return a.order - b.order;
    }

    // Check if one is a directory and the other is not (based on having children)
    const aIsDirectory = a.children.length > 0;
    const bIsDirectory = b.children.length > 0;

    if (aIsDirectory !== bIsDirectory) {
      return aIsDirectory ? -1 : 1;
    }

    return a.title.localeCompare(b.title);
  }

  /**
   * Find navigation item by path
   */
  findNavigationItem(navigation: NavigationItem[], path: string): NavigationItem | null {
    for (const item of navigation) {
      if (item.path === path) {
        return item;
      }
      
      if (item.children.length > 0) {
        const found = this.findNavigationItem(item.children, path);
        if (found) return found;
      }
    }
    
    return null;
  }

  /**
   * Set active states in navigation based on current path
   */
  setActiveStates(navigation: NavigationItem[], currentPath: string): NavigationItem[] {
    return navigation.map(item => {
      const isActive = item.path === currentPath;
      const hasActiveChild = item.children.length > 0 && 
                            this.hasActiveChild(item.children, currentPath);
      
      return {
        ...item,
        isActive,
        children: item.children.length > 0 
          ? this.setActiveStates(item.children, currentPath)
          : []
      };
    });
  }

  /**
   * Check if navigation item has active child
   */
  private hasActiveChild(navigation: NavigationItem[], currentPath: string): boolean {
    return navigation.some(item => 
      item.path === currentPath || 
      (item.children.length > 0 && this.hasActiveChild(item.children, currentPath))
    );
  }
}
export interface ContentItem {
  /** Relative path from content root */
  path: string;
  
  /** Display name for the item */
  name: string;
  
  /** Whether this is a directory */
  isDirectory: boolean;
  
  /** File extension (if file) */
  extension: string;
  
  /** Last modified date */
  lastModified: Date;
  
  /** File size in bytes (if file) */
  size: number;
  
  /** Child items (if directory) */
  children: ContentItem[];
  
  /** Parent directory reference */
  parent?: ContentItem;
}

export interface NavigationItem {
  /** Display title */
  title: string;
  
  /** URL path */
  path: string;
  
  /** Child navigation items */
  children: NavigationItem[];
  
  /** Custom order for sorting */
  order: number;
  
  /** Whether this item is currently active */
  isActive: boolean;
  
  /** Icon for the navigation item */
  icon?: string;
  
  /** Whether this item is hidden from navigation */
  hidden?: boolean;
}

export interface RenderedContent {
  /** The main HTML content */
  htmlContent: string;
  
  /** Page title */
  title: string;
  
  /** Page description */
  description: string;
  
  /** Navigation items */
  navigation: NavigationItem[];
  
  /** Breadcrumb items */
  breadcrumbs: NavigationItem[];
  
  /** Additional metadata */
  metadata: Record<string, any>;
  
  /** Table of contents */
  tableOfContents?: TocItem[];
}

export interface TocItem {
  /** Heading text */
  text: string;
  
  /** Heading level (1-6) */
  level: number;
  
  /** Anchor ID */
  anchor: string;
  
  /** Child headings */
  children: TocItem[];
}

export interface GitCommitInfo {
  /** Full commit hash */
  hash: string;
  
  /** Short commit hash */
  shortHash: string;
  
  /** Commit message */
  message: string;
  
  /** Short commit message */
  shortMessage: string;
  
  /** Author name */
  author: string;
  
  /** Author email */
  authorEmail: string;
  
  /** Commit date */
  date: Date;
  
  /** Relative date string */
  dateRelative: string;
}
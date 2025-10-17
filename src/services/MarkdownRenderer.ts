import { marked } from 'marked';
import hljs from 'highlight.js';
import { TocItem } from '../core/models';

export interface MarkdownRendererOptions {
  isStaticSite?: boolean;
  baseUrl?: string;
  currentPath?: string;
}

/**
 * Server-side markdown renderer with full feature support
 */
export class MarkdownRenderer {
  private isStaticSite: boolean;
  private baseUrl: string;
  private currentPath: string;
  private headers: TocItem[] = [];

  constructor(options: MarkdownRendererOptions = {}) {
    this.isStaticSite = options.isStaticSite || false;
    this.baseUrl = options.baseUrl || '';
    this.currentPath = options.currentPath || '';
    this.configureMarked();
  }

  /**
   * Configure marked with syntax highlighting and custom renderers
   */
  private configureMarked(): void {
    // Configure marked options
    marked.setOptions({
      breaks: false,  // Disable automatic line breaks to prevent math splitting
      gfm: true,
    });

    // Custom renderer for links and headers
    const renderer = new marked.Renderer();
    
    // Generate slug for header IDs
    const slugify = (text: string): string => {
      if (!text || typeof text !== 'string') {
        text = String(text || '');
      }
      return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with -
        .replace(/--+/g, '-') // Replace multiple - with single -
        .trim();
    };

    // Override heading renderer to add anchor IDs
    renderer.heading = (token: any) => {
      const text = typeof token === 'object' ? token.text : String(token);
      const level = token.depth || 1;
      const slug = slugify(text);
      
      this.headers.push({
        text,
        level,
        anchor: slug,
        children: []
      });
      
      return `<h${level} id="${slug}">
        <a href="#${slug}" class="header-anchor">
          ${text}
        </a>
      </h${level}>`;
    };
    
    // Override link renderer to handle both dynamic and static sites
    renderer.link = (token: any) => {
      // Extract href, title, and text from the token object
      const href = token.href || '';
      const title = token.title || '';
      const text = token.text || '';
      
      let processedHref = href;
      
      // Handle relative markdown links
      if (processedHref && processedHref.endsWith('.md') && !processedHref.startsWith('http') && !processedHref.startsWith('/')) {
        if (this.isStaticSite) {
          // For static sites, convert .md to .html and keep relative
          processedHref = processedHref.replace('.md', '.html');
        } else {
          // For dynamic sites, convert to content paths
          processedHref = `/content/${processedHref}`;
        }
      }
      
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${processedHref}"${titleAttr}>${text}</a>`;
    };

    // Override code renderer to support Mermaid diagrams
    renderer.code = (token: any) => {
      // Extract code and language from the token object
      const code = token.text || token.code || '';
      const language = token.lang || token.language || '';
      
      if (language === 'mermaid') {
        return `<div class="mermaid">${code}</div>`;
      }
      
      // Default code block with syntax highlighting
      const langClass = language ? ` class="hljs language-${language}"` : ' class="hljs"';
      
      try {
        let highlighted = code;
        if (language && hljs.getLanguage(language)) {
          highlighted = hljs.highlight(code, { language }).value;
        } else if (code) {
          highlighted = hljs.highlightAuto(code).value;
        }
        
        return `<pre><code${langClass}>${highlighted}</code></pre>`;
      } catch (error) {
        console.warn('Highlight.js error for language', language, ':', (error as Error).message);
        // Fallback to plain code block if highlighting fails
        return `<pre><code${langClass}>${code}</code></pre>`;
      }
    };

    marked.use({ renderer });
  }

  /**
   * Build hierarchical table of contents from flat headers list
   */
  private buildTocHierarchy(headers: TocItem[]): TocItem[] {
    const result: TocItem[] = [];
    const stack: TocItem[] = [];

    for (const header of headers) {
      // Pop items from stack until we find a parent or reach the root
      while (stack.length > 0 && stack[stack.length - 1].level >= header.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        // Root level item
        result.push(header);
      } else {
        // Add as child to the last item in stack
        stack[stack.length - 1].children.push(header);
      }

      // Add current header to stack
      stack.push(header);
    }

    return result;
  }

  /**
   * Generate table of contents HTML from collected headers
   */
  private generateTOCHtml(tocItems: TocItem[]): string {
    if (!tocItems || tocItems.length === 0) return '';
    
    const renderTocList = (items: TocItem[]): string => {
      if (items.length === 0) return '';
      
      let html = '<ul>\n';
      for (const item of items) {
        html += `<li><a href="#${item.anchor}">${item.text}</a>`;
        if (item.children.length > 0) {
          html += '\n' + renderTocList(item.children);
        }
        html += '</li>\n';
      }
      html += '</ul>\n';
      return html;
    };
    
    return '<div class="table-of-contents">\n' + renderTocList(tocItems) + '</div>';
  }

  /**
   * Render markdown content to HTML
   */
  async render(markdown: string): Promise<{ html: string; tableOfContents: TocItem[] }> {
    if (!markdown || typeof markdown !== 'string') {
      return { html: '', tableOfContents: [] };
    }
    
    try {
      // Clear headers array before rendering
      this.headers = [];
      
      // Render markdown content
      const html = await marked(markdown);
      
      // Build hierarchical TOC
      const tableOfContents = this.buildTocHierarchy([...this.headers]);
      
      // Generate TOC HTML if there are headers
      const tocHtml = this.generateTOCHtml(tableOfContents);
      
      // Return content with TOC if headers exist
      const finalHtml = tableOfContents.length > 0 ? tocHtml + html : html;
      
      return {
        html: finalHtml,
        tableOfContents
      };
    } catch (error) {
      console.error('Markdown rendering error:', error);
      return {
        html: `<pre><code>${markdown}</code></pre>`,
        tableOfContents: []
      };
    }
  }

  /**
   * Get the current options
   */
  getOptions(): MarkdownRendererOptions {
    return {
      isStaticSite: this.isStaticSite,
      baseUrl: this.baseUrl,
      currentPath: this.currentPath
    };
  }

  /**
   * Update options
   */
  updateOptions(options: Partial<MarkdownRendererOptions>): void {
    if (options.isStaticSite !== undefined) this.isStaticSite = options.isStaticSite;
    if (options.baseUrl !== undefined) this.baseUrl = options.baseUrl;
    if (options.currentPath !== undefined) this.currentPath = options.currentPath;
  }
}
import * as fs from 'fs/promises';
import * as path from 'path';
import { KnowledgeBase } from '../core/KnowledgeBase';
import { KnowledgeBaseOptions } from '../core/interfaces';

/**
 * Static site builder for knowledge base
 */
export class StaticSiteBuilder {
  private knowledgeBase: KnowledgeBase;
  private options: KnowledgeBaseOptions;

  constructor(options: KnowledgeBaseOptions) {
    // Force static site mode
    this.options = {
      ...options,
      isStaticSite: true
    };
    this.knowledgeBase = new KnowledgeBase(this.options);
  }

  /**
   * Build static site
   */
  async build(): Promise<void> {
    console.log('🔨 Building static site...');
    
    const outputDir = this.options.build?.outputDir || './docs';
    
    // Clean output directory if requested
    if (this.options.build?.clean !== false) {
      await this.cleanOutputDirectory(outputDir);
    }

    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });

    // Build all pages
    await this.buildPages(outputDir);

    // Copy assets
    await this.copyAssets(outputDir);

    // Generate additional files
    if (this.options.build?.generateSitemap) {
      await this.generateSitemap(outputDir);
    }

    if (this.options.build?.generateRobots) {
      await this.generateRobots(outputDir);
    }

    console.log('✅ Static site build completed!');
  }

  /**
   * Clean output directory
   */
  private async cleanOutputDirectory(outputDir: string): Promise<void> {
    try {
      console.log('🧹 Cleaning output directory...');
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch (error) {
      // Directory might not exist, that's okay
    }
  }

  /**
   * Build all pages recursively
   */
  private async buildPages(outputDir: string, currentPath: string = ''): Promise<void> {
    const fileService = this.knowledgeBase.getFileService();
    
    try {
      const items = await fileService.getDirectoryListing(currentPath);
      
      for (const item of items) {
        if (item.isDirectory) {
          // Create directory in output
          const dirOutputPath = path.join(outputDir, item.path);
          await fs.mkdir(dirOutputPath, { recursive: true });
          
          // Recursively build subdirectory
          await this.buildPages(outputDir, item.path);
          
          // Check for index.md in directory
          const indexPath = path.posix.join(item.path, 'index.md');
          if (await fileService.exists(indexPath)) {
            const content = await this.knowledgeBase.renderContent(item.path);
            if (content) {
              const htmlPath = path.join(outputDir, item.path, 'index.html');
              await this.writeHtmlFile(htmlPath, content);
            }
          }
        } else if (item.extension === '.md') {
          // Build markdown file
          const content = await this.knowledgeBase.renderContent(item.path);
          if (content) {
            const htmlPath = path.join(
              outputDir, 
              item.path.replace(/\.md$/, '.html')
            );
            await fs.mkdir(path.dirname(htmlPath), { recursive: true });
            await this.writeHtmlFile(htmlPath, content);
          }
        } else {
          // Copy other files as-is
          const sourcePath = fileService.getAbsolutePath(item.path);
          const targetPath = path.join(outputDir, item.path);
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.copyFile(sourcePath, targetPath);
        }
      }
      
      // Handle root index
      if (currentPath === '') {
        const content = await this.knowledgeBase.renderContent('');
        if (content) {
          const indexPath = path.join(outputDir, 'index.html');
          await this.writeHtmlFile(indexPath, content);
        }
      }
      
    } catch (error) {
      console.error(`Error building pages for ${currentPath}:`, error);
    }
  }

  /**
   * Write HTML file with template
   */
  private async writeHtmlFile(filePath: string, content: any): Promise<void> {
    const html = this.generateHtmlTemplate(content);
    await fs.writeFile(filePath, html, 'utf-8');
  }

  /**
   * Generate HTML template
   */
  private generateHtmlTemplate(content: any): string {
    const baseUrl = this.options.baseUrl || '';
    const title = content.title || this.options.title;
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <meta name="description" content="${content.description || this.options.description}">
    ${this.options.enableMath ? '<script src="https://polyfill.io/v3/polyfill.min.js?features=es6"></script>' : ''}
    ${this.options.enableMath ? '<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>' : ''}
    ${this.options.enableSyntaxHighlighting ? '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/default.min.css">' : ''}
    <link rel="stylesheet" href="${baseUrl}/style.css">
    <link rel="stylesheet" href="${baseUrl}/markdown.css">
    <link rel="stylesheet" href="${baseUrl}/assets/css/style.css">
    ${this.options.customCssFiles?.map(css => `<link rel="stylesheet" href="${baseUrl}/${css}">`).join('\n    ') || ''}
</head>
<body>
    <div id="app">
        <nav class="sidebar">
            <div class="nav-header">
                <h2><a href="${baseUrl}/">${this.options.title}</a></h2>
            </div>
            <div class="nav-content">
                ${this.renderNavigation(content.navigation || [])}
            </div>
        </nav>
        
        <main class="main-content">
            ${content.breadcrumbs && content.breadcrumbs.length > 0 ? `
            <nav class="breadcrumb">
                ${content.breadcrumbs.map((item: any) => 
                    `<a href="${baseUrl}/content/${item.path}.html">${item.title}</a>`
                ).join(' / ')}
            </nav>
            ` : ''}
            
            <article class="content">
                ${content.htmlContent}
            </article>
        </main>
    </div>

    ${this.options.enableMermaid ? '<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>' : ''}
    <script src="${baseUrl}/mermaid-init.js"></script>
    <script src="${baseUrl}/app.js"></script>
    <script src="${baseUrl}/assets/js/app.js"></script>
    <script src="${baseUrl}/assets/js/mermaid-init.js"></script>
    ${this.options.enableMermaid ? '<script>mermaid.initialize({startOnLoad:true});</script>' : ''}
    ${this.options.enableSyntaxHighlighting ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>' : ''}
    ${this.options.enableSyntaxHighlighting ? '<script>hljs.highlightAll();</script>' : ''}
    ${this.options.customJsFiles?.map(js => `<script src="${baseUrl}/${js}"></script>`).join('\n    ') || ''}
</body>
</html>`;
  }

  /**
   * Render navigation HTML
   */
  private renderNavigation(navigation: any[]): string {
    if (!navigation || navigation.length === 0) return '';
    
    const baseUrl = this.options.baseUrl || '';
    
    const renderItem = (item: any): string => {
      const hasChildren = item.children && item.children.length > 0;
      const href = item.path.endsWith('.md') 
        ? `${baseUrl}/content/${item.path.replace(/\.md$/, '.html')}`
        : `${baseUrl}/content/${item.path}/`;
      
      let html = `<li class="${item.isActive ? 'active' : ''}">`;
      html += `<a href="${href}">${item.title}</a>`;
      
      if (hasChildren) {
        html += '<ul>';
        for (const child of item.children) {
          html += renderItem(child);
        }
        html += '</ul>';
      }
      
      html += '</li>';
      return html;
    };
    
    let html = '<ul class="nav-list">';
    for (const item of navigation) {
      html += renderItem(item);
    }
    html += '</ul>';
    
    return html;
  }

  /**
   * Copy assets to output directory
   */
  private async copyAssets(outputDir: string): Promise<void> {
    console.log('📦 Copying framework assets...');
    
    // Get the framework assets directory
    const frameworkRoot = path.resolve(__dirname, '../../');
    const frameworkAssetsDir = path.join(frameworkRoot, 'src', 'assets');
    
    // Create output assets directories
    const outputAssetsDir = path.join(outputDir, 'assets');
    const outputCssDir = path.join(outputAssetsDir, 'css');
    const outputJsDir = path.join(outputAssetsDir, 'js');
    
    await fs.mkdir(outputCssDir, { recursive: true });
    await fs.mkdir(outputJsDir, { recursive: true });
    
    try {
      // Copy CSS files
      const cssSourceDir = path.join(frameworkAssetsDir, 'styles');
      const cssFiles = await fs.readdir(cssSourceDir);
      
      for (const cssFile of cssFiles) {
        if (cssFile.endsWith('.css')) {
          const sourcePath = path.join(cssSourceDir, cssFile);
          const targetPath = path.join(outputCssDir, cssFile);
          await fs.copyFile(sourcePath, targetPath);
          console.log(`  ✓ Copied ${cssFile}`);
        }
      }
      
      // Copy JavaScript files
      const jsSourceDir = path.join(frameworkAssetsDir, 'scripts');
      const jsFiles = await fs.readdir(jsSourceDir);
      
      for (const jsFile of jsFiles) {
        if (jsFile.endsWith('.js')) {
          const sourcePath = path.join(jsSourceDir, jsFile);
          const targetPath = path.join(outputJsDir, jsFile);
          await fs.copyFile(sourcePath, targetPath);
          console.log(`  ✓ Copied ${jsFile}`);
        }
      }
      
      // Also copy to root level for compatibility with existing templates
      for (const cssFile of cssFiles) {
        if (cssFile.endsWith('.css')) {
          const sourcePath = path.join(cssSourceDir, cssFile);
          const targetPath = path.join(outputDir, cssFile);
          await fs.copyFile(sourcePath, targetPath);
        }
      }
      
      for (const jsFile of jsFiles) {
        if (jsFile.endsWith('.js')) {
          const sourcePath = path.join(jsSourceDir, jsFile);
          const targetPath = path.join(outputDir, jsFile);
          await fs.copyFile(sourcePath, targetPath);
        }
      }
      
    } catch (error) {
      console.warn('⚠️ Could not copy some framework assets:', error instanceof Error ? error.message : 'Unknown error');
      console.log('   Creating fallback basic styles...');
      
      // Fallback: create basic CSS if framework assets aren't available
      const basicCss = `
/* Basic Knowledge Base Styles - Fallback */
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
  color: #333;
}

#app {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 300px;
  background: #f8f9fa;
  border-right: 1px solid #e9ecef;
  overflow-y: auto;
}

.nav-header {
  padding: 1rem;
  border-bottom: 1px solid #e9ecef;
}

.main-content {
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
}

.content {
  max-width: 800px;
}
`;
      
      await fs.writeFile(path.join(outputCssDir, 'style.css'), basicCss);
      await fs.writeFile(path.join(outputDir, 'style.css'), basicCss);
    }
  }

  /**
   * Generate sitemap.xml
   */
  private async generateSitemap(outputDir: string): Promise<void> {
    // Implementation would collect all pages and generate sitemap
    console.log('Generating sitemap...');
  }

  /**
   * Generate robots.txt
   */
  private async generateRobots(outputDir: string): Promise<void> {
    const robots = `User-agent: *
Allow: /

Sitemap: ${this.options.baseUrl}/sitemap.xml`;
    
    await fs.writeFile(path.join(outputDir, 'robots.txt'), robots);
  }
}
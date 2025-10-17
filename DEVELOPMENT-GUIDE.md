# Knowledge Base Framework - Development Guide

This guide covers how to develop, extend, and customize the Knowledge Base Framework, including JavaScript scripts, styles, templates, and core functionality.

## Table of Contents

1. [Development Environment Setup](#development-environment-setup)
2. [Project Structure](#project-structure)
3. [Core Architecture](#core-architecture)
4. [JavaScript Development](#javascript-development)
5. [Styling System](#styling-system)
6. [Template System](#template-system)
7. [Service Development](#service-development)
8. [Building and Testing](#building-and-testing)
9. [Plugin Development](#plugin-development)
10. [Deployment and Publishing](#deployment-and-publishing)

## Development Environment Setup

### Prerequisites

```bash
# Required tools
node --version    # >= 16.0.0
npm --version     # >= 8.0.0
git --version     # Latest stable
```

### Setting up the Framework

```bash
# Clone the framework repository
git clone https://github.com/solovey1985/knowledge-base-framework.git
cd knowledge-base-framework

# Install dependencies
npm install

# Build the framework
npm run build

# Link globally for testing
npm link

# Watch mode for development
npm run build:watch
```

## Project Structure

```
knowledge-base-framework/
├── src/                          # TypeScript source code
│   ├── core/                     # Core framework classes
│   │   ├── KnowledgeBase.ts      # Main framework orchestrator
│   │   ├── interfaces.ts         # Configuration interfaces
│   │   └── models.ts             # Data models and types
│   ├── services/                 # Business logic services
│   │   ├── FileService.ts        # File system operations
│   │   ├── NavigationService.ts  # Navigation generation
│   │   ├── MarkdownRenderer.ts   # Markdown processing
│   │   └── GitService.ts         # Git repository info
│   ├── builders/                 # Site builders
│   │   └── StaticSiteBuilder.ts  # Static site generation
│   ├── cli/                      # Command line interface
│   │   └── kb.ts                 # CLI implementation
│   └── index.ts                  # Main exports
├── lib/                          # Compiled JavaScript (generated)
├── templates/                    # HTML templates
│   ├── page.hbs                  # Main page template
│   └── partials/                 # Reusable template parts
│       └── navigation.hbs        # Navigation component
├── assets/                       # Default assets
│   ├── css/                      # Default styles
│   ├── js/                       # Client-side scripts
│   └── images/                   # Framework images
├── tests/                        # Test files
├── docs/                         # Framework documentation
├── package.json                  # NPM configuration
├── tsconfig.json                 # TypeScript configuration
└── README.md                     # Main documentation
```

## Core Architecture

### Service-Oriented Design

The framework follows a service-oriented architecture with clear separation of concerns:

```typescript
// Main framework class orchestrates services
export class KnowledgeBase {
  private fileService: FileService;
  private navigationService: NavigationService;
  private markdownRenderer: MarkdownRenderer;
  private gitService: GitService;

  constructor(options: KnowledgeBaseOptions) {
    // Initialize services with dependency injection
    this.fileService = new FileService(options.contentRootPath);
    this.navigationService = new NavigationService(this.fileService);
    this.markdownRenderer = new MarkdownRenderer(options);
    this.gitService = new GitService();
  }
}
```

### Configuration System

All configuration is handled through TypeScript interfaces:

```typescript
// Example: Adding new configuration options
export interface KnowledgeBaseOptions {
  // Existing options...
  
  // New feature configuration
  search?: SearchOptions;
  analytics?: AnalyticsOptions;
}

export interface SearchOptions {
  enabled: boolean;
  indexPath: string;
  engine: 'lunr' | 'fuse' | 'algolia';
}
```

## JavaScript Development

### Client-Side Scripts

Create JavaScript functionality for the generated sites:

#### 1. Create JavaScript Files

```bash
mkdir -p assets/js
```

```javascript
// assets/js/app.js - Main application script
class KnowledgeBaseApp {
  constructor() {
    this.init();
  }

  init() {
    this.setupNavigation();
    this.setupSearch();
    this.setupThemeToggle();
    this.setupScrollSpy();
  }

  setupNavigation() {
    // Mobile navigation toggle
    const navToggle = document.querySelector('.nav-toggle');
    const sidebar = document.querySelector('.sidebar');
    
    if (navToggle && sidebar) {
      navToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
      });
    }

    // Collapsible navigation items
    const navItems = document.querySelectorAll('.nav-item.has-children');
    navItems.forEach(item => {
      const toggle = item.querySelector('.nav-toggle-icon');
      if (toggle) {
        toggle.addEventListener('click', (e) => {
          e.preventDefault();
          item.classList.toggle('expanded');
        });
      }
    });
  }

  setupSearch() {
    const searchInput = document.querySelector('#search-input');
    const searchResults = document.querySelector('#search-results');
    
    if (searchInput && searchResults) {
      let searchIndex = null;
      
      // Load search index
      fetch('/search-index.json')
        .then(response => response.json())
        .then(data => {
          searchIndex = lunr.Index.load(data);
        });

      // Search functionality
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        if (query.length > 2 && searchIndex) {
          const results = searchIndex.search(query);
          this.displaySearchResults(results, searchResults);
        } else {
          searchResults.innerHTML = '';
        }
      });
    }
  }

  displaySearchResults(results, container) {
    if (results.length === 0) {
      container.innerHTML = '<p>No results found</p>';
      return;
    }

    const html = results.map(result => `
      <div class="search-result">
        <h3><a href="${result.ref}">${result.title}</a></h3>
        <p>${result.excerpt}</p>
      </div>
    `).join('');

    container.innerHTML = html;
  }

  setupThemeToggle() {
    const themeToggle = document.querySelector('#theme-toggle');
    
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        localStorage.setItem('theme', 
          document.body.classList.contains('dark-theme') ? 'dark' : 'light'
        );
      });

      // Load saved theme
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
      }
    }
  }

  setupScrollSpy() {
    const tocLinks = document.querySelectorAll('.table-of-contents a');
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    
    if (tocLinks.length && headings.length) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            tocLinks.forEach(link => {
              link.classList.toggle('active', 
                link.getAttribute('href') === `#${id}`);
            });
          }
        });
      }, { rootMargin: '-20% 0% -80% 0%' });

      headings.forEach(heading => observer.observe(heading));
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new KnowledgeBaseApp();
});
```

#### 2. Enhanced Features Script

```javascript
// assets/js/features.js - Advanced features
class FeatureEnhancements {
  constructor() {
    this.setupCodeCopy();
    this.setupMermaidZoom();
    this.setupLazyLoading();
    this.setupPrintMode();
  }

  setupCodeCopy() {
    // Add copy buttons to code blocks
    document.querySelectorAll('pre code').forEach((block, index) => {
      const pre = block.parentElement;
      pre.style.position = 'relative';
      
      const button = document.createElement('button');
      button.className = 'copy-code-btn';
      button.innerHTML = '📋 Copy';
      button.setAttribute('aria-label', 'Copy code to clipboard');
      
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(block.textContent);
          button.innerHTML = '✅ Copied!';
          setTimeout(() => {
            button.innerHTML = '📋 Copy';
          }, 2000);
        } catch (err) {
          console.error('Failed to copy text: ', err);
        }
      });
      
      pre.appendChild(button);
    });
  }

  setupMermaidZoom() {
    // Add zoom functionality to Mermaid diagrams
    document.querySelectorAll('.mermaid').forEach(diagram => {
      diagram.style.cursor = 'zoom-in';
      
      diagram.addEventListener('click', () => {
        const modal = document.createElement('div');
        modal.className = 'diagram-modal';
        modal.innerHTML = `
          <div class="modal-content">
            <span class="close-modal">&times;</span>
            ${diagram.outerHTML}
          </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'flex';
        
        modal.querySelector('.close-modal').addEventListener('click', () => {
          document.body.removeChild(modal);
        });
        
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            document.body.removeChild(modal);
          }
        });
      });
    });
  }

  setupLazyLoading() {
    // Lazy load images
    const images = document.querySelectorAll('img[data-src]');
    
    if ('IntersectionObserver' in window) {
      const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
            imageObserver.unobserve(img);
          }
        });
      });
      
      images.forEach(img => imageObserver.observe(img));
    }
  }

  setupPrintMode() {
    // Print-friendly mode
    const printBtn = document.querySelector('#print-btn');
    
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        window.print();
      });
    }
    
    // Expand all collapsible sections before printing
    window.addEventListener('beforeprint', () => {
      document.querySelectorAll('.collapsible').forEach(el => {
        el.classList.add('print-expanded');
      });
    });
    
    window.addEventListener('afterprint', () => {
      document.querySelectorAll('.collapsible').forEach(el => {
        el.classList.remove('print-expanded');
      });
    });
  }
}

// Auto-initialize features
document.addEventListener('DOMContentLoaded', () => {
  new FeatureEnhancements();
});
```

#### 3. Integration with Framework

Update the StaticSiteBuilder to include JavaScript files:

```typescript
// In StaticSiteBuilder.ts
private async copyAssets(outputDir: string): Promise<void> {
  const assetsDir = path.join(outputDir, 'assets');
  await fs.mkdir(assetsDir, { recursive: true });
  
  // Copy framework JavaScript files
  const frameworkJsDir = path.join(__dirname, '../assets/js');
  if (await this.pathExists(frameworkJsDir)) {
    await fs.cp(frameworkJsDir, path.join(assetsDir, 'js'), { recursive: true });
  }
  
  // Copy project-specific assets
  const projectAssetsDir = path.join(process.cwd(), 'assets');
  if (await this.pathExists(projectAssetsDir)) {
    await fs.cp(projectAssetsDir, assetsDir, { recursive: true });
  }
}
```

## Styling System

### 1. SCSS Architecture

Create a modular SCSS system:

```bash
# Create SCSS structure
mkdir -p assets/scss/{base,components,layout,themes,utils}
```

#### Base Styles

```scss
// assets/scss/base/_variables.scss
:root {
  // Colors
  --color-primary: #007bff;
  --color-secondary: #6c757d;
  --color-success: #28a745;
  --color-danger: #dc3545;
  --color-warning: #ffc107;
  --color-info: #17a2b8;
  
  // Neutral colors
  --color-white: #ffffff;
  --color-gray-100: #f8f9fa;
  --color-gray-200: #e9ecef;
  --color-gray-300: #dee2e6;
  --color-gray-400: #ced4da;
  --color-gray-500: #adb5bd;
  --color-gray-600: #6c757d;
  --color-gray-700: #495057;
  --color-gray-800: #343a40;
  --color-gray-900: #212529;
  
  // Typography
  --font-family-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-family-mono: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  
  // Spacing
  --spacing-xs: 0.25rem;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-xl: 3rem;
  
  // Breakpoints
  --breakpoint-sm: 576px;
  --breakpoint-md: 768px;
  --breakpoint-lg: 992px;
  --breakpoint-xl: 1200px;
  
  // Layout
  --sidebar-width: 300px;
  --header-height: 60px;
  --border-radius: 0.375rem;
  --box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075);
}

// Dark theme variables
[data-theme="dark"] {
  --color-primary: #0d6efd;
  --color-background: var(--color-gray-900);
  --color-surface: var(--color-gray-800);
  --color-text: var(--color-gray-100);
  --color-text-muted: var(--color-gray-400);
}
```

```scss
// assets/scss/base/_typography.scss
body {
  font-family: var(--font-family-sans);
  font-size: 1rem;
  line-height: 1.6;
  color: var(--color-text);
  background-color: var(--color-background);
}

h1, h2, h3, h4, h5, h6 {
  margin-top: 0;
  margin-bottom: var(--spacing-md);
  font-weight: 600;
  line-height: 1.25;
  color: var(--color-text);
  
  .header-anchor {
    opacity: 0;
    transition: opacity 0.2s ease;
    text-decoration: none;
    color: inherit;
    
    &:hover {
      text-decoration: none;
    }
  }
  
  &:hover .header-anchor {
    opacity: 1;
  }
}

h1 { font-size: 2.5rem; }
h2 { font-size: 2rem; }
h3 { font-size: 1.75rem; }
h4 { font-size: 1.5rem; }
h5 { font-size: 1.25rem; }
h6 { font-size: 1.125rem; }

p {
  margin-bottom: var(--spacing-md);
  
  &:last-child {
    margin-bottom: 0;
  }
}

a {
  color: var(--color-primary);
  text-decoration: none;
  
  &:hover {
    text-decoration: underline;
  }
}

code {
  font-family: var(--font-family-mono);
  font-size: 0.875em;
  color: var(--color-danger);
  background-color: var(--color-gray-100);
  padding: 0.2em 0.4em;
  border-radius: 0.25rem;
}

pre {
  font-family: var(--font-family-mono);
  font-size: 0.875rem;
  background-color: var(--color-gray-100);
  border: 1px solid var(--color-gray-200);
  border-radius: var(--border-radius);
  padding: var(--spacing-md);
  overflow-x: auto;
  margin-bottom: var(--spacing-md);
  
  code {
    color: inherit;
    background-color: transparent;
    padding: 0;
  }
}

blockquote {
  margin: var(--spacing-lg) 0;
  padding: var(--spacing-md);
  border-left: 4px solid var(--color-primary);
  background-color: var(--color-gray-50);
  color: var(--color-gray-700);
  
  p:last-child {
    margin-bottom: 0;
  }
}
```

#### Component Styles

```scss
// assets/scss/components/_navigation.scss
.sidebar {
  width: var(--sidebar-width);
  height: 100vh;
  background-color: var(--color-surface);
  border-right: 1px solid var(--color-gray-200);
  overflow-y: auto;
  position: fixed;
  left: 0;
  top: 0;
  z-index: 1000;
  
  @media (max-width: 768px) {
    transform: translateX(-100%);
    transition: transform 0.3s ease;
    
    &.open {
      transform: translateX(0);
    }
  }
}

.nav-header {
  padding: var(--spacing-lg);
  border-bottom: 1px solid var(--color-gray-200);
  
  h2 {
    margin: 0;
    font-size: 1.5rem;
    
    a {
      color: var(--color-text);
      text-decoration: none;
      
      &:hover {
        color: var(--color-primary);
      }
    }
  }
}

.nav-content {
  padding: var(--spacing-md);
}

.nav-list {
  list-style: none;
  padding: 0;
  margin: 0;
  
  li {
    margin: 0;
    
    &.has-children {
      > .nav-item-link {
        position: relative;
        
        &::after {
          content: '▶';
          position: absolute;
          right: var(--spacing-sm);
          transition: transform 0.2s ease;
        }
      }
      
      &.expanded {
        > .nav-item-link::after {
          transform: rotate(90deg);
        }
        
        > ul {
          display: block;
        }
      }
      
      > ul {
        display: none;
      }
    }
  }
  
  ul {
    padding-left: var(--spacing-lg);
    margin-top: var(--spacing-xs);
  }
}

.nav-item-link {
  display: block;
  padding: var(--spacing-sm) var(--spacing-md);
  color: var(--color-text-muted);
  text-decoration: none;
  border-radius: var(--border-radius);
  transition: all 0.2s ease;
  
  &:hover {
    background-color: var(--color-gray-100);
    color: var(--color-text);
  }
  
  &.active {
    background-color: var(--color-primary);
    color: white;
  }
}
```

```scss
// assets/scss/components/_content.scss
.main-content {
  margin-left: var(--sidebar-width);
  min-height: 100vh;
  
  @media (max-width: 768px) {
    margin-left: 0;
  }
}

.content-header {
  background-color: var(--color-surface);
  border-bottom: 1px solid var(--color-gray-200);
  padding: var(--spacing-md) var(--spacing-lg);
  
  @media (max-width: 768px) {
    .nav-toggle {
      display: inline-block;
      background: none;
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      margin-right: var(--spacing-md);
    }
  }
}

.breadcrumb {
  padding: var(--spacing-md) var(--spacing-lg);
  background-color: var(--color-gray-50);
  border-bottom: 1px solid var(--color-gray-200);
  
  .breadcrumb-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    
    li {
      &:not(:last-child)::after {
        content: '/';
        margin: 0 var(--spacing-sm);
        color: var(--color-gray-500);
      }
    }
  }
  
  a {
    color: var(--color-primary);
    
    &:hover {
      text-decoration: underline;
    }
  }
}

.content {
  padding: var(--spacing-xl);
  max-width: 800px;
  
  @media (max-width: 768px) {
    padding: var(--spacing-lg);
  }
}

.table-of-contents {
  background-color: var(--color-gray-50);
  border: 1px solid var(--color-gray-200);
  border-radius: var(--border-radius);
  padding: var(--spacing-lg);
  margin-bottom: var(--spacing-xl);
  
  h2 {
    margin-top: 0;
    margin-bottom: var(--spacing-md);
    font-size: 1.125rem;
    color: var(--color-gray-700);
  }
  
  ul {
    margin: 0;
    padding-left: var(--spacing-lg);
    
    &:first-child {
      padding-left: 0;
    }
  }
  
  a {
    color: var(--color-text);
    text-decoration: none;
    
    &:hover {
      color: var(--color-primary);
    }
    
    &.active {
      color: var(--color-primary);
      font-weight: 600;
    }
  }
}
```

#### Utility Classes

```scss
// assets/scss/utils/_utilities.scss
// Display utilities
.d-none { display: none !important; }
.d-block { display: block !important; }
.d-flex { display: flex !important; }
.d-inline { display: inline !important; }
.d-inline-block { display: inline-block !important; }

// Responsive display
@media (max-width: 576px) {
  .d-sm-none { display: none !important; }
  .d-sm-block { display: block !important; }
}

@media (max-width: 768px) {
  .d-md-none { display: none !important; }
  .d-md-block { display: block !important; }
}

// Spacing utilities
@for $i from 0 through 5 {
  .m-#{$i} { margin: #{$i * 0.25}rem !important; }
  .mt-#{$i} { margin-top: #{$i * 0.25}rem !important; }
  .mr-#{$i} { margin-right: #{$i * 0.25}rem !important; }
  .mb-#{$i} { margin-bottom: #{$i * 0.25}rem !important; }
  .ml-#{$i} { margin-left: #{$i * 0.25}rem !important; }
  
  .p-#{$i} { padding: #{$i * 0.25}rem !important; }
  .pt-#{$i} { padding-top: #{$i * 0.25}rem !important; }
  .pr-#{$i} { padding-right: #{$i * 0.25}rem !important; }
  .pb-#{$i} { padding-bottom: #{$i * 0.25}rem !important; }
  .pl-#{$i} { padding-left: #{$i * 0.25}rem !important; }
}

// Text utilities
.text-left { text-align: left !important; }
.text-center { text-align: center !important; }
.text-right { text-align: right !important; }

.text-muted { color: var(--color-text-muted) !important; }
.text-primary { color: var(--color-primary) !important; }
.text-success { color: var(--color-success) !important; }
.text-danger { color: var(--color-danger) !important; }

// Flexbox utilities
.flex-column { flex-direction: column !important; }
.flex-row { flex-direction: row !important; }
.justify-content-center { justify-content: center !important; }
.justify-content-between { justify-content: space-between !important; }
.align-items-center { align-items: center !important; }
.flex-grow-1 { flex-grow: 1 !important; }
```

#### Main SCSS File

```scss
// assets/scss/main.scss
// Import order is important for cascade
@import 'base/variables';
@import 'base/typography';

@import 'components/navigation';
@import 'components/content';
@import 'components/code';
@import 'components/mermaid';

@import 'layout/grid';
@import 'layout/print';

@import 'themes/dark';
@import 'themes/light';

@import 'utils/utilities';

// Global styles
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  background-color: var(--color-background);
  transition: background-color 0.3s ease, color 0.3s ease;
}

#app {
  display: flex;
  min-height: 100vh;
}

// Smooth scrolling
html {
  scroll-behavior: smooth;
}

// Focus styles for accessibility
:focus {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

// Print styles
@media print {
  .sidebar,
  .breadcrumb,
  .nav-toggle {
    display: none !important;
  }
  
  .main-content {
    margin-left: 0 !important;
  }
  
  .content {
    padding: 0 !important;
    max-width: none !important;
  }
}
```

### 2. CSS Build Process

Add SCSS compilation to the framework:

```typescript
// Add to StaticSiteBuilder.ts
import * as sass from 'sass';

private async compileStyles(outputDir: string): Promise<void> {
  const scssPath = path.join(__dirname, '../assets/scss/main.scss');
  const outputPath = path.join(outputDir, 'assets/css/style.css');
  
  try {
    const result = sass.compile(scssPath, {
      style: 'compressed',
      sourceMap: true
    });
    
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, result.css);
    
    if (result.sourceMap) {
      await fs.writeFile(outputPath + '.map', JSON.stringify(result.sourceMap));
    }
  } catch (error) {
    console.error('SCSS compilation failed:', error);
    // Fallback to basic CSS
    await this.copyBasicCSS(outputDir);
  }
}
```

## Template System

### 1. Handlebars Templates

The framework uses Handlebars for templating. Here's how to work with templates:

#### Main Page Template

```handlebars
{{!-- templates/page.hbs --}}
<!DOCTYPE html>
<html lang="{{lang}}" data-theme="{{theme}}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{title}}{{#if siteTitle}} - {{siteTitle}}{{/if}}</title>
    <meta name="description" content="{{description}}">
    
    {{!-- Open Graph meta tags --}}
    <meta property="og:title" content="{{title}}">
    <meta property="og:description" content="{{description}}">
    <meta property="og:type" content="article">
    {{#if canonicalUrl}}
    <meta property="og:url" content="{{canonicalUrl}}">
    {{/if}}
    
    {{!-- Favicon --}}
    <link rel="icon" type="image/x-icon" href="{{baseUrl}}/favicon.ico">
    
    {{!-- Stylesheets --}}
    {{#if enableSyntaxHighlighting}}
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/{{highlightTheme}}.min.css">
    {{/if}}
    
    {{#if enableMath}}
    <script src="https://polyfill.io/v3/polyfill.min.js?features=es6"></script>
    <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
    {{/if}}
    
    <link rel="stylesheet" href="{{baseUrl}}/assets/css/style.css">
    
    {{#each customCssFiles}}
    <link rel="stylesheet" href="{{../baseUrl}}/{{this}}">
    {{/each}}
    
    {{!-- Custom head content --}}
    {{#if customHeadContent}}
    {{{customHeadContent}}}
    {{/if}}
</head>
<body>
    {{!-- Skip to content link for accessibility --}}
    <a href="#main-content" class="sr-only sr-only-focusable">Skip to main content</a>
    
    <div id="app">
        {{!-- Sidebar Navigation --}}
        <nav class="sidebar" aria-label="Main navigation">
            <div class="nav-header">
                <h2>
                    <a href="{{baseUrl}}/" class="site-title">
                        {{#if siteLogo}}
                        <img src="{{baseUrl}}/{{siteLogo}}" alt="{{siteTitle}}" class="site-logo">
                        {{/if}}
                        {{siteTitle}}
                    </a>
                </h2>
                
                {{!-- Theme toggle --}}
                <button id="theme-toggle" class="theme-toggle" aria-label="Toggle dark mode">
                    <span class="theme-icon light">☀️</span>
                    <span class="theme-icon dark">🌙</span>
                </button>
            </div>
            
            {{!-- Search --}}
            {{#if enableSearch}}
            <div class="search-container">
                <input type="search" id="search-input" placeholder="Search..." aria-label="Search content">
                <div id="search-results" class="search-results"></div>
            </div>
            {{/if}}
            
            <div class="nav-content">
                {{> navigation navigation=navigation baseUrl=baseUrl}}
            </div>
        </nav>
        
        {{!-- Main Content Area --}}
        <main class="main-content">
            {{!-- Mobile Navigation Toggle --}}
            <div class="content-header d-md-none">
                <button class="nav-toggle" aria-label="Toggle navigation">
                    ☰
                </button>
                <span class="page-title">{{title}}</span>
            </div>
            
            {{!-- Breadcrumbs --}}
            {{#if breadcrumbs}}
            <nav class="breadcrumb" aria-label="Breadcrumb">
                <ol class="breadcrumb-list">
                    <li><a href="{{baseUrl}}/">Home</a></li>
                    {{#each breadcrumbs}}
                    <li>
                        {{#if @last}}
                        <span aria-current="page">{{title}}</span>
                        {{else}}
                        <a href="{{../baseUrl}}/content/{{path}}.html">{{title}}</a>
                        {{/if}}
                    </li>
                    {{/each}}
                </ol>
            </nav>
            {{/if}}
            
            {{!-- Page Content --}}
            <div id="main-content" class="content">
                {{!-- Table of Contents --}}
                {{#if tableOfContents}}
                <aside class="table-of-contents">
                    <h2>Table of Contents</h2>
                    {{> toc items=tableOfContents}}
                </aside>
                {{/if}}
                
                {{!-- Main Article --}}
                <article class="markdown-content">
                    {{{htmlContent}}}
                </article>
                
                {{!-- Page Actions --}}
                <div class="page-actions">
                    {{#if showEditLink}}
                    <a href="{{editUrl}}" class="btn btn-secondary" target="_blank" rel="noopener">
                        📝 Edit this page
                    </a>
                    {{/if}}
                    
                    <button id="print-btn" class="btn btn-secondary">
                        🖨️ Print
                    </button>
                    
                    {{#if showShareButtons}}
                    <div class="share-buttons">
                        <button class="btn btn-secondary" onclick="shareViaTwitter()">Share on Twitter</button>
                        <button class="btn btn-secondary" onclick="shareViaLinkedIn()">Share on LinkedIn</button>
                        <button class="btn btn-secondary" onclick="copyPageUrl()">Copy Link</button>
                    </div>
                    {{/if}}
                </div>
            </div>
            
            {{!-- Page Footer --}}
            <footer class="page-footer">
                {{#if gitInfo}}
                <div class="git-info">
                    <small>
                        Last updated: {{gitInfo.dateRelative}} by {{gitInfo.author}}
                        {{#if gitInfo.remoteUrl}}
                        <a href="{{gitInfo.remoteUrl}}/commit/{{gitInfo.hash}}" target="_blank" rel="noopener">
                            ({{gitInfo.shortHash}})
                        </a>
                        {{/if}}
                    </small>
                </div>
                {{/if}}
                
                {{#if customFooterContent}}
                <div class="custom-footer">
                    {{{customFooterContent}}}
                </div>
                {{/if}}
            </footer>
        </main>
    </div>
    
    {{!-- JavaScript Libraries --}}
    {{#if enableMermaid}}
    <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
    <script>
        mermaid.initialize({
            startOnLoad: true,
            theme: document.body.dataset.theme === 'dark' ? 'dark' : 'default'
        });
    </script>
    {{/if}}
    
    {{#if enableSyntaxHighlighting}}
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>
    <script>hljs.highlightAll();</script>
    {{/if}}
    
    {{#if enableSearch}}
    <script src="https://unpkg.com/lunr/lunr.js"></script>
    {{/if}}
    
    {{!-- Framework Scripts --}}
    <script src="{{baseUrl}}/assets/js/app.js"></script>
    <script src="{{baseUrl}}/assets/js/features.js"></script>
    
    {{#each customJsFiles}}
    <script src="{{../baseUrl}}/{{this}}"></script>
    {{/each}}
    
    {{!-- Custom body content --}}
    {{#if customBodyContent}}
    {{{customBodyContent}}}
    {{/if}}
</body>
</html>
```

#### Navigation Partial

```handlebars
{{!-- templates/partials/navigation.hbs --}}
{{#if navigation}}
<ul class="nav-list" role="list">
    {{#each navigation}}
    <li class="nav-item {{#if isActive}}active{{/if}} {{#if children}}has-children{{/if}}" role="listitem">
        <a href="{{../baseUrl}}/content/{{path}}{{#if isDirectory}}/{{else}}.html{{/if}}" 
           class="nav-item-link {{#if isActive}}active{{/if}}"
           {{#if isActive}}aria-current="page"{{/if}}>
            {{#if icon}}<span class="nav-icon">{{icon}}</span>{{/if}}
            {{title}}
        </a>
        
        {{#if children}}
        <ul class="nav-sublist">
            {{#each children}}
            <li class="nav-item {{#if isActive}}active{{/if}}">
                <a href="{{../../baseUrl}}/content/{{path}}{{#if isDirectory}}/{{else}}.html{{/if}}" 
                   class="nav-item-link {{#if isActive}}active{{/if}}"
                   {{#if isActive}}aria-current="page"{{/if}}>
                    {{#if icon}}<span class="nav-icon">{{icon}}</span>{{/if}}
                    {{title}}
                </a>
            </li>
            {{/each}}
        </ul>
        {{/if}}
    </li>
    {{/each}}
</ul>
{{/if}}
```

#### Table of Contents Partial

```handlebars
{{!-- templates/partials/toc.hbs --}}
{{#if items}}
<ul class="toc-list">
    {{#each items}}
    <li class="toc-item toc-level-{{level}}">
        <a href="#{{anchor}}" class="toc-link">{{text}}</a>
        {{#if children}}
        {{> toc items=children}}
        {{/if}}
    </li>
    {{/each}}
</ul>
{{/if}}
```

### 2. Template Integration

Update the framework to use Handlebars:

```typescript
// Add to package.json dependencies
"handlebars": "^4.7.8",
"@types/handlebars": "^4.1.0"

// In StaticSiteBuilder.ts
import Handlebars from 'handlebars';
import * as fs from 'fs/promises';
import * as path from 'path';

export class StaticSiteBuilder {
  private handlebars: typeof Handlebars;
  private templates: Map<string, HandlebarsTemplateDelegate> = new Map();

  constructor(options: KnowledgeBaseOptions) {
    this.handlebars = Handlebars.create();
    this.registerHelpers();
    this.loadTemplates();
  }

  private registerHelpers(): void {
    // Custom helper for conditional formatting
    this.handlebars.registerHelper('formatDate', (date: Date) => {
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    });

    // Helper for generating edit URLs
    this.handlebars.registerHelper('editUrl', (filePath: string, baseUrl: string) => {
      return `${baseUrl}/edit/${filePath}`;
    });

    // Helper for active navigation states
    this.handlebars.registerHelper('isCurrentPage', (itemPath: string, currentPath: string) => {
      return itemPath === currentPath;
    });

    // Math helper for calculations
    this.handlebars.registerHelper('add', (a: number, b: number) => {
      return a + b;
    });

    // String manipulation helpers
    this.handlebars.registerHelper('capitalize', (str: string) => {
      return str.charAt(0).toUpperCase() + str.slice(1);
    });

    this.handlebars.registerHelper('slugify', (str: string) => {
      return str.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .trim();
    });
  }

  private async loadTemplates(): Promise<void> {
    const templatesDir = path.join(__dirname, '../templates');
    
    try {
      // Load main template
      const pageTemplate = await fs.readFile(
        path.join(templatesDir, 'page.hbs'), 
        'utf-8'
      );
      this.templates.set('page', this.handlebars.compile(pageTemplate));

      // Load partials
      const partialsDir = path.join(templatesDir, 'partials');
      const partialFiles = await fs.readdir(partialsDir);
      
      for (const file of partialFiles) {
        if (file.endsWith('.hbs')) {
          const partialName = path.basename(file, '.hbs');
          const partialContent = await fs.readFile(
            path.join(partialsDir, file), 
            'utf-8'
          );
          this.handlebars.registerPartial(partialName, partialContent);
        }
      }
    } catch (error) {
      console.warn('Could not load templates, using default:', error);
    }
  }

  private renderTemplate(templateName: string, context: any): string {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`Template "${templateName}" not found`);
    }
    
    return template({
      ...context,
      // Global template variables
      baseUrl: this.options.baseUrl,
      siteTitle: this.options.title,
      buildTime: new Date(),
      version: this.getFrameworkVersion()
    });
  }

  private async writeHtmlFile(filePath: string, content: RenderedContent): Promise<void> {
    const html = this.renderTemplate('page', {
      ...content,
      enableMath: this.options.enableMath,
      enableMermaid: this.options.enableMermaid,
      enableSyntaxHighlighting: this.options.enableSyntaxHighlighting,
      customCssFiles: this.options.customCssFiles,
      customJsFiles: this.options.customJsFiles,
      lang: 'en', // Could be configurable
      theme: 'light', // Could be user preference
      highlightTheme: 'github' // Configurable
    });
    
    await fs.writeFile(filePath, html, 'utf-8');
  }
}
```

### 3. Custom Template Override

Allow users to override templates:

```typescript
// In KnowledgeBaseOptions interface
export interface KnowledgeBaseOptions {
  // ... existing options
  
  /** Custom templates directory */
  templatesDir?: string;
  
  /** Template overrides */
  templateOverrides?: {
    page?: string;
    navigation?: string;
    toc?: string;
  };
}

// In StaticSiteBuilder
private async loadCustomTemplates(): Promise<void> {
  if (this.options.templatesDir) {
    const customTemplatesDir = path.resolve(this.options.templatesDir);
    
    try {
      // Check if custom templates exist and load them
      const customPageTemplate = path.join(customTemplatesDir, 'page.hbs');
      if (await this.fileExists(customPageTemplate)) {
        const content = await fs.readFile(customPageTemplate, 'utf-8');
        this.templates.set('page', this.handlebars.compile(content));
      }
      
      // Load custom partials
      const customPartialsDir = path.join(customTemplatesDir, 'partials');
      if (await this.fileExists(customPartialsDir)) {
        const partialFiles = await fs.readdir(customPartialsDir);
        
        for (const file of partialFiles) {
          if (file.endsWith('.hbs')) {
            const partialName = path.basename(file, '.hbs');
            const partialContent = await fs.readFile(
              path.join(customPartialsDir, file), 
              'utf-8'
            );
            this.handlebars.registerPartial(partialName, partialContent);
          }
        }
      }
    } catch (error) {
      console.warn('Could not load custom templates:', error);
    }
  }
}
```

## Service Development

### Creating New Services

To add new functionality, create services following the established pattern:

```typescript
// src/services/SearchService.ts
import { FileService } from './FileService';
import { MarkdownRenderer } from './MarkdownRenderer';

export interface SearchIndex {
  id: string;
  title: string;
  content: string;
  path: string;
  tags: string[];
}

export interface SearchResult {
  id: string;
  title: string;
  excerpt: string;
  path: string;
  score: number;
}

export class SearchService {
  private fileService: FileService;
  private markdownRenderer: MarkdownRenderer;
  private searchIndex: SearchIndex[] = [];

  constructor(fileService: FileService, markdownRenderer: MarkdownRenderer) {
    this.fileService = fileService;
    this.markdownRenderer = markdownRenderer;
  }

  /**
   * Build search index from all content files
   */
  async buildIndex(): Promise<void> {
    this.searchIndex = [];
    await this.indexDirectory('');
  }

  private async indexDirectory(dirPath: string): Promise<void> {
    const items = await this.fileService.getDirectoryListing(dirPath);
    
    for (const item of items) {
      if (item.isDirectory) {
        await this.indexDirectory(item.path);
      } else if (item.extension === '.md') {
        await this.indexFile(item.path);
      }
    }
  }

  private async indexFile(filePath: string): Promise<void> {
    try {
      const content = await this.fileService.readFile(filePath);
      const rendered = await this.markdownRenderer.render(content);
      
      // Extract title from first heading or filename
      const title = this.extractTitle(content) || 
                   path.basename(filePath, '.md');
      
      // Extract tags from frontmatter or content
      const tags = this.extractTags(content);
      
      // Clean HTML content for indexing
      const textContent = this.stripHtml(rendered.html);
      
      this.searchIndex.push({
        id: filePath,
        title,
        content: textContent,
        path: filePath,
        tags
      });
    } catch (error) {
      console.warn(`Failed to index file ${filePath}:`, error);
    }
  }

  /**
   * Search the index
   */
  search(query: string, limit: number = 10): SearchResult[] {
    const lowercaseQuery = query.toLowerCase();
    const results: SearchResult[] = [];
    
    for (const item of this.searchIndex) {
      let score = 0;
      
      // Title match (highest weight)
      if (item.title.toLowerCase().includes(lowercaseQuery)) {
        score += 10;
      }
      
      // Content match
      const contentMatches = (item.content.toLowerCase().match(
        new RegExp(lowercaseQuery, 'g')
      ) || []).length;
      score += contentMatches;
      
      // Tag match
      const tagMatches = item.tags.filter(tag => 
        tag.toLowerCase().includes(lowercaseQuery)
      ).length;
      score += tagMatches * 5;
      
      if (score > 0) {
        results.push({
          id: item.id,
          title: item.title,
          excerpt: this.generateExcerpt(item.content, query),
          path: item.path,
          score
        });
      }
    }
    
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private extractTitle(content: string): string | null {
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# ')) {
        return trimmed.substring(2).trim();
      }
    }
    
    return null;
  }

  private extractTags(content: string): string[] {
    // Simple tag extraction from frontmatter or content
    const tagRegex = /tags:\s*\[(.*?)\]/i;
    const match = content.match(tagRegex);
    
    if (match) {
      return match[1]
        .split(',')
        .map(tag => tag.trim().replace(/['"]/g, ''));
    }
    
    return [];
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private generateExcerpt(content: string, query: string): string {
    const queryPos = content.toLowerCase().indexOf(query.toLowerCase());
    
    if (queryPos === -1) {
      return content.substring(0, 200) + '...';
    }
    
    const start = Math.max(0, queryPos - 100);
    const end = Math.min(content.length, queryPos + 100);
    
    return '...' + content.substring(start, end) + '...';
  }

  /**
   * Export search index for client-side search
   */
  exportIndex(): string {
    return JSON.stringify(this.searchIndex);
  }
}
```

### Integrating New Services

Add the new service to the main framework:

```typescript
// In KnowledgeBase.ts
import { SearchService } from '../services/SearchService';

export class KnowledgeBase {
  private searchService?: SearchService;

  constructor(options: KnowledgeBaseOptions) {
    // ... existing initialization
    
    // Initialize search if enabled
    if (options.search?.enabled) {
      this.searchService = new SearchService(
        this.fileService,
        this.markdownRenderer
      );
    }
  }

  /**
   * Build search index
   */
  async buildSearchIndex(): Promise<void> {
    if (this.searchService) {
      await this.searchService.buildIndex();
    }
  }

  /**
   * Search content
   */
  search(query: string, limit?: number): SearchResult[] {
    if (!this.searchService) {
      throw new Error('Search is not enabled');
    }
    
    return this.searchService.search(query, limit);
  }

  /**
   * Get search service
   */
  getSearchService(): SearchService | undefined {
    return this.searchService;
  }
}
```

## Building and Testing

### Development Workflow

1. **Watch Mode**: Use `npm run build:watch` during development
2. **Linking**: Use `npm link` to test the framework globally
3. **Testing**: Create test projects to verify functionality

### Testing Setup

```typescript
// tests/setup.ts
import { KnowledgeBase } from '../src';
import * as fs from 'fs/promises';
import * as path from 'path';

export async function createTestProject(name: string): Promise<string> {
  const testDir = path.join(__dirname, 'fixtures', name);
  
  // Clean up existing test directory
  try {
    await fs.rm(testDir, { recursive: true });
  } catch (error) {
    // Directory might not exist
  }
  
  // Create test content
  await fs.mkdir(path.join(testDir, 'content'), { recursive: true });
  
  await fs.writeFile(
    path.join(testDir, 'content', 'index.md'),
    '# Test Project\n\nThis is a test project.'
  );
  
  await fs.writeFile(
    path.join(testDir, 'kb.config.json'),
    JSON.stringify({
      title: 'Test KB',
      contentRootPath: './content'
    }, null, 2)
  );
  
  return testDir;
}

export function createKnowledgeBase(projectDir: string): KnowledgeBase {
  return new KnowledgeBase({
    title: 'Test KB',
    contentRootPath: path.join(projectDir, 'content')
  });
}
```

```typescript
// tests/services/FileService.test.ts
import { FileService } from '../../src/services/FileService';
import { createTestProject } from '../setup';

describe('FileService', () => {
  let testDir: string;
  let fileService: FileService;

  beforeEach(async () => {
    testDir = await createTestProject('file-service-test');
    fileService = new FileService(path.join(testDir, 'content'));
  });

  test('should read directory listing', async () => {
    const listing = await fileService.getDirectoryListing('');
    expect(listing).toHaveLength(1);
    expect(listing[0].name).toBe('index.md');
    expect(listing[0].isDirectory).toBe(false);
  });

  test('should read file content', async () => {
    const content = await fileService.readFile('index.md');
    expect(content).toContain('# Test Project');
  });

  test('should check if file exists', async () => {
    const exists = await fileService.exists('index.md');
    expect(exists).toBe(true);
    
    const notExists = await fileService.exists('nonexistent.md');
    expect(notExists).toBe(false);
  });
});
```

### Build Scripts

Add comprehensive build scripts:

```json
{
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch",
    "build:production": "tsc && npm run minify && npm run optimize",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint src/**/*.ts --fix",
    "format": "prettier --write src/**/*.ts",
    "minify": "node scripts/minify-assets.js",
    "optimize": "node scripts/optimize-images.js",
    "docs": "typedoc src/index.ts",
    "prepublishOnly": "npm run build:production && npm test"
  }
}
```

## Plugin Development

### Plugin Architecture

Create a plugin system for extensibility:

```typescript
// src/core/Plugin.ts
export interface Plugin {
  name: string;
  version: string;
  init(knowledgeBase: KnowledgeBase): Promise<void>;
  beforeBuild?(options: BuildOptions): Promise<void>;
  afterBuild?(outputDir: string): Promise<void>;
  beforeRender?(content: string, filePath: string): Promise<string>;
  afterRender?(html: string, filePath: string): Promise<string>;
}

export class PluginManager {
  private plugins: Plugin[] = [];
  
  register(plugin: Plugin): void {
    this.plugins.push(plugin);
  }
  
  async initialize(knowledgeBase: KnowledgeBase): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.init(knowledgeBase);
    }
  }
  
  async executeHook(hookName: string, ...args: any[]): Promise<any[]> {
    const results = [];
    
    for (const plugin of this.plugins) {
      const hook = (plugin as any)[hookName];
      if (typeof hook === 'function') {
        const result = await hook.apply(plugin, args);
        results.push(result);
      }
    }
    
    return results;
  }
}
```

### Example Plugin

```typescript
// plugins/analytics-plugin.ts
import { Plugin, KnowledgeBase } from '@solovey1985/knowledge-base-framework';

export class AnalyticsPlugin implements Plugin {
  name = 'analytics';
  version = '1.0.0';
  
  private trackingId: string;
  
  constructor(trackingId: string) {
    this.trackingId = trackingId;
  }
  
  async init(knowledgeBase: KnowledgeBase): Promise<void> {
    console.log('Analytics plugin initialized');
  }
  
  async afterRender(html: string, filePath: string): Promise<string> {
    // Inject analytics script into HTML
    const analyticsScript = `
      <script async src="https://www.googletagmanager.com/gtag/js?id=${this.trackingId}"></script>
      <script>
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', '${this.trackingId}');
      </script>
    `;
    
    return html.replace('</head>', analyticsScript + '</head>');
  }
}

// Usage
const kb = new KnowledgeBase(options);
const pluginManager = new PluginManager();
pluginManager.register(new AnalyticsPlugin('GA_TRACKING_ID'));
await pluginManager.initialize(kb);
```

## Deployment and Publishing

### NPM Publishing

```bash
# Build the framework
npm run build:production

# Run tests
npm test

# Update version
npm version patch  # or minor, major

# Publish to NPM
npm publish
```

### GitHub Actions CI/CD

```yaml
# .github/workflows/ci.yml
name: CI/CD

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        node-version: [16.x, 18.x, 20.x]
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Use Node.js ${{ matrix.node-version }}
      uses: actions/setup-node@v3
      with:
        node-version: ${{ matrix.node-version }}
        cache: 'npm'
    
    - run: npm ci
    - run: npm run build
    - run: npm test
    - run: npm run lint
  
  publish:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        registry-url: 'https://registry.npmjs.org'
    
    - run: npm ci
    - run: npm run build:production
    
    - name: Publish to NPM
      run: npm publish
      env:
        NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Documentation Generation

```bash
# Install TypeDoc for documentation generation
npm install --save-dev typedoc

# Generate documentation
npm run docs

# Deploy docs to GitHub Pages
# (Add to package.json scripts)
"docs:deploy": "typedoc src/index.ts && gh-pages -d docs"
```

This comprehensive development guide covers all aspects of working with the Knowledge Base Framework. Developers can use this to:

1. **Set up their development environment**
2. **Understand the architecture and add new features**
3. **Create custom styles and JavaScript enhancements**
4. **Work with the template system**
5. **Build and test their changes**
6. **Create plugins for extended functionality**
7. **Deploy and publish updates**

The framework is designed to be extensible and maintainable, following modern TypeScript and Node.js best practices.
# Knowledge Base Framework - Quick Reference

## Development Commands

```bash
# Framework Development
npm run build           # Compile TypeScript
npm run build:watch     # Watch mode development
npm test               # Run tests
npm run lint           # Check code style
npm link               # Link globally for testing

# CLI Usage
kb init my-project     # Create new project
kb update             # Refresh server/build/workflow templates
kb serve              # Start dev server
kb build              # Build static site
```

## Key Files & Directories

```
src/
├── core/KnowledgeBase.ts      # Main framework class
├── services/                  # Business logic services
├── builders/StaticSiteBuilder.ts  # Static site generator
└── cli/kb.ts                 # CLI implementation

assets/
├── scss/                     # SCSS source files
├── js/                       # JavaScript files
└── templates/                # Handlebars templates
```

## Configuration Schema

```json
{
  "title": "string",
  "description": "string", 
  "contentRootPath": "./content",
  "baseUrl": "",
  "enableMath": true,
  "enableMermaid": true,
  "enableSyntaxHighlighting": true,
  "navigation": {
    "maxDepth": 3,
    "excludePatterns": ["README.md", ".*"]
  },
  "server": { "port": 3000 },
  "build": {
    "outputDir": "./docs",
    "target": "github"
  }
}
```

## Service Architecture

```typescript
// Creating a new service
export class MyService {
  constructor(private fileService: FileService) {}
  
  async doSomething(): Promise<void> {
    // Service implementation
  }
}

// Using in KnowledgeBase
class KnowledgeBase {
  constructor(options: KnowledgeBaseOptions) {
    this.myService = new MyService(this.fileService);
  }
}
```

## Template Variables

Available in Handlebars templates:

```handlebars
{{title}}              <!-- Page title -->
{{description}}        <!-- Page description -->
{{baseUrl}}           <!-- Base URL -->
{{siteTitle}}         <!-- Site title -->
{{htmlContent}}       <!-- Rendered markdown -->
{{navigation}}        <!-- Navigation items -->
{{breadcrumbs}}       <!-- Breadcrumb items -->
{{tableOfContents}}   <!-- TOC items -->
{{gitInfo}}           <!-- Git commit info -->
{{enableMath}}        <!-- Math rendering enabled -->
{{enableMermaid}}     <!-- Mermaid enabled -->
{{customCssFiles}}    <!-- Custom CSS files -->
{{customJsFiles}}     <!-- Custom JS files -->
```

## CSS Custom Properties

```css
/* Colors */
--color-primary: #007bff;
--color-background: #ffffff;
--color-surface: #f8f9fa;
--color-text: #212529;
--color-text-muted: #6c757d;

/* Layout */
--sidebar-width: 300px;
--spacing-md: 1rem;
--border-radius: 0.375rem;

/* Typography */
--font-family-sans: system-ui, sans-serif;
--font-family-mono: 'SF Mono', monospace;
```

## JavaScript API

```javascript
// Main app class
class KnowledgeBaseApp {
  setupNavigation()      // Mobile nav & collapsible
  setupSearch()          // Search functionality  
  setupThemeToggle()     // Dark/light theme
  setupScrollSpy()       // TOC active states
}

// Feature enhancements
class FeatureEnhancements {
  setupCodeCopy()        // Copy code buttons
  setupMermaidZoom()     // Diagram zoom
  setupLazyLoading()     // Image lazy loading
  setupPrintMode()       // Print optimization
}
```

## Plugin Development

```typescript
interface Plugin {
  name: string;
  version: string;
  init(kb: KnowledgeBase): Promise<void>;
  beforeBuild?(options: BuildOptions): Promise<void>;
  afterBuild?(outputDir: string): Promise<void>;
  beforeRender?(content: string, path: string): Promise<string>;
  afterRender?(html: string, path: string): Promise<string>;
}

// Plugin usage
const plugin = new MyPlugin();
pluginManager.register(plugin);
```

## Common Tasks

### Adding New Configuration Option

1. Update `KnowledgeBaseOptions` interface
2. Add default value in `mergeWithDefaults()`
3. Use in relevant services
4. Update templates if needed

### Creating Custom Styles

1. Edit `assets/scss/` files
2. Build with `npm run build`
3. Reference in `customCssFiles` config

### Adding JavaScript Features

1. Create file in `assets/js/`
2. Reference in `customJsFiles` config
3. Initialize in `DOMContentLoaded`

### Custom Template

1. Create `.hbs` file in `templates/`
2. Set `templatesDir` in config
3. Override partials in `partials/` subdirectory

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm test:watch

# Coverage report
npm test:coverage

# Create test project
const testDir = await createTestProject('test-name');
const kb = createKnowledgeBase(testDir);
```

## Debugging

```typescript
// Enable debug logging
process.env.DEBUG = 'kb:*';

// Check build output
console.log('Generated files:', await fs.readdir(outputDir));

// Validate templates
const template = handlebars.compile(templateSource);
console.log(template(testData));
```

## Performance Tips

1. **Large Sites**: Increase `maxDepth` carefully
2. **Build Speed**: Use `--target=local` for testing
3. **Assets**: Optimize images before adding
4. **Search**: Consider external search for large content
5. **Cache**: Enable browser caching for assets

## Troubleshooting

| Issue | Solution |
|-------|----------|
| CLI not found | Run `npm link` in framework directory |
| Build fails | Check TypeScript errors with `npm run build` |
| Styles not loading | Verify `customCssFiles` paths |
| Template errors | Check Handlebars syntax and context |
| Navigation empty | Verify `contentRootPath` and file structure |

## Best Practices

- **Services**: Single responsibility, testable
- **Templates**: Semantic HTML, accessibility  
- **Styles**: CSS custom properties, mobile-first
- **JavaScript**: Progressive enhancement
- **Content**: Consistent file naming, clear structure
- **Configuration**: Environment-specific settings

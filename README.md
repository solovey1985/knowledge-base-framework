# Knowledge Base Framework

A flexible, Node.js-based framework for building markdown-based knowledge bases and documentation portals with support for Mermaid diagrams, LaTeX math, and syntax highlighting.

## Features

- 📝 **Markdown Support** - Full CommonMark and GitHub Flavored Markdown
- 🔗 **Auto Navigation** - Automatically generated navigation from folder structure
- 📊 **Mermaid Diagrams** - Built-in support for Mermaid diagram rendering
- 🧮 **LaTeX Math** - Mathematical notation with MathJax
- 🎨 **Syntax Highlighting** - Code blocks with highlight.js
- 📱 **Responsive Design** - Mobile-friendly interface
- 🔍 **Table of Contents** - Automatic TOC generation from headings
- ⚡ **Fast Builds** - Optimized static site generation
- 🛠️ **TypeScript** - Full TypeScript support with type definitions

## Quick Start

### Using the CLI (Recommended)

```bash
# Install globally
npm install -g @solovey1985/knowledge-base-framework

# Create a new project
kb init my-docs

# Navigate and install
cd my-docs
npm install

# Start development server
npm start

# Build static site
npm run build
```

### Manual Setup

```bash
npm install @solovey1985/knowledge-base-framework express
```

Create a `server.js`:

```javascript
const express = require('express');
const { KnowledgeBase } = require('@solovey1985/knowledge-base-framework');

const app = express();
const kb = new KnowledgeBase({
  contentRootPath: './content',
  title: 'My Knowledge Base',
  description: 'A comprehensive knowledge base'
});

kb.setupMiddleware(app);

app.listen(3000, () => {
  console.log('Knowledge Base running at http://localhost:3000');
});
```

## Configuration

Create a `kb.config.json` file:

```json
{
  "title": "My Knowledge Base",
  "description": "A comprehensive documentation portal",
  "contentRootPath": "./content",
  "baseUrl": "",
  "enableMath": true,
  "enableMermaid": true,
  "enableSyntaxHighlighting": true,
  "navigation": {
    "maxDepth": 3,
    "excludePatterns": ["README.md", ".*"]
  },
  "server": {
    "port": 3000
  },
  "build": {
    "outputDir": "./docs",
    "target": "github"
  }
}
```

## API Reference

### KnowledgeBase Class

```typescript
import { KnowledgeBase, KnowledgeBaseOptions } from '@solovey1985/knowledge-base-framework';

const kb = new KnowledgeBase(options);
```

### Static Site Builder

```typescript
import { StaticSiteBuilder } from '@solovey1985/knowledge-base-framework';

const builder = new StaticSiteBuilder(options);
await builder.build();
```

### Services

The framework provides several services that can be used independently:

- `FileService` - File system operations
- `NavigationService` - Navigation menu generation
- `MarkdownRenderer` - Markdown to HTML conversion
- `GitService` - Git repository information

## Content Structure

```
content/
├── index.md              # Home page
├── guides/               # Guides section
│   ├── index.md
│   ├── getting-started.md
│   └── advanced.md
├── reference/            # Reference section
│   ├── index.md
│   └── api.md
└── assets/              # Static assets
    ├── images/
    └── files/
```

## Markdown Features

### Standard Markdown

All CommonMark and GitHub Flavored Markdown features are supported.

### Math (LaTeX)

```markdown
Inline math: $E = mc^2$

Block math:
$$
\frac{d}{dx}\int_a^x f(t)dt = f(x)
$$
```

### Mermaid Diagrams

```markdown
\`\`\`mermaid
graph TD
    A[Start] --> B[Process]
    B --> C[End]
\`\`\`
```

### Code Highlighting

```markdown
\`\`\`typescript
interface User {
  name: string;
  email: string;
}
\`\`\`
```

## Deployment

### GitHub Pages

Set `build.target` to `"github"` in your config and run:

```bash
npm run build
```

Then commit and push the `docs/` directory.

### Netlify/Vercel

Set `build.target` to `"local"` and deploy the `docs/` directory.

## CLI Commands

- `kb init [name]` - Create new project
- `kb serve` - Start development server  
- `kb build` - Build static site
- `kb help` - Show help

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request
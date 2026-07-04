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
- 🔌 **Plugin System** - Extend rendering and directory behavior with plugins
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

### Upgrading Existing Projects

After bumping `@solovey1985/knowledge-base-framework` in a project, run:

```bash
kb update
```

to refresh `server.js`, `build.js`, `.github/workflows/deploy.yml`, README, and `package.json` scripts.

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

### Plugins

You can extend the framework with plugins via `KnowledgeBaseOptions.plugins`.

For scaffolded projects (`kb init`), plugin configuration lives in a separate `kb.plugins.json` file and is loaded automatically by `server.js`, `kb serve`, and `kb build`.

```typescript
import express from 'express';
import { KnowledgeBase, threeDViewerPlugin } from '@solovey1985/knowledge-base-framework';

const app = express();

const kb = new KnowledgeBase({
  contentRootPath: './content',
  title: 'Engineering KB',
  plugins: [
    threeDViewerPlugin({
      extensions: ['.stl', '.obj'],
      backgroundColor: '#f8fafc',
      modelRotation: { x: -90, y: 0, z: 0 }
    })
  ]
});

kb.setupMiddleware(app);
```

Built-in plugin: `threeDViewerPlugin`

- Renders `.stl` and `.obj` files as interactive 3D previews.
- Adds a dedicated **3D Models** section in directory listings.
- Supports viewer background color and model rotation configuration.
- Keeps original model files downloadable via **Open original** link.

Built-in plugin: `interviewPrepPlugin`

- Activates on `*.interview.md` pages.
- Supports hidden-answer questions, multiple-choice questions, and code-completion exercises.
- Persists interview progress locally in the browser.

Example interview content file:

````md
---
title: TypeScript Interview Practice
interview:
  persistProgress: true
---

# TypeScript Interview Practice

```interview-question
What is the difference between `interface` and `type` in TypeScript?
---
answer:
Interfaces support declaration merging. Types are more general and can model unions and primitives.
hints:
- One supports declaration merging.
- One is often used with unions.
```

```interview-choice
Which statement about closures is correct?
---
options:
- A closure only exists in async functions.
- A closure keeps access to variables from its lexical scope.
- A closure copies outer values when the function is created.
correct: 1
explanation:
Closures keep access to the lexical environment in which they were created.
```

```interview-code
language: ts
prompt: Complete the function so it returns only even values.
starter:
function onlyEven(values: number[]): number[] {
  return values.
}
solution:
function onlyEven(values: number[]): number[] {
  return values.filter(value => value % 2 === 0);
}
checks:
- includes: filter
- includes: % 2 === 0
```
````

Example `kb.plugins.json`:

```json
{
  "plugins": [
    {
      "name": "threeDViewer",
      "enabled": true,
      "options": {
        "extensions": [".stl", ".obj"],
        "sectionTitle": "3D Models"
      }
    },
    {
      "name": "interviewPrep",
      "enabled": true,
      "options": {
        "sectionTitle": "Interview Prep"
      }
    }
  ]
}
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

Scaffolded projects also include `.github/workflows/deploy.yml`, which mirrors the second-brain deployment: every push to `main` runs `npm ci`, executes `npm run build:github`, and publishes `docs/` to the `gh-pages` branch via `peaceiris/actions-gh-pages`. Enable it by choosing **Settings → Pages → Deploy from branch → gh-pages (/)**.

### Netlify/Vercel

Set `build.target` to `"local"` and deploy the `docs/` directory.

## CLI Commands

- `kb init [name]` - Create new project
- `kb update` - Refresh server/build/workflow templates after upgrading the framework
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

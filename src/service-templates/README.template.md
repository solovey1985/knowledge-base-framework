# {{PROJECT_NAME}}

A knowledge base built with [Knowledge Base Framework](https://github.com/solovey1985/knowledge-base-framework).

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm start

# Build static site
npm run build
```

## Configuration

Edit `kb.config.json` to customize your knowledge base settings.

## Content Structure

Add your markdown files to the `content/` directory. The framework will automatically:

- Generate navigation from your folder structure
- Create breadcrumbs for easy navigation
- Render Markdown with syntax highlighting
- Support Mermaid diagrams and LaTeX math
- Generate table of contents from headings

## Deployment

The `npm run build` command generates a static site in the `docs/` directory that can be deployed to GitHub Pages, Netlify, Vercel or any static hosting service.

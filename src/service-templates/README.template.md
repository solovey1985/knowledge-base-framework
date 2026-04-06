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

# Refresh framework-managed files after upgrading
kb update
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

The `npm run build` (or `npm run build:github`) command generates a static site in the `docs/` directory.

### GitHub Pages

This project includes `.github/workflows/deploy.yml`, which:

1. Runs on pushes to `main` (and can be triggered manually).
2. Executes `npm ci` followed by `npm run build:github`.
3. Publishes the `docs/` folder to the `gh-pages` branch via `peaceiris/actions-gh-pages`.

To enable it:

1. Push the repository to GitHub.
2. Go to **Settings → Pages** and select the `gh-pages` branch as the source.
3. Adjust the workflow tokens (`DEFAULT_BRANCH`, `OUTPUT_DIR`) if your repository uses different names.

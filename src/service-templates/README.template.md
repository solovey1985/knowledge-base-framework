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

Edit `kb.plugins.json` to enable/disable framework plugins (for example the built-in 3D viewer plugin).

Interview practice pages can be created as `*.interview.md` files when the `interviewPrep` plugin is enabled in `kb.plugins.json`.

`server.js` and `build.js` are thin entry points: the framework resolves `kb.config.json`, loads the plugins and owns the middleware order. Environment: `PORT`, `HOST`, and `KB_PLUGINS_CONFIG` (an alternative plugin settings file).

Private access uses the `passwordAuth` plugin and server-side `AUTH_*` environment variables; see `PASSWORD_AUTH.md` in the framework package. A site with authentication cannot be exported as a static site.

## Content Structure

Add your markdown files to the `content/` directory. The framework will automatically:

- Generate navigation from your folder structure
- Create breadcrumbs for easy navigation
- Render Markdown with syntax highlighting
- Support Mermaid diagrams and LaTeX math
- Generate table of contents from headings

## Deployment

This project can run as a server on Render with:

1. Build command: `npm install`
2. Start command: `npm start`
3. Health check path: `/healthz` (empty 204, always public)
4. Private access: enable `passwordAuth` in `kb.plugins.json` and set the `AUTH_*` variables

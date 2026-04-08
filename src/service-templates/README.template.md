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

To enable private access, set `auth.enabled` to `true` and provide:

- `auth.username`
- `auth.password`
- `auth.cookieSecret`

On Render, these values can also come from `KB_AUTH_*` environment variables.

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
3. Optional private access env vars: `KB_AUTH_ENABLED`, `KB_AUTH_USERNAME`, `KB_AUTH_PASSWORD`, `KB_AUTH_COOKIE_SECRET`

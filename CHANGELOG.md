# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0-rc.20] - 2026-11-14

- Close the content watcher when its root directory is deleted, so it does not keep the process running on Windows.

## [2.0.0-rc.19] - 2026-11-14

- Load local OBJ materials and textures and render OBJ faces from both sides.
- Add lighting, material, shading, and edge controls to the 3D viewer.
- Add first-person navigation with WASD, mouse look, and E/Q for elevation.
  Touch controls provide movement, drag-to-look, elevation, and an exit button.
- Unreference the development content watcher so it does not keep the process running.

## [2.0.0-rc.18] - 2026-11-12

First release candidate of the 2.0 line. It is a large step from 1.0.x: a plugin
architecture, authentication and storage, a React client with no CDN requests, and
a hardened static build. Published under the `next` dist-tag.

### Added
- **Open plugin system.** A name-to-factory registry replaces the hard-coded plugin
  list. Projects can load external plugins from a module path or npm package through
  `kb.plugins.json`, declare dependencies (`requires`), and contribute Markdown and
  search-index hooks. `kb doctor` validates configuration, options and dependencies
  without network access.
- **Authentication.** `passwordAuth` plugin (Argon2 hashing, signed sessions, CSRF,
  login rate limiting). At most one authentication plugin per application.
- **Storage.** `googleDriveStorage` provider with opaque tickets, last-write-wins,
  backups and read-only reconciliation.
- **Work Manager.** Per-document task manager (`*.work-manager.md`), fixed JSON API,
  and a cross-project overview of open work (Today, overdue, by priority).
- **Notes.** `[[wiki links]]`, backlinks and tags with Unicode-safe heading anchors.
- **3D viewer.** STL, OBJ and 3MF models, loaded on demand.
- **Shared entry points.** `createApp`, `startServer` and `buildSite` are exported and
  used by the CLI and the scaffolded project, with a neutral `GET /healthz`.
- **CLI.** `--config`, `--port`, `--plugins` options; `kb update --dry-run`/`--force`
  that will not silently overwrite files you changed.

### Changed
- **Client.** Vite + Tailwind 4 build with a per-plugin lazy bundle. Mermaid, KaTeX,
  Three.js and fonts are bundled locally; the rendered pages make no CDN requests.
- **Static build.** Each directory gets exactly one `index.html` (authored `index.md`
  when present, otherwise a generated listing); the first breadcrumb is the authored
  home; a page that cannot be rendered aborts the build instead of being logged.
- **Search.** Deleted and renamed documents are detected; one public payload schema for
  the in-memory and on-disk index; titles come from YAML front matter.
- **Performance.** The navigation tree and Git commit info are cached; a content watcher
  provides live reload in development.
- **Package.** Pruned dependencies, added `LICENSE`, removed unused scaffold assets.

### Security
- A site that needs authentication can no longer be exported as a static site: the
  builder refuses before cleaning its output directory, in the CLI and the direct API.
- The private search index is served `private, no-store`.

### Notes
- Prerelease. Not yet verified on Windows, against live Google Drive, or on Render.

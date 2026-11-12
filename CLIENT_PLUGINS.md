# Client plugins

The framework shell and plugin clients have separate Vite entries. `client/main.ts` owns navigation/search/Mermaid/lightbox only and has no plugin imports. The four interactive plugin entries import shared React chunks on their own pages.

## Loading contract

`KnowledgeBasePlugin.clientEntry?: { file: string; marker: string; cssFile?: string }` is the server declaration. It is consumed only from resolved enabled plugins. TemplateContextBuilder adds the ESM entry only when rendered htmlContent contains an actual HTML container bearing its marker (plain text/code mentions do not match). Disabled plugins have no script entry even if their marker appears in authored HTML. An enabled plugin without a matching page has no script entry either. Existing clientAssets/custom classic scripts remain compatible.

Built-in entries use `kb-plugin-<name>.js`. Vite emits each into templates/default/assets, and server/static asset copying ships the complete reusable framework distribution. Application settings control HTML references and browser downloads; they do not remove disabled plugin files from the npm package or asset directory. React and other plugin code are absent from kb-app.js. This is page-based lazy loading: the entry is requested when its plugin page is opened, without a global client registry containing disabled imports.

## Structure

- client/core/mount.ts: idempotent mount, navigation cleanup, BFCache handling.
- client/core/httpClient.ts: same-origin credentials, CSRF header, 45s timeout and request cancellation on disposal.
- client/shared/controls.tsx: shared Button/IconButton/Icon/Field components.
- client/plugins/work-manager/index.tsx: React page, task editor and timer components.
- client/plugins/work-manager/editor.ts: explicit Save/ticket/reconcile controller; mutable snapshots preserve edits made while Save is pending.
- client/plugins/work-manager/timerStore.ts: Web Locks and persisted interval coordination, separate from React display ticks.
- client/plugins/{interview-prep,tech-memory,three-d-viewer}/index.tsx: React page entries. Interview and concept cards render into the slots created by the Markdown renderer. Their model modules retain the page-specific localStorage keys. Three.js owns the WebGL canvas while React owns controls and lifecycle.
- client/styles/tailwind.css: Tailwind utilities compiled by @tailwindcss/vite into kb-app.css. Source scanning covers TSX components, Handlebars templates and server renderers.
- src/plugins/work-manager/{model,draft,planning,timer}.ts: shared business rules and existing JSON contracts.

Work Manager preserves kb.wm.v1 local draft keys, lastTimerId, baseMinutes, explicit recovery, YAML metadata and Drive schema/API. Text renders through React text values. There is no automatic Save effect. Subscriptions, timer display intervals, session checks and pending HTTP requests have cleanup. Login remains a self-contained page.

## Checks

`npm run typecheck:client` uses tsconfig.client.json and is part of build/test. `npm run lint` includes client TS/TSX and server TS. Browser-only CDN modules have explicit ambient declarations; Three types are provided by @types/three. Vite emits the assets; do not edit generated JS manually.

Node tests verify disabled/ordinary/matching-page script references, nested baseUrl and that the core bundle has no plugin markers. Browser acceptance verified missing-title feedback, create/Save, Start/Stop/review/Save, and reload of the saved 2 minutes on an isolated real Drive workspace. No production or Render acceptance is implied. Previous timer 401/sleep/crash-window gates remain open.

## Buttons and CSS icons

React controls and server templates share `kb-button`, `kb-button-primary`, `kb-button-secondary`, and `kb-button-danger`, authored with Tailwind `@apply`. React Button accepts an optional full CSS icon class and a loading state. IconButton requires a label, used for both its accessible name and tooltip; decorative icons are aria-hidden.

Iconify Tailwind 4 and the local Lucide data package are build dependencies. `scripts/build-icon-styles.mjs` collects literal `icon-[lucide--name]` classes from each plugin and the shell separately. It runs before asset builds. Use full literal classes instead of constructing icon names dynamically. When introducing a new icon during watch mode, restart the asset watcher to regenerate the candidate files.

The generated icon CSS scans only icon candidates, preventing duplicated base utilities from overriding responsive styles. Shell icons live in kb-app.css. Each plugin declares its own `cssFile: kb-icons-<name>.css`, attached under the same enabled-and-matching-page condition as its script. No icon CDN or browser icon runtime is needed. Ordinary pages load no plugin icon CSS.

## Folder navigation

NavigationService carries explicit folder identity, including empty and depth-limited folders. The template renders a separate labelled chevron only when children exist. Folder links remain independent. Folders start collapsed, then saved expansion state and the current page's ancestors are revealed. First expansion exposes direct children only; previously expanded descendants retain their state. Enter/Space toggle the focused button; Left/Right explicitly collapse/expand. Bulk controls remain available. The mobile drawer uses the same tree and supports Escape.

2026-11-06 acceptance used an isolated temporary project, not Second Brain. Verified single-level expansion, nested folders, folder-link navigation, bulk controls, keyboard arrows, desktop icons and the mobile drawer at 390px. Work Manager used a fixture API, not Google Drive. Other plugin icon assets are covered by build checks; this does not imply fresh WebGL or all-plugin browser acceptance.

## Bundled libraries (rc.18)

Mermaid, KaTeX (with its fonts), Three.js and the interface fonts are npm dev dependencies bundled by Vite into `templates/default/assets`. Pages request them as lazy chunks only when they contain a diagram, a formula or a 3D model; nothing is loaded from a CDN, so a site works offline and under a strict Content-Security-Policy. Vite uses `base: './'`: every generated reference is relative, because assets are served from `/framework-assets`, `/assets` or `<baseUrl>/assets`. highlight.js runs on the server only; the browser receives the theme stylesheet. Source maps are not shipped.

A plugin may declare `clientEntries` in addition to `clientEntry` when it has more than one kind of page (Work Manager: the project editor and the overview). Third-party plugins ship their own files through `assetsDir`; see [PLUGIN_AUTHORING.md](PLUGIN_AUTHORING.md).

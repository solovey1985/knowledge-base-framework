# Writing a plugin

A plugin is a function that receives its options and returns a `KnowledgeBasePlugin` object. Built-in plugins and your own use the same contract and the same registry. A complete working example is in [docs/examples/plugins/reading-time](docs/examples/plugins/reading-time/index.cjs); the framework's tests run it.

## Connect a plugin

`kb.plugins.json` lists the plugins of a project. An entry names either a registered plugin or a module of your own:

```json
{
  "plugins": [
    { "name": "threeDViewer", "enabled": true, "options": { "extensions": [".stl", ".obj", ".3mf"] } },
    { "module": "./plugins/reading-time/index.cjs", "options": { "wordsPerMinute": 200 } },
    { "module": "kb-plugin-from-npm", "enabled": false }
  ]
}
```

- `name` matches a registered plugin; case, separators and a `Plugin` suffix are ignored (`threeDViewer`, `three-d-viewer`).
- `module` is a path relative to the settings file, or a package name resolved from that directory.
- `enabled: false` skips the entry completely: its module is not loaded and its options are not validated.
- `KB_PLUGINS_CONFIG` (or `kb serve --plugins <file>`) selects another settings file, for example a private profile.

A module exports the factory itself (`module.exports = options => plugin`), `{ default }`, `{ plugin }`, or a definition `{ name, create }`. The factory is called once at startup with `(options, { configDir })`.

Only modules named in your own settings file are loaded. A plugin runs with the full rights of the server process, so add third-party plugins as carefully as any dependency.

To make a plugin available by name instead of by module path, register it before the settings are loaded:

```js
const { registerPlugin, startServer } = require('@solovey1985/knowledge-base-framework');
registerPlugin({ name: 'reading-time', create: require('./plugins/reading-time/index.cjs') });
startServer();
```

## What a plugin can provide

| Field | Purpose |
| --- | --- |
| `id` | Unique id. Lowercase letters, digits and hyphens when the plugin serves assets. |
| `contentRenderers` | Render files by extension or by a `matches(path, extension)` function, and decorate them in directory listings. |
| `markdownExtensions` | [marked extensions](https://marked.js.org/using_pro#extensions) applied to every Markdown render: custom inline or block syntax. |
| `transformPage(page, context)` | Post-process a rendered Markdown document: add HTML, change the title or metadata. Return the changed page or nothing. |
| `searchDocuments(context)` | Add documents to the search index. A failure is logged and never breaks search. |
| `assetsDir` | Absolute directory served at `/plugin-assets/<id>/` and copied by static builds. |
| `clientEntry` | `{ file, marker, cssFile? }`: an ES module loaded only on pages that contain an element with the `marker` attribute. |
| `clientAssets` | `{ css, js }` public URLs added to every page. |
| `authentication` | `{ middleware }` installed before every route. At most one enabled plugin may provide it. |
| `storageProviders` | Storage back ends other plugins use by id. |
| `setupServer(app, context)` | Register API routes; runs after authentication. |
| `requiresAuthentication` | The application refuses to start when no authentication plugin is enabled. |
| `requiresStorage` | Storage provider ids the plugin uses; `kb doctor` reports a missing one by name. |

Set `metadata.layout = 'fullscreen'` on a rendered page to drop the navigation shell, as the 3D viewer does.

### Rules that keep a plugin safe to operate

- Validate options and environment variables in the factory and throw a clear `Error`. The factory must not perform network requests: it also runs in `kb doctor`.
- Read secrets from environment variables, never from options or content.
- Escape everything you put into HTML. `transformPage` and content renderers return raw HTML.
- A plugin that writes data must set `requiresAuthentication: true`; a static export of such a site is refused.
- A `markdownExtensions` entry should add custom tokens (`extensions: [...]`). Overrides of the standard renderer methods are not applied: the framework supplies its own renderer for links, images, headings and code.

## Client code

A plugin's client code is a plain ES module in `assetsDir`; no build step is required. The framework adds the script (as `type="module"`) and the optional stylesheet only when the rendered page contains an element carrying the marker attribute, so pages that do not use the plugin download nothing.

```js
// assets/reading-time.js
for (const element of document.querySelectorAll('[data-reading-time]')) {
  element.textContent = `${element.dataset.minutes} min read`;
}
```

On a private site the assets are served after authentication, like the rest of the site.

## Check a project

```bash
kb doctor                 # configuration, plugin options, relations between plugins
kb doctor --private       # also require an authentication plugin
kb doctor --verbose       # include the plugins' own error messages
```

`kb doctor` works offline, starts no server and exits with code 1 when something must be fixed. Without `--verbose` it does not print a plugin's own error message, which may quote configuration values. The same check is available as `checkProject()`.

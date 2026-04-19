import path from 'path';
import { KnowledgeBasePlugin } from '../core/plugins';

const DEFAULT_EXTENSIONS = ['.stl', '.obj'];

const MODEL_EXTENSIONS = new Set([
  '.stl',
  '.obj',
  '.ply',
  '.glb',
  '.gltf'
]);

export interface ThreeDViewerPluginOptions {
  extensions?: string[];
  sectionTitle?: string;
}

export function threeDViewerPlugin(options: ThreeDViewerPluginOptions = {}): KnowledgeBasePlugin {
  const configuredExtensions = (options.extensions || DEFAULT_EXTENSIONS)
    .map(extension => extension.toLowerCase());

  return {
    id: 'three-d-viewer',
    contentRenderers: [
      {
        id: 'three-d-file-renderer',
        extensions: configuredExtensions,
        async render(context) {
          const stats = await context.getStats(context.requestPath);
          const displayName = path.basename(context.requestPath);
          const extension = path.extname(context.requestPath).replace('.', '').toLowerCase();
          const modelUrl = context.buildRawContentUrl(context.requestPath);
          const escapedTitle = escapeHtml(displayName);
          const escapedPath = escapeHtml(context.requestPath);
          const html = `
            <div class="kb-model flex h-full w-full flex-col bg-slate-950 text-slate-100">
              <header class="kb-model__header flex flex-wrap items-end justify-between gap-4 border-b border-slate-700 px-5 py-4">
                <div>
                  <p class="kb-model__path text-xs uppercase tracking-[0.3em] text-sky-300">${escapedPath}</p>
                  <h1 class="mt-2 text-2xl font-semibold tracking-tight text-slate-100">${escapedTitle}</h1>
                </div>
                <div class="kb-model__meta flex flex-wrap items-center gap-3 text-sm text-slate-300">
                  <span class="rounded-full border border-slate-700 bg-slate-900 px-3 py-1">${escapeHtml(extension.toUpperCase())} • ${formatBytes(stats?.size || 0)}</span>
                  ${stats?.lastModified ? `<span class="rounded-full border border-slate-700 bg-slate-900 px-3 py-1">Updated ${formatDate(stats.lastModified)}</span>` : ''}
                  <a class="kb-model__download rounded-full bg-sky-500 px-4 py-2 font-semibold text-white transition hover:bg-sky-600" href="${modelUrl}" target="_blank" rel="noopener">Open original</a>
                </div>
              </header>
              <section class="kb-model__viewer min-h-0 flex-1">
                <div class="kb-3d-viewer relative h-full w-full overflow-hidden bg-slate-900" data-kb-3d-viewer data-model-url="${modelUrl}" data-model-format="${escapeHtml(extension)}">
                  <div class="absolute inset-0 flex items-center justify-center text-sm text-slate-300" data-kb-3d-status>Loading 3D preview…</div>
                  <div class="absolute right-3 top-3 z-10 flex gap-2" data-kb-3d-controls>
                    <button type="button" class="rounded-full border border-slate-300 bg-white/90 px-3 py-1 text-xs font-medium text-slate-700" data-kb-3d-reset>Reset</button>
                    <button type="button" class="rounded-full border border-slate-300 bg-white/90 px-3 py-1 text-xs font-medium text-slate-700" data-kb-3d-wireframe>Wireframe</button>
                  </div>
                </div>
              </section>
            </div>
          `;

          return context.composeContentResponse(
            context.requestPath,
            displayName,
            html,
            `${displayName} 3D preview`,
            {
              isThreeDModel: true,
              modelFormat: extension,
              modelUrl
            }
          );
        },
        renderDirectoryItem({ entry, friendlyHref }) {
          if (!MODEL_EXTENSIONS.has(entry.extension.toLowerCase())) {
            return null;
          }

          return {
            href: friendlyHref,
            targetBlank: true,
            meta: `3D • ${entry.extension.toUpperCase().replace('.', '')}`,
            section: 'models',
            sectionTitle: options.sectionTitle || '3D Models'
          };
        }
      }
    ]
  };
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[exponent]}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

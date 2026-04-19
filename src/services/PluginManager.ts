import path from 'path';
import { ContentItem, RenderedContent } from '../core/models';
import {
  ContentRendererPlugin,
  KnowledgeBasePlugin,
  PluginClientAssets,
  PluginDirectoryRenderInfo,
  PluginRenderContext
} from '../core/plugins';

export class PluginManager {
  private readonly plugins: KnowledgeBasePlugin[];
  private readonly renderers: ContentRendererPlugin[];

  constructor(plugins: KnowledgeBasePlugin[] = []) {
    this.plugins = plugins;
    this.renderers = this.collectRenderers(plugins);
  }

  getPlugins(): KnowledgeBasePlugin[] {
    return [...this.plugins];
  }

  getClientAssets(): PluginClientAssets {
    const css = new Set<string>();
    const js = new Set<string>();

    for (const plugin of this.plugins) {
      for (const file of plugin.clientAssets?.css || []) {
        css.add(file);
      }
      for (const file of plugin.clientAssets?.js || []) {
        js.add(file);
      }
    }

    return {
      css: [...css],
      js: [...js]
    };
  }

  async renderByFileType(requestPath: string, contextFactory: (renderer: ContentRendererPlugin) => PluginRenderContext): Promise<RenderedContent | null> {
    const renderer = this.findRenderer(requestPath);
    if (!renderer) {
      return null;
    }

    return renderer.render(contextFactory(renderer));
  }

  resolveDirectoryItem(entry: ContentItem, defaultHref: string, friendlyHref: string): PluginDirectoryRenderInfo | null {
    const renderer = this.findRenderer(entry.path);
    if (!renderer?.renderDirectoryItem) {
      return null;
    }

    return renderer.renderDirectoryItem({
      entry,
      defaultHref,
      friendlyHref
    });
  }

  private findRenderer(requestPath: string): ContentRendererPlugin | null {
    const extension = path.extname(requestPath).toLowerCase();
    for (const renderer of this.renderers) {
      if (renderer.matches && renderer.matches(requestPath, extension)) {
        return renderer;
      }

      if (extension && (renderer.extensions || []).some(item => item.toLowerCase() === extension)) {
        return renderer;
      }
    }

    return null;
  }

  private collectRenderers(plugins: KnowledgeBasePlugin[]): ContentRendererPlugin[] {
    const result: ContentRendererPlugin[] = [];
    for (const plugin of plugins) {
      for (const renderer of plugin.contentRenderers || []) {
        result.push(renderer);
      }
    }
    return result;
  }
}

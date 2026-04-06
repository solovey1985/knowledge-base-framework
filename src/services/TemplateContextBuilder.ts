import path from 'path';
import { KnowledgeBaseOptions } from '../core/interfaces';
import { RenderedContent, NavigationItem } from '../core/models';
import { TemplateRenderContext } from './TemplateRenderer';

export class TemplateContextBuilder {
  constructor(private options: KnowledgeBaseOptions, private assetsBaseOverride?: string) {}

  build(content: RenderedContent): TemplateRenderContext {
    const baseUrl = this.normalizeBaseUrl(this.options.baseUrl);
    const navigation = this.mapNavigationItems(content.navigation || []);
    const breadcrumbs = (content.breadcrumbs || []).map(crumb => ({
      title: crumb.title,
      path: crumb.path,
      href: this.composeHref(crumb.path, true)
    }));

    return {
      site: {
        title: this.options.title,
        description: this.options.description,
        baseUrl
      },
      page: {
        title: content.title || this.options.title,
        description: content.description || this.options.description,
        metadata: content.metadata || {}
      },
      content,
      navigation,
      breadcrumbs,
      assets: this.getAssetContext(baseUrl),
      search: {
        enabled: this.options.search?.enabled !== false,
        indexFileName: this.options.search?.indexFileName || 'search-index.json'
      }
    };
  }

  private mapNavigationItems(items: NavigationItem[]): NavigationItem[] {
    if (!items || items.length === 0) {
      return [];
    }

    return items.map(item => {
      const isDirectory = item.children && item.children.length > 0;
      return {
        ...item,
        href: this.composeHref(item.path, isDirectory),
        children: this.mapNavigationItems(item.children || [])
      };
    });
  }

  private composeHref(itemPath: string, isDirectory: boolean): string {
    const normalized = this.normalizeSlashes(itemPath);
    const suffix = isDirectory ? normalized : this.replaceMarkdownExtension(normalized);
    const href = this.joinWithBase(this.options.baseUrl, suffix);
    return isDirectory ? this.ensureTrailingSlash(href) : href;
  }

  private getAssetContext(baseUrl: string): { base: string; css: string[]; js: string[] } {
    const assetBase = this.assetsBaseOverride
      || (this.options.templates?.assetsBasePath
        ? this.normalizePublicPath(this.options.templates.assetsBasePath)
        : this.joinWithBase(baseUrl || '/', 'assets'));

    const css: string[] = [
      `${assetBase}/kb-app.css`,
      ...(this.options.customCssFiles || [])
        .map(file => this.normalizePublicPath(file))
        .filter(Boolean)
    ];

    const js: string[] = [
      `${assetBase}/kb-app.js`,
      ...(this.options.customJsFiles || [])
        .map(file => this.normalizePublicPath(file))
        .filter(Boolean)
    ];

    return {
      base: assetBase,
      css,
      js
    };
  }

  private normalizePublicPath(value: string): string {
    if (!value) return '';
    if (this.isHttpUrl(value)) {
      return value;
    }
    return this.joinWithBase(this.options.baseUrl, value);
  }

  private normalizeBaseUrl(value?: string): string {
    if (!value || value === '/') {
      return '';
    }
    let normalized = value.trim();
    if (!this.isHttpUrl(normalized) && !normalized.startsWith('/')) {
      normalized = `/${normalized}`;
    }
    normalized = this.normalizeSlashes(normalized);
    return this.removeTrailingSlash(normalized);
  }

  private joinWithBase(base?: string, suffix?: string): string {
    const normalizedBase = this.normalizeBaseUrl(base);
    const trimmedSuffix = suffix ? this.trimLeadingSlashes(this.normalizeSlashes(suffix)) : '';

    if (this.isHttpUrl(normalizedBase)) {
      const trimmedBase = this.removeTrailingSlash(normalizedBase);
      return trimmedSuffix ? `${trimmedBase}/${trimmedSuffix}` : trimmedBase;
    }

    const parts = [normalizedBase, trimmedSuffix].filter(Boolean);
    if (parts.length === 0) {
      return '/';
    }

    const combined = parts.join('/');
    const normalized = this.collapseSlashes(combined);
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }

  private ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
  }

  private normalizeSlashes(input: string): string {
    return input.split('\\').join('/');
  }

  private trimLeadingSlashes(value: string): string {
    let result = value;
    while (result.startsWith('/')) {
      result = result.substring(1);
    }
    return result;
  }

  private removeTrailingSlash(value: string): string {
    return value.endsWith('/') ? value.slice(0, -1) : value;
  }

  private replaceMarkdownExtension(value: string): string {
    return value.endsWith('.md') ? `${value.slice(0, -3)}.html` : value;
  }

  private isHttpUrl(value: string): boolean {
    if (!value) {
      return false;
    }
    const lower = value.toLowerCase();
    return lower.startsWith('http://') || lower.startsWith('https://');
  }

  private collapseSlashes(value: string): string {
    return value.replace(/\/+/g, '/');
  }
}

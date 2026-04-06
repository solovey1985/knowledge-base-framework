import * as fs from 'fs/promises';
import * as path from 'path';
import Handlebars, { HelperOptions } from 'handlebars';

export interface TemplateRendererOptions {
  templatesDir?: string;
  layout?: string;
  partialsDir?: string;
}

export interface TemplateRenderContext {
  site: Record<string, unknown>;
  page: Record<string, unknown>;
  content: Record<string, unknown>;
  navigation: unknown;
  breadcrumbs: unknown;
  assets: Record<string, unknown>;
  search?: Record<string, unknown>;
}

const DEFAULT_LAYOUT = 'layout.hbs';

export class TemplateRenderer {
  private readonly baseDir: string;
  private readonly layoutName: string;
  private readonly partialsDir: string;
  private layoutCache?: Handlebars.TemplateDelegate;
  private partialsLoaded = false;

  constructor(options: TemplateRendererOptions = {}) {
    this.baseDir = options.templatesDir || path.resolve(__dirname, '../../templates/default');
    this.layoutName = options.layout || DEFAULT_LAYOUT;
    this.partialsDir = options.partialsDir || path.join(this.baseDir, 'partials');
    this.registerBuiltInHelpers();
  }

  async render(context: TemplateRenderContext): Promise<string> {
    const template = await this.getLayout();
    return template(context);
  }

  private async getLayout(): Promise<Handlebars.TemplateDelegate> {
    if (this.layoutCache) {
      return this.layoutCache;
    }

    await this.ensurePartialsLoaded();

    const layoutPath = path.join(this.baseDir, this.layoutName);
    const layoutSource = await fs.readFile(layoutPath, 'utf-8');
    this.layoutCache = Handlebars.compile(layoutSource);
    return this.layoutCache;
  }

  private async ensurePartialsLoaded(): Promise<void> {
    if (this.partialsLoaded) {
      return;
    }

    try {
      const entries = await fs.readdir(this.partialsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith('.hbs')) continue;

        const partialPath = path.join(this.partialsDir, entry.name);
        const contents = await fs.readFile(partialPath, 'utf-8');
        const partialName = entry.name.replace(/\.hbs$/, '');
        Handlebars.registerPartial(partialName, contents);
      }
    } catch (error) {
      // When consumers override templates, they might not provide partials.
    }

    this.partialsLoaded = true;
  }

  private registerBuiltInHelpers(): void {
    Handlebars.registerHelper('eq', function (this: unknown, a: unknown, b: unknown, options: HelperOptions) {
      return a === b ? options.fn(this) : options.inverse(this);
    });

    Handlebars.registerHelper('not', (value: unknown) => !value);
  }
}

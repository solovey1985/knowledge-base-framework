import path from 'path';
import type { KnowledgeBasePlugin, PluginPageContext } from '../../core/plugins';
import type { FileService } from '../../services/FileService';
import { frontMatterTags, splitFrontMatter } from '../../core/frontMatter';
import { slugifyHeading } from '../../services/MarkdownRenderer';

export interface NotesOptions {
  /** Resolve [[Note]], [[Note|label]] and [[Note#heading]] links. Default: true. */
  wikiLinks?: boolean;
  /** Append the list of notes that link to the current one. Default: true. */
  backlinks?: boolean;
  /** Show front matter tags on a note and render *.tags.md documents as a tag index. Default: true. */
  tags?: boolean;
  /** Heading of the backlinks section. Default: "Linked from". */
  backlinksTitle?: string;
  /**
   * Upper bound, in seconds, for reusing the link index on a server. Default: 30.
   * File changes reported by the content watcher refresh it at once; static builds index once.
   */
  refreshSeconds?: number;
}

export const TAGS_SUFFIX = '.tags.md';

interface Note {
  path: string;
  title: string;
  tags: string[];
  /** Raw link targets as written; resolved once every note is known. */
  wiki: string[];
  /** Markdown links to other .md files, already content-relative. */
  links: string[];
}

interface NoteIndex {
  notes: Map<string, Note>;
  byPath: Map<string, string>;
  byName: Map<string, string[]>;
  byTitle: Map<string, string[]>;
  backlinks: Map<string, string[]>;
  tags: Map<string, string[]>;
  tagsPage?: string;
}

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const unescapeHtml = (value: string): string => value
  .replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
const key = (value: string): string => value.trim().toLowerCase();
const stripExtension = (value: string): string => value.replace(/\.md$/i, '');
const tagAnchor = (tag: string): string => `tag-${key(tag).replace(/\s+/g, '-')}`;
const WIKI_LINK = /\[\[([^[\]|#\n]+)(?:#([^[\]|\n]+))?(?:\|([^[\]\n]+))?\]\]/g;

/** Wiki links, backlinks and tags over the Markdown notes of a knowledge base. */
export function notesPlugin(options: NotesOptions = {}): KnowledgeBasePlugin {
  const allowed = ['wikiLinks', 'backlinks', 'tags', 'backlinksTitle', 'refreshSeconds'];
  const unknown = Object.keys(options || {}).find(name => !allowed.includes(name));
  if (unknown) throw new Error(`notes: unknown option "${unknown}".`);
  const refreshSeconds = options.refreshSeconds ?? 30;
  if (typeof refreshSeconds !== 'number' || !Number.isFinite(refreshSeconds) || refreshSeconds < 0) {
    throw new Error('notes: refreshSeconds must be a non-negative number.');
  }
  const wikiLinks = options.wikiLinks !== false;
  const backlinks = options.backlinks !== false;
  const tags = options.tags !== false;
  const backlinksTitle = options.backlinksTitle || 'Linked from';

  let cached: { index: Promise<NoteIndex>; expires: number } | undefined;
  const getIndex = (fileService: FileService, isStaticSite: boolean): Promise<NoteIndex> => {
    const now = Date.now();
    if (!cached || cached.expires <= now) {
      const index = buildIndex(fileService);
      const entry = { index, expires: isStaticSite ? Number.POSITIVE_INFINITY : now + refreshSeconds * 1000 };
      cached = entry;
      index.catch(() => { if (cached === entry) cached = undefined; });
    }
    return cached.index;
  };

  const plugin: KnowledgeBasePlugin = {
    id: 'notes',

    onContentChange() {
      cached = undefined;
    },

    async transformPage(page, context) {
      const index = await getIndex(context.fileService, context.isStaticSite);
      let html = page.htmlContent;
      if (wikiLinks) html = resolveWikiLinks(html, index, context);
      if (tags) html += renderTags(frontMatterTags(context.frontMatter), index, context);
      if (backlinks) html += renderBacklinks(context.requestPath, index, context, backlinksTitle);
      return html === page.htmlContent ? undefined : { ...page, htmlContent: html };
    }
  };

  if (wikiLinks) {
    plugin.markdownExtensions = [{
      extensions: [{
        name: 'kbWikiLink',
        level: 'inline',
        start: (source: string) => source.indexOf('[['),
        tokenizer(source: string) {
          const match = new RegExp('^' + WIKI_LINK.source).exec(source);
          return match ? { type: 'kbWikiLink', raw: match[0], target: match[1].trim(), anchor: (match[2] || '').trim(), label: (match[3] || '').trim() } : undefined;
        },
        // Rendering is synchronous and cannot know the other notes; transformPage adds the address.
        renderer(token) {
          const { target, anchor, label } = token as unknown as { target: string; anchor: string; label: string };
          return `<a class="kb-wikilink" data-wikilink="${escapeHtml(target)}" data-anchor="${escapeHtml(anchor)}">${escapeHtml(label || target)}</a>`;
        }
      }]
    }];
  }

  if (tags) {
    plugin.contentRenderers = [{
      id: 'notes-tag-index',
      matches: requestPath => requestPath.endsWith(TAGS_SUFFIX),
      async render(context) {
        const { data, body } = splitFrontMatter(await context.readFile(context.requestPath));
        const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'Tags';
        const introduction = await context.renderMarkdown(body, context.requestPath);
        const index = await getIndex(context.fileService, false);
        const sections = [...index.tags.keys()].sort((a, b) => a.localeCompare(b)).map(tag => {
          const notes = index.tags.get(tag)!.map(notePath => index.notes.get(notePath)!)
            .sort((a, b) => a.title.localeCompare(b.title));
          return `<h2 id="${escapeHtml(tagAnchor(tag))}">#${escapeHtml(tag)} <small>${notes.length}</small></h2><ul>${notes.map(note =>
            `<li><a href="${escapeHtml(context.buildFriendlyUrl(note.path, 'markdown'))}">${escapeHtml(note.title)}</a></li>`).join('')}</ul>`;
        });
        const html = `<h1>${escapeHtml(title)}</h1>${introduction.html}<div class="kb-tag-index">${sections.join('') || '<p>No tagged notes yet.</p>'}</div>`;
        return context.composeContentResponse(context.requestPath, title, html, `${title}: notes by tag`);
      },
      renderDirectoryItem({ friendlyHref }) {
        return { href: friendlyHref, meta: 'Tags' };
      }
    }];
  }

  return plugin;
}

async function buildIndex(fileService: FileService): Promise<NoteIndex> {
  const index: NoteIndex = {
    notes: new Map(), byPath: new Map(), byName: new Map(), byTitle: new Map(), backlinks: new Map(), tags: new Map()
  };
  const add = (map: Map<string, string[]>, name: string, value: string) => {
    const list = map.get(name);
    if (list) { if (!list.includes(value)) list.push(value); } else map.set(name, [value]);
  };

  const scan = async (directory: string): Promise<void> => {
    for (const entry of await fileService.getDirectoryListing(directory)) {
      const entryPath = entry.path.split('\\').join('/');
      if (entry.isDirectory) {
        await scan(entry.path);
      } else if (entry.extension === '.md') {
        if (entryPath.endsWith(TAGS_SUFFIX)) {
          if (!index.tagsPage || entryPath < index.tagsPage) index.tagsPage = entryPath;
          continue;
        }
        const { data, body } = splitFrontMatter(await fileService.readFile(entry.path));
        // Links inside code are examples, not references.
        const prose = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
        const directoryName = path.posix.dirname(entryPath);
        const links: string[] = [];
        for (const match of prose.matchAll(/\]\(([^)\s#?]+\.md)(?:[#?][^)\s]*)?\)/gi)) {
          if (/^[a-z][a-z0-9+.-]*:/i.test(match[1])) continue;
          let target = match[1];
          try { target = decodeURIComponent(target); } catch { /* keep as written */ }
          links.push(target.startsWith('/') ? target.replace(/^\/+/, '') : path.posix.normalize(path.posix.join(directoryName, target)));
        }
        index.notes.set(entryPath, {
          path: entryPath,
          title: (typeof data.title === 'string' && data.title.trim()) || prose.match(/^#\s+(.+)$/m)?.[1]?.trim()
            || stripExtension(path.posix.basename(entryPath)),
          tags: frontMatterTags(data),
          wiki: [...prose.matchAll(WIKI_LINK)].map(match => match[1].trim()),
          links
        });
      }
    }
  };
  await scan('');

  for (const note of index.notes.values()) {
    index.byPath.set(key(note.path), note.path);
    index.byPath.set(key(stripExtension(note.path)), note.path);
    add(index.byName, key(stripExtension(path.posix.basename(note.path))), note.path);
    add(index.byTitle, key(note.title), note.path);
    for (const tag of note.tags) add(index.tags, tag, note.path);
  }
  for (const note of index.notes.values()) {
    const targets = new Set<string>(note.links.filter(link => index.notes.has(link)));
    for (const raw of note.wiki) {
      const target = resolveTarget(raw, note.path, index);
      if (target) targets.add(target);
    }
    targets.delete(note.path);
    for (const target of targets) add(index.backlinks, target, note.path);
  }
  return index;
}

/** A path wins over a file name, a file name over a title; the nearest note wins a tie. */
function resolveTarget(raw: string, fromPath: string, index: NoteIndex): string | undefined {
  const target = raw.trim().split('\\').join('/');
  const fromDirectory = path.posix.dirname(fromPath);
  const relative = key(path.posix.normalize(path.posix.join(fromDirectory, target)));
  const direct = index.byPath.get(relative) || index.byPath.get(key(target.replace(/^\/+/, '')));
  if (direct) return direct;
  let list = target.includes('/') ? undefined : index.byName.get(key(stripExtension(target)));
  if (!list || list.length === 0) list = index.byTitle.get(key(target));
  if (!list || list.length === 0) return undefined;
  const distance = (candidate: string) => {
    const a = fromDirectory === '.' ? [] : fromDirectory.split('/');
    const b = path.posix.dirname(candidate) === '.' ? [] : path.posix.dirname(candidate).split('/');
    let common = 0;
    while (common < a.length && common < b.length && a[common] === b[common]) common++;
    return a.length + b.length - 2 * common;
  };
  return [...list].sort((a, b) => distance(a) - distance(b) || a.length - b.length || (a < b ? -1 : 1))[0];
}

function resolveWikiLinks(html: string, index: NoteIndex, context: PluginPageContext): string {
  return html.replace(/<a class="kb-wikilink" data-wikilink="([^"]*)" data-anchor="([^"]*)">([\s\S]*?)<\/a>/g,
    (_all, rawTarget: string, rawAnchor: string, label: string) => {
      const target = resolveTarget(unescapeHtml(rawTarget), context.requestPath, index);
      if (!target) {
        return `<span class="kb-wikilink kb-wikilink--missing" title="No note found for this link">${label}</span>`;
      }
      const anchor = unescapeHtml(rawAnchor);
      const slug = slugifyHeading(anchor);
      const href = context.buildDocumentUrl(target) + (slug ? `#${slug}` : '');
      return `<a class="kb-wikilink kb-markdown-link" href="${escapeHtml(href)}">${label}</a>`;
    });
}

function renderTags(tags: string[], index: NoteIndex, context: PluginPageContext): string {
  if (tags.length === 0) return '';
  const base = index.tagsPage ? context.buildDocumentUrl(index.tagsPage) : undefined;
  const chips = tags.map(tag => base
    ? `<a class="kb-tag" href="${escapeHtml(`${base}#${tagAnchor(tag)}`)}">#${escapeHtml(tag)}</a>`
    : `<span class="kb-tag">#${escapeHtml(tag)}</span>`);
  return `<p class="kb-tags">${chips.join(' ')}</p>`;
}

function renderBacklinks(requestPath: string, index: NoteIndex, context: PluginPageContext, title: string): string {
  const sources = (index.backlinks.get(requestPath) || []).map(source => index.notes.get(source)!)
    .sort((a, b) => a.title.localeCompare(b.title));
  if (sources.length === 0) return '';
  return `<section class="kb-backlinks"><h2>${escapeHtml(title)}</h2><ul>${sources.map(note =>
    `<li><a href="${escapeHtml(context.buildDocumentUrl(note.path))}">${escapeHtml(note.title)}</a></li>`).join('')}</ul></section>`;
}

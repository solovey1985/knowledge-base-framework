import path from 'path';
import { KnowledgeBasePlugin, PluginRenderContext } from '../core/plugins';

interface TechMemoryFrontMatter {
  title?: string;
  techMemory?: {
    persistProgress?: boolean;
    defaultReveal?: 'term' | 'summary' | 'details';
    showHierarchy?: boolean;
    showRelated?: boolean;
    enableRecallMode?: boolean;
    sectionTitle?: string;
  };
}

interface TechMemoryRelation {
  label: string;
  targetId?: string;
}

interface TechMemoryPayload {
  id: string;
  kind: 'concept';
  term: string;
  aliases: string[];
  summaryHtml: string;
  detailsHtml: string;
  exampleHtml: string;
  mnemonicHtml: string;
  recallHtml: string[];
  parents: TechMemoryRelation[];
  children: TechMemoryRelation[];
  related: TechMemoryRelation[];
}

interface ParsedConceptBlock {
  id: string;
  term: string;
  aliases: string[];
  parents: string[];
  children: string[];
  related: string[];
  summary: string;
  details: string;
  exampleLanguage: string;
  example: string;
  mnemonic: string;
  recall: string[];
}

export interface TechMemoryPluginOptions {
  sectionTitle?: string;
}

export function techMemoryPlugin(options: TechMemoryPluginOptions = {}): KnowledgeBasePlugin {
  return {
    id: 'tech-memory',
    contentRenderers: [
      {
        id: 'tech-memory-renderer',
        matches: requestPath => requestPath.toLowerCase().endsWith('.concept.md'),
        async render(context) {
          const raw = await context.readFile(context.requestPath);
          const parsed = await transformTechMemoryDocument(raw, context);
          if (parsed.items.length === 0) {
            return null;
          }

          const rendered = await context.renderMarkdown(parsed.markdown, context.requestPath);
          const title = parsed.frontMatter.title || extractMarkdownTitle(parsed.body) || path.basename(context.requestPath, '.md');
          const settings = {
            persistProgress: true,
            defaultReveal: 'term',
            showHierarchy: true,
            showRelated: true,
            enableRecallMode: true,
            ...(parsed.frontMatter.techMemory || {})
          };

          return context.composeContentResponse(
            context.requestPath,
            title,
            rendered.html,
            `${title} technical memory map`,
            {
              isTechMemory: true,
              techMemoryItemCount: parsed.items.length,
              techMemorySettings: settings
            }
          );
        },
        renderDirectoryItem({ entry, friendlyHref }) {
          if (!entry.path.toLowerCase().endsWith('.concept.md')) {
            return null;
          }

          return {
            href: friendlyHref,
            meta: 'Memory • Concepts',
            section: 'technical-memory',
            sectionTitle: options.sectionTitle || 'Technical Memory'
          };
        }
      }
    ]
  };
}

async function transformTechMemoryDocument(raw: string, context: PluginRenderContext): Promise<{
  frontMatter: TechMemoryFrontMatter;
  body: string;
  markdown: string;
  items: TechMemoryPayload[];
}> {
  const { frontMatter, body } = extractFrontMatter(raw);
  const blocks = await parseConceptBlocks(body, context);
  const items = resolveRelations(blocks);

  let blockIndex = 0;
  const transformedParts: string[] = [];
  const blockRegex = /```concept-card\r?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = blockRegex.exec(body)) !== null) {
    transformedParts.push(body.slice(lastIndex, match.index));
    transformedParts.push(buildTechMemoryPlaceholder(items[blockIndex]));
    blockIndex += 1;
    lastIndex = match.index + match[0].length;
  }

  transformedParts.push(body.slice(lastIndex));

  const progressShell = items.length > 0
    ? '\n<div class="kb-tech-memory-shell space-y-8" data-kb-tech-memory-page>\n<div class="kb-tech-memory-progress rounded-3xl border border-slate-200 bg-gradient-to-br from-sky-50 to-indigo-50 p-5 shadow-lg shadow-slate-200/50" data-kb-tech-memory-progress></div>\n</div>\n'
    : '';

  return {
    frontMatter,
    body,
    markdown: items.length > 0 ? `${progressShell}${transformedParts.join('')}` : transformedParts.join(''),
    items
  };
}

async function parseConceptBlocks(body: string, context: PluginRenderContext): Promise<ParsedConceptBlock[]> {
  const blocks: ParsedConceptBlock[] = [];
  const blockRegex = /```concept-card\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null = null;

  while ((match = blockRegex.exec(body)) !== null) {
    const sections = parseSectionMap((match[1] || '').trim());
    const term = getSectionText(sections.term);
    if (!term) {
      continue;
    }

    const id = normalizeConceptId(getSectionText(sections.id) || term);
    blocks.push({
      id,
      term,
      aliases: getSectionList(sections.aliases),
      parents: getSectionList(sections.parents),
      children: getSectionList(sections.children),
      related: getSectionList(sections.related),
      summary: getSectionText(sections.summary),
      details: getSectionText(sections.details),
      exampleLanguage: getSectionText(sections.examplelanguage),
      example: getSectionText(sections.example),
      mnemonic: getSectionText(sections.mnemonic),
      recall: getSectionList(sections.recall)
    });
  }

  return blocks;
}

function resolveRelations(blocks: ParsedConceptBlock[]): TechMemoryPayload[] {
  const index = new Map<string, string>();

  for (const block of blocks) {
    index.set(normalizeConceptId(block.id), block.id);
    index.set(normalizeConceptId(block.term), block.id);
    for (const alias of block.aliases) {
      index.set(normalizeConceptId(alias), block.id);
    }
  }

  return blocks.map(block => ({
    id: block.id,
    kind: 'concept',
    term: block.term,
    aliases: block.aliases,
    summaryHtml: block.summary ? inlineMarkdownToHtml(block.summary) : '',
    detailsHtml: block.details ? inlineMarkdownToHtml(block.details) : '',
    exampleHtml: block.example ? formatExampleHtml(block.example, block.exampleLanguage) : '',
    mnemonicHtml: block.mnemonic ? inlineMarkdownToHtml(block.mnemonic) : '',
    recallHtml: block.recall.map(item => inlineMarkdownToHtml(item)),
    parents: resolveRelationList(block.parents, index),
    children: resolveRelationList(block.children, index),
    related: resolveRelationList(block.related, index)
  }));
}

function resolveRelationList(values: string[], index: Map<string, string>): TechMemoryRelation[] {
  return values.map(value => {
    const normalized = normalizeConceptId(value);
    return {
      label: value,
      targetId: index.get(normalized)
    };
  });
}

function buildTechMemoryPlaceholder(payload: TechMemoryPayload): string {
  const escapedJson = escapeJsonForScript(JSON.stringify(payload));
  return `\n<div class="kb-tech-memory-slot" data-kb-tech-memory-id="${payload.id}"></div>\n<script type="application/json" data-kb-tech-memory-payload="${payload.id}">${escapedJson}</script>\n`;
}

function extractFrontMatter(raw: string): { frontMatter: TechMemoryFrontMatter; body: string } {
  if (!raw.startsWith('---')) {
    return { frontMatter: {}, body: raw };
  }

  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) {
    return { frontMatter: {}, body: raw };
  }

  return {
    frontMatter: parseSimpleFrontMatter(match[1]),
    body: raw.slice(match[0].length)
  };
}

function parseSimpleFrontMatter(value: string): TechMemoryFrontMatter {
  const result: TechMemoryFrontMatter = {};
  let section = '';

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ');
    const sectionMatch = /^([a-zA-Z][\w-]*):\s*$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].toLowerCase();
      if (section === 'techmemory') {
        result.techMemory = result.techMemory || {};
      }
      continue;
    }

    const keyValueMatch = /^([a-zA-Z][\w-]*):\s*(.+)$/.exec(line.trim());
    if (keyValueMatch && !section) {
      if (keyValueMatch[1].toLowerCase() === 'title') {
        result.title = unquote(keyValueMatch[2]);
      }
      continue;
    }

    const nestedMatch = /^\s{2}([a-zA-Z][\w-]*):\s*(.+)$/.exec(line);
    if (nestedMatch && section === 'techmemory') {
      const key = nestedMatch[1] as keyof NonNullable<TechMemoryFrontMatter['techMemory']>;
      result.techMemory = result.techMemory || {};
      result.techMemory[key] = parseScalar(nestedMatch[2]) as never;
    }
  }

  return result;
}

function parseSectionMap(content: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  let currentKey = '';

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ');
    const keyMatch = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(line);
    if (keyMatch) {
      currentKey = keyMatch[1].toLowerCase();
      result[currentKey] = [];
      if (keyMatch[2]) {
        result[currentKey].push(keyMatch[2]);
      }
      continue;
    }

    if (!currentKey) {
      continue;
    }

    result[currentKey].push(line);
  }

  return result;
}

function getSectionText(lines: string[] | undefined): string {
  return (lines || []).join('\n').trim();
}

function getSectionList(lines: string[] | undefined): string[] {
  const values: string[] = [];
  let current = '';

  for (const rawLine of lines || []) {
    const line = rawLine.trimEnd();
    const itemMatch = /^-\s+(.*)$/.exec(line.trim());
    if (itemMatch) {
      if (current) {
        values.push(current.trim());
      }
      current = itemMatch[1];
      continue;
    }

    if (!line.trim()) {
      if (current) {
        current += '\n';
      }
      continue;
    }

    if (!current) {
      current = line.trim();
      continue;
    }

    current += `\n${line.trim()}`;
  }

  if (current) {
    values.push(current.trim());
  }

  return values;
}

function normalizeConceptId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function extractMarkdownTitle(markdown: string): string | null {
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      return trimmed.slice(2).trim();
    }
  }

  return null;
}

function parseScalar(value: string): string | boolean {
  const normalized = unquote(value).trim();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return normalized;
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

function escapeJsonForScript(value: string): string {
  return value.replace(/<\//g, '<\\/');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function inlineMarkdownToHtml(value: string): string {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, '<code class="rounded bg-slate-200 px-1.5 py-0.5 text-xs">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return html.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>');
}

function formatExampleHtml(value: string, language: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const lines = trimmed.split(/\r?\n/);
  const normalizedLanguage = (language || '').trim().toLowerCase();
  const looksLikeCode = Boolean(normalizedLanguage) || lines.length > 1 || /[;{}=>]/.test(trimmed);
  if (looksLikeCode) {
    const className = normalizedLanguage ? ` class="language-${escapeHtml(normalizedLanguage)}"` : '';
    return `<pre class="max-w-full overflow-x-auto rounded-2xl bg-slate-950 p-4 text-sm text-slate-100"><code${className}>${escapeHtml(trimmed)}</code></pre>`;
  }

  return `<p>${inlineMarkdownToHtml(trimmed)}</p>`;
}

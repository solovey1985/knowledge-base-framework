import { parseDocument } from 'yaml';

export interface FrontMatterResult {
  /** Parsed YAML mapping; empty when the document has no front matter. */
  data: Record<string, unknown>;
  /** The document without its front matter block. */
  body: string;
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const MAX_FRONT_MATTER_LENGTH = 32768;

/**
 * Splits a leading YAML block from Markdown. A block that is not a YAML mapping is
 * left in the body: a document may legitimately start with a horizontal rule.
 * YAML is data only: aliases are not expanded and no custom tags are resolved.
 */
export function splitFrontMatter(source: string): FrontMatterResult {
  // A byte order mark may precede the block in files saved by some editors.
  source = (source || '').charCodeAt(0) === 0xFEFF ? source.slice(1) : source || '';
  const match = FRONT_MATTER.exec(source);
  if (!match || match[1].length > MAX_FRONT_MATTER_LENGTH) {
    return { data: {}, body: source };
  }
  try {
    const document = parseDocument(match[1], { prettyErrors: false });
    if (document.errors.length) {
      return { data: {}, body: source };
    }
    const value = document.toJS({ maxAliasCount: 0 });
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { data: {}, body: source };
    }
    return { data: value as Record<string, unknown>, body: source.slice(match[0].length) };
  } catch {
    return { data: {}, body: source };
  }
}

/** Tags as a clean list, whether authored as a YAML list or a comma-separated string. */
export function frontMatterTags(data: Record<string, unknown>): string[] {
  const raw = data.tags ?? data.tag;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return [...new Set(list.map(item => String(item).trim().replace(/^#/, '')).filter(Boolean))];
}

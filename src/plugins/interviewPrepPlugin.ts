import path from 'path';
import { KnowledgeBasePlugin, PluginRenderContext } from '../core/plugins';

type InterviewItemKind = 'question' | 'choice' | 'code';

interface InterviewFrontMatter {
  title?: string;
  interview?: {
    persistProgress?: boolean;
    shuffleChoices?: boolean;
    showScore?: boolean;
    allowRevealAll?: boolean;
    markCompleteOnCheck?: boolean;
  };
}

interface InterviewQuestionPayload {
  id: string;
  kind: 'question';
  promptHtml: string;
  answerHtml: string;
  hintsHtml: string[];
}

interface InterviewChoicePayload {
  id: string;
  kind: 'choice';
  promptHtml: string;
  optionsHtml: string[];
  correctIndex: number;
  explanationHtml: string;
}

interface InterviewCodeCheck {
  type: 'includes' | 'excludes' | 'equals';
  value: string;
}

interface InterviewCodePayload {
  id: string;
  kind: 'code';
  language: string;
  promptHtml: string;
  starterCode: string;
  solutionCode: string;
  checks: InterviewCodeCheck[];
}

type InterviewPayload = InterviewQuestionPayload | InterviewChoicePayload | InterviewCodePayload;

export interface InterviewPrepPluginOptions {
  sectionTitle?: string;
}

export function interviewPrepPlugin(options: InterviewPrepPluginOptions = {}): KnowledgeBasePlugin {
  return {
    id: 'interview-prep',
    contentRenderers: [
      {
        id: 'interview-prep-renderer',
        matches: requestPath => requestPath.toLowerCase().endsWith('.interview.md'),
        async render(context) {
          const raw = await context.readFile(context.requestPath);
          const parsed = await transformInterviewDocument(raw, context);
          if (parsed.items.length === 0) {
            return null;
          }

          const rendered = await context.renderMarkdown(parsed.markdown, context.requestPath);
          const title = parsed.frontMatter.title || extractMarkdownTitle(parsed.body) || path.basename(context.requestPath, '.md');

          return context.composeContentResponse(
            context.requestPath,
            title,
            rendered.html,
            `${title} interview prep`,
            {
              isInterviewPrep: true,
              interviewItemCount: parsed.items.length,
              interviewKinds: [...new Set(parsed.items.map(item => item.kind))],
              interviewSettings: parsed.frontMatter.interview || {}
            }
          );
        },
        renderDirectoryItem({ entry, friendlyHref }) {
          if (!entry.path.toLowerCase().endsWith('.interview.md')) {
            return null;
          }

          return {
            href: friendlyHref,
            meta: 'Interview • Markdown',
            section: 'interviews',
            sectionTitle: options.sectionTitle || 'Interview Prep'
          };
        }
      }
    ]
  };
}

async function transformInterviewDocument(raw: string, context: PluginRenderContext): Promise<{
  frontMatter: InterviewFrontMatter;
  body: string;
  markdown: string;
  items: InterviewPayload[];
}> {
  const { frontMatter, body } = extractFrontMatter(raw);
  const items: InterviewPayload[] = [];
  let itemIndex = 0;

  const transformedParts: string[] = [];
  const blockRegex = /```(interview-question|interview-choice|interview-code)\r?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = blockRegex.exec(body)) !== null) {
    transformedParts.push(body.slice(lastIndex, match.index));
    itemIndex += 1;

    const kind = normalizeKind(match[1]);
    const blockContent = (match[2] || '').trim();
    const itemId = `interview-item-${itemIndex}`;
    const payload = await parseInterviewBlock(kind, itemId, blockContent, context);
    items.push(payload);
    transformedParts.push(buildInterviewPlaceholder(payload));

    lastIndex = match.index + match[0].length;
  }

  transformedParts.push(body.slice(lastIndex));

  const progressShell = items.length > 0
    ? `\n<div class="kb-interview-shell space-y-8" data-kb-interview-page>\n<div class="kb-interview-progress rounded-3xl border border-slate-200 bg-gradient-to-br from-sky-50 to-indigo-50 p-5 shadow-lg shadow-slate-200/50" data-kb-interview-progress></div>\n</div>\n`
    : '';

  const markdown = items.length > 0
    ? `${progressShell}${transformedParts.join('')}`
    : transformedParts.join('');

  return {
    frontMatter,
    body,
    markdown,
    items
  };
}

async function parseInterviewBlock(kind: InterviewItemKind, itemId: string, blockContent: string, context: PluginRenderContext): Promise<InterviewPayload> {
  if (kind === 'code') {
    return parseCodeBlock(itemId, blockContent, context);
  }

  const { prompt, sections } = splitPromptAndSections(blockContent);
  const promptHtml = (await context.renderMarkdown(prompt, context.requestPath)).html;

  if (kind === 'question') {
    const answerHtml = (await context.renderMarkdown(getSectionText(sections.answer), context.requestPath)).html;
    const hints = getSectionList(sections.hints).slice(0, 3);
    const hintsHtml = await Promise.all(hints.map(async hint => (await context.renderMarkdown(hint, context.requestPath)).html));

    return {
      id: itemId,
      kind: 'question',
      promptHtml,
      answerHtml,
      hintsHtml
    };
  }

  const options = getSectionList(sections.options).slice(0, 3);
  const optionsHtml = await Promise.all(options.map(async option => (await context.renderMarkdown(option, context.requestPath)).html));
  const explanationHtml = (await context.renderMarkdown(getSectionText(sections.explanation), context.requestPath)).html;
  const correctIndex = clampIndex(parseInt(getSectionText(sections.correct), 10), optionsHtml.length);

  return {
    id: itemId,
    kind: 'choice',
    promptHtml,
    optionsHtml,
    correctIndex,
    explanationHtml
  };
}

async function parseCodeBlock(itemId: string, blockContent: string, context: PluginRenderContext): Promise<InterviewCodePayload> {
  const sections = parseSectionMap(blockContent);
  const language = getSectionText(sections.language) || 'ts';
  const promptHtml = (await context.renderMarkdown(getSectionText(sections.prompt), context.requestPath)).html;
  const starterCode = trimTrailingNewlines(getSectionText(sections.starter));
  const solutionCode = trimTrailingNewlines(getSectionText(sections.solution));
  const checks = getSectionList(sections.checks)
    .map(parseCodeCheck)
    .filter((check): check is InterviewCodeCheck => Boolean(check));

  return {
    id: itemId,
    kind: 'code',
    language,
    promptHtml,
    starterCode,
    solutionCode,
    checks
  };
}

function buildInterviewPlaceholder(payload: InterviewPayload): string {
  const escapedJson = escapeJsonForScript(JSON.stringify(payload));
  return `\n<div class="kb-interview-slot" data-kb-interview-id="${payload.id}"></div>\n<script type="application/json" data-kb-interview-payload="${payload.id}">${escapedJson}</script>\n`;
}

function splitPromptAndSections(content: string): { prompt: string; sections: Record<string, string[]> } {
  const separator = /^---\s*$/m;
  const match = separator.exec(content);
  if (!match || match.index < 0) {
    return {
      prompt: content.trim(),
      sections: {}
    };
  }

  const prompt = content.slice(0, match.index).trim();
  const sectionContent = content.slice(match.index + match[0].length).trim();
  return {
    prompt,
    sections: parseSectionMap(sectionContent)
  };
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

function parseCodeCheck(value: string): InterviewCodeCheck | null {
  const match = /^(includes|excludes|equals):\s*(.+)$/i.exec(value.trim());
  if (!match) {
    return null;
  }

  return {
    type: match[1].toLowerCase() as InterviewCodeCheck['type'],
    value: match[2]
  };
}

function extractFrontMatter(raw: string): { frontMatter: InterviewFrontMatter; body: string } {
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

function parseSimpleFrontMatter(value: string): InterviewFrontMatter {
  const result: InterviewFrontMatter = {};
  let section = '';

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ');
    const sectionMatch = /^([a-zA-Z][\w-]*):\s*$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].toLowerCase();
      if (section === 'interview') {
        result.interview = result.interview || {};
      }
      continue;
    }

    const keyValueMatch = /^([a-zA-Z][\w-]*):\s*(.+)$/.exec(line.trim());
    if (keyValueMatch && !section) {
      const key = keyValueMatch[1].toLowerCase();
      if (key === 'title') {
        result.title = unquote(keyValueMatch[2]);
      }
      continue;
    }

    const nestedMatch = /^\s{2}([a-zA-Z][\w-]*):\s*(.+)$/.exec(line);
    if (nestedMatch && section === 'interview') {
      const key = nestedMatch[1] as keyof NonNullable<InterviewFrontMatter['interview']>;
      result.interview = result.interview || {};
      result.interview[key] = parseScalar(nestedMatch[2]) as never;
    }
  }

  return result;
}

function normalizeKind(value: string): InterviewItemKind {
  if (value === 'interview-code') {
    return 'code';
  }
  if (value === 'interview-choice') {
    return 'choice';
  }
  return 'question';
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

function trimTrailingNewlines(value: string): string {
  return value.replace(/[\r\n]+$/, '');
}

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, Math.max(length - 1, 0)));
}

function escapeJsonForScript(value: string): string {
  return value.replace(/<\//g, '<\\/');
}

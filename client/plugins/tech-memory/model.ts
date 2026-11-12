export interface TechMemoryRelation {
  label: string;
  targetId?: string;
}

export interface TechMemoryPayload {
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

export interface TechMemoryItemState {
  status?: 'new' | 'known' | 'review';
  sections?: Record<string, boolean>;
}

export interface TechMemoryPageState {
  pageId: string;
  recallMode?: boolean;
  items: Record<string, TechMemoryItemState>;
}

declare global {
  interface Window {
    hljs?: {
      highlightElement?: (element: Element) => void;
    };
  }
}

const STORAGE_PREFIX = 'kb.tech-memory.';
const HIGHLIGHT_CLASS = 'ring-2 ring-sky-300 ring-offset-4 ring-offset-slate-50';
const DEFAULT_OPEN_SECTIONS = ['summary'];

export function readPayloads(): TechMemoryPayload[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>('[data-kb-tech-memory-payload]'))
    .map(script => {
      try {
        return JSON.parse(script.textContent || '') as TechMemoryPayload;
      } catch (error) {
        console.warn('[kb] Failed to parse tech memory payload', error);
        return null;
      }
    })
    .filter((value): value is TechMemoryPayload => Boolean(value));
}

export function highlightCard(targetId: string): void {
  const card = document.getElementById(`concept-${targetId}`);
  if (!card) {
    return;
  }

  card.classList.add(...HIGHLIGHT_CLASS.split(' '));
  window.setTimeout(() => {
    card.classList.remove(...HIGHLIGHT_CLASS.split(' '));
  }, 1800);
}

export function loadState(): TechMemoryPageState {
  const storageKey = getStorageKey();
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return { pageId: storageKey, recallMode: false, items: {} };
    }

    const parsed = JSON.parse(raw) as TechMemoryPageState;
    return {
      pageId: parsed.pageId || storageKey,
      recallMode: parsed.recallMode || false,
      items: parsed.items || {}
    };
  } catch (error) {
    console.warn('[kb] Failed to restore tech memory state', error);
    return { pageId: storageKey, recallMode: false, items: {} };
  }
}

export function saveState(state: TechMemoryPageState): void {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(state));
  } catch (error) {
    console.warn('[kb] Failed to save tech memory state', error);
  }
}

export function getStorageKey(): string {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  return `${STORAGE_PREFIX}${pathname}`;
}

export function getDefaultSections(recallMode: boolean): Record<string, boolean> {
  if (recallMode) {
    return {};
  }

  return Object.fromEntries(DEFAULT_OPEN_SECTIONS.map(section => [section, true]));
}


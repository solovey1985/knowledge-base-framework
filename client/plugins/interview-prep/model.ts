export interface InterviewQuestionPayload {
  id: string;
  kind: 'question';
  promptHtml: string;
  answerHtml: string;
  hintsHtml: string[];
}

export interface InterviewChoicePayload {
  id: string;
  kind: 'choice';
  promptHtml: string;
  optionsHtml: string[];
  correctIndex: number;
  explanationHtml: string;
}

export interface InterviewCodeCheck {
  type: 'includes' | 'excludes' | 'equals';
  value: string;
}

export interface InterviewCodePayload {
  id: string;
  kind: 'code';
  language: string;
  promptHtml: string;
  starterCode: string;
  solutionCode: string;
  checks: InterviewCodeCheck[];
}

export type InterviewPayload = InterviewQuestionPayload | InterviewChoicePayload | InterviewCodePayload;

export interface InterviewItemState {
  revealed?: boolean;
  hintsUsed?: number;
  selectedOption?: number;
  checked?: boolean;
  correct?: boolean;
  codeDraft?: string;
  completed?: boolean;
  solutionRevealed?: boolean;
}

export interface InterviewPageState {
  pageId: string;
  items: Record<string, InterviewItemState>;
  startedAt?: string;
  completedAt?: string;
}

declare global {
  interface Window {
    hljs?: {
      highlightElement?: (element: Element) => void;
    };
  }
}

const STORAGE_PREFIX = 'kb.interview.';

export function readPayloads(): InterviewPayload[] {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('[data-kb-interview-payload]'));
  const payloads: InterviewPayload[] = [];

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.textContent || '') as InterviewPayload;
      payloads.push(parsed);
    } catch (error) {
      console.warn('[kb] Failed to parse interview payload', error);
    }
  }

  return payloads;
}

export function validateCodeDraft(draft: string, payload: InterviewCodePayload): boolean {
  const normalizedDraft = normalizeCode(draft);
  if (payload.checks.length === 0) {
    return normalizedDraft === normalizeCode(payload.solutionCode);
  }

  return payload.checks.every(check => {
    const normalizedValue = normalizeCode(check.value);
    if (check.type === 'includes') {
      return normalizedDraft.includes(normalizedValue);
    }
    if (check.type === 'excludes') {
      return !normalizedDraft.includes(normalizedValue);
    }
    return normalizedDraft === normalizedValue;
  });
}

export function normalizeCode(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function loadState(): InterviewPageState {
  const storageKey = getStorageKey();
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return {
        pageId: storageKey,
        items: {}
      };
    }

    const parsed = JSON.parse(raw) as InterviewPageState;
    return {
      pageId: parsed.pageId || storageKey,
      items: parsed.items || {},
      startedAt: parsed.startedAt,
      completedAt: parsed.completedAt
    };
  } catch (error) {
    console.warn('[kb] Failed to restore interview state', error);
    return {
      pageId: storageKey,
      items: {}
    };
  }
}

export function saveState(state: InterviewPageState): void {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(state));
  } catch (error) {
    console.warn('[kb] Failed to save interview state', error);
  }
}

export function getStorageKey(): string {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  return `${STORAGE_PREFIX}${pathname}`;
}

export function formatLocalDate(value: string): string {
  return new Date(value).toLocaleString();
}


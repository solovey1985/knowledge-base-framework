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

interface InterviewItemState {
  revealed?: boolean;
  hintsUsed?: number;
  selectedOption?: number;
  checked?: boolean;
  correct?: boolean;
  codeDraft?: string;
  completed?: boolean;
  solutionRevealed?: boolean;
}

interface InterviewPageState {
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

export function initInterviewPrep(): void {
  const progressRoot = document.querySelector<HTMLElement>('[data-kb-interview-progress]');
  if (!progressRoot) {
    return;
  }

  const payloads = readPayloads();
  if (payloads.length === 0) {
    return;
  }

  const state = loadState();
  if (!state.startedAt) {
    state.startedAt = new Date().toISOString();
  }

  const render = () => {
    renderSummary(progressRoot, payloads, state, render);
    for (let index = 0; index < payloads.length; index += 1) {
      const payload = payloads[index];
      const slot = document.querySelector<HTMLElement>(`[data-kb-interview-id="${payload.id}"]`);
      if (!slot) {
        continue;
      }

      renderItem(slot, payload, index, state, render);
    }

    const allCompleted = payloads.length > 0 && payloads.every(payload => Boolean(state.items[payload.id]?.completed));
    state.completedAt = allCompleted ? (state.completedAt || new Date().toISOString()) : undefined;
    saveState(state);
  };

  render();
}

function readPayloads(): InterviewPayload[] {
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

function renderSummary(root: HTMLElement, payloads: InterviewPayload[], state: InterviewPageState, onChange: () => void): void {
  const completedCount = payloads.filter(payload => Boolean(state.items[payload.id]?.completed)).length;
  const percent = payloads.length === 0 ? 0 : Math.round((completedCount / payloads.length) * 100);

  root.innerHTML = `
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="space-y-2">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">Interview Progress</p>
        <h2 class="text-2xl font-semibold tracking-tight text-slate-900">${completedCount} of ${payloads.length} completed</h2>
        <p class="text-sm text-slate-600">Track your progress as you reveal answers, validate choices, and work through code exercises.</p>
      </div>
      <button type="button" class="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:text-sky-700" data-kb-interview-reset>Reset progress</button>
    </div>
    <div class="mt-4 h-3 overflow-hidden rounded-full bg-white/80">
      <div class="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all" style="width: ${percent}%"></div>
    </div>
    <div class="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
      <span class="rounded-full border border-slate-200 bg-white px-3 py-1">${percent}% done</span>
      ${state.startedAt ? `<span class="rounded-full border border-slate-200 bg-white px-3 py-1">Started ${formatLocalDate(state.startedAt)}</span>` : ''}
      ${state.completedAt ? `<span class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">Completed ${formatLocalDate(state.completedAt)}</span>` : ''}
    </div>
  `;

  root.querySelector<HTMLButtonElement>('[data-kb-interview-reset]')?.addEventListener('click', () => {
    state.items = {};
    state.startedAt = new Date().toISOString();
    state.completedAt = undefined;
    onChange();
  });
}

function renderItem(
  slot: HTMLElement,
  payload: InterviewPayload,
  index: number,
  state: InterviewPageState,
  onChange: () => void
): void {
  const itemState = state.items[payload.id] || {};
  state.items[payload.id] = itemState;

  slot.innerHTML = buildItemMarkup(payload, index, itemState);
  bindItemActions(slot, payload, state, itemState, onChange);
  highlightCode(slot);
}

function buildItemMarkup(payload: InterviewPayload, index: number, itemState: InterviewItemState): string {
  const completedBadge = itemState.completed
    ? '<span class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Completed</span>'
    : '<span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">In progress</span>';

  const actions = `
    <div class="mt-5 flex flex-wrap gap-2">
      <button type="button" class="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:text-sky-700" data-kb-interview-toggle-complete>
        ${itemState.completed ? 'Mark incomplete' : 'Mark complete'}
      </button>
    </div>
  `;

  if (payload.kind === 'question') {
    const hintsUsed = Math.min(itemState.hintsUsed || 0, payload.hintsHtml.length);
    return `
      <section class="kb-interview-item mt-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/40" data-kb-interview-kind="question">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">Question ${index + 1}</p>
            <div class="mt-3 prose prose-slate max-w-none">${payload.promptHtml}</div>
          </div>
          ${completedBadge}
        </div>
        <div class="mt-5 space-y-3">
          ${payload.hintsHtml.slice(0, hintsUsed).map((hint, hintIndex) => `
            <div class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-700">
              <div class="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">Hint ${hintIndex + 1}</div>
              <div class="prose prose-sm prose-slate max-w-none">${hint}</div>
            </div>
          `).join('')}
          ${itemState.revealed ? `
            <div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-slate-700">
              <div class="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Answer</div>
              <div class="prose prose-sm prose-slate max-w-none">${payload.answerHtml}</div>
            </div>
          ` : ''}
        </div>
        <div class="mt-5 flex flex-wrap gap-2">
          <button type="button" class="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:text-sky-700" data-kb-interview-hint ${hintsUsed >= payload.hintsHtml.length ? 'disabled' : ''}>${hintsUsed >= payload.hintsHtml.length ? 'No more hints' : `Show hint ${hintsUsed + 1}`}</button>
          <button type="button" class="rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-600" data-kb-interview-reveal>${itemState.revealed ? 'Answer revealed' : 'Reveal answer'}</button>
        </div>
        ${actions}
      </section>
    `;
  }

  if (payload.kind === 'choice') {
    const selected = itemState.selectedOption;
    const statusMessage = itemState.checked
      ? itemState.correct
        ? '<div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">Correct.</div>'
        : '<div class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">Not quite. Review the explanation and try again.</div>'
      : '';

    return `
      <section class="kb-interview-item mt-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/40" data-kb-interview-kind="choice">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">Multiple Choice ${index + 1}</p>
            <div class="mt-3 prose prose-slate max-w-none">${payload.promptHtml}</div>
          </div>
          ${completedBadge}
        </div>
        <div class="mt-5 space-y-3">
          ${payload.optionsHtml.map((option, optionIndex) => `
            <label class="block rounded-2xl border px-4 py-3 transition ${selected === optionIndex ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'}">
              <span class="flex items-start gap-3">
                <input type="radio" name="${payload.id}" value="${optionIndex}" ${selected === optionIndex ? 'checked' : ''} data-kb-interview-choice>
                <span class="prose prose-sm prose-slate max-w-none">${option}</span>
              </span>
            </label>
          `).join('')}
        </div>
        <div class="mt-5 flex flex-wrap gap-2">
          <button type="button" class="rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-600" data-kb-interview-check>Check answer</button>
        </div>
        <div class="mt-4 space-y-3">
          ${statusMessage}
          ${itemState.checked ? `<div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"><div class="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Explanation</div><div class="prose prose-sm prose-slate max-w-none">${payload.explanationHtml}</div></div>` : ''}
        </div>
        ${actions}
      </section>
    `;
  }

  const result = itemState.checked
    ? itemState.correct
      ? '<div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">Check passed. Your draft satisfies the configured rules.</div>'
      : '<div class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">Check failed. Compare the draft with the prompt and try again.</div>'
    : '';

  return `
    <section class="kb-interview-item mt-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/40" data-kb-interview-kind="code">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">Code Completion ${index + 1}</p>
          <div class="mt-3 prose prose-slate max-w-none">${payload.promptHtml}</div>
        </div>
        ${completedBadge}
      </div>
      <div class="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div class="space-y-2">
          <div class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Your draft</div>
          <textarea class="min-h-[16rem] w-full rounded-3xl border border-slate-200 bg-slate-950 p-4 font-mono text-sm text-slate-100 outline-none transition focus:border-sky-400" data-kb-interview-code-input>${escapeHtml(itemState.codeDraft || payload.starterCode)}</textarea>
        </div>
        <div class="space-y-4">
          <div class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div class="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Reference starter</div>
            <pre class="overflow-x-auto rounded-2xl bg-slate-950 p-4 text-sm text-slate-100"><code class="language-${escapeHtml(payload.language)}">${escapeHtml(payload.starterCode)}</code></pre>
          </div>
          ${itemState.solutionRevealed ? `
            <div class="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
              <div class="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Reference solution</div>
              <pre class="overflow-x-auto rounded-2xl bg-slate-950 p-4 text-sm text-slate-100"><code class="language-${escapeHtml(payload.language)}">${escapeHtml(payload.solutionCode)}</code></pre>
            </div>
          ` : ''}
        </div>
      </div>
      <div class="mt-5 flex flex-wrap gap-2">
        <button type="button" class="rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-600" data-kb-interview-check>Check answer</button>
        <button type="button" class="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:text-sky-700" data-kb-interview-reveal-solution>${itemState.solutionRevealed ? 'Solution shown' : 'Reveal solution'}</button>
      </div>
      <div class="mt-4">${result}</div>
      ${actions}
    </section>
  `;
}

function bindItemActions(slot: HTMLElement, payload: InterviewPayload, state: InterviewPageState, itemState: InterviewItemState, onChange: () => void): void {
  slot.querySelector<HTMLButtonElement>('[data-kb-interview-toggle-complete]')?.addEventListener('click', () => {
    itemState.completed = !itemState.completed;
    onChange();
  });

  if (payload.kind === 'question') {
    slot.querySelector<HTMLButtonElement>('[data-kb-interview-hint]')?.addEventListener('click', () => {
      itemState.hintsUsed = Math.min((itemState.hintsUsed || 0) + 1, payload.hintsHtml.length);
      onChange();
    });

    slot.querySelector<HTMLButtonElement>('[data-kb-interview-reveal]')?.addEventListener('click', () => {
      itemState.revealed = true;
      onChange();
    });
    return;
  }

  if (payload.kind === 'choice') {
    slot.querySelectorAll<HTMLInputElement>('[data-kb-interview-choice]').forEach(radio => {
      radio.addEventListener('change', () => {
        itemState.selectedOption = parseInt(radio.value, 10);
        onChange();
      });
    });

    slot.querySelector<HTMLButtonElement>('[data-kb-interview-check]')?.addEventListener('click', () => {
      itemState.checked = true;
      itemState.correct = itemState.selectedOption === payload.correctIndex;
      onChange();
    });
    return;
  }

  const textarea = slot.querySelector<HTMLTextAreaElement>('[data-kb-interview-code-input]');
  textarea?.addEventListener('input', () => {
    itemState.codeDraft = textarea.value;
    saveState(state);
  });

  slot.querySelector<HTMLButtonElement>('[data-kb-interview-check]')?.addEventListener('click', () => {
    const draft = textarea?.value || '';
    itemState.codeDraft = draft;
    itemState.checked = true;
    itemState.correct = validateCodeDraft(draft, payload);
    onChange();
  });

  slot.querySelector<HTMLButtonElement>('[data-kb-interview-reveal-solution]')?.addEventListener('click', () => {
    itemState.solutionRevealed = true;
    onChange();
  });
}

function validateCodeDraft(draft: string, payload: InterviewCodePayload): boolean {
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

function normalizeCode(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function loadState(): InterviewPageState {
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

function saveState(state: InterviewPageState): void {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(state));
  } catch (error) {
    console.warn('[kb] Failed to save interview state', error);
  }
}

function getStorageKey(): string {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  return `${STORAGE_PREFIX}${pathname}`;
}

function formatLocalDate(value: string): string {
  return new Date(value).toLocaleString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function highlightCode(root: HTMLElement): void {
  const elements = root.querySelectorAll('pre code');
  elements.forEach(element => {
    window.hljs?.highlightElement?.(element);
  });
}

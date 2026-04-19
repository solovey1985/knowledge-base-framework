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

interface TechMemoryItemState {
  status?: 'new' | 'known' | 'review';
  sections?: Record<string, boolean>;
}

interface TechMemoryPageState {
  pageId: string;
  recallMode?: boolean;
  items: Record<string, TechMemoryItemState>;
}

const STORAGE_PREFIX = 'kb.tech-memory.';
const HIGHLIGHT_CLASS = 'ring-2 ring-sky-300 ring-offset-4 ring-offset-slate-50';

export function initTechMemory(): void {
  const progressRoot = document.querySelector<HTMLElement>('[data-kb-tech-memory-progress]');
  if (!progressRoot) {
    return;
  }

  const payloads = readPayloads();
  if (payloads.length === 0) {
    return;
  }

  const state = loadState();
  const render = () => {
    renderSummary(progressRoot, payloads, state, render);
    payloads.forEach((payload, index) => {
      const slot = document.querySelector<HTMLElement>(`[data-kb-tech-memory-id="${payload.id}"]`);
      if (!slot) {
        return;
      }

      renderItem(slot, payload, index, state, render);
    });

    saveState(state);
  };

  render();
}

function readPayloads(): TechMemoryPayload[] {
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

function renderSummary(root: HTMLElement, payloads: TechMemoryPayload[], state: TechMemoryPageState, onChange: () => void): void {
  const statuses = payloads.map(payload => state.items[payload.id]?.status || 'new');
  const knownCount = statuses.filter(status => status === 'known').length;
  const reviewCount = statuses.filter(status => status === 'review').length;
  const coveredCount = knownCount + reviewCount;
  const percent = payloads.length === 0 ? 0 : Math.round((coveredCount / payloads.length) * 100);

  root.innerHTML = `
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="space-y-2">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">Technical Memory</p>
        <h2 class="text-2xl font-semibold tracking-tight text-slate-900">${coveredCount} of ${payloads.length} concepts reviewed</h2>
        <p class="text-sm text-slate-600">Reveal one layer at a time, connect related concepts, and mark what you know versus what needs review.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:text-sky-700" data-kb-tech-memory-mode>Recall mode: ${state.recallMode ? 'on' : 'off'}</button>
        <button type="button" class="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-rose-300 hover:text-rose-700" data-kb-tech-memory-reset>Reset progress</button>
      </div>
    </div>
    <div class="mt-4 h-3 overflow-hidden rounded-full bg-white/80">
      <div class="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all" style="width: ${percent}%"></div>
    </div>
    <div class="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
      <span class="rounded-full border border-slate-200 bg-white px-3 py-1">${percent}% covered</span>
      <span class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">Known: ${knownCount}</span>
      <span class="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">Review: ${reviewCount}</span>
    </div>
  `;

  root.querySelector<HTMLButtonElement>('[data-kb-tech-memory-mode]')?.addEventListener('click', () => {
    state.recallMode = !state.recallMode;
    onChange();
  });

  root.querySelector<HTMLButtonElement>('[data-kb-tech-memory-reset]')?.addEventListener('click', () => {
    state.recallMode = false;
    state.items = {};
    onChange();
  });
}

function renderItem(slot: HTMLElement, payload: TechMemoryPayload, index: number, state: TechMemoryPageState, onChange: () => void): void {
  const itemState = state.items[payload.id] || { status: 'new', sections: {} };
  itemState.sections = itemState.sections || {};
  itemState.status = itemState.status || 'new';
  state.items[payload.id] = itemState;

  slot.innerHTML = buildConceptMarkup(payload, index, itemState, state.recallMode || false);
  bindActions(slot, payload, itemState, state, onChange);
}

function buildConceptMarkup(payload: TechMemoryPayload, index: number, itemState: TechMemoryItemState, recallMode: boolean): string {
  const statusBadge = renderStatusBadge(itemState.status || 'new');
  const sectionNames: Array<keyof Required<TechMemoryItemState>['sections']> = ['summary', 'details', 'example', 'mnemonic', 'recall'];

  return `
    <article id="concept-${payload.id}" class="kb-tech-memory-item mt-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/40" data-kb-tech-memory-card="${payload.id}">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">Concept ${index + 1}</p>
          <h3 class="mt-3 text-3xl font-semibold tracking-tight text-slate-900">${escapeHtml(payload.term)}</h3>
          ${payload.aliases.length > 0 ? `<p class="mt-3 text-sm text-slate-500">Aliases: ${payload.aliases.map(escapeHtml).join(', ')}</p>` : ''}
        </div>
        ${statusBadge}
      </div>

      <div class="mt-5 space-y-3 text-sm">
        ${renderRelationRow('Parents', payload.parents, 'indigo')}
        ${renderRelationRow('Children', payload.children, 'sky')}
        ${renderRelationRow('Related', payload.related, 'violet')}
      </div>

      <div class="mt-6 flex flex-wrap gap-2">
        ${sectionNames.map(section => renderActionButton(section, itemState.sections?.[section] || false)).join('')}
      </div>

      <div class="mt-6 space-y-4">
        ${renderPanel('summary', 'Summary', payload.summaryHtml, itemState.sections?.summary || false, 'slate', recallMode)}
        ${renderPanel('details', 'Details', payload.detailsHtml, itemState.sections?.details || false, 'slate', recallMode)}
        ${renderPanel('example', 'Example', payload.exampleHtml, itemState.sections?.example || false, 'slate', recallMode)}
        ${renderPanel('mnemonic', 'Mnemonic', payload.mnemonicHtml, itemState.sections?.mnemonic || false, 'emerald', recallMode)}
        ${renderRecallPanel(payload.recallHtml, itemState.sections?.recall || false, recallMode)}
      </div>

      <div class="mt-6 flex flex-wrap gap-2">
        <button type="button" data-kb-tech-memory-status="known" class="rounded-full bg-emerald-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600">Mark known</button>
        <button type="button" data-kb-tech-memory-status="review" class="rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600">Review later</button>
        <button type="button" data-kb-tech-memory-reset class="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-rose-300 hover:text-rose-700">Reset card</button>
      </div>
    </article>
  `;
}

function renderStatusBadge(status: string): string {
  if (status === 'known') {
    return '<span class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Known</span>';
  }
  if (status === 'review') {
    return '<span class="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">Review</span>';
  }
  return '<span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">New</span>';
}

function renderRelationRow(title: string, relations: TechMemoryRelation[], color: 'indigo' | 'sky' | 'violet'): string {
  if (relations.length === 0) {
    return '';
  }

  const tones: Record<typeof color, string> = {
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:border-indigo-300',
    sky: 'border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300',
    violet: 'border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-300'
  };

  return `
    <div class="flex flex-wrap items-start gap-2">
      <span class="pt-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">${title}</span>
      ${relations.map(relation => relation.targetId
        ? `<a href="#concept-${relation.targetId}" data-kb-tech-memory-link="${relation.targetId}" class="rounded-full border px-3 py-1 transition ${tones[color]}">${escapeHtml(relation.label)}</a>`
        : `<span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-500">${escapeHtml(relation.label)}</span>`
      ).join('')}
    </div>
  `;
}

function renderActionButton(section: string, active: boolean): string {
  return `<button type="button" data-kb-tech-memory-action="${section}" class="rounded-full border px-4 py-2 text-sm font-medium transition ${active ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-300 bg-white text-slate-700 hover:border-sky-300 hover:text-sky-700'}">${active ? 'Hide' : 'Reveal'} ${section === 'recall' ? 'prompts' : section}</button>`;
}

function renderPanel(section: string, title: string, html: string, revealed: boolean, tone: 'slate' | 'emerald', recallMode: boolean): string {
  if (!html) {
    return '';
  }

  const visible = revealed;
  const styles = tone === 'emerald'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-slate-200 bg-slate-50 text-slate-500';

  return `
    <section data-kb-tech-memory-panel="${section}" class="${visible ? '' : 'hidden '}rounded-3xl border p-5 ${styles}">
      <div class="text-xs font-semibold uppercase tracking-[0.2em]">${title}</div>
      <div class="mt-3 text-sm leading-7 text-slate-700">${html}</div>
    </section>
  `;
}

function renderRecallPanel(items: string[], revealed: boolean, recallMode: boolean): string {
  if (items.length === 0) {
    return '';
  }

  const visible = revealed || recallMode;
  return `
    <section data-kb-tech-memory-panel="recall" class="${visible ? '' : 'hidden '}rounded-3xl border border-amber-200 bg-amber-50 p-5">
      <div class="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">Recall prompts</div>
      <ul class="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-slate-700">
        ${items.map(item => `<li>${item}</li>`).join('')}
      </ul>
    </section>
  `;
}

function bindActions(slot: HTMLElement, payload: TechMemoryPayload, itemState: TechMemoryItemState, state: TechMemoryPageState, onChange: () => void): void {
  slot.querySelectorAll<HTMLButtonElement>('[data-kb-tech-memory-action]').forEach(button => {
    button.addEventListener('click', () => {
      const section = button.getAttribute('data-kb-tech-memory-action') || '';
      itemState.sections = itemState.sections || {};
      itemState.sections[section] = !itemState.sections[section];
      onChange();
    });
  });

  slot.querySelectorAll<HTMLButtonElement>('[data-kb-tech-memory-status]').forEach(button => {
    button.addEventListener('click', () => {
      itemState.status = button.getAttribute('data-kb-tech-memory-status') as TechMemoryItemState['status'];
      onChange();
    });
  });

  slot.querySelector<HTMLButtonElement>('[data-kb-tech-memory-reset]')?.addEventListener('click', () => {
    state.items[payload.id] = { status: 'new', sections: {} };
    onChange();
  });

  slot.querySelectorAll<HTMLAnchorElement>('[data-kb-tech-memory-link]').forEach(link => {
    link.addEventListener('click', () => {
      const targetId = link.getAttribute('data-kb-tech-memory-link');
      if (!targetId) {
        return;
      }

      window.setTimeout(() => highlightCard(targetId), 80);
    });
  });
}

function highlightCard(targetId: string): void {
  const card = document.getElementById(`concept-${targetId}`);
  if (!card) {
    return;
  }

  card.classList.add(...HIGHLIGHT_CLASS.split(' '));
  window.setTimeout(() => {
    card.classList.remove(...HIGHLIGHT_CLASS.split(' '));
  }, 1800);
}

function loadState(): TechMemoryPageState {
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

function saveState(state: TechMemoryPageState): void {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(state));
  } catch (error) {
    console.warn('[kb] Failed to save tech memory state', error);
  }
}

function getStorageKey(): string {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  return `${STORAGE_PREFIX}${pathname}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

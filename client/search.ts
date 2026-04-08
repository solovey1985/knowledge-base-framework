import lunr from 'lunr';

interface SearchInitOptions {
  baseUrl?: string;
}

interface SearchDocument {
  id: string;
  title: string;
  url: string;
  snippet: string;
}

interface SearchPayload {
  index: lunr.Index.JsonSerialized;
  documents: SearchDocument[];
}

interface SearchModal {
  root: HTMLElement;
  open(): void;
  close(): void;
  onQueryChange(handler: (query: string) => void): void;
  onClose(handler: () => void): void;
  renderResults(documents: SearchDocument[]): void;
  setReady(): void;
  setLoading(): void;
  setError(message: string, retryable?: boolean): void;
  clearResults(): void;
}

const FETCH_TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;

export function initSearch({ baseUrl = '' }: SearchInitOptions): void {
  const trigger = document.querySelector<HTMLElement>('[data-kb-search-trigger]');
  const indexName = document.body?.dataset.kbSearchIndex;
  if (!trigger || !indexName) {
    return;
  }

  const modal = createSearchModal();
  document.body.appendChild(modal.root);

  let index: lunr.Index | null = null;
  let documents: SearchDocument[] = [];
  let loading = false;
  let retryCount = 0;
  let retryTimeout: ReturnType<typeof setTimeout> | null = null;

  const loadIndex = (attempt = 0) => {
    loading = true;
    modal.setLoading();

    fetchIndex(baseUrl, indexName)
      .then(payload => {
        index = lunr.Index.load(payload.index);
        documents = payload.documents;
        retryCount = 0;
        modal.setReady();
      })
      .catch(error => {
        retryCount++;
        const isNetworkError = error.message.includes('fetch') || error.message.includes('network') || error.message.includes('timeout');
        const canRetry = attempt < MAX_RETRIES && isNetworkError;

        if (canRetry) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          modal.setError(`Retrying… (${attempt + 1}/${MAX_RETRIES})`, false);
          retryTimeout = setTimeout(() => loadIndex(attempt + 1), delay);
        } else {
          const message = formatErrorMessage(error, attempt);
          modal.setError(message, attempt < MAX_RETRIES);
        }
      })
      .finally(() => {
        loading = false;
      });
  };

  const openModal = () => {
    modal.open();
    if (!index && !loading) {
      retryCount = 0;
      loadIndex();
    }
  };

  const closeModal = () => {
    modal.close();
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
  };

  trigger.addEventListener('click', event => {
    event.preventDefault();
    openModal();
  });

  document.addEventListener('keydown', event => {
    const target = event.target as HTMLElement;
    if (event.key === '/' && !isTyping(target)) {
      event.preventDefault();
      openModal();
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openModal();
    }

    if (event.key === 'Escape') {
      closeModal();
    }
  });

  modal.onClose(() => {
    modal.clearResults();
  });

  modal.onQueryChange(query => {
    if (!index) {
      modal.renderResults([]);
      return;
    }

    const normalized = query.trim();
    if (!normalized) {
      modal.renderResults([]);
      return;
    }

    try {
      const results = executeSearch(index, documents, normalized);
      modal.renderResults(results);
    } catch {
      modal.renderResults([]);
    }
  });
}

function executeSearch(index: lunr.Index, documents: SearchDocument[], query: string): SearchDocument[] {
  const strategies = [
    () => index.search(`${query}`),
    () => index.search(`${query}*`),
    () => {
      const words = query.split(/\s+/);
      return words.flatMap(word => index.search(`${word}*`));
    }
  ];

  for (const strategy of strategies) {
    try {
      const results = strategy();
      if (results.length > 0) {
        const seen = new Set<string>();
        const unique = results.filter(r => {
          if (seen.has(r.ref)) return false;
          seen.add(r.ref);
          return true;
        });
        return unique
          .map(result => documents.find(doc => doc.id === result.ref))
          .filter((doc): doc is SearchDocument => Boolean(doc));
      }
    } catch {
      continue;
    }
  }

  return [];
}

async function fetchIndex(baseUrl: string, indexName: string): Promise<SearchPayload> {
  const requestUrl = joinUrl(baseUrl, indexName);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(requestUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Search index not found. Run "kb build" or "kb serve" to generate it.`);
      }
      throw new Error(`Search index request failed (HTTP ${response.status})`);
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Search index request timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  }
}

function formatErrorMessage(error: unknown, attempt: number): string {
  const cause = error instanceof Error ? error.message : String(error);
  if (attempt > 0) {
    return `Failed to load search index after ${attempt + 1} attempts: ${cause}`;
  }
  return cause;
}

function createSearchModal(): SearchModal {
  const root = document.createElement('div');
  root.className = 'kb-search-modal';
  root.innerHTML = `
    <div class="kb-search-modal__overlay" data-kb-close></div>
    <div class="kb-search-modal__dialog">
      <div class="kb-search-modal__bar">
        <input type="search" placeholder="Search documentation" aria-label="Search documentation" />
        <button class="kb-search-modal__close" data-kb-close aria-label="Close search">✕</button>
      </div>
      <div class="kb-search-modal__status" data-kb-search-status>Loading index…</div>
      <div class="kb-search-modal__results" data-kb-search-results></div>
    </div>
  `;

  const overlay = root.querySelector<HTMLElement>('[data-kb-close]');
  const closeBtn = root.querySelector<HTMLButtonElement>('.kb-search-modal__close');
  const input = root.querySelector<HTMLInputElement>('input');
  const status = root.querySelector<HTMLElement>('[data-kb-search-status]');
  const results = root.querySelector<HTMLElement>('[data-kb-search-results]');

  let queryHandler: ((query: string) => void) | null = null;
  let closeHandler: (() => void) | null = null;

  const open = () => {
    root.classList.add('is-visible');
    requestAnimationFrame(() => input?.focus());
  };

  const close = () => {
    root.classList.remove('is-visible');
    input!.value = '';
    status!.textContent = 'Loading index…';
    status!.classList.remove('is-hidden');
    results!.innerHTML = '';
    closeHandler?.();
  };

  overlay?.addEventListener('click', close);
  closeBtn?.addEventListener('click', close);

  input?.addEventListener('input', () => {
    status!.classList.add('is-hidden');
    queryHandler?.(input.value);
  });

  const renderResults = (documents: SearchDocument[]) => {
    if (!results) return;
    if (documents.length === 0) {
      results.innerHTML = '<p class="kb-search-modal__empty">No matches found.</p>';
      return;
    }

    results.innerHTML = documents
      .map(doc => `
        <a class="kb-search-result" href="${escapeAttr(doc.url)}">
          <strong>${escapeHtml(doc.title)}</strong>
          <span>${escapeHtml(doc.snippet)}</span>
        </a>
      `)
      .join('');
  };

  return {
    root,
    open,
    close,
    onQueryChange(handler) {
      queryHandler = handler;
    },
    onClose(handler) {
      closeHandler = handler;
    },
    renderResults,
    setReady() {
      if (status) {
        status.textContent = 'Type to search';
        status.classList.remove('is-hidden');
      }
    },
    setLoading() {
      if (status) {
        status.textContent = 'Loading index…';
        status.classList.remove('is-hidden');
      }
    },
    setError(message: string, retryable?: boolean) {
      if (!status) return;
      status.classList.remove('is-hidden');
      if (retryable) {
        status.innerHTML = `${escapeHtml(message)} <button class="kb-search-retry" style="margin-left:0.5rem;padding:0.2rem 0.6rem;border-radius:0.4rem;border:1px solid #ccc;background:#fff;cursor:pointer">Retry</button>`;
        const retryBtn = status.querySelector('.kb-search-retry');
        retryBtn?.addEventListener('click', () => {
          window.dispatchEvent(new CustomEvent('kb-search-retry'));
        });
      } else {
        status.textContent = message;
      }
    },
    clearResults() {
      if (results) {
        results.innerHTML = '';
      }
    }
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function joinUrl(baseUrl: string, suffix: string): string {
  const normalizedBase = baseUrl && baseUrl !== '/' ? baseUrl.split('\\').join('/') : '';
  const trimmedSuffix = suffix.replace(/^\/+/, '');
  if (!normalizedBase) {
    return `/${trimmedSuffix}`;
  }
  return `${normalizedBase.replace(/\/$/, '')}/${trimmedSuffix}`;
}

function isTyping(element: HTMLElement | null): boolean {
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || element.isContentEditable;
}

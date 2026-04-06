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
  setError(message: string): void;
  clearResults(): void;
}

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

  const openModal = () => {
    modal.open();
    if (!index && !loading) {
      loading = true;
      fetchIndex(baseUrl, indexName)
        .then(payload => {
          index = lunr.Index.load(payload.index);
          documents = payload.documents;
          modal.setReady();
        })
        .catch(error => {
          const message = error instanceof Error ? error.message : 'Unable to load search index';
          modal.setError(message);
        })
        .finally(() => {
          loading = false;
        });
    }
  };

  const closeModal = () => modal.close();

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
      const results = index.search(`${normalized}*`);
      const mapped = results
        .map(result => documents.find(doc => doc.id === result.ref))
        .filter((doc): doc is SearchDocument => Boolean(doc));
      modal.renderResults(mapped);
    } catch (error) {
      modal.renderResults([]);
    }
  });
}

function fetchIndex(baseUrl: string, indexName: string): Promise<SearchPayload> {
  const requestUrl = joinUrl(baseUrl, indexName);
  return fetch(requestUrl).then(response => {
    if (!response.ok) {
      throw new Error(`Search index request failed (${response.status})`);
    }
    return response.json();
  });
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
    status!.textContent = 'Type to search';
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
      results.innerHTML = '<p class="kb-search-modal__empty">No matches yet.</p>';
      return;
    }

    results.innerHTML = documents
      .map(doc => `
        <a class="kb-search-result" href="${doc.url}">
          <strong>${doc.title}</strong>
          <span>${doc.snippet}</span>
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
    setError(message: string) {
      if (status) {
        status.textContent = message;
        status.classList.remove('is-hidden');
      }
    },
    clearResults() {
      if (results) {
        results.innerHTML = '';
      }
    }
  };
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
  if (!element) {
    return false;
  }
  const tag = element.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || element.isContentEditable;
}

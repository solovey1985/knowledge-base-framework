interface NavigationInitOptions {
  baseUrl?: string;
}

const NAV_STATE_KEY = 'kb.nav.state.v1';

export function initNavigation({ baseUrl = '' }: NavigationInitOptions): void {
  const sidebar = document.querySelector<HTMLElement>('[data-kb-sidebar]');
  const navRoot = document.querySelector<HTMLElement>('[data-kb-nav]');
  if (!sidebar || !navRoot) {
    return;
  }

  const navState = loadState();
  applyState(navRoot, navState);
  bindToggleHandlers(navRoot, navState);
  bindBulkActions(navRoot, navState);
  highlightActiveLink(navRoot, baseUrl);
  initDrawer(sidebar);
}

type NavState = Record<string, boolean>;

function loadState(): NavState {
  try {
    const raw = localStorage.getItem(NAV_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch (error) {
    console.warn('[kb] Unable to parse navigation state', error);
    return {};
  }
}

function saveState(state: NavState): void {
  try {
    localStorage.setItem(NAV_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('[kb] Unable to persist navigation state', error);
  }
}

function applyState(navRoot: HTMLElement, state: NavState): void {
  const items = navRoot.querySelectorAll<HTMLElement>('[data-kb-nav-item]');
  items.forEach(item => {
    const path = item.dataset.path;
    if (!path) return;
    const persisted = state[path];
    if (persisted === undefined) return;
    setExpanded(item, persisted);
  });
}

function bindToggleHandlers(navRoot: HTMLElement, state: NavState): void {
  navRoot.addEventListener('click', event => {
    const toggle = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-kb-nav-toggle]');
    if (!toggle) return;
    event.preventDefault();

    const item = toggle.closest<HTMLElement>('[data-kb-nav-item]');
    if (!item) return;
    const path = item.dataset.path;
    if (!path) return;

    const currentlyExpanded = !item.classList.contains('is-collapsed');
    const nextState = !currentlyExpanded;
    setExpanded(item, nextState);
    state[path] = nextState;
    saveState(state);
  });
}

function bindBulkActions(navRoot: HTMLElement, state: NavState): void {
  const collapseTrigger = document.querySelector('[data-kb-collapse-nav]');
  const expandTrigger = document.querySelector('[data-kb-expand-nav]');

  collapseTrigger?.addEventListener('click', () => {
    navRoot.querySelectorAll<HTMLElement>('[data-kb-nav-item]').forEach(item => {
      const path = item.dataset.path;
      if (!path) return;
      setExpanded(item, false);
      state[path] = false;
    });
    saveState(state);
  });

  expandTrigger?.addEventListener('click', () => {
    navRoot.querySelectorAll<HTMLElement>('[data-kb-nav-item]').forEach(item => {
      const path = item.dataset.path;
      if (!path) return;
      setExpanded(item, true);
      state[path] = true;
    });
    saveState(state);
  });
}

function setExpanded(item: HTMLElement, expanded: boolean): void {
  const children = item.querySelector<HTMLElement>('[data-kb-nav-children]');
  const toggle = item.querySelector<HTMLButtonElement>('[data-kb-nav-toggle]');
  item.classList.toggle('is-collapsed', !expanded);
  item.classList.toggle('is-expanded', expanded);
  if (children) {
    children.hidden = !expanded;
  }
  if (toggle) {
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }
}

function highlightActiveLink(navRoot: HTMLElement, baseUrl: string): void {
  const current = normalizePath(window.location.pathname, baseUrl);
  const links = navRoot.querySelectorAll<HTMLAnchorElement>('[data-kb-nav-link]');
  links.forEach(link => {
    const target = link.dataset.targetPath;
    if (!target) return;
    const normalizedTarget = normalizePath(target, '');
    if (current === normalizedTarget || current.startsWith(`${normalizedTarget}/`)) {
      link.classList.add('is-active');
      const parent = link.closest<HTMLElement>('[data-kb-nav-item]');
      parent?.classList.add('is-active');
      expandParents(parent);
    }
  });
}

function normalizePath(pathname: string, baseUrl: string): string {
  let value = pathname || '';
  if (baseUrl && value.startsWith(baseUrl)) {
    value = value.substring(baseUrl.length);
  }
  value = value.replace(/\\/g, '/');
  value = value.replace(/^\//, '');
  value = value.replace(/index\.html?$/i, '');
  value = value.replace(/\.html?$/i, '.md');
  return value.replace(/\/$/, '');
}

function expandParents(item: HTMLElement | null): void {
  let current: HTMLElement | null = item;
  while (current) {
    current.classList.remove('is-collapsed');
    current.classList.add('is-expanded');
    const children = current.querySelector<HTMLElement>('[data-kb-nav-children]');
    if (children) {
      children.hidden = false;
    }
    const toggle = current.querySelector<HTMLButtonElement>('[data-kb-nav-toggle]');
    toggle?.setAttribute('aria-expanded', 'true');
    current = current.parentElement?.closest<HTMLElement>('[data-kb-nav-item]') || null;
  }
}

function initDrawer(sidebar: HTMLElement): void {
  const openers = document.querySelectorAll('[data-kb-open-drawer]');
  const closers = document.querySelectorAll('[data-kb-close-drawer]');
  const overlay = document.querySelector<HTMLElement>('[data-kb-overlay]');
  const body = document.body;

  const setOpen = (next: boolean) => {
    sidebar.classList.toggle('is-visible', next);
    body?.classList.toggle('kb-drawer-open', next);
    if (overlay) {
      overlay.classList.toggle('is-visible', next);
    }
  };

  openers.forEach(trigger => trigger.addEventListener('click', event => {
    event.preventDefault();
    setOpen(true);
  }));

  closers.forEach(trigger => trigger.addEventListener('click', event => {
    event.preventDefault();
    setOpen(false);
  }));

  overlay?.addEventListener('click', () => setOpen(false));

  window.addEventListener('resize', () => {
    if (window.innerWidth > 960) {
      setOpen(false);
    }
  });
}

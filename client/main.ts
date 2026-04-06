import './styles/main.scss';
import { initNavigation } from './navigation';
import { initSearch } from './search';

const DATA_BASE_ATTR = 'data-base-url';

function getBaseUrl(): string {
  const el = document.body;
  if (!el) return '';
  const value = el.getAttribute(DATA_BASE_ATTR);
  if (!value) return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function ready(fn: () => void): void {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    fn();
    return;
  }
  document.addEventListener('DOMContentLoaded', fn, { once: true });
}

ready(() => {
  const baseUrl = getBaseUrl();

  initNavigation({ baseUrl });
  initSearch({ baseUrl });
});

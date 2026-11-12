/** Mount once per document and release subscriptions on navigation. */
export function mountPlugin(selector: string, mount: (host: HTMLElement) => () => void): void {
  const start = () => document.querySelectorAll<HTMLElement>(selector).forEach(host => {
    if (host.dataset.clientMounted) return;
    host.dataset.clientMounted = 'true';
    const dispose = mount(host);
    window.addEventListener('pagehide', event => {
      if (event.persisted) return;
      dispose();
      delete host.dataset.clientMounted;
    });
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

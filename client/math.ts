const DELIMITERS = [
  { left: '$$', right: '$$', display: true },
  { left: '$', right: '$', display: false }
];

/** KaTeX, its stylesheet and fonts are bundled and downloaded only by pages that contain a formula. */
export function initMath(): void {
  const scope = document.querySelector<HTMLElement>('.kb-article') ?? document.body;
  if (!scope.textContent?.includes('$')) {
    return;
  }
  void Promise.all([import('katex/contrib/auto-render'), import('katex/dist/katex.min.css')])
    .then(([autoRender]) => autoRender.default(scope, { delimiters: DELIMITERS, throwOnError: false }))
    .catch(error => console.warn('Math rendering is unavailable:', error));
}

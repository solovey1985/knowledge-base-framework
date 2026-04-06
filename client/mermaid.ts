let mermaidLoader: Promise<typeof import('mermaid/dist/mermaid.esm.mjs')> | null = null;

function loadMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs');
  }
  return mermaidLoader;
}

export function initMermaid(): void {
  const codeBlocks = Array.from(document.querySelectorAll<HTMLElement>('pre > code.language-mermaid'));
  const standaloneBlocks = Array.from(document.querySelectorAll<HTMLElement>('.mermaid'));

  if (codeBlocks.length === 0 && standaloneBlocks.length === 0) {
    return;
  }

  const targets: Array<{ source: string; host: HTMLElement }> = [];

  codeBlocks.forEach(block => {
    const source = block.textContent || '';
    const wrapper = document.createElement('div');
    wrapper.className = 'mermaid';
    const pre = block.parentElement;
    if (pre && pre.parentElement) {
      pre.parentElement.replaceChild(wrapper, pre);
      targets.push({ source, host: wrapper });
    }
  });

  standaloneBlocks.forEach(block => {
    targets.push({ source: block.textContent || '', host: block });
  });

  targets.forEach(async ({ source, host }, index) => {
    try {
      const { default: mermaid } = await loadMermaid();
      mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
      const { svg } = await mermaid.render(`mermaid-${index}`, source);
      host.innerHTML = svg;
    } catch (error) {
      host.innerHTML = `<pre class="kb-mermaid-error">${escapeHtml(String(error))}</pre>`;
    }
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

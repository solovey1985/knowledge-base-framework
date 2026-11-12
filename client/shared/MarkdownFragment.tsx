import { useEffect, useRef } from 'react';

// Only HTML rendered by the existing server Markdown renderer belongs here.
export function MarkdownFragment({ html }: { html: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    host.current?.querySelectorAll('pre code').forEach(code => window.hljs?.highlightElement?.(code));
  }, [html]);
  return <div ref={host} className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />;
}

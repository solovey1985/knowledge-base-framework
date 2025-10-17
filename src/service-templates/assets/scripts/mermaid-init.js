// Mermaid diagram renderer for docs portal
// Usage: <script type="module" src="/assets/mermaid-init.js"></script>

import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs";

// 1) Hide Mermaid code blocks to avoid flash-of-unprocessed-code
const css = document.createElement("style");
css.textContent = `
  pre > code.language-mermaid { display: none; }
  .mermaid svg { max-width: 100%; height: auto; }
`;
document.head.appendChild(css);

// 2) Init Mermaid (no auto-scan; we’ll render programmatically)
mermaid.initialize({
  startOnLoad: false,
  theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default",
  securityLevel: "strict",
});

// 3) Find all code.language-mermaid and replace each with rendered SVG
(async () => {
  const blocks = document.querySelectorAll('pre > code.language-mermaid');
  let i = 0;
  for (const code of blocks) {
    const graphText = code.textContent;
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid";
    const pre = code.closest("pre");
    pre.replaceWith(wrapper);
    try {
      const { svg } = await mermaid.render(`mmd-${i++}`, graphText);
      wrapper.innerHTML = svg;
    } catch (err) {
      wrapper.textContent = "Mermaid render error. See console.";
      console.error(err);
    }
  }
})();

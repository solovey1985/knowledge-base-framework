// Plain ES module: no build step is required for a plugin's client code.
for (const element of document.querySelectorAll('[data-reading-time]')) {
  const minutes = Number(element.dataset.minutes) || 1;
  element.textContent = `${minutes} min read`;
}

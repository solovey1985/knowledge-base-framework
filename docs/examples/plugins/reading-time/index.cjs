// Example third-party plugin. Reference it from kb.plugins.json:
//   { "module": "./plugins/reading-time/index.cjs", "options": { "wordsPerMinute": 200 } }
const path = require('node:path');

/** @returns {import('@solovey1985/knowledge-base-framework').KnowledgeBasePlugin} */
module.exports = function readingTimePlugin(options = {}) {
  const wordsPerMinute = options.wordsPerMinute ?? 200;
  // Validate here: create() runs at startup and in "kb doctor", never per request.
  if (!Number.isInteger(wordsPerMinute) || wordsPerMinute < 50 || wordsPerMinute > 1000) {
    throw new Error('readingTime: wordsPerMinute must be an integer between 50 and 1000.');
  }

  return {
    id: 'reading-time',

    // Served at /plugin-assets/reading-time/ and copied by static builds.
    assetsDir: path.join(__dirname, 'assets'),

    // The script and stylesheet are added only to pages that contain the marker attribute.
    clientEntry: { file: 'reading-time.js', cssFile: 'reading-time.css', marker: 'data-reading-time' },

    // Custom Markdown syntax: ==highlighted text==
    markdownExtensions: [{
      extensions: [{
        name: 'highlight',
        level: 'inline',
        start: source => source.indexOf('=='),
        tokenizer(source) {
          const match = /^==([^=\n]+)==/.exec(source);
          return match ? { type: 'highlight', raw: match[0], tokens: this.lexer.inlineTokens(match[1]) } : undefined;
        },
        renderer(token) {
          return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
        },
      }],
    }],

    // Runs after a Markdown document is rendered.
    transformPage(page, context) {
      const words = context.markdown.split(/\s+/).filter(Boolean).length;
      const minutes = Math.max(1, Math.round(words / wordsPerMinute));
      return {
        ...page,
        htmlContent: `<p class="reading-time" data-reading-time data-minutes="${minutes}"></p>${page.htmlContent}`,
        metadata: { ...page.metadata, readingMinutes: minutes },
      };
    },
  };
};

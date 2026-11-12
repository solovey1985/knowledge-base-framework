# Interview Prep Plugin Design

## Goal

Add a plugin that turns a markdown document into an interactive technical interview preparation page.

The plugin should support:

- Questions with hidden answers
- Up to 3 optional hints per question
- Multiple-choice questions with 3 answer variants
- Code-completion questions based on code samples
- Client-side interactivity in TypeScript
- Local progress tracking and state persistence

## Recommended Activation Model

Use a dedicated markdown page extension for the first version:

- `*.interview.md`

Example:

- `typescript-basics.interview.md`
- `dotnet-generics.interview.md`

Why this is the best first step:

- Fits the current plugin architecture better than normal `.md` takeover
- Avoids changing all markdown rendering behavior immediately
- Makes interview pages explicit and easy to detect
- Leaves room for future frontmatter-based activation

Future extension:

- support normal `.md` files with frontmatter like `plugin: interview`

## Plugin Responsibilities

### Server Side

The plugin should:

- Match `*.interview.md`
- Read the markdown document
- Parse interactive interview blocks
- Render normal markdown sections to HTML
- Replace special interview blocks with structured interactive HTML
- Return a standard `RenderedContent` page

### Client Side

The client script should:

- Hydrate interactive interview blocks
- Show hints and answers
- Check multiple-choice answers
- Manage code-completion state
- Track progress for the page
- Persist progress in `localStorage`

## Required Core Changes

The current plugin system matches by file extension only. That is not enough for `*.interview.md` because the final extension is still `.md`.

Recommended change:

Add a custom matcher to content renderer plugins.

Current shape:

```ts
export interface ContentRendererPlugin {
  id: string;
  extensions: string[];
  render: (context: PluginRenderContext) => Promise<RenderedContent | null>;
  renderDirectoryItem?: (context: PluginDirectoryContext) => PluginDirectoryRenderInfo | null;
}
```

Recommended shape:

```ts
export interface ContentRendererPlugin {
  id: string;
  extensions?: string[];
  matches?: (requestPath: string, extension: string) => boolean;
  render: (context: PluginRenderContext) => Promise<RenderedContent | null>;
  renderDirectoryItem?: (context: PluginDirectoryContext) => PluginDirectoryRenderInfo | null;
}
```

Matching order:

1. `matches(...)` if defined
2. fallback to `extensions`

This will support:

- `*.interview.md`
- future content-driven markdown plugins
- future compound extensions without fragile hacks

## Authoring Format

Interview pages should remain markdown documents with fenced blocks for interactive sections.

This keeps the source readable and compatible with existing markdown workflows.

### Hidden Answer Question

````md
```interview-question
What is the difference between `interface` and `type` in TypeScript?
---
answer:
Interfaces are open and support declaration merging. Types are more general and can represent unions, primitives, and mapped types.
hints:
- One supports declaration merging.
- One is commonly used for unions.
- Think about API shape vs composition.
```
````

### Multiple Choice Question

````md
```interview-choice
Which statement about closures is correct?
---
options:
- A closure only exists in async functions.
- A closure keeps access to variables from its lexical scope.
- A closure copies outer values when the function is created.
correct: 1
explanation:
Closures retain access to the lexical environment in which they were created.
```
````

### Code Completion Question

````md
```interview-code
language: ts
prompt: Complete the function so it returns only even values.
starter:
function onlyEven(values: number[]): number[] {
  return values.
}
solution:
function onlyEven(values: number[]): number[] {
  return values.filter(value => value % 2 === 0);
}
checks:
- includes: filter
- includes: % 2 === 0
```
````

## Parsing Strategy

Use a two-pass render flow inside the plugin.

### Pass 1: Parse source document

Split the markdown into:

- normal markdown blocks
- interview blocks

Interview blocks are recognized by fenced code languages:

- `interview-question`
- `interview-choice`
- `interview-code`

### Pass 2: Render output

- Render normal markdown chunks with `MarkdownRenderer`
- Replace interview blocks with structured HTML mount nodes
- Include JSON payloads for client hydration

Recommended HTML output shape:

```html
<section class="kb-interview-item" data-kb-interview-item="q1" data-kb-interview-kind="choice"></section>
<script type="application/json" data-kb-interview-payload="q1">
  { ... }
</script>
```

Why use JSON payload scripts:

- safer than packing large escaped strings into attributes
- easier to evolve
- cleaner for code-completion content

## Page Layout

Interview pages should use the normal documentation layout in v1.

That means:

- navigation panel remains visible
- breadcrumbs remain visible
- page content is rendered inside the normal document shell

Suggested content structure:

- Intro section
- Progress summary bar/card
- Interview items in document order
- Optional final summary section

## State Management

Use client-side state with `localStorage` in v1.

Recommended shape:

```ts
interface InterviewPageState {
  pageId: string;
  items: Record<string, {
    revealed?: boolean;
    hintsUsed?: number;
    selectedOption?: number;
    checked?: boolean;
    correct?: boolean;
    codeDraft?: string;
    completed?: boolean;
  }>;
  startedAt?: string;
  completedAt?: string;
}
```

Storage key:

- `kb.interview.<page-path>`

What to track:

- viewed hints
- revealed answer state
- chosen multiple-choice answer
- whether each item is completed
- code draft for code-completion questions
- page-level completion percentage

## Interaction Model

### Hidden Answer Questions

Actions:

- `Show hint 1`
- `Show hint 2`
- `Show hint 3`
- `Reveal answer`
- `Mark complete`

### Multiple Choice Questions

Actions:

- select one of 3 options
- `Check answer`
- show explanation after checking
- `Mark complete` automatically when checked or correct, depending on settings

### Code Completion Questions

Recommended v1 implementation:

- textarea or simple editable code area
- syntax-highlighted reference block for starter code is optional
- `Check answer` validates via lightweight heuristic rules
- `Reveal solution` shows the expected solution

Do not build a code execution sandbox in v1.

Recommended checks:

- required substring rules
- forbidden substring rules
- normalized exact match for simple tasks

## Frontmatter Support

Even if the page is activated by `*.interview.md`, frontmatter should still be supported for page settings.

Example:

```yaml
---
title: TypeScript Interview Practice
plugin: interview
interview:
  persistProgress: true
  shuffleChoices: false
  showScore: true
---
```

Useful settings:

- `persistProgress`
- `shuffleChoices`
- `showScore`
- `allowRevealAll`
- `markCompleteOnCheck`

## Plugin API Proposal

### Factory

```ts
export interface InterviewPrepPluginOptions {
  sectionTitle?: string;
}

export function interviewPrepPlugin(options?: InterviewPrepPluginOptions): KnowledgeBasePlugin
```

### Directory listing behavior

Interview pages can appear in a dedicated directory section:

- section key: `interviews`
- title: `Interview Prep`

Meta examples:

- `Interview • TS`
- `Interview • 12 questions`

## Client Runtime Structure

Suggested client file:

- `client/interviewPrep.ts`

Suggested responsibilities:

- scan for interview payloads
- build interactive UI for each item
- persist state
- update progress bar
- expose reset action

Suggested module structure:

- parser/hydrator
- state store
- item renderers
- progress summary

## Suggested Metadata

The plugin should include page metadata like:

```ts
{
  isInterviewPrep: true,
  interviewItemCount: number,
  interviewKinds: ['question', 'choice', 'code']
}
```

This gives future layout/template hooks room to evolve.

## Example Usage

### 1. Register plugin

In plugin settings:

```json
{
  "plugins": [
    {
      "name": "interviewPrep",
      "enabled": true,
      "options": {
        "sectionTitle": "Interview Prep"
      }
    }
  ]
}
```

### 2. Create content file

Example file:

- `content/interviews/typescript-basics.interview.md`

### 3. Open in browser

Expected behavior:

- page renders like a normal markdown document
- interview blocks become interactive widgets
- progress persists locally

## Implementation Plan

### Phase 1: Core support

1. Extend plugin renderer matching with `matches(...)`
2. Add plugin settings loader support for `interviewPrep`
3. Export plugin factory from `src/index.ts`

### Phase 2: Server plugin

1. Create `src/plugins/interviewPrepPlugin.ts`
2. Match `*.interview.md`
3. Parse interview fenced blocks
4. Render normal markdown + interactive placeholders
5. Add directory listing decoration

### Phase 3: Client runtime

1. Add `client/interviewPrep.ts`
2. Initialize from `client/main.ts`
3. Implement hidden-answer interactions
4. Implement multiple-choice interactions
5. Implement code-completion interactions
6. Implement progress state persistence

### Phase 4: Documentation and examples

1. Add README section
2. Add sample `kb.plugins.json` config
3. Add sample interview markdown page

## Recommended v1 Scope

Keep the first implementation intentionally narrow:

- activation by `*.interview.md`
- hidden-answer questions
- multiple-choice questions
- code completion with simple heuristic validation
- `localStorage` state
- no sandboxed code execution
- no question randomization yet

## Future Enhancements

- Frontmatter activation on regular `.md`
- Question tags and difficulty levels
- Timed interview mode
- Randomized question order
- Spaced repetition mode
- Export/import progress
- Rich code editor integration
- Server-backed synced progress

## Recommendation

Implement the plugin in this order:

1. Add `matches(...)` support to the plugin manager
2. Build `interviewPrepPlugin` for `*.interview.md`
3. Use fenced blocks for question definitions
4. Hydrate on the client with TypeScript and `localStorage`
5. Keep code-completion validation simple in v1

This gives a practical first version without overcomplicating markdown rendering or adding a sandbox too early.

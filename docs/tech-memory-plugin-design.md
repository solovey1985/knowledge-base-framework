# Tech Memory Plugin Design

## Goal

Add a plugin that helps organize and memorize technical concepts through structured relationships instead of question/answer drills.

The plugin should support:

- a term or common phrase as the main study unit
- a short summary and a broader explanation
- links to higher-level concepts
- links to lower-level concepts
- related concepts
- optional examples
- optional mnemonics
- optional recall prompts
- client-side progress tracking and memorization state

This plugin is intended to help users build a mental model of complex technical domains such as:

- TypeScript and JavaScript language concepts
- .NET runtime and architecture concepts
- networking and security terminology
- database internals
- cloud architecture building blocks
- system design vocabulary

## UX Direction

The plugin should feel like a structured study atlas, not a quiz engine and not a graph-first visualization tool.

The best v1 UI is:

- a normal documentation page
- a progress summary at the top
- a stack of interactive concept cards
- progressive reveal of concept details
- relationship chips for parents, children, and related items
- local progress persistence

This direction fits the existing documentation UI and the patterns seen in the service-template assets:

- documentation-first layout
- hierarchy and navigation as primary structure
- progressive disclosure
- local state persistence
- low-noise, readable styling

## Recommended Activation Model

Two activation models are possible, but suffix-based discovery should be the primary implementation.

### Option 1: suffix-based activation

Use a dedicated page suffix:

- `*.concept.md`

Examples:

- `dependency-injection.concept.md`
- `tcp-handshake.concept.md`
- `garbage-collector.concept.md`

Pros:

- explicit and easy to reason about
- very easy to scan in the content tree
- simple for authors and maintainers

Cons:

- adds a special file naming convention

### Option 2: frontmatter-only activation

Use normal markdown files with frontmatter:

```yaml
---
plugin: techMemory
techMemory:
  persistProgress: true
  showHierarchy: true
---
```

Pros:

- cleaner filenames
- more flexible long term
- consistent with future interactive markdown plugins

Cons:

- activation is less visible from filenames alone
- plugin detection depends on reading file contents

## Recommendation

Yes, suffix usage can be avoided technically, but it should not be the primary discovery model.

Recommended final behavior:

1. use `*.concept.md` as the primary activation model
2. use frontmatter for page-level configuration
3. optionally support frontmatter-only activation later if there is a concrete need

Why suffix-first is better:

- more performant because the plugin can be selected without reading file contents
- clearer in the content tree
- simpler to debug
- consistent with the existing `*.interview.md` approach

This same recommendation should apply to the interview plugin.

## Frontmatter Model

### Interview plugin

Suggested frontmatter for configuration on `*.interview.md` pages:

```yaml
---
title: TypeScript Interview Practice
plugin: interview
interview:
  persistProgress: true
  shuffleChoices: false
  showScore: true
  allowRevealAll: true
  markCompleteOnCheck: true
---
```

### Tech memory plugin

Suggested frontmatter for configuration on `*.concept.md` pages:

```yaml
---
title: Dependency Injection Concepts
plugin: techMemory
techMemory:
  persistProgress: true
  defaultReveal: term
  showHierarchy: true
  showRelated: true
  enableRecallMode: true
  sectionTitle: Technical Memory
---
```

Suggested plugin key normalization:

- `interview`
- `techMemory`

## Authoring Model

Pages remain markdown documents with special fenced blocks.

Normal markdown can be mixed with structured interactive blocks.

### Concept card block

````md
```concept-card
term: Dependency Injection
aliases:
- DI
parents:
- Inversion of Control
children:
- Constructor Injection
- Method Injection
- Property Injection
related:
- Composition Root
- Service Lifetime
summary:
A pattern where dependencies are provided from outside the class.
details:
Dependency Injection improves testability, configurability, and separation of concerns.
example:
ASP.NET Core injects registered services through constructors.
mnemonic:
Don't create collaborators inside the class; receive them.
recall:
- What broader concept does it belong to?
- What are the common injection forms?
- Why does it improve testability?
```
````

## UI/UX Features

### Concept cards

Each concept card should include:

- term
- optional aliases
- short summary
- optional detailed explanation
- optional example
- optional mnemonic
- recall prompts
- relationship chips

### Relationship display

Use chips or linked badges for:

- parents
- children
- related concepts

This reinforces memorization through hierarchy and association.

### Progressive reveal

Each card should support:

- reveal summary
- reveal details
- reveal example
- reveal mnemonic
- show recall prompts

This supports active recall instead of passive reading.

### Memorization state

Each card should allow:

- mark known
- review later
- reset card state

### Progress summary

At the top of the page show:

- total concept count
- known count
- review-later count
- completion percentage

## State Management

Use `localStorage` in v1.

Suggested key:

- `kb.tech-memory.<page-path>`

Suggested state shape:

```ts
interface TechMemoryPageState {
  pageId: string;
  items: Record<string, {
    summaryRevealed?: boolean;
    detailsRevealed?: boolean;
    exampleRevealed?: boolean;
    mnemonicRevealed?: boolean;
    recallRevealed?: boolean;
    status?: 'new' | 'known' | 'review';
  }>;
  startedAt?: string;
  completedAt?: string;
}
```

## Server Plugin Responsibilities

The plugin should:

- detect whether a markdown page belongs to `techMemory`
- parse frontmatter
- parse `concept-card` fenced blocks
- render normal markdown through `MarkdownRenderer`
- replace concept blocks with structured placeholders and JSON payloads
- return a normal `RenderedContent` page

## Client Plugin Responsibilities

The client runtime should:

- hydrate concept cards
- manage reveal controls
- persist local state
- update progress summary
- support known/review status

Suggested client file:

- `client/techMemory.ts`

## Directory Listing Behavior

Concept pages should appear in a dedicated section when possible:

- section key: `technical-memory`
- title: `Technical Memory`

Example meta labels:

- `Memory • Concepts`
- `Memory • 14 terms`

## Implementation Steps

### Phase 1: shared frontmatter support

1. create a reusable frontmatter parser utility
2. update `interviewPrepPlugin` to read frontmatter settings on `*.interview.md`
3. define shared helpers for interactive markdown plugins

### Phase 2: server-side tech memory plugin

1. add `techMemoryPlugin`
2. allow activation by `*.concept.md`
3. parse frontmatter settings after suffix-based activation
4. parse `concept-card` blocks
5. render placeholders with JSON payloads
6. attach plugin metadata to the page

### Phase 3: client-side runtime

1. add `client/techMemory.ts`
2. hydrate cards
3. implement reveal controls
4. implement known/review status
5. implement progress summary
6. persist state in `localStorage`

### Phase 4: plugin settings and docs

1. allow `techMemory` in `kb.plugins.json`
2. export plugin from `src/index.ts`
3. add README usage section
4. add example `.concept.md` or frontmatter-based `.md` page

## Recommended v1 Scope

Keep the first version narrow:

- frontmatter settings support
- `concept-card` block
- reveal-based study UI
- known/review-later state
- local progress persistence
- directory listing grouping

Do not add in v1:

- graph canvas
- spaced repetition scheduler
- cross-page backlink engine
- server-side progress sync

## Future Enhancements

- graph visualization
- compare blocks for confusing concepts
- backlinks between terms across pages
- spaced repetition review mode
- concept collections and filtering by difficulty
- cross-page concept index

## Summary

This plugin should focus on memorization by hierarchy and association.

Recommended direction:

1. support suffix-based activation for both `interview` and `techMemory`
2. use frontmatter for plugin configuration and page behavior
3. keep markdown as the source format
4. use structured interactive cards for concepts
5. keep the documentation layout intact
6. add graph or advanced memorization features later

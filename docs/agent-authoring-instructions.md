# Agent Authoring Instructions For Interview And Concept Pages

## Purpose

Use this guide when an agent needs to turn existing technical markdown content into interactive pages for the framework.

This document covers:

- how to build `*.interview.md` pages
- how to build `*.concept.md` pages
- the correct block syntax
- how relations should be written
- what content belongs in each field

## General Rules

1. Keep the page focused on one topic cluster.
2. Preserve useful narrative markdown outside interactive blocks.
3. Prefer multiple small blocks over one oversized block.
4. Keep wording concise and study-friendly.
5. Use consistent names for related concepts across the page.
6. Do not invent relationships that are not supported by the source material.

## File Types

### Interview pages

Use:

- `topic-name.interview.md`

Examples:

- `typescript-basics.interview.md`
- `promises.interview.md`

### Concept pages

Use:

- `topic-name.concept.md`

Examples:

- `promises.concept.md`
- `dependency-injection.concept.md`

## Frontmatter

Frontmatter is used for page metadata and plugin settings.

### Interview page frontmatter

```yaml
---
title: TypeScript Interview Practice
interview:
  persistProgress: true
  shuffleChoices: false
  showScore: true
  allowRevealAll: true
  markCompleteOnCheck: true
---
```

### Concept page frontmatter

```yaml
---
title: Promises Concept Map
techMemory:
  persistProgress: true
  defaultReveal: term
  showHierarchy: true
  showRelated: true
  enableRecallMode: true
  sectionTitle: Technical Memory
---
```

## Interview Page Authoring

Interview pages mix normal markdown with interactive interview blocks.

Supported blocks:

- `interview-question`
- `interview-choice`
- `interview-code`

## Interview Block Syntax

### 1. Hidden-answer question

Use this for open recall.

````md
```interview-question
What is the difference between `interface` and `type` in TypeScript?
---
answer:
Interfaces support declaration merging. Types are more general and can represent unions and primitives.
hints:
- One supports declaration merging.
- One is commonly used for unions.
- Think about API contracts versus type composition.
```
````

Structure:

- first lines before `---`: the prompt
- `answer:`: the revealed answer
- `hints:`: optional list, up to 3 is recommended

Guidelines:

- ask one clear thing
- answer should be brief but correct
- hints should progressively narrow the answer

### 2. Multiple-choice question

Use this for recognition and distinction.

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

Structure:

- prompt before `---`
- `options:`: list of answer variants
- `correct:`: zero-based correct option index
- `explanation:`: explanation shown after checking

Guidelines:

- use exactly 3 options when possible
- keep distractors plausible
- explanation should clarify why the correct answer is correct

### 3. Code-completion question

Use this for implementation recall.

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

Structure:

- `language:`: code language, usually `ts`, `js`, `cs`, etc.
- `prompt:`: what the learner must do
- `starter:`: incomplete starting code
- `solution:`: reference answer
- `checks:`: heuristic validation rules

Supported checks:

- `includes: ...`
- `excludes: ...`
- `equals: ...`

Guidelines:

- keep tasks small and local
- use `checks:` for practical validation
- do not rely on full code execution

## Concept Page Authoring

Concept pages mix normal markdown with `concept-card` blocks.

Use concept pages to help memorize:

- terms
- definitions
- hierarchy
- related concepts
- examples
- mnemonics

## Concept Card Syntax

````md
```concept-card
id: promise-state
term: Promise State
aliases:
- Promise lifecycle state
parents:
- Promise
children:
- Pending
- Fulfilled
- Rejected
related:
- Settlement
summary:
A Promise can be pending, fulfilled, or rejected.
details:
A Promise starts as pending and transitions only once to fulfilled or rejected.
example:
A network request Promise remains pending while the request is in flight.
mnemonic:
Pending waits, fulfilled succeeds, rejected fails.
recall:
- Which state comes first?
- Can a fulfilled Promise become rejected later?
- What does settled mean?
```
````

## Concept Card Fields

### Required field

- `term:`

### Recommended fields

- `id:`
- `summary:`
- `details:`
- `parents:`
- `children:`
- `related:`
- `recall:`

### Optional fields

- `aliases:`
- `example:`
- `mnemonic:`

## Meaning Of Each Concept Field

### `id:`

Canonical identifier for linking.

Example:

```md
id: promise-state
```

Use when:

- the term may be ambiguous
- the page is large
- you want stable internal linking

If `id:` is omitted, the plugin derives one from `term:`.

### `term:`

The visible concept name.

Example:

```md
term: Promise
```

Guidelines:

- use the standard technical name
- keep it short
- do not include explanation text here

### `aliases:`

Alternative names or phrases for the same concept.

Example:

```md
aliases:
- JavaScript Promise
- async result wrapper
```

Use aliases when:

- the concept is commonly known by another name
- alternate wording appears in source docs

### `parents:`

Broader concepts above this concept.

Example:

```md
parents:
- Asynchronous Programming
- Event Loop
```

Meaning:

- “this concept belongs under these broader ideas”

### `children:`

Narrower or subordinate concepts.

Example:

```md
children:
- Pending
- Fulfilled
- Rejected
```

Meaning:

- “these concepts are parts, states, forms, or subtopics of this concept”

### `related:`

Peer concepts, commonly associated ideas, or commonly confused neighbors.

Example:

```md
related:
- async/await
- Microtask Queue
- Callback
```

Meaning:

- “not hierarchical, but strongly associated”

### `summary:`

Short study definition.

Guidelines:

- 1 to 2 sentences
- optimized for first reveal
- should answer “what is it?”

### `details:`

Broader explanation.

Guidelines:

- explain mechanics, constraints, or significance
- can be multi-line
- should answer “how does it work?” or “why does it matter?”

### `example:`

Short concrete example.

Guidelines:

- use brief prose or compact code-like text
- keep it readable in plain markdown
- avoid nested fenced code blocks inside the field

Recommended:

```md
example:
fetch('/api/data').then(r => r.json())
```

Avoid deeply nested markdown constructs inside `example:`.

### `mnemonic:`

Memory aid.

Guidelines:

- short and memorable
- not a replacement for correctness
- useful for abstract concepts

### `recall:`

List of active recall prompts.

Example:

```md
recall:
- What does a Promise represent?
- Why is it better than nested callbacks?
- Which concepts sit directly below it?
```

Guidelines:

- ask short questions
- focus on structure, behavior, and distinctions

## Relation Linking Rules

Concept relations are linked by:

1. explicit `id:` if present
2. normalized `term:`
3. normalized `aliases:`

That means these relation entries can resolve to a local card:

```md
children:
- Promise State
```

or:

```md
children:
- promise-state
```

## Best Practice For Relations

Use explicit `id:` for larger pages.

Example:

````md
```concept-card
id: promise-state
term: Promise State
...
```
````

Then relations can safely reference:

```md
children:
- promise-state
```

## Recommended Page Structure

### Interview page structure

Suggested order:

1. title and short introduction
2. one markdown section per topic cluster
3. a mix of:
   - hidden-answer questions
   - multiple-choice questions
   - code-completion tasks
4. short final summary section if needed

### Concept page structure

Suggested order:

1. title and short introduction
2. main concept card
3. child/lifecycle/state cards
4. related concept cards
5. brief author notes or summary markdown

## Converting Existing Markdown Into Interview Pages

When an agent converts existing content into an interview page:

1. extract important facts and distinctions
2. turn definitions into `interview-question`
3. turn common confusions into `interview-choice`
4. turn short implementation patterns into `interview-code`
5. keep the rest as normal markdown

## Converting Existing Markdown Into Concept Pages

When an agent converts existing content into a concept page:

1. identify the main concept cluster
2. create one `concept-card` per concept
3. connect cards with `parents`, `children`, and `related`
4. keep summaries short
5. keep details explanatory, not repetitive
6. add recall prompts for memorization

## Authoring Constraints

1. Do not make cards too large.
2. Do not put multiple unrelated concepts into one card.
3. Do not use nested fenced code blocks inside structured fields unless parser support is explicitly added.
4. Do not create relation names that differ only slightly from card terms unless you also define `id:` or `aliases:` clearly.
5. Do not overload `related:` with weak associations.

## Minimal Good Examples

### Interview example

````md
```interview-question
What is a closure?
---
answer:
A closure is a function that retains access to its lexical scope.
hints:
- It is about scope.
- It does not require async code.
```
````

### Concept example

````md
```concept-card
id: closure
term: Closure
parents:
- JavaScript Functions
related:
- Lexical Scope
summary:
A closure is a function that retains access to its lexical scope.
details:
It can use variables from the environment where it was created even after that outer function has returned.
recall:
- What does a closure retain?
- Why are closures useful?
```
````

## Final Recommendation For Agents

When in doubt:

- use `*.interview.md` for practice and recall
- use `*.concept.md` for hierarchy and memorization
- keep cards small
- keep syntax exact
- prefer explicit `id:` for concept pages with many relations

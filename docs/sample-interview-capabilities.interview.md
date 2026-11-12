---
title: Interview Plugin Capability Showcase
interview:
  persistProgress: true
  showScore: true
  allowRevealAll: true
  markCompleteOnCheck: true
---

# Interview Plugin Capability Showcase

This sample page demonstrates all current interview plugin capabilities:

- hidden-answer questions
- optional hints
- multiple-choice questions
- code-completion tasks
- markdown inside prompts, hints, explanations, and answers

Use this file to manually verify rendering, interaction, and progress persistence.

## Hidden Answer Questions

```interview-question
What is the difference between `interface` and `type` in TypeScript?
---
answer:
`interface` is best suited for extensible object shapes and supports **declaration merging**.

`type` is more general and can represent:

- primitives
- unions
- intersections
- tuples
- mapped types

In practice, both can describe object types, but `type` is broader.
hints:
- One of them supports declaration merging.
- One is commonly used for unions like `string | number`.
- Think about API contracts versus type composition.
```

```interview-question
Why can mutating shared state in asynchronous code be risky?
---
answer:
Mutating shared state in async code can introduce **race conditions** because operations may complete in an order different from the one you expect.

Common consequences:

- stale writes
- lost updates
- non-deterministic bugs

Safer alternatives include immutability, synchronization, serialization, or isolating state ownership.
hints:
- Think about two async operations updating the same object.
- The failure often depends on timing.
- The same input may not always produce the same result.
```

## Multiple Choice Questions

```interview-choice
Which statement about closures in JavaScript is correct?
---
options:
- A closure only exists inside async functions.
- A closure keeps access to variables from its lexical scope.
- A closure copies all outer variables by value when the function is created.
correct: 1
explanation:
A closure gives a function access to the lexical environment in which it was created.

It does **not** require async code, and it does **not** create value copies of all referenced variables.
```

```interview-choice
Which option best describes `Promise.all()`?
---
options:
- It resolves after the first promise finishes.
- It resolves when all promises resolve, and rejects if any promise rejects.
- It ignores rejected promises and only returns resolved ones.
correct: 1
explanation:
`Promise.all()` waits for every promise in the input collection to resolve.

If any promise rejects, the combined promise rejects immediately with that error.
```

## Code Completion Questions

```interview-code
language: ts
prompt: Complete the function so it returns only even values from the input array.
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

```interview-code
language: ts
prompt: Complete the function so it returns a new array of uppercase names.
starter:
function upperCaseNames(values: string[]): string[] {
  return values.
}
solution:
function upperCaseNames(values: string[]): string[] {
  return values.map(value => value.toUpperCase());
}
checks:
- includes: map
- includes: toUpperCase
```

```interview-code
language: ts
prompt: Complete the function so it returns `true` when every number is positive.
starter:
function areAllPositive(values: number[]): boolean {
  return false;
}
solution:
function areAllPositive(values: number[]): boolean {
  return values.every(value => value > 0);
}
checks:
- includes: every
- includes: > 0
- excludes: < 0
```

## Mixed Markdown Content

Interview pages can also contain regular markdown between interactive blocks.

### Things to verify

- progress summary appears at the top
- hidden-answer questions reveal hints one by one
- multiple-choice questions show explanations after checking
- code-completion questions preserve draft state in `localStorage`
- progress survives a page reload

### Suggested manual test flow

1. Open this page in the browser.
2. Reveal one hint and one answer.
3. Answer a multiple-choice question.
4. Enter code into one code-completion task.
5. Refresh the page.
6. Confirm your progress and draft were restored.

## Notes

Current plugin constraints:

- activation happens on `*.interview.md`
- code checking is heuristic, not sandboxed execution
- progress is local to the browser

This file is intended as a feature-discovery and smoke-test document.

---
title: TypeScript Interview Practice
interview:
  persistProgress: true
  showScore: true
---

# TypeScript Interview Practice

Use this sample page to verify the interview plugin end-to-end.

## Hidden Answer

```interview-question
What is the difference between `interface` and `type` in TypeScript?
---
answer:
`interface` is ideal for extensible object shapes and supports declaration merging.
`type` is more general and can represent unions, intersections, primitives, tuples, and mapped types.
hints:
- One of them supports declaration merging.
- One is commonly used to describe union types.
- Think about API contracts versus type composition.
```

## Multiple Choice

```interview-choice
Which statement about closures is correct?
---
options:
- A closure only exists inside async functions.
- A closure keeps access to variables from its lexical scope.
- A closure copies all outer variables by value when the function is created.
correct: 1
explanation:
Closures retain access to the lexical environment in which the function was created.
```

## Code Completion

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

---
title: Promise Concept Map Demo
techMemory:
  persistProgress: true
  defaultReveal: term
  showHierarchy: true
  showRelated: true
  enableRecallMode: true
  sectionTitle: Technical Memory
---

# Promise Concept Map Demo

This page is the markdown source equivalent of the standalone HTML demo.

It shows how the `techMemory` plugin could be authored as a normal markdown document with structured `concept-card` blocks.

The goal is to keep the source readable while still expressing:

- term hierarchy
- related concepts
- revealable summaries and details
- examples
- mnemonics
- recall prompts

## Why this format works

The page remains readable as markdown even before any plugin rendering happens.

That matters because authors should be able to:

1. review the file in raw form
2. edit it comfortably in any markdown editor
3. mix narrative explanation with structured memory cards

## Core concept

```concept-card
term: Promise
aliases:
- JavaScript Promise
- async result wrapper
parents:
- Asynchronous Programming
- Event Loop
children:
- Promise State
- Promise Chaining
related:
- async/await
- Microtask Queue
- Callback
summary:
A `Promise` is an object that represents the eventual completion or failure of an asynchronous operation.
details:
Promises improve readability and composition compared with deeply nested callbacks.

They let asynchronous work be chained, transformed, and handled consistently through success and failure branches.
example:
fetch('/api/data')
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error(error));
mnemonic:
Think of a Promise as a sealed envelope for a result that will be delivered later.
recall:
- What does a Promise represent?
- Why is it better than raw nested callbacks?
- Which concepts sit directly below it?
```

## Lifecycle

The lifecycle concepts are usually easier to memorize when split into small cards rather than explained in one large block.

```concept-card
term: Promise State
parents:
- Promise
children:
- Pending
- Fulfilled
- Rejected
related:
- Settlement
summary:
A Promise can be `pending`, `fulfilled`, or `rejected`.
details:
A Promise begins as pending and can transition only once to fulfilled or rejected.

After settlement, it cannot switch to another state later.
recall:
- Which state comes first?
- Can a fulfilled Promise become rejected later?
- What does settled mean?
```

```concept-card
term: Pending
parents:
- Promise State
related:
- Async Operation
summary:
Pending means the asynchronous operation has not finished yet.
details:
While pending, handlers may be attached, but no final value or error is available yet.
recall:
- What is available while a Promise is pending?
- When does pending end?
```

```concept-card
term: Fulfilled
parents:
- Promise State
related:
- Resolution Value
summary:
Fulfilled means the Promise completed successfully and produced a value.
details:
When fulfilled, success handlers such as `.then(...)` can receive the resolved value.
recall:
- Which handler receives a fulfilled value?
```

```concept-card
term: Rejected
parents:
- Promise State
related:
- Error Handling
summary:
Rejected means the Promise completed with an error or failure reason.
details:
When rejected, `.catch(...)` or rejection handlers can process the failure.
recall:
- Which handler typically processes a rejected Promise?
```

## Composition

```concept-card
term: Promise Chaining
parents:
- Promise
children:
- then
- catch
- finally
related:
- async/await
summary:
Promise chaining lets asynchronous operations be expressed as a readable sequence of transformations and handlers.
details:
Each `.then(...)` callback can return a value or another Promise.

Errors move down the chain until they are handled by a rejection handler.
example:
fetch('/api/user')
  .then(response => response.json())
  .then(user => user.profile)
  .catch(error => console.error(error));
recall:
- What can a `.then(...)` callback return?
- How do errors move through the chain?
- When might chaining be clearer than nested callbacks?
```

```concept-card
term: then
parents:
- Promise Chaining
related:
- Transformation
- Fulfilled
summary:
`.then(...)` registers a callback that runs after fulfillment.
details:
It can transform the previous value and return either a plain value or another Promise.
recall:
- What is the purpose of `.then(...)`?
- Why is returning another Promise useful?
```

```concept-card
term: catch
parents:
- Promise Chaining
related:
- Rejected
- Error Handling
summary:
`.catch(...)` registers a callback for handling rejection.
details:
It centralizes failure handling for errors produced earlier in the chain.
recall:
- Why is `.catch(...)` often placed near the end of a chain?
```

```concept-card
term: finally
parents:
- Promise Chaining
related:
- Cleanup
summary:
`.finally(...)` runs cleanup logic regardless of whether the Promise succeeds or fails.
details:
It is useful for hiding loading indicators, stopping spinners, or releasing resources.
recall:
- When should `.finally(...)` be used instead of `.then(...)` or `.catch(...)`?
```

## Related syntax

```concept-card
term: async/await
parents:
- Asynchronous Programming
related:
- Promise
- Promise Chaining
summary:
`async/await` is syntax built on top of Promises that makes asynchronous code read more like synchronous control flow.
details:
An `async` function always returns a Promise, and `await` pauses within that function until a Promise settles.
example:
async function loadUser() {
  const response = await fetch('/api/user');
  const user = await response.json();
  return user;
}
mnemonic:
Think of `async/await` as Promise syntax with a more sequential reading style.
recall:
- What does an `async` function return?
- What happens when `await` is used?
```

```concept-card
term: Microtask Queue
parents:
- Event Loop
related:
- Promise
- async/await
summary:
Promise callbacks are scheduled in the microtask queue rather than run immediately inline.
details:
This helps explain execution ordering between synchronous code, Promise handlers, and timers.
recall:
- Why do Promise callbacks run after synchronous code finishes?
- Which queue are Promise reactions scheduled into?
```

## Authoring Notes

This example shows that the markdown does get more structured, but it is still manageable because:

- each concept stays small and self-contained
- normal markdown can still explain broader context
- fenced blocks keep fields predictable
- hierarchy becomes explicit instead of buried in prose

For larger domains, the best approach is usually:

1. keep one page focused on one cluster of related concepts
2. use short cards instead of essay-sized cards
3. let parent/child/related fields carry the structure

## Questions to validate with the plugin UI

When this page is rendered by the plugin, verify that:

1. cards are easy to scan in collapsed mode
2. relationships are visually useful, not noisy
3. code blocks inside `example:` render well
4. recall mode still feels natural on longer pages
5. the markdown authoring cost stays acceptable

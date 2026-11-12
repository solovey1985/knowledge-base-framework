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

# Promises Concept Map

This sample page shows how a suffix-based `*.concept.md` page can present a technical concept as a set of linked memory cards rather than a linear explanation.

The page mixes normal markdown with `concept-card` blocks so the reader can learn in layers:

- term first
- summary next
- details and examples after recall
- parent, child, and related concepts as memory anchors

## Core Concept

```concept-card
term: Promise
aliases:
- JavaScript Promise
- Future-like async result
parents:
- Asynchronous Programming
- Event Loop
children:
- Promise State
- Promise Chaining
- Promise Error Handling
related:
- async/await
- Callback
- Microtask Queue
summary:
A `Promise` is an object that represents the eventual completion or failure of an asynchronous operation.
details:
Promises let asynchronous code be composed and sequenced more reliably than deeply nested callbacks.

They have a lifecycle and can carry either a fulfilled value or a rejection reason.
example:
`fetch('/api/data')` returns a Promise that eventually resolves with a response or rejects with an error.
mnemonic:
Think of a Promise as a sealed envelope for a result that will be delivered later.
recall:
- What does a Promise represent?
- Why is it better than raw nested callbacks?
- Which concepts sit directly below it?
```

## Lifecycle And State

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
A Promise can be pending, fulfilled, or rejected.
details:
The state starts as pending and can transition once to either fulfilled or rejected.

After settlement, the state cannot change again.
example:
A network request Promise stays pending while the request is in flight, then becomes fulfilled when data arrives or rejected if the request fails.
mnemonic:
Pending means waiting; fulfilled means success; rejected means failure.
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
During this phase, handlers may be attached, but no final value or error is available yet.
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
When fulfilled, `.then(...)` success handlers can receive the resolved value.
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
Promise chaining allows sequential asynchronous operations to be expressed as a readable pipeline.
details:
Each `.then(...)` can transform the previous result and return either a value or another Promise.

Errors propagate through the chain until they are handled.
example:
`fetch(...).then(r => r.json()).then(data => data.items)`
mnemonic:
Each `.then` hands the next step either a value or a new Promise.
recall:
- What can a `.then(...)` callback return?
- How do errors move through the chain?
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
It can also return a transformed value or another Promise, enabling composition.
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
It centralizes error handling for failures produced earlier in the chain.
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
`.finally(...)` runs cleanup logic regardless of success or failure.
details:
It is useful for things like hiding loading indicators or releasing resources.
recall:
- When should `.finally(...)` be used instead of `.then(...)` or `.catch(...)`?
```

## Related Concepts

```concept-card
term: async/await
parents:
- Asynchronous Programming
related:
- Promise
- Promise Chaining
summary:
`async/await` is syntax built on top of Promises that makes asynchronous code look more sequential.
details:
An `async` function returns a Promise, and `await` pauses within that function until a Promise settles.
example:
`const data = await fetch('/api').then(r => r.json())`
mnemonic:
`async/await` is Promise syntax with a more synchronous reading style.
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

## Notes For Authors

This sample suggests a good writing pattern for `techMemory` pages:

1. start with the main concept
2. split its lifecycle and child concepts into smaller cards
3. add neighboring concepts that are easy to confuse or naturally associated
4. keep each card short enough for recall practice

This makes the page useful both for first-time learning and repeated memorization.

# Pure Functions (`effects=pure`)

> **Status: spec / proposal.** This document defines the semantics for a not-yet-implemented prop. Slice 6 will land the parser/schema/codegen/importer/tests for it. Refer to this doc when reviewing the implementation PR — divergences are bugs in the implementation, not the spec.

Add `effects=pure` to a function-emitting node (`fn`, `derive`, `memo`) to declare that the body has no observable side effects: deterministic in its inputs, no I/O, no mutation of caller-visible state. The codegen rejects bodies that violate the contract at compile time. The annotation does not change the emitted code shape — it is a guarded contract, not a transformation.

## The problem `effects=pure` solves

KERN currently has no way for a function to declare its side-effect profile. Reviewers and downstream tools (`kern review`, `kern test`) can only infer purity from the body, which is fragile across imports and noisy across edits. The result is that:

- A pure-by-construction `fn` and a network-calling `fn` look identical in source.
- `kern review` rules against side effects fire heuristically and produce false positives on hand-rolled pure helpers.
- Memoization decisions (in `derive` / `memo`) are made by the user with no compile-time check that the body actually qualifies.

`effects=pure` makes the contract explicit: the user declares it, and the compiler enforces it.

## Syntax

```kern
fn name=clamp params="value:number,min:number,max:number" returns=number effects=pure
  handler <<<
    return Math.max(min, Math.min(max, value));
  >>>

derive name=visibleItems deps="items, filter" effects=pure
  expr={{ items.filter(it => it.kind === filter) }}

memo name=normalized deps="raw" effects=pure
  handler <<<
    return raw.trim().toLowerCase();
  >>>
```

Only the literal value `pure` is accepted in slice 6. `effects=...` with any other value is a compile-time error. (See **Future extensions** for what other values may mean later.)

## What `effects=pure` forbids

The body must be **deterministic** in its inputs and produce **no observable effect**. The codegen rejects the body if it contains any of:

**I/O calls**
- `fetch(`, `XMLHttpRequest`, network/HTTP client method calls (axios, got, ky, undici)
- `console.*`, `process.stdout.*`, `process.stderr.*`
- File system access: `readFileSync`, `writeFileSync`, `fs.promises.*`, `require('fs').*`
- `localStorage`, `sessionStorage`, `indexedDB`
- `document.*`, `window.*` (anything beyond `globalThis`-safe constants)

**Time / randomness**
- `Math.random`
- `Date.now`, `Date.now()`, `new Date()` with no args
- `crypto.randomUUID`, `crypto.getRandomValues`
- `performance.now`

**Async / scheduling**
- `await` keyword anywhere
- `.then(`, `.catch(`, `.finally(`
- `setTimeout`, `setInterval`, `setImmediate`, `queueMicrotask`
- `requestAnimationFrame`, `requestIdleCallback`

**State mutation**
- React-style state setters: `setX(`, `dispatch(`, `bump${Name}()`
- Direct assignment to module-scope `let` bindings or globals
- Reassignment of any free variable not declared in the body

The list is closed for slice 6 — additions follow a roadmap PR with the same review bar as a new node type.

## What is allowed

- Reading immutable inputs (params, captured `const` bindings)
- Calling other `effects=pure` KERN functions in the same compilation unit
- Local mutation: creating and mutating fresh objects/arrays before returning them
- Recursion (direct and indirect)
- `throw` — errors are values in KERN's effect model. Slice 4's `Result` / `Option` will refine this; until then, `throw` from a pure function is fine and does not break purity.
- Reading module-scope `const` declarations (not `let`)
- `Math.*` other than `random` (`Math.max`, `Math.floor`, …)
- `JSON.parse`, `JSON.stringify`, `String`, `Number`, `Boolean`, `Array.from`, etc.

## Where `effects=pure` can be used

| Node | Slice 6 status | Why |
|---|---|---|
| `fn` | supported | Primary use case. Standalone helpers most often want this contract. |
| `derive` | supported | Already required to be pure-ish for memoization correctness. The annotation makes the requirement explicit and checked. |
| `memo` | supported | Same reason as `derive`. |
| `method` | rejected (v1) | A method's body can read mutable `this.*` fields, which the body inspector cannot statically prove pure. Express the pure formula as a `fn` taking the value explicitly. |
| `handler` | rejected | A `handler` is the body of an effect-bearing parent (`on`, `route`, `transition`). Marking the handler pure is a category error — if the body is pure, lift it into a `fn` and call from the handler. |
| `transition`, `action`, `route`, `on` | rejected | These nodes exist to carry effects. Annotation is meaningless. |

Codegen rejects `effects=pure` on any node not in the supported list with a clear message naming the node type.

## Interaction with other props

`effects=pure` combined with any of the following is a hard rejection at compile time:

- `async=true` — async functions are not pure (they yield to the scheduler and typically perform I/O). Drop one.
- `stream=true` — streams are effects.
- `safe=false`, `throttle=N`, `debounce=N` (on `state` / setter-bearing contexts) — these are setter-side concerns and have no meaning on a pure formula.

Each rejection signals a misunderstanding of what `effects=pure` means and is enforced rather than silently ignored.

## How the check works

A static walker over the handler / expr body flags any **rejected identifier** or **rejected member-call pattern** from the lists above. The walker is the same shape as the `batch=true` async-rejection pass — a regex-with-AST-anchors scan, not a full type-flow analysis.

This means the check is **scoped to syntactic constructs the walker recognises**. Specifically:

- A bare call to `fetch(` is rejected. A call through an alias (`const f = fetch; f(...)`) is **not** rejected.
- Calling an external library function that performs I/O is **not** rejected — the walker has no cross-module visibility.
- Calling another KERN `fn` is allowed regardless of that fn's purity unless the called fn is **also** marked `effects=pure` AND in the same compilation unit (forward-checked transitively).

These limits are documented, not bugs — see **Limitations**.

## Why declared, not inferred

Inference across imports and aliases is fragile. A heuristic that flags 95% of impure functions still produces enough false positives to train users to ignore the warning, and enough false negatives to undermine the contract. `effects=pure` flips the burden: the user declares the contract explicitly, the compiler validates the declaration. False positives become "the walker rejects valid code" (a fixable bug); false negatives become "the user lied about purity" (a code review issue, not a tooling one).

## Limitations

- **Static walker, not flow analysis.** Aliasing through locals, dynamic property access, computed member calls, and any I/O reached via an unmarked import are uncheckable. The annotation's strength is proportional to how directly the body uses rejected identifiers.
- **Argument mutation is undetectable.** The walker can reject `Math.random` but cannot tell whether `items.push(x)` mutates a parameter, a captured local, or a fresh local. Convention: never mutate parameters or closures from a pure body. Future versions may add a runtime dev-only freeze pass.
- **Cross-fn purity check is single-compilation-unit.** A pure `fn` calling another pure `fn` declared in a different `.kern` file gets no transitive check. The annotation's contract-y nature still holds — both authors took the oath — but the compiler enforces only what it can see.
- **No "almost pure" escape hatch.** v1 is binary: pass the walker or be rejected. There is no `effects=pure ignore=time` style override. If you need to make an exception, the function is not pure; either fix the body or drop the annotation.
- **Target-target portability.** The check is a single static walk, target-independent. The emitted code is unchanged on every target. FastAPI / Vue / etc. emit the same body they would without the annotation. The annotation is metadata on the IR, not a codegen mode.

## Future extensions (out of scope for slice 6)

Flagged here so the slice 6 implementation does not accidentally box them out:

- `effects="throws"` — function may throw but is otherwise pure. Useful for `Result`-style code (slice 4).
- `effects="reads:state"` — function reads but does not write a named state.
- `effects="writes:counter"` — function writes a specific named external state.
- A **separate** `effect` node (already in roadmap Phase 3.3) is a heavyweight, declarative effect description with `trigger` / `recover` / `cleanup` children. `effects=pure` is the lightweight inline annotation; the two coexist and are not in conflict.

The slice 6 prop value parser must be a string-list reader, not a boolean reader, so the value can grow from `pure` to `pure|throws` without a parser change. (`effects=pure,throws` is the expected form.) Slice 6 only accepts the single literal `pure`; anything else errors.

## Why a single string prop, not multiple booleans

`pure=true` would have been the obvious shape, but it boxes out the future extensions above. A `effects=...` string-list is the right shape on day one even if day-one only accepts `pure`.

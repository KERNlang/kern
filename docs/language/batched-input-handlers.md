# Batched Input Handlers

Add `batch=true` to an `on event=key` (or `on event=input`) node to collapse all of its setter calls into a single Ink paint cycle. This is the surgical opt-out from `__inkSafe`'s per-setter macrotask deferral, for handlers that only update state and want one render per keystroke instead of N.

## The problem `batch=true` solves

KERN's Ink target wraps every `safe=true` state setter (the default) in `__inkSafe`, which forces each setter call into its own `setTimeout(..., 0)` macrotask. The wrapper exists because Ink's render pipeline drops state updates made inside microtasks — the same reason Agon's CLI keeps a `yieldToInk` helper that calls `setImmediate(resolve)` before mutating state.

The cost: a handler that calls two setters in a row produces **two macrotasks → two React batches → two renders per keystroke**. React 18's automatic batching does not collapse these because each macrotask is a separate task boundary by design.

`batch=true` changes the codegen so the entire handler body shares one macrotask:

- Before: every `setX(...)` call queues its own `setTimeout` via `__inkSafe`
- After: one outer `setTimeout(() => { _setXRaw(...); _setYRaw(...); ... }, 0)` runs all of them inside one Ink paint cycle, calling the **raw** setters so the wrappers do not re-defer

## Syntax

```kern
screen name=Editor
  state name=cursor initial=0
  state name=mode initial="view"
  state name=selection initial=""

  on event=key key=return batch=true
    handler <<<
      setCursor(0);
      setMode("edit");
      setSelection("");
    >>>

  text value="cursor: {cursor}"
```

The `batch=true` prop sits on the `on` node, not on `handler`. The whole handler body is treated as one batched macrotask. The user keeps writing ordinary `setCursor`/`setMode`/`setSelection` calls — codegen rewrites them to the raw forms.

## What gets rewritten

The codegen knows the names of every safe state setter in the screen. Inside a `batch=true` handler, every `setX(` call against a known safe state is rewritten to `_setXRaw(`. State that is **not** rewritten (kept as the original setter):

- States declared with `safe=false` — their setter is already the bare `useState` setter, no wrapper to bypass
- States with `throttle=N` or `debounce=N` — their setters have their own scheduling, and re-routing them to the raw form would lose the throttle/debounce behavior

Other identifiers (functions, locals, anything not matching a known setter pattern) are left alone.

## Example: before and after

KERN source:

```kern
screen name=Counter
  state name=count initial=0
  state name=tick initial=0
  on event=key key=return batch=true
    handler <<<
      setCount(count + 1);
      setTick(Date.now());
    >>>
  text value="count: {count}"
```

Compiled (without `batch=true`):

```ts
_inputHandlerRef.current = (input, key) => {
  if (!(key.return)) return;
  setCount(count + 1);  // → setTimeout(() => _setCountRaw(count + 1), 0)
  setTick(Date.now());  // → setTimeout(() => _setTickRaw(Date.now()), 0)
};
// → 2 macrotasks → 2 Ink paint cycles → 2 renders per keystroke
```

Compiled (with `batch=true`):

```ts
_inputHandlerRef.current = (input, key) => {
  if (!(key.return)) return;
  setTimeout(() => {
    _setCountRaw(count + 1);
    _setTickRaw(Date.now());
  }, 0);
};
// → 1 macrotask → 1 Ink paint cycle → 1 render per keystroke
```

## When to use it

Use `batch=true` when **the entire handler body is a sequence of state updates** and you want a single render. Typical cases:

- Keystroke handlers that update multiple cursor/selection/mode states at once
- Submit handlers that reset several form fields together
- Mode-switch handlers that flip multiple flags

## When not to use it

- **The handler does anything that depends on the previous state being committed.** All setters in a batch run inside the same React tick, so reading `count` between two `setCount` calls still sees the original value, just like any sync setState batch.
- **The handler needs to await something or schedule deferred work.** This is enforced — see below.
- **You want the existing per-setter deferral semantics for some specific reason** — e.g., you are deliberately relying on each `setX` triggering its own paint as a checkpoint. Rare, but if it applies, do not turn `batch=true` on.

## Hard rejection: async / deferred constructs in a batched handler

The codegen will throw at compile time if a `batch=true` handler body contains any of:

- `setTimeout(...)`
- `setInterval(...)`
- `setImmediate(...)`
- `queueMicrotask(...)`
- `await` (anywhere)
- `.then(...)`

Why: the whole point of `batch=true` is to collapse N synchronous setter calls into one shared macrotask. If the body defers work into a nested timer or promise, the inner setter calls land in their own task **after** the batch's `setTimeout` has already flushed — with no `__inkSafe` wrapper to bridge them. That is exactly the missed-repaint failure mode `__inkSafe` exists to prevent. Better to refuse the batch at compile time than to ship code that silently regresses on a subset of paths.

If you need a handler that mixes synchronous batched updates with deferred work, split it into two on-nodes: one batched, one not.

## Limitations

- **Text-based rewrite (with member-access guard).** The codegen rewrite is a regex substitution with a negative lookbehind, not a TypeScript AST pass. It only rewrites bare setter calls — `setCount(1)` is rewritten, but `form.setCount(1)`, `obj?.setCount(1)`, and any setter preceded by a word character are left alone. The one remaining edge case: a setter name appearing as a bare call inside a string literal will still be rewritten. Avoid `<<< console.log("setCount called"); >>>` inside a batched handler — the `setCount` substring inside the string will become `_setCountRaw`. Use single-line comments or rename the string content if you need to mention a setter name verbatim.
- **Synchronous body only — enforced.** See the rejection list above.
- **Per-handler granularity.** `batch=true` is all-or-nothing for the on-node it sits on. There is no `batch { … }` sub-block — that may come later if real use cases need it.

## Why a prop, not a `batch { … }` block

The block form would require new parser keywords and a new IR node type. The prop form requires zero parser changes — `batch` is just another prop on the existing `on` node, and the codegen handles the rewrite. The block form would be more flexible (mixing batched and non-batched code in one handler), but it is not yet justified by a real use case. Most batched handlers in practice are "the whole thing is setters" — exactly what the prop form covers.

If you need finer control later, the block form can be added on top without breaking the prop form.

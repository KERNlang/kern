# `?` and `!` propagation operators (slice 7)

> **Status: spec / proposal.** This document defines the semantics for slice 7 — the `?` and `!` postfix operators that propagate `Result` and `Option` failure cases up the call stack. The implementation lands in a follow-up commit. Refer to this doc when reviewing the implementation PR — divergences are bugs in the implementation, not the spec.

KERN gets postfix `?` and `!` operators for ergonomic error propagation. They are the "happy path" sugar for Result and Option returns: `?` early-returns the err/none, `!` throws on err/none. The shape that ships in slice 7 is the minimum the slice 4 type aliases promised, with no surprise semantics.

## The model — postfix operator on Result/Option-typed expressions

Any expression in a handler body whose evaluated type is `Result<T, E>` or `Option<T>` may be suffixed with `?` or `!`. The operator inspects the discriminant tag and either:

- `expr?` — short-circuits the enclosing function. If the value is `err` / `none`, control returns from the function with that same value. Otherwise the expression evaluates to the inner `T`.
- `expr!` — panics on the failure case. If the value is `err` / `none`, throws a `KernUnwrapError` carrying the original err/none value. Otherwise evaluates to the inner `T`.

Slice 7 uses the same kind-tagged shape that slice 4 already pinned: every Result/Option value (compact-form or explicit `union name=R kind=result …`) carries `kind: 'ok'|'err'|'some'|'none'`, so the operator lowering is target-uniform.

## Authoring forms

The operators live inside handler bodies. Both forms are accepted:

**Postfix `?` — early-return:**

```kern
fn name=parseAndStore params="raw:string" returns="Result<User, AppError>"
  handler <<<
    const parsed = parseUser(raw)?;     // returns Result.err(...) on failure
    const stored = storeUser(parsed)?;  // ditto
    return Result.ok(stored);
  >>>
```

**Postfix `!` — panic:**

```kern
fn name=mustParse params="raw:string" returns=User
  handler <<<
    const parsed = parseUser(raw)!;     // throws KernUnwrapError on failure
    return parsed;
  >>>
```

The operators bind tighter than function-call arguments — `foo(parseUser(raw)?)` is allowed and lowers to a temporary inserted before the call.

## Codegen per target

| Target | `expr?` lowering | `expr!` lowering |
|---|---|---|
| **TypeScript** (lib, web, nextjs, native, terminal, mcp, express) | `const _t = expr; if (_t.kind === 'err' \|\| _t.kind === 'none') return _t; const _v = _t.value;` (binding emitted at the original use site) | `const _t = expr; if (_t.kind === 'err' \|\| _t.kind === 'none') throw new KernUnwrapError(_t); const _v = _t.value;` |
| **Python** (fastapi) | Equivalent `if _t.kind in {'err','none'}: return _t` followed by `_v = _t.value` | `raise KernUnwrapError(_t)` instead of `return` |
| **Vue** | Same as TS | — |

The `_t` and `_v` binding names are gensyms; the actual emit uses `__kern_t<N>` / `__kern_v<N>` with a counter scoped to the enclosing function so nested operators don't collide.

`KernUnwrapError` is a small vendored class (≤10 LoC) added to the slice 4 stdlib preamble when at least one `!` is detected:

```ts
class KernUnwrapError<T> extends Error {
  constructor(public readonly cause: T) {
    super(`KernUnwrapError: unwrap on ${(cause as { kind: string }).kind}`);
    this.name = 'KernUnwrapError';
  }
}
```

## Type-checking — function return must be Result/Option

`?` only compiles inside a function whose return type is `Result<T, E>` or `Option<T>`. The validator checks:

1. The enclosing `fn` / `method` node has `returns="Result<…>"` or `returns="Option<…>"` (compact or explicit form).
2. The expression to which `?` is applied resolves to a Result/Option value. (Slice 7 v1 trusts the user; deeper inference lands in slice 8.)
3. The result-type of `?` matches the unwrapped form (`T`).

Mismatched types emit `INVALID_PROPAGATION` diagnostics:

- `?` on a non-Result/Option expression → `INVALID_PROPAGATION: \`?\` requires a Result<T,E> or Option<T> expression`
- `?` inside a function whose return type isn't Result/Option → `INVALID_PROPAGATION: containing fn must return Result<T,E> or Option<T> for \`?\` to propagate`
- Mixing Result and Option (e.g. `Option<User>` value `?`-propagated inside a `Result<X, Y>` function) → `INVALID_PROPAGATION: cannot propagate Option<T> into a Result<U,E> function`

The third rule is conservative — slice 7 v1 keeps the error and value shapes matched. A future slice may add automatic conversion (`Option<T>` → `Result<T, NoneError>`) if real usage demands it.

`!` has no return-type requirement — it always panics on failure. The only check is that the expression resolves to Result/Option.

## Match interaction (slice 5 hook)

Once slice 5 lands native `match`, propagation operators and match are interchangeable for Result/Option destructuring:

```kern
# Equivalent shapes
handler <<<
  const u = parseUser(raw)?;
  return Result.ok(transform(u));
>>>

# vs
match parseUser(raw)
  on kind=ok    handler <<< return Result.ok(transform(result.value)); >>>
  on kind=err   handler <<< return result; >>>
```

`?` is the ergonomic shorthand; `match` is the explicit shape. Both lower to the same TS.

## Why postfix-string rewriting (and not a new kern node)

The brainstorm's hardest call: should `?` / `!` be a new kern IR node (`propagate name=user value={{ parseUser(raw) }}`), or string-level rewrites of the handler body?

Answer: **string-level rewrite at handler-body emission time.** Reasons:

- **Ergonomics.** The whole point of `?` is to disappear from the source. A user who has to write `propagate name=u value={{ … }}` is back to verbose. The slice 4 spec already chose helper-function ergonomics over new IR nodes for the same reason.
- **Implementation cost.** A new IR node means schema + parser + validator + codegen × N targets. A string rewrite is one pre-pass in `handlerCode` shared by every target.
- **Slice 4 alignment.** Slice 4's compact form (`returns="Result<…>"`) is also a string-level recognition pass. The same precedent.
- **Detection precision.** The rewrite is anchored by `\bExpr\?\s*[;,)]` patterns inside handler bodies; the slice 6 effects walker shows the same regex-on-stripped-source approach is reliable when comments and string literals are pre-stripped.

The OpenCode-style "every operator is its own node" pitch was the most first-class but failed the slice budget. Per-buddy verdicts will pin the call before implementation.

## Validation

Three new diagnostics ship with slice 7:

- `INVALID_PROPAGATION` (described above) — three rules.
- `UNWRAP_OUTSIDE_TRY` — `expr!` is allowed anywhere, but a warning surfaces if `!` appears in a function whose `returns` is `Result<…>` (suggests using `?` instead, since `!` discards the rich error shape).
- `NESTED_PROPAGATION` — `parseUser(raw)??` (double `?`) is rejected; chains require explicit `let` bindings.

## Limitations

- **No expression-level lowering before slice 5.** The `?` is statement-level — it must appear in a position where an early `return` is legal. Mid-expression usage (`array.map(x => parse(x)?)`) doesn't propagate out of the `.map` callback; slice 7 v1 emits a diagnostic. Slice 5's native `match` provides the expression-level fallback.
- **No `KernUnwrapError` typing on TS.** The thrown error's `cause` field is typed as `unknown` from the catch site's perspective; recovering the original err shape needs an explicit `instanceof KernUnwrapError` + cast. Acceptable for v1 — `!` is an escape hatch, not the happy path.
- **No async lowering.** `await parseUser(raw)?` is rejected by slice 7 v1 — the `await` and `?` interact in non-obvious ways (which one short-circuits first?). Slice 8 may add `await?` as a fused operator.
- **No `Option` → `Result` autoconversion.** Mixing types is a hard error; the user must explicitly bridge with `match` or a helper.

## Future extensions (out of scope for slice 7)

Flagged here so the slice 7 implementation does not box them out:

- **Expression-level propagation** via slice 5 `match` desugar.
- **`await?` / `await!`** fused operators for `Promise<Result<T,E>>`.
- **`?` on custom types** beyond Result/Option — would require a kind hint on user-defined unions.
- **Recoverable panics** — `!` could carry stack trace + source location for better debugging.
- **Linting `unwrapOr` over `!`** — when the panic value is statically known to be an `err`, suggest the safer combinator.

# Result and Option (`union kind=result|option` + stdlib helpers)

> **Status: spec / proposal.** This document defines the semantics for slice 4 — `Result<T,E>` and `Option<T>` built-ins. The implementation lands in a follow-up commit. Refer to this doc when reviewing the implementation PR — divergences are bugs in the implementation, not the spec.

KERN gets first-class `Result<T,E>` and `Option<T>` types as the foundation for explicit, value-level error handling. The shape that ships in slice 4 is the minimum hook slice 7 (`?` / `!` propagation operators) needs, plus a stdlib of pure helpers that work on every TypeScript-targeting backend.

## The model — two parallel layers

The design splits cleanly into two layers so each can evolve independently:

**Layer 1 — Type-level: extended `union` node with a `kind` prop.**
Existing `union name=Shape ...` stays exactly the same. `union name=R kind=result ...` and `union name=O kind=option ...` are recognised by the codegen as Result-shaped and Option-shaped, allowing target-specific optimisation (Python `Optional[T]`, FastAPI Pydantic-compatible wrappers, slice 7 propagation lowering). The default `kind` is "data" — a regular discriminated union, identical to today's behaviour.

**Layer 2 — Value-level: vendored stdlib helpers.**
Constructors (`ok`, `err`, `some`, `none`) and combinators (`map`, `mapErr`, `andThen`, `unwrapOr`, `isOk`, `isErr`, `isSome`, `isNone`) are pure helper functions exported from a vendored module. The codegen auto-imports them when a Result/Option type is referenced. They are NOT new IR node types — see "Why helpers, not new IR nodes" below.

This split is the entire design. Everything else falls out of it.

## Authoring forms

The reserved type names `Result<T,E>` and `Option<T>` desugar to a `union` node with the appropriate `kind` and standard variant children. Both forms are supported:

**Compact (preferred — uses the reserved type names):**

```kern
fn name=parseUser params="raw:string" returns="Result<User, ParseError>"
  handler <<<
    if (!raw) return err({ code: "EMPTY" });
    return ok(JSON.parse(raw));
  >>>
```

**Explicit (the `union` node form the compact shape desugars to):**

```kern
union name=ParseUserResult kind=result
  variant name=ok
    field name=value type=User
  variant name=err
    field name=error type=ParseError

fn name=parseUser params="raw:string" returns=ParseUserResult
  handler <<<
    ...
  >>>
```

Both forms emit identical TypeScript. The compact form is what 95% of code will use; the explicit form is for codebases that want named result types in their public API surface.

## Codegen per target

| Target | `Option<T>` | `Result<T,E>` |
|---|---|---|
| **TypeScript** (lib, web, nextjs, native, terminal, mcp, express) | Discriminated union: `\| { kind: 'some'; value: T } \| { kind: 'none' }` | Discriminated union: `\| { kind: 'ok'; value: T } \| { kind: 'err'; error: E }` |
| **Python** (fastapi) | Frozen dataclass `Option[T]` with `Some` / `None_` subclasses (NOT `Optional[T]` — see below) | Frozen dataclass `Result[T, E]` with `Ok` / `Err` subclasses |
| **Vue** | TypeScript-equivalent — Vue's script-setup blocks consume the same TS DUs | Same |

The Python wrapper is a **deliberate choice over `Optional[T]`**. Rationale (Codex review consensus):

- `Optional[T]` collapses `Some(None)` into `None` — losing the round-trip distinction the IR carries
- Pydantic deserialises `Optional[T]` differently from `Union[Some[T], None_]`, breaking FastAPI body validation for nested Result/Option fields
- Slice 7's propagation operators need a uniform "is this `Err` / `None`?" check across targets — `Optional[T]` forces a target-specific lowering that breaks the contract

The Python wrapper is small (≤30 LoC vendored) and gives every target the same abstract shape.

## Stdlib helpers

Eight functions ship in slice 4. All pure, all `effects=pure`-compatible:

```kern
# Constructors
ok(value)        # → { kind: 'ok',   value }
err(error)       # → { kind: 'err',  error }
some(value)      # → { kind: 'some', value }
none()           # → { kind: 'none' }

# Predicates
isOk(result)     # → boolean
isErr(result)    # → boolean
isSome(option)   # → boolean
isNone(option)   # → boolean

# Combinators
map(f, result | option)            # Result<T,E> + (T → U)  → Result<U,E>
mapErr(f, result)                  # Result<T,E> + (E → F)  → Result<T,F>
andThen(f, result | option)        # monadic flatMap
unwrapOr(default, result | option) # value or default
```

`unwrap` and `expect` are **deferred to slice 7**. They throw on `err` / `none`, which means they participate in the propagation-operator design — putting them in slice 4 risks locking in the wrong throw semantics before `?` / `!` exist.

## Match interaction (slice 5 hook)

Slice 5 introduces native `match`. The `kind` discriminant on Result/Option unions is `'kind'` (matching the existing union convention), so:

```kern
match result
  on kind=ok    handler <<< doSomething(result.value)   >>>
  on kind=err   handler <<< logError(result.error)      >>>

match option
  on kind=some  handler <<< render(option.value)        >>>
  on kind=none  handler <<< renderEmpty()               >>>
```

The match arms reference the variant name (`ok` / `err` / `some` / `none`) as a string discriminant value, NOT as a constructor identifier. This avoids the parser collision Codex flagged in the brainstorm: `ok` and `err` are helper functions in expression position; `kind=ok` is a string literal in match position. The two contexts never overlap.

## Slice 7 hook (`?` and `!` propagation)

`?` and `!` are deferred to slice 7. Slice 4 makes them implementable cleanly because:

1. `?` lowering inspects the `union.kind` of the function return type. If `kind=result` or `kind=option`, the operator desugars to early-return the err/none case.
2. The lowering is target-uniform — every target's discriminated union has the same kind-tagged shape, so the desugar works identically on TS, Python, and any future target.
3. No runtime metadata needed: the kind hint lives in the IR, not the emitted code.

This is the load-bearing reason for the `kind` prop. Without it, slice 7 has to fall back to identifier-name heuristics or runtime `instanceof` checks — fragile and target-dependent.

## Why helpers, not new IR nodes (the slice 5 disambiguation)

The brainstorm's hardest call: should `ok` / `err` / `some` / `none` be new IR node types?

Answer: **no, they are helper functions.** Reasons:

- **Slice 5 collision.** `match { ok: ..., err: ... }` is the canonical match shape. If `ok` is a new IR node type, the parser has to disambiguate constructor calls from match arm labels. Helper functions live in expression position and never appear bare; match arms use `kind=ok` strings. No ambiguity.
- **Implementation cost.** New node types means schema entries, parser rules, codegen × 5+ targets, importer round-tripping, capability-matrix updates. Helpers are a single vendored module per target.
- **Promotion path stays open.** If a future slice needs first-class constructor nodes, the `union.kind` hook is already there — promotion is mechanical.

OpenCode's "new nodes" pitch was the most first-class option but didn't fit the slice budget. Gemini's "extend union with kind" was the right type-level call. Codex's "helper functions" was the right value-level call. The hybrid takes both.

## Validation

Three new schema rules ship with the kind prop:

- `union kind=result` MUST have exactly two variants named `ok` and `err`. Other variant counts or names are a `KIND_SHAPE_VIOLATION` diagnostic.
- `union kind=option` MUST have exactly two variants named `some` and `none`.
- `kind` accepts only `result` / `option` / unspecified. Other values (`union kind=foo`) error with `INVALID_UNION_KIND`.

The first two rules are what make the helpers safe — `map(f, x)` can rely on `x.kind === 'ok'` and `x.value` because the schema enforces the shape.

## Limitations

- **No exhaustiveness checking in slice 4.** A `match` over a Result that misses `err` won't be flagged until slice 5 lands native match. Until then, it's an author convention.
- **No nested Result-of-Result optimisation.** `Result<Result<T,E1>,E2>` is allowed but emits the obvious nested DU — flatten via `andThen` if you want the chained shape.
- **No async variants.** `AsyncResult<T,E>` (Result-flavoured Promise) is out of scope. Combine with `async=true` on the function and let the caller await; the result is `Promise<Result<T,E>>` which composes cleanly.
- **No FastAPI-specific response policy.** A route returning `Result<User, NotFoundError>` does NOT auto-emit a 404 on `err`. That's slice 8 (route-level error policy) — slice 4 just gives the type.

## Future extensions (out of scope for slice 4)

Flagged here so the slice 4 implementation does not box them out:

- **First-class `result` / `option` IR node types.** If real usage shows the `union kind=...` ergonomics are clumsy, promote to dedicated node types. The `kind` prop becomes a hint that the parser uses to route into the dedicated nodes.
- **`unwrap` / `expect` helpers.** Wait for slice 7 to define throw semantics first.
- **Pattern destructuring** (`if let Ok(x) = result`). Wait for slice 5 native match to land the pattern infrastructure.
- **Custom error chains** (`E1 | E2 | E3` as the err side). Today the err type is a single type; chained errors are user-defined.
- **`Either<L,R>`** as an alternative biased shape. Result has the success/failure asymmetry baked in; Either is symmetric. If a real use case shows up, separate slice.

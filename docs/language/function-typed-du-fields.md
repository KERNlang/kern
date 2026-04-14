# Function-Typed Discriminated Union Fields

KERN's `union` / `variant` / `field` nodes already support function-typed fields on **TypeScript-targeting codegen** (`lib`, `web`, `nextjs`, `tailwind`, `native`, `terminal`, `express`, `mcp`). You can model callbacks, resolvers, handlers, and async continuation functions inside a discriminated union without dropping to hand-written TypeScript.

This page exists because the pattern is not obvious from the examples and was assumed impossible in external feedback. It is not.

> **Portability note.** Other targets (`fastapi`, `vue`) pass the quoted type string through their own emitters. The FastAPI backend's `mapTsTypeToPython` is a literal pass-through, so a TypeScript function signature will emit as invalid Python. Only use this pattern in KERN files you intend to compile to TypeScript targets.

## The pattern

Wrap the function type in double quotes on the `type=` prop of a `field` node. The parser tokenizes the quoted value as a single string and the codegen emits it verbatim as the TypeScript type annotation.

```kern
union name=DialogState discriminant=kind
  variant name=closed
  variant name=open
    field name=title type=string
    field name=resolve type="(answer: string) => void"
    field name=onCancel type="() => void" optional=true
```

Compiles to:

```typescript
export type DialogState =
  | { kind: 'closed' }
  | { kind: 'open'; title: string; resolve: (answer: string) => void; onCancel?: () => void };
```

The discriminator (`kind`) is controlled by `discriminant=` on the union and the `name=` on each variant becomes its tag literal. Optional fields use `optional=true`.

## What works

- Multi-argument functions: `type="(a: string, b: number) => boolean"`
- Return types that reference named types: `type="() => Promise<User>"`
- Higher-order functions: `type="(cb: (x: number) => void) => () => void"`
- Recursive references to the parent union: `type="() => Promise<DialogState>"`
- Object literal types inside the signature: `type="(ctx: { id: string; flags: number }) => void"`
- Union returns and parameters: `type="(input: string | number) => string"`

> **Limitation.** KERN's `union` node currently has no generic parameter syntax — `generateUnion()` always emits `type Name =` with no `<T>`. If you want a polymorphic union, you either reference a concrete named type (see the next example) or write the union in hand-maintained TypeScript and re-export it from a KERN module.

The `emitTypeAnnotation` helper at `packages/core/src/codegen/emitters.ts:63` validates bracket balance (`<>`, `()`, `[]`, `{}`) and rejects a small set of unsafe constructs (template interpolation, dynamic `import()`, comments, top-level semicolons). Anything else that TypeScript itself accepts will pass through unchanged.

## What does not work

- Backticks in the type string — rejected to prevent template-literal escape hatches
- `${...}` interpolation — rejected for the same reason
- Top-level `;` — rejected as statement injection; semicolons are allowed inside `{}` for object type members
- `import(…)` expressions in type positions — rejected
- `//` or `/* */` comments inside the type string — rejected

All of these fail with a `KernCodegenError` at compile time with a clear message, not at TypeScript parse time.

## Worked example — async result with a concrete named type

```kern
union name=AsyncUserResult discriminant=state
  variant name=idle
  variant name=loading
    field name=cancel type="() => void"
  variant name=success
    field name=value type=User
    field name=onAck type="(value: User, retries: number) => Promise<void>"
  variant name=failure
    field name=error type="Error"
    field name=retry type="() => Promise<AsyncUserResult>"
```

Compiles to:

```typescript
export type AsyncUserResult =
  | { state: 'idle' }
  | { state: 'loading'; cancel: () => void }
  | { state: 'success'; value: User; onAck: (value: User, retries: number) => Promise<void> }
  | { state: 'failure'; error: Error; retry: () => Promise<AsyncUserResult> };
```

The recursive `AsyncUserResult` reference inside the `retry` callback works because the type annotation is a pass-through string — the codegen does not try to resolve it against KERN's symbol table, which is what would otherwise block self-referential callback signatures. `User` is expected to be declared elsewhere (an `interface` node or an imported type).

## Why quote the type

Without quotes, the parser treats whitespace and `=` as token boundaries. `(answer: string) => void` would be tokenized as five separate tokens and the `field` node would end up with a broken `type` prop. The quoted form is the single escape hatch that lets an entire TypeScript type expression live inside one `field` prop.

## When to use this vs. a handler

If the function you are modelling is **part of the data shape** — an inert callback that gets held by the value until it is invoked elsewhere — a function-typed field is the right tool. Examples: promise resolvers held in a dialog state, onAck callbacks in an async pipeline, cleanup hooks.

If the function is **logic that runs during a state transition** — something that reads and writes state, performs side effects, or encodes business rules — use a `handler` child node instead. Handlers are first-class KERN IR and participate in the compiler's coverage-gap tracking; function-typed fields are opaque string pass-throughs by design.

A good rule of thumb: if you would hand the function to React as a prop, it is a field. If you would call it from inside a `on` or `action` node, it is a handler.

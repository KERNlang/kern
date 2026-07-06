# KERN 5 Support Matrix

This document defines the bounded KERN 5.0 final-complete claim. KERN 5.0 is
complete for the manifest-driven native runner app surface described here. Code
outside this matrix is not part of the 5.0 runtime promise unless a later
release adds tests and documentation for it.

The release rule is fail-closed: unsupported runtime shapes must reject before
they can leak partial output or implicit host effects.

## Canonical Gates

| Gate | Proof |
| --- | --- |
| Build and typecheck | `pnpm build` |
| Full workspace tests | `pnpm test` |
| Native KERN contract tests | `pnpm test:kern` |
| Runner and preview smoke | `pnpm test:runner-smoke` |
| KERN 5 focused gate | `pnpm fitness:kern-5` |
| Repository formatting/lint | `pnpm lint` |
| Final multi-engine review | `agon review uncommitted` |

## Manifest App Surface

| Surface | KERN 5 status | Evidence |
| --- | --- | --- |
| `app`, `view`, `route`, and `policy` manifest declarations | Supported | `packages/core/tests/app-descriptor.test.ts` |
| Duplicate apps, routes, views, policies, and handlers | Fail-closed | `packages/core/tests/app-descriptor.test.ts`, `packages/core/tests/runner-source-executor.test.ts` |
| Unknown policies and unknown capabilities | Fail-closed | `packages/core/tests/app-descriptor.test.ts`, `packages/core/tests/runner-capability-plan.test.ts` |
| Source path escaping, absolute source paths, and missing source files | Fail-closed | `packages/core/tests/app-descriptor.test.ts` |
| Descriptor-selected view and route handler execution | Supported | `packages/core/tests/runner-source-executor.test.ts` |
| Descriptor-selected async route execution | Supported for the matrix shapes below | `packages/core/tests/runner-source-executor.test.ts` |
| Descriptor-selected unsupported async class initialization | Fail-closed | `packages/core/tests/runner-source-executor.test.ts` |

## Native Runner Runtime Surface

| Feature | KERN 5 status | Evidence |
| --- | --- | --- |
| Functions and same-file pure helper calls | Supported | `packages/core/tests/runner-source-executor.test.ts` |
| Explicit multi-file `use` / `from` imports for pure helper functions and classes | Supported for host-resolved `.kern` files with explicit exports | `packages/core/tests/runner-source-executor.test.ts`, `packages/cli/tests/run.test.ts`, `examples/native-multifile` |
| Missing exports, duplicate imported aliases, import cycles, imported `fn main`, and path-containment failures | Fail-closed link errors before stdout | `packages/core/tests/runner-source-executor.test.ts`, `packages/cli/tests/run.test.ts` |
| Helper calls with scalar, record, array, and class-instance values | Supported in tested sync and descriptor async paths | `packages/core/tests/runner-source-executor.test.ts` |
| `let`, mutable `let`, and `assign` | Supported for portable values and tested class fields | `packages/core/tests/runner-source-executor.test.ts` |
| `if`, `branch`, `while`, `for`, and `each` | Supported for tested portable runner shapes | `packages/core/tests/runner-source-executor.test.ts`, `packages/core/tests/runner-capability-plan.test.ts` |
| Arrays and records | Supported for portable bindings, helper returns, arguments, dot reads, literal index reads, and iteration | `packages/core/tests/runner-source-executor.test.ts` |
| Classes, fields, constructors, methods, inheritance, and `super(...)` | Supported for tested portable sync paths and pure descriptor async argument paths | `packages/core/tests/runner-source-executor.test.ts` |
| Capability calls inside class methods or constructors | Fail-closed | `packages/core/tests/runner-source-executor.test.ts` |
| Async class field initializers and async explicit `super(...)` arguments | Outside the supported matrix; descriptor-selected paths fail closed | `packages/core/tests/runner-source-executor.test.ts` |
| Async class member assignment RHS parity beyond tested paths | Outside the supported matrix | No 5.0 promise |
| Async helper call caching semantics | Outside the supported matrix; async helper calls must remain pure within tested paths | No 5.0 promise |
| Side-effecting helper calls | Outside the supported matrix and rejected where detected | `packages/core/tests/runner-source-executor.test.ts` |
| `throw`, `try`, `catch`, and `finally` | Supported for explicit `new Error(...)`, caught `.message`, and tested cleanup paths | `packages/core/tests/runner-source-executor.test.ts` |

## Capability Contract

| Capability family | KERN 5 status | Provider rule |
| --- | --- | --- |
| `storage.*` | Shipped sync | Explicit host injection required |
| `crypto.*` | Shipped sync | Explicit host crypto source required |
| `app-http.queryParam` | Shipped sync | Host adapter provides request input; app source must declare it |
| `rag.retrieve` | Shipped sync | Node/local RAG adapter only |
| `rag.promptContext` | Shipped sync | Explicit host injection required |
| `rag.checkAnswer` | Shipped sync | Explicit host injection required |
| `fs.*` | Async preview (`--async-preview` only) | Explicit async provider required (`--fs-root` / `--fs-write-root`) |
| `net.fetch` | Async preview (`--async-preview` only) | Explicit async provider required (`--allow-net <origin>`) |
| `llm.complete` | Shipped async (no `--async-preview`) | Explicit async provider required (`--llm-response` / `--llm-provider openai`); per-call timeout via `--capability-timeout-ms` (default 30s, fail-closed) |
| `rag.retrieveAsync`, `rag.answer`, and `rag.ingest` | Shipped async (no `--async-preview`) | Explicit async provider required; `kern run` routes through the async executor automatically when the program's executable requirements need the async boundary |

Capability requirements are checked before execution. Unknown, undeclared,
missing, unsupported, and unprovided capabilities reject before app code can
continue. The preview app treats `app.kern` as the authoritative policy and
capability declaration; JavaScript may only provide host adapters for declared
capabilities. `kern run --capabilities` aggregates requirements over the whole
linked native-runner module graph, not only the root file; its
`capabilityReadinessMode` reports `sync`, `async` (promoted lane, no flag), or
`async-preview` (still-gated `fs.*`/`net.fetch`).

Promotion hardening shipped with the KERN 5.2 lane: every async capability
provider call is bounded by a host-configurable per-call timeout
(`capabilityTimeoutMs` / `--capability-timeout-ms`, default 30s; a timed-out
provider fails closed), retrieved-chunk citation provenance uses one
normalized wire shape across `rag.retrieve`/`rag.retrieveAsync` emission and
`rag.promptContext`/`rag.checkAnswer`/`rag.answer` parsing (disagreeing
duplicate encodings fail closed), and `rag.promptContext` returns `safeText` —
the assembled context wrapped in instruction-boundary markers with
boundary-marker lookalikes in retrieved data neutralized — which `rag.answer`
uses for its default prompt.

Routes and views may attach executable policy slots (`policy ... slot=pre|post
kind=passthrough`, optional `source=`/`handler=`); KERN 5.2 ships the slot
shape, fail-closed validation, and the `executeKernAppEntryPolicySlot` hook
with the no-op passthrough kind only — real guard kinds land in 5.3. External
vector-store adapter kinds become retrievable only through
`registerExternalRagVectorStoreAdapter`, which runs the full vector-store
conformance suite at registration and fails closed on any failing case.

## Reference App

`examples/kern-5-preview-app` is the maintained KERN 5 reference app for this
matrix. Its app manifest, UI view, route behavior, RAG query path, and grounding
guard are authored in `.kern`. `server.mjs` is host glue for HTTP, filesystem
source loading, request query input, local RAG/vector lookup, deterministic LLM
output, and JSON response shaping.

## Explicit Exclusions

The following are not KERN 5.0 final promises:

- Broad async class initialization semantics beyond the fail-closed descriptor
  guard tested in `runner-source-executor.test.ts`.
- Async class member assignment parity beyond tested portable paths.
- Side-effecting helper functions.
- Async capability calls inside streams or broad unsupported async control-flow
  shapes.
- Bare package imports, implicit top-level leakage, lazy module initialization,
  and value import cycles in the native runner.
- Production network, filesystem, vector database, or model-provider adapters
  without explicit host wiring and capability declarations.

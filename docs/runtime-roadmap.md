# KERN Runtime Roadmap

This roadmap tracks the path from portable KERN codegen to KERN executing useful
programs through its own runtime surface.

The bounded KERN 5.0 native-runner app contract is frozen in
[`kern-5-support-matrix.md`](./kern-5-support-matrix.md). This roadmap remains
the forward-looking document for surfaces outside that release matrix.

## Current Contract

`kern run <file.kern>` is the native runner preview. It parses one `.kern` file,
finds exactly one top-level `fn name=main returns=void`, executes that function's
single `handler lang="kern"` body through the reference runner, and replays
stdout events.

The runner is intentionally fail-closed. Unsupported or non-portable operations
must exit non-zero without leaking partial stdout.

## Supported Preview Surface

The preview surface is the documented, tested subset used by the smoke gate:

- `print`
- `let` and mutable `let kind=let`
- `assign`
- `if` and `else`
- `branch` with `path value=...` and one optional `path default=true`
- `while`
- `for`
- `each` over portable array values
- bare `return` from a void `main`
- `fmt name=... template=...` over portable scalar interpolations
- explicit `throw value="new Error(...)"` from a `try` body caught by `catch`,
  plus normal `finally` cleanup and caught-error `.message` reads
- portable scalar arithmetic, comparison, booleans, strings, and null
- portable array-literal binding, including nested array literals for iteration,
  plus in-bounds array index reads by a bare safe-integer literal, an
  integer-provenanced `for` counter, or `+`/`-` arithmetic recursively
  combining such operands (`xs[i + 1]`, `xs[1 + 1]`) — `*`, `/`, `%`, and
  unary stay outside the provenanced-arithmetic domain
- array append via `do value="<arrayIdent>.push(<elementExpr>)"` (a
  functional rebind of the target identifier to a new array; no synthetic
  trace event, matching the uninstrumented TS/Python emitters)
- `List.length(xs)` (the namespace-call form of `xs.length`), `new Map()`
  (empty-map construction only), and `Map.get`/`Map.has`/`Map.set` over
  string keys and portable-scalar values (`Map.set` only inside `do`,
  the same functional-rebind mutation model as array append; `Map.get` on a
  missing key fails closed — use `Map.has` to probe first)
- `Text.length`, `Text.charAt(i)`, `Text.slice(a, b)`, `Text.indexOf(needle)`,
  and `Text.startsWith(prefix)`, under the tribunal-locked Unicode
  code-point contract (Option D, decided 2026-07-02), for BMP-SAFE strings
  only (no character outside U+0000..U+FFFF, no surrogate-range code unit
  in the receiver or any string argument) — a deliberate risk-valve
  narrowing (see `packages/core/src/ir/semantics/portable-string.ts`): a
  well-formed non-BMP character (emoji, rare CJK extension characters) is
  NOT yet supported and fails closed identically to a malformed surrogate,
  pending a follow-up slice with full code-point-index emulation.
  `charAt`/`slice` fail closed on out-of-bounds/negative indices (a
  deliberately stricter bounds policy than JS's/Python's native silent
  clamping); `indexOf` returns a code-point offset or `-1` (not an error).
  This slice reaches the REFERENCE RUNNER ONLY — the production TS/Python
  codegen legs (`kern build`/`kern compile`) do not yet lower `Text.charAt`/
  `Text.slice`/`Text.indexOf`, and `Text.length`'s existing UTF-16-based
  lowering is UNCHANGED on those two legs; wiring the shared preamble/helper
  injection needed for 3-leg parity is deferred to a follow-up slice.
- flat record-literal binding with scalar dot-field reads
- pure KERN helper functions returning portable scalars, including explicit
  `use path="..."` imports from host-resolved `.kern` modules, and same-file
  RECURSION (direct self-calls and mutual/indirect cycles) up to an explicit
  512-deep call limit — unbounded recursion with no base case still fails
  closed once it exceeds the limit
- runner-native classes, including explicit imports of exported classes through
  `use` / `from`
- explicit `capability namespace=... operation=...` calls when an embedder
  injects a browser-safe capability provider through `@kernlang/core/runner`
  or the narrower `@kernlang/core/runner/browser` subpath
- browser-safe capability preflight with `analyzeKernSourceCapabilities`, which
  classifies shipped, planned, async-planned, unknown, and missing
  host-provided capabilities
- `executeKernSourceAsync`, a browser-safe async preview that delegates
  sync-only programs to `executeKernSource`, preflights async-planned
  capabilities against explicit async provider ids, and awaits async host
  providers in straight-line code, the matched arm of `if`/`else`, selected
  `branch` path bodies, structured `try` / `catch` / `finally`, and sequential
  `while` / `for` / `each` loop bodies, including same-file helper calls that
  return portable scalars from portable expression positions such as `print`,
  `let`, `assign`, `return`, `fmt`, `if` / `while` conditions, and capability
  input records; helper-expression bodies may use async-planned capability
  providers but do not receive sync capability providers
- in the Node CLI path, `kern run --async-preview --fs-root <dir>
  [--fs-write-root <dir>] <file.kern>` executes the same narrow async preview
  with CLI-owned `fs.list` / `fs.readText` adapters and an explicit
  `fs.writeText` adapter only when a write root is supplied
- in the Node CLI path, `kern run --async-preview --allow-net <origin>` exposes
  `net.fetch` only for explicitly allowlisted URL origins or the `data:` scheme,
  with redirects denied, and
  `--llm-response <text>` exposes a deterministic `llm.complete` preview
  provider for tests and local demos without contacting a model provider; the
  CLI also exposes a Node-only OpenAI-compatible `llm.complete` provider through
  `--llm-provider openai`, `--llm-model <model>` or `KERN_LLM_MODEL`,
  `KERN_LLM_BASE_URL`, and `KERN_LLM_API_KEY`
- `kern run --capabilities` reports async-planned requirements, missing async
  providers, supplied async preview provider ids, and provider-flag hints without
  executing the program body; the same `--fs-root`, `--fs-write-root`,
  `--allow-net`, `--llm-response`, and `--llm-provider openai` flags can be
  supplied in report mode to check async preview readiness, while separate sync
  and async blocker fields keep default `kern run` readiness distinct from
  `--async-preview` readiness; unsupported async execution shapes such as
  helper functions outside `main` and helper calls from unsupported expression
  slots are reported separately from missing provider flags, and explicit
  async-preview execution fails closed on those reported unsupported shapes
  before falling back to the sync runner
- native-runner module linking is eager and fail-closed: the root and all
  host-resolved `use path="..."` `.kern` imports are parsed and validated before
  user code executes; imported modules may not declare `fn main`; runtime import
  cycles, missing explicit exports, duplicate local import aliases, and host
  path-containment failures are link errors; `kern run --capabilities`
  aggregates capability requirements across the whole loaded graph
- `storage` capability calls backed by `createMemoryStorageCapability`, a
  browser-safe volatile provider for in-run state
- `crypto` capability calls backed by `createWebCryptoCapability`, a
  browser-safe synchronous provider for `randomUUID`, `randomBytes`, and
  `randomHex`; embedders must inject the host crypto source explicitly
- in the Node CLI path, local `rag.retrieve` capability calls over declared
  `ragRetrieve` specs with deterministic local embeddings
- in the Node CLI default async path (promoted out of `--async-preview` in the
  KERN 5.2 lane), `rag.retrieveAsync` capability calls run the same declared
  `ragRetrieve` specs through the explicit async retrieval adapter
  (`retrieveRagDocumentAsync`) while preserving the normalized retrieved-chunk
  provenance shape for later `rag.answer` / `rag.checkAnswer` guards
- in the Node CLI path, local `rag.promptContext` capability calls assemble
  retrieved chunks into a deterministic prompt-context record
- in the Node CLI path, local `rag.checkAnswer` capability calls enforce
  deterministic answer grounding and citation checks over retrieved chunks before
  a preview program prints an answer, including inferred grounding spans from
  inline chunk citations such as `[1]` when citation or grounding settings
  request them; inline citation extraction now lives in a shared pure helper so
  a dedicated answer-synthesis surface can reuse the same grounding contract
- in the Node CLI default async path, `rag.answer` synthesizes an answer over
  already-retrieved chunks through the configured deterministic or
  OpenAI-compatible `llm.complete` provider (prompting through the
  instruction-boundary-marked `safeText` context), then fails closed through
  the same inline-citation-derived grounding contract before returning an
  answer result
- in the Node CLI default async path, `rag.ingest` indexes declared
  local-persistent RAG stores through the existing async indexing workflow and
  returns a portable index lifecycle report without changing the shipped sync
  `rag.retrieve` boundary
- a KERN-authored RAG answer example at
  `examples/rag-starter/runtime-answer-preview.kern` that composes local
  `rag.retrieve`, `rag.promptContext`, deterministic `llm.complete`, and
  `rag.checkAnswer` through plain `kern run` (no `--async-preview`)
- a KERN-authored async retrieval answer example at
  `examples/rag-starter/runtime-answer-async-retrieve-preview.kern` that
  composes `rag.retrieveAsync`, `rag.promptContext`, deterministic
  `llm.complete`, and `rag.checkAnswer` through plain `kern run` (no
  `--async-preview`)
- a KERN-authored RAG answer-capability preview at
  `examples/rag-starter/runtime-answer-capability-preview.kern` that keeps
  retrieval explicit but replaces manual prompt assembly, completion, and answer
  checking with one async `rag.answer` capability call
- a KERN 5 preview vertical app at `examples/kern-5-preview-app` whose
  browser UI markup, backend route behavior, RAG query path, and grounding
  guard are emitted or authored from `.kern`, with `server.mjs` limited to thin
  HTTP, storage, RAG adapter, and deterministic LLM host wiring

Anything outside this surface is not a runtime promise until it has a contract,
three-leg parity coverage where applicable, and a native runner test. Current
known exclusions include whole-array / whole-record rendering, nested or dynamic
records, `*`/`/`/`%`/unary array-index arithmetic (only `+`/`-` between
provenanced operands is proven divergence-free), non-empty `new Map(...)`
construction (only the empty `new Map()` form is supported), non-string Map
keys and non-scalar Map values, recursion past the explicit 512-deep call
limit, non-BMP (surrogate-pair) characters in ANY `Text.*` string op (a
well-formed emoji/rare-CJK character fails closed the same as a malformed
surrogate — see the `Text.*` entry above), other string operations beyond
`length`/`charAt`/`slice`/`indexOf`/`startsWith` (`upper`/`lower`/`trim`/
`includes`/`endsWith`/`split`/`replace` still abstain in the reference
runner despite existing in the KERN-stdlib lowering table for the other
legs), non-canonical throws, side-effecting helper calls, implicit host
globals, non-RAG/non-storage/non-crypto CLI host capabilities,
provider-backed async RAG retrieval, async capability calls inside streams,
async helper calls from unsupported expression positions, and broad async
control flow.

## Phase 0 Gate

The phase-zero gate is:

```sh
npm run test:runner-smoke
```

It builds the CLI and runs `examples/native-runtime-smoke.kern` through
`kern run`, then checks the browser-runner budget with
`scripts/check-runner-browser-budget.mjs`. The gate fails on a non-zero exit,
unexpected stderr, stdout drift, browser-unsafe runner imports, a broken
`examples/browser-runner-smoke` fixture, runner static closure growth above
1,100,000 raw bytes / 260,000 gzip bytes, or median cold
`@kernlang/core/runner/browser` import+execute above 150ms in the Node proxy
probe. It also runs `examples/native-runtime-async-fs-preview.kern` and
`examples/native-runtime-async-host-preview.kern` through the CLI async preview
with temporary roots, a `data:` scheme allowlist, and deterministic LLM output.
It also runs `examples/rag-starter/runtime-answer-preview.kern`,
`examples/rag-starter/runtime-answer-async-retrieve-preview.kern`, and
`examples/rag-starter/runtime-answer-capability-preview.kern` through plain
`kern run --llm-response ...` (the promoted default async lane — no
`--async-preview`) to prove local RAG retrieval can
feed deterministic async LLM completion both through the manual primitive chain,
the explicit async retrieval boundary, and the dedicated `rag.answer` synthesis
boundary inside KERN-authored preview programs. The same gate also runs
`scripts/check-kern-5-preview-app.mjs`, which starts the maintained KERN 5
preview app and checks the browser UI markup emitted from `.kern` plus the
`.kern`-authored RAG answer route end to end.
When Chrome/Chromium is available, the same gate also serves the checked
in browser fixture and enforces a measured headless-browser import+execute
budget of 750ms; `--browser-budget=required` or
`KERN_BROWSER_BUDGET=required` makes that measured lane fail-closed. The smoke
fixtures stay on shipped sync capabilities except for the dedicated async fs
and async host preview fixtures; real network destinations and credentialed LLM
providers remain explicit host-adapter work.

## Roadmap

1. **Native runner preview**
   Keep `kern run` small, explicit, and fail-closed. Add support only with
   contract tests and CLI-level coverage.

2. **Browser-safe runner**
   Keep `@kernlang/core/runner` and the narrower
   `@kernlang/core/runner/browser` subpath free of the TypeScript compiler and
   Node-only dependencies. The runner budget gate now pins the static
   browser-facing closure, a cold import+execute Node proxy, and an optional
   fail-closed headless Chrome/Chromium measurement of the checked-in browser
   fixture. Real cross-browser/device thresholds can tighten these numbers later
   without weakening the import graph invariant. A checked-in static smoke
   harness at `examples/browser-runner-smoke` imports
   `packages/core/dist/runner-browser.js`, executes a storage+crypto KERN
   program, and records `performance.now()` timing when served in a browser.

3. **Capability boundary**
   Introduce explicit runtime capabilities for host effects such as filesystem,
   network, storage, crypto, RAG, and LLM calls. No implicit host globals. The
   first ABI slice is in `@kernlang/core/runner`: embedders can inject named
   synchronous providers, and missing capabilities fail closed. The Node CLI now
   registers volatile in-run storage, an explicit host crypto source, and a
   local RAG adapter without importing that RAG adapter from the browser runner
   entry. Browser/embedded hosts can preflight a source file with
   `analyzeKernSourceCapabilities` before execution to surface requirements
   without invoking any host capability. The Node CLI exposes the same
   read-only check as `kern run --capabilities <file.kern>`, emitting JSON
   without executing the program body. The runner entry also exposes a
   browser-safe async capability dispatch contract
   (`invokeRunnerCapabilityAsync` and `KernRunnerAsyncCapabilities`) so hosts can
   prototype fs/net/LLM providers without adding Node-only modules to the
   browser import graph. The source-level `executeKernSourceAsync` preview uses
   the same descriptor preflight, delegates sync-only programs to
   `executeKernSource`, and awaits known async-planned capability requirements
   in straight-line statements, the matched arm of `if`/`else`, selected
   `branch` path bodies, structured `try` / `catch` / `finally`, and sequential
   `while` / `for` / `each` loop bodies, plus same-file helper calls that return
   portable scalars from portable expression positions with async-planned
   capability providers only. The Node CLI owns the first documented
   host-adapter slice for that boundary through
   `kern run --async-preview --fs-root <dir> [--fs-write-root <dir>] <file.kern>`,
   which exposes root-scoped `fs.list` / `fs.readText` and opt-in
   `fs.writeText`, plus `--allow-net <origin>` for allowlisted non-redirecting
   `net.fetch` and `--llm-response <text>` for deterministic `llm.complete`,
   without adding Node imports to the browser runner graph. Its
   `kern run --capabilities` JSON report now exposes the same async-planned
   requirement sets and provider-flag hints, so tooling can tell whether an
   async preview run is missing `--fs-root`, `--fs-write-root`, `--allow-net`,
   or `--llm-response` before execution. The report validates those provider
   flags through the same setup paths as execution and reports unsupported
   async execution shapes before claiming async-preview readiness.
   Descriptor-level async policy remains a preflight concern, signaled through
   `asyncBoundaryRequired`; streams and broad async control-flow execution are
   still future work in the CLI.

3a. **Native module linking**
   The native runner now supports explicit value imports for the tested
   portable helper-function and class surface. `executeKernSource` and
   `executeKernSourceAsync` accept a browser-safe module loader hook; Node CLI
   execution supplies a filesystem loader rooted at the entry file directory
   and rejects escaping imports. Linking is eager: the whole reachable graph is
   parsed, import paths are canonicalized by the host, module records are
   memoized by canonical path, exported names must be explicit (`export=true`
   declarations or `from ... export=true` re-exports), and runtime import cycles
   are rejected before stdout is produced. The root entry remains the only file
   allowed to declare `fn main`. This is not a package manager or bare-module
   resolver; unsupported import shapes and host-denied paths fail closed.

4. **RAG runtime operations**
   Move from runner/tooling-only RAG commands toward runtime-executable RAG
   operations behind explicit capabilities. The first local retrieval slice is
   available through `capability namespace=rag operation=retrieve`. The first
  answer-preview slice composes that local retrieval with deterministic
  `llm.complete` in a KERN-authored program, core now exposes deterministic
  prompt-context assembly for retrieved chunks before answer synthesis, and the
  Node CLI path can enforce explicit or inline-citation-derived answer
  grounding/citation spans before printing. The first async retrieval slice is
  available through the clearly named `rag.retrieveAsync` preview capability.
  The first dedicated `rag.answer` preview now composes retrieved chunks with
  the configured deterministic or OpenAI-compatible `llm.complete` provider and
  returns only after the same grounding contract passes. Runtime ingestion,
  provider-backed retrieval adapters beyond the local preview, and broader
  async control-flow support remain future work.

5. **End-to-end KERN app**
   The first maintained vertical slice lives at `examples/kern-5-preview-app`.
   It uses KERN to emit browser-facing UI markup and to author backend route
   behavior, RAG retrieval, and grounding/security checks, with JavaScript
   limited to the thin HTTP and host-capability adapter. Keep expanding this
   slice until the production KERN 5.0 app contract is proven.

## Non-Goals

- Do not freeze a broad runtime ABI before the native runner surface is proven.
- Do not promise target-native RAG adapters until the emitted-target boundary
  changes intentionally.
- Do not treat TypeScript/Python codegen parity as obsolete; it remains the
  production path while the runtime matures.

## Capability Matrix

| Capability | Status | Boundary | Provider rule |
| --- | --- | --- | --- |
| `storage.get` / `storage.set` / `storage.has` / `storage.delete` / `storage.clear` / `storage.keys` | Shipped | Sync | Browser-safe volatile provider, explicit injection through runner capabilities |
| `crypto.randomUUID` / `crypto.randomBytes` / `crypto.randomHex` | Shipped | Sync | Browser-safe provider with explicit host crypto source |
| `rag.retrieve` | Shipped | Sync | Node CLI local RAG adapter over declared local sources |
| `rag.retrieveAsync` | Shipped (async) | Async | Runs by default without `--async-preview`; Node CLI async RAG adapter over declared local sources through `retrieveRagDocumentAsync`; explicit host/provider boundary that preserves the normalized retrieval provenance shape |
| `rag.promptContext` | Shipped | Sync | Node CLI local prompt-context assembly over retrieved RAG chunks |
| `rag.checkAnswer` | Shipped | Sync | Node CLI local deterministic answer grounding/citation check over retrieved RAG chunks |
| `rag.answer` | Shipped (async) | Async | Runs by default without `--async-preview`; answer synthesis over already-retrieved chunks through deterministic or OpenAI-compatible `llm.complete`, prompt assembled with instruction-boundary marking, fail-closed by grounding/citation checks |
| `rag.ingest` | Shipped (async) | Async | Runs by default without `--async-preview`; indexes declared local-persistent stores through `indexRagDocumentAsync` and returns a portable lifecycle report; provider-backed embedders can be supplied by Node hosts |
| `fs.readText` / `fs.writeText` / `fs.list` | Planned | Async planned | Must be host-injected; preview-runnable in `executeKernSourceAsync` straight-line / matched `if` arm / selected `branch` path / structured `try` / `catch` / `finally` / sequential `while`, `for`, and `each` loop bodies / same-file portable-scalar helper calls; Node CLI preview provides root-scoped `fs.list` / `fs.readText` and opt-in `fs.writeText` |
| `net.fetch` | Planned | Async planned | Must be host-injected; preview-runnable in `executeKernSourceAsync` straight-line / matched `if` arm / selected `branch` path / structured `try` / `catch` / `finally` / sequential `while`, `for`, and `each` loop bodies / same-file portable-scalar helper calls; Node CLI preview requires explicit `--allow-net <origin>` or `--allow-net data:` and denies redirects |
| `llm.complete` | Shipped (async) | Async | Runs by default without `--async-preview`; must be host-injected; runnable in `executeKernSourceAsync` straight-line / matched `if` arm / selected `branch` path / structured `try` / `catch` / `finally` / sequential `while`, `for`, and `each` loop bodies / same-file portable-scalar helper calls; Node CLI provides deterministic `--llm-response <text>` and OpenAI-compatible `--llm-provider openai`; per-call provider timeout via `--capability-timeout-ms` (default 30s) |

All shipped `executeKernSource` capabilities in this ABI slice are synchronous.
Async providers are not invoked by `executeKernSource`; `executeKernSourceAsync`
accepts the async host adapter shape, preflights explicit async provider ids,
and awaits async providers. The KERN 5.2 promotion moved the RAG async lane
(`rag.retrieveAsync`, `rag.answer`, `rag.ingest`) plus `llm.complete` out of
`--async-preview`: `kern run` detects when a program's executable requirements
need the async boundary and runs the async executor by default. `fs.*` and
`net.fetch` stay preview-gated behind `--async-preview`. Every async capability
provider call is bounded by a host-configurable per-call timeout
(`--capability-timeout-ms`, default 30s; a timed-out provider fails closed).
Async capabilities inside streams, unsupported helper expression positions,
and broader control flow still fail closed. External vector-store adapter
kinds registered through `registerExternalRagVectorStoreAdapter` (which runs
the vector-store conformance suite fail-closed at registration) join
`memory`/`local-persistent` as valid runtime `vectorStore kind=` values.

The preflight analyzer refuses fake broad ABI by separating:

- `requirements`: known capability calls found in parsed KERN source.
- `plannedCapabilities`: known still-preview-gated capabilities (`fs.*`, `net.fetch`). Promoted async capabilities (`rag.retrieveAsync`, `rag.answer`, `rag.ingest`, `llm.complete`, descriptor status `shipped-async`) no longer appear here even though they need the async boundary.
- `asyncPlannedCapabilities`: known capability calls whose descriptor requires
  the future async runner boundary. This currently matches
  `plannedCapabilities`, but it tracks execution shape rather than release
  status.
- `unknownCapabilities`: calls outside the descriptor table.
- `malformedCapabilities`: capability nodes missing a usable namespace or operation.
- `missingProviders`: shipped synchronous capabilities not present in the
  host-provided capability set.
- `missingAsyncProviders`: async-planned capabilities not present in the
  host-provided async capability set.
- `unsupportedAsyncExecutions`: async-planned capability calls present in source
  locations the narrow async preview executor still rejects, such as helper
  functions outside `main`.
- `unknownProvidedCapabilities`: host-provided capability ids outside the descriptor table.
- `unknownProvidedAsyncCapabilities`: async host-provided capability ids outside
  the async descriptor table.
- `asyncBoundaryRequired`: true when the executable main/helper call graph
  contains async-planned capability requirements.
- `hasParseErrors`: fail-closed signal that requirements should not be trusted
  until parse diagnostics are fixed.

Preflight is advisory for embedders and tooling. Runtime execution still
fail-closes on malformed capability tokens, missing providers, async provider
returns, and non-portable provider values.

## Open Blockers

- Promote the measured Chrome/Chromium browser budget from the current
  zero-dependency headless lane to a cross-browser/device threshold matrix when
  CI has dedicated browser runners.
- Expand the narrow async source preview into full app-ready execution for
  streams, unsupported helper expression positions, and any remaining broad
  async control-flow gaps.
- Tighten provider-backed LLM policy surfaces beyond the first Node-only
  OpenAI-compatible async preview adapter.
- Decide whether `rag.retrieveAsync` should remain the explicit async retrieval
  capability or whether `rag.retrieve` needs a dual sync/async descriptor
  boundary, and promote `rag.answer` from explicit retrieved chunks to
  async/provider-backed retrieval after the 5.0 demo proves the app path.
- Decide when a self-hosting/bootstrap demo is strong enough to call `kern run`
  canonical rather than preview.

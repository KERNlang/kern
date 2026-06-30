# KERN Runtime Roadmap

This roadmap tracks the path from portable KERN codegen to KERN executing useful
programs through its own runtime surface.

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
  plus in-bounds literal array index reads
- flat record-literal binding with scalar dot-field reads
- same-file pure KERN helper functions returning portable scalars
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
  `branch` path bodies, and sequential `while` / `for` / `each` loop bodies
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
  `try`, helper functions, and streams are reported separately from
  missing provider flags
- `storage` capability calls backed by `createMemoryStorageCapability`, a
  browser-safe volatile provider for in-run state
- `crypto` capability calls backed by `createWebCryptoCapability`, a
  browser-safe synchronous provider for `randomUUID`, `randomBytes`, and
  `randomHex`; embedders must inject the host crypto source explicitly
- in the Node CLI path, local `rag.retrieve` capability calls over declared
  `ragRetrieve` specs with deterministic local embeddings
- in the Node CLI path, local `rag.promptContext` capability calls assemble
  retrieved chunks into a deterministic prompt-context record
- in the Node CLI path, local `rag.checkAnswer` capability calls enforce
  deterministic answer grounding and citation checks over retrieved chunks before
  a preview program prints an answer, including inferred grounding spans from
  inline chunk citations such as `[1]` when citation or grounding settings
  request them; inline citation extraction now lives in a shared pure helper so
  a dedicated answer-synthesis surface can reuse the same grounding contract
- in the Node CLI async-preview path, `rag.answer` synthesizes an answer over
  already-retrieved chunks through the configured deterministic or
  OpenAI-compatible `llm.complete` provider, then fails closed through the same
  inline-citation-derived grounding contract before returning an answer result
- in the Node CLI async-preview path, `rag.ingest` indexes declared
  local-persistent RAG stores through the existing async indexing workflow and
  returns a portable index lifecycle report without changing the shipped sync
  `rag.retrieve` boundary
- a KERN-authored RAG answer preview at
  `examples/rag-starter/runtime-answer-preview.kern` that composes local
  `rag.retrieve`, `rag.promptContext`, deterministic `llm.complete`, and
  `rag.checkAnswer` through `kern run --async-preview`
- a KERN-authored RAG answer-capability preview at
  `examples/rag-starter/runtime-answer-capability-preview.kern` that keeps
  retrieval explicit but replaces manual prompt assembly, completion, and answer
  checking with one async `rag.answer` capability call

Anything outside this surface is not a runtime promise until it has a contract,
three-leg parity coverage where applicable, and a native runner test. Current
known exclusions include whole-array / whole-record rendering, nested or dynamic
records, non-counter dynamic array indices, arithmetic-on-counter array indices,
string `.length`, non-canonical throws, recursive helper calls, side-effecting
helper calls, implicit host globals, non-RAG/non-storage/non-crypto CLI host
capabilities, provider-backed async RAG retrieval, async capability calls inside
`try` and helper functions, and broad async control flow.

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
It also runs `examples/rag-starter/runtime-answer-preview.kern` and
`examples/rag-starter/runtime-answer-capability-preview.kern` through
`kern run --async-preview --llm-response ...` to prove sync local RAG retrieval
can feed deterministic async LLM completion both through the manual primitive
chain and through the dedicated `rag.answer` synthesis boundary inside
KERN-authored preview programs.
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
   `branch` path bodies, and sequential `while` / `for` / `each` loop bodies. The Node CLI
   owns the first documented host-adapter slice for that boundary through
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
   `asyncBoundaryRequired`; `try`, helper functions, streams, and broad async
   control-flow execution are still future work in the CLI.

4. **RAG runtime operations**
   Move from runner/tooling-only RAG commands toward runtime-executable RAG
   operations behind explicit capabilities. The first local retrieval slice is
   available through `capability namespace=rag operation=retrieve`. The first
  answer-preview slice composes that local retrieval with deterministic
  `llm.complete` in a KERN-authored program, core now exposes deterministic
  prompt-context assembly for retrieved chunks before answer synthesis, and the
  Node CLI path can enforce explicit or inline-citation-derived answer
  grounding/citation spans before printing. The first dedicated `rag.answer`
  preview now composes retrieved chunks with the configured deterministic or
  OpenAI-compatible `llm.complete` provider and returns only after the same
  grounding contract passes. Async retrieval, runtime ingestion, and broader
  async control-flow support remain future work.

5. **End-to-end KERN app**
   Ship one maintained vertical slice that uses KERN for browser-facing UI,
   backend route behavior, RAG retrieval, and security guards, with TS/Python
   limited to thin host adapters where still unavoidable.

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
| `rag.promptContext` | Shipped | Sync | Node CLI local prompt-context assembly over retrieved RAG chunks |
| `rag.checkAnswer` | Shipped | Sync | Node CLI local deterministic answer grounding/citation check over retrieved RAG chunks |
| `rag.answer` | Planned | Async planned | Node CLI preview answer synthesis over already-retrieved chunks through deterministic or OpenAI-compatible `llm.complete`, fail-closed by grounding/citation checks |
| `rag.ingest` | Planned | Async planned | Node CLI preview indexes declared local-persistent stores through `indexRagDocumentAsync` and returns a portable lifecycle report; provider-backed embedders can be supplied by Node hosts |
| `fs.readText` / `fs.writeText` / `fs.list` | Planned | Async planned | Must be host-injected; preview-runnable in `executeKernSourceAsync` straight-line / matched `if` arm / selected `branch` path / sequential `while`, `for`, and `each` loop bodies; Node CLI preview provides root-scoped `fs.list` / `fs.readText` and opt-in `fs.writeText` |
| `net.fetch` | Planned | Async planned | Must be host-injected; preview-runnable in `executeKernSourceAsync` straight-line / matched `if` arm / selected `branch` path / sequential `while`, `for`, and `each` loop bodies; Node CLI preview requires explicit `--allow-net <origin>` or `--allow-net data:` and denies redirects |
| `llm.complete` | Planned | Async planned | Must be host-injected; preview-runnable in `executeKernSourceAsync` straight-line / matched `if` arm / selected `branch` path / sequential `while`, `for`, and `each` loop bodies; Node CLI preview provides deterministic `--llm-response <text>` and OpenAI-compatible `--llm-provider openai` |

All shipped `executeKernSource` capabilities in this ABI slice are synchronous.
Async providers are not invoked by `executeKernSource`; `executeKernSourceAsync`
accepts the async host adapter shape, preflights explicit async provider ids,
and awaits async providers only in the narrow preview lane. Async capabilities
inside `try`, helper functions, streams, and broader control flow still fail
closed.

The preflight analyzer refuses fake broad ABI by separating:

- `requirements`: known capability calls found in parsed KERN source.
- `plannedCapabilities`: known non-shipped capabilities such as `fs.readText`, `net.fetch`, and `llm.complete`.
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
  locations the narrow async preview executor still rejects, such as `try`,
  streams, or helper functions outside `main`.
- `unknownProvidedCapabilities`: host-provided capability ids outside the descriptor table.
- `unknownProvidedAsyncCapabilities`: async host-provided capability ids outside
  the async descriptor table.
- `asyncBoundaryRequired`: true when source contains async-planned capability
  requirements.
- `hasParseErrors`: fail-closed signal that requirements should not be trusted
  until parse diagnostics are fixed.

Preflight is advisory for embedders and tooling. Runtime execution still
fail-closes on malformed capability tokens, missing providers, async provider
returns, and non-portable provider values.

## Open Blockers

- Promote the measured Chrome/Chromium browser budget from the current
  zero-dependency headless lane to a cross-browser/device threshold matrix when
  CI has dedicated browser runners.
- Expand the narrow async source preview into full async control-flow execution:
  `try`/`finally`, helper functions, and streams.
- Tighten provider-backed LLM policy surfaces beyond the first Node-only
  OpenAI-compatible async preview adapter.
- Promote the dedicated `rag.answer` synthesis preview from explicit retrieved
  chunks to async/provider-backed retrieval, and decide whether `rag.retrieve`
  needs a dual sync/async descriptor boundary or a new provider-specific
  capability.
- Decide when a self-hosting/bootstrap demo is strong enough to call `kern run`
  canonical rather than preview.

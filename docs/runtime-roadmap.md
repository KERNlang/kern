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
- `while`
- `for`
- `each` over portable array values
- `return` from a void `main`
- portable scalar arithmetic, comparison, booleans, strings, and null
- portable array-literal binding, including nested array literals for iteration,
  plus in-bounds literal array index reads

Anything outside this surface is not a runtime promise until it has a contract,
three-leg parity coverage where applicable, and a native runner test.

## Phase 0 Gate

The phase-zero gate is:

```sh
npm run test:runner-smoke
```

It builds the CLI and runs `examples/native-runtime-smoke.kern` through
`kern run`. The gate fails on a non-zero exit, unexpected stderr, or stdout drift.

## Roadmap

1. **Native runner preview**
   Keep `kern run` small, explicit, and fail-closed. Add support only with
   contract tests and CLI-level coverage.

2. **Browser-safe runner**
   Keep `@kernlang/core/runner` free of the TypeScript compiler and Node-only
   dependencies. Measure browser bundle size and cold start before declaring it
   browser-ready.

3. **Capability boundary**
   Introduce explicit runtime capabilities for host effects such as filesystem,
   network, storage, crypto, RAG, and LLM calls. No implicit host globals.

4. **RAG runtime operations**
   Move from runner/tooling-only RAG commands toward runtime-executable RAG
   operations behind explicit capabilities.

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

## Open Blockers

- Define the exact browser bundle and cold-start thresholds.
- Prove host capability registration works without hidden Node globals.
- Decide when a self-hosting/bootstrap demo is strong enough to call `kern run`
  canonical rather than preview.

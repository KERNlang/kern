# KERN 5 Ownership Support Matrix

**Release status:** R1 internal Alpha constitution; KERN 5.0 is not complete.
**Current product baseline:** KERN 4.5.0, audited from `main` at `477063a1`.
**Release meaning:** KERN 5 parses, checks, compiles, and executes its canonical
handler language through KERN-authored semantic tooling over versioned KIR.
Host code provides explicit capabilities and transport only. A clean bootstrap
must prove a deterministic Stage 1 equals Stage 2 fixed point.

This document is the human-readable mirror of
`scripts/kern-5-fitness-policy.json`. `pnpm check:kern-5-contract` requires the
two marked tables below to match that policy exactly. A current gate is runnable
now; a planned gate is deliberately absent until its implementation slice
promotes the policy and matrix atomically.

The fail-closed rule applies throughout: unsupported runtime shapes reject
before partial output, result, diagnostic, or implicit host effect escapes.

## Canonical Gates

<!-- KERN5_GATE_MATRIX_START -->
| ID | Gate | Status | Command |
| --- | --- | --- | --- |
| repo-consistency | Repository consistency | current | `pnpm check:repo` |
| lint | Formatting and lint | current | `pnpm lint` |
| build | Build and typecheck | current | `pnpm build` |
| workspace-tests | Full workspace tests | current | `pnpm test` |
| cross-target-conformance | TypeScript and Python conformance | current | `pnpm check:conformance` |
| native-kern | Native KERN tests | current | `pnpm test:kern` |
| runner-smoke | Runner and self-host smoke | current | `pnpm test:runner-smoke` |
| app-behavior | Three-leg app behavior | current | `pnpm test:app-behavior` |
| drift-showcase | Backend drift showcase | current | `pnpm test:drift-showcase` |
| browser-budget | Required browser budget | current | `pnpm check:runner-browser-budget:required` |
| kir-seam-probe | Typed semantic KIR seam probe | current | `pnpm test:kern-ir-probe` |
| kir-reader-candidate | Internal semantic KIR reader candidate | current | `pnpm test:kern-ir-reader-candidate` |
| semantic-ownership-proof | Bootstrap-dependent semantic ownership proof | current | `pnpm test:kern-semantic-ownership` |
| kir-v1-eligibility | KIR v1 coverage and identity eligibility | current | `pnpm test:kern-ir-eligibility` |
| canonical-value-reader | Bounded canonical value reader | current | `pnpm test:kern-canonical-value` |
| kir-structural-constitution | Structural KIR node and property constitution | current | `pnpm test:kern-kir-structural-constitution` |
| kir-structural-codec | Bounded structural KIR writer and reader | current | `pnpm test:kern-kir-structural-codec` |
| kir-module-graph | Structural KIR module and symbol graph | current | `pnpm test:kern-kir-module-graph` |
| internal-decoded-module-kir-binding | Decoded Module KIR to internal runtime handler binding | current | `pnpm test:kern-kir-runtime-binding` |
| kir-runner-composed-evidence | Internal composed KIR runner witnesses and structural blockers | current | `pnpm test:kern-kir-runner-composed-evidence` |
| kir-coverage-closure | Structural KIR coverage witness closure | current | `pnpm test:kern-kir-coverage-closure` |
| kir-evidence | Diagnostic and UTF-8 location evidence | current | `pnpm test:kern-kir-evidence` |
| kir-alpha-receipt | Clean-HEAD immutable Alpha receipt | current | `pnpm test:kern-alpha-receipt` |
| internal-runtime-envelope | Internal runtime envelope, handler entry, source link, capability seam, scheduler control, and private effect machine | current | `pnpm test:kern-runtime-envelope` |
| diff-hygiene | Git diff hygiene | current | `git diff --check` |
| kir-v1 | Versioned canonical KIR | current | `pnpm test:kern-ir` |
| runtime-handler-abi | Default-off public typed runtime handler ABI | current | `pnpm test:runtime-abi` |
| runtime-contract-v1 | Frozen runtime handler, capability, event, diagnostic, limit, and rejection contract v1 | current | `pnpm test:kern-runtime-contract-v1` |
| core-runtime-internalization | CoreRuntime public-ABI quarantine and internalization | current | `pnpm test:core-runtime-internalization` |
| source-runner-convergence | Source runner convergence, call-site isolation, and blocker non-growth | current | `pnpm test:source-runner-convergence` |
| kern-kir-canonicalizer | KERN-authored bounded KIR canonicalizer profile | current | `pnpm test:kern-canonicalizer` |
| kern-frontend-tokenizer-shadow | KERN-authored bounded frontend tokenizer shadow | current | `pnpm test:kern-frontend-tokenizer` |
| kern-frontend-stitch-shadow | KERN-authored bounded frontend framing and stitch shadow | current | `pnpm test:kern-frontend-stitch-shadow` |
| kern-frontend-indentation-shadow | KERN-authored bounded frontend indentation observation shadow | current | `pnpm test:kern-frontend-indentation-shadow` |
| kern-frontend | KERN-authored frontend | planned | `pnpm test:kern-frontend` |
| kern-compiler | KERN-authored compiler | planned | `pnpm test:kern-compiler` |
| selfhost-fixed-point | Stage 1 equals Stage 2 | planned | `pnpm test:selfhost-fixed-point` |
| kern-interpreter-shadow | KERN interpreter shadow | planned | `pnpm test:kern-interpreter-shadow` |
| packed-release | Packed release proof | planned | `pnpm test:packed-release` |
<!-- KERN5_GATE_MATRIX_END -->

`pnpm fitness:kern-5` validates this contract, then executes every current gate
in the listed order without a shell and stops on the first failure. Planned
commands are not silently skipped; they are explicitly outside the current
wall and must remain absent until promoted.

## Ownership Status

<!-- KERN5_OWNERSHIP_MATRIX_START -->
| ID | Ownership boundary | Status | Evidence |
| --- | --- | --- | --- |
| direct-source-runtime | Direct .kern source runtime | shipped-4.5 | `packages/core/tests/runner-source-executor.test.ts` |
| browser-safe-runner | Browser-safe runner | shipped-4.5 | `scripts/check-runner-browser-budget.mjs` |
| kern-assertion-engine | KERN assertion engine | internal-oracle | `pnpm test:capstone-assertion-engine` |
| kern-module-validator | KERN module validator | internal-oracle | `pnpm test:selfhost-validator` |
| kern-checker-v1 | KERN checker subset v1 | shipped-4.5 | `git show v4.5.0:examples/capstone-checker-subset/checker.kern` |
| checker-v2 | Checker v2 and production shadow | internal-oracle | `pnpm test:capstone-checker-subset` |
| kir-seam-selection | Typed semantic KIR seam selection | internal-oracle | `pnpm test:kern-ir-probe` |
| kir-reader-candidate | Internal semantic KIR reader candidate | internal-oracle | `pnpm test:kern-ir-reader-candidate` |
| semantic-ownership-proof | Non-circular semantic ownership substrate | internal-oracle | `pnpm test:kern-semantic-ownership` |
| kir-v1-eligibility | KIR v1 coverage and identity eligibility | internal-oracle | `pnpm test:kern-ir-eligibility` |
| canonical-value-reader | Bounded canonical value reader | internal-oracle | `pnpm test:kern-canonical-value` |
| kir-structural-constitution | Structural KIR node and property constitution | internal-oracle | `pnpm test:kern-kir-structural-constitution` |
| kir-structural-codec | Bounded structural KIR writer and reader | internal-oracle | `pnpm test:kern-kir-structural-codec` |
| kir-module-graph | Structural KIR module and symbol graph | internal-oracle | `pnpm test:kern-kir-module-graph` |
| internal-decoded-module-kir-binding | Decoded Module KIR to internal runtime handler binding | internal-oracle | `pnpm test:kern-kir-runtime-binding` |
| kir-runner-composed-evidence | Internal composed KIR runner witness closure | internal-oracle | `pnpm test:kern-kir-runner-composed-evidence` |
| kir-coverage-closure | Structural KIR coverage witness closure | internal-oracle | `pnpm test:kern-kir-coverage-closure` |
| kir-evidence | Diagnostic and UTF-8 location evidence | internal-oracle | `pnpm test:kern-kir-evidence` |
| kir-alpha-receipt | Clean-HEAD immutable Alpha receipt | internal-oracle | `pnpm test:kern-alpha-receipt` |
| internal-runtime-envelope | Default-off transactional runtime envelope | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-handler-entry | Typed current-domain handler entry | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-source-handler-link | Bounded source handler identity and link | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-capability-seam | Default-off capability interception seam | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-scheduler-control | Default-off cancellation and timeout control | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine | Private sync and async effect-machine convergence | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-if | Private effect-machine if and else frames | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-branch | Private effect-machine branch frames | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-while | Private effect-machine while frames | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-for | Private effect-machine counted for frames | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-each-array | Private effect-machine array each frames | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-architecture | Private effect-machine architecture boundary | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-try | Private effect-machine try, catch, and finally frames | internal-oracle | `pnpm test:kern-runtime-envelope` |
| internal-runtime-effect-machine-evaluator-boundary | Legacy-free stable machine and scalar-evaluator import boundary | internal-oracle | `pnpm test:kern-runtime-envelope` |
| versioned-kir-v1 | Versioned canonical KIR v1 | internal-oracle | `pnpm test:kern-ir` |
| typed-runtime-handler-abi | Frozen default-off public typed runtime handler ABI | internal-oracle | `pnpm test:kern-runtime-contract-v1` |
| core-runtime-internalization | CoreRuntime public-ABI quarantine and internalization | internal-oracle | `pnpm test:core-runtime-internalization` |
| source-runner-convergence | Sync/async source-runner convergence and pre-execution selector | internal-oracle | `pnpm test:source-runner-convergence` |
| kern-kir-canonicalizer-profile | Bounded KERN-authored KIR canonicalizer profile | internal-oracle | `pnpm test:kern-canonicalizer` |
| kern-frontend-tokenizer-shadow | Bounded KERN-authored line-tokenizer shadow | internal-oracle | `pnpm test:kern-frontend-tokenizer` |
| kern-frontend-stitch-shadow | Bounded KERN-authored physical framing and multiline stitch shadow | internal-oracle | `pnpm test:kern-frontend-stitch-shadow` |
| kern-frontend-indentation-shadow | Bounded KERN-authored indentation observation shadow | internal-oracle | `pnpm test:kern-frontend-indentation-shadow` |
| kern-formatter | KERN formatter or canonicalizer | not-shipped | R2 planned |
| kern-frontend | KERN-authored source frontend | not-shipped | R2 planned |
| kern-compiler | KERN-authored compiler | not-shipped | R2 planned |
| selfhost-fixed-point | Clean Stage 1 equals Stage 2 | not-shipped | R2 planned |
| kern-interpreter | KERN semantic interpreter | not-shipped | R2 and R3 planned |
| packed-release-proof | Exact packed release proof | not-shipped | R4 planned |
<!-- KERN5_OWNERSHIP_MATRIX_END -->

`shipped-4.5` means public substrate in the current product. `internal-oracle`
means KERN-authored logic participates in a release-blocking differential
harness but is not yet the production API or semantic authority. `not-shipped`
means the ownership boundary cannot support a KERN 5 release claim.

The internal `kern.kir.v1` envelope composes the historical Alpha semantic and
evidence payloads behind a strict canonical decoder and immutable acceptance
lineage. It is deliberately absent from package exports and is not the runtime
semantic authority.

M4.152 adds an opt-in `kern canonicalize` distribution preview backed by the
authenticated KERN canonicalizer. It remains `internal-oracle`: the command
uses the TypeScript bootstrap frontend, is bounded to the admitted structural
profile, and rejects comment syntax because it cannot preserve trivia. It
therefore does not promote the `kern-formatter` or `kern-frontend` ownership
rows.

M4.153 begins frontend ownership with a handwritten KERN line-tokenizer shadow.
It covers the eleven bootstrap line-token kinds and four tokenizer diagnostics
over a bounded scalar-safe profile, with KERN-owned boundary deltas and a
terminal source seal validated and normalized to UTF-8 byte positions by the
oracle. The whole public envelope is byte-ceiling checked before parsing.
Standalone non-ASCII unknown tokens and malformed UTF-16 fail closed. This is
an `internal-oracle` slice;
multi-line parsing, token-stream parsing, KIR production, and production
frontend cutover remain absent, so `kern-frontend` stays `not-shipped`.

M4.154 extends that internal oracle with LF-only physical-record framing and a
KERN-owned decision for multiline double-quoted properties and nested
`{{ ... }}` expressions. The emitted tape preserves exact indentation, LF
extent, contiguous group membership, boundary termination, open state, and
document-relative UTF-8 token and diagnostic positions. File-comment and
closed-profile raw-opener classes are observational boundaries only: trivia,
indentation meaning, raw bodies, parsing, KIR emission, and frontend cutover
remain unclaimed. Source-hashed corpus selection, aggregate limits, envelope
validation, and mutation tests make this a bounded
`kern-frontend-stitch-shadow: internal-oracle`; `kern-frontend` remains
`not-shipped`.

M4.155 composes that KERN-authored stitch envelope inside KERN and emits one
exact indentation observation for each complete ordinary group. It binds the
group and first physical record, maximal ASCII space/tab prefix, exact content
witness, source-derived UTF-8/code-unit boundary, and `initial`/`same`/`deeper`/
`shallower` relation. Blank, comment, raw-opener, continuation, boundary, and
EOF-unclosed records do not invent observations. The tape deliberately claims
no tree, node admission, tab validity, `INDENT_JUMP`, trivia attachment, AST,
KIR, or cutover, so this is only
`kern-frontend-indentation-shadow: internal-oracle`; `kern-frontend` remains
`not-shipped`.

The R1.4b ownership proof is visibly `BOOTSTRAP-DEPENDENT`: it proves an
acyclic, oracle-free assignment for the planned canonical path and binds the
current TypeScript authority to source evidence. It does not prove executable
handler-semantic ownership, runtime cutover, or self-hosting; those remain
blocked on the planned interpreter shadow and fixed-point gates.

## KERN 4.5 Manifest App Substrate

| Surface | Current status | Evidence |
| --- | --- | --- |
| `app`, `view`, `route`, and `policy` manifest declarations | Supported | `packages/core/tests/app-descriptor.test.ts` |
| Duplicate apps, routes, views, policies, and handlers | Fail-closed | `packages/core/tests/app-descriptor.test.ts`, `packages/core/tests/runner-source-executor.test.ts` |
| Unknown policies and unknown capabilities | Fail-closed | `packages/core/tests/app-descriptor.test.ts`, `packages/core/tests/runner-capability-plan.test.ts` |
| Source path escaping, absolute source paths, and missing source files | Fail-closed | `packages/core/tests/app-descriptor.test.ts` |
| Descriptor-selected view and route handler execution | Supported | `packages/core/tests/runner-source-executor.test.ts` |
| Descriptor-selected async route execution | Supported for the tested matrix | `packages/core/tests/runner-source-executor.test.ts` |
| Unsupported async class initialization | Fail-closed in descriptor-selected paths | `packages/core/tests/runner-source-executor.test.ts` |

## KERN 4.5 Native Runner Substrate

| Feature | Current status | Evidence |
| --- | --- | --- |
| Functions and same-file pure helper calls | Supported | `packages/core/tests/runner-source-executor.test.ts` |
| Explicit multi-file `use` / `from` imports for pure helpers and classes | Supported for host-resolved `.kern` files with explicit exports | `packages/core/tests/runner-source-executor.test.ts`, `packages/cli/tests/run.test.ts`, `examples/native-multifile` |
| Missing exports, duplicate aliases, import cycles, imported `fn main`, and path escapes | Fail-closed before stdout | `packages/core/tests/runner-source-executor.test.ts`, `packages/cli/tests/run.test.ts` |
| Scalar, record, array, and class-instance helper values | Supported in tested sync and descriptor async paths | `packages/core/tests/runner-source-executor.test.ts` |
| `let`, mutable `let`, and `assign` | Supported for portable values and tested class fields | `packages/core/tests/runner-source-executor.test.ts` |
| `if`, `branch`, `while`, `for`, and `each` | Supported for tested portable runner shapes | `packages/core/tests/runner-source-executor.test.ts`, `packages/core/tests/runner-capability-plan.test.ts` |
| Arrays and records | Supported for tested bindings, returns, arguments, reads, and iteration | `packages/core/tests/runner-source-executor.test.ts` |
| Classes, fields, constructors, methods, inheritance, and `super(...)` | Supported for tested portable sync and pure descriptor async paths | `packages/core/tests/runner-source-executor.test.ts` |
| Capability calls inside class methods or constructors | Fail-closed | `packages/core/tests/runner-source-executor.test.ts` |
| Async class field initialization and async explicit `super(...)` arguments | Outside the supported matrix; descriptor paths fail closed | `packages/core/tests/runner-source-executor.test.ts` |
| Side-effecting helper calls | Outside the supported matrix and rejected where detected | `packages/core/tests/runner-source-executor.test.ts` |
| `throw`, `try`, `catch`, and `finally` | Supported for tested explicit errors and cleanup paths | `packages/core/tests/runner-source-executor.test.ts` |

## KERN 4.5 Capability Substrate

| Capability family | Current status | Provider rule |
| --- | --- | --- |
| `storage.*` and `crypto.*` | Shipped sync | Explicit host injection required |
| `app-http.queryParam` | Shipped sync | Host adapter provides declared request input |
| `rag.retrieve`, `rag.promptContext`, and `rag.checkAnswer` | Shipped sync | Explicit host injection required |
| `fs.*` and `net.fetch` | Async preview only | Explicit bounded async provider and opt-in required |
| `llm.complete` | Shipped async | Explicit bounded async provider required |
| `rag.retrieveAsync`, `rag.answer`, and `rag.ingest` | Shipped async | Explicit bounded async provider required |

Requirements are checked before execution. Unknown, undeclared, missing,
unsupported, and unprovided capabilities reject before application code can
continue. These providers remain host implementations. Runtime contract v1
freezes their invocation boundary without claiming a KERN-authored semantic
runtime.

## Reference App

`examples/kern-5-preview-app` is the maintained preview app for the current
substrate. Its manifest, view, route behavior, RAG query path, and grounding
guard are authored in `.kern`. `server.mjs` remains explicit host glue for HTTP,
filesystem source loading, request facts, local retrieval, deterministic model
output, and JSON transport framing.

## Explicit Exclusions

Until their ownership rows and gates are promoted, KERN 5.0 does not claim:

- a production KERN checker v2 or production checker shadow;
- a frozen versioned KIR/value/diagnostic contract or public/full KIR-to-runtime cutover beyond the sanctioned internal decoded-Module-KIR binder;
- a KERN-authored formatter, source frontend, compiler, or semantic interpreter;
- a clean Stage 0 to Stage 1 to Stage 2 fixed point;
- an exact packed-release/bootstrap proof;
- broad async class semantics, side-effecting helpers, or implicit host effects
  outside the tested 4.5 substrate.

No internal Alpha/Beta/RC status changes a package version or public npm tag.

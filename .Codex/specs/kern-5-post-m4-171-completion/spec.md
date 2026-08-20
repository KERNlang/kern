# KERN 5 Post-M4.171 Completion Contract

**Status:** PHASE 1 IN PROGRESS; CHECKER + FORMATTER + FRONTEND F0 COMPLETE

**Date:** 2026-08-13

**Baseline contract:** direct-main M4.171 implementation `50407d08`; verified
post-publication `origin/main` baseline `bc1682880671b4dcac036ad74be8c4db4987810b`

**Current public version:** `4.5.0`

**Confidence:** 0.96

## Decision

KERN 5 remains a source-language ownership release, not a count of accumulated
shadow gates. After M4.171 publication, continue through one serial critical
path:

1. reconcile the completion contract and enumerate every terminal gate;
2. finish KERN-owned frontend, formatter, and production checker behavior;
3. finish KERN-owned compilation and prove the clean Stage 1/Stage 2 fixed point;
4. finish the KERN interpreter and cut canonical consumers off TypeScript
   semantics while retaining an explicit forced-TypeScript oracle;
5. prove exact packed artifacts, then publish `5.0.0` from the accepted RC
   source only after explicit publication authority.

This is the only credible ordering because each later phase consumes the
contract produced by the earlier one. A big-bang cutover would make failures
non-local, while parallel compiler/interpreter ownership would build against a
moving frontend and KIR boundary.

## Current State After M4.171 Publication and Phase 1 F0 Closure

### Repository-measured state

- **[VERIFIED]** The KERN 5 policy declares 65 gates: 59 `current` and 6
  `planned`. The terminal roster and its frozen classification vocabulary are
  bound in `scripts/kern-5-remaining-gates-v1.json`; policy and ledger agree on
  ID, order, status, and argv.
- **[VERIFIED]** `pnpm fitness:kern-5` executes promoted/current gates and does
  not execute planned gates. A green wall therefore proves the current
  substrate, not KERN 5 completion. Evidence:
  `scripts/kern-5-fitness-policy.json` and its policy tests.
- **[VERIFIED]** M4.171 owns one admitted successful logical line through a
  complete authenticated `ParsedLine`-shaped shadow record. Cross-line
  `parseLines`, decorators, multiline blocks, node/tree construction, KIR
  emission, and public cutover remain absent. Evidence:
  `docs/kern-5-support-matrix.md`.
- **[VERIFIED]** The bounded internal `Text.splice` prerequisite and scalar-tape
  lexer/parser feasibility proof are current at `fa11d52d`. Frontend F0 binds
  all 302 source nodes, 1,149 structural properties, the expression/operator
  catalogs, diagnostics, source families, and static KIR goldens without
  creating or promoting the production frontend entry point. Evidence:
  `.Codex/specs/kern-5-frontend-surface-closure/spec.md` and
  `scripts/kern-frontend-closure/closure-ledger.json`.
- **[VERIFIED]** The reference-runner Text cache prerequisite is execution
  local, bounded, opaque, and current. It removes repeated scalar
  materialization for F1 document walks without promoting the frontend or
  claiming generated TypeScript/Python parity. Evidence:
  `.Codex/specs/kern-5-runtime-text-cache-prerequisite/spec.md`.
- **[VERIFIED]** KIR v1 and the frontend slices are `internal-oracle`, which
  means they participate in release-blocking differential evidence but are not
  the production semantic authority. Evidence:
  `docs/kern-5-support-matrix.md`.
- **[VERIFIED]** F3 authenticates the exact F1 record tape positionally, owns
  logical-line framing and geometric tree topology, and remains
  `internal-oracle`; declaration admission, node attachment, KIR emission, and
  terminal frontend promotion remain F4-F7 work. Evidence:
  `.Codex/specs/kern-5-f3-line-tree/spec.md`.
- **[VERIFIED]** The production runner still imports the TypeScript
  `referenceRunSequence` and TypeScript parser, and `kern run` documents that it
  executes through the reference runner. Evidence:
  `packages/core/src/runner.ts` and `packages/cli/src/commands/run.ts`.
- **[VERIFIED]** The ownership matrix marks the production structural checker
  and formatter `internal-product`; it still marks the complete
  frontend, compiler, fixed point, interpreter, and packed-release proof as
  `not-shipped` and excludes full/canonical KIR-to-runtime cutover. Evidence:
  `docs/kern-5-support-matrix.md`.

### Progress interpretation

- **[VERIFIED]** Promoted-gate row coverage after P0 transport, production F1
  physical scanning, F2 expression parsing, F2 document batching, and F3
  logical-line/tree assembly is `59 / 65 = 90.8%`.
- **[INFERRED]** Release completion is approximately **54-64%**, not 89.8%.
  The range is deliberately heuristic: the repository has a large, well-gated
  ownership substrate, but the remaining phases are the high-weight canonical
  product path—complete frontend, compiler, fixed point, interpreter, consumer
  cutover, packed proof, and public release.
- **[VERIFIED]** The production checker and lossless formatter are current.
  Complete frontend and canonical cutover remain planned terminal gates without
  placeholder root scripts.

## What Already Works

| Area | Proven state after M4.171 | KERN 5 status |
| --- | --- | --- |
| Runtime/capability substrate | Typed handler ABI, capability seam, scheduler controls, effect-machine slices, source-runner convergence | Strong internal substrate; not the fully canonical KERN interpreter |
| KIR | Strict versioned `kern.kir.v1` envelope, structural codec/module graph, evidence, coverage closure, runtime binding | Current internal contract; deliberately not a public export or runtime authority |
| Frontend | Tokenizer through successful single-line composition, with differential and mutation evidence | Substantial shadow ownership; no cross-line/tree/KIR/public frontend |
| Checker | Versioned facts/result envelopes, native KERN verdicts, 48/48 parity, 36 hostile rejections, packaged private assets | Structural checker is current; bootstrap fact production remains until frontend cutover |
| Formatter | Bounded, deterministic, trivia-preserving lossless formatter | Current internal product |
| Release machinery | Policy, packing, durability, recovery, promotion, and registry verification infrastructure exists | Exact KERN 5 packed-release/bootstrap proof is open |

## Required Terminal Gate Contract

Phase 0 must make the policy, policy tests, support matrix, release train, and
goal agree on this complete target set. A proposed gate remains `planned`, and
its root package script remains absent, until its binary oracle exists and the
slice promotes both atomically.

| Gate | Current declaration | Promotion meaning |
| --- | --- | --- |
| `pnpm test:kern-checker` | **[VERIFIED]** current | the compiled authenticator plus KERN semantic checker owns verdicts over `kern.checker.facts.2`; the bootstrap producer remains explicit until frontend cutover |
| `pnpm test:kern-formatter` | **[VERIFIED]** current | KERN formatter preserves required trivia/source evidence and is idempotent and deterministic |
| `pnpm test:kern-frontend` | **[VERIFIED]** planned | Complete admitted source produces byte-identical canonical KIR and diagnostics against the bootstrap oracle |
| `pnpm test:kern-compiler` | **[VERIFIED]** planned | KERN-owned compiler covers the v5 target matrix and can compile its own toolchain sources |
| `pnpm test:selfhost-fixed-point` | **[VERIFIED]** planned | Clean Stage 1 and Stage 2 packed outputs are byte-identical under enumerated normalization, twice |
| `pnpm test:kern-interpreter-shadow` | **[VERIFIED]** planned | KERN interpreter has zero semantic/effect/diagnostic drift across the supported v5 contract |
| `pnpm test:kern-canonical-cutover` | **[VERIFIED]** planned | Normal CLI/core/browser and required downstream paths cannot reach TypeScript semantics or silently fall back; forced-TS remains explicit |
| `pnpm test:packed-release` | **[VERIFIED]** planned | Exact tarballs pass install, export, runtime, downstream, fixed-point, integrity, and recovery proof from fresh roots |

`pnpm test:kern-ir` stays current. Its ownership row becomes shipped/canonical
only when the frontend/compiler/interpreter/cutover evidence proves that KIR v1
is the actual product contract. KIR remains private to the package graph by
default; a new public KIR API is out of scope unless a verified consumer need is
approved.

## Delivery Contract

### Phase 0 — Reconcile the truth sources

- Record direct-main implementation `50407d08` and the verified
  post-publication baseline `bc168288` without inventing a merge commit.
- Correct stale release-train baselines, missing-document references, and old
  release-machinery claims against current workflows.
- Add the checker, formatter, and canonical-cutover planned gates and tests that
  prevent their omission or premature root-script exposure.
- Define the admitted v5 language/diagnostic/trivia contract and close any
  contradiction between “versioned KIR current” and “KIR not shipped”.
- Produce one machine-readable remaining-gate ledger.

Phase 0 distinguishes two horizons: all eight root scripts must be absent while
their rows are planned; final KERN 5 completion requires real scripts, current
status, and green binary oracles.

### Phase 1 — Complete source ownership

- Extend successful-line composition to cross-line parsing, decorators,
  multiline blocks, declarations, nodes/trees, modules/imports, malformed input,
  stable locations, and source-to-KIR emission.
- Finish the trivia-preserving formatter and production checker over the same
  frozen contract.
- Promote the checker, formatter, and frontend gates only on zero-drift valid
  and malformed corpora plus adversarial mutation evidence.

### Phase 2 — Complete compiler ownership

- Implement KERN-owned KIR-to-target compilation for the required v5 matrix.
- Compile the KERN frontend/compiler/runtime sources themselves.
- Reject delegated-host, constant-output, stale-artifact, and partial-coverage
  implementations before promoting `test:kern-compiler`.

### Phase 3 — Prove self-hosting

- From separate clean roots and immutable packed inputs, build Stage 1 from
  Stage 0 and Stage 2 from Stage 1.
- Repeat twice and require byte identity after only enumerated normalization.
- Bind source, toolchain, manifest, output, and tarball hashes into the receipt.

### Phase 4 — Complete semantic ownership

- Make the KERN interpreter consume the frozen KIR and handler/capability ABIs.
- Require zero drift in typed values, events/stdout, diagnostics, completion,
  cancellation, effects, and capability requests.
- Fail unsupported shapes before partial output or effects.

### Phase 5 — Cut over canonical consumers

- Migrate internal packages, CLI Node, browser, and required downstream
  consumers in staged slices.
- Keep the TypeScript oracle behind explicit configuration only.
- Prove normal execution cannot import, call, or fall back to TypeScript
  parser/compiler/ReferenceRunner semantics.

### Phase 6 — Prove the exact packed RC

- Pack once, test the exact files, and bind their integrities to an immutable RC
  manifest.
- Exercise clean installation, exports/binaries, CLI, core, browser, Python,
  Express, FastAPI, reference app, fixed point, downstream canary, registry
  staging/recovery, and two fresh-root KERN 5 fitness walls.

### Phase 7 — Publish KERN 5.0

- Require explicit authority immediately before irreversible public
  registry/tag operations.
- Inject `5.0.0` through release policy, rebuild from the accepted RC source,
  and prove all non-version outputs match the RC manifest.
- Publish dependency-first, move `kern-lang@latest` last, and verify a clean
  consumer from the registry.

## Acceptance Criteria

- [ ] All eight target terminal gates exist in policy and package scripts and
      are `current` and green.
- [ ] KERN owns canonical parse, check, format, compile, and execute behavior
      over one versioned KIR contract.
- [ ] Stage 1 equals Stage 2 twice from clean packed inputs.
- [ ] Normal canonical execution cannot reach TypeScript semantics or silently
      fall back; forced-TypeScript oracle mode remains tested.
- [ ] Native, Node, browser, Python, Express, FastAPI, and maintained-app
      conformance walls pass where the v5 matrix requires them.
- [ ] Exact RC tarballs pass fresh install, integrity, downstream, and recovery
      proof.
- [ ] Support matrix, release train, policy, package scripts, and public docs
      contain no future-tense or contradicted ownership claim.
- [ ] Final `5.0.0` source is the accepted RC source and post-publication clean
      consumer verification passes.

## Out of Scope

- WASM as a release blocker.
- All-target self-hosting, a package manager, an LSP, or `vscode-kern` release.
- A public KIR package/API without an approved consumer contract.
- Broad new language semantics outside the frozen v5 admitted contract.
- Weakening the KERN 5 meaning by renaming unfinished ownership work as Fable.

## Open Questions and Authority Boundaries

There is no blocking architecture choice if KIR remains a private canonical
contract. Public KIR exposure requires a separate consumer-driven decision.
Ordinary implementation, local commits, and feature-branch pushes may proceed
under repository rules; pushing to `main`, merging, and public registry/tag
publication require the authority specified by the active engineering doctrine.

## Corrections Log

- **[CORRECTED]** The live post-F3 count is `59/65`: checker and formatter are
  promoted, the non-terminal frontend closure, Text scaling, F1, F2, F2B, and
  F3 gates are current, and six terminal gates remain planned.
- **[CORRECTED]** `51/58` measures promoted gate rows, not 87.9% release
  completion.
- **[CORRECTED]** The five declared planned gates omit checker, formatter, and
  canonical-cutover completion gates.
- **[CORRECTED]** Historical R0 release-machinery gaps must be re-audited; much
  of the machinery now exists and should not be rebuilt from stale prose.
- **[CORRECTED]** KIR v1 is a current internal oracle but not yet the canonical
  product authority; “versioned” and “shipped/canonical” are separate claims.
- **[CORRECTED]** M4.171 was published directly to `main` as `50407d08` plus
  completion-contract commit `bc168288`; there is no merge commit.

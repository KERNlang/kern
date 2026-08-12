# KERN 5.0 Completion Goal

**Status:** READY AFTER M4.171 MERGES

**Goal confidence:** 0.96

**Current public version:** `4.5.0`
**Authoritative spec:**
`.Codex/specs/kern-5-post-m4-171-completion/spec.md`

## Start Prompt

> Read `.Codex/goals/KERN-5-COMPLETION-GOAL.md` and its authoritative spec in
> full. Create or resume the KERN 5 completion goal and execute the first
> unfinished phase from a fresh worktree based on current `origin/main`. Treat
> every ownership claim as untrusted until its binary oracle passes. Continue
> through independently reviewed slices; stop only for a genuine product
> decision, unavailable required reviewer/credential, or an irreversible
> operation that lacks explicit authority.

## Objective

Ship KERN `5.0.0` only when KERN owns the canonical parse, check, format,
compile, and execute path over versioned KIR; host code supplies capabilities
and transport only; clean Stage 1 equals Stage 2; normal execution cannot reach
or silently fall back to TypeScript semantics; and the exact accepted packed RC
passes the required product and recovery walls.

The goal is not complete merely because the current `pnpm fitness:kern-5` wall
passes. After M4.171, that wall contains 50 promoted gates and excludes five
declared planned gates. Three other terminal requirements—production checker,
full formatter, and canonical cutover—still need explicit planned gates.

## Post-M4.171 Baseline

Do not guess the merge SHA. Before the next slice:

1. Finish M4.171 publication and merge under the active repository rules.
2. Run `git fetch origin`.
3. Resolve and record the actual M4.171 merge commit on `origin/main`.
4. Create a new feature branch and isolated worktree from that exact SHA.
5. Re-audit the policy, support matrix, release workflows, package exports, and
   current runner/parser/compiler call paths for merge skew.

Expected state immediately after merge:

- 55 declared KERN 5 gates: 50 current, 5 planned.
- M4.171 proves one authenticated successful logical-line shadow only.
- KIR v1, checker v2, runtime ownership slices, canonicalizer, and frontend
  slices remain `internal-oracle`, not canonical product authority.
- TypeScript parser/compiler/ReferenceRunner paths remain production surfaces.
- Formatter, complete frontend, compiler, fixed point, interpreter, canonical
  cutover, exact packed proof, and public `5.0.0` remain open.

Promoted-gate coverage is 90.9%. The source-grounded release-completion estimate
is only 45-55% because the remaining gates are the high-weight ownership and
cutover phases. This estimate is directional, not a repository metric.

## Target Gate Ledger

Phase 0 must make all eight rows explicit in the fitness policy, policy tests,
support matrix, and release train. New rows begin as `planned`, and their root
package scripts must remain absent until the implementation slice promotes each
row to `current` with its complete binary oracle.

| Gate | Starting state after M4.171 |
| --- | --- |
| `pnpm test:kern-checker` | add as planned |
| `pnpm test:kern-formatter` | add as planned |
| `pnpm test:kern-frontend` | planned |
| `pnpm test:kern-compiler` | planned |
| `pnpm test:selfhost-fixed-point` | planned |
| `pnpm test:kern-interpreter-shadow` | planned |
| `pnpm test:kern-canonical-cutover` | add as planned |
| `pnpm test:packed-release` | planned |

`pnpm test:kern-ir` remains current. KIR v1 becomes shipped/canonical only
when the final call chain actually consumes it. Keep KIR private by default;
public export is a separate consumer-contract decision, not a KERN 5 blocker.

## Execution Phases

### Phase 0 — Reconcile the completion contract

- Replace stale baselines and release-machinery claims with current evidence.
- Repair missing-document references and conflicting KIR status language.
- Add the three omitted planned gates and tests that require their root scripts
  to remain absent until promotion.
- Freeze the admitted v5 source, diagnostics, trivia, KIR, handler, capability,
  trace, determinism, limit, and rejection contracts.
- Produce one machine-readable remaining-gate ledger.

**Exit:** all truth sources agree and every KERN 5 terminal requirement is
machine-enumerated without promoting unfinished work.

### Phase 1 — Finish frontend, checker, and formatter ownership

- Extend M4.171 through cross-line parsing, decorators, multiline blocks,
  nodes/trees, declarations, modules/imports, malformed-input diagnostics,
  stable source evidence, and source-to-KIR emission.
- Finish production checker v2 over the frozen source/KIR contract.
- Finish deterministic, idempotent, trivia-preserving formatting.
- Require zero-drift valid and malformed corpora plus mutations that kill
  delegation, constants, reordering, partial coverage, and stale artifacts.

**Exit:** `test:kern-frontend`, `test:kern-checker`, and
`test:kern-formatter` are current and green.

### Phase 2 — Finish compiler ownership

- Implement KERN-owned KIR-to-target compilation for the v5 support matrix.
- Compile the KERN frontend, compiler, and runtime sources themselves.
- Preserve required Node, browser, Python, Express, FastAPI, and maintained-app
  behavior.
- Prove the gate cannot be satisfied by host delegation or cached output.

**Exit:** `test:kern-compiler` is current and green.

### Phase 3 — Prove the fixed point

- Build Stage 1 from Stage 0 and Stage 2 from Stage 1 in separate clean roots
  using immutable packed inputs.
- Require Stage 1 and Stage 2 byte identity after only enumerated normalization.
- Repeat twice and bind source, tools, manifests, outputs, and tarball hashes.
- Prove workspace links, stale `dist`, untracked files, or prior receipts cannot
  satisfy the gate.

**Exit:** `test:selfhost-fixed-point` is current and green.

### Phase 4 — Finish interpreter ownership

- Make the KERN interpreter consume the frozen KIR and handler/capability ABIs.
- Cover every admitted v5 construct across sync and immediately resolved async
  execution.
- Require zero drift in values, events/stdout, diagnostics, completion,
  cancellation, effects, and capability requests.
- Reject unsupported shapes before partial output or effects.

**Exit:** `test:kern-interpreter-shadow` is current and green.

### Phase 5 — Perform canonical cutover

- Migrate internal packages, CLI Node, browser, and required downstream
  consumers in staged slices.
- Keep TypeScript as an explicit forced oracle and emergency selector only.
- Add import/call/fallback traps proving normal canonical execution cannot reach
  TypeScript parser, compiler, or ReferenceRunner semantics.
- Unsupported canonical inputs must fail loudly before effects; they must never
  silently retry through TypeScript.

**Exit:** `test:kern-canonical-cutover` is current and green in canonical and
forced-TypeScript CI lanes.

### Phase 6 — Prove the exact packed RC

- Build and pack once, test those exact files, and record immutable integrity.
- Prove clean installation, exports/binaries, CLI check/format/compile/run,
  canonical and forced-TS modes, browser budgets, Python, Express, FastAPI,
  maintained app, fixed point, downstream canary, and recovery.
- Run two complete KERN 5 fitness walls from separate clean roots.
- Record source SHA, toolchain versions, contract hashes, stage hashes, tarball
  integrities, and every gate result in the RC manifest.

**Exit:** `test:packed-release` is current and green, and independent terminal
review has no unresolved verified blocker.

### Phase 7 — Publish public KERN 5.0

- Pause immediately before public registry/tag work unless explicit authority
  is already present.
- Inject `5.0.0` only through release policy from the accepted RC source.
- Rebuild and prove all non-version output matches the RC manifest.
- Publish dependency-first and promote `kern-lang@latest` last.
- Verify exact registry versions, dependencies, integrities, tags, provenance,
  and a clean consumer install/run.
- Never reuse a failed published version.

**Exit:** final source equals accepted RC source and post-publication evidence
is durable and complete.

## Slice Protocol

For each non-trivial slice:

1. Fetch and branch from current `origin/main`; never reuse a merged branch.
2. Ground the claim in current source and write/update a claim-tagged spec.
3. State a 3-5 bullet plan, confidence, dependencies, and binary acceptance.
4. Prove the missing behavior RED at the baseline, then implement the smallest
   complete ownership boundary.
5. Keep handwritten source below 500 lines and policy configurable.
6. Run focused tests first. Run the complete promoted KERN 5 wall at meaningful
   promotion/cutover points and before a slice is declared ready.
7. Run the local gate, then independent Agon review using automatic risk routing
   and the verified primary implementer identity. Resolve the live usable roster
   from configuration; never hardcode it.
8. Verify every finding against current source, fix genuine blockers, and rerun
   affected gates.
9. Create granular KERN-signed commits. Push the complete feature branch once
   only when authorized; never use `gh`, never push to `main` without explicit
   confirmation, and hand over the PR URL emitted by native `git push`.
10. Record the landed SHA, ownership gained, exact gate counts, review result,
    remaining ledger, and next slice.

## Binary Definition of Done

- [ ] All eight target gates are present, current, and green.
- [ ] KERN owns canonical parse, check, format, compile, and execution behavior.
- [ ] KIR v1 is the actual canonical product contract.
- [ ] Stage 1 equals Stage 2 twice from clean packed inputs.
- [ ] Normal execution has no TypeScript semantic call or silent fallback.
- [ ] Explicit forced-TypeScript oracle mode remains green.
- [ ] Required native, Node, browser, Python, Express, FastAPI, and application
      conformance walls pass.
- [ ] Exact RC tarballs pass clean installation, bootstrap, integrity,
      downstream, and recovery proof.
- [ ] The complete `pnpm fitness:kern-5` wall includes every terminal gate and
      passes from fresh roots.
- [ ] Independent terminal review has no unresolved verified blocker.
- [ ] Policy, support matrix, release train, package docs, and public claims
      match proved ownership exactly.
- [ ] Final version is `5.0.0`; final source equals accepted RC source.
- [ ] Registry/tag/`latest` and clean-consumer verification pass if publication
      is authorized.

## Stop Conditions

Pause only for:

- a missing product decision that changes the public contract;
- unavailable required reviewer identity, credential, or external system;
- an irreversible merge, public registry, or tag operation lacking authority;
- a root-cause blocker that remains after safe in-scope investigation.

Do not stop because an individual slice is difficult, a broad suite is quiet,
or the current promoted wall is green. Do not move unfinished KERN 5 ownership
into Fable or rename it to make this checklist pass.

## Completion Report

When every Definition of Done item is evidenced, report the accepted RC SHA,
final source/tag SHA, package integrities, fixed-point hashes, all gate results,
review receipt, publication receipt, and any explicitly approved residual risk.

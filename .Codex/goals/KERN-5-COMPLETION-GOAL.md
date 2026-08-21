# KERN 5.0 Completion Goal

**Status:** KERN 5 IN PROGRESS; F0-F3 CURRENT-GATED CANDIDATE SUBSTRATE; F4
CANDIDATE AWAITING ACCEPTANCE

**Goal confidence:** 0.96

**Current `origin/main` source:** `4.6.0` at `ab360354` (source baseline only;
not a KERN 5 release, tag, or publication claim)
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
passes. After the production-checker, formatter, and non-promoting frontend F0
closure, runtime text-scaling prerequisite, P0 transport, production F1
physical-scanner, production F2 expression-parser, F2 document-batch, and F3
logical-line/tree slices, that wall contains 59
promoted gates and excludes the six
remaining planned terminal gates.

## Post-M4.171 Baseline

M4.171 was published directly to `main`; no merge commit exists. The
implementation commit is `50407d08ac97eeb4bfe9ee007f1072841b058991`, and the
post-publication completion-contract baseline is
`bc1682880671b4dcac036ad74be8c4db4987810b`. Fresh fetch and `ls-remote`
verification resolved both `origin/main` and the remote ref to that baseline
before the isolated Phase 0 worktree was created.

Reconciled state after the Phase 1 checker, formatter, runtime splice, and
frontend F0 closure slices:

- 65 declared KERN 5 gates: 59 current, 6 planned.
- M4.171 proves one authenticated successful logical-line shadow only.
- The production structural checker is `internal-product`; KIR v1, runtime
  ownership slices, canonicalizer, and frontend slices remain
  `internal-oracle`, not canonical product authority.
- TypeScript parser/compiler/ReferenceRunner paths remain production surfaces.
- The lossless formatter is `internal-product`; complete frontend, compiler,
  fixed point, interpreter, canonical cutover, exact packed proof, and public
  `5.0.0` remain open.
- The bounded internal `Text.splice` primitive and scalar-tape lexer/parser
  feasibility proof are current at `fa11d52d`; they are prerequisites, not a
  complete frontend claim.
- Frontend F0 freezes the full 302-node/1,149-property source-to-KIR
  disposition ledger, 16 expression kinds, 30 operators, diagnostic catalogs,
  static canonical KIR goldens, and the F1-F7 delivery order. It does not add a
  production parser or promote `test:kern-frontend`.
- The execution-local Text cache prerequisite removes repeated Unicode-scalar
  materialization from reference-runner document walks. P0 transport and the
  authenticated KERN-owned production F1 physical scanner, and the authenticated
  KERN-owned production F2 expression parser and document batch, plus F3
  logical-line/tree assembly, are current; F4-F7,
  generated target parity, and terminal frontend promotion remain open.

Promoted-gate row coverage is `59 / 65 = 90.8%`. Phase 0 made three omitted
terminal requirements visible; no implementation was lost. The source-grounded
release-completion estimate is approximately 54-64%
because the remaining gates are the high-weight ownership and cutover phases.
This estimate is directional, not a repository metric.

## Target Gate Ledger

All eight rows are explicit in the fitness policy, versioned remaining-gate
ledger, policy tests, support matrix, and release train. Checker and formatter
are current; the other six remain `planned`, and their root package scripts
remain absent until an implementation slice promotes each with its complete
binary oracle. The machine-readable authority is
`scripts/kern-5-remaining-gates-v1.json`.

| Gate | Current state after frontend F3 |
| --- | --- |
| `pnpm test:kern-checker` | current |
| `pnpm test:kern-formatter` | current |
| `pnpm test:kern-frontend` | planned |
| `pnpm test:kern-compiler` | planned |
| `pnpm test:selfhost-fixed-point` | planned |
| `pnpm test:kern-interpreter-shadow` | planned |
| `pnpm test:kern-canonical-cutover` | planned |
| `pnpm test:packed-release` | planned |

`pnpm test:kern-ir` remains current. KIR v1 becomes shipped/canonical only
when the final call chain actually consumes it. Keep KIR private by default;
public export is a separate consumer-contract decision, not a KERN 5 blocker.

## Current state — 2026-08-21

- **[K5-CS1 VERIFIED]** `origin/main` is `ab360354` with the integrated `4.6.0`
  source baseline. M0 candidate integration is landed. This source fact is not
  KERN 5 acceptance, terminal promotion, release, tag, or publication.
- **[K5-CS2 VERIFIED]** F0, P0, F1, F2, F2B, and F3 form an implemented,
  current-gated *candidate* internal frontend substrate. Their authenticated
  KERN composition remains `internal-oracle`; it does not promote the terminal
  frontend gate or replace the TypeScript production path. F1 cumulative-wall
  and F2 acceptance-review evidence remain explicitly pending in their slice
  specifications.
- **[K5-CS3 VERIFIED]** F4 is a substantial, independently scoped
  review-clean *candidate* (declarations, expression evidence, request verdict,
  path/ID, resource-prefix, UTF-8, and merged M1.1 eligibility slices). M1.1
  acceptance remains open: this slice implements all eight C13-LOCAL
  constructed-here admission families and its pre-integration candidate passed the focused
  32/32 oracle plus the full 362/362 F4 declarations wall. That bounded local
  evidence is not a durable merged/CI receipt. C13-GLOBAL imported expression/
  path admission remains M3/open. The remaining F4-A1–A6/A11 corpus, canonical
  C15 graph ordering, and full-scale closure are unfinished. F4 is neither
  accepted nor promoted; the F4 specification remains authoritative for
  slice-level status, and no candidate result changes the terminal-gate ledger.
- **[K5-CS4 VERIFIED]** The machine ledger still has exactly eight terminal
  rows: two current (`test:kern-checker`, `test:kern-formatter`) and six planned
  (`test:kern-frontend`, compiler, fixed-point, interpreter-shadow, canonical
  cutover, packed-release). Therefore the promoted prerequisite count remains
  `2 / 8` terminal rows and `59 / 65` all prerequisite gates; neither count is
  evidence that the merged candidate source is shippable.
- **[K5-CS5 DECIDED]** Retain the directional 54–64% completion heuristic. It
  weighs the still-open ownership/cutover gates rather than the 59/65 row count;
  it is not a repository metric or publication forecast.

### Authority boundary

- **[K5-CS6 DECIDED]** Integration/merge authority is separate from technical
  acceptance: only an explicit project-owner instruction may select a target
  branch and authorize integration after the relevant candidate gates and
  independent review are recorded.
- **[K5-CS7 DECIDED]** Publication authority is separate again. This goal
  authorizes **no push, tag, release, package publication, or deployment**.
  Those actions require a later explicit authorization after a merged,
  reproducible release candidate satisfies M7 below.

## Bounded remaining-work milestones (M0–M7)

This map supersedes the broad remaining-work ordering for execution planning;
the historical Phase 0–7 record below is retained as provenance. A milestone is
not complete until every listed acceptance gate is green on its candidate and
its stated dependency is complete.

| Milestone | Bounded deliverable and dependency | Acceptance gate(s) |
| --- | --- | --- |
| **M0 — candidate integration (source landed; acceptance receipt not attached)** | `origin/main` `ab360354` contains landed M0 integration and M1.1; dependency: K5-CS1. Aggregate M0 integration head `eaff1992` is provenance only. | Required M0 acceptance gates remain `git diff --check`; `pnpm test:kern-frontend-f4-declarations`; and `pnpm --filter @kernlang/core exec tsc -b --force`. This goal row attaches no durable M0 gate receipt; source landing alone is not terminal-promotion or release evidence. |
| **M1 — F4A semantic closure** | Close F4-A1–A6 and A11 across all frozen F0 source forms, properties, raw blocks, decorators, attachments, diagnostics, and decoder ownership; C13-LOCAL's eight constructed-here facts are implemented and locally verified in this slice, while the remaining M1 closure stays open; dependency: M0. | New F4A binary/mutation oracles prove each acceptance claim; F4-A1–A6/A11 may move only with their evidence. |
| **M2 — F4B canonical graph closure** | Close F4-A7 and canonical C15: deterministic R/T/facts, binding positions, normalized resolution, re-export fixed point, rejected/blocked order, and actual SCC/component rows; dependency: M1. | Permutation, cycle, malformed, and multi-hop re-export oracles; exact canonical receipt/decoder evidence. |
| **M3 — F4 scale and adversarial closure** | Close F4-A8–A10, including complete 26-form coverage, declared scale caps, resource/work/byte boundaries, C13-GLOBAL imported expression/path admission, and full-slice independent review; dependency: M2. | Focused F4 suite plus mutation/scaling oracle matrix; no unclassified source form or quadratic authority scan remains. |
| **M4 — F5 KIR projection** | Produce the KERN-owned projection from accepted F4 facts to frozen KIR without TypeScript semantic delegation; dependency: M3. | F5 spec and binary oracle prove canonical KIR rows, provenance, malformed atomicity, and static-golden parity. |
| **M5 — F6/F7 frontend promotion** | Complete adversarial frontend closure and promote the terminal frontend gate only after F0–F6 converge; dependency: M4. | `pnpm test:kern-frontend` is added, current, and green; the ledger, policy, support matrix, and release train promote atomically. |
| **M6 — remaining canonical ownership** | Complete compiler, fixed-point, interpreter-shadow, and canonical-cutover ownership serially; dependency: M5. | In order: `pnpm test:kern-compiler`, `pnpm test:selfhost-fixed-point`, `pnpm test:kern-interpreter-shadow`, and `pnpm test:kern-canonical-cutover` are each current and green. |
| **M7 — exact packed RC** | Build and independently reproduce the accepted packed release candidate; dependency: M6. | `pnpm test:packed-release` is current and green, including recovery walls and exact artifact identity. Completion grants only technical acceptance; K5-CS7 still forbids publication without explicit authority. |

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

- [x] Freeze the exhaustive frontend surface/disposition ledger and static
  canonical/malformed goldens without promoting the terminal frontend gate.
- [x] Land authenticated P0 result transport and the KERN-owned production F1
  physical scanner without promoting the terminal frontend gate.
- Extend M4.171 through cross-line parsing, decorators, multiline blocks,
  nodes/trees, declarations, modules/imports, malformed-input diagnostics,
  stable source evidence, and source-to-KIR emission.
- [x] Finish production checker v2 over the frozen structural-facts contract.
- [x] Finish deterministic, idempotent, trivia-preserving formatting.
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

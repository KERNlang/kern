# KERN 5.0 Completion Goal

**Status:** KERN 5 IN PROGRESS; F0 LEDGER FROZEN; F1-F5 SOURCE-TO-KIR FOUNDATION MERGED;
FIRST PRODUCT GOAL IS KIR-BACKED REVIEW PREVIEW; COMPILER, RUNTIME,
INTEROPERABILITY, AND CANONICAL OWNERSHIP OPEN

**Goal confidence:** 0.89 after corrections, capped by three OPEN product
decisions: external-import syntax, first ecosystem packages, and
reference-service domain

**Integrated source baseline:** `4.6.0`; `origin/main` was verified at
`032f9e574673dcc1ca497458452556da49e2d4cd` after the F5 projection and exact
work-ownership repairs. This is source provenance, not a KERN 5 release, tag,
or publication.
**Authoritative spec:**
`.Codex/specs/kern-5-runtime-compiler-review-replan/spec.md`.
The first product goal is specified by
`.Codex/specs/kern-review-kir-preview-release/spec.md`.
The earlier
`.Codex/specs/kern-5-post-m4-171-completion/spec.md` remains the historical
terminal-contract authority where the replan does not explicitly supersede it.

## Start Prompt

> Read `.Codex/goals/KERN-5-COMPLETION-GOAL.md` and its authoritative spec in
> full. Create or resume the KERN 5 completion goal from a fresh worktree based
> on current `origin/main`. Advance the frontend and Review immediately from
> accepted F5 KIR, with the packed KIR-backed Review preview as the first
> shippable goal. Unlock compiler/runtime, interoperability, and service work
> independently through their R0 contract cells. Integrate only at the declared
> convergence milestones. Treat every ownership claim as untrusted until its
> binary oracle passes. Stop only for a genuine product decision, unavailable
> required reviewer/credential, or an irreversible operation that lacks explicit
> authority.

## Objective

Ship KERN `5.0.0` only when a developer can write, semantically review,
compile, run, and deploy a KERN microservice. KERN must own canonical parse,
check, format, KIR projection, target compilation, and runtime behavior; host
code supplies capabilities, transport, and locked npm/PyPI package loading
only. A Node-target gateway and Python-target compute service must interoperate
over a versioned contract; clean Stage 1 must equal Stage 2; normal execution
cannot reach or silently fall back to TypeScript semantics; and the exact
accepted packed RC must pass the required product and recovery walls.

The goal is not complete merely because the current `pnpm fitness:kern-5` wall
passes or because frontend evidence grows. The current wall contains 60
promoted gates and excludes six planned terminal gates. Product progress is
reported first by vertical capabilities: source-to-KIR, JavaScript compilation,
Python compilation, runtime execution, locked ecosystem imports, KIR-backed
Review, deployable microservices, canonical cutover, and self-hosting.

## Strategic Execution Reset — 2026-08-24

The accepted F5 KIR boundary permits parallel work. Frontend work continues as
productionization and service-driven language closure; it no longer blocks the
start of compiler, runtime, interoperability, or Review work.

R0 is not a global phase barrier. Accepted F5 KIR and provenance unlock FE and
REV immediately. An executable ABI cell independently unlocks RT, C-JS, and
C-PY; a package-manifest cell unlocks INT; and a service wire/budget cell
unlocks integration fixtures. Each lane advances when its own dependency is
ready:

1. **FE:** production source-to-KIR CLI path, diagnostics, and constructs
   required by reference services;
2. **C-JS:** KERN-owned KIR-to-JavaScript compilation;
3. **C-PY:** KERN-owned KIR-to-Python compilation;
4. **RT:** KERN-owned values, calls, control flow, effects, cancellation, and
   capability execution;
5. **INT:** locked npm and PyPI import manifests, resolvers, and policy;
6. **REV:** canonical-KIR semantic diff, dependency/capability impact, and
   target-compatibility Review.

The lanes converge at walking-skeleton, interoperability-service,
two-microservice, canonical-cutover, and self-host/release milestones. Focused
lane gates run during development; combined and complete walls run only at
those meaningful convergence or promotion points.

The three OPEN product decisions block only their R0-PKG/R0-SVC fixtures and
implementation. They do not block this documentation reset, the packed Review
preview, or immediate FE/REV work.

### First Product Goal — KIR-Backed Review Preview

The first release-oriented milestone is an advisory KIR-backed Review preview
(working label `4.8.0`; exact version not yet authorized). It productizes the
accepted private F5 projection as a packed authenticated service, derives
Review semantics from canonical KIR, and exposes explicit preview/dual modes in
the Review package and CLI.

It must be useful before KERN 5 is complete: semantic API, import/export,
dependency, capability, call/effect, and structural changes are reported, while
formatter-only edits are ignored. Canonical projection or analysis failure is
visible and cannot silently become a legacy-parser or empty-success result.

This milestone advances FE and REV together immediately. Runtime, compiler,
package-import, and service-contract work remain parallel; they do not wait for
the Review preview, and Review does not wait for them. No version, tag,
publication, or deployment is authorized by this goal update.

## Post-M4.171 Baseline

M4.171 was published directly to `main`; no merge commit exists. The
implementation commit is `50407d08ac97eeb4bfe9ee007f1072841b058991`, and the
post-publication completion-contract baseline is
`bc1682880671b4dcac036ad74be8c4db4987810b`. Fresh fetch and `ls-remote`
verification resolved both `origin/main` and the remote ref to that baseline
before the isolated Phase 0 worktree was created.

Reconciled state after the Phase 1 checker, formatter, runtime splice, and
frontend F0 closure slices:

- 66 declared KERN 5 gates: 60 current, 6 planned.
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
  authenticated KERN-owned F1 physical scanner, F2 expression parser/document
  batch, F3 logical-line/tree assembly, F4 declaration/module-set semantics,
  and merged F5 KIR projection form the source-to-KIR foundation. Production
  frontend routing, KERN-owned target compilation/runtime, locked npm/PyPI
  imports, KIR-backed Review, and terminal promotion remain open.

Promoted-gate row coverage is `60 / 66 = 90.9%`. Phase 0 made three omitted
terminal requirements visible; no implementation was lost. The historical
source-grounded release-completion estimate was approximately 54-64%. It
remains directional, not a repository metric, and is no longer the primary
progress report. Report vertical capabilities and convergence milestones
instead.

## Target Gate Ledger

All eight rows are explicit in the fitness policy, versioned remaining-gate
ledger, policy tests, support matrix, and release train. Checker and formatter
are current; the other six remain `planned`, and their root package scripts
remain absent until an implementation slice promotes each with its complete
binary oracle. The machine-readable authority is
`scripts/kern-5-remaining-gates-v1.json`.

Review-preview, R0-contract, and microservice commands are planned sub-gates,
not terminal rows. Their implementation slices must create and authenticate
their own manifests before adding root scripts; the eight-row terminal ledger
does not enumerate unfinished sub-gates.

| Gate | Current state after merged F5 source |
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

## Current state — 2026-08-23

- **[K5-CS1 VERIFIED]** The integrated `4.6.0` source baseline contains M0,
  M1.1 eligibility, C13-LOCAL, the A6 detached-subtree closure, A5-local
  property evidence, the A3a neutral source-form kernel, and the A3b
  authenticated public source-form projection;
  `d0631aff` is the pinned pre-A1/A2 evidence ancestor and `4c0ade63` is the
  pinned pre-A6 ancestor.
  This source fact is not
  KERN 5 acceptance, terminal promotion, release, tag, or publication.
- **[K5-CS2 VERIFIED]** F0, P0, F1, F2, F2B, and F3 form an implemented,
  current-gated *candidate* internal frontend substrate. Their authenticated
  KERN composition remains `internal-oracle`; it does not promote the terminal
  frontend gate or replace the TypeScript production path. The cumulative F4
  acceptance wall exercised these prerequisites; their historical slice-level
  review status remains recorded in their own specifications.
- **[K5-CS3 VERIFIED]** F4 is an accepted, independently reviewed nonterminal
  `internal-oracle` for declarations, expression evidence, request verdict,
  path/ID, resource-prefix, UTF-8, and module-set semantics. M1.1 implements all
  eight C13-LOCAL constructed-here admission families; its focused `32/32`
  oracle and full `362/362` F4 wall passed before the later cumulative
  acceptance. C13-GLOBAL imported expression/path admission is integrated.
  F4-A1, F4-A2, and F4-A11 evidence includes the focused `8/8` matrix, complete
  F4 wall `370/370`, and automatic-risk Agon review with no verified blocker.
  F4-A6 evidence includes its focused E1-E10 matrix
  passed `10/10`, its adjacent C13/document/eligibility/expression/path wall
  passed `119/119`, and automatic-risk Agon review left no verified blocker
  after the traced repairs; the expanded complete F4 declarations wall passed
  `383/383` on the final candidate. F4-A4 evidence includes its final
  public-path matrix passed `10/10`, the complete F4 declarations wall passed
  `393/393`, and automatic-risk Agon review found no verified or needs-check
  blocker; no production or contract bytes changed. F4-A5 F4A-local evidence
  includes its focused matrix `12/12` and adjacent decoder/
  resource wall passed `145/145`, the complete F4 declarations wall passed
  `405/405`, and automatic-risk Agon review found no blocker. Its decoder now
  binds receipt coordinates and last-write-wins presence to the authenticated
  property authority without changing document `.2`, policy `.4`, or ABI 109.
  The A3a dependency extracts the 52-case source-form decisions into one
  receipt-neutral KERN kernel, and A3b now projects its authenticated scalar
  writes through public F4. The reviewed A3b candidate passed its focused
  `35/35` matrix, adjacent `246/246` wall, complete `458/458` F4 declarations
  wall, complete `23/23` keyword-handler gate plus regression wall, and exact
  `41/41` policy-pin validation. This closes the bounded F4-A3 scalar subset.
  F4-A7/C15 evidence includes the focused M2 matrix `17/17` and adjacent
  module-set/resource gates `17/17`, `30/30`, and `17/17`, the complete F4 wall
  passed `481/481`, all `43` policy pins matched, and post-repair independent
  correctness review reported no findings. The KERN-owned `.4` module-set path
  now emits canonical R/T/V, real SCCs, sourced cycle facts, normalized
  bindings, and charged canonical output, with a source-backed independent
  reference verifier, as recorded by the parent F4 spec's F4-A7 row.
  C13-GLOBAL and F4-A8 evidence is integrated. The A8
  registry covers all nine mutation families; its focused aggregate passed
  `2/2`, the complete F4 wall passed `509/509`, all `45` policy pins matched,
  and independent review left no verified blocker. F4-A9's authenticated
  1x/2x/4x/8x scale matrix passed `41/41`; the standalone complete F4 wall
  passed `550/550`, with repeated module-density RSS samples inside the
  calibrated policy wall. F4-A10 then passed the focused prerequisite and
  adjacent product gates, exact `45/45` pins, deterministic authority
  regeneration, and the cumulative `pnpm fitness:kern-5` wall. F4-A1 through
  F4-A11 are therefore accepted and `kern-frontend-f4-declarations` is current
  as a nonterminal `internal-oracle`. Final review-driven source-canary and
  accounting repairs passed the post-review complete F4 wall `551/551`. This
  does not promote the terminal frontend gate or change the terminal ledger.
- **[K5-CS3B VERIFIED]** F5 KIR projection and its exact work-ownership repairs
  are merged at `032f9e57`. The final candidate passed the focused F5
  `67/67` wall, complete F4 `551/551` wall, core tests, lint, root build,
  repository consistency, exact `20/20` F5 descriptor validation, and
  deterministic F4 authority regeneration before integration. F5 gives the new
  parallel lanes a stable canonical-KIR input. It does not by itself promote
  `test:kern-frontend`, provide a KERN-owned target compiler/runtime, or prove
  npm/PyPI interoperability.
- **[K5-CS4 VERIFIED]** The machine ledger still has exactly eight terminal
  rows: two current (`test:kern-checker`, `test:kern-formatter`) and six planned
  (`test:kern-frontend`, compiler, fixed-point, interpreter-shadow, canonical
  cutover, packed-release). Therefore the promoted prerequisite count remains
  `2 / 8` terminal rows and `60 / 66` all prerequisite gates; neither count is
  evidence that the merged candidate source is shippable.
- **[K5-CS5 SUPERSEDED]** The directional 54–64% heuristic remains historical
  context only. Current reporting uses the vertical capability scoreboard:
  source-to-KIR, JavaScript compilation, Python compilation, runtime execution,
  locked ecosystem imports, KIR-backed Review, two-service deployment,
  canonical cutover, and self-hosting/release proof.

### Authority boundary

- **[K5-CS6 DECIDED]** Integration/merge authority is separate from technical
  acceptance: only an explicit project-owner instruction may select a target
  branch and authorize integration after the relevant candidate gates and
  independent review are recorded.
- **[K5-CS7 DECIDED]** Publication authority is separate again. This goal
  authorizes **no push, tag, release, package publication, or deployment**.
  Those actions require a later explicit authorization after a merged,
  reproducible release candidate satisfies R6 below.

For the KIR-backed Review Preview execution only, the 2026-08-24 task grants a
narrower superseding authority: after all requested local gates and independent
review pass, push `feat/kir-backed-review-preview` exactly once and hand over
the native Git PR URL. This does not authorize main, merge, version, tag,
registry, publication, or deployment operations and does not alter K5-CS7 for
KERN 5 release work.

## Accepted foundation and product convergence milestones

M0-M4 record the accepted/merged source foundation. R0-R6 supersede the
historical serial Phase 0-7 ordering for execution planning. A convergence
milestone is not complete until every participating lane passes its focused
gate and the listed combined acceptance is green on the integrated candidate.
The complete historical Phase 0-7 narrative remains preserved in baseline
commit `032f9e57`; it is provenance, not current execution authority.

| Milestone | Bounded deliverable and dependency | Acceptance gate(s) |
| --- | --- | --- |
| **M0 — candidate integration (source landed; acceptance receipt not attached)** | The integrated source baseline contains landed M0 integration and M1.1; dependency: K5-CS1. Aggregate M0 integration head `eaff1992` is provenance only. | Required M0 acceptance gates remain `git diff --check`; `pnpm test:kern-frontend-f4-declarations`; and `pnpm --filter @kernlang/core exec tsc -b --force`. This goal row attaches no durable M0 gate receipt; source landing alone is not terminal-promotion or release evidence. |
| **M1 — F4A semantic closure (accepted)** | F4-A1 through F4-A6 and F4-A11 are accepted. A3a retains exact legacy parity, and A3b projects its frozen scalar source-form writes through public F4 with authenticated provenance and prospective occurrence ownership; dependency: M0. | The A3b public-path binary/mutation oracle, adjacent wall, complete F4 declarations wall, exact pin validation, and independent review passed. |
| **M2 — F4B canonical graph closure (accepted)** | F4-A7/C15 provides deterministic R/T/facts, binding positions, normalized resolution, re-export fixed point, rejected/blocked order, and actual SCC/component rows; dependency: M1. | Focused M2 `17/17`, adjacent `17/17` + `30/30` + `17/17`, complete F4 `481/481`, exact `43/43` pins, deterministic authority regeneration, and independent review passed. |
| **M3 — F4 scale, adversarial closure, and promotion (accepted)** | C13-GLOBAL and F4-A8-A10 close the declared adversarial, scale, resource, work, byte, and promotion contract; dependency: M2. | A9 focused `41/41`, pre-review complete F4 `550/550`, post-review complete F4 `551/551`, exact `45/45` pins, cumulative KERN 5 fitness, and independent review passed. F4 is current only as a nonterminal internal oracle. |
| **M4 — F5 KIR projection (merged source foundation)** | KERN-owned projection from accepted F4 facts to frozen KIR without TypeScript semantic delegation; dependency: M3. | Merged at `032f9e57`; focused F5, cumulative F4, core, build, lint, pin, generation, and independent review evidence passed before integration. It remains nonterminal. |
| **P0 — packed KIR-backed Review preview** | Productize accepted F5 behind a packed authenticated projection boundary, add KIR-native Review model/diff/findings, expose advisory preview/dual modes, and preserve legacy defaults; dependency: M4 only. | Planned `pnpm test:kern-review-kir-preview`, packed ESM/CLI consumer, semantic mutation matrix, formatter-only equality, no-legacy-call traps, full 22-package release policy, and independent review are green on the exact candidate. No KERN 5 terminal row is promoted. |
| **R0 — independently unlockable contract cells** | R0-KIR is accepted F5 KIR/provenance; R0-ABI is executable runtime/compiler conformance; R0-PKG is authenticated package resolution; R0-SVC is the service wire/budget contract; dependency: M4. | FE/REV start from R0-KIR now. Other lanes start when their own cell passes its claim-tagged REDs; no lane waits for an unrelated cell and no terminal gate is promoted. |
| **R1 — parallel walking skeleton** | FE, C-JS, C-PY, RT, INT, and REV implement their smallest complete boundaries against only the cells they consume. RT publishes executable ABI conformance before compiler fan-out. | The representative KERN fixture compiles/runs on JavaScript and Python; Review reports one semantic change; focused lane gates are green. Review is advisory during R1. |
| **R2 — ecosystem microservices** | JavaScript gateway uses one locked npm export; Python compute service uses one locked PyPI export; dependency: the participating R1 boundaries and R0-SVC. | Planned `pnpm test:kern-microservices` builds and runs both services in clean locked roots, checks lifecycle/wire/cancellation/logging, reproduces artifact hashes, and rejects lock/package/export/policy/wire mutations. KIR Review evidence is mandatory and fail-closed. |
| **R3 — product ownership promotion** | Integrate frontend production routing, both compiler targets, runtime shadow, ecosystem imports, and KIR-backed Review; dependency: R2. | `test:kern-frontend`, `test:kern-compiler`, and `test:kern-interpreter-shadow` become current and green atomically with ledger/matrix truth updates. |
| **R4 — self-hosting fixed point** | KERN compiler/runtime build themselves from clean packed inputs; dependency: R3. | `pnpm test:selfhost-fixed-point` is current and Stage 1 equals Stage 2 twice. |
| **R5 — canonical cutover** | Normal compile/run/review consumers use KERN-owned semantics; TypeScript is explicit oracle only; dependency: R4. | `pnpm test:kern-canonical-cutover` is current and import/call/fallback traps prove no silent legacy reachability. |
| **R6 — exact packed RC** | Build and independently reproduce the accepted packed release candidate; dependency: R5. | `pnpm test:packed-release` is current and green, including both microservices, npm/PyPI clean installs, Review, recovery walls, and exact artifact identity. Completion grants only technical acceptance; K5-CS7 still forbids publication without explicit authority. |

## Parallel Execution Phases

### P0 — Ship the Review preview first

- **RP0:** package the authenticated F1-F5 projection without repository
  `scripts/`, `examples/`, workspace links, or stale outputs.
- **RP1:** derive a KIR-native Review model from decoded module KIR and source
  provenance.
- **RP2:** implement semantic diff/findings for public API, imports/exports,
  dependencies, capabilities, calls/effects, and structural changes.
- **RP3:** add explicit advisory preview/dual CLI and package surfaces; preserve
  existing Review defaults and make canonical failures visible.
- **RP4:** pack the exact 22-package train and prove ESM/API/CLI behavior from a
  fresh consumer root before recommending any release.

**Exit:** planned `pnpm test:kern-review-kir-preview` and the exact packed
consumer gate are green, independent review has no verified blocker, and the
candidate is ready for a separate version/publication decision.

### R0 — Complete independently unlockable contract cells

- **R0-KIR:** use the accepted F5 KIR/provenance boundary immediately for FE
  productionization and KIR-backed REV work.
- **R0-ABI:** execute representative JSON, async I/O, concurrency,
  cancellation, logs, latency, and memory behavior on provisional JavaScript
  and Python adapters. The probe observes accepted KIR semantics; disagreement
  stops the cell and cannot redefine semantics.
- **R0-PKG:** decide authored import syntax and freeze a normalized artifact
  descriptor while preserving raw npm SRI/PyPI lock identity. Authenticate raw
  lock bytes, resolver identity, adapter contract, and byte-identical clean
  regeneration.
- **R0-SVC:** freeze typed HTTP/JSON, health/readiness, cancellation, logging,
  latency, throughput, and memory fixtures/budgets.
- Record cell schemas and REDs in planned
  `scripts/kern-5-r0-contracts/manifest.json`, executed by planned
  `pnpm test:kern-5-r0-contracts`.
- Assign non-overlapping directories and one integration owner to every lane.

**Exit:** each lane can build independently as soon as the cells it consumes
are versioned. Both compiler targets additionally require executable runtime
ABI conformance; unrelated unfinished cells do not block FE, REV, or another
ready lane.

### R1 — Build six lanes concurrently

- **FE:** route real product source through F1-F5 and close only
  service-discovered syntax/diagnostic gaps.
- **C-JS/C-PY:** compile the shared accepted KIR subset to deterministic ESM and
  Python.
- **RT:** execute the shared value/control/effect/capability ABI.
- **INT:** resolve and validate one locked npm and one locked PyPI import.
- **REV:** consume F5 KIR/provenance for semantic diff and impact reporting.

**Exit:** both targets run the pure walking-skeleton fixture and Review reports
the exact semantic delta. Review remains advisory during R1 and becomes
mandatory and fail-closed at R2 convergence.

### R2 — Prove the microservice product

- Build a JavaScript gateway service and Python compute service from KERN.
- Exercise target-native npm/PyPI packages, typed HTTP/JSON, health/readiness,
  logs, timeout/cancellation, and clean shutdown.
- Treat packages as separate versioned adapter contracts; require parity for
  KERN semantics and the shared wire contract, not arbitrary third-party
  package internals.
- Run planned `pnpm test:kern-microservices` from
  `scripts/kern-5-microservices/manifest.json`: create two fresh roots, perform
  strict offline locked installs, build, launch, poll health/readiness, exchange
  typed requests, exercise timeout/cancellation, verify logs, stop processes,
  rebuild for identical hashes, and reject lock/package/export/policy/wire
  mutations.
- Review the source change and report API, dependency, capability, call/effect,
  and target-compatibility impact from canonical KIR.
- Treat missing Review evidence, analysis errors, legacy-parser fallback, or a
  fabricated empty result as a hard R2 failure.

**Exit:** the two-service proof passes from clean locked environments with no
legacy semantic fallback.

### R3 — Promote product ownership

- Promote frontend, compiler, and interpreter-shadow gates only after the
  integrated microservice candidate is green.
- Update ledger, fitness policy, support matrix, release train, and docs
  atomically.
- Keep legacy TypeScript implementations as forced oracles.

**Exit:** `test:kern-frontend`, `test:kern-compiler`, and
`test:kern-interpreter-shadow` are current and green.

### R4 — Prove self-hosting

- Build Stage 1 from Stage 0 and Stage 2 from Stage 1 in separate clean roots
  using immutable packed inputs.
- Require byte identity twice after only enumerated normalization.
- Reject workspace links, stale outputs, untracked inputs, and cached receipts.

**Exit:** `test:selfhost-fixed-point` is current and green.

### R5 — Perform canonical cutover

- Move compile, run, Review, CLI, browser, and required consumers to canonical
  KERN semantics.
- Trap every normal call/import/fallback edge into the TypeScript parser,
  compiler, ReferenceRunner, and legacy KERN Review parser.
- Keep forced-TypeScript oracle mode explicit and green.

**Exit:** `test:kern-canonical-cutover` is current and green.

### R6 — Prove and optionally publish the exact RC

- Pack once, test those exact files, reproduce independently, and record
  source/tool/contract/stage/package hashes.
- Prove both microservices, locked npm/PyPI installation, semantic Review,
  fixed point, maintained consumers, recovery, and two clean fitness walls.
- Pause before tag/registry work unless explicit publication authority exists.

**Exit:** `test:packed-release` is current and green. If publication is
separately authorized, final source equals RC source and registry/tag evidence
is durable.

## Slice Protocol

For each non-trivial slice:

1. Fetch and branch each lane from the same accepted integration SHA; never
   reuse a merged branch or edit another lane's owned directory.
2. Ground the claim in current source and write/update a claim-tagged spec.
3. State a 3-5 bullet plan, confidence, dependencies, and binary acceptance.
4. Prove the missing behavior RED at the baseline, then implement the smallest
   complete ownership boundary.
5. Keep handwritten source below 500 lines and policy configurable.
6. Run focused lane tests first. Run combined walls at declared convergence
   milestones and the complete KERN 5 wall only at promotion/cutover/final
   candidate boundaries.
7. Run the local gate, then independent Agon review using automatic risk routing
   and the verified primary implementer identity. Resolve the live usable roster
   from configuration; never hardcode it.
8. Verify every finding against current source, fix genuine blockers, and rerun
   affected gates.
9. Create granular KERN-signed commits. Push the complete feature branch once
   only when authorized; never use `gh`, never push to `main` without explicit
   confirmation, and hand over the PR URL emitted by native `git push`.
10. Integrate through one owner against the accepted R0 cell contracts. Record
    each landed SHA, ownership gained, exact gate counts, review result,
    remaining ledger, and next convergence milestone.

## Binary Definition of Done

- [ ] The KIR-backed Review preview is available from packed packages and CLI,
      useful on real `.kern` diffs, formatter-insensitive, explicitly advisory,
      and incapable of silent legacy fallback.
- [ ] All eight target gates are present, current, and green.
- [ ] KERN owns canonical parse, check, format, compile, and execution behavior.
- [ ] KIR v1 is the actual canonical product contract.
- [ ] JavaScript output loads an exact locked npm export through the external
      package capability contract.
- [ ] Python output loads an exact locked PyPI module/export through the same
      logical contract.
- [ ] KIR-backed Review reports semantic/API/dependency/capability/call-impact
      changes and ignores formatter-only changes.
- [ ] The Node gateway and Python compute service build, boot, communicate,
      report health/readiness, enforce timeout/cancellation, log, and stop
      cleanly from locked environments.
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

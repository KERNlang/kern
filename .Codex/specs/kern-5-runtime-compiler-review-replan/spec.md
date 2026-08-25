# KERN 5 Runtime, Compiler, Frontend, Interoperability, and Review Replan

**Status:** SPEC — ADVERSARIALLY CORRECTED STRATEGIC EXECUTION RESET
**Date:** 2026-08-24
**Baseline:** `032f9e574673dcc1ca497458452556da49e2d4cd`
**Challenges:** `nero-1787555691679-5r65hu`; independent low-risk review
`review-1787555824379-qqtfnu`
**Confidence:** 0.88 before challenge; 0.89 after corrections, capped by the
three OPEN product decisions below

## Executive Summary

KERN 5 will be executed as a product-first, parallel program. The completed
frontend stages remain an active productionization lane, but they no longer
serialize compiler, runtime, interoperability, or Review work. Independently
unlockable contract cells replace one global R0 barrier: accepted F5 KIR and
provenance unlock FE and REV now; an executable runtime/compiler ABI cell
unlocks RT, C-JS, and C-PY; a package-manifest cell unlocks INT; and a service
wire/budget cell unlocks integration fixtures. The lanes converge through two
deployable KERN microservices before self-hosting, canonical cutover, and the
packed release. The first shippable convergence is a KIR-backed Review preview
release, described by
`.Codex/specs/kern-review-kir-preview-release/spec.md`.

The product definition is:

> A developer can write, review, compile, run, and deploy a KERN microservice.
> KERN owns source semantics, KIR projection, target compilation, and runtime
> behavior. Small host adapters provide explicit capabilities and locked access
> to npm and PyPI packages; they do not select language semantics.

## Current State and Root Cause

- **[RCR-C1 VERIFIED]** The integrated baseline contains the KERN-owned F1-F5
  source-to-KIR path. F5 remains private and nonterminal; its own contract says
  F6 was to own adversarial closure and F7 terminal promotion.
  Evidence: `.Codex/specs/kern-5-f5-kir-projection/spec.md:15-22` and merged
  baseline `032f9e57`.
- **[RCR-C2 VERIFIED]** The production compile command is still host-owned. It
  imports `parseWithDiagnostics`, TypeScript classifiers, generators, target
  transpilers, and host filesystem orchestration before selecting output.
  Evidence: `packages/cli/src/commands/compile.ts:1-55,93-110,529-575`.
- **[RCR-C3 VERIFIED]** A substantial TypeScript core runtime already models
  KERN values, environments, functions, control flow, classes, and execution.
  It is valuable as a compatibility oracle, but it parses expressions through
  TypeScript modules and contains explicitly deferred runtime semantics.
  Evidence: `packages/core/src/core-runtime/index.ts:1-30,37-76,120-225,341-423`.
- **[RCR-C4 VERIFIED]** Python emission exists, including import-aware handler
  output and FastAPI integration, but the emitter still injects the TypeScript
  expression classifier and rejects capability nodes until an emitted
  capability ABI exists.
  Evidence: `packages/python/src/codegen-body-python.ts:143-151,489-545,732-739`.
- **[RCR-C5 VERIFIED]** Review already accepts `.kern`, TypeScript/JavaScript,
  and Python files and has native rules, structural diff, taint, call-graph,
  confidence, and cross-file machinery.
  Evidence: `packages/review/src/index.ts:1-16,740-771,1081-1187` and
  `packages/cli/src/commands/review.ts:1429-1445`.
- **[RCR-C6 VERIFIED]** Native KERN Review still parses `.kern` through the
  TypeScript parser and TypeScript classifiers rather than consuming the
  accepted F5 KIR artifact.
  Evidence: `packages/review/src/index.ts:1081-1118`.
- **[RCR-C7 VERIFIED]** The repository detects npm/pnpm lockfiles and Python
  project files and can generate Python requirements files, but no accepted
  KERN-owned package-import ABI binds a KIR import to a locked npm or PyPI
  artifact. Evidence:
  `packages/core/src/scanner.ts:218-250,403-413`,
  `packages/cli/src/shared.ts:478-502`, and
  `rg -n 'npm:|pypi:' packages/core/src packages/python/src packages/cli/src`
  returned no package-scheme implementation on 2026-08-24.
- **[RCR-C8 VERIFIED]** The baseline completion goal before this replan was
  sequential and measured 60/66 promoted gates while compiler, runtime,
  imports, cutover, and the packed product remained open. Evidence:
  `git show 032f9e57:.Codex/goals/KERN-5-COMPLETION-GOAL.md`, lines `32-38`,
  `190-206`, and `223-310`.

The execution problem is therefore not lack of frontend evidence. It is the
serial dependency model: more frontend proof has repeatedly been treated as a
prerequisite for starting the compiler, runtime, interoperability, and Review
product paths. The reset advances every lane as soon as its own executable
contract cell is ready; unrelated cells never block it.

## What Already Works

- F1-F5 provide an authenticated source-to-canonical-KIR foundation.
- Checker and formatter are current products.
- Existing TypeScript codegen/runtime and Python/FastAPI emitters provide
  compatibility behavior and differential fixtures; they are not discarded.
- Review already has reporting, baselines, rule execution, taint, graphs,
  suppressions, SARIF/JSON output, and multi-language file discovery.
- Existing package scanning and requirements generation can be adapted after
  the package-import contract is frozen.
- Existing fitness and terminal ledgers remain useful release controls.

This replan does not reopen accepted frontend semantics, replace KIR, or delete
compatibility implementations. New frontend work must be justified by a
service, compiler, runtime, interoperability, or Review requirement.

## Product Contract

> Verified against baseline `032f9e57` on 2026-08-24.

| Boundary | Required behavior | Evidence / status | Tag |
| --- | --- | --- | --- |
| Source input | `.kern` module set reaches accepted F5 canonical KIR | F1-F5 baseline | VERIFIED |
| Frontend | Normal product path uses KERN-owned F1-F5 stages; legacy parser is explicit oracle only | Existing F1-F5 plus new cutover work | DECIDED |
| Compiler | KIR-to-target semantic selection is KERN-owned; host writes validated bytes only | Missing product boundary | DECIDED |
| JavaScript target | Deterministic executable ESM for the accepted service subset | Existing TS generator is oracle | DECIDED |
| Python target | Deterministic executable Python for the same accepted subset | Existing Python emitter is oracle | DECIDED |
| Runtime | KERN owns values, calls, control flow, errors, effects, cancellation, and capability requests | Existing TS runtime is oracle | DECIDED |
| npm import | Exact package/version/integrity/export binding from a checked lock manifest | Missing | DECIDED |
| PyPI import | Exact distribution/version/hash/module binding from a checked lock manifest | Missing | DECIDED |
| Host adapter | Loads a locked package or performs an explicit capability; cannot inspect or rewrite KIR semantics | New narrow boundary | DECIDED |
| Review | Consumes canonical F5 KIR plus source provenance for semantic diff and policy analysis | Existing Review uses legacy IR | DECIDED |
| Microservices | Node gateway calls Python compute service over a versioned HTTP/JSON contract | New product proof | DECIDED |
| Fallback | Unsupported canonical input fails before output/effects; no silent TypeScript retry | Existing goal requirement | VERIFIED |

The KIR remains target-neutral. JavaScript- or Python-specific metadata belongs
in versioned target-lowering profiles and artifact manifests, never in the
shared semantic KIR. If the R0 executable probe cannot lower the representative
fixture without adding target semantics to KIR, parallel implementation stops
for a KIR contract decision.

### Import semantics

The accepted product meaning of “npm and Python imports” is target-native:

- the JavaScript target may bind an authorized KIR external import to one exact
  npm package export;
- the Python target may bind an authorized KIR external import to one exact
  PyPI distribution/module export;
- the lock manifest records package identity, version, integrity/hash, target,
  requested export, and capability class;
- policy decides allowed packages and capabilities. Package names, versions,
  registries, and allowlists are configuration, never hardcoded policy;
- ordinary KERN-to-KERN module imports remain distinct from external package
  imports;
- cross-runtime service calls use an explicit service capability and versioned
  wire contract. RPC is not a substitute for target-native package imports.

An npm package and a PyPI package are not assumed to be equivalent
implementations. Each external adapter owns a package-specific, versioned
behavior contract. Cross-target parity applies to package-free KERN semantics
and shared service-wire fixtures; package-backed services must satisfy their
declared adapter and wire contracts. Self-hosting fixed-point identity never
depends on third-party package outputs.

Every resolved external package also emits one normalized artifact descriptor:

- ecosystem (`npm` or `pypi`), canonical package/distribution name, version,
  registry/source, target, and resolved export/module;
- normalized digest `{algorithm, value}` plus the ecosystem's raw lock identity
  (npm SRI or PyPI hash record); and
- capability class, resolver version, and package-specific adapter-contract
  identity.

Before an external capability becomes active, policy pins the exact raw lock
bytes, normalized artifact manifest, and resolver identity. Independent
regeneration from a clean locked environment must produce byte-identical
manifests. Normalization permits shared verification without pretending npm SRI
and PyPI hashes are the same native format.

The concrete authored syntax is **OPEN** until the shared-contract slice
compares an explicit `external use` form with a URI-like path form. This human
decision does not block the documentation reset, but it must be resolved before
an import oracle or implementation is written.

### Review semantics

Review receives the canonical KIR and source provenance emitted by the accepted
frontend. It must report at least:

- semantic KIR changes while ignoring formatter-only edits;
- public declaration/export and handler-signature changes;
- dependency, external-package, and capability additions/removals;
- changed calls, effects, and reachable service boundaries;
- module impact and affected callers;
- diagnostic/source-span changes;
- target-compatibility differences between JavaScript and Python.

Review may continue to analyze TypeScript and Python source directly. The KERN
path, however, must stop rebuilding semantics through
`parseWithDiagnostics` once the canonical frontend is promoted.

### First product goal — KIR-backed Review preview

Before the microservice convergence, productize F5 as a packed authenticated
source-to-KIR service and use it to ship an advisory KIR-backed Review preview.
The preview must report semantic API/import/export/dependency/capability/call/
effect changes and ignore formatter-only edits. It is opt-in during the preview
window and must surface canonical projection/analysis failure rather than
silently falling back to legacy parsing.

This goal advances FE and REV together immediately from R0-KIR. It does not
wait for R0-ABI, R0-PKG, or R0-SVC, and it does not block those cells or their
lanes. The proposed release label is `4.8.0`; the exact version and publication
still require explicit human authority.

## Execution Model

### R0 — Independently unlockable contract cells

R0 is a set of concurrent cells, not a global phase barrier. A lane starts when
its declared cell is executable and versioned; it does not wait for unrelated
cells.

| Cell | Contract and evidence | Unlocks |
| --- | --- | --- |
| **R0-KIR** | Accepted F5 KIR plus authenticated source provenance; already present at the baseline | FE and REV immediately |
| **R0-ABI** | Runtime value/completion/error/effect/capability ABI, compiler request/result, target artifact manifest, and a representative cross-target executable probe | RT, C-JS, and C-PY |
| **R0-PKG** | External-import syntax decision, normalized artifact descriptor, raw lock authentication, resolver identity, adapter contract, and deterministic regeneration | INT |
| **R0-SVC** | Versioned HTTP/JSON schema, health/readiness, timeout/cancellation, structured-log, latency, throughput, and peak-memory budgets | Reference-service fixtures and convergence |

R0-ABI executes records/lists, JSON encode/decode, error propagation, one
async boundary, cancellation/timeout, concurrent requests, and structured logs
on provisional JavaScript and Python adapters. It observes whether the already
accepted KIR semantics can be represented; it does not define or silently
revise those semantics. If observed target behavior disagrees with accepted
KIR, the cell stops for a contract decision. It also stops for target-specific
semantic KIR fields, incompatible value/error/cancellation behavior, mutable
runtime-internal coupling, or an unbounded budget regression.

The planned executable contract bundle is
`scripts/kern-5-r0-contracts/manifest.json`, verified by the planned command
`pnpm test:kern-5-r0-contracts`. Each cell has its own version and RED fixtures.
A versioned integration bundle records compatible cell versions at a
convergence milestone; it does not delay independent lane work and does not
promote a terminal gate.

### Parallel lanes unlocked per contract cell

| Lane | Ownership | First deliverable | May change |
| --- | --- | --- | --- |
| **FE** | Frontend productionization | Product source reaches F5 KIR through the CLI; service-driven missing constructs fail clearly or are implemented | F1-F5 integration, diagnostics, frontend CLI adapter |
| **C-JS** | KERN compiler + JavaScript | Minimal service KIR emits deterministic executable ESM against the frozen runtime ABI | compiler KERN modules, JS target adapter |
| **C-PY** | KERN compiler + Python | Same service subset emits deterministic Python against the frozen runtime ABI | compiler KERN modules, Python target adapter |
| **RT** | KERN runtime | Values, functions, control flow, errors, effects, cancellation, capabilities execute from KIR | runtime KERN modules, host capability adapter |
| **INT** | Interoperability | One locked npm export and one locked PyPI export load and execute | import manifest/resolvers, policy, packaging |
| **REV** | Review | KIR semantic diff and dependency/capability impact report | Review KIR adapter/rules/reporting |

Each lane owns separate source directories and tests. A cell contract is
read-only after that cell is accepted; any change requires an integration
decision and versioned skew plan. One integration owner combines lane commits
at defined convergence points. RT publishes executable ABI conformance fixtures
before C-JS/C-PY fan-out and on every versioned revision; directory separation
alone is not treated as decoupling.

### Convergence milestones

1. **Walking skeleton:** frontend → KIR → target artifact → runtime for one pure
   function plus representative JSON/async/concurrency/cancellation/logging
   probes on JavaScript and Python; Review shows one semantic change; latency
   and memory remain inside the configurable R0 budgets.
2. **Interop service:** JavaScript service calls one locked npm package; Python
   service calls one locked PyPI package.
3. **Microservice proof:** Node gateway and Python compute service build, boot,
   expose health/readiness, exchange typed JSON, log one trace, handle timeout,
   and shut down cleanly.
4. **Ownership cutover:** normal CLI compile/run/review paths cannot reach
   TypeScript semantic selection; explicit oracle mode remains available.
5. **Self-host and release:** KERN builds its compiler/runtime, Stage 1 equals
   Stage 2, and the exact packed candidate passes recovery and consumer walls.

Review is advisory during R1 lane development so an incomplete REV lane cannot
deadlock FE/INT/compiler merges. It becomes mandatory evidence at R2
microservice convergence and a blocking product gate at R3 promotion. From R2
forward, missing Review evidence, legacy-parser fallback, analysis errors, or
an empty fabricated result fail closed before candidate promotion.

The Review preview is an earlier, nonterminal product release: its planned
`pnpm test:kern-review-kir-preview` and packed-consumer gate must pass without
promoting any KERN 5 terminal row.

## Implementation Options

### Option A — Parallel product lanes unlocked by contract cells (recommended, 0.89)

Use the lanes above, integrate at the five convergence milestones, and keep
focused gates inside lanes. This exposes real blockers early and keeps
frontend, compiler, runtime, interoperability, and Review advancing together.

### Option B — Continue the historical sequential frontend-first ladder (0.45)

Finish all frontend adversarial and promotion work before compiler/runtime.
This preserves simple dependency ordering but delays every user-visible
capability and repeats the execution problem this replan addresses.

### Option C — Start targets immediately without a shared ABI (0.55)

This maximizes initial activity but creates incompatible value, import,
capability, and artifact contracts. Integration churn would erase the speed
gain. Rejected.

## Documentation Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `.Codex/specs/kern-5-runtime-compiler-review-replan/spec.md` | add | Authoritative strategic reset and cross-lane contract |
| `.Codex/specs/kern-review-kir-preview-release/spec.md` | add | First shippable KIR-backed Review product goal |
| `.Codex/goals/KERN-5-COMPLETION-GOAL.md` | update | Make compiler/runtime/microservices/Review the execution center |

Future implementation blast radius is deliberately not frozen here. Each lane
must write a bounded satellite spec when its required contract cell is ready.

## Binary Acceptance Criteria

- [ ] **RCR-A0 Feasibility:** target-neutral KIR executes the representative
      JSON/async/concurrency/cancellation/logging probe on provisional
      JavaScript and Python adapters without target-specific KIR fields, ABI
      divergence, or unbounded latency/memory regression. The probe observes
      accepted semantics; any disagreement stops for a contract decision rather
      than becoming a new semantic rule.
- [ ] **RCR-A1 Frontend:** a clean CLI invocation routes reference-service
      source through F1-F5 and produces the exact accepted KIR; legacy parser
      traps remain untouched in normal mode.
- [ ] **RCR-A2 JavaScript compiler:** accepted KIR produces deterministic ESM,
      runs the pure-function and service fixtures, and dies when KERN compiler
      selection is replaced by the TypeScript generator.
- [ ] **RCR-A3 Python compiler:** the same semantic fixture produces
      deterministic Python with equal observable results and no TypeScript
      expression parse during normal compilation.
- [ ] **RCR-A4 Runtime:** canonical KIR executes values, calls, control flow,
      errors, effects, cancellation, and capability requests with exact
      completion/trace parity; unsupported input is atomic.
- [ ] **RCR-A5 npm:** a clean install resolves one exact locked npm package
      export, rejects version/integrity/export/allowlist mutations, and records
      the dependency in the normalized artifact manifest. Raw lock bytes,
      resolver identity, and normalized output are authenticated; independent
      regeneration is byte-identical.
- [ ] **RCR-A6 PyPI:** a clean environment resolves one exact locked PyPI
      module export and rejects distribution/version/hash/export/allowlist
      mutations, with the same normalized-manifest and regeneration proof.
- [ ] **RCR-A7 Review:** formatter-only source changes produce no semantic
      change, while public API, import, capability, call/effect, and target
      compatibility mutations each produce the expected KIR-backed finding.
      The first packed delivery is governed by the Review-preview satellite
      and planned `pnpm test:kern-review-kir-preview`.
- [ ] **RCR-A8 Microservices:** the Node gateway and Python compute service
      build from KERN, boot from clean locked environments, pass
      health/readiness and typed request/response tests, propagate one timeout,
      emit structured logs, stay inside configured latency/memory budgets, and
      stop cleanly. The planned `pnpm test:kern-microservices` reads
      `scripts/kern-5-microservices/manifest.json`, creates two fresh roots,
      performs strict offline locked installs, launches and polls both services,
      exercises request and cancellation behavior, stops every process, then
      repeats the build to prove artifact hashes. Lock, package, export, policy,
      and wire mutations must fail.
- [ ] **RCR-A9 Parallel integrity:** every lane passes its focused gate; only
      convergence milestones run the combined frontend/compiler/runtime/Review
      wall. No full repository wall runs after each small commit.
- [ ] **RCR-A10 Cutover:** import/call/fallback traps prove normal
      compile/run/review cannot reach the TypeScript parser, compiler,
      ReferenceRunner, or legacy Review parser.
- [ ] **RCR-A11 Fixed point:** two clean Stage 1/Stage 2 builds are byte-equal
      after only enumerated normalization.
- [ ] **RCR-A12 Release:** existing terminal ledger, support matrix, release
      train, exact packed RC, recovery, and consumer evidence agree before
      public 5.0.0.

## Gate Policy

- Keep the existing eight terminal rows. Do not add top-level gates merely to
  represent lanes.
- Review-preview, R0-contract, and microservice commands are sub-gates. Their
  future slices own authenticated manifests; they are not added to the terminal
  remaining-gate ledger merely because this plan names them.
- npm/PyPI and semantic Review are mandatory evidence inside
  `test:kern-compiler`, `test:kern-frontend`, and
  `test:kern-canonical-cutover`.
- Run focused lane gates during development.
- Make the packed KIR-backed Review preview the first shippable convergence;
  keep it advisory and nonterminal.
- Keep KIR-backed Review advisory during R1 and make it blocking at R2/R3.
- The planned `pnpm test:kern-review-kir-preview` must fail closed on missing evidence,
  analysis errors, legacy-parser fallback, or a fabricated empty result at
  R2/R3.
- Run combined gates at walking-skeleton, microservice, cutover, fixed-point,
  and packed-RC milestones.
- Run the complete KERN 5 fitness wall only at meaningful promotion/cutover
  boundaries and on the final candidate.
- A high-confidence implementation still receives risk-routed independent
  review, but review is performed on complete bounded slices rather than every
  mechanical sub-edit.

## Out of Scope

- Reopening accepted F0-F5 semantics without a product fixture that proves a
  blocker.
- Arbitrary unpinned package loading, runtime `eval`, implicit network
  installation, or silent fallback.
- Requiring one process to host Node and CPython simultaneously.
- Building a general service mesh, orchestrator, or cloud platform before the
  two-service proof.
- Adding a new public KIR schema solely for Review.
- Publishing, tagging, or deploying KERN 5 from this documentation change.

## Open Questions

1. **[OPEN — product decision]** Authored external-import syntax:
   explicit `external use` versus a URI-like path. Resolve in R0-PKG.
2. **[OPEN — product decision]** First npm and PyPI packages used by the
   reference service. Select packages with deterministic, offline-testable
   behavior in R0-PKG; package identities must remain policy/config values.
3. **[OPEN — product decision]** Reference-service domain. The default is a
   small gateway plus compute service, but the user may choose a more valuable
   business example without changing the architecture.

These questions do not block committing the replan. They block only the
corresponding R0-PKG or R0-SVC fixture and implementation.

## Deploy and Skew Order

1. Land this documentation reset without changing code or gate status.
2. Land the Review-preview RP0/RP1 contract/model slices and independently
   unlockable R0 contract-cell manifests/RED fixtures in parallel;
   old production paths remain default.
3. Land lane implementations behind private selectors that fail closed.
4. Integrate the walking skeleton and microservice proof in shadow mode.
5. Promote frontend/compiler/runtime/Review consumers atomically only after
   their combined cutover gate passes.
6. Retain explicit forced-TypeScript oracle mode through the KERN 5 release.
7. Publication remains separately authorized.

## Corrections Log

| Original claim | Reality | Impact |
| --- | --- | --- |
| Frontend adversarial closure had to finish before compiler/runtime work began. | F5 already supplies a stable KIR boundary; FE and REV can start now, while target/runtime work proceeds when R0-ABI is executable. | Replace the serial ladder with lanes unlocked by only their own contract cells. |
| Gate count represented practical product progress. | 60/66 current gates coexist with no KERN-owned production compiler/runtime or locked ecosystem imports. | Report vertical capabilities and convergence milestones first. |
| Review improvement should wait for runtime cutover. | Review can consume F5 KIR now for semantic diff and dependency/capability analysis. | Add a parallel Review lane. |
| Python interoperability primarily meant a sidecar. | Target-native Python/PyPI imports and cross-service RPC solve different problems. | Require both target-native import evidence and a separate service wire contract. |
| A static global R0 schema freeze was sufficient to unlock six lanes. | Target/runtime impedance requires an executable ABI, but unrelated frontend, Review, package, and service cells can advance independently. | Replace global R0 with R0-KIR, R0-ABI, R0-PKG, and R0-SVC contract cells. |
| Separate directories made compiler/runtime lanes independent. | Emitters depend on runtime value/error/cancellation behavior. | Require executable RT conformance fixtures before target fan-out and on every ABI revision. |
| Review could block every lane immediately. | An incomplete REV lane would deadlock unrelated progress. | Keep Review advisory in R1; require it at R2 and block promotion at R3. |
| npm and PyPI packages had to behave identically. | Third-party ecosystems are not semantic twins. | Apply parity to KERN semantics/wire contracts and package-specific adapter contracts separately. |
| Ecosystem-native integrity strings were enough for a shared import contract. | npm SRI and PyPI hashes have distinct raw identities and verification rules. | Preserve raw lock identity and emit one normalized artifact descriptor with deterministic regeneration. |
| An R0 feasibility probe could establish semantics. | Accepted KIR defines semantics; the probe may only expose target incompatibility. | Make disagreement a stop condition instead of letting provisional adapters become normative. |
| Review could return empty or legacy evidence at convergence. | Mandatory evidence that silently degrades is not a gate. | Keep R1 advisory, then fail closed on missing/error/legacy/fabricated evidence from R2. |
| A prose microservice milestone proved deployment. | Process lifecycle and clean-root reproducibility need a binary oracle. | Plan `test:kern-microservices` with two clean roots, process polling, mutations, cleanup, and repeated artifact hashes. |

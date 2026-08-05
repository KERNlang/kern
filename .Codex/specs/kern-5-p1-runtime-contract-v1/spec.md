# KERN 5 Phase 1.1 — Runtime Contract v1 Freeze

**Status:** APPROVED FOR IMPLEMENTATION — SEMANTIC RED CONFIRMED
**Date:** 2026-08-04
**Initial confidence:** 0.86
**Post-red-team confidence:** 0.82
**Current confidence:** 0.98
**Parent objective:** Phase 1 of `.Codex/goals/KERN-5-COMPLETION-GOAL.md`
**Authorization:** tribunals `tribunal-1785836219802-0adpbe`,
`tribunal-1785843131349-r3cziy-kern-5-p1-closed-recovery-plan`, and
`tribunal-1785844077598-d99wm8-kern-5-p1-scheduler-effect-ledge`; each 4/4
succeeded, with the final recovery boundary approved

## Executive Summary

Phase 1 requires frozen KIR, handler, capability, diagnostic, UTF-8 location,
observable trace, determinism, limit, and rejection contracts before
`pnpm test:kern-ir` or `versioned-kir-v1` can be promoted. The live repository
has complete Alpha structural/evidence precursors and a default-off public
`kern.runtime.handler.v1`, but the eligibility record still marks the runtime
ABI unfrozen and defers trace/handler/capability contracts to M3. **VERIFIED**

This slice freezes only the already-public runtime handler contract as a
prerequisite. It adds a closed semantic constitution, observed conformance,
append-only version lineage, public-to-internal parity, raw-debug-trace
unreachability, defined-edge acyclicity, pre-effect rejection, and conditional
determinism gates. It does not freeze or promote KIR v1. **DECIDED**

The later Phase 1 composition slice must bind this immutable runtime contract
to the existing structural KIR, diagnostic/location evidence, coverage, and
clean-SHA receipt before it may introduce `pnpm test:kern-ir`. **GUARD**

## Authority and Baseline

- The completion goal at current `origin/main` is authoritative over older
  release-train prose that deferred these ABIs to R2/M3. **DECIDED**
- The isolated baseline is commit
  `5797d48d22072d74a9fd32db7d584799fa46d7eb`. **VERIFIED**
- On 2026-08-04, `pnpm fitness:kern-5` passed from a clean isolated worktree,
  including the 732-test canonicalizer suite and all current KIR/runtime
  gates. **VERIFIED**
- `KERN_RUNTIME_HANDLER_ABI` is `kern.runtime.handler.v1`; the public handler
  is default-off and exported as `./runtime/handler`. **VERIFIED**
- Eligibility currently has `runtimeAbiFrozen: false`, keeps KIR/public/cutover
  claims false, and contains stale M3 deferrals for trace, handler, and
  capability ABIs. **VERIFIED**

## Tribunal Plan Delta

Red-team tribunal `tribunal-1785834977419-sut609` approved the two-slice
sequence but rejected the first draft boundary. It required explicit answers
for semantic digest authority, immutable version evolution, declared versus
observed events, evidence lineage, and diagnostic/location composition. It
also required semantic mutants for raw Trace reachability, graph cycles, and
pre-effect rejection rather than source hashes or boolean claims. **VERIFIED**

Synthesis tribunal `tribunal-1785835634942-krv9w7` accepted the architecture
but rejected four exact contradictions: production-only RED imports could not
exercise structural seams, provider-result rejection was assigned the wrong
effect phase, module dependency acyclicity was mislabeled call-graph
acyclicity, and neither the durable authority nor declaration oracle was
named. **VERIFIED**

This revision resolves those contradictions, makes the constitution normative
instead of source-digest-derived, keeps whole-file hashes as receipts only,
and adds realizable semantic proof obligations. **DECIDED**

### Independent-review recovery delta

The first complete implementation passed the local fitness wall but full-roster
review reproduced three blockers: dynamic loader escapes were not classified,
the declaration oracle froze names rather than complete types, and the observed
authority contained only three cases. Recovery tribunal
`tribunal-1785842338148-rcx6t9-kern-5-p1-review-blocker-recover` rejected a
generic rebuild because completeness was still author-defined. **VERIFIED**

Tribunal `tribunal-1785843131349-r3cziy-kern-5-p1-closed-recovery-plan`
approved a fresh A2/B2 reconstruction only after freezing a machine-readable
proof inventory, a complete ordered declaration schema, an independent B2
proof floor, and explicit behavior/ingress/limit/effect IDs. Prior candidate
commits are superseded and may validate neither introduction nor promotion.
Any failed pre-push gate requires a fresh pair, never amend or a third commit.
**DECIDED**

While implementing the hostile scheduler matrix, current behavior proved that
caller-authorized scheduler controls are installed before execution-phase
capability-input validation. Tribunal
`tribunal-1785844077598-d99wm8-kern-5-p1-scheduler-effect-ledge` approved an
invariant-first correction: scheduler/provider-timeout controls are a separate
conditioned transcript, while the three-phase semantic ledger covers provider,
publication, and state effects. Counts are frozen as witnesses; the normative
invariant is balanced cleanup with zero residual control resources. **DECIDED**

### Safe-pattern authority review delta

Targeted review after dynamic-loader flow closure found that lexical `resolve()`
path matching rejected legitimate symlinked and case-normalized checkouts and
that the two helper token-tree pins lacked an auditable inspection workflow.
Red-team tribunal
`tribunal-1785929471749-569pbj-runtime-authority-operability` required symmetric
filesystem canonicalization, labeled source/built authority records, explicit
canonical-collision rejection, independent missing-artifact behavior, one
shared digest kernel, and a print/check-only report with no update mode.
**VERIFIED**

The authority continues to admit exactly two declared filesystem identities;
it does not authorize hardlinks, twins, directory containment, basenames, or
identical contents at another path. Canonicalization failure and source/built
canonical collisions fail closed. The report records TypeScript version, Git
blob identity, expected digest, and actual digest, but changing a pin remains a
manual reviewed source edit and never approves helper semantics automatically.
**DECIDED**

Fitness policy keeps the exact frozen `test:kern-runtime-contract-v1` command.
Its existing `*.test.mjs` wildcard continuously executes the print-only report;
the operator-facing invocation remains the documented direct `node` command,
not a new root package-script authority. **GUARD**

Receipt review found that the safe-pattern authority files were executable but
absent from the Alpha receipt denominator. Receipt-binding tribunal
`tribunal-1785931003251-bl8ifw-runtime-safe-pattern-receipt-bin` required the
implementation, digest kernel, print-only CLI, regression test, and normative
operator authority document to be bound explicitly, plus self-binding for the
Alpha receipt implementation and its test. The existing runtime-contract
oracle remains sufficient because its frozen wildcard executes the safe-pattern
test and CLI; no new root script or receipt oracle is introduced. **DECIDED**

This claim-tagged specification is a design and recovery record, not the
runtime receipt's semantic authority. The immutable constitution, lineage,
goldens, declaration schema, proof inventory, executable enforcement, and
operator authority named by the receipt remain the normative boundary.
**GUARD**

Follow-up receipt review proved that a hand-maintained directory manifest still
omitted four executed validator tests, the core parity test, the shared timer
observer, and the canonical receipt serializer. Synthesis tribunal
`tribunal-1785931613321-fccuwp-runtime-receipt-derived-denomina` replaced that
manifest with a closed flat-directory invariant: live regular files are derived
from `scripts/runtime-contract-v1/`, pinned explicitly in policy, and compared
exactly; non-files, empty inventories, and case-folded duplicates reject. Core
tests outside the directory remain explicit existence-checked bindings, and the
serializer joins the self-bound receipt authority. **DECIDED**

The closed directory contains normative artifacts only and has no exclusion
list. Generated or temporary output belongs under ignored roots such as
`.kern/`. Out-of-directory imports remain explicit bindings; a complete import
graph is intentionally deferred because it would conflate type-only, generated,
and dynamic dependencies beyond this receipt correction. **GUARD**

## Frozen Boundary

The exact v1 boundary is:

1. ingress ABI, request, identity, options, scheduler control, and limits;
2. sync and async capability call/context/provider domains;
3. canonical portable result/value/slot encodings;
4. observable envelope completion, outcome, runtime diagnostics, and events;
5. failure partition between thrown programmer/config errors and returned
   link/execution envelopes;
6. rejection order under the declared three-phase effect model;
7. conditional determinism over admitted inputs and normalized external
   transcripts;
8. the machine-only runtime owner graph and acyclic runtime module dependency
   graph reachable from the public package entry. **DECIDED**

The observable trace ABI is exactly the normalized public envelope event set:
`stdout`, `stderr`, and `capability`. Raw semantic `Trace` and every other
debug-only event are excluded and must be unreachable from public declarations
and exports. **DECIDED**

## Blocking Ambiguity Resolutions

### A. Semantic authority and digest input

The checked-in v1 constitution is the normative semantic source. It contains
closed, canonical JSON inventories for ABI identity, fields, variants,
diagnostic codes, event operations, limits, errors, rejection phases, and
determinism qualifications. The validator rejects unknown or reordered data
and derives the eligibility claim from successful semantic checks. **DECIDED**

The checker compares that constitution independently against:

- the TypeScript public declaration surface after build;
- literal runtime identities and accepted-key inventories;
- public and internal envelope shape parity;
- observed exact-byte sync/async fixtures; and
- hostile mutation fixtures. **GUARD**

Whole-source SHA-256 values are receipt bindings only. They are not semantic
authority and cannot make a changed contract valid by being regenerated.
Toolchain and config inputs that affect emitted declarations are closed receipt
bindings, while behavior remains independently exercised. **DECIDED**

### B. Immutable version evolution

The v1 ledger is append-only. `kern.runtime.handler.v1` permanently names one
semantic constitution and one independent golden-byte fixture set. A semantic
change requires a new ABI identifier and a new ledger row; the v1 row and its
goldens remain runnable. Compatible implementation changes may retain v1 only
when every v1 semantic and observed oracle remains byte-identical. **DECIDED**

Mutation tests must kill deletion, replacement, reordering, aliasing, or digest
rewriting of the v1 row. Updating a source file and a receipt hash together is
allowed only when the normative v1 constitution and all v1 observations stay
unchanged. Changing v1 semantics and its expected digest together remains a
failure because the independent v1 golden corpus is not generated from the
live source. **GUARD**

The durable authority is an exact two-commit local sequence shipped in one
push. Evidence-introduction commit A adds the v1 constitution, ledger row,
literal golden corpus, and validators while every promotion claim remains
false. Promotion commit B records A's full SHA and changes only promotion
policy, receipt/fitness wiring, documentation, and any review-required fixes.
The final gate uses `git show A:<path>` to recover the accepted v1 constitution,
ledger row, and goldens, then compares current v1 bytes and semantics against
that ancestor. A must be an ancestor of B and must contain no authority record
that validates itself. A live policy, live digest, or B's own contents can
never serve as the root. **DECIDED**

The feature is pushed only after both commits and the complete branch diff pass
review. CI or a shallow clone lacking A fails closed with an actionable
history-required diagnostic; any workflow that runs this gate must fetch the
anchored history. No public tag or registry action is involved. **GUARD**

Commit A contains exactly the constitution, immutable v1 ledger row, literal
sync/async goldens, declaration oracle, graph/effect validators, and tests. All
promotion claims remain false. A contains neither its own SHA nor any authority
record that validates A. **GUARD**

Commit B pins A's full 40-character SHA and introduces promotion policy,
receipt/fitness wiring, CI history configuration, and truthful documentation.
If review changes any constitution, ledger, golden, or semantic authority
artifact, A must be rebuilt and B repinned; such a change may never be repaired
only in B. **GUARD**

The final gate validates the anchor syntax, rejects A equal to B or HEAD,
requires `git merge-base --is-ancestor A B`, recovers every v1 authority
artifact with `git show A:<path>`, byte-compares the current artifacts against
A, and rejects any artifact that supplies its own authority. Missing A is a
hard failure with an exact history-fetch diagnostic. The validator performs no
network fetch. **DECIDED**

### C. Declared versus observed behavior

The freeze is both structural and observed. The public flag-on sync and async
entrypoints run an independent corpus covering success, link failure,
execution failure, capability invocation, scheduler cancellation/timeout,
boundary limits, portable-value rejection, and ingress/config exceptions.
Expected envelope bytes are literal fixtures, never produced by the runtime
under test. **DECIDED**

Determinism is conditional on the admitted request, limits, normalized
capability transcript, and scheduler/cancellation transcript. The contract
does not claim determinism for arbitrary providers, wall-clock races, or
uncontrolled host state. **GUARD**

### D. Evidence lineage

No Alpha evidence is replaced. The composition inventory is:

| Existing evidence | Slice disposition |
|---|---|
| semantic ownership | carried unchanged; required by new aggregate |
| KIR eligibility | extended with one derived runtime freeze state |
| canonical value | carried unchanged; reused by KIR, not claimed as runtime ABI authority |
| structural constitution/codec/module graph | carried unchanged |
| coverage witness ledger/closure | carried unchanged |
| diagnostic/location evidence | carried unchanged and separately versioned |
| Alpha receipt policy | extended to bind the runtime constitution, ledger, validator, and oracle |
| runtime envelope/runtime ABI gates | promoted as prerequisites of the new aggregate |
| handler/source import closures | promoted and strengthened with cycle and public reachability proofs |

The new aggregate must fail if any carried oracle is removed or if the receipt
omits a new normative/runtime enforcement file. **GUARD**

### E. Diagnostics and UTF-8 location composition

`kern.runtime.handler.v1` runtime diagnostics intentionally remain location
free: category, stable code, and link/execution phase are their complete
identity. KIR diagnostic identities and zero-based half-open UTF-8 byte spans
remain the separately versioned `kern.kir.evidence.r1.5d.1-alpha` contract.
Neither format is widened in this slice. **DECIDED**

The final `test:kern-ir` composition must bind both contracts and define the
mapping from KIR diagnostic/span evidence to runtime link diagnostics without
placing evidence locations inside KIR semantic bytes or retroactively changing
the runtime v1 diagnostic shape. **GUARD**

## Graph and Effect Semantics

The runtime module dependency graph starts at the real public package entry and
includes runtime ESM imports/re-exports, import-equals/require, direct literal
require, literal dynamic import, package-entry and source-alias edges, and the
built JavaScript closure. Non-literal loaders fail closed. Type-only edges are
reported separately and must not be confused with runtime cycles. **DECIDED**

The machine-only owner allowlist covers linking, admission, normalization,
scheduling, scalar evaluation, effect execution, capability dispatch, and
sync/async completion. Compatibility/reference/legacy owners, runtime export
bridges, and dynamic loader/code-generation escapes are forbidden at any
depth. The frozen escape inventory covers `process`, `module`, `globalThis`,
`global`, `eval`, `Function`, `createRequire`, `importScripts`, `Deno`, `Bun`,
`WebAssembly`, and constructor-chain access in direct, aliased, and computed
forms. This is a dependency and dynamic-code boundary, not a sandbox claim
over ordinary host globals such as timers. **GUARD**

Rejection evidence uses three exact phases:

- `pre-dispatch-before-effect`: invalid ABI/request/options/limits,
  unsupported handler admission, invalid handler arguments, and invalid
  capability input produce zero provider calls, semantic events,
  publications, later dispatch, or state changes;
- `post-provider-pre-publication`: an invalid provider result permits exactly
  one authorized provider call but zero event/result publication, later
  dispatch, or state mutation; and
- `post-effect-declared-result-mismatch`: already-observed authorized effects
  are not rolled back, while the public failure envelope suppresses result and
  event publication. **DECIDED**

Caller-authorized scheduler and provider-timeout controls are conditioned
transcripts outside the semantic ledger. For invalid capability input the
literal witness matrix covers: no scheduler; live signal; pre-aborted signal;
timeout only; and combined signal+timeout. Every installed listener or timer
is cleaned up, leaving zero residual resources. A pre-aborted signal wins
terminal precedence; immediate invalid input wins before a live timeout.
Guarantees apply to scheduler objects conforming to the documented signal
protocol, not hostile proxies that throw from their own methods. **DECIDED**

Each hostile fixture uses poisoned getters, event sinks, timers, abort hooks,
later providers, and state observers appropriate to its phase. Async provider
validation permits its one mandated provider-scope timeout plus cleanup. A
blanket zero-provider-call or zero-control-effect claim is forbidden for
post-provider validation. **GUARD**

## Claims Allowed After This Slice

- `kern.runtime.handler.v1` runtime contract frozen;
- handler and capability ABI frozen at the public default-off boundary;
- observable normalized event ABI frozen;
- conditional determinism and defined rejection ordering proven;
- raw debug Trace unreachable from public ABI;
- runtime module dependency graph acyclic under the enumerated source,
  generated-entry, and built-JavaScript edge model;
- runtime owner graph machine-only under an enumerated allowlist. **DECIDED**

## Explicit Non-Claims After This Slice

- KIR v1 frozen, canonical, versioned, shipped, or promoted;
- `pnpm test:kern-ir` implemented or current;
- Alpha/public KIR reader export;
- KIR-to-runtime semantic binding or cutover;
- unconditional determinism;
- raw debug Trace as a public ABI;
- recursion-free function call graphs;
- zero provider invocations for invalid provider results;
- any contract artifact asserting its own version validity;
- Phase 1 or any later completion-goal phase complete. **GUARD**

## Expected File Boundary

- add a focused runtime-contract v1 constitution, append-only ledger,
  proof inventory, complete public declaration schema, validator, checker, and
  hostile tests below `scripts/runtime-contract-v1/`;
- add independent observed fixtures/tests below `packages/core/tests/`;
- add `assertPublicRuntimeHandlerDeclaration(declarationText)` in a focused
  declaration validator because the current direct declaration test has no
  injected-reader or mutation seam;
- strengthen runtime public import/type reachability and module-cycle checks;
- add `test:kern-runtime-contract-v1` and wire it into current fitness/infra;
- configure every CI workflow that runs the gate with `fetch-depth: 0`; a
  developer may fetch the pinned A object explicitly, but the validator never
  fetches or skips;
- update eligibility validation and receipt bindings/oracles;
- reuse the validation and result conventions of
  `scripts/check-kir-v1-eligibility.mjs` and the adjacent structural
  constitution/ledger gates rather than creating a divergent proof inventory;
- reconcile support-matrix, release-train, and fitness policy language without
  promoting `kir-v1` or `versioned-kir-v1`. **PROPOSED**

No new handwritten source file may exceed 500 lines. Operational limits remain
config inputs; protocol identities and closed schema variants may be literal
and documented. **GUARD**

## Semantic RED Oracle

Behavioral RED cases import only the existing public
`@kernlang/core/runtime/handler` entry. Structural, eligibility, and evidence
RED cases may import existing repository validator functions and use their
existing injected-reader seams. No RED imports a planned artifact or fails
because a planned artifact is absent. **DECIDED**

One `node:test` file records five current-state cases:

1. **Proof inventory:** inspect current fitness and receipt inputs and assert
   that a promoted runtime-v1 constitution, durable ancestor anchor, literal
   sync/async goldens, declaration mutation oracle, and phased rejection
   corpus are required. It fails with a sorted explicit missing-proof list,
   never a missing-file exception.
2. **Eligibility mutation:** load current eligibility through
   `validateKirV1Eligibility`, change only `runtimeAbiFrozen` to true, and
   assert acceptance. Current validation rejects the promotion because the
   contracts remain deferred.
3. **Declaration boundary:** read the existing built public declaration and
   first prove the current surface contains no raw `Trace`. Then assert that
   the aggregate provides a declaration-text mutation oracle. It currently
   fails with `missing declaration mutation oracle`; the RED does not pretend
   that the import-closure checker validates type reachability. GREEN adds the
   named `assertPublicRuntimeHandlerDeclaration(declarationText)` seam and
   synthetic raw-Trace/alias/unknown-channel mutants.
4. **Defined-edge cycle:** call existing `runtimeImportClosure` with an injected
   map containing `runtime-handler.ts -> handler-entry.ts -> runtime-handler.ts`
   and assert a cycle diagnostic. Its visited-set traversal currently accepts
   the cycle, producing a semantic RED.
5. **Behavior/effect evidence:** invoke the existing public entry with one
   malformed pre-dispatch request plus a poisoned provider, and one valid
   capability dispatch whose provider returns a non-portable value. First prove
   the observed zero-call versus one-call/zero-publication behavior, then
   assert current fitness/receipt evidence freezes those phase claims. The
   final assertion currently fails with an explicit missing-proof list.
   **DECIDED**

The checked-in test-only RED is
`packages/core/tests/runtime-contract-v1-red.test.mjs`. On 2026-08-04 it ran
5 tests with 0 passes and 5 intended semantic failures; module resolution,
build output, synthetic graph reads, and public behavioral sub-assertions all
succeeded. The clean full precursor fitness wall passed immediately before the
test-only spec/RED changes. **VERIFIED**

The RED is semantic even if a planned file is absent: it must report missing
freeze evidence as the contract failure, while all old gates remain green.
Missing imports, build failures, and environment failures are invalid REDs.
**GUARD**

## Binary Acceptance

- [x] Revised full-roster tribunal approves this boundary with no unresolved
      dependency.
- [x] Semantic RED fails for the intended missing-proof reasons while all
      precursor gates stay green.
- [ ] Constitution and ledger are closed, canonical, append-only, and mutation
      complete.
- [ ] A2 proof inventory and B2 raw proof floor agree on every exact edge,
      declaration, behavior, ingress, limit, scheduler, and effect ID.
- [ ] Public declaration/source/internal/observed shapes agree exactly.
- [ ] Raw Trace public reachability and every defined module-cycle mutant die.
- [ ] Rejection mutants satisfy the exact pre-dispatch,
      post-provider-pre-publication, or post-effect evidence phase.
- [ ] Conditional determinism and exact sync/async bytes hold over the closed
      fixture corpus.
- [ ] Eligibility derives only `runtimeAbiFrozen: true`; all KIR/public/cutover
      claims remain false.
- [ ] Receipt lineage and CI/meta-gate wiring are complete.
- [ ] Focused tests, lint, build/type checks, full `pnpm fitness:kern-5`, and
      `git diff --check` pass.
- [ ] Full-roster independent Agon review finds no verified blocker.

## Kill Switches

- Any KIR v1, public export, semantic cutover, or Phase 1 completion claim.
- Any v1 semantic expectation generated from the live implementation.
- Any source digest used as the semantic authority.
- Any raw Trace/debug event reachable from public declarations or exports.
- Any graph claim that ignores a defined runtime edge class.
- Any contract artifact used to assert its own version validity.
- Any pre-dispatch fixture that invokes poisoned host behavior, or any
  post-provider fixture that publishes downstream effects.
- Any location field added to runtime v1 merely to duplicate KIR evidence.
- Any edit to the primary dirty checkout.

## Authorization Void Conditions

Implementation authorization immediately returns to tribunal if:

- delivery deviates from the exact two-commit, one-push A-then-B sequence;
- a rebase rewrites A without regenerating B's pin and rerunning all affected
  gates;
- any missing-history path skips, substitutes live files, or fetches from
  inside the validator;
- commit A contains self-SHA or self-authority data;
- commit B changes a v1 semantic authority artifact instead of rebuilding A;
- any claim exceeds the verbatim allowed boundary or contradicts an explicit
  non-claim. **GUARD**

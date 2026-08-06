# KERN 5.0 Release Train

**Status:** PLAN ONLY
**Date:** 2026-07-10
**Baseline:** `main` at `477063a1`; source version `4.5.0`
**Architecture:** `docs/kern-5-own-language-plan.md`
**Oracles:** `docs/kern-5-release-oracles.md`
**Recommended bar:** Bar C via B
**Schedule confidence:** 0.82
**Sequence confidence:** 0.94
**Adversarial pass:** Agon Nero `nero-1783661241064-hz8z9t`

## Release Decision

KERN 5 should use four evidence stages, but only one required public release:

```text
R0 release machinery
        |
        v
internal Alpha: contracts and non-circular runtime seam
        |
        v
internal Beta: feature complete, all new paths blocking in shadow
        |
        v
internal RC: canonical cutover, exact packed artifact proof
        |
        v
public v5.0.0: same accepted source SHA, version-injected and promoted
```

Alpha, Beta, and RC are quality bars recorded by commit SHA and an immutable
release manifest. They do not change package versions or create public releases
by default. A public Beta or RC is justified only when a named external consumer
cannot test the packed tarballs or a downstream canary.

This keeps npm and CI noise low during a projected 14-24-calendar-day train.
It also avoids pretending that a prerelease is useful merely because SemVer can
name one.

## Non-Negotiable Release Meaning

The final claim remains:

> KERN 5 parses, checks, compiles, and executes its canonical handler language
> through KERN-authored semantic tooling over versioned KIR. Host code provides
> explicit capabilities and transport only. A clean bootstrap proves the KERN
> compiler reaches a deterministic stage1==stage2 fixed point.

The following decisions are frozen for this train:

- Bar B+ is the Beta checkpoint, not an acceptable silent redefinition of
  `5.0.0`.
- If the KERN semantic interpreter cannot become canonical, the train remains
  Beta until it can. The release oracle is not weakened.
- TypeScript remains a separately selectable, continuously gated bootstrap
  oracle and emergency engine. It is never an automatic semantic fallback.
- WASM, all-target self-hosting, a package manager, and an LSP are not blockers.
- `vscode-kern` is outside the workspace package graph and outside this release;
  it needs its own version and Marketplace/Open VSX train.

## Verified Release-Machinery Gaps

These are current facts, not proposed work:

| Current behavior | Evidence | Consequence | Tag |
|---|---|---|---|
| Stable release accepts only `vX.Y.Z` | `.github/workflows/release.yml:28-37` | Public prereleases cannot use the stable workflow | VERIFIED |
| Preflight accepts only stable SemVer | `.github/workflows/release-preflight.yml:31-37` | Alpha/Beta/RC cannot preflight | VERIFIED |
| Stable publish omits `--tag` | `.github/workflows/release-pipeline.yml:89-99` | A prerelease would move npm `latest` | VERIFIED |
| Canary derives the next 4.5 patch | `.github/workflows/canary-publish.yml:72-99` | Current main produces `4.5.1-canary...`, not a KERN 5 canary | VERIFIED |
| Manual canary tag is free-form and bypasses CI | `.github/workflows/canary-publish.yml:21-27,39-43,89-93` | An operator can select `latest` without a CI result | VERIFIED |
| Publish runs no test wall | `.github/workflows/release-pipeline.yml:75-99` | The exact version-injected artifact is less proven than main | VERIFIED |
| Registry verification checks only version URLs | `.github/workflows/release-pipeline.yml:101-131` | It does not prove integrity, dependencies, install, or execution | VERIFIED |
| Publish workflows are cancellable | `.github/workflows/release.yml:7-9`; `.github/workflows/canary-publish.yml:29-31` | Cancellation can strand a partial immutable package upload | VERIFIED |
| Every release syncs its version to `dev` | `.github/workflows/release-pipeline.yml:139-210` | A prerelease would break stable-only canary generation | VERIFIED |
| CI runs on main, not dev | `.github/workflows/ci.yml:3-11` | The documented automatic canary-on-green-dev trigger has no CI run to observe | VERIFIED |

Therefore R0 is a release blocker even if all language work is already green.

## R0 - Make Publication Recoverable

**Purpose:** ensure the exact tested package graph is what reaches npm.

**Work:**

1. Create one release-policy/config source for target version, allowed channels,
   channel-to-dist-tag mapping, public package discovery, and stable-only dev
   synchronization. Workflows consume it; they do not duplicate policy.
2. Validate versions with one tested SemVer parser. Derive the channel from the
   version; never accept an arbitrary public dist-tag.
3. Reserve `latest` for stable versions. Explicitly reject it from canary,
   Alpha, Beta, and RC paths.
4. Make real publication globally serialized and non-cancellable. Concurrency
   may cancel preflight, but never an upload or tag-promotion transaction.
5. Bind the job to an exact commit SHA and injected release version. Run the
   full release wall inside that job; a separate preflight is only an early
   signal, not proof that the publish commit passed.
6. Build and pack once. Test those exact tarballs, record their SHA-512/integrity,
   then publish those exact files. Add npm provenance when the organization or
   trusted-publishing configuration is verified.
7. Compute package layers from runtime `dependencies` and
   `optionalDependencies`. Ignore `devDependencies` when ordering publication.
8. Upload every immutable version under a version-specific staging tag. Verify
   all package names, versions, internal exact dependencies, exports, binaries,
   integrity, and clean consumer execution before any public-channel movement.
9. Promote dependency layers first and `kern-lang` last. Treat the root package
   tag as the channel commit marker.
10. Verify every moved tag and run a post-promotion install by both exact version
    and channel. Only a stable final synchronizes versions back to `dev`.
11. Fix or remove the impossible automatic dev-canary trigger. A manual KERN 5
    canary must still require a recorded green SHA and a configured target
    release line.
12. Extend `check:repo` so release policy, package discovery, internal dependency
    versions, and workflow contracts cannot drift independently.

**Important limitation:** npm dist-tag updates are not atomic across packages.
The plan does not claim otherwise. Exact internal dependency pins, dependency-
first movement, a root-package commit marker, global serialization, and
roll-forward recovery make the normal install path coherent while minimizing
the unavoidable direct-package tag window.

**Recovery procedure:**

- Missing staged artifact: publish it, then resume verification.
- Existing artifact with matching integrity: treat it as complete and resume.
- Existing artifact with different integrity: hard stop; never overwrite or
  reuse the version. Diagnose and issue a new prerelease or patch version.
- Tag promotion fails before the root marker moves: leave the channel officially
  unpromoted and resume forward; do not alternate tags backward and forward.
- Root marker moved but post-promotion smoke fails: restore the root/CLI public
  entry tags to the previous coherent release, deprecate the broken version,
  and ship a fully gated next patch. Published versions are never rewritten.

**Exit gate:** simulate failure after every package layer and every tag layer;
the recovery tool resumes without republishing mismatched bytes, changing
`latest`, or producing a green result for an incomplete graph.

**Estimate:** 0.5-1.5 active days. This can overlap Alpha design, but it must
land before any public KERN 5 canary or release.

**Confidence:** 0.96 on necessity; 0.88 on the exact implementation until npm
trusted-publishing/provenance configuration is inspected.

## R1 - Internal Alpha: Freeze the Truth

**Scope:** M0-M2 from the architecture plan.

**Entry:**

- `main` baseline is green and recorded by SHA.
- Bar C, mandatory target legs, formatter wording, and exclusions are resolved.
- Every new oracle is RED at base for the intended missing behavior.

**Build order:**

**Slice progress:**

- [x] R1.1 Alpha constitution: truthful support matrix, versioned fitness
  policy, frozen current-wall oracle, canonical aggregate, and shared
  repository contract validation.
- [x] R1.2 checker v2 closure: 48/48 TS/KERN byte-matched fixtures,
  36 accept-but-abstain attacks rejected, 23 direct safe-integer cases, and the
  complete `fitness:kern-5` wall passed on 2026-07-11.
- [x] R1.3 KIR seam probe and selection: typed semantic projection selected;
  source AST and runner lowering rejected; 20/20 strict, hostile-value,
  module-graph, mutation, and subprocess checks passed on 2026-07-11.
- [x] R1.4a internal semantic KIR reader candidate: core/probe parity with no
  public export or stability claim.
- [x] R1.4b bootstrap-dependent, non-circular semantic ownership substrate:
  source-bound current TypeScript authority witness plus an acyclic,
  oracle-free planned path over the internal reader candidate. This is not
  executable handler-semantic ownership or runtime cutover.
- [x] R1.5 eligible KIR/value/diagnostic contract freeze and Alpha manifest.
  Runtime implementation landed through M3; Phase 1.1 separately freezes its
  public default-off contract before final KIR composition.
  - [x] R1.5a source/runner eligibility inventory and identity constitution.
  - [x] R1.5b bounded strict UTF-8 canonical/value reader.
  - [x] R1.5c coverage-closed module/node writer-reader parity.
    - [x] R1.5c.1 schema and property constitution: exact source-bound census
      covers all 302 node kinds and 1,149 property contracts; full fitness wall
      and final 3/3 Agon review passed on 2026-07-12 (`ALPHA-NO-GO`).
    - [x] R1.5c.2 structural writer and bounded reader: internal browser-safe
      codec uses identical bounded canonical-value limits, a closed portable
      expression catalog, and an explicit empty type catalog; full fitness wall
      and final 3/3 Agon review passed on 2026-07-12 (`ALPHA-NO-GO`).
    - [x] R1.5c.3 module and symbol-kind parity: ordered per-source roots,
      explicit `class | fn` symbols, dependency-ordered transitive re-exports,
      pure POSIX resolution, full fitness wall, and final 3/3 Agon review passed
      on 2026-07-12 (`ALPHA-NO-GO`).
    - [x] R1.5c.4 executable coverage closure: all 302 node kinds, 1,149
      properties, and the runner-synthetic lambda contract have 2,289
      executable include/exclude witnesses; all 16 runtime contracts have
      internal composed witnesses. The historical Alpha proof remains bound
      as a constituent of the internal v1 envelope.
  - [x] R1.5d diagnostic/location evidence contract and Alpha manifest.
    - [x] R1.5d.1 separately versioned diagnostic and UTF-8 byte-location
      evidence, bound to exact source and structural KIR bytes. Full fitness
      wall and final 3/3 Agon review passed on 2026-07-12 (`ALPHA-NO-GO`).
    - [x] R1.5d.2 clean-HEAD immutable Alpha receipt generator and release
      gate: policy-bound hashes/oracles/exclusions, dirty-tree and symlink kill
      tests, full fitness wall, and final 3/3 Agon review passed on 2026-07-12.
      The SHA-named ignored receipt is generated only after commit.
  - [x] R1.5e.1 runtime-handler type KIR bridge: one neutral exact handler-type
    owner now feeds both runtime admission and canonical semantic KIR records
    for `fn.returns` plus direct structured `param.type`. The other 93
    type-annotation locations remain explicitly excluded; structural, module,
    catalog, constitution, and coverage identities are versioned together.
    The Node 22 full fitness wall and terminal `claude,codex,agy` review passed
    on 2026-07-17 with zero verified, needs-check, or speculative findings
    (`ALPHA-NO-GO`; no public KIR v1 or formatter claim).
  - [x] Phase 1.1 anchored runtime contract v1 freeze: the immutable
    `kern.runtime.handler.v1` constitution, lineage, literal sync/async goldens,
    declaration boundary, normalized event and diagnostic domains, phased
    rejection behavior, and acyclic source/built module closures are recovered
    from an exact introduction commit. `pnpm test:kern-runtime-contract-v1`
    is current; public KIR export, semantic cutover, and Phase 1 completion
    remain explicitly false.
  - [x] R1.5f internal canonical KIR v1 acceptance: strict
    `kern.kir.v1` canonical-value envelope over the unchanged Alpha module and
    evidence constituents, exact order/multiplicity/digest rejection, no root
    barrel or package export, promoted `pnpm test:kern-ir`, and an append-only
    SHA-named acceptance manifest introduced by the direct child of its clean
    accepted implementation commit. Public reader export, runtime cutover,
    semantic self-hosting, and KERN 5 completion remain false.
- [ ] R2 M3 runtime and handler ownership.
  - [x] M3.1 internal transactional runtime envelope: default-off sync/async
    normalization with closed portable values, structural diagnostics, failure
    suppression, and containment from every public export. This deliberately
    leaves the public runtime/handler ABI and effect scheduler unpromoted. The
    full fitness wall and final 3/3 Agon review passed on 2026-07-12.
  - [x] M3.2 internal typed handler entry: exact-arity portable parameters feed
    fresh sync/async runtime environments, with invalid or currently
    non-executable argument shapes rejected before handler execution. Decimal,
    nested-record, source-linking, scheduler, and public-ABI work remain
    explicitly deferred. The full fitness wall and terminal 3/3 Agon review
    passed with zero verified findings on 2026-07-12.
  - [x] M3.3 internal source handler identity/link: one bounded source document
    resolves a canonical source path and exact top-level KERN handler into the
    M3.2 typed entry. Modules, helper/class linking, scheduler, runner-contract,
    and public-ABI work remain explicitly deferred. The full fitness wall and
    final 3/3 Agon review passed with zero verified findings on 2026-07-12;
    review-discovered handler-name byte bounding is regression-covered.
  - [x] M3.4 internal capability interception seam: one private, default-off,
    versioned request/decision point routes synchronous and asynchronous handler
    capability dispatch without changing public runner or handler contracts.
    Per-handler cache identity carries the seam through rebuilt function/class
    environments without cross-call leakage. The full fitness wall and final
    3/3 Agon review passed with zero verified findings on 2026-07-12.
  - [x] M3.5 internal scheduler control: caller-supplied cancellation and
    timeout bound internal envelope execution and capability waits with closed,
    distinct diagnostics. Provider abort propagation, trace convergence,
    linking, value symmetry, and public ABI promotion remain deferred. The full
    fitness wall and final 3/3 Agon review passed with zero verified findings on
    2026-07-13.
  - [x] M3.6 private effect-machine convergence: one closed flat-statement
    corpus routes sync and async internal envelope execution through a shared
    resumable machine with explicit capability effects and raw-trace parity.
    Control-flow expansion, legacy async-mirror removal, linking, value
    symmetry, and public ABI promotion remain deferred. The full fitness wall
    and final 3/3 Agon review passed with zero findings on 2026-07-13.
  - [x] M3.7 private effect-machine `if`/`else` frames: immediate sibling
    pairing and selected nested bodies run through the shared resumable machine
    with raw-trace parity and no nested legacy fallback. Branch, try, loops,
    linking, value symmetry, and public ABI promotion remain deferred. The full
    fitness wall and terminal 3/3 Agon review passed with zero findings on
    2026-07-13; unselected else-if evaluation and smuggled pairing metadata are
    regression-covered.
  - [x] M3.8 private effect-machine `branch` frames: strict first-match/default
    selection executes only the selected path through the shared resumable
    machine in a child lexical environment. Loops, try/unwind, linking, value
    symmetry, and public ABI promotion remain deferred. The exact commit
    `64a5b6d7` passed the full fitness wall and terminal 3/3 Agon review on
    2026-07-13; review-discovered pre-effect structural closure and valid
    capability-to-format dataflow are regression-covered.
  - [x] M3.9 private effect-machine `while` frames: strict-boolean conditions
    re-evaluate around fresh iteration scopes, repeated capabilities resume
    through the shared machine, loop-local `break`/`continue` are consumed, and
    `return`/`throw` propagate. `for`, `each`, try/unwind, linking, value
    symmetry, and public ABI promotion remain deferred. The full fitness wall
    and terminal 3/3 Agon review passed with zero findings on 2026-07-13; nested
    loop control, repeated capability parity, fresh scope, and pre-effect
    structural closure are regression-covered.
  - [x] M3.10 private effect-machine counted `for` frames: evaluated-once safe
    integer ranges execute with half-open positive/negative steps, canonical
    iteration events, fresh integer-provenanced bindings, resumable capability
    effects, consumed loop control, and propagated abrupt completions. `each`,
    try/unwind, linking, value symmetry, and public ABI promotion remain
    deferred. The full fitness wall and terminal 3/3 Agon review passed with
    zero verified findings on 2026-07-13; range direction, evaluated-once
    bounds, fresh induction scope, repeated capability parity, loop control,
    pre-effect structural closure, and a caller-configured shared sync/async
    iteration budget are regression-covered.
  - [x] M3.11 private effect-machine array `each` frames: portable array and
    indexed-array shapes iterate lazily through the shared resumable machine,
    with canonical bindings, fresh scopes, shared budgets, capability parity,
    and loop completion semantics. Pair, entry, pseudo-async, try/unwind,
    linking, value symmetry, and public ABI promotion remain deferred. The
    focused runtime-envelope suite and full KERN 5 fitness wall passed on
    2026-07-13. The terminal 3/3 Agon review passed with zero actionable
    findings; its single nit concerns unchanged, deferred legacy entry shapes.
    Review-discovered non-array diagnostics and pre-read budget containment are
    regression-covered.
  - [x] M3.12 private effect-machine architecture boundary: the monolithic
    machine is split into an 80-line stable driver, 80-line contract/type
    owner, 107-line structural preflight owner, and 230-line sequence/frame
    owner with a guarded acyclic dependency direction. Runtime behavior,
    stable internal imports, and `try: 'legacy'` remain unchanged. A live,
    skip-free M3.13 manifest records the complete portable unwind acceptance
    surface. The full KERN 5 fitness wall and terminal 3/3 Agon review passed
    with zero findings on 2026-07-13. Review-discovered emitted-`.js`
    dependency guarding, complete while/for/each try-in-loop coverage, and
    pre-effect rejection evidence are regression-covered.
  - [x] M3.13 private effect-machine `try`/`catch`/`finally` frames: root and
    nested portable try shapes route through the resumable machine, with
    completion-aware whole-tree preflight, cleanup-only finally, canonical
    catch values, mandatory catch tombstoning, provider-error/cancellation
    unwind, and sync/immediate-async parity. The executable skip-free manifest
    and import-closure mutation oracle are implemented. The full KERN 5
    fitness wall passed, followed by a terminal 3/3 Agon review with zero
    verified or needs-check findings on 2026-07-13
    (`review-1783937376907-jxblxa-m3-13-terminal`).
  - [x] M3.14 legacy-free shared evaluator boundary: split runtime-only
    branch/for/if/while and portable scalar evaluator leaves so the stable
    effect-machine import closure no longer instantiates
    `reference-runner.ts`. M3.13 already severs legacy `try.ts` and keeps the
    new try executor itself legacy-free; M3.14 closes the older helper debt
    before public runtime ABI promotion. This is a static machine/evaluator
    ownership boundary, not an executable-envelope cutover: global contract
    registration and legacy fallback remain explicit M3.15 debt. The complete
    KERN 5 fitness wall passed on 2026-07-13. Review-discovered computed
    Decimal-pow parity, signed-zero, evaluator-gate selection, bare-alias, and
    peer-dependency closure gaps are regression-covered. The terminal
    `claude,codex,agy` review completed 3/3 with zero verified or needs-check
    findings (`review-1783984093881-cj5xgv-m3-14-terminal-review`), and the
    completion tribunal approved the scoped static-boundary claim
    (`tribunal-1783984246816-s1ysxv-m3-14-completion-adjudication`). The M3.15
    descendant fitness wall is regression evidence, not an isolated clean
    checkout fitness run of `d6634f1d`.
  - [x] M3.15 executable-envelope isolation: make the direct sync/async
    internal envelope route fail closed outside the machine corpus, replace
    global-registry leaf dispatch with machine-owned evaluator-injected leaves,
    and prove the complete `execute.ts`/`internal-engine.ts` runtime import
    closure excludes both reference runners, reference evaluator hosts,
    compatibility fallback, and global contract registration. Preserve the
    old fallback only behind a separately named compatibility entry until the
    handler root is isolated in the following slice. `pnpm fitness:kern-5`
    passed end-to-end on 2026-07-14; `pnpm test:kern-runtime-envelope` passed
    the complete focused runtime-envelope/evaluator suite plus the 29-case
    closure suite. The terminal `claude,codex,agy` review completed 3/3 with zero
    verified findings after adjudicating every candidate against the current
    contracts
    (`review-1783989797752-hnsl4k-m3-15-envelope-isolation-r36-fin`). Deferred
    expression atomicity and dynamic short-circuit behavior are regression-
    covered following
    `tribunal-1783981922640-sbxioy-m3-15-r32-deferred-expression-ad`.
  - [x] M3.16 handler-root isolation: switch the existing typed handler and
    source-handler sync/async roots from explicit compatibility fallback to the
    direct machine-only envelope, with no new compat handler ABI or public package
    export. Extract parser/runtime state from the public app/runner barrel and
    prove the complete handler/source emitted-runtime closure excludes compat,
    registry, reference, legacy-owner, app-descriptor, and runner modules.
    `pnpm fitness:kern-5` passed end-to-end on 2026-07-14; the combined closure
    suite passed 36/36 cases. The terminal `claude,codex,agy` review completed 3/3
    with zero findings after both review nits were fixed
    (`review-1784011660440-0jp6lw-m3-16-handler-root-isolation-ter`).
  - [x] M3.17 default-off public typed handler ABI: add the exact versioned
    `@kernlang/core/runtime/handler` source-only facade over the M3.16
    machine-only root. Request `abi` and envelope `format` are both
    `kern.runtime.handler.v1`; public declarations expose handler-owned
    operation-map capability types, never raw IR, `SemanticEnv`, runner-branded
    types, or private formats. Source admission enforces the executable
    `string | boolean | integer-only number | void` scalar/one-dimensional-list
    subset, with argument mismatch rejected before effects and result mismatch
    suppressing the public result/events without claiming host-effect rollback.
    The additive subpath remains explicitly enabled with caller-supplied limits
    and async capability timeout. `pnpm test:runtime-abi` is now a current
    fitness gate. `pnpm fitness:kern-5` passed end-to-end on 2026-07-14 after
    the promoted gate's exact policy expectation and the historical KIR-
    evidence no-promotion guard were aligned with M3 ownership. The resolved
    six-engine terminal review completed with five usable structured reviewers,
    zero verified findings after source adjudication, and one external Claude
    session-limit failure (`review-1784022774682-988gs0`). Review-discovered
    limits and argument accessor boundaries are regression-covered.
  - [x] M3.18 maintained-preview typed-handler adoption: cut the answer route
    from `executeKernEntrySourceAsync`, `app-http.queryParam`, and five stdout
    markers to `kern.runtime.handler.v1` with exact `question:string ->
    string[]` ingress/egress. The KERN handler owns the fixed
    `[answer, status, source]` result, while the host validates the closed
    envelope and projects the unchanged HTTP JSON. A return-only effect-machine
    evaluator admits portable scalar expressions at the top level of returned
    arrays; computed `let` arrays, computed nested arrays, and public ABI type
    mismatches remain fail-closed. Exact route descriptor ABI opt-in leaves
    legacy view validation unchanged and rejects unsupported signatures,
    async/stream handlers, and module syntax at load time. App-owned JSON
    limits and timeouts are validated before execution. `pnpm fitness:kern-5`
    passed end-to-end on 2026-07-14, including 432/432 cross-target fixtures,
    109/109 class fixtures, 233 native KERN assertions at 100% coverage, the
    public runtime ABI/closure gates, preview smoke, and app-behavior
    conformance. The final six-engine terminal review completed 6/6 with zero
    verified findings (`review-1784029943644-crvryy-m3-18-preview-typed-handler-fina`).
  - [x] M3.19 CoreRuntime public-ABI quarantine: removed the runtime-coupled
    `core-runtime` module family from both `@kernlang/core` and `kern-lang`
    public graphs, retained static shape facts in a runtime-neutral module, and
    kept CoreRuntime only as an internal reference implementation. The packed
    graph gate passes for both packages with 47 adversarial tests covering
    direct, transitive, namespace, alias, wildcard, JavaScript, declaration,
    renamed, and default-export restoration paths. `pnpm fitness:kern-5`
    passed twice end-to-end after the extraction; full-roster Agon review found
    and drove closure of each verified bypass. R2 M3 remains open until the
    active `executeKernSource*` compatibility runners migrate onto the
    canonical machine.
  - [x] M3.20 source-runner convergence bridge: promoted the exact portable
    `do` contract to unified effect-machine ownership and routed all four
    public source-runner APIs through one pre-execution selector. Eligible
    programs now execute on the canonical machine; explicitly deferred shapes
    use an isolated legacy adapter, with no catch-and-retry path after machine
    selection. An executable manifest keeps `expression-v1`, `lambda`,
    pair/entry `each`, helper functions, class state, non-root environments,
    and implicit loop budgets visible as follow-up debt. The browser-safe graph
    is measured and policy-bound at 1,310,717 raw / 294,834 gzip bytes across
    110 modules, with an automatic ceiling-rollback failure when the legacy
    adapter leaves the graph. `pnpm fitness:kern-5` passed end-to-end on
    2026-07-14. The terminal `claude,codex,agy` review completed 3/3 with zero
    verified findings (`review-1784058369015-oomdka`). R2 M3 remains open until
    the deferred ledger is empty and compatibility selection is removable.
  - [x] M3.21 `expression-v1` machine ownership: extracted the existing scalar,
    array, record, Decimal, and regex semantics into one registry-independent
    runtime owner shared by the semantic oracle adapter and canonical effect
    machine. Whole-tree preflight now validates expression shapes and output
    bindings before any earlier capability effect, while source-runner
    selection admits supported expression-v1 programs without catch-and-retry
    fallback. The historical public two-argument regex evaluator remains
    available through a reference adapter. The executable convergence manifest
    now records `expression-v1` as unified while `lambda`, pair/entry `each`,
    helper functions, class state, non-root environments, and implicit loop
    budgets remain explicit blockers. `pnpm fitness:kern-5` passed end-to-end on
    2026-07-14. The terminal `claude,codex,agy` review completed 3/3 with zero
    verified findings (`review-1784062012773-h9ch34`); its sole performance nit
    was adjudicated as deferred optimization because admission, precondition,
    and execution intentionally retain separate fail-closed validation points.
  - [x] M3.22 pair/entry `each` machine ownership: promoted all six bounded
    array, indexed-array, pair-sync, pair-async, entry-key, and entry-value
    shapes to one unified iterator contract. Whole-tree preflight validates the
    complete pair tuple array or plain-record receiver before any capability
    effect, and every emitted step consumes the caller-owned shared iteration
    budget before its body. Pair/entry execution uses captured Map/Object
    intrinsics, so an earlier capability cannot redirect host iteration after
    admission. Source selection and the executable convergence manifest now
    record `each` as unified. `lambda`, helper functions, runner class state,
    non-root environments, and implicit iteration budgets remain explicit
    blockers. `pnpm fitness:kern-5` passed end-to-end on 2026-07-14 after the
    review-discovered host-global poisoning regression was fixed. The terminal
    `claude,codex,agy` review completed 3/3 with zero verified, needs-check, or
    speculative findings (`review-1784066250344-bzqds0`).
  - [x] M3.23 lambda machine ownership: extracted the frozen single-expression
    lambda evaluator into one registry-independent runtime owner shared by the
    semantic adapter and canonical effect machine. Private closure values,
    bounded `List.map`/`List.filter`, deferred callback facts, stable shape
    preflight, captured host intrinsics, recursive setup-closure rejection, and
    deterministic failure timing are now machine-owned. Source selection and
    the executable convergence manifest record `lambda` as unified; helper
    functions, runner class state, non-root environments, and implicit
    iteration budgets remain explicit blockers. Runtime and stable preflight
    now share non-primitive arithmetic guards, and identity-aware closure facts
    reject alias/reassignment recursion before effects. `null` intentionally
    remains distinct from `undefined` in the shared owner. `pnpm
    fitness:kern-5` passed end-to-end on 2026-07-15 after the current-roster
    review findings were fixed; five of six engines returned and Kimi timed out
    (`review-1784108789206-i2rjfh-m3-23-lambda-review-fixes-terminal`).
  - [x] M3.24 same-root helper machine ownership: PR #530 moved reachable,
    synchronous, pure KERN helpers onto canonical effect-machine sequence
    re-entry with per-run registry, recursion, cache, and shared iteration
    state. Unsupported graphs still select compatibility before execution;
    imported/effectful/async helpers, runner classes, non-root environments,
    and implicit iteration budgets remain deferred. Post-merge hardening
    isolated overlapping async runs sharing one environment, required an
    explicit portable return on every helper path, preserved machine state for
    `Text` integer indexes, and proved exact nested-loop budget charging.
    `pnpm fitness:kern-5` passed end-to-end on 2026-07-15 with 432/432
    conformance, 109/109 class, 48/48 checker, and 39/39 self-host verdicts.
    The terminal `claude,codex,agy` review completed 3/3 with zero verified,
    needs-check, or speculative findings
    (`review-1784133690272-jea8yz-kern-5-r2-m3-24-terminal-post-bl`).
  - [x] M3.25 caller-owned iteration-budget configuration: added one optional,
    positive safe-integer budget to all four public source-runner APIs and the
    `kern run --iteration-budget` surface. The exact value now reaches sync,
    real-async, entry, and async-to-sync execution without an embedded default;
    omission preserves compatibility selection. Loop, bounded-lambda, and
    reachable-helper programs prove exact admission and exhaustion, while
    invalid values reject before provider execution. The executable manifest
    now records `iteration-budget` as unified, leaving only class state and
    non-root environments deferred. `pnpm fitness:kern-5` passed end-to-end on
    2026-07-15 with 432/432 conformance fixtures, 109/109 class fixtures, 233
    native assertions, 48/48 checker fixtures, 39/39 validator verdicts, and a
    browser wall of 128 modules / 1,384,412 raw / 305,749 gzip bytes / 75 ms
    median execution. The `claude,codex,agy` review completed across its main
    run and one focused timeout retry with zero findings
    (`review-1784141350527-jna9fu-kern-5-r2-m3-25-iteration-budget`,
    `review-1784141541689-hzqupd-kern-5-r2-m3-25-iteration-budget`).
  - [x] M3.26 same-root state-only class ownership: the canonical machine now
    owns linker-admitted local class allocation, scalar field initialization,
    restricted direct-assignment constructors, own-field reads/writes, and
    receiver identity across async suspension. Each run snapshots its admitted
    class registry; overlapping runs and caller replacement cannot share or
    alter instance state. Deferred constructor arguments and field writes use
    shape-only synthetic preflight, and unowned class metadata rejects before
    accessor invocation. Methods, getters, inheritance, imported classes,
    helper/class mixing, nested allocation/mutation, and non-root environments
    remain explicit compatibility paths. `pnpm fitness:kern-5` passed
    end-to-end on the final post-review state on 2026-07-16 with 432/432
    conformance, 109/109 class, 233 native
    core assertions, 48/48 checker fixtures, 39/39 validator verdicts, and a
    browser wall of 131 modules / 1,402,747 raw / 309,088 gzip bytes / 79 ms
    median execution. Deferred metadata, linked-root selection, field-read,
    and constructor initialization-order gaps found during review were fixed
    with focused regressions. The final terminal `claude,codex,agy` pass
    completed 3/3; Codex reported no findings, Agy only nits, and Claude's
    selector claim was adjudicated against the direct-eligibility call chain
    and passing nested-mutation oracle
    (`review-1784157448784-n8yhbw-kern-5-r2-m3-26-class-state-post`).
  - [x] M3.27 pure direct same-root class methods: the canonical machine now
    snapshots and owns linker-admitted instance methods containing exactly one
    portable scalar return. Calls require an exact private-owned identifier
    receiver, exact scalar arity, and a complete root `let`, `print`, or
    `return` value. Method metadata and bodies are immutable across async
    suspension; aliases, optional/missing dispatch, nested calls, mutation,
    helpers, deferred arguments, and invalid returns select compatibility
    before provider dispatch. Getters, inheritance, `super`, imported classes,
    and non-root environments remain deferred to M3.29 and M3.28 respectively.
    The focused suite covers public source parity, sync and real-async dispatch,
    metadata tamper, receiver forgery, and the complete negative admission
    boundary. Final aggregate fitness and terminal review evidence are recorded
    in the M3.27 completion spec.
  - [x] M3.28 authentic non-root environment ownership: the canonical source
    runner now admits exact lexical children created by `childEnv`, validates
    the complete private parent chain without invoking accessors, preserves
    nearest-scope reads and exact declaring-scope writes, and revalidates the
    chain after every sync or async provider before generator resume. Forged,
    reparented, spliced, cyclic, metadata-invalid, unowned, or active-call entry
    frames remain compatibility paths. Resume validation preserves
    machine-created aliases, normalized structured capability results, live
    portable scalar updates, and the captured-intrinsics contract while
    rejecting unowned or cyclic composites. `non-root-environment` is now
    unified; `runner-classes-state` remains the sole exact M3.29 convergence
    blocker. The final `pnpm fitness:kern-5` wall passed on 2026-07-16 with
    432/432 conformance fixtures, 109/109 class cases, 233 native cases, 48/48
    checker fixtures, 39/39 validator verdicts, and 40 application fixtures on
    three legs plus whole-app boot. The browser wall passed at 135 modules /
    1,432,650 raw / 313,744 gzip bytes / 49 ms cold / 76 ms median. The 3/3
    `claude,codex,agy` review fixed ancestor-accessor ordering and falsy-input
    hardening; its global-prototype proposal was adjudicated against the frozen
    captured-intrinsics regression
    (`review-1784167478723-wugqlu-kern-5-r2-m3-28-non-root-environ`).
  - [x] M3.29 pure same-root class getters: the canonical source runner now
    snapshots linker-owned zero-parameter getters containing exactly one pure
    scalar return. Exact private instance reads preserve field precedence and
    admit getters only as complete root `let`, `print`, or `return` values;
    nested dispatch, mutation, allocation, calls, effects, optional access,
    and invalid metadata reject before provider dispatch. Getter bodies remain
    stable across async suspension. `runner-class-pure-getters` is unified,
    while the full `runner-classes-state` row remains the sole exact M3.30
    blocker for inheritance, overrides, `super`, module scopes, and effectful
    class frames. The final `pnpm fitness:kern-5` wall passed on 2026-07-16
    with 432/432 cross-target fixtures, 109/109 class fixtures, 233 native
    cases, 48/48 checker fixtures, 39/39 validator verdicts, and 40 application
    fixtures on three legs plus whole-app boot. The browser wall passed at 135
    modules / 1,436,090 raw / 314,151 gzip bytes / 49 ms cold / 81 ms median.
    The terminal `claude,codex,agy` review completed 3/3 with zero verified,
    needs-check, or speculative findings and three nits
    (`review-1784171484079-3dpyff-kern-5-r2-m3-29-pure-class-gette`).
  - [x] M3.30 constructorless same-root class inheritance: the canonical source
    runner now snapshots finite same-root lineages, initializes scalar fields
    base-to-derived with derived-field-wins semantics, and resolves pure
    methods/getters derived-to-base while preserving declaring-owner metadata.
    Unknown, cyclic, cross-module, non-linker-owned, constructor-bearing,
    kind-changing, arity-changing, impure, nested, or metadata-replaced graphs
    select compatibility before provider dispatch. The new
    `runner-class-constructorless-inheritance` row is unified; the full
    `runner-classes-state` row remains the sole exact M3.31 blocker for
    constructor/`super` ownership, imported scopes, and effectful class frames.
    The exact `pnpm fitness:kern-5` wall passed on 2026-07-16 with 432/432
    cross-target fixtures, 109/109 class fixtures, 233 native cases, 48/48
    checker fixtures, 39/39 validator verdicts, and 40 application fixtures on
    three legs plus whole-app boot. The browser wall passed at 136 modules /
    1,440,946 raw / 314,961 gzip bytes / 57 ms cold / 103 ms median. All six
    usable Agon engines completed the terminal review; consensus found zero
    verified defects, and the sole blocking verdict was disproved by the
    linker-identity ownership check and made explicit in the regression
    (`review-1784184896071-7m2bxe-kern-5-r2-m3-30-constructorless-`).
  - [x] M3.31a resumable same-root class frames: constructors, methods, and
    getters now run the unified machine sequence through generator-owned
    activations that suspend on the existing capability request and resume
    without replay. Nested calls in constructor arguments, binary/template/
    conditional expressions, and lazy short-circuit branches preserve order;
    provider failures unwind private frame bindings and machine state without
    compatibility retry; ordinary field writes are not advertised as a
    transactional rollback. Capability planning and execution share one
    semantic admission predicate and the same single-module scope builder, so
    only exact owned frames lose their `unsupported` marker. Class-body loops consume the
    caller-owned iteration budget. Helper/class composition, `super`, effectful
    fields, imported classes, and module identity remain fail-closed for
    M3.31b/c; the parent `runner-classes-state` blocker stays visible. The
    current KERN 5 wall passed with 432/432 cross-target fixtures, 109/109 class
    fixtures, 233 native cases, 48/48 checker fixtures, 39/39 validator
    verdicts, and 40 application fixtures on three legs plus whole-app boot.
    The M3.31a browser baseline is 146 modules / 1,477,446 raw / 320,266 gzip
    bytes / 61 ms cold / 99 ms median with the same fixed 5% anti-bloat
    margin. All six usable Agon engines completed terminal review; two blocking
    verdicts were disproved by the current control flow and successful full
    build, while the remaining reports were covered regressions, conservative
    admission, or documented M3.31b/c boundaries
    (`review-1784199956730-meez5j-kern-5-r2-m3-31a-terminal-final`).
  - [x] M3.31b1 Option-C constructor/super lifecycle: the canonical source
    runner now owns implicit no-argument base initialization and one leading
    top-level explicit `super(...)` with literal, constructor-parameter, or
    call-free `this`-independent scalar arguments. One most-derived private
    receiver is initialized recursively in language order: base layer, current
    fields, then the current constructor remainder. Sync and real-async base
    and derived constructors suspend without replay, retain a run-local class
    snapshot, and fail without compatibility retry or receiver leakage.
    Non-leading or nested super, `super.member`, helper/class composition,
    effectful arguments or fields, and imported/module identity remain
    fail-closed for M3.31b2/c; the parent `runner-classes-state` blocker stays
    visible. The exact final `pnpm fitness:kern-5` wall passed with 432/432
    cross-target fixtures, 109/109 class fixtures, 233 native cases, 48/48
    checker fixtures, 39/39 validator verdicts, and 40 application fixtures on
    three legs plus whole-app boot. The browser wall passed at 147 modules /
    1,486,452 raw / 321,435 gzip bytes / 60 ms cold / 90 ms median. The full
    usable review roster was dispatched; five engines returned no verified
    blocker, while Kimi timed out twice at the complete 600-second wall. All
    returned findings were adjudicated against the current contract and tree
    (`review-1784220056869-n5svyh-kern-5-r2-m3-31b1-constructor-su`,
    `review-1784220336939-kraaju-kern-5-r2-m3-31b1-constructor-su`).
  - [x] M3.31b2a declaring-owner super-method dispatch: generator-owned `let`,
    `print`, and `return` scalar leaves in same-root constructors, methods, and
    getters now resolve non-optional `super.method(...)` from the declaring
    owner's immediate base, invoke the nearest method on the existing
    most-derived private receiver, and reuse the M3.31a resumable method frame.
    Three-level lookup, caller continuation, constructor/getter use, real-async
    suspension, snapshot isolation, provider rejection, public-source parity,
    capability-planner reachability, and fail-closed admission are executable
    oracles. Helper/class composition, effectful fields, virtual
    `this.method()`, non-leaf expression slots, pre-super statements, and
    imported/module identity remain explicit M3.31b2b/c boundaries. The exact
    `pnpm fitness:kern-5` wall passed with 432/432 cross-target fixtures,
    109/109 class fixtures, 233 native cases, 48/48 checker fixtures, 39/39
    validator verdicts, and 40 application fixtures on three legs plus
    whole-app boot. The browser wall passed at 148 modules / 1,489,600 raw /
    321,881 gzip bytes / 57 ms cold / 85 ms median. All six usable review
    engines completed across the main run and a Claude-only retry; none found
    a verified blocker, and the one valid `print`-site coverage nit was closed
    (`review-1784226020031-rupwy5-kern-5-r2-m3-31b2a-super-method-`,
    `review-1784226650868-o94yce-kern-5-r2-m3-31b2a-super-method-`).
  - [x] M3.31b2b1 virtual `this.method(...)` dispatch: generator-owned `let`,
    `print`, and `return` value slots in same-root constructors, methods, and
    getters now resolve from the private receiver's concrete class, select the
    nearest override, and retain the selected declaring owner for nested
    `super` lookup. The planner carries both declaring owner and concrete
    receiver through method and constructor worklist keys, so inherited
    templates reached on different derived classes cannot collapse or pull
    unrelated same-named methods into executable scope. Three-level
    virtual-to-super chains, constructor/getter use, real-async suspension,
    mutation isolation, direct/indirect recursion, uninitialized derived-field
    failure, provider rejection, public-source behavior, and fail-closed
    admission are executable oracles. Pure helper/class composition, effectful
    fields, virtual getter/property reads, pre-super statements, and
    imported/module identity remain M3.31b2b2/c boundaries. The exact
    `pnpm fitness:kern-5` wall passed with 432/432 cross-target fixtures,
    109/109 class fixtures, 233 native cases, 48/48 checker fixtures, 39/39
    validator verdicts, and 40 application fixtures on three legs plus
    whole-app boot. The required browser wall passed at 148 modules /
    1,491,871 raw / 322,225 gzip bytes / 56 ms cold / 86 ms median. All six
    usable engines completed the initial and post-fix reviews. One post-fix
    blocking verdict was disproved by the current receiver propagation and a
    new two-derived/shared-base-constructor capability oracle; all verified
    nits were closed or recorded as explicit boundaries
    (`review-1784229445070-ij7bxg-kern-5-r2-m3-31b2b1-virtual-this`,
    `review-1784230029905-13rm3s-kern-5-r2-m3-31b2b1-virtual-this`).
  - [x] M3.31b2b2 pure class-to-helper composition: same-root constructors,
    methods, and getters now call M3.24 pure portable helpers through the
    existing per-run machine state. Class bodies seed exact helper
    reachability; the helper registry snapshots binding metadata and bodies
    before suspension; combined class preflight runs before helper-only
    admission; and the planner clears `unsupported` only for the same exact
    owned graph. Private receiver transport, helper-to-class allocation or
    member access, helper calls in `super(...)`, effects inside helpers, and
    imported/module identity remain fail-closed as explicit M3.31b2b3/c
    boundaries. Constructor/method/getter execution, before-and-after async
    capabilities without replay, class-only helper discovery, shared loop
    budget, inactive-branch preflight, overlapping-run isolation, mid-flight
    metadata mutation, public-source behavior, and local/imported planner
    dispositions are executable oracles. The exact `pnpm fitness:kern-5` wall
    passed with 432/432 cross-target fixtures, 109/109 class fixtures, 233
    native cases, 48/48 checker fixtures, 39/39 validator verdicts, and 40
    application fixtures on three legs plus whole-app boot. The required
    browser wall passed at 149 modules / 1,504,140 raw / 324,003 gzip bytes /
    60 ms cold / 92 ms median; the required repeat measured 57 ms cold / 88 ms
    median. The new convergence wall passed 433 focused
    runtime/planner units plus 27 convergence checks. The initial 6/6 Agon review
    found no verified blocker; its wrapped-private-receiver concern was made
    executable and fixed before this final fitness run
    (`review-1784236442005-xtko8x`). A second 6/6 review exposed shallow nested
    metadata snapshotting; a RED oracle, structured deep clone, and convergence
    kill mutation closed it (`review-1784238408653-tdc0cw`). A third review
    exposed missing portable array/record helper arguments; a RED oracle and
    composite-aware classifier closed that gap while its helper-only regression
    claim was disproved by the guarded selector and M3.24 suite
    (`review-1784240330837-1grirm`). The first terminal 6/6 review exposed live
    nested-call arity validation through the original function map; a RED async
    mutation oracle and convergence kill now bind nested calls to the frozen
    helper registry (`review-1784242429634-pwgyrc`). A second terminal 6/6
    review returned zero verified findings but exposed bare `this`/`super`
    receiver containment as a real needs-check; three RED graph oracles and a
    convergence kill closed it (`review-1784244496719-9oo0jq`). A third
    terminal review exposed composite helper returns escaping scalar class
    slots; declared scalar contracts, return-body proof, nested composite
    argument preservation, and two convergence kills closed the boundary and
    its M3.24 regression (`review-1784246309546-pbzrmw`). The final full-roster
    review returned five verdicts while Kimi exhausted the 600-second wall.
    Its sole verified item was commit completeness for the new untracked files;
    the unrelated-class needs-check was disproved by machine selection with a
    valid dormant class and intentional fallback for private-receiver transport
    (`review-1784249101282-nraj2q-m3-31b2b2-final`).
  - [x] M3.31b2b3 pure helper-to-class composition: an admitted M3.24 helper
    may now allocate an exact same-root class, keep its private instance inside
    the helper invocation, and return a portable scalar through owned field,
    getter, or method access. Reverse reachability follows only selected
    members, preserves inherited virtual/`super` dispatch, snapshots helper and
    class metadata before suspension, and rejects direct or nested-helper
    instance transport. Reached direct/indirect class effects fail preflight
    before provider dispatch, while unused effectful members do not poison a
    selected pure member. Planner and runtime dispositions are executable, and
    convergence mutations bind reverse ownership, instance/effect containment,
    snapshot depth, private receivers, stable local binding identity, and scalar
    return proof. Effectful class work and pre-super statements remain
    M3.31b2c; imported/module identity remains M3.31c. The exact final
    `pnpm fitness:kern-5` wall passed with 432/432
    cross-target fixtures, 233 native cases, 48/48 checker fixtures, 39/39
    validator verdicts, and 40 application fixtures on three legs plus
    whole-app boot. The required browser wall passed at 150 modules / 1,517,134
    raw / 325,833 gzip bytes / 57 ms cold / 87 ms median; all 36 convergence
    mutations were killed. The first full-roster review found private-receiver,
    scalar-argument, getter-reachability, parenthesisless-construction, and
    whole-return validation gaps; seven RED boundary oracles plus four new
    convergence kills close them (`review-1784252757692-8i784i-m3-31b2b3-final`).
    A later review's helper-local scalar-argument gap was fixed and covered
    (`review-1784254817000-7qq1xn-m3-31b2b3-terminal`). The next terminal review
    reproduced stale class-binding admission after reassignment; a provider-before-helper
    RED oracle and convergence kill close it
    (`review-1784256648627-inqwpc-m3-31b2b3-terminal-2`). The final
    `claude,codex,agy` review completed 3/3 with zero verified findings. Its sole
    needs-check, duplicate class-loop budget propagation, was disproved by the
    independent complete class-graph budget owner and existing class-frame
    budget tests (`review-1784258421483-r2xyxd-m3-31b2b3-terminal-3`).
  - [x] M3.31b2c1 pre-super constructor execution: explicit derived
    constructors now bind parameters, execute authored pre-super statements,
    evaluate pure `super(...)` arguments from definitely established locals,
    recurse into the base, initialize the current class fields, and execute the
    post-super body through one resumable class frame. Pre-super capabilities,
    three-layer descent/ascent ordering, provider failure, overlapping-run and
    metadata-snapshot isolation, and public-source behavior are executable
    oracles. Whole-graph preflight rejects receiver access, abnormal completion,
    missing or unstable locals, helper/class calls in super arguments, and
    helper-reached class effects before provider dispatch. The convergence
    owner and 37 mutation checks bind the plan partition, authored execution
    order, receiver containment, definite-binding proof, capability planning,
    and explicit M3.31b2c2/M3.31c deferrals. The final `pnpm fitness:kern-5`
    wall passed with 432/432 cross-target fixtures, 109/109 class fixtures, 233
    native cases, 48/48 checker fixtures, 39/39 validator verdicts, and 40
    application fixtures on three legs plus whole-app boot. The required
    browser wall passed at 150 modules / 1,521,167 raw / 326,404 gzip bytes /
    58 ms cold / 87 ms median. The terminal `claude,codex,agy` review completed
    3/3 with zero verified and zero needs-check findings. Its speculative
    fast-path concern was disproved because preflight preparation does not
    execute constructors and all real construction enters the resumable class
    frame; its remaining duplicate-parse item is a non-behavioral nit
    (`review-1784262755790-138qtd-m3-31b2c1-pre-super-final`). Resumable
    helper-to-class effects remain M3.31b2c2 and imported/cross-module identity
    remains M3.31c.
  - [x] M3.31b2c2 resumable helper-to-class effects: a same-root helper and any
    transitive wrapper may now enter an owned class constructor, method, or
    getter that performs a capability or print effect. Nested resumable helper
    arguments execute left-to-right exactly once before the outer cache lookup;
    observable body events bypass memoization, while pure helper/class bodies
    retain the bounded cache. Only stdout, stderr, and capability events cross
    the helper boundary, so helper-local assignment/iteration trace and private
    class identity remain contained. Frozen helper/class registries preserve
    suspended-run and overlapping-run isolation, and the planner now reports
    the admitted same-root path executable. Direct helper effects remain
    rejected, and imported/re-exported/cross-module identity remains the sole
    M3.31c follow-up. The final `pnpm fitness:kern-5` wall passed with 432/432
    cross-target fixtures, 109/109 class fixtures, 233 native cases, 48/48
    checker fixtures, 39/39 validator verdicts, and 40 application fixtures on
    three legs plus whole-app boot. The required browser wall passed at 152
    modules / 1,535,195 raw / 328,258 gzip bytes / 64 ms cold / 127 ms median,
    and all 43 convergence mutations were killed. The terminal
    `claude,codex,agy` review completed 3/3 with zero verified and zero
    needs-check findings; its one speculative classifier concern was disproved
    by scalar-first classification and the nested-helper oracle, while three
    non-behavioral allocation/traversal/explicit-boundary nits were retained
    (`review-1784269895309-ubvwed-m3-31b2c2-resumable-helper-class`).
  - [x] M3.31c module-owned helper and class identity: the canonical source
    machine now authenticates the complete linker-built module graph, snapshots
    every function/class binding once while preserving alias and re-export
    identity, and executes reached helpers and class frames in their defining
    module scopes. Helper caches, resumability, recursion labels, receiver
    dispatch, and metadata snapshots are binding-keyed rather than flattened by
    display name. The shared runtime linker now feeds both execution and linked
    capability admission; the planner follows exact imported function,
    constructor, method, and getter reachability without poisoning an admitted
    path with unused private members. `runner-classes-state` is unified/current
    and the convergence manifest has no deferred rows. The final Node 22
    `pnpm fitness:kern-5` wall passed with 432/432 cross-target fixtures,
    109/109 class fixtures, 233 native cases, 48/48 checker fixtures, 39/39
    validator verdicts, and 40 application fixtures on three legs plus
    whole-app boot. The required browser wall passed at 153 modules / 1,534,548
    raw / 328,497 gzip bytes / 75 ms cold / 108 ms browser, and all 68
    convergence mutations were killed. Reviews added and fixed binding-identity
    resumability plus imported-helper -> private-class -> private-helper budget
    reachability with RED public oracles
    (`review-1784275324468-ctztgz`, `review-1784277601118-gduk7h`). The final
    full-roster review completed on the fixed diff; its two Agy blockers were
    stale or contradicted the exact-reachability contract, Codex reported no
    findings, and Claude reported no high-confidence blocker
    (`review-1784279863324-vvtril`).
  - [x] M3.31d public runtime-handler sibling helper link: the selected typed
    source entry now retains a fresh authenticated function-only scope from the
    same parsed module. The public entry is excluded from that helper scope;
    classes and imports remain unavailable; duplicate callable helpers and
    class/function collisions fail during link. Public oracles cover transitive
    scalar helpers, list arguments, wrong arity, loop and recursion bounds,
    unreachable and reached effects, exact map ownership, sync/async byte
    parity, and overlapping-call isolation. The machine-only public import
    closure remains green after narrowing the linker dependency to the portable
    scalar domain. Focused `test:runtime-abi` and the complete Node 22
    `fitness:kern-5` wall are green. The terminal 3/3 full-roster review found
    zero issues
    (`review-1784294556508-m2mp6g-kern-5-r2-m3-31d-terminal-v2`).
- [ ] R2 M4 toolchain ownership.
  - [x] M4.1 bounded KERN-authored KIR canonicalizer profile: a generic,
    lossless host adapter transports decoded structural KIR through twelve
    primitive tables, while `canonicalizer.kern` owns profile validation,
    property/type/expression spelling, quoting, indentation, child order, and
    complete-result construction. Eleven valid fixtures prove exact goldens,
    byte-identical module KIR, second-pass idempotence, and every admitted
    return/parameter type. The config-owned 16/30/72 row ceilings are enforced
    inside KERN; one exact-boundary valid fixture completes while three
    otherwise-valid over-limit fixtures and 105 hostile table/profile fixtures
    reject without partial source. `kern check
    --with-semantics` reports zero diagnostics and the new current gate earns
    only `kern-kir-canonicalizer-profile: internal-oracle`; the broad formatter,
    frontend, compiler, fixed point, interpreter, and packed-release rows stay
    open. Exact-tree reviews found and drove the `$` structural-name round-trip
    fix, the missing non-string parameter/void-parameter coverage, duplicate
    required-property variants, and a runtime-ABI public-entry gate omission.
    Focused gates are green after the row-bound, runtime-ABI, name-uniqueness,
    Unicode, policy, signed-integer, array-density, root-order, and direct-ABI
    table-integrity, escaped-output, symbol-record, and shared-array hardening.
    The complete Node 22 wall passed on 2026-07-17. The terminal six-engine
    exact-tree review completed across an initial dispatch and exact-range
    retry for two transport failures, with no unresolved material finding
    (`review-1784323647882-9ylf9g-kern-5-r2-m4-1-terminal-sealed-v`,
    `review-1784324869674-axw52z-kern-5-r2-m4-1-terminal-sealed-v`). M4.1 is
    closed; the broader M4 toolchain exit remains open.
  - [x] M4.2 measured canonicalizer tranche selection: a hash-bound corpus of
    seven handwritten modules across the assertion engine, validator, checker,
    and canonicalizer drives a deterministic structural-KIR coverage summary.
    The summary measures 98 functions; one is already M4.1-complete, 97 are
    blocked by the deliberately excluded legacy `fn.params` payload, and one
    of those also contains an expression outside the structural catalog. Every
    catalog-backed candidate family completes zero additional functions. The
    exact family registry is coverage-closed over every observed unsupported
    function-root node, expression, and property fact, including 491 index
    expressions, and exact M4.1 property/value/child admission is required
    before completion credit, so the tribunal-mandated evidence-only fallback
    records a null winner and makes no canonicalizer or ownership promotion.
    The first three terminal reviews found and fixed profile-admission,
    candidate-closure, property-closure, nested-base-expression,
    text-character, and row-ceiling blockers. The exact receipt also exposes
    47 value-row, 12 node-row, and seven property-row blockers plus six rejected
    text-character facts in one function; the bounded codec also rejects 13
    functions for depth and one for node count. They were previously hidden
    behind the legacy parameter
    exclusion and do not change the null winner. Exact-byte/regular-file corpus
    revalidation, complete per-function fact binding,
    policy/canonicalizer/profile/coverage digests, ordinal witness ids,
    explicit candidate handler widening, and corpus/property/expression
    mutation oracles harden the receipt. The fourth terminal review independently
    found the same false-credit path through two engines: a candidate handler
    child could mask duplicate returns or an orphan/reversed `else`
    (`review-1784360706127-7sgggx-kern-5-r2-m4-2-coverage-terminal`). Combined
    handler-sequence validation, fail-closed fact/limit checks, explicit
    handwritten corpus classification, and a deterministic receipt writer are
    now regression-covered. The fifth terminal review found nested candidate
    sequence, codec-bypass, exact-fact-schema, and expression-authority binding
    blockers
    (`review-1784363236516-soakf0-kern-5-r2-m4-2-coverage-terminal`). Every
    candidate statement container now validates its sequence, rows pass through
    bounded canonical encode/decode, all 13 function-fact fields are exact, and
    the expression source is digest-bound. The deterministic writer builds core
    and asserts the null fallback before writing; nested-sequence, codec-limit,
    incomplete-fact, and empty-family mutations are regression-covered.
    Post-fix focused gates and the repeated complete Node 22
    `pnpm fitness:kern-5` wall passed on 2026-07-18. The sixth review completed
    4/6 before Codex and Kimi timed out, with no verified blockers and two
    needs-checks
    (`review-1784365878717-6kfy1g-kern-5-r2-m4-2-coverage-terminal`). The
    catalog-freeze concern is disproved by exact policy-to-catalog validation
    plus separate policy/constitution digests. The real node-row concern is
    fixed: codec rows are no longer overwritten by source traversal counts,
    codec-rejected functions carry explicit null rows, and malformed rows
    reject. The post-fix focused gates and complete Node 22
    `pnpm fitness:kern-5` wall passed on 2026-07-18. The exact Codex/Kimi retry
    completed and found a stale prose count plus three integrity gaps
    (`review-1784368509065-1oh63s-kern-5-r2-m4-2-coverage-terminal`). The prose
    now records 12 node-row blockers; generated-header variants reject;
    function kind sets are derived exactly from occurrence evidence; and
    profile-only rejection populates `firstUnsupported`. Three RED integrity
    tests, focused gates, and the complete Node 22 wall pass after these fixes.
    The terminal full-roster review completed 5/6 before Codex timed out
    (`review-1784370930544-az31je-kern-5-r2-m4-2-coverage-terminal`). Its
    canonicalizer/corpus digest duplication claim is intentional and
    drift-safe; malformed parser shapes reject before receipts; `fn.async`
    remains outside exact M4.1 admission; and production profile limits are
    policy-validated. One defense-in-depth concern was valid: executed compiled
    core modules were not receipt-bound. The receipt now hashes the complete
    emitted core JavaScript tree with path/length framing, rejects compiled
    symlinks, and has a RED binding oracle. Post-fix focused gates and the
    complete Node 22 `pnpm fitness:kern-5` wall passed on 2026-07-18. The exact
    Codex retry then found that local implementation dependencies were not all
    path/length-framed, compiled bytes were hashed after static loading, and a
    profile-only first blocker came from sorted summary order
    (`review-1784373341918-svmlgh-kern-5-r2-m4-2-coverage-terminal`). The entry
    now authenticates compiled and local dependency bytes before dynamic
    implementation loading, verifies them after load, and preserves authored
    blocker traversal. Three RED oracles, the focused gates, and the post-fix
    complete Node 22 `pnpm fitness:kern-5` wall pass. The next full-roster
    exact review completed all six engines
    (`review-1784378428611-liei4p-kern-5-r2-m4-2-coverage-terminal`). Its dead
    constitution-loader claim was disproved at the receipt call site, while
    two needs-checks were real: constitution projection accepted ignored or
    duplicate rows, and the local dependency digest relied on a mirrored
    allowlist. Constitution validation now enforces exact schemas, counts,
    identities, and property-to-node membership against the executed catalog;
    implementation authentication discovers and path/length-frames every local
    `.mjs`. Focused gates and the post-fix complete Node 22
    `pnpm fitness:kern-5` wall pass after the corrections. The exact retry
    then completed five engines before Codex hit its 600-second transport
    timeout
    (`review-1784380865734-63qlrs-kern-5-r2-m4-2-coverage-terminal`). Its
    missing-file findings were disproved by the staged tree; the expression
    projector is already authenticated by the compiled-core digest; and
    code-unit ordering is locale-independent. A clean core rebuild reproduced
    compiled digest
    `7b00119bb78af4ed955f7f0f3d636393b9ab6f0685bf11df661d5ab9da132725`.
    One non-blocking hardening gap was real: function-fact property identities
    now enforce exact `node.property` grammar with a RED oracle. Focused gates
    and the post-fix complete Node 22 `pnpm fitness:kern-5` wall pass after that
    correction; the exact full-roster retry then completed four engines with
    zero verified findings before Codex and Kimi timed out
    (`review-1784383392836-5e943l-kern-5-r2-m4-2-coverage-terminal`). An exact
    longer-budget retry completed both missing engines
    (`review-1784384016998-14qhb3-kern-5-r2-m4-2-coverage-terminal`). Three
    fail-closed hardening gaps were real and are RED-covered: duplicate function
    witness ids reject, selection independently enforces policy row ceilings,
    and atomic summary writes reject symlink/non-file destinations. Measured
    duplicate occurrences remain the intentional ranking frequency signal.
    The focused suite passes 47/47 and the post-fix complete Node 22
    `pnpm fitness:kern-5` wall passes after the corrections; the final terminal
    review then completed all six usable engines
    (`review-1784387000656-w3teuz-kern-5-r2-m4-2-coverage-terminal`) and exposed
    one deeper trust-boundary defect through two Codex findings: exported
    re-selection accepted mutable or cloned fact arrays, permitting blocker,
    occurrence, or tool-score forgery. Measurement now deeply freezes its fact
    graph and registers the exact array in a module-private weak map bound to
    the producing policy digest. Clones, mutations, and policy/tool-manifest
    drift reject before ranking. The authenticity RED oracle and focused suite
    pass 41/41, and the post-fix complete Node 22 `pnpm fitness:kern-5` wall
    passes. The next terminal full-roster review completed five structured
    verdicts plus the full unstructured ZAI review
    (`review-1784389940398-i5qcyc-kern-5-r2-m4-2-coverage-terminal`). It found
    two evidence blockers and two reachable hardening gaps. Mixed profile and
    structural blockers now share authored traversal positions; check mode
    requires canonical summary bytes in a regular non-symlink file; deep
    freezing traverses shallow-frozen containers; and catalog-excluded
    candidate properties remain ineligible blockers without becoming family
    claims. Four RED oracles cover those corrections, the focused suite passes
    45/45, and the post-fix complete Node 22 `pnpm fitness:kern-5` wall passes.
    The next terminal review completed five engines before Kimi returned a
    parse failure
    (`review-1784392563479-1a9dd8-kern-5-r2-m4-2-coverage-terminal`) and reported
    zero verified findings. Its one real prose correction records that six
    distinct rejected text-character facts belong to one `quotesource`
    function. The final exact-tree terminal review completed all six usable
    engines with zero verified findings
    (`review-1784393191142-xojaa8-kern-5-r2-m4-2-coverage-terminal`). M4.2 is
    sealed with a null winner and no canonicalizer or ownership promotion.
  - [x] M4.3a structured-parameter prerequisite: direct semantic, TypeScript,
    and Python consumers now reject mixed legacy `params=` plus structured
    `param` declarations instead of silently selecting one representation.
    Seven parameterized functions in the assertion-engine `diag.kern` module
    use fourteen ordered structured children; `passResult`, bodies, calls,
    exports, and returns remain unchanged. The hash-bound corpus gate first
    rejected the expected source drift, then remeasured the same 98 functions
    across four tools with 90 remaining `fn.params` blockers. The exact new
    winner is `binary-expression`: three complete assertion-engine functions,
    941 occurrences, and witnesses `reasonTypeMismatch`,
    `reasonValueMismatch`, and `reasonKeyMismatch`. The result is pinned but
    deliberately not implemented in this slice. Focused gates and the initial
    complete Node 22 `pnpm fitness:kern-5` wall pass, including
    assertion-engine 13/13, checker subset 48/48 plus 36 rejected
    accept-but-abstain attacks, and self-host validator 39/39. The first
    terminal review (`review-1784398592317-alchda-kern-5-r2-m4-3a-terminal`)
    exposed and drove RED fixes for the incorrectly `fn`-only guard, missing
    core-runtime rejection, and write-mode winner assertion. The corrected
    exact tree passes the complete Node 22 `pnpm fitness:kern-5` wall with the
    regenerated compiled-core-bound receipt. The second terminal review
    (`review-1784402070934-k183s3-kern-5-r2-m4-3a-terminal-r2`) found no
    verified issues across five completed engines; Kimi timed out, while Codex
    and Claude exposed a valid null-winner status-printer edge. That edge is
    now RED-covered and fixed. The next exact receipt-bound Node 22
    `pnpm fitness:kern-5` wall passed. The third terminal review completed all
    six usable engines
    (`review-1784404337202-jjc35k-kern-5-r2-m4-3a-terminal-r3`) with zero
    verified findings and independently exposed duplicated package-boundary
    guard/message drift. Python and the checker adapter now consume the shared
    core guard, a RED export-contract test proves the dependency, and the
    compiled-core-bound receipt is regenerated. The corrected exact-tree Node
    22 `pnpm fitness:kern-5` wall passes. The final terminal review completed
    all six usable engines with zero verified findings
    (`review-1784406342479-xc3w91-kern-5-r2-m4-3a-terminal-r4`). Its five
    needs-checks were rejected against the bound winner row-or-null schema,
    the shared guard that runs before target-local fallback parsing, the
    fn-only checker fact contract, semantic validation's location ownership,
    and the runtime's required direct-invocation defense.
  - [x] M4.3b binary-expression canonicalizer tranche: the handwritten
    canonicalizer is split into two sub-500-line authored KERN members and an
    exact checked-in composite. A fail-closed composition record authenticates
    ordered member paths, byte lengths, SHA-256 digests, trailing-LF seams, and
    the composite executed by the unchanged one-source runtime handler ABI.
    KERN now validates the exact 24 structural binary operators and emits
    recursive fully parenthesized source. Fourteen golden/idempotence/KIR
    fixtures, all three M4.3a witnesses, three profile-limit fixtures, and 119
    hostile fixtures pass; every pre-M4.3b non-binary golden byte remains
    unchanged. Receipt regeneration exposed a contradiction in the draft
    contract: newly authored `validbinaryop` and binary syntax cannot preserve
    the pre-slice raw counts. Synthesis tribunal
    `tribunal-1784459844249-vw92xw-kern-5-r2-m4-3b-receipt-contradi` selected a
    dual-timepoint contract: digest-pinned M4.3a provenance remains exactly 98
    functions and 941 binary occurrences, while live M4.3b coverage honestly
    reports 99 functions, 1,002 occurrences, four tools, eight authored corpus
    members, and the same winner identity, three completed functions, one tool,
    and three witnesses. The generated composite is explicitly forbidden from
    handwritten coverage credit. Focused gates and the complete Node 22
    `pnpm fitness:kern-5` wall pass. The exact requested terminal review
    (`review-1784460387023-6g3bfl-kern-5-r2-m4-3b-binary-expressio`) returned
    zero findings from Claude and Antigravity; Codex exhausted its account
    limit after retry, leaving a recorded 2/3 routing shortfall rather than a
    silently reduced roster.
  - [x] M4.3c binary-profile promotion and remeasurement: coverage-policy
    format 2 names the exact cumulative
    `kern.kir-canonicalizer.profile.m4.3c` base, promotes binary through the
    digest-pinned M4.3a selection provenance, and removes
    `binary-expression` from active candidates without changing the frozen
    family registry. Receipt/summary format 3 exposes the validated base and
    fails closed on profile identity, fact, evidence, candidate-overlap, and
    checked-in byte drift. Promoted binary shape and all 24 operators are
    validated through the authoritative structural-expression validator. The
    remeasurement reports four of 99 functions base-complete and selects
    `conditional`: two newly complete assertion-engine functions, one tool,
    1,115 occurrences, and witnesses `pathAppendKey` and `failResult`;
    `call-expression` ranks second with the same function/tool score and 454
    occurrences. No second family is implemented. The focused gate passes 56
    Node tests plus core/CLI builds, composition, semantic, host, and receipt
    checks. Exact staged review
    `review-1784463482337-0745ow-kern-5-r2-m4-3c-terminal-exact` found one real
    stale implementation digest after a final source-byte cleanup; receipt
    regeneration and the repeated focused gate fixed it. Post-fix review
    `review-1784463782524-6v723f-kern-5-r2-m4-3c-post-fix-exact` completed
    Claude and Antigravity with no verified actionable finding; Codex exhausted
    its account limit, leaving an explicit 2/3 routing shortfall. Final
    slice-only full-usable-roster review
    `review-1784464773863-hra3ka-kern-5-r2-m4-3c-terminal-full-ro` completed
    five of six engines with zero verified material findings; Codex alone was
    unavailable. Its only important notes were non-blocking ranking-loop cost
    and the actionable next-slice constraint that the 497-line implementation
    module must be split before expansion. The final exact staged tree passes
    the complete Node 22 `pnpm fitness:kern-5` wall.
  - [x] M4.3d conditional-selection handoff prerequisite: the exact M4.3c
    `conditional` winner is frozen as separate canonical, digest-pinned
    implementation provenance before any KERN corpus change. Receipt and
    summary format 4 now distinguish the older M4.3a evidence authorizing the
    promoted binary base from the M4.3c evidence authorizing the next
    implementation tranche. Pure completion/ranking moved into a dedicated
    module while the authenticated public wrapper remains fail-closed; the
    former 497-line implementation owner is now 433 lines. The executable KERN
    canonicalizer remains exactly 25,892 bytes, the policy remains format 2
    with profile M4.3c, and live coverage remains four of 99 base-complete with
    the same conditional winner. The focused canonicalizer gate passes 59
    tests plus core/CLI builds, composition, semantic, host, and receipt checks.
    The exact prerequisite tree also passes the complete Node 22
    `pnpm fitness:kern-5` wall. Its clean-worktree build refreshed the
    compiled-core receipt binding without any core source diff. Full usable-
    roster review `review-1784468516053-xupoi8` completed five of six engines
    with zero verified or needs-check findings; Codex alone was unavailable.
  - [x] M4.4 conditional canonicalizer capability: a third authenticated,
    handwritten KERN composition member recursively validates and emits the
    exact `if` / sibling `else` / `if.cond` statement family, including nested
    and empty containers. It preserves terminal-return and return-type rules,
    validates before emission, and returns fresh line arrays so helper
    parameters remain effect-machine pure. Four new golden/idempotence/KIR
    fixtures, both sealed conditional witnesses, and nine hostile mutations
    pass. The focused Node 22 gate passes 60 Node tests, 18 golden fixtures,
    five witnesses, three profile-limit fixtures, and 128 hostile fixtures;
    coverage keeps conditional unpromoted and selected. Full-roster review,
    `review-1784467657693-d189fo-kern-5-r2-m4-conditional-termina`, completed
    five of six requested engines; Codex exhausted its account limit. The only
    claimed blocker mistook the generated composite for another composition
    input: byte arithmetic, declared membership, and exact definition counts
    prove every statement helper appears once. A regression assertion now
    freezes that invariant. The exact integrated tree passes the complete Node
    22 `pnpm fitness:kern-5` wall. Final integrated-tree review
    `review-1784470527261-w0lc8x` completed five of six engines with zero
    verified findings; all four needs-check claims were disproven or were the
    intentionally pending publication step. The capability/evidence gate is
    closed; signed commit, rebase, and verified push remain external
    publication actions. M4.5 owns promotion and remeasurement.
  - [x] M4.5 conditional-profile promotion and remeasurement: the exact
    cumulative `kern.kir-canonicalizer.profile.m4.5` base adds `if`, `else`,
    and `if.cond`, citing both immutable causal records: M4.3a for binary and
    M4.3c for conditional. Conditional is removed from active candidates;
    every promotion is authenticated by family plus digest. Base and candidate
    completion now share the promoted recursive statement profile rather than
    treating all non-return statements as perpetually candidate-only. The
    unchanged nine-member/104-function corpus measures six base-complete
    functions and selects `call-expression`: two functions, one tool, 481
    occurrences, with witnesses `pathAppendIndex` and
    `reasonLengthMismatch`. No call implementation is included. The focused
    Node 22 gate passes 61 Node tests, 18 golden fixtures, five witnesses,
    three profile-limit fixtures, and 128 hostile fixtures. The exact tree also
    passes the complete Node 22 `pnpm fitness:kern-5` wall, including 432
    cross-target fixtures, 109 class fixtures, 48 checker-subset fixtures, 39
    validator verdicts, 40 whole-app fixtures on three legs, browser budget,
    KIR seam/export guards, source-runner convergence, and the repeated
    canonicalizer proof. Exact-tree review `review-1784472947300-f8nh4e`
    completed five of six engines with zero verified findings; Codex exhausted
    its account limit. All five needs-check claims were disproven against the
    exact cumulative profile and catalog-closure contracts. Review-driven
    hardening then centralized recursive-statement classification, added an
    explicit duplicate-provenance guard, restored prior mutations, and passed
    the focused gate plus targeted review
    `review-1784473453151-59d825-kern-5-r2-m4-5-review-hardening`. The
    capability/evidence gate is closed; signed follow-up commit, rebase, and
    verified push remain external publication actions.
  - [x] M4.5a call-expression selection handoff prerequisite: the exact
    published M4.5 call-expression winner is frozen before any new KERN or
    corpus byte. Canonical selection provenance now forms an ordered,
    append-only three-record history for binary, conditional, and call
    expression, with unique family/digest validation and a single digest
    pointer to the current implementation authorization. Receipt and summary
    advance to format 5; the policy, corpus, ranking, executable canonicalizer,
    KIR/runtime/public contracts, and ownership claims remain unchanged. Nero
    `nero-1784473503920-aoxj6q` correctly exposed tranche-boundary churn in the
    first schema proposal, causing the stable append-only redesign. The
    focused Node 22 gate passes 63 Node tests, 18 golden/idempotence/KIR
    fixtures, five measured witnesses, three profile-limit fixtures, and 128
    hostile fixtures. Live evidence remains six of 104 base-complete and
    selects call-expression with two functions, one tool, 481 occurrences,
    and the same two witnesses. The exact tree passes the complete Node 22
    `pnpm fitness:kern-5` wall, including repo consistency, lint, build,
    workspace tests, infrastructure proofs, cross-target/native conformance,
    capstones, app behavior, browser budget, KIR guards, source-runner
    convergence, and the repeated canonicalizer evidence. Exact-tree review
    `review-1784548446121-pw3ita` completed all six engines with zero
    consensus-verified findings. Its one claimed blocker exposed an orphaned
    CLI-generated JavaScript file in the old core `dist`; the clean worktree
    correctly refreshes `compiledCoreDigest` from contaminated `f72c…` to
    reproducible `592b…`, and passes the full wall with that receipt. The
    capability/evidence gate is closed; signed commit, no-rewrite rebase, and
    push remain external publication actions.
  - [x] M4.5b call-expression canonicalizer capability: the KERN-authored
    `exprsource` now validates the exact structural `{args, callee, optional}`
    call record and recursively emits non-optional callees and ordered
    arguments. It deliberately rejects `optional=true` until member/index
    chain semantics are designed, while member and index callees remain
    fail-closed through their unpromoted expression families. Contract
    tribunal `tribunal-1784555533734-ntsxox-kern-5-r2-m4-5b-call-contract`
    selected this dependency-closed boundary over witness-shaped direct calls
    and unsafe optional-call emission. The intended RED failed on the sealed
    `pathAppendIndex` witness before implementation. Three valid call fixtures,
    twelve hostile mutations, both measured witnesses, recursive calls, nested
    arguments, and binary callees now pass. The focused Node 22 gate passes 64
    Node tests, 21 golden/idempotence/KIR fixtures, seven measured witnesses,
    three profile-limit fixtures, and 140 hostile fixtures. Immutable M4.5a
    provenance remains 481 call occurrences while live implementation evidence
    advances to 492; call-expression stays selected and unpromoted at six of
    104 base-complete functions. The exact tree passes the complete Node 22
    `pnpm fitness:kern-5` wall. Review-driven hardening adds exact live byte
    count and SHA-256 bindings plus dangling callee/argument-id mutations.
    Final exact-tree review
    `review-1784559503294-8nuqnc-kern-5-r2-m4-5b-call-expression-` completed
    all six usable engines with zero verified, needs-check, or speculative
    findings. Publication remains pending; the next slice owns promotion and
    remeasurement.
  - [x] M4.5c call-expression profile promotion and remeasurement: cumulative
    profile `kern.kir-canonicalizer.profile.m4.5c` authenticates the exact
    immutable M4.5a call selection digest, appends it after binary and
    conditional, admits recursive structural calls only when
    `optional=false`, and removes call-expression from active candidates.
    Missing, malformed, extra-field, non-boolean, optional, and nested-optional
    call shapes fail closed; reordered, duplicated, missing, forged, and
    overlapping promotion-policy mutations are killed. Immutable provenance
    remains two functions, one tool, and 481 occurrences even though M4.5b
    live implementation evidence measured 492. The unchanged 104-function
    corpus now has eight base-complete functions. Every remaining single-family
    candidate completes zero functions, so the authenticated winner is `null`;
    binding is not selected merely for having the highest occurrence count.
    Initial six-engine review
    `review-1784563663115-9as2oz-kern-5-r2-m4-5c-call-promotion` reported zero
    verified blockers and exposed two needs-check hardening gaps. The exact
    completion predicate now proves member/index call dependencies remain
    outside the base, and any future base expression kind without a local
    validator fails closed. Both additions passed RED first. The focused Node
    22 gate passes 67 Node tests, 21
    golden/idempotence/KIR fixtures, seven measured witnesses, three
    profile-limit fixtures, and 140 hostile fixtures. The exact tree passes the
    complete Node 22 `pnpm fitness:kern-5` wall, including repository
    consistency, lint, build, all workspace and infrastructure tests, 432
    cross-target fixtures, 109 class fixtures, 233 native assertions, 48
    checker-subset fixtures, 39 validator verdicts, 40 whole-app fixtures on
    three legs, browser budget, KIR and runtime guards, source-runner
    convergence, and repeated canonicalizer evidence. Final exact-tree review
    `review-1784565656837-624qiq-kern-5-r2-m4-5c-call-promotion-f` completed all
    six usable engines with zero verified or needs-check findings. This closes
    the single-family ladder; the next slice must measure dependency-closed
    multi-family tranches before authorizing another canonicalizer capability.
  - [x] M4.6 structured-parameter prerequisite measurement: exhaustive
    read-only evaluation of all 255 non-empty combinations of the eight
    remaining families completed no additional function because every one of
    the 96 incomplete functions first carried the catalog-excluded legacy
    `fn.params` property. Corrected six-engine brainstorm
    `brainstorm-1784566212986-7ygt4o-kern-5-r2-m4-6-structured-parame`
    rejected a forced-null multi-family selector and selected the smallest
    complete-module prerequisite: migrate only the three functions and seven
    parameters in assertion-engine `sort.kern` to existing ordered direct
    `param` children. Runtime bodies, calls, arities, types, exports, the
    canonicalizer executable, profile, family registry, schema, and immutable
    promotion history remain unchanged. Authenticated remeasurement advances
    base completion from eight to nine of 104 and reduces `fn.params` blockers
    from 96 to 93. `halfFloor` is newly complete at 6/9/53
    node/property/value rows; `mergeStrings` measures 29/44/493 and remains
    blocked by all three row ceilings, while `sortStrings` measures 16/29/197
    and remains blocked by the value-row ceiling. Every remaining family still
    completes zero functions, so the winner remains `null`. The focused Node
    22 gate passes all 67 canonicalizer tests, the assertion engine remains
    13/13 byte-identical to its TypeScript oracle, and the checker-subset
    structured-parameter adapter tests pass. The exact tree also passes the
    complete Node 22 `pnpm fitness:kern-5` wall: repository consistency, lint,
    build, all workspace and infrastructure tests, 432 cross-target fixtures,
    109 class fixtures, 233 native assertions, 48 checker-subset fixtures, 39
    validator verdicts, 40 whole-app fixtures on three legs, browser budget,
    KIR and runtime guards, source-runner convergence, and repeated
    canonicalizer evidence. Terminal exact-tree review
    `review-1784569089322-7yj717-kern-5-r2-m4-6-terminal-boundary` completed all
    six usable engines with zero verified findings. Both needs-check items are
    resolved by the exact 93-blocker assertion already present in
    `coverage.test.mjs` and the corrected array-type value-row explanation in
    the sealed spec. This slice removes one measured prerequisite only; no
    remaining family is authorized by it.
  - [x] M4.7 targeted checker structured-parameter prerequisite: exact
    read-only migration measurement found that converting only
    `isDecimalDigit`, `isLiteralKind`, and `literalToken` in
    `checker-while.kern` changes five parameter rows and completes three
    functions. Converting all 18 functions and 126 parameters in that module
    produces the identical gain. Six-engine brainstorm
    `brainstorm-1784569913694-o3p3tj-kern-5-r2-m4-7-parameter-scope`
    unanimously selected the per-function boundary: three internally
    consistent direct-form functions intentionally coexist with 15
    internally consistent legacy-form siblings. The migrated source is 256
    lines, authenticated completion advances from nine to 12 of 104, and
    `fn.params` blockers fall from 93 to 90. Exact target rows are 8/10/43,
    4/6/67, and 10/14/49. Every remaining family still completes zero
    functions and the winner remains `null`. The focused Node 22 gate passes
    all 67 canonicalizer tests, 21 golden/idempotence/KIR fixtures, seven
    measured witnesses, three profile-limit fixtures, and 140 hostile
    fixtures. Checker-subset parity remains 48/48 with all 36 hostile attempts
    rejected. The exact tree passes the complete Node 22
    `pnpm fitness:kern-5` wall, including repository consistency, lint, build,
    every workspace and infrastructure suite, 432 cross-target fixtures, 109
    class fixtures, 233 native assertions at 100% coverage, 39 validator
    verdicts, 40 whole-app fixtures on three legs, browser budget, KIR/runtime
    guards, source-runner convergence, and repeated canonicalizer evidence.
    Initial six-engine review
    `review-1784571949656-g95nh2-kern-5-r2-m4-7-terminal-boundary` found one
    material evidence-wording issue, resolved by binding the nine/93/251
    baseline to immutable M4.6 commit `f8f684fc` and separating the current
    M4.7 state. Post-fix review
    `review-1784572635152-mw47un-kern-5-r2-m4-7-final-postfix` completed all six
    usable engines with zero verified findings. Its one needs-check item is
    resolved by the exhaustive 3-direct/15-legacy partition, which covers all
    18 functions and mechanically excludes mixed parameter forms.
  - [x] M4.8 targeted checker structured-parameter prerequisite: exact
    read-only measurement found eight remaining functions that become
    base-complete after structured-parameter migration. Corrected boundary
    selection migrates only `acceptLine`, `isSafeIntText`,
    `elseRejectDetail`, and `isPrintNumberText` in `checker.kern`: six ordered
    parameter rows complete four functions while the other 20 functions remain
    internally consistent legacy siblings. Full-roster brainstorm
    `brainstorm-1784573693847-hlks2n-kern-5-r2-m4-8-parameter-scope` initially
    synthesized the three-function validator alternative on the false premise
    that it avoided checker fixture regeneration. Repository evidence shows
    the checker fixture embeds both validator and checker sources, so checker
    dominates: the same six-row and generated-evidence cost completes one more
    function, leaves 140 rather than 29 lines of source headroom, and avoids an
    additional validator gate. The source is exactly 360 lines; authenticated
    completion advances from 12 to 16 of 104 and `fn.params` blockers fall
    from 90 to 86. Exact target rows are 4/7/20, 4/7/21, 6/10/36, and 4/6/20.
    All eight remaining families still complete zero functions and the winner
    remains `null`. Focused Node 22 evidence passes 67 canonicalizer tests, 21
    golden/idempotence/KIR fixtures, seven measured witnesses, three
    profile-limit fixtures, 140 hostile fixtures, checker adapter 3/3, checker
    parity 48/48, all 36 hostile checker attempts, and all 23 direct
    safe-integer cases. The exact tree passes the complete Node 22
    `pnpm fitness:kern-5` wall, including repository consistency, lint, build,
    every workspace and infrastructure suite, 432 cross-target fixtures, 109
    class fixtures, 233 native assertions at 100% coverage, 39 validator
    verdicts, 40 whole-app fixtures across three legs, browser budget,
    KIR/runtime guards, source-runner convergence, and repeated canonicalizer
    evidence. Automatically routed terminal review
    `review-1784574989078-5m4n95` completed both required independent seats
    with zero verified, needs-check, or speculative findings; its six
    low-severity maintainability notes do not alter the bounded evidence or
    fail-closed digest contract. No material finding remains unresolved.
  - [x] M4.9 targeted validator structured-parameter prerequisite: exact
    authenticated read-only measurement found only four remaining functions
    that become base-complete through structured-parameter migration. The
    selected coherent boundary migrates `charoknext`, `localname`, and
    `failline` in `validator.kern`: six ordered parameter rows complete three
    functions, while the other 18 functions remain internally consistent
    legacy siblings. The only alternative completion is `validnext` in the
    canonicalizer expression helper; it is deferred because reopening the
    executable composition for one completion has a larger evidence blast
    radius. The validator source is exactly 471 lines; authenticated completion
    advances from 16 to 19 of 104 and `fn.params` blockers fall from 86 to 83.
    Exact target rows are 8/11/61, 7/11/31, and 6/11/67. All eight remaining
    families still complete zero functions and the winner remains `null`.
    Focused Node 22 evidence passes all 67 canonicalizer tests, 21
    golden/idempotence/KIR fixtures, seven measured witnesses, three
    profile-limit fixtures, 140 hostile fixtures, validator parity 39/39,
    checker adapter 3/3, checker parity 48/48, and all 36 hostile checker
    attempts. Validator `main.kern` and the numeric checker fixture remain
    byte-identical; the checker embedded-source fixture was regenerated by its
    repository generator. The exact tree passes the complete Node 22
    `pnpm fitness:kern-5` wall, including repository consistency, lint, build,
    every workspace and infrastructure suite, 432 cross-target fixtures, 109
    class fixtures, 233 native assertions at 100% coverage, 39 validator
    verdicts, 40 whole-app fixtures across three legs, browser budget,
    KIR/runtime guards, source-runner convergence, and repeated canonicalizer
    evidence. Preliminary automatically routed review
    `review-1784577709996-drhnzx` completed both requested reviewers with zero
    findings and remains preserved as superseded history. Full-roster terminal
    review
    `review-1784577771218-s0mruf-kern-5-r2-m4-9-terminal-boundary` completed all
    six usable engines with zero verified, needs-check, or speculative
    findings. Its five nits do not alter the bounded fail-closed evidence; the
    accurate baseline-wording nit is resolved in the sealed spec. No material
    finding remains unresolved.
  - [x] M4.10 final isolated structured-parameter prerequisite: authenticated
    read-only measurement found exactly one remaining function that becomes
    base-complete through parameter representation alone. The selected boundary
    migrates only `validnext` in the canonicalizer expression helper: its one
    `c:string` parameter completes the function while the other 15 helper
    functions remain internally consistent legacy siblings. The helper is
    exactly 166 lines; repository-owned composition generation authenticates a
    6,357-byte member and 32,310-byte composite. Authenticated completion
    advances from 19 to 20 of 104 and `fn.params` blockers fall from 83 to 82;
    the target profile is exactly 6/9/53. All eight remaining families still
    complete zero functions and the winner remains `null`. The focused Node 22
    canonicalizer gate passes all 67 tests, including composition rejection,
    frozen provenance, exact coverage, profile, and hostile boundaries.
    Validator source/main and checker main/numeric fixtures remain
    byte-identical. The exact implementation tree passes the complete Node 22
    `pnpm fitness:kern-5` wall, including repository consistency, lint,
    production build, all workspace and infrastructure suites, 432
    cross-target fixtures, 109 class fixtures, 233 native assertions at 100%
    coverage, 48 checker fixtures plus 36 hostile rejections, 39 validator
    verdicts, 40 whole-app fixtures across three legs, browser budget,
    KIR/runtime/ownership/convergence guards, and repeated canonicalizer
    evidence. Preliminary automatically routed terminal review
    `review-1784580066541-ki9752` completed both requested independent
    reviewers with zero verified, needs-check, or speculative findings and one
    editorial nit. Superseding full-roster terminal review
    `review-1784580218054-0u53yc-kern-5-r2-m4-10-terminal-boundar` completed
    all six usable engines with zero verified, needs-check, or speculative
    findings and eight non-blocking nits. The exact-count, line-citation, and
    provenance nits are resolved in the sealed specs; import and current-value
    label concerns were verified non-issues. No material finding remains
    unresolved.
  - [x] M4.11 member-expression selection prerequisite: exact AST-level
    read-only measurement distinguished the only two apparent post-call
    witnesses. Migrating only checker function `isPositiveSafeIntText` yields
    an admitted 8/10/70 profile; migrating validator function `contained`
    would yield 9/13/73 and remain outside the frozen 72-value-row ceiling.
    The implemented boundary therefore rewrites only `raw:string` as one
    ordered direct `param` child. Checker source is exactly 257 lines with 18
    functions, six direct params, and 14 internally consistent legacy
    siblings. Authenticated base completion remains 20/104 while `fn.params`
    blockers fall from 82 to 81. `member-expression` becomes the unique winner
    at one function, one tool, and 259 read-only corpus occurrences, witnessed
    only by `checker-while.kern#8:isPositiveSafeIntText`; all seven other
    families remain at zero. The focused canonicalizer gate passes all 67
    structural tests plus 21 golden/idempotence/KIR, seven measured-witness,
    three profile-limit, and 140 hostile fixtures. Checker parity passes 48/48
    oracle fixtures and all 36 hostile attempts reject. Numeric main,
    validator source/main, the 32,310-byte canonicalizer composite, profile,
    schema, family registry, and all three historical provenance records remain
    byte-identical. The exact tree passes the complete Node 22
    `pnpm fitness:kern-5` wall, including repository consistency, lint,
    production build, every workspace and infrastructure suite, 432
    cross-target fixtures, 109 class fixtures, 233 native assertions at 100%
    coverage, 39 validator verdicts, 40 whole-app fixtures across three legs,
    browser budget, KIR/runtime/ownership/convergence guards, and repeated
    canonicalizer evidence. Automatically routed medium-risk terminal review
    `review-1784582535977-ppv228` completed both independent reviewers with zero
    verified, needs-check, or speculative findings and three non-blocking nits.
    The tense nit is fixed; the order and generated-line observations were
    resolved against canonical receipt ordering and exact old/new flatten
    comparison. Superseding full-roster review
    `review-1784582618011-rl1t8z-kern-5-r2-m4-11-terminal-boundar` completed all
    six usable engines with zero verified findings, one needs-check item, zero
    speculative findings, and nine non-blocking nits. The needs-check item was
    the intentionally pending review checkbox in the reviewed tree and is
    resolved by the sealed receipt; documentation nits were clarified without
    changing authenticated implementation bytes. No material finding remains
    unresolved. This slice freezes no new provenance and implements no member
    canonicalization.
  - [x] M4.12 member-expression handoff evidence: the exact published M4.11
    selection at commit `b2c653f6757f8af9996a59b998b3c52b9d033d29` is frozen
    as a fourth append-only provenance record. Its canonical bytes hash to
    `83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d`
    and bind the exact format-5 summary, coverage policy, 32,310-byte
    canonicalizer, 9-member/104-function/4-tool snapshot, and sole
    `member-expression` witness at 1 function / 1 tool / 259 occurrences. The
    chain remains ordered binary, conditional, call, member with unique ids and
    digests; only the implementation-selection pointer moves to the fourth
    record. Base promotions remain exactly binary, conditional, and call, so
    this slice implements and promotes no member-expression behavior.
    Repository-owned regeneration produces format-5 summary SHA-256
    `cf01966cc48992ed638049f12e11b695935815a986784388b547a7b756443ee4`
    while live coverage remains 20/104 with 81 `fn.params` blockers and the
    exact M4.11 winner. The focused Node 22 canonicalizer gate passes all 68
    structural tests plus 21 golden/idempotence/KIR, seven measured-witness,
    three profile-limit, and 140 hostile fixtures. The exact implementation
    tree passes the complete Node 22 `pnpm fitness:kern-5` wall, including all
    workspace and infrastructure suites, 432 cross-target fixtures, 109 class
    fixtures, 233 native assertions at 100% coverage, 48 checker fixtures plus
    36 hostile rejections, 39 validator verdicts, 40 whole-app fixtures across
    three legs, and all KIR/runtime/ownership/convergence guards. Full-roster
    terminal review
    `review-1784585011550-5ggags-kern-5-r2-m4-12-terminal-boundar` completed all
    six usable engines with zero verified findings, zero needs-check findings,
    two speculative findings, and ten non-blocking nits. Direct audit confirmed
    the selection constant and both digests, and verified that milestone labels,
    promotion-title scope, and witness-order mutations preserve distinct
    source-measurement and freeze semantics. No material finding remains
    unresolved. Supplemental automatically routed review
    `review-1784585131496-22fuex` completed 2/2 identities with zero verified,
    needs-check, or speculative findings and one non-blocking nit. It directly
    authenticated the historical M4.11 hash; a Git-history-dependent CI oracle
    was rejected in favor of the hermetic checked-in record and digest.
  - [x] M4.13 member-expression canonicalizer tranche: the KERN-authored
    canonicalizer now validates and emits the exact structural
    `{ object, optional, property }` member record for `optional=false`.
    Objects recurse only through already implemented expression families;
    optional chains, index dependencies, malformed fields, and parser-forbidden
    dot properties remain fail-closed. Direct properties, member calls,
    recursive chains, call/binary/list/null/boolean/integer/text receivers, and
    parser-valid `object.new`, `object.typeof`, and `object.return` spellings
    preserve exact structural KIR and byte idempotence.
    The authenticated composite is 33,571 bytes at SHA-256
    `b22b359416deb5da970a2826738eb392d37d29807d48aefe946d8f8aafcffc0a`;
    format-5 coverage summary SHA-256 is
    `1caa9245ea16dd60e572cef3812070552645b041e2fe1805d606872fede7ac0b`.
    The focused Node 22 gate passes all 69 structural/authentication tests plus
    27 golden/idempotence/KIR, eight measured-witness, three profile-limit, and
    156 hostile fixtures. Coverage deliberately remains 20/104 with 81
    `fn.params` blockers and member still selected, unpromoted, at one function
    / one tool / 259 occurrences. The exact tree passes the complete Node 22
    `pnpm fitness:kern-5` wall, including all workspace and infrastructure
    suites, 432 cross-target fixtures, 109 class fixtures, 233 native assertions
    at 100% coverage, 48 checker fixtures plus 36 hostile rejections, 39
    validator verdicts, 40 whole-app fixtures across three legs, browser budget,
    and every KIR/runtime/ownership/convergence guard. High-risk role-lens
    review `review-1784588210665-n8hgn4-kern-5-r2-m4-13-terminal-boundar`
    completed all six usable engines with zero verified findings, five
    needs-check findings, zero speculative findings, and five nits. The
    escaped ownership guard, per-source witness parse cache, review receipt,
    and missing positive/hostile cases are fixed. The remaining modularity
    suggestions were rejected as prior-tranche scope expansion or intentional
    independent parser/KERN oracle duplication. No material finding remains.
    Supplemental review
    `review-1784589125374-ngt1a2-kern-5-r2-m4-13-post-review-fixe` completed
    2/2 independent engines with zero verified findings, one needs-check item,
    zero speculative findings, and five nits. Exact flattened-KIR inspection
    resolved the needs-check: fixture index zero is the inner `service.client`
    member, so recursive optional rejection is directly exercised.
  - [x] M4.14 member-expression profile promotion: cumulative profile
    `kern.kir-canonicalizer.profile.m4.14` now authenticates the immutable
    M4.11 member selection digest, admits the exact recursive M4.13 member
    subset, and removes `member-expression` from active candidates. The local
    profile requires exact `{ object, optional, property }` shape,
    `optional=false`, identifier-shaped properties, and rejects the six
    parser-forbidden dot properties while preserving valid `new`, `typeof`,
    and `return` properties. Index dependencies remain outside the base.
    Authenticated measurement rises from 20 to 21 of 104 base-complete
    functions with 81 `fn.params` blockers. All seven remaining single-family
    candidates complete zero functions, so the deterministic winner is null;
    binding's 750 occurrences do not authorize implementation. The KERN
    executable remains 33,571 bytes at SHA-256
    `b22b359416deb5da970a2826738eb392d37d29807d48aefe946d8f8aafcffc0a`;
    regenerated format-5 summary SHA-256 is
    `ddcb79ffd489555070ae807905ad09405761fb6175d7d0597ab896fc4e26717c`.
    The focused Node 22 gate passes 70 structural/authentication tests plus 27
    golden/idempotence/KIR, eight measured-witness, three profile-limit, and
    156 hostile fixtures. The exact tree passes the complete Node 22
    `pnpm fitness:kern-5` wall, including all workspace and infrastructure
    suites, 432 cross-target fixtures, 109 class fixtures, 233 native assertions
    at 100% coverage, 48 checker fixtures plus 36 hostile rejections, 39
    validator verdicts, 40 whole-app fixtures across three legs, browser budget,
    and every KIR/runtime/ownership/convergence guard. Full-roster terminal
    review `review-1784590699884-b0vlql-kern-5-r2-m4-14-terminal-boundar`
    completed all six usable engines with zero verified findings, two
    needs-check items, zero speculative findings, and three nits. The
    needs-check items were resolved as intentional separation between
    root-identifier and dot-property policy, and as an out-of-scope
    cross-family validator refactor. No material finding remains unresolved.
  - [x] M4.15 multi-family dependency prerequisite: after M4.14 leaves no
    single-family winner, an authenticated in-memory migration of all 81
    legacy `fn.params` signatures proves the minimum completing closure has
    two active families. `counted-iteration` plus `index-expression` completes
    six functions across checker, canonicalizer, and validator with 14 direct
    parameter rows and 962 observed family occurrences. The only other
    completing pair, binding plus counted iteration, completes one
    canonicalizer function with one migrated parameter row and 1,218
    occurrences. Within the winning pair, index expression is the exact next
    prerequisite because it owns one catalog fact versus counted iteration's
    node plus three required properties. This is ordering evidence only: no
    source signature changes, family merge, ordinary selection provenance,
    implementation, or promotion occurs. The canonical prerequisite receipt
    SHA-256 is
    `54146de715b207e507d56e303937d0531d8832a5ced3e162b0288be83865f49f`;
    regenerated ordinary format-5 summary SHA-256 is
    `12b26731a6f686f55e8e80736bbb6bdd7bbcb5e7ed514be9628885ddd8ef627c`.
    Exact mixed legacy/direct parameters now reject before counterfactual
    credit. The focused Node 22 gate passes 73 structural/authentication tests
    plus 27 golden/idempotence/KIR, eight measured-witness, three
    profile-limit, and 156 hostile fixtures. The exact tree passes the complete
    Node 22 `pnpm fitness:kern-5` wall, including all workspace and
    infrastructure suites, 432 cross-target fixtures, 109 class fixtures, 233
    native assertions at 100% coverage, 48 checker fixtures plus 36 hostile
    rejections, 39 validator verdicts, 40 whole-app fixtures across three legs,
    browser budget, and every KIR/runtime/ownership/convergence guard.
    Full-roster terminal review
    `review-1784593242913-wo6j0u-kern-5-r2-m4-15-terminal-boundar` completed all
    six usable engines with one verified finding, one needs-check item, zero
    speculative findings, and 12 nits. The verified finding inspected a stale
    scratch copy with a free `base`; the current source passes `policy.base`,
    and both focused and full gates repeatedly execute the path. The shared
    corpus-loader extraction was deferred because current duplicated ownership
    fails closed and changing the authenticated ordinary coverage core would
    widen this evidence-only slice. No material finding remained unresolved at
    publication. Supplemental independent review
    `review-1784593437144-5awnq5-kern-5-r2-m4-15-independent-term` later found
    that the slice-local parameter identifier regex was wider than KERN's
    canonical portable-binding predicate and that the prerequisite baseline
    should expose its canonicalizer-policy and compiled-core digests directly.
    M4.16 closes both items with hostile regressions and regenerated live
    receipts; the M4.15 closure result and published causal hashes remain
    unchanged.
  - [x] M4.16 index-expression prerequisite handoff: a distinct canonical
    `kern.kir-canonicalizer.prerequisite-provenance.1` record freezes published
    M4.15 commit `003f3222b23d7543b529186957a67feeb72009b0`, its format-5
    coverage-summary hash, its prerequisite-summary-1 hash, the exact 21/104
    baseline with 81 legacy parameter blockers, the two-family minimum, the
    six-function winning closure, and the one-fact index prerequisite. The
    record SHA-256 is
    `3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869`.
    It remains separate from the four-record ordinary selection chain because
    index alone has no truthful positive completion witness. The same tree
    hardens M4.15 by using `isPortableBindingName`, rejecting dollar-prefixed,
    reserved, `__k*`, and `_kern*` parameters, and binding the
    canonicalizer-policy and compiled-core digests into the live prerequisite
    receipt. Regenerated live coverage and prerequisite summary SHA-256 values
    are respectively
    `baa2567653c16e07bd6d4215540896f95d5adbfe891458ad7804591bd0efb4b5`
    and
    `12f839bc4ef6447423aa7e449049636c6a658d04acc3ea652c7ee895b6ebf725`;
    semantic counts and ranking are unchanged. The focused Node 22 gate passes
    76 structural/authentication tests plus 27 golden/idempotence/KIR, eight
    measured-witness, three profile-limit, and 156 hostile fixtures. The exact
    tree passes the complete Node 22 `pnpm fitness:kern-5` wall, including all
    workspace and infrastructure suites, 432 cross-target fixtures, 109 class
    fixtures, 233 native assertions at 100% coverage, 48 checker fixtures plus
    36 hostile rejections, 39 validator verdicts, 40 whole-app fixtures across
    three legs, browser budget, and every KIR/runtime/ownership/convergence
    guard. Full-roster terminal review
    `review-1784595745138-ulwrug-kern-5-r2-m4-16-terminal-boundar` completed all
    six engines with no blocker. Its genuine test-quality finding was fixed by
    separating 16 direct structural-validator mutations from six structurally
    valid exact-digest mutations and by enforcing that completed tools cannot
    exceed completed functions. Targeted post-fix correctness review
    `review-1784597722970-iorlpt-kern-5-r2-m4-16-post-review-hard` completed
    1/1 with zero findings. No material finding remains unresolved.
  - [x] M4.17 index-expression canonicalizer tranche: the KERN-authored
    `exprsource` now owns the exact structural `{ index, object, optional }`
    family, recursively canonicalizes both operands, emits bracket syntax, and
    rejects optional, malformed, dangling, and unsupported nested values
    without partial output. The implementation passes 32 exact
    golden/idempotence/KIR fixtures, eight measured witnesses, three
    profile-limit fixtures, 166 hostile mutations, and all 77 structural and
    authentication tests. Authenticated composition is 34,547 bytes at
    SHA-256
    `37b081f3ff01320b96cf7482d096999f4121429d700e8f8fe0852f2f8e1e9308`;
    live format-5 coverage and prerequisite-summary-1 SHA-256 values are
    `fb883f3ed1a4820de75213313aa7f44edfb9f119afb0bdb134d70a78543e7cfa`
    and
    `b7cdd95ad4a023db2f0ce3bbd20c977193bdce08ba78f3e301a1d0a88a080960`.
    Index remains unpromoted, ordinary selection remains null at 21/104 with
    81 legacy parameter blockers, and the six-function winning prerequisite
    closure remains exact. The second-place binding/counting closure rises
    from 1,218 to 1,233 live occurrences because the new KERN branch adds 15
    binding-family facts. Immutable M4.16 prerequisite provenance remains
    byte-identical. The complete Node 22 `pnpm fitness:kern-5` wall passes,
    including every workspace and infrastructure suite, 432 cross-target
    fixtures, 109 class fixtures, 233 native assertions at 100% coverage, and
    every KIR/runtime/ownership/convergence guard. Terminal high-risk
    role-lens review `review-1784601165188-9lbhq4` completed all six usable
    engines with zero verified findings and no unresolved material issue.
  - [x] M4.18 index-expression promotion and remeasurement: coverage policy 3
    replaces the selection-only promotion field with exact typed provenance,
    preserving four immutable selection records while promoting index through
    the immutable M4.16 prerequisite digest
    `3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869`.
    Profile `kern.kir-canonicalizer.profile.m4.18` adds exact recursive
    non-optional index validation, removes index from active candidates, and
    leaves the M4.17 KERN executable byte-identical. Authenticated format-6
    remeasurement remains 21/104 with 81 legacy parameter blockers and a null
    ordinary winner. The live counterfactual prerequisite collapses from the
    two-family M4.15 closure to counted iteration alone: six functions, three
    tools, 14 migrated parameter rows, and 468 occurrences. Coverage and
    prerequisite summary SHA-256 values are
    `6e75ecfe710b9e4ba5ca8df2b5bb0080260a786f37674f5c938db8a5373db1a9`
    and
    `0759e372fa2c10e61bc341518be2b67121772757835107f0bbedc3399a3b3ded`.
    The focused Node 22 gate passes all 77 structural/authentication tests, 32
    runtime fixtures, eight witnesses, three limit fixtures, and 166 hostile
    mutations. The complete Node 22 `pnpm fitness:kern-5` wall passes on the
    exact integrated tree, including all workspace and infrastructure suites,
    432/432 cross-target fixtures, 109/109 class fixtures, native KERN at 100%
    coverage, and every KIR/runtime/ownership/convergence guard. Terminal
    high-risk role-lens review `review-1784604232493-2zm0ma` completed all six
    usable engines with zero verified, needs-check, or speculative findings
    and no unresolved material issue.
  - [x] M4.19 counted-iteration prerequisite handoff: a second canonical
    `kern.kir-canonicalizer.prerequisite-provenance.1` record freezes exact
    published M4.18 commit `8e6cc3a5b721923647a9b1564337d1fd7910edaa`,
    its format-6 coverage-summary hash, its prerequisite-summary-1 hash, the
    21/104 baseline with 81 legacy parameter blockers, and the singleton
    counted-iteration closure at six functions, three tools, 14 migrated
    parameter rows, and 468 occurrences. The new record SHA-256 is
    `af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b`.
    Prerequisite history is now an exact ordered index/counting chain while
    the M4.16 index record remains byte-identical and the current
    implementation pointer remains index. Regenerated coverage and
    prerequisite summary SHA-256 values are
    `aaa9fa135565294eeb84269875242b5fde28ceafb9deb26e21a80eedf9a178d2`
    and
    `d53293f4fd5ab96efe5f4eeda74523e30961316be23ef07628521325f7536123`.
    KERN composition and coverage-policy bytes remain unchanged. The focused
    Node 22 gate passes all 80 structural/authentication/profile tests, 32
    runtime fixtures, eight witnesses, three limit fixtures, and 166 hostile
    mutations. After the final receipt regeneration, the complete Node 22
    `pnpm fitness:kern-5` wall passes on the exact integrated tree, including
    all workspace and infrastructure suites, 432/432 cross-target fixtures,
    109/109 class fixtures, native KERN at 100% declared coverage, and both
    repeated 80-test canonicalizer executions with exact receipt checks.
    Initial high-risk role-lens review `review-1784607983468-z4t569` completed
    five seats before the performance seat timed out; the automatic retry
    `review-1784608629541-khr40o` completed all six usable engines with zero
    verified or speculative findings and no unresolved material issue. Its two
    needs-check items were rejected after verification: bounded repeat
    validation preserves tamper detection for tiny records, and the exact
    two-position chain is deliberately digest/family-bound and mutation-tested.
  - [x] M4.20 counted-iteration canonicalizer tranche: the KERN-authored
    statement member now owns exact recursive default-step `for` validation
    and emission for required `from`, `name`, and `to`. It rejects explicit
    `step`, future or malformed properties, structural-only `$` names,
    unsupported bounds and body statements, and invalid nested loops without
    partial output. Four new valid fixtures raise the corpus to 36 exact
    golden/KIR/idempotence fixtures; 13 hostile mutations raise fail-closed
    coverage to 179 cases. The added witnesses cover parser-admitted empty loop
    bodies plus malformed and non-text names. Authenticated composition is
    36,410 bytes at
    SHA-256
    `55c1b597a8912af545c348c57329d9aef0174590dbe4ba64310484806a8c1307`;
    coverage policy, coverage summary, and prerequisite summary SHA-256 values
    are
    `ede4213ce6a909d820545b92e1d48d34e0575bc22ef26c9683d6d16df3ffb05d`,
    `927553eb48c7be6107a8fd00938ccf2df35a80dc0bbd9ee369ecc11f13bd9182`,
    and
    `927ef4b4229d9319e8312dafaa8a9ef348f6e9f2e5f7db453fd84389e3e36cc0`.
    The focused Node 22 gate passes all 81 structural/authentication tests and
    the complete runtime corpus. Counted iteration deliberately remains
    unpromoted for M4.21: ordinary selection stays null at 21/104 with 81
    legacy parameter blockers, while its authenticated singleton closure stays
    exact at six functions, three tools, 14 migrated parameter rows, and 468
    occurrences. Both immutable prerequisite records remain byte-identical.
    The complete Node 22 `pnpm fitness:kern-5` wall passed after the production
    KERN implementation and initial receipt regeneration, including all
    workspace and infrastructure suites, release policy, 432/432 cross-target
    fixtures, 109/109 class fixtures, 233 native assertions at 100% declared
    coverage, 40 whole-app fixtures across three legs, browser budget, and
    every repeated KIR/runtime/ownership, convergence, and canonicalizer gate.
    High-risk role-lens review `review-1784612259232-nltnpu` completed all six
    usable engines with zero verified or speculative findings. Its four
    needs-check items were disposed against current source: generated
    composition was not a duplicate handwritten owner; missing malformed and
    non-text name witnesses were added; an empty-body fixture proved the
    parser-supported round trip; and cosmetic line compression was replaced by
    a shared helper module. The post-review focused gate passes all 81 tests,
    36 exact runtime fixtures, and 179 hostile mutations while production KERN
    bytes and both immutable prerequisite records remain unchanged.
  - [x] M4.21 counted-iteration promotion and parameter-ready remeasurement:
    coverage profile `kern.kir-canonicalizer.profile.m4.21` promotes the exact
    default-step `for` capability through immutable M4.19 prerequisite digest
    `af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b`.
    The base admits only `for.from`, `for.name`, and `for.to` with portable
    cross-target names; explicit `for.step` remains outside the profile.
    Counted iteration leaves the active-family registry and becomes the live
    implementation pointer while all four selection and both prerequisite
    records remain byte-identical. Live prerequisite summary format 2 now
    separates the six base-only parameter-ready functions across three tools
    and 14 rows from residual structural ranking, preventing an unrelated
    singleton from receiving false completion credit. Binding is the honest
    next prerequisite at five functions, two tools, nine rows, and 801
    occurrences; unary is the only other completing singleton at one function,
    one tool, two rows, and 48 occurrences. Coverage-policy, coverage-summary,
    and prerequisite-summary SHA-256 values are
    `bb4a60b56bf42ea4a75465d84c1b35a7dd9a9ee9599ce418dfb440803c1d7f15`,
    `23f7fc2ebea695a4d0182590171da4e871eb5172fe842309a9297ef994ce3df3`,
    and
    `cf00b028374005140d0aa4add87496684d08439a9e7711a2986b80ffdcff41e8`.
    Authenticated KERN composition remains exactly 36,410 bytes at
    `55c1b597a8912af545c348c57329d9aef0174590dbe4ba64310484806a8c1307`.
    The focused Node 22 canonicalizer gate passes all 82 tests, 36 exact
    runtime fixtures, and 179 hostile mutations. The complete Node 22
    `pnpm fitness:kern-5` wall passed all workspace and infrastructure suites,
    432/432 cross-target fixtures, 109/109 class fixtures, 233 native assertions
    at 100% declared coverage, 40 whole-app fixtures across three legs, browser
    budgets, and every KIR/runtime/ownership/convergence gate before its repeated
    canonicalizer stage exposed a test-only transient-directory race. Corpus
    fixtures now remain outside the authenticated implementation tree; the
    concurrent fresh-process reproducer passed twice and the complete
    canonicalizer gate passed afterward. High-risk review
    `review-1784616172647-5cd21c` completed all six usable engines with zero
    verified findings. Targeted review `review-1784618742992-n5ktt4`
    subsequently completed both automatically routed identities with zero
    substantive findings before publication.
  - [x] M4.22 frozen parameter-ready migration: the exact six-function,
    14-row cohort authenticated by M4.21 now uses ordered direct `param`
    children in checker, canonicalizer, and validator source. Function bodies,
    calls, returns, exports, and root order remain unchanged. Generated checker
    and canonicalizer consumers were rebuilt by repository writers; the
    numeric checker fixture, statement helper, canonicalizer main, and all
    immutable selection/prerequisite records remain byte-identical. The
    authenticated composition is 36,437 bytes at SHA-256
    `0eb8771b873f1b44f7dbe8754b27f159268da5115dcf288e59a627d62f366064`.
    Coverage now measures exactly 27/104 base-complete with 75 remaining
    `fn.params` blockers, a null ordinary winner, and zero remaining base-only
    parameter-ready functions or rows. Binding remains the honest next
    one-family prerequisite at five functions, two tools, nine parameter rows,
    and 801 occurrences; unary remains unchanged at one function, one tool,
    two rows, and 48 occurrences. Coverage-policy, coverage-summary, and
    prerequisite-summary SHA-256 values are
    `7651b89e6a37025994a5bd5700f702508da6272c6aa66a47852633f021d4e5b7`,
    `9cfabe1ea53540a69d3ba4aa4444a2578f9d0c992c53f17a63826600abf2434a`,
    and
    `44b2ce6e4542770cad06201a7d1cc9763a01b2960ce4ef654657b7d455836c8f`.
    Focused coverage/composition tests pass 46/46, checker parity passes 48/48
    with 36 hostile attempts rejected, validator parity passes 39/39, and the
    canonicalizer passes all 82 structural/authentication tests, 36 runtime
    fixtures, 8 measured witnesses, 3 profile-limit fixtures, and 179 hostile
    fixtures. The complete Node 22 `pnpm fitness:kern-5` wall passed every
    workspace, infrastructure, conformance, native, runner, whole-app,
    browser, KIR/runtime, convergence, and repeated canonicalizer gate.
    High-risk role-lens review `review-1784621539302-7wo5z1` completed all six
    usable non-excluded identities with zero verified, needs-check,
    speculative, or nit findings and no routing shortfall.
  - [x] M4.23 binding prerequisite handoff: the exact published M4.22 binding
    result is frozen as the third canonical prerequisite-provenance record at
    SHA-256
    `00f67756052785ece657b451bc22c5f43ce088021cb6c1a48bb83d99ca2343ab`.
    Its source binds commit `ca99949f28aca5c39f182f67a35b1342762cc6cd`,
    the published coverage/prerequisite summaries, profile M4.21, 27/104
    base-complete functions, 75 legacy parameter blockers, and the exact
    singleton binding closure: five functions across two tools, nine migrated
    parameter rows, six catalog facts, and 801 occurrences. The prerequisite
    chain is now exactly index, counted iteration, and binding; both historical
    loaders remain exact, while the implementation pointer deliberately stays
    on counted iteration. No KERN source, composition, policy, profile, family
    registry, runtime ABI, or live semantic result changed. Regenerated
    coverage-summary and prerequisite-summary SHA-256 values are
    `7544fee6ffe3239b7f9851b364b72244f54f36585c8b946474aa2cbfcd5626e5`
    and
    `b118993d69f35b40a632dec123e49d9ea1628e400bc64d18ebea1d269063aa2e`.
    The focused canonicalizer gate passes 86/86 structural/authentication
    tests, 36 runtime fixtures, 8 measured witnesses, 3 profile-limit fixtures,
    and 179 hostile fixtures. The complete Node 22 `pnpm fitness:kern-5` wall
    passed every workspace, infrastructure, conformance, native, runner,
    whole-app, browser, KIR/runtime, convergence, and repeated canonicalizer
    gate. High-risk role-lens review `review-1784624663111-i58ebe` completed
    all six usable non-excluded identities with zero verified, needs-check, or
    speculative findings and no routing shortfall. Its one concrete nit, an
    unused import left by the test extraction, was removed and the 16 affected
    handoff tests passed afterward; three suggested DRY refactors remain
    deliberately deferred because explicit family pins are the fail-closed
    evidence boundary in this slice.
  - [x] M4.24 binding canonicalizer tranche: the KERN-authored statement
    member now owns exact `let` and direct `assign` validation and canonical
    emission. The admitted shape is exactly `let.name`/`let.value` and
    `assign.target`/`assign.value`; optional declaration metadata, assignment
    operators, future properties, malformed names, non-assignable targets,
    unsupported expressions, and children fail closed without partial output.
    Four new valid fixtures raise the runtime corpus to 40 exact
    golden/KIR/idempotence cases; 23 new hostile mutations raise fail-closed
    coverage to 202 cases. Authenticated composition is 39,340 bytes at
    SHA-256
    `fbc7cd4a38910b7fb4f97ce6b4ebb843da0ebc4543d069958652e40932e54fa8`.
    Coverage-policy, coverage-summary, and prerequisite-summary SHA-256 values
    are
    `29b5cae01b6e8573b2cbb632d2e968398c002c5b948a6855f2983fc47ba316e4`,
    `d0dcae5a55cb5984bcca6d8c698000a8137302bba4fd3e1cb34027d8c73cab54`,
    and
    `20c82af0928a6c16755bfa1c81a527b2d1da4f03665f895c4ee9893a14390893`.
    Binding deliberately remains unpromoted: live coverage stays 27/104 with
    75 legacy parameter blockers, no ordinary winner, and no parameter-ready
    row. The same five-function, two-tool, nine-row singleton remains next;
    its live occurrence count rises from the immutable M4.23 value of 801 to
    852 because the KERN implementation itself contains binding nodes. All
    three prerequisite records remain byte-identical and the implementation
    pointer remains counted iteration. The focused Node 22 gate passes all 87
    structural/authentication/profile tests, 40 runtime fixtures, eight
    measured witnesses, three limit fixtures, 202 hostile mutations, and the
    exact final coverage check. The complete Node 22 `pnpm fitness:kern-5`
    wall passes every workspace and release-policy gate, 432/432 cross-target
    fixtures, 109/109 class fixtures, 233/233 native fixtures, 40 whole-app
    fixtures across three legs, the checker/validator/KIR/runtime contracts,
    and the repeated canonicalizer gate on the final implementation tree.
    High-risk role-lens review `review-1784628519839-yy1k63` completed all six
    usable non-excluded identities with no routing shortfall and no unresolved
    material finding. Its claimed blocker was disproved against decoded KIR:
    `binding-assign-nonassignable-target` changes the assignment roots from
    `target=identifier`/`value=binary` to
    `target=binary`/`value=identifier`, and the complete hostile runner proves
    that supported-but-nonassignable target rejects. The suggested generic
    fixture-helper extraction and remaining nits are deferred because they do
    not affect correctness and would widen this authenticated tranche.
  - [x] M4.25 binding promotion and parameter-ready remeasurement: cumulative
    profile `kern.kir-canonicalizer.profile.m4.25` now promotes the exact
    direct-binding family through immutable M4.23 prerequisite digest
    `00f67756052785ece657b451bc22c5f43ce088021cb6c1a48bb83d99ca2343ab`.
    Binding is removed from active families and becomes the implementation
    pointer; do, exception, unary, and while retain their relative order. The
    promoted profile admits only leaf `let` with structural `name` plus
    recursive `value`, and leaf `assign` with recursive `target`/`value` plus
    an identifier, member, or index target root. The KERN executable remains
    byte-identical at 39,340 bytes and SHA-256
    `fbc7cd4a38910b7fb4f97ce6b4ebb843da0ebc4543d069958652e40932e54fa8`.
    Policy, coverage-summary, and prerequisite-summary file SHA-256 values are
    `4b8888e4e1f64b8356949f1b823f80e5a84c0594b1a864cdd7804d805ac13991`,
    `377d43bdf852e7981c0a6ca80927c862700982833df7b14de7d2b1e2f3e6c0df`,
    and
    `e62f14054d00cf76ca0e362c88b453a9777d415a9c131f16f38602580f530260`.
    Live measurement remains 27/104 base-complete with 75 legacy parameter
    blockers and no ordinary winner, while the exact five-function/two-tool/
    nine-row binding witness set becomes parameter-ready. Residual ranking
    selects unary expression as the next one-family prerequisite at 48
    occurrences, with `numberat` as its one two-row witness. The focused Node
    22 gate passes all 88 structural/authentication/profile tests, 40 runtime
    fixtures, eight measured witnesses, three profile-limit fixtures, 202
    hostile fixtures, and the final exact coverage check. The complete Node 22
    `pnpm fitness:kern-5` wall passes every workspace, release-policy, and
    infrastructure gate; 432/432 cross-target fixtures; 109/109 class
    fixtures; 233/233 native fixtures at 100% coverage; 40 whole-app fixtures
    across three legs; runner/browser budgets; checker, validator, KIR,
    runtime, ownership, and convergence contracts; and the repeated
    canonicalizer gate on the final M4.25 tree. Terminal Agon review
    `review-1784631411129-sr8uax-kern-5-r2-m4-25-binding-promotio` completed
    with the exact `claude,codex,agy` roster: 3/3 succeeded with zero findings.
    An additional high-risk review `review-1784631406278-9iplpf` routed all six
    then-usable non-excluded identities
    with no shortfall. Its one claimed blocker incorrectly assumed authored
    source strings bypass `projectExpressionText`; the exact binding
    admission/mutation test proves `state.value` is an admitted member root
    while call and binary targets reject. The related `let.kind` concern is
    disproved by exact unexpected-property validation. Remaining findings are
    non-material cleanup/performance nits. Signed commit
    `f56cb91e0bce3aa328b6020809d18312fdc6dc36` is published on both `main` and
    `feat/kern-5-r2-m4-25-binding-promotion`.
  - [x] M4.26 frozen binding parameter migration: exactly the five M4.25
    base-only witnesses now use direct ordered `param` children. `propcount`,
    `childcount`, `valuechildcount`, `indentation`, and `paramcount` lose only
    their legacy `fn.params` headers and gain nine equivalent rows; bodies,
    calls, root ordering, M4.25 profile, active families, and all immutable
    provenance remain unchanged. Expression helpers are 174 lines, statement
    helpers 146, and validator 481. Repository writers regenerate the checker
    consumer and the 39,430-byte canonicalizer composite at SHA-256
    `5337c271465e710261901af18fe55d19a6e69a62f976d0d0fe44df209c4a2974`;
    canonicalizer main and numeric checker remain byte-identical. The three
    changed handwritten source digests are
    `3b5c6affbb2232c5bd0cfcf2d73fdb2141b22ca50e074ff750f926798620d417`,
    `cc4e9aaafc55269e1278d354776c67924737d32e1824413708cb01a6ac2f4f62`,
    and `95ba4b55a80f939f3e04bc9b53dd244c5100e19e9e4c0d40d577bf5ec4f4cbe4`.
    Policy, coverage-summary, and prerequisite-summary file SHA-256 values are
    `9a1175b209c38ee0a56ef2da8ee114170e87455e6a0ccd79a3f838dd8558e653`,
    `d1b8de698fb76227e586fd3e101895f0a0cd1c5c204fc0edb79a838fef2a2fbf`,
    and `df2316b3ec0d1fa169640bea723483574332ef43174341471537065bcceb5e12`.
    Live coverage is 32/104 with 70 `fn.params` blockers, no ordinary winner,
    and an empty base-only migration queue. Unary expression remains the next
    one-family prerequisite at 48 occurrences with `numberat` as the single
    two-row witness. The complete Node 22 `pnpm fitness:kern-5` wall passes on
    the final implementation tree, including all workspace, release-policy,
    cross-target, class, native, whole-app, checker, validator, KIR, runtime,
    ownership, convergence, browser-budget, and repeated canonicalizer gates.
    Automatic high-risk role-lens review `review-1784634663411-o7v3xc` routed
    all six usable non-excluded identities with no exclusions or shortfall;
    all six returned and none reported a blocker. The only count-correction
    claim reflected an out-of-scope test injected by an earlier auxiliary
    review process; removing that contamination and regenerating its stale
    receipts restored implementation digest `8a22fa8e68c94910f16382cf761965b8331279d44b87e0a0219948fca963770c`
    and the exact 33/33 focused gate. Remaining findings are non-material
    future assertion-refactoring and process nits.
    Review-discovered coverage now directly proves the counterfactual
    partitioner distinguishes base-ready from residual blocked facts.
  - [x] M4.27 unary-expression prerequisite handoff: published M4.26 commit
    `e22a02418f14b6de9619b08b63281abdbc002ef1` is frozen as the fourth exact
    prerequisite record. The 1,214-byte canonical record has SHA-256
    `e64147e572dff26720b7efae7353583ac2b97b0b37001a9cd835909684dfd9e5`
    and binds coverage summary
    `276c3d0a0673cf22027f65b9c532a79be4e018749aa7b8d50d421defd125271c`,
    prerequisite summary
    `8a1bc1d5082760c0cf81a38f71225761ac8bf22accac34ee0ddb7207abb7dffb`,
    the 32/104 M4.25 baseline with 70 legacy blockers, and the exact singleton
    unary closure: one canonicalizer function, one tool, two parameter rows,
    one catalog fact, 48 occurrences, and witness `numberat`. The authenticated
    chain is exactly index, counted iteration, binding, unary while live
    implementation provenance remains binding. Historical record bytes, KERN
    composite, policy, profile, registry, corpus, function facts, and semantic
    measurement remain unchanged. Regenerated coverage and prerequisite
    summary SHA-256 values are
    `79a0b773b85eb44fac193d7ee50f4f7161dc44b8affc4ce85fb59767eb32ce40`
    and `a3cc02fedb90c211c3621a06daad7ba0bb3c4323a6747d046a9bdbfdf1913e32`;
    implementation digest is
    `2fd49ffdc1e07c9eda5e7830b411117485b26ae9a95acdf466910749c1d2190a`.
    The focused Node 22 canonicalizer gate passes 91/91 structural and
    authentication tests plus all 40 runtime fixtures, eight witnesses, three
    profile-limit fixtures, 202 hostile fixtures, and the exact terminal check.
    The complete Node 22 KERN 5 fitness wall passes on the same tree: every
    workspace, release, and infrastructure gate; 432/432 cross-target and
    109/109 class fixtures; 233/233 native contracts at 100%; 40 whole-app
    fixtures across three legs with Express/FastAPI boot; runner/browser
    budgets; checker, validator, KIR, runtime, ownership, and convergence
    gates; and the repeated canonicalizer 91/91 plus 40/8/3/202 terminal
    fixtures with exact 32/104 coverage and unary still next. Terminal Agon
    review `review-1784637760933-cyd05w-kern-5-r2-m4-27-unary-prerequisi`
    completed with the exact `claude,codex,agy` roster: 3/3 engines succeeded
    with zero findings.
  - [x] M4.28 unary-expression canonicalizer tranche: KERN `exprsource` now
    owns exact fail-closed validation and universally grouped source emission
    for parser-portable unary `!`, `-`, `~`, and `typeof`. It rejects unary
    `+`, `void`, negative zero, malformed shapes, unsupported arguments, and
    invalid recursion without events or partial output. The authenticated
    composite is 40,414 bytes at SHA-256
    `178f9ad3e90cae8de9aa3ee5963dfc6a1acd5c70853ac7904c6228548a1e251a`;
    handwritten main is 23,666 bytes at
    `5472494a26004621d1ac76b0571432462c74da88563e4e3fca9ca7a2394a42e2`.
    Policy, coverage-summary, and prerequisite-summary file SHA-256 values are
    `33680d7f1aefebb4efa3bc8c40102f2669436042677779627807ed0274357cb6`,
    `d1e3f21ca3efab4f28aff136e83e1fedd3f52e8e7c7d374d4a1f4fa40043e9c4`,
    and `fabfd3b802db25c0788e6f46582f471a8860bf54a02c8c4d23dc67e4b5aa2ac7`;
    implementation digest is
    `f2799971b9cb44932b5ca874740f59a860635bef31c2de4dc34ce6b39c6a2775`.
    The focused Node 22 canonicalizer gate passes 92/92 tests plus 48 exact
    runtime fixtures, eight witnesses, three profile limits, and 218 hostile
    fixtures. Live coverage remains 32/104 with 70 legacy blockers and unary
    unpromoted; immutable M4.27 provenance remains exact at 48 occurrences
    while the live corpus observes 49 after implementation. The complete Node
    22 `pnpm fitness:kern-5` wall passes on the exact integrated tree after
    test-only review hardening, including every workspace, release-policy, and
    infrastructure gate; 432/432 cross-target, 109/109 class, 233/233 native,
    and 40 whole-app fixtures; and the repeated 92/92 plus 48/8/3/218
    canonicalizer terminal gate. Review hardening corrects the helper
    ownership escape needle and directly proves fail-closed rejection of a
    negative-integer KIR argument with unchanged production hashes and
    coverage.
    Required high-risk role-lens review `review-1784641872553-abfibk` routed
    all six usable non-excluded identities with no exclusions or shortfall;
    all six returned, with zero material findings and one deferred fixture-DRY
    nit. Exact-final targeted review
    `review-1784644332568-66l4h5-kern-5-r2-m4-28-unary-canonicali` then
    completed 3/3 with zero blocking, correctness, or security findings and one
    deferred negative-zero structural-hardening nit.
  - [x] M4.29 unary-expression promotion and bounded prerequisite exhaustion:
    the cumulative base advances to `kern.kir-canonicalizer.profile.m4.29`
    through exact immutable M4.27 prerequisite provenance
    `e64147e572dff26720b7efae7353583ac2b97b0b37001a9cd835909684dfd9e5`.
    Its local profile admits only recursively valid `!`, `-`, `~`, and
    `typeof`, keeps negative zero rejected, removes unary from active families,
    and leaves the KERN composite byte-identical at 40,414 bytes and SHA-256
    `178f9ad3e90cae8de9aa3ee5963dfc6a1acd5c70853ac7904c6228548a1e251a`.
    Policy, coverage-summary, and prerequisite-summary file SHA-256 values are
    `d2bee244fce9cfeae7c3fe327bcdbc694bac1b631c910d7a459dd3a79a4de636`,
    `8c31aeb81b5523899eb66ac771e783fadb28f8a2102c5a6d0eb4632008b5c082`,
    and `d1d44548a3d332489ce17ac55ca69bd89e196d48373f03f58416ca7617948821`;
    coverage implementation and profile digests are
    `b8d6102c904311628111720d5383c2f75989cbf22e76dd4106acad7f14635cba`
    and `2f17f2ec8537172a761fc8043f0a3c9e19a1852d4bb4755daf182c4bec2d1afa`.
    Live coverage remains 32/104 with 70 legacy parameter blockers. Exact
    counterfactual measurement makes `numberat` the only base-ready migration
    witness at one function, one tool, and two parameter rows. None of the
    remaining 69 functions completes under any of the seven non-empty closures
    of do, exception, and while, so format 3 records explicit
    `bounded-exhaustion`, a null minimum/selection, the derived reason census,
    and assignment digest
    `7cd89ffda2d591cf9a82fa0f836d5b7f095887a33a9b4c843a117a0ab6734c1c`.
    This is exhaustion only within the authenticated current profile, corpus,
    projection, registry, and limits; it is not KERN 5 completion. A mandatory
    six-engine confidence-gate brainstorm
    `brainstorm-1784645342548-1oulrm-kern-5-m4-29-prerequisite-exhaus`
    changed the initial format-2/null design into this discriminated and
    authenticated terminal outcome. The
    focused Node 22 gate passes 95/95 structural/authentication/profile tests,
    48 runtime fixtures, eight measured witnesses, three profile limits, and
    218 hostile fixtures. The complete `pnpm fitness:kern-5` wall passes on the
    same tree, including every workspace, release-policy, cross-target, native,
    whole-app, browser-budget, KIR, runtime, ownership, convergence, diff, and
    repeated canonicalizer gate. The next action is the digest-bound exact
    `numberat` parameter migration. Initial high-risk role-lens review
    `review-1784648104213-k92ywc-kern-5-r2-m4-29-unary-promotion` completed
    6/6 and exposed two material authentication/consumer gaps. The final tree
    binds every format-3 baseline, witness, and policy field exactly, admits
    format 3 through the generic provenance consumer, and mutation-kills both
    fixes. Exact-final high-risk role-lens review
    `review-1784651102229-a55dcn-kern-5-r2-m4-29-exact-final` completed 6/6
    with zero verified, needs-check, or speculative findings; fourteen
    diagnostic, naming, comment, tracking, or test-clarity nits were deferred.
    After final authentication hardening regenerated the implementation and
    receipt digests, the complete Node 22 fitness wall passed again on the
    exact tree. Targeted security/correctness/overall confirmation
    `review-1784653499792-znrm3j-kern-5-r2-m4-29-unary-promotion-` completed
    3/3 with no findings.
  - [x] M4.30 frozen unary parameter migration: published M4.29 receipt
    `d1d44548a3d332489ce17ac55ca69bd89e196d48373f03f58416ca7617948821`
    authenticates `canonicalizer-expression-helpers.kern#9:numberat` as the
    sole base-ready legacy-parameter witness with ordered `id:number` and
    `values:number[]` rows and counterfactual profile rows 8/14/66. M4.30
    removes only its legacy `fn.params`, inserts those two direct parameter
    children, and preserves the handler body, calls, root ordinal, M4.29 base,
    active families, and every historical provenance record. Expression
    helpers become 176 lines at
    `55c8a6e54bc4442ee91af43eb7fc4fb0c2fad325d48477710bbbcce7e138ba91`;
    main and statement-helper hashes remain exact. The repository writer
    regenerates a 40,441-byte composite at
    `bf2b2c1f1e8fa85174d72503d836b3a305467af20c560a6e9f037ac616b97bb5`.
    Policy, coverage-summary, and prerequisite-summary SHA-256 values are
    `6c19138011e493a28444fca1899c1c9418b292f30f0aff0ab7e02341d9a50f67`,
    `2af38c98be269861f472182463df850b7111e40389acf0e49e1fc65e3c4b4c5b`,
    and `9dd7d8e117deeb473c6d802d735e9e4fbdad7a8d8d34ac304ef4eea5c483501a`.
    Live measurement is 33/104 with 69 `fn.params` blockers, no ordinary
    winner, zero base-ready migrations, and the same authenticated
    69-function bounded exhaustion. The focused gate passes 95/95 plus
    48/8/3/218. The next action is residual blocker analysis, not another
    structural-family or parameter-migration claim. High-risk role-lens review
    `review-1784656775259-u4e3qa-kern-5-r2-m4-30-numberat-paramet` completed
    6/6 and found one shared future-proofing gap: parameter-migration witnesses
    no longer exercised residual-ranking disjointness after the queue became
    empty. M4.30 restores the always-on invariant, adds a synthetic overlap
    rejection, regenerates authenticated receipts, and passes the exact
    focused gate again with no unresolved material finding.
  - [x] M4.31 authenticated residual blocker analysis: the unchanged M4.29
    base leaves 69 legacy-parameter functions after M4.30, but the bounded
    exhaustion receipt previously authenticated only their aggregate reason
    census. Format `kern.kir-canonicalizer.residual-analysis.1` now publishes
    one exact assignment for every residual function, reproduces assignment
    digest `7cd89ffda2d591cf9a82fa0f836d5b7f095887a33a9b4c843a117a0ab6734c1c`,
    and binds the unchanged 33/104 baseline, 69 `fn.params` blockers, function
    facts, coverage policy, and implementation bytes. Of the 69 functions, 53
    expose counterfactual profile rows. The analysis derives 50 distinct
    observed settings and 50 actionable candidates without changing KERN,
    profile policy, the runtime, KIR, or ABI. Ranking first minimizes changed
    axes, then maximizes cross-tool evidence, then minimizes total widening.
    It selects value rows 72 to 106 with node/property limits unchanged: 12
    functions complete across all four tools. The exact coverage,
    prerequisite, and residual-analysis receipt SHA-256 values are
    `668c7e1eec36107c02508535e79c15e5f707dfa4f8e22cc6ab459d95060291cd`,
    `8c29baf2d234e95864819e41d6285a358dc8e23f3193b79f06d69be7d26d5ef6`,
    and `160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076`.
    The next action is a separately reviewed M4.32 value-row profile
    promotion, not an implicit limit change inside this analysis slice.
  - [x] M4.32 authenticated value-row profile promotion: the only admission
    change raises `maxValueRows` from 72 to the M4.31-selected 106 while node
    and property ceilings remain exactly 16 and 30. KERN source, its 40,441-byte
    composite at
    `bf2b2c1f1e8fa85174d72503d836b3a305467af20c560a6e9f037ac616b97bb5`,
    the runtime envelope, KIR, ABI, corpus, base profile, and active structural
    families remain unchanged. The exact 16/30/106 construction executes and
    canonicalizes idempotently; changing one additional parameter type produces
    16/30/107 and fails closed without events or a partial result. M4.31's
    residual-analysis receipt is now an immutable published handoff pinned to
    commit `fdf55cfb52616ef9bdf006a42f6a58a56a10b7c1` and remains byte-identical at
    `160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076`;
    coverage writes cannot regenerate it. The M4.32 policy, coverage, and
    prerequisite receipt SHA-256 values are
    `9d3229bc2554adf7b49ff2fa0cba8885d156cb2f4e4b3b20fc9094719fc32279`,
    `5f2519ef25f7e66564a684485eb4a1c5c7b0b40946d9b1dff40bd03d73f3ae08`,
    and `274819d899252c815d9caeb9203077a4c5dca29003070c61108cb920444b1e79`;
    implementation digest is
    `216067ddd4c3833aa13485d26184326a9bec318d454c744e6dff7d51cffce4ba`.
    Live coverage remains honestly 33/104 with 69 legacy-parameter blockers,
    while the frozen next queue becomes exactly 12 functions, four tools, and
    44 parameter rows. The remaining partition selects one disjoint
    `do-statement` witness, `appendid`; terminal guidance deliberately
    prioritizes consuming the authenticated parameter queue. The focused Node
    22 canonicalizer gate passes 98/98 structural/authentication tests plus
    48 exact runtime fixtures, eight witnesses, three profile-limit fixtures,
    and 218 hostile mutations. The complete Node 22 `pnpm fitness:kern-5`
    wall passes on the exact integrated tree, including every workspace and
    infrastructure suite, 432/432 cross-target fixtures, 109/109 class
    fixtures, 233/233 native assertions at 100% declared coverage, 40
    whole-app fixtures across three legs, browser budgets, and every repeated
    KIR/runtime/ownership/convergence/canonicalizer gate. Review performance
    reproduction measured the synchronous exact boundary at 4.636 seconds for
    16/30/72 and 14.089 seconds for 16/30/106. That is accepted only as bounded
    internal evidence: no later profile widening is allowed, and the quadratic
    table validator requires an explicit budgeted optimization before runtime
    cutover or RC. High-risk role-lens review
    `review-1784665356538-orqubl` completed all six usable non-excluded seats.
    Its apparent blocking missing-import finding was rejected against the
    current file and repeated fresh-process passes; the import already exists.
    The stale live/historical status ambiguity was genuine and is fixed with
    explicit past-tense M4.31 labeling. The performance finding was reproduced
    at the timings above and bound as pre-cutover work, leaving no unresolved
    material M4.32 finding.
  - [x] M4.33 frozen value-band parameter migration: the exact authenticated
    M4.32 cohort is consumed without a policy, body, call, return, KIR, runtime,
    ABI, family, or corpus-membership change. Exactly 12 functions across five
    handwritten sources lose legacy `fn.params` and gain 44 ordered direct
    parameter rows. Base completion advances from 33/104 to 45/104,
    `fn.params` blockers fall from 69 to 57, and the base-only parameter queue
    becomes empty. The residual selection remains exactly one `do-statement`
    witness, `examples/selfhost-validator/validator.kern#14:appendid`, with two
    counterfactual rows and 176 occurrences. The live coverage and prerequisite
    receipt SHA-256 values are
    `8550b80e0a98da57f26a9c78ac762b0049cc02146202b278e817bf07051d774a`
    and `d8c2fdd07c96ce6548edd1121ae0eea1596c14a52f25d4caab15cf259edf1e1c`;
    policy SHA-256 is
    `cc4b84c8655a458890edb6c7b79a07a5c1af7997db172a559c7cdeec47ff33b6`
    and the authenticated coverage implementation digest is
    `3e47fea76a74d98bf742777d486a6b2f898d569bee01c1526942b87f6f1271c4`;
    the historical M4.31 handoff remains byte-identical at
    `160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076`.
    The regenerated canonicalizer composite is 40,459 bytes at
    `e58663c3bdc552faa094b8318650f8791f30056ceea81a4888293fc64f348101`.
    Focused behavior gates pass 13/13 assertion-engine, 48/48 checker, and
    39/39 validator fixtures; canonicalizer gates pass 99/99 tests, 48 runtime
    fixtures, eight witnesses, three profile-limit fixtures, and 218 hostile
    mutations. The complete Node 22 `fitness:kern-5` wall passes on the exact
    integrated tree. Automatic high-risk role-lens review
    `review-1784669163876-ojpnpj` first exposed the new guard's omission from
    the supplied diff; complete-diff review `review-1784669744046-mlgid4`
    finished 6/6 and then found a real parameter-after-handler guard gap. RED
    reproduced it, the exact-prefix and immediate-handler checks now kill it,
    and targeted security confirmation
    `review-1784669870369-4xtdh7-kern-5-r2-m4-33-value-band-param` returned no
    finding on the hardened tree. Final exact-diff review
    `review-1784672564559-4cf8of-kern-5-r2-m4-33-value-band-param` completed 7/8
    usable non-excluded seats with zero verified or needs-check findings;
    OpenCode had a parse failure. Its lone speculative check-mode claim was
    disproved against the current non-write assertion branch. No material
    review finding remains. The next slice freezes the exact do-statement
    prerequisite before any implementation or promotion.
  - [x] M4.34 do-statement prerequisite handoff: the exact published M4.33
    result is frozen as a fifth immutable prerequisite-provenance record. The
    canonical record binds commit
    `f91c92aa63524c65c261d1f34f2187c55455ea6b`, the published coverage and
    prerequisite receipts, the unchanged M4.29 baseline, and the singleton
    `examples/selfhost-validator/validator.kern#14:appendid` closure with one
    function, one tool, two migrated parameter rows, two catalog facts, and
    176 occurrences. Its SHA-256 is
    `3d865f4983e7febd26540db681c88d8749d156f5d180405b831b5ccd7fb54d72`.
    The ordered prerequisite chain is now exactly index, counted iteration,
    binding, unary, and do; implementation provenance deliberately remains
    unary at chain index 3. Regenerated coverage and prerequisite summary
    SHA-256 values are
    `017ba566b0648fe9a7eb9d10b4646bda267273abeb0223831040d59a1cfad9fe`
    and `8f95372d6bd48f309a01efc045a2a2698bb38346169313d78b87b6e9c22a2a92`,
    with authenticated implementation digest
    `283ab5664e670b1efbeb32809aeae7a35ed17febfc4c3e7762e30253b760dd20`.
    Policy and canonicalizer bytes remain unchanged. Focused integration is
    38/38, the promotion regression is 9/9, and the complete canonicalizer
    gate passes 102/102 tests plus 48 runtime fixtures, eight witnesses, three
    profile-limit fixtures, and 218 hostile mutations. M4.35 may consume this
    immutable handoff to implement do canonicalization; M4.34 does not migrate
    `appendid`, implement do, or promote any family. The exact final-tree Node
    22 `pnpm fitness:kern-5` wall passes. Automatic high-risk role-lens review
    `review-1784675099637-as8in6` completed 6/6 usable non-excluded engines with
    zero verified findings. Its two needs-check items were non-blocking
    historical-mechanism refactor suggestions; positional validation and the
    newest exact-chain test remain deliberately explicit for this evidence-only
    slice. No material review finding remains.
  - [x] M4.35 exact do-statement canonicalizer implementation: the immutable
    M4.34 handoff is consumed without promoting do, migrating `appendid`, or
    changing parser, structural KIR, runtime, ABI, public exports, profile, or
    family registry. KERN now validates `do` as exactly one required `value`
    expression with zero children and emits one canonical quoted `do value=`
    line through the existing recursive expression owner. Three valid fixtures
    cover direct calls, canonical argument spacing, and nested control flow;
    eight hostile mutations cover missing, duplicate, excluded, future,
    non-expression, unsupported-expression, and child-bearing forms. The
    statement member is 158 lines and 11,014 bytes at
    `475ec6bcaa3bcc3610a1dcb64cfa9175ee8faf00a20d458586b2003fd7009314`;
    the authenticated composite is 41,190 bytes at
    `40cadf5358a539eb54bfdd54adf48fba508d4c7eb03541a400e4d7e16f42b6a3`.
    Live do evidence rises from the immutable 176 to 178 while M4.29 remains
    the base profile, coverage remains 45/104, `fn.params` blockers remain 57,
    and unary remains implementation provenance. Policy, coverage, and
    prerequisite receipt SHA-256 values are
    `fa5cedd2be8cac69bf4798826848ccf445e6788738685e015be149f5d3df67a4`,
    `3be607f15bcd762a24ece0dacf2816fded0dd9b57b082780fe2f6590bf27632a`,
    and `e932f7f4c85f9aedc02b76ba13ea1e91033be0998303fc997ce067a7f617f832`;
    implementation digest is
    `5f25fd30c54b55a770b1bcce0828316d147f283e40ff68c67452ca7a6a1d457b`.
    Focused Node 22 canonicalizer validation passes 103/103 tests, 51 exact
    runtime fixtures, eight witnesses, three profile-limit fixtures, and 226
    hostile mutations. The complete pre-review Node 22 `pnpm fitness:kern-5`
    wall also passes, including the final canonicalizer replay at the exact
    receipt-bound 45/104 state. Initial automatic high-risk role-lens review
    `review-1784678742702-fdb847` completed all six usable non-excluded seats.
    Five seats found no blocker; Kimi and Z.AI exposed one real fixture-
    precision issue, now fixed by making the displaced expression's return
    path valid so malformed `do.value` is the witness's only rejection cause.
    The exact final-tree focused gate passes after regenerated authenticated
    receipts; that hostile fixture is the only post-wall implementation change.
    MiniMax's value-ID ordering and digest-authentication claims were disproved
    against append-only allocation and live digest regeneration. No material
    review finding remains.
  - [x] M4.36 do-statement profile promotion: the cumulative base advances to
    `kern.kir-canonicalizer.profile.m4.36` through immutable M4.34 do
    prerequisite provenance
    `3d865f4983e7febd26540db681c88d8749d156f5d180405b831b5ccd7fb54d72`.
    The base adds only leaf node `do` and required recursively expression-valued
    property `do.value`; do leaves active families while exception and while
    preserve order. All KERN source and the 41,190-byte composite remain exact
    at `40cadf5358a539eb54bfdd54adf48fba508d4c7eb03541a400e4d7e16f42b6a3`.
    The 511-line profile source is split into a 431-line evaluator and 96-line
    base contract. Live remeasurement makes
    `examples/selfhost-validator/validator.kern#14:appendid` the sole
    parameter-ready witness with two rows and profile rows 9/16/80. The two
    residual families exhaust all three non-empty closures with zero completing
    closures, 56 residual functions, and assignment digest
    `8ae6a54e20836ad1b560c88c59fed44e6bd96ecdfbee30cf5cb5404d44f0daef`.
    Policy, coverage, and prerequisite receipt SHA-256 values are
    `5e806bf8f4078bf07a2190df6b1be11a8a2fc3e4e77cad668e6030ac1ca1cb0b`,
    `d334c6843c9730a25cca07ca26c389563609cc8deb39ea6de214f41d8e9caf21`,
    and `20055d5b554a116776d8bda54b832703fca85eddb6f5f7bbf7f7957b4d0f751f`;
    implementation digest is
    `c6940a950795d304a2b6bbd88dfc16e96e5a355babec135f882cf484b7603aa5`.
    The complete focused canonicalizer gate passes 104/104 tests, 51 exact
    runtime fixtures, eight witnesses, three profile-limit fixtures, and 226
    hostile mutations. The exact integrated tree also passes the complete Node
    22 `pnpm fitness:kern-5` wall on 2026-07-22, including all workspace and
    infrastructure suites, 432/432 cross-target fixtures, 109/109 class
    fixtures, 233 native KERN assertions at 100% coverage, self-host smoke, and
    the terminal canonicalizer gate. Automatic high-risk role-lens review
    `review-1784683098662-uov4yq` completed all 6/6 live usable seats with zero
    verified, needs-check, or speculative findings. Four nits were checked
    against exact source and required no change: the questioned export exists,
    both measured file lengths are exact, extraction need not preserve their
    sum, and the bounded nine-entry promotion serialization is immaterial. No
    material review finding remains.
  - [x] M4.37 frozen `appendid` parameter migration: published M4.36 receipt
    `20055d5b554a116776d8bda54b832703fca85eddb6f5f7bbf7f7957b4d0f751f`
    authenticates `examples/selfhost-validator/validator.kern#14:appendid` as
    the sole base-ready legacy-parameter witness with ordered `xs:number[]` and
    `id:number` rows and profile rows 9/16/80. M4.37 removes only its legacy
    `fn.params`, inserts those two direct children, and preserves its body at
    semantic digest
    `24064fe7a08b3e1c82733710d090dd7f10ec2e8ee1621b7cc2a4e6983aeed72e`.
    The 490-line validator is
    `d0a458b709e8e3c2675f2b017623557679cb59007ca0012dd6c44b5ddbb8b7cd`;
    its generated checker fixture reproduces at
    `fc71450c1e5a79accd971ee5a3afd046042a25bb305abdf947986b0528ecfa65`,
    while the numeric fixture and 41,190-byte canonicalizer composite remain
    exact. Policy, coverage, and prerequisite summary SHA-256 values are
    `f441b42d80b0fbbe1d858efafddfc8b713b3633699f0d125df9541f90afdb987`,
    `677f7ec0ae9616017a0db891d5cf87bce93fbb0d93b05f20a758153c2d7eda81`,
    and `2922af3886bd0436cdd9f11f247cb46092cf8a94c6d70b07f80b914d3ee5b849`.
    Live measurement advances to 46/104 with 56 `fn.params` blockers, an empty
    migration queue, and the unchanged 56-function bounded exhaustion. The
    focused gate passes 104/104 plus 51/8/3/226; checker and validator gates
    pass 48/48 and 39/39. The exact integrated tree passes the complete Node 22
    `pnpm fitness:kern-5` wall on 2026-07-21, including every workspace and
    infrastructure suite, 432/432 cross-target fixtures, 109/109 class
    fixtures, 233 native KERN assertions at 100% coverage, self-host smoke,
    browser budgets, and the terminal canonicalizer replay. Automatic
    high-risk role-lens review `review-1784686452451-qok4j4` completed all 6/6
    usable non-excluded seats with zero verified or speculative findings.
    Three dryness needs-check items require no slice change: the 365-line
    handwritten assertion module remains below the explicit 500-line split
    threshold, a neutral helper extraction would broaden this frozen singleton
    migration, and folding `appendid` into the M4.33 target table would mutate
    a historical cohort. The ordinal-14 contract is deliberately exact and
    both imported helpers are exported. No material review finding remains.
  - [x] M4.38 authenticated current residual blocker analysis: published M4.37
    commit `daeca7e16b4a31454e5e7f6db74747f2eae2de03` supplies the exact
    56-function bounded-exhaustion population at profile limits 16/30/106.
    Version-2 analysis reproduces reason-assignment digest
    `8ae6a54e20836ad1b560c88c59fed44e6bd96ecdfbee30cf5cb5404d44f0daef`,
    publishes 56 canonical assignments, and evaluates 39 distinct observed
    settings from the 40 functions with profile rows. All 39 settings are
    actionable. The first ranked setting changes only `maxValueRows` from 106
    to 154, a delta of 48, and completes 11 functions across checker,
    canonicalizer, and validator tools. Coverage, prerequisite, and M4.38
    receipt whole-file SHA-256 values are
    `fc37c7ac4f34b3517937068e7b7307f78d72db39efd3848121a7b40553cd33b8`,
    `7832331bce8ebdb8aafe9a74755505b88b66224a34b125e4b76195f6666428f8`,
    and `8bc1be3c941c8fd2d8a4a5990de0266f54ae986fbfd1e4712e6044c78cc092cd`.
    M4.31 historical evidence remains byte-identical at
    `160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076`.
    Focused Node 22 canonicalizer validation passes 108/108 structural and
    receipt tests, 51 golden/idempotence/KIR fixtures, eight measured
    witnesses, three profile-limit fixtures, and 226 hostile fixtures. The
    exact integrated tree passes the complete Node 22
    `pnpm fitness:kern-5` wall on 2026-07-22, including all 22 workspace
    projects, 168/168 release-policy tests, 432/432 cross-target fixtures,
    109/109 class fixtures, 233 native KERN assertions at 100% coverage,
    runner/browser/app gates, self-host parity, runtime/KIR ownership gates,
    and the repeated terminal canonicalizer replay. M4.38 recommends the next
    profile slice; it does not mutate a profile, KERN source, family registry,
    parser, KIR, runtime, or ABI. Final six-seat role-lens review
    `review-1784691513868-za02lj-kern-5-r2-m4-38-final` completed across every
    usable non-excluded engine. The original `toJSON` finding is fixed and its
    reporter returned zero findings; candidate math and ordering were
    independently verified. Missing-file and hash claims were disproved
    against staged files and exact published blobs. No material finding
    remains unresolved.
  - [x] M4.39 canonicalizer budgeted table validation: the quadratic
    `tablesok` scans are replaced by deterministic Map indexes while retaining
    every published table invariant and the exact `16/30/106` active profile.
    Deferred `Map.set` keys are admitted only when syntax proves a string from
    literals, exact `String(...)` calls, and recursively proved concatenations;
    mixed, bare, template, conditional, asserted, and helper-returned keys
    remain fail-closed. A frozen transcription of the old quadratic validator
    agrees with the optimized KERN implementation across the exact production
    witness plus delimiter/Unicode, duplicate, sparse, ownership, scalar-child,
    list-role, and record-order mutations. The migrated
    `validator.kern#18:hasimportcyclefrom` witness at 15/24/154 now returns exact
    canonical bytes at an authenticated 56,000-iteration regression budget and
    the unchanged 65,536 production ceiling; the measured full-handler floor
    is 55,002. The 43,416-byte composite authenticates at SHA-256
    `6851fddd986fe123bf33087b6ab0494c3601e62e9acf08571a9cb73fa6689ac9`.
    Effect-machine writes update exact runtime-owned Maps in place instead of
    copying or ownership-walking their complete growing prefix; speculative
    generic preconditions remain pure, assignment traces retain immutable Map
    snapshots, and regressions prove Maps cannot be aliased by portable `let`
    before a write or rescanned during the exact owned rebind.
    Live coverage and prerequisite receipts authenticate at
    `6d64f891592adac4dd59c3435f0343a7c5638db14c6c427a274be784a3883c4b`
    and `91d42844781ed13406b66a1389d7198d122e75cd85df32284894bcd46cc97083`;
    the published M4.38 receipt remains byte-identical at
    `8bc1be3c941c8fd2d8a4a5990de0266f54ae986fbfd1e4712e6044c78cc092cd`.
    Profile promotion remains performance-gated because the later validated
    lookup and emission helpers leave only 10,534 iterations (16.07%) of
    capacity; the next slice optimizes those helpers before any 154-row
    promotion. The focused canonicalizer gate passed 111/111 tests, 51
    golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
    fixtures, and 226 hostile fixtures. The complete Node 22
    `fitness:kern-5` wall passed, including 432/432 cross-target fixtures,
    109/109 class fixtures, and 233/233 native KERN assertions at required
    100% coverage.
  - [x] M4.40 canonicalizer indexed-lookup headroom and profile promotion:
    the existing strict `List.index(List, Number)` contract now executes in
    the portable source runner and lowers across native TS and Python with
    identical hit, nullish-miss, type, arity, finite-number, shadowing, and
    Python negative-index/boolean guards. Raw array indexing retains its
    existing integer-provenance gate. Canonicalizer `stringat` and `numberat`
    now perform one indexed lookup plus their published `""`/`-1` fallback,
    removing both remaining linear scans without changing their one-based
    public API. The exact 15/24/154 production witness floor falls from 55,002
    to 34,700 iterations; it passes the precommitted 40,000 promotion budget
    with 30,836 iterations, or 47.1%, of headroom below the unchanged 65,536
    runtime ceiling. The active profile advances only `maxValueRows`, yielding
    exact limits 16/30/154 and authenticating the M4.38 cohort of 11 functions,
    three tools, and 39 structured parameter rows. The 43,272-byte composite
    and expression helper authenticate at SHA-256
    `de4710746e4c4c6ba30970577eefbdb284d282eaf58de30d78bfea45fa758080`
    and `9329756e2373e5afc68903cafeb0043a9a50e3a07f7710a9f115d7628455726f`.
    Live coverage and prerequisite receipts authenticate at
    `1b4eaebc67bc0c1e9287259dce0de9feed453e06b68de60ef1348bdaed5e3819`
    and `e298ccec225eb339b6a566ed1c607b2abf14d11c9719557a9dc29a4de7dec9c9`;
    compiled core is bound at
    `7b8d3540cb8927db1e9c8d3d2938671103186bed4cc32c955d68e5dbb82c7448`.
    The browser policy resets its stale M3.31a baseline to the exact M4.40
    graph: 157 modules, 1,553,103 raw bytes, and 333,617 gzip bytes, retaining
    the fixed 5% bloat guard; the latest required measurement passed at an
    89 ms browser median (89/89/95 ms samples).
    Focused validation passes 112/112 canonicalizer tests plus 51/8/3/226
    replay fixtures. The complete Node 22 `fitness:kern-5` wall passes,
    including all 22 workspace projects, 434/434 cross-target fixtures,
    109/109 class fixtures, 233/233 native KERN assertions at 100% coverage,
    whole-app behavior, browser budgets, runtime/KIR ownership, and the
    repeated terminal canonicalizer replay.
    Automatic high-risk review
    `review-1784707821710-ju7ajt-kern-5-r2-m4-40-final` found lexical `List`
    shadowing and generated-helper collision defects; both are fixed with
    regressions. Targeted post-fix review
    `review-1784711104800-11arvy-kern-5-r2-m4-40-review-fixes` completed 1/1
    with no findings.

  - [x] M4.41 canonicalizer frozen 154-row parameter migration: the exact
    M4.40-authenticated queue of 11 functions across checker, canonicalizer,
    and validator sources now uses 39 ordered direct `param` children instead
    of legacy `fn.params` strings. Function bodies, calls, root ordinals,
    properties, siblings, profile limits, runtime, KIR, ABI, and public APIs
    remain unchanged. An exact mutation guard rejects mixed representation,
    missing, duplicated, reordered, renamed, mistyped, or post-handler
    parameters plus identity, body, property, sibling, profile-row, and
    generated-consumer drift.
    Live coverage advances from 46/104 to 57/104 base-complete functions and
    reduces legacy parameter blockers from 56 to 45. The parameter queue is
    exactly empty at zero functions, tools, and rows; the same two active
    structural families remain bounded-exhausted across three non-empty
    closures and 45 residual functions, so the authenticated next action is
    current residual-blocker analysis rather than an implicit promotion.
    The 43,578-byte canonicalizer composite authenticates at SHA-256
    `2b39f976b7eeb3e2cedc400821880a77edc11b99a72d0e24a28ddec8cabaeb4c`;
    the regenerated checker fixture authenticates at
    `d6a47919ef06a6cb6674d5ba94fbb706184ed7244c8d7d9015bb5d2e87b8301c`.
    Live coverage and prerequisite receipts authenticate at
    `eca4d82a8503d961270214a4bf69bca90873bfe624d49228b07ba5627d3f98c2`
    and `1120312f40cb14247c351d732342ab2034db4f3ee0bc2391bc884d1e5cd3bde3`;
    function facts bind at
    `ca9702a70e92e79aa384c04a09e4ea835009e19f726671dead147f160b632ea8`.
    Focused validation passes 113/113 canonicalizer tests plus 51/8/3/226
    replay fixtures, 48/48 checker fixtures, and 39/39 validator verdicts.
    The complete Node 22 `fitness:kern-5` wall passes, including all 22
    workspace projects, 434/434 cross-target fixtures, 109/109 class fixtures,
    233/233 native assertions at 100% coverage, whole-app behavior, runtime/KIR
    ownership, and repeated canonicalizer replay. The required browser receipt
    remains 157 modules, 1,553,103 raw bytes, and 333,617 gzip bytes at a 92 ms
    median (88/92/93 ms samples). Automatic role-lens review
    `review-1784714230963-a42g97-kern-5-r2-m4-41-final` completed 2/2 with no
    material finding; its one line-count-confirmation nit was verified against
    the exact 494-line validator pin. KERN 5 remains incomplete: M4.42 begins
    the authenticated current residual-blocker analysis.

  - [x] M4.42 canonicalizer current residual-blocker analysis: a new format-3
    receipt binds all 45 post-M4.41 residual functions to exact canonical
    assignments and reproduces the published reason-assignment digest
    `a965461fa32dc4bbb1fdfa3ca153d91d019865e6ddb10e57f64087be6d7402bf`.
    Exactly 29 functions expose profile rows, yielding 29 observed settings
    and 29 positive actionable candidates under the unchanged M4.36 base and
    16/30/154 limits. Deterministic ranking selects a one-axis value-row
    widening to 16/30/388, total delta 234, completing two functions across
    two tools: `checkerSafeIntText` and `validbinaryop`. This is authenticated
    recommendation only: no profile, KERN source, generated consumer, family,
    parser, KIR, runtime, ABI, or public API changes in this slice.
    The implementation digest is
    `6c74f747f3df19ea9e09eb88be4e0aa10d54a7319f90af0eeffe4054ad9ebd2d`;
    coverage, prerequisite, and M4.42 receipt whole-file SHA-256 values are
    `e578c3a828ef1a2757fd285de02afc3cdbb98e2b5ef9299f577bab8d14aa27b6`,
    `b01651c6993078bc364edb62d95fce092e37e630e71d46f9338ca1554e7a2e96`,
    and `f37fed74d24a739adf3584ceb7608f8d25c490d2325ebc1c127e05ee15238a8e`.
    M4.31 and M4.38 receipts remain byte-identical. Focused validation passes
    117/117 canonicalizer tests plus 51/8/3/226 replay fixtures. The complete
    Node 22 `fitness:kern-5` wall passes, including all 22 workspace projects,
    434/434 cross-target fixtures, 109/109 class fixtures, and 233/233 native
    assertions at 100% coverage. The required browser measurement remains 157
    modules, 1,553,103 raw bytes, and 333,617 gzip bytes at an 89 ms median
    (86/89/95 ms samples). Automatic medium-risk role-lens review
    `review-1784716745356-42xprs-kern-5-r2-m4-42-final` completed 2/2 with no
    material finding; its two naming/process-documentation nits are resolved.
    M4.43 must authenticate runtime headroom before any 388-row profile
    promotion; KERN 5 remains incomplete.

  - [x] M4.43 canonicalizer value-row runtime headroom: `exprsource` now
    projects expressions with collision-safe bottom-up parent/order and
    length-framed parent/role indexes instead of recursively rescanning the
    complete value table. Exact iteration floors fall from 38,978 to 6,533
    for the 161-row witness, from 237,982 to 10,614 for the selected 388-row
    witness, and from 34,700 to 7,360 for the existing 154-row witness. The
    selected witness therefore uses 21.6% of the precommitted 49,152 promotion
    budget and retains 38,538 iterations of headroom. The active profile stays
    exactly 16/30/154: this slice optimizes and authenticates capacity but does
    not promote policy or migrate KERN source. A live residual measurement now
    reproduces the exact historical M4.42 16/30/388 recommendation and its two
    function/tool identities, while the published M4.42 receipt remains
    byte-identical at SHA-256
    `f37fed74d24a739adf3584ceb7608f8d25c490d2325ebc1c127e05ee15238a8e`.
    The 49,400-byte generated canonicalizer authenticates at SHA-256
    `1114de23dc9f6bb036eb4734ed8e7aadef5c1d79d54b1d0395967065fc4e904d`;
    its source and composition authenticate at
    `394ebcf582c289d13f877b9546430991ea89cdea0ecd1a22b02bef64083d678d`
    and `3fa5131b62fcdcea4325b22ab56b81e5dba368c7accfa670d090bcfcd7f29dc5`.
    Live implementation, policy, function-fact, reason-assignment, coverage,
    prerequisite, and corpus digests are respectively
    `e1f76383da938ab2caad81fe9209fd58061a3f1b47f675a23aae7a607548b333`,
    `6c70a49fc5b8fabbefb902c3323534302448281fa998691598efd6a6d83fff6b`,
    `75ec5a9f2ce7c3b6a7c42b212ecbced4a4ecb9becb80766c2f04280eb05d4287`,
    `fb73e3bfba455094fd188454de81c56e0a1ff8011bc3ec70eea2f02160537092`,
    `b79a191f79ab8a59e114e4354cbcdd788fed0bbeb49d101e058cb5c1eacf9a53`,
    `b28d2ec9f58c99dc4ab6a6e1f98628e539c0560f74ea9cef872f68787830d497`,
    and `80499e1162962382b51be60976e6b2590a8aa755f9b42b5beadd64af52e62d20`.
    Focused validation passes 123/123 canonicalizer tests plus 51/8/3/226
    replay fixtures. The complete Node 22.22 `fitness:kern-5` wall passes,
    including all 22 workspace projects, 434/434 cross-target fixtures,
    109/109 class fixtures, 233/233 native assertions at 100% coverage, 48/48
    checker fixtures, 39/39 validator verdicts, 40 app fixtures on three legs,
    and whole-app Express/FastAPI boot. The required browser receipt remains
    157 modules, 1,553,103 raw bytes, and 333,617 gzip bytes at 56 ms cold and
    a 95 ms browser median (93/95/98 ms samples). Automatic medium-risk
    role-lens review `review-1784721631067-zpjerk-kern-5-r2-m4-43-final`
    completed 2/2; its live-liveness finding was fixed by binding the current
    residual analysis to the exact published recommendation. Targeted review
    `review-1784722477838-aiu54x-kern-5-r2-m4-43-review-fix` completed 1/1
    with no finding. KERN 5 remains incomplete: a fresh M4.44 slice may now
    authenticate the 388-row profile promotion and parameter migrations.

  - [x] M4.44 authenticated 388-row profile promotion: the admission policy
    raises only `maxValueRows` from 154 to 388 while node/property ceilings,
    runtime/KIR limits, ABI, public APIs, KERN source, the 49,400-byte composed
    canonicalizer, and the 104-function corpus remain unchanged. The optimized
    M4.43 frontier is frozen at SHA-256
    `823e464ea6b6cc78a6959c0bced2b6d5f63b5722e0e15bda4a2dd08abf8200d8`
    and source commit `df27456aeda2880eb6bb76e5ed1b8fe314023a39` before the
    policy moves. Exact fixtures admit 12/15/388 and reject 12/16/389 without
    partial output. Because the old 154-row frontier cannot be rederived after
    policy promotion, that pre-promotion analysis is deliberately immutable
    declaration-only history; the post-promotion prerequisite queue and
    residual partition are still remeasured live. Live completion advances
    from 57/104 to 58/104 solely because already-direct `sortStrings` at
    16/29/197 enters the profile; its exact runtime floor is 9,926 with failure
    at 9,925. The next legacy parameter queue is exactly two functions, two
    tools, and two rows:
    `checkerSafeIntText` at 14/20/161 and `validbinaryop` at 12/15/388. Neither
    source signature is migrated in this slice, leaving 45 `fn.params`
    blockers and 43 residual functions. Live coverage and prerequisite
    receipt SHA-256 values are
    `c11de38b5370eecbe48292ca8d15136d017205a7278321d57fe577236016f98a`
    and `9741650d8567016fb029a8e51b4706da1da131d9870c94a3221b4550792dee01`;
    implementation, canonicalizer-policy, and function-fact digests are
    `ada72154808a46b10766f9d4513cd6f7e54d021f9ee7aae2637bb0051d8a16ab`,
    `a0613353cf5dd7def20b13138fae461b3084bb6b958b769c99bf5b00a5c98556`,
    and `e964748bf7a8c52d2381506b12137be3438a78ac8f627f009b1c00a0ce41f3d1`.
    The complete canonicalizer gate passes 131/131 tests plus 51/8/3/226
    replay fixtures. The complete Node 22.22 `fitness:kern-5` wall passes,
    including all workspace projects, 434/434 cross-target fixtures, 109/109
    class fixtures, 233/233 native assertions at 100% coverage, 48/48 checker
    fixtures, 39/39 validator verdicts, 40 app fixtures on three legs, and
    whole-app Express/FastAPI boot. The required browser receipt remains 157
    modules, 1,553,103 raw bytes, and 333,617 gzip bytes at 55 ms cold and a
    98 ms median (91/98/105 ms samples). Automatic review
    `review-1784728882250-bm9sqa-kern-5-r2-m4-44-final` completed 2/2 and
    removed an obsolete second live-analysis path. Required high-risk
    role-lens review `review-1784729443580-vk3iwj-kern-5-r2-m4-44-high-risk`
    completed 6/6; all candidates were verified and its material cleanup was
    applied. Targeted post-fix review
    `review-1784730577887-1mq9xg-kern-5-r2-m4-44-review-fix` completed 1/1 with
    no finding. KERN 5 remains incomplete: M4.45 must migrate exactly the two
    authenticated legacy parameter rows without widening the profile again.

  - [x] M4.45 frozen 388-row parameter migration: exactly
    `checkerSafeIntText` and `validbinaryop` replace their authenticated legacy
    `fn.params` strings with one equivalent direct `param` child each. Bodies,
    identities, ordinals, calls, profile rows, policy 16/30/388, runtime/KIR
    limits, ABI, and public APIs remain unchanged. The exact published M4.44
    2/2/2 queue is frozen byte-identically at SHA-256
    `9741650d8567016fb029a8e51b4706da1da131d9870c94a3221b4550792dee01`
    before live receipt regeneration. Base completion advances from 58/104 to
    60/104, `fn.params` blockers fall from 45 to 43, the live parameter queue
    becomes exact zero, and bounded exhaustion remains 43 with reason digest
    `f72e98d37cd3fcbc711c53bc6dfd8c4afe0ea56a08c21b3907a550a17fa0418c`.
    Live coverage and prerequisite receipts authenticate at
    `f6d511f31f15afe38b24fa0bed20a9632ac1795e04d94271c22b1d05fb8cac47`
    and `28e31cb5cba0859d79b08aae181c86ed95340b44669c2c6dc0428c21cf8f2470`.
    The checker writer reproduces `main.kern` at
    `7adbe8a62c597fb42b6602d728e2c1aefb1dfc972bccafde3de6f50914363776`;
    the canonicalizer writer reproduces a 49,409-byte composite at
    `a81f3a28cae9b96bfe7fac0f3a38e7f6830590d11ab5e7214293297f103b1872`.
    Unrelated generated outputs remain byte-identical. The complete
    canonicalizer gate passes 135/135 tests plus 51/8/3/226 replay fixtures,
    and the checker gate passes 48/48 with 36 rejected accept-but-abstain
    attempts. The complete Node 22.22 `fitness:kern-5` wall passes, including
    all workspace builds/tests, 434/434 cross-target fixtures, 109/109 class
    fixtures, 233/233 native assertions at 100% coverage, 39/39 validator
    verdicts, 40 app fixtures on three legs, whole-app Express/FastAPI boot,
    runtime/KIR/ownership/convergence gates, diff hygiene, and the repeated
    canonicalizer gate. Its browser receipt is 157 modules, 1,553,103 raw
    bytes, and 333,617 gzip bytes at 57 ms cold and a 93 ms median
    (87/93/111 ms samples). Required high-risk role-lens review
    `review-1784734117538-be83sb-kern-5-r2-m4-45-final` completed 6/6 with no
    consensus-verified finding. The genuine authentication candidate was
    fixed by directly pinning both handwritten sources, generated checker
    `main.kern`, the composite and composition record, unchanged generated
    members, and explicit return types. Post-fix lint, 10/10 focused tests,
    and the complete 135/135 plus 51/8/3/226 canonicalizer gate pass. The
    body-digest concern was disproved against the helper implementation; the
    historical milestone duplication is deliberate cumulative evidence and
    remains outside this representation-only slice. No material finding
    remains unresolved. KERN 5 remains incomplete: the live residual blocker
    analysis must determine M4.46 without inventing policy.

  - [x] M4.46 authenticated current residual blocker analysis: under unchanged
    M4.36 base profile and 16/30/388 limits, the complete live 43-function
    residual population is assigned and evaluated against only data-derived
    observed settings. The parameter-ready partition remains exact zero; 27
    residual functions have measured profile rows, producing 26 distinct
    observed settings and 26 positive candidates. The assignment digest
    remains byte-identical to M4.45 at
    `f72e98d37cd3fcbc711c53bc6dfd8c4afe0ea56a08c21b3907a550a17fa0418c`.
    The first canonical action raises only `maxNodeRows` from 16 to 19 and
    selects four functions across three tools with 12 total parameter rows:
    `isIndexRebound` at 17/26/152, `isUserCallable` at 19/26/185,
    `validinteger` at 19/28/290, and `isportable` at 18/24/217. This slice is
    analysis-only: no KERN source, generated consumer, profile, active family,
    parser, runtime, KIR, ABI, package version, or public API changes. The
    canonical analysis receipt and analyzer authenticate at SHA-256
    `67ed659c709adfc5cd51095a3ac5f9549b0384d9651ac3d74894ad4b3aab3402`
    and `20f85ccfd19b75cfc4357d6b726ce02207312d0812358c46fb4155de8e74b194`.
    Regenerated live coverage and prerequisite receipts authenticate at
    `f92de8285ead020203aa7a4d299e89ab62c13f67c904598abfdfc01c049ea62b`
    and `f18ad9a00b41d15f94a7eb7de047efb6257c5b1b606f3099b3bcc596f6d9cd4e`;
    implementation, policy, and function-fact digests are
    `9ba952686c10c0210810f428fbbfabdd4d8612825e0047a8add9d2425466021e`,
    `f326deb064b3e787cd24d1adfb12066db2c6206b93ac3bdebbcfbeb196e93096`,
    and `b6adf472db5ae14b3ad4735d20a3ed3c4b6d5425295af2904c4136d441399d50`.
    The isolated analysis/status suite passes 8/8, and the complete
    canonicalizer gate passes 140/140 tests plus 51/8/3/226 replay fixtures.
    The complete Node 22.22 `fitness:kern-5` wall passes, including all
    workspace builds/tests, 434/434 cross-target fixtures, 109/109 class
    fixtures, 233/233 native assertions at 100% coverage, 48/48 checker
    fixtures, 39/39 validator verdicts, 40 app fixtures on three legs,
    whole-app Express/FastAPI boot, runtime/KIR/ownership/convergence gates,
    diff hygiene, and the repeated canonicalizer gate. Its required browser
    receipt is 157 modules, 1,553,103 raw bytes, and 333,617 gzip bytes at
    56 ms cold and a 91 ms median (88/91/113 ms samples). Automatic medium-risk
    role-lens review `review-1784737826705-aha15a-kern-5-r2-m4-46-final`
    completed 2/2 with no verified finding. The exact-population writer guard
    was retained because allowing `--write` after the M4.45 population changes
    would rewrite historical evidence; the genuine null-status test gap was
    fixed. No material finding remains unresolved. KERN 5 remains incomplete:
    M4.47 must prove runtime headroom for the exact four-function 19-row node
    cohort before profile promotion.

  - [x] M4.47 authenticated node-row runtime headroom: the exact M4.46
    four-function, three-tool, 12-parameter-row cohort is frozen before the
    current implementation closure changes, and each selected function is
    executed as the same single-function structural KIR artifact used by the
    coverage path. Exact runtime floors under the unchanged 19/30/388 candidate
    are 8,303 for `isIndexRebound`, 10,361 for `isUserCallable`, 15,236 for
    `validinteger`, and 10,591 for `isportable`; floor minus one fails, every
    floor succeeds without diagnostics/events, and every result reparses to
    byte-identical structural KIR. All floors remain below the precommitted
    49,152 promotion budget and the unchanged 65,536 production ceiling. The
    module-envelope `isportable` depth-64 rejection is recorded explicitly as
    outside this structural proof and no KIR/runtime limit is widened. The
    M4.46 receipt remains byte-identical at
    `67ed659c709adfc5cd51095a3ac5f9549b0384d9651ac3d74894ad4b3aab3402`;
    its immutable loader authenticates at
    `dc4480a7568863f376e5fe392d2defcabb3394c88d945a7ba506a6c9b980a2b1`.
    The M4.47 receipt, validator, and runtime oracle authenticate at
    `0da8ef5be1be0ea2ac12ef739bd6cc38070d60b7b3a775f45602857d40979af1`,
    `09259ac9b634dc8875a58bda40eca564377aca2e3758c89c2ec626c765053af3`,
    and `a45de591e2641e7971b9ab9e662dd6caae586cd2e84060ef1e47693e22ada1a6`.
    Regenerated live coverage and prerequisite receipts authenticate at
    `95f6c10dff915595f866ae035ce686c9c1fa34bfc3aef47654d29150cedc7eea`
    and `a40338a9deb0a0e604d4a667a6a016fd75686930ebcb0d74de4f871f160f1b9b`;
    their shared implementation digest is
    `1ebb64074a71b37120ed663162bef05d14a4f513c35d6eaefd4fe1dd2efb73e6`.
    No KERN source, generated consumer, profile, active family, parser,
    runtime, KIR, ABI, package version, or public API changes. The focused
    receipt/status suite passes 10/10, the exact performance suite passes 5/5,
    and the complete canonicalizer gate passes 147/147 tests plus 51/8/3/226
    replay fixtures. The complete Node 22.22 `fitness:kern-5` wall passes,
    including all workspace builds/tests, 434/434 cross-target fixtures,
    109/109 class fixtures, 233/233 native assertions at 100% coverage, 48/48
    checker fixtures, 39/39 validator verdicts, 40 app fixtures on three legs,
    whole-app Express/FastAPI boot, runtime/KIR/ownership/convergence gates,
    diff hygiene, and the repeated canonicalizer gate. Its required browser
    receipt is 157 modules, 1,553,103 raw bytes, and 333,617 gzip bytes at
    56 ms cold and a 95 ms median (87/95/102 ms samples). Automatic medium-risk
    role-lens review `review-1784742281330-sgd69l-kern-5-r2-m4-47-final`
    completed 2/2 with no consensus-verified finding. Both needs-check
    candidates were resolved by self-pinning the exact M4.47 receipt digest and
    requiring the exact public-handler failure envelope at floor minus one,
    above every direct input collection length. The corrected focused suite
    passes 8/8. Post-fix lint, repository consistency, diff hygiene, and the
    complete 147/147 plus 51/8/3/226 canonicalizer gate pass. No material
    finding remains unresolved. KERN 5 remains incomplete: M4.48 may promote
    only `maxNodeRows` from 16 to 19 while preserving this exact handoff.

  - [x] M4.48 authenticated the node-row profile promotion: M4.47 is frozen as
    an immutable published handoff at source commit `233e71a8` and receipt
    SHA-256
    `0da8ef5be1be0ea2ac12ef739bd6cc38070d60b7b3a775f45602857d40979af1`;
    the active profile raises only `maxNodeRows` from 16 to 19 while property
    rows remain 30, value rows remain 388, runtime limits remain unchanged,
    and KIR depth remains 64. Base completion stays 60/104 with 43 legacy
    `fn.params` blockers. The exact M4.46 cohort becomes the only
    parameter-ready queue: four functions across three tools and 12 parameter
    rows (`isIndexRebound`, `isUserCallable`, `validinteger`, and
    `isportable`), leaving 39 residual functions. No source parameter is
    migrated in this slice. The exact hostile boundary is 20/22/30 and rejects
    above the admitted 19 node rows. The immutable M4.47 loader authenticates
    at `940fcad40fef2751b59623302ba06a0d28b1254f0829a507e50e61fe5dddc19b`;
    live coverage and prerequisite receipts authenticate at
    `c1843e6d6931eb1e81c8fcb11797355acdeb84a7f1b3627048ca697830eb3ffa`
    and `fbc4b671f665d1ed2ebb709201a4c3f4be27d9cec4f18708ce7130fd2b2a7b0a`.
    Their shared implementation digest is
    `185340b44f0810f30d7e6fdb7d0d5a7aa7205460e83149029a22d38526829789`.
    The complete canonicalizer gate passes 152/152 tests plus 51/8/3/226
    replay fixtures. The complete Node 22.22 `fitness:kern-5` wall passes,
    including workspace builds/tests, cross-target and class conformance,
    233/233 native assertions at 100% coverage, 48/48 checker fixtures, 39/39
    validator verdicts, 40 app fixtures on three legs, whole-app
    Express/FastAPI boot, runtime/KIR/ownership/convergence gates, diff
    hygiene, and repeated canonicalizer gates. Its required browser receipt is
    157 modules, 1,553,103 raw bytes, and 333,617 gzip bytes at 56 ms cold and
    an 87 ms median (85/87/90 ms samples). Required high-risk role-lens review
    `review-1784746347612-zqg77t-kern-5-r2-m4-48-final` covered all six usable
    reviewers. Two consensus-marked blockers were disproved by the actual
    symbol/prototype rejection code and passing 8/8 mutation guards; two
    needs-check observations were adjudicated against the immutable-handoff
    and terminal-checker contracts. No material finding remains unresolved.
    KERN 5 remains incomplete: M4.49 must migrate only this frozen 12-row queue
    in a fresh slice.

  - [x] M4.49 consumed the exact M4.48 node-row parameter queue: at source
    commit `87e10471`, exactly four functions across three tools replace their
    authenticated legacy parameter strings with 12 equivalent direct `param`
    children. The published M4.48 prerequisite receipt remains frozen at
    SHA-256
    `fbc4b671f665d1ed2ebb709201a4c3f4be27d9cec4f18708ce7130fd2b2a7b0a`.
    Base completion advances from 60/104 to 64/104, legacy `fn.params`
    blockers fall from 43 to 39, and the live parameter queue becomes exact
    zero under the unchanged 19/30/388 profile. Bounded exhaustion remains 39
    with reason digest
    `d3175ab22aaf82a3e37a5c439b4e603d3922e53224b649176c9940d9e04431dc`.
    Coverage and prerequisite receipts authenticate at
    `998955248fe4a5e8a1d35108bdd0cd23e7132e1ede3693bc2f40838d6290596b`
    and `9ffd897ad4e631ea7cb4395fffbdae87a36637d3f5d011eaa377c01f3f2fa403`;
    the shared implementation digest is
    `063caa43723772d3ad44b1662b2c345e24f9e46ab914cfdadd71872836de81d8`.
    The complete canonicalizer gate passes 156/156 tests plus 51/8/3/226
    replay fixtures, and the complete Node 22 `fitness:kern-5` wall passes.
    Required high-risk role-lens review covered all six usable independent
    reviewers with zero verified findings and zero blockers. KERN 5 remains
    incomplete: consumed M4.46 evidence cannot authorize another widening, so
    M4.50 must recompute the current residual frontier.

  - [x] M4.50 authenticated the current residual blocker frontier without
    changing KERN source, generated consumers, active profile, families,
    parser, runtime, KIR, ABI, package versions, or public APIs. All 39 current
    residual functions have exact assignments; 23 have measured profile rows,
    producing 23 distinct observed settings and 23 positive candidates. The
    assignment digest remains byte-identical to M4.49 at
    `d3175ab22aaf82a3e37a5c439b4e603d3922e53224b649176c9940d9e04431dc`.
    The first canonical action raises only `maxPropertyRows` from 30 to 31 and
    selects one six-parameter-row function in one tool:
    `examples/selfhost-validator/validator.kern#17:classcyclefrom`, measured at
    19/31/202 with only the `profile.rows.properties` reason. The M4.50 receipt
    and analyzer authenticate at
    `14fdff4dce865a79215eabdb02b05a29c62a66c633561e9643e2a46f38020e4f`
    and `8a8c5f061b87ad6881d51a9d9abe00c7d1a4f639c259b409b4f899d730c85678`.
    Regenerated coverage and prerequisite receipts authenticate at
    `5240c7896ab3992a91b918e8c2d4cb36316cd49500a631a7c50fbb605ee04954`
    and `4509179584d95da5b51c9540678ed60e9e6c361cdb9ec09fa9ddf718aaeb4b5e`;
    their shared implementation digest is
    `dcaf4485e454b2aa366bb80d529fea9cb0bc8e79bc11a4d2cb336372c60b5d34`.
    The focused suite passes 9/9, the complete canonicalizer gate passes
    161/161 tests plus 51/8/3/226 replay fixtures, and the complete Node 22
    `fitness:kern-5` wall passes. Required high-risk role-lens review
    `review-1784753205306-w4aaia-kern-5-r2-m4-50` completed all 6/6 usable
    reviewers with zero verified findings and zero blockers. Its sole
    needs-check refactor was rejected after source verification because
    milestone-local validation keeps immutable historical receipts independent
    of future measurement code; the canonical textual tie-break nit cannot
    change this selection after the preceding numeric ranks. This receipt is
    recommendation-only; the active profile remains 19/30/388. KERN 5 remains
    incomplete: M4.51 must authenticate runtime/property-row headroom for the
    exact `classcyclefrom` witness before profile promotion.

  - [x] M4.51 authenticated structural runtime headroom for the exact M4.50
    property-row witness without changing KERN source, generated consumers,
    active profile, parser, runtime, KIR, ABI, package versions, or public
    APIs. The M4.50 receipt remains byte-identical at
    `14fdff4dce865a79215eabdb02b05a29c62a66c633561e9643e2a46f38020e4f`
    and is now consumed only through an immutable loader pinned to published
    source commit `8600d811`. The counterfactually migrated
    `examples/selfhost-validator/validator.kern#17:classcyclefrom` artifact has
    six parameter rows and exact structural rows 19/31/202. Through the public
    `kern.runtime.handler.v1` boundary, 11,950 steps fail with the expected
    unsupported-runtime completion and 11,951 succeeds with no diagnostics or
    events; emitted source reparses to byte-identical structural KIR. The exact
    floor leaves 37,201 steps below the 49,152 promotion budget and 53,585
    below the unchanged 65,536 production ceiling. The authenticated M4.51
    receipt, validator, runtime-floor oracle, and immutable M4.50 loader have
    SHA-256 values
    `c36711a885495d41b879bdcc364122f380dfde1a720a0985cdafbd78e067dfbe`,
    `de5dff024f27c92df8d528a58a14895550b8f38fd6a72713791172667811d945`,
    `1565b98f4f711e167c2de6209c5b0b7c026e66071732d918360dd544375a413a`,
    and
    `92e085a1b7050d5800143e1c11bf2560a01217b08c339bf23d45c961a3c047c4`.
    Regenerated coverage and prerequisite receipts authenticate at
    `6ef856b7d58ef3c83ea28e7e2044747d34c50b7d313d9d2e47c72135e853e33c`
    and `17db623955206d59886fbb184744187163d364988b946108fb1ef73c260eae6d`;
    their shared implementation digest is
    `0b40930cdb0f9224c492e389df7b421af4bd8f490b9dab5ba1652e75288570e0`.
    Focused evidence tests pass 11/11, runtime performance contracts pass 2/2,
    the complete canonicalizer gate passes 165/165 tests plus 51/8/3/226
    replay fixtures, and the complete Node 22 `fitness:kern-5` wall passes.
    The proof is explicitly scoped to a structural KIR function and makes no
    module-envelope claim. Required high-risk role-lens review
    `review-1784756402233-2v34x8-kern-5-r2-m4-51` completed all 6/6 usable
    independent reviewers with zero consensus-verified findings, zero
    needs-check findings, and zero blockers. Its sole speculative observation
    is resolved by documenting that `fitness:kern-5` builds fresh `dist`
    artifacts before the runtime oracle imports them; remaining nits are
    unreachable under the exact one-witness digest or deliberate historical
    handoff/test patterns. KERN 5 remains incomplete: M4.52 may promote only
    `maxPropertyRows` from 30 to 31 and must freeze M4.51 as an immutable
    published handoff in the same change.

  - [x] M4.52 promotes only `maxPropertyRows` from 30 to 31 and freezes M4.51
    as an immutable published handoff pinned to source commit
    `2e363bab008fd2f03ef21fdc1bcb0a2488bd0637`. The exact M4.51 receipt remains
    byte-identical at
    `c36711a885495d41b879bdcc364122f380dfde1a720a0985cdafbd78e067dfbe`;
    its immutable loader authenticates at
    `4d630be7927b6b94afbed7fb0d49f52a26b51e0316470f9c1472ece3296fd140`.
    Base completion remains 64/104 and legacy `fn.params` blockers remain 39.
    The promoted 19/31/388 profile exposes exactly one parameter-ready
    validator function with six rows:
    `examples/selfhost-validator/validator.kern#17:classcyclefrom` at
    19/31/202. The exact hostile boundary is 32 property rows; no KERN source,
    generated consumer, family, parser, runtime, KIR, ABI, package version, or
    public API changes. Live coverage and prerequisite receipts authenticate
    at
    `75aab0c200dce0e2629fb654cd77951a17e315e889516204f032993cda62de62`
    and
    `220becc58afa59bb35f1fef2246038d7c7763b49db65d615f6c5725c87659c76`;
    their shared implementation digest is
    `9a2f9fff62a756def97ab7201ec1483e855442085f55099073f6fc611e938e4d`.
    The focused suite passes 70/70, the complete canonicalizer gate passes
    170/170 tests plus 51/8/3/226 replay fixtures, and the complete Node 22.22
    `fitness:kern-5` wall passes. Required high-risk role-lens review
    `review-1784759389980-rphvm4-kern-5-r2-m4-52` completed all 6/6 usable
    independent reviewers with zero verified findings and zero blockers. Its
    three needs-check observations were rejected after source verification:
    independent exact literals are intentional release-proof boundaries, and
    the M4.51 formatter follows the established evidence-to-promotion status
    pattern. KERN 5 remains incomplete: after publication, M4.53 may migrate
    only this frozen six-row queue.

  - [x] M4.53 migrates only the exact M4.52 one-function/six-row parameter
    queue: `examples/selfhost-validator/validator.kern#17:classcyclefrom` now
    carries six ordered direct `param` children while its semantic body remains
    byte-identical by digest. The 19/31/388 profile is unchanged; base
    completion advances from 64/104 to 65/104, legacy `fn.params` blockers fall
    from 39 to 38, the parameter-ready queue becomes 0/0/0, and the residual
    set remains 38. The M4.52 handoff and loader authenticate at
    `220becc58afa59bb35f1fef2246038d7c7763b49db65d615f6c5725c87659c76`
    and
    `357e848651a9347a4c96c269686253dc0e5e49407456fe5cb0767b4cef400639`;
    live coverage and prerequisite receipts authenticate at
    `ae82ad725240338fb5cb37e3847e8b06e8a1940f771a7e2d75a4f0a6c10f779c`
    and
    `c53e760123fc4f48c37a905d76d291f8bb4eacb12dbb792461fdd84358062416`.
    Focused gates pass 4/4, 54/54, and 32/32; the canonicalizer wall passes
    175/175 tests plus 51/8/3/226 fixtures; and the complete Node 22.22
    `fitness:kern-5` wall passes. Required high-risk role-lens review
    `review-1784762426236-sq8uae-kern-5-r2-m4-53` completed all 6/6 usable
    reviewers with zero verified findings and zero blockers. Its two
    needs-check DRY observations were rejected after source verification:
    milestone-local hashes and cumulative line-count guards intentionally
    remain independent so a shared edit cannot bless historical drift. KERN 5
    remains incomplete; the next slice must analyze the exact 38-function
    residual before selecting any further capability work.

  - [x] M4.54 publishes the exact current 38-function residual analysis
    without changing KERN source, generated consumers, the 19/31/388 profile,
    active families, parser, runtime, KIR, ABI, packages, or public APIs. The
    analyzer reproduces assignment digest
    `158ee2e9ee592986fa70f10e7345a243db0b082f7949497275e2dce2141ae6c8`,
    derives 22 distinct observed settings from authenticated current facts,
    and selects exact 25/50/388 headroom: a 25-row total delta completing seven
    functions across all four tools and covering 102 eventual parameter rows.
    The receipt and analyzer authenticate at
    `9c8507a4fe5bacf1048bfc1f6946c3e493ee35cd7fb63ce3a2a7ced474ad1423`
    and
    `2210e0a46db3ef2f7930640d258ccf843ca93201678ca99c76d5c28b994f2ea8`;
    live coverage and prerequisite receipts authenticate at
    `6475265b907af06f564870723ea1a2c8c3fa92784581c79ef571de0f54e6189e`
    and
    `1349932bd6fbba25e870d77235259bc36e9a8c9bcd5c78b1027fe02972778a7d`.
    Focused gates pass 50/50; the canonicalizer wall passes 179/179 tests plus
    51/8/3/226 fixtures; and the complete Node 22.22 `fitness:kern-5` wall
    passes. High-risk role-lens review
    `review-1784765519833-ajerxw-kern-5-r2-m4-54` completed all 6/6 usable
    reviewers. Its one verified provenance blocker was fixed by naming the
    analyzed M4.53 boundary `inputCommit` instead of falsely calling it the
    M4.54 source commit; the post-fix canonicalizer wall passes. Three
    needs-check DRY observations were rejected because milestone-local guards
    intentionally remain independent, and nine bounded CI-only nits are
    non-material. KERN 5 remains incomplete; M4.55 must authenticate exact
    structural runtime headroom for the seven selected witnesses before
    either profile limit moves.

  - [x] M4.55 authenticates exact structural runtime headroom for the complete
    M4.54 seven-function/102-parameter dual-row cohort without changing KERN
    source, generated consumers, the active 19/31/388 profile, parser, runtime,
    KIR, ABI, packages, or public APIs. Through the public
    `kern.runtime.handler.v1` boundary, the exact floors are 26,356 for
    `compareNode`, 15,094 for `literalTrue`, 19,763 for
    `checkerWhileRejectDetail`, 17,423 for `termProvenanced`, 19,622 for
    `whileRejectDetail`, 21,985 for `emitstatementlist`, and 17,931 for
    `owncallable`; every floor-minus-one fails canonically, every floor
    succeeds without diagnostics or events, and emitted source reparses to
    byte-identical structural KIR. The 26,356 maximum floor leaves 22,796 steps
    below the policy-derived 49,152 promotion budget and 39,180 below the
    unchanged 65,536 production ceiling. The M4.55 receipt, validator, receipt
    tests, and runtime-floor oracle authenticate at
    `10e36abdda5e7de48c65689f9d2a318a6095497bdd3cff81aa64e3ab4e6e535b`,
    `4b8635ca9df8a94e87bd77274e8409c2740f89b81d93e30a4a5f4e467a6b07f6`,
    `891f6d4875954e64a30c080ad72173d618cc733834714fc5a29c066fbddf1322`,
    and
    `d6b135c207b2ed8616bb8a4eed232b4f01feff6140cf9036f07a547018f89b4a`.
    Focused gates pass 11/11 and the complete canonicalizer wall passes
    191/191 tests plus 51/8/3/226 fixtures. The complete Node 22.22
    `fitness:kern-5` wall passes, including all workspace and infrastructure
    tests, 434/434 cross-target and 109/109 class-conformance fixtures,
    319/319 example-native and 233/233 core-native assertions, 48/48
    checker-subset fixtures plus 36 rejection oracles, and 39/39 self-host
    validator verdicts. Required high-risk role-lens review
    `review-1784769597959-x4q3ug-kern-5-r2-m4-55` completed all 6/6 usable
    reviewers with zero consensus-verified findings, five needs-check items,
    one speculative item, and twelve nits. Verification against the receipt,
    validator, mutation suite, terminal checker, build-owned `dist` preamble,
    and exact runtime oracles found no material defect; the measured test cost
    is intentional release evidence. No unresolved material finding remains.
    KERN 5 remains incomplete; after publication, M4.56 may
    promote only `maxNodeRows` 19 to 25 and `maxPropertyRows` 31 to 50 while
    leaving `maxValueRows` at 388, and must freeze M4.55 as immutable evidence.

  - [x] M4.56 freezes the published M4.55 structural-runtime receipt at exact
    source commit `56a45251663840d2d8ab60a8c8ee84ae5b29975b` and receipt
    SHA-256
    `10e36abdda5e7de48c65689f9d2a318a6095497bdd3cff81aa64e3ab4e6e535b`,
    then promotes only `maxNodeRows` 19 to 25 and `maxPropertyRows` 31 to 50.
    `maxValueRows` remains 388, the runtime collection ceiling remains 65,536,
    KIR depth remains 64, and no KERN source, generated consumer, parser,
    runtime, KIR, ABI, package, version, or public API changes. The immutable
    loader, current canonicalizer policy, live coverage implementation,
    function facts, coverage receipt, and prerequisite receipt authenticate at
    `d9ef2964087fc8d2488807af876c166f4bd85d969b08ffe1fa4428485d9123c8`,
    `5aeba11a3c26e7b8025f28cd0c6a8ba1b8de50bf2060ae311744a7527767c67d`,
    `7feccc57475faa9712f6b34f8d2c0a8208bef71e90f30e4a5234543cd37dbb95`,
    `b8f15f0c98c3019e78b6450eaca47d1110677555db0695136ca2b1a12fa78aee`,
    `2adf0326116d8dd42fdf9bb43cc811f7e3492f2860db617f00ab365fae441ce3`,
    and
    `13a420892453e03eed314ddad2f50ceeed4fe0f01e50cc3ee1a72a253caad26b`.
    The live frontier remains 65/104 base-complete with 38 legacy `fn.params`
    blockers and now publishes the exact M4.54/M4.55 seven-function,
    four-tool, 102-row parameter queue. Exact 26-node and 51-property hostile
    fixtures reject above the promoted 25/50 boundary. Focused gates pass 8/8;
    the standalone and final aggregate canonicalizer walls pass 196/196 tests
    plus 51/8/3/226 fixtures; and the complete Node 22.22 `fitness:kern-5`
    wall passes. Required high-risk role-lens review
    `review-1784773427040-p9pwu1-kern-5-r2-m4-56` completed all 6/6 usable
    reviewers. Its consensus blocker misread the current array-first receipt
    validator and was rejected against exact source and passing loader tests.
    One correctness needs-check was real: the 51-property fixture also carried
    unsupported `fn.async` and `param.optional`, so rejection did not isolate
    the row ceiling. The fixture is now an admitted 25/51/80 KIR that fails at
    50 and succeeds at 51. The same audit found and fixed the pre-existing
    value-fixture ambiguity with an admitted 12/15/389 KIR that fails at 388
    and succeeds at 389; the node fixture likewise succeeds exactly at 26.
    Post-fix focused gates pass 16/16 and the causal canonicalizer replay passes
    all 51/8/3/226 fixtures. No unresolved material review finding remains.
    KERN 5 remains incomplete; M4.57 must consume exactly this 7/4/102 queue
    before the selected subsequent `while-iteration` prerequisite can be
    promoted.

  - [x] M4.57 freezes the published M4.56 prerequisite receipt at source
    commit `8928684827706b2abac1f4906f785a389afb91c6` and exact SHA-256
    `13a420892453e03eed314ddad2f50ceeed4fe0f01e50cc3ee1a72a253caad26b`,
    then consumes exactly its seven-function, four-tool, 102-row parameter
    queue. The immutable loader and migration contract authenticate at
    `d486f9ab37e755bc4c7c1c6010fdc2a24cfb4700d246a7bace9c5eb28da436f6`
    and
    `3a7ad14587b75559bfa778a3fe24058a880f9df879499c63b76acf074db7befb`.
    `compareNode`, `literalTrue`, `checkerWhileRejectDetail`,
    `termProvenanced`, `whileRejectDetail`, `emitstatementlist`, and
    `owncallable` now use the exact ordered direct `param` prefixes measured
    by M4.56; their semantic body digests, names, types, order, returns,
    exports, handlers, bodies, and call sites remain unchanged. The five
    handwritten source digests are
    `1bbcff9ce986ec644d22bfe0a6b358c124ba078a43f9b17fdce4d79ff15cde7e`,
    `424a5a3fc76a149efd6ba4ae8358dc025e06bed6873d466ba42d4fba19e8c46b`,
    `61453a2f2aec5de05973bf0c6a0c9e84e9f00d7d501a80993ea02f57a518fd2d`,
    `9f572824fb6f7424fa87559b03c1c8291ad347c9c5035e7336e3760d739d2c03`,
    and
    `b8f2e779ced7577804686ac953cf555fffbc271b974bb29d64310245aa6270e2`.
    Repository writers reproduce the checker aggregate, canonicalizer
    composite, and composition record at
    `efebd94b0fc27368eb9f69ae60491d11d6dc0540937a430f4abdf96db45620bb`,
    `cd182decf48bad672bbae25b8f74aecc13dd7d308379167c42e7230cf8e3cd23`,
    and
    `9e4c9d4b57e280c0ff0dc32f92bf6f79f992aaa076e6a6ee34dff8dbd1678d74`;
    the numeric checker, validator main, and assertion-engine main remain
    byte-identical. Live coverage is now exactly 72/104 base-complete with 31
    legacy `fn.params` blockers, an empty 0/0 parameter queue, and the exact
    one-function `while-iteration` prerequisite for validator `sortstrings`
    selected next. The coverage policy, coverage receipt, and prerequisite
    receipt authenticate at
    `ca8362845bc2460dde40596674ded29ff8aab3eb4de40a28fd7789cc558937b1`,
    `b6f8ae2a49de9b8c2a859605a6c6a5da1bfcbc90d440efa9cdf259ccb7db7015`,
    and
    `31a90a6e1bb413939a56ab9637c12c660dbfb6247b24a347698312839c366c58`.
    Targeted migration, immutable-handoff, mutation, writer-reproduction,
    cumulative-history, prerequisite, and exact M4.55 runtime-floor gates are
    green. The complete Node 22.22 `pnpm fitness:kern-5` wall passes, including
    both 201/201 canonicalizer replays, 434/434 cross-target fixtures, 109/109
    class fixtures, 233/233 native assertions at 100% declared coverage, 40
    whole-app fixtures across three legs, and every repeated KIR, runtime,
    ownership, convergence, capstone, and browser-budget gate. Required
    high-risk role-lens review `review-1784780665798-en22ew` completed all 6/6
    usable reviewers with zero verified or speculative findings. Its two
    needs-check observations were resolved against the actual contracts: the
    immutable history is the digest-pinned M4.56 receipt, while earlier
    migration modules deliberately retain milestone-local target body pins and
    cumulative current-source/generated-consumer guards. No material finding
    remains unresolved. KERN 5 remains incomplete; the next slice must freeze
    this migrated frontier before promoting or rejecting `while-iteration`.

  - [x] M4.58 freezes the exact M4.57 `while-iteration` prerequisite as the
    sixth append-only provenance record before any implementation or profile
    promotion. Source commit
    `5ad4f524f9e3434fb039033803f2988316a04564`, coverage receipt
    `b6f8ae2a49de9b8c2a859605a6c6a5da1bfcbc90d440efa9cdf259ccb7db7015`,
    and prerequisite receipt
    `31a90a6e1bb413939a56ab9637c12c660dbfb6247b24a347698312839c366c58`
    are bound into canonical provenance bytes at SHA-256
    `5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07`.
    The exact snapshot retains 72/104 base-complete functions, 31 legacy
    `fn.params` blockers, unchanged profile `kern.kir-canonicalizer.profile.m4.36`,
    and a one-family closure containing only validator `sortstrings` at
    25/43/266 with one legacy parameter row. `while-iteration` remains active
    and unpromoted with two catalog facts and two occurrences. The
    six-record loader module bytes authenticate at
    `11cad7ae42af06e90fa18709d8a4c72c2be2f09788c1c8869db54b882e02c839`;
    live coverage and prerequisite receipts advance only their authenticated
    evidence/implementation hashes to
    `7646cd99678abd39d88a732a0c74ef3474ede960f7a0f1863d53496dac5aeac2`
    and
    `9b522cef1894f8ec43db8b71489b3db951264aeb9ade2591e4e672e066a04f8d`.
    Function facts remain
    `962d0bc6b57a5158fdc8c0f6dfc5c1aebf5ee0c2e53fe4e352241cc75b91f3b5`,
    policy remains
    `ca8362845bc2460dde40596674ded29ff8aab3eb4de40a28fd7789cc558937b1`,
    and validator source remains
    `b8f2e779ced7577804686ac953cf555fffbc271b974bb29d64310245aa6270e2`.
    Exact handoff, causal mutation, ordered-history, current-boundary, and
    status gates are green. The complete Node 22.22 `pnpm fitness:kern-5`
    wall passes, including both 206/206 canonicalizer replays, 434/434
    cross-target fixtures, 109/109 class fixtures, 233/233 native assertions
    at 100% declared coverage, 40 whole-app fixtures across three legs, and
    every repeated KIR, runtime, ownership, convergence, capstone, and
    browser-budget gate. Required high-risk role-lens review
    `review-1784784632782-f0decj` returned all 6/6 usable reviewers: five
    structured verdicts plus one unstructured DRYness report, zero verified
    findings, three needs-check observations, one speculative observation,
    and twelve nits. The needs-check observations were resolved against the
    actual contracts: read-only verification performs no writes; `git show`
    proves both frozen receipt digests at source commit `5ad4f524`; and the
    exact terminal assertions intentionally remain milestone-local while the
    digest-pinned loader enforces canonical bytes. The speculative digest
    concern was a wording ambiguity; `11cad7ae...` is the loader module file
    hash, not a chain-level digest. No material finding remains unresolved.
    KERN 5 remains incomplete; M4.59 owns exact canonicalizer
    validation/emission for this frozen `while-iteration` profile without
    promotion or parameter migration.

  - [x] M4.59 implements exact `while-iteration` validation and emission in
    the KERN-authored canonicalizer statement member. `while` owns exactly one
    required structural `cond` expression plus a recursively validated and
    emitted statement list. Four golden fixtures cover binding/assignment,
    nesting, conditional bodies, and an empty body; nine hostile fixtures kill
    missing, duplicate, excluded, future, non-expression, unsupported, and
    invalid-child variants. The 182-line statement member and 50,476-byte
    composed executable authenticate at
    `adfa0c49cee230106ba7cff2249a0306f98aefc009d7e2581a3ffc622f6e9ff7`
    and
    `94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56`;
    the composition record authenticates at
    `cab6c1e38591e0a75cf717691c9d7247b623ddc849bc65bdf021cdcd3b914995`.
    Live coverage remains profile M4.36 at 72/104 base-complete with 31 legacy
    `fn.params` blockers. `while-iteration` remains selected and unpromoted at
    two catalog facts/two occurrences; validator `sortstrings` remains the
    exact one-function, one-tool, one-row witness; and implementation
    provenance remains the immutable `do-statement` record. Policy, coverage,
    and prerequisite receipts authenticate at
    `6f7c62d5e74253a158a29c037ca8eafe56466f431fa9ec0fe21292bccc84954c`,
    `3ff15ee3068b4a1d1ed273c5a33a269d45948f42c2980f3c4056c201c024a91c`,
    and
    `be873c3b08c4da4b16b318776c68cf1bc84d0ba638faac749f770621fca1860f`.
    Focused Node 22 canonicalizer gates pass 207/207 plus 55/8/3/235 fixture
    sets. The complete Node 22.22 `pnpm fitness:kern-5` wall passes, including
    all three canonicalizer replays, 434/434 cross-target fixtures, 109/109
    class fixtures, 233/233 native assertions at 100% declared coverage, and
    40 whole-app fixtures across three legs. Mandatory high-risk role-lens
    review `review-1784788924213-73zblw` completed with all 6/6 usable
    reviewers, zero verified findings, six needs-check observations, and four
    nits. Security, correctness, performance, and one overall lens were clean.
    The observations were resolved against the actual contracts:
    `composition.mjs` derives byte lengths and hashes, atomically writes the
    composed source and receipt, and rejects drift; repeated historical pins
    intentionally preserve immutable milestone contracts; and the remaining
    source-section and fixture-array suggestions are non-blocking test
    maintainability debt. No material finding remains unresolved. KERN 5
    remains incomplete; the next slice must promote only the exact frozen
    `while-iteration` family before any `sortstrings` parameter migration or
    subsequent-family work.

  - [x] M4.60 promotes the exact frozen `while-iteration` prerequisite into
    cumulative profile `kern.kir-canonicalizer.profile.m4.60` without changing
    handwritten KERN source. The tenth ordered promotion cites immutable M4.58
    digest `5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07`;
    `while` now requires exactly structural `cond`, recursively validates its
    condition and statement children, and leaves only `exception-flow` active.
    Policy and cumulative base-profile bytes authenticate at
    `d76a6f0acdc1b981014b192e424b150a7b802d44bd20bbdff31cd8bcafb5d76f`
    and `795de7b476484a544afa837dda6a052e8442ccda72f16e7730f60eb489d0a079`.
    Coverage remains 72/104 base-complete with 31 legacy `fn.params` blockers;
    the residual one-family search authenticates bounded exhaustion, while the
    exact base-only parameter queue becomes one function, one tool, and one row:
    `examples/selfhost-validator/validator.kern#19:sortstrings` at 25/43/266.
    Coverage and prerequisite receipts authenticate at
    `0912893a2caf11c4132fa8c880d0835488e8254f42ea2599625133970e710836`
    and `c24a3f59fab134a0845980550196f5d843c05d28986ea68a6e31642e3577dfdf`;
    their exact implementation digest is
    `122393317edb7cbd592ecad875e3d77b5cfa185a12c1f0f888bccef26b96f616`.
    The M4.59 composite remains byte-identical at 50,476 bytes and SHA-256
    `94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56`.
    RED first proved the old identity and missing `while.cond` enforcement;
    targeted gates then passed 12/12 and 64/64, the focused canonicalizer gate
    passed 210/210 plus 55 golden/idempotence/KIR fixtures, 8 measured witnesses,
    3 profile-limit fixtures, and 235 hostile fixtures, and the complete
    `pnpm fitness:kern-5` wall passed. Required high-risk role-lens review
    `review-1784792621566-64jcux` completed all 6/6 usable reviewers with zero
    consensus-verified findings; the security, performance, and correctness
    lenses were clean. Review-driven test hardening pins exact while blockers,
    restores ready/residual disjointness, and clarifies current milestone
    labels. After regenerating authenticated receipts, the final targeted set
    passed 29/29 and the complete focused gate again passed 210/210 plus all
    55/8/3/235 fixture classes. No unresolved material finding remains. KERN 5
    remains incomplete; M4.61 must migrate only the exact `sortstrings`
    parameter row before remeasuring the final frontier.

  - [x] M4.61 consumes the immutable M4.60 one-function/one-row parameter
    queue by migrating only validator `sortstrings` from legacy
    `params="xs:string[]"` to one direct `param name=xs type="string[]"` child.
    Function identity, export and return contracts, handler, semantic body,
    generated validator main, cumulative profile, ten ordered promotions,
    sole active `exception-flow` family, profile limits, and canonicalizer
    composite remain exact. Validator source now authenticates at
    `99717668519d853fa83805189626957c1565a415dbfd135c9fe3b1abccfb46a4`.
    The repository checker writer regenerates its source-location aggregate at
    `68b80ab1a720bc2de985fb624ce6f5d543c981d56fcd78816bc44b860a128020`;
    numeric checker, validator main, assertion main, and canonicalizer remain
    byte-identical. Live coverage is 73/104 base-complete with 30 legacy
    `fn.params` blockers and an empty parameter queue. The only active
    `exception-flow` closure completes zero functions, so current bounded
    exhaustion selects residual blocker analysis next. Policy, coverage, and
    prerequisite receipts authenticate at
    `00517a1a5e8958ed4158310a2c5c4815c9a8cf673d98e73f45c41f4edbae408e`,
    `07b9e09c860e803f493599eb809870916df470dfa66c488570d3129431c4a23e`,
    and `135759db56ce009c72adedfc4caa0018e78709361388ad1b91ff33bf8c034dfd`;
    the implementation, function-fact, and corpus digests are
    `613810d0b74e31f21cd756520dbfe94047ba06ee654ef349a86663a32b517d83`,
    `4ef2c486bbff42c35795789ac66e362863a357f5e7d6ca10dd77525576dc761d`,
    and `1ce05b6867a583aef963ee5a8cd087c1865ca88173dc8c4432d3680a382078ae`.
    RED, exact-target mutation, immutable M4.60 handoff, cumulative migration,
    writer-reproduction, deterministic fresh-process, and focused coverage
    gates are green. The complete Node 22 KERN 5 fitness wall passed on the
    exact tree. Automatic high-risk role-lens review
    `review-1784797157970-79cjrq` completed 6/6 with zero verified or
    speculative findings. Its sole needs-check concern measured five repeated
    reads and SHA-256 sweeps of the 6.35 MB checker aggregate at about 16.8 ms
    total versus the 132-second canonicalizer test phase; the independent
    historical guards remain intentional. Eight non-material naming,
    formatting, duplication, and test-harness nits are deferred. No unresolved
    material finding remains. KERN 5 remains incomplete; the next slice must
    use the measured residual blocker evidence and must not infer an
    exception-flow promotion from this zero-completion closure.

  - [x] M4.62 publishes the exact current 30-function residual analysis
    without changing KERN source, generated consumers, the 25/50/388 profile,
    the sole active `exception-flow` family, parser, runtime, KIR, ABI,
    packages, or public APIs. Format-3 measurement reproduces assignment digest
    `6a2d680c3dfe3fdbddf24f5b6cd383e03d5c2b7ed1fdf5667ec6ea94551c40e5`
    across all 30 residual functions. Fourteen functions expose profile rows,
    yielding 12 distinct observed settings and 12 positive candidates under
    the unchanged canonical ranking. The deterministic winner raises only
    `maxNodeRows` from 25 to 28, keeps property/value limits at 50/388, and
    completes four functions across checker and validator: `isSafeMagnitude`,
    `mapCallRejectDetail`, `fnokat`, and `ownexportkind`, totaling 37 parameter
    rows. The immutable receipt authenticates at
    `5339ffa5c128efbe857b53e64a67092d72b8b6b6cbe6cc3ea16c96f4939e79cc`;
    coverage and prerequisite summaries authenticate at
    `ea14f05bc46fbcbba7d56ccfbb748c65de1f3c4080708736a671d42d366bb95c`
    and `fa75b97922ab4ee9f1eb16cf28f50755a9524b3763ec68d0af866560c959b247`.
    RED, exact receipt mutation, decorated-data, M4.54 history, fresh-process,
    status, prerequisite, and complete residual-history tests pass 41/41. The
    complete Node 22 fitness wall passed, followed after review fixes by the
    complete canonicalizer gate at 218/218 plus all 55/8/3/235 fixture classes.
    Automatic high-risk role-lens review `review-1784800561443-zzz2m9`
    completed 6/6 with zero verified findings. Its two material current-slice
    concerns were fixed by executing the live analyzer against the frozen
    receipt and removing a stale next-action status phrase. Four deliberate
    immutable-milestone duplication concerns, one speculative entry-point
    hardening concern, and nine non-material nits are deferred. No unresolved
    material finding remains. KERN 5 remains incomplete: M4.63 must
    authenticate exact structural runtime headroom for all four witnesses
    before any node-row promotion.

  - [x] M4.63 authenticates exact structural runtime headroom for the four
    immutable M4.62 witnesses without changing handwritten KERN source,
    generated consumers, the active 25/50/388 profile, family policy, parser,
    runtime, KIR, ABI, packages, or public APIs. Public
    `kern.runtime.handler.v1` execution proves monotonic floor-minus-one
    failure, floor success, and byte-identical structural round-trip at exact
    floors 21,736 for `isSafeMagnitude`, 27,076 for `mapCallRejectDetail`,
    21,825 for `fnokat`, and 24,993 for `ownexportkind`. The maximum 27,076
    floor leaves 22,076 steps inside the policy-derived 49,152 promotion budget
    and 38,460 inside the unchanged 65,536 production ceiling; module-envelope
    admission remains explicitly `not-claimed` at depth 64. The frozen receipt
    authenticates at
    `110260eb3a2c9ed942e309d5b6e1331f2752bc486bfe99840c887e2a6ef7e7c3`;
    coverage and prerequisite summaries authenticate at
    `dbd7a3fcb0c2655b76475c62bca936d34872d42b9923679aaf5f11a096d35153`
    and `a73c830b8b74af2e128ca88bf31179233f4117a40db9cf537576ff9fdc6918f2`,
    with coverage implementation digest
    `671def9cd9967c3e6305b40b55cd842a2980d9fe3e858e6b66fd5c442b1bf8df`.
    Focused gates pass 16/16 and 5/5; the standalone canonicalizer passes
    227/227 plus all 55/8/3/235 fixture classes; and the complete Node 22
    `fitness:kern-5` wall passes. Automatic high-risk role-lens review
    `review-1784805563870-g1y27i` completed 6/6 with zero consensus-verified
    findings, five needs-check findings, and ten nits. The writer-integrity
    concern was fixed by validating the exact receipt digest before any write,
    and the stale spec was updated with measured evidence. The remaining
    observations were rejected as non-exploitable in the hard-coded repository
    call graph, incorrect, intentional immutable-milestone isolation, or
    already covered by the fresh-build gate. No unresolved material finding
    remains. KERN 5 remains incomplete: M4.64 must freeze this exact receipt
    and promote only `maxNodeRows` from 25 to 28 before any of the 37 parameter
    rows migrate.

  - [x] M4.64 freezes M4.63 as immutable published evidence and promotes only
    `profileLimits.maxNodeRows` from 25 to 28, preserving property/value limits
    50/388, runtime ceiling 65,536, KIR depth 64, the 73/104 cumulative base,
    and all 30 legacy `fn.params` blockers. The exact M4.63 receipt remains
    byte-identical at
    `110260eb3a2c9ed942e309d5b6e1331f2752bc486bfe99840c887e2a6ef7e7c3`
    and is bound to source commit `6aba5e056c833e7dd2e613a21ac52e3f718d9673`.
    The promoted profile exposes exactly four parameter-ready functions across
    checker and validator—`isSafeMagnitude`, `mapCallRejectDetail`, `fnokat`,
    and `ownexportkind`—with 37 total parameter rows and 26 residual functions;
    an exact 29-node-row hostile fixture remains rejected. Policy, coverage,
    and prerequisite summary digests are
    `589de16d30335145b89dfe50f57721ae2424f580b659749d7b5de8f4f771257c`,
    `d7a284c00163199a247df6c6aeec13cde06cc786ca9a7423eacc619bfbc937c9`,
    and `9bba0c10b55e732392fa68dd7f7174135a4ff380875e15ea787e045b46d5610f`;
    coverage implementation and reason-assignment digests are
    `5b3bfb87d739d37d9617fdbe22e97febc214edda298199764d0b756c51eee3f9`
    and `68108254cf57ba70b019f6556c6808e585eeb63355078b7f9c243271fdb989c6`.
    Focused gates, the standalone 232/232 canonicalizer suite plus all
    55/8/3/235 fixture classes, and the complete Node 22 `fitness:kern-5` wall
    pass. Automatic high-risk role-lens review
    `review-1784809274977-0mcpmm` completed 6/6 with zero verified findings,
    three needs-check findings, one speculative finding, and nine nits.
    Historical published-only verification was documented, drift mutations
    were strengthened, and receipt anchors/key-order semantics were clarified;
    the remaining independent historical assertion duplication and explicitly
    authorized no-verify push observation are non-material. No unresolved
    material finding remains. KERN 5 remains incomplete: M4.65 must freeze and
    migrate only this exact four-function/37-row parameter queue.

  - [x] M4.65-M4.151 canonicalizer frontier closure: the serial authenticated
    parameter, profile-headroom, structural-family, runtime-cost, and residual
    slices recorded in `.Codex/specs/kern-5-r2-m4-*` and the corresponding main
    commits complete the bounded KERN-authored corpus at 112/112 functions.
    M4.151 commit `c063801418827b5053811c28ab6745e53bd7e020` leaves zero
    profile blockers, zero legacy `fn.params` blockers, an empty migration
    queue, and terminal prerequisite-summary format 4 outcome `complete`.
    The focused gate passes 732/732 structural/authentication tests plus 58
    golden/idempotence/KIR fixtures, eight measured witnesses, three
    profile-limit fixtures, and 250 hostile fixtures. This closes the bounded
    repository canonicalizer frontier; it does not promote the formatter,
    frontend, compiler, fixed point, or interpreter ownership rows.

  - [x] M4.152 packaged canonicalizer preview: carries the exact authenticated
    KERN composite and policy in `@kernlang/cli` dist, copies the existing
    structural module codec's bounded emitted closure privately without adding
    a core package export, and adds
    `kern canonicalize <file.kern> [--check] [--json]`. The command runs the
    KERN handler over decoded structural KIR, preserves KIR bytes, rejects
    parse/profile/asset failures and non-preservable comments without partial
    source, and matches the complete
    existing golden corpus through built dist. Because comments/trivia are not
    preserved and the bootstrap frontend remains TypeScript, both
    `kern-formatter` and `kern-frontend` remain `not-shipped`.
    Verification passes thirteen command-contract tests, 58 packaged-dist
    golden/fixed-point replays, three bounded profile rejections, isolated
    asset-tamper rejection, actual `pnpm pack` artifact/content inspection,
    an extracted-tarball success smoke, the internal KIR containment guard,
    and the complete canonicalizer wall at 732/732 and terminal 112/112.

  - [x] M4.153 KERN-authored frontend tokenizer shadow: adds a handwritten,
    bounded line scanner for all eleven bootstrap token kinds and the four
    tokenizer diagnostics. KERN returns a sealed monotone tape of exact source
    deltas for token starts plus local diagnostic end spans; the test-only
    adapter validates the tape and independently normalizes bootstrap UTF-16
    positions and KERN fragments to UTF-8 byte locations. The complete public
    envelope is measured against a policy-owned JSON byte ceiling before any
    record is parsed.
    Deterministic fixtures cover nested expressions, quoted/style escapes,
    numeric bases and BigInt diagnostics, evolved identifiers, slash paths,
    and non-BMP text inside aggregate tokens. Standalone non-ASCII unknowns,
    malformed UTF-16, and malformed bootstrap aggregate-token slices fail
    closed, while config-owned byte, code-point, token, diagnostic, record,
    and runtime bounds are enforced atomically.
    The gate includes 307 fixture/generated/committed-corpus parity cases,
    six excluded-profile cases, eight
    boundary cases, policy/source containment checks, and discriminating
    token-kind/diagnostic mutations. Only
    `kern-frontend-tokenizer-shadow: internal-oracle` is promoted; the full
    frontend, compiler, fixed point, and interpreter remain open.

1. Correct the support matrix and make `fitness:kern-5` the planned aggregate,
   without pretending missing commands already exist.
2. Close checker v2: admit structured `while`/`else`, replace literal numeric
   whitelists with the designed integer contract, and accept-and-run every
   handwritten self-hosted tool.
3. Probe the three KIR seams and select one only after hostile values,
   diagnostics, effects, modules, capabilities, and determinism discriminate
   them.
4. Promote the selected strict reader into browser-safe core source as an
   internal candidate, parity-locked to the probe and deliberately unexported.
5. Prove the planned canonical runtime call chain is non-circular before any
   ABI promise: executing a KERN-authored interpreter through
   `referenceRunSequence` is not yet semantic ownership.
6. R1.5a: bind every static source node and native runner contract to an
   executable eligibility inventory. Preserve `ALPHA-NO-GO` while the selected
   probe covers only seven of 302 source node kinds.
7. R1.5b: implement the bounded strict UTF-8 canonical/value reader with closed
   scalar, collection, map, record, and error-data profiles. Regex, expression,
   and operator admission remain excluded from this portable value format.
8. R1.5c: close module/node writer-reader parity and freeze any portable regex
   and operator grammar that admitted nodes require. Every catalog row becomes
   included, deterministically lowered, or explicitly excluded with fixtures.
9. R1.5d: version diagnostic/location evidence separately, require stable
   non-empty diagnostics and expression spans, then generate the clean-SHA
   Alpha manifest. Unknown versions and fields fail before effects.
10. R1.5e.1: bridge the exact executable runtime-handler type domain into
    semantic structural/module KIR before M4 consumes the seam. Keep the other
    93 type-annotation locations excluded and preserve `ALPHA-NO-GO`.

The original broad R1.4-before-ownership order was withdrawn after the R1.3
probe. The selected projection covers seven of 302 source node kinds, while the
native runner requires 16 semantic contracts. R1.5a makes that denominator and
the remaining blockers executable. M3 implemented trace normalization,
handler, scheduler, and capability behavior; Phase 1.1 freezes the public
runtime boundary while KIR-to-runtime composition remains deferred. The split
prevents an internal shadow schema from becoming an
accidental public promise.

**Binary exit:**

- Checker accepts and executes assertion, validator, and checker modules.
- Orphan/duplicate `else`, unsafe loops, invalid numeric boundaries, and every
  accept-but-abstain attack reject.
- Canonical KIR bytes match across the hostile corpus, process, OS, locale, and
  clean-root matrix.
- Unknown KIR/ABI input fails before any effect or partial output.
- No OPEN or ASSUMED claim feeds a build oracle.
- The complete 4.5 regression wall remains green.

**Artifact:** Alpha manifest containing commit SHA, frozen schema hashes,
oracle results, and known exclusions. No package version or public tag.

**Rollback:** disable readers/shadows; the current 4.5 path remains primary. If
the KIR leaks TypeScript coercion rules or the runtime seam is circular, Alpha
fails and the contract is redesigned.

**Scheduling rule:** release by binary slice completion, not calendar guesses.
Each R1.5a-d slice ships only after its named oracle, the complete 4.5 wall, and
three-engine review pass. Historical 4.0/4.5 throughput is useful for ordering,
but it is not evidence for the unresolved KIR coverage count.

**Confidence:** 0.97 in the R1.5a-d order after the completed KIR audit,
three-engine tribunal, and full-roster brainstorm. Confidence in Alpha timing
remains deliberately unstated until R1.5b measures the strict-reader work.

## R2 - Internal Beta: Become Feature Complete

**Scope:** M3-M8, with every new implementation default-off until the end.

After Alpha, two lanes may advance in isolated branches and merge serially:

- **Runtime/app lane:** one sync/async semantic scheduler, typed handler call,
  explicit effects, KERN policy decisions, generic app host, and native/TS/
  Python capability parity.
- **Toolchain lane:** KERN canonicalizer/formatter, frontend, compiler, and the
  clean Stage 0 -> Stage 1 -> Stage 2 fixed point.

The KERN interpreter shadow begins only after both lanes consume the frozen KIR
and handler/capability ABIs.

**Binary exit:**

- Typed handler arguments/results validate symmetrically; errors expose no
  partial result, stdout event, response, or host effect.
- Sync and immediately resolved async providers produce byte-identical semantic
  traces through one engine.
- No application-specific stdout marker becomes an HTTP response.
- Formatter is idempotent and preserves canonical KIR:
  `format(format(x)) == format(x)` and
  `KIR(parse(format(x))) == KIR(parse(x))`.
- KERN and bootstrap frontends emit byte-identical KIR and stable diagnostic
  code/location over the complete valid and malformed corpus. No tolerated
  drift list exists.
- KERN compiler output byte-matches the bootstrap output on the discriminating
  corpus and compiles its own sources.
- Stage 1 equals Stage 2 twice from separate clean roots using immutable packed
  inputs; behavior and diagnostics also match.
- Auth, HMAC, and RAG review pass the runner-host, Express, FastAPI, emitted
  capability, and whole-app failure matrix. Hosts provide facts; KERN decides.
- KERN interpreter shadow has zero typed-result, event, diagnostic, completion,
  or capability-request divergence across every supported v5 construct.
- Mutated parser/compiler/interpreter implementations are killed by the oracle.

**Artifact:** Beta manifest with exact SHA, schema/ABI hashes, fixed-point
hashes, packed-tarball integrities, full shadow report, and explicit gaps. The
new paths remain default-off.

**Optional public Beta:** allowed only after R0 and only for a named downstream
test plan. Use a configured `5.0.0-beta.N` channel; never `latest`. Every code or
semantic change increments `N` and reruns the exact publication wall.

**Rollback:** turn off the shadow path and keep the TS bootstrap engine primary.
Any KIR or ABI change invalidates Alpha and restarts Beta parity.

**Estimate:** 6-9 active / 8-14 calendar days after Alpha, assuming the proven
parallel design/build cadence.

**Confidence:** 0.86 after Alpha freezes KIR; 0.72 today because the semantic
interpreter remains the largest technical risk.

## R3 - Internal RC: Cut Over, Do Not Add Features

**Scope:** canonical cutover and release proof only.

**Entry:** Beta is feature complete, Stage 1 equals Stage 2, interpreter shadow
is zero-drift, and the full support matrix contains no future-tense v5 claim.

**Order:**

1. Freeze public APIs, KIR, handler ABI, capability ABI, configuration schema,
   CLI behavior, and package graph.
2. Make the KERN semantic engine canonical for internal packages, then CLI Node,
   then browser. Each flip has its own trace and budget wall.
3. Keep the TS oracle inside the same built release graph behind an explicit,
   config-driven engine selector. Run both canonical and forced-TS lanes in CI;
   unsupported canonical input fails loudly instead of falling back.
4. Remove the scheduled 4.x root re-exports and prove the selected browser-safe
   public graph reaches no TypeScript compiler or Node-only module.
5. Correct README, support matrix, runtime roadmap, migration guide, changelog,
   examples, and wording. “Preview” remains only on genuinely gated surfaces.
6. Pack the exact graph and run one clean downstream KERN product canary.
7. Run the full local wall, then full-roster `agon review`; fix every verified
   blocker and restart RC if source changes.

**Binary exit:**

- `pnpm fitness:kern-5` passes twice from separate fresh roots and builds every
  artifact it reads.
- Normal execution has a static/dynamic witness that it never invokes the TS
  ReferenceRunner semantic path.
- Forced TS-oracle mode remains buildable, executable, and trace-compatible.
- No hidden fallback test can make canonical mode pass unsupported input.
- Exact packed tarballs pass imports, CLI check/compile/run, reference app,
  Express/FastAPI app, and clean fixed-point bootstrap.
- Browser graph and configured performance budgets pass.
- Full-roster review reports no verified blocker.

**Artifact:** immutable RC manifest with source SHA, toolchain versions, policy
hashes, all tarball integrities, all gate results, and the only intentional
RC-to-final difference: injected SemVer/version stamps.

**Optional public RC:** allowed only when external installation is itself an
acceptance dependency. Use `5.0.0-rc.N` on the configured RC tag. Any source
change creates a new RC and reruns all proof.

**Rollback:** select the already-built TS oracle explicitly and restore the
previous package entry tag if necessary. This rollback is tested in the exact
RC artifact; it is not a promise to rebuild an old source tree later.

**Estimate:** 1-2 active / 2-3 calendar days.

**Confidence:** 0.92 after Beta exits; 0.78 today because cutover cost depends
on the still-unmeasured interpreter and browser budgets.

## R4 - Public v5.0.0

**Rule:** final contains no new source work.

1. Point the final tag at the exact accepted RC source SHA. If RC was internal,
   verify the manifest SHA; if it was public, both release tags identify the
   same source commit.
2. Inject `5.0.0` through the configured release policy. Rebuild from a clean
   root and compare the result with the RC manifest after normalizing only the
   enumerated version-stamp fields.
3. Run the complete release wall again inside the publish job.
4. Pack once, verify, and upload every exact tarball under a version-specific
   staging tag using the R0 recovery algorithm.
5. Verify registry integrity, exact internal dependencies, exports/binaries,
   clean exact-version install, CLI/runtime/app execution, and fixed-point
   bootstrap.
6. Promote public tags dependency-first and `kern-lang@latest` last. Verify each
   move, acknowledge the non-atomic direct-package window, and keep `4.5.0`
   recoverable throughout.
7. Install from `latest` in a clean consumer and rerun the representative smoke
   wall. Then create/finalize the public release record and sync the stable
   baseline to `dev`.
8. Record tag, source SHA, workflow run, provenance, package integrities, and
   post-publish results in the final release manifest.

**Failure after upload:** never reuse `5.0.0`. Deprecate it, restore public
entry tags to the last coherent release when necessary, fix on main, run a new
RC, and publish `5.0.1`.

**Estimate:** 0.5-1 active day; about one calendar day.

**Confidence:** 0.96 once the RC manifest is accepted.

## Target Release Wall

The current `fitness:kern-5` implements every CURRENT row in the versioned
fitness policy, but it is not yet the full target wall. Commands marked TARGET
must be created and promoted atomically in the policy and support matrix before
RC.

```text
pnpm check:repo
pnpm lint
pnpm build
pnpm test
pnpm check:conformance
pnpm test:kern
pnpm test:runner-smoke
pnpm test:app-behavior
pnpm test:drift-showcase
pnpm check:runner-browser-budget:required
pnpm test:kern-ir-probe               # CURRENT experimental seam oracle
pnpm test:kern-ir-reader-candidate    # CURRENT internal reader candidate
pnpm test:kern-semantic-ownership     # CURRENT bootstrap-dependent ownership proof
pnpm test:kern-ir-eligibility         # CURRENT internal KIR v1 coverage/identity acceptance
pnpm test:kern-canonical-value        # CURRENT bounded internal value reader
pnpm test:kern-ir                      # CURRENT internal canonical KIR v1 and acceptance lineage
pnpm test:runtime-abi                  # CURRENT public facade containment
pnpm test:kern-runtime-contract-v1     # CURRENT anchored runtime v1 freeze
pnpm test:kern-frontend                # TARGET
pnpm test:kern-compiler                # TARGET
pnpm test:selfhost-fixed-point         # TARGET
pnpm test:kern-interpreter-shadow      # TARGET
pnpm test:packed-release               # TARGET
git diff --check
```

`fitness:kern-5` becomes the self-contained aggregator for this wall. It cannot
read stale `dist/`, workspace-linked packages, or evidence from another SHA.

## Slice-to-Main Operating Rhythm

Every feature slice follows the same sequence:

1. Start from current `origin/main`; restate the 3-5-step slice plan and freeze
   its claim-tagged contract.
2. Write a discriminating oracle, prove RED-at-base for the intended reason,
   and red-team it for a subtly wrong passing implementation.
3. Implement in an isolated branch/worktree. The design lane may prepare only
   the next slice; the build lane remains serial at integration.
4. Run touched-package gates plus the complete currently available repository
   wall.
5. Run full-roster `agon review`, verify findings from source/reproduction, fix,
   and rerun until there is no blocker.
6. Make granular local Agon-signed commits, push the complete feature once, and
   hand over the native-git PR link. Never push directly to main without
   explicit confirmation.
7. After human merge, record the merge SHA and oracle evidence in the current
   stage manifest before starting a dependent slice.

## Schedule Based on Actual KERN Velocity

| Evidence window | Observed result |
|---|---:|
| v3.5.8 -> v4.0 | 33 commits over 7 active days / 6d 7h elapsed |
| v4.0 -> v4.1 | 44 commits over 10 active days / 11d 21h elapsed |
| v4.1 -> v4.5 | 32 commits over 10 active days / 14d 22h elapsed |
| Self-host ladder #488 -> #500 | 13 landings in 27h 54m |

The critical-path projection is **10-16 active build days / 14-24 calendar
days**. R0 overlaps Alpha design; internal manifests add little release latency.
The serial sum is closer to 10-17 active days if publication machinery cannot
overlap.

This is not a commitment to a calendar date. The two confidence dependencies
are the KIR seam and the non-circular interpreter substrate. If either misses
its probe exit after one milestone cycle, report the evidence and replan rather
than silently consuming contingency.

## Go/No-Go Summary

KERN 5.0 is releasable only when all are true:

- [x] R0 publication failure/recovery simulations pass. R0.1-R0.4 now enforce
      policy-bound planning, exact 22-package artifact validation, durable
      forward-only registry publication, and root-last failed-smoke containment
      with exhaustive ambiguous-mutation drills.
- [ ] Alpha freezes non-host-specific KIR and a non-circular runtime seam.
- [ ] Beta is feature complete and all shadow parity is zero-drift.
- [ ] Stage 1 equals Stage 2 twice from clean packed inputs.
- [ ] KERN policies and capabilities pass native/TS/Python and whole-app walls.
- [ ] RC canonical execution has no TS semantic call or silent fallback.
- [ ] The forced TS oracle remains operational in the same artifact.
- [ ] Root/browser public boundaries match the v5 support matrix.
- [ ] Exact RC tarballs pass downstream canary and packed bootstrap.
- [ ] Final source SHA equals accepted RC source SHA.
- [ ] Final exact-version wall, staging upload, integrity verification,
      dependency-first promotion, and post-`latest` smoke pass.
- [ ] Documentation says no more than the binary oracles prove.

If any item is false, remain at the prior internal stage. Do not relabel the
remaining work as Fable merely to make `5.0.0` ship.

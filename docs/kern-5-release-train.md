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
- [ ] R1.5 eligible KIR/value/diagnostic contract freeze and Alpha manifest.
  Runtime trace, handler, scheduler, and capability ABIs are M3 work in R2.
  - [x] R1.5a source/runner eligibility inventory and identity constitution.
  - [x] R1.5b bounded strict UTF-8 canonical/value reader.
  - [ ] R1.5c coverage-closed module/node writer-reader parity.
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
    - [x] R1.5c.4 executable coverage closure: all 302 node kinds and 1,149
      properties have 2,286 executable include/exclude witnesses; 16 runtime
      contracts remain explicitly deferred to M3. Full fitness wall and final
      3/3 Agon review passed on 2026-07-12 (`ALPHA-NO-GO`).
  - [ ] R1.5d diagnostic/location evidence contract and Alpha manifest.
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
the remaining blockers executable. Trace, handler, scheduler, and capability
ABIs stay in M3 because they describe runtime convergence rather than KIR wire
identity. The split prevents an internal shadow schema from becoming an
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
pnpm test:kern-ir-eligibility         # CURRENT Alpha no-go coverage/identity inventory
pnpm test:kern-canonical-value        # CURRENT bounded internal value reader
pnpm test:kern-ir                      # TARGET
pnpm test:runtime-abi                  # TARGET
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

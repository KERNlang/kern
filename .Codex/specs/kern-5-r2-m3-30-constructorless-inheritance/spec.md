# KERN 5 R2 M3.30 Constructorless Same-Root Inheritance

**Status:** COMPLETE
**Date:** 2026-07-16
**Confidence:** 0.98
**Latest review:**
`review-1784184896071-7m2bxe-kern-5-r2-m3-30-constructorless-`

## Executive Summary

M3.30 adds the smallest complete inheritance lifecycle to the private source
runner: linker-owned classes in one root module, with no constructors anywhere
in the selected lineage, initialize inherited fields base-to-derived and
dispatch pure methods/getters from the derived class toward its bases. Derived
members override base members. A derived field declaration overwrites the
already-initialized base slot, aligning the source runner with the existing
TS/Python conformance contract.

Admission is deliberately graph-wide for the selected root module, matching
source semantic validation: an unused malformed class component rejects the
whole handler rather than allowing reachability to hide invalid class
metadata. Runtime dispatch remains limited to the constructed receiver's
snapshotted lineage.

This slice does not claim the full `runner-classes-state` row. Constructor
chaining, explicit `super`, imported/re-exported class scopes, and active
effectful class frames remain one exact M3.31 blocker. That split preserves a
testable lifecycle instead of mixing construction ordering, lexical module
ownership, and resumable effects into one release card.

## Historical Root Cause (Closed)

- **VERIFIED:** before M3.30, machine graph admission rejected every non-empty
  `extendsName` before snapshotting.
- **VERIFIED:** the pre-M3.30 snapshot omitted `extendsName`, so lineage identity
  could not survive async suspension even if the admission guard were removed.
- **VERIFIED:** pre-M3.30 machine instance preparation initialized only the
  selected class's direct fields.
- **VERIFIED:** pre-M3.30 machine getter and method lookup consulted only the
  receiver's exact class map.
- **VERIFIED:** compatibility semantics initialize bases recursively before
  derived fields and constructors (`packages/core/src/ir/semantics/portable-reference-body.ts:49-80`).
- **VERIFIED:** compatibility member lookup walks derived-to-base and therefore
  gives the nearest override precedence (`packages/core/src/ir/semantics/portable-reference-body.ts:149-172`).
- **VERIFIED:** the validator permits same-kind inherited field overrides
  (`packages/core/src/semantic-validator.ts:5772-5800`), and the
  release-blocking class fixture requires `Dog.sound` to replace
  `Animal.sound` (`scripts/class-conformance.mjs:287-304`).
- **VERIFIED:** the source-runner compatibility initializer previously skipped a
  derived field once the base created the slot
  (`packages/core/src/ir/semantics/portable-reference-body.ts:69-74`). A direct
  2026-07-16 `executeKernSource` probe printed `generic` for that Animal/Dog
  program, contradicting the emitted-leg fixture's required `woof`.
- **VERIFIED:** the convergence ledger now keeps one legacy full-class row with
  the exact M3.31 constructor/super/module/effect follow-up.

The first root cause is a stale compatibility initializer that disagrees with
the language's emitted-leg field override semantics. After correcting that
oracle, the missing machine behavior is an immutable lineage owner shared by
graph admission, field initialization, member preflight, and runtime dispatch.
Removing the inheritance guard alone would create four divergent partial
implementations and allow metadata drift after selection.

## What Already Works

- Exact linker ownership, descriptor snapshots, root-module identity, and
  run-local class registries already reject caller-forged metadata.
- Same-root direct fields, field assignment, pure one-return methods, and pure
  one-return getters already execute on the machine.
- Root-only allocation/member-use restrictions and before-provider preflight
  already define the safe use-site boundary.
- The compatibility runner remains the oracle and the fallback for every
  inheritance form outside this slice.

## Contract (Verified)

> Verified against the machine and compatibility sources listed below on
> 2026-07-16.

| Field / Behavior | M3.30 contract | Evidence | Tag |
| --- | --- | --- | --- |
| Metadata | exact linker-owned classes in one root module | `internal-effect-machine-class-graph.ts:127-165` | VERIFIED |
| Lineage | finite, acyclic, every base present in the selected snapshot | `runner.ts:277-305`; machine revalidates independently | VERIFIED |
| Constructors | every class participating in an inheritance edge has no constructor; unrelated direct classes retain M3.26 constructors | compatibility constructor lifecycle at `portable-reference-body.ts:49-80` | VERIFIED |
| Fields | evaluate declarations base-to-derived; a derived declaration overwrites the base slot, including with `undefined`; field initializers remain in the existing outer scalar domain and cannot read `this` | validator and emitted-leg oracle at `semantic-validator.ts:5772-5800`; `class-conformance.mjs:287-304` | VERIFIED |
| Dispatch | nearest derived method/getter wins, then walk bases | `portable-reference-body.ts:149-172` | VERIFIED |
| Field precedence | an initialized field wins before getter lookup | `portable-reference-evaluator.ts:225-239` | VERIFIED |
| Member field reads | `this.field` may name any field visible in the declaring member owner's lineage; the runtime receiver supplies the final overridden slot value | compatibility instances contain base fields before derived dispatch at `portable-reference-body.ts:49-80` | VERIFIED |
| Owner identity | member resolution returns both runtime receiver class and declaring owner; owner metadata is never flattened away | `RunnerClassMemberBinding.ownerClass` at `semantic-env.ts:151-163` | VERIFIED |
| Override kinds | field/method/accessor kind must match the inherited member kind; standalone M3.29 field/getter precedence remains unchanged | `semantic-validator.ts:5765-5795`; `runtime-envelope-effect-machine-class-getter.test.ts` | VERIFIED |
| Use sites | existing complete root allocation/read/write/method/getter leaves only | `internal-effect-machine-class-graph.ts:168-250` | VERIFIED |
| Preflight | every base/derived field initializer and member body validates before any provider | selector invokes class graph admission at `source-runner-engine.ts:92`; M3.30 oracle binds the full lineage | VERIFIED |
| Suspension | every lineage lookup uses only the run-local snapshotted registry after selection | run-local registry in `internal-effect-machine-types.ts:48-55` | VERIFIED |
| Deferred | constructors, all `super`, imported scopes, effects, nested dispatch | release ledger at `docs/kern-5-release-train.md:539-541` | VERIFIED |

## Implementation Options

### A. Constructorless same-root lineage owner — selected

First correct the compatibility initializer to apply derived declarations
after base declarations. Add one private lineage helper used by graph validation, field initialization,
member-body preflight, use-site recognition, and method/getter resolution. It
admits transitive same-root inheritance only when every class participating in
an inheritance edge has no constructor; unrelated direct classes keep their
existing constructor owner. The helper returns the owning class
for a resolved member and proves that the exact receiver class descends from
that owner. Member purity validates `this.field` against the declaring owner's
full visible lineage, not only that class's direct field map. Before execution, preflight
walks every base/derived initializer and member body; after selection, every
walk uses the run-local registry exclusively.

Inheritance admission independently revalidates direct registries rather than relying on
source semantic validation: every base must exist in the exact root scope;
cycles reject without a hardcoded depth threshold; derived fields overwrite
same-named base fields; overrides preserve field/method/accessor kind; method
overrides preserve arity; and every inherited field initializer/member remains
inside the existing pure scalar domain. Dispatch walks derived-to-base and
returns both the member and its declaring owner.

### B. Full constructor and `super` ownership in M3.30 — rejected

This requires explicit/implicit base argument evaluation, exact `this` timing,
base/derived field initialization order, `super.member` dispatch, and
before-provider validation across multiple constructor frames. It is a
materially separate runtime state machine, not an extension of member lookup.

### C. Inherited fields without inherited dispatch — rejected

Construction would succeed but normal source calls could change engine or
behavior solely because a member lives on a base. That is not a complete
user-visible inheritance lifecycle and would leave an awkward partial owner.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `portable-reference-body.ts` | replace the base-slot skip with derived overwrite | align source execution with validator and TS/Python oracle |
| private class lineage helper | add immutable lineage and nearest-member resolution | one owner for admission and execution |
| `internal-effect-machine-class-graph.ts` | preserve/validate `extendsName`; use inherited leaf discovery | admit exact same-root constructorless graphs |
| `internal-effect-machine-class-runtime.ts` | initialize inherited fields and preflight lineage members | base-to-derived state with derived dispatch |
| focused inheritance test | add source/direct parity, override, transitive, async, and negatives | RED/GREEN oracle |
| convergence manifest/checker/tests | add M3.30 evidence and advance full blocker | truthful release ledger |
| package fitness policy | include inheritance oracle in required convergence gate | bind CI evidence |
| release train/spec | record exact final receipts | auditable handoff |

## Acceptance Criteria

- [x] Compatibility and machine initialization both overwrite a same-named
      base slot, including when the derived declaration has no initializer;
      linked public source parity is frozen for the initialized override.
- [x] Linked public source and direct machine execution construct a
      constructorless derived class with base and derived scalar fields in
      base-to-derived order.
- [x] Direct field read/write works for inherited fields without changing
      field-before-getter precedence.
- [x] Inherited methods/getters and nearest derived overrides match
      compatibility output, including a transitive three-class lineage and a
      base member reading a derived field override plus a derived member
      reading an inherited field.
- [x] The selected snapshot preserves base identity, fields, methods, getters,
      and override dispatch across an async capability suspension.
- [x] Unknown, cyclic, non-linker-owned, cross-module, metadata-mutated, or
      inherited-member-kind-conflicting lineages reject before provider
      dispatch. Valid source-level field/getter kind mismatches are already
      rejected by semantic validation; direct environments fail closed too.
- [x] Direct registries independently reject local/cross-lineage member-kind
      conflicts and inherited method arity drift, even when parser semantic
      validation was bypassed.
- [x] A constructor anywhere in an inheritance component routes the complete
      handler to compatibility before provider dispatch, while an unrelated
      direct class with an M3.26 constructor remains machine-compatible.
- [x] Every base and derived field initializer/member body is preflighted
      before an earlier provider, including helper/effectful base initializers.
- [x] Inherited dispatch accepts a derived receiver only when its snapshotted
      lineage contains the resolved member owner; no original `env.runnerClasses`
      lookup occurs after selection.
- [x] Any constructor anywhere in an inheritance lineage in the selected root
      registry, explicit
      or implicit `super` behavior, `super.member`, imported/re-exported class,
      effectful member, nested member use, or helper/class mixing remains a
      compatibility path before provider dispatch.
- [x] Manifest adds `runner-class-constructorless-inheritance` as unified and
      retains `runner-classes-state` as the exact M3.31 constructor/super/module
      blocker.
- [x] Every touched handwritten source/test file remains below 500 lines.
- [x] Focused class/convergence gates and exact `pnpm fitness:kern-5` pass.
- [x] One final full-roster `agon review` completes; every finding is verified
      against current code and genuine blockers receive targeted regressions.

## Out of Scope

- Any constructor in a constructed lineage, including no-argument
  constructors that would otherwise look equivalent to implicit construction.
- Explicit constructor `super(...)`, implicit base-argument forwarding,
  `super.method()`, `super` getter access, or `this`/`super` ordering.
- Imported, re-exported, aliased, or cross-module class lookup.
- Effectful/async methods, getters, constructors, field initializers, or
  resumable class frames.
- Nested allocation/member use, helper/class mixing, recursion, composite
  returns, and mutation inside member bodies.
- Deletion or promotion of the full `runner-classes-state` blocker.

## Open Questions

None. The recommended option has no ASSUMED or OPEN contract claims.

## Deploy Order

This is an internal machine-eligibility expansion with no exported API change.
Ship core behavior, focused oracle, convergence policy, and release evidence in
one branch. During version skew, older packages keep selecting compatibility;
new core selects the machine only for the frozen constructorless domain.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| M3.30 could close inheritance, `super`, modules, and effectful frames together. | Current owners have no shared lineage/constructor/module frame and each lifecycle has separate ordering rules. | Split a complete constructorless same-root lifecycle and retain an exact M3.31 blocker. |
| Preserving `extendsName` would be enough. | Field initialization, member preflight, use-site recognition, and runtime dispatch all currently use direct class maps. | Introduce one shared immutable lineage owner and use it at every hop. |
| Direct-field purity validation was sufficient. | A derived member may validly read a field declared on a base, and an inherited member executes with a derived receiver. | Validate fields against the member owner's visible lineage and verify receiver ancestry instead of exact class-name equality. |
| Base metadata would be covered automatically once the derived class was selected. | Existing preflight and several lookups read only the direct class or environment map. | Preflight every lineage member/initializer and use only the snapshotted registry after selection. |
| Field/getter precedence across overrides was ambiguous. | KERN semantic validation rejects inherited field/getter kind changes, while the existing direct-class machine contract intentionally keeps field-before-getter precedence. | Reject cross-kind conflicts only in admitted inheritance lineages and preserve the M3.29 standalone behavior. |
| Duplicate inherited fields should reject. | The validator permits same-kind overrides and TS/Python conformance requires derived-field-wins; only source-runner compatibility kept the base value. | Correct compatibility first, then freeze derived-field-wins for machine ownership. |
| Constructorless inheritance was fully specified after the field correction. | The latest Nero exposed owner identity, receiver-lineage visibility, mixed-graph constructor, and async-snapshot gaps. | Freeze whole-lineage snapshots, owner-aware resolution, receiver-lineage field visibility, and graph-level constructor exclusion. |

## Adversarial Record

Nero `nero-1784182248392-mp0ngn-kern-5-r2-m3-30-constructorless-`
returned **FLAWED** at 35% confidence in the original draft. The four concrete
runtime/preflight gaps above are incorporated here. Because the revised
confidence is 0.84, the next gate is a full-roster brainstorm before build.

Full-roster brainstorm
`brainstorm-1784182383593-ynrvb7-kern-5-r2-m3-30-constructorless-`
completed 6/6. Its consensus was **NARROW, then PROCEED** once graph admission
explicitly owns same-root resolution, cycles, field uniqueness, override
kind/arity, direct-registry revalidation, receiver-bound dispatch, whole-lineage
purity, and run-local snapshot isolation. Those requirements are now frozen in
the contract and acceptance criteria above; no OPEN claim remains.

The later tribunal `tribunal-1784182354301-6n7nsq` correctly rejected the
still-present inherited-field rejection claim after finding the source-runner
versus emitted-leg contradiction. The direct probe and validator trace resolve
that contradiction in favor of derived-field-wins. Nero
`nero-1784182774839-vpyj7o-kern-5-m3-30-revised-inheritance` then exposed five
remaining specification gaps; the graph-level constructor rule, outer-only
field initializer domain, receiver-lineage member visibility, owner-aware
resolution, and eager whole-registry snapshot rules above incorporate them.

## Completion Evidence

- Exact `pnpm fitness:kern-5`: PASS on 2026-07-16.
- Cross-target conformance: 432/432; class conformance: 109/109; native KERN:
  233 cases; checker subset: 48/48; self-host validator: 39/39; application
  behavior: 40 fixtures on three legs plus whole-app boot.
- Browser wall: 136 modules, 1,440,946 raw bytes, 314,961 gzip bytes, 57 ms
  cold and 103 ms median browser import plus execute.
- Terminal Agon review: all six usable engines completed. Consensus found zero
  verified defects, three needs-check items, one speculative item, and 19 nits.
  The sole blocking verdict was disproved by linker identity ownership and the
  regression now asserts that exact failure reason. The genuine convergence
  brittleness was replaced by a function-scoped TypeScript AST check. Final
  adjudication also rejects empty base metadata and nested inherited field
  reads against the same admitted snapshot; focused class and convergence
  suites passed after those review fixes.

# KERN 5 R2 M4.3a — Mixed-Parameter Guard and `diag.kern` Migration

**Status:** SEALED
**Date:** 2026-07-18
**Confidence:** 0.97

## Executive Summary

[VERIFIED] M4.2 measures 98 handwritten self-host functions and finds 97
blocked first by the legacy `fn.params` property; the checked-in receipt records
that result and a null tranche winner
(`scripts/kern-canonicalizer/coverage-summary.json`,
`docs/kern-5-release-train.md:851`).

[VERIFIED] The next independently releasable prerequisite is the two-checkpoint
verdict from Agon tribunal
`tribunal-1784394202630-ov5bqb`: reject mixed legacy and structured parameter
declarations everywhere they can be consumed directly, then migrate only the
seven parameterized functions in the 35-line
`examples/capstone-assertion-engine/diag.kern`. Remeasure once and stop whether
the winner remains null or becomes a concrete family.

[REJECTED] This slice does not parse legacy signatures inside the measurement
host, pre-split unrelated KERN modules, migrate a second module, implement a
newly selected tranche, or promote a public ABI/semantic owner.

## Current State / Root Cause

[VERIFIED] Every non-empty `params=` signature in the seven-member M4.2 corpus
uses only `boolean`, `boolean[]`, `number`, `number[]`, `string`, or `string[]`.
The Node 22 parser inventory command over `coverage-policy.json` returned 98
functions, 97 non-empty legacy signatures, zero structured parameter children,
and no type outside that six-type set on 2026-07-18.

[VERIFIED] `diag.kern` contains eight ordered functions. Seven have exactly two
legacy parameters each; `passResult` has none. The file is 35 lines
(`examples/capstone-assertion-engine/diag.kern:1-35`, `wc -l` on 2026-07-18).
Replacing the seven header properties with fourteen ordered child rows yields
49 lines, well below the handwritten-source ceiling.

[VERIFIED] The language already has the desired structured representation.
TypeScript codegen reads direct `param` children before the compatibility
property (`packages/core/src/codegen/type-system.ts:851-875`), Python does the
same (`packages/python/src/codegen-helpers.ts:336-360`), and the source runner
already rejects a non-empty property combined with child parameters
(`packages/core/src/runner-runtime-scope.ts:27-32`). No new type grammar or
runtime binding model is required.

[VERIFIED] The root defect is inconsistent mixed-mode handling. The direct
TypeScript API currently has an executable test proving that children silently
win and the legacy declaration is ignored
(`packages/core/tests/param-value.test.ts:241-255`). Python's direct parameter
builder likewise branches to children without rejecting the property
(`packages/python/src/codegen-helpers.ts:336-354`). Meanwhile nested KERN-body
functions and the source runner already reject mixed mode
(`packages/core/src/codegen/body-ts.ts:2368-2370`,
`packages/core/src/runner-runtime-scope.ts:27-32`).

## What Already Works

- [VERIFIED] Pure legacy signatures remain a compatibility input in both
  TypeScript and Python emitters
  (`packages/core/src/codegen/type-system.ts:870-872`,
  `packages/python/src/codegen-helpers.ts:349-359`).
- [VERIFIED] Pure structured parameters already preserve authored order and
  types through both emitters
  (`packages/core/src/codegen/type-system.ts:866-869`,
  `packages/python/src/codegen-helpers.ts:340-348`).
- [VERIFIED] CLI compilation and `check --with-semantics` already consume
  `validateSemantics`; semantic violations are hard errors
  (`packages/cli/src/shared.ts:579-588`,
  `packages/cli/src/commands/check.ts:226-237`).
- [VERIFIED] Assertion-engine behavior is protected by a read-only capstone
  gate that executes the checked-in KERN engine, rejects stderr/nonzero status,
  and byte-compares every fixture verdict against the TypeScript reference
  (`scripts/check-capstone-assertion-engine.mjs:36-63,76-95,98-144`).
- [VERIFIED] `diag.kern` source bytes are already a hash-bound corpus member
  (`scripts/kern-canonicalizer/coverage-policy.json:20-24`).

## Contract (Verified)

> Verified against the current source tree and Node 22 build on 2026-07-18.

| Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Legacy-only function | Continue accepting non-empty `fn.params` for compatibility outside the migrated module | `packages/core/src/codegen/type-system.ts:870-872`; `packages/python/src/codegen-helpers.ts:349-359` | VERIFIED |
| Structured-only function | Direct `param` children are ordered and authoritative | `packages/core/src/codegen/type-system.ts:866-869`; `packages/python/src/codegen-helpers.ts:340-348` | VERIFIED |
| Mixed function | Reject; never choose one representation silently | Runner precedent at `packages/core/src/runner-runtime-scope.ts:27-32`; body-function precedent at `packages/core/src/codegen/body-ts.ts:2368-2370` | VERIFIED |
| Semantic validation | Emit one stable `mixed-parameter-declarations` rule with source location | `SemanticViolation` shape at `packages/core/src/semantic-validator.ts:59-64`; traversal entry at `:459-465` | VERIFIED |
| Direct TypeScript emitter | Throw before emitting a partial signature | Current branch point at `packages/core/src/codegen/type-system.ts:863-872` | VERIFIED |
| Direct Python emitter | Throw before name mapping or signature emission | Current branch points at `packages/python/src/generators/core.ts:86-100` and `packages/python/src/codegen-helpers.ts:336-354` | VERIFIED |
| Migrated `diag.kern` order | Preserve each ordered `(name,type)` pair and leave bodies/calls/exports/returns unchanged | `examples/capstone-assertion-engine/diag.kern:1-35` | VERIFIED |
| Coverage receipt | Source digest drift rejects before measurement; regenerated receipt must remain byte-canonical and deterministic | `scripts/kern-canonicalizer/coverage-implementation.mjs:411-428`; `scripts/kern-canonicalizer/coverage-summary-writer.mjs:13-42` | VERIFIED |

## Implementation Decision

[VERIFIED] Follow the tribunal's bounded migration, not a normalization seam or
preemptive split (`tribunal-1784394202630-ov5bqb`, 4/4 seats, two rounds):

1. Add RED tests for mixed declarations at semantic, TypeScript-emitter,
   Python-emitter, and coverage/corpus boundaries.
2. Add the semantic rule and fail-closed direct-emitter guards while preserving
   both pure modes.
3. Rewrite only the seven parameterized `diag.kern` signatures into fourteen
   ordered `param name=... type=...` child rows; do not touch bodies or
   `passResult`.
4. Prove the old corpus digest rejects, update only the `diag.kern` manifest
   digest, regenerate the canonical coverage summary, and pin the exact new
   blocker/ranking result.
5. Run focused gates, the complete KERN 5 wall, and a terminal six-engine Agon
   review. Stop after publishing this slice.

The winner is deliberately not preselected. A deterministic non-null winner is
a successful measurement result and a hard stop, not permission to implement
that family in this slice.

## Measured Result

[VERIFIED] The bounded migration changed the leading blocker from 97 to exactly
90 `fn.params` functions while preserving the 98-function, four-tool corpus.
The exact deterministic winner is `binary-expression`: three complete
functions in one tool, 941 corpus occurrences, and witnesses
`diag.kern#4:reasonTypeMismatch`, `diag.kern#5:reasonValueMismatch`, and
`diag.kern#7:reasonKeyMismatch`. The remaining ranking rows all complete zero
functions. This slice records that result and does not implement the family.

[VERIFIED] The source expansion was the predicted fourteen lines: `diag.kern`
is exactly 49 lines, contains fourteen direct `param` nodes across seven
functions, and contains no `fn.params` property. The unchanged parameterless
`passResult` remains the single base-complete function.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/semantic-validator.ts` | Modify | Common mixed-declaration semantic rule |
| `packages/core/src/codegen/type-system.ts` | Modify | Direct TypeScript emitter must fail closed |
| `packages/python/src/codegen-helpers.ts` and/or `generators/core.ts` | Modify | Direct Python consumers must fail closed before precedence |
| focused core/Python tests | Modify/add | RED oracles for mixed and pure modes |
| `examples/capstone-assertion-engine/diag.kern` | Modify | Seven exact structured-signature migrations |
| `scripts/kern-canonicalizer/coverage-policy.json` | Modify | Bind the new `diag.kern` source bytes |
| `scripts/kern-canonicalizer/coverage-summary.json` | Regenerate | Record the honest post-migration measurement |
| `scripts/kern-canonicalizer/coverage*.test.mjs` | Modify | Pin provenance, blocker delta, determinism, and stop condition |
| checker-subset flattener, test, and generated main | Modify | Preserve the existing checker facts for direct structured parameters |
| release train and this spec | Modify | Durable release evidence |

## Acceptance Criteria

- [x] RED first: a top-level `fn` with non-empty `params=` plus at least one
      direct `param` child is currently accepted by `validateSemantics`, the
      TypeScript direct emitter, and the Python direct emitter; new tests prove
      all three failures before production changes.
- [x] `validateSemantics` returns exactly one
      `mixed-parameter-declarations` violation for that function, with its
      source line/column, and no such rule for either pure mode.
- [x] Direct TypeScript and Python parameter emitters throw on mixed mode before
      emitting or mapping any parameter; their legacy-only and structured-only
      tests remain green.
- [x] `diag.kern` has exactly eight functions, seven parameterized functions
      with the tribunal-pinned ordered pairs, `passResult` with zero parameters,
      zero `fn.params` properties, and 49 source lines.
- [x] `pnpm test:capstone-assertion-engine` remains 13/13 byte-identical with
      empty stderr, unchanged fixture ids/order, and no generated artifact diff.
- [x] Before the manifest update, canonicalizer coverage fails specifically on
      the changed `diag.kern` digest; only that corpus digest is then changed.
- [x] The regenerated receipt still has exactly 98 functions and four tools;
      the `fn.params` blocker count changes from 97 to exactly 90; the seven
      migrated witnesses do not carry `fn.params`; every other corpus witness
      retains its prior legacy-parameter classification.
- [x] The full ranking and winner are asserted exactly from the deterministic
      post-migration receipt. If the winner is non-null, no production
      canonicalizer or ownership file changes in this slice.
- [x] `diag.kern` remains below the 500-line handwritten-source ceiling. The
      observed 14-lines-for-seven-functions expansion is recorded as evidence
      for deciding whether a later module must split first.
- [x] Focused typecheck/tests pass. The exact receipt-bound Node 22
      `pnpm fitness:kern-5` wall passed after review-driven guard
      centralization with `KERN 5 current fitness wall passed.`
- [x] Terminal full-roster Agon review passes with no unresolved material
      finding. All six usable engines completed
      (`review-1784406342479-xc3w91-kern-5-r2-m4-3a-terminal-r4`) with zero
      verified findings; five needs-checks were rejected against the bound
      winner schema, shared pre-fallback guard, fn-only checker fact profile,
      semantic location owner, and direct-runtime boundary contract.

## Out of Scope

- Migrating the remaining 90 legacy functions or any second corpus module.
- Splitting `checker.kern`, `canonicalizer.kern`, or `validator.kern`.
- A host-side parser/normalizer for legacy parameter text.
- Removing the legacy parameter compatibility path globally.
- Implementing a measured tranche winner.
- Public KIR/runtime ABI or semantic-ownership promotion.

## Open Questions

None blocks implementation. The exact post-migration winner is an output of the
existing deterministic oracle, not an input decision.

## Deploy Order

[VERIFIED] This commit is stacked after M4.2 because it modifies the measurement
contract introduced there. In the monorepo there is no supported skewed deploy:
the semantic guard, source migration, corpus digest, receipt, tests, and docs
ship atomically. If M4.2 lands first, rebase this slice onto `origin/main` before
pushing; if it remains unmerged, keep the same stacked feature branch.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| A normalization seam might avoid source churn | It would move signature semantics into the host evidence path and weaken the M4.2 trust boundary | Rejected |
| The large modules should split before any migration | `diag.kern` is 35 lines and reaches only 49 lines after its complete migration | Split deferred until measured expansion requires it |
| `checker.kern` is the smallest useful first module | `diag.kern` is far smaller and has only fourteen simple parameters across seven functions | Exact scope narrowed to `diag.kern` |
| The guard should invent a `KERN-E-*` code | This repository's common semantic contract exposes stable rule names through `SemanticViolation` | Use `mixed-parameter-declarations` plus emitter errors |
| The checker-subset generated fixture would remain byte-stable | Its adapter encoded parameter facts only from legacy `fn.params` and walked direct `param` children as ordinary statements | Add a fail-closed structured-parameter adapter and regenerate the bound fixture |
| The shared mixed-declaration guard only needed to recognize `fn` | `emitParamList`, Python codegen, semantic member analysis, and the core runtime consume parameters for other callable nodes; the `fn` gate left TS/Python behavior divergent and runtime binding ambiguous | Make the predicate representation-based for every callable consumer, add non-`fn` and runtime RED regressions, and use the shared guard in core runtime |
| The exact winner assertion could run before both check and write modes | A future measured winner change would make the receipt regeneration command fail before it could write the new canonical result | Keep the exact winner assertion in check mode; allow `--write` to regenerate, while the receipt test independently pins the checked-in winner |
| Successful write mode could always print `winner.id` | A valid null-winner measurement would write its receipt, then throw while formatting status and exit nonzero | Add a null-safe formatter with a RED null-winner test and bind it into the coverage implementation receipt |
| Package-boundary consumers could safely duplicate the mixed-declaration predicate and message | The third terminal review independently identified silent drift risk in both the Python emitter and checker adapter | Export the core guard, consume it from Python and the built-core checker seam, add a RED export-contract test, and regenerate the compiled-core-bound receipt |

# KERN 5 R2 M4.7 — Targeted `checker-while.kern` Structured Parameters

**Status:** SEALED
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED BASELINE] The immutable M4.6 main commit
`f8f684fc18b49c0679a0faec2b506490e49fc17c` records nine of 104 corpus
functions base-complete, 93 functions blocked by the excluded legacy
`fn.params` property, all eight remaining candidate families at zero
completions, and an authenticated `null` winner. Those values are the
pre-M4.7 baseline, not claims about the current mutable tree.

[VERIFIED] Exact read-only in-memory migration measurement ranked every
remaining corpus module. Migrating only `isDecimalDigit`, `isLiteralKind`, and
`literalToken` in `examples/capstone-checker-subset/checker-while.kern` changes
five parameter rows and completes exactly three functions. Migrating all 18
functions and 126 parameters in that module produces the identical three
completions. Full-roster Agon brainstorm
`brainstorm-1784569913694-o3p3tj-kern-5-r2-m4-7-parameter-scope` selected the
three-function boundary unanimously, 6/6.

## Current State / Root Cause

[VERIFIED BASELINE] At M4.6 commit `f8f684fc`, `checker-while.kern` is 251 lines
and contains 18 legacy-signature functions. The three selected functions are
individually blocked only by `fn.params`; their baseline projected rows and
exact migrated rows are:

| Function | Params | Current rows | Migrated rows | New blockers |
|---|---:|---:|---:|---|
| `isDecimalDigit` | 1 | 7/8/40 | 8/10/43 | none |
| `isLiteralKind` | 1 | 3/4/64 | 4/6/67 | none |
| `literalToken` | 3 | 7/8/40 | 10/14/49 | none |

[VERIFIED] The language invariant is per-function parameter-form consistency.
A function may use legacy signature text or ordered direct `param` children;
mixing both forms inside one function fails closed. Sibling functions in one
module may use different internally consistent forms. Therefore a deliberate
3-direct/15-legacy module is a stable language state, not an incomplete syntax
transition.

[VERIFIED CURRENT] The implemented M4.7 tree has a 256-line source with 18
functions: the three selected functions use ordered direct `param` children
and the other 15 retain internally consistent legacy signatures. Its current
authenticated receipt records 12/104 base completions, 90 `fn.params`
blockers, eight zero-completion candidate families, and a `null` winner.

## Options Measured

| Scope | Functions | Parameters | New completions | Decision |
|---|---:|---:|---:|---|
| Three exact `checker-while.kern` functions | 3 | 5 | 3 | Select |
| Entire `checker-while.kern` module | 18 | 126 | 3 | Reject: 121 extra rows, zero gain |
| Entire `checker.kern` module | 24 | 259 | 4 | Reject: exceeds 500 handwritten lines |
| Entire `validator.kern` module | 21 | 134 | 3 | Reject: worsens an oversized file |
| Canonicalizer expression helpers | 16 | 34 | 1 | Reject: composition/evidence blast radius |

## Contract (Verified)

| Behavior | Contract | Tag |
|---|---|---|
| Exact source scope | Rewrite only the signatures of `isDecimalDigit`, `isLiteralKind`, and `literalToken` | VERIFIED |
| Parameter order | `(ch:string)`, `(kind:string)`, `(kind:string,name:string,num:string)` | VERIFIED |
| Source isolation | The other 15 functions and all target bodies, calls, returns, and exports remain byte-equivalent | VERIFIED |
| Mixed-module validity | Three direct-form functions coexist with 15 legacy-form sibling functions | VERIFIED |
| Runtime behavior | Checker-subset output remains byte-identical for 48 fixtures and rejects all 36 hostile attempts | VERIFIED |
| Coverage result | Base completion becomes 12/104 and `fn.params` blockers become 90 | VERIFIED |
| Selection result | All eight candidate-family rows remain zero and winner remains `null` | VERIFIED |
| Frozen evidence | Canonicalizer composition, profile, schema, registry, and three promotion provenance records remain unchanged | VERIFIED |

## Implementation Plan

1. Add RED assertions for the exact 256-line source shape, three function IDs,
   five ordered direct parameters, 15 remaining legacy sibling functions,
   exact post-migration profile rows, 12 base completions, 90 `fn.params`
   blockers, and a null winner.
2. Prove RED fails on the unchanged 251-line source.
3. Rewrite only the three selected headers and insert five direct `param`
   children. Preserve every other source byte.
4. Prove the old authenticated corpus digest rejects specifically on
   `checker-while.kern`, update only that policy digest, regenerate the
   checker-subset composed fixture through its repository generator, and write
   the authenticated coverage summary.
5. Run focused checker/canonicalizer gates, the complete Node 22
   `pnpm fitness:kern-5` wall, and terminal six-engine Agon review. Stop before
   migrating a fourth function or promoting a family.

## Expected Blast Radius

| File | Action |
|---|---|
| `examples/capstone-checker-subset/checker-while.kern` | Modify three signatures |
| `examples/capstone-checker-subset/main.kern` | Regenerate composed checker fixture |
| `scripts/kern-canonicalizer/coverage.test.mjs` | Add RED and exact receipt assertions |
| `scripts/kern-canonicalizer/coverage-policy.json` | Update only the changed corpus digest |
| `scripts/kern-canonicalizer/coverage-summary.json` | Regenerate authenticated receipt |
| `scripts/check-kern-canonicalizer-coverage.mjs` | Pin live M4.7 totals |
| `scripts/kern-canonicalizer/coverage-handoff.test.mjs` | Pin current total against frozen provenance |
| `docs/kern-5-release-train.md` | Record the intentional partial-module boundary |
| this spec | Seal measured results and gate evidence |

## Acceptance Criteria

- [x] RED failed on the unchanged 251-line legacy source (`251 !== 256`) before
      implementation.
- [x] The migrated source is exactly 256 lines and contains 18 functions: three
      exact direct-form targets, five direct `param` nodes, and 15 legacy-form
      siblings with zero intra-function mixed forms.
- [x] Target parameter names, types, and order match the contract; all
      non-signature source remains unchanged.
- [x] The old policy digest failed specifically on `checker-while.kern` before
      only that corpus digest is updated.
- [x] Authenticated coverage is exactly 12/104 with exactly 90 `fn.params`
      blockers; target rows are exactly 8/10/43, 4/6/67, and 10/14/49.
- [x] All eight candidate families remain at zero completions and the winner is
      `null`; corpus/tool/function counts remain 9/4/104.
- [x] Canonicalizer composition, profile, schema, family registry, executable,
      and immutable promotion provenance remain unchanged.
- [x] Checker-subset parity remains 48/48 with all 36 hostile attempts rejected.
- [x] Focused tests and `pnpm fitness:kern-5` pass on the exact implementation
      tree.
- [x] Terminal full-roster Agon review passes with no unresolved material
      finding.

## Measured Result

[VERIFIED] The source-only edit failed the old authenticated policy exactly with
`corpus member examples/capstone-checker-subset/checker-while.kern digest drift`.
The migrated source SHA-256 is
`07f17a96fc27cb8f9926537d6d9900395c2b9286eb66f8addd499bc2f1ed459a`.

[VERIFIED] Repository generators produced checker fixture SHA-256
`8be9515001f68dc8446f91282cd1ca5cdd0f31c59d765ddcf815df1d39dbdced`
and an authenticated receipt with 12/104 base completions, 90 legacy blockers,
the three exact target profiles, eight zero-completion family rows, and a null
winner. No canonicalizer member or frozen promotion record changed.

[VERIFIED] Focused coverage passed 18/18 tests, the checker adapter passed 3/3,
and checker behavior remained 48/48 byte-identical with all 36 hostile attempts
rejected. The complete Node 22 `pnpm fitness:kern-5` wall passed repository
consistency, lint, build, all workspace and infrastructure tests, 432
cross-target fixtures, 109 class fixtures, 233 native assertions at 100%
coverage, 13 assertion-engine fixtures, 48 checker-subset fixtures, 39 validator
verdicts, 40 whole-app fixtures on three legs, browser budget, KIR/runtime
guards, source-runner convergence, and repeated canonicalizer evidence.

[VERIFIED] Initial review
`review-1784571949656-g95nh2-kern-5-r2-m4-7-terminal-boundary` completed 6/6
engines and correctly identified that the spec presented M4.6 baseline facts as
current mutable-tree facts. The baseline is now explicitly bound to immutable
commit `f8f684fc`, current M4.7 facts are stated separately, target names are
single-sourced in the structural test, legacy-param absence is strict, and the
compact gate directly pins the 90-blocker summary row. The post-fix focused
gate passed all 67 structural/integrity tests plus 21 golden, seven measured,
three profile-limit, and 140 hostile fixtures.

[VERIFIED] Final post-fix review
`review-1784572635152-mw47un-kern-5-r2-m4-7-final-postfix` completed all six
usable engines with zero verified and zero speculative findings. Its one
needs-check item is resolved by the exhaustive source partition: the three
targets strictly omit legacy params, the 15 siblings strictly omit direct
params, and those sets total all 18 roots. The exact 256-line pin deliberately
authenticates this migration's source-isolation and generated line receipts.
Five remaining nits are non-material wording or future-maintenance suggestions.
This post-review sealing metadata is intentionally not represented as input to
its own review.

## Stop Conditions

- Completion gain is not exactly three or blocker reduction is not exactly
  three functions.
- Any non-target source bytes change, a fourth function must migrate, or any
  function mixes legacy and direct parameter forms.
- Any candidate family becomes selectable or any previously complete function
  regresses.
- Canonicalizer composition or frozen promotion evidence changes.
- The source crosses 500 lines or generated evidence requires manual editing.

## Out of Scope

- Migrating the other 15 `checker-while.kern` functions.
- Migrating another corpus module.
- Removing global legacy-parameter compatibility.
- Changing parser, checker, runtime, canonicalizer, schema, profile limits, or
  candidate-family definitions.
- Selecting, implementing, or promoting a canonicalizer family.

## Deploy Order

[VERIFIED] Source, generated fixture, corpus digest, authenticated receipt,
tests, spec, and release evidence ship together after one fetch/rebase and one
feature push. No skewed deployment is supported.

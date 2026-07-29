# KERN 5 R2 M4.125 — Four-Function Residual Analysis

**Status:** IMPLEMENTED AND VERIFIED
**Date:** 2026-07-29
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.124 commit
`044cf2936bb36f3647bac2e4bf1aa571866ad3ca` consumes the exact M4.123
`rejectLine` queue and advances the cumulative base to 103/112. Published
review-fix commit `b2a722f43092ed16eeff45600dd8638fc53d4e05` removes its unused
whole-source pin and is the exact M4.125 measurement input.

[VERIFIED] The remaining legacy-parameter frontier is exactly four functions:
`quotesource`, `expressionsources`, `canonicalize`, and `validate`. None exposes
authenticated profile rows at the current projection boundary, so no profile
widening can be evaluated or selected.

[DECIDED] M4.125 publishes a canonical, fail-closed residual-analysis receipt
that freezes this bounded no-action result. M4.126 owns projection and
canonical-surface blocker analysis.

## Contract

| Behavior | Tag |
|---|---|
| Bind the exact published M4.124 commit and current semantic baseline | DECIDED |
| Analyze exactly four legacy-parameter functions | VERIFIED |
| Preserve reason-assignment digest `d56df2cc…c481` | VERIFIED |
| Record zero profile-row-available functions | VERIFIED |
| Evaluate zero observed profile settings | VERIFIED |
| Publish no actionable candidates and no selected action | VERIFIED |
| Keep KIR, runtime, profile, ABI, corpus, and source semantics unchanged | DECIDED |
| Hand the four-function projection frontier to M4.126 | DECIDED |

## Exact Frontier

1. `canonicalizer-expression-helpers.kern#5:quotesource`
   - two parameter rows
   - text-character and projection-depth blockers
2. `canonicalizer.kern#3:expressionsources`
   - six parameter rows
   - unknown-expression-kind blockers
3. `canonicalizer.kern#5:canonicalize`
   - fifteen parameter rows
   - unknown-expression-kind blockers
4. `validator.kern#20:validate`
   - forty-one parameter rows
   - projection node-limit blocker

## Implementation

1. Add a RED M4.125 test importing the absent residual-analysis owner.
2. Measure the current M4.124 frontier through authenticated coverage and
   canonicalizer policy inputs.
3. Freeze exact baseline facts, assignments, deterministic ranking rules, and
   the bounded no-action outcome in a canonical JSON receipt.
4. Add an isolated status formatter and central assertion without growing the
   already-498-line shared status module.
5. Integrate M4.125 into the canonical coverage gate and preserve all historical
   M4.120–M4.124 receipts.
6. Regenerate derived summaries twice, run focused and full KERN 5 gates, run
   high-risk role-lens review, commit with Agon identity, fetch/rebase, and push
   once to `main`.

## Acceptance Criteria

- [x] RED proves the M4.125 owner is absent before implementation.
- [x] Receipt binds base 103/112 and exactly four legacy blockers.
- [x] Receipt assignment digest is exactly `d56df2cc…c481`.
- [x] Every residual function retains its exact authenticated reasons.
- [x] Profile-row-available and evaluated-setting counts are both zero.
- [x] Actionable candidates are empty and selected action is `null`.
- [x] Canonical bytes, plain-data shape, symlink rejection, mutation rejection,
      and fresh-process reproducibility are tested.
- [x] M4.120 and the M4.121–M4.124 chain remain immutable.
- [x] No KIR, runtime, profile, ABI, corpus, or source semantic policy changes.
- [x] Derived summaries converge byte-identically.
- [x] Focused, canonicalizer, and full KERN 5 gates pass.
- [x] High-risk automatic role-lens review has no unresolved material finding.
- [x] Signed commit is fetched/rebased before one push and remote main verifies.

## Stop Conditions

- The current frontier is not exactly 103/112 with four legacy blockers.
- The reason-assignment digest differs from the authenticated M4.124 handoff.
- Any function exposes profile rows or produces an actionable profile candidate.
- Publishing the receipt requires changing source semantics or any policy limit.

## Out of Scope

- Resolving projection depth/node limits or unknown expression kinds.
- Changing `quotesource` character policy.
- Parameter migration, runtime optimization, or policy promotion.
- M4.126 projection analysis, KIR v1 freeze, runtime cutover, RC/stable release,
  Fable, or KERN 5 completion.

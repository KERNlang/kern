# KERN 5 R2 M4.6 — `sort.kern` Structured Parameters

**Status:** VERIFIED
**Date:** 2026-07-20
**Confidence:** 0.95

## Executive Summary

[VERIFIED] M4.5c leaves eight of 104 corpus functions base-complete and all eight
remaining single-family candidates at zero completions. The leading blocker is
the deliberately excluded legacy `fn.params` property on all 96 incomplete
functions (`scripts/kern-canonicalizer/coverage-summary.json:65-70,163-228`).

[VERIFIED] A read-only exhaustive measurement of all 255 non-empty combinations
of the eight remaining candidate families also completed zero functions on
2026-07-20. A multi-family selector would therefore only formalize a forced
null result. The corrected six-engine Agon brainstorm
`brainstorm-1784566212986-7ygt4o-kern-5-r2-m4-6-structured-parame` unanimously
selected the smallest complete-module prerequisite: migrate only the three
functions in `examples/capstone-assertion-engine/sort.kern` from legacy
signature text to the language's existing ordered direct `param` children,
then remeasure once without preselecting a family.

## Current State / Root Cause

[VERIFIED] `sort.kern` is 46 lines and contains exactly three legacy signatures:
one parameter for `halfFloor`, five ordered parameters for `mergeStrings`, and
one parameter for `sortStrings` (`examples/capstone-assertion-engine/sort.kern:1-46`).
The migration adds exactly seven child rows, producing a 53-line file below the
500-line handwritten-source ceiling.

[VERIFIED] The current authenticated receipt admits direct `param` nodes in the
base profile but records `fn.params` as a property and excluded-host-type blocker
(`scripts/kern-canonicalizer/coverage-summary.json:14-20,36-63,65-70`). The
existing deterministic coverage test pins 96 legacy blockers, eight base
completions, and a null single-family winner
(`scripts/kern-canonicalizer/coverage.test.mjs:146-178`).

[VERIFIED] Read-only pre-migration measurement produced these exact profile rows:

| Function | Nodes | Properties | Values | Relevant current blockers |
|---|---:|---:|---:|---|
| `halfFloor` | 5 | 7 | 50 | `fn.params` only |
| `mergeStrings` | 24 | 34 | 475 | `fn.params` plus all three row limits |
| `sortStrings` | 15 | 27 | 193 | `fn.params` plus value-row limit |

The post-migration result is deliberately not predicted: structured children
change row counts, so the actual source must be remeasured.

## What Already Works

- [VERIFIED] Pure structured parameters preserve authored order and types in
  current KERN consumers; `diag.kern` already uses the exact intended shape
  (`examples/capstone-assertion-engine/diag.kern:1-49`).
- [VERIFIED] Mixed legacy/structured declarations already fail closed, and pure
  legacy declarations remain supported outside this bounded migration; M4.3a
  sealed those guards (`.Codex/specs/kern-5-r2-m4-3a-diag-structured-parameters/spec.md:65-108,159-180`).
- [VERIFIED] The assertion-engine gate executes the checked-in KERN engine and
  byte-compares every result against the TypeScript assertion core
  (`scripts/check-capstone-assertion-engine.mjs:3-16,58-146`). No new runtime or
  parity harness is required.
- [VERIFIED] The coverage policy already hash-binds `sort.kern` as handwritten
  assertion-engine corpus input
  (`scripts/kern-canonicalizer/coverage-policy.json:40-47`).

## Contract (Verified)

> Verified against the current tree and Node 22 evidence on 2026-07-20.

| Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Migration scope | Rewrite all and only the three `sort.kern` signatures | `examples/capstone-assertion-engine/sort.kern:1-46` | VERIFIED |
| Parameter order | `halfFloor(n)`; `mergeStrings(left,i,right,j,acc)`; `sortStrings(xs)` | `examples/capstone-assertion-engine/sort.kern:1,7,32` | VERIFIED |
| Source preservation | Bodies, exports, returns, call sites, and authored order remain byte-equivalent outside signature rows | `examples/capstone-assertion-engine/sort.kern:1-46` | VERIFIED |
| Runtime behavior | All assertion-engine fixtures remain byte-identical to the TypeScript reference with empty stderr | `scripts/check-capstone-assertion-engine.mjs:58-146` | VERIFIED |
| Corpus authentication | Old source digest rejects before policy update; only the `sort.kern` corpus digest changes | `scripts/kern-canonicalizer/coverage-policy.json:40-47`; `scripts/kern-canonicalizer/coverage-implementation.mjs:124-140,392` | VERIFIED |
| Remeasurement | Preserve 104 functions, nine members, four tools, base profile, candidate registry, and immutable promotion provenance | `scripts/kern-canonicalizer/coverage.test.mjs:54-178` | VERIFIED |
| Selection | Record the exact post-migration base count and ranking; do not preselect or implement a family | `scripts/kern-canonicalizer/coverage-summary.json:163-228` | VERIFIED |

## Implementation Decision

There is one real option: migrate `sort.kern`. It is the smallest full module,
has the fewest parameters, stays far below the line ceiling, and provides the
cleanest expected completion signal. Larger modules add risk without resolving
any prerequisite that this bounded slice needs to validate first.

1. Add RED assertions that require the three exact structured signatures, seven
   ordered direct `param` children, zero `sort.kern` `fn.params` blockers, the
   honest post-migration totals, and exact ranking output.
2. Prove those assertions fail on the unchanged legacy source.
3. Rewrite only the three function headers and add the seven direct children.
4. Prove the old corpus digest rejects, update only the `sort.kern` digest,
   regenerate generated checker evidence if source-derived bytes change, and
   write the canonical coverage summary.
5. Run focused gates, the complete `pnpm fitness:kern-5` wall, and terminal
   six-engine `agon review`. Stop before a second migration or capability.

## Measured Result

[VERIFIED] RED failed first on the unchanged 46-line legacy module (`46 !== 53`).
After the source edit, the old policy failed specifically with
`corpus member examples/capstone-assertion-engine/sort.kern digest drift`.
The migrated source SHA-256 is
`c0bb7e664cfa0886df2e1183e87dfd3942e4348d0765dff467b92f3164cc4728`.

[VERIFIED] The regenerated receipt records nine of 104 functions base-complete,
93 `fn.params` blockers, and a null winner because every remaining candidate
still completes zero functions. Immutable binary, conditional, and call
promotion provenance remains unchanged. Exact post-migration profile rows are:

| Function | Nodes | Properties | Values | Profile blockers |
|---|---:|---:|---:|---|
| `halfFloor` | 6 | 9 | 53 | none |
| `mergeStrings` | 29 | 44 | 493 | nodes, properties, values |
| `sortStrings` | 16 | 29 | 197 | values |

[VERIFIED] The complete canonicalizer gate passed 67/67 tests. Assertion-engine
behavior remains 13/13 byte-identical to its TypeScript reference, and the
regenerated checker fixture remains 48/48 byte-identical with all 36 hostile
attempts rejected.

[VERIFIED] The exact tree passed the complete Node 22 `pnpm fitness:kern-5`
wall, including repository consistency, lint, build, all workspace and
infrastructure tests, 432 cross-target fixtures, 109 class fixtures, 233 native
assertions, 48 checker-subset fixtures, 39 validator verdicts, 40 whole-app
fixtures on three legs, browser budget, KIR and runtime guards, source-runner
convergence, and repeated canonicalizer evidence.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `examples/capstone-assertion-engine/sort.kern` | Modify | Three exact structured-signature migrations |
| `scripts/kern-canonicalizer/coverage.test.mjs` | Modify | RED oracle and exact measured result |
| `scripts/kern-canonicalizer/coverage-policy.json` | Modify | Bind the migrated source bytes |
| `scripts/kern-canonicalizer/coverage-summary.json` | Regenerate | Authenticated post-migration receipt |
| `examples/capstone-checker-subset/main.kern` | Regenerate if changed | Source-derived structural checker fixture |
| `docs/kern-5-release-train.md` | Modify | Durable M4.6 decision and evidence |
| this spec | Modify | Seal observed results and gate evidence |

## Acceptance Criteria

- [x] RED first: the unchanged legacy source fails the new exact `sort.kern`
      structured-signature and post-migration coverage assertions.
- [x] `sort.kern` contains exactly three `fn` roots, seven direct `param`
      children, zero non-empty `fn.params` properties, and exactly 53 lines.
- [x] Ordered `(name,type)` pairs are exactly `[(n,number)]`,
      `[(left,string[]),(i,number),(right,string[]),(j,number),(acc,string[])]`,
      and `[(xs,string[])]`; all non-signature source remains unchanged.
- [x] The old authenticated corpus digest fails specifically on `sort.kern`
      before the policy digest is updated; no other corpus digest changes.
- [x] `pnpm test:capstone-assertion-engine` remains 13/13 byte-identical with
      empty stderr, proving runtime behavior and call arity/order preservation.
- [x] The regenerated receipt retains nine corpus members, 104 functions, four
      tools, profile `kern.kir-canonicalizer.profile.m4.5c`, and the immutable
      binary/conditional/call promotion provenance chain.
- [x] Exact post-migration node/property/value profiles for all three functions,
      legacy blocker count, base-complete count, every candidate ranking row,
      and winner-or-null are pinned from observed facts, not forecasts.
- [x] No canonicalizer source, runtime, schema, family registry, promotion
      provenance, or second corpus module changes.
- [x] Focused tests and `pnpm fitness:kern-5` pass on the exact tree.
- [x] Terminal automatic-risk Agon review `review-1784568300383-ovva7y`
      completed 2/2 independent reviewers with no findings.

## Out of Scope

- A multi-family selector or report schema.
- Migrating any module other than `sort.kern`.
- Parsing legacy signatures inside the measurement host.
- Implementing or promoting any candidate family selected after remeasurement.
- Removing legacy parameter compatibility globally.
- Runtime, parser, schema, ABI, or semantic-ownership changes.

## Open Questions

None. The exact post-migration measurement is an output, not a design input.

## Deploy Order

[VERIFIED] This monorepo slice ships atomically: migrated source, any regenerated
fixture, corpus digest, receipt, tests, spec, and release evidence land in one
commit. Rebase the complete feature on `origin/main` before its single push;
there is no supported skewed deployment.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| M4.6 should rank multi-family tranches | All 255 family combinations complete zero functions because every incomplete function first carries excluded `fn.params` | Reject the selector and remove a prerequisite blocker first |
| Remaining-family residual sets alone describe completion | Excluded properties and profile/projection blockers also participate in completion | Remeasure actual migrated source; never infer completion from families alone |
| A larger checker module might maximize yield | `sort.kern` is the smallest full-module boundary and already has one function blocked only by legacy parameters | Choose the lower-risk serial slice unanimously recommended by the corrected panel |

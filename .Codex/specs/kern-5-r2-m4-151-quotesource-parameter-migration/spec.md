# KERN 5 R2 M4.151 Quotesource Parameter Migration

**Status:** VERIFIED — READY TO PUBLISH
**Date:** 2026-08-03
**Confidence:** 0.99

## Executive Summary

M4.151 consumes the exact one-function/two-row `quotesource` queue published
by M4.150. It replaces only the legacy quoted `fn.params` property with two
ordered direct `param` children, advances canonicalizer coverage from 111/112
to 112/112, and publishes a truthful terminal `complete` prerequisite state.
The terminal state uses prerequisite summary format 4 because format 3 is a
closed contract whose `parameter-ready` outcome requires a non-empty queue.

## Current State / Root Cause

- **VERIFIED:** `origin/main` is M4.150 commit
  `5d4703309a5c96276da04d4d35a1ec257a584b12`; no M4.151 implementation is
  present. Evidence: `git fetch origin && git rev-parse origin/main` and
  `rg -n "M4\.151" .Codex scripts examples docs`, 2026-08-03.
- **VERIFIED:** M4.150 publishes exactly one migration witness,
  `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource`,
  with two parameter rows and profile rows 54/82/932, and selects M4.151 to
  consume it. Evidence:
  `scripts/kern-canonicalizer/quotesource-rewrite-m4-150.mjs:94-116`.
- **VERIFIED:** the live function still carries
  `params="value:string,validated:boolean"`, has no direct parameters, is
  exported at function ordinal 5, returns `string`, and has semantic body
  digest `5de221c8033b585c8c128def0e3e70cad565be00bd54a493f800e905ab9deb73`.
  Evidence:
  `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern:57-58`
  and the Node parser/`semanticBodyDigest` measurement run on 2026-08-03.
- **VERIFIED:** current coverage is 111/112 with exactly one `fn.params`
  blocker and the live prerequisite outcome is `parameter-ready`. Evidence:
  `scripts/kern-canonicalizer/coverage-summary.json:1-185` and
  `scripts/kern-canonicalizer/coverage-prerequisite-summary.json:1-86`.
- **VERIFIED:** after the last legacy signature is migrated, the producer's
  `migrated`, `parameterReady`, and `residual` sets are all empty. The current
  zero-residual branch still emits `parameter-ready`, while its validator
  requires `completeFunctions > 0`; therefore an honest post-migration summary
  is rejected. Evidence:
  `scripts/kern-canonicalizer/coverage-prerequisite.mjs:358-367,422-438`.
- **VERIFIED:** format 3 is explicitly checked by every current summary
  consumer, while historical prerequisite receipts have milestone-local
  validators. Evidence:
  `scripts/kern-canonicalizer/coverage-current.mjs:92-132`,
  `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs:34-128`, and
  `scripts/kern-canonicalizer/coverage-prerequisite-m4-*.mjs`.

## What Already Works

- M4.150 already authenticates the exact input commit, source rewrite,
  composition, candidate predicate, and terminal queue; M4.151 consumes that
  evidence rather than reselecting parameters.
- The generic direct-parameter guards already freeze ordered parameter
  children, function identity, body semantics, profile rows, and function
  facts. Evidence:
  `scripts/kern-canonicalizer/coverage-value-band-parameter-migrations.mjs:140-179`
  and `scripts/kern-canonicalizer/coverage-m4-147-parameter-migration.mjs:34-89`.
- Coverage measurement already counts direct parameters as admitted KIR. No
  profile, KIR, runtime, family, capability, handler, or package policy needs
  widening.
- Historical source reconstruction already supports ordered reversible source
  replacements. M4.151 adds one predecessor layer before the existing M4.150
  predicate layer; immutable earlier receipts remain unchanged.

## Contract (Verified)

> Verified against `origin/main` `5d470330` on 2026-08-03.

| Field / Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Input handoff | exact M4.150 record and one-function/two-row queue | `quotesource-rewrite-m4-150.mjs:94-116` | VERIFIED |
| Source owner | expression helpers, function ordinal 5, `quotesource` | `canonicalizer-expression-helpers.kern:57-58` | VERIFIED |
| Parameters | ordered `value:string`, `validated:boolean` direct children | live legacy signature plus M4.150 queue | VERIFIED |
| Stable function | exported, returns `string`, semantic body digest `5de221...b73` | parser measurement, 2026-08-03 | VERIFIED |
| Stable profile | rows 54/82/932 under unchanged active limits | M4.150 witness | VERIFIED |
| Coverage exit | 112/112, zero `fn.params` blockers | current 111/112 plus exact sole migration | VERIFIED |
| Queue exit | exact empty migration row: 0 functions/tools/rows/witnesses | terminal measurement contract | VERIFIED |
| Prerequisite exit | format 4, outcome `complete`, null selection/exhaustion, empty rankings/queue | producer/validator contract below | VERIFIED |

### Producer and consumers

| Surface | Role | Required M4.151 behavior | Tag |
|---|---|---|---|
| `coverage-prerequisite.mjs` | producer and validator | emit/accept `complete` iff the base covers every function and legacy blockers plus queue are exactly zero | VERIFIED |
| `coverage-prerequisite-structure.mjs` | checked-in receipt validator | consume format 4 through the shared exact validator | VERIFIED |
| `coverage-current.mjs` | live frontier owner | require 112/112, format 4, `complete`, and the exact empty queue | VERIFIED |
| `check-kern-canonicalizer-coverage.mjs` | release wall | retain M4.150 history and append exact M4.151 completion status | VERIFIED |
| M4.148-M4.150 owners | historical consumers | measure exact pre-M4.151 expression-helper and policy bytes | VERIFIED |
| historical composition/runtime owners | historical consumers | reverse direct parameters before the M4.150 predicate replacement | VERIFIED |

## Implementation Option

There is one coherent option: atomically migrate the exact queue, introduce
format 4 with a closed `complete` outcome, layer authenticated predecessor
reconstruction, and regenerate current evidence. Keeping format 3 would claim
compatibility while existing format-3 validators reject `complete`; retaining
an empty `parameter-ready` state would violate its non-empty-queue invariant.

## Blast Radius

| File / group | Action | Reason |
|---|---|---|
| this spec | add | durable cross-session contract |
| expression-helper KERN source + composed source | modify/regenerate | exact two-parameter migration |
| M4.151 target, migration, status, and tests | add | RED oracle and exact terminal handoff |
| prerequisite producer/validator + current consumers | modify | format-4 `complete` contract |
| M4.150 target/central/status tests | modify | authenticate immutable predecessor after successor source exists |
| historical composition/policy/runtime loaders | modify | reverse M4.151 before older reconstruction layers |
| coverage policy and current summaries | regenerate | bind current source and implementation graph |
| runtime, handler ABI, limits, packages, public API | unchanged | outside this migration slice |

## Acceptance Criteria

- [x] RED fails on M4.150 because `quotesource` still exposes legacy
      `fn.params` and lacks the two direct parameter children.
- [x] M4.151 accepts only the exact M4.150 digest/input commit, queue, source
      identity, predicate, and selected action.
- [x] Only the `quotesource` signature changes: exact ordered direct parameters
      `value:string`, `validated:boolean`; name/export/return/body remain exact.
- [x] Reversing the signature change reproduces M4.150 expression-helper
      digest `2073ed0c915c0375a43accc202e1c99ceacef84ec1972ef2fc6d25ebcdf7986a`.
- [x] Live coverage is 112/112 across 112 functions with no blocker rows and no
      `fn.params` fact.
- [x] Format 4 `complete` requires base-complete count equal to function count,
      zero legacy blockers, exact empty migration queue, null
      exhaustion/selection/minimum, and empty rankings.
- [x] `complete` rejects decorated/non-plain data, any witness/count, any
      blocker, incomplete base, selection, ranking, or exhaustion drift.
- [x] Current composition, coverage policy, coverage summary, and prerequisite
      summary reproduce exactly from live source.
- [x] M4.148, M4.149, and M4.150 evidence remains reproducible and immutable
      through authenticated pre-M4.151 reconstruction.
- [x] No profile/KIR/runtime limit, capability, handler ABI, package version,
      public API, or function-body semantic changes.
- [x] Focused tests, `pnpm test:kern-canonicalizer`, and
      `pnpm fitness:kern-5` pass on Node 22.
- [x] Full-roster `agon review` reports no unresolved source-verified blocker.
- [ ] The Agon-signed commit is fetched/rebased onto current `origin/main`,
      pushed once, and remote `main` equals the local SHA.

## Out of Scope

- KIR v1 public promotion, formatter/frontend/compiler implementation,
  fixed-point bootstrap, interpreter cutover, RC/public release, or Fable.
- Any new canonicalizer family or resource-limit widening.
- Declaring the full KERN 5 objective complete.

## Open Questions

None. There are no ASSUMED or OPEN claims in the selected path.

## Deploy Order

Source migration, format-4 producer/validator, current consumers, historical
reconstruction, composition, policy, and summaries ship in one commit. There
is no supported skew window: old consumers reject format 4, and new consumers
reject the pre-migration `parameter-ready` frontier. Historical format-1/2/3
receipts remain owned by their frozen milestone validators.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| The post-migration state can remain `parameter-ready`. | The exact queue becomes empty and format 3 requires a non-empty terminal migration queue. | Publish a distinct format-4 `complete` state. |
| The M4.151 source edit affects only current composition. | M4.148-M4.150 and older runtime/composition evidence read the same live expression-helper member. | Add an authenticated pre-M4.151 reconstruction layer before every older replacement. |
| Zero legacy migrations are sufficient to emit format-4 `complete`. | A restrictive but valid profile can leave the measured base incomplete with zero legacy migrations. | The producer now requires `baseCompleteFunctions === functionCount`; a RED/green counterfactual test freezes this guard. |

## Local Verification Evidence

- `pnpm fitness:kern-5` passed after evidence regeneration on Node 22.
- The dedicated canonicalizer suite passed twice inside the wall: 732/732
  tests, 58 golden/idempotence/KIR fixtures, 8 measured witnesses, 3
  profile-limit fixtures, and 250 hostile fixtures.
- Current authenticated coverage is 112/112 with zero profile blockers, zero
  legacy-parameter blockers, and an empty parameter queue.

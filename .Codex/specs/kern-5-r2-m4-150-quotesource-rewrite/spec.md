# KERN 5 R2 M4.150 Quotesource Source Rewrite

**Status:** DONE
**Date:** 2026-07-30
**Confidence:** 0.98

## Executive Summary

M4.150 applies the exact `quotesource` predicate selected and exhaustively
proved by M4.149. The KERN source change replaces six forbidden text literals
with three open intervals bounded by admitted neighboring characters. It does
not migrate `quotesource` parameters or promote the final function into the
base.

The source rewrite makes the final legacy function parameter-ready. The
current prerequisite producer rejects that truthful terminal state because it
requires at least one residual function after base-only parameter migration.
M4.150 therefore also adds the exact `parameter-ready` terminal outcome so the
live release gate can publish the one-function/two-row queue without inventing
a prerequisite family or retaining stale blocker evidence.

## Current State / Root Cause

- **VERIFIED:** `origin/main` is
  `864017b4200a6a3bc51b8d9e30cc61145eef6951`, the exact published M4.149
  commit. Evidence: `git fetch origin && git rev-parse origin/main` on
  2026-07-30.
- **VERIFIED:** M4.149 publishes digest
  `bca47b2e75cd13cbbaa3b54e7e98e92f515e44f15cf92e3edea8c8c6bf59dc1d`
  and selects
  `c < " " || (c > "~" && c < "\u00a0") || (c > "\u2027" && c < "\u202a") || (c > "\ufefe" && c < "\uff00")`.
  Evidence:
  `scripts/kern-canonicalizer/canonical-surface-analysis-m4-149.json:1-75`.
- **VERIFIED:** The selected predicate has zero profile blockers, retains
  rows `54/82/932` and two parameter rows, and is equivalent across all
  1,112,064 Unicode scalar values. Evidence:
  `scripts/kern-canonicalizer/canonical-surface-analysis-m4-149.json:12-25`.
- **VERIFIED:** The live KERN source still contains exactly the old blocked
  predicate inside `quotesource`. Evidence:
  `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern:58-109`.
- **VERIFIED:** `partitionMigratedFunctions` already separates base-complete
  migrated functions into `parameterReady`; however,
  `buildCanonicalizerPrerequisiteSummary` throws whenever `residual.length`
  is zero. Evidence:
  `scripts/kern-canonicalizer/coverage-prerequisite.mjs:180-191,412-421`.
- **VERIFIED:** Format 3 currently validates only `selected` and
  `bounded-exhaustion`. A zero-residual terminal queue cannot satisfy either:
  `selected` requires a positive family closure and `bounded-exhaustion`
  requires at least one residual function and one reason row. Evidence:
  `scripts/kern-canonicalizer/coverage-prerequisite.mjs:327-391`.

## What Already Works

- M4.149 already owns the Unicode equivalence proof and exact source decision;
  M4.150 must consume it, not duplicate or weaken it.
- `parameterMigrationRow` already emits the required exact witness shape.
- The coverage profile, KIR limits, runtime envelope, base promotions, handler
  ABI, and public runtime contracts do not need changes.
- The old source can be reconstructed exactly from the successor by reversing
  one unique predicate line, preserving all historical measurements.

## Contract (Verified)

> Verified against `origin/main`
> `864017b4200a6a3bc51b8d9e30cc61145eef6951` on 2026-07-30.

| Field / Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| M4.150 input | exact M4.149 digest `bca47b2e...9dc1d` | `canonical-surface-analysis-m4-149.mjs:21-27` | VERIFIED |
| Rewrite target | expression-helper function ordinal 5, `quotesource` | `canonical-surface-analysis-m4-149.mjs:258-274` | VERIFIED |
| Old source digest | `c32414ee...ee2f` | M4.149 JSON `baseline.sourceDigest` | VERIFIED |
| New predicate | exact M4.149 `candidate.predicate` | M4.149 JSON `candidate.predicate` | VERIFIED |
| Live coverage | remains 111/112 with one `fn.params` blocker | `coverage-summary.json`, `coverage-prerequisite-summary.json` | VERIFIED |
| Terminal queue | one function, one tool, two parameter rows, rows `54/82/932` | M4.149 JSON candidate evidence | VERIFIED |
| New outcome | `parameter-ready`, null exhaustion/selection, empty rankings, non-empty exact migration queue | producer/validator contract in this spec | VERIFIED |

### Producer and consumers

| Surface | Role | Required M4.150 behavior | Tag |
|---|---|---|---|
| `coverage-prerequisite.mjs` | producer and validator | emit/accept terminal `parameter-ready` only when every legacy blocker is in the queue | VERIFIED |
| `coverage-prerequisite-structure.mjs` | checked-in summary validator | consume the same exact format-3 contract | VERIFIED |
| `coverage-current.mjs` | release frontier assertion | require the exact one-function/two-row queue and no stale exhaustion reasons | VERIFIED |
| `check-kern-canonicalizer-coverage.mjs` | release wall | run M4.150 after immutable M4.149 evidence | VERIFIED |
| M4.148/M4.149 measurements | historical consumers | reproduce pre-rewrite bytes through one authenticated reverse replacement | VERIFIED |
| historical composition/coverage loaders | historical consumers | reconstruct the old expression-helper digest and old policy bytes | VERIFIED |
| M4.148 successor normalization | historical consumer | authenticate raw live composition, policy, and implementation identities before substituting archived identities | VERIFIED |
| M4.150 status identity | release status | freeze both input commits plus exact source path and predicate, not only their digests | VERIFIED |

## Implementation Plan

There is one coherent option:

1. Add a RED test requiring the exact M4.149 candidate line and exact terminal
   parameter queue.
2. Add one fail-closed M4.150 target module that authenticates the M4.149
   handoff, old and new source identities, and reversible one-line rewrite.
3. Apply only the exact predicate replacement and regenerate the authenticated
   composition.
4. Extend format 3 with `parameter-ready`, requiring:
   - `parameterMigration.completeFunctions ===
     baseline.legacyParameterBlockers`;
   - at least one exact migration witness;
   - `exhaustion`, `selectedPrerequisite`, and `minimumFamilyCount` are null;
   - both rankings are empty.
5. Preserve historical M4.148/M4.149 measurements by reconstructing the old
   expression-helper and coverage-policy bytes.
6. Publish M4.150 central/status assertions and regenerate live coverage
   receipts.

Keeping `bounded-exhaustion` with zero residual functions would make its name,
reason rows, and invariants false. Pretending an empty family is `selected`
would weaken the positive-closure contract. Neither is a real alternative.

## Blast Radius

| File / group | Action | Reason |
|---|---|---|
| this spec | add | claim-tagged cross-session contract |
| `canonicalizer-expression-helpers.kern` | modify one line | exact M4.149 rewrite |
| composed canonicalizer + `composition.json` | regenerate | authenticated executable bytes |
| `quotesource-rewrite-m4-150.mjs` + tests | add | exact reversible source target and RED/green oracle |
| `coverage-prerequisite.mjs` + tests | modify | truthful terminal queue outcome |
| `coverage-current.mjs` | modify | current frontier becomes parameter-ready |
| historical source/composition loaders | modify | retain exact pre-M4.150 evidence |
| M4.148/M4.149 measurement owners | modify | measure immutable historical source after successor |
| M4.150 central/status modules | add | release-blocking handoff to parameter migration |
| coverage policy and live summaries | regenerate | authenticate new source and implementation graph |
| runtime, handler ABI, packages, public API | unchanged | outside this source-only semantic slice |

## Acceptance Criteria

- [x] RED fails because current source contains the old predicate and not the
      M4.149 candidate.
- [x] The exact M4.149 digest and action are authenticated before accepting
      the rewrite.
- [x] The expression-helper source changes by exactly one predicate line.
- [x] The old predicate occurs zero times and the candidate occurs exactly
      once in `quotesource`.
- [x] Reversing that one line reproduces source digest
      `c32414ee7aa6f29d092dc21de5065f04c4054c54d070dd4d964763047170ee2f`.
- [x] Composition metadata and composed KERN bytes reproduce exactly.
- [x] Live coverage remains 111/112 with one legacy `fn.params` blocker.
- [x] Live prerequisite outcome is `parameter-ready` with exactly one
      canonicalizer witness, two parameter rows, and rows `54/82/932`.
- [x] Terminal `parameter-ready` rejects an empty/partial/decorated queue,
      non-null exhaustion, any family selection, and queue/baseline mismatch.
- [x] M4.148 and M4.149 receipts remain byte-identical and their historical
      measurements still reproduce.
- [x] M4.148 rejects forged live composition, canonicalizer, coverage-policy,
      implementation, and corresponding prerequisite identities before any
      historical normalization.
- [x] M4.150 status rejects drift in both input commits, source path, exact
      predicate, and decorated/non-plain rewrite records as well as the
      existing digest and queue fields.
- [x] No parameter signature, profile/KIR/runtime limit, capability, runtime,
      package, or public API changes.
- [x] Focused tests, `pnpm test:kern-canonicalizer`, and
      `pnpm fitness:kern-5` pass.
- [x] `agon review uncommitted -e claude,codex,agy,kimi-for-coding-k3,minimax-coding-plan-minimax-m3,zai-coding-plan-glm-5.2`
      has no unresolved verified blocker.

## Out of Scope

- Migrating the two `quotesource` parameters.
- Promoting coverage to 112/112.
- Changing the forbidden character set or Unicode ordering contract.
- New text primitives, KIR/profile/runtime limits, handler ABI, or packages.
- Compiler bootstrap, fixed point, RC publication, Fable, or a KERN 5
  completion claim.

## Open Questions

None. There are no ASSUMED or OPEN claims in the selected path.

## Deploy Order

The rewrite, terminal prerequisite outcome, historical reconstruction, policy,
composition, and live receipts ship in one commit. There is no supported skew
window between these files. M4.151 may consume the exact published
one-function/two-row queue; it must not infer or rebuild a different queue.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| M4.150 could change only one KERN line and leave the current prerequisite contract untouched. | Removing the canonical-surface blockers makes every remaining migrated function base-complete, and the producer currently rejects a zero-residual frontier. | M4.150 must atomically publish an exact terminal `parameter-ready` state without migrating the parameters. |
| Historical normalization could replace successor identity fields before comparing the reconstructed M4.148 receipt. | Replacement without first authenticating the raw live composition and dependency identities makes those fields vacuous under a forged direct caller. | M4.150 authenticates every replaced live identity and its prerequisite mirror before normalization. |
| The status validator's digest checks transitively froze the complete rewrite record. | Direct callers could drift the input commits, source path, or predicate while preserving the checked digests. | The status contract now checks all four fields explicitly. |
| Checking only selected rewrite values was equivalent to authenticating the exact status record. | Extra own fields and custom prototypes could survive while the status still reported success. | The status contract now requires exact plain-object envelopes for the rewrite, input, source, and selected action. |

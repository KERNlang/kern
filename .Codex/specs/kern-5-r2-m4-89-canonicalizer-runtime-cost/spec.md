# KERN 5 R2 M4.89 — Canonicalizer Expression-Source Runtime Cost

**Status:** PUBLISHED
**Date:** 2026-07-20
**Confidence:** 0.97

## Executive Summary

[VERIFIED] Published M4.88 commit
`d6b8687624e1361d5e43ef6c6910cc68672d2b2e` freezes the exact three-witness
74/77/580 structural-runtime rejection. Its controlling `isreserved` witness
needs 107,594 iterations: 42,058 above the unchanged 65,536 production ceiling
and 58,442 above the fixed 49,152 promotion budget.

[DECIDED] M4.89 removes repeated complete value-table projection inside
`exprsource` without changing its public name, ordinal, signature, result, or
callers. A new table-only `expressionsources` helper projects all expression
rows once and returns a reverse-id-aligned `string[]`. Existing machine-helper
memoization then reuses that immutable result across every `exprsource(id, ...)`
call with the same authenticated tables.

[DECIDED] M4.89 changes KERN canonicalizer source only. It does not raise a
runtime or profile limit, alter KIR/runtime/parser/ABI behavior, promote
74/77/580, consume parameter rows, or claim KERN 5 completion. M4.90 owns any
promotion decision from the authenticated M4.89 evidence.

[VERIFIED] The optimized `exprsource` body now fits the active 38/61/580 row
profile and therefore exposes one real seven-row parameter-migration witness.
M4.89 records but does not consume that queue; M4.90 can preserve it while
publishing the combined queue created by the authenticated dual-row promotion.

[VERIFIED] Six independent high-risk role-lens reviewers completed. Their one
material finding was corrected: every malformed-table exit from
`expressionsources` now returns a typed empty list, while direct runtime tests
prove `exprsource` preserves its fail-closed empty-string contract.

## Published Input

[VERIFIED] Branch `feat/kern-5-r2-m4-89-runtime-cost-reduction` starts from
exact published M4.88 commit `d6b8687624e1361d5e43ef6c6910cc68672d2b2e`.

[VERIFIED] The immutable M4.88 input is:

- receipt format `kern.kir-canonicalizer.dual-row-headroom.4`;
- receipt SHA-256
  `285b42785be8f651d323444ddd3464381b337b74557bbd07e8c3f4bad02a89bb`;
- active profile 38/61/580 and candidate profile 74/77/580;
- exact witness floors 36,229, 51,321, and 107,594;
- fixed promotion budget 49,152 and production ceiling 65,536;
- canonicalizer composite SHA-256
  `fe5087dfcb79898a4b5d46cd233a2bbbeea156417f18ac314e87330172e31b28`;
  and
- disposition `rejected-over-production-ceiling`, next milestone M4.89.

## Measured Root Cause

[VERIFIED] A temporary diagnostic instrumented only ignored compiled runtime
output and rolled its counters back whenever the helper trampoline rolled back
the iteration budget. It executed the exact M4.88 `isreserved` structural
witness successfully at 107,594 and attributed exactly 107,594 committed loop
iterations.

[VERIFIED] The two `exprsource` loops dominate that exact floor:

| Loop | Calls x rows | Iterations | Share |
|---|---:|---:|---:|
| value parent/order/role index | 71 x 572 | 40,612 | 37.75% |
| bottom-up expression projection | 71 x 572 | 40,612 | 37.75% |
| all other canonicalizer loops | — | 26,370 | 24.51% |
| total | — | 107,594 | 100% |

[VERIFIED] The 71 distinct ids correspond to every expression in the migrated
`isreserved` function. Helper memoization already avoids repeating the same id,
but the id remains part of the `exprsource` cache key, so each distinct id
rebuilds identical table indexes and recomputes every expression source.

## Optimization Contract

[DECIDED] Insert `expressionsources` immediately after `exprsource` in
`canonicalizer.kern`. It accepts only the six expression value tables and
contains the current two-pass projection algorithm. During the
descending projection pass it appends one string for every value id, including
an empty string for non-expression or invalid rows. Array index
`valueTag.length - id` therefore maps deterministically back to value id.

[DECIDED] Keep `exprsource` at
`examples/kern-canonicalizer/canonicalizer.kern#2:exprsource` with its exact
seven-parameter signature. Its body retains the existing id/record guard,
calls `expressionsources` with table-only arguments, and returns the aligned
entry through strict `List.index` fallback.

[VERIFIED] Existing pure-helper memoization executes the table-only helper once
per canonicalization. The controlling exact floor is 27,514: 107,594 minus 70
duplicate pairs of 572-row scans. The other exact floors are 24,273 and 23,104.

[VERIFIED] Receipt `kern.kir-canonicalizer.runtime-cost-reduction.2` is frozen
at SHA-256 `c41cfbb3d7fb6f9d5f32f2d59f58e6e8d5ce7a65f77040316c7497c8cd89f86c`.
It proves an 80,080-step maximum-floor reduction, 21,638 promotion headroom,
and 38,022 production headroom without changing runtime policy.

[DECIDED] M4.89 must preserve:

1. byte-identical canonical output for every accepted fixture and witness;
2. existing malformed/duplicate/order/id rejection behavior;
3. exact M4.80 and M4.88 receipt bytes as immutable historical evidence;
4. active 38/61/580 and candidate 74/77/580 policy limits;
5. the 65,536 production ceiling, 49,152 budget, and KIR depth 64; and
6. diagnostic/module-envelope boundaries as unclaimed runtime policy.

## Implementation Plan

1. Add a RED M4.89 receipt/performance test that fails at the missing runtime-
   cost module while proving the M4.88 baseline exceeds the fixed budget.
2. Extract the current projection algorithm into table-only
   `expressionsources`; leave `exprsource` as the exact id wrapper.
3. Recompose the canonicalizer and prove all focused golden, hostile, direct
   helper, and historical-receipt contracts.
4. Measure all three M4.88 witnesses at floor-minus-one/floor, publish an
   immutable M4.89 receipt, and require the maximum exact floor <=49,152.
5. Regenerate current coverage summaries only after `.mjs` bytes settle; run
   focused, complete canonicalizer, terminal checker, and full Node 22 fitness.
6. Run automatic high-risk role-lens review, resolve verified findings, create
   one Agon-signed commit, fetch/rebase, and atomically push branch plus main
   once with the explicitly authorized `--no-verify`.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.88 commit `d6b86876`.
- [x] Exact committed iteration attribution accounts for all 107,594 steps.
- [x] Root cause is 81,224 repeated `exprsource` table-scan iterations.
- [x] RED fails at the intended missing M4.89 receipt boundary.
- [x] `exprsource` keeps its name, ordinal, signature, and return contract.
- [x] `expressionsources` performs exactly one index and one projection pass.
- [x] All direct and canonicalizer malformed-input behavior remains fail closed.
- [x] M4.80 and M4.88 receipt bytes remain exact immutable history.
- [x] All three live witnesses fail at floor-minus-one, succeed at floor, and
      round-trip byte-identically.
- [x] Maximum exact floor is at or below 49,152 with unchanged runtime policy.
- [x] Active profile remains 38/61/580; candidate remains 74/77/580.
- [x] Focused and complete canonicalizer gates pass; full Node 22 fitness passes.
- [x] Independent high-risk review has no unresolved material finding.
- [x] Signed commit is fetched/rebased before one atomic no-verify push; remote
      branch and main hashes verify identically.

## Stop Conditions

- Cached table projection changes accepted or emitted canonical bytes.
- Any malformed input becomes accepted or produces a partial source string.
- Maximum exact optimized floor remains above 49,152.
- Historical receipt bytes, active limits, or runtime/KIR/ABI policy must move.
- The optimization depends on observable helper events or mutable cached data.

## Out of Scope

- Promoting node/property limits or migrating the selected 40 parameter rows.
- Raising iteration, collection, projection-depth, or KIR limits.
- Runtime-engine cache or trampoline changes.
- Module-envelope admission, runtime cutover, KIR v1 freeze, RC/stable release,
  Fable work, or a KERN 5 completion claim.

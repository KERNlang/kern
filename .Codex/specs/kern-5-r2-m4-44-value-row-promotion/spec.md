# KERN 5 R2 M4.44 Authenticated 388-Row Profile Promotion

**Status:** READY TO SHIP — LOCAL GATES AND INDEPENDENT REVIEW PASS
**Date:** 2026-07-22
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.43 commit
`df27456aeda2880eb6bb76e5ed1b8fe314023a39` reauthenticated the exact M4.42
16/30/388 recommendation against the optimized live frontier. The selected
388-row `validbinaryop` witness now has an exact 10,614-iteration floor, uses
21.6% of the precommitted 49,152 promotion budget, and preserves 38,538
iterations of headroom. The active profile remains 16/30/154.

[DECIDED] M4.44 promotes only `profileLimits.maxValueRows` from 154 to 388.
Node and property rows remain 16 and 30. KERN source, generated canonicalizer
bytes, structural families, runtime/KIR/expansion limits, ABI, public APIs, and
the 104-function corpus remain unchanged. The promotion immediately admits the
already-direct `sortStrings` function and exposes exactly two legacy-signature
functions as the next parameter queue, but does not migrate them in this slice.

## Published Input

[VERIFIED] Both `origin/main` and the M4.43 feature ref resolve to
`df27456aeda2880eb6bb76e5ed1b8fe314023a39`.

[VERIFIED] The optimized live M4.43 residual analysis has canonical SHA-256
`823e464ea6b6cc78a6959c0bced2b6d5f63b5722e0e15bda4a2dd08abf8200d8`,
45 assignments, 29 observed settings, 29 actionable candidates, and the exact
selected action:

- limits 16/30/388;
- one changed axis, `maxValueRows`;
- total delta 234;
- two functions across two tools;
- `examples/capstone-checker-subset/checker-while.kern#2:checkerSafeIntText`;
- `examples/kern-canonicalizer/canonicalizer.kern#1:validbinaryop`.

[VERIFIED] M4.43 artifact SHA-256 values are:

- composed canonicalizer:
  `1114de23dc9f6bb036eb4734ed8e7aadef5c1d79d54b1d0395967065fc4e904d`;
- handwritten canonicalizer:
  `394ebcf582c289d13f877b9546430991ea89cdea0ecd1a22b02bef64083d678d`;
- M4.42 historical analysis:
  `f37fed74d24a739adf3584ceb7608f8d25c490d2325ebc1c127e05ee15238a8e`;
- live coverage summary:
  `b79a191f79ab8a59e114e4354cbcdd788fed0bbeb49d101e058cb5c1eacf9a53`;
- live prerequisite summary:
  `b28d2ec9f58c99dc4ab6a6e1f98628e539c0560f74ea9cef872f68787830d497`.

## Root Problem

[VERIFIED] The current 154-row policy is the only remaining blocker for the
two selected legacy-parameter functions after counterfactual direct-parameter
conversion. Under an in-memory 388-row policy, the live prerequisite partition
is exactly two parameter-ready functions, two tools, two parameter rows, and
43 residual legacy functions.

[VERIFIED] The same widening also immediately admits the already-direct
`examples/capstone-assertion-engine/sort.kern#2:sortStrings` at 16/29/197.
This function was outside the legacy-only M4.42 residual-analysis scope, so it
was not listed in the selected parameter action. Its exact production floor is
9,926 iterations, with failure at 9,925, below both the 49,152 gate and the
selected 388-row witness's 10,614 floor.

[VERIFIED] This is an admission-policy boundary, not a semantic or runtime
capability gap. M4.43 already proved the exact 388-row function through the
production KERN handler at its 10,614 floor and below the fixed 49,152 gate.
Raising the runtime ceiling or changing the canonicalizer algorithm is neither
required nor permitted in M4.44.

## Promotion Contract

| Surface | M4.43 | M4.44 | Tag |
|---|---:|---:|---|
| max node rows | 16 | 16 | VERIFIED |
| max property rows | 30 | 30 | VERIFIED |
| max value rows | 154 | 388 | DECIDED |
| production iteration ceiling | 65,536 | 65,536 | DECIDED |
| KERN canonicalizer bytes | current | byte-identical | DECIDED |
| handwritten corpus | 104 functions / 9 members / 4 tools | unchanged | DECIDED |
| structural families | exception-flow / while-iteration | unchanged | DECIDED |
| KIR/runtime/expansion/ABI/public API | current | unchanged | DECIDED |

[DECIDED] The exact admitted boundary is the counterfactually migrated
`validbinaryop` function at 12/15/388. The exact overflow fixture adds only the
`fn.async` property and measures 12/16/389. It must reject at the configured
388 ceiling without a partial canonical result.

[DECIDED] The optimized M4.43 live analysis becomes an immutable historical
handoff before policy changes. Its exact canonical bytes, digest, source
commit, assignments, frontier, and selected action remain independently
loadable and mutation-guarded. The older M4.31, M4.38, and M4.42 receipts also
remain byte-identical.

## Expected Live Transition

[VERIFIED] At 16/30/388, the prerequisite parameter queue is exactly:

1. `checkerSafeIntText`: one `raw:string` parameter, rows 14/20/161, checker;
2. `validbinaryop`: one `op:string` parameter, rows 12/15/388, canonicalizer.

[DECIDED] The queue totals two functions, two tools, and two parameter rows.
Neither source signature is changed in M4.44. The live coverage base becomes
58/104: `sortStrings` becomes immediately base-complete, while both queued
functions retain their excluded legacy `fn.params` property until M4.45.

[DECIDED] The 43 residual functions are remeasured under the promoted policy,
after the two queued functions leave the pre-promotion 45-function residual set.
Any selected structural prerequisite or bounded-exhaustion receipt must be
accepted only from the live deterministic measurement; M4.44 must not invent a
family action to make the release status look complete.

## Implementation Plan

1. Add RED assertions for the 388 policy, exact 388 admission, exact 389
   rejection, frozen M4.43 analysis, the one direct admission, and exact 2/2/2
   queue while source remains legacy.
2. Freeze the canonical M4.43 live residual analysis as a digest- and
   source-commit-bound historical handoff; stop requiring the post-promotion
   live analysis to reproduce the old baseline.
3. Change only `profileLimits.maxValueRows` from 154 to 388 and replace the
   profile boundary/overflow fixtures with the exact selected witness pair.
4. Regenerate only the policy digest and live coverage/prerequisite receipts.
   Preserve every KERN, composite, composition, corpus, historical receipt,
   runtime, KIR, and ABI byte outside those live consumers.
5. Pin `sortStrings` success at 9,926 and failure at 9,925 through the same
   handler, policy, and round-trip oracle; prove its zero queue rows are
   disjoint from the two legacy witnesses and all three effects share one
   non-composing 10,614 maximum floor.
6. Run focused canonicalizer gates and the complete Node 22.22
   `pnpm fitness:kern-5` wall, then automatic high-risk role-lens independent
   review because this changes shared admission policy.
7. Commit with Agon identity, fetch/rebase onto `origin/main`, push once with
   `--no-verify` to the fresh feature ref and authorized `main`, verify both
   remote hashes, and start M4.45 from fresh `origin/main`.

## Expected Files

- this spec;
- `scripts/kern-canonicalizer/policy.json`;
- `scripts/kern-canonicalizer/profile-limit-fixtures.mjs`;
- canonicalizer policy/profile/prerequisite/residual assertion wiring;
- a frozen M4.43 residual-analysis loader and canonical JSON receipt;
- regenerated live coverage and prerequisite summaries;
- terminal coverage status and release-train evidence.

## Acceptance Criteria

- [x] Fresh M4.44 branch starts exactly at published M4.43 commit
      `df27456aeda2880eb6bb76e5ed1b8fe314023a39`.
- [x] Counterfactual 388 measurement yields exactly the 2/2/2 queue and 43
      residual functions.
- [x] RED fails on the published 154 policy at the intended promotion boundary.
- [x] M4.43 optimized residual analysis is immutable at SHA-256
      `823e464ea6b6cc78a6959c0bced2b6d5f63b5722e0e15bda4a2dd08abf8200d8`.
- [x] Active policy is exactly 16/30/388; every other limit is unchanged.
- [x] Exact 12/15/388 succeeds and exact 12/16/389 rejects.
- [x] Canonicalizer source, composite, composition, corpus, historical receipt,
      runtime, KIR, ABI, and public API bytes remain unchanged.
- [x] Live parameter queue is exactly two functions, two tools, and two rows;
      neither target source signature is migrated.
- [x] `sortStrings` is the sole immediate direct admission at 16/29/197, fails
      at 9,925, succeeds and byte-roundtrips at 9,926, and contributes zero
      legacy queue rows.
- [x] Live base completion is exactly 58/104; the promotion effect is one
      direct admission plus two queued migrations, not three source migrations.
- [x] Focused canonicalizer gates and complete Node 22.22 fitness wall pass.
- [x] Independent high-risk role-lens review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push to the
      fresh feature ref and authorized main; both remote hashes verify.

## Gate Evidence

[VERIFIED] The complete canonicalizer gate passes 131/131 tests, followed by
51 golden/idempotence/KIR fixtures, eight measured witnesses, three exact
profile-limit fixtures, and 226 hostile fixtures. The initial complete run
caught that JavaScript string escaping had removed the embedded KERN quote
escapes from the new boundary fixture. The fix uses raw strings, adds a direct
parse regression assertion, and binds the canonicalizer's exact parenthesized
golden output; the complete gate then passed from a regenerated authenticated
receipt.

[VERIFIED] Live coverage is exactly 58/104 with 45 `fn.params` blockers. The
parameter queue is exactly 2/2/2 with 43 residual functions. Coverage and
prerequisite whole-file SHA-256 values are
`c11de38b5370eecbe48292ca8d15136d017205a7278321d57fe577236016f98a`
and `9741650d8567016fb029a8e51b4706da1da131d9870c94a3221b4550792dee01`.
The live implementation, canonicalizer-policy, and function-fact digests are
`ada72154808a46b10766f9d4513cd6f7e54d021f9ee7aae2637bb0051d8a16ab`,
`a0613353cf5dd7def20b13138fae461b3084bb6b958b769c99bf5b00a5c98556`,
and `e964748bf7a8c52d2381506b12137be3438a78ac8f627f009b1c00a0ce41f3d1`.

[VERIFIED] The complete Node 22.22 `pnpm fitness:kern-5` wall passes,
including all workspace tests, 434/434 cross-target fixtures, 109/109 class
fixtures, 233/233 native assertions at 100% coverage, 48/48 checker fixtures,
39/39 validator verdicts, 40 app fixtures on three legs, and whole-app
Express/FastAPI boot. The required browser receipt remains 157 modules,
1,553,103 raw bytes, and 333,617 gzip bytes at 55 ms cold and a 98 ms browser
median (91/98/105 ms samples).

## Independent Review Delta

[VERIFIED] Automatic medium-risk role-lens review
`review-1784728882250-bm9sqa-kern-5-r2-m4-44-final` completed 2/2. It found
that `coverage-residual-analysis-current.mjs` had become an unreachable second
live-analysis path whose old non-empty-selection contract could no longer hold
after promotion. The obsolete module was deleted, the M4.43 receipt test moved
to its own milestone file, and the remaining performance test was named for
the exact M4.43 witness it preserves.

[VERIFIED] Because this slice changes shared admission policy, explicit
high-risk role-lens review
`review-1784729443580-vk3iwj-kern-5-r2-m4-44-high-risk` completed the complete
usable non-excluded roster, 6/6. Its candidates were checked against the code.
The review produced these material improvements:

- the exact boundary fixture is now structurally bound to the real migrated
  `validbinaryop` AST after location normalization;
- the migration helper removes obsolete `params` quote metadata when it
  removes the legacy property;
- the previous policy is pinned exactly to 16/30/154 rather than derived from
  the promoted policy;
- residual status formatting shares one implementation, the no-selection
  operator message is milestone-neutral, and a tautological runtime-floor
  assertion was removed;
- release evidence explicitly separates the immutable declaration-only M4.43
  frontier from the live post-promotion prerequisite measurement.

[VERIFIED] Suggestions to make the generic policy validator encode this
milestone's performance budget or to centralize all 2/2/2 expected literals
were rejected. The active profile is exact-pinned by milestone tests and live
runtime floors, while the duplicated literals are intentionally independent
oracles that prevent one bad edit from blessing both measurement and checks.

[VERIFIED] Targeted post-fix review
`review-1784730577887-1mq9xg-kern-5-r2-m4-44-review-fix` completed 1/1 with
zero findings. No review dependency remains unresolved.

## Stop Conditions

- The exact 388 witness exceeds the fixed 49,152 budget or fails the unchanged
  65,536 production envelope.
- The 389 witness succeeds, returns a partial result, or exceeds a different
  profile axis than the exact 12/16/389 contract.
- The parameter queue differs from exactly 2/2/2, target identity/order drifts,
  or either target becomes base-complete before source migration.
- `sortStrings` differs from 16/29/197, has a floor other than 9,926, consumes
  a legacy queue row, or another already-direct function becomes newly
  base-complete.
- Freezing M4.43 requires changing its canonical record or any older receipt.
- Any KERN source, runtime/KIR/ABI limit, structural family, corpus member, or
  public API change is required.

## Out of Scope

- Migrating `checkerSafeIntText` or `validbinaryop` to direct parameters.
- Raising any profile axis beyond 16/30/388.
- Selecting or implementing another structural family.
- KIR v1 freeze, public reader export, runtime cutover, RC, or KERN 5
  completion.

## Open Questions

[DECIDED] None blocks implementation. The live post-promotion residual outcome
is deliberately measured rather than predicted, but the promotion and queue
contracts are exact and fail closed on drift.

## Adversarial Challenge Delta

[VERIFIED] Full usable non-excluded Agon brainstorm
`brainstorm-1784725453898-olcgg4-kern-5-r2-m4-44-scope` completed 8/8 after
the first live write exposed the unplanned direct admission.

[DECIDED] Initial approach: promote only 154 to 388, freeze M4.43, and expose
the exact 2/2/2 legacy queue. The challenge confirmed the promotion-only then
migration-only split, but required `sortStrings` to be named as a separate
immediate admission, its exact 9,926/9,925 floor to be frozen, and the direct
admission to remain disjoint from the queued legacy cohort.

[DECIDED] Suggestions to add milestone metadata directly to `policy.json` or
generated summary schemas are rejected: those files are exact-schema policy
and measured receipts, not free-form release ledgers. The dedicated M4.44
assertion module, immutable M4.43 JSON handoff, and release train carry that
evidence without weakening fail-closed schema validation.

[VERIFIED] No dependency remains unresolved. Confidence rises from 0.84 during
the unexpected-scope investigation to 0.96 after the exact performance probe
and 8/8 challenge agreement.

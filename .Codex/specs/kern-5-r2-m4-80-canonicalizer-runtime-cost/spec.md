# KERN 5 R2 M4.80 — Canonicalizer Type-Source Runtime Cost

**Status:** IMPLEMENTED — ALL LOCAL GATES AND INDEPENDENT REVIEW PASSED — PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.79 commit
`990898fba53f88e71dce24e5e783d47b9c91b62c` rejects the selected
38/61/461 property-row promotion because the exact migrated
`checkWhileCore` witness needs 56,238 loop iterations, 7,086 above the
precommitted 49,152 promotion budget.

[DECIDED] M4.80 removes repeated full-value-table scans inside `typesource`
without changing its name, ordinal, signature, return contract, or callers.
It freezes the old M4.79 receipt as immutable history, publishes a new exact
optimized boundary, and leaves the active 38/53/461 profile unchanged. A later
fresh slice may promote 38/61/461 only from M4.80's authenticated evidence.

## Published Input

[VERIFIED] This fresh branch
`feat/kern-5-r2-m4-80-canonicalizer-runtime-cost` starts at exact
`origin/main` commit `990898fba53f88e71dce24e5e783d47b9c91b62c`.

[VERIFIED] The immutable M4.79 input is bound by:

- receipt SHA-256
  `d8683f1440e8bb0f8496ab1845c83c7dabe73dbfd26114b78685d8c8e1cf830b`;
- exact floor 56,238 and promotion deficit 7,086;
- candidate profile 38/61/461 and active profile 38/53/461;
- canonicalizer source SHA-256
  `f4a39a81ea169f0127aac92a2791ac3a2726329f9bd369d05f1f5648593f78d7`;
- composite SHA-256
  `974b8d3ba6fefac4861152be88181c176feda56df9aa820e9f8d3a89e0488f8d`;
- composition SHA-256
  `2e8a4f77f6f343e7a16b42522b74afce3fd91272df3261431cb8e8950c17105d`;
- current coverage-summary SHA-256
  `072563357669df76099c8343cd57be21a59c82148072dedd2f4d8402c86863a4`;
  and
- current prerequisite-summary SHA-256
  `156a6b67a18690b915a31ede135e702cf7d3953c315da97b7400c6acb78bab90`.

## Root Cause

[VERIFIED] The runtime budget counts every KERN loop iteration. A temporary
read-only diagnostic run at the 65,536 production ceiling attributed 10,580
iterations to 23 `valuechildcount` full-table traversals and 20,240 iterations
to 44 `recordfield` full-table traversals while `typesource` processed the
460-row witness. The same run succeeded and did not alter repository source.

[VERIFIED] Current `typesource` first calls `valuechildcount`, then calls
`recordfield` for `kind`, and calls `recordfield` again for `element` on list
types. Each helper independently scans the complete `valueParent` table.
These scans are redundant because count, `record:kind`, and `record:element`
can be collected together while preserving duplicate-field rejection.

[IMPLEMENTED] Replace those two-or-three table passes with one bounded helper,
`typefields`, that records in a single pass:

1. exact direct-child count;
2. the unique `record:kind` child id; and
3. the unique `record:element` child id.

Duplicate matching roles fail closed exactly as the current `recordfield`
contract does. Unknown and missing roles still fail through the existing count,
kind, and element checks.

## Implementation Plan

1. Add RED coverage proving M4.79's current 56,238 implementation misses the
   fixed 49,152 budget and that M4.80 must preserve exact output.
2. Append one base-admissible `typefields` helper and make `typesource` delegate
   to it; retain `typesource` identity, ordinal, signature, export, and grammar.
3. Regenerate the exact composed canonicalizer and composition metadata, then
   measure the optimized witness boundary at `floor - 1` and `floor`.
4. Freeze M4.79 as historical evidence and publish an immutable M4.80
   runtime-cost receipt binding old/new source, composition, floor, reduction,
   budget headroom, witness identity, and unchanged policy.
5. Regenerate current coverage summaries after all `.mjs` edits; run focused,
   canonicalizer, complete Node 22 fitness, and high-risk role-lens review.
6. Make one signed commit, fetch/rebase, and atomically push the fresh feature
   ref plus authorized `main` once with `--no-verify`.

## Acceptance Criteria

- [x] Fresh branch starts at exact M4.79 commit `990898fb`.
- [x] Root cause is traced to repeated `typesource` full-table helpers.
- [x] RED fails because the current exact floor exceeds 49,152.
- [x] `typesource` retains its exact name, ordinal, signature, and export.
- [x] Its optimized body delegates to one bounded `typefields` value-table scan
      and does not call `valuechildcount` or `recordfield`.
- [x] Duplicate, missing, unknown, decorated, and malformed field evidence
      remains fail-closed.
- [x] M4.79 receipt bytes remain exact immutable history.
- [x] Current witness fails at 35,997, succeeds at the exact 35,998 floor,
      and byte-roundtrips exactly.
- [x] New floor is 35,998: 13,154 below 49,152 and 20,240 below M4.79.
- [x] Active profile remains exactly 38/53/461; runtime ceiling remains 65,536;
      KIR depth remains 64.
- [x] No parser, runtime, KIR, ABI, generated consumer, package version, or
      public API changes.
- [x] Focused gates, complete canonicalizer, terminal checker, and complete
      Node 22 `fitness:kern-5` wall pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Stop Conditions

- One-pass `typesource` changes accepted or emitted canonical bytes.
- The exact optimized floor remains above 49,152.
- Historical M4.79 bytes or active profile limits must change.
- Optimization requires runtime, KIR, ABI, parser, or policy widening.

## Plan Delta

[VERIFIED] The first implementation put the merged scan directly inside
`typesource`. It cleared the runtime budget but expanded that function from the
published 38/51/461 structural profile to 49/67/560, which would have coupled
the cost fix to unrelated profile widening. That implementation was rejected
before publication.

[IMPLEMENTED] The corrected design appends `typefields` at ordinal 16 with a
20/33/250 base-admissible profile. `typesource` remains ordinal 0 and now has a
38/51/455 profile, within the active base. Coverage therefore rises from
80/104 to 81/105 while the 23-function residual set remains unchanged.

[VERIFIED] Focused contracts pass 80/80. The exact boundary proof fails closed
at 35,997 and succeeds at 35,998, reproducing the expected canonical bytes.

[VERIFIED] The complete canonicalizer wall passes 315/315 tests plus 55 golden,
8 measured, 3 profile-limit, and 235 hostile fixtures. The complete Node 22
`fitness:kern-5` release wall reaches its terminal pass.

## Independent Review Adjudication

[VERIFIED] High-risk role-lens review run
`/Users/nicolascukas/.agon/runs/review-1784872033638-natr8v` routed all six
usable independent seats. Five returned `ok`; one reported ten blockers about
historical exact-floor tests no longer executing against the live canonicalizer.

[DECIDED] Those ten blockers do not apply to M4.80. Their premise would require
published historical floors to remain exact after the canonicalizer was
deliberately made faster. The historical receipt loaders still authenticate the
exact old bytes and outcomes, while M4.80 alone owns and executes the current
35,997/35,998 boundary oracle.

[IMPLEMENTED] The review did identify dead runtime harness code left in six
historical performance files and a future-fragile `typefields` regex. The dead
harnesses were replaced by concise immutable-receipt tests, and function source
selection now stops at the next top-level function. Post-review lint, terminal
coverage regeneration/check, and 66 targeted tests pass.

[VERIFIED] The receipt-construction naming/hardcoded-boundary observations are
resolved by the separate live performance oracle: receipt creation remains
deterministic and source-bound, and `runtime-cost-m4-80-performance.test.mjs`
executes both sides of the exact boundary. No unresolved dependency remains.

## Out of Scope

- Promoting `maxPropertyRows` from 53 to 61.
- Migrating the selected 22 parameter rows.
- Optimizing `exprsource`, `tablesok`, or the runtime engine.
- Claiming module-envelope admission, release readiness, stable KIR, semantic
  self-hosting, or KERN 5 completion.

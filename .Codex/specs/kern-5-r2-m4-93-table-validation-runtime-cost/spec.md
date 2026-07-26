# KERN 5 R2 M4.93 — Table-Validation Runtime Cost

**Status:** IMPLEMENTED — REVIEW AND FINAL FITNESS PASSED
**Date:** 2026-07-26
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.92 commit
`8e9c8c7d99aa215a5a6f5109f2f4839a06bb4995` selects exactly one
24-parameter checker witness at candidate profile 74/95/832:

`examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk`.

[VERIFIED] The public runtime handler did not reach a terminal envelope for
that witness after more than three hours at the unchanged 65,536 iteration
ceiling. The attempt was terminated without claiming success, failure, or an
exact floor. M4.93 therefore cannot honestly publish structural headroom yet.

[DECIDED] M4.93 removes repeated complete node/property table validation from
the resumable `tablesok` helper. It does not raise a row/runtime/KIR limit,
promote 74/95/832, migrate the witness, or claim KERN 5 completion.

## Published Input

[VERIFIED] This fresh branch starts from exact `origin/main` commit
`8e9c8c7d99aa215a5a6f5109f2f4839a06bb4995`.

[VERIFIED] The immutable M4.92 input is:

- receipt SHA-256
  `c6311d6351db075292af7a36a850787dd3bdf135ab290b60098da3ce25509e24`;
- residual-analysis input commit
  `730aa181e1e3ea40b88dd22f74c58e853a706009`;
- active profile 74/77/580;
- candidate profile 74/95/832;
- one checker function and 24 parameter rows; and
- unchanged production ceiling 65,536, promotion budget 49,152, and KIR depth
  64.

[VERIFIED] Pre-implementation source identities are:

- canonicalizer source
  `85baf571138d4b26d1168e8a3036f216d716f8d895db3eefaadf4a890fc24245`;
- canonicalizer composite
  `a8ec4d0e4d838aaa2a1f4b60ad4a403fb5df9f7889d46f22109bb25fda1b50d7`;
- composition receipt
  `a9fc6520aa20d333d918592dcace1147a5dd10f402b335b5761a3669d1cc1d5b`;
- coverage policy
  `6cbdac4c6dfaa9746be103d1d8d10f01d89655f9e7ba9b2299f418d27beb9453`;
- canonicalizer policy
  `f3819746060ae31ee7ae0ac0ddaa4753190b02820366e6ee2971f8c3a1178849`;
  and
- structural KIR codec
  `04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab`.

## Measured Root Cause

[VERIFIED] Temporary diagnostics changed only ignored compiled runtime output.
At a 1,000 committed-iteration budget the exact public-handler input failed
with the canonical `unsupported-runtime-input` envelope.

[VERIFIED] The helper trampoline replayed 30,261 loop entries while consuming
that budget:

| Loop | Replayed entries |
|---|---:|
| `tablesok` node index | 10,123 |
| `tablesok` node order check | 10,123 |
| `tablesok` property index | 9,215 |
| `tablesok` value index | 800 |

[VERIFIED] `canonicalize` calls `tablesok` once. The amplification occurs
inside resumable helper evaluation: progress in later value validation
re-enters `tablesok` and replays its already-completed node/property scans.

## Optimization Contract

[IMPLEMENTED] The measured plan changed from one record-returning helper to
three independent linear helpers:

- `nodetablesok`, returning a boolean;
- `propertyfacts`, returning a boolean after one property pass; and
- `valuefacts`, returning a boolean after one property-ownership pass and one
  value pass.

[VERIFIED] This plan delta avoids introducing a new projected `record`
expression family and keeps every result cache-safe: only plain booleans cross
helper boundaries. All three functions use structural `param` children and
therefore add no legacy `fn.params` blocker.

[DECIDED] `tablesok` must consume the cached facts and preserve every existing
fail-closed check:

1. exact row-array length equality;
2. node parent/order range, topology, and sibling-order uniqueness;
3. property owner/value range, root-value ownership, and key uniqueness;
4. value parent/order range, topology, tag domain, and order uniqueness;
5. primitive/container content constraints;
6. single property ownership for root values;
7. record role syntax, uniqueness, and lexical order; and
8. identical boolean output for malformed and accepted tables.

[IMPLEMENTED] Internal `Map` instances remain local to each helper. No mutable
container crosses the cache boundary. Property ownership, scalar-parent
rejection, content validation, root ownership, and role/order validation are
completed inside `valuefacts`; `tablesok` performs no text scan or table loop.

[IMPLEMENTED] Integer spelling delegates from the single `valuefacts` pass to
the existing runtime-supported `validinteger` helper. A focused regression run
caught and removed an unsupported JavaScript regular-expression predicate
before the complete gate.

[DECIDED] M4.93 must preserve canonical output bytes for all accepted fixtures,
all hostile rejection behavior, M4.87–M4.92 historical receipt bytes, runtime
handler ABI, and active policy limits.

## Implementation Plan

1. Add a RED direct test for the absent cached table-validation helper.
2. Extract immutable table facts and retain `tablesok` as the exact public
   boolean owner.
3. Recompose the canonicalizer and add malformed/accepted parity tests.
4. Re-run the 1,000-budget diagnostic and require the node/property replay
   amplification to disappear before attempting a larger runtime boundary.
5. Publish an immutable M4.93 runtime-cost receipt only after exact optimized
   evidence is available.
6. Run focused, complete canonicalizer, full Node 22 fitness, six-engine
   high-risk review, signed commit, fetch/rebase, and one atomic push.

## Implemented Evidence

[VERIFIED] The selected 53/95/832 witness now executes exactly:

- 53 node-table loop entries;
- 95 property-table loop entries;
- 95 property-ownership loop entries; and
- 832 value-table loop entries.

[VERIFIED] The table-validation owner fails at 1,074 and succeeds with an exact
round trip at 1,075. The authenticated receipt SHA-256 is
`62631ce9d2c97e80b6187c0d75bcb878a610ab1076ab8df71a46d53c0e51b3f3`.

[VERIFIED] The six-engine high-risk review found four genuine quadratic-cost
findings in the delimiter-string implementation and one genuine receipt
binding gap. The final implementation removes all delimiter concatenation and
`Text.indexOf` scans. The structural KIR codec is now included in
`REPOSITORY_DIGESTS`, and the receipt reads the exported runtime ABI constant.
The review claim that `List.index` performs a search was rejected against the
runtime implementation: it is direct indexed access.

[VERIFIED] The final six-engine review produced one additional genuine
receipt-integrity finding: array entries were checked for key density but not
for plain enumerable data descriptors. The validator now rejects
non-enumerable and accessor entries without invoking getters. Focused hostile,
coverage-prerequisite, coverage-summary, and live coverage checks pass after
regenerating the authenticated coverage digests. A targeted independent review
of the correction found no blocker.

[VERIFIED] The public `canonicalize` path no longer replays the table scans at
budget 1,000. A production-budget observation ran for at least 840 seconds
without a terminal envelope and was interrupted. Therefore production
headroom, profile promotion, and KERN 5 completion remain explicitly unproven.

[VERIFIED] Coverage remains 88/109 base-complete with exactly 18 legacy
`fn.params` blockers. The lower runtime floor makes `tablesok` the exact
1-function/12-row parameter-migration queue for M4.94; 17 functions remain in
bounded active-family exhaustion.

[VERIFIED] Accepted/malformed table parity, historical expression-source
admission, the exact 1,811/1,812 boundary, and live M4.89 witness headroom all
pass focused tests.

[VERIFIED] The final full gate exposed one root-value-order regression: the
root-only invariants had been placed in the sibling `else` of a resumable
non-root branch and therefore were skipped for root values. The invariants now
run in the universal per-value check, preserving the intended fail-closed
behavior without changing the exact 1,074/1,075 runtime boundary.

[VERIFIED] `PATH=/Users/nicolascukas/.nvm/versions/node/v22.22.0/bin:$PATH
pnpm fitness:kern-5` passed after the semantic correction, including all 382
canonicalizer tests, 55 golden/idempotence/KIR fixtures, 8 measured witnesses,
3 profile-limit fixtures, 235 hostile fixtures, self-host validator, app
behavior, browser budget, native targets, and the final current-fitness wall.

[VERIFIED] The final-code fitness rerun passed repository consistency, lint,
build, every workspace and infrastructure test, all 382 canonicalizer tests,
native and runner suites, and every remaining current gate. A test cleanup
removed the isolated worktree's `.git` pointer before the last
`git diff --check` sentinel, causing only that wrapper invocation to exit 129.
The still-registered worktree pointer was restored and the exact failed
`git diff --check` gate then passed.

[VERIFIED] Final source identities at the passing full gate are:

- canonicalizer source
  `923c1edc4d79bf1c5e16554ddcbc86ad077a9a9ffa591ba2810c775b89fad5be`;
- canonicalizer composite
  `aff72db1605a0a5cdcbfe34fae65939e4206b659514641b02c2999da3e94b3ab`;
- composition receipt
  `a09fdf1c63e7debc330018b83017a4569ac52da8d70f774904fd62d1ea28d999`;
- coverage policy
  `b578207467e045913d40da46804bb0fca2285f6351f56ed76e9aa805c6dbcc89`;
- canonicalizer policy
  `f3819746060ae31ee7ae0ac0ddaa4753190b02820366e6ee2971f8c3a1178849`;
  and
- structural KIR codec
  `04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab`.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.92 commit `8e9c8c7d`.
- [x] M4.92 selection, assignment, policy, and source identities are grounded.
- [x] Runtime non-completion is recorded without inventing a terminal outcome.
- [x] Replay attribution identifies the dominant table-validation loops.
- [x] RED fails at the intended absent helper boundary.
- [x] Cached facts preserve all accepted and malformed behavior.
- [x] Node/property replay amplification is removed.
- [x] Exact optimized runtime evidence is published immutably.
- [x] Active profile, runtime/KIR limits, ABI, and historical receipts remain
      exact.
- [x] Focused tests pass at the final 1,074/1,075 boundary.
- [x] Complete canonicalizer and final full Node 22 fitness gates pass after
      review-driven changes.
- [x] Targeted independent review confirms the material findings are resolved.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- Cached facts change any accepted source or malformed rejection.
- The helper cache exposes a mutable/non-portable result.
- Replay attribution does not improve after extraction.
- Exact optimized evidence still cannot be measured within a repeatable gate.
- The fix requires raising active profile, runtime, KIR, or ABI limits.

## Out of Scope

- Promoting property/value rows, migrating `comparisonOperandsOk`, or consuming
  the newly published `tablesok` parameter queue.
- Raising iteration or wall-clock limits.
- Changing the shared runtime helper trampoline.
- Runtime cutover, KIR v1 freeze, semantic self-hosting, RC/stable release,
  Fable work, or a KERN 5 completion claim.

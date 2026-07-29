# KERN 5 R2 M4.118 — Authenticated Triple-Row Profile Promotion

**Status:** IMPLEMENTED AND VERIFIED LOCALLY
**Date:** 2026-07-29
**Confidence:** 0.97

## Executive Summary

[VERIFIED] M4.114 selected exactly one actionable structural-profile change:
raise `maxNodeRows`, `maxPropertyRows`, and `maxValueRows` from
`89/125/2100` to `122/193/2411`. The only completing witness is
`examples/capstone-checker-subset/checker.kern#24:checkModule`, with 58 legacy
parameter rows.

[VERIFIED] M4.117 authenticated the candidate at an exact runtime floor of
38,693 retained iterations, leaving 10,459 iterations of promotion-budget
headroom and 26,843 iterations of production headroom. Its receipt explicitly
hands the decision to M4.118 without approving the promotion itself.

[DECIDED] M4.118 will promote only the three authenticated profile limits,
freeze the exact causal M4.114 and M4.117 inputs, and publish the one-function
58-row queue for M4.119. It will not rewrite `checkModule`.

## Contract

| Behavior | Evidence | Tag |
|---|---|---|
| Candidate profile is exactly `122/193/2411` | M4.114 selected action and M4.117 limits | VERIFIED |
| Only `checkModule` completes under the promoted profile | M4.114 actionable frontier | VERIFIED |
| Queue has one checker function and 58 parameter rows | migrated witness facts | VERIFIED |
| Exact runtime floor remains 38,693 | M4.117 receipt | VERIFIED |
| Promotion-budget headroom remains 10,459 | M4.117 receipt | VERIFIED |
| Runtime maximum collection length stays 65,536 | current policy and M4.117 | VERIFIED |
| KIR maximum depth stays 76 | current policy | VERIFIED |
| M4.119, not M4.118, consumes the queue | milestone separation | DECIDED |

## Implementation

1. Add an M4.118 promotion owner exposing immutable copies of the active
   profile and exact parameter queue.
2. Bind that owner to the exact M4.114 selected action and byte-digested M4.117
   receipt.
3. Promote only `policy.json.profileLimits`.
4. Rebase the three over-limit fixtures one row beyond the new ceilings.
5. Update current-policy/frontier assertions and central status output so the
   prerequisite summary publishes one function / 58 rows ready for M4.119.
6. Keep M4.117 loadable as immutable historical evidence after the live policy
   changes.

## Acceptance Criteria

- [x] RED tests fail because the M4.118 owner and promoted policy are absent.
- [x] M4.118 consumes the exact M4.114 `122/193/2411` selected action.
- [x] M4.118 pins the exact M4.117 receipt bytes.
- [x] Current policy changes only the three profile row limits.
- [x] Runtime and KIR limits remain byte-for-byte unchanged.
- [x] The new queue is exactly one function, one tool, and 58 parameter rows.
- [x] The only queue witness is `checker.kern#24:checkModule` with structural
      rows `122/193/2411`.
- [x] Current coverage stays 101/112 base-complete before queue consumption.
- [x] Current prerequisite status becomes one function / 58 rows ready, with
      five residual legacy-parameter blockers.
- [x] Over-limit fixtures reject exactly 123 nodes, 194 properties, and 2,412
      values.
- [x] M4.117 remains immutable historical evidence and does not live-remeasure
      against the promoted policy.
- [x] Full Node 22 KERN 5 fitness and mandatory high-risk role review pass.
- [ ] Signed commit is fetched/rebased and pushed once to `main`.

## Out of Scope

- Rewriting `checkModule` to direct parameters; M4.119 owns consumption.
- Any runtime, KIR, handler ABI, canonicalizer source, or composition change.
- Any promotion for the other five residual functions.
- KIR v1 freeze, runtime cutover, semantic self-hosting, or a KERN 5 completion
  claim.

## Deploy Order

The promotion owner, policy change, fixtures, current summaries, and status
assertions publish atomically in one rebased push.

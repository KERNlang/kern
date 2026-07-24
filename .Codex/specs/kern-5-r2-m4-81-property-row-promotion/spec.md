# KERN 5 R2 M4.81 — Property-Row Profile Promotion

**Status:** RELEASE CANDIDATE — REVIEW FIXES APPLIED; PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.80 commit
`fef8b1ef09f5d122a9239d1e85dbd9fb359c3696` reduces the exact
`checkWhileCore` structural canonicalization floor from 56,238 to 35,998.
That is 13,154 iterations below the fixed 49,152 promotion budget and 29,538
below the unchanged 65,536 production ceiling.

[DECIDED] M4.81 consumes only that authenticated runtime evidence to raise
`maxPropertyRows` from 53 to 61. It keeps `maxNodeRows=38`,
`maxValueRows=461`, runtime limits, KIR limits, canonicalizer source, parser,
ABI, and package versions unchanged. The promotion must expose exactly the
one-function/22-parameter-row `checkWhileCore` migration queue for M4.82.

## Published Input

[VERIFIED] This branch
`feat/kern-5-r2-m4-81-property-row-promotion` starts at exact `origin/main`
commit `fef8b1ef09f5d122a9239d1e85dbd9fb359c3696`.

[VERIFIED] The immutable M4.80 input is bound by:

- runtime receipt SHA-256
  `48465b28f951d5f74a1ea148d2c21a1f28d3dcb13c475ed5885d7c0512046b14`;
- exact floor 35,998, promotion headroom 13,154, and production headroom 29,538;
- active profile 38/53/461 and candidate profile 38/61/461;
- canonicalizer policy SHA-256
  `ac4983323d0e9da875e75ae12aff079d8d52deee069d77f703280a06f2f42244`;
- coverage policy SHA-256
  `56ae4deb67877ac56789a4cbf8a069a90165fabe628df6daf389486593dfd8a8`;
- coverage summary SHA-256
  `5822f372b8b4bf52afdd7361fa99b84430edc2927a4b3cd05fc42fcd34361dc0`;
  and
- prerequisite summary SHA-256
  `5fbaed9502ca12ad508f0977f0190dba1e6dd899dc8de273281c329a2566535d`.

## Implementation Plan

1. Add a RED M4.81 promotion contract proving the current 53-row property
   limit still yields an empty migration queue.
2. Raise only `profileLimits.maxPropertyRows` to 61 and update the exact
   over-property fixture boundary to 62.
3. Regenerate current coverage/prerequisite artifacts so the published M4.81
   prerequisite summary contains exactly `checkWhileCore` with 22 parameter
   rows and measured witness rows 38/61/460. M4.82 freezes those published bytes before
   consuming the queue, matching the established promotion/consumption split.
4. Bind M4.81 into the terminal checker/status chain while preserving all
   M4.80 and older receipt bytes.
5. Run focused, complete canonicalizer, full Node 22 fitness, high-risk
   independent review, signed commit, fetch/rebase, and one atomic push.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.80 commit.
- [x] RED proved the current 53-row policy could not expose the M4.81 queue:
      the promotion contract observed 53 instead of 61 and an empty queue.
- [x] Active profile becomes exactly 38/61/461 and no other policy limit moves.
- [x] M4.80 receipt bytes and digest remain unchanged.
- [x] M4.81 handoff contains exactly one checker witness, 22 parameter rows,
      and profile rows 38/61/460.
- [x] Current coverage remains 81/105 base-complete with 23 legacy parameter
      blockers before M4.82 consumes the queue.
- [x] Current prerequisite outcome remains bounded exhaustion after publishing
      exactly the M4.81 parameter queue; residual population becomes 22.
- [x] The over-property fixture rejects the exact measured 31/62/99 boundary
      and admits only a policy widened
      to 62; node/value fixture boundaries remain unchanged.
- [x] Runtime ceiling remains 65,536 and KIR depth remains 64.
- [x] No canonicalizer source, parser, runtime, KIR, ABI, package version, or
      public API changes.
- [x] Focused gates, complete canonicalizer, terminal checker, and complete
      Node 22 `fitness:kern-5` wall pass.
- [x] Independent high-risk 6/6 review completed; its two verified
      maintainability findings were resolved by centralizing live frontier and
      profile assertions in `coverage-current.mjs`.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Stop Conditions

- The promoted profile exposes any witness other than `checkWhileCore`.
- The exact M4.80 receipt or any older historical receipt must change.
- Promotion requires a runtime, KIR, parser, ABI, or canonicalizer-source edit.
- The 35,998 exact boundary no longer reproduces under the promoted profile.

## Out of Scope

- Migrating `checkWhileCore`'s 22 legacy parameter rows.
- Any additional profile widening or runtime optimization.
- Module-envelope admission, stable KIR, semantic self-hosting, release
  readiness, or a KERN 5 completion claim.

## Verification Evidence

[VERIFIED] The regenerated current artifacts are byte-stable under the
no-write checker:

- prerequisite summary SHA-256
  `d41669c95edfab7e6a088abd14841f93fd49ea9c0daa4a0369230effb8859e7d`;
- coverage summary SHA-256
  `2e67eefaab84bab79dd9b3417dd81d2329c29c0d34af560e248a3a4f3b2f3415`;
- M4.80 receipt SHA-256 remains
  `48465b28f951d5f74a1ea148d2c21a1f28d3dcb13c475ed5885d7c0512046b14`;
  and
- M4.79 receipt SHA-256 remains
  `d8683f1440e8bb0f8496ab1845c83c7dabe73dbfd26114b78685d8c8e1cf830b`.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passed on
2026-07-20, including 307 canonicalizer/convergence tests, the exhaustive
canonicalizer checker, and the terminal M4.81 status assertion.

[VERIFIED] Agon high-risk role review run
`review-1784877286575-ki25hi` completed 6/6. The security and correctness
lenses were clean. Two verified maintainability findings identified that
historical milestone tests duplicated current policy and frontier assertions;
the review fix moved those assertions behind one current-state contract. Its
affected 84-test regression set and the regenerated no-write checker pass.

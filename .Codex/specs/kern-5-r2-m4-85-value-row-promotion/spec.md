# KERN 5 R2 M4.85 — Value-Row Profile Promotion

**Status:** RELEASE CANDIDATE — REVIEW GREEN / PUSH PENDING
**Date:** 2026-07-24
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.84 commit
`a3500db5921b4cabe6781022d391fa6c3494f71b` authenticates the exact
`argProvenanced` structural runtime floor at 38,773. The immutable 49,152-step
promotion budget leaves 10,379 steps of headroom, so its receipt approves a
single value-row profile promotion for M4.85.

[DECIDED] M4.85 changes only the canonicalizer coverage profile's
`maxValueRows` ceiling from 461 to 580. Node rows remain 38, property rows
remain 61, production collection length remains 65,536, and KIR depth remains
64. The promoted profile must expose exactly one 19-parameter migration queue
entry for `argProvenanced`; it does not consume that queue. KERN 5 remains
incomplete.

## Published Input

[VERIFIED] Branch `feat/kern-5-r2-m4-85-value-row-promotion` starts from clean
`origin/main` at exact commit
`a3500db5921b4cabe6781022d391fa6c3494f71b`.

[VERIFIED] The exact M4.84 handoff is:

- receipt SHA-256
  `4b92ced7a43f4aa938a9fe303edcd5fb17b423a61d99b9a8c476ccdc653b8065`;
- candidate profile 38 node rows, 61 property rows, and 580 value rows;
- witness `examples/capstone-checker-subset/checker.kern#16:argProvenanced`;
- 19 parameter rows and structural rows 35/55/580;
- exact floor 38,773, promotion headroom 10,379, and production headroom
  26,763;
- promotion disposition `approved` with next milestone `M4.85`; and
- module-envelope admission explicitly not claimed.

## Promotion Contract

[DECIDED] The active policy transition is exactly:

| Limit | Before | After |
|---|---:|---:|
| `maxNodeRows` | 38 | 38 |
| `maxPropertyRows` | 61 | 61 |
| `maxValueRows` | 461 | 580 |

[DECIDED] After promotion, current measurement must preserve:

- 83/105 authored functions are profile-complete after the ceiling moves (the
  separately published 19-row parameter queue remains unconsumed);
- 22 authored functions still carrying legacy `fn.params` rows;
- no ordinary family winner and bounded exception-flow exhaustion;
- exactly one parameter-ready function in one tool;
- exactly 19 queued parameter rows; and
- witness identity and rows exactly
  `argProvenanced`, 19 parameters, 35/55/580.

[DECIDED] The independent over-limit fixture must move to exactly 581 value
rows while staying within the active node/property ceilings. Historical
receipts and historical profile assertions retain their published values.

## Implementation Plan

1. Add a focused test importing the absent M4.85 promotion module and capture
   RED at the missing-module boundary.
2. Add an exact promotion contract bound to the immutable M4.84 receipt, then
   change only `policy.json.profileLimits.maxValueRows` to 580.
3. Update the current-policy/current-frontier assertions and the exact
   over-value profile fixture without rewriting historical evidence.
4. Wire M4.85 into the terminal coverage checker and status formatter; write
   the current coverage and prerequisite summaries only after `.mjs` bytes
   settle.
5. Run focused tests, the complete canonicalizer wall, and full Node 22 KERN 5
   fitness; then run automatic high-risk role-lens review.
6. Create one Agon-signed commit, fetch/rebase `origin/main`, and atomically
   push the feature branch and `main` once with `--no-verify`.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.84 commit `a3500db5`.
- [x] RED fails at the intended absent M4.85 module boundary.
- [x] Exact M4.84 receipt and GO decision are authenticated before promotion.
- [x] Only `maxValueRows` moves from 461 to 580.
- [x] Current measurement exposes exactly one function and 19 parameter rows.
- [x] Profile-limit fixtures reject 581 rows and admit 580.
- [x] Historical receipts and active runtime/KIR limits remain unchanged.
- [x] Focused, complete canonicalizer, and full Node 22 fitness gates pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- M4.84 receipt digest, floor, GO disposition, witness, or candidate profile
  differs from the published handoff.
- Current measurement exposes any queue other than the one published by
  M4.83/M4.84.
- Promotion changes node/property, production runtime, KIR depth, base profile,
  KERN source, parser, runtime ABI, or a historical receipt.
- The 580-row boundary cannot be independently rejected at 581.

## Plan Delta

[VERIFIED] The initial plan expected the promotion to preserve 82/105 until
the parameter queue was consumed. Direct measurement corrected that model:
profile promotion itself clears `argProvenanced`'s value-row blocker and moves
the authored coverage count to 83/105, while `fn.params` remains explicit and
the 19-row migration queue is still unconsumed. The implementation now binds
those two facts independently instead of forcing the pre-measurement count.

## Verification Evidence

[VERIFIED] The focused M4.85 contract passes 4/4 and the adjacent current,
historical, status, fixture, and runtime regression set passes 61/61. After
correcting six intentionally stale pre-promotion assertions, the complete
canonicalizer Node suite passes 329/329, including independent reproduction of
the historical 35,998 and 38,773 runtime floors.

[VERIFIED] Composition and semantic CLI validation pass, and the deterministic
aggregate passes 55 golden/idempotence/KIR fixtures, eight measured witnesses,
three profile-limit fixtures, and 235 hostile fixtures. The exact over-value
fixture was measured through parser, structural KIR, and table flattening at
29/32/581 after the first arithmetic construction measured only 575.

[VERIFIED] The settled current coverage summary SHA-256 is
`081161626b2d02e3cfe310d6c3abcf8ba6ca333f5747cac3fbc2ebba546a0c74`;
the prerequisite summary SHA-256 is
`8f11e49073b1f57f3f7906f0bc2e30b7b48a2f8c47178f2e0927d6bd1c178772`;
the policy SHA-256 is
`a929434c674ecbed5688eb36235f81c203d5d0eb4a34583554caad116960614c`;
and both current summaries bind coverage implementation digest
`5fe10fdb7fb3a339071578ce1dce729bbaaf5a578371d5e41b8e1b73e81d8f99`.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall exited zero. Its
terminal marker was `KERN 5 current fitness wall passed.` The terminal
canonicalizer replay passed 329/329 tests and reported the exact current
frontier as 83/105 base-complete, 22 `fn.params` blockers, and one
function/19 rows parameter-ready for M4.86.

[VERIFIED] High-risk role-lens review
`review-1784894934505-ehlwmx` completed with all 6/6 usable reviewers. The
consensus reported zero verified findings, three needs-check candidates, and
11 nits. Two candidates correctly identified stale documented generated-file
hashes; those values were rebound after the final writer pass. The remaining
candidate concerned M4.83's historical regeneration entry point. Direct
comparison with the already-promoted M4.78 analyzer confirmed this is the
established archival contract: old analyzers reject later active policy
states before writing. A regression now binds that M4.83's exported measure
and `--write` paths fail closed without changing its immutable receipt after
M4.85 promotion. The focused historical test passes 5/5.

## Out of Scope

- Consuming the 19-row parameter queue; that is the next milestone.
- Changing canonicalizer implementation or runtime cost.
- Module-envelope admission, projection depth/nodes, unknown expressions,
  exception-flow, KIR freeze, runtime cutover, release versioning, or Fable.

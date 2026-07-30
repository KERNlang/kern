# KERN 5 R2 M4.146 — Authenticated Combined KIR/Profile Promotion

**Status:** REVIEWED — PENDING PUBLISH
**Date:** 2026-07-30
**Base:** `74c6b523fb5a534bd85ffe7513dc429404b40ea9`
**Confidence:** 0.98

## Executive Summary

[VERIFIED] M4.144 selected exactly one actionable combined projection:
`examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources`, with six
structured parameter rows, structural KIR limits 367368/122/7136, and
table-profile limits 205/332/6304.

[VERIFIED] M4.145 authenticated the candidate's exact structural boundaries,
public/internal runtime parity, and exact runtime iteration floor of 43,054.
That leaves 6,098 iterations of promotion-budget headroom and 22,482
iterations of production headroom.

[VERIFIED] The checked-in M4.145 receipt has SHA-256
`e61beda6a311742d0475fdcd52ab0147cffe74300c1ee339ea79acceb3f147ba`,
declares the candidate promotion ready, and names M4.146 as the next milestone.

[DECIDED] M4.146 promotes the six authenticated KIR/profile ceilings plus the
two exact factor-derived runtime byte ceilings, keeps every unrelated policy
field unchanged, and publishes the exact one-function/six-row
`expressionsources` migration queue. M4.147, not M4.146, consumes that queue.

## Inputs

- [VERIFIED] Current live KIR limits are 273051/98/5313.
- [VERIFIED] Current live profile limits are 202/308/4493.
- [VERIFIED] Current runtime string/envelope byte limits are
  1092204/2184408.
- [VERIFIED] Expansion factors remain exactly 4/2.
- [VERIFIED] Runtime collection iterations remain 65,536 and depth remains 64.
- [VERIFIED] Candidate KIR maxBytes 367368 requires exact runtime byte ceilings
  1469472 and 2938944 under the unchanged 4/2 factors.
- [VERIFIED] Current cumulative coverage is 110/112 and the remaining legacy
  parameter blockers are `quotesource` and `expressionsources`.

## Contract

| Claim | Tag |
|---|---|
| Promote KIR maxBytes/maxDepth/maxNodes to 367368/122/7136 | DECIDED |
| Promote profile maxNodeRows/maxPropertyRows/maxValueRows to 205/332/6304 | DECIDED |
| Promote runtime maxStringBytes/maxBytes to exact derived 1469472/2938944 | DECIDED |
| Preserve expansion factors at 4/2 and every unrelated KIR/runtime field | DECIDED |
| Preserve runtime/handler ABI, corpus, canonicalizer source, and signatures | DECIDED |
| Bind the exact M4.145 GO receipt and all candidate/witness facts | DECIDED |
| Publish exactly `canonicalizer.kern#3:expressionsources`, six rows, one tool | DECIDED |
| Return immutable copies of every published limit and queue | DECIDED |
| Preserve the M4.145 receipt bytes and make its historical measurement executable | DECIDED |
| Keep cumulative coverage at 110/112 and do not migrate `expressionsources` | DECIDED |

## Design

### Promotion owner

Add one M4.146 owner exposing immutable copies of the active KIR limits,
profile limits, exact derived runtime byte limits, and one-function/six-row
parameter queue.

Its assertion loads and validates the exact M4.145 receipt, independently
checks its SHA-256, and binds:

- candidate KIR 367368/122/7136;
- candidate profile 205/332/6304;
- exact floor 43,054;
- promotion/production headroom 6,098/22,482;
- successful structural and runtime round trips;
- public and observer parity;
- exactly one `expressionsources` witness with six parameter rows.

### Policy transition

Update only the six selected KIR/profile fields and the two derived runtime
byte fields in `policy.json`. Update current-policy assertions and the three
one-over profile-limit fixtures to the newly active profile ceilings. The
policy validator continues enforcing the factor relationships and must reject
either derived runtime byte ceiling one below the required product.

### Queue boundary

M4.146 publishes but does not consume:

```text
1 function / 1 tool / 6 parameter rows
examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources
profile rows 205/332/6304
```

The live coverage/prerequisite summaries therefore remain at 110/112 with the
same two legacy blockers. M4.147 owns source migration and cumulative coverage
advancement.

### Historical evidence

The pre-M4.146 policy is reconstructed from the new live policy by replacing
only the promoted fields and verifying the archived policy digest. M4.145
loads that reconstructed policy for its historical receipt and measurement.
Its measurement source is reconstructed to the archived SHA-256 before source
identity validation. The checked-in M4.145 JSON bytes are never rewritten.

## Implementation Plan

1. Add RED tests for the promotion owner, exact queue, status, current policy,
   historical policy, and archival M4.145 execution.
2. Implement the M4.146 owner and status formatter; update the six selected
   limits, two derived byte ceilings, and current one-over fixtures.
3. Introduce exact pre-M4.146 policy/source reconstruction so M4.145 remains
   byte-identical and executable.
4. Wire M4.146 into the production coverage gate and regenerate derived
   summaries twice to prove convergence without coverage advancement.
5. Run focused tests, full canonicalizer tests, complete KERN 5 fitness, and
   `agon review` with the full usable roster before one rebased push.

## Acceptance Criteria

- [x] RED tests fail before the M4.146 owner/policy exists.
- [x] Policy KIR limits are exactly 367368/122/7136.
- [x] Policy profile limits are exactly 205/332/6304.
- [x] Runtime maxStringBytes/maxBytes are exactly 1469472/2938944.
- [x] Expansion factors remain exactly 4/2 and unrelated limits are unchanged.
- [x] Either derived byte ceiling one below its exact product fails validation.
- [x] The owner consumes the exact M4.145 receipt SHA and complete GO facts.
- [x] The queue contains only `expressionsources`, six rows, and one tool.
- [x] Returned limits and queue copies cannot mutate the published contract.
- [x] M4.145 checked-in receipt bytes remain byte-identical and executable.
- [x] Current coverage remains 110/112 with two legacy parameter blockers.
- [x] Derived summaries converge byte-identically on a second generation.
- [x] Full canonicalizer and KERN 5 fitness gates pass.
- [x] Full-roster Agon review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main verifies.

## Stop Conditions

- The M4.145 receipt SHA or any checked-in receipt byte changes.
- Any promoted field differs from the exact M4.145 candidate.
- Exact 4/2-derived runtime ceilings are insufficient.
- Unrelated policy, handler ABI, corpus, signatures, or canonicalizer behavior
  changes.
- Cumulative coverage advances or either legacy blocker disappears in M4.146.
- M4.145 historical receipt validation or measurement cannot be preserved.

## Out of Scope

- Migrating `expressionsources` parameters or advancing cumulative coverage.
- Resolving `quotesource`.
- KIR v1 freeze, compiler/frontend/interpreter completion, fixed-point
  self-hosting, packed release, KERN 5 completion, or Fable.

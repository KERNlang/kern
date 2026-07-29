# KERN 5 R2 M4.130 — Authenticated Combined KIR/Profile Promotion

**Status:** REVIEWED — PENDING PUBLISH
**Date:** 2026-07-29
**Confidence:** 0.98

## Executive Summary

[VERIFIED] M4.126 selected exactly one actionable combined projection:
`examples/selfhost-validator/validator.kern#20:validate`, with 41 structured
parameter rows, structural KIR limits 273051/98/5313, and table-profile limits
202/308/4493.

[VERIFIED] M4.127 authenticated the candidate's structural boundaries and
production envelope but rejected promotion because its 54,894 exact floor
exceeded the 49,152 promotion budget by 5,742 iterations.

[VERIFIED] M4.128 attributed 8,986 iterations to two assignment-target
`recordfield` scans. M4.129 removed those scans by reusing the authenticated
type-field projection and measured an exact floor of 45,908, leaving 3,244
iterations of promotion-budget headroom.

[VERIFIED] The six-field promotion alone is not a valid live policy:
`runtimeLimits.maxStringBytes` must cover `kirLimits.maxBytes * 4`, and
`runtimeLimits.maxBytes` must cover `runtimeLimits.maxStringBytes * 2`.
At the selected byte boundary, the exact required runtime ceilings are
1,092,204 and 2,184,408.

[DECIDED] M4.130 promotes the six authenticated KIR/profile ceilings plus those
two exact derived runtime byte ceilings, keeps both expansion factors
unchanged, and publishes the exact one-function/41-row `validate` migration
queue. M4.131, not M4.130, consumes that queue.

## Inputs

- [VERIFIED] M4.126 receipt SHA-256:
  `25f1ba6ed40efdff909a6c95a11c385c12f9eba2b0025375ed4943f14393e369`.
- [VERIFIED] M4.129 receipt SHA-256:
  `e4bd57760198241cbe295ef6dcc7e35b1b7ddbb41026ca066d4016de0cfccd7c`.
- [VERIFIED] M4.129 published commit:
  `a59e954457a41119e326ccc377456c99afe6913b`.
- [VERIFIED] Runtime collection iterations remain 65,536 and depth remains 64.
- [VERIFIED] Runtime byte ceilings must move from 1,048,576/2,097,152 to the
  exact factor-derived 1,092,204/2,184,408 for the promoted KIR byte ceiling.
- [VERIFIED] Current active limits are KIR 262144/77/4096 and profile
  122/193/2411.

## Contract

| Claim | Tag |
|---|---|
| Promote KIR maxBytes/maxDepth/maxNodes to 273051/98/5313 | DECIDED |
| Promote profile maxNodeRows/maxPropertyRows/maxValueRows to 202/308/4493 | DECIDED |
| Preserve all non-promoted KIR limits byte-for-byte | DECIDED |
| Promote runtime maxStringBytes/maxBytes to exact derived 1092204/2184408 | DECIDED |
| Preserve expansion factors at 4/2 and every other runtime limit | DECIDED |
| Preserve runtime/handler ABI | DECIDED |
| Bind the exact M4.126 selection and exact M4.129 GO receipt | DECIDED |
| Publish exactly `validator.kern#20:validate`, 41 rows, one tool | DECIDED |
| Keep the queue immutable to callers | DECIDED |
| Preserve M4.127-M4.129 receipts as byte-identical archival evidence | DECIDED |
| Do not migrate `validate` or advance cumulative coverage in M4.130 | DECIDED |

## Design

### Promotion owner

Add one M4.130 owner exposing immutable copies of:

- the active combined KIR limits;
- the active table-profile limits;
- the exact one-function/41-row parameter migration queue.

Its assertion binds the published M4.126 selected action and the M4.129
runtime-cost receipt, including failure at 45,907, success/roundtrip at 45,908,
zero `recordfield` executions, one type-field table projection, and 3,244
iterations of promotion-budget headroom.

### Policy transition

Update the six selected fields and the two exact derived runtime byte ceilings
in `policy.json`. Current-policy assertions, profile-boundary fixtures, and
derived coverage summaries move to those exact limits. The cumulative base
remains 103/112 and the four legacy-parameter functions remain unchanged until
M4.131.

The live-policy owner proves both factor equalities and rejects either derived
runtime ceiling one below its required value. M4.130 references prior receipts
as historical structural/runtime-iteration evidence; it does not edit their
immutable bytes.

### Historical evidence

Any M4.125-M4.129 owner or measurement that needs the pre-promotion policy must
reconstruct the exact old policy bytes rather than rewriting an old receipt.
Checked-in M4.127, M4.128, and M4.129 JSON receipts remain byte-identical.

## Implementation Plan

1. Add RED promotion-owner, queue, status, and current-policy tests.
2. Implement the M4.130 owner and status formatter, then update the six selected
   ceilings, the two exact derived runtime byte ceilings, and current boundary
   fixtures.
3. Preserve pre-M4.130 policy identities in historical analyses and runtime
   evidence; keep all published receipt bytes unchanged.
4. Wire the M4.130 assertion/status into the central coverage gate and
   regenerate derived summaries twice to prove convergence.
5. Run focused tests, complete canonicalizer tests, full KERN 5 fitness, and
   high-risk role-lens review; fix verified findings, rebase, and push once.

## Acceptance Criteria

- [x] RED tests fail before the M4.130 owner/policy exists.
- [x] Policy KIR limits are exactly 273051/98/5313.
- [x] Policy profile limits are exactly 202/308/4493.
- [x] Runtime maxStringBytes/maxBytes are exactly 1092204/2184408.
- [x] Expansion factors remain exactly 4/2, and all other runtime and unrelated
      KIR fields are unchanged.
- [x] Either derived runtime byte ceiling one below its required product fails
      live policy validation.
- [x] The owner consumes the exact M4.126 selected action.
- [x] The owner consumes the exact M4.129 promotion-ready receipt.
- [x] The published queue contains only `validator.kern#20:validate`, 41 rows,
      and one tool.
- [x] Queue copies cannot mutate the published handoff.
- [x] M4.127-M4.129 receipts remain byte-identical and executable.
- [x] Current cumulative coverage remains 103/112 with four legacy blockers.
- [x] Derived summaries converge byte-identically on a second generation.
- [x] Complete canonicalizer and full KERN 5 fitness gates pass.
- [x] High-risk automatic role-lens review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main verifies.

## Verification Evidence

- [VERIFIED] `pnpm fitness:kern-5` passed the complete KERN 5 wall, including
  593/593 canonicalizer tests and the production checker with 55 golden,
  8 measured, 3 profile-limit, and 235 hostile fixtures.
- [VERIFIED] The production coverage gate reports 103/112 base-complete and
  publishes the exact M4.131 queue as one function, 41 rows, and one tool.
- [VERIFIED] The six-engine role-lens review completed 6/6 with zero verified
  findings and no unresolved material finding. Four `needs-check` candidates
  were traced to intentional current-policy binding, exact archival snapshots,
  or the production-exercised 4,494-row boundary fixture.

## Stop Conditions

- M4.129 exact floor or observer parity cannot be reproduced.
- Any promoted field differs from M4.126's selected action.
- Expansion factors, unrelated runtime policy, handler ABI, corpus, signatures,
  or cumulative base changes.
- M4.127-M4.129 checked-in receipt bytes change.
- The active frontier gains or loses a function before M4.131 migration.
- Promotion requires expanding beyond the six selected ceilings and two exact
  factor-derived runtime byte ceilings.

## Out of Scope

- Migrating `validate` parameters or advancing cumulative coverage.
- Resolving the remaining `quotesource`, `expressionsources`, or `canonicalize`
  blockers.
- KIR v1 freeze, runtime cutover, semantic self-hosting, RC/stable release,
  Fable, or a KERN 5 completion claim.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| The six selected KIR/profile fields could be promoted with runtime policy unchanged. | The live policy validator couples KIR maxBytes to runtime string/envelope byte ceilings through exact 4x and 2x factors. | M4.130 also promotes runtime maxStringBytes/maxBytes to 1092204/2184408 and adds live-policy adjacency evidence. |

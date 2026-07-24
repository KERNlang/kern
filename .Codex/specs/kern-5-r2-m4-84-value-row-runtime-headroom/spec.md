# KERN 5 R2 M4.84 — Value-Row Structural Runtime Headroom

**Status:** RELEASE CANDIDATE — REVIEW GREEN / PUSH PENDING
**Date:** 2026-07-20
**Confidence:** 0.94

## Executive Summary

[VERIFIED] Published M4.83 commit
`6a5dea4687b54600778d62cf21855443567959e6` freezes the exact current
22-function residual frontier and selects candidate profile 38/61/580. The
selected cohort is exactly one legacy-parameter checker function with 19
parameter rows.

[DECIDED] M4.84 is evidence-only. It authenticates the exact structural
runtime floor for that counterfactually migrated function through the public
`kern.runtime.handler.v1` boundary. It does not change the active 38/61/461
profile, KERN source, generated consumers, parser, runtime, KIR, ABI, package
versions, or public APIs. The measured floor alone determines whether M4.85
may promote the value-row ceiling or must instead own a runtime-cost
reduction. KERN 5 remains incomplete.

## Published Input

[VERIFIED] Branch `feat/kern-5-r2-m4-84-value-row-headroom` starts from clean
`origin/main` at exact commit
`6a5dea4687b54600778d62cf21855443567959e6`.

[VERIFIED] The immutable M4.83 handoff is:

- receipt SHA-256
  `42815f7d4bd02daa625718deb8b8ae04590efb605dccc69ffc90b3a4bdcbf546`;
- residual-analysis input commit
  `89083ba126201067c918ea7e130382ca171f4097`;
- assignment digest
  `37f914f5ccfce7a4cb86c1235939e760a133936c22775f3a1d25043ea7c7dcec`;
- selected limits 38 node rows, 61 property rows, and 580 value rows;
- one function in tool `checker` and 19 total parameter rows;
- unchanged production collection ceiling 65,536 and KIR depth 64; and
- active profile remains 38/61/461 before any later promotion.

[VERIFIED] The exact published M4.83 evidence is additionally bound by:

- coverage implementation digest
  `e02d1e500c4ddfd668b11854bed8d69c04d0fc79d0adb9484f6d9838ab76c301`;
- coverage-summary SHA-256
  `cb38681a9ad87434c85eef3295e5a7cef4957af2397f75186a9496fc82d9153d`;
- prerequisite-summary SHA-256
  `1236bd16b762ee0a115a31487f622a77662e609520e1a7e15fb48e784820c5d0`;
  and
- coverage-policy digest
  `e4a310720a9f41d9c0d8b9340177d5df634d1add5209420fe600ebef46e78da6`.

## Witness Contract

| Witness | Params | Structural rows | Required reasons |
|---|---:|---:|---|
| `examples/capstone-checker-subset/checker.kern#16:argProvenanced` | 19 | 35/55/580 | `profile.rows.values` |

[DECIDED] The witness is parsed from its authenticated handwritten source and
counterfactually migrated with `migrateLegacyFunctionForPrerequisite`. The
migrated function is structurally encoded and decoded, flattened, and executed
through the public runtime handler with exact candidate limits 38/61/580.

[VERIFIED] Bound source SHA-256 values before implementation are:

- checker source
  `a703952e717a77015179987a4e5a6940b0b16846a9c122810e959a595eee5017`;
- canonicalizer composite
  `fe5087dfcb79898a4b5d46cd233a2bbbeea156417f18ac314e87330172e31b28`;
- canonicalizer policy JSON
  `6506df16bb042ae3c5544fce3324c500e2401192983fc98ae492d2283ff21495`;
- composition JSON
  `894cf14bc391d3109a20fb6abef8d1c98cab426e2ed6d238d414c8aee46cff3b`;
  and
- structural KIR codec
  `04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab`.

## Headroom Contract

[DECIDED] The promotion budget remains policy-derived as three quarters of the
65,536 production ceiling: 49,152 steps, preserving 16,384 reserved production
headroom. The witness floor must be found by monotonic runtime execution rather
than estimated or selected to fit the budget.

[DECIDED] M4.84 must prove:

1. exact M4.83 receipt, selection, assignment, source, and active-profile
   identity;
2. exact counterfactual migration to 19 direct parameters and 35/55/580 rows;
3. execution at `exactFloor - 1` fails with the canonical
   `unsupported-runtime-input` envelope;
4. execution at `exactFloor` succeeds with no diagnostics or events;
5. returned source reparses and structurally encodes byte-identically;
6. the exact floor is compared against the precommitted 49,152-step budget;
7. positive headroom or a required reduction is exact arithmetic; and
8. module-envelope admission remains explicitly outside this structural claim.

[DECIDED] If the floor is at most 49,152, publish `approved` and route M4.85 to
profile promotion. If it exceeds 49,152 but remains within 65,536, publish
`rejected-over-budget` and route M4.85 to reduce the floor by the exact deficit.
No limit may be weakened to force a GO result.

[VERIFIED] Authenticated binary search and independent boundary execution found
the exact floor at 38,773: 38,772 returns the canonical
`unsupported-runtime-input` failure envelope and 38,773 succeeds, returns no
diagnostics or events, and round-trips to byte-identical structural KIR. This
leaves 10,379 steps of promotion headroom and 26,763 steps of production
headroom. M4.84 therefore publishes `approved` and routes M4.85 to value-row
profile promotion.

## Implementation Plan

1. Add a focused test importing the absent M4.84 receipt module and capture
   RED at the missing-module boundary.
2. Build the exact migrated witness from published M4.83 identity, binary
   search the monotonic execution boundary, then directly prove floor-minus-one
   failure and floor success with byte-identical structural round-trip.
3. Freeze one canonical M4.84 value-row headroom receipt with exact source,
   policy, summary, and residual-handoff bindings plus tree-only and
   regular-file/non-symlink enforcement.
4. Add mutation, history, fresh-process, independent runtime-boundary, status,
   and terminal-checker tests without changing active policy.
5. Regenerate only current summaries after all `.mjs` bytes settle; run focused,
   complete canonicalizer, and full Node 22 fitness gates.
6. Run automatic high-risk role-lens review, resolve verified findings, make
   one signed commit, fetch/rebase, and atomically push once with `--no-verify`.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.83 commit `6a5dea46`.
- [x] Exact M4.83 selection and witness assignment are grounded.
- [x] RED fails at the intended missing M4.84 receipt boundary.
- [x] Exact runtime floor is measured and authenticated at both sides.
- [x] Output round-trips to byte-identical structural KIR.
- [x] Receipt publishes the evidence-derived GO without policy drift.
- [x] Receipt is canonical, source-bound, regular-file-only, and tree-only.
- [x] Module-envelope admission remains explicitly unclaimed.
- [x] No active product or profile surface is authorized to change.
- [x] Focused, complete canonicalizer, and full Node 22 fitness gates pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- M4.83 digest, input commit, selection, assignment, or source bytes drift.
- The selected function no longer counterfactually migrates to exactly
  35/55/580 rows with 19 parameters.
- Runtime success is not monotonic at the measured collection boundary.
- The exact floor exceeds 65,536 or round-trip identity fails.
- Evidence requires changing the active profile, runtime, KIR, ABI, or any
  historical receipt.

## Plan Delta

[VERIFIED] The initial contract left GO versus NO-GO deliberately unresolved.
Real execution resolved that dependency in favor of GO: the exact 38,773 floor
fits the immutable 49,152 budget with 10,379 steps to spare. No runtime-cost
slice or policy weakening is needed; M4.85 may authenticate only the selected
value-row promotion.

[VERIFIED] High-risk role-lens review kept the initial evidence-only approach
unchanged. Reviewers independently confirmed the digest chain, boundary proof,
structural round-trip, integration wiring, and unchanged active profile. The
only observations were 15 non-material nits about established receipt-module
duplication, redundant defense-in-depth validation, future pluralization, and
theoretical hardening outside this immutable milestone. None exposed a current
correctness, security, performance, or release dependency, so no scope-expanding
historical refactor was admitted. Confidence after review is 0.99.

## Verification Evidence

[VERIFIED] The canonical M4.84 receipt SHA-256 is
`4b92ced7a43f4aa938a9fe303edcd5fb17b423a61d99b9a8c476ccdc653b8065`.
After all implementation bytes settled, the current coverage-summary and
prerequisite-summary SHA-256 values are
`4642c6f0ae9782b83085e456373482078aef63923f384c205fc072328e319798`
and
`728f6bd114b5abfc0eef40410cc133e13976869ed2f42179fa2c6ff806bdc82c`;
the current coverage implementation digest is
`21316a1c794686f11d46625cf90349013aefe85803323883631dc3b13fd024b0`.

[VERIFIED] Receipt/status tests pass 30/30. The independent runtime-boundary
suite passes 2/2 and proves 38,772 failure versus 38,773 success. The complete
canonicalizer passes 324/324 Node tests plus 55 golden/idempotence/KIR, eight
measured, three profile-limit, and 235 hostile fixtures.

[VERIFIED] The full Node 22 `pnpm fitness:kern-5` wall passed after the final
324/324 canonicalizer reproduction and terminated with
`KERN 5 current fitness wall passed.`

[VERIFIED] Agon review `review-1784890907905-i52xdt` routed high risk with
automatic roles across all six usable independent seats. All 6/6 completed:
zero verified, zero needs-check, zero speculative, and 15 nit findings; no
material finding remains unresolved.

## Out of Scope

- Promoting `maxValueRows` from 461 to 580.
- Migrating the selected 19 parameter rows.
- Implementing a runtime-cost reduction if the evidence is a NO-GO.
- Projection depth/nodes, unknown-expression, exception-flow, runtime cutover,
  stable KIR, RC/stable release, Fable work, or a KERN 5 completion claim.

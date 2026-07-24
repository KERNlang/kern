# KERN 5 R2 M4.79 — Property-Row Structural Runtime Headroom

**Status:** IMPLEMENTED — LOCAL GATES AND REVIEW PASSED — PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.78 commit
`07c896900a49d9abd6b5bb4946ee891a97684575` freezes the exact current
23-function residual frontier and selects candidate profile 38/61/461. The
selected cohort is exactly one legacy-parameter checker function with 22
parameter rows.

[DECIDED] M4.79 is evidence-only. It authenticates the exact structural runtime
floor for that counterfactually migrated function through the public
`kern.runtime.handler.v1` boundary and publishes a promotion NO-GO because the
measured floor exceeds the precommitted safety budget. It does not change the
active 38/53/461 profile, KERN source, generated consumers, parser, runtime,
KIR, ABI, package versions, or public APIs. It explicitly blocks a profile
promotion and cannot authorize a KERN 5 completion claim.

## Published Input

[VERIFIED] This fresh branch
`feat/kern-5-r2-m4-79-property-row-headroom` starts at exact `origin/main`
commit `07c896900a49d9abd6b5bb4946ee891a97684575`.

[VERIFIED] The immutable M4.78 handoff is:

- receipt SHA-256
  `f63342ef1f4b2754add412232fd4cf24758b0a0f77b8522361ea2f66cd1fadc2`;
- residual-analysis input commit
  `2ee34545f1a97acd5889f95e52bdd0952eb362bd`;
- assignment digest
  `0abacdcff2a8ee7dfd977de09a3af2488350a383347b226a0afe36b8ca786ae7`;
- selected limits 38 node rows, 61 property rows, and 461 value rows;
- one function in tool `checker` and 22 total parameter rows;
- unchanged production collection ceiling 65,536 and KIR depth 64; and
- active profile remains 38/53/461 before any later promotion.

[VERIFIED] The exact published M4.78 live evidence is additionally bound by:

- coverage implementation digest
  `c8d4a6f063c0021993022ccc5a05360717311fef8934c774a1aee49c86305ea8`;
- coverage-summary SHA-256
  `e47d481662172a8dbbdd0605f284f2248f9b6631e8653a189117a37d806d4ec7`;
  and
- prerequisite-summary SHA-256
  `4c65daf66262f22bd476638a67976b5461f9ae9383e122c0025a7f05eb90fc4f`.

## Witness Contract

| Witness | Params | Structural rows | Required reasons |
|---|---:|---:|---|
| `examples/capstone-checker-subset/checker-while.kern#16:checkWhileCore` | 22 | 38/61/460 | `profile.rows.properties` |

[DECIDED] The witness is parsed from its authenticated handwritten source and
counterfactually migrated with `migrateLegacyFunctionForPrerequisite`. The
migrated function is structurally encoded and decoded, flattened, and executed
through the public runtime handler with exact candidate limits 38/61/461.

[VERIFIED] Bound source SHA-256 values before implementation are:

- checker-while source
  `84ca20346a655595cbaab095e3b46b964e46acabd90ead29d1d1a3c6813e8b60`;
- canonicalizer composite
  `974b8d3ba6fefac4861152be88181c176feda56df9aa820e9f8d3a89e0488f8d`;
- canonicalizer policy JSON
  `ac4983323d0e9da875e75ae12aff079d8d52deee069d77f703280a06f2f42244`;
- composition JSON
  `2e8a4f77f6f343e7a16b42522b74afce3fd91272df3261431cb8e8950c17105d`;
  and
- structural KIR codec
  `04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab`.

## Headroom Contract

[DECIDED] The promotion budget remains policy-derived as three quarters of the
65,536 production ceiling: 49,152 steps, preserving 16,384 reserved production
headroom. The witness floor must be found by monotonic runtime execution rather
than estimated or selected to fit the budget.

[VERIFIED] Direct execution measured the exact structural floor at 56,238:
56,237 fails with the canonical `unsupported-runtime-input` envelope and
56,238 succeeds. The witness retains 9,298 steps of production headroom but
exceeds the promotion budget by 7,086 steps. M4.79 therefore freezes
`rejected-over-budget`; it must not publish positive headroom or authorize the
38/61/461 profile.

[DECIDED] M4.79 must prove:

1. exact M4.78 receipt, selection, assignment, source, and active-profile
   identity;
2. exact counterfactual migration to 22 direct parameters and 38/61/460 rows;
3. execution at `exactFloor - 1` fails with the canonical
   `unsupported-runtime-input` envelope;
4. execution at `exactFloor` succeeds with no diagnostics or events;
5. returned source reparses and structurally encodes byte-identically;
6. the exact 7,086-step budget deficit and 9,298-step production headroom are
   exact arithmetic;
7. promotion disposition is fail-closed as `rejected-over-budget`; and
8. module-envelope admission remains explicitly outside this structural claim.

## Implementation Plan

1. Add a focused test importing the absent M4.79 receipt module and capture
   RED at the missing module boundary.
2. Build the exact migrated witness from published M4.78 identity and freeze
   the measured 56,237 failure/56,238 success boundary.
3. Freeze canonical format `kern.kir-canonicalizer.property-row-headroom.2`
   with the live evidence writer/loader/validator contract, including plain
   tree-only data and regular-file/non-symlink enforcement.
4. Add mutation, decorated/shared-data, exact live-measurement equality,
   M4.78-history, fresh-process, status, terminal-checker, and exact
   runtime-boundary tests; terminal/status evidence must say promotion is
   blocked and route M4.80 to reduce the floor by at least 7,086 steps.
5. Regenerate authenticated current summaries after all `.mjs` edits and run
   focused, standalone canonicalizer, and complete Node 22 fitness gates.
6. Run automatic high-risk role-lens review, resolve verified findings, make
   one signed commit, fetch/rebase, and atomically push once with `--no-verify`.

## Acceptance Criteria

- [x] Fresh branch starts at published M4.78 commit `07c89690`.
- [x] Exact M4.78 selection and witness assignment are grounded.
- [x] RED fails at the intended missing M4.79 receipt boundary.
- [x] Exact runtime floor is measured, with failure one step below and success
      at the floor.
- [x] Output round-trips to byte-identical structural KIR.
- [x] Exact floor 56,238 exceeds the promotion budget by 7,086 while retaining
      9,298 steps of production headroom.
- [x] Receipt and release gates reject profile promotion as over budget.
- [x] Receipt is canonical, source-bound, regular-file-only, and tree-only.
- [x] Module-envelope admission remains explicitly unclaimed.
- [x] No active product or profile surface is authorized to change.
- [x] Focused gates, complete canonicalizer, terminal checker, and complete
      Node 22 `fitness:kern-5` wall pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Plan Delta

[VERIFIED] The initial implementation contract treated M4.79 as a possible
evidence pass under the existing 49,152-step promotion budget. Direct
authenticated execution disproved that assumption: the selected witness needs
56,238 steps. The implementation therefore pivoted to an immutable promotion
NO-GO, preserved the 38/53/461 active profile, and routed M4.80 to reduce the
canonicalizer cost by at least 7,086 steps. No policy limit was weakened to
make the candidate pass.

## Verification Evidence

[VERIFIED] The generated receipt and settled live evidence are:

- M4.79 receipt SHA-256
  `d8683f1440e8bb0f8496ab1845c83c7dabe73dbfd26114b78685d8c8e1cf830b`;
- current coverage-summary SHA-256
  `072563357669df76099c8343cd57be21a59c82148072dedd2f4d8402c86863a4`;
- current prerequisite-summary SHA-256
  `156a6b67a18690b915a31ede135e702cf7d3953c315da97b7400c6acb78bab90`;
  and
- current coverage implementation digest
  `30dff8eda3dd11af4e0202a70d5df3d5edd700901dbcaa09350d885707b80c04`.

[VERIFIED] Focused receipt/status tests pass 25/25 and the independent
performance boundary suite passes 2/2. The standalone canonicalizer gate
passes 308/308 Node tests, 55 golden/idempotence/KIR fixtures, 8 measured
witnesses, 3 profile-limit fixtures, and 235 hostile fixtures.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passes and emits
`KERN 5 current fitness wall passed.` Its final canonicalizer rerun independently
reproduces the exact 56,238-step M4.79 floor and the promotion NO-GO.

[VERIFIED] Automatic high-risk role-lens review completed 6/6 usable reviewers
at `/Users/nicolascukas/.agon/runs/review-1784866649269-06xj4c`: zero verified
findings, three DRYness needs-check candidates, and twelve nits. The three
needs-check candidates are rejected after inspection: milestone-local check and
test assertions are intentionally independent release oracles; repeating the
receipt digest prevents one mutable exported constant from authenticating
itself; and extracting shared validators would couple immutable historical
receipts to mutable cross-milestone infrastructure. No material finding remains.

## Stop Conditions

- M4.78 digest, input commit, selection, assignment, or source bytes drift.
- The selected function no longer counterfactually migrates to exactly
  38/61/460 rows with 22 parameters.
- Runtime success is not monotonic at the measured collection boundary.
- The exact floor exceeds 65,536 or round-trip identity fails.
- Evidence requires changing the active profile, runtime, KIR, ABI, or any
  historical receipt.

## Out of Scope

- Promoting `maxPropertyRows` from 53 to 61.
- Migrating the selected 22 parameter rows.
- Implementing the required runtime-cost reduction; M4.80 owns that work.
- Claiming module-envelope admission, release readiness, stable KIR, semantic
  self-hosting, or KERN 5 completion.

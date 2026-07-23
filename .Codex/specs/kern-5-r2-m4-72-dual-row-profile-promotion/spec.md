# KERN 5 R2 M4.72 — Dual-Row Profile Promotion

**Status:** IMPLEMENTED — REVIEW GREEN, PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.71 commit
`75a927c4faf36d4c18530ff30b4f877fdc411628` authenticates one structural
function witness at exact runtime floor 36,193 under candidate profile
31/53/388. Its canonical receipt SHA-256 is
`8be340082e3a5de479b015d4f0f4248486286290ed981cbf5715538069638c12`.

[DECIDED] M4.72 promotes only `profileLimits.maxNodeRows` from 30 to 31 and
`profileLimits.maxPropertyRows` from 50 to 53. `maxValueRows` remains 388.
Before moving policy, it freezes M4.71 into an immutable published handoff.
The promoted profile exposes the exact one-function/one-tool/14-row parameter
queue for M4.73; this slice does not migrate source. KERN 5 remains incomplete.

## Published Inputs

[VERIFIED] The fresh branch
`feat/kern-5-r2-m4-72-dual-row-profile-promotion` starts from exact
`origin/main` commit `75a927c4faf36d4c18530ff30b4f877fdc411628`.

[VERIFIED] Published M4.71 binds:

- receipt digest
  `8be340082e3a5de479b015d4f0f4248486286290ed981cbf5715538069638c12`;
- source commit `75a927c4faf36d4c18530ff30b4f877fdc411628`;
- M4.70 residual-analysis digest
  `2e1b2dea394f8a238b2f63b4a7045576b1843948740b3a6666b0c002971d8401`;
- structural-function scope and candidate profile 31/53/388;
- witness
  `examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#1:validstatementlist`;
- structural rows 31/53/370 and 14 legacy parameter rows;
- exact floor 36,193, promotion headroom 12,959, and production headroom
  29,343; and
- explicit `not-claimed` module-envelope disposition at KIR depth 64.

## Read-Only Candidate Projection

[VERIFIED] A read-only projection passed candidate profile 31/53/388 through
the current coverage facts and prerequisite partition without changing the
repository. It produced:

| Field | Active 30/50/388 | Candidate 31/53/388 |
|---|---:|---:|
| authored functions | 104 | 104 |
| base-complete functions | 78 | 78 |
| legacy `fn.params` blockers | 25 | 25 |
| parameter-ready functions | 0 | 1 |
| parameter-ready tools | 0 | 1 |
| parameter-ready rows | 0 | 14 |
| residual functions after queue | 25 | 24 |

[VERIFIED] The sole candidate queue row is the M4.71 witness exactly:

| Function | Tool | Params | Rows N/P/V |
|---|---|---:|---:|
| `canonicalizer-statement-helpers.kern#1:validstatementlist` | canonicalizer | 14 | 31/53/370 |

[VERIFIED] The generated live prerequisite summary proves the remaining 24
functions stay in bounded exhaustion under the already admitted
`exception-flow` family. Its exact bounded-exhaustion receipt digest is
`bc209e6142330b70cac9499b3cc66a6750bdf3baabe6763a9f6b847995c21831`.

## Exact Promotion Contract

| Field | Before | After |
|---|---:|---:|
| `maxNodeRows` | 30 | 31 |
| `maxPropertyRows` | 50 | 53 |
| `maxValueRows` | 388 | 388 |
| production runtime ceiling | 65,536 | 65,536 |
| promotion runtime budget | 49,152 | 49,152 |
| KIR depth | 64 | 64 |

[DECIDED] No coverage family, base profile, source function, generated
consumer, runtime limit, KIR limit, ABI, package version, or public API may
change in this slice.

## Integrity and Freeze Contract

[DECIDED] Before policy moves, convert the live M4.71 measurer/validator/writer
module into an immutable loader bound to the exact receipt digest, source
commit, canonical JSON bytes, and regular non-symlink path. Preserve the M4.71
receipt bytes exactly.

[DECIDED] Promotion tests must fail closed on:

- M4.71 digest, source commit, candidate profile, witness identity, rows,
  floor, headroom, round trip, or module no-claim drift;
- movement of any policy value other than node rows 30→31 and property rows
  50→53;
- any queue member other than the exact M4.71 witness;
- a change from exact queue cardinality 1 function/1 tool/14 rows;
- any direct source function becoming newly base-complete;
- loss of exact rejection above the 31-node, 53-property, or 388-value
  boundaries; and
- historical M4.70 or M4.71 receipt-byte drift.

## RED and Implementation Plan

1. Add the M4.72 promotion oracle first and capture RED against the absent
   immutable M4.71 published loader.
2. Freeze M4.71 as published evidence from commit `75a927c4`; route its receipt,
   performance proof, and terminal checker through the immutable loader.
3. Raise only node rows 30→31 and property rows 50→53 in `policy.json`.
4. Move the hostile profile fixtures to exact 32-node and 54-property
   rejection boundaries while retaining exact 389-value rejection.
5. Assert the exact 1/1/14 queue, unchanged 78/104 base completion and 25
   legacy blockers, and exact 24-function residual frontier. Do not migrate
   source.
6. Regenerate only active coverage and prerequisite summaries after all MJS
   implementation bytes settle. Preserve every historical receipt.
7. Run focused tests, canonicalizer checker, complete Node 22 KERN 5 fitness,
   and independent high-risk role-lens review; resolve every verified material
   finding.
8. Create one Agon-signed commit, fetch and rebase onto current `origin/main`,
   then atomically push the fresh feature ref and authorized `main` once with
   `--no-verify` and verify identical remote hashes.

## Verification Evidence

[VERIFIED] RED failed first because the new oracle imported the intentionally
absent `loadPublishedCanonicalizerDualRowHeadroomM471` export.

[VERIFIED] The initial 54-property hostile fixture used a fourth root function
property (`async`) that the standalone KERN canonicalizer correctly rejects.
Tracing the full admitted function shape showed that `fn` roots allow only
`name`, `returns`, and `export`; the corrected fixture reaches 54 property rows
with an admitted `do value="0"` child and preserves the intended profile-only
boundary proof.

[VERIFIED] Final artifact SHA-256 values are:

- coverage summary:
  `885af96ee3e9279fbf2ca8f1d1bf87f633fc1f8c86fe0aceb413f18dccbb428a`;
- prerequisite summary:
  `617e5e0dc200d8f931d94ab9d6b09e6c7080f6216d40918927d340b339c27461`;
- active policy:
  `a4b53907df9507d12606fafb1bbf42fd5e129589e389e5ac349c154a8e3ab964`.

[VERIFIED] Focused promotion and transition tests passed, the complete
canonicalizer suite passed 273/273, the standalone canonicalizer passed 55
golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
fixtures, and 235 hostile fixtures, and the complete Node 22 fitness wall ended
with `KERN 5 current fitness wall passed.`

[VERIFIED] Independent high-risk role-lens review
`review-1784839078209-bnebwy` completed 6/6 usable engines with zero verified
findings, one needs-check, and eight nits. The needs-check alleged that the
32-node fixture was counted but not executed. It was rejected against the
actual checker: `check-kern-canonicalizer.mjs` measures every profile-limit
fixture, requires explicit failure under the active profile with no partial
events or result, and then requires success when only that fixture's exceeded
ceiling is widened exactly. No implementation change was warranted.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.71 commit `75a927c4`.
- [x] Exact M4.71 digest, source commit, witness, rows, and floor are grounded.
- [x] Read-only projection yields exact 1-function/1-tool/14-row queue and 24
      residual functions.
- [x] RED fails against the missing immutable M4.71 published loader.
- [x] M4.71 receipt stays byte-identical and loads only as published evidence.
- [x] Only node rows 30→31 and property rows 50→53 change; value rows stay 388.
- [x] Exact 32-node, 54-property, and 389-value hostile fixtures reject.
- [x] Queue equals only `validstatementlist` at 31/53/370 and 14 rows.
- [x] Base completion stays 78/104; legacy blockers stay 25; residuals become 24.
- [x] No KERN source, generated consumer, family, parser, runtime, KIR, ABI,
      package version, or public API changes.
- [x] Focused gates, complete canonicalizer, and Node 22 fitness pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Stop Conditions

- M4.71 receipt digest, source commit, witness, floor, or headroom differs.
- Candidate projection admits an additional function or changes base completion.
- Promotion requires source, family, runtime, KIR, ABI, or value-row changes.
- Exact 32-node, 54-property, or 389-value rejection cannot be demonstrated.
- M4.73 would not consume the exact one-function/14-row queue.

## Out of Scope

- Migrating `validstatementlist`; that is the fresh M4.73 slice.
- Adding or promoting another prerequisite family.
- Widening value rows, runtime limits, KIR depth, or module-envelope admission.
- Runtime, KIR, ABI, public API, package version, RC, or stable-release changes.
- Claiming KERN 5 completion.

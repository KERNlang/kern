# KERN 5 R2 M4.64 Node-Row Profile Promotion

**Status:** IMPLEMENTED — VERIFIED AND REVIEWED; PUBLISH PENDING
**Date:** 2026-07-23
**Confidence:** 0.99

## Executive Summary

[VERIFIED] M4.63 is published at exact commit
`6aba5e056c833e7dd2e613a21ac52e3f718d9673`. Its canonical receipt SHA-256 is
`110260eb3a2c9ed942e309d5b6e1331f2752bc486bfe99840c887e2a6ef7e7c3`, and
all four selected structural-function witnesses pass at their exact floors
with at least 22,076 steps of promotion headroom.

[DECIDED] M4.64 promotes only `profileLimits.maxNodeRows` from 25 to 28. It
first converts M4.63 into an immutable published handoff, then authenticates
the exact four-function/two-tool/37-row parameter queue. It changes no KERN
source and migrates no parameter. KERN 5 remains incomplete.

## Published Inputs

[VERIFIED] This fresh branch starts from exact `origin/main` commit
`6aba5e056c833e7dd2e613a21ac52e3f718d9673`.

[VERIFIED] The M4.63 handoff binds:

- receipt digest
  `110260eb3a2c9ed942e309d5b6e1331f2752bc486bfe99840c887e2a6ef7e7c3`;
- source commit `6aba5e056c833e7dd2e613a21ac52e3f718d9673`;
- structural-function scope and candidate profile 28/50/388;
- exact floors 21,736, 27,076, 21,825, and 24,993;
- maximum floor 27,076 under the 49,152 promotion budget;
- minimum promotion and production headroom 22,076 and 38,460;
- explicit `not-claimed` module-envelope disposition at depth 64; and
- active pre-promotion policy 25/50/388.

[VERIFIED] M4.62 remains the causal selection input at receipt digest
`5339ffa5c128efbe857b53e64a67092d72b8b6b6cbe6cc3ea16c96f4939e79cc`.

## Exact Promotion Contract

| Field | Before | After |
|---|---:|---:|
| `maxNodeRows` | 25 | 28 |
| `maxPropertyRows` | 50 | 50 |
| `maxValueRows` | 388 | 388 |
| production runtime ceiling | 65,536 | 65,536 |
| promotion runtime budget | 49,152 | 49,152 |
| base-complete functions | 73/104 | 73/104 |
| legacy `fn.params` blockers | 30 | 30 |
| parameter-ready functions | 0 | 4 |
| parameter-ready tools | 0 | 2 |
| parameter-ready rows | 0 | 37 |
| residual functions after queue | 30 | 26 |

[DECIDED] No other policy value may move. The cumulative base identity,
promotions, admitted families, canonicalizer source, runtime, and KIR limits
remain unchanged.

## Authenticated Queue

| Function | Tool | Params | Rows N/P/V |
|---|---|---:|---:|
| `checker-while.kern#1:isSafeMagnitude` | checker | 2 | 27/39/288 |
| `checker.kern#22:mapCallRejectDetail` | checker | 13 | 28/42/309 |
| `validator.kern#10:fnokat` | validator | 8 | 28/38/270 |
| `validator.kern#12:ownexportkind` | validator | 14 | 28/48/260 |

[DECIDED] The queue order, identities, tools, parameter counts, and structural
rows must equal the M4.63 witnesses exactly. A simultaneous or additional
admission is a stop condition.

## Integrity and Freeze Contract

[DECIDED] Before policy moves, convert the live M4.63 measurement module into
an immutable loader bound to the exact receipt digest, source commit, canonical
JSON bytes, and regular non-symlink path. Preserve the receipt bytes exactly.

[DECIDED] Promotion tests must fail closed on:

- M4.63 digest, source commit, candidate limits, witness order, floors,
  headroom, or module no-claim drift;
- any policy movement other than 25 to 28 node rows;
- a change in base completion, legacy blocker count, queue membership/order,
  tool count, parameter rows, profile rows, or residual count;
- any direct source function becoming newly base-complete;
- loss of exact profile-boundary rejection at 29 node rows; and
- historical M4.62/M4.63 receipt byte drift.

## RED and Implementation Plan

1. Add the exact M4.64 promotion oracle and capture RED against the unchanged
   25-row active policy.
2. Freeze M4.63 as published evidence from commit `6aba5e05`; route terminal
   checks and performance evidence through the immutable loader.
3. Raise only `profileLimits.maxNodeRows` from 25 to 28 and move the hostile
   node-row fixture to the exact 29-row rejection boundary.
4. Assert the exact 4/2/37 queue, unchanged 73/104 base completion, 30 legacy
   blockers, and 26 residual functions. Do not migrate source.
5. Regenerate only current live coverage/prerequisite summaries after all
   implementation and test bytes settle; preserve historical receipts.
6. Run focused and complete Node 22 gates, high-risk role-lens review, and
   targeted regression gates after verified review fixes.
7. Create one Agon-signed commit, fetch/rebase onto fresh `origin/main`, push
   once with `--no-verify` to the fresh feature ref and authorized `main`, and
   verify identical remote hashes.

The no-verify push is explicitly operator-authorized for this release train;
the complete local Node 22 fitness wall is the compensating pre-push gate.

## Verification Evidence

[VERIFIED] RED failed before implementation because the published M4.63 loader
export did not yet exist. After implementation:

- the complete Node 22 `fitness:kern-5` wall passes;
- the canonicalizer passes 232/232 tests plus all 55 golden/idempotence/KIR,
  8 measured-witness, 3 profile-limit, and 235 hostile fixtures;
- post-review targeted regression passes 16/16, the deterministic coverage
  checker passes, and `git diff --check` passes;
- policy, coverage, and prerequisite summary SHA-256 digests are
  `589de16d30335145b89dfe50f57721ae2424f580b659749d7b5de8f4f771257c`,
  `d7a284c00163199a247df6c6aeec13cde06cc786ca9a7423eacc619bfbc937c9`,
  and `9bba0c10b55e732392fa68dd7f7174135a4ff380875e15ea787e045b46d5610f`;
- coverage implementation and reason-assignment digests are
  `5b3bfb87d739d37d9617fdbe22e97febc214edda298199764d0b756c51eee3f9`
  and `68108254cf57ba70b019f6556c6808e585eeb63355078b7f9c243271fdb989c6`;
  and
- high-risk role-lens review `review-1784809274977-0mcpmm` completed 6/6
  with zero verified findings, three needs-check findings, one speculative
  finding, and nine nits. The historical-boundary rationale, receipt anchors,
  byte-order contract, and drift mutations were clarified or tightened. The
  remaining duplication and push-process observations are intentional
  independent milestone pins and explicit operator policy, not unresolved
  product defects.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.63 commit `6aba5e05`.
- [x] Exact M4.63 receipt, source commit, witnesses, and floors are grounded.
- [x] RED fails against the unchanged 25-row active policy.
- [x] M4.63 receipt is byte-identical and loads only as published evidence.
- [x] Only `maxNodeRows` changes, from 25 to 28.
- [x] Exact 28-row witnesses become parameter-ready; exact 29-row fixture fails.
- [x] Exact queue is 4 functions, 2 tools, and 37 rows; 26 residual remain.
- [x] Base completion remains 73/104 and legacy blockers remain 30.
- [x] No KERN source, generated consumer, family, parser, runtime, KIR, ABI,
      package version, or public API changes.
- [x] Focused gates and complete Node 22 `fitness:kern-5` pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Stop Conditions

- M4.63 receipt digest, source commit, witness identity/order, or headroom differs.
- Any selected function fails the 28/50/388 completion projection.
- Any additional function becomes parameter-ready or directly base-complete.
- Promotion requires changing property/value/runtime/KIR limits or KERN source.
- Exact 29-row rejection cannot be demonstrated.

## Out of Scope

- Migrating the selected 37 legacy parameter rows.
- Widening property/value rows, runtime limits, KIR depth, or module admission.
- Adding or promoting another prerequisite family.
- Runtime, KIR, ABI, public API, package version, RC, or release changes.
- Claiming KERN 5 completion.

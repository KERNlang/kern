# KERN 5 R2 M4.68 — Node-Row Profile Promotion

**Status:** IMPLEMENTED — VERIFIED — REVIEWED — PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.67 commit
`40b6961bbd41f3b60e346ef3246d6587c0c3a1f4` authenticates one exact
structural witness at runtime floor 17,552 under candidate profile 30/50/388.
Its canonical receipt SHA-256 is
`61e2c3b388160035d5764efcc2037c408eca8fc30f12010430168dd2b3bf9bca`.

[DECIDED] M4.68 promotes only `profileLimits.maxNodeRows` from 28 to 30. It
first converts M4.67 into an immutable published handoff, then authenticates
the exact one-function/one-tool/one-row parameter queue. It changes no KERN
source and migrates no parameter. KERN 5 remains incomplete.

## Published Inputs

[VERIFIED] This fresh branch starts at exact `origin/main` commit
`40b6961bbd41f3b60e346ef3246d6587c0c3a1f4`.

[VERIFIED] The M4.67 handoff binds:

- receipt digest
  `61e2c3b388160035d5764efcc2037c408eca8fc30f12010430168dd2b3bf9bca`;
- source commit `40b6961bbd41f3b60e346ef3246d6587c0c3a1f4`;
- structural-function scope and candidate profile 30/50/388;
- exact witness `examples/capstone-checker-subset/checker.kern#3:isSurfaceKind`;
- exact migrated rows 30/32/219 and one parameter row;
- exact floor 17,552, 31,600 promotion headroom, and 47,984 production
  headroom;
- explicit `not-claimed` module-envelope disposition at depth 64; and
- active pre-promotion policy 28/50/388.

[VERIFIED] M4.66 remains the causal selection input at receipt digest
`7c3748692b35c5c30c9241b70de86af69ff5046382dba8b07963bd1c6e7c5736`.

## Exact Promotion Contract

| Field | Before | After |
|---|---:|---:|
| `maxNodeRows` | 28 | 30 |
| `maxPropertyRows` | 50 | 50 |
| `maxValueRows` | 388 | 388 |
| production runtime ceiling | 65,536 | 65,536 |
| promotion runtime budget | 49,152 | 49,152 |
| base-complete functions | 77/104 | 77/104 |
| legacy `fn.params` blockers | 26 | 26 |
| parameter-ready functions | 0 | 1 |
| parameter-ready tools | 0 | 1 |
| parameter-ready rows | 0 | 1 |
| residual functions after queue | 26 | 25 |

[DECIDED] No other policy value may move. The cumulative base identity,
promotions, admitted families, canonicalizer source, runtime, and KIR limits
remain unchanged.

## Authenticated Queue

| Function | Tool | Params | Rows N/P/V |
|---|---|---:|---:|
| `checker.kern#3:isSurfaceKind` | checker | 1 | 30/32/219 |

[DECIDED] Queue identity, order, tool, parameter count, and structural rows must
equal the sole M4.67 witness exactly. Any simultaneous or additional admission
is a stop condition.

## Integrity and Freeze Contract

[DECIDED] Before policy moves, convert the live M4.67 measurement module into
an immutable loader bound to the exact receipt digest, source commit, canonical
JSON bytes, and regular non-symlink path. Preserve receipt bytes exactly.

[DECIDED] Promotion tests must fail closed on:

- M4.67 digest, source commit, candidate limits, witness identity, floor,
  headroom, or module no-claim drift;
- any policy movement other than 28 to 30 node rows;
- a change in base completion, legacy blocker count, queue membership, tool
  count, parameter rows, profile rows, or residual count;
- any direct source function becoming newly base-complete;
- loss of exact profile-boundary rejection at 31 node rows; and
- historical M4.66/M4.67 receipt byte drift.

## RED and Implementation Plan

1. Add the exact M4.68 promotion oracle and capture RED against the unchanged
   28-row active policy.
2. Freeze M4.67 as published evidence from commit `40b6961b`; route terminal
   checks and performance evidence through the immutable loader.
3. Raise only `profileLimits.maxNodeRows` from 28 to 30 and move current hostile
   node-row fixtures to the exact 31-row rejection boundary.
4. Assert the exact 1/1/1 queue, unchanged 77/104 base completion, 26 legacy
   blockers, and 25 residual functions. Do not migrate source.
5. Regenerate only current live coverage/prerequisite summaries after all
   implementation and test bytes settle; preserve historical receipts.
6. Run focused and complete Node 22 gates, high-risk role-lens review, and
   targeted regression gates after verified review fixes.
7. Create one Agon-signed commit, fetch/rebase onto fresh `origin/main`, push
   once with `--no-verify` to the fresh feature ref and authorized `main`, and
   verify identical remote hashes.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.67 commit `40b6961b`.
- [x] Exact M4.67 receipt, source commit, witness, and floor are grounded.
- [x] RED fails against the unchanged 28-row active policy.
- [x] M4.67 receipt is byte-identical and loads only as published evidence.
- [x] Only `maxNodeRows` changes, from 28 to 30.
- [x] Exact 30-row witness becomes parameter-ready; exact 31-row fixture fails.
- [x] Exact queue is 1 function, 1 tool, and 1 row; 25 residual remain.
- [x] Base completion remains 77/104 and legacy blockers remain 26.
- [x] No KERN source, generated consumer, family, parser, runtime, KIR, ABI,
      package version, or public API changes.
- [x] Focused gates and complete Node 22 `fitness:kern-5` pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Verification Evidence

[VERIFIED] The RED oracle failed before implementation because the unchanged
M4.67 live-measurement module did not export the required immutable published
loader. The promotion implementation then passed its focused 5/5 oracle, the
corrected 25/25 regression cluster, the M4.66/M4.68 8/8 transition cluster,
the canonicalizer checker, and `git diff --check`.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall exited 0 with its
terminal marker `KERN 5 current fitness wall passed.` Its canonicalizer legs
each passed 253/253 tests, 55 golden/idempotence/KIR fixtures, 8 measured
witnesses, 3 profile-limit fixtures, and 235 hostile fixtures.

[VERIFIED] Final active artifacts are bound by these SHA-256 digests:

- canonicalizer policy file:
  `63f5cfdbf980ed1300bbe3a4d6be1e8409dc20ed9c51b13b1873ebafcd186826`;
- coverage summary file:
  `c3b95e682d40254c1b9d9c96d38e72af47596168104c260ec6b83a45dbf576e2`;
- prerequisite summary file:
  `0038f2a831533a8c6494a56a83cc4af96a50a2416d62de772707624cf634412c`;
- frozen M4.67 receipt file:
  `61e2c3b388160035d5764efcc2037c408eca8fc30f12010430168dd2b3bf9bca`;
- coverage implementation digest:
  `4d0cfa9b419917195b2f836358b4dbd26af0bba33172ada00559e3cc24f2b79f`;
- function-facts digest:
  `2bf38c69f8ffa1a64de121071b05431d5e2329736657a2bbc6518e1980ceaf96`;
- reason-assignments digest:
  `42ea4f41e325a8743710cb29b4f3b275dc2df7e2a233662d1e952df0568f8685`.

[VERIFIED] The live summary reports 77/104 base-complete functions, 26 legacy
parameter blockers, the sole `isSurfaceKind` 30/32/219 witness as exactly one
parameter-ready function/tool/row, and 25 residual functions after that queue.

## Independent Review

[VERIFIED] High-risk role-lens review
`review-1784823777816-yhg77i` completed with all 6/6 usable independent
reviewers. Consensus reported 0 verified findings, 0 needs-check findings,
1 speculative candidate, and 6 nits; security, correctness, performance, and
DRYness lenses were clean.

[VERIFIED] The sole speculative candidate was rejected by repo-wide symbol
search: no removed M4.67 measurement, validation, or writer export has any
remaining consumer. The nits require no code change:

- milestone titles intentionally name the historical migrations being
  preserved while their bodies also assert the current M4.68 frontier;
- `measureCanonicalizerResidualAnalysisM466` remains the historical module's
  own explicit writer entry point;
- the M4.67 source-commit constant identifies immutable published evidence,
  not the current branch head;
- the 31-node hostile boundary is codec-measured and passed the exact profile
  fixture and complete canonicalizer gates; and
- live M4.66 reproduction was deliberately retired after policy promotion,
  while canonical bytes, digest, source commit, and fresh-process published
  loading remain authenticated.

## Stop Conditions

- M4.67 receipt digest, source commit, witness identity, or headroom differs.
- The selected function fails the 30/50/388 completion projection.
- Any additional function becomes parameter-ready or directly base-complete.
- Promotion requires changing property/value/runtime/KIR limits or KERN source.
- Exact 31-row rejection cannot be demonstrated.

## Out of Scope

- Migrating the selected legacy parameter row.
- Widening property/value rows, runtime limits, KIR depth, or module admission.
- Adding or promoting another prerequisite family.
- Runtime, KIR, ABI, public API, package version, RC, or release changes.
- Claiming KERN 5 completion.

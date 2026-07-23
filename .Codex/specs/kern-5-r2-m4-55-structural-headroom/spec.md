# KERN 5 R2 M4.55 Dual-Row Structural Runtime Headroom

**Status:** READY TO SHIP — FULL FITNESS AND INDEPENDENT REVIEW PASS
**Date:** 2026-07-23
**Confidence:** 0.97

## Executive Summary

[VERIFIED] Published M4.54 commit
`90782122a63ff168a8031f571d913454289d287f` freezes the current residual
frontier and selects exact candidate profile limits 25/50/388. The selection
contains seven legacy-parameter functions across all four self-hosted tools
and 102 parameter rows.

[DECIDED] M4.55 is evidence-only. It authenticates exact structural runtime
floors for those seven counterfactually migrated functions through the public
`kern.runtime.handler.v1` boundary. It does not change the active 19/31/388
profile, KERN source, generated consumers, parser, runtime, KIR, ABI, package
versions, or public APIs. KERN 5 remains incomplete after this slice.

## Published Input

[VERIFIED] The fresh branch starts at exact `origin/main` commit
`90782122a63ff168a8031f571d913454289d287f`.

[VERIFIED] The exact M4.54 handoff is:

- receipt SHA-256
  `9c8507a4fe5bacf1048bfc1f6946c3e493ee35cd7fb63ce3a2a7ced474ad1423`;
- input commit `87431a527dfb8d0f3a707b74ce33907392670a51`;
- selected limits 25 node rows, 50 property rows, and 388 value rows;
- seven functions across four tools;
- 102 total parameter rows;
- current production collection ceiling 65,536 and KIR depth 64.

## Witness Contract

| Witness | Params | Structural rows |
|---|---:|---:|
| `compareNode` | 13 | 24/39/373 |
| `literalTrue` | 7 | 23/33/244 |
| `checkerWhileRejectDetail` | 22 | 25/49/189 |
| `termProvenanced` | 11 | 24/36/237 |
| `whileRejectDetail` | 22 | 25/48/188 |
| `emitstatementlist` | 15 | 25/50/235 |
| `owncallable` | 12 | 24/42/212 |

[DECIDED] Each witness is parsed from its authenticated handwritten source,
counterfactually migrated using the canonical prerequisite migration,
structurally encoded and decoded, flattened, then executed through the public
runtime handler with exact candidate limits 25/50/388.

## Headroom Contract

[DECIDED] The promotion budget is policy-derived as three quarters of the
65,536 production ceiling: 49,152 steps, preserving 16,384 reserved production
headroom. No future ceiling or witness floor is hardcoded before measurement.

[DECIDED] For every witness, M4.55 must prove:

1. execution at `exactFloor - 1` fails with the canonical
   `unsupported-runtime-input` envelope;
2. execution at `exactFloor` succeeds with no diagnostics or events;
3. the returned source reparses and structurally encodes byte-identically;
4. the exact floor is no greater than 49,152;
5. recorded promotion and production headroom are exact arithmetic; and
6. module-envelope admission remains explicitly outside this structural claim.

[VERIFIED] The exact measured floors are:

| Witness | Failure/success boundary | Promotion headroom | Production headroom |
|---|---:|---:|---:|
| `compareNode` | 26,355 / 26,356 | 22,796 | 39,180 |
| `literalTrue` | 15,093 / 15,094 | 34,058 | 50,442 |
| `checkerWhileRejectDetail` | 19,762 / 19,763 | 29,389 | 45,773 |
| `termProvenanced` | 17,422 / 17,423 | 31,729 | 48,113 |
| `whileRejectDetail` | 19,621 / 19,622 | 29,530 | 45,914 |
| `emitstatementlist` | 21,984 / 21,985 | 27,167 | 43,551 |
| `owncallable` | 17,930 / 17,931 | 31,221 | 47,605 |

[VERIFIED] The maximum exact floor is 26,356, leaving 22,796 steps below the
promotion budget and 39,180 below the unchanged production ceiling.

## Implementation Evidence

[VERIFIED] RED failed at the intended missing
`dual-row-headroom-m4-55.mjs` module boundary.

[VERIFIED] The receipt, validator, mutation suite, fresh-process loader, and
seven public-handler boundary oracles pass. Every floor-minus-one execution
returns the canonical unsupported-runtime envelope, every exact-floor
execution succeeds without diagnostics or events, and emitted source reparses
to byte-identical structural KIR.

[VERIFIED] Immutable artifact hashes after the standalone canonicalizer gate
are:

- M4.55 receipt SHA-256
  `10e36abdda5e7de48c65689f9d2a318a6095497bdd3cff81aa64e3ab4e6e535b`;
- receipt/validator SHA-256
  `4b8635ca9df8a94e87bd77274e8409c2740f89b81d93e30a4a5f4e467a6b07f6`;
- receipt-test SHA-256
  `891f6d4875954e64a30c080ad72173d618cc733834714fc5a29c066fbddf1322`;
- runtime-floor oracle SHA-256
  `d6b135c207b2ed8616bb8a4eed232b4f01feff6140cf9036f07a547018f89b4a`;
- live coverage and prerequisite receipt SHA-256 values
  `d4fcb87c2c96a82426d209a643030c14d25678b34fd4e61e85b9b03760c028db`
  and `bb9a7694a9cc8e1aef5591a9d56380d57a6a644d93c9b7e461d0e628240de7b6`;
- coverage implementation, coverage policy, corpus, function-fact, and
  canonicalizer policy digests
  `e32ded7e95248a7a6b01e1f24362e823d8d489caef45b87fb77b7eaee5aa4658`,
  `213ce7266b0d8e449c4333483fe8862ae7d3fc69f2aaa7b869595dcbd5111d5c`,
  `da83239e2f10cf3a14350fc935c43ca44fcaf461e6513e14cc25ff984ec3c9de`,
  `7f42974aba8157c6f20fae3cf0c7632317e36e2e7c0d6e5869c32aa31970dc78`,
  and `c6838abc0d5dd2db23f1050b7acc3e0411f5d8e4ffbe90abd47bcdcf2ada95ac`.

[VERIFIED] Focused receipt/status gates pass 11/11. The standalone
canonicalizer wall passes 191/191 tests plus 51 golden/idempotence/KIR, eight
measured-witness, three profile-limit, and 226 hostile fixtures.

[VERIFIED] The complete Node 22.22 `pnpm fitness:kern-5` wall passes. It
includes all workspace and infrastructure tests; 434/434 cross-target and
109/109 class-conformance fixtures; 319/319 example-native and 233/233
core-native assertions at 100% declared coverage; 48/48 checker-subset
fixtures plus 36 accept-but-abstain rejections; 39/39 self-host-validator
verdicts; and two independent executions of the 191/191 canonicalizer suite
and its 51/8/3/226 standalone fixtures.

[VERIFIED] Required high-risk role-lens review
`review-1784769597959-x4q3ug-kern-5-r2-m4-55` completed all 6/6 live usable
reviewers with zero consensus-verified findings, five needs-check items, one
speculative item, and twelve nits. Source verification found no material
defect: independent witness copies are deliberate exact-boundary guards and
cannot drift silently through the receipt digest/live validator; the gate
builds `dist` before loading it; every runtime boundary and derived witness
field is re-executed or digest-authenticated; and the expensive floor oracles
are intentional release evidence. The performance cost is real but accepted
for this evidence slice. No unresolved material review finding remains.

## Implementation Plan

1. Add the M4.55 receipt/validator and runtime-boundary tests, capturing RED at
   the intentionally missing module boundary.
2. Measure each exact floor by bounded monotonic search through the public
   runtime handler, then freeze the seven verified boundaries.
3. Bind the receipt to the exact M4.54 digest/input commit, source files,
   canonicalizer artifacts, policy, codec, ABI, and policy-derived budgets.
4. Add mutation, decorated-data, history, fresh-process, status, and terminal
   checker coverage without changing active product or profile surfaces.
5. Run focused tests, the canonicalizer wall, complete Node 22 fitness, and
   high-risk role-lens review; fix verified findings before one signed commit.
6. Fetch, rebase onto current `origin/main`, and atomically push the feature
   branch and main once with `--no-verify`.

## Acceptance Criteria

- [x] Fresh branch starts at published M4.54 commit `90782122`.
- [x] RED fails at the intended missing M4.55 receipt boundary.
- [x] Exact M4.54 selection and seven witness assignments are authenticated.
- [x] All seven exact floors are verified at floor-minus-one and floor.
- [x] All seven outputs round-trip to byte-identical structural KIR.
- [x] Maximum exact floor is at or below the 49,152 promotion budget.
- [x] Module-envelope admission remains explicitly unclaimed.
- [x] No KERN source, generated consumer, profile, family, parser, KIR,
      runtime, ABI, package, or public surface changes.
- [x] Focused gates and complete Node 22 `fitness:kern-5` pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Stop Conditions

- M4.54 digest, input commit, selection, assignment, or source bytes drift.
- Any selected function no longer migrates to its exact published rows.
- Runtime success is not monotonic at the measured collection boundary.
- Any exact floor exceeds 49,152 or round-trip identity fails.
- Evidence requires changing the active profile, runtime, KIR, or ABI.

## Out of Scope

- Promoting `maxNodeRows` from 19 to 25 or `maxPropertyRows` from 31 to 50.
- Migrating any of the 102 selected parameter rows.
- Claiming module-envelope admission, release readiness, or KERN 5 completion.

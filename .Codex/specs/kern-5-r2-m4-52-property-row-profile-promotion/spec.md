# KERN 5 R2 M4.52 Property-Row Profile Promotion

**Status:** READY TO SHIP — FULL FITNESS AND INDEPENDENT REVIEW PASS
**Date:** 2026-07-20
**Confidence:** 0.98

## Executive Summary

[VERIFIED] M4.51 shipped from exact commit
`2e363bab008fd2f03ef21fdc1bcb0a2488bd0637` and authenticates the single
M4.50-selected `classcyclefrom` structural witness at rows 19/31/202. Its
exact runtime floor is 11,951, leaving 37,201 steps below the 49,152 promotion
budget and 53,585 below the unchanged production ceiling
(`scripts/kern-canonicalizer/property-row-headroom-m4-51.json`).

[DECIDED] M4.52 raises only `profileLimits.maxPropertyRows` from 30 to 31,
freezes M4.51 as an immutable published handoff before policy moves, proves the
exact one-function/one-tool/six-row parameter-ready queue, and migrates no KERN
source parameter. KERN 5 remains incomplete.

## Current State and Root Cause

[VERIFIED] The active profile is 19/30/388 while runtime collection length is
65,536 and KIR depth is 64 (`scripts/kern-canonicalizer/policy.json:18-30`).

[VERIFIED] The live M4.51 module is intentionally tied to the pre-promotion
19/30/388 policy and still owns measurement/writing functions
(`scripts/kern-canonicalizer/property-row-headroom-m4-51.mjs:92-200`). Changing
policy before freezing this evidence would make the terminal gate fail and
would conflate historical proof with current policy.

[VERIFIED] The M4.51 receipt binds candidate profile 19/31/388, one witness,
exact floor 11,951, structural-function scope, and no module-envelope claim
(`scripts/kern-canonicalizer/property-row-headroom-m4-51.json`). Its published
SHA-256 is
`c36711a885495d41b879bdcc364122f380dfde1a720a0985cdafbd78e067dfbe`.

[VERIFIED] A read-only projection through `measureCanonicalizerCoverage`,
`migrateFunctionFact`, and `partitionMigratedFunctions` at 19/31/388 produced
exactly 64/104 base-complete functions, 39 legacy `fn.params` blockers, one
parameter-ready validator function, six parameter rows, and 38 residual
functions. The sole queue row is
`examples/selfhost-validator/validator.kern#17:classcyclefrom` at 19/31/202
(Node 22 projection command, 2026-07-20).

## What Already Works

[VERIFIED] The canonicalizer profile is policy-owned and centrally loaded by
`loadCanonicalizerPolicy` (`scripts/kern-canonicalizer/policy.mjs:1-60`); no
runtime, parser, KIR, ABI, package, or public API change is needed.

[VERIFIED] M4.48 already establishes the exact promotion lifecycle required
here: freeze live headroom evidence, move one policy integer, update the
hostile boundary, authenticate the queue, and regenerate only live receipts
(`.Codex/specs/kern-5-r2-m4-48-node-row-profile-promotion/spec.md`).

## Contract

> Verified against the published M4.50/M4.51 receipts, current policy, and the
> read-only 19/31/388 projection on 2026-07-20.

| Field or behavior | Before | After | Evidence | Tag |
|---|---:|---:|---|---|
| `maxNodeRows` | 19 | 19 | `policy.json:27` | VERIFIED |
| `maxPropertyRows` | 30 | 31 | `policy.json:28`, M4.51 candidate | VERIFIED |
| `maxValueRows` | 388 | 388 | `policy.json:29` | VERIFIED |
| production runtime ceiling | 65,536 | 65,536 | `policy.json:18-24` | VERIFIED |
| KIR depth | 64 | 64 | `policy.json:3-17` | VERIFIED |
| base-complete functions | 64/104 | 64/104 | read-only projection | VERIFIED |
| legacy `fn.params` blockers | 39 | 39 | read-only projection | VERIFIED |
| parameter-ready functions/tools/rows | 0/0/0 | 1/1/6 | read-only projection | VERIFIED |
| residual functions | 39 | 38 | read-only projection | VERIFIED |
| newly ready function | none | `classcyclefrom` at 19/31/202 | M4.50/M4.51 receipts | VERIFIED |
| M4.51 receipt bytes | published digest | unchanged | SHA-256 above | VERIFIED |
| module-envelope admission | not claimed | not claimed | M4.51 receipt | VERIFIED |

## Implementation Option

[DECIDED] Apply the single evidence-backed promotion using the established
M4.48 lifecycle. There is no credible alternative to compare: leaving the
profile unchanged does not consume authenticated evidence, while widening any
other limit or migrating source would exceed this slice's causal authority.

1. Add the M4.52 promotion/freeze tests first and capture RED against the
   unchanged policy/live M4.51 API.
2. Convert M4.51 into a digest-pinned immutable loader bound to source commit
   `2e363bab`, canonical JSON bytes, and a regular non-symlink path; preserve
   the receipt byte-identically.
3. Raise only `maxPropertyRows` 30→31 and move the hostile property fixture to
   the exact 32-row rejection boundary.
4. Assert the exact 1/1/6 queue, unchanged 64/104 base completion and 39 legacy
   blockers, 38 residual functions, and no direct base-completion gain.
5. Route the terminal checker and performance oracle through the published
   M4.51 loader, update current-profile tests/status, and regenerate only live
   coverage/prerequisite receipts after implementation bytes settle.
6. Run focused gates, the standalone canonicalizer wall, complete Node 22
   `fitness:kern-5`, and high-risk independent role-lens review.
7. Create one Agon-signed commit, fetch/rebase, atomically no-verify push the
   fresh feature ref and authorized `main`, verify both remote hashes, and
   begin the next slice from fresh `origin/main`.

## Blast Radius

| File group | Action | Reason |
|---|---|---|
| this spec and release train | add/update | durable promotion contract/evidence |
| M4.51 module and tests | freeze/update | immutable published handoff |
| M4.51 receipt | preserve exactly | causal runtime evidence |
| `policy.json` | change one integer | property-row promotion 30→31 |
| M4.52 promotion test | add | exact policy, queue, history, and drift guard |
| profile fixtures/current policy tests | update | exact 31-row admission and 32-row rejection |
| prerequisite/current coverage tests | update | exact 1/1/6 queue and 38 residuals |
| terminal checker/status | update | published M4.51 and M4.52 decision |
| live coverage/prerequisite receipts | regenerate | authenticate final current closure |

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.51 commit `2e363bab`.
- [x] Read-only projection yields exact 1/1/6 queue and 38 residual functions.
- [x] RED fails against the unchanged 30-row policy or missing published M4.51 loader.
- [x] M4.51 receipt remains byte-identical and loads only as published evidence.
- [x] Only `maxPropertyRows` changes, from 30 to 31.
- [x] Exact 31-row witness becomes parameter-ready; exact 32-row fixture fails.
- [x] Base completion remains 64/104 and legacy blockers remain 39.
- [x] Queue is only `classcyclefrom`, one validator tool, and six rows.
- [x] No KERN source, generated consumer, family, parser, runtime, KIR, ABI,
      package version, or public API changes.
- [x] Focused gates, full canonicalizer, and complete Node 22 fitness pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Implementation Evidence

[VERIFIED] The discriminating M4.52 test first failed because the unchanged
M4.51 module did not export
`loadPublishedCanonicalizerPropertyRowHeadroomM451`; the completed focused
suite passes 70/70.

[VERIFIED] The M4.51 receipt remains byte-identical at SHA-256
`c36711a885495d41b879bdcc364122f380dfde1a720a0985cdafbd78e067dfbe`.
Its immutable loader is pinned to source commit
`2e363bab008fd2f03ef21fdc1bcb0a2488bd0637` and authenticates at
`4d630be7927b6b94afbed7fb0d49f52a26b51e0316470f9c1472ece3296fd140`.

[VERIFIED] The live coverage and prerequisite receipts authenticate at
`75aab0c200dce0e2629fb654cd77951a17e315e889516204f032993cda62de62`
and
`220becc58afa59bb35f1fef2246038d7c7763b49db65d615f6c5725c87659c76`.
Their shared implementation digest is
`9a2f9fff62a756def97ab7201ec1483e855442085f55099073f6fc611e938e4d`;
the promoted policy authenticates at
`2cb2bcad0164b3457cf398c18a78d46fc1bbe9cd3ef5e9676996bd89f9b35c97`.
The coverage policy and function-facts digests remain unchanged at
`3f72981ab56a3b7c6d27b675384349cd93b1a36b5d554dfcead57648794ad00e`
and
`8b2c88aac92ede8551155c55b870bc2245db042e7cc246946ee60eaa1285c35e`.

[VERIFIED] The standalone canonicalizer wall passes 170/170 Node tests plus
51 golden/idempotence/KIR fixtures, eight measured witnesses, three exact
profile-limit fixtures, and 226 hostile fixtures. The complete Node 22.22
`pnpm fitness:kern-5` wall passes end-to-end, including workspace tests,
434/434 cross-target fixtures, 109/109 class fixtures, 233/233 native KERN
assertions at 100% declared coverage, 48/48 checker fixtures, 39/39 validator
verdicts, app/drift/browser gates, runtime/KIR/ownership/convergence gates,
diff hygiene, and the repeated canonicalizer wall.

[VERIFIED] Current coverage remains 64/104 base-complete with 39 legacy
`fn.params` blockers. The exact next queue is one validator function and six
parameter rows: `classcyclefrom` at 19/31/202. Bounded exhaustion contains 38
residual functions with reason-assignment digest
`158ee2e9ee592986fa70f10e7345a243db0b082f7949497275e2dce2141ae6c8`.

[VERIFIED] Required high-risk role-lens review
`review-1784759389980-rphvm4-kern-5-r2-m4-52` completed all 6/6 usable
independent reviewers with zero verified findings and zero blockers. Its three
needs-check observations were adjudicated as deliberate release-proof design:
terminal and milestone tests retain independent exact literals instead of a
shared mutable expectation, while the M4.51 formatter follows the established
M4.47 evidence-to-promotion narrative pattern. Ten remaining nits do not
identify behavioral, safety, or release-contract failures.

## Out of Scope

- Migrating the selected six legacy parameter rows; that requires a fresh
  M4.53 slice after this promotion is published.
- Widening node/value rows, runtime limits, KIR depth, or module admission.
- Adding exception-flow or while-iteration families.
- Runtime, KIR, ABI, public API, package version, RC, or stable-release changes.
- Claiming KERN 5 completion.

## Deploy Order

[DECIDED] The immutable M4.51 loader, one-integer policy promotion, updated
consumers, boundary fixture, tests, and regenerated live receipts ship in the
same commit. There is no supported mixed-version window inside this repository;
the full local gate must pass before the single push.

## Stop Conditions

- M4.51 digest, source commit, witness identity, exact floor, or no-claim scope differs.
- The projected queue differs from exact 1/1/6 or any direct function becomes newly base-complete.
- Promotion requires changing node/value/runtime/KIR limits or KERN source.
- Exact 32-property-row rejection cannot be demonstrated.

## Open Questions

[VERIFIED] None block this exact promotion. Once published, M4.53 may migrate
only the frozen six-row `classcyclefrom` queue.

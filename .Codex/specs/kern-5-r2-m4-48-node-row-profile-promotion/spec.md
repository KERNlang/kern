# KERN 5 R2 M4.48 Node-Row Profile Promotion

**Status:** IMPLEMENTED AND REVIEWED — SHIPPING PENDING
**Date:** 2026-07-22
**Confidence:** 0.99

## Executive Summary

[VERIFIED] M4.47 shipped at commit
`233e71a84fe7afdd7566e19a5545a885ffc36e8f` and published exact structural
runtime headroom for the four-function M4.46 cohort. Its canonical receipt has
SHA-256
`0da8ef5be1be0ea2ac12ef739bd6cc38070d60b7b3a775f45602857d40979af1`.
Every witness fits the precommitted 49,152 runtime budget and round-trips to
byte-identical structural KIR.

[DECIDED] M4.48 promotes only `profileLimits.maxNodeRows` from 16 to 19. It
freezes M4.47 as an immutable published handoff before moving policy, proves
the exact four-function/three-tool/12-row parameter queue, and migrates no
source parameter in this slice. KERN 5 remains incomplete.

## Published Inputs

[VERIFIED] The fresh branch starts from exact `origin/main` commit
`233e71a84fe7afdd7566e19a5545a885ffc36e8f`.

[VERIFIED] The M4.47 handoff binds:

- receipt digest
  `0da8ef5be1be0ea2ac12ef739bd6cc38070d60b7b3a775f45602857d40979af1`;
- source commit `233e71a84fe7afdd7566e19a5545a885ffc36e8f`;
- structural-function scope and candidate profile 19/30/388;
- exact floors 8,303, 10,361, 15,236, and 10,591;
- maximum floor 15,236 under the 49,152 promotion budget;
- explicit no-claim module-envelope disposition;
- active pre-promotion policy 16/30/388 and unchanged runtime/KIR limits.

[VERIFIED] M4.46 remains the causal selection input at receipt digest
`67ed659c709adfc5cd51095a3ac5f9549b0384d9651ac3d74894ad4b3aab3402`
and source commit `77ba01b467b411def9343ffb3c064e1650e6fced`.

## Exact Promotion Contract

| Field | Before | After |
|---|---:|---:|
| `maxNodeRows` | 16 | 19 |
| `maxPropertyRows` | 30 | 30 |
| `maxValueRows` | 388 | 388 |
| production runtime ceiling | 65,536 | 65,536 |
| promotion runtime budget | 49,152 | 49,152 |
| base-complete functions | 60/104 | 60/104 |
| legacy `fn.params` blockers | 43 | 43 |
| parameter-ready functions | 0 | 4 |
| parameter-ready tools | 0 | 3 |
| parameter-ready rows | 0 | 12 |
| residual functions after queue | 43 | 39 |

[DECIDED] No other policy value may move. The base profile id and admitted
node/expression/property families remain unchanged.

## Authenticated Queue

| Function | Tool | Params | Rows N/P/V |
|---|---|---:|---:|
| `checker.kern#12:isIndexRebound` | checker | 6 | 17/26/152 |
| `checker.kern#9:isUserCallable` | checker | 4 | 19/26/185 |
| `canonicalizer-expression-helpers.kern#4:validinteger` | canonicalizer | 1 | 19/28/290 |
| `validator.kern#3:isportable` | validator | 1 | 18/24/217 |

[VERIFIED] A read-only projection through the current coverage and prerequisite
implementation produces exactly this sorted four-function queue, 12 rows, and
39 residual functions at 19/30/388. Base completion remains 60/104; no direct
function is accidentally admitted by the node-row widening.

## Integrity and Freeze Contract

[DECIDED] Before policy moves, convert the M4.47 live evidence module into an
immutable loader bound to the exact receipt digest, source commit, canonical
JSON bytes, and regular non-symlink path. Preserve the M4.47 receipt bytes
exactly.

[DECIDED] Promotion tests must fail closed on:

- M4.47 digest, source commit, artifact scope, candidate limits, witness order,
  exact floors, headroom, or module no-claim drift;
- any policy movement other than 16→19 node rows;
- a change in base completion, legacy blocker count, queue membership/order,
  tool count, parameter rows, profile rows, or residual count;
- a direct function becoming newly complete outside the exact queue;
- loss of exact profile-boundary rejection at 20 node rows;
- historical M4.46/M4.47 receipt byte drift.

## RED and Implementation Plan

1. Add an M4.48 promotion test first and capture RED against the unchanged
   16-row policy.
2. Freeze M4.47 as the exact published receipt from commit `233e71a8` and route
   terminal coverage through the published loader.
3. Raise only `profileLimits.maxNodeRows` from 16 to 19 and move the hostile
   node-row fixture to the exact 20-row rejection boundary.
4. Assert the exact 4/3/12 parameter queue, unchanged 60/104 base completion,
   43 legacy blockers, and 39 residual functions. Do not migrate source.
5. Regenerate only current live coverage/prerequisite receipts after all
   implementation/test bytes settle; preserve historical receipts exactly.
6. Run focused gates, complete Node 22.22 `fitness:kern-5`, required independent
   review, and affected gates after verified fixes.
7. Create one Agon-signed commit, fetch/rebase onto fresh `origin/main`, push
   once with `--no-verify` to the fresh feature ref and authorized `main`, and
   verify identical remote hashes.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | claim-tagged promotion contract |
| M4.47 evidence module/tests | freeze/modify | immutable published handoff |
| M4.47 receipt | preserve exactly | causal runtime proof |
| policy JSON | modify one integer | node-row promotion 16→19 |
| M4.48 promotion test | add | exact policy/queue/history guard |
| profile fixture/current policy tests | modify | exact 19-row boundary and 20-row rejection |
| terminal coverage checker/status | modify | published M4.47 plus M4.48 promotion status |
| live coverage/prerequisite receipts | regenerate | authenticate final closure |
| release train | modify after gates | durable evidence and next action |

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.47 commit `233e71a8`.
- [x] Read-only projection yields exact 4/3/12 queue and 39 residual functions.
- [x] RED fails against the unchanged 16-row active policy.
- [x] M4.47 receipt is byte-identical and loads only as published evidence.
- [x] Only `maxNodeRows` changes, from 16 to 19.
- [x] Exact 19-row witnesses become parameter-ready; exact 20-row fixture fails.
- [x] Base completion remains 60/104 and legacy blockers remain 43.
- [x] No KERN source, generated consumer, family, parser, runtime, KIR, ABI,
      package version, or public API changes.
- [x] Focused gates and complete Node 22.22 `fitness:kern-5` pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push to the
      feature ref and authorized `main`; both remote hashes verify.

## Stop Conditions

- M4.47 receipt digest, source commit, witness identity/order, or headroom differs.
- Any selected function fails the 19/30/388 completion projection.
- Any additional function becomes parameter-ready or directly base-complete.
- Promotion requires changing property/value/runtime/KIR limits or KERN source.
- Exact 20-row rejection cannot be demonstrated.

## Out of Scope

- Migrating the selected 12 legacy parameter rows; that is a later fresh slice.
- Widening property/value rows, runtime limits, KIR depth, or module admission.
- Adding exception-flow or while-iteration families.
- Runtime, KIR, ABI, public API, package version, RC, or stable-release changes.
- Claiming KERN 5 completion.

## Open Questions

[VERIFIED] None block this exact profile promotion. The module-envelope depth
gap remains explicit future KIR work. M4.49 may migrate only the frozen 12-row
queue after M4.48 ships with exact evidence and no unresolved review finding.

## Implementation Evidence

[VERIFIED] The RED test failed first at the missing published M4.47 loader
export. After implementation, the focused promotion/freeze/status suite passed
12/12. The complete canonicalizer gate passes 152/152 tests plus 51 golden,
eight measured, three profile-limit, and 226 hostile fixtures. The hostile
node fixture is exactly 20/22/30 and rejects above the active 19-row ceiling.

[VERIFIED] The active profile is exactly 19/30/388. Base completion remains
60/104 with 43 legacy `fn.params` blockers. The live prerequisite measurement
publishes exactly four functions across three tools and 12 parameter rows,
leaving 39 residual functions. No source parameter is migrated in M4.48.

[VERIFIED] Historical M4.46 and M4.47 receipt bytes remain exact at SHA-256
`67ed659c709adfc5cd51095a3ac5f9549b0384d9651ac3d74894ad4b3aab3402`
and
`0da8ef5be1be0ea2ac12ef739bd6cc38070d60b7b3a775f45602857d40979af1`.
The immutable M4.47 loader authenticates at
`940fcad40fef2751b59623302ba06a0d28b1254f0829a507e50e61fe5dddc19b`.
The final live coverage and prerequisite receipts authenticate at
`c1843e6d6931eb1e81c8fcb11797355acdeb84a7f1b3627048ca697830eb3ffa`
and
`fbc4b671f665d1ed2ebb709201a4c3f4be27d9cec4f18708ce7130fd2b2a7b0a`.
Their shared implementation digest is
`185340b44f0810f30d7e6fdb7d0d5a7aa7205460e83149029a22d38526829789`;
the canonicalizer policy and function-fact digests are
`e5656d77ecce74230c0f300821323ffeacf944a9348a0137f6b9022ca1c02b5c`
and
`678d9ba10414b2df891b35ca4b537cc7f6a43ed1b34697461a6380f4a7c955a7`.

[VERIFIED] Lint, repository consistency, diff hygiene, and the complete Node
22.22 `fitness:kern-5` wall pass. The required browser receipt is 157 modules,
1,553,103 raw bytes, and 333,617 gzip bytes at 56 ms cold and an 87 ms median
(85/87/90 ms samples).

[VERIFIED] Required high-risk role-lens review
`review-1784746347612-zqg77t-kern-5-r2-m4-48-final` routed to all six usable,
non-excluded reviewers. Correctness, security, performance, dryness, and two
overall lenses completed. The two consensus-marked blockers were disproved
against the actual loader: symbol keys are rejected through `Reflect.ownKeys`,
and inherited prototypes are rejected before hashing. Their exact mutation
tests pass 8/8 with the M4.47 freeze suite. The immutable digest pin is the
intended published-handoff boundary after policy moves; the M4.48 test also
asserts semantic fields. Terminal status is emitted only after the checker has
proved the exact active policy and queue. No material finding remains
unresolved. The signed fetch/rebase-and-push is the only remaining procedure.

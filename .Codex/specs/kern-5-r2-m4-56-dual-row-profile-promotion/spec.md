# KERN 5 R2 M4.56 Dual-Row Profile Promotion

**Status:** IMPLEMENTED — FULL GATES AND REVIEW PASS; PENDING PUBLICATION
**Date:** 2026-07-20
**Confidence:** 0.98

## Executive Summary

[VERIFIED] M4.55 shipped from exact commit
`56a45251663840d2d8ab60a8c8ee84ae5b29975b` and authenticates the complete
M4.54-selected seven-function/102-parameter cohort at candidate profile
25/50/388. Its largest exact public-handler runtime floor is 26,356, leaving
22,796 steps below the 49,152 promotion budget and 39,180 below the unchanged
65,536 production ceiling.

[DECIDED] M4.56 raises only `profileLimits.maxNodeRows` from 19 to 25 and
`profileLimits.maxPropertyRows` from 31 to 50. `maxValueRows` remains 388.
The slice freezes M4.55 as an immutable published handoff before policy moves,
proves the exact seven-function/four-tool/102-row parameter-ready queue, and
migrates no KERN source parameter. KERN 5 remains incomplete.

## Published Input

[VERIFIED] The fresh branch
`feat/kern-5-r2-m4-56-dual-row-promotion` starts from exact `origin/main`
commit `56a45251663840d2d8ab60a8c8ee84ae5b29975b`.

[VERIFIED] Published M4.55 evidence is bound by:

- receipt SHA-256
  `10e36abdda5e7de48c65689f9d2a318a6095497bdd3cff81aa64e3ab4e6e535b`;
- live receipt/validator SHA-256
  `4b8635ca9df8a94e87bd77274e8409c2740f89b81d93e30a4a5f4e467a6b07f6`;
- source commit `56a45251663840d2d8ab60a8c8ee84ae5b29975b`;
- candidate profile 25 node rows, 50 property rows, and 388 value rows;
- seven structural-function witnesses across all four tools;
- 102 total parameter rows; and
- explicit exclusion of module-envelope admission.

## Current State and Root Cause

[VERIFIED] The active policy remains 19/31/388 while runtime collection length
is 65,536 and KIR depth is 64
(`scripts/kern-canonicalizer/policy.json`).

[VERIFIED] The live M4.55 module is intentionally tied to the pre-promotion
19/31/388 policy and still owns measurement and writing functions. Changing
policy before freezing that evidence would make the terminal gate fail and
would conflate historical proof with current policy.

[VERIFIED] The M4.54 recommendation changed exactly two limits, selected
25/50/388, and named the same seven functions that M4.55 executes at exact
floor-minus-one/floor boundaries.

## Read-Only Candidate Projection

[VERIFIED] A temporary projection changed only the in-memory policy source to
25/50/388, ran `measureCanonicalizerCoverage` and
`measureCanonicalizerPrerequisite`, and then restored 19/31/388 byte-clean.
It produced:

| Field | Current 19/31/388 | Candidate 25/50/388 |
|---|---:|---:|
| base-complete functions | 65/104 | 65/104 |
| legacy `fn.params` blockers | 38 | 38 |
| parameter-ready functions | 0 | 7 |
| parameter-ready tools | 0 | 4 |
| parameter-ready rows | 0 | 102 |
| `maxValueRows` | 388 | 388 |
| production collection ceiling | 65,536 | 65,536 |
| KIR depth | 64 | 64 |

[VERIFIED] The candidate queue is exact and ordered:

| Witness | Tool | Params | Structural rows |
|---|---|---:|---:|
| `compareNode` | assertion-engine | 13 | 24/39/373 |
| `literalTrue` | checker | 7 | 23/33/244 |
| `checkerWhileRejectDetail` | checker | 22 | 25/49/189 |
| `termProvenanced` | checker | 11 | 24/36/237 |
| `whileRejectDetail` | checker | 22 | 25/48/188 |
| `emitstatementlist` | canonicalizer | 15 | 25/50/235 |
| `owncallable` | validator | 12 | 24/42/212 |

[VERIFIED] After partitioning this queue, prerequisite selection identifies a
one-family `while-iteration` closure for `sortstrings` at 25/43/266. This is
not the M4.56 action: terminal policy gives a non-empty parameter queue
priority, so the next action remains exact 102-row parameter migration. No
family is promoted in this slice.

## Promotion Contract

[DECIDED] The only active policy changes are:

| Limit | Before | After |
|---|---:|---:|
| `maxNodeRows` | 19 | 25 |
| `maxPropertyRows` | 31 | 50 |
| `maxValueRows` | 388 | 388 |

[DECIDED] M4.56 must also prove:

1. M4.55 receipt bytes remain exact at the published SHA-256;
2. M4.55 loads only through a digest-pinned, commit-bound immutable handoff;
3. every M4.54/M4.55 witness becomes parameter-ready in the exact order;
4. no eighth function enters the parameter queue;
5. exact 26-node and 51-property hostile fixtures reject while the promoted
   25/50 boundary is admitted;
6. the 388-value boundary, 65,536 runtime ceiling, and KIR depth 64 remain
   unchanged;
7. the queue remains the next action even though `while-iteration` is the
   selected subsequent prerequisite; and
8. no source, generated consumer, parser, runtime, KIR, ABI, package, version,
   or public API changes.

## Implementation Plan

1. Add the M4.56 promotion/freeze test first and capture RED against the
   unchanged policy or missing published M4.55 loader.
2. Convert M4.55 from a live measurer/writer into an immutable loader pinned to
   receipt digest `10e36abd...` and source commit `56a45251...`; preserve its
   JSON bytes exactly.
3. Raise only node rows 19→25 and property rows 31→50 in `policy.json`.
4. Move the hostile boundary fixtures to exact 26-node and 51-property
   rejection rows, measured as 26/28/38 and 25/51/80 respectively; require
   the same KIR to succeed when only the exceeded ceiling widens by one.
5. Route M4.55 consumers and performance proofs through the published loader;
   update every active-profile assertion without weakening historical
   receipt or causal-boundary checks.
6. Authenticate the exact 7/4/102 queue, selected subsequent
   `while-iteration` prerequisite, and priority of parameter migration.
7. Regenerate only live coverage and prerequisite summaries after source
   bytes settle; keep all historical receipt bytes unchanged.
8. Run focused gates, the standalone canonicalizer wall, full Node 22 fitness,
   and high-risk role-lens review; fix every verified material finding.
9. Create one Agon-signed commit, fetch/rebase, and atomically push the fresh
   feature ref and authorized `main` once with `--no-verify`.

## Blast Radius

| File group | Action | Reason |
|---|---|---|
| this spec and release train | add/update | durable promotion contract |
| M4.55 module and receipt tests | freeze/update | immutable published evidence |
| M4.55 receipt JSON | preserve exactly | causal runtime evidence |
| M4.55 performance oracle | update loader only | keep exact runtime floors |
| M4.56 promotion test | add | policy, queue, history, and drift guard |
| `policy.json` | change two integers | exact dual-row promotion |
| profile fixtures/current-profile tests | update | 25/50 admission and 26/51 rejection |
| prerequisite/current coverage checks | update | exact queue and next-prerequisite state |
| live coverage/prerequisite summaries | regenerate | authenticate current closure |

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.55 commit `56a45251`.
- [x] Read-only projection yields exact 7/4/102 queue.
- [x] Projection keeps base completion 65/104 and legacy blockers 38.
- [x] Projection selects subsequent `while-iteration` while preserving queue
      priority for the next action.
- [x] RED fails against the missing published M4.55 loader.
- [x] M4.55 receipt remains byte-identical and loads only as published evidence.
- [x] Only node rows 19→25 and property rows 31→50 change; value rows stay 388.
- [x] Exact 26-node and 51-property hostile fixtures fail.
- [x] Queue contains only the seven published witnesses and 102 rows.
- [x] No KERN source, generated consumer, family, parser, runtime, KIR, ABI,
      package version, or public API changes.
- [x] Focused gates, full canonicalizer, and complete Node 22 fitness pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Stop Conditions

- M4.55 digest, source commit, witness identity, exact floor, or no-claim scope
  differs.
- Candidate projection differs from exact 7/4/102 or admits an eighth function.
- Promotion changes value/runtime/KIR limits or requires KERN source changes.
- Exact 26-node or 51-property rejection cannot be demonstrated.
- Parameter migration no longer has priority over the subsequent prerequisite.

## Out of Scope

- Migrating the selected 102 parameter rows; that requires fresh M4.57.
- Promoting `while-iteration` or any other family.
- Widening value rows, runtime limits, KIR depth, or module admission.
- Runtime, KIR, ABI, public API, package version, RC, or stable-release changes.
- Claiming KERN 5 completion.

## Open Questions

[VERIFIED] None block this exact promotion. Once published, M4.57 may consume
only the frozen seven-function/102-row queue. The selected `while-iteration`
prerequisite remains evidence for the later post-migration slice.

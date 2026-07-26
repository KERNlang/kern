# KERN 5 R2 M4.94 — `tablesok` Parameter Migration

**Status:** IMPLEMENTED — COMPLETE FITNESS AND INDEPENDENT REVIEW PASSED
**Date:** 2026-07-26
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.93 commit
`76ecd7eaef39db6117a47062f7d09c59c9fc7ae2` removes resumable table-scan
replay and publishes exactly one parameter-ready function:

`examples/kern-canonicalizer/canonicalizer.kern#4:tablesok`.

[DECIDED] M4.94 consumes only that immutable one-function/12-row handoff by
replacing the legacy `fn.params` attribute with 12 ordered structural `param`
children. It does not change the handler body, active profile, runtime/KIR
limits, public runtime ABI, or any historical receipt.

[DECIDED] M4.94 is a parameter-migration milestone, not KERN 5 completion.
The exact post-migration prerequisite result will determine the M4.95 handoff.

## Published Input

[VERIFIED] This fresh branch starts from exact `origin/main` commit
`76ecd7eaef39db6117a47062f7d09c59c9fc7ae2`.

[VERIFIED] The immutable M4.93 runtime-cost receipt is:

- receipt SHA-256
  `62631ce9d2c97e80b6187c0d75bcb878a610ab1076ab8df71a46d53c0e51b3f3`;
- exact table-validation failure/success boundary 1,074/1,075;
- one parameter-ready function and 12 parameter rows;
- target profile 19 node rows, 33 property rows, and 156 value rows; and
- unchanged production ceiling 65,536, promotion budget 49,152, and KIR depth
  64.

[VERIFIED] Published source identities are:

- canonicalizer source
  `923c1edc4d79bf1c5e16554ddcbc86ad077a9a9ffa591ba2810c775b89fad5be`;
- canonicalizer composite
  `aff72db1605a0a5cdcbfe34fae65939e4206b659514641b02c2999da3e94b3ab`;
- composition receipt
  `a09fdf1c63e7debc330018b83017a4569ac52da8d70f774904fd62d1ea28d999`;
- coverage policy
  `b578207467e045913d40da46804bb0fca2285f6351f56ed76e9aa805c6dbcc89`;
- coverage summary
  `e45df04e65cf31c797ae6b218cbebb6a287a23ad4fc09d83336581a2a6094ffd`;
- prerequisite summary
  `a2f8ca92735e7887165aa16cdb19ba482b9a229477029c0fa40df4cc11d648d4`;
  and
- authenticated coverage implementation
  `c96f32d30eae56da4cabe3bb1fa1c19739c95e58349d713b148e6d0e1d4f0628`.

## Exact Migration Contract

[VERIFIED] The pre-migration target is function ordinal 4 with:

- name `tablesok`;
- return type `boolean`;
- `export=true`;
- semantic handler-body digest
  `796d3e287b0cb3e4dd7e534309dffabdb49ffcf7e1a560ad953c0767228f9203`;
  and
- the sole blocker `fn.params`.

[DECIDED] The structural parameter prefix must be exactly:

1. `nodeKind: string[]`
2. `nodeParent: number[]`
3. `nodeOrder: number[]`
4. `propNode: number[]`
5. `propKey: string[]`
6. `propValue: number[]`
7. `valueTag: string[]`
8. `valueParent: number[]`
9. `valueRole: string[]`
10. `valueOrder: number[]`
11. `valueText: string[]`
12. `valueBool: number[]`

[DECIDED] The migration guard must reject:

- any retained, quoted, reordered, duplicated, renamed, or retyped parameter;
- target name, export, return type, ordinal, identity, or body drift;
- new excluded properties or profile blockers;
- profile rows other than exact 19/33/156; and
- any queue other than the exact M4.93 one-function/12-row receipt.

## Implementation Plan

1. Add a RED M4.94 target guard that fails while `tablesok` retains
   `fn.params`.
2. Convert only `tablesok` to ordered structural `param` children.
3. Recompose the canonicalizer from repository writers and bind the new source
   and composite identities.
4. Advance the authenticated frontier from 88/109 to exactly 89/109 and remove
   only `tablesok` from the legacy-parameter blocker list.
5. Regenerate current coverage/prerequisite summaries and publish their exact,
   measured M4.95 handoff.
6. Run focused migration, canonicalizer, complete Node 22 fitness, independent
   review, signed commit, fetch/rebase, and one atomic no-verify push.

## Implemented Evidence

[VERIFIED] `tablesok` now has exactly the 12 ordered structural parameter
children in this specification. Its semantic handler-body digest remains
`796d3e287b0cb3e4dd7e534309dffabdb49ffcf7e1a560ad953c0767228f9203`.

[VERIFIED] The target measures exactly 19 node rows, 33 property rows, and 156
value rows with no excluded property, first-unsupported fact, or profile
blocker.

[VERIFIED] The current frontier is exactly 89/109 base-complete. The only
removed legacy-parameter blocker is `tablesok`; 17 `fn.params` blockers remain.
The active profile is still 74/77/580, the runtime collection ceiling is still
65,536, and KIR depth is still 64.

[VERIFIED] The measured M4.95 handoff is bounded `exception-flow` exhaustion
with 17 residual functions and an empty 0-function/0-row parameter queue. Its
reason-assignment digest remains
`ac1ce11255b827161910b883fb8061606849524c52f9531036dea2570e82264f`.

[VERIFIED] Historical M4.93 receipt bytes remain exact at
`62631ce9d2c97e80b6187c0d75bcb878a610ab1076ab8df71a46d53c0e51b3f3`.
The historical receipt validator now authenticates its embedded published
source identities without requiring the live repository to retain those old
bytes.

[VERIFIED] Current source identities are:

- canonicalizer source
  `8c4266b646738c7a07dcc252bd8426adee299bff62542b5b484d5fb1c7a92ae1`;
- canonicalizer composite
  `987ee019ef9cd8e79dde3261883f3b7aef6ff1d708b6a1ebd99998a801f35e01`;
- composition receipt
  `d5168ec5cfd87375f005bb01907f4752aff7d46a436c050a6eeee173dd97e534`;
- coverage policy
  `3f68fc1e198be2c8072a619170e4494e05c54f8442dffa6271189bbd33a352c7`;
- coverage summary
  `94a111a804372e6b41105bd70fe9031d463961261334b7f98e05e2b91c54e5fa`;
- prerequisite summary
  `e7b913f5c2cd6d0bc6d31ad94620e9fe05c926729680f7624647d20f19a6ce6a`;
  and
- authenticated coverage implementation
  `f3e648ceb482e0b6131c97ee884d623169437408bcea83c427bcf61f99543a0c`.

[VERIFIED] The hand-written canonicalizer remains below the source-size guard
at 494 lines. The complete canonicalizer gate passes 387/387 tests, 55
golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
fixtures, and 235 hostile fixtures.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` release wall exited 0
with `KERN 5 current fitness wall passed`, including repository consistency,
lint/build/workspace tests, source-runner convergence, canonicalizer,
cross-target conformance, runner/capstone/self-host smoke, application
behavior, browser budget, KIR closure, semantic ownership, runtime envelope,
and final diff hygiene.

[VERIFIED] Independent high-risk role review completed with all 6/6 usable
engines, 0 verified findings, 2 needs-check observations, and 12 nits. Manual
disposition:

- the current-frontier assertions repeated by the M4.86 and M4.91 preservation
  guards are confirmed architectural debt, but are pre-existing current-state
  invariants rather than an M4.94 behavior regression;
- the repeated linear child scans, string concatenation, and map-key work are
  confirmed pre-existing performance debt in unchanged handler code;
- removing live-source equality from the historical M4.93 validator is
  intentional: its exact receipt bytes and embedded source identities remain
  authenticated, while live-source integrity remains bound by current coverage
  policy, composition, summaries, and reproduction tests;
- milestone status literals, cross-milestone receipt input, bounded test
  fixture work, and repeated assertion traversals are non-blocking convention
  or test-only nits; and
- the alleged stale M4.92 local in the M4.93 validator is not a defect: M4.92 is
  the exact prerequisite receipt that M4.93 must authenticate.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.93 commit `76ecd7ea`.
- [x] M4.93 queue, target identity, body digest, source identities, and policy
      limits are grounded.
- [x] RED fails at the intended retained-`fn.params` boundary.
- [x] Only `tablesok` receives the exact 12 structural parameter children.
- [x] Handler body digest and accepted/rejected behavior remain exact.
- [x] Coverage advances only from 88/109 to 89/109.
- [x] Legacy `fn.params` blockers fall only from 18 to 17.
- [x] Active profile remains 74/77/580; runtime ceiling remains 65,536; KIR
      depth remains 64.
- [x] M4.93 receipt bytes remain exact.
- [x] The measured post-migration prerequisite publishes the exact M4.95
      handoff without an invented completion claim.
- [x] Generated composite reproduces only from repository writers.
- [x] Focused and complete final gates pass.
- [x] Independent review has no verified blocker.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- The migration changes the handler body or canonical output.
- Any function other than `tablesok` changes parameter representation.
- The post-migration profile exceeds 19/33/156.
- The implementation requires a profile, runtime, KIR, ABI, or policy-limit
  increase.
- Historical M4.93 receipt bytes or prior milestone receipts drift.

## Out of Scope

- Migrating `canonicalize` or any other residual legacy-parameter function.
- Promoting property/value rows or changing runtime cost.
- Raising iteration, collection, row, or KIR-depth limits.
- Runtime cutover, KIR v1 freeze, semantic self-hosting, RC/stable release,
  Fable work, or a KERN 5 completion claim.

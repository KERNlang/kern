# KERN 5 R2 M4.86 — `argProvenanced` Parameter Migration

**Status:** READY TO SHIP — FULL FITNESS AND INDEPENDENT REVIEW GREEN
**Date:** 2026-07-24
**Confidence:** 0.97

## Executive Summary

[VERIFIED] Published M4.85 commit
`63c463cf7f2789dfaba9ed62b19a299f1e813160` promotes only the canonicalizer
coverage profile's `maxValueRows` ceiling to 580 and exposes exactly one
parameter-ready function: `argProvenanced`, with 19 parameter rows and
35/55/580 migrated profile rows.

[DECIDED] M4.86 consumes only that immutable queue by replacing the legacy
`fn.params` string on `argProvenanced` with 19 ordered structural `param`
children. Its name, return type, export state, function ordinal, semantic body,
and callers remain unchanged. No profile, runtime, KIR, parser, ABI, or
historical receipt limit moves. KERN 5 remains incomplete after this slice.

## Published Input

[VERIFIED] Branch `feat/kern-5-r2-m4-86-parameter-migration` starts from clean
`origin/main` at exact commit
`63c463cf7f2789dfaba9ed62b19a299f1e813160`.

[VERIFIED] The exact M4.85 handoff is:

- active profile 38 node rows, 61 property rows, and 580 value rows;
- witness `examples/capstone-checker-subset/checker.kern#16:argProvenanced`;
- one function in one tool and exactly 19 parameter rows;
- migrated structural rows 35/55/580;
- current authored frontier 83/105 with 22 legacy `fn.params` blockers;
- bounded exhaustion with 21 residual functions after excluding the published
  parameter-ready witness; and
- next milestone explicitly `M4.86 consumes it`.

[VERIFIED] The pre-migration checker source SHA-256 is
`a703952e717a77015179987a4e5a6940b0b16846a9c122810e959a595eee5017`.
The immutable M4.84 value-row headroom receipt SHA-256 is
`4b92ced7a43f4aa938a9fe303edcd5fb17b423a61d99b9a8c476ccdc653b8065`.

## Migration Contract

[DECIDED] The ordered structural parameter sequence is exactly:

1. `fnName:string`
2. `argId:number`
3. `argKind:string[]`
4. `argName:string[]`
5. `argNum:string[]`
6. `argOp:string[]`
7. `argLeftKind:string[]`
8. `argLeftName:string[]`
9. `argLeftNum:string[]`
10. `argRightKind:string[]`
11. `argRightName:string[]`
12. `argRightNum:string[]`
13. `stmtKind:string[]`
14. `stmtFn:string[]`
15. `stmtName:string[]`
16. `stmtTarget:string[]`
17. `paramFn:string[]`
18. `paramName:string[]`
19. `paramOrdinal:number[]`

[DECIDED] M4.86 must authenticate M4.85 before asserting the migrated target.
The current queue must become empty, the legacy blocker population must lose
only `argProvenanced`, and the post-migration base-complete/residual counts and
reason-assignment digest must be taken from direct measurement rather than
assumed.

## Implementation Plan

1. Add a focused M4.86 test importing an absent migration module and capture
   RED at the missing-module boundary.
2. Convert only `argProvenanced` to the exact ordered structural parameters,
   regenerate repository-owned checker fixtures if their writer changes them,
   and add an exact source/body/fact guard bound to the M4.85 handoff.
3. Re-measure current coverage and prerequisite exhaustion; update only live
   frontier guards, status text, and deterministic summaries while preserving
   every historical M4.85/M4.84 value.
4. Run focused tests, the complete canonicalizer wall, capstone checker parity,
   and full Node 22 `fitness:kern-5`.
5. Run automatic high-risk role-lens review, fix verified material findings,
   create one Agon-signed commit, fetch/rebase `origin/main`, and atomically
   push the feature branch plus `main` once with `--no-verify`.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.85 commit `63c463cf`.
- [x] RED fails at the intended absent M4.86 module boundary.
- [x] Exact M4.85 one-function/19-row handoff is authenticated.
- [x] Only `argProvenanced` loses legacy `fn.params` and gains 19 ordered
      structural `param` children.
- [x] Function identity, ordinal, return/export contract, semantic body, and
      migrated 35/55/580 profile rows remain exact.
- [x] Current parameter queue is empty and all post-migration frontier values
      match direct measurement.
- [x] Generated checker consumers reproduce only from their repository writer.
- [x] M4.84/M4.85 evidence and active runtime/KIR/profile limits remain exact.
- [x] Focused, complete canonicalizer, capstone, and full Node 22 fitness gates
      pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- M4.85 exposes a queue other than the exact `argProvenanced` witness.
- Structural conversion changes the semantic body, signature order/type,
  function identity, callers, or checker behavior.
- Any policy limit or historical receipt changes.
- Direct measurement exposes an additional parameter-ready function or loses
  bounded exhaustion without an explained causal path.

## Plan Delta

[VERIFIED] Direct GREEN measurement confirms 84/105 base-complete functions,
21 `fn.params` blockers, an empty parameter queue, and bounded exhaustion with
21 residual functions. The reason-assignment digest remains
`0e6700b777a3cf2f5ed462636ba292ef69df90de141e3466b8831d8f190b7328`.
No additional tranche became selectable.

[VERIFIED] The migrated checker source SHA-256 is
`a04a2242cb7762b9753f16e49cc0b849eadd736d2d1667d691d267603394ad59`;
the semantic body digest remains
`a5f4c679b2db4d48ab8f3779bc6e02285c730be9c2497a36bada5d3321532915`.
The repository writer changed the generated aggregate checker SHA-256 to
`fe870142a814fc82e6bbb25c1bc8395d97a228e87d8ad175ed6794490305cc41`
because source line metadata moved; numeric output remains
`4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a`.

[VERIFIED] Focused M4.86/status tests pass 38/38, the complete canonicalizer
suite passes 336/336, composition and semantic CLI validation pass, the
canonicalizer runtime passes 55 golden/idempotence/KIR fixtures plus 235
hostile fixtures, and capstone parity passes 48/48 with 36 abstention attempts
rejected. Full Node 22 `pnpm fitness:kern-5` passes with the terminal marker
`KERN 5 current fitness wall passed.`

## Independent Review

[VERIFIED] Agon review `review-1784898792118-q558t3` routed all six usable
independent engines with automatic high-risk role lenses. All 6/6 completed;
consensus reported zero verified findings, four needs-check items, one
speculative item, and nine nits.

[VERIFIED] The four needs-check items are non-defects: the M4.84 performance
test's live structured witness is independently bound by the exact M4.86
signature/body/fact guard; the M4.86 status deliberately describes the
immutable M4.85 queue that was consumed while live queue emptiness is asserted
separately; the coverage policy format has no top-level digest field and its
derived digest was regenerated in the live summaries; and official
canonicalizer/fitness commands build core `dist` before importing it. No
material review item remains unresolved.

## Out of Scope

- Selecting or consuming any subsequent residual tranche.
- Changing profile limits or canonicalizer runtime cost.
- Module-envelope admission, projection depth/nodes, unknown expressions,
  exception-flow, KIR freeze, runtime cutover, release versioning, or Fable.

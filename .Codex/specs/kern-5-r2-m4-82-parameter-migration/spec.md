# KERN 5 R2 M4.82 — checkWhileCore Parameter Migration

**Status:** READY TO SHIP — LOCAL FITNESS + INDEPENDENT REVIEW GREEN
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.81 commit
`e8ff7714d21266c8990384c543b96580a028e1f1` raises only
`maxPropertyRows` from 53 to 61 and publishes exactly one parameter-ready
function: `checkWhileCore`, with 22 legacy parameter rows and migrated profile
rows 38/61/460.

[DECIDED] M4.82 freezes those published prerequisite bytes, replaces only the
legacy `fn.params` property on `checkWhileCore` with the exact ordered 22
structural `param` children, regenerates the checker fixture consumer, and
advances current base completion from 81/105 to 82/105. No profile, runtime,
KIR, parser, ABI, package version, handler body, or call-site behavior changes.

## Published Input

[VERIFIED] This branch
`feat/kern-5-r2-m4-82-parameter-migration` starts at exact `origin/main`
commit `e8ff7714d21266c8990384c543b96580a028e1f1`.

[VERIFIED] The immutable M4.81 prerequisite summary has SHA-256
`d41669c95edfab7e6a088abd14841f93fd49ea9c0daa4a0369230effb8859e7d`.
It records:

- base completion 81/105;
- 23 legacy `fn.params` blockers;
- active profile 38/61/461;
- exactly `examples/capstone-checker-subset/checker-while.kern#16:checkWhileCore`;
- exactly 22 parameter rows and migrated profile rows 38/61/460; and
- bounded exhaustion with 22 residual functions.

[VERIFIED] The authored source is
`examples/capstone-checker-subset/checker-while.kern`, SHA-256
`84ca20346a655595cbaab095e3b46b964e46acabd90ead29d1d1a3c6813e8b60`,
with 303 lines and 18 function roots. `checkWhileCore` has semantic body digest
`89bda0c358c1a825dd05d9843fc436f2cfa8e061181315a29fa1365b7a1ed7a0`.
The generated checker main has SHA-256
`c73f0356534ee83eac5d81609d178fcbc67709a0c3ca291a62f79eeb9ad19c2e`.

## Ordered Migration Target

[VERIFIED] The legacy property contains these exact ordered name/type pairs:

1. `row:number`
2. `stmtKind:string[]`
3. `stmtFn:string[]`
4. `stmtParent:number[]`
5. `stmtName:string[]`
6. `stmtTarget:string[]`
7. `stmtExprKind:string[]`
8. `stmtExprName:string[]`
9. `stmtExprNum:string[]`
10. `stmtExprLeftKind:string[]`
11. `stmtExprLeftName:string[]`
12. `stmtExprLeftNum:string[]`
13. `stmtExprLeftMemberObject:string[]`
14. `stmtExprLeftMemberProp:string[]`
15. `stmtExprRightKind:string[]`
16. `stmtExprRightName:string[]`
17. `stmtExprRightNum:string[]`
18. `stmtExprRightMemberObject:string[]`
19. `stmtExprRightMemberProp:string[]`
20. `paramFn:string[]`
21. `paramName:string[]`
22. `paramType:string[]`

## Implementation Plan

1. Freeze the exact M4.81 prerequisite summary as immutable
   `coverage-prerequisite-m4-81.json` plus a canonical-byte, digest-bound,
   non-symlink loader tied to the published M4.81 commit.
2. Add a RED M4.82 target guard proving `checkWhileCore` still exposes legacy
   `fn.params` and lacks the required structural parameter prefix.
3. Replace only that property with the 22 ordered `param` children and
   regenerate `examples/capstone-checker-subset/main.kern` from its repository
   writer.
4. Preserve historical migration target/body guards while removing their
   coupling to mutable whole-source and generated-artifact hashes. Own current
   source/artifact integrity in the M4.82 contract and the existing generator
   reproduction checks.
5. Update the centralized current frontier to 82/105, 22 legacy blockers, an
   empty parameter queue, and the unchanged 22-function bounded-exhaustion
   residual; regenerate current artifacts and bind M4.82 into the terminal
   checker/status chain.
6. Run focused RED/GREEN tests, generator checks, complete canonicalizer and
   Node 22 fitness, high-risk independent review, signed commit, fetch/rebase,
   and one atomic no-verify push.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.81 commit.
- [x] Immutable M4.81 handoff loads only exact canonical JSON bytes with digest
      `d41669c95edfab7e6a088abd14841f93fd49ea9c0daa4a0369230effb8859e7d`.
- [x] RED proves the target still has legacy `fn.params` before migration.
- [x] `checkWhileCore` has no `fn.params` property and has exactly the ordered
      22 direct structural parameter children before its handler.
- [x] Target name, ordinal, return type, export flag, handler language, semantic
      body digest, call sites, and measured migrated profile 38/61/460 remain
      exact.
- [x] Authored source has 18 function roots and exactly three remaining legacy
      parameter functions: `numericBindingProven`, `lengthReceiverProven`, and
      `comparisonOperandsOk`.
- [x] Generated checker main reproduces byte-for-byte from its repository
      writer; numeric main remains byte-identical.
- [x] Current coverage becomes exactly 82/105 with 22 legacy blockers.
- [x] Current parameter-migration queue becomes empty; outcome stays bounded
      exhaustion with the same 22 residual functions.
- [x] Active profile stays 38/61/461, runtime ceiling 65,536, and KIR depth 64.
- [x] Published M4.81 and all older receipt bytes remain unchanged.
- [x] Focused gates, complete canonicalizer, terminal checker, and complete
      Node 22 `fitness:kern-5` wall pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Stop Conditions

- The frozen M4.81 bytes or digest cannot be reproduced.
- Migration changes the target semantic body digest or generated behavior.
- Any function other than `checkWhileCore` changes in authored source.
- Completion requires profile/runtime/KIR widening or parser/ABI changes.
- The post-migration frontier differs from 82/105, 22 blockers, empty queue,
  and 22-function bounded exhaustion.

## Out of Scope

- Migrating the remaining 22 legacy-parameter functions.
- Any additional profile widening or runtime optimization.
- Module-envelope admission, stable KIR, semantic self-hosting, release
  readiness, or a KERN 5 completion claim.

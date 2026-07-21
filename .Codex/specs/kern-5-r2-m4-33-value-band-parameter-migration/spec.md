# KERN 5 R2 M4.33 — Frozen Value-Band Parameter Migration

**Status:** IMPLEMENTED — REVIEW HARDENED, READY TO PUBLISH
**Date:** 2026-07-21
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.32 commit
`e02c4191037905366b12182dfad553eb36cf7613` promotes only the canonicalizer
value-row admission ceiling from 72 to 106 and authenticates an exact
12-function, four-tool, 44-row cohort that becomes base-complete after
parameter representation alone is migrated.

[DECIDED] M4.33 consumes exactly that frozen cohort. It removes each target's
legacy `fn.params` property, prepends equivalent ordered direct `param`
children, regenerates affected repository-owned consumers and live receipts,
and changes no function body, call, return, root ordinal, capability family,
profile limit, runtime, KIR, or ABI.

## Published Input

[VERIFIED] M4.32's exact SHA-256 evidence is:

- canonicalizer policy:
  `9d3229bc2554adf7b49ff2fa0cba8885d156cb2f4e4b3b20fc9094719fc32279`;
- coverage summary:
  `5f2519ef25f7e66564a684485eb4a1c5c7b0b40946d9b1dff40bd03d73f3ae08`;
- prerequisite summary:
  `274819d899252c815d9caeb9203077a4c5dca29003070c61108cb920444b1e79`;
- immutable M4.31 residual handoff:
  `160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076`;
- authenticated implementation digest:
  `216067ddd4c3833aa13485d26184326a9bec318d454c744e6dff7d51cffce4ba`.

[VERIFIED] The live M4.32 baseline is 33/104 base-complete with 69
`fn.params` blockers, no ordinary active-family winner, and an exact
parameter-ready partition of 12 functions, four tools, and 44 rows. The
remaining partition selects `do-statement` alone through validator function
`appendid`, with two counterfactual parameters and 176 occurrences.

## Frozen Cohort

| Function | Ordered direct parameters | Rows N/P/V | Tool |
|---|---|---:|---|
| `compareTrees` | `pA:number[]`, `kA:string[]`, `xA:number[]`, `tA:string[]`, `vA:string[]`, `pB:number[]`, `kB:string[]`, `xB:number[]`, `tB:string[]`, `vB:string[]` | 13/25/106 | assertion-engine |
| `previousSiblingKind` | `row:number`, `stmtKind:string[]`, `stmtParent:number[]` | 10/18/77 | checker |
| `functionRow` | `fnName:string`, `stmtKind:string[]`, `stmtName:string[]` | 9/15/85 | checker |
| `isForCounter` | `fnName:string`, `binding:string`, `stmtKind:string[]`, `stmtFn:string[]`, `stmtName:string[]` | 13/21/104 | checker |
| `isAssigned` | `fnName:string`, `binding:string`, `stmtKind:string[]`, `stmtFn:string[]`, `stmtTarget:string[]` | 13/21/104 | checker |
| `paramOrdinalOf` | `fnName:string`, `binding:string`, `paramFn:string[]`, `paramName:string[]`, `paramOrdinal:number[]` | 12/20/96 | checker |
| `argIndexOf` | `callId:number`, `ordinal:number`, `argCall:number[]`, `argOrdinal:number[]` | 11/18/84 | checker |
| `validfirst` | `c:string` | 8/11/100 | canonicalizer |
| `structuralname` | `value:string` | 10/16/104 | canonicalizer |
| `charokfirst` | `c:string` | 10/13/92 | validator |
| `classrow` | `module:number`, `name:string`, `classModule:number[]`, `className:string[]` | 11/19/89 | validator |
| `contained` | `root:string`, `candidate:string` | 9/13/73 | validator |

[VERIFIED] Their source identities and root ordinals are the exact ordered
M4.32 receipt witnesses. Migration must not reorder roots, rename bindings, or
substitute another function with an equivalent signature.

## Migration Contract

| Surface | Contract | Tag |
|---|---|---|
| Scope | exactly 12 receipt witnesses and 44 rows | VERIFIED |
| Header | remove only legacy `params`; preserve every other property | DECIDED |
| Children | prepend exact ordered direct `param` rows before the handler | DECIDED |
| Semantics | preserve every location-normalized non-parameter child and target body digest | DECIDED |
| Siblings | preserve non-target root order and source semantics | DECIDED |
| Profile | remain exactly 16/30/106 and base M4.29 | DECIDED |
| Families | remain do, exception, while in current order | DECIDED |
| Provenance | preserve all historical selection/prerequisite records and M4.31 handoff bytes | DECIDED |
| Measurement | remeasure live coverage/prerequisite facts after source changes | DECIDED |

## Generated Consumers

[VERIFIED] `canonicalizer-expression-helpers.kern` is an authenticated member
of the checked-in composite. Its two migrations require
`scripts/kern-canonicalizer/composition.mjs --write`; statement-helper and main
member bytes must remain exact.

[VERIFIED] The checker fixture writer flattens fixture source that includes the
self-host validator. The three validator migrations require
`scripts/capstone-checker-subset/gen-fixtures-kern.mjs`; the separately
generated numeric fixture must remain byte-identical.

[DECIDED] Exactly five handwritten coverage members change: assertion compare,
checker-while, checker, canonicalizer expression helpers, and validator. The
other four corpus member digests remain exact.

## Expected Live Transition

[INFERRED] Exact consumption should advance base completion from 33/104 to
45/104 and reduce legacy `fn.params` blockers from 69 to 57. The base-only
parameter-migration partition should become empty because every M4.32-ready
witness is consumed.

[INFERRED] The residual single-family selection should remain
`do-statement`, one function, one tool, two counterfactual parameter rows, and
176 occurrences through `examples/selfhost-validator/validator.kern#14:appendid`.
Exact digests, blocker census, file lengths, and generated bytes are measured
outputs and must not be guessed into the terminal checker.

## Performance Boundary

[VERIFIED] M4.32 measured the exact worst-case synchronous boundary at 14.089
seconds locally versus 4.636 seconds at 72 rows. M4.33 does not widen policy or
modify table validation. That budgeted optimization remains mandatory before
runtime cutover or RC and is not hidden by this source migration.

## RED Plan

1. Add exact source assertions for all 12 target identities, signatures, root
   ordinals, non-parameter body digests, file lengths, and frozen profile rows.
2. Update existing structured-migration sibling assertions so only the known
   M4.33 cohort may become direct; all remaining siblings stay legacy.
3. Add live receipt assertions expecting 45/104, 57 blockers, an empty
   parameter queue, and the exact residual do winner. On published M4.32 these
   assertions must fail for the intended source boundary.

## Implementation Plan

1. Land RED exact-source and receipt guards without weakening historical
   migration assertions.
2. Rewrite only the 12 frozen headers and prepend the 44 direct parameter rows.
3. Regenerate the checker fixture consumer and canonicalizer composite; verify
   unrelated generated and handwritten bytes remain unchanged.
4. Update exactly five corpus digests, regenerate live coverage/prerequisite
   summaries, and pin measured post-migration evidence.
5. Run focused assertion-engine, checker, validator, and canonicalizer gates;
   then run the complete Node 22 `fitness:kern-5` wall and automatic high-risk
   role-lens Agon review.
6. Resolve verified findings, commit with Agon identity, fetch/rebase onto
   `origin/main`, atomically push the fresh feature ref and authorized main
   once with `--no-verify`, verify both refs, and start the next slice fresh.

## Acceptance Criteria

- [x] Fresh branch starts at published M4.32 commit
      `e02c4191037905366b12182dfad553eb36cf7613`.
- [x] Exact 12-function/four-tool/44-row input is grounded from M4.32.
- [x] RED fails on unchanged M4.32 at the intended source-shape boundary.
- [x] Exactly 12 targets lose `fn.params` and gain 44 ordered direct rows.
- [x] Target bodies, other properties, root ordinals, calls, and returns remain
      exact; no mixed parameter representation exists.
- [x] Exactly five handwritten corpus digests change; other corpus and all
      historical provenance/handoff bytes remain exact.
- [x] Repository writers regenerate affected consumers with unrelated outputs
      byte-identical.
- [x] Every migrated target reproduces its frozen M4.32 profile rows.
- [x] Live coverage is exactly 45/104 with 57 `fn.params` blockers and no
      ordinary winner.
- [x] Live base-only parameter queue is empty; residual do selection is exact.
- [x] Focused gates and complete `fitness:kern-5` pass.
- [x] Full usable-roster review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push to the
      feature ref and authorized main; both remote hashes verify.

## Stop Conditions

- A target requires a body, call, return, capability, runtime, KIR, or ABI edit.
- Any target identity, parameter order/type, or frozen profile row differs.
- Any non-cohort legacy function becomes direct or any migrated function keeps
  mixed legacy/direct parameters.
- Base completion/blockers differ from 45/104 and 57 after exact migration.
- `appendid` ceases to be the exact disjoint residual do witness.
- M4.31 handoff or any historical provenance byte changes.
- The 16/30/106 boundary no longer passes the unchanged runtime envelope.

## Out of Scope

- Implementing or promoting do, exception, or while.
- Migrating `appendid` or another residual legacy signature.
- Changing the 16/30/106 policy or optimizing `tablesok` in this slice.
- KIR v1 freeze, public reader export, runtime cutover, or KERN 5 completion.

## Open Questions

None. The published M4.32 receipt fixes the complete source-migration cohort;
post-migration coverage and the next prerequisite are measured, never assumed.

## Implementation Evidence

[VERIFIED] The unchanged M4.32 source failed RED at the first post-migration
source boundary: `checker-while.kern` remained 261 lines instead of the
required 267. After the exact edits, every one of the 12 targets matches its
ordered direct signature and its pre-migration, location-normalized semantic
body digest.

[VERIFIED] The five changed handwritten corpus SHA-256 values are:

- assertion compare:
  `3f2deb4f9defee02126107fd5b5adcae915a0d03e515bb2d27a41ff89ab4aabd`;
- checker while:
  `25b047708b20db3f292523414fc87fc571cffa7dad4051edae6bc219d7166cbb`;
- checker main:
  `3761995d062daaaefecae3b35a21f6642848d63764f53653a59f4c70c4ac81fe`;
- canonicalizer expression helpers:
  `f42bca77f6271cbd6292f2e11c2249cff269a9b9e67b29c5cce9e16d7ee512e4`;
- self-host validator:
  `91028ca731e7054d72339bff91e86c2bac5bf271e8895732e9cd157c80a2f920`.

[VERIFIED] The generated canonicalizer composite is 40,459 bytes at
`e58663c3bdc552faa094b8318650f8791f30056ceea81a4888293fc64f348101`;
its composition record is
`e410f6abaa7b613805a9b7851ae5fda77110ba75ec28d592cc9d1255a3cfbc04`.
The validator-derived checker fixture changed as required, while
`numeric-main.kern`, both non-target assertion sources, and the canonicalizer
statement-helper/main members remained byte-identical.

[VERIFIED] The exact M4.33 coverage-policy, coverage-summary, and prerequisite
summary SHA-256 values are respectively
`cc4b84c8655a458890edb6c7b79a07a5c1af7997db172a559c7cdeec47ff33b6`,
`8550b80e0a98da57f26a9c78ac762b0049cc02146202b278e817bf07051d774a`,
and `d8c2fdd07c96ce6548edd1121ae0eea1596c14a52f25d4caab15cf259edf1e1c`.
The authenticated implementation digest is
`3e47fea76a74d98bf742777d486a6b2f898d569bee01c1526942b87f6f1271c4`;
the immutable M4.31 handoff remains byte-identical at
`160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076`.

[VERIFIED] Final-byte focused coverage, prerequisite, provenance-handoff,
parameter-order, and terminal checker gates pass 39/39. The complete
canonicalizer structural/authentication suite passes 99/99 tests, while the
source-integrated runtime gate passes 48 golden/idempotence/KIR
fixtures, eight measured witnesses, three profile-limit fixtures, and 218
hostile fixtures. Live output is 45/104, 57 `fn.params` blockers, no ordinary
tranche, zero parameter-ready functions/rows, and the exact one-family
`do-statement` prerequisite. The complete Node 22 `fitness:kern-5` wall passes
on the same settled tree.

[VERIFIED] Initial automatic high-risk role-lens review
`review-1784669163876-ojpnpj` completed all six usable non-excluded seats and
correctly found that the new guard was absent from its supplied diff while it
remained untracked. After adding the complete file through intent-to-add,
complete-diff review `review-1784669744046-mlgid4` completed 6/6 and exposed
one material guard weakness: filtered parameter comparison could accept a
later parameter after the handler. RED reproduced that exact parser-valid
mutation. The guard now requires the complete ordered parameter prefix followed
immediately by the handler, and the new mutation-killing test passes. Targeted
Claude security confirmation
`review-1784669870369-4xtdh7-kern-5-r2-m4-33-value-band-param` returned zero
findings on the hardened tree. Other review suggestions were verified as
intentional generated composition, independent receipt authentication, or
immutable historical pins. Final exact-diff review
`review-1784672564559-4cf8of-kern-5-r2-m4-33-value-band-param` completed 7/8
usable non-excluded seats with zero verified or needs-check findings; OpenCode
had a parse failure. Its lone low-confidence speculative claim was disproved
against the current file: the pinned live assertions execute in the non-write
branch, as the passing plain check-mode gate confirms. No material finding
remains.

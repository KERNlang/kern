# KERN 5 R2 M4.131 — Validate Direct-Parameter Migration

**Status:** IMPLEMENTED AND VERIFIED — PENDING PUBLICATION
**Date:** 2026-07-29
**Confidence:** 0.96

## Executive Summary

[VERIFIED] M4.130 published exactly one migration-ready function:
`examples/selfhost-validator/validator.kern#20:validate`, with 41 legacy
parameter rows across the validator tool.

[VERIFIED] The promoted policy admits the migrated function at profile
202/308/4493 and KIR 273051/98/5313, with exact factor-derived runtime byte
ceilings 1092204/2184408.

[DECIDED] M4.131 consumes only that queue by replacing `validate`'s legacy
`params` property with 41 direct `param` children in the identical order and
types. Its exported state, return contract, handler, and semantic body remain
unchanged.

[DECIDED] Successful migration advances the current cumulative base from
103/112 to 104/112 and removes only `validate` from the legacy-parameter
blocker set. The remaining three blockers are the canonicalizer functions
`quotesource`, `expressionsources`, and `canonicalize`.

## Inputs

- [VERIFIED] M4.130 published commit:
  `cc179223602a19288f45a76484ab3ea8c2ee2d00`.
- [VERIFIED] M4.130 queue: one function, 41 rows, one validator tool.
- [VERIFIED] Target function ordinal: 20.
- [VERIFIED] Target semantic body digest:
  `a4c62d180c5f7522bd6566310ed8c3991329996e1c367d9f55cfa475f3011cb7`.
- [VERIFIED] Pre-M4.131 validator source SHA-256:
  `96a1c96800132f2401d743eac02f0efe8cb0717980ceb56c2af531798790eaac`.
- [VERIFIED] Target returns unquoted `string[]` and is exported.

## Contract

| Claim | Tag |
|---|---|
| Consume exactly the immutable M4.130 migration queue | DECIDED |
| Remove only `validate`'s legacy `params` property | DECIDED |
| Add exactly 41 direct `param` children in source order | DECIDED |
| Preserve every parameter name and type exactly | DECIDED |
| Preserve function name, ordinal, export, and return contract | DECIDED |
| Preserve handler and semantic body digest exactly | DECIDED |
| Preserve runtime/handler ABI and canonicalizer policy | DECIDED |
| Advance current coverage only from 103/112 to 104/112 | DECIDED |
| Reduce legacy blockers only from four to three | DECIDED |
| Publish an empty post-migration parameter queue | DECIDED |
| Preserve all M4.126-M4.130 receipts byte-identically | DECIDED |
| Reconstruct pre-M4.131 validator source for historical replay | DECIDED |

## Exact Parameter Order

1. `schemaVersion:number`
2. `moduleId:number[]`
3. `moduleRoot:string[]`
4. `moduleStatus:string[]`
5. `fnModule:number[]`
6. `fnName:string[]`
7. `fnReturns:string[]`
8. `fnAsync:number[]`
9. `fnStream:number[]`
10. `fnHandlers:number[]`
11. `fnParams:string[]`
12. `fnExport:number[]`
13. `paramFn:number[]`
14. `paramName:string[]`
15. `paramHasChildren:number[]`
16. `paramHasValue:number[]`
17. `paramHasDefault:number[]`
18. `paramOptional:number[]`
19. `paramVariadic:number[]`
20. `classModule:number[]`
21. `className:string[]`
22. `classExtends:string[]`
23. `classExport:number[]`
24. `fieldClass:number[]`
25. `fieldName:string[]`
26. `memberClass:number[]`
27. `memberKind:string[]`
28. `memberName:string[]`
29. `memberAsync:number[]`
30. `memberStream:number[]`
31. `memberStatic:number[]`
32. `memberHandlers:number[]`
33. `useModule:number[]`
34. `usePath:string[]`
35. `useTarget:number[]`
36. `useCandidate:string[]`
37. `fromUse:number[]`
38. `fromName:string[]`
39. `fromAs:string[]`
40. `fromKind:string[]`
41. `fromExport:number[]`

## Design

### Migration owner

Add an M4.131 owner following the established parameter-migration contract. It
must bind M4.130's immutable queue, assert the exact source identity and direct
parameter prefix, prove the unchanged semantic body digest, and prove the
current coverage fact has no excluded properties or profile blockers.

The owner publishes an empty post-migration queue and an exact status line for
104/112 with three remaining legacy blockers.

### Historical replay

The validator source digest changes when the direct parameter children are
written. Historical loaders must reconstruct the exact pre-M4.131 legacy
signature and substitute its old corpus digest before replaying any archived
coverage, projection, structural-headroom, bottleneck, or runtime-cost receipt.

Checked-in M4.126-M4.130 receipts are evidence and must not be regenerated or
edited.

### Current frontier

The current coverage summary and prerequisite summary are regenerated from the
new direct source. Only these current derived artifacts may advance. The
remaining residual frontier is remeasured from the current source; no claim is
made about the next promotion until that exact result is observed.

## Implementation Plan

1. Add RED M4.131 owner, status, mutation, and historical-reconstruction tests.
2. Migrate exactly the 41 `validate` parameters and update its corpus digest.
3. Add pre-M4.131 historical source/policy reconstruction to every archived
   measurement path affected by the validator source change.
4. Wire the M4.131 owner into the central gate and current-frontier assertions;
   regenerate current summaries twice to prove convergence.
5. Run targeted tests, complete canonicalizer tests, full KERN 5 fitness, and
   high-risk role-lens review; fix verified findings, rebase, and push once.

## Acceptance Criteria

- [x] RED tests fail before the direct-parameter migration exists.
- [x] M4.131 consumes the exact immutable M4.130 queue.
- [x] `validate` has no legacy `params` property.
- [x] `validate` has exactly 41 direct parameters in the specified order/types.
- [x] Name, ordinal, exported state, return contract, handler, and body digest
      remain exact.
- [x] The migrated coverage fact has no exclusions or profile blockers.
- [x] Current cumulative coverage is exactly 104/112.
- [x] Exactly three legacy-parameter blockers remain.
- [x] The post-migration queue is exactly empty.
- [x] M4.126-M4.130 receipts remain byte-identical and executable.
- [x] Historical reconstruction rejects unrelated live source or policy drift.
- [x] Current summaries converge byte-identically on a second generation.
- [x] Complete canonicalizer and full KERN 5 fitness gates pass.
- [x] High-risk automatic role-lens review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main verifies.

## Verification Evidence

- [VERIFIED] RED phase: the M4.131 owner/status tests failed because their
  implementation modules did not yet exist.
- [VERIFIED] `pnpm test:kern-canonicalizer`: 600/600 tests passed, followed by
  55 golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
  fixtures, 235 hostile fixtures, and exact 104/112 coverage reproduction.
- [VERIFIED] `pnpm fitness:kern-5`: the complete current fitness wall passed,
  including repository consistency, lint, build, workspace tests, cross-target
  conformance, native KERN, runner/self-host smoke, browser budget, KIR seams,
  semantic ownership, runtime ABI, convergence, and canonicalizer closure.
- [VERIFIED] Agon role-lens review:
  `/Users/nicolascukas/.agon/runs/review-1785346145013-croexx-m4-131-validate-parameter-migrat`;
  6/6 engines succeeded with zero verified findings.
- [VERIFIED] The review's historical-reconstruction ordering concern was
  checked against the implementation: all signature replacements are derived
  from the live source and applied atomically before the historical digest is
  checked. The archival tests exercise this path.
- [VERIFIED] The remaining review observations concern deliberate frozen-data
  duplication or unchanged validator algorithms; none changes this
  body-preserving migration.

## Stop Conditions

- M4.130's queue differs from one function/41 rows/one tool.
- Any parameter name, type, order, or count differs from the published target.
- The semantic body digest, function identity, export, or return contract moves.
- Any M4.126-M4.130 checked-in receipt byte changes.
- Coverage advances by anything other than one function.
- A non-`validate` legacy blocker changes.
- Runtime, handler ABI, corpus membership, or canonicalizer limits change.

## Out of Scope

- Migrating `quotesource`, `expressionsources`, or `canonicalize`.
- Selecting or promoting the next exception-flow prerequisite.
- KIR v1 freeze, runtime cutover, semantic self-hosting, RC/stable release,
  Fable, or a KERN 5 completion claim.

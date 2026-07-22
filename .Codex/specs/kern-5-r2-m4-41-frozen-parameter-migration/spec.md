# KERN 5 R2 M4.41 Frozen 154-Row Parameter Migration

**Status:** IMPLEMENTED — RELEASE GATES PASSED; PUBLICATION PENDING
**Date:** 2026-07-20
**Confidence:** 0.94

## Executive Summary

M4.40 publishes an exact base-only queue of 11 legacy-signature functions
across checker, canonicalizer, and validator sources. M4.41 will consume that
queue as a representation-only migration: remove each target's legacy
`fn.params` property, prepend the same 39 ordered direct `param` children, and
regenerate only authenticated consumers and live receipts. It will not change
function bodies, calls, profile limits, structural families, runtime, KIR, ABI,
or public APIs.

## Current State / Root Cause

- [VERIFIED] Published M4.40 is commit
  `54fc7b58c4d53d1a4bf2d16697d3247492f867fb`; both remote `main` and
  `feat/kern-5-r2-m4-40-list-index` resolved to that hash through
  `git ls-remote origin`, 2026-07-20.
- [VERIFIED] The active profile remains
  `kern.kir-canonicalizer.profile.m4.36`, with 46/104 base-complete functions
  and 56 legacy `fn.params` blockers
  (`scripts/kern-canonicalizer/coverage-prerequisite-summary.json:2-16`).
- [VERIFIED] M4.40's authenticated queue is exactly 11 functions, three tools,
  and 39 parameter rows
  (`scripts/kern-canonicalizer/coverage-prerequisite-summary.json:90-205`).
- [VERIFIED] Each queued function already fits the exact 16/30/154 profile
  after counterfactual parameter representation alone is migrated; the receipt
  binds every function identity, parameter count, and N/P/V row triple
  (`scripts/kern-canonicalizer/coverage-prerequisite-summary.json:95-204`).
- [VERIFIED] With the queue excluded, both remaining structural families are
  bounded-exhausted: three non-empty closures produce zero completing closures
  over 45 residual functions
  (`scripts/kern-canonicalizer/coverage-prerequisite-summary.json:18-89`).

The root cause is representational, not semantic. These functions still encode
parameters in the excluded `fn.params` string even though direct `param`
children are already admitted by the base profile
(`scripts/kern-canonicalizer/coverage-policy.json:3-64`).

## What Already Works

- [VERIFIED] M4.40's complete Node 22 fitness wall passes, including all 22
  workspaces, 434/434 cross-target fixtures, 109/109 class fixtures, and
  233/233 native assertions at 100% coverage
  (`docs/kern-5-release-train.md:2403-2408`).
- [VERIFIED] The canonicalizer's exact 15/24/154 witness succeeds at the
  authenticated 34,700-iteration floor under the unchanged 65,536 ceiling
  (`docs/kern-5-release-train.md:2382-2389`).
- [VERIFIED] Earlier parameter slices already provide exact direct-prefix,
  immediate-handler, semantic-body-digest, sibling, and profile-row guards in
  `scripts/kern-canonicalizer/coverage-parameter-migrations.mjs` and
  `scripts/kern-canonicalizer/coverage-value-band-parameter-migrations.mjs`.
- [VERIFIED] The four affected handwritten files are already authenticated
  corpus members (`scripts/kern-canonicalizer/coverage-policy.json:85-120`).

## Frozen Migration Contract

> Verified against the M4.40 prerequisite receipt and current source on
> 2026-07-20.

| Function | Ordered direct parameters | Rows N/P/V | Evidence | Tag |
|---|---|---:|---|---|
| `checker-while#10:isLengthType` | `raw:string` | 9/12/138 | receipt lines 95-104; source line 153 | VERIFIED |
| `checker-while#5:checkerElseRejectDetail` | `row:number`, `stmtKind:string[]`, `stmtParent:number[]` | 15/21/115 | receipt lines 105-114; source line 70 | VERIFIED |
| `checker#19:mapArgToken` | `callId:number`, `ordinal:number`, `argCall:number[]`, `argOrdinal:number[]`, `argKind:string[]`, `argName:string[]` | 15/24/120 | receipt lines 115-124; source line 224 | VERIFIED |
| `checker#8:isArrayBinding` | `fnName:string`, `binding:string`, `stmtKind:string[]`, `stmtFn:string[]`, `stmtName:string[]`, `stmtExprKind:string[]` | 15/24/128 | receipt lines 125-134; source line 66 | VERIFIED |
| `expression-helpers#10:propid` | `node:number`, `key:string`, `propNode:number[]`, `propKey:string[]`, `propValue:number[]` | 14/25/126 | receipt lines 135-144; source line 113 | VERIFIED |
| `expression-helpers#12:childat` | `parent:number`, `order:number`, `nodeParent:number[]`, `nodeOrder:number[]` | 13/23/122 | receipt lines 145-154; source line 133 | VERIFIED |
| `expression-helpers#14:valuechildat` | `parent:number`, `order:number`, `valueParent:number[]`, `valueOrder:number[]` | 13/23/122 | receipt lines 155-164; source line 153 | VERIFIED |
| `expression-helpers#15:recordfield` | `parent:number`, `key:string`, `valueParent:number[]`, `valueRole:string[]` | 14/25/135 | receipt lines 165-174; source line 163 | VERIFIED |
| `expression-helpers#2:valididentifier` | `value:string` | 10/16/148 | receipt lines 175-184; source line 17 | VERIFIED |
| `expression-helpers#3:validexpressionidentifier` | `value:string` | 8/11/149 | receipt lines 185-194; source line 27 | VERIFIED |
| `validator#18:hasimportcyclefrom` | `module:number`, `useModule:number[]`, `useTarget:number[]`, `path:number[]` | 15/24/154 | receipt lines 195-204; source line 281 | VERIFIED |

For every target:

- [DECIDED] Remove only the legacy `params` property and prepend the exact
  ordered direct parameters before the handler.
- [DECIDED] Preserve every other function property, normalized non-parameter
  child, root ordinal, call site, return, and exported status.
- [DECIDED] Reject mixed representation, reordered/mistyped parameters, a
  parameter after the handler, target substitution, or semantic-body drift.
- [DECIDED] Keep profile limits exactly 16/30/154 and keep exception-flow and
  while-iteration as the exact active family order.
- [DECIDED] Preserve every historical selection, prerequisite handoff, and
  residual-analysis receipt byte-for-byte.

## Implementation Options

### A. Consume the exact 11-function queue in one frozen migration

Recommended. It matches the authenticated M4.40 receipt, produces one coherent
post-migration measurement, and avoids inventing a new selection policy inside
an already selected cohort.

### B. Split the queue by tool

Rejected. The receipt selects one exact cross-tool cohort, and splitting it
would create arbitrary intermediate states, repeat expensive full-wall runs,
and require unauthenticated tranche-order policy.

### C. Skip migration and analyze or promote another family

Rejected. The current terminal evidence explicitly exposes a complete
parameter queue while no structural closure completes. Family work before
consuming the queue would bypass the live admission frontier.

## Expected Transition

- [VERIFIED] Exact consumption advances base completion from 46/104 to 57/104
  and reduces legacy blockers from 56 to 45. The current authenticated queue
  contains exactly 11 functions, and the live algorithm defines blockers as
  the remaining `fn.params` facts
  (`coverage-prerequisite-summary.json:2-16,90-205`;
  `coverage-prerequisite.mjs:429-463`).
- [VERIFIED] The parameter queue becomes exactly
  `{completeFunctions:0,completeTools:0,migratedParameterRows:0,witnesses:[]}`;
  the row builder always emits this shape, including for an empty partition
  (`coverage-prerequisite.mjs:227-241`).
- [VERIFIED] The same 45 residual functions remain bounded-exhausted over the
  same two families, with the same reason census and assignment digest, because
  the current algorithm partitions the 11 queue members away from those exact
  45 residuals before closure selection
  (`coverage-prerequisite.mjs:434-466`;
  `coverage-prerequisite-summary.json:18-89`).
- [VERIFIED] Terminal guidance becomes authenticated current residual-blocker
  analysis, not an implicit profile or family promotion: no queue remains and
  the exact structural search remains bounded-exhausted.

Generated live receipts must reproduce these derived facts. Any mismatch stops
the slice for root-cause analysis rather than changing the oracle.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | durable frozen contract and evidence |
| `checker-while.kern` | modify | two queued signatures |
| `checker.kern` | modify | two queued signatures |
| `canonicalizer-expression-helpers.kern` | modify | six queued signatures |
| `validator.kern` | modify | one queued signature |
| checker-subset `main.kern` | regenerate | checker/validator-derived fixture |
| canonicalizer composite and composition receipt | regenerate | expression-helper member changed |
| self-host validator `main.kern` and checker `numeric-main.kern` | verify unchanged | negative generated-consumer boundary |
| a new M4.41 migration assertion module | add | keep hand-written files below 500 lines |
| coverage test, policy, live receipts, and exact tests | modify/regenerate | authenticated transition |
| terminal coverage check and release train | modify | measured next action and release evidence |

## RED and Implementation Plan

1. Add an isolated M4.41 assertion module that binds all 11 identities,
   ordinals, ordered parameters, pre-migration semantic body digests, profile
   rows, post-migration source lengths 271/391/191/494, sibling representation,
   and generated-consumer boundaries. Mutation guards cover missing,
   duplicated, reordered, renamed, mistyped, mixed, post-handler, substituted,
   body/property, ordinal, sibling, and generated-output drift. Run it on
   published M4.40 and capture the intended source-shape failure.
2. Add post-migration live receipt assertions for the predicted 57/104 and 45
   blocker boundary, empty queue, unchanged bounded exhaustion, exact profile,
   and preserved historical evidence. Do not rewrite receipts yet.
3. Rewrite only the 11 frozen signatures and rerun the RED guard.
4. Run the repository writers for the checker fixture and canonicalizer
   composition; prove unrelated generated artifacts remain byte-identical.
5. Update exactly four corpus digests, regenerate live coverage/prerequisite
   receipts, and replace predictions only with measured facts.
6. Run focused checker, validator, canonicalizer, receipt, handoff, and browser
   policy gates; then run the complete Node 22 `fitness:kern-5` wall.
7. Run automatic high-risk role-lens independent review, resolve verified
   findings, fetch/rebase, create one Agon-signed commit, and atomically push
   the fresh feature ref plus explicitly authorized `main` once with
   `--no-verify`.
8. Verify both remote refs and start M4.42 from a new branch at fresh
   `origin/main`; never reuse the M4.41 branch.

## Challenge Evidence

- [VERIFIED] Full usable non-excluded Agon brainstorm
  `brainstorm-1784711599738-il23i0-kern-5-r2-m4-41-parameter-migrat`
  completed 6/6 engines.
- [DECIDED] Initial approach: consume the exact cross-tool queue in one frozen
  migration, regenerate the checker fixture and canonicalizer composition, and
  authenticate live post-state receipts.
- [DECIDED] Plan delta: pin the exact zero-valued empty queue object, add exact
  post-source line counts 271/391/191/494, make the full mutation matrix
  explicit, and preserve self-host validator `main.kern`, checker
  `numeric-main.kern`, unrelated composition members, and historical M4.38
  receipts as negative byte-stability evidence.
- [VERIFIED] Proposed `generated/contracts`, `generated/src`, runtime queue
  accessors, transaction locks, and sender authorization were rejected as
  hallucinated surfaces: repository search found no such parameter consumers,
  while the real dependency edges are the checker fixture registry
  (`scripts/capstone-checker-subset/fixtures.mjs:114-133`) and canonicalizer
  composition (`scripts/kern-canonicalizer/composition.json:8-23`).
- [VERIFIED] No dependency remains open. Confidence rises from 0.79 to 0.94.

## Measured Implementation Evidence

- [VERIFIED] The isolated RED guard failed on unchanged M4.40 at the intended
  source-shape boundary (`267 !== 271`) before any migration was applied.
- [VERIFIED] The four handwritten sources now authenticate at 271/391/191/494
  lines and SHA-256 `6d42fe55e330523cf734fbe6476a3020f95271f68bdf2c9c14a2ed580d2b343f`,
  `d52e8a601020cfb43d9740d4107fcb974f22e5ebbe64eb41a29f0dc4b9bba0bd`,
  `1d4c95f4801dc3f7eae268872bf111f56b49a8a778576e463292daed4206b63f`,
  and `0bb516e32a63802f9a23e0e93b5f55f942bd24c93b343a1678a6cbfcd2bccd56`.
- [VERIFIED] Live receipts measure 57/104 base-complete, 45 legacy-parameter
  blockers, an exact zero-valued parameter queue, and unchanged bounded
  exhaustion across three non-empty closures and 45 residual functions. The
  reason-assignment digest remains
  `a965461fa32dc4bbb1fdfa3ca153d91d019865e6ddb10e57f64087be6d7402bf`.
- [VERIFIED] The canonicalizer composite is 43,578 bytes at SHA-256
  `2b39f976b7eeb3e2cedc400821880a77edc11b99a72d0e24a28ddec8cabaeb4c`;
  the checker fixture is
  `d6a47919ef06a6cb6674d5ba94fbb706184ed7244c8d7d9015bb5d2e87b8301c`.
  The checker numeric fixture, validator fixture, and unrelated canonicalizer
  member remain byte-identical at their frozen negative-boundary hashes.
- [VERIFIED] Focused validation passes 113/113 canonicalizer tests plus
  51/8/3/226 canonicalizer fixtures, 48/48 checker fixtures, and 39/39
  self-host-validator verdict lines.
- [VERIFIED] The complete Node 22 `fitness:kern-5` wall passes, including all
  22 workspace projects, 434/434 cross-target fixtures, 109/109 class
  fixtures, 233/233 native assertions at 100% coverage, whole-app behavior,
  browser budgets, runtime/KIR ownership, and the repeated canonicalizer
  replay. The required browser measurement is 157 modules, 1,553,103 raw
  bytes, 333,617 gzip bytes, and a 92 ms median (88/92/93 ms samples).
- [VERIFIED] Automatic medium-risk role-lens review
  `review-1784714230963-a42g97-kern-5-r2-m4-41-final` completed 2/2 independent
  reviewers with no material finding. Its sole nit requested confirmation of
  the truncated validator line-count pin; the current source binds it to 494,
  and the full wall exercises that exact assertion.

## Acceptance Criteria

- [x] Fresh branch starts at published M4.40 commit `54fc7b58`.
- [x] RED fails on unchanged M4.40 at the intended legacy-parameter boundary.
- [x] Exactly 11 targets lose `fn.params` and gain 39 ordered direct params.
- [x] Target bodies, calls, properties, ordinals, and siblings remain exact;
      no target admits mixed or post-handler parameters.
- [x] Exactly four handwritten corpus digests change; all other corpus and
      historical evidence remains byte-identical.
- [x] Checker fixture and canonicalizer composite reproduce through their
      repository writers; unrelated generated outputs remain exact.
- [x] Every migrated target reproduces its frozen M4.40 profile rows under
      unchanged 16/30/154 limits.
- [x] Live base completion/blocker counts and the empty parameter queue are
      regenerated and pinned from the implementation.
- [x] Residual exhaustion and terminal next action are measured, not assumed.
- [x] Focused gates and the complete Node 22 KERN 5 fitness wall pass.
- [x] Automatic role-lens review has no unresolved material finding.
- [ ] Signed Agon commit is fetched/rebased before one atomic no-verify push to
      the feature ref and authorized `main`; both refs are verified.

## Out of Scope

- Function bodies, call sites, return behavior, parser, runtime, codegen, KIR,
  ABI, public exports, package versions, or browser budget policy.
- Profile widening or promotion of exception-flow/while-iteration.
- New residual ranking policy or claiming KERN 5 completion.

## Deploy Order

This is a single-repository evidence migration with no external version-skew
window. Generated consumers and live receipts ship atomically with their four
handwritten sources.

## Open Questions

No product decision or implementation dependency remains open. The full
fitness wall, independent review, and remote publication receipts remain as
release gates.

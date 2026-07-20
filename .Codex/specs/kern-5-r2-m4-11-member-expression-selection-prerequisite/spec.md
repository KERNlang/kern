# KERN 5 R2 M4.11 — Member-Expression Selection Prerequisite

**Status:** SEALED — READY TO PUBLISH
**Date:** 2026-07-20
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Immutable M4.10 commit
`ab67a7eac5ebcf6e9c1c188b9b1b84f63c142b6e` records 20 of 104 corpus
functions base-complete, 82 functions blocked by legacy `fn.params`, all eight
candidate families at zero completions, and a `null` winner.

[VERIFIED] Exact AST-level read-only migration measurement found one bounded
signature change that creates the first post-call family winner: migrating only
`examples/capstone-checker-subset/checker-while.kern#8:isPositiveSafeIntText`
from `params="raw:string"` to one ordered direct `param` child produces profile
rows 8/10/70 with no blocker. Base completion remains 20/104, `fn.params`
blockers fall to 81, and `member-expression` becomes the sole winner with one
checker witness and 259 corpus occurrences.

[VERIFIED] The only second apparent witness, validator function `contained`,
becomes 9/13/73 after its two direct params and therefore remains blocked by
the frozen 72-value-row ceiling. Migrating it alone selects nothing; migrating
it beside the checker target does not improve the one-function winner.

[DECIDED] M4.11 migrates only `isPositiveSafeIntText`. It establishes causal
selection evidence but does not freeze provenance, implement member-expression
canonicalization, promote the family, change profile limits, or claim any KIR,
runtime, public-reader, or semantic-self-hosting milestone.

## M4.10 Baseline / Root Cause

[VERIFIED] M4.10 intentionally exhausted functions that become complete in the
base profile through parameter representation alone. Remaining legacy
signatures can still mask candidate-family evidence: `isPositiveSafeIntText`
is otherwise inside the frozen profile, but its body contains member access and
its legacy signature contributes the excluded `fn.params` property. The live
selector therefore cannot credit the member-expression family until that
unrelated representation blocker is removed.

[VERIFIED] Removing `fn.params` abstractly from all current facts yields only
two apparent member-expression witnesses across two tools and no witness for
the other seven families. Exact structured-param row measurement distinguishes
them:

| Function | Params | Baseline rows | Migrated rows | Result |
|---|---:|---:|---:|---|
| `isPositiveSafeIntText` | 1 | 7/8/67 | 8/10/70 | member witness |
| `contained` | 2 | 7/9/67 | 9/13/73 | blocked by value rows |

[VERIFIED] Current checker-while source is 256 lines with 18 functions: three
direct-form functions and 15 legacy-form siblings. The selected edit produces
257 lines, four exact direct-form functions, six total direct params, and 14
internally consistent legacy-form siblings. Parameter-form consistency is a
per-function invariant; mixed forms inside one function remain forbidden.

## Contract

> Verified against immutable M4.10 source and exact in-memory AST measurement on 2026-07-20.

| Behavior | Contract | Tag |
|---|---|---|
| Exact source scope | Rewrite only `isPositiveSafeIntText`'s signature | VERIFIED |
| Parameter | one direct `param name=raw type=string` before handler | VERIFIED |
| Source isolation | preserve target body and every non-target source byte | VERIFIED |
| Mixed module | 4 direct functions / 14 legacy siblings; no mixed function | VERIFIED |
| Target rows | exactly 8 nodes / 10 properties / 70 values, no blocker | VERIFIED |
| Base result | exactly 20/104 complete and 81 `fn.params` blockers | VERIFIED |
| Selection | `member-expression`: 1 function, 1 tool, 259 occurrences, exact witness | VERIFIED |
| Other families | seven rows remain zero; no tie | VERIFIED |
| Frozen profile | 16/30/72 limits, schema, registry, and base remain unchanged | VERIFIED |
| Provenance | prior binary/conditional/call records remain byte-identical | VERIFIED |
| Ownership | no implementation, promotion, export, cutover, or self-hosting claim | VERIFIED |

## Options Measured

| Scope | Params changed | Winner credit | Decision |
|---|---:|---:|---|
| checker target only | 1 | member 1/1 | Select: minimum exact causal boundary |
| validator `contained` only | 2 | none | Reject: 73 value rows |
| both apparent witnesses | 3 | member 1/1 | Reject: broader, identical result |
| all remaining legacy params | large | member 1/1 at most | Reject: unrelated executable churn |
| raise value-row ceiling | 0 | changes evidence policy | Reject: unauthenticated profile widening |
| implement member expressions now | n/a | mixes selection and implementation | Reject: destroys causal handoff |

## Implementation Plan

1. Add RED assertions for the exact 257-line source partition, one new direct
   param, target rows 8/10/70, 20/104 base completion, 81 legacy blockers, and
   the exact one-witness member-expression winner.
2. Prove RED fails on immutable M4.10 before changing source.
3. Rewrite only the target signature, prove the old coverage policy rejects
   the checker-while digest, update only that corpus digest, regenerate the
   checker fixture through its repository generator, and rewrite the coverage
   summary through its authenticated writer.
4. Run checker and canonicalizer focused gates plus the complete Node 22
   `pnpm fitness:kern-5` wall.
5. Run automatically routed terminal Agon review, seal evidence, fetch/rebase,
   and publish once. Stop before provenance freeze or member implementation.

## Expected Blast Radius

| File | Action | Reason |
|---|---|---|
| `examples/capstone-checker-subset/checker-while.kern` | modify one signature | remove unrelated selection blocker |
| `examples/capstone-checker-subset/main.kern` | regenerate | embedded checker source fixture |
| `scripts/kern-canonicalizer/coverage-parameter-migrations.mjs` | extend assertions | exact source/profile boundary |
| `scripts/kern-canonicalizer/coverage.test.mjs` | pin result | authenticated receipt and ranking |
| `scripts/check-kern-canonicalizer-coverage.mjs` | pin M4.11 totals/winner | standalone gate |
| `scripts/kern-canonicalizer/coverage-handoff.test.mjs` | pin live selection | preserve frozen prior provenance |
| `scripts/kern-canonicalizer/coverage-policy.json` | update one digest | authenticate changed corpus member |
| `scripts/kern-canonicalizer/coverage-summary.json` | regenerate | canonical measured receipt |
| `docs/kern-5-release-train.md` | record slice | durable release evidence |
| this spec | seal decision and results | cross-session contract |

## Acceptance Criteria

- [x] RED fails on immutable M4.10 at the exact source/count/ranking boundary:
      selector remained `null` and source remained 256 lines before the source
      migration.
- [x] Source is exactly 257 lines and 18 functions: four exact direct targets,
      six direct params, and 14 legacy siblings with no mixed form.
- [x] `isPositiveSafeIntText` retains name, return type, body, calls, and
      behavior; its only representation change is `raw:string` as a direct
      child before its handler.
- [x] Old policy rejects specifically on checker-while digest drift before only
      that corpus digest changes.
- [x] Authenticated target rows are 8/10/70 with no blocker; base completion is
      20/104 and `fn.params` blocker count is 81.
- [x] Member expression is the unique winner at 1 function / 1 tool / 259
      occurrences with only the exact checker witness; every other family is
      zero.
- [x] `contained` remains unmodified and measured 9/13/73 alternative evidence
      cannot receive selection credit under the frozen profile.
- [x] Canonicalizer executable/composition, profile/schema/family registry, and
      all three historical promotion records remain byte-identical.
- [x] Checker parity remains 48/48 and all 36 hostile attempts reject.
- [x] Focused gates and the complete Node 22 fitness wall pass.
- [x] Automatically routed terminal review has no unresolved material finding.

## Measured Result

[VERIFIED] The pre-source RED run failed only the two intended boundary
assertions: the M4.10 source remained 256 lines and its selector remained
`null`. After migrating the one signature, the old authenticated policy failed
specifically with `corpus member examples/capstone-checker-subset/checker-while.kern digest drift`.

[VERIFIED] Repository-owned regeneration now measures 20/104 base-complete, 81
`fn.params` blockers, and the unique `member-expression` winner at 1 function,
1 tool, and 259 occurrences with only
`examples/capstone-checker-subset/checker-while.kern#8:isPositiveSafeIntText`.
All seven other candidate families remain at zero completions. The checker
source is 257 lines with 18 functions, six direct parameters, and 14 legacy
signatures; the target profile is exactly 8/10/70.

[VERIFIED] The focused canonicalizer gate passes 67/67 structural tests, 21
golden/idempotence/KIR fixtures, seven measured witnesses, three profile-limit
fixtures, and 140 hostile fixtures. The checker gate passes all three adapter
tests, 48/48 oracle fixtures, and 36 hostile rejections. Numeric main remains
byte-identical at `4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a`.
The 32,310-byte composite remains byte-identical at
`e2930f10fddfbfc2682d420ec61e494a7171f051801455336f213af2e719e59b`;
validator source/main and every historical provenance record also remain
byte-identical.

[VERIFIED] The exact implementation tree passes the complete Node 22
`pnpm fitness:kern-5` wall: repository consistency, lint, production build, all
workspace and infrastructure suites, 432/432 cross-target fixtures, 109/109
class fixtures, 233 native assertions at 100% coverage, 48/48 checker fixtures
plus 36 hostile rejections, 39/39 validator verdicts, 40 whole-app fixtures on
three legs, drift and browser budgets, KIR/runtime/ownership/convergence guards,
and repeated canonicalizer evidence all pass.

## Stop Conditions

- Target rows differ from 8/10/70, base completion changes, blocker reduction
  differs from one, or the exact winner differs from member 1/1/259.
- A second function must migrate, another family gains credit, or selection
  depends on widening any frozen limit.
- Any target body or non-target checker source byte changes.
- Canonicalizer source/composition, historical selection provenance, schema,
  profile, family registry, or ownership proof changes.
- Checker generated evidence cannot be reproduced by its repository generator.
- Any focused, hostile, complete-wall, or terminal-review gate fails.

## Out of Scope

- Migrating `contained` or any other legacy signature.
- Freezing the M4.11 winner into a fourth provenance record.
- Implementing or promoting member-expression canonicalization.
- Changing profile limits, candidate families, parser, runtime, or checker
  behavior.
- Claiming KIR v1 freeze, public reader export, runtime cutover, or semantic
  self-hosting.

## Deploy Order

[VERIFIED] Source, generated checker fixture, corpus digest, authenticated
receipt, tests, spec, and release evidence ship atomically after fetch/rebase
and one push. No skewed deployment is supported. The next slice must start from
published M4.11 and freeze its exact selection before implementation.

## Confidence Gate

[VERIFIED] Initial decision confidence was 0.88 before exact row measurement.
The exact AST transformation raised it to 0.94 by eliminating the validator
alternative. Per doctrine, one Nero adversarial challenge ran before
implementation because the initial score entered the 0.85-0.89 band.

## Challenge Adjudication

[VERIFIED] Nero run `nero-1784580513555-745pht` returned `FLAWED` with three
scenarios. None applies to the repository contract:

- It treated 259 member-expression occurrences as rewrite targets with macros.
  The selector computes 259 as a read-only aggregate over existing facts;
  M4.11 rewrites one signature and no expression occurrence.
- It invented raw database/API traffic. `isPositiveSafeIntText` is an offline
  checker helper called once with `stmtExprRightNum[i]`; its reference oracle
  is `scripts/capstone-checker-subset/reference.mjs` and no database, route, or
  network edge exists in this surface.
- It treated the direct parameter as a schema change awaiting a later server
  implementation. Direct and legacy parameter declarations already produce
  identical checker facts, direct params are already runtime-bound, and mixed
  forms fail closed in parser, adapter, and runtime tests. Source and generated
  fixture ship atomically.

[DECIDED] Plan delta is documentation precision only: make the absence of an
external API/deployment seam explicit. No source scope, expected count, or
deploy order changes. No challenge dependency remains unresolved. Confidence
rises from 0.94 to 0.97.

## Terminal Review

[VERIFIED] Automatically routed medium-risk Agon review
`review-1784582535977-ppv228` completed 2/2 independent reviewers: Kimi's
overall lens and Agy's security lens. Consensus reports zero verified,
needs-check, or speculative findings and three non-blocking nits.

[VERIFIED] The stale future-tense wording is corrected. The proposed witness
reordering does not apply because receipt function ids are intentionally
canonical lexicographic strings, where `#8` follows `#13`; this adjudication
makes that invariant explicit without changing authenticated implementation
bytes. The generated-fixture concern was diff-alignment noise: exact old/new
flatten comparison found every non-location array
byte-equivalent, equal `stmtLine`/`idxLine`/`callLine` lengths of 214/62/41,
and zero mismatches against the required one-line offset from old source line
96 onward. No material finding remains unresolved.

[VERIFIED] A second doctrine-triggered challenge,
`nero-1784580580093-6mkbc1`, returned `FLAWED` at 15% after proposing four
additional scenarios. Direct audit rejects them as category errors:

- a direct `param` child is the exact measured AST change and creates no
  invented internal binding; the measured post-migration rows are 8/10/70;
- 259 is the selector's corpus-wide member-expression occurrence total, not a
  count of calls to `isPositiveSafeIntText`; the source has one unchanged call;
- `contained` remains an unselected measurement witness, not a deployed
  runtime rule, and this slice forbids implementation or promotion;
- blocker and family completion are computed independently from immutable
  per-function facts, so one declaration cannot mutate the remaining facts.

[VERIFIED] The RED canonicalizer run on unchanged M4.10 source failed at the
two exact intended boundaries: the selection winner remained `null` instead
of the member-expression receipt, and checker-while remained 256 rather than
257 lines. All other canonicalizer tests passed. No adversarial dependency
remains unresolved; build confidence remains 0.97.

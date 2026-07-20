# KERN 5 R2 M4.10 — Final Parameter-Only Canonicalizer Prerequisite

**Status:** SEALED
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Immutable M4.9 commit
`8fe558d0a1a5723106b286c7129baf75c06a4b6c` records 19 of 104 corpus
functions base-complete, 83 functions blocked by the excluded legacy
`fn.params` property, all eight remaining candidate families at zero
completions, and a `null` winner (`scripts/kern-canonicalizer/coverage-summary.json`).

[VERIFIED] Exact authenticated read-only in-memory migration measurement on
that commit found one—and only one—remaining function that becomes
base-complete by replacing its existing legacy signature with ordered direct
`param` children:
`examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#1:validnext`.
Its one `c:string` parameter changes the profile from 5/7/50 to 6/9/53 and
introduces no blocker.

[VERIFIED] M4.10 migrates only `validnext`. This is the final parameter-only
completion prerequisite: it advances base completion to 20 of 104 and reduces
`fn.params` blockers to 82 while keeping every candidate family at zero. The
slice does not authorize a family promotion; it closes the last isolated
signature representation gap before the next measured prerequisite design.

## M4.9 Baseline / Root Cause

[VERIFIED] The expression-helper member is 165 lines with 16 functions, all
using non-empty legacy signatures. `validnext` is defined at
`examples/kern-canonicalizer/canonicalizer-expression-helpers.kern:9`; its
only excluded property is `fn.params`, and its current profile has no profile
blocker. Replacing the signature in memory with one direct `param` produces
6 node rows, 9 property rows, and 53 value rows, all inside the frozen base
limits.

[VERIFIED] The source member is the first of three exact-byte composition
members (`scripts/kern-canonicalizer/composition.mjs:18-27`). The checked-in
composite and `composition.json` authenticate byte length and SHA-256 for every
member and for their exact ordered concatenation
(`scripts/kern-canonicalizer/composition.mjs:177-217,274-281`). A source-only
edit therefore must fail the old composition record before repository-owned
generation updates both derived artifacts.

[VERIFIED] Current authenticated identities are:

- expression helper SHA-256
  `c5bbf6412e1ca4fb8af40f8042331e2084f2f5950f490b83d8220b1b8e17c39c`;
- composite SHA-256
  `279725b92d959ddbc734f096749d904fde36934ef4a1c73769e87a84e6e72087`;
- composition-record SHA-256
  `6331d09a62df5f74c4274955d39dc1af6ba6f409778d3f765cc4c23d90299c2d`.

## What Already Works

[VERIFIED] Direct structured parameters are already parsed, type-preserving,
runtime-bound, code-generated, and rejected when mixed with legacy text. Five
earlier migrations exercise 38 direct parameter rows across assertion,
checker, and validator sources; M4.10 adds no language feature.

[VERIFIED] Canonicalizer tests parse each source member, enforce the under-500
line ceiling, authenticate exact composition, execute every valid fixture,
exercise 140 hostile fixtures, and bind the coverage receipt
(`scripts/kern-canonicalizer/canonicalizer.test.mjs:8-41`, package
`test:kern-canonicalizer`).

[VERIFIED] The checker fixture corpus does not embed either canonicalizer
source member or composite (`rg -n "kern-canonicalizer|canonicalizer" scripts/capstone-checker-subset/fixtures.mjs`
returned zero hits on 2026-07-20). No checker fixture regeneration is required.

## Contract

> Verified against immutable M4.9 source and authenticated coverage measurement on 2026-07-20.

| Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Exact source scope | Rewrite only `validnext`'s signature | helper source `:9-10` | VERIFIED |
| Parameter | one direct `param name=c type=string`, before handler | current signature plus direct-param grammar | VERIFIED |
| Source isolation | Other 15 functions and the complete body/call/export remain byte-equivalent | exact source-diff oracle | VERIFIED |
| Mixed-module validity | One direct-form target coexists with 15 legacy siblings | existing per-callable representation guard | VERIFIED |
| Composition | Regenerate exact composite and record only through `composition.mjs --write` | composition writer `:274-281` | VERIFIED |
| Canonicalizer behavior | Preserve all golden, idempotence, KIR, measured, profile, and hostile fixtures | canonicalizer gate | VERIFIED |
| Coverage result | Exactly 20/104 complete and 82 legacy blockers | exact in-memory measurement | VERIFIED |
| Selection result | Eight families remain at zero and winner remains `null` | target becomes base-complete without family facts | VERIFIED |
| Historical provenance | Frozen binary/conditional/call selection records remain byte-identical | coverage handoff contract | VERIFIED |
| Public ownership | No public export, runtime cutover, KIR freeze, or semantic-self-hosting claim | ownership/eligibility gates | VERIFIED |

## Implementation Options

| Scope | Functions | Params | New completions | Source result | Decision |
|---|---:|---:|---:|---:|---|
| `validnext` only | 1 | 1 | 1 | 166 helper lines | Select: only measured completion |
| Entire expression-helper member | 16 | 47 | 1 | 212 helper lines | Reject: same gain and unnecessarily broad executable diff |
| Stop parameter work at 19/104 | 0 | 0 | 0 | unchanged | Reject: leaves the sole isolated measured gap open |
| Promote a candidate family now | n/a | n/a | 0 | broader source | Reject: authenticated ranking has no winner |

No external pre-implementation challenge is required. The authenticated
measurement contains a single candidate, all alternatives are strictly broader
or make no progress, and confidence exceeds the canonical 0.90 threshold.

## Implementation Plan

1. Add RED assertions for the exact 166-line helper, 16 functions, one exact
   target, one ordered direct parameter, 15 legacy siblings, 6/9/53 profile,
   20 base completions, 82 `fn.params` blockers, and null winner.
2. Prove RED fails on immutable M4.9 before editing source.
3. Rewrite only the `validnext` header and add its direct parameter child.
4. Prove the old composition record and coverage policy reject the source-only
   edit; regenerate composite/record through `composition.mjs --write`, update
   only the changed corpus digest, and rewrite the authenticated coverage
   summary.
5. Run focused canonicalizer gates, the complete Node 22 fitness wall, and
   automatically routed terminal review. Stop before migrating a second helper
   or promoting any family.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern` | Modify one signature | remove final parameter-only blocker |
| `examples/kern-canonicalizer/canonicalizer.composed.kern` | Regenerate | exact ordered executable composition |
| `scripts/kern-canonicalizer/composition.json` | Regenerate | authenticate member and composite bytes |
| `scripts/kern-canonicalizer/coverage-parameter-migrations.mjs` | Extend exact migration assertions | RED and permanent boundary evidence |
| `scripts/kern-canonicalizer/coverage.test.mjs` | Pin 20/104 and 82 | live authenticated totals |
| `scripts/kern-canonicalizer/coverage-policy.json` | Update helper digest only | authenticate changed corpus member |
| `scripts/kern-canonicalizer/coverage-summary.json` | Regenerate | authenticated receipt and composition identity |
| `scripts/check-kern-canonicalizer-coverage.mjs` | Pin current totals | standalone coverage gate |
| `scripts/kern-canonicalizer/coverage-handoff.test.mjs` | Pin current totals | frozen provenance handoff |
| `docs/kern-5-release-train.md` | Record M4.10 | release evidence |
| this spec | Seal measured result | durable contract |

## Acceptance Criteria

- [x] RED fails on the unchanged 165-line helper before implementation.
- [x] Migrated helper is exactly 166 lines with 16 functions: one exact
      direct-form target, one direct param, and 15 legacy-form siblings.
- [x] `validnext` retains name, export, return type, body, and call behavior;
      all non-signature helper bytes remain unchanged.
- [x] Old composition metadata rejects the changed member before repository
      generation updates exact member/composite bytes and record.
- [x] Old coverage policy fails specifically on the expression-helper member
      before only that corpus digest changes.
- [x] Authenticated coverage is exactly 20/104 with 82 `fn.params` blockers and
      target profile 6/9/53.
- [x] All eight candidate families remain at zero and winner remains `null`;
      corpus/tool/function counts remain 9/4/104.
- [x] Frozen schema, profile, family registry, and binary/conditional/call
      promotion provenance remain unchanged.
- [x] Checker, validator, and their generated fixtures remain byte-identical.
- [x] Focused gates and the complete Node 22 `pnpm fitness:kern-5` wall pass on
      the exact implementation tree.
- [x] Automatically routed terminal Agon review has no unresolved material
      finding.

## Measured Result

[VERIFIED] RED on the unchanged M4.9 executable failed only at the new exact
boundaries: base completion remained 19 rather than 20 and the helper remained
165 rather than 166 lines. After the source-only edit, the old composition
record rejected the expression-helper metadata and the old coverage policy
rejected that member's digest before either authenticated artifact was
updated.

[VERIFIED] Repository-owned composition generation produced a 6,357-byte
helper at SHA-256
`0f26a889dc98604f419b12b3afa9f1d3ac305dc97fd3464c1534f0dc3cdd6f02`,
a 32,310-byte composite at SHA-256
`e2930f10fddfbfc2682d420ec61e494a7171f051801455336f213af2e719e59b`,
and composition-record SHA-256
`f9ef5950a5564fef51d78dac6cbfe548be2194fecc3a571a82b1dbbcf3fa1955`.
The other two composition members remained byte-identical.

[VERIFIED] Authenticated measurement now records exactly 20/104 complete, 82
`fn.params` blockers, target rows 6/9/53, all eight families at zero, and a
`null` winner. The focused Node 22 canonicalizer gate passes all 67 tests. The
validator source/main and checker main/numeric fixture remain byte-identical at
SHA-256 `a46ab0d4...`, `9ac7774a...`, `0f783b80...`, and `4bef89f9...`
respectively.

[VERIFIED] The exact implementation tree passes the complete Node 22
`pnpm fitness:kern-5` wall: repository consistency, lint, production build,
all workspace and infrastructure suites, 432/432 cross-target fixtures,
109/109 class fixtures, 233 native assertions at 100% coverage, 48 checker
fixtures plus 36 hostile rejections, 39 validator verdicts, 40 whole-app
fixtures across three legs, browser budget, KIR/runtime/ownership/convergence
guards, and the repeated canonicalizer receipt at 20/104 with 82 blockers and
no selected tranche.

[VERIFIED] Preliminary automatically routed terminal review
`review-1784580066541-ki9752` completed both requested independent reviewers
with zero verified, needs-check, or speculative findings and one editorial
nit. It remains recorded as preliminary evidence.

[VERIFIED] Superseding full-roster terminal review
`review-1784580218054-0u53yc-kern-5-r2-m4-10-terminal-boundar` completed all
six usable engines with zero verified, needs-check, or speculative findings
and eight non-blocking nits. Review-triggered audit confirmed the questioned
imports are present and exercised by the passing wall, corrected the exact
earlier-migration parameter count and source line citation, and preserves the
preliminary M4.9 receipt as superseded history. The current-value assertion
labels intentionally name M4.10 while the test title separately preserves the
M4.5c origin. No material finding remains unresolved. This post-review sealing
metadata was not input to its own review.

## Stop Conditions

- Completion gain or blocker reduction is not exactly one.
- Any non-target helper source bytes change, a second function must migrate, or
  any function mixes legacy and direct parameter forms.
- Composition cannot be reproduced byte-identically by its repository writer.
- Checker/validator sources or generated fixtures change.
- A candidate family becomes selectable or a previously complete function
  regresses.
- Historical promotion evidence, schema, profile, or family registry changes.
- Any canonicalizer, hostile, focused, or full-wall gate fails.

## Out of Scope

- Migrating the other 15 expression-helper functions or any other module.
- Changing canonicalizer behavior, formatting, semantics, schema, profile
  limits, candidate families, or selection rules.
- Selecting, implementing, or promoting a canonicalizer family.
- Removing global legacy-parameter compatibility.
- Claiming KIR v1 freeze, public reader export, runtime cutover, or semantic
  self-hosting.

## Deploy Order

[VERIFIED] Source member, generated composite/record, corpus digest,
authenticated receipt, tests, spec, and release evidence ship atomically after
fetch/rebase and one feature push. No skewed deployment is supported.

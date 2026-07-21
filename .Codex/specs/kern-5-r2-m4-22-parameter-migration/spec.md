# KERN 5 R2 M4.22 — Frozen Parameter-Ready Migration

**Status:** COMPLETE
**Date:** 2026-07-21
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.21 commit
`ede84e5fee068ccf79611baa195971fe37e8d04b` authenticates exactly six
functions across checker, canonicalizer, and validator as base-complete after
representation-only migration of 14 legacy parameter rows
(`scripts/kern-canonicalizer/coverage-prerequisite-summary.json:20-85`).

[VERIFIED] M4.22 applies exactly that frozen migration to checked-in KERN
source, regenerates the source-derived checker fixture and canonicalizer
composition, updates the three changed corpus digests, and remeasures coverage.
It does not promote binding or any other structural family. The measured
structural result is 27/104 base-complete, 75 remaining `fn.params` blockers,
no further base-only parameter-ready witness, and binding still selected as the
next one-family prerequisite.

## Current State / Root Cause

[VERIFIED] The live M4.21 receipt records 21/104 base-complete and 81 legacy
parameter blockers while the ordinary selector remains null
(`scripts/kern-canonicalizer/coverage-summary.json:181-197,293-320`).

[VERIFIED] The live prerequisite measurement proves these six legacy functions
complete under the existing M4.21 base after exact in-memory migration, with no
additional structural family:

| Function | Parameters | Rows after migration | Evidence | Tag |
|---|---|---:|---|---|
| `hasDirectChild` | `row:number`, `stmtParent:number[]` | 8 / 13 / 53 | `coverage-prerequisite-summary.json:25-34`; source `checker-while.kern:58-63` | VERIFIED |
| `subtreeEnd` | `row:number`, `stmtParent:number[]` | 9 / 14 / 70 | `coverage-prerequisite-summary.json:35-44`; source `checker-while.kern:78-85` | VERIFIED |
| `stringat` | `id:number`, `values:string[]` | 8 / 14 / 62 | `coverage-prerequisite-summary.json:45-54`; source `canonicalizer-expression-helpers.kern:97-102` | VERIFIED |
| `rootpath` | `module:number`, `moduleId:number[]`, `moduleRoot:string[]` | 9 / 16 / 66 | `coverage-prerequisite-summary.json:65-74`; source `validator.kern:127-132` | VERIFIED |
| `statusof` | `module:number`, `moduleId:number[]`, `moduleStatus:string[]` | 9 / 16 / 66 | `coverage-prerequisite-summary.json:75-84`; source `validator.kern:134-139` | VERIFIED |
| `containsid` | `xs:number[]`, `id:number` | 8 / 14 / 54 | `coverage-prerequisite-summary.json:55-64`; source `validator.kern:206-211` | VERIFIED |

[VERIFIED] M4.21's partition is exact and disjoint: the six functions above do
not occur in residual binding/unary witness rows
(`scripts/kern-canonicalizer/coverage-prerequisite.test.mjs:15-147`). The root
cause is therefore representation only: each target still uses the legacy
`fn.params` property even though ordered direct `param` children are already an
admitted base contract.

## What Already Works

- [VERIFIED] Structured parameters are an established source form with exact
  order/type assertions across assertion-engine, checker, validator, and
  canonicalizer modules
  (`scripts/kern-canonicalizer/coverage-parameter-migrations.mjs:6-245`).
- [VERIFIED] Mixed legacy and direct declarations fail closed; M4.22 needs no
  parser, runtime, or schema change
  (`scripts/kern-canonicalizer/coverage-prerequisite.mjs:54-79`).
- [VERIFIED] Checker fixtures are repository-generated from live validator and
  checker sources (`scripts/capstone-checker-subset/fixtures.mjs:114-134` and
  `scripts/capstone-checker-subset/gen-fixtures-kern.mjs:13-42,71-101`).
- [VERIFIED] The canonicalizer composition already authenticates the exact
  ordered helper/main bytes and has a repository writer
  (`scripts/kern-canonicalizer/composition.mjs:19-27,191-206,270-287`).
- [VERIFIED] Frozen M4.16 and M4.19 prerequisite records already bind the six
  witness identities historically and remain immutable inputs
  (`scripts/kern-canonicalizer/coverage-handoff.test.mjs:30-38,130-185`).

## Contract (Verified)

> Verified against `origin/main` at
> `ede84e5fee068ccf79611baa195971fe37e8d04b` on 2026-07-21.

| Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Migration scope | Exactly six named function roots and 14 ordered rows | M4.21 prerequisite summary lines 20-85 | VERIFIED |
| Source semantics | Remove only `fn.params`; prepend equivalent direct `param` children; preserve body, return, export, calls, and root order | target source lines cited above; established pattern in `coverage-parameter-migrations.mjs` | VERIFIED |
| Checker consumer | Regenerate `examples/capstone-checker-subset/main.kern`; numeric fixture must remain byte-identical | `fixtures.mjs:114-134`; `gen-fixtures-kern.mjs:13-60` | VERIFIED |
| Canonicalizer consumer | Regenerate composite and composition record after `stringat` source changes | `composition.mjs:191-206,270-287` | VERIFIED |
| Validator consumer | Validator runtime parity remains 39/39; validator `main.kern` is fixture-derived and does not embed validator source | `scripts/check-selfhost-validator.mjs:18-52`; prior M4.9 change `8fe558d0` | VERIFIED |
| Coverage authentication | Update exactly the checker-while, expression-helper, and validator corpus member digests | `coverage-policy.json:66-102` | VERIFIED |
| Live totals | 27 base-complete and 75 `fn.params` blockers; ordinary winner remains null | arithmetic from exact six-function M4.21 base-only partition plus current 21/81 totals | VERIFIED |
| Next prerequisite | Empty base-only migration row; residual binding closure remains five functions/two tools/nine rows/801 occurrences | M4.21 disjoint partition and `coverage-prerequisite-summary.json:87-176` | VERIFIED |
| Historical provenance | Four selection and two prerequisite records remain byte-identical | `coverage-handoff.test.mjs:130-185,360-430` | VERIFIED |

## Implementation Options

### A — migrate the frozen six-function cohort (selected, confidence 0.96)

Apply all 14 rows in one release slice. This matches the published M4.21
boundary, pays generated-fixture/composition/receipt churn once, and produces
one truthful post-migration receipt.

### B — split by checker, canonicalizer, and validator module (confidence 0.78)

This reduces each source edit but creates three intermediate coverage states,
three review/publication cycles, and repeated regeneration of shared evidence.
The exact cohort has already been authenticated, so the extra release states do
not resolve an unknown.

No third option is genuine: promoting binding before applying the proven
base-only migration would mix two independent capability boundaries and make
the next prerequisite evidence less truthful.

## Implementation Plan

1. Add RED assertions for the exact six structured signatures, 14 ordered
   `param` rows, 27/104 completion, 75 blockers, empty base-only parameter row,
   unchanged residual ranking, and new live composition binding.
2. Prove RED on unchanged M4.21 source for the intended signature/totals reason.
3. Rewrite only the six headers and insert their ordered `param` children.
4. Regenerate checker fixture and canonicalizer composition; prove numeric
   checker fixture, other composition members, and frozen provenance unchanged.
5. Update exactly three corpus digests, regenerate coverage/prerequisite
   summaries once after all `.mjs` edits, and pin measured facts.
6. Run checker, validator, canonicalizer, and KERN 5 gates; route independent
   review automatically; fix verified findings; fetch/rebase and publish once.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `examples/capstone-checker-subset/checker-while.kern` | modify | Two exact signatures / four rows |
| `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern` | modify | `stringat` signature / two rows |
| `examples/selfhost-validator/validator.kern` | modify | Three exact signatures / eight rows |
| `examples/capstone-checker-subset/main.kern` | regenerate | Embeds changed checker and validator source facts |
| `examples/kern-canonicalizer/canonicalizer.composed.kern` | regenerate | Exact changed helper bytes |
| `scripts/kern-canonicalizer/composition.json` | regenerate | Member/composite size and digest |
| `scripts/kern-canonicalizer/coverage-parameter-migrations.mjs` | modify | RED exact source/profile boundary |
| `scripts/kern-canonicalizer/coverage-policy.json` | modify | Three corpus digests |
| `scripts/kern-canonicalizer/coverage-summary.json` | regenerate | Authenticated post-migration facts |
| `scripts/kern-canonicalizer/coverage-prerequisite-summary.json` | regenerate | Empty base-only row and residual prerequisite |
| `scripts/kern-canonicalizer/coverage.test.mjs` | modify | Exact 27/75/null receipt |
| `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs` | modify | Exact M4.22 prerequisite result |
| `scripts/kern-canonicalizer/coverage-handoff.test.mjs` | modify | Current facts with immutable historical records |
| `scripts/check-kern-canonicalizer-coverage.mjs` | modify | Terminal live assertions and status |
| `docs/kern-5-release-train.md` | modify | Durable M4.22 release evidence |
| this spec | modify | Decision and terminal evidence |

## Acceptance Criteria

- [x] RED first fails on unchanged M4.21 source because the six exact
      structured signatures and 27/75 live totals are absent.
- [x] The targets contain exactly 14 ordered direct `param` children and no
      target retains `fn.params`; every non-target function remains internally
      pure legacy or pure structured form.
- [x] Checker-while is 261 lines, expression helpers 168 lines, and validator
      479 lines, all under the 500-line handwritten ceiling.
- [x] Function bodies, export/return properties, function/root ordering, and
      call sites are unchanged outside inserted signature rows.
- [x] Only three handwritten corpus digests change; all six other corpus member
      digests and all immutable selection/prerequisite records remain exact.
- [x] Checker `main.kern` and canonicalizer composition are regenerated by
      repository writers; numeric checker fixture, statement helper, and
      canonicalizer main bytes remain unchanged.
- [x] Authenticated post-migration rows exactly match M4.21 counterfactual rows:
      8/13/53, 9/14/70, 8/14/62, 9/16/66, 9/16/66, and 8/14/54.
- [x] Live coverage is exactly 27/104 with 75 `fn.params` blockers, a null
      ordinary winner, and no active family credited to the six migrated
      functions.
- [x] Live prerequisite format 2 records zero base-only parameter-ready
      functions/rows and retains binding as the selected one-family
      prerequisite with the exact five-function residual witness set.
- [x] Checker parity remains 48/48 with 36 hostile attempts rejected; validator
      remains 39/39; the complete canonicalizer gate and `fitness:kern-5` pass.
- [x] Automatic high-risk post-implementation review completes with no
      unresolved substantive finding.

## Measured Implementation Evidence

[VERIFIED] The RED oracle failed first on unchanged M4.21 source at the expected
checker line-count boundary (`257 !== 261`), then failed closed on the intended
checker corpus digest after the source migration and before policy refresh.

[VERIFIED] The six migrated functions now reproduce the frozen counterfactual
profiles exactly. Their three source SHA-256 values are
`42c20bb13243a582cb0632934934e02bf45075385b3e1ac699f68c7a01ace372`,
`5eb8a3e6ee2e1e83fd11781efda73dac3892838b737aba35ea748891ef2aab77`,
and `e31d87a157b5c5cf8ee9dbfbb42c2c5a94fe20e0e6d245daab2f74b373b16ee1`.

[VERIFIED] The regenerated canonicalizer composition is 36,437 bytes at
SHA-256 `0eb8771b873f1b44f7dbe8754b27f159268da5115dcf288e59a627d62f366064`.
Numeric checker, statement helper, canonicalizer main, index prerequisite, and
counted-iteration prerequisite bytes remain exact at SHA-256
`4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a`,
`b30350be41f066109263c9fc8022e963e4aad3298425fbdbfe2480811f8a36bc`,
`c7bfb896a4905fe8ebfde0dabf821ac0e35da881f30a8d117b31aa90dea03b14`,
`3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869`,
and `af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b`.

[VERIFIED] Coverage policy, coverage summary, and prerequisite summary SHA-256
values are
`7651b89e6a37025994a5bd5700f702508da6272c6aa66a47852633f021d4e5b7`,
`9cfabe1ea53540a69d3ba4aa4444a2578f9d0c992c53f17a63826600abf2434a`,
and `44b2ce6e4542770cad06201a7d1cc9763a01b2960ce4ef654657b7d455836c8f`.
The authenticated coverage implementation and corpus digests are
`be96b8cc2b3a68af3d9adbc841ae09c8f268ff25ac0f9616160b20c7872eb14d`
and `e612418828f0636e3fb2843e1c57fb5bf6cd26bdfc3f547b1cb9aa7e6e813394`.

[VERIFIED] Focused coverage/composition tests pass 46/46, checker parity passes
48/48 with 36 hostile attempts rejected, validator parity passes 39/39, and the
complete canonicalizer gate passes all 82 structural/authentication tests, 36
runtime fixtures, 8 measured witnesses, 3 profile-limit fixtures, and 179
hostile fixtures. The complete Node 22 `pnpm fitness:kern-5` wall passes every
workspace, infrastructure, conformance, native, runner, whole-app, browser,
KIR/runtime, convergence, and repeated canonicalizer gate.

[VERIFIED] Automatic high-risk role-lens review
`review-1784621539302-7wo5z1` routed all six usable non-excluded identities.
Every reviewer completed successfully; consensus is zero verified,
needs-check, speculative, or nit findings. The routing manifest has no identity
shortfall or excluded engine.

## Out of Scope

- Migrating any function outside the frozen six-witness cohort.
- Adding or promoting binding, unary, do, exception, or while capability.
- Changing the M4.21 base profile, profile limits, family registry, parser,
  runtime, KIR schema, ABI, or ownership claims.
- Rewriting the legacy-parameter compatibility path or claiming all parameters
  have migrated.
- Freezing a new prerequisite provenance record; M4.22 consumes the existing
  M4.21 parameter-ready measurement and leaves binding for the next slice.
- KIR v1 freeze, public reader export, runtime cutover, or KERN 5 completion.

## Open Questions

None. All source shapes, consumers, measured rows, and expected counters are
bound by current repository evidence. Generated byte digests are outputs and
will be recorded only after repository writers run.

## Deploy Order

[DECIDED] This monorepo contract ships atomically: source migrations, generated
checker/composition artifacts, corpus digests, receipts, tests, spec, and
release evidence land together. There is no supported skew window. Immediately
before the only push, fetch and rebase onto `origin/main`; publish the feature
ref and explicitly authorized `main` atomically with `--no-verify`, verify both
remote refs, then start the next slice from a new branch based on fresh
`origin/main`.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| The next slice might need a new capability family | M4.21 separately proves six functions complete under the existing base through parameter representation alone | M4.22 is source migration only; binding stays next |
| Per-module migration is inherently safer | The exact cross-module cohort is already immutable evidence, while splitting repeats shared generator/receipt churn | Ship the frozen cohort atomically |

# KERN 5 R2 M4.8 — Targeted `checker.kern` Structured Parameters

**Status:** SEALED
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED BASELINE] Immutable main commit
`932e94c0fd9bc6231f7e1cd1b65a5bf9476356bf` records 12 of 104 corpus
functions base-complete, 90 functions blocked by the excluded legacy
`fn.params` property, all eight remaining candidate families at zero
completions, and an authenticated `null` winner.

[VERIFIED] Exact read-only in-memory migration measurement found eight
remaining functions that would become base-complete when migrated to existing
ordered direct `param` children. The strongest bounded group is exactly four
functions in `examples/capstone-checker-subset/checker.kern`:
`acceptLine`, `isSafeIntText`, `elseRejectDetail`, and `isPrintNumberText`.
They require six parameter rows and produce four completions.

[VERIFIED] Full-roster brainstorm
`brainstorm-1784573693847-hlks2n-kern-5-r2-m4-8-parameter-scope` completed 6/6
engines. Its synthesis selected the three-function validator alternative on
the premise that validator migration would avoid checker fixture regeneration.
Repository evidence disproves that premise: the checker fixture corpus embeds
both `validator.kern` and `checker.kern` through `repoFile`, and its generator
flattens the live source of every fixture. Validator therefore requires the
checker parity gate in addition to its own 39-verdict gate.

[VERIFIED] With that false premise removed, the checker boundary dominates the
validator boundary: both change six parameter rows and regenerate checker
evidence, but checker completes four rather than three functions, ends at 360
rather than 471 source lines, and does not add the validator verdict gate. The
one-function canonicalizer-helper alternative remains rejected because it
reopens executable composition evidence for only one completion.

## Current State / Root Cause

[VERIFIED] `checker.kern` is 354 lines with 24 legacy-signature functions. The
four selected functions are individually blocked only by `fn.params`. Their
current and exact in-memory migrated profile rows are:

| Function | Params | Current rows | Migrated rows | New blockers |
|---|---:|---:|---:|---|
| `acceptLine` | 1 | 3/5/17 | 4/7/20 | none |
| `isSafeIntText` | 1 | 3/5/18 | 4/7/21 | none |
| `elseRejectDetail` | 3 | 3/4/25 | 6/10/36 | none |
| `isPrintNumberText` | 1 | 3/4/17 | 4/6/20 | none |

[VERIFIED] The language invariant is per-function consistency. Each function
may use either legacy `params=` text or ordered direct `param` children, while
mixing both forms inside one function fails closed. Four direct-form functions
may therefore coexist durably with 20 internally consistent legacy siblings.

[INFERRED] If and only if the actual source produces the measured projection,
M4.8 advances base completion from 12 to 16 of 104 and reduces `fn.params`
blockers from 90 to 86. Actual generated-source measurement is authoritative.

## Options Measured

| Scope | Functions | Params | New completions | Source result | Decision |
|---|---:|---:|---:|---:|---|
| Four exact `checker.kern` functions | 4 | 6 | 4 | 360 lines | Select |
| Three exact `validator.kern` functions | 3 | 6 | 3 | 471 lines | Reject: same checker evidence plus validator gate |
| `validnext` in canonicalizer helper | 1 | 1 | 1 | 166 lines | Reject: executable composition blast radius |
| Entire `checker.kern` module | 24 | 259 | 4 | 613 lines | Reject: crosses 500-line ceiling |

## Contract

| Behavior | Contract | Tag |
|---|---|---|
| Exact source scope | Rewrite only the four selected function signatures | VERIFIED |
| Parameter order | `path`; `raw`; `row,stmtKind,stmtParent`; `raw` | VERIFIED |
| Source isolation | Other 20 functions and every target body/call/export remain byte-equivalent | VERIFIED |
| Mixed-module validity | Four direct-form functions coexist with 20 legacy-form siblings | VERIFIED |
| Generated evidence | Regenerate checker `main.kern` only through its repository generator | VERIFIED |
| Checker behavior | Preserve 48/48 TS parity and reject all 36 hostile attempts | VERIFIED |
| Numeric behavior | Preserve all 23 direct safe-integer predicate cases | VERIFIED |
| Coverage result | Observe exactly 16/104 base completion and 86 legacy blockers | INFERRED |
| Selection result | Eight candidate families remain zero and winner remains `null` | INFERRED |
| Frozen evidence | Canonicalizer source/composition/profile/schema/registry/promotion provenance remain unchanged | VERIFIED |

## Implementation Plan

1. Add RED assertions for the exact 360-line source, 24 roots, four target
   IDs, six ordered direct parameters, 20 legacy siblings, exact migrated
   profile rows, 16 base completions, 86 `fn.params` blockers, and null winner.
2. Prove RED fails on immutable main before any source edit.
3. Rewrite only the four selected headers and add six direct `param` children.
4. Prove the old authenticated corpus digest rejects specifically on
   `checker.kern`, update only that digest, regenerate checker fixtures through
   `gen-fixtures-kern.mjs`, and write the authenticated coverage summary.
5. Run focused checker/canonicalizer gates, the complete Node 22
   `pnpm fitness:kern-5` wall, and terminal six-engine Agon review. Stop before
   migrating a fifth function or promoting a family.

## Expected Blast Radius

| File | Action |
|---|---|
| `examples/capstone-checker-subset/checker.kern` | Modify four signatures |
| `examples/capstone-checker-subset/main.kern` | Regenerate composed checker fixture |
| `scripts/kern-canonicalizer/coverage-parameter-migrations.mjs` | Add exact RED/source/profile assertions |
| `scripts/kern-canonicalizer/coverage.test.mjs` | Pin live 16/104 and 86 totals |
| `scripts/kern-canonicalizer/coverage-policy.json` | Update only the changed checker corpus digest |
| `scripts/kern-canonicalizer/coverage-summary.json` | Regenerate authenticated receipt |
| `scripts/check-kern-canonicalizer-coverage.mjs` | Pin live M4.8 totals |
| `scripts/kern-canonicalizer/coverage-handoff.test.mjs` | Pin current totals against frozen provenance |
| `docs/kern-5-release-train.md` | Record the measured boundary and correction |
| this spec | Seal actual evidence and review resolution |

## Acceptance Criteria

- [x] RED fails on the unchanged 354-line source before implementation.
- [x] The migrated source is exactly 360 lines with 24 functions: four exact
      direct-form targets, six direct params, and 20 legacy-form siblings.
- [x] Target names, types, and order match the contract; all non-signature
      source remains unchanged.
- [x] The old policy digest fails specifically on `checker.kern` before only
      that corpus digest is updated.
- [x] Authenticated coverage is exactly 16/104 with exactly 86 `fn.params`
      blockers and the four exact target profile rows above.
- [x] All eight candidate families remain at zero and winner remains `null`;
      corpus/tool/function counts remain 9/4/104.
- [x] Canonicalizer composition, profile, schema, family registry, executable,
      and immutable promotion provenance remain unchanged.
- [x] Checker parity remains 48/48, all 36 hostile attempts are rejected, and
      all 23 direct safe-integer cases remain byte-identical.
- [x] Focused tests and `pnpm fitness:kern-5` pass on the exact implementation
      tree.
- [x] Terminal automatically routed Agon review has no unresolved material
      finding.

## Measured Result

[VERIFIED] RED failed before source changes exactly with `354 !== 360`. The
source-only edit then failed the old authenticated policy exactly with
`corpus member examples/capstone-checker-subset/checker.kern digest drift`.
The migrated source SHA-256 is
`af5d394b6ea121646bc3edb35c8be2a140fbc09d8ae56fbdf3651c97659f887b`.

[VERIFIED] Repository generation produced checker fixture SHA-256
`3784df61123ad24bdf947e71faff86edf6bf24747392640d15643ad20282113a`.
The numeric fixture remained byte-identical at
`4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a`.

[VERIFIED] Authenticated measurement records 16/104 base completions, 86
legacy blockers, the four exact target profiles, eight zero-completion family
rows, and a null winner. Focused coverage/handoff passed 23/23 tests. The full
canonicalizer gate passed all 67 tests plus 21 golden/idempotence/KIR fixtures,
seven measured witnesses, three profile-limit fixtures, and 140 hostile
fixtures. Checker adapter tests passed 3/3; runtime behavior remained 48/48
byte-identical, all 36 hostile attempts were rejected, and all 23 direct
safe-integer cases passed.

[VERIFIED] The exact implementation tree passed the complete Node 22
`pnpm fitness:kern-5` wall, including repository consistency, lint, production
build, every workspace and infrastructure suite, 432 cross-target fixtures,
109 class fixtures, 233 native assertions at 100% coverage, 39 validator
verdicts, 40 whole-app fixtures across three legs, browser budget, KIR/runtime
guards, source-runner convergence, and repeated canonicalizer evidence. A
stable exact-tree closure reran `pnpm check:repo`, `pnpm lint`, `pnpm build`,
all 67 canonicalizer tests plus the fixture scan, and the checker adapter,
48-case parity, and 36-case hostile gates successfully.

[VERIFIED] Automatically routed terminal review
`review-1784574989078-5m4n95` completed both required independent seats with
zero verified, needs-check, or speculative findings. Its six low-severity
maintainability notes do not change the contract: the 153-line milestone
assertion helper is bounded and intentionally exact; LF-count assertions pin
the generated-source receipt; milestone labels identify release evidence;
the implementation digest intentionally hashes every local `.mjs` module as a
fail-closed boundary; and tracked `.Codex/specs` artifacts are established
repository convention. No material finding remains unresolved.

## Stop Conditions

- Completion gain is not exactly four or blocker reduction is not exactly four.
- Any non-target source bytes change, a fifth function must migrate, or any
  function mixes legacy and direct parameter forms.
- Generated numeric fixture bytes change, a candidate family becomes
  selectable, or a previously complete function regresses.
- Canonicalizer executable/composition or frozen promotion evidence changes.
- `checker.kern` is not exactly 360 lines or generated evidence requires manual
  editing.
- Any checker parity, hostile, direct numeric, or full-wall gate fails.

## Out of Scope

- Migrating the other 20 `checker.kern` functions.
- Migrating validator or canonicalizer-helper functions.
- Removing global legacy-parameter compatibility.
- Changing parser, checker behavior, runtime, canonicalizer, schema, profile
  limits, or candidate-family definitions.
- Selecting, implementing, or promoting a canonicalizer family.

## Deploy Order

[VERIFIED] Source, generated fixture, corpus digest, authenticated receipt,
tests, spec, and release evidence ship atomically after fetch/rebase and one
feature push. No skewed deployment is supported.

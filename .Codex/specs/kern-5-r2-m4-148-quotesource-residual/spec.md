# M4.148 `quotesource` residual remeasurement

**Status:** READY TO BUILD
**Date:** 2026-07-30
**Confidence:** 0.98

## Executive Summary

M4.148 publishes an immutable, independently digest-bound remeasurement of the
single residual function left by M4.147. The slice must prove that
`quotesource` remains blocked only by six canonical-surface text characters,
that its migrated 54/82/932 profile rows fit inside the active 205/332/6304
profile, and that no profile widening is actionable. It changes no KERN source,
runtime behavior, policy limit, package, or public API.

## Current State / Root Cause

- [VERIFIED] `origin/main` and the fresh M4.148 branch both start at the exact
  M4.147 commit `4115914127dc627edf8348af8a487ac1beae941a`.
  Evidence: `git rev-parse HEAD && git rev-parse origin/main`, 2026-07-30.
- [VERIFIED] M4.147 leaves 111/112 base-complete functions, exactly one legacy
  `fn.params` blocker, an empty parameter queue, and one residual function.
  Evidence:
  `scripts/kern-canonicalizer/coverage-summary.json`;
  `scripts/kern-canonicalizer/coverage-prerequisite-summary.json`;
  `scripts/kern-canonicalizer/coverage-current.mjs:93-160`.
- [VERIFIED] The sole residual is
  `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource`.
  It retains two legacy parameters and six text-character blockers:
  `u007f`, `u0080`, `u009f`, `u2028`, `u2029`, and `ufeff`.
  Evidence:
  `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern:57-108`;
  `scripts/kern-canonicalizer/coverage-m4-147-parameter-migration.mjs:20-28`;
  `scripts/kern-canonicalizer/coverage-prerequisite-summary.json`.
- [VERIFIED] Migrating only the two parameter rows produces profile rows
  54 nodes, 82 properties, and 932 values. These are below the active limits
  205/332/6304, so no observed profile setting differs from the current
  profile and no profile widening can complete the function.
  Evidence: the Node 22 inspection using
  `measureCanonicalizerCoverage`, `migrateFunctionFact`, and
  `partitionMigratedFunctions` reported one residual with
  `profileRows={nodes:54,properties:82,values:932}` and the exact six character
  blockers on 2026-07-30; active limits are
  `scripts/kern-canonicalizer/policy.json`.
- [VERIFIED] The current coverage and prerequisite summary bytes hash to
  `fc030f9b1140e15cca55fdcea93bcf7da15fd75825ae1cb6577b5620e0b95bf0`
  and
  `0ef253dba0b3ab80593d9fd3985e210736c3c9bc69763b21480330f1c0ba21f7`.
  Evidence:
  `shasum -a 256 scripts/kern-canonicalizer/coverage-summary.json
  scripts/kern-canonicalizer/coverage-prerequisite-summary.json`, 2026-07-30.

## What Already Works

M4.147 authenticates the source migration queue, current active KIR/profile/
runtime limits, 111/112 cumulative coverage, and bounded exhaustion. Existing
M4.143 format-3 residual analysis provides the established immutable-receipt,
candidate-ranking, hostile-data, fresh-process, and direct-write contracts.
Neither the canonicalizer implementation nor the generic coverage algorithm
needs modification.

## Contract

> Verified against the M4.147 source, policy, generated summaries, and live
> Node 22 measurement on 2026-07-30.

| Field / Behavior | Required value | Evidence | Tag |
|---|---|---|---|
| Input commit | `4115914127dc627edf8348af8a487ac1beae941a` | `git rev-parse HEAD` | VERIFIED |
| Base coverage | 111/112 | `coverage-summary.json` | VERIFIED |
| Residual | only `quotesource` | `coverage-m4-147-parameter-migration.mjs:20-28` | VERIFIED |
| Migrated parameter rows | 2 | live `migrateFunctionFact` measurement | VERIFIED |
| Migrated profile rows | 54/82/932 | live `migrateFunctionFact` measurement | VERIFIED |
| Active profile limits | 205/332/6304 | `policy.json` | VERIFIED |
| Residual reasons | exact six text-character blockers | `coverage-prerequisite-summary.json` | VERIFIED |
| Actionable profile candidates | none | measured rows are below every active limit | VERIFIED |

## Implementation

There is one real implementation: add the M4.148 format-3 analyzer, canonical
JSON receipt, immutable loader/validator, central assertion, status formatter,
and tests; integrate its status into the canonical coverage checker after
M4.147. Copying stale prior receipt bytes, changing policy, or rewriting
`quotesource` would violate the slice boundary rather than form alternatives.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-m4-148-quotesource-residual/spec.md` | add | Durable claim contract |
| `scripts/kern-canonicalizer/coverage-{policy,summary,prerequisite-summary}-m4-147.json` | add | Preserve the exact M4.147 input bytes before the local implementation digest advances |
| `scripts/kern-canonicalizer/coverage-input-m4-147.mjs` | add | Load and cross-bind the archived M4.147 policy and summaries |
| `scripts/kern-canonicalizer/coverage-residual-analysis-m4-148.{mjs,json,test.mjs}` | add | Measure, freeze, and attack the exact residual receipt |
| `scripts/kern-canonicalizer/coverage-m4-148-central.mjs` | add | Reproduce and authenticate the published receipt |
| `scripts/kern-canonicalizer/coverage-status-m4-148.{mjs,test.mjs}` | add | Exact milestone and M4.149 handoff text |
| `scripts/check-kern-canonicalizer-coverage.mjs` | edit | Include M4.148 in the chronological aggregate |
| `scripts/kern-canonicalizer/coverage-{summary,prerequisite-summary}.json` | regenerate | Record the new all-local-module implementation digest without semantic frontier drift |

## Acceptance Criteria

- [ ] A RED oracle fails at the M4.147 base because no M4.148 published receipt
  exists.
- [ ] Exact M4.147 coverage policy, coverage summary, and prerequisite summary
  bytes are archived, independently hashed, structurally validated, and
  cross-bound.
- [ ] The analyzer authenticates the archived M4.147 input and reproduces its
  semantic identities from the live source/policy while deliberately excluding
  only the self-changing local implementation digest from the live comparison.
- [ ] The receipt contains exactly one assignment: `quotesource`, two parameter
  rows, profile rows 54/82/932, and the six ordered character reasons.
- [ ] The frontier reports one profile-bearing residual, zero observed changed
  settings, zero actionable candidates, and `selectedNextAction: null`.
- [ ] Canonical/decorated/shared/cyclic receipt mutations reject.
- [ ] Missing, non-regular, symlinked, malformed, or non-canonical receipt bytes
  reject; direct invocation accepts exactly `--write`.
- [ ] The published receipt reloads byte-identically in a fresh locale-neutral
  Node 22 process and preserves the exact M4.143 receipt.
- [ ] No KERN source, generated composition, coverage policy, canonicalizer
  policy, runtime limit, package, or public API changes.
- [ ] Focused tests, `pnpm test:kern-canonicalizer`, and
  `pnpm fitness:kern-5` pass.
- [ ] `agon review uncommitted -e claude,codex,agy --timeout 600` reports no
  verified blocker after any accepted fix and gate rerun.
- [ ] The Agon-signed commit is fetched/rebased onto current `origin/main`,
  pushed once to `main` under standing authorization, and the remote SHA is
  verified.

## Out of Scope

- Rewriting or migrating `quotesource`.
- Admitting any of the six text characters.
- Changing KIR, profile, or runtime limits.
- Performing M4.149 projection/remediation analysis.
- Updating package versions or claiming Alpha, Beta, RC, or KERN 5 completion.

## Deploy Order

This evidence-only commit lands atomically. It has no runtime skew window.
M4.149 may consume the receipt only after its exact remote commit is present on
`main`.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Adding only evidence modules would leave the live coverage/prerequisite summary bytes unchanged. | `coverage-dependencies.mjs:51-62,89-91` hashes every local `.mjs`, so M4.148 necessarily advances `coverageImplementationDigest`. | Archive the exact M4.147 inputs before regeneration; compare live semantic identities separately and regenerate both live summaries. |

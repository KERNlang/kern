# RT7 Review Fixes

**Status:** READY TO BUILD
**Date:** 2026-09-04
**Confidence:** 0.95

## Executive Summary

Apply the verified RT7 review fixes without broadening ratchet policy. The CI census command remains the canonical package script, incomplete probe rows invalidate a corpus report, and atomic writes refuse an occupied temporary path.

## Current State / Root Cause

- **VERIFIED** `package.json:116` defines an earlier `census:sweep` direct command while `package.json:122` defines the later CI wrapper; JSON parsing retains the latter but the duplicate is ambiguous.
- **VERIFIED** `scripts/kern-5-admission-census/sweep.mjs:47-55` compares only admitted files, so `timeout` and `probe` results do not independently fail the corpus invariant.
- **VERIFIED** `scripts/kern-5-admission-census/sweep.mjs:15-19` writes the predictable temporary path without exclusive creation.
- **VERIFIED** `packages/core/src/runner.ts:282-287` has a defensive non-string `props.params` branch, but `packages/core/src/runner.ts:782-786` accepts source text and the source parser emits string-valued attributes. The private predicate has no supported direct-IR test seam, so this review item is dismissed rather than weakly tested or exposed.

## What Already Works

- **VERIFIED** `scripts/kern-5-admission-census/sweep.mjs:28-44` already rejects incomplete rows when rewriting the ratchet; this change extends that safety property only to the corpus-wide CLI invariant.
- **VERIFIED** `scripts/kern-5-admission-census/census.test.mjs:202-211` pins the required `--allow-shrink` behavior; it remains unchanged.
- **VERIFIED** `packages/core/tests/runner-source-executor.test.ts:4570-4705` already isolates explicit void export behavior and covers parameterized source-string forms; no runner change is required for this slice.

## Implementation

Remove the first duplicate package key, add an incomplete-row branch to `corpusInvariantFailures`, and use exclusive file creation in `writeAtomic`. Extend focused census and CI-contract regression tests.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `package.json` | Edit | Single canonical CI census command |
| `scripts/kern-5-admission-census/sweep.mjs` | Edit | Corpus completeness and atomic write safety |
| `scripts/kern-5-admission-census/census.test.mjs` | Edit | Regression coverage |

## Acceptance Criteria

- [ ] `package.json` has one `census:sweep`, targeting `scripts/ci/kern-5-census-sweep.mjs`; `sweep:kern-5-admission-census` remains direct.
- [ ] Corpus invariant failures include `timeout` and `probe` rows.
- [ ] An occupied temporary path, including a symlink, cannot be overwritten by `writeAtomic`.
- [ ] Focused census, runner, CI-contract, and canonicalizer-prerequisite gates pass with no diff.

## Out of Scope

- Changing `--allow-shrink`, ratchet update policy, timeout values, the permitted descriptor-selected void-export shape, or runner test seams.

## Open Questions

None.

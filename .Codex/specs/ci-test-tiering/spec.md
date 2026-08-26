# CI Test Tiering

**Status:** DONE — LOCAL VALIDATION AND INDEPENDENT REVIEW GREEN
**Date:** 2026-08-26
**Confidence:** 0.98

## Executive Summary

KERN pull-request CI currently serializes package tests, contract gates, every historical frontend shadow wall, and cumulative replay evidence into one job. The job exceeded GitHub's six-hour ceiling on PR #548 without a test failure. Split the suite into a bounded PR tier and an exhaustive scheduled tier, remove exact duplicate invocations, and preserve the full evidence wall for nightly and release execution.

## Current State / Root Cause

- **VERIFIED:** PR #548 workflow run `32897810253` started at `2026-08-25T20:52:03Z` and was cancelled at `2026-08-26T02:52:23Z`; its log ended with `The operation was canceled` during F4 declarations after earlier steps passed (GitHub workflow API and job log, 2026-08-26).
- **VERIFIED:** `.github/workflows/ci.yml:70` invokes `pnpm test:non-semantics`, which expands through `package.json:18` into all workspace package tests plus `test:infra`.
- **VERIFIED:** `package.json:100` calls `test:kern-ir` and then repeats ten leaf gates already contained by `test:kern-ir` at `package.json:49` (source inspection, 2026-08-26).
- **VERIFIED:** The failed job invoked the `@kernlang/core` build script 56 times (workflow log count, 2026-08-26).
- **VERIFIED:** `test:kern-frontend-successful-line-composition` consumed about 139 minutes: about 119 minutes for the 273-case predecessor replay and about 20 minutes for an aggregate regression wall that calls earlier frontend checkers (`scripts/kern-frontend-successful-line-composition/replay.test.mjs`, `scripts/check-kern-frontend-successful-line-composition-regressions.mjs`, workflow log, 2026-08-26).
- **VERIFIED:** In a fresh checkout, `test:infra:contracts` reached `test:kern-semantic-ownership` before `packages/core/dist/frontend-projection-assets/adapter.cjs` existed; the contracts aggregate now builds `@kernlang/core` immediately before semantic ownership (`package.json`).

## What Already Works

Lint, build, runtime-contract, facade synchronization, rule coverage, Python codegen, and differential conformance all passed before the cancellation. The underlying historical and mutation tests remain valuable evidence and are not deleted. Stable and canary release workflows already run version-mutated verification and remain authoritative for publication.

## Contract (Verified)

> Verified against: `.github/workflows/ci.yml`, `.github/workflows/release-pipeline.yml`, `package.json`, and `scripts/kern-5-fitness.test.mjs` on 2026-08-26.

| Behavior | Evidence | Tag |
|---|---|---|
| Pull requests require bounded blocking jobs | `.github/workflows/ci.yml` | VERIFIED |
| Current frontend fitness gates remain in `test:infra` in policy order | `scripts/kern-5-fitness.test.mjs:304` | VERIFIED |
| Exhaustive predecessor replay remains callable | `package.json` script `test:kern-frontend-successful-line-composition` | VERIFIED |
| Release publication retains `pnpm test` | `.github/workflows/release-pipeline.yml:95` | VERIFIED |
| Before this change, KIR Review Preview had a dedicated gate but PR CI did not invoke it | `package.json:45`; zero pre-change `test:kern-review-kir-preview` hits in `.github/workflows/ci.yml` on 2026-08-26 | VERIFIED |

## Implementation Options

### A. Delete slow tests

Rejected: it reduces evidence without proving that the assertions are obsolete.

### B. Raise the job timeout

Rejected: GitHub's hosted-job ceiling caused the observed cancellation, and a larger monolith would remain slow and opaque.

### C. Tier and shard execution

Selected: keep focused behavior and contract gates blocking on pull requests, move complete historical replay/cumulative regression walls to scheduled/manual exhaustive jobs, deduplicate aggregate scripts, and keep release verification unchanged.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `package.json` | Modify | Define package-only, focused frontend, and deduplicated infrastructure scripts |
| `.github/workflows/ci.yml` | Modify | Replace one six-hour job with bounded blocking jobs |
| `.github/workflows/exhaustive-tests.yml` | Add | Preserve scheduled/manual full historical evidence in bounded shards |
| `scripts/ci/test-tier-contract.test.mjs` | Add | Prevent duplicate/full-wall regression into PR CI |
| `scripts/kern-5-fitness.test.mjs` | Modify only if required | Preserve the current-gate ownership contract across tiers |

## Acceptance Criteria

- [x] The contract test is RED on the pre-change tree because focused scripts and exhaustive workflow are absent.
- [x] No PR CI job invokes `pnpm test`, `pnpm test:non-semantics`, `pnpm test:infra`, or the full successful-line replay wall.
- [x] PR CI invokes the KIR Review Preview gate and a bounded `infrastructure-contracts` lane.
- [x] `test:infra` composes `test:infra:contracts`, then invokes every current frontend fitness gate in order with no duplicate segment.
- [x] The focused successful-line command and every PR-reachable frontend leaf run behavior checks without `replay.test.mjs` or a cumulative regression-wall script.
- [x] The scheduled/manual exhaustive workflow runs bounded contracts, foundation, properties-core, properties-extended, full composition, language, and tooling shards; it must not invoke the monolithic `test:infra` command.
- [x] The exhaustive composition shard invokes the full successful-line replay and cumulative frontend evidence with a 180-minute cap; every other exhaustive shard has a 75-minute cap.
- [x] Release workflow continues to invoke `pnpm test` after version mutation.
- [x] Repository consistency, release workflow contracts, KERN fitness contracts, lint, and build pass.

## Out of Scope

- Deleting underlying assertions or fixture corpora.
- Changing release publication, registry reconciliation, or recovery behavior.
- Path-based test selection based on changed files; correctness-first static tiers land before change-impact routing.

## Deploy Order

Merge the CI-tiering branch first. New PRs then use bounded jobs while nightly/manual exhaustive runs preserve the historical wall. Release behavior remains unchanged, so there is no mixed-version runtime window.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Repeated builds were probably the primary cost | The 119-minute predecessor replay and cumulative shadow walls dominate; repeated builds are secondary | Preserve build optimization for later and first tier exhaustive evidence |
| Contracts could remain implicit in the quality lane | The required CI aggregator needs a separately visible bounded contracts result | Add `infrastructure-contracts` and remove the duplicate standalone runtime-contract step |
| Focused frontend leaves could retain cumulative regression walls | Those walls multiply work across PR shards; complete evidence belongs at the exhaustive full successful-line terminal gate | Use singular checkers for PR-reachable leaves and retain only the full successful-line cumulative wall |
| Root-script changes were self-contained | The KERN 5 fitness policy binds current root entrypoints byte-for-byte | Update the synchronized policy entries with the focused singular checker commands |
| Contract-tier assertions only needed presence checks | Presence checks could miss a missing/extra aggregator dependency or hidden PR alias | Assert exact `needs` and PR expansion, and require the core build before semantic ownership |
| Intermediate regression wrappers remained useful after tiering | They had no remaining references after singular checkers replaced them | Remove the 12 unreferenced wrappers; retain the terminal successful-line cumulative wall |

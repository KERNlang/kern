# PR CI Wall-Clock Reduction

**Date:** 2026-08-28
**Confidence:** 0.92

## Executive Summary

PR CI currently serializes several independent frontend test scripts inside four long-running jobs and runs every package test, including the dominant review package, in one package job. The change will preserve every semantic test while partitioning those independent scripts into fail-fast-disabled matrix shards and separating review-package tests from the remaining package train. Each shard will build its required artifacts once, then execute the selected package script with only its leading build preamble removed.

## Current State / Root Cause

- **VERIFIED:** `frontend-properties-extended`, `frontend-composition`, `frontend-language`, and `frontend-tooling` each invoke one aggregate script serially (`.github/workflows/ci.yml:190`, `.github/workflows/ci.yml:211`, `.github/workflows/ci.yml:232`, `.github/workflows/ci.yml:253`).
- **VERIFIED:** Those aggregates contain 3, 3, 6, and 3 semantically distinct leaf scripts respectively (`package.json:91`, `package.json:92`, `package.json:94`, `package.json:95`).
- **VERIFIED:** Every selected leaf script begins by building core, or core and CLI for tooling, so the aggregate repeats an artifact build before each leaf (`package.json:84-103`, `package.json:66`).
- **VERIFIED:** The package job builds the package train and then invokes every package's `test` script; all current package `test` scripts rebuild their package before testing (`.github/workflows/ci.yml:98-101`; command `for f in packages/*/package.json; do jq ...; done`, 2026-08-28, returned 20 test scripts beginning with `pnpm run build &&`).
- **VERIFIED:** The supplied live PR evidence identifies review tests as approximately 17 minutes of a package lane exceeding 31 minutes and the four frontend aggregates as approximately 29-31+ minutes. This timing evidence motivates parallel partitioning; no test is removed.

## What Already Works

- **VERIFIED:** PR CI already substitutes the focused successful-line composition gate for cumulative historical replay (`scripts/ci/test-tier-contract.test.mjs:83-90`).
- **VERIFIED:** Scheduled exhaustive CI retains the full composition replay and every current frontend fitness gate (`.github/workflows/exhaustive-tests.yml:1-57`; `scripts/ci/test-tier-contract.test.mjs:234-269`).
- **VERIFIED:** Release CI runs the complete `pnpm test` aggregate after a full build (`.github/workflows/release-pipeline.yml:91-104`).
- Quality, semantics, infrastructure, foundation, properties-core, and product-smoke lanes remain unchanged because current evidence does not identify them as the critical wall-clock tail.

## Implementation Plan

1. Add a narrowly scoped prebuilt-script runner that accepts one root package script, validates and removes only its leading core/CLI build preamble, rejects aggregate or later build commands, and executes strict Node-only segments without a shell. The runner expands only a single basename wildcard in-process; shell control syntax, interpolation, traversal, and non-Node commands are rejected.
2. Convert the four measured long frontend jobs to `fail-fast: false` matrices containing exactly the leaf scripts already present in their aggregates. Build core once per shard; tooling shards also build CLI once.
3. Split package tests into review and non-review jobs. Each job builds the complete package train once, preserving cross-package prerequisites, then a manifest-validated runner executes the same test glob without the packages' redundant build preambles.
4. Update the structural CI oracle to require exact matrix membership, build-before-test ordering, no aggregate invocation in matrix jobs, direct no-build package execution, and unchanged scheduled/release coverage.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.github/workflows/ci.yml` | Modify | Partition long PR-only lanes and build once per shard |
| `scripts/ci/run-prebuilt-test.mjs` | Add | Safely execute one existing semantic package script without its redundant leading build |
| `scripts/ci/run-prebuilt-test.test.mjs` | Add | Unit-test parsing, validation, and execution-plan behavior |
| `scripts/ci/run-prebuilt-package-tests.mjs` | Add | Discover test-bearing packages and run their standard semantic command after the clean package build |
| `scripts/ci/run-prebuilt-package-tests.test.mjs` | Add | Protect package selection and no-build command construction |
| `scripts/ci/test-tier-contract.test.mjs` | Modify | Enforce preserved coverage and bounded PR topology |
| `.Codex/specs/pr-ci-wall-clock/spec.md` | Add | Record verified invariants and acceptance criteria |

## Acceptance Criteria

- [ ] The new structural oracle fails at base because the four long frontend jobs are serial aggregates, package review is not partitioned, and package tests rebuild inside each package.
- [ ] Every leaf script from the four existing frontend aggregates appears exactly once in its replacement matrix.
- [ ] Every frontend matrix shard builds core once before the semantic command; tooling also builds CLI once; the semantic runner cannot silently skip a non-build command or accept nested aggregates.
- [ ] `@kernlang/review` tests and all other previously included package tests execute in separate required jobs, with `@kernlang/review-python` and IR semantics still excluded.
- [ ] Both package jobs use `build:packages` once and invoke the test runner directly, preserving clean cross-package prerequisites while avoiding each package's `pnpm run build` preamble.
- [ ] `.github/workflows/exhaustive-tests.yml`, `.github/workflows/release-pipeline.yml`, package leaf scripts, and `scripts/kern-5-fitness-policy.json` remain unchanged.
- [ ] Focused runner tests, `pnpm test:ci-contract`, applicable build/type checks, and `git diff --check` pass.

## Out of Scope

- Removing, weakening, or path-skipping semantically unique tests.
- Changing scheduled exhaustive or release coverage.
- Artifact sharing between GitHub jobs, runner-size changes, or product-smoke restructuring.
- Optimizing individual test algorithms; this change only improves safe orchestration parallelism and redundant-build structure.

## Open Questions

None blocking. The realized wall-clock depends on hosted-runner availability and the distribution of the three-to-six leaf runtimes, so the estimate must be verified by the next live PR run.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| The initial runner implementation executed remaining commands "without a shell rewrite." | The first implementation passed repository-controlled segments to `spawnSync` with `shell: true`; the 15 selected leaves require only Node commands and single-basename glob expansion. | Replaced shell execution with strict token validation, in-process basename-glob expansion, and direct `process.execPath` spawning. |

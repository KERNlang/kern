# KERN 5 CI Census Sweep

**Status:** IN REVIEW
**Date:** 2026-09-02
**Confidence:** 0.97

## Executive Summary

Add one required pull-request CI lane that executes the complete landed KERN 5
R/RT evidence family and a full repository `.kern` admission sweep. The lane
uses one checkout/install and a fail-fast root aggregate to avoid multiplying CI
setup minutes. The sweep runs into a temporary report and fails closed if it is
incomplete, suffers an infrastructure/probe failure, loses a ratcheted file, or
reports fewer admissions than the committed ratchet.

## Current State / Root Cause

- **[VERIFIED]** The root exposes R1, R2, RT2 through RT6, the admission census,
  its operator sweep, and RT8, but it exposes no C-PY-1 or CLI-shadow root gate
  (`package.json:105-115`, inspected 2026-09-02).
- **[VERIFIED]** Pull-request CI runs frontend, package, infrastructure, product,
  and tooling lanes but no KERN 5 R/RT leaf or admission census command
  (`.github/workflows/ci.yml:13-384`; `rg -n "admission-census|kern-5-r[12]|kern-5-rt[2-8]|c-py-1|cli-compiler-runtime-shadow" .github/workflows` returned no hits on 2026-09-02).
- **[VERIFIED]** The required `Build & Test` aggregator enumerates every required
  lane both in `needs` and in its result loop, so a new lane is not fail-closed
  until both lists include it (`.github/workflows/ci.yml:370-384`).
- **[VERIFIED]** The committed ratchet contains one admitted file, while the
  committed full report contains 240 completed files and one admission
  (`scripts/kern-5-admission-census/admitted.json:1-23` and
  `scripts/kern-5-admission-census/admission.json:1-12`).
- **[VERIFIED]** The existing focused census test protects the one-file floor
  and live three-leg behavior but scans only the whitelist plus five pinned
  rejections for its count assertion (`scripts/kern-5-admission-census/census.test.mjs:29-96`).
- **[VERIFIED]** The full sweep itself records timeout, overflow, child-exit,
  and unparsable results as rejected rows and exits normally; it does not apply
  a CI failure policy (`scripts/kern-5-admission-census/sweep.mjs:72-123,162-192`).

## What Already Works

The admission implementation, corpus ownership, RT evidence suites, and their
runtime/compiler owners already exist. This slice only wires public root gates,
adds a CI-only sweep policy wrapper, and authenticates the workflow contract.
No KIR, runtime, projection, corpus, or census implementation changes are
needed.

## Implementation Options

### A — One required aggregate lane (recommended)

Add missing root aliases, an ordered `test:kern-5-script-family` aggregate, a
temporary-output `census:sweep` wrapper, and one CI job. This installs once and
is cheapest in CI minutes; later commands do not run after the first failure.

### B — Matrix of leaf scripts

This reports all failures in parallel but repeats checkout, dependency install,
and core builds for every leaf. It materially increases CI minutes without
improving the acceptance contract, so it is rejected for this slice.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `package.json` | modify | expose missing leaf gates, census sweep, and ordered family aggregate |
| `.github/workflows/ci.yml` | modify | add required KERN 5 evidence lane and aggregator dependency |
| `scripts/ci/kern-5-census-sweep.mjs` | add | run a non-mutating full sweep and enforce the ratchet/infrastructure policy |
| `scripts/ci/kern-5-census-sweep.test.mjs` | add | prove the fail-closed policy with synthetic reports |
| `scripts/ci/test-tier-contract.test.mjs` | modify | authenticate exact family membership and required workflow routing |
| `.Codex/specs/kern-5-ci-census-sweep/spec.md` | add | durable claim-tagged contract |

## Acceptance Criteria

- [x] `test:ci-contract` is RED at `origin/main` because the required KERN 5
  lane/root aggregates are absent, then GREEN after implementation.
- [x] `test:kern-5-script-family` contains exactly, once, and in dependency
  order: R1, R2, C-PY-1, CLI shadow, RT2, RT3, RT4, RT5, RT6, the full census
  sweep, the focused census gate (RT7), and RT8.
- [x] `census:sweep` scans every tracked `.kern` file into temporary output and
  exits nonzero on incomplete results, probe/timeout infrastructure failures,
  a missing ratcheted path, or `admittedCount < committed ratchet length`.
- [x] Pull-request CI contains one `kern-5-evidence` job that runs
  `pnpm test:kern-5-script-family`; `Build & Test` requires its success.
- [x] Workflow/static contract validation, typecheck/build, every family leaf,
  and the full corpus sweep pass locally from the fresh worktree.
- [x] No lane-1 or hard-boundary file changes.
- [ ] Automatic-risk Agon review with primary `codex` and mechanical mutation
  completes after local gates; every finding is verified against source.

## Out of Scope

No changes to RT2-RT9, KIR/runtime/compiler behavior, F0-F5 authority,
frontend projection, any `.kern` file, admission-census implementation/data,
terminal-gate promotion, release, merge, or deployment. R0-SVC, R0-PKG, and the
review-analyzer backlog remain separate lane-2 slices.

## Open Questions

None blocking. C-PY-1 and CLI-shadow have landed test directories but no root
aliases; this slice supplies aliases without changing their contracts.

## Deploy Order

The feature branch can merge independently of lane 1 because it only consumes
existing gates. During branch skew, older branches simply lack the new required
CI lane; no runtime or public API compatibility changes.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| The existing focused census test alone proves the full corpus ratchet. | Its live count check covers the whitelist plus five pinned rejected samples. | Run the full corpus sweep and enforce an explicit CI policy over its report. |
| Every landed KERN 5 slice already has a root script. | C-PY-1 and CLI-shadow have harness directories but no root aliases; RT7 is represented by the census. | Add honest aliases and bind RT7 to the sweep plus focused census gate. |

## Pre-review Verification

- **[VERIFIED]** The base oracle failed for the intended two absences: 7 passed,
  2 failed (`pnpm test:ci-contract` on `origin/main` plus the RED test change,
  2026-09-02).
- **[VERIFIED]** The implemented workflow contract passed 9/9 and the sweep
  policy tests passed 6/6 (`pnpm test:ci-contract`; `node --test
  scripts/ci/kern-5-census-sweep.test.mjs`, 2026-09-02).
- **[VERIFIED]** The complete Node 22 family aggregate passed: R1 22, R2 16,
  C-PY-1 29, CLI shadow 16, RT2 35, RT3 142, RT4 50, RT5 86, RT6 52,
  full census 1/240, focused census 10, and RT8 28
  (`PATH=/Users/nicolascukas/.nvm/versions/node/v22.22.0/bin:$PATH pnpm
  test:kern-5-script-family`, 2026-09-02).
- **[VERIFIED]** `pnpm build:packages`, `pnpm lint`, `git diff --check`, and
  Ruby YAML parsing of `.github/workflows/ci.yml` passed on the candidate. The
  root playground build alone is not evidence for this slice because the
  instructed worktree copied package-level dependency symlinks outside the
  Turbopack filesystem root; package build/typecheck completed before that
  environment-only failure.

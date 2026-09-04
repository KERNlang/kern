# CI pnpm store cache

**Status:** READY TO BUILD
**Date:** 2026-09-04
**Confidence:** 0.91

## Executive Summary

Every installing job in `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile --ignore-scripts` from a cold pnpm store on every run. Cache the pnpm content-addressable store across runs so repeated installs of the same `pnpm-lock.yaml` hit local disk instead of the network, without changing any install command, test command, build command, job topology, or the `concurrency` gate. Mechanism: `actions/cache@v4` keyed on `pnpm-lock.yaml`'s hash, over the path printed by `pnpm store path`, inserted right after each job's existing "Activate pnpm" step and before "Install dependencies". `setup-node`'s built-in `cache: pnpm` input was rejected because it requires pnpm to already be resolvable on `PATH` when the `setup-node` step itself executes, and in this repo pnpm is not put on `PATH` until the later "Activate pnpm" (`corepack enable && corepack prepare pnpm@10.32.1 --activate`) step, which runs strictly after `setup-node` in every one of the 11 installing jobs.

## Current State / Root Cause

Verified by reading `.github/workflows/ci.yml` in full (bash `cat`, 2026-09-04):

- 11 job definitions install dependencies: `quality` (L14-52), `infrastructure-contracts` (L54-73), `package-tests` (L75-109), `semantics` (L111-154), `frontend-foundation` (L156-175), `frontend-properties-core` (L177-196), `frontend-properties-extended` (L198-229), `frontend-composition` (L231-262), `frontend-language` (L264-301), `frontend-tooling` (L303-336), `product-smoke` (L338-368). The 12th job, `build-and-test` (L370-385), is a `needs:`-only aggregator with no checkout/install.
- Every installing job's step order is: `actions/checkout@v7` → `actions/setup-node@v7` (pinning `node-version: '22'`, no `cache:` input) → ... → a step literally named `Activate pnpm` whose `run:` block is exactly:
  ```
  corepack enable
  corepack prepare pnpm@10.32.1 --activate
  pnpm --version
  ```
  → ... → `Install dependencies` running `pnpm install --frozen-lockfile --ignore-scripts`.
- In every job, `Activate pnpm` appears strictly after `actions/setup-node@v7` and strictly before `Install dependencies` (verified line-by-line for all 11 jobs). In 4 jobs (`quality` L25, `package-tests` L99, `semantics` L122, `product-smoke` L354) a `setup-python`/`pip install mcp` pair also sits between `setup-node` and `Install dependencies`, in varying order relative to `Activate pnpm` — but `Activate pnpm` always precedes `Install dependencies` regardless.
- `package.json:6` pins `"packageManager": "pnpm@10.32.1"`, matching the `corepack prepare pnpm@10.32.1` version exactly — VERIFIED, `grep -n '"packageManager"' package.json` → `"packageManager": "pnpm@10.32.1"`.
- No job's `setup-node@v7` step has a `cache:` input — VERIFIED, `grep -n "cache:" .github/workflows/ci.yml` → zero hits, 2026-09-04.
- `scripts/ci/test-tier-contract.test.mjs` already parses `.github/workflows/ci.yml` per-job via `workflowJob(workflow, id)` (a marker-based string slice, L17-24) and asserts on step order and `uses:` sets. This file is the natural home for new cache-block assertions — same slicing helper, same per-job pattern already established for `product-smoke`, `semantics`, `package-tests`.
- `pnpm-lock.yaml` exists at repo root (implied by `--frozen-lockfile` usage and `hashFiles('pnpm-lock.yaml')` being the natural cache key input); no other lockfile is referenced anywhere in the workflow.

## What Already Works

- Job topology, `strategy.matrix` shards, `needs:` graph, `build-and-test` aggregator, and the top-level `concurrency` block (L9-11: `group: ${{ github.workflow }}-${{ github.ref }}`, `cancel-in-progress: true`) are correct and untouched.
- `pnpm install --frozen-lockfile --ignore-scripts` is the correct install invocation in every job and is not changed.
- `actions/setup-python@v7` + `pip install mcp` in the 4 python-needing jobs is unrelated to this change and untouched.
- The `Activate pnpm` step's corepack version pin already matches `package.json`'s `packageManager` field — no drift to fix there.

## Implementation Options

Only one option survives contact with the verified activation order; the alternative is a real option in the abstract but is disqualified by this repo's concrete facts, not a strawman.

**Option A — `setup-node@v7` `cache: pnpm` input (rejected).** Requires the `pnpm` binary to be resolvable on `PATH` at the moment the `setup-node` step executes (it shells out to `pnpm store path` internally to compute the cache path). In this repo, `pnpm` is not on `PATH` until the `Activate pnpm` step, which runs strictly *after* `setup-node` in all 11 jobs (verified above). Adopting this option requires moving pnpm activation to before `setup-node`, which means running `corepack enable && corepack prepare` against whichever Node binary the GitHub-hosted `ubuntu-latest` runner image ships by default (not the pinned Node 22 that `setup-node` installs). Whether that preinstalled runner Node has a corepack version compatible with `corepack prepare pnpm@10.32.1` cannot be verified from this repo or this machine — it depends on the runner image, which is out of this repo's control and can change without a diff here. Taking that dependency to save a cache-input line is not worth the unverifiable risk to every one of 11 CI lanes. **Not chosen.**

**Option B — `actions/cache@v4` on the pnpm store path, inserted after `Activate pnpm` (chosen).** Two new steps per job, placed immediately after the existing `Activate pnpm` step (so `pnpm` is already on `PATH`) and before `Install dependencies` (so the store is warm before install runs):
```
      - name: Resolve pnpm store path
        run: echo "STORE_PATH=$(pnpm store path)" >> "$GITHUB_ENV"
      - name: Cache pnpm store
        uses: actions/cache@v4
        with:
          path: ${{ env.STORE_PATH }}
          key: ${{ runner.os }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}
```
This never touches step order relative to `setup-node`, `setup-python`, or `Install dependencies`; it only inserts two new steps at one fixed anchor point (right after `Activate pnpm`) that exists identically in all 11 jobs. `actions/cache@v4` is an official `actions/*` action, consistent with every other action already in this workflow (`actions/checkout@v7`, `actions/setup-node@v7`, `actions/setup-python@v7`, `actions/upload-artifact@v7`) — not a new third-party dependency.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.github/workflows/ci.yml` | Insert the two-step cache block after `Activate pnpm` in each of the 11 installing jobs | Warms the pnpm store cache identically everywhere installs happen |
| `scripts/ci/test-tier-contract.test.mjs` | Add assertions: every installing job's `uses:` set includes `actions/cache@v4`; the cache block's `path`/`key` lines are present; the install command text is byte-identical to today; the top `concurrency:` block is byte-identical to today | Pin the new setup contract the same way existing setup contracts (python version, install flags, `Build & Test` aggregator shape) are already pinned in this file |

Nothing else changes: no other workflow file (`exhaustive-tests.yml`, `release-pipeline.yml`), no `package.json` script, no test/build command, no job name, no `needs:` graph, no matrix shard.

## Acceptance Criteria

- [ ] All 11 installing jobs (`quality`, `infrastructure-contracts`, `package-tests`, `semantics`, `frontend-foundation`, `frontend-properties-core`, `frontend-properties-extended`, `frontend-composition`, `frontend-language`, `frontend-tooling`, `product-smoke`) carry the identical two-step cache block (`Resolve pnpm store path` + `Cache pnpm store` using `actions/cache@v4`, keyed on `hashFiles('pnpm-lock.yaml')`).
- [ ] The cache block appears after `Activate pnpm` and before `Install dependencies` in every one of those 11 jobs.
- [ ] `Install dependencies` still runs exactly `pnpm install --frozen-lockfile --ignore-scripts` in every job, byte-identical to before.
- [ ] The per-job `uses:` action set is exactly the old set plus `actions/cache@v4` — no other action added, removed, or reordered relative to the others.
- [ ] The top-level `concurrency:` block (L9-11) is byte-identical to before.
- [ ] `build-and-test`'s `needs:` list, step, and `if: ${{ always() }}` are untouched.
- [ ] `pnpm test:ci-contract` and `pnpm lint` both pass.
- [ ] The workflow YAML parses cleanly (`python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/ci.yml"))'`).
- [ ] Removing the cache block from any one job makes the new tier-contract row(s) for that job fail.
- [ ] Changing any job's install command (e.g. dropping `--ignore-scripts`) makes the existing/new tier-contract assertion for that job fail.

## Out of Scope

- Matrix collapse or job/lane consolidation (`package-tests`, `frontend-properties-extended`, `frontend-composition`, `frontend-language`, `frontend-tooling` shards stay as-is).
- Path filters / conditional job execution based on changed files.
- A shared build artifact passed between jobs (each job still builds what it needs independently).
- Any change to `exhaustive-tests.yml` or `release-pipeline.yml` — out of the stated blast radius.
- `setup-node`'s `cache:` input (Option A) — rejected above, not revisited unless the activation step is independently reordered for unrelated reasons and that reordering is itself verified safe.
- Cache `restore-keys` fallback prefixes — the single exact-lockfile key is sufficient for the stated goal (hit cache when the lockfile is unchanged) and keeps the tier-contract assertion surface minimal; can be added later without touching this spec's blast radius.

## Open Questions

None blocking. The one real unknown (whether the `ubuntu-latest` image's preinstalled Node/corepack would support pre-`setup-node` activation) is resolved by *not* taking that path — Option B sidesteps it entirely rather than requiring an answer.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| (task framing) "if the activation depends on node being installed first, instead use actions/cache@v4" | Confirmed true by direct line-by-line read of all 11 jobs: `Activate pnpm` runs after `setup-node` in every single job, with no exception. | Locked in Option B with no remaining ambiguity; no reordering of the activation step was attempted. |

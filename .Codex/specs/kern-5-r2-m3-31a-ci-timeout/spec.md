# KERN 5 M3.31a Checker Smoke Timeout Policy

**Status:** COMPLETE — PUBLICATION PENDING
**Date:** 2026-07-16
**Confidence:** 0.99

## Executive Summary

PR #534 passed its complete local KERN 5 fitness wall, but GitHub Actions later
failed `Runner smoke + browser budget` because the self-hosted checker process
hit the script's literal 30-second `spawnSync` timeout. Replace that literal
threshold with a validated, versioned repository policy and set the checked-in
checker budget to 60 seconds. Every checker-subset subprocess must consume the
same policy value.

## Current State / Root Cause

- **VERIFIED:** authenticated job logs for Actions job `87611069390` show
  `kern run smoke`, preview-app smoke, browser policy, measured browser budget,
  capstone flatten, and capstone assertion-engine all passed before the failure.
- **VERIFIED:** the same log records
  `spawnSync /opt/hostedtoolcache/node/22.23.1/x64/bin/node ETIMEDOUT` exactly
  30 seconds after `test:capstone-checker-subset` entered its KERN execution.
- **VERIFIED:** `scripts/check-capstone-checker-subset.mjs:83-155` passes the
  literal `timeout: 30000` to its main fixture, red-team fixtures, and numeric
  fixture.
- **VERIFIED:** the final M3.31a tree passed exact `pnpm fitness:kern-5` locally
  on 2026-07-16, including 48/48 checker fixtures and the same runner-smoke
  chain.
- **VERIFIED:** the connected GitHub app can read the job log but GitHub rejects
  its job-rerun request with `403 Resource not accessible by integration`.
- **VERIFIED:** the first final-tree fitness rerun exposed a semantic-ownership
  integration regression after subprocess execution moved out of the checker:
  `checker-to-cli source evidence drifted`. Keeping `spawnSync` in the checker
  and updating its AST witness from the fixed main fixture to the shared
  `target` invocation restores the ownership proof without weakening it.

The product behavior is green. The CI defect is a runner-sensitive literal
process deadline that is too close to the observed hosted-runner execution
time and cannot be tuned without changing source.

## What Already Works

- The checker fixture corpus, reference comparison, and generated KERN inputs
  need no semantic changes.
- Browser size/timing budgets passed in the failed job and remain unchanged.
- The complete M3.31a runtime and convergence receipt remain unchanged.
- Existing timeout errors already fail closed with exit code 2 and useful
  stderr; only timeout ownership changes.

## Contract (Verified)

> Verified against `scripts/check-capstone-checker-subset.mjs`, authenticated
> Actions job `87611069390`, and the final local KERN 5 fitness run on
> 2026-07-16.

| Field / Behavior | Contract | Evidence | Tag |
| --- | --- | --- | --- |
| `schemaVersion` | exactly `1` | `scripts/selfhost-smoke-policy.mjs:23-26`; policy test | VERIFIED |
| `timeouts.capstoneCheckerSubsetMs` | positive safe integer | `scripts/selfhost-smoke-policy.mjs:27-35`; policy test | VERIFIED |
| checked-in timeout | `60000` milliseconds | `scripts/selfhost-smoke-policy.json`; `selfhost-smoke-policy.test.mjs:27-34` | VERIFIED |
| subprocess coverage | main, red-team, and numeric checker invocations share the policy value | `check-capstone-checker-subset.mjs`; policy binding test | VERIFIED |
| authority edge | checker directly owns the Node CLI subprocess through an AST-verified shared target call | `semantic-ownership/policy.json`; `semantic-ownership/validate.test.mjs` | VERIFIED |
| invalid policy | rejects before spawning KERN | `selfhost-smoke-policy.test.mjs:36-53` | VERIFIED |

## Implementation Options

### A. Versioned self-host smoke policy — selected

Add a small JSON policy and loader, test its closed schema, and bind all three
checker subprocesses to the validated value. This is durable, reviewable, and
config-tunable without changing executable source.

### B. Raise the literal timeout

Rejected because it preserves the exact hardcoded-threshold defect exposed by
CI and violates the repository's config-tunable threshold rule.

### C. Retry the unchanged job

Rejected as the only remedy because it cannot prevent recurrence and the
connected integration lacks Actions-write permission. A later retry remains a
useful verification step after the policy fix.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `scripts/selfhost-smoke-policy.json` | add checked-in timeout policy | configuration owner |
| `scripts/selfhost-smoke-policy.mjs` | add closed-schema loader | fail closed before execution |
| `scripts/selfhost-smoke-policy.test.mjs` | add policy and consumer-binding regression | RED/GREEN oracle |
| `scripts/check-capstone-checker-subset.mjs` | consume one validated timeout | remove three literals |
| `scripts/semantic-ownership/policy.json` | follow the shared checker target | preserve checker-to-CLI authority proof |
| `scripts/semantic-ownership/validate.mjs` | bind the expected witness | fail closed on policy drift |
| `scripts/semantic-ownership/validate.test.mjs` | mutate the shared target edge | keep the witness adversarial |
| `package.json` | include policy regression in runner smoke | keep CI receipt executable |

## Acceptance Criteria

- [x] The regression fails on the current PR head because the policy artifacts
      and consumer binding do not exist.
- [x] Invalid schema versions, unknown top-level keys, missing timeout fields,
      and non-positive/fractional timeout values fail closed.
- [x] The checked-in policy loads as exactly 60 seconds.
- [x] Every checker-subset `spawnSync` call consumes the validated policy value;
      no `timeout: 30000` remains in that script.
- [x] `test:capstone-checker-subset`, `test:runner-smoke`,
      `test:kern-semantic-ownership`, lint, build, and `git diff --check` pass.
- [x] Exact final-tree `fitness:kern-5` passes after the ownership-witness
      correction.
- [x] Full-roster `agon review` finds no verified blocker.
- [ ] The corrective commit is Agon-signed, rebased immediately before one
      push to the still-open PR #534 branch.
- [ ] GitHub checks pass and PR #534 merges before another slice starts.

## Out of Scope

- Changing checker semantics, fixtures, or output.
- Changing browser performance budgets.
- Generalizing every pre-existing script timeout in the repository.
- Adding environment-specific overrides or retry-on-timeout behavior.

## Open Questions

None. The failed process, elapsed deadline, consumer, and required publication
path are all directly evidenced.

## Deploy Order

Policy, loader, consumer, and regression ship atomically on PR #534. Older
checkouts retain the literal 30-second timeout; the new checkout validates the
policy before running the checker. Rebase against fresh `origin/main`
immediately before the corrective push. After PR merge, never push this branch
again; start the next slice from fresh `origin/main`.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| The browser budget likely failed. | Browser budget passed at 97 ms cold / 246 ms browser. | Do not alter browser policy. |
| Public annotations were enough to diagnose the failure. | They exposed only exit code 2; authenticated logs identified the exact checker timeout. | Bind the fix to the proven subprocess. |
| The connected GitHub app could rerun the job. | Read access works, but Actions rerun returns 403. | Publish a durable fix instead of waiting on an unavailable rerun. |
| Moving subprocess execution to a generic helper strengthened the consumer test. | It broke the repository's direct checker-to-CLI semantic-ownership witness and made ownership less explicit. | Keep execution in the checker; verify the actual call with the shared AST witness and policy-bound source regression. |

## Adversarial Record

Final full-roster review
`review-1784210533606-nib18i-kern-5-m3-31a-ci-timeout-final`
completed 6/6 with zero verified defects, four needs-check items, and eleven
nits. The four needs-check items were adjudicated against the final tree:

- the policy regression executes in `test:runner-smoke`, which is the exact
  CI/fitness owner for this subprocess;
- `pnpm lint` accepts the import ordering;
- the checker has one AST-verified `spawnSync` edge, one named policy timeout,
  and three calls through that shared owner;
- loading the closed policy before the CLI existence check intentionally keeps
  invalid configuration fail-closed before process execution.

No review item requires a code change.

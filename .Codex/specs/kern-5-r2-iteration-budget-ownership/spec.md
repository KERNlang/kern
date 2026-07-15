# KERN 5 R2 M3.25 Caller-Owned Iteration Budget

**Status:** IMPLEMENTED - READY FOR PR
**Date:** 2026-07-15
**Confidence:** 0.99

## Executive Summary

M3.25 removes the source-runner `iteration-budget` configuration blocker by
threading one caller-owned positive safe integer through all four public source
runner APIs and the `kern run` CLI. No default is embedded. Omitting the option
preserves the current deterministic compatibility selection; supplying it lets
loop-, lambda-, and helper-bearing programs select the canonical machine.

This is an additive browser-safe runner contract. It does not change machine
loop semantics, add a catch-and-retry fallback, or claim ownership of runner
classes or non-root environments.

## Baseline Root Cause

- **VERIFIED:** `SourceRunnerEngineOptions` already accepts
  `iterationBudget?: number`, validates it as a positive safe integer, selects
  compatibility when an admitted program needs a budget but none was supplied,
  and forwards a supplied value to the machine
  (`packages/core/src/runtime-envelope/source-runner-engine.ts:37-40,66-90,105-126`).
- **VERIFIED:** the contract test explicitly requires a caller-owned budget and
  rejects an embedded loop threshold
  (`packages/core/tests/source-runner-engine.test.ts:52-61`).
- **VERIFIED:** `ExecuteKernSourceOptions` has no budget field, even though its
  async and entry variants inherit from it (`packages/core/src/runner.ts:96-164`).
- **VERIFIED:** the sync public path drops the configuration by calling
  `executeSourceRunnerSync` with only `policy`
  (`packages/core/src/runner.ts:1065-1089`).
- **VERIFIED:** the direct async path forwards capability options but no budget,
  while the async-to-sync delegation reconstructs an allowlist that also omits
  a budget (`packages/core/src/runner.ts:1245-1264,1286-1298`).
- **VERIFIED:** the browser entry re-exports `ExecuteKernSourceOptions` and both
  source APIs from the same runner module, so a scalar option adds no browser
  dependency (`packages/core/src/runner-browser.ts:11-24,41-50`).
- **VERIFIED:** the CLI wrapper currently exposes only `sourcePath` on its sync
  path and has no iteration configuration on its async path
  (`packages/cli/src/commands/run.ts:93-115`).
- **VERIFIED:** the convergence manifest therefore keeps `iteration-budget` as
  `configuration` / `compatibility`
  (`scripts/source-runner-convergence-manifest.json:36-54`).

The root cause is missing configuration transport, not missing loop semantics.
The machine already consumes a shared exact budget; the active public wrappers
and CLI cannot provide it.

## What Already Works

- Machine execution validates and consumes the exact caller budget.
- Explicit budgets already cover `for`, `while`, all `each` forms, bounded
  lambdas, and reachable helper loops.
- Missing budgets select compatibility before execution.
- Machine failures never retry on the legacy runner.
- Runtime-handler execution already derives its internal budget from a
  separately validated host limit and is outside this slice.

## Contract (Verified)

> Verified against the listed source files on 2026-07-15.

| Field / Behavior | Type | Evidence | Tag |
|---|---|---|---|
| `ExecuteKernSourceOptions.iterationBudget` | optional positive safe integer | engine contract at `source-runner-engine.ts:37-40,66-80` | VERIFIED |
| Sync main and entry APIs | inherit and forward the field exactly once | shared path at `runner.ts:1047-1089` | VERIFIED |
| Async main and entry APIs | inherit and forward on direct async and sync-delegation paths | `runner.ts:1116-1135,1245-1298` | VERIFIED |
| Omitted budget | preserves compatibility selection for budget-requiring programs | `source-runner-engine.ts:73-80` | VERIFIED |
| Invalid budget | rejects before execution with `invalid-iteration-budget` | `source-runner-engine.ts:42-46,66-70` | VERIFIED |
| Browser ABI | reuses the same scalar option and adds no import | `runner-browser.ts:11-24,41-50` | VERIFIED |
| CLI flag | `--iteration-budget <positive-safe-integer>`; omitted means current behavior | CLI has no existing field at `packages/cli/src/commands/run.ts:93-115` | VERIFIED |

## Implementation Options

### Option A - Embedded implicit default

Rejected. It contradicts the existing caller-owned contract and hardcodes a
tunable execution limit.

### Option B - Public runner option only

Smallest code diff, but rejected as the final M3.25 boundary because the main
`kern run` consumer could not exercise the owned configuration while the
manifest claimed the blocker closed.

### Option C - Public option plus explicit CLI flag (selected)

Add one optional field inherited by all public runner variants, forward it
through both execution lanes, and add one explicit CLI flag. This closes the
configuration transport end to end without changing omission behavior.

### Option D - Non-root environment first

Deferred. It is prerequisite work for class transactions, not a solution to
the already-isolated iteration configuration gap.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-iteration-budget-ownership/spec.md` | add/update | frozen contract and evidence |
| `packages/core/src/runner.ts` | edit | exported option and exact sync/async forwarding |
| `packages/core/tests/runner-iteration-budget.test.ts` | add | four public API lanes, omission, invalid values, exact exhaustion |
| `packages/cli/src/commands/run.ts` | edit | explicit flag parsing and forwarding |
| `packages/cli/src/commands/run-options.ts` | add | bounded option types, usage, and numeric validation |
| `packages/cli/tests/run-iteration-budget.test.ts` | add | CLI usage, validation, execution, and omission compatibility |
| `scripts/semantic-ownership/validate.test.mjs` | edit | keep authority-witness mutations exact after the call shape changes |
| `scripts/source-runner-convergence-manifest.json` | edit | promote configuration ownership for M3.25 |
| `scripts/check-source-runner-convergence.mjs` | edit | bind exact forwarding and forbid embedded defaults |
| `scripts/source-runner-convergence.test.mjs` | edit | mutation-kill missing, duplicated, or defaulted forwarding |
| `docs/kern-5-release-train.md` | edit | close M3.25 with measured evidence |

`runner.ts` is already oversized. M3.25 adds only one interface field and
small forwarding properties there; parsing and validation stay in the CLI and
existing engine owner rather than adding a second runner implementation.

## Acceptance Criteria

- [x] `ExecuteKernSourceOptions` exposes `readonly iterationBudget?: number`;
  async and entry variants inherit it without duplicate declarations.
- [x] `executeKernSource` and `executeKernEntrySource` forward the exact supplied
  value once to `executeSourceRunnerSync`.
- [x] `executeKernSourceAsync` and `executeKernEntrySourceAsync` forward the
  exact supplied value on both the real async lane and sync-delegation lane.
- [x] Omission preserves legacy selection for programs that require a budget;
  no literal, environment variable, collection-length guess, or other implicit
  default is introduced.
- [x] Zero, negative, fractional, unsafe, `NaN`, and infinite values reject
  before any capability provider or stdout event executes.
- [x] A configured budget admits loop, lambda-collection, and reachable-helper
  programs to the machine and exhausts at the exact existing boundary.
- [x] Sync and async paths consume identical budgets for identical immediate
  programs.
- [x] `kern run --iteration-budget N` parses only one positive safe integer,
  forwards it on sync and async execution paths, and documents the flag.
- [x] CLI omission remains byte-for-byte compatible; duplicate, missing,
  malformed, non-positive, fractional, and unsafe flag values fail closed.
- [x] The convergence guard rejects missing forwarding, duplicate forwarding,
  a literal/default budget, a `process.env` switch, and catch-and-retry.
- [x] The M3.25 manifest records `iteration-budget` as evidenced `unified` while
  `runner-classes-state` and `non-root-environment` remain exact deferred rows.
- [x] Browser closure/budget, runtime-envelope closure, source-runner
  convergence, targeted core/CLI tests, and `pnpm fitness:kern-5` all pass.
- [x] One full-roster `agon review -e claude,codex,agy` completes after the
  local wall; every reported finding is verified against current source.

## Out of Scope

- A default iteration budget or automatic source-derived threshold.
- Removing compatibility behavior when no budget is supplied.
- Changing runtime-handler limit ownership.
- Runner class state, constructors, `this`, `super`, inheritance, or mutation.
- Non-root/module environment transaction ownership.
- Public runtime-handler ABI or KIR changes.
- Reference-runner imports, execution catch-and-retry, or legacy deletion.

## Open Questions

None. The selected contract contains no ASSUMED or OPEN acceptance claim.

## Deploy Order

Core and CLI ship in the same monorepo release. During version skew, older
callers omit the additive field and retain compatibility selection; newer
callers can opt in explicitly. A newer CLI cannot depend on an older core in
the workspace release. Rollback removes the CLI flag and option forwarding,
restores the manifest row to deferred, and requires no data migration.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| M3.25 should own runner classes immediately after helpers. | The tribunal found helper re-entry lacks receiver identity and transactional class-state semantics. | Sequence explicit budget configuration before non-root transactions and classes. |
| M3.25 should choose an internal implicit budget. | The existing test freezes caller ownership, and repository rules forbid hardcoded tunables. | No default; add explicit public and CLI configuration. |
| A public runner option alone honestly closes the release blocker. | `kern run` is a live consumer and currently cannot supply the option. | Include an explicit CLI flag in the same slice. |
| Helper budget exhaustion would always expose the leaf machine error at the public boundary. | The helper trampoline normalizes the leaf failure into a rejected public print while preserving exact budget behavior in its cause. | Assert behavioral admission/exhaustion at the public boundary and retain exact engine-level budget tests. |

## Agon Evidence

- Sequencing tribunal: `tribunal-1784134873121-a3mpeh-kern-5-r2-m3-25-sequencing`
  (3/3 engines; budget before non-root transactions and class state).
- Contract brainstorm:
  `brainstorm-1784135144434-nrx62r-kern-5-r2-m3-25-budget-contract`
  (3/3 engines; caller-owned additive option selected after source verification).
- Full-roster review:
  `review-1784141350527-jna9fu-kern-5-r2-m3-25-iteration-budget`
  (`claude` and `codex` returned zero findings; `agy` timed out at 180 seconds).
- Focused completion retry:
  `review-1784141541689-hzqupd-kern-5-r2-m3-25-iteration-budget`
  (`agy` returned zero findings; all three requested reviewers therefore completed).

## Implementation Evidence

- Targeted core budget wall: 11 cases passed across sync, async, entry,
  lambda, helper, invalid-value, and provider-order behavior.
- Targeted CLI budget wall: 10 cases passed across sync, real async,
  omission, duplicate, missing, malformed, and capabilities-mode behavior.
- Semantic-ownership wall: 40/40 adversarial witness tests passed after the
  sync call-shape fixture was made exact and fail-closed.
- Source-runner convergence: 7/7 mutation tests and the production guard
  passed; only `runner-classes-state` and `non-root-environment` remain deferred.
- `pnpm fitness:kern-5` passed end to end on 2026-07-15: 432/432 cross-target
  conformance fixtures, 109/109 class fixtures, 233 native assertions, 48/48
  checker fixtures, and 39/39 self-host validator verdicts.
- Required browser wall passed at 128 modules, 1,384,412 raw bytes, 305,749
  gzip bytes, 47 ms cold import/execute, and 75 ms median browser
  import/execute (69/75/83 ms samples).

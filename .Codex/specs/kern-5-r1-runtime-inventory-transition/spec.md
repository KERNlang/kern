# KERN 5 R1 Runtime Inventory Transition Repair

**Status:** IMPLEMENTED AND VERIFIED (uncommitted)
**Date:** 2026-08-27
**Confidence:** 0.96

## Executive Summary

PR #558 adds ten compiled Core JavaScript modules for the KIR runtime owner. Clean CI now presents 332 paths to a frozen historical transition that accepts exactly the authenticated 322-path predecessor, so one fail-closed rejection cascades through 102 canonicalizer tests. Add one immutable reverse transition that authenticates the 332-path R1 inventory, removes exactly the ten R1 paths, proves the frozen 322-path identity, and then calls the existing historical chain unchanged.

## Current State / Root Cause

- **VERIFIED:** Core recursively inventories every emitted `.js` file and normalizes it to a repository-relative POSIX path (`scripts/kern-canonicalizer/coverage-dependencies.mjs:161-179`).
- **VERIFIED:** Legacy historical callers enter through `reconstructRunnerCallCacheCompiledCoreJavaScriptPaths`; the R1 reverse edge must compose there immediately before the frozen frontend-projection edge, so every caller first receives the authenticated 322-path predecessor.
- **VERIFIED:** The frontend-projection edge rejects anything other than 322 paths with digest `7acc8276003ea732f7ae3e18d4feddb235d6726a4277828e704599ea35e1cefa` (`scripts/kern-canonicalizer/frontend-projection-historical-transition.mjs:68-86`).
- **VERIFIED:** A clean R1 build contains 332 paths with digest `2258d6442315b54ad81f27f387ffa0c43239e28e442d0452efe0504f6d8e9bd2`; removing the ten paths listed below reproduces the frozen 322-path digest. Evidence: `pnpm --filter @kernlang/core build` plus the transition inventory hash on 2026-08-27.
- **VERIFIED:** The narrow R1 gate builds Core and runs only `scripts/kern-5-r1-runtime-owner/*.test.mjs`, while `test:kern-canonicalizer` exercises the historical chain (`package.json:66,106`). This omission allowed the PR to push locally before clean CI exposed the cascade.

## What Already Works

The existing frontend-projection, runner-cache, and M4.145 transitions correctly reproduce their frozen predecessor inventories. They must not be edited or regenerated. R1 runtime behavior, package build, and focused runtime-owner tests are already green.

## Contract (Verified)

> Verified against the clean R1 build and transition sources on 2026-08-27.

| Field / Behavior | Evidence | Tag |
|---|---|---|
| R1 successor inventory | 332 paths, digest `2258d6442315b54ad81f27f387ffa0c43239e28e442d0452efe0504f6d8e9bd2` | VERIFIED |
| Pre-R1 predecessor inventory | 322 paths, digest `7acc8276003ea732f7ae3e18d4feddb235d6726a4277828e704599ea35e1cefa` | VERIFIED |
| Added paths | `frontend-projection/verified-brand.js`; `kir-runtime/capability.js`; `kir-runtime/contracts.js`; `kir-runtime/deadline.js`; `kir-runtime/envelope.js`; `kir-runtime/execute.js`; `kir-runtime/expression.js`; `kir-runtime/inspect.js`; `kir-runtime/json.js`; `runtime-kir.js` | VERIFIED |
| Frozen downstream input | `reconstructRunnerCallCacheCompiledCoreJavaScriptPaths` reconstructs the R1 predecessor immediately before invoking the frozen frontend-projection edge, before all older transitions | VERIFIED |
| Failure behavior | Extra, missing, duplicate, absolute, backslash, dot-segment, renamed, or substituted paths fail closed | VERIFIED |

## Implementation Options

Recommended: add an immutable R1 reverse-transition owner and compose it inside `reconstructRunnerCallCacheCompiledCoreJavaScriptPaths`, immediately before the frozen frontend-projection edge. This preserves every frozen edge, keeps legacy direct callers valid, and makes the new current inventory explicit.

Rejected alternatives: editing the frozen frontend receipt would rewrite history; excluding runtime files from the live crawl would create a coverage hole; introducing a generic transition registry is unnecessary architecture for one new edge.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `scripts/kern-canonicalizer/r1-runtime-owner-historical-transition.mjs` | Add | Own and validate the exact 332-to-322 reverse edge |
| `scripts/kern-canonicalizer/r1-runtime-owner-historical-transition.test.mjs` | Add | RED/GREEN inventory, normalization, and tamper oracles |
| `scripts/kern-canonicalizer/coverage-dependencies.mjs` | Modify | Apply the new edge before the frozen frontend transition |
| `scripts/kern-canonicalizer/coverage-integrity.test.mjs` | Modify | Bind the ten current-only paths and unchanged M4.145 digest |
| Current coverage summaries/receipt assertions | Regenerate only if the repository writer reports drift | Bind current implementation and compiled digests without changing frozen history |

## Acceptance Criteria

- [x] RED at base reproduced the exact CI rejection from live 332-path input.
- [x] The transition authenticates exactly 332 / `2258d644...`, removes exactly the literal ten-path set, and authenticates 322 / `7acc8276...`.
- [x] Extra, missing, renamed, substituted, duplicate, absolute, backslash, and dot-segment inputs fail closed.
- [x] The transition rejects non-plain prototypes, `toJSON`, accessor properties without invoking their getters, symbol/non-enumerable extras, and a nested non-plain record behind an otherwise descriptor-faithful top-level candidate; both endpoint SHAs are independently pinned.
- [x] The complete historical chain still returns 305 M4.145 paths and the frozen digest remains `29daa6ca...`.
- [x] `pnpm test:kern-5-r1-runtime-owner` (22/22) and `pnpm test:kern-canonicalizer` (859/859) passed from a forced clean Core build.
- [x] Current coverage receipts are canonical and `pnpm lint`/`git diff --check` pass.

## Out of Scope

No changes to KIR runtime semantics, public APIs, frozen historical transitions, release versions, a generic transition registry, PR #557 analyzer policy, or the R2 JavaScript lowering implementation.

## Deploy Order

Update the existing R1 feature branch before merge. R2 remains stacked on the old R1 SHA and must be rebased onto the repaired R1 commit before its final push/merge; no mixed-version runtime behavior is exposed because neither branch is on `main`.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| PR #558 had many independent failures | 102 labels share one rejected 332-to-322 inventory edge | One root-cause repair, not test suppression |
| JSON serialization authenticated immutable transition identity | `JSON.stringify` admitted prototype, `toJSON`, accessor, symbol/non-enumerable, and nested-shape substitutions | Recursive descriptor-only own-data comparison rejects them without executing getters |
| Frontend tamper cases could mutate the live 332-path list directly | The frozen frontend edge owns the reconstructed 322-path predecessor | Tamper oracle now derives authenticated 322 paths before each mutation |
| Current digest sensitivity covered the runtime-owner addition | `runtime-kir.js` was absent from the per-file mutation loop | Current compiled digest now has an explicit `runtime-kir.js` witness |

## Mutation Evidence

The 10 survivors from `mutate-1787820997636-3glkz7-r1-node22-focused` are covered by focused witnesses for descriptor-tree key order/configurability/writability/null-or-primitive handling, normalized `..` rejection, caller/order preservation, and case-only membership rejection.

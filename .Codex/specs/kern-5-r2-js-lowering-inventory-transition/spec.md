# KERN 5 R2 JavaScript-Lowering Inventory Transition

**Status:** IMPLEMENTED AND VERIFIED
**Date:** 2026-08-27
**Confidence:** 0.99

## Executive Summary

R2 JavaScript lowering raises the live compiled Core inventory from 332 to 346
modules. The R1 reverse transition is deliberately frozen at 332, so direct
historical callers reject the live R2 inventory before reaching any older edge.
Add one immutable R2 reverse edge that authenticates the exact 346-path set,
removes the 14 new compiled modules, reproduces the R1 332-path identity, and
composes immediately before the frozen R1 owner inside runner-cache recovery.

## Current State / Root Cause

- **VERIFIED:** live `packages/core/dist` contains 346 JavaScript paths with
  SHA-256 path digest `03f9dedb11af11fe4b6126d34ebd3bfc0a046f940bdea5f64ec9f9e2570206af`
  (recursive Node inventory command, 2026-08-27).
- **VERIFIED:** R1 accepts exactly 332 paths with digest
  `2258d6442315b54ad81f27f387ffa0c43239e28e442d0452efe0504f6d8e9bd2`
  (`scripts/kern-canonicalizer/r1-runtime-owner-historical-transition.mjs:8-28`).
- **VERIFIED:** `reconstructRunnerCallCacheCompiledCoreJavaScriptPaths` enters
  R1 before the frozen frontend edge (`coverage-dependencies.mjs:237-239`),
  making it the compatibility boundary for legacy direct callers.
- **VERIFIED:** `a8f5e9a7c8632faed10dd301056d1260928c9026` is the R1 repair
  endpoint (`docs(kern5): record R1 CI repair evidence`) and
  `41f6c5ec5479e76b61a7401db04c5c08cc2b4394` is the R2 JavaScript-lowering
  endpoint (`feat(core): lower linked KIR to JavaScript`); their Core source
  diff adds precisely the 14 paths listed below (`git show --format=%H%n%P%n%s`
  and `git diff --diff-filter=A`, 2026-08-27).

## Contract (Verified)

> Verified against the rebased R2 head `c8f02685` on 2026-08-27.

| Behavior | Evidence | Tag |
|---|---|---|
| R2 successor inventory | 346 / `03f9dedb11af11fe4b6126d34ebd3bfc0a046f940bdea5f64ec9f9e2570206af` | live recursive inventory command | VERIFIED |
| R1 predecessor inventory | 332 / `2258d6442315b54ad81f27f387ffa0c43239e28e442d0452efe0504f6d8e9bd2` | R1 transition literal | VERIFIED |
| Added compiled paths | `compiler-kir-js-esm.js`; `compiler/kir-js-esm/contracts.js`; `emitter.js`; `index.js`; `request.js`; `target-base.js`; `target-execution.js`; `target-hash.js`; `target-json.js`; `kir-runtime/digest.js`; `kir-runtime/linked-kir-program/contracts.js`; `expression.js`; `index.js`; `link.js` | R2 endpoint add-only Core source diff | VERIFIED |
| Composition | R2 reconstructs to R1 immediately before R1/frontend recovery | runner-cache call chain | VERIFIED |
| Identity validation | Exact recursive own data-property shape/value validation, normalized paths, order preservation, and no live FS/process/Git dependency | hardened R1 owner/test pattern | VERIFIED |

## Implementation Plan

Add `r2-js-lowering-historical-transition.mjs` and a focused test using the
hardened R1 pattern. Compose the R2 reconstruction inside
`reconstructRunnerCallCacheCompiledCoreJavaScriptPaths` before R1. Rebind only
live-inventory tests to derive R2 predecessors, extend the current per-file
digest sensitivity and omitted historical membership, and use the repository
writer for current receipt drift only.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `scripts/kern-canonicalizer/r2-js-lowering-historical-transition.mjs` | Add | Immutable 346→332 owner |
| `scripts/kern-canonicalizer/r2-js-lowering-historical-transition.test.mjs` | Add | Inventory, hostile shape, endpoint, path, order, no-live-IO oracles |
| `coverage-dependencies.mjs` | Modify | Compose R2 before frozen R1 |
| direct live-inventory transition tests | Modify | Derive R2 predecessor before their frozen owner |
| `coverage-integrity.test.mjs` | Modify | Bind all R2 modules into current digest and R1+ omitted membership |
| current coverage receipts | Writer refresh only | Bind changed implementation/current Core digest |

## Acceptance Criteria

- [x] Base R2 live input is RED at the frozen R1 rejection with the exact 346 inventory: `coverage dependency rejection: R1 runtime owner historical membership requires the authenticated current inventory`.
- [x] R2 validates literal endpoints, 346 identity, exact 14 paths, and 332 R1 identity.
- [x] Hostile prototype/accessor/serialization/descriptor/key-order/null-path inputs fail closed without getter execution.
- [x] Parent traversal reports normalized-path rejection; case-only paths reach membership rejection; input and predecessor order are preserved.
- [x] All direct live callers derive the R2 predecessor while frozen R1/frontend identities remain unchanged.
- [x] Current digest sensitivity includes each new compiled R2 path and historical omitted membership includes all 14.
- [x] R2 lowering gate (14 tests), forced Core build, full canonicalizer (867 tests), lint, and final diff check pass.

## Out of Scope

No R2 lowering semantics, public compiler contract, frozen R1/frontend owner,
historical receipts, commits, pushes, or Agon runs change.

## Deploy Order

The R2 repair must land on the rebased R2 branch after R1. It is additive and
only rebases the current inventory into the frozen R1 compatibility boundary;
there is no public runtime or compiler skew change.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| R1 recovery accepts every later compiled Core inventory | R1 authenticates only its 332-path successor | R2 needs its own immutable predecessor edge, not a frozen-R1 rewrite |
| A first receipt write is terminal | Its digest binds all executed coverage sources, including the final prerequisite expectation edit | Re-run the current-only writer after all coverage source edits; final implementation digest is `027b8ea7abe4b72ffa47992e9adc8251adf692e09b0b4bb3e5e80fe870969901` |

## Verification Evidence

- Focused R2/R1/frontend transition tests: 17/17 passed.
- Historical closure and content-sensitivity test: 22/22 passed after its
  independent omitted-set RED named the exact 14 R2 paths.
- `pnpm test:kern-5-r2-js-lowering`: 14/14 passed.
- Forced Core TypeScript build: passed.
- `pnpm test:kern-canonicalizer`: 867/867 passed, then canonicalizer, CLI,
  and coverage checks passed.

## Mutation Evidence

- Focused survivors: an extra trailing own key and a final `addedPaths` value
  drift both reject from descriptor-faithful clones; `.json` and `.js.map`
  replacements reject as non-normalized JavaScript paths; an uppercase
  case-variant duplicate rejects before membership. These target the
  key-count, final-array-index, suffix, and normalized-duplicate mutants.
- Key-order and writable/configurable mutations are not separately contorted:
  they are equivalent to the existing exact own-descriptor comparator tests,
  which already reject either difference.

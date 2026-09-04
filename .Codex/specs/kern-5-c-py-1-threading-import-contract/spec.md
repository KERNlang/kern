# C-PY-1 emitted Python standard-library closure

**Status:** READY TO BUILD
**Date:** 2026-09-04
**Confidence:** 0.99

## Executive Summary

The C-PY-1 closure gate rejects the RT10-pre emitted Python because its allowlist omits `threading`, despite the generated target using `threading.RLock()` for the shared digit-conversion window. Add that standard-library module to the closure allowlist and report only offending module names when the allowlist check fails.

## Current State / Root Cause

- **VERIFIED:** `packages/core/src/compiler/kir-python/target-base.ts:1-6` emits `import threading`; `packages/core/src/compiler/kir-python/target-execution.ts:110` uses `threading.RLock()`.
- **VERIFIED:** `scripts/kern-5-c-py-1-contract/closure.test.mjs:14` omits `threading` from `STANDARD_LIBRARY`.
- **VERIFIED:** `KERN_NODE22=... pnpm --filter @kernlang/core build && node --test scripts/kern-5-c-py-1-contract/closure.test.mjs` on 2026-09-04 is RED only at `closure.test.mjs:85`, reporting `asyncio, hashlib, re, sys, threading, time`.

## What Already Works

- **VERIFIED:** The emitted import list is limited to standard-library modules; the RED is caused solely by an incomplete test allowlist.
- **VERIFIED:** The closure gate’s forbidden-emitted checks and native execution continue to run around the import assertion at `closure.test.mjs:80-90`.

## Contract (Verified)

> Verified against `target-base.ts`, `target-execution.ts`, and `closure.test.mjs` on 2026-09-04.

| Behavior | Evidence | Tag |
|---|---|---|
| Emitted Python may use `threading` for the process-wide RLock. | `target-base.ts:5`, `target-execution.ts:110` | VERIFIED |
| C-PY-1 rejects non-standard imports from `entry.py`. | `closure.test.mjs:31-32,79-90` | VERIFIED |
| The test must name only rejected imports in its failure diagnostic. | `closure.test.mjs:84-85` | VERIFIED |

## Implementation Plan

1. Derive an `unexpectedImports` list from the emitted imports.
2. Add `threading` to `STANDARD_LIBRARY` and assert that the unexpected list is empty.
3. Run the closure regression, C-PY-1 gate, RT10-pre gate, canonicalizer fixed point/prerequisite, CI contract, and independent Agon review.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `scripts/kern-5-c-py-1-contract/closure.test.mjs` | Modify | Correct the standard-library closure contract and its diagnostic. |
| Canonicalizer receipts/static pin | Regenerate if writer detects the test within its implementation closure. | Preserve receipt integrity. |

## Acceptance Criteria

- [ ] A generated `entry.py` importing `threading` passes the C-PY-1 standard-library closure gate.
- [ ] A disallowed import is reported by name without listing allowed imports.
- [ ] Native closure execution remains successful.
- [ ] Canonicalizer receipts converge after all tracked edits.

## Out of Scope

- Altering the generated RLock behavior or its imports.
- Relaxing forbidden-emitted checks beyond the Python standard library.

## Deploy Order

The generator and closure gate ship in the same repository commit; no cross-repository skew exists.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| CI-only failure implied a CI environment discrepancy. | The exact local closure command reproduces it. | Test allowlist correction is sufficient. |

# KERN 5 R2 M4.119 — checkModule Parameter Migration

**Status:** IMPLEMENTED AND VERIFIED LOCALLY; PUBLICATION PENDING
**Date:** 2026-07-29
**Confidence:** 0.96

## Summary

[VERIFIED] M4.118 publishes exactly one parameter-ready witness:
`examples/capstone-checker-subset/checker.kern#24:checkModule`, with 58 legacy
parameter rows and promoted structural rows `122/193/2411`.

[DECIDED] M4.119 consumes only that queue by replacing `checkModule`'s legacy
`params="..."` property with 58 ordered direct `param` children. Its body,
name, export status, return type, call sites, runtime/KIR policies, and
canonicalizer source remain unchanged.

## Contract

- [VERIFIED] Input queue: one function, one tool, 58 rows.
- [VERIFIED] Target ordinal: 23 (coverage id ordinal 24).
- [VERIFIED] Body digest: `175eff26d52cefeebe38af0a57b9c7b1fdce649c8e46c4c48e36ee2dbb983644`.
- [VERIFIED] Direct-parameter profile: `122/193/2411`.
- [DECIDED] Current base advances from 101/112 to 102/112.
- [DECIDED] Legacy parameter blockers fall from six to five.
- [DECIDED] The post-M4.119 parameter queue is empty; residual count remains five.
- [DECIDED] M4.115–M4.118 reconstruct and authenticate the exact pre-M4.119
  checker source rather than rewriting their receipts.

## Acceptance

- [x] RED test proves the M4.119 owner is absent.
- [x] The owner consumes the exact immutable M4.118 queue.
- [x] `checkModule` has exactly 58 ordered direct parameters and no legacy
  `params` property.
- [x] Body digest, export, return type, and call sites are unchanged.
- [x] Current coverage is 102/112 with five legacy parameter blockers.
- [x] Current prerequisite result is bounded exhaustion with an empty queue and
  five residual functions.
- [x] M4.115–M4.118 historical receipts remain byte-identical and loadable.
- [x] Checker subset passes: 48/48 fixtures byte-match the TypeScript reference
  and 36 accept-but-abstain attempts reject.
- [x] Self-host validator passes: 39/39 verdict lines byte-match the TypeScript
  reference.
- [x] Full `pnpm fitness:kern-5` wall passes, including 537/537 canonicalizer
  tests, 434/434 cross-target conformance fixtures, and 109/109 class fixtures.
- [x] Mandatory full-roster Agon review passes; verified findings are resolved
  and targeted regressions pass.
- [ ] Signed commit is fetched/rebased and pushed once to `main`.

## Out of Scope

- Migrating `rejectLine`, `quotesource`, `expressionsources`, `canonicalize`, or
  `validate`.
- Changing checker behavior, runtime budgets, profile limits, KIR limits,
  canonicalizer source, or claiming KERN 5 completion.

# KERN 5 R2 M4.113 — Depth-Enabled Parameter Migration

**Status:** READY TO BUILD
**Date:** 2026-07-29
**Confidence:** 0.95

## Executive Summary

[VERIFIED] M4.112 publishes an exact queue of nine functions, four tools, and
134 legacy parameter rows after promoting structural KIR depth to 76
(`scripts/kern-canonicalizer/coverage-m4-112-kir-depth-promotion.mjs:41`).

[DECIDED] M4.113 consumes that queue by replacing only each target function's
legacy `fn.params` string with an ordered direct-`param` prefix. It preserves
function bodies, return/export contracts, call sites, runtime limits, profile
limits, and structural KIR limits. The resulting live frontier is 101/111
base-complete functions with six legacy-parameter blockers; M4.114 owns the
next residual analysis.

## Current State / Root Cause

[VERIFIED] The current frontier is 92/111 base-complete with fifteen exact
legacy-parameter function IDs, and its prerequisite queue is the M4.112 queue
(`scripts/kern-canonicalizer/coverage-current.mjs:80`).

[VERIFIED] M4.112's queue selects nine of those fifteen IDs and authenticates
their exact profile rows and 134-row total
(`scripts/kern-canonicalizer/coverage-m4-112-kir-depth-promotion.mjs:41`).
They remained blocked until structural depth 76 was promoted because their
direct-parameter projections exceeded the previous depth-64 KIR envelope.

[VERIFIED] The migration representation is already established: remove
`fn.params`, emit the exact ordered `param` children immediately before the
handler, and reject any count/order/type drift
(`scripts/kern-canonicalizer/coverage-value-band-parameter-migrations.mjs:140`,
`scripts/kern-canonicalizer/coverage-value-band-parameter-migrations.mjs:154`).

## What Already Works

- [VERIFIED] KIR depth is already 76 and runtime depth remains 64
  (`scripts/kern-canonicalizer/coverage-current.mjs:38`).
- [VERIFIED] The M4.111 receipt already proves all nine depth-enabled
  projections; M4.113 requires no limit widening
  (`scripts/kern-canonicalizer/coverage-m4-112-kir-depth-promotion.mjs:113`).
- [VERIFIED] The canonicalizer policy already admits direct `param` nodes and
  their properties; no catalog or parser change is needed
  (`scripts/kern-canonicalizer/coverage-value-band-parameter-migrations.mjs:154`).
- [VERIFIED] Repository writers already own canonicalizer composition and
  derived coverage summaries; M4.113 extends those existing regeneration
  paths rather than adding a new generator.

## Contract (Verified)

> Verified against live source and the authenticated M4.112 queue on
> 2026-07-29.

| Behavior | Evidence | Tag |
|---|---|---|
| Consume 9 functions / 4 tools / 134 rows | `coverage-m4-112-kir-depth-promotion.mjs:41` | VERIFIED |
| `compareList` becomes 13 direct params | `examples/capstone-assertion-engine/compare.kern:31` | VERIFIED |
| `compareMap` becomes 13 direct params | `examples/capstone-assertion-engine/compare.kern:57` | VERIFIED |
| `numericBindingProven` becomes 16 direct params | `examples/capstone-checker-subset/checker-while.kern:119` | VERIFIED |
| `lengthReceiverProven` becomes 12 direct params | `examples/capstone-checker-subset/checker-while.kern:169` | VERIFIED |
| `paramCallsitesOk` becomes 23 direct params | `examples/capstone-checker-subset/checker.kern:258` | VERIFIED |
| `mapKeyToken` becomes 9 direct params | `examples/capstone-checker-subset/checker.kern:333` | VERIFIED |
| `mapKnownBefore` becomes 12 direct params | `examples/capstone-checker-subset/checker.kern:346` | VERIFIED |
| `emitstatement` becomes 15 direct params | `examples/kern-canonicalizer/canonicalizer-statement-helpers.kern:159` | VERIFIED |
| `exportkind` becomes 21 direct params | `examples/selfhost-validator/validator.kern:272` | VERIFIED |
| Function bodies and call sites remain unchanged | semantic body digest excludes only signature representation (`coverage-value-band-parameter-migrations.mjs:140`) | VERIFIED |
| Post-migration queue is empty; six legacy blockers remain | 15 current blockers minus the exact 9-target queue (`coverage-current.mjs:6`) | VERIFIED |

## Implementation Option

Use the existing direct-parameter migration pattern for all nine targets in
one atomic slice. A partial migration would contradict the authenticated queue
and create an unnecessary skew state; changing limits or bodies would be a
different milestone, so there is no genuine alternative implementation.

1. Add a RED M4.113 owner/test specifying all nine target signatures, immutable
   body digests, exact M4.112 queue consumption, and the 101/111 frontier.
2. Convert the five handwritten source files to direct parameters without
   touching handlers or call sites.
3. Regenerate canonicalizer composition and current coverage/prerequisite
   summaries; update current source/corpus identities.
4. Extend historical source/composition reconstruction so older receipts keep
   their original bytes instead of being rewritten.
5. Integrate M4.113 status and central assertions, then run targeted tests,
   the full KERN 5 wall, and high-risk independent review.

## Blast Radius

| File group | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-m4-113-parameter-migration/spec.md` | add | Claim/evidence boundary |
| Five target `.kern` sources | modify | Replace nine legacy signatures with 134 direct rows |
| `coverage-m4-113-parameter-migration.{mjs,test.mjs}` | add | Exact target and frontier oracle |
| canonicalizer composition files | regenerate | `emitstatement` source identity changed |
| `coverage-policy.json` and derived summaries | regenerate/update | Five corpus digests and live facts changed |
| `coverage-current.mjs`, prerequisite/status tests, central checker | modify | Publish the 101/111 frontier and M4.114 handoff |
| historical source/composition owners | modify | Reconstruct pre-M4.113 bytes for archived receipts |
| source identity assertions | modify | Bind current source while preserving historical receipts |

## Acceptance Criteria

- [ ] RED fails because the M4.113 owner is absent.
- [ ] The exact M4.112 nine-function/four-tool/134-row queue is consumed.
- [ ] Each target has no `fn.params` property and has the exact ordered direct
      parameter prefix followed by one handler.
- [ ] All nine semantic body digests remain unchanged.
- [ ] Return types, export flags, call sites, and generated consumer output are
      unchanged.
- [ ] Live coverage is exactly 101/111 with six exact legacy blockers.
- [ ] The next parameter queue is empty and bounded exhaustion still reports
      the same six residual functions.
- [ ] KIR policy remains depth 76; runtime and profile policies are unchanged.
- [ ] M4.110, M4.111, and M4.112 evidence remains byte-exact.
- [ ] Older composition/runtime receipts reconstruct their authenticated
      pre-M4.113 source bytes.
- [ ] Canonicalizer composition and both coverage summaries converge
      byte-identically from repository writers.
- [ ] Targeted tests, the complete KERN 5 fitness wall, and automatic high-risk
      role-lens review pass with no unresolved material finding.
- [ ] One signed commit is fetched/rebased before one push and remote `main`
      verifies identically.

## Out of Scope

- Migrating the six remaining legacy signatures.
- Widening any KIR, runtime, or profile limit.
- Changing function bodies, calls, generated fixture data, or public behavior.
- M4.114 residual analysis, KIR v1 freeze, runtime cutover, RC, stable 5.0, or
  Fable.

## Open Questions

None.

## Deploy Order

Publish source migration, regenerated composition, corpus identities, derived
summaries, and integrity assertions in one commit. There is no supported skew
window: the old sources require the M4.112 queue, while the new sources require
the M4.113 current-frontier assertions. M4.114 starts from the resulting
`origin/main`.


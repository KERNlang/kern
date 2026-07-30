# KERN 5 R2 M4.141 — Exception-Flow Promotion

**Status:** VERIFIED — READY TO PUBLISH
**Date:** 2026-07-29
**Base commit:** `6a7af982c7afdf8419d756e8c9133a7bc173d86a`
**Confidence:** 0.99

## Executive Summary

[VERIFIED] M4.138 freezes the exact `exception-flow` selection prerequisite
at digest
`2c36f8d7ec2e91cba6742241e72c79adacc917ad59e3105aabdf15f7e9e712e4`.
M4.139 implements bounded valued leaf throws in KERN-owned
`validstatement`/`emitstatement`. M4.140 freezes that implementation at digest
`c9f9d4610800ca53cdec00f5d519d6c1ebaa3e76d26734ebcc69cb3c21ff7753`.

[DECIDED] M4.141 consumes both immutable inputs and promotes only the registered
`exception-flow` facts: node kind `throw` and property `throw.value`. The live
coverage policy remains format 3; its appended promotion row cites the existing
M4.138 prerequisite, while the M4.141 central/status owner independently
requires the exact M4.140 implementation handoff before accepting the policy.

[DECIDED] The promotion removes the last active structural family instead of
inventing a fake family for `quotesource`. An empty active-family list is a
valid terminal structural-family frontier; the frozen family registry itself
remains non-empty and unchanged.

[DECIDED] M4.141 does not migrate parameters. Coverage therefore remains
109/112 with three legacy `fn.params` blockers. The promoted base exposes
exactly one parameter-ready function:
`examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize`, 15 rows.
`quotesource` remains canonical-surface-blocked and `expressionsources`
remains projection-limited.

## Root Cause

[VERIFIED] Current base profile `kern.kir-canonicalizer.profile.m4.137` omits
`throw`/`throw.value`, so the exact M4.139 implementation is not yet admitted
as cumulative coverage. The sole active `exception-flow` family completes only
the hypothetically migrated `canonicalize` function.

[VERIFIED] `validateCoverageFamilies` currently rejects an empty active-family
array even when the cumulative base has consumed every registered fact. That
prevents an honest terminal structural-family frontier and would force either
duplicate claims or a fabricated family unrelated to structural KIR facts.

## Promotion Contract

| Surface | Exact M4.141 contract | Tag |
|---|---|---|
| base id | `kern.kir-canonicalizer.profile.m4.141` | DECIDED |
| base node kinds | append sorted `throw` | DECIDED |
| base property keys | append sorted `throw.value` | DECIDED |
| base expression kinds | unchanged | DECIDED |
| promotion family | `exception-flow` | DECIDED |
| promotion prerequisite | exact M4.138 digest | DECIDED |
| implementation authorization | exact M4.140 digest | DECIDED |
| active families | `[]` | DECIDED |
| family registry | unchanged and non-empty | DECIDED |
| policy format | remain `kern.kir-canonicalizer.coverage-policy.3` | DECIDED |
| coverage completion | remain 109/112 | DECIDED |
| parameter-ready queue | one `canonicalize` function / 15 rows | DECIDED |
| residual frontier | `quotesource`, `expressionsources` | DECIDED |
| KERN source/composition | unchanged | DECIDED |
| KIR/runtime/ABI/limits | unchanged | DECIDED |

The appended promotion row is:

```json
{
  "family": "exception-flow",
  "provenanceDigest": "2c36f8d7ec2e91cba6742241e72c79adacc917ad59e3105aabdf15f7e9e712e4",
  "provenanceKind": "prerequisite"
}
```

The policy row alone does not claim implementation authorization. The M4.141
central owner must load and validate the exact M4.140 record, assert its family
and digest, and only then accept the promoted policy.

## Alternatives

### A — Promote with dual central evidence and an empty active frontier
(selected)

This preserves policy format 3, uses its existing prerequisite semantics, and
keeps implementation authorization independently fail-closed through M4.140.

### B — Invent a `quotesource` family (rejected)

Coverage families own structural node, expression, and property facts.
`quotesource` is blocked by canonical text-surface characters, so representing
it as a family would falsify the registry model.

### C — Add M4.140 fields to every promotion row (rejected)

Earlier promotions have no implementation-handoff artifact. Widening the
policy schema and rewriting every historical row would create unrelated
migration risk without strengthening the exact M4.141 central proof.

### D — Promote and migrate `canonicalize` together (rejected)

The release train separates profile promotion from parameter-queue
consumption. Combining them would erase the measurable M4.141 handoff and
widen rollback scope.

## Implementation Plan

1. Add RED policy, central, status, and empty-family terminal-frontier tests.
2. Permit an empty active-family array while keeping the registry non-empty and
   retaining closed-world checks for all observed facts.
3. Promote only `throw`/`throw.value`, append the exact M4.138 row, and remove
   `exception-flow` from active families.
4. Add M4.141 central/status owners that require exact M4.138 and M4.140
   evidence and publish the one-function/15-row M4.142 queue.
5. Wire the current frontier/checker, regenerate authenticated summaries, then
   run focused, canonicalizer, full fitness, and six-engine review gates.

## Expected File Surface

| File/group | Action | Reason |
|---|---|---|
| this spec | add/seal | promotion claim/evidence boundary |
| coverage policy | modify | promote exact exception-flow facts |
| coverage-family validator/tests | modify | admit terminal empty active set |
| M4.141 central/status/tests | add | dual-evidence release owner |
| current frontier/checker | modify | make M4.141 release-blocking |
| current promotion/prerequisite tests | update | bind new exact live policy |
| live coverage summaries | regenerate | authenticate promoted state |
| M4.138/M4.140 artifacts | unchanged | immutable inputs |
| family registry | unchanged | no invented family |
| KERN source/composition | unchanged | implementation already published |

## Acceptance Criteria

- [x] RED fails at the M4.140 base for the intended missing-promotion reason.
- [x] Policy base id is exactly M4.141.
- [x] Only `throw` and `throw.value` enter the cumulative base.
- [x] Last promotion row cites exact M4.138 prerequisite evidence.
- [x] M4.141 central/status validation consumes exact M4.140 implementation
      evidence before accepting promotion.
- [x] Active families become exactly empty; the family registry remains exact.
- [x] Empty active families produce deterministic bounded-exhaustion evidence
      with zero evaluated non-empty closures.
- [x] Coverage remains 109/112 with three legacy parameter blockers.
- [x] Parameter migration exposes only `canonicalize`, exactly 15 rows.
- [x] Residual frontier remains exactly `quotesource` and
      `expressionsources`.
- [x] KERN source, composition, expression profile, limits, KIR, runtime, ABI,
      and package APIs remain unchanged.
- [x] Focused and complete canonicalizer gates pass.
- [x] The full KERN 5 wall exercises every gate; all unrelated gates pass, and
      the settled post-review canonicalizer gate passes independently.
- [x] Six-engine Agon review has no unresolved material finding.
- [x] Publication requires a signed commit, fetch/rebase immediately before the
      single push, and exact remote-main SHA verification.

## Verification Evidence

- [VERIFIED] The policy checker passes at 109/112 with exactly three
  `fn.params` blockers, one `canonicalize` queue entry, 15 parameter rows, and
  no active structural families.
- [VERIFIED] The final coverage implementation digest is
  `507bae018e1494fe645b5ef762fc6eccf58e02dbbe81e9345f25cc7decb3533e`;
  the policy digest is
  `2091c8c213efd5b006bc22f183f47bd7a651ec21779efe66b1670b1019fbaaf0`.
- [VERIFIED] The checked-in coverage and prerequisite summaries hash to
  `94e38e557c4caaaad5473b2c56cf16e6db43632445e8e7a88dc2fc6392274437`
  and
  `0a6e3a1fda2b4e1e201fbdbc768ca8cb820fd430932f90296ce3019c24a9aa01`.
- [VERIFIED] The complete canonicalizer gate passes 652/652 unit tests, 58
  golden/KIR tests, 8 measured tests, 3 profile-limit tests, the 250-case
  hostile corpus, and the coverage checker. The focused evidence/status suite
  passes 11/11 after the final helper extraction and summary regeneration.
- [VERIFIED] Repository lint checks 1,328 files without findings, and
  `git diff --check` passes.
- [VERIFIED] The full fitness wall cleared all unrelated repository, package,
  KIR, runtime, source-convergence, conformance, native, browser, release, and
  drift gates. Its duplicate final canonicalizer invocation observed coherent
  concurrent source changes; the settled complete canonicalizer rerun above
  is green.
- [VERIFIED] High-risk role-lens review
  `review-1785389793478-wjk09b` used all six usable independent engines. Its
  authenticated-evidence blocker was reproduced with RED tests and fixed by
  binding exact function facts, base shape, tool evidence, and plain-array
  structure. No material finding remains unresolved.

## Stop Conditions

- M4.138 or M4.140 immutable evidence differs from the published inputs.
- Promoting exception flow requires any KERN source or runtime semantic change.
- The empty-family frontier leaves an observed unclaimed structural fact.
- More than `canonicalize` becomes parameter-ready.
- `quotesource` or `expressionsources` loses its exact blocker.
- Any local wall or independent review blocker remains unresolved.

## Out of Scope

- Migrating `canonicalize`.
- Rewriting or migrating `quotesource`.
- Increasing projection limits for `expressionsources`.
- Adding bare throw, catch/finally, exception binding, or runtime semantics.
- Changing the family registry, policy format, KIR, handler ABI, or runtime
  limits.
- KIR v1 freeze, public cutover, RC/stable release, Fable, or KERN 5
  completion.

## Release Boundary

[DECIDED] M4.141 publishes the exact exception-flow promotion and the resulting
one-function/15-row parameter queue. M4.142 may migrate only that immutable
`canonicalize` queue. The remaining canonical-surface and projection blockers
continue in later focused slices.

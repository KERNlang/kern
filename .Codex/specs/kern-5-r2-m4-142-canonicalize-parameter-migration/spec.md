# KERN 5 R2 M4.142 — Canonicalize Parameter Migration

**Status:** VERIFIED — READY TO PUBLISH
**Date:** 2026-07-30
**Base commit:** `02ef5b629575c51cb2bc49b4921933df322c255f`
**Confidence:** 0.99

## Executive Summary

[VERIFIED] M4.141 promotes the final active structural family and publishes one
exact parameter-ready witness:
`examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize`, 15 rows,
profile rows 100/159/2556. The published policy digest is
`2091c8c213efd5b006bc22f183f47bd7a651ec21779efe66b1670b1019fbaaf0`;
the authenticated implementation digest is
`507bae018e1494fe645b5ef762fc6eccf58e02dbbe81e9345f25cc7decb3533e`.

[DECIDED] M4.142 consumes only that queue by replacing the legacy quoted
`fn.params` property on `canonicalize` with 15 direct canonical `param`
children. The function body, name, return type, export flag, profile limits,
KIR limits, runtime limits, ABI, and structural coverage base remain unchanged.

[DECIDED] The direct parameters would grow the 499-line handwritten main
member to 514 lines. To preserve the repository's source-size invariant,
M4.142 also relocates the exact trailing `nodetablesok`, `propertyfacts`, and
`valuefacts` definitions into the existing statement-helper member. Their
source bytes, names, signatures, and bodies remain exact. Composition retains
the same three members and concatenation recipe, while its authenticated member
metadata and composite digest advance.

[DECIDED] Live cumulative coverage advances from 109/112 to 110/112. Legacy
parameter blockers fall from three to two. The live parameter queue becomes
empty; the two residual functions remain `quotesource` and
`expressionsources`. M4.143 owns the next bounded residual measurement.

## Root Cause

[VERIFIED] `canonicalize` is structurally complete under the M4.141 base but
remains excluded solely by `fn.params`. Its legacy signature is:

```text
nodeKind:string[],nodeParent:number[],nodeOrder:number[],
propNode:number[],propKey:string[],propValue:number[],
valueTag:string[],valueParent:number[],valueRole:string[],
valueOrder:number[],valueText:string[],valueBool:number[],
maxNodeRows:number,maxPropertyRows:number,maxValueRows:number
```

[VERIFIED] The semantic body digest with `fn.params` excluded is
`121b336b4f863035917440eed2ccd6fc3e4761e3ed632aa53b7e8d1471b43f12`.
The function is ordinal 5, returns `string[]`, and is exported.

[VERIFIED] `canonicalizer.kern` is an authenticated corpus member. Changing its
signature changes both its corpus digest and the live coverage-policy digest.
Historical M4.141 verification therefore requires exact reconstruction of the
pre-M4.142 source and policy, plus frozen M4.141 summary inputs; otherwise a
live-source migration would silently rewrite earlier milestone evidence.

[VERIFIED] The three helpers follow `canonicalize` in the pre-M4.142 main
member and are dependency-compatible with the existing statement-helper
member. Moving that exact suffix keeps both handwritten members below 500
lines without changing the `canonicalize` ordinal or target identity.

## Migration Contract

| Surface | Exact M4.142 contract | Tag |
|---|---|---|
| input milestone | exact M4.141 queue from commit `02ef5b62` | DECIDED |
| target | `canonicalizer.kern#5:canonicalize` only | DECIDED |
| parameter representation | 15 direct `param` children | DECIDED |
| parameter order/types | byte-for-byte semantic equivalent of legacy list | DECIDED |
| legacy `fn.params` | removed from `canonicalize` | DECIDED |
| body digest | remain `121b336…` | DECIDED |
| function identity | name/ordinal/returns/export unchanged | DECIDED |
| live coverage | 110/112 | DECIDED |
| legacy blockers | 2 | DECIDED |
| post-migration queue | 0 functions / 0 rows | DECIDED |
| residual frontier | `quotesource`, `expressionsources` | DECIDED |
| bounded member split | move exact three-helper suffix to statement helpers | DECIDED |
| handwritten member sizes | main 381; statement helpers 374 | DECIDED |
| composition topology | same three members and recipe | DECIDED |
| structural base id | remain `kern.kir-canonicalizer.profile.m4.141` | DECIDED |
| active families | remain `[]` | DECIDED |
| KIR/profile/runtime/ABI | unchanged | DECIDED |
| next owner | M4.143 residual measurement | DECIDED |

The exact direct parameter sequence is:

1. `nodeKind:string[]`
2. `nodeParent:number[]`
3. `nodeOrder:number[]`
4. `propNode:number[]`
5. `propKey:string[]`
6. `propValue:number[]`
7. `valueTag:string[]`
8. `valueParent:number[]`
9. `valueRole:string[]`
10. `valueOrder:number[]`
11. `valueText:string[]`
12. `valueBool:number[]`
13. `maxNodeRows:number`
14. `maxPropertyRows:number`
15. `maxValueRows:number`

## Alternatives

### A — Direct-parameter migration with frozen M4.141 reconstruction (selected)

This follows the established M4.131 queue-consumption pattern while preserving
the stronger immutable evidence introduced in M4.141.

### B — Change only the KERN source and update live digests (rejected)

That would make historical M4.141 checks accidentally evaluate M4.142 bytes or
fail without explaining the milestone boundary.

### C — Change the structural base id to M4.142 (rejected)

Parameter representation is not a structural-family promotion. Renaming the
base would imply a coverage-fact change that did not occur.

### D — Migrate either residual function in the same slice (rejected)

Neither residual function is in the M4.141 queue. `quotesource` is
canonical-surface-blocked and `expressionsources` is projection-limited.

### E — Leave the migrated main member at 514 lines (rejected)

That would violate the inherited handwritten-source size invariant. The exact
trailing helper-suffix relocation is the narrowest split that preserves the
M4.141 `canonicalize` path and ordinal.

## Implementation Plan

1. Add RED M4.142 target/status tests against the still-legacy source.
2. Relocate the exact trailing table-fact helper suffix into the existing
   statement member, then add exact pre-M4.142 source/policy/layout
   reconstruction and freeze the M4.141 coverage/prerequisite summaries used
   by the promotion proof.
3. Replace only the `canonicalize` legacy signature with the 15 direct
   parameters and update its authenticated corpus digest.
4. Add M4.142 migration/status owners, advance the current checker/frontier,
   and update current-state assertions without rewriting historical claims.
5. Regenerate live summaries and run focused, canonicalizer, full-fitness, and
   independent high-risk review gates before publication.

## Expected File Surface

| File/group | Action | Reason |
|---|---|---|
| this spec | add/seal | migration claim/evidence boundary |
| `canonicalizer.kern` | modify | migrate the exact 15-row signature |
| statement helpers | modify | bounded exact helper-suffix relocation |
| composition output/record | regenerate | authenticate the unchanged recipe |
| coverage policy | modify member digests only | authenticate new corpus bytes |
| M4.142 owner/status/tests | add | exact queue consumption and live state |
| historical source loader/tests | modify | reconstruct immutable M4.141 inputs |
| frozen M4.141 summaries | add | retain exact promotion proof |
| M4.141 status/tests | modify | validate historical, not live M4.142 bytes |
| current frontier/checker/tests | modify | make M4.142 release-blocking |
| live coverage summaries | regenerate | authenticate post-migration state |
| composition/KIR/runtime/ABI | unchanged | out of scope |

## Acceptance Criteria

- [x] RED fails because `canonicalize` still uses legacy `fn.params`.
- [x] M4.141 input queue is exactly one function / 15 rows.
- [x] Only `canonicalize` changes parameter representation.
- [x] The exact `nodetablesok`/`propertyfacts`/`valuefacts` suffix relocates
      without signature or body drift.
- [x] Both handwritten destination members remain below 500 lines.
- [x] All 15 direct parameters preserve exact order, names, and types.
- [x] Name, ordinal, return type, export flag, and semantic body digest remain
      exact.
- [x] Pre-M4.142 source and policy reconstruct to the published M4.141 digests.
- [x] Frozen M4.141 coverage and prerequisite summaries remain independently
      valid.
- [x] Live coverage advances to 110/112 with exactly two legacy blockers.
- [x] Live parameter queue becomes exactly empty.
- [x] Residual frontier remains exactly `quotesource` and
      `expressionsources`.
- [x] Structural base, active families, composition topology, limits, KIR,
      runtime, ABI, and public package APIs remain unchanged.
- [x] Focused and complete canonicalizer gates pass.
- [x] Full KERN 5 fitness wall passes.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main verifies.

## Stop Conditions

- The M4.141 queue, policy, source, or summary digests cannot be reconstructed
  exactly.
- Direct parameters change the parsed handler or semantic body digest.
- Any function besides `canonicalize` changes representation or coverage state.
- The helper relocation changes any helper signature/body or the composition
  member set/recipe.
- Either residual blocker changes unexpectedly.
- Any KIR/profile/runtime/ABI limit must change.
- Any local gate or independent review blocker remains unresolved.

## Out of Scope

- Structural-family or profile promotion.
- Migrating `quotesource` or `expressionsources`.
- Canonical text-surface remediation or projection-limit work.
- Changing canonicalizer behavior, composition topology, exception semantics,
  KIR, runtime, handler ABI, or limits.
- Public cutover, release candidate, stable KERN 5, Fable, or declaring KERN 5
  complete.

## Release Boundary

[DECIDED] M4.142 ends when the exact M4.141 `canonicalize` queue is consumed,
live coverage is 110/112 with an empty queue, and immutable M4.141 evidence
still reconstructs exactly. M4.143 may only remeasure the resulting two-function
bounded residual frontier.

## Verification Evidence

[VERIFIED] The final live coverage summary authenticates:

- canonicalizer composite:
  `9e7ecb330e665b7bf2a0d7e13d78f4cf3c0b9e5b27a799bdafbabd0e18ca770a`;
- composition record:
  `3093e49e5c543d874a30bf501cb364e192d3dcb17fdad010204997b71ea99726`;
- coverage policy:
  `3512347baf3870f21b879b632041eea72ffea304e037f0a26fcf720cbe596877`;
- coverage implementation:
  `7f7d25c5dc4ff389789ab72af5a7831ff180bacb354d1f648db19d189a295e24`;
- cumulative frontier: 110/112, two `fn.params` blockers, empty parameter
  queue, and no ranked widening candidate.

[VERIFIED] The pre-M4.142 reconstruction reproduces the exact M4.141 main,
statement-helper, composition, policy, coverage, and prerequisite evidence.
The M4.141 implementation digest
`507bae018e1494fe645b5ef762fc6eccf58e02dbbe81e9345f25cc7decb3533e`
is independently pinned and checked against both frozen summaries.

[VERIFIED] Focused historical, migration, status, and immutability regressions
pass; the exact coverage checker, lint, diff check, complete canonicalizer
lane, and `fitness:kern-5` wall pass. Handwritten member sizes are 401
expression-helper lines, 374 statement-helper lines, and 381 main lines.

[VERIFIED] Agon review
`review-1785395993875-ba76ms` ran at high risk with `codex` declared as the
primary implementer and automatic role lenses across all six usable engines.
All 6/6 completed successfully. The earlier unattributed review found the
M4.141 digest self-authentication blocker and shallow target immutability;
both were fixed with failing-first regressions before this final role review.

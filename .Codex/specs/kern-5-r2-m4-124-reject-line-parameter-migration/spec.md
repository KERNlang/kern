# KERN 5 R2 M4.124 — rejectLine Parameter Migration

**Status:** IMPLEMENTED AND VERIFIED
**Date:** 2026-07-29
**Confidence:** 0.97

## Executive Summary

[VERIFIED] Published M4.123 commit
`0c3f3cc02dc2cc92994cfae7977b467d8a3800ea` promotes structural KIR
`maxDepth` to 77 and publishes exactly one parameter-ready function:
`examples/capstone-checker-subset/checker.kern#2:rejectLine`.

[DECIDED] M4.124 consumes only that immutable one-function/five-row queue.
It replaces the legacy `params` property with five direct `param` children
while preserving export visibility, return type, body semantics, callers,
runtime ABI, structural policy, profile policy, and cumulative promotion
history.

[DECIDED] After migration, current coverage advances from 102/112 to 103/112,
legacy parameter blockers fall from five to four, and no parameter-ready
function remains. M4.125 owns the next residual analysis.

## Contract

| Behavior | Tag |
|---|---|
| Consume exact M4.123 receipt queue | VERIFIED |
| Migrate only `checker.kern#2:rejectLine` | VERIFIED |
| Direct parameters are path/line/col/code/detail in authored order | VERIFIED |
| Body digest remains `7b2f5559…1938` | VERIFIED |
| Function remains exported and returns string | VERIFIED |
| Current base becomes 103/112 | VERIFIED |
| Remaining legacy parameter population is exactly four functions | VERIFIED |
| Post-migration parameter queue is empty | VERIFIED |
| Runtime/KIR/profile policy remains unchanged | VERIFIED |
| M4.125 receives the four-function bounded residual frontier | VERIFIED |

## Exact Migration Target

```json
{
  "id": "examples/capstone-checker-subset/checker.kern#2:rejectLine",
  "functionOrdinal": 1,
  "parameters": [
    ["path", "string"],
    ["line", "number"],
    ["col", "number"],
    ["code", "string"],
    ["detail", "string"]
  ],
  "profileRows": {
    "nodes": 8,
    "properties": 15,
    "values": 106
  }
}
```

## Implementation

1. Add a RED M4.124 test importing the absent migration owner.
2. Add an exact target guard that binds M4.123 provenance, function identity,
   direct parameter order/types, body digest, and post-migration coverage fact.
3. Replace only the `rejectLine` legacy `params` property with five direct
   parameter children.
4. Keep the generated checker consumer byte-reproducible and decouple M4.119
   from whole-file checksum churn caused by later independent migrations.
5. Advance current frontier/status assertions and regenerate authenticated
   summaries twice.
6. Run focused tests, complete canonicalizer and KERN 5 gates, high-risk
   role-lens review, signed commit, fetch/rebase, and one push.

## Acceptance Criteria

- [x] RED fails because the M4.124 migration owner is absent.
- [x] Exact M4.123 queue is consumed without mutation.
- [x] Only `rejectLine` changes from legacy to direct parameters.
- [x] Direct parameter names, types, and order are exact.
- [x] Export, return type, and semantic body digest remain exact.
- [x] Current coverage is exactly 103/112.
- [x] Legacy parameter blockers are exactly four.
- [x] Current parameter-ready queue is empty.
- [x] Remaining residual reason assignments are unchanged and authenticated.
- [x] Generated checker consumer is byte-reproducible from the repository writer.
- [x] No policy, runtime ABI, profile, or cumulative promotion changes.
- [x] Derived summaries converge byte-identically.
- [x] Focused, canonicalizer, and full KERN 5 gates pass.
- [x] High-risk automatic role-lens review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main verifies.

## Stop Conditions

- M4.123 queue identity, rows, tool, or witness count differs.
- The migration changes `rejectLine` body semantics or any caller.
- Another function, policy field, runtime ABI, or cumulative promotion must
  change to admit the target.
- The post-migration frontier is not exactly four legacy blockers with an
  empty parameter-ready queue.

## Out of Scope

- Resolving `quotesource`, unsupported expression kinds, or validator limits.
- Widening structural KIR, runtime, or profile limits.
- M4.125 residual analysis.
- KIR v1 freeze, runtime cutover, RC/stable release, Fable, or KERN 5
  completion.

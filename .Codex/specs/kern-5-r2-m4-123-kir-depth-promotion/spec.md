# KERN 5 R2 M4.123 — Structural KIR Depth Promotion

**Status:** VERIFIED; READY TO PUBLISH
**Date:** 2026-07-29
**Confidence:** 0.96

## Executive Summary

[VERIFIED] Published M4.122 commit
`085d6891b1280dbe42e2ffd6a744c1bd442c14d3` authenticates the sole M4.121
projection candidate: raise structural KIR `maxDepth` from 76 to 77 for
`examples/capstone-checker-subset/checker.kern#2:rejectLine`.

[VERIFIED] The canonical M4.122 receipt digest is
`e9b5e413a81d5c2992cd31eb705728608407e934d0f7c5c3d765865e65ad290e`.
Depth 76 fails, depth 77 produces exact rows `8/15/106`, runtime floor 1,007
succeeds, floor 1,006 fails, public/internal results agree, byte-exact
round-trip succeeds, and promotion-budget headroom is 48,145.

[DECIDED] M4.123 changes only live structural KIR `kirLimits.maxDepth` from
76 to 77. Runtime depth remains 64, all other KIR and profile limits remain
unchanged, and no KERN parameter signature is migrated.

[DECIDED] M4.123 publishes the exact one-function/five-row `rejectLine` queue
for M4.124. M4.123 does not claim that queue as consumed.

## Contract

| Behavior | Tag |
|---|---|
| Live structural KIR maxDepth becomes exactly 77 | DECIDED |
| Other structural KIR limits remain byte-for-byte unchanged | DECIDED |
| Runtime limits remain byte-for-byte unchanged, including maxDepth 64 | DECIDED |
| Profile remains exactly 122/193/2411 | VERIFIED |
| M4.121 and M4.122 remain immutable historical depth-76 evidence | DECIDED |
| M4.122 compiled-core and receipt digests remain exact | DECIDED |
| M4.124 queue contains only rejectLine with five rows | DECIDED |
| No KERN source or generated application artifact changes | DECIDED |

## Implementation

1. Add a RED M4.123 test that imports the absent promotion owner.
2. Add a dedicated promotion owner that consumes the exact M4.121 selection
   and M4.122 GO, validates the live policy, and publishes a cloned M4.124
   queue.
3. Change only `policy.json` structural `kirLimits.maxDepth` from 76 to 77.
4. Make M4.121/M4.122 reproduction explicitly historical at depth 76 while
   current-policy checks require depth 77.
5. Add dedicated M4.123 status/integrity modules and append them through the
   existing M4.122 central owner so oversized central files do not grow.
6. Regenerate both authenticated summaries twice, run focused and full Node
   22 gates, complete high-risk review, sign, fetch/rebase, and push once.

## Exact M4.124 Queue

[DECIDED]

```json
{
  "completeFunctions": 1,
  "completeTools": 1,
  "migratedParameterRows": 5,
  "witnesses": [
    {
      "id": "examples/capstone-checker-subset/checker.kern#2:rejectLine",
      "parameterRows": 5,
      "profileRows": {
        "nodes": 8,
        "properties": 15,
        "values": 106
      },
      "tool": "checker"
    }
  ]
}
```

## Blast Radius

| Area | Action |
|---|---|
| M4.123 spec | Add claim/evidence boundary |
| `policy.json` | Change only structural maxDepth 76 to 77 |
| M4.123 promotion/status/test owners | Add exact promotion and queue contract |
| M4.122 central owner | Append successor assertion/status |
| M4.121/M4.122 analysis and headroom owners | Preserve historical depth-76 reproduction |
| Current-policy and later historical evidence owners | Distinguish live depth 77 from archived depth 76 |
| Generated coverage summaries | Refresh implementation identity |

## Acceptance Criteria

- [x] RED fails because the M4.123 promotion owner is absent.
- [x] Live KIR limits are exactly 262144/77/4096.
- [x] All non-depth KIR fields are unchanged.
- [x] Runtime limits remain exact, including depth 64 and collection 65536.
- [x] Profile limits remain exactly 122/193/2411.
- [x] M4.122 receipt bytes and digest remain unchanged.
- [x] M4.121/M4.122 historical measurements reproduce their published bytes.
- [x] M4.124 queue is exactly one checker function and five parameter rows.
- [x] Queue copies cannot mutate the published handoff.
- [x] No KERN source, generated tool, runtime ABI, or cumulative base changes.
- [x] Derived summaries converge byte-identically.
- [x] Full KERN 5 fitness gate passes; focused and complete canonicalizer gates pass.
- [x] High-risk automatic role-lens review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main verifies.

## Stop Conditions

- M4.122 receipt digest, GO, witness, floor, parity, or headroom differs.
- Promotion requires changing another KIR axis, runtime/profile policy, KERN
  source, runtime ABI, or cumulative base.
- Historical M4.121/M4.122 evidence cannot reproduce under explicit depth-76
  reconstruction.

## Out of Scope

- Migrating `rejectLine`; M4.124 owns that.
- Resolving `quotesource`, unsupported expressions, or validator limits.
- Changing runtime depth or iteration budgets.
- KIR v1 freeze, runtime cutover, RC/stable release, Fable, or KERN 5
  completion.

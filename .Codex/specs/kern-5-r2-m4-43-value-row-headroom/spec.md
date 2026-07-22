# KERN 5 R2 M4.43 Value-Row Runtime Headroom

**Status:** READY TO SHIP
**Date:** 2026-07-22
**Confidence:** 0.99

## Executive Summary

[VERIFIED] M4.42 selected a 16/30/388 profile candidate completing
`checkerSafeIntText` and `validbinaryop`, but that recommendation was explicitly
performance-gated. Exact Node 22 execution now proves the 161-row witness fits
the unchanged 65,536 production runtime ceiling at a 38,978 floor, while the
388-row witness requires 237,982 iterations and therefore fails production.
Evidence: `node /tmp/kern-m443-probe.mjs` on 2026-07-22 printed the exact two
floors and the production-ceiling outcomes.

[VERIFIED] M4.43 removes the quadratic recursive value-table scans inside
`exprsource` with one bottom-up indexed pass. Exact Node 22.22 measurements now
place the 161-row witness at 6,533 iterations, the 388-row witness at 10,614,
and the existing 154-row witness at 7,360. The selected 388-row witness uses
only 21.6% of the precommitted 49,152 promotion budget and round-trips
byte-identically. The active 16/30/154 profile remains unchanged; a later
fresh slice may promote 388 only from this authenticated boundary.

## Current State / Root Cause

[VERIFIED] The selected witnesses and row shapes are fixed by
`scripts/kern-canonicalizer/coverage-residual-analysis-m4-42.json`: 14/20/161
for `checkerSafeIntText` and 12/15/388 for `validbinaryop`. The selected action
changes only `maxValueRows` from 154 to 388 and completes two functions across
two tools.

[VERIFIED] Production owns an unchanged 65,536 collection/iteration ceiling at
`scripts/kern-canonicalizer/policy.json:18-24`. The existing 154-row promoted
witness proves a 34,700 exact floor and success at a 40,000 budget in
`scripts/kern-canonicalizer/tables-ok-performance.test.mjs:201-231`.

[VERIFIED] Before M4.43, `exprsource` recursively visited binary, unary, member,
index, call, and list descendants. Every recursive level called
`valuechildcount`, `valuechildat`, or `recordfield`, whose implementations scan
the complete `valueParent` table at
`examples/kern-canonicalizer/canonicalizer-expression-helpers.kern:154-191`.
The 388-row nested binary witness therefore repeated whole-table scans and had
an exact measured floor of 237,982 before this slice. The replacement builds
collision-safe parent/order and parent/role indexes once, traverses the value
table in reverse id order, and records each projected expression exactly once.

[VERIFIED] The failure is not the table validator or direct indexed lookup:
M4.39 already uses collision-safe Maps for table invariants at
`examples/kern-canonicalizer/canonicalizer.kern:195-315`, and M4.40 made
`stringat`/`numberat` strict indexed operations at
`examples/kern-canonicalizer/canonicalizer-expression-helpers.kern:103-113`.

## What Already Works

- [VERIFIED] All M4.42 release and review gates passed at commit `fa762508`.
- [VERIFIED] The 161-row witness already has 26,558 iterations of production
  headroom; it needs no special-case optimization.
- [VERIFIED] Table validation, one-based scalar lookup, KERN source ownership,
  hostile fixture semantics, runtime ceiling, KIR, ABI, and public APIs need no
  widening.
- [DECIDED] Historical M4.31, M4.38, and M4.42 receipt bytes remain immutable.

## Contract (Verified)

> Verified against the cited source and exact Node 22 probe on 2026-07-22.

| Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Current profile | exactly 16/30/154 | `policy.json:26-30` | VERIFIED |
| Production ceiling | exactly 65,536 | `policy.json:18-24` | VERIFIED |
| Promotion budget | floor at or below 49,152, exactly 75% of production | safety decision derived from current policy | DECIDED |
| Selected large witness | migrated `validbinaryop`, exactly 12/15/388 | M4.42 receipt assignment | VERIFIED |
| Baseline floor | 237,982 and failure at 65,536 | RED diagnostic probe output | VERIFIED |
| Optimized floor | 10,614, 38,538 below the 49,152 budget | exact checked-in performance oracle | VERIFIED |
| Algorithm | one bottom-up pass with collision-safe parent/order and parent/role Maps | existing Map semantics in `tablesok` | DECIDED |
| Function identity | retain all 104 exact `path#ordinal:name` ids and signatures | `coverage-implementation.mjs:346-360` | VERIFIED |
| Semantics | byte-identical canonical output and identical hostile rejection | current canonicalizer fixtures | DECIDED |
| Authority | optimization proof only; no profile promotion or migration | this slice boundary | DECIDED |

## Implementation Options

### A. Bottom-up indexed `exprsource` (recommended)

Build collision-safe Maps exactly once per `exprsource` call from the already
validated `valueParent`, `valueOrder`, and length-framed `valueRole` rows.
Traverse value ids in reverse canonical order so every child expression is
available before its parent, and store successful source projections by value
id. The bottom-up loop must not call `valuechildcount`, `valuechildat`, or
`recordfield`; all child count/order/role access comes from the prebuilt Maps.
Preserve the existing `exprsource` signature, function ordinal, and output
contract.

The 49,152 gate is deliberately not claimed as an empirical floor. It is the
precommitted safety boundary of 75% of the current policy-owned 65,536 ceiling,
retaining at least 25% runtime headroom. Exact post-change floor measurement is
recorded separately and must be at or below that fixed boundary.

Pros: removes the measured quadratic path; keeps 104 functions and every
caller contract stable; reuses runtime-owned Maps already proved in M4.39.
Cons: rewrites a semantically dense function and requires exhaustive parity
and malformed-table checks.

### B. Raise the production runtime ceiling

Rejected. The measured requirement is 3.63 times the current ceiling and would
weaken the bounded-runtime contract without removing the quadratic algorithm.

### C. Skip the selected candidate and promote only 161 rows

Deferred, not selected for M4.43. It would ship one function while leaving the
known quadratic expression traversal in the critical path. If option A cannot
meet the 49,152 budget without changing semantics, M4.43 publishes a no-go and
the next analysis may rank feasible smaller candidates.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | frozen performance and no-promotion contract |
| `canonicalizer.kern` | modify | replace recursive whole-table expression projection |
| composed canonicalizer + composition metadata | regenerate | exact executable bytes |
| canonicalizer structural/parity tests | modify | bind algorithm and unchanged semantics |
| performance test | modify | RED at 388 rows, exact budget, roundtrip proof |
| M4.42 provenance/check wiring | add/modify | freeze published receipt before live implementation moves |
| coverage/prerequisite summaries | regenerate | authenticate changed implementation at unchanged profile |
| release train | modify after gates | durable M4.43 evidence |

## Acceptance Criteria

- [x] Fresh branch starts exactly at published M4.42 commit `fa762508`.
- [x] RED proves migrated `validbinaryop` fails the 49,152 promotion budget on
      the M4.42 implementation for the runtime-budget reason.
- [x] Existing `exprsource` name, ordinal, signature, and 104-function corpus
      population remain unchanged.
- [x] The replacement uses one bounded bottom-up value-table traversal and no
      recursive `exprsource` call or per-expression whole-table scan.
- [x] Collision-safe indexes reject duplicate order/role identities and cannot
      collide through delimiters, Unicode, or numeric-looking role text.
- [x] Targeted deep-binary and wide-call/list fixtures prove reverse-order
      child availability and prevent a narrow-witness optimization.
- [x] The exact 12/15/388 witness succeeds at its 10,614 measured floor, fails
      at 10,613, and byte-roundtrips to the migrated source.
- [x] The exact 14/20/161 witness and existing 15/24/154 witness retain
      byte-identical output and remain within their authenticated budgets.
- [x] All existing golden, idempotence, KIR, profile-limit, hostile, and
      historical receipt tests pass.
- [x] M4.31, M4.38, and M4.42 receipt bytes remain exact immutable history.
- [x] Active profile remains exactly 16/30/154; no KERN source migration,
      family, parser, KIR, runtime, ABI, generated consumer, or public API
      widening occurs.
- [x] Complete Node 22.22 `pnpm fitness:kern-5` passes on the final reviewed
      diff.
- [x] Automatic role-lens review has no unresolved material finding.
- [ ] Signed Agon commit is fetched/rebased before one atomic no-verify push to
      the fresh feature ref and authorized `main`; both refs are verified.

## Out of Scope

- Promoting `maxValueRows` to 388.
- Migrating `checkerSafeIntText` or `validbinaryop` parameters.
- Raising runtime/KIR limits.
- Adding or removing canonicalizer functions.
- Claiming KERN 5 completion.

## Open Questions

[DECIDED] No unresolved dependency blocks implementation. The performance
result remains an empirical gate: if the in-place bottom-up algorithm does not
reach 49,152 without semantic drift, M4.43 publishes a no-go and does not
promote or weaken the ceiling.

## Deploy Order

Optimization, generated composite, performance proof, and regenerated live
receipts land atomically. The profile remains 154, so there is no version-skew
window and no consumer can submit 388-row input as newly admitted data.

## Adversarial Challenge Delta

[VERIFIED] Nero run `nero-1784717940647-g995fz` challenged the initial plan.
It correctly required an explicit identity definition, budget rationale,
proof that no scanning helper remains in the bottom-up loop, and wider/deeper
fixtures. The spec now includes all four.

[VERIFIED] Two challenge premises were disproved from source. Function ids are
constructed only from corpus path, source ordinal, and declared name at
`scripts/kern-canonicalizer/coverage-implementation.mjs:346-360`, not runtime
encounter order. Replacing the body of `exprsource` in place requires neither a
new function nor a signature change. The challenged “12/15/388 versus
16/30/388” distinction is also resolved: 12/15/388 is the exact witness shape,
while 16/30/388 is the enclosing candidate profile.

[DECIDED] Initial confidence 0.88 rises to 0.93 because the remaining risk is
bounded by RED, exact floor measurement, full semantic replay, and a no-go
outcome that leaves policy unchanged.

## Review Delta

[VERIFIED] Automatic role-lens review
`review-1784721631067-zpjerk-kern-5-r2-m4-43-final` completed 2/2. It found no
algorithmic security or correctness defect. Its one material needs-check
correctly identified that freezing the M4.42 bytes had removed the live
frontier link needed before a future promotion.

[VERIFIED] The fix adds a current residual measurement that authenticates its
assignment digest against the live prerequisite receipt and requires the live
optimized frontier to reproduce the exact published 16/30/388 action and two
witness identities. The historical M4.42 receipt remains byte-identical at
SHA-256 `f37fed74d24a739adf3584ceb7608f8d25c490d2325ebc1c127e05ee15238a8e`.
Targeted post-fix review
`review-1784722477838-aiu54x-kern-5-r2-m4-43-review-fix` completed 1/1 with no
finding.

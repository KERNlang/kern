# KERN 5 R2 M4.112 — Structural KIR Depth Promotion

**Status:** VERIFIED — PUBLISH PENDING
**Date:** 2026-07-28
**Confidence:** 0.99

## Executive Summary

[VERIFIED] M4.110 selected a single-axis structural KIR promotion from
`maxDepth: 64` to `maxDepth: 76`. The selected frontier contains exactly nine
functions, four tools, and 134 legacy parameter rows.

[VERIFIED] M4.111 authenticated every selected witness at depth 76 through
structural encode/decode, table flattening, canonicalizer execution, source
parse, byte-exact KIR re-encode, and public/internal runtime parity. The
maximum exact runtime floor is 31,028, leaving 18,124 steps of promotion-budget
headroom and 34,508 steps of production headroom. Its canonical receipt digest
is `0acd91174c05caa96587876209abe1e3aa8744d3d8643204d07028c3e0526be9`.

[DECIDED] M4.112 changes only the live structural KIR
`kirLimits.maxDepth` value from 64 to 76. It does not change any other KIR
limit, any runtime limit, any profile limit, generated KERN source, or legacy
parameter signatures.

[DECIDED] M4.112 publishes the exact nine-function/134-row queue already
selected by M4.110 and authenticated by M4.111. M4.113 will consume that queue;
M4.112 does not claim the associated functions as migrated.

## Current State / Root Cause

[VERIFIED] The current live policy has structural KIR depth 64 and runtime
depth 64. These are separate limits: structural KIR encoding needs depth 76
for the selected roots, while the runtime handler already executes all nine
artifacts within its unchanged depth-64 envelope.

[VERIFIED] M4.111 records `activeKir.maxDepth: 64`,
`candidateKir.maxDepth: 76`, `runtimeMaxDepth: 64`, and an approved promotion
whose `nextMilestone` is M4.112.

[VERIFIED] Historical runtime and headroom receipts embed depth 64 as part of
their original evidence. A live policy promotion must not rewrite those
receipts or reinterpret their historical limits.

## Contract

| Behavior | Tag |
|---|---|
| Live `kirLimits.maxDepth` becomes exactly 76 | DECIDED |
| `kirLimits.maxBytes` remains 262,144 | VERIFIED |
| `kirLimits.maxNodes` remains 4,096 | VERIFIED |
| Runtime `maxDepth` remains exactly 64 | DECIDED |
| Runtime `maxCollectionLength` remains 65,536 | VERIFIED |
| Profile remains 89/125/2,100 | VERIFIED |
| M4.111 canonical receipt digest remains byte-exact | DECIDED |
| M4.110 projection receipt remains byte-exact and reproducible against its historical depth-64 base | DECIDED |
| Published M4.113 queue is the ordered M4.110/M4.111 witness population | DECIDED |
| No KERN source parameter is migrated in M4.112 | DECIDED |

## Implementation

1. Add a RED M4.112 promotion test that imports an absent promotion owner and
   specifies the exact live limits, immutable M4.111 GO, and exact migration
   queue.
2. Add the M4.112 promotion owner. It must authenticate the M4.111 receipt
   digest and GO, require live structural depth 76, require unchanged runtime
   and profile limits, and publish the ordered nine-function/134-row queue.
3. Change only `policy.json` structural `kirLimits.maxDepth` from 64 to 76.
4. Separate current-policy assertions from historical evidence assertions:
   current checks require 76; historical receipts retain depth 64; M4.110 and
   M4.111 live reproduction explicitly use their historical depth-64 base.
5. Add M4.112 status and central integrity-chain integration, then regenerate
   the two derived coverage summaries until byte-identical.
6. Run targeted tests, the complete canonicalizer suite, full Node 22 KERN 5
   fitness, and high-risk automatic role-lens review before one signed,
   rebased push.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-m4-112-kir-depth-promotion/spec.md` | add | Claim/evidence boundary |
| `scripts/kern-canonicalizer/policy.json` | modify | Promote structural KIR depth only |
| `scripts/kern-canonicalizer/coverage-m4-112-kir-depth-promotion.{mjs,test.mjs}` | add | Authenticate promotion and publish queue |
| `scripts/kern-canonicalizer/coverage-current.mjs` | modify | Require live depth 76 |
| `scripts/kern-canonicalizer/projection-analysis-m4-110.mjs` | modify | Preserve historical depth-64 analysis base |
| `scripts/kern-canonicalizer/kir-depth-headroom-m4-111*.mjs` | modify | Preserve receipt while reproducing under promoted policy |
| `scripts/kern-canonicalizer/historical-policy*.mjs` | modify | Reconstruct historical KIR as well as profile limits |
| historical promotion/runtime assertions | modify | Stop confusing later live policy with archived depth |
| `scripts/kern-canonicalizer/coverage-status.{mjs,test.mjs}` | modify | Publish exact M4.113 handoff |
| `scripts/check-kern-canonicalizer-coverage.mjs` | modify | Repository-wide promotion integrity |
| canonical coverage summaries | regenerate | Derived source identities |

## Acceptance Criteria

- [x] RED fails because the M4.112 owner is absent.
- [x] Live structural KIR limits are exactly 262,144 bytes / depth 76 / 4,096 nodes.
- [x] Every other structural KIR policy field is unchanged.
- [x] Runtime limits remain byte-for-byte unchanged, including depth 64.
- [x] Profile limits remain exactly 89/125/2,100.
- [x] M4.111 digest and approved GO are consumed exactly.
- [x] M4.111 JSON receipt bytes remain unchanged.
- [x] M4.110 and M4.111 historical measurements remain reproducible.
- [x] M4.113 queue contains exactly nine ordered witnesses, four tools, and 134 rows.
- [x] Current coverage remains 92/111 with 15 legacy-parameter blockers.
- [x] No example KERN source or generated artifact changes.
- [x] Derived summaries converge; targeted, complete canonicalizer, and full
      KERN 5 fitness gates pass.
- [x] Independent high-risk role-lens review completed 6/6; its two verified
      findings were fixed with regression coverage and the full gate rerun.
- [ ] Signed commit is fetched/rebased before one push and remote `main`
      verifies identically.

## Verification Evidence

- Full gate: `pnpm fitness:kern-5` on Node 22, ending with
  `KERN 5 current fitness wall passed.`
- Canonicalizer: 495/495 tests, 55 golden/idempotence/KIR fixtures,
  8 measured witnesses, 3 profile-limit fixtures, and 235 hostile fixtures.
- Derived summaries converged byte-identically at SHA-256
  `6b418694b70f96599944090ed0866ab7ee7412e9fc3a02ba719aca77ef437d8c`
  and `264b3fb9bf83125ca9f30fcafbd5c345f9e1f409792ae7788c173b4fc9486172`.
- Independent review:
  `/Users/nicolascukas/.agon/runs/review-1785272916335-qppasd` (6/6).

## Out of Scope

- Changing runtime depth or runtime iteration budgets.
- Migrating any legacy parameter signature.
- Changing profile limits or other KIR axes.
- KIR v1 freeze, runtime cutover, release candidate, stable 5.0, or Fable.

## Open Questions

None. M4.110 defines the exact candidate and M4.111 supplies the required GO.

## Deploy Order

Publish M4.112 as one policy/contract slice. M4.113 starts from the resulting
`origin/main` and consumes the published parameter queue without widening any
limit.

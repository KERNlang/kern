# KERN 5 R2 M4.138 — Exception-Flow Prerequisite Handoff

**Status:** VERIFIED — READY TO PUBLISH
**Date:** 2026-07-30
**Base commit:** `5b35add93c04871beac52d0b93d74fa06a7039ae`
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.137 promotes the exact M4.136 `new-expression`
prerequisite into cumulative base
`kern.kir-canonicalizer.profile.m4.137`, advancing coverage from 104/112 to
109/112 while preserving the same three legacy `fn.params` blockers.

[VERIFIED] The measured M4.137 frontier has no ordinary selection winner.
`exception-flow` is the sole active family and the exact one-family
prerequisite closure: two catalog facts, 34 occurrences, one completed
`canonicalize` function, one tool, and 15 parameter rows.

[DECIDED] M4.138 freezes that exact published result as the eighth immutable
`kern.kir-canonicalizer.prerequisite-provenance.1` record. It does not
implement or promote exception flow, migrate parameters, change any resource
limit, or claim KERN 5 completion.

## Immutable Published Input

[VERIFIED] The M4.137 source boundary is:

- commit `5b35add93c04871beac52d0b93d74fa06a7039ae`;
- coverage summary format
  `kern.kir-canonicalizer.coverage-summary.6`, SHA-256
  `7e6b79ade0125e120b19009d53e2cb4b05e17633cd38bd6f4787075ded58e615`;
- prerequisite summary format
  `kern.kir-canonicalizer.prerequisite-summary.3`, SHA-256
  `d07915389748776424f0075f512abc7fe0d2957864a09a11c111179f60b9fb62`.

[VERIFIED] The canonical snapshot contains exactly:

- baseline profile `kern.kir-canonicalizer.profile.m4.137`;
- 109/112 base-complete functions;
- nine corpus members, four tools, and three legacy parameter blockers;
- selected prerequisite `exception-flow`, two catalog facts, 34 occurrences;
- minimum family count one;
- winning closure `exception-flow`, one function, one tool, 15 parameter
  rows, 34 occurrences, and only
  `examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize`.

## Contract

| Behavior | Contract | Tag |
|---|---|---|
| New record | canonical `kern.kir-canonicalizer.prerequisite-provenance.1` JSON | DECIDED |
| History | append after the exact seven published records | DECIDED |
| Exact loader | bind canonical bytes to a pinned SHA-256 | DECIDED |
| Source causality | bind exact M4.137 commit and both published receipt hashes | DECIDED |
| Live base | remain profile M4.137 at 109/112 | DECIDED |
| Live blockers | remain exactly three legacy parameter functions | DECIDED |
| Selected family | remain sole `exception-flow` prerequisite | DECIDED |
| Winning closure | remain one family, one function, one tool, 15 rows | DECIDED |
| Canonicalizer/reader/runtime | byte- and behavior-unchanged | DECIDED |
| Resource limits | unchanged | DECIDED |
| Promotion | none | DECIDED |
| Parameter migration | none | DECIDED |

## Alternatives

### A — Freeze the exact prerequisite now (selected)

This preserves the append-only causal chain before implementation and gives
the next slice one authenticated exception-flow input.

### B — Implement exception flow directly (rejected)

Implementation without an immutable handoff would make provenance depend on
mutable live receipts and skip the established prerequisite boundary.

### C — Migrate `canonicalize` parameters first (rejected)

The live frontier identifies exception-flow shape support as the prerequisite;
parameter migration remains explicitly zero until that capability is owned and
promoted.

## Implementation Plan

1. Add RED assertions for the absent exception-flow loader and eight-record
   chain.
2. Add canonical provenance JSON for the exact published M4.137 boundary.
3. Extend the strict digest-pinned loader and ordered chain without changing
   the first seven records.
4. Bind handoff/current/standalone coverage tests to exact record bytes,
   source receipts, ordering, and causal mutation rejection.
5. Regenerate live summaries only if implementation-provenance bytes require
   it; semantic counts must remain identical.
6. Run focused tests, complete canonicalizer, full KERN 5 fitness wall,
   six-engine review, fetch/rebase, one push, and remote SHA verification.

## Expected File Surface

| File/group | Action | Reason |
|---|---|---|
| this spec | add/seal | cross-session claim/evidence boundary |
| M4.137 spec | correct evidence hashes/review reference | preserve exact published evidence |
| `coverage-exception-flow-prerequisite-provenance.json` | add | immutable M4.137 causal record |
| `coverage-prerequisite-provenance.mjs` | modify | exact loader and eight-record chain |
| provenance/handoff/coverage tests | modify | RED, ordering, mutation, and gate proof |
| live coverage/prerequisite receipts | regenerate if required | authenticate final implementation bytes |
| canonicalizer KERN members | unchanged | exception flow is not implemented here |
| structural reader/runtime | unchanged | evidence-only slice |

## Acceptance Criteria

- [x] RED fails because published M4.137 has no immutable exception-flow
      prerequisite artifact or loader.
- [x] New JSON is canonical and its exact SHA-256 is pinned.
- [x] The record binds exact M4.137 commit and published receipt bytes.
- [x] Snapshot binds the exact baseline, selected prerequisite, one-family
      closure, counts, and sole witness.
- [x] Validator rejects malformed/decorated records and exact loader rejects
      every causal mutation.
- [x] Ordered history contains exactly eight unique records and preserves the
      first seven byte-for-byte.
- [x] Live coverage remains 109/112 with three legacy parameter blockers.
- [x] Exception flow remains unimplemented, unpromoted, and solely selected.
- [x] No canonicalizer, reader, runtime, limit, or parameter source changes.
- [x] Focused tests pass.
- [x] Complete canonicalizer tests pass.
- [x] Full KERN 5 fitness wall passes.
- [x] Six-engine review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main
      verifies.

## Current Evidence

[VERIFIED] The exact M4.138 prerequisite record has SHA-256
`2c36f8d7ec2e91cba6742241e72c79adacc917ad59e3105aabdf15f7e9e712e4`.
Final receipt generation produces:

- coverage summary SHA-256
  `4c374e8c2d4bb78dac9e48ab149f76ae6cbc446426e6507a0819f4e7c3868473`;
- prerequisite summary SHA-256
  `807e9992d318a491099c9bc3d6b53b302e1391502ef7ab498a8bc171828d0b3b`;
- coverage implementation digest
  `d30f1899c2ec5ac2f6d9df4fdafe30c4ad6d4c3e0ae143bfeafce3756e7e03b2`;
- unchanged coverage policy digest
  `edecde1e3bd5e27ef3025ff6da045a77b71e9718e4fd573bc0bedc17a060e6c5`;
- unchanged profile digest
  `fe14493f42136a4c6d5593b0ec6eb8c5c96c89076264cbdb961e8c2e03acb44b`;
- unchanged canonicalizer digest
  `e6b33ada0310452eb01f33426ef5a7d807b83b3de1637e01befdb541fcaa8e75`.

[VERIFIED] The focused seven-file regression set passes 51/51. The complete
canonicalizer gate passes 636/636 tests plus 56 golden/idempotence/KIR
fixtures, eight measured witnesses, three profile-limit fixtures, and 243
hostile fixtures. The authoritative `pnpm fitness:kern-5` wall passes end to
end.

[VERIFIED] Agon review `review-1785373756685-bksaqd` completed with 6/6 usable
engines. Correctness, security, and performance returned no findings. Four
needs-check items were resolved: two duplicated reports confused the immutable
M4.137 source receipt with the live M4.138 receipt, so the M4.137 evidence
heading now states its published commit explicitly; historical prefix
projections remain intentional because the live append-only chain grows; and
the status digest pin remains intentionally independent of the loader pin.

## Stop Conditions

- The published M4.137 commit or either receipt hash differs from the immutable
  input above.
- The record requires weakening the provenance schema or rewriting one of the
  first seven records.
- Live semantic counts, selected prerequisite, closure, or witness differ
  after evidence-only changes.
- Any canonicalizer, reader, runtime, limit, or parameter-source mutation is
  required.
- Any focused, full-wall, or review gate fails unresolved.

## Out of Scope

- Exception-flow implementation or promotion.
- Parameter migration for `canonicalize`, `expressionsources`, or
  `quotesource`.
- Quotesource code-point remediation.
- Structural/profile/runtime limit changes.
- KIR v1 freeze, public reader cutover, RC/stable release, Fable, or KERN 5
  completion.

## Release Boundary

[DECIDED] M4.138 publishes only the authenticated exception-flow prerequisite
handoff. The next fresh slice may consume that record to implement bounded
exception flow, then must remeasure promotion and parameter-migration
eligibility from the resulting live frontier.

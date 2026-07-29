# KERN 5 R2 M4.136 — New-Expression Prerequisite Handoff

**Status:** VERIFIED — READY TO PUBLISH
**Date:** 2026-07-29
**Base commit:** `5c5e80fe03f9664ffb2cd87b513b7dfe3d9d867c`
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.135 adds the bounded `new-expression` structural
contract and KERN-owned canonical emission without promotion. Its live
coverage remains 104/112 base-complete with three legacy `fn.params`
blockers.

[VERIFIED] M4.135 selects `new-expression` as the one-catalog-fact
prerequisite inside the minimum two-family closure with `exception-flow`.
That closure completes only
`examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize`, covering
15 parameter rows and 75 combined occurrences.

[DECIDED] M4.136 freezes that exact published result as the seventh immutable
prerequisite-provenance record. It does not promote either family, migrate
`canonicalize`, change profile limits, implement `exception-flow`, or claim
KERN 5 completion.

[VERIFIED] The M4.135a base independently hardens the reader so impossible
constructor arity rejects before recursively validating hostile argument
subtrees. M4.136 consumes that published base and remains evidence-only.

## Immutable Published Input

[VERIFIED] The M4.135 source boundary is:

- commit `5c5e80fe03f9664ffb2cd87b513b7dfe3d9d867c`;
- coverage summary format
  `kern.kir-canonicalizer.coverage-summary.6`, SHA-256
  `b54ea0da184be397ff995d3ffce4ee4be425cd2751de5089543a246be3c7c522`;
- prerequisite summary format
  `kern.kir-canonicalizer.prerequisite-summary.3`, SHA-256
  `019ca1548ad46208c8b34b31cbd5d9bb4d140b4888a9992731a286cfde464a5b`.

[DECIDED] The canonical snapshot contains exactly:

- baseline: profile `kern.kir-canonicalizer.profile.m4.60`, 104/112
  base-complete, nine corpus members, four tools, three legacy parameter
  blockers;
- selected prerequisite: `new-expression`, one catalog fact, 41 occurrences;
- minimum family count: two;
- winning closure: `exception-flow` plus `new-expression`, one function, one
  tool, 15 parameter rows, 75 occurrences, and only the `canonicalize`
  witness.

## Contract

| Behavior | Contract | Tag |
|---|---|---|
| New record | canonical `kern.kir-canonicalizer.prerequisite-provenance.1` JSON | DECIDED |
| History | append after index, counted iteration, binding, unary, do, and while | DECIDED |
| Exact loader | bind canonical bytes to a pinned SHA-256 | DECIDED |
| Source causality | bind exact M4.135 commit and both published receipt hashes | DECIDED |
| Live base | remain profile M4.60 at 104/112 | DECIDED |
| Live blockers | remain exactly three legacy parameter functions | DECIDED |
| Selected family | remain `new-expression` inside the two-family closure | DECIDED |
| Reader rejection | check args tag, constructor, and exact arity before nested args | DECIDED |
| Admitted bytes | unchanged for valid `new Map()` and `new Error(expr)` | DECIDED |
| Promotion | none | DECIDED |
| Parameter migration | none | DECIDED |

## Alternatives

### A — Freeze the exact prerequisite now (selected)

This preserves the append-only causal chain before promotion and gives the
next slice one authenticated input.

### B — Promote `new-expression` directly (rejected)

Promotion without an immutable handoff would skip the repository's established
prerequisite boundary and make later provenance depend on mutable live
receipts.

### C — Implement `exception-flow` in this slice (rejected)

That would merge two capability boundaries and destroy the measured ordering
that chose `new-expression` first.

## Implementation Plan

1. Add RED imports/assertions for the missing new-expression handoff and
   seven-record chain.
2. Add canonical provenance JSON for the exact published M4.135 boundary.
3. Extend the strict digest-pinned loader and ordered chain.
4. Bind the standalone coverage gate and handoff tests to exact record bytes,
   source receipts, ordering, and mutation rejection.
5. Regenerate authenticated live summaries only after implementation bytes
   settle; preserve all live semantic counts.
6. Run focused tests, complete canonicalizer, full KERN 5 fitness wall,
   independent high-risk review, rebase, and publish once.

## Expected File Surface

| File/group | Action | Reason |
|---|---|---|
| this spec | add/seal | cross-session claim/evidence boundary |
| `coverage-new-expression-prerequisite-provenance.json` | add | immutable M4.135 causal record |
| `coverage-prerequisite-provenance.mjs` | modify | exact loader and seven-record chain |
| provenance/handoff/coverage tests | modify | RED, ordering, mutation, and gate proof |
| live coverage/prerequisite receipts | regenerate if required | authenticate final implementation bytes |
| structural expression reader/test | unchanged | inherited from published M4.135a base |
| pre-M4.135 structural target | unchanged | inherited from published M4.135a base |

## Acceptance Criteria

- [x] RED fails because published M4.135 has no immutable new-expression
      prerequisite artifact or loader.
- [x] New JSON is canonical and its exact SHA-256 is pinned.
- [x] The record binds exact M4.135 commit and published receipt bytes.
- [x] Snapshot binds the exact baseline, selected prerequisite, two-family
      closure, counts, and sole witness.
- [x] Validator rejects malformed/decorated records and exact loader rejects
      every causal mutation.
- [x] Ordered history contains exactly seven unique records and preserves the
      first six byte-for-byte.
- [x] Reader rejects impossible arity before traversing hostile nested values.
- [x] Valid bounded constructor canonical bytes remain unchanged.
- [x] Pre-M4.135 compiled-core reconstruction retains its exact digest.
- [x] Live coverage remains 104/112 with three legacy parameter blockers.
- [x] `new-expression` remains unpromoted and selected inside the exact
      two-family closure.
- [x] Focused tests pass.
- [x] Complete canonicalizer tests pass.
- [x] Full KERN 5 fitness wall passes.
- [x] Independent high-risk role review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main
      verifies.

## Stop Conditions

- The published M4.135 commit or either receipt hash differs from the immutable
  input above.
- The record requires weakening the existing provenance schema or rewriting
  one of the first six records.
- Live semantic counts, selected prerequisite, winning closure, or witness
  differ after evidence-only changes.
- Reader hardening changes any admitted canonical bytes.
- Any focused, full-wall, or review gate fails unresolved.

## Out of Scope

- Promoting `new-expression` or `exception-flow`.
- Implementing exception-flow canonicalization.
- Migrating `canonicalize`, `expressionsources`, or `quotesource`.
- Raising structural/profile/runtime limits.
- KIR v1 freeze, public reader cutover, RC/stable release, Fable, or KERN 5
  completion.

## Release Boundary

[DECIDED] M4.136 publishes the immutable handoff and compatible reader
hardening only. The next fresh slice may consume the record to promote
`new-expression`, then must remeasure the remaining `exception-flow`,
projection-limit, and `quotesource` frontier honestly.

## Current Evidence

[VERIFIED] The canonical M4.136 provenance record has SHA-256
`ca3b4053df5707126d97c21300cf20004d7c01e9fcc0b78d40dd249fd8d1af0e`.
The regenerated live coverage and prerequisite summaries have SHA-256
`90e10732c0c62fb82069ef137e648300cf45f7591378dcaf727db951ba0d7b98`
and
`ab0f212f65553f773041b1a24f9649b9a2c8eaca388901bc39f1937be5bc4cd9`.

[VERIFIED] Focused provenance/current-frontier tests pass 17/17, and bounded
structural new-expression tests pass 14/14. The reader regression first
failed with `unknown-expression-kind` from the hostile child and now rejects
at the constructor argument-list path with `invalid-expression`.

[VERIFIED] The authoritative pre-review implementation
`PATH=/Users/nicolascukas/.nvm/versions/node/v22.22.0/bin:$PATH pnpm fitness:kern-5`
wall passed with exit 0. It includes two complete
624/624 canonicalizer-history runs, 434/434 cross-backend conformance
fixtures, 109/109 class-conformance fixtures, native KERN coverage at 100%,
48/48 checker-subset fixtures, 39/39 self-host-validator verdicts, and ended
with `KERN 5 current fitness wall passed.`

[VERIFIED] The high-risk role review routed all six usable independent seats
and completed 6/6 with zero verified blockers. One needs-check finding was
confirmed: the exported status formatter trusted a claimed digest without
rebinding the supplied record. A RED mutation test reproduced it; the
formatter now runs the exact provenance validator and compares the claimed
digest to the validator-derived digest. The final post-review focused suite
passes 35/35 and the complete canonicalizer gate passes 625/625 plus both
executable checks. The remaining needs-check notes were verified as
intentional immutable-loader validation, explicit historical-prefix tests,
and a fail-loud milestone-status dependency.

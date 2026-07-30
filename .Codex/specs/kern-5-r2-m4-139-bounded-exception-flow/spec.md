# KERN 5 R2 M4.139 — Bounded Exception-Flow Contract

**Status:** VERIFIED — READY TO PUBLISH
**Date:** 2026-07-30
**Base commit:** `6060d864a7cb8c877acc3439756a6666ec41b357`
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.138 freezes the exact M4.137 exception-flow
prerequisite as the eighth append-only provenance record, SHA-256
`2c36f8d7ec2e91cba6742241e72c79adacc917ad59e3105aabdf15f7e9e712e4`.

[VERIFIED] The live base remains
`kern.kir-canonicalizer.profile.m4.137` at 109/112 base-complete with three
legacy `fn.params` blockers. `exception-flow` is the sole active family and
the one-family prerequisite closure completing only `canonicalize`.

[DECIDED] M4.139 adds bounded KERN-owned canonicalization for structural
`throw` statements with exactly one `value` property containing a recursively
valid expression. The node must be a leaf. Bare throws, decorated throws,
unknown properties, malformed expressions, and child-bearing throws reject.

[DECIDED] M4.139 does not promote `exception-flow`, migrate parameters, add
`try`/`catch`/`finally`, change any resource limit, or claim KERN 5
completion. The measured post-implementation frontier becomes the M4.140
handoff.

## Immutable Input

[VERIFIED] M4.139 consumes:

- source commit `6060d864a7cb8c877acc3439756a6666ec41b357`;
- prerequisite format
  `kern.kir-canonicalizer.prerequisite-provenance.1`;
- exact exception-flow provenance digest
  `2c36f8d7ec2e91cba6742241e72c79adacc917ad59e3105aabdf15f7e9e712e4`;
- baseline profile `kern.kir-canonicalizer.profile.m4.137`;
- 109/112 base-complete functions and three legacy parameter blockers;
- selected prerequisite `exception-flow`, two catalog facts, 34 occurrences;
- one-family closure completing only
  `examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize`, with 15
  legacy parameter rows.

## Current State / Root Cause

- [VERIFIED] Structural KIR already catalogs node `throw` as a leaf
  structural candidate and `throw.value` as a lowered expression.
- [VERIFIED] The language schema allows a body-statement `throw`, including a
  legacy bare form, but the measured canonicalizer corpus contains exactly 17
  valued throws and no bare throw.
- [VERIFIED] The shared `statementfacts` projection already authenticates the
  child count, property count, and `value` property id for every statement.
- [VERIFIED] `validstatement` currently has no `throw` branch and therefore
  rejects every structural throw.
- [VERIFIED] `emitstatement` currently has no `throw` branch and therefore
  cannot reproduce authenticated throw source.
- [VERIFIED] The frozen family registry defines `exception-flow` as exactly
  node kind `throw` plus property `throw.value`; it does not include
  `try`, `catch`, or `finally`.

## Contract

| Behavior | Contract | Tag |
|---|---|---|
| Structural node | exactly `throw` | VERIFIED |
| Children | exactly zero | DECIDED |
| Properties | exactly one: `value` | DECIDED |
| Value | one recursively valid structural expression | DECIDED |
| Canonical source | `throw value=<quotesource(expression, true)>` | DECIDED |
| Bare throw | reject | DECIDED |
| Extra/decorated property | reject | DECIDED |
| Malformed/unsupported expression | reject | DECIDED |
| Placement | any already-valid statement-list position | DECIDED |
| Runtime semantics | unchanged | DECIDED |
| KIR/profile/runtime limits | unchanged | DECIDED |
| Base profile | remains M4.137 at 109/112 | DECIDED |
| Promotion | none | DECIDED |
| Parameter migration | none | DECIDED |

## Alternatives

### A — Exact valued leaf throw (selected)

This matches every measured occurrence, reuses the authenticated statement
fact projection, preserves the thrown expression structurally, and adds no
new control-flow container.

### B — Admit the legacy bare throw (rejected)

No published prerequisite occurrence requires it. Synthesizing a default
error would widen the self-hosting contract beyond measured evidence.

### C — Add generic try/catch/finally (rejected)

Those nodes are not part of the selected family and require separate
container, binding, completion, and target-emission contracts.

### D — Special-case only `new Error("KERN_CANONICALIZER_PROFILE")` (rejected)

The structural property contract is an expression. Restricting emission to
one literal would make canonicalization depend on current message bytes and
would not preserve the already-bounded recursive expression seam.

## Implementation Plan

1. Add RED golden and hostile fixtures for valued leaf throws.
2. Add exact validation and emission branches in the KERN statement helper.
3. Add source-ownership assertions and a historical replacement so archived
   canonicalizer compositions remain reconstructible byte-for-byte.
4. Regenerate composition metadata, the checked-in composite, policy corpus
   digest, and authenticated coverage receipts.
5. Add M4.139 central/status assertions binding the M4.138 provenance,
   unchanged base, exact one-family frontier, and zero parameter migration.
6. Run focused tests, complete canonicalizer, full KERN 5 fitness wall,
   independent high-risk role review, fetch/rebase, one push, and remote SHA
   verification.

## Expected File Surface

| File/group | Action | Reason |
|---|---|---|
| this spec | add/seal | shared contract and evidence boundary |
| `canonicalizer-statement-helpers.kern` | modify | KERN-owned validation/emission |
| composed canonicalizer + composition metadata | regenerate | authenticated executable |
| exception-flow fixtures + fixture registry | add/modify | golden and hostile oracles |
| canonicalizer ownership tests | modify | exact branch and quotation contract |
| historical composition replacement | add/wire | preserve archived byte identities |
| coverage policy corpus digest | update | authenticate changed handwritten member |
| M4.139 central/status tests | add/wire | release-blocking milestone contract |
| live coverage receipts | regenerate | bind final implementation bytes |
| structural reader/runtime | unchanged | existing structural/runtime semantics suffice |

## Acceptance Criteria

- [x] RED proves the KERN canonicalizer rejects a valid valued throw.
- [x] Valued leaf throw validates and emits canonical source exactly.
- [x] Nested valued throw preserves recursively canonical expression source.
- [x] Bare throw rejects.
- [x] Missing, duplicate, unknown, or decorated properties reject.
- [x] Child-bearing throw rejects.
- [x] Malformed and unsupported value expressions reject.
- [x] Historical canonicalizer compositions retain exact archived digests.
- [x] All pre-M4.139 golden bytes remain unchanged.
- [x] Live base remains M4.137 at 109/112 with three parameter blockers.
- [x] Exception flow remains unpromoted and solely selected.
- [x] Parameter migration remains zero.
- [x] Focused and complete canonicalizer gates pass.
- [x] Full KERN 5 fitness wall passes.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main
      verifies.

## Stop Conditions

- The M4.138 record or digest differs from the immutable input.
- Supporting valued throw requires runtime, reader, ABI, or limit changes.
- Archived canonicalizer compositions cannot be reconstructed exactly.
- The measured live frontier changes beyond implementation authentication.
- A test or independent-review blocker remains unresolved.

## Out of Scope

- Bare throw canonicalization.
- `try`, `catch`, `finally`, rethrow, typed catches, or exception binding.
- Promotion of `exception-flow`.
- Parameter migration for `canonicalize`, `expressionsources`, or
  `quotesource`.
- Quotesource code-point remediation.
- KIR v1 freeze, public reader cutover, RC/stable release, Fable, or KERN 5
  completion.

## Release Boundary

[DECIDED] M4.139 publishes bounded valued-throw canonicalization only. M4.140
must freeze the exact resulting exception-flow prerequisite before any
promotion or parameter migration.

## Verification Evidence

[VERIFIED] The complete canonicalizer gate passed 639/639 unit and historical
preservation tests, 58 golden/idempotence/KIR fixtures, eight measured
witnesses, three profile-limit fixtures, and 250 hostile fixtures.

[VERIFIED] `pnpm fitness:kern-5` passed the complete repository, build,
workspace-test, infrastructure, portable-conformance, self-host, application,
runtime-ABI, and canonicalizer release wall.

[VERIFIED] High-risk role-lens Agon review routed all six usable independent
reviewers across overall, security, correctness, dryness, and performance:
6/6 succeeded, with zero verified material findings and zero unresolved
needs-check findings.

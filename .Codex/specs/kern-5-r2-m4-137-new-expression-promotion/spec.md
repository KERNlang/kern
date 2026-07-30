# KERN 5 R2 M4.137 — New-Expression Cumulative-Base Promotion

**Status:** VERIFIED — READY TO PUBLISH
**Date:** 2026-07-30
**Base commit:** `ea82f5e4f951e5a27064790e711dc81a898c313b`
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.136 freezes the exact M4.135 `new-expression`
prerequisite as the seventh append-only provenance record, SHA-256
`ca3b4053df5707126d97c21300cf20004d7c01e9fcc0b78d40dd249fd8d1af0e`.

[VERIFIED] The published live base remains
`kern.kir-canonicalizer.profile.m4.60` at 104/112 base-complete with three
legacy `fn.params` blockers. `new-expression` is implemented and selected but
not promoted.

[DECIDED] M4.137 consumes the exact M4.136 provenance to promote expression
kind `new` into the cumulative base. It removes only `new-expression` from
the active family registry and leaves `exception-flow` as the sole residual
family.

[DECIDED] M4.137 does not implement exception flow, migrate any function
parameters, change KIR/profile/runtime ceilings, freeze KIR v1, cut over the
reader, or claim KERN 5 completion.

## Immutable Input

[VERIFIED] The promotion input is:

- source commit `ea82f5e4f951e5a27064790e711dc81a898c313b`;
- prerequisite provenance format
  `kern.kir-canonicalizer.prerequisite-provenance.1`;
- exact new-expression provenance digest
  `ca3b4053df5707126d97c21300cf20004d7c01e9fcc0b78d40dd249fd8d1af0e`;
- baseline profile `kern.kir-canonicalizer.profile.m4.60`;
- baseline completion 104/112;
- selected prerequisite `new-expression`, one catalog fact, 41 occurrences;
- minimum closure `exception-flow` plus `new-expression`, completing only
  `examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize`.

## Contract

| Behavior | Contract | Tag |
|---|---|---|
| Profile identity | `kern.kir-canonicalizer.profile.m4.137` | DECIDED |
| Expression base | append `new` in canonical sorted order | DECIDED |
| Expression profile | admit only structurally valid bounded Map/Error constructors | DECIDED |
| Promotion evidence | append exact M4.136 digest with kind `prerequisite` | DECIDED |
| Family registry | remove only `new-expression`; retain only `exception-flow` | DECIDED |
| Structural/node base | unchanged | DECIDED |
| Property base | unchanged | DECIDED |
| Resource limits | unchanged M4.130 KIR/profile/runtime limits | DECIDED |
| Provenance history | retain all seven prerequisite records byte-for-byte | DECIDED |
| Canonicalizer bytes | unchanged | DECIDED |
| Reader/runtime bytes | unchanged | DECIDED |
| Post-promotion frontier | measurement-derived, never guessed | DECIDED |

## Measured Result

[VERIFIED] Promoting `new-expression` advances base completion from 104/112
to 109/112 and leaves the same three legacy `fn.params` blockers.

[VERIFIED] Ordinary selection has no winner. `exception-flow` is the sole
active family and the exact one-family prerequisite closure: two catalog
facts, 34 occurrences, one completed `canonicalize` function, and 15 parameter
rows. Parameter migration remains zero and prerequisite exhaustion is null.

## Implementation Plan

1. Add RED promotion assertions for the M4.137 profile, expression kind,
   provenance citation, remaining family, immutable history, and unchanged
   resource contracts.
2. Update the generated base validator and checked-in coverage policy in
   lockstep.
3. Update current-frontier and standalone-gate assertions only from observed
   post-promotion measurements.
4. Regenerate authenticated coverage and prerequisite summaries after all
   implementation dependencies settle.
5. Run focused tests, complete canonicalizer, full KERN 5 fitness wall,
   independent high-risk role review, fetch/rebase, one push, and remote SHA
   verification.

## Expected File Surface

| File/group | Action | Reason |
|---|---|---|
| this spec | add/seal | shared profile contract |
| `coverage-base-profile.mjs` | modify | authoritative base identity and evidence |
| `coverage-policy.json` | modify | checked-in base and residual family registry |
| `coverage-profile.mjs` | modify | exact portable profile for the promoted expression |
| promotion/current/handoff tests | modify/add | RED and historical preservation |
| `coverage-current.mjs` | modify | exact new live frontier |
| standalone coverage gate | modify | exact M4.137 contract |
| live coverage/prerequisite summaries | regenerate | authenticate final implementation bytes |
| canonicalizer KERN members | unchanged | implementation already landed in M4.135 |
| structural reader/runtime | unchanged | bounded constructor contract already published |

## Acceptance Criteria

- [x] RED fails because the current base is still M4.60 and excludes `new`.
- [x] Base identity is exactly M4.137.
- [x] Base expression kinds include `new` in canonical order.
- [x] Base expression profile admits only exact published Map/Error shapes.
- [x] Promotion evidence cites only the exact M4.136 prerequisite digest.
- [x] `new-expression` is absent from active families.
- [x] `exception-flow` is the only active family.
- [x] Node kinds, property keys, KIR/profile/runtime limits, corpus, and
      canonicalizer bytes remain unchanged.
- [x] All seven prerequisite records remain present and byte-identical.
- [x] Live base completion and residual frontier match measured values.
- [x] No parameter source is migrated.
- [x] Focused tests pass.
- [x] Complete canonicalizer tests pass.
- [x] Full KERN 5 fitness wall passes.
- [x] Independent high-risk role review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main
      verifies.

## Stop Conditions

- The M4.136 provenance digest or record differs from the immutable input.
- Promotion requires a canonicalizer, reader, runtime, KIR-limit, profile-limit,
  or parameter-source change.
- More than `new-expression` must be removed from the active family registry.
- The measured base does not advance by exactly the functions completed by the
  published new-expression surface.
- Any historical receipt or provenance record must be rewritten.
- Any focused, full-wall, or review gate fails unresolved.

## Pre-Implementation Challenge

[VERIFIED] A Nero adversarial pass challenged canonicalizer-byte drift,
unbounded constructor admission, version-skew, and the possibility that the
live blockers were resource limits rather than profile-shape blockers.

[DECIDED] The implementation therefore binds canonicalizer bytes unchanged,
keeps every constructor outside bounded Map/Error rejected, and asserts
resource limits independently. The version-skew scenario does not apply
because the family registry is build-time evidence policy, not a runtime
wire/schema registry. Direct call-chain inspection proves
`expression.new.profile` is emitted by the missing local profile branch before
resource-limit classification; post-change measurement remains authoritative.

## Out of Scope

- Exception-flow implementation or promotion.
- Parameter migration for `canonicalize`, `expressionsources`, or
  `quotesource`.
- Quotesource code-point remediation.
- Projection-limit or resource-limit changes.
- KIR v1 freeze, public reader cutover, RC/stable release, Fable, or KERN 5
  completion.

## Release Boundary

[DECIDED] M4.137 publishes only the authenticated cumulative-base promotion
and the measured residual frontier. The next slice must consume that published
frontier honestly; it may not infer exception-flow implementation or parameter
migration from this promotion alone.

## Current Evidence

[VERIFIED] The focused M4.137 contract suite passes 55/55 tests. Receipt
generation succeeds with:

- coverage summary SHA-256
  `d9b82dac62a6db2817bef824de4c17b1449bec7885860a167487a7c51ae6b875`;
- prerequisite summary SHA-256
  `3a55b1024d043e4f585ac03df845c1fc3d74e538dd86ce816043e18d46fda093`;
- coverage implementation digest
  `d0039abea55f3fbc8f6fbdcdbab69b83d88bd55b9cbef26385faf8e6f0d5df9f`;
- coverage policy digest
  `edecde1e3bd5e27ef3025ff6da045a77b71e9718e4fd573bc0bedc17a060e6c5`;
- profile digest
  `fe14493f42136a4c6d5593b0ec6eb8c5c96c89076264cbdb961e8c2e03acb44b`;
- unchanged canonicalizer digest
  `e6b33ada0310452eb01f33426ef5a7d807b83b3de1637e01befdb541fcaa8e75`.

[VERIFIED] The complete canonicalizer gate passes 630/630 tests, 56
golden/idempotence/KIR fixtures, eight measured witnesses, three profile-limit
fixtures, and 243 hostile fixtures.

[VERIFIED] The authoritative `pnpm fitness:kern-5` wall passes end to end,
including repository consistency, lint, production build, all workspace and
infrastructure suites, runner/capstone/self-host smoke, app and drift
conformance, KIR proofs, runtime ABI/quarantine, source-runner convergence,
and the dedicated canonicalizer gate.

[VERIFIED] Agon review
`review-1785370468008-9sgy7l-m4-137-new-expression-promotion` completed with
6/6 usable engines. Consensus reported zero verified findings; the correctness
reviewer reported no findings. All four needs-check items were rejected against
the current source: the alleged unused import is absent, the current-frontier
assertion delegates to the M4.137 assertion, historical replacements require
one exact occurrence plus the archived SHA-256, and historical authentication
requires allowlisted bytes whose parsed value exactly matches the supplied
policy.

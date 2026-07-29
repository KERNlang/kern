# KERN 5 R2 M4.134 — Residual Remediation Analysis

**Status:** REVIEWED — PENDING PUBLISH
**Date:** 2026-07-29
**Confidence:** 0.99

## Executive Summary

[VERIFIED] M4.133 is published on `main` at
`6222871ce7e8025a4654ff1b0d4c3a43afe3f494`. Its immutable projection
receipt proves that no KIR/profile limit change can complete the remaining
three legacy-parameter functions.

[VERIFIED] The two unknown-expression functions contain one bounded syntax
family: four exact `new Map()` expressions in `expressionsources` and
seventeen exact `new Error("KERN_CANONICALIZER_PROFILE")` expressions in
`canonicalize`. Both constructor forms already have portable runtime
contracts.

[VERIFIED] `quotesource` has no structural or profile-limit deficit. Its six
remaining blockers are the exact character literals used by its rejection
condition. The portable `Text` namespace does not currently expose a numeric
code-point operation.

[DECIDED] M4.134 is analysis-only. It selects bounded `new`-expression
structural/canonical support as the next remediation because that path covers
two functions and 21 parameter rows. M4.135 owns the shared constructor
contract and its three-leg oracle. The `quotesource` code-point rewrite
remains the following independent remediation.

## Current State / Root Cause

- [VERIFIED] The structural expression catalog contains 15 expression kinds
  but no `new`; all other parsed kinds fail with `unknown-expression-kind`
  (`packages/core/src/kir-structural/expression.ts:7-23`,
  `packages/core/src/kir-structural/expression.ts:113-177`).
- [VERIFIED] `expressionsources` declares six legacy parameters and creates
  four empty maps at lines 69-71 and 91
  (`examples/kern-canonicalizer/canonicalizer.kern:67-92`).
- [VERIFIED] A live migrated-root traversal on 2026-07-29 found exactly four
  `new` nodes, all zero-argument `Map` calls, in `expressionsources`.
- [VERIFIED] `canonicalize` declares fifteen legacy parameters and contains
  seventeen explicit profile-error throws
  (`examples/kern-canonicalizer/canonicalizer.kern:276-333`).
- [VERIFIED] A live migrated-root traversal on 2026-07-29 found exactly
  seventeen `new` nodes, all one-argument `Error` calls, in `canonicalize`.
- [VERIFIED] `quotesource` embeds the six forbidden characters in its exact
  rejection condition
  (`examples/kern-canonicalizer/canonicalizer-expression-helpers.kern:57-108`).
- [VERIFIED] The portable text dispatcher admits only `length`, `charAt`,
  `slice`, `indexOf`, and `startsWith`
  (`packages/core/src/ir/semantics/portable-string.ts:62-99`).

Evidence command:

```text
node --input-type=module -e <migrated-root new-expression traversal>
quotesource=[]
expressionsources=4x new Map()
canonicalize=17x new Error(...)
```

## What Already Works

- [VERIFIED] Empty `new Map()` is already the exact portable map-construction
  contract; argument-bearing forms fail closed
  (`packages/core/src/ir/semantics/portable-map.ts:11-14`,
  `packages/core/src/ir/semantics/portable-map.ts:60-64`).
- [VERIFIED] `throw new Error(<one string expression>)` is already the
  portable error contract shared by the reference runner and both emitted
  legs (`packages/core/src/ir/semantics/portable-error.ts:2-22`,
  `packages/core/src/ir/semantics/portable-error.ts:32-67`).
- [VERIFIED] M4.133 already authenticates the exact three residual identities,
  six character blockers, current 104/112 base, and zero limit candidates
  (`scripts/kern-canonicalizer/projection-analysis-m4-133.json`).
- [DECIDED] M4.134 therefore does not modify source, structural KIR, runtime,
  profile limits, ABI, or coverage. It freezes the remediation decision only.

## Contract

> Verified against current source and live migrated-root traversal on
> 2026-07-29.

| Behavior | Evidence | Tag |
|---|---|---|
| Consume exact M4.133 digest and three-function population | `projection-analysis-m4-133.json` | VERIFIED |
| Preserve six exact `quotesource` character blockers | `canonicalizer-expression-helpers.kern:105` | VERIFIED |
| Count exactly 4 `new Map()` nodes | live migrated-root traversal | VERIFIED |
| Count exactly 17 `new Error(...)` nodes | live migrated-root traversal | VERIFIED |
| Bind Map arity 0 and Error arity 1 | `portable-map.ts:60-64`, `portable-error.ts:38-47` | VERIFIED |
| Rank constructor support at 2 functions / 21 rows | M4.133 parameter rows 6 + 15 | VERIFIED |
| Rank code-point rewrite at 1 function / 2 rows | M4.133 `quotesource` row | VERIFIED |
| Select constructor support and hand M4.135 its contract | deterministic ranking | DECIDED |
| Change no source/runtime/KIR/profile/ABI/coverage | analysis-only boundary | DECIDED |

## Implementation Options

### A — Bounded constructor-expression support (selected)

Publish the exact two-constructor population and select a shared `new`
expression contract. M4.135 must preserve the already-supported runtime
shapes: zero-argument `Map` and one-argument `Error`, add structural
projection/validation and KERN canonical-source emission, and reject
unsupported constructor shapes.

This covers two functions and 21 direct parameter rows. It changes a shared
contract only in M4.135, where the skew and three-leg oracle can be tested
together.

### B — `quotesource` numeric code-point rewrite (deferred)

Add a portable numeric `Text.codePointAt` operation and rewrite the character
condition to compare integer code points. This removes all six source
character blockers without weakening the canonical text policy, but covers
only one function and two parameter rows.

### C — Relax the text-character profile (rejected)

Allow the six characters directly. This conflicts with the current
`quotesource` behavior, which returns an empty sentinel for those same
characters. A profile-only relaxation would certify a canonical surface the
KERN-authored serializer deliberately rejects.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-m4-134-remediation-analysis/spec.md` | add | Claim/evidence boundary |
| `remediation-analysis-m4-134.{mjs,json,test.mjs}` | add | Live measurement, immutable receipt, drift oracles |
| `coverage-m4-134-central.mjs` | add | Exact release-wall assertions |
| `coverage-status-m4-134.{mjs,test.mjs}` | add | Publish M4.135 handoff |
| `check-kern-canonicalizer-coverage.mjs` | modify | Make evidence release-blocking |
| current coverage summaries | regenerate | Bind the new evidence implementation |

## Acceptance Criteria

- [x] RED fails because the M4.134 owner/status modules are absent.
- [x] Exact M4.133 digest, source commit, and three residual identities bind.
- [x] The live migrated roots reproduce exactly 4 `Map` and 17 `Error`
      constructor expressions, with arities 0 and 1 respectively.
- [x] All six `quotesource` blockers remain exact.
- [x] Constructor remediation is exactly two functions and 21 parameter rows.
- [x] Code-point remediation is exactly one function and two parameter rows.
- [x] Deterministic ranking selects constructor support.
- [x] Receipt mutation, decoration, sharing, cycles, symlinks, and byte drift
      fail closed.
- [x] M4.133 and all earlier receipts remain immutable.
- [x] Source, KIR, runtime, ABI, limits, and 104/112 coverage remain unchanged.
- [x] Status assigns M4.135 the bounded constructor contract and keeps
      `quotesource` remediation pending.
- [x] Focused tests, complete canonicalizer, and full KERN 5 gates pass.
- [x] Six-engine Agon review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main verifies.

## Verification Evidence

- [VERIFIED] Focused M4.134 tests pass 5/5, including exact decision,
  receipt mutation/decorated/shared/cyclic rejection, immutable M4.133 input,
  fresh locale-independent loading, and status.
- [VERIFIED] The complete canonicalizer gate passes 615/615 Node tests plus
  55 golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
  fixtures, and 235 hostile fixtures.
- [VERIFIED] Coverage remains exactly 104/112 and binds implementation digest
  `123d447967d471d873e5068786379ccffea4e177963480e844945172f750b41c`.
- [VERIFIED] The complete `pnpm fitness:kern-5` wall exits 0, including
  workspace tests/builds, 434/434 cross-target fixtures, 109/109 class
  fixtures, 233 native tests with 100% declared coverage, runner/self-host
  smoke, app behavior, drift showcase, KIR proofs, runtime ABI and
  internalization, source-runner convergence, and the final canonicalizer
  gate.
- [VERIFIED] The canonical M4.134 receipt digest is
  `0023de4d890d0a1b25783f3a6f6ded2985285bb98664df210533744b6ac9e286`.

## Out of Scope

- Adding `new` to structural KIR or the coverage family registry.
- Changing KERN canonicalizer expression emission.
- Adding `Text.codePointAt` or rewriting `quotesource`.
- Migrating any of the three legacy parameter signatures.
- KIR v1 freeze, runtime cutover, RC/stable release, Fable, or KERN 5
  completion.

## Open Questions

None for M4.134. M4.135 must choose and freeze the canonical field shape for
the bounded constructor expression before changing the shared structural
contract.

## Deploy Order

M4.134 is additive evidence and can publish without skew. M4.135 must ship
structural projection, validation, KERN source emission, runtime parity
oracles, and fail-closed unsupported-shape tests atomically because partial
support would let one producer emit a value another consumer cannot read.

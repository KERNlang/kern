# KERN 5 R2 M4.133 — Three-Function Projection Frontier

**Status:** REVIEWED — PENDING PUBLISH
**Date:** 2026-07-29
**Confidence:** 0.97

## Executive Summary

[VERIFIED] M4.132 is published on `main` at
`0899f689fbe1b91471d89b380447f3bcf27dd3a0`. Its immutable receipt freezes
the exact current 104/112 canonicalizer frontier: three legacy-parameter
functions, no parameter-ready queue, and no actionable profile widening.

[VERIFIED] `quotesource` projects at the already-active KIR limits and has
profile rows 54/82/932, below all active profile limits. Its only remaining
blockers are six exact canonical text-character exclusions.

[VERIFIED] `expressionsources` and `canonicalize` remain unsupported with
`unknown-expression-kind` even when all three structural KIR axes are doubled.
Their authenticated non-projection blockers are respectively the unknown
`let.value` and `throw.value` expression kinds.

[DECIDED] M4.133 publishes projection/canonical-surface evidence only. It
selects no KIR or profile promotion and changes no source or runtime behavior.
M4.134 owns source/canonical-surface and expression-support remediation
analysis.

## Inputs

- [VERIFIED] Input commit:
  `0899f689fbe1b91471d89b380447f3bcf27dd3a0`.
- [VERIFIED] M4.132 receipt SHA-256:
  `1f260e985d3fd8990a387da07144eca4f59c22a3133407b6c408e26e597b521e`.
- [VERIFIED] M4.132 reason-assignment SHA-256:
  `a3383dd12d41a3beaca9bf9c0de49ddadc9333c99ca7b14162e0a01ebdb0d338`.
- [VERIFIED] Current cumulative base: 104/112.
- [VERIFIED] Current KIR limits: 273051 bytes, depth 98, 5313 nodes.
- [VERIFIED] Current profile limits: 202 node rows, 308 property rows, 4493
  value rows.

## Contract

| Behavior | Tag |
|---|---|
| Bind the exact M4.132 receipt and assignments | DECIDED |
| Reproduce exactly three live residual function identities | DECIDED |
| Probe current and doubled structural KIR axes | DECIDED |
| Record `quotesource` as projectable at current limits | DECIDED |
| Preserve all six canonical text-character blockers | DECIDED |
| Record both other functions as `unknown-expression-kind` | DECIDED |
| Preserve each non-projection source blocker | DECIDED |
| Publish zero changed settings and zero candidates | DECIDED |
| Publish a null selected action | DECIDED |
| Preserve source, KIR, profile, runtime, ABI, and coverage | DECIDED |
| Route M4.134 to remediation analysis | DECIDED |

## Exact Requirements

1. `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource`
   - Outcome: projected
   - Parameter rows: 2
   - Profile rows: 54/82/932
   - Required KIR changes: none
   - Required profile changes: none
   - Canonical-surface blockers:
     - `if.properties.cond.expression.text.character-u007f`
     - `if.properties.cond.expression.text.character-u0080`
     - `if.properties.cond.expression.text.character-u009f`
     - `if.properties.cond.expression.text.character-u2028`
     - `if.properties.cond.expression.text.character-u2029`
     - `if.properties.cond.expression.text.character-ufeff`
2. `examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources`
   - Outcome: unsupported
   - Parameter rows: 6
   - Projection code: `unknown-expression-kind`
   - Source blocker: `let.value:unknown-expression-kind`
3. `examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize`
   - Outcome: unsupported
   - Parameter rows: 15
   - Projection code: `unknown-expression-kind`
   - Source blocker: `throw.value:unknown-expression-kind`

## Design

### Projection measurement

The owner loads the exact M4.132 receipt, measures current live coverage, and
requires the live legacy-function ids and reasons to reproduce the published
assignments exactly. Each legacy signature is migrated in memory.

Projectable functions are tested against the current KIR limits. Unsupported
functions are also tested against a probe that doubles only `maxBytes`,
`maxDepth`, and `maxNodes` while preserving every other structural limit. An
unchanged `unknown-expression-kind` result proves that limit widening cannot
remove those blockers.

### Candidate boundary

A candidate may exist only if a projected function requires at least one
current KIR or profile limit to increase and the resulting setting completes a
residual function without deleting a canonical-surface blocker. `quotesource`
requires no increase and retains six canonical-surface blockers. The other two
functions do not project. Therefore:

- projected functions: one;
- canonical-surface functions: one;
- unsupported functions: two;
- observed changed settings: zero;
- candidates: zero; and
- selected action: null.

### Handoff

The exact status reports the bounded no-candidate result and directs M4.134 to
investigate source/canonical-surface and expression-support remediation. It
makes no KERN 5 completion, runtime-cutover, KIR v1 freeze, self-hosting, or
release claim.

## Implementation Plan

1. Add RED owner, mutation, fresh-process, central, and status tests.
2. Implement live projection measurement and write the canonical receipt.
3. Wire the M4.133 receipt and status into the central coverage gate.
4. Regenerate current coverage summaries twice and prove semantic stability.
5. Run focused tests, complete canonicalizer and KERN 5 gates, six-engine Agon
   review, then sign, fetch/rebase, and push once.

## Acceptance Criteria

- [x] RED fails before M4.133 owner/status modules exist.
- [x] Exact M4.132 receipt and assignments authenticate.
- [x] Exactly three live residual functions reproduce.
- [x] `quotesource` projects at current limits with 54/82/932 rows.
- [x] All six `quotesource` canonical-surface blockers remain exact.
- [x] Both unsupported functions retain `unknown-expression-kind` under the
      doubled structural probe.
- [x] Their `let.value` and `throw.value` source blockers remain exact.
- [x] No changed setting or actionable candidate is published.
- [x] Selected action is null.
- [x] Receipt mutation, decoration, sharing, cycles, symlinks, and byte drift
      fail closed.
- [x] All M4.132 and earlier evidence remains immutable.
- [x] Complete canonicalizer and full KERN 5 gates pass.
- [x] Six-engine Agon review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main verifies.

## Stop Conditions

- The M4.132 digest, assignment digest, or live residual identities differ.
- `quotesource` requires a KIR/profile increase or loses a canonical blocker.
- Either unsupported function projects under the doubled probe.
- Any actionable candidate appears.
- Publishing evidence requires changing source, limits, runtime, ABI, or
  cumulative coverage.

## Out of Scope

- Rewriting `quotesource`, `expressionsources`, or `canonicalize`.
- Adding expression kinds or changing canonical character policy.
- Promoting KIR/profile/runtime limits or migrating parameters.
- KIR v1 freeze, runtime cutover, semantic self-hosting, RC/stable release,
  Fable, or KERN 5 completion.

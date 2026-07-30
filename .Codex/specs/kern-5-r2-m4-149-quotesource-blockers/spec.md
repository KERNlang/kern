# KERN 5 R2 M4.149 Quotesource Canonical-Surface Investigation

**Status:** READY TO BUILD
**Date:** 2026-07-30
**Confidence:** 0.98

## Executive Summary

M4.149 will publish immutable evidence for the exact source rewrite that breaks the
last canonicalizer bootstrap cycle. The remaining `quotesource` function rejects six
unsafe characters at runtime by naming those same characters in its KERN predicate;
the coverage profile therefore rejects the predicate before the function can become
base-complete. The selected remediation replaces the six forbidden literals with
three open ranges bounded by admitted neighboring characters, while preserving the
predicate over every Unicode scalar value. M4.149 is evidence-only; M4.150 owns the
checked-in KERN source rewrite.

## Current State / Root Cause

- **VERIFIED:** M4.148 freezes exactly one residual function,
  `canonicalizer-expression-helpers.kern#5:quotesource`, with two parameter rows,
  structural rows `54/82/932`, and precisely six text-character blockers.
  Evidence: `scripts/kern-canonicalizer/coverage-residual-analysis-m4-148.json:2-22`.
- **VERIFIED:** The source predicate directly embeds U+007F, U+0080, U+009F,
  U+2028, U+2029, and U+FEFF as string literals in the branch that rejects unsafe
  output. Evidence:
  `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern:88-108`.
- **VERIFIED:** Coverage rejects those literals because its text-expression profile
  forbids U+007F-U+009F, U+2028, U+2029, and U+FEFF. Evidence:
  `scripts/kern-canonicalizer/coverage-profile.mjs:93-108`.
- **VERIFIED:** KERN ordered string comparison is defined by Unicode code-point
  ordering, not host locale or UTF-16 unit ordering. Evidence:
  `packages/core/src/core-contracts/semantics.ts:102-116` and
  `packages/core/src/core-contracts/semantics.ts:223-232`.
- **VERIFIED:** An in-memory candidate using the admitted open intervals
  `("~", U+00A0)`, `(U+2027, U+202A)`, and `(U+FEFE, U+FF00)` produced zero profile
  blockers, retained rows `54/82/932`, and had zero predicate mismatches across all
  Unicode scalar values. Evidence: Node 22 candidate probe on 2026-07-30 returned
  `{"blockers":[],"mismatches":0,"rows":{"nodes":54,"properties":82,"values":932}}`.
- **VERIFIED:** M4.134 already classified this residual as
  `quotesource-code-point-rewrite`; M4.149 resolves the previously unspecified
  operation to the existing portable code-point ordering contract rather than adding
  a new text primitive. Evidence:
  `scripts/kern-canonicalizer/remediation-analysis-m4-134.json:29-48`.

## What Already Works

- The current unsafe-character set is correct and remains unchanged.
- The KERN runtime already owns portable Unicode code-point string ordering.
- Existing profile limits are sufficient; M4.148 proves there is no useful profile
  widening.
- The `quotesource` function's parameters, structure, fast path, escaping behavior,
  and row counts do not need to change.

## Contract (Verified)

> Verified against the current `origin/main` source at
> `44ca4feda2901c16f79c7c5c40ede69394e60404` on 2026-07-30.

| Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| M4.149 input | Exact M4.148 receipt digest `bf5b7c6886f7f114995f59d916f4a87ecc2ea3f7fffc5289448d7ebb32abde2f` | `scripts/kern-canonicalizer/coverage-residual-analysis-m4-148.mjs:17-20` | VERIFIED |
| Current blocked set | U+007F, U+0080-U+009F, U+2028, U+2029, U+FEFF | `scripts/kern-canonicalizer/coverage-profile.mjs:93-105` | VERIFIED |
| First open interval | `c > "~" && c < "\u00a0"` equals U+007F-U+009F | Exhaustive Node 22 probe, 2026-07-30 | VERIFIED |
| Second open interval | `c > "\u2027" && c < "\u202a"` equals U+2028-U+2029 | Exhaustive Node 22 probe, 2026-07-30 | VERIFIED |
| Third open interval | `c > "\ufefe" && c < "\uff00"` equals U+FEFF | Exhaustive Node 22 probe, 2026-07-30 | VERIFIED |
| Candidate admission | Zero blockers; rows remain `54/82/932` | In-memory migrated-function probe, 2026-07-30 | VERIFIED |

## Implementation Plan

Publish one canonical `canonical-surface-analysis-m4-149` receipt that:

1. Authenticates the exact M4.148 handoff, current `quotesource` owner, and current
   blocked predicate.
2. Builds the neighbor-sentinel candidate in memory without changing repository KERN
   source.
3. Exhaustively compares the old and candidate predicates across all 1,112,064
   Unicode scalar values through the actual core string-ordering contract.
4. Proves the migrated candidate has zero profile blockers and unchanged row counts,
   then selects `quotesource-neighbor-sentinel-rewrite` for M4.150.
5. Adds canonical loader/hostile mutation tests and wires the chronological M4.149
   status into the coverage gate.

Adding evidence modules changes the coverage implementation digest. Regenerate the
live coverage and prerequisite summaries; every semantic field must remain identical
to M4.148's baseline, with only the implementation digest changing.

Alternatives are not real contenders:

- Adding a new `Text.codePointAt`-style primitive expands a shared runtime/codegen
  contract when the existing ordered-string contract already proves the rewrite.
- Allowlisting the six literals in coverage would weaken the canonical surface and
  preserve the bootstrap cycle instead of removing it.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-m4-149-quotesource-blockers/spec.md` | Add | Claim-tagged cross-slice contract |
| `scripts/kern-canonicalizer/canonical-surface-analysis-m4-149.mjs` | Add | Measure, validate, load, and write exact remediation evidence |
| `scripts/kern-canonicalizer/canonical-surface-analysis-m4-149.json` | Add | Immutable published receipt |
| `scripts/kern-canonicalizer/canonical-surface-analysis-m4-149.test.mjs` | Add | RED/green, exhaustive, mutation, loader, and process oracles |
| `scripts/kern-canonicalizer/coverage-m4-149-central.mjs` | Add | Central live/published assertion |
| `scripts/kern-canonicalizer/coverage-status-m4-149.mjs` | Add | Exact M4.150 handoff text |
| `scripts/kern-canonicalizer/coverage-status-m4-149.test.mjs` | Add | Status contract |
| `scripts/check-kern-canonicalizer-coverage.mjs` | Modify | Run and print M4.149 after M4.148 |
| `scripts/kern-canonicalizer/coverage-summary.json` | Regenerate | Bind the new implementation digest |
| `scripts/kern-canonicalizer/coverage-prerequisite-summary.json` | Regenerate | Bind the new implementation digest |

## Acceptance Criteria

- [ ] RED is demonstrated by the missing immutable M4.149 receipt.
- [ ] The receipt pins the exact M4.148 digest and input commit.
- [ ] The current source must contain exactly one authenticated old predicate; missing,
      duplicated, or modified source fails closed.
- [ ] The candidate predicate uses only the six exact admitted sentinels:
      U+007E, U+00A0, U+2027, U+202A, U+FEFE, and U+FF00.
- [ ] The old and candidate predicates match over all 1,112,064 Unicode scalar values.
- [ ] Boundary-killer tests cover every sentinel, every blocked edge, astral values,
      and malformed surrogate inputs.
- [ ] The candidate migrated function has zero profile blockers and retains rows
      `54/82/932` and two parameter rows.
- [ ] The receipt selects `quotesource-neighbor-sentinel-rewrite` and hands source
      ownership to M4.150.
- [ ] The receipt is canonical JSON, immutable plain data, exact-digest bound,
      locale/timezone independent, and rejects missing/directory/symlink/malformed/
      noncanonical inputs.
- [ ] M4.148 remains byte-identical.
- [ ] No KERN source, coverage policy, canonicalizer policy, runtime, package, or public
      API changes in M4.149.
- [ ] Focused tests, `pnpm test:kern-canonicalizer`, and `pnpm fitness:kern-5` pass.
- [ ] `agon review uncommitted -e claude,codex,agy` reports no verified blocker.

## Out of Scope

- Editing `canonicalizer-expression-helpers.kern` or its composed output.
- Migrating `quotesource` parameters or promoting coverage to 112/112.
- Changing the forbidden character set or coverage policy.
- Adding a text/code-point runtime primitive.
- KIR v1 freeze, public reader export, or runtime cutover.

## Open Questions

None. There are no ASSUMED or OPEN claims in the selected path.

## Deploy Order

M4.149 evidence ships first and has no runtime skew. M4.150 may then consume its exact
receipt to change the KERN source. Any later parameter migration or coverage promotion
must consume post-rewrite evidence rather than bypassing this handoff.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| M4.134 named a required `portable-text-code-point-operation`, suggesting a new primitive might be necessary. | Existing KERN ordered string comparison already provides portable Unicode code-point ordering and the neighbor-sentinel rewrite is exhaustive. | M4.149 selects a source-only rewrite and explicitly rejects runtime/API expansion. |
| The first boundary test treated tab, newline, and carriage return as false for the isolated unsafe-character predicate. | The predicate's leading `c < " "` is true for all U+0000-U+001F; earlier `quotesource` branches make tab, newline, and carriage return unreachable at this predicate. | The oracle now tests the exact predicate domain while retaining the full-function control-flow distinction. |

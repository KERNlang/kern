# KERN 5 F4-A4 Decorator Closure

**Status:** READY TO BUILD
**Date:** 2026-08-22
**Confidence:** 0.98

## Executive Summary

Close F4-A4 as a bounded evidence and semantic-closure slice over the
authenticated F3 decorator-run transport. The slice proves one F4 decorator
row per grammar-valid decorator, exact attachment/export behavior for a
contiguous run, exact dropped behavior for EOF, indentation, non-`fn`, and
detached targets, malformed-line segregation, and one ordered
`DROPPED_DECORATOR` warning per dropped row.

This is not a parser, lexer, F3, receipt, ABI, policy-format, or diagnostic-
vocabulary redesign. Production changes are allowed only if a discriminating
RED demonstrates that the existing KERN-owned projection is wrong.

## Current State / Root Cause

- **[VERIFIED]** F3 transports only `candidate`, `orphan-eof`, and
  `orphan-indent` decorator-run dispositions, with exact run bounds and
  successor constraints (`scripts/kern-frontend-f3-line-tree/decoder.mjs:132-150`).
- **[VERIFIED]** F3 independently reconstructs every maximal same-indent
  decorator run from logical lines and rejects unequal adjacency evidence
  (`scripts/kern-frontend-f3-line-tree/decoder.mjs:264-288`).
- **[VERIFIED]** F4 currently maps each line whose eligibility kind is
  `decorator` to one six-field row, attaches only a `candidate` whose successor
  is an in-range, same-indent, non-detached `fn`, and propagates explicit export
  only for an attached decorator (`examples/kern-frontend/f4-line-eligibility.kern:153-234`).
- **[VERIFIED]** The decorator diagnostic phase emits one
  `DROPPED_DECORATOR` warning from every dropped decorator row and then uses
  the common C14 merge (`examples/kern-frontend/f4-diagnostic-merge.kern:209-232`).
- **[VERIFIED]** Existing tests prove one attached decorator, one explicit
  export, one non-`fn` drop, one isolated drop, malformed syntax segregation,
  and a detached target drop (`scripts/kern-frontend-f4-declarations/document.test.mjs:129-163`,
  `scripts/kern-frontend-f4-declarations/line-eligibility.test.mjs:167-277`,
  `scripts/kern-frontend-f4-declarations/a6-detached-closure.test.mjs:156-176`).
- **[VERIFIED]** The remaining A4 acceptance row is still `PROPOSED` and names
  runs, explicit export, EOF, indentation mismatch, non-`fn` substitution,
  malformed syntax, and one diagnostic per dropped decorator
  (`.Codex/specs/kern-5-f4-declarations-modules/spec.md`, F4-A4).

The gap is therefore an acceptance gap unless the new matrix finds a semantic
counterexample. Current tests do not bind multi-row run cardinality/order to
F3 run geometry or prove the EOF/indent dispositions and warning multiplicity
through the real public F4 path.

## What Already Works

- Native decorator lexical eligibility, argument retention, legacy whitespace,
  inline comments, explicit export, and malformed-line rejection are already
  covered. This slice reuses those contracts and adds only cross-row closure.
- A6 already makes a decorator on a detached target `dropped`, suppresses its
  export effect, and emits one warning. No detached-closure redesign belongs
  here.
- C14 already owns global diagnostic order. A4 asserts the observable ordered
  result; it does not add host sorting or a decorator-local order protocol.
- F3 already authenticates run geometry. F4 consumes it and must not infer
  runs from source text or bootstrap parser output.

## Contract

> Verified against `origin/main` `d4a8f5313c42e12e67a76af98edc9c172cb256a0`
> on 2026-08-22.

| Behavior | Required result | Evidence | Tag |
| --- | --- | --- | --- |
| Run cardinality | Every grammar-valid decorator logical line produces exactly one F4 decorator row in source order. | `f4-line-eligibility.kern:199-233` | VERIFIED |
| Candidate attachment | Every decorator in one candidate run attaches to the same immediate same-indent, non-detached `fn`. | `f4-line-eligibility.kern:207-232` | VERIFIED |
| Explicit export | An attached explicit decorator exports its target; a dropped explicit decorator never does. | `f4-line-eligibility.kern:227-232` | VERIFIED |
| EOF orphan | Every row in an F3 `orphan-eof` run is dropped with target `-1`. | F3 vocabulary at `decoder.mjs:132-150`; F4 predicate at `f4-line-eligibility.kern:227-229` | VERIFIED |
| Indent orphan | Every row in an F3 `orphan-indent` run is dropped with target `-1`. | F3 reconstruction at `decoder.mjs:272-285`; F4 predicate at `f4-line-eligibility.kern:227-229` | VERIFIED |
| Non-`fn` target | A grammar-valid candidate run followed by a non-`fn` line is dropped without changing that target's independent classification. | `f4-line-eligibility.kern:224-229`; A1 witness `a1-a2-a11-evidence.test.mjs:72-94` | VERIFIED |
| Detached target | A candidate run whose target is in the A6 detached closure is dropped and cannot export. | `f4-line-eligibility.kern:174-186,226-232`; `a6-detached-closure.test.mjs:156-176` | VERIFIED |
| Malformed syntax | A malformed decorator candidate produces no decorator row and no `DROPPED_DECORATOR`; M1.1 eligibility owns its fact/diagnostic. | `line-eligibility.test.mjs:230-268` | VERIFIED |
| Dropped diagnostic | Every dropped row emits exactly one warning at that decorator row's scalar span and logical ordinal. | `f4-diagnostic-merge.kern:218-225` | VERIFIED |
| Global order | Decorator warnings participate in C14 source/rank ordering; A4 adds no sorting or deduplication. | `f4-diagnostic-merge.kern:355-482` | VERIFIED |
| Identity | Policy remains `.4`, document remains `.2` with 17 fields, and private ABI remains 109. | `policy.json:2-6`; `a6-detached-closure.test.mjs:250-258` | VERIFIED |

## Implementation Plan

There is one real approach: extend the F4 declarations test corpus with a
public-path A4 matrix and structural mutation controls. If the baseline is
green, this is an evidence-only slice. If a case is RED for the specified
semantic reason, trace the F3 transport through `f4decoratorrows` and
`f4diagdecoratorphase`, then make the smallest KERN-owned repair.

An AST/lexer rewrite, source lookahead, new receipt fields, or new diagnostic
codes are strawmen because F3 already transports authenticated run geometry
and the vocabulary is frozen.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `.Codex/specs/kern-5-f4-m1-a4-decorator-closure/spec.md` | Add | Freeze A4 scope and acceptance. |
| `scripts/kern-frontend-f4-declarations/a4-decorator-closure.test.mjs` | Add | Public-path D1-D10 evidence and source mutation guards. |
| `scripts/kern-frontend-f4-declarations/worker.mjs` | Test-only change if required | Private, descriptor-shaped F3 transport mutation seam for D10; public `runDocument` stays unchanged. |
| `examples/kern-frontend/f4-line-eligibility.kern` | Conditional | Only if a semantic RED proves row/attachment behavior wrong. |
| `examples/kern-frontend/f4-diagnostic-merge.kern` | Conditional | Only if a semantic RED proves warning multiplicity/order wrong. |
| `scripts/kern-frontend-f4-declarations/policy.json` | Conditional | Update only changed composition SHA pins. |
| Parent F4 spec and completion goal | Final evidence update | Mark A4 verified without promoting F4 or terminal gates. |

## Acceptance Criteria

- **[A4-D1] Attached run.** Two same-indent decorators followed immediately by
  a same-indent `fn` yield two ordered `attached` rows targeting that function,
  exact scalar spans, zero dropped warnings, and one target export if exactly
  one row is explicit.
- **[A4-D2] Explicit dropped isolation.** An explicit decorator followed by a
  non-`fn` or detached `fn` is `dropped`, target `-1`, emits no export/symbol
  effect, and produces exactly one warning.
- **[A4-D3] EOF run.** A two-row F3 `orphan-eof` run yields two ordered dropped
  rows and two warnings at the decorators' own logical ordinals/spans.
- **[A4-D4] Indent-orphan run.** A two-row F3 `orphan-indent` run yields two
  ordered dropped rows and two warnings; the differently indented successor is
  classified independently and never becomes their target.
- **[A4-D5] Non-`fn` substitution.** Equal-geometry `fn` and non-`fn` sources
  retain equal F3 decorator-run fields while F4 diverges to attached versus
  dropped rows without changing the non-`fn` target's ordinary classification.
- **[A4-D6] Malformed segregation.** At least two malformed forms adjacent to a
  valid target produce no decorator rows, no dropped warnings, and retain the
  frozen M1.1 fact/diagnostic behavior.
- **[A4-D7] Detached compatibility.** The A6 detached-target case remains one
  dropped row/warning and no export, declaration, symbol, binding, or evidence
  effect from the target.
- **[A4-D8] Composite order.** One document containing an attached run, a
  non-`fn` drop, an indentation orphan, an EOF orphan, and a malformed candidate
  has exact decorator partitions and one warning per valid dropped row, sorted
  monotonically by `(startScalar, phase, ruleRank)` through C14. The malformed
  row contributes no dropped warning.
- **[A4-D9] Identity and isolation.** Public `runDocument.length` stays `2`;
  policy `.4`, document `.2`, 17 fields, and private ABI 109 remain exact.
- **[A4-D10] Authenticated transport.** Well-shaped F3 decorator-run mutations
  (delete, duplicate, reorder/swap, successor, disposition) invoke real F4 once
  and reject atomically with `F4_F3_DRIFT`. Malformed outer transport remains
  `F4_INVALID_REQUEST`. No ordinary partition escapes.
- **[A4-D11] Structural oracle.** Source inspection proves the F4 row loop uses
  every transported run bound/disposition and emits one row per grammar-valid
  decorator; the diagnostic loop emits one warning per dropped row. Canaries
  that change “per row” to “per run,” ignore disposition, attach regardless of
  target kind, or suppress the dropped-row loop must fail.
- **[A4-D12] Mutation strength.** Before any production edit, isolated source
  mutations corresponding to D3, D4, D5, D8, and D10 must be killed by at least
  three distinct semantic families. If fewer than three families discriminate,
  strengthen the oracle and do not implement.
- Focused A4, adjacent A6/C13/document/line-eligibility, and the complete F4
  declarations wall pass with zero fail/skip. Lint, repository consistency,
  policy path/order/SHA validation, deterministic authority regeneration, and
  `git diff --check` pass.
- Automatic-risk Agon review using the actual primary implementer identity has
  no unresolved verified blocker.

## Out of Scope

- F0–F3 source or receipt changes.
- Decorator argument interpretation beyond the existing opaque string value.
- New decorator kinds, diagnostic codes, ranks, severity, or recovery modes.
- A5 property closure, A3 26-form corpus, F4B graph/C15, F5 projection, terminal
  frontend promotion, publication, or release.
- Performance/scaling promotion beyond regression protection for this small
  semantic matrix; A9 remains M3.

## Deploy Order

The spec and RED oracle land before or with any conditional KERN repair. If a
KERN composition source changes, its policy descriptor SHA changes atomically
in the same commit. There is no mixed-version public skew window because the
document/policy formats and ABI do not change; source and policy pins must still
deploy together. Parent acceptance docs update only after the final reviewed
candidate is green.

## Kill Switches

Stop and respec if the slice requires:

1. any F0, F1, F2, F2B, or F3 source/receipt change;
2. host-side source classification, decorator lookahead, sorting, or dedup;
3. a new diagnostic code/rank/severity or malformed-as-dropped behavior;
4. a policy-format, document-format, 17-field receipt, or ABI-109 change;
5. weakening A6 detached closure, C13 admission, C14 ordering, or atomic fatal
   partitions;
6. a feature flag, fallback, TypeScript semantic delegation, or bootstrap
   parser result as F4 input;
7. production edits without a genuine semantic RED; or
8. fewer than three mutation-killing RED families.

## Corrections Log

| Original claim | Verified correction | Impact |
| --- | --- | --- |
| A4 is an unimplemented decorator parser/AST subsystem. | F3 run geometry and F4 decorator projection already exist; the current gap is acceptance closure unless RED proves otherwise. | Keep the slice evidence-level and narrow. |
| A5 must precede A4 because property behavior is broadly absent. | Many high-risk A5 behaviors already have tests; A5 needs a subtraction audit before its bounded remainder is specified. | A4 is the sharper immediate slice. |
| The whole 26-form A3 corpus can move to M3. | Semantic coverage remains an M1 dependency; scale/adversarial expansion belongs in M3. | Sequence A4, A5 remainder, A3 semantic, then M2/M3. |
| One dropped diagnostic per run is sufficient. | The frozen F4 contract maps each grammar-valid decorator row independently; every dropped row requires its own warning. | D3/D4/D8 assert row cardinality and spans. |

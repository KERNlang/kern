# KERN 5 F1 Runtime Text Cache Prerequisite

**Status:** IMPLEMENTED — FULL WALL PENDING

**Date:** 2026-08-13

**Baseline:** `4330f42866d8e3d1534e471881d17b870c067106`

**Tribunals:**

- `tribunal-1786631014526-n25590` (`claude,codex,agy`, 3/3) selected the
  execution-local cache.
- `tribunal-1786631874182-yl58i3` (`claude,codex,agy`, 3/3) caught validation
  before lookup and required an opaque lookup-first store.
- `tribunal-1786633247008-cdxl9t` (`claude,codex,agy`, 3/3) required a new
  chained 317-to-316 historical transition before the Text.splice transition;
  clean builds then refined five changed TypeScript owners to four changed
  retained JavaScript owners plus one byte-identical type-only owner.
- `tribunal-1786652415894-8zgvr8` (`claude,codex,agy`, 3/3) rejected
  exception-producing cache exhaustion, retained the sparse astral-position
  representation, and required outcome-transparent fallback plus generated-leg
  diagnostic ordering.

**Confidence:** 0.77 after independent review; 0.94 after the corrective
tribunal, RED evidence, source trace, and 65K scalar-tape proof.

## Decision

- **[RTC-D1 DECIDED]** Preserve the existing public `Text.length`,
  `Text.charAt`, `Text.slice`, `Text.indexOf`, and `Text.startsWith` contract.
  Add no KIR node, syntax, public namespace member, array result, or typed-array
  ABI.
- **[RTC-D2 DECIDED]** The internal effect machine may memoize a sparse index
  of astral scalar positions for a text value within one execution only. The
  cache is execution state, not a semantic binding, result, event, capability,
  receipt, or module-global.
- **[RTC-D3 DECIDED]** The cache store is opaque. A hit is authoritative because
  exact primitive string values are immutable and only a successfully
  validated miss can be inserted. A miss is validated as well-formed UTF-16
  before insertion. Malformed text never enters the cache and retains the
  current fail-closed behavior.
- **[RTC-D4 DECIDED]** Cache retention is bounded independently of result
  `maxBytes` by a conservative two-maximum-entry capacity derived from
  `maxStringBytes`. Each entry charges fixed overhead, retained UTF-16 key
  storage, and four bytes per astral scalar position. LRU eviction preserves
  the two hot operands required by the F1 scalar walk.
- **[RTC-D5 DECIDED]** Admission cost is proven before the only
  input-proportional allocation. An uncacheable value is validated and handled
  by an allocation-free scan; cache admission, eviction, or absence never
  changes values, diagnostics, completion, events, or source/KIR eligibility.
- **[RTC-D6 DECIDED]** This slice closes the reference-runner prerequisite for
  F1. Equivalent isolated scaling proof for generated TypeScript and Python is
  an explicit F7 promotion dependency, not a claim made here.
- **[RTC-D7 DECIDED]** The new compiled cache owner and all four changed
  retained compiled owners require a dedicated successor-history epoch. It is
  applied before the frozen Text.splice transition; neither the Text.splice
  transition nor any published M4.145 or pre-M4.135 digest may change.

## Root Cause

- **[RTC-C1 VERIFIED]** `packages/core/src/ir/semantics/portable-string.ts`
  calls `textCodePoints(receiver)` independently for every `Text.length`,
  `Text.charAt`, and `Text.slice` evaluation.
- **[RTC-C2 VERIFIED]** `textCodePoints` is `Array.from(s)`, so a KERN loop
  calling `Text.charAt(source, cursor)` performs a full source walk per scalar
  and is quadratic on the reference runner.
- **[RTC-C3 VERIFIED]** The current falsification probe measures only
  8/32/128-character operands with a loose 16x wall and therefore cannot
  distinguish the quadratic implementation at an F1 document scale.

## Binary Acceptance

- **[RTC-A1 ACCEPT]** RED demonstrates that the strengthened geometric
  scalar-tape scaling oracle fails at the baseline for the expected quadratic
  reason.
- **[RTC-A2 ACCEPT]** The cache is constructed only as part of a fresh sync or
  async internal-effect-machine state and is discarded with that execution.
- **[RTC-A3 ACCEPT]** Child/helper/class environments see the same active
  execution state; independent executions never share retained values.
- **[RTC-A4 ACCEPT]** Repeated `Text.length`, `Text.charAt`, and `Text.slice`
  calls on an admitted well-formed value reuse one sparse scalar index.
  `Text.indexOf` maps native UTF-16 matches back to scalar offsets, while
  `Text.startsWith` validates allocation-free and remains cache-neutral.
- **[RTC-A5 ACCEPT]** Cache removal, cross-execution retention, externally
  mutable storage, UTF-16-unit splitting, insertion-before-validation, and
  mutable-array mutations are rejected by focused tests or source validators.
- **[RTC-A6 ACCEPT]** The geometric oracle covers ASCII, astral, mixed Unicode,
  CRLF, and long-token inputs through 65,536 scalars, large enough to reject
  both quadratic rescanning and the former independent-`maxBytes` failure. It
  binds the admitted F1 cap to `maxStringBytes`-derived retention.
- **[RTC-A7 ACCEPT]** Existing Text contract, runtime-envelope, runtime-handler,
  canonicalizer, runtime-contract-v1, and scalar-tape tests remain green.
- **[RTC-A8 ACCEPT]** Runtime owner closure and historical canonicalizer
  receipts are reconciled through an exact, fail-closed 317-to-316 successor
  transition because the reachable compiled owner inventory demonstrably
  changes.

## Hard Stops

- Any cached value survives an execution boundary or becomes guest-observable.
- Any malformed value is inserted, repaired, or replaced with U+FFFD.
- Cache storage is externally injectable or an admission decision changes a
  language-visible outcome.
- The production F1 scaling claim is extended to internally-created strings
  larger than `maxStringBytes`; those values retain correct uncached semantics
  but are outside this slice's admitted-source scaling bound.
- The non-promoting slice is described as generated-code parity or terminal
  frontend ownership.

## Exclusions

- `Array.from(source)` internal-machine admission.
- A new `Text.scalars`, iterator, cursor, numeric code-point, or typed-array
  contract.
- F1 document scanning, expression parsing, tree construction, KIR projection,
  `test:kern-frontend` promotion, compiler cutover, or release publication.

## Verification Plan

1. Strengthen and run the scalar-tape probe to capture RED at the baseline.
2. Add focused execution-state/cache tests and named source mutations.
3. Implement bounded execution-local memoization without changing Text output.
4. Run focused runtime/Text/canonicalizer gates and the strengthened probe.
5. Run the full KERN 5 fitness wall, independent Agon review, signed commit,
   and one authorized publication push before beginning F1 scanner code.

## Current Evidence

- **[RTC-V1 VERIFIED]** The baseline scaling oracle failed for the expected
  quadratic `Array.from`-per-call path.
- **[RTC-V2 VERIFIED]** RED reproduced five failures from exception-producing
  exhaustion, malformed-receiver diagnostic inversion, cache-dependent
  `startsWith`, and under-budget mixed scalar mapping. The corrected sparse
  index passes deterministic mapping, isolation, malformed-text, eviction,
  fallback, and cache-neutrality tests.
- **[RTC-V3 VERIFIED]** ASCII, astral, CRLF, and mixed 4K/16K/65K scalar walks
  scale near linearly. The first 65K astral run exposed source/alphabet cache
  thrash at 116.8 seconds; the bounded two-entry LRU correction reduces the
  same case to approximately 0.56 seconds.
- **[RTC-V4 VERIFIED]** The exact 317-to-316 successor-history reconstruction
  closes the fail-closed inventory break while preserving all frozen digests;
  the complete canonicalizer gate passes 750/750.
- **[RTC-V5 PENDING]** Corrected exact-history reconstruction, focused runtime
  gates, full KERN 5 fitness, independent Agon review, signed history commit,
  and authorized publication.

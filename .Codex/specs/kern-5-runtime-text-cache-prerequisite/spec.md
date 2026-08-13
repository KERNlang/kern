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

**Confidence:** 0.82 before challenge; 0.92 after the tribunal and source trace.

## Decision

- **[RTC-D1 DECIDED]** Preserve the existing public `Text.length`,
  `Text.charAt`, `Text.slice`, `Text.indexOf`, and `Text.startsWith` contract.
  Add no KIR node, syntax, public namespace member, array result, or typed-array
  ABI.
- **[RTC-D2 DECIDED]** The internal effect machine may memoize the immutable
  Unicode-scalar sequence for a text value within one execution only. The
  cache is execution state, not a semantic binding, result, event, capability,
  receipt, or module-global.
- **[RTC-D3 DECIDED]** The cache store is opaque. A hit is authoritative because
  exact primitive string values are immutable and only a successfully
  validated miss can be inserted. A miss is validated as well-formed UTF-16
  before insertion. Malformed text never enters the cache and retains the
  current fail-closed behavior.
- **[RTC-D4 DECIDED]** Cache retention is bounded by the accepted runtime
  `maxBytes` option. Retaining one value conservatively charges fixed entry
  overhead, UTF-16 storage, scalar-array slots, and scalar values; equal
  immutable string values share one entry. Exhaustion fails closed rather than
  silently restoring quadratic execution under a claimed scaling guarantee.
- **[RTC-D5 DECIDED]** Cached scalar arrays are frozen and never returned to
  guest code. Cache admission cannot affect values, diagnostics, completion,
  events, or source/KIR eligibility; only execution cost may improve.
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
  calls on the same well-formed value reuse one frozen scalar materialization.
  `Text.indexOf` and `Text.startsWith` retain their current observable
  semantics.
- **[RTC-A5 ACCEPT]** Cache removal, cross-execution retention, externally
  mutable storage, UTF-16-unit splitting, insertion-before-validation, and
  mutable-array mutations are rejected by focused tests or source validators.
- **[RTC-A6 ACCEPT]** The geometric oracle covers ASCII, astral, mixed Unicode,
  CRLF, and long-token inputs at sizes large enough to distinguish quadratic
  rescanning, and binds the admitted F1 cap to the available retention budget.
- **[RTC-A7 ACCEPT]** Existing Text contract, runtime-envelope, runtime-handler,
  canonicalizer, runtime-contract-v1, and scalar-tape tests remain green.
- **[RTC-A8 ACCEPT]** Runtime owner closure and historical canonicalizer
  receipts are reconciled through an exact, fail-closed 317-to-316 successor
  transition because the reachable compiled owner inventory demonstrably
  changes.

## Hard Stops

- Any cached value survives an execution boundary or becomes guest-observable.
- Any malformed value is inserted, repaired, or replaced with U+FFFD.
- Cache storage is externally injectable or exhaustion silently falls back to
  the quadratic path.
- F1 admits a source limit larger than the configured retention budget used by
  its production gate.
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
- **[RTC-V2 VERIFIED]** The corrected lookup-first implementation passes its
  deterministic isolation, immutability, malformed-text, and exhaustion tests.
- **[RTC-V3 VERIFIED]** ASCII, astral, CRLF, and mixed 1K/4K/16K scalar walks
  scale near linearly; focused runtime envelope, public ABI, source-runner, and
  runtime-contract-v1 gates pass.
- **[RTC-V4 VERIFIED]** The exact 317-to-316 successor-history reconstruction
  closes the fail-closed inventory break while preserving all frozen digests;
  the complete canonicalizer gate passes 750/750.
- **[RTC-V5 PENDING]** Full KERN 5 fitness, independent Agon review, signed
  history commit, and authorized publication.

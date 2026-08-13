# KERN 5 Runtime Rewrite Prerequisite Spike

**Status:** IMPLEMENTED AND INDEPENDENTLY REVIEWED

**Date:** 2026-08-13

**Baseline:** `41c877cf219813b9ac475b14c53c72a5a6b352de`

**Tribunal:** `tribunal-1786595931235-m2s1iv` (`claude,codex,agy`, 3/3)

**Confidence:** 0.80 before Gate 0; 0.91 after Gate 0 and the ordinary-assignment control.

## Claims

- **[RRP-D1 DECIDED]** Generic deferred scalar-assignment admission is rejected.
  It would broaden symbolic preflight and concrete evaluation rather than add a
  bounded primitive.
- **[RRP-D2 DECIDED]** Scalar freshness or snapshotting is rejected because the
  observed failures are data-dependency admission failures, not aliasing.
- **[RRP-D3 DECIDED]** A structured internal text splice remains only a
  hypothesis. It cannot help unless its replacement operand can be fully
  materialized through existing machinery before the splice commits.
- **[RRP-D4 DECIDED]** Gate 0 changes no runtime, evaluator, IR, KIR, parser, or
  public contract. It supplies a native KERN handler that scans iteratively,
  mutates scalar bindings, then calls a helper over those bindings to produce a
  materialized replacement.
- **[RRP-D5 DECIDED]** Gate 0 failure closes the runtime-splice option. The next
  investigation is compiler-level two-pass lowering, beginning with proof that
  a rewrite pass can read scan-produced offsets. No third runtime exception is
  permitted.
- **[RRP-R1 OBSERVED]** Gate 0 passed: the existing runtime materialized a
  source-sensitive helper result from loop-mutated scalar bindings without any
  runtime change.
- **[RRP-R2 OBSERVED]** Splitting the original tape rewrite into separately
  materialized prefix/replacement/suffix values still failed at the first
  `Text.slice(tape, 0, previousStart)` read of the loop-mutated tape.
- **[RRP-D6 DECIDED]** Add one exact internal `do` operation:
  `Text.splice(target, start, end, replacement, maxOutputCodePoints)`. Every
  operand is a direct binding identifier. The operation performs no expression
  evaluation, helper dispatch, coercion, getter access, or partial mutation.
- **[RRP-D7 DECIDED]** Bounds are Unicode code-point indexes and must be either
  statically known safe integers, integer-provenanced bindings, or direct
  bindings declared deferred by whole-tree preflight. Every form must satisfy
  concrete safe-integer and `0 <= start <= end <= length` checks at execution.
  The result must fit both the caller-supplied positive cap and a documented
  stable internal safety ceiling before result allocation.
- **[RRP-D8 DECIDED]** The implementation is confined to a new internal splice
  module and the existing internal `do` parser/dispatch. Any required change to
  `portable-machine-evaluator.ts`, `deferred-expression-preflight.ts`, parser,
  public IR/KIR codecs, or serialized formats stops implementation.

## Binary Acceptance

- **[RRP-A1 ACCEPT]** The baseline test fails only if the existing runtime
  rejects helper materialization over loop-mutated scalar bindings.
- **[RRP-A2 ACCEPT]** The test is source-sensitive and checks the exact helper
  output, terminal source seal, and absence of host semantic computation.
- **[RRP-A3 ACCEPT]** A passing Gate 0 raises the structured-splice plan to a new
  spec/re-score step; it does not authorize implementation by itself.
- **[RRP-A4 ACCEPT]** No file beneath `packages/` changes during Gate 0.
- **[RRP-A5 ACCEPT]** RED proves the scalar-tape probe remains rejected until
  the exact splice operation exists.
- **[RRP-A6 ACCEPT]** Focused tests reject embedded helper, index, member,
  conditional, template, binary, namespace-call, computed-target, shadowed
  namespace, non-string target/replacement, invalid bounds, and excessive
  output.
- **[RRP-A7 ACCEPT]** Rejection is atomic: the target binding remains unchanged.
- **[RRP-A8 ACCEPT]** Existing unsupported array-indexed control and composite
  deferred assignment stay rejected.
- **[RRP-A9 ACCEPT]** The lexer-inclusive scalar-tape probe emits byte-identical
  canonical expression output and passes bounded 1x/2x/4x walls.
- **[RRP-A10 ACCEPT]** Typecheck, focused runtime tests, probe tests, and existing
  runtime-envelope regression suites pass before independent review.

## Exclusions

- Public syntax, KIR/IR schema, terminal frontend ownership promotion, and
  KERN 5 release-gate promotion.

## Verification Result

- **[RRP-R3 OBSERVED]** The lexer-inclusive scalar-tape probe now tokenizes raw
  source, decodes its own frames, performs two precedence-ordered rewrites,
  and emits byte-identical canonical expression output at 1x/2x/4x sizes.
- **[RRP-R4 OBSERVED]** The entire `@kernlang/core` test suite, focused runtime
  handler/envelope suites, tokenizer parity, and successful-line composition
  checks pass. The existing mutable pointer-index abstention fence remains
  green after rejecting general integer-provenance propagation.
- **[RRP-R5 REVIEWED]** Agon review
  `review-1786597833973-pmz5yl-kern5-runtime-text-splice-valid-` used the valid
  independent roster (`claude` security, `agy` correctness): 2/2 reviewers,
  zero findings.

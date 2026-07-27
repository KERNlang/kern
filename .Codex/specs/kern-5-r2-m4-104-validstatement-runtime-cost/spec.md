# KERN 5 R2 M4.104 — Validated Statement-Source Quoting

**Status:** REVIEWED — READY TO PUBLISH
**Date:** 2026-07-27
**Confidence:** 0.98

## Executive Summary

[VERIFIED] M4.103 authenticates an exact 72,195-iteration floor for the
`validstatement` witness, 6,659 iterations above the production ceiling.
The failed production run never reaches statement emission; the successful
run adds 43 `quotesource` executions.

[VERIFIED] `quotesource` owns a KERN `for` loop over every source character.
Statement emission invokes it only on non-empty canonical expression strings
already accepted by the complete `validstatementlist` pass.

[IMPLEMENTED] M4.104 retains `quotesource` as the single quoting helper and
adds an explicit `validated` mode. The ordinary `false` path preserves the
complete character-by-character validation and escaping behavior. The
statement-emission-only `true` path uses the self-host runtime's existing
portable `Text.indexOf` and `Text.slice` operations and iterates only once per
escaped character, rather than once per source character.

[DECIDED] The optimization must lower the exact witness beneath the 65,536
production ceiling without changing canonical bytes, hostile-input verdicts,
the runtime engine, handler ABI, active profile, or any runtime limit.

## Published Input

[VERIFIED] This branch starts at exact published M4.103 commit
`7c341bb2ece7900617ea16715bf881650624fcf8`.

[VERIFIED] M4.103 records:

- failure at 65,536 and byte-roundtripping success at 72,195;
- zero rollback and zero parent restart;
- 43 success-only `quotesource` executions; and
- 6,659 success-only retained KERN `for` iterations.

[VERIFIED] The first executable sparse-quote measurement succeeds and
round-trips, reducing retained work to 70,002 iterations. It does not yet
reach production because validation itself exhausts 65,536 iterations before
emission begins.

[VERIFIED] The accepted witness has 89 node rows and 89 distinct `childat`
executions. Each lookup currently starts at row zero even though
`nodetablesok` already authenticates that every non-root parent id precedes
its children.

## Safety Contract

[VERIFIED] `canonicalize` validates every handler statement tree with
`validstatementlist` before it creates output lines or invokes
`emitstatementlist`.

[VERIFIED] Every expression-valued statement property is converted by
`exprsource` during validation and must return a non-empty string.
`exprsource` uses the validating `quotesource` path for text literal values.

[IMPLEMENTED] `quotesource(value, true)` may only receive a canonical source
string produced after that validation pass. It finds the earliest of
backslash, quote, newline, carriage return, and tab, copies the untouched span,
and appends the corresponding escape.

[VERIFIED] Every ordinary caller passes `false`, retaining the validating
`quotesource` behavior and rejection ceiling. The optimization introduces no
recursion, host-only intrinsic, or function-name/runtime special case.

[VERIFIED] Validated sources containing an encoded backslash pair use the
original bounded `for` path. This preserves the 8,192-byte dense-escape
boundary without a numeric heuristic and prevents the sparse resumable path
from accumulating enough helper frames to overflow the host stack.

[VERIFIED] The initially considered `Text.replace` implementation was rejected
by the live measurement before execution. Codegen supports `Text.replace`, but
the self-host runtime's structural scalar domain intentionally admits only
`Text.length`, `charAt`, `slice`, `indexOf`, and `startsWith`. Widening that
runtime domain is outside this milestone.

## Implementation Plan

1. Add RED source-contract tests proving the validated mode owns one sparse
   loop, searches exactly five escape characters, and exclusively owns
   expression quoting in statement emission.
2. Add the validated mode in KERN, route all statement expression attributes
   through it, and regenerate the authenticated composition.
3. Bound existing `childat` lookup at its authenticated parent row and return
   immediately on the unique requested sibling, without changing statement
   helper bodies or the 109-function corpus.
4. Run canonicalizer golden, hostile, idempotence, and focused runtime tests;
   measure the new adjacent failure/success floor.
5. Publish immutable M4.104 evidence and update derived coverage artifacts
   without promoting the active profile.
6. Run the full Node 22 KERN 5 fitness wall, mandatory high-risk role review,
   fetch/rebase, and one atomic signed push to `main`.

## Measured Result

[VERIFIED] The exact adjacent runtime boundary is 62,829 failure and 62,830
byte-roundtripping success. This reduces the M4.102 floor by 9,365 iterations,
leaves 2,706 iterations of production headroom, and remains 13,678 iterations
above the stricter promotion budget.

[VERIFIED] The successful boundary records 62,726 `for` entries, 104 `while`
entries, zero rollback, and zero parent restart. The corpus remains 109
functions and coverage remains 90/109 base-complete with 16 functions blocked
by `fn.params`.

[VERIFIED] Receipt digest
`eace33240c8425569685d76530e4b59ec5b07fa874572a93458ea5e17f84ec92`
publishes a production-headroom YES and promotion NO-GO, handing the residual
bottleneck to M4.105 without changing the active profile.

[VERIFIED] The complete Node 22 KERN 5 fitness wall passed after the
dense-escape correction. High-risk role review routed all six usable engines;
correctness, security, performance, and both overall lenses reported no
blocker. The dryness-only generated-artifact finding was rejected because the
composition and digest consumers are writer-generated and byte-verified.

## Acceptance Criteria

- [x] RED source-contract test fails before implementation.
- [x] Ordinary `quotesource` validation behavior remains unchanged.
- [x] Validated quoting mode contains one sparse KERN loop and no recursion.
- [x] Statement emission uses validated mode for every expression source.
- [x] Existing `childat` starts at the parent row and returns immediately on
      the unique requested sibling.
- [x] The canonical corpus remains exactly 109 functions.
- [x] Canonical golden/idempotence and hostile verdicts remain unchanged.
- [x] Exact floor is frozen with adjacent failure/success budgets.
- [x] Exact floor is at or below the 65,536 production ceiling.
- [x] Public/internal execution envelopes remain byte-identical.
- [x] Runtime/KIR/ABI limits and active profile remain unchanged.
- [x] Full fitness and independent review pass with no unresolved blocker.
- [ ] Signed commit is fetched/rebased and pushed once to `main`.

## Stop Conditions

- Any statement emission path can bypass the complete validation pass.
- Validated mode receives raw user text instead of canonical expression source.
- Any golden, hostile, or round-trip result changes.
- The measured floor remains above the production ceiling.
- The optimization requires runtime policy or ABI widening.

## Out of Scope

- Candidate-profile promotion or parameter migration.
- General-purpose use of the validated quoting mode.
- Runtime cache, collection-limit, or handler changes.
- KIR v1 freeze, runtime cutover, semantic self-hosting, RC/stable release,
  Fable work, or a KERN 5 completion claim.

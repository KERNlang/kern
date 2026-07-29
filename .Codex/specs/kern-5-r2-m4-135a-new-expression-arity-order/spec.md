# KERN 5 R2 M4.135a — New-Expression Arity Rejection Order

**Status:** VERIFIED — READY TO PUBLISH
**Date:** 2026-07-29
**Confidence:** 0.99
**Base commit:** `e1d052a49c6e06919b8ad8c2beaf86a52dacfeab`

## Root Cause

[VERIFIED] The published M4.135 reader calls `nestedList` before checking the
bounded constructor arity. For an impossible outer shape such as a `Map`
constructor with one argument, a hostile nested expression is therefore
traversed first and can determine the rejection code/path.

[VERIFIED] The reader still rejects the artifact, so this is not an admission
or canonical-byte vulnerability. It is a fail-closed ordering defect: the
exact constructor/arity contract should reject at `fields.args` before
inspecting argument subtrees that cannot belong to any admitted constructor.

## Contract

[DECIDED] Validate the argument field tag, constructor identity, and exact
arity in that order. Only after those outer invariants pass may the reader
recursively validate each admitted argument expression.

[DECIDED] Preserve the M4.135 structural representation, admitted constructors,
writer behavior, KERN source, runtime semantics, coverage family, cumulative
base, active-family selection, and every pre-M4.135 historical receipt.

## Plan

1. Add a hostile nested-argument oracle proving impossible arity rejects at
   the outer `fields.args` path.
2. Replace the eager `nestedList` call with an exact list-tag check, arity
   check, then recursive validation.
3. Update only the authenticated pre-M4.135 compiled-source reconstruction
   replacement required by the emitted JavaScript change.
4. Regenerate current coverage/prerequisite receipts and run focused tests,
   the full KERN 5 wall, and full-roster Agon review before publication.

## Acceptance Criteria

- [x] Impossible arity rejects before hostile subtree traversal.
- [x] Valid `new Error(argument)` still recursively validates its argument.
- [x] Exact Map/Error shapes and canonical bytes remain unchanged.
- [x] Historical pre-M4.135 reconstruction remains byte-identical.
- [x] Current coverage remains 104/112 with the same new-expression winner
      and exact prerequisite closure.
- [x] Focused gates, full KERN 5 fitness, and Agon review pass.
- [ ] Commit is fetched/rebased before one push and remote `main` verifies.

## Verification Evidence

- Focused structural reader oracle: 14/14 passed.
- Coverage prerequisite integrity: 5/5 passed.
- Canonicalizer gate: 619/619 tests; 56 golden/idempotence/KIR fixtures,
  8 measured witnesses, 3 profile-limit fixtures, and 243 hostile fixtures.
- Full `pnpm fitness:kern-5`: passed.
- Agon review: 6/6 engines completed with zero verified, needs-check, or
  speculative findings; four non-blocking refactor nits were intentionally
  left outside this surgical ordering fix.

## Out of Scope

- New constructors, arities, expression kinds, runtime behavior, profile
  promotion, parameter migration, or KERN 5 completion.

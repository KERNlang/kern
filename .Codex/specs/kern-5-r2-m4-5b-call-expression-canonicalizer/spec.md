# KERN 5 R2 M4.5b — Call-Expression Canonicalizer Tranche

**Status:** REVIEWED — local release and terminal review gates passed;
publication pending

**Parent objective:** implement the M4.5a-selected call-expression family in
the KERN-authored canonicalizer without promoting the family or widening a
shared KIR, parser, runtime, or public contract.

## Grounded Evidence

[VERIFIED] Published `origin/main` at
`215e8703ccea8a04452b9dc46016b46d5e8474a5` contains the complete M4.5a
selection handoff and its deterministic closure-power CI correction. Format-5
coverage evidence selects `call-expression`: two functions, one tool, 481
occurrences, and ordered witnesses
`examples/capstone-assertion-engine/diag.kern#1:pathAppendIndex` and
`examples/capstone-assertion-engine/diag.kern#6:reasonLengthMismatch`.

[VERIFIED] Both witnesses are blocked only by direct `String(value)` calls.
The current KERN-owned `exprsource` already recursively emits the promoted
base kinds: null, identifier, boolean, nonnegative integer, text, binary, and
list.

[VERIFIED] The existing structural KIR catalog defines `call` as the exact
record `{ args, callee, optional }`: `args` is an ordered expression list,
`callee` is a recursive expression, and `optional` is a boolean. Typed calls
are rejected before structural KIR projection. Member and index remain
separate unpromoted expression families.

## Tribunal and Decision

[VERIFIED] Tribunal
`tribunal-1784555533734-ntsxox-kern-5-r2-m4-5b-call-contract` completed two
rounds across four usable engines. Its verdict rejected both witness-shaped
direct-call-only support and unconditional optional-call support.

[DECIDED] Implement the exact catalogued recursive call record, dependency
closed over expression kinds already supported by `exprsource`. Do not invent
a second call schema that restricts `callee` to identifiers. Recursive calls
such as `f()()`, nested arguments such as `f(g(x))`, and an already
parenthesized binary callee such as `(a || b)(x)` are therefore reachable and
owned by this tranche.

[DECIDED] Require the exact `optional` boolean field but admit only
`optional=false`. `optional=true` remains fail-closed until optional-chain
emission is designed with the member/index chain families. Parenthesizing an
optional call can terminate short-circuit propagation, so accepting it now
would risk turning `f?.()(x)` into a throwing outer call.

[DECIDED] Emit a non-optional call by concatenating the recursively canonical
callee, `(`, canonical arguments joined by `, ` in stored order, and `)`.
Existing expression emitters already parenthesize binary callees, while a
recursive call callee naturally emits `f()(x)` without additional grouping.

[REJECTED] Supporting only direct identifier callees is witness-shaped rather
than contract-shaped, misattributes member/index rejection to the call family,
and would require deleting tranche-local guards when later families land.

[REJECTED] Emitting optional calls in this slice is not safe merely because
the structural catalog represents them. Optional-chain grouping has runtime
semantics and requires an attributable future design slice.

## RED and Mutation Contract

[VERIFIED] The intended RED added both selected witnesses to the measured
runtime wall before the KERN implementation changed. Sealed M4.5a failed at
`pathAppendIndex` because the profile returned `uncaught-throw` for kind
`call`.

[VERIFIED] Valid fixtures cover the two selected `String(x)` witnesses, zero
and multiple arguments, nested argument calls, recursive call callees, and a
binary callee.

[VERIFIED] Hostile mutations cover missing, duplicate, or extra call fields;
non-list args; sparse or duplicate argument orders; non-boolean
optional; `optional=true`; dangling callee or argument ids; and member/index
callees. Every mutation must reject the entire input without partial output.

[VERIFIED] Both frozen M4.5a witnesses execute through structural KIR,
KERN-authored canonicalization, byte-idempotence, and the existing measured
coverage gate.

## Slice Boundary

[DECIDED] `call-expression` remains outside the cumulative coverage base and
remains the active selected candidate. This tranche changes implementation
capability evidence only. A later promotion slice must authenticate this exact
implementation, promote the family, remove it from active candidates, and
remeasure before selecting another family.

[DECIDED] Do not change the structural expression catalog, parser, ValueIR,
runtime ABI, emitted-target semantics, handwritten coverage corpus, selection
provenance history, or ownership claims.

[DECIDED] Re-adjudicate if either selected witness remains incomplete; if any
function beyond the exact expected call-dependent closure changes completion;
if round-trip changes argument order, call nesting, or binary grouping; if
member/index support becomes necessary; or if optional calls cannot remain
cleanly fail-closed.

## Expected File Surface

- one call-expression valid/hostile fixture module and fixture registration;
- KERN-owned call validation/emission inside `exprsource`;
- ownership, RED, witness, mutation, and idempotence assertions;
- regenerated authenticated canonicalizer composition and format-5 coverage
  summary;
- this spec and the release train.

## Acceptance

- [x] Fresh branch starts from exact published `origin/main`.
- [x] Full Agon tribunal decides the call subset and optional-call boundary.
- [x] Intended RED fails against sealed M4.5a for unsupported call emission.
- [x] Exact recursive non-optional call validation and emission are KERN-owned.
- [x] Valid, hostile, profile-limit, witness, receipt, and focused gates pass.
- [x] Live measurement remains six of 104 base-complete with call-expression
      still selected at 492 occurrences until the separate promotion slice;
      its immutable M4.5a selection record remains 481 occurrences.
- [x] Complete Node 22 `pnpm fitness:kern-5` wall passes.
- [x] Full usable-roster Agon review has no verified blocker.
- [ ] Signed commit is fetched/rebased before one verified push.

Confidence: 0.99. The structural schema, selected witnesses, dependency-closed
recursive boundary, optional-chain stop condition, RED, implementation,
measurement, focused gate, and complete fitness wall are grounded in current
source and executable evidence. Final review
`review-1784559503294-8nuqnc-kern-5-r2-m4-5b-call-expression-` completed all
six usable engines with zero verified, needs-check, or speculative findings.
Publication remains pending.

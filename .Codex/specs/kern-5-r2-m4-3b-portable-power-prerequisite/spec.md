# KERN 5 R2 M4.3b prerequisite — portable exponentiation

**Status:** COMPLETED
**Date:** 2026-07-18
**Confidence:** 0.99

## Decision

[VERIFIED] The structural KIR binary catalog already includes `**`, but the
expression tokenizer/parser, KERN core runtime, portable evaluators, lambda
runtime, and generated-target parity did not implement one shared executable
contract.

[VERIFIED] The first staged parser/codegen patch passed its focused tests but
failed terminal Agon review `review-1784410611644-1ytgz9`: unparenthesized
`await` could produce invalid TypeScript, executable evaluators rejected the
new parser output, and raw JavaScript/Python power diverged for negative
exponents, negative bases with fractional exponents, and overflow.

[VERIFIED] Agon tribunal `tribunal-1784408765955-xj7j34` selected a separate,
revertible prerequisite commit rather than hiding the issue inside the
canonicalizer change.

[VERIFIED] Full-roster brainstorm `brainstorm-1784411358030-vjb710` converged
on a guarded integer domain. Five substantive drafts rejected raw host power;
four selected safe-integer or nonnegative-integer semantics. The selected
Claude synthesis did not complete, so the decision is based on the preserved
Codex, Kimi, agy, Minimax, and Z.ai artifacts plus current repository evidence.

[VERIFIED] KERN `**` accepts exactly:

- a finite safe-integer base that is not negative zero;
- a finite, nonnegative safe-integer exponent that is not negative zero;
- a result that remains inside the safe-integer domain.

[VERIFIED] `0 ** 0` is `1`; negative integer bases are accepted; negative or
fractional exponents, fractional/unsafe operands, negative zero, and unsafe
results fail closed.

## Owned algorithm and diagnostics

[VERIFIED] One core contract owns checked exponentiation by squaring. It
performs a safe multiplication precheck before every multiplication, so large
exponents terminate logarithmically and Python never constructs an unbounded
big integer.

[VERIFIED] The stable diagnostics are:

- `portable: ** requires a safe-integer base and nonnegative safe-integer exponent`
- `portable: ** result exceeds the safe-integer domain`
- `portable: ** does not accept spread operands`

[VERIFIED] `Number.MAX_SAFE_INTEGER` is the language-domain boundary on the
TypeScript/core side. The Python helper uses its exact decimal equivalent in
the co-located target rendering and parity tests bind the two implementations.
This is a language contract, not an operational quota or deploy-time tuning
knob.

## Grammar and emission

[VERIFIED] The tokenizer consumes `**` before `*`. The parser collects a power
chain iteratively and folds it right-to-left, avoiding recursive-chain stack
overflow while preserving right associativity.

[VERIFIED] Any operand that becomes the left side of a power node and begins
with an unparenthesized supported prefix form (`unary`, `await`, or `new`) is
rejected. Explicit source parentheses are recognized through IR
`isParenthesized`, not token look-behind. Supported prefix forms remain valid
on the right side. Spread operands fail closed on either side, including
parenthesized parser input and hand-built IR passed directly to either emitter.

[VERIFIED] Raw/non-native expression emission retains the catalog spelling and
correct parentheses for structural round trips. Native `lang="kern"`
TypeScript and Python emission lowers to `__kern_pow_int` / `_kern_pow_int` and
injects the corresponding private helper exactly once. The public runtime
handler ABI does not change.

## Runtime and consumer closure

[VERIFIED] The KERN core runtime dispatches `**` through a `Number.power` core
contract backed by the checked algorithm.

[VERIFIED] Sync/async portable evaluation, internal-effect machine evaluation,
portable-machine structural allowlists, and lambda preflight/runtime all use
the same checked domain. Consumers outside these executable domains retain
their existing explicit unsupported-operator diagnostic.

[VERIFIED] Generated TypeScript and Python helpers mirror the core guard order,
algorithm, and messages. Neither target uses raw `**`, `Math.pow`, or Python
`pow` for native KERN execution.

## Terminal-review hardening

[VERIFIED] Six-engine Agon review `review-1784421489615-s7z6pt` identified
three security blockers: generated helpers could capture shadowed host globals
or Python builtins, and wrapped spreads could bypass the outer-node operand
guard. The remediation removes TypeScript dependence on `Number`, `Math`,
`Object`, and `Error`; binds Python builtins through a private module import;
and unwraps `typeAssert` and `nonNull` before rejecting spread operands.

[VERIFIED] The same review's needs-check items were closed: untyped default
parameters cannot capture generated helpers, and destructuring preflight now
validates helper-name collisions without mutating semantic binding state.

[VERIFIED] Shared identifier-case conversion and ValueIR traversal utilities
replace the duplicate Python/core implementations found during review. Focused
shadowing, wrapped-spread, helper-capture, and termination regressions pass.

[VERIFIED] Follow-up six-engine review `review-1784424294169-eungwo` found
four remaining generated-helper capture paths: TypeScript bare assignment,
Python set/assignment/f-string binding, closure-local declarations, and raw
block-bodied TypeScript closures. It also found that Python numeric subclasses
could bypass the exact portable-number domain.

[VERIFIED] The remediation validates every emitted binding spelling before a
private helper is selected, including parameters, declarations, destructures,
bare assignments, increments/decrements, sets, and formatted-string bindings.
Native block-bodied TypeScript closures now receive a source-preserving,
TypeScript-AST-planned power rewrite instead of re-emitting raw `**`. Python
operands must have the exact built-in `int` or `float` type, and wrapped
`propagate` operands are unwrapped before spread rejection. Focused hostile
capture, subclass, structural-closure, and wrapped-spread regressions pass.

[VERIFIED] Follow-up six-engine review `review-1784427316091-ehk51u` found one
remaining blocker: the parser and executable power evaluator were iterative,
but structural admission and internal effect-machine preflight still walked a
10,001-operand right-associated tree recursively and exhausted the host stack.

[VERIFIED] The remediation makes the complete affected preflight path
stack-safe: power structural admission flattens the right spine, and helper
call discovery, nested class-use scanning, expression-binding discovery, and
deferred-caught validation use explicit iterative worklists. A RED oracle now
executes a 10,001-operand chain through both root and nested `expression-v1`
effect-machine paths. The focused oracle, complete core suite, and complete
KERN 5 fitness wall pass.

[VERIFIED] The same review's remaining needs-check items were resolved without
speculative edits: the required Python callback is proven by the TypeScript
build; the array-freshness refactor retains the existing root-only
`preserveFreshPush` behavior; the 10,001-operand end-to-end oracle completes in
bounded linear time; and the reported formatting/helper duplication is
pre-existing or non-material to this prerequisite.

[VERIFIED] Follow-up six-engine review `review-1784429704957-y1mfau` found a
real target-runtime ceiling after the stack-safety fix: the iterative parser
and evaluator could accept a chain whose emitted variadic helper call exceeded
the JavaScript engine's 65,535-argument call limit. A 65,537-operand RED oracle
reproduced `SyntaxError: Too many arguments in function call` against actual
generated native TypeScript.

[VERIFIED] The private generated-helper ABI now accepts one operand array/list
instead of variadic arguments in TypeScript, JavaScript, and Python. Native
emitters and the `Number.power` target lowerings pass the complete chain as a
single array/list value, preserving authored left-to-right operand evaluation
and right-to-left power reduction without a host call-arity ceiling. The
65,537-operand generated TypeScript oracle, complete core/Python/CLI suites,
and a fifth complete KERN 5 fitness wall pass.

[VERIFIED] The same review's remaining needs-check items were closed by source
validation rather than speculative edits. The iterative expression-binding
walker preserves its predecessor's admitted node set; root-instance member
access still descends to the identifier predicate; the right-spine flatten is
linear; and `**` integer provenance is sound because checked power either
returns a safe integer or throws, while every array-index consumer separately
validates the evaluated value as a nonnegative safe integer.

[VERIFIED] Terminal six-engine review `review-1784432700637-jp66kc` found one
remaining target-integration blocker: the shared preamble was injected after
target-specific codegen, so an Ink callback or Express path parameter named
`__kern_pow_int` could capture the generated call. RED oracles reproduced both
the recursive Ink callback and the Express string-as-function path.

[VERIFIED] The CLI post-target pass now scopes the checked-power helper to each
individual TS/TSX/SFC output that actually contains an emitted helper call and
structurally scans that output with the TypeScript AST before injection. Any
target-generated declaration, import, parameter, destructure, assignment, or
increment/decrement of the reserved helper fails closed. The guard lives at
the CLI integration boundary, preserving the core browser-spine proof's exact
five TypeScript-importer set.

[VERIFIED] The review also exposed a real pre-existing completeness gap in the
two iterative effect-machine walkers: identifiers under `spread`, `await`, or
`propagate` wrappers were skipped. Both walkers now descend through all three
wrappers; direct RED oracles and the complete effect-machine preflight/try
suites pass. The reported `needsParens` ReferenceError was disproved because
the function is defined in the same module and exercised by passing emission
suites. Duplication and memoization suggestions were non-correctness refactors
or would make context-sensitive emission caching unsafe, so no speculative
change was made.

[VERIFIED] The complete post-r7 Node 22 `pnpm fitness:kern-5` wall exited zero
after the target-boundary collision guard, browser-spine relocation, and
wrapper-traversal fixes. This is the sixth complete wall for the prerequisite;
the aggregate ended with `KERN 5 current fitness wall passed.`

[VERIFIED] Terminal review r8
`review-1784436831823-m1q50p-kern-5-r2-m4-3b-power-prerequisi` completed with
five successful engines, zero consensus-verified findings, and one reviewer
process failure: Claude exited 1 twice without producing a code finding. Codex
reported no security findings. The reported missing-file and missing
parenthesized-tree claims were context errors: the files are present, the
portable flattener follows only the implicit right spine, and existing runtime
and emission tests distinguish `(2 ** 3) ** 2 == 64` from `2 ** 3 ** 2 == 512`.
Direct rewrite oracles now also prove that TypeScript `satisfies` and legacy
type-assertion wrappers select one non-overlapping outer power span.

[VERIFIED] The broad r8 binding-bypass claim was disproved against the
fail-closed closure gate and lowerer. Destructuring, nested functions, and
classes cannot emit; catch targets are TypeScript `VariableDeclaration` nodes
and already flow through `validateBindingName`. A direct catch oracle passes.
The TypeScript collision matrix now explicitly includes `set` and `fmt`, and
both reject the reserved helper through the generated-output AST boundary.

[VERIFIED] The r8 duplication finding was material maintainability feedback.
Both internal-machine data walkers now share one child policy layered on the
canonical ValueIR walker, preserving the intentional callee/lambda boundaries;
the two evaluator-specific right folds now use one generic fold while retaining
their own error and trace adapters. Lint, the complete core suite, the complete
CLI suite, and all focused power/closure/effect-machine suites pass after this
cleanup. The seventh complete Node 22 `pnpm fitness:kern-5` wall then exited
zero on the post-r8 tree and refreshed canonicalizer receipt. Terminal review
r9 remains required.

[VERIFIED] Automatic high-risk role review
`review-1784436668741-dd8vzn` completed 3/3 with the complete live roster and
reported four needs-check items. Two were real: expression-form `for...in/of`
targets could overwrite the TypeScript helper after the target scan, and the
exported Python closure lowerer emitted a bare `for...of` target without its
mandatory binding validation/free-write classification. Direct RED oracles now
pass after the TS scanner descends those loop targets and the Python lowerer
validates, classifies, and rename-resolves its target before emission.

[VERIFIED] The other two r8 items were disproved against the executable
contract. Type aliases and interfaces occupy TypeScript's type namespace and
cannot capture the runtime helper value; explicit non-collision tests preserve
that distinction. The closure power analyzer only receives gate-admitted
blocks, while value-position assignments, nested functions, loops, and other
binding-bearing power operands are rejected before rewriting, so its
outermost-power early return cannot bypass a reachable binding validation.

[VERIFIED] The complete post-r8 Node 22 `pnpm fitness:kern-5` wall exited zero
after both review fixes, ending with `KERN 5 current fitness wall passed.` This
is the seventh authoritative complete wall for the prerequisite.

[VERIFIED] Terminal review r9
`review-1784439823920-is97u4-kern-5-r2-m4-3b-power-prerequisi` completed with
all six requested engines. Codex reproduced one real availability defect:
`isIntProvenancedExpr` still recursively traversed the right-associated power
tree, so a valid 10,001-operand chain exhausted the host stack when integer
provenance was requested. A direct RED oracle reproduced the `RangeError`;
the provenance predicate now preserves its narrow admitted grammar through an
explicit worklist, and the same oracle passes without recursion.

[VERIFIED] The remaining r9 blocker labels were disproved against source and
passing executable oracles. `needsParens` and `parseExpr` are local function
declarations in their respective modules. The shared machine data walker
intentionally omits call operation names: admitted member callees are namespace
or class-operation selectors, their data arguments are walked, and unsupported
data-receiver/computed callees fail structural admission before dispatch. The
deferred-caught rule still observes `error.message` as the only admitted member
read; chained method calls such as `error.message.toString()` are outside the
portable machine call domain. Existing runtime and emission tests distinguish
right-associated `2 ** 3 ** 2 == 512` from explicitly grouped
`(2 ** 3) ** 2 == 64`.

[VERIFIED] The performance-labeled r9 blockers were source misreads or
non-material micro-optimizations. Record-field proof performs one deep walk
from the root, not nested deep walks; each parsed power operand owns only its
local wrapper chain; binding validation is the required fail-closed boundary;
and the generic fold callback does not alter asymptotic behavior. ValueIR is a
parser/codegen tree with no back-edges, so adding an arbitrary depth cap would
reject valid stress inputs instead of hardening them. Pre-existing guard-builder
duplication and test-table consolidation remain outside this prerequisite's
correctness boundary.

[VERIFIED] The complete post-r9 Node 22 `pnpm fitness:kern-5` wall exited zero
after the iterative provenance fix, refreshed compiled-core receipt, and lint
cleanup. The terminal line was `KERN 5 current fitness wall passed.` This is
the eighth complete wall for the prerequisite.

## RED oracles

- [VERIFIED] Tokenization is atomic and malformed star neighbors reject.
- [VERIFIED] `a ** b ** c` is right-nested; `(a ** b) ** c` remains left-nested.
- [VERIFIED] A chain with 10,000 operators parses without call-stack overflow.
- [VERIFIED] Unparenthesized unary/await/new left operands reject;
  parenthesized equivalents and right-side supported prefix operands parse;
  spreads reject in every power operand position.
- [VERIFIED] `2 ** 3 ** 2` produces `512`; `(2 ** 3) ** 2` produces `64`.
- [VERIFIED] `0 ** 0`, negative integer bases, and safe boundaries agree in
  core runtime, reference evaluators, lambda runtime, emitted TypeScript, and
  emitted Python.
- [VERIFIED] negative/fractional/unsafe operands, negative zero, and overflow
  fail with the same stable diagnostic class on every executable path.
- [VERIFIED] an exponent near the safe-integer maximum terminates
  logarithmically for bases `0`, `1`, and `-1`, and rejects overflowing bases
  without constructing host-sized powers.
- [VERIFIED] helper detection equals emitted call-site detection; native output
  receives one helper, raw/non-native output receives none.
- [VERIFIED] a 65,537-operand native chain emits and executes through one
  array/list helper argument instead of exceeding the JavaScript call-arity
  ceiling.
- [VERIFIED] Ink callbacks and Express path parameters cannot capture the
  target-injected checked-power helper, and helper injection is per output.

## Acceptance

- [x] RED tests demonstrate the reviewed syntax, runtime, and cross-target gaps.
- [x] The checked core contract and both target helpers pass the adversarial matrix.
- [x] Every executable binary consumer handles `**` through the shared contract.
- [x] Core, Python, and CLI focused suites, typechecks, builds, and full package suites pass.
- [x] Eight complete Node 22 `pnpm fitness:kern-5` walls passed, including the
      complete post-r9 provenance wall.
- [x] Automatic high-risk role-lens Agon review completed with the complete live
      roster; both real findings are fixed and both non-findings are disproved.
- [x] The post-r8 review-remediation Node 22 `pnpm fitness:kern-5` wall passes.
- [x] The post-r9 provenance fix passes a refreshed complete fitness wall; the
      terminal six-engine finding is fixed with no unresolved correctness item.
- [x] This prerequisite lands as a separate KERN-signed commit before the
      canonicalizer implementation resumes.

## Stop conditions

Stop and redesign if this requires a public runtime ABI change, host-owned raw
power semantics in native output, fractional/negative exponent emulation,
unbounded Python integer construction, or weakening the existing finite
portable-scalar and negative-zero boundaries.

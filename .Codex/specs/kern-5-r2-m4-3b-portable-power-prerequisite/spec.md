# KERN 5 R2 M4.3b prerequisite — portable exponentiation

**Status:** COMPLETED — ready to publish
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

[VERIFIED] Terminal review r10
`review-1784442457532-llmwxy-kern-5-r2-m4-3b-power-prerequisi` completed with
all six requested engines. Codex identified one real integration gap: the
TypeScript closure gate admits runtime-no-op TypeScript syntax such as
`satisfies`, legacy type assertions, generic call arguments, and comments, but
the TypeScript power rewriter and Python closure lowerer reparsed the raw text
with the narrower KERN expression parser. Direct end-to-end RED tests
reproduced all three parse failures on both native targets.

[VERIFIED] Both closure paths now share a TypeScript-AST normalization boundary
that removes only compile-time wrappers, type arguments, and comments before
the KERN expression parser sees the source. Runtime grouping and authored
semantics remain intact. Focused core and CLI tests pass, including generic
calls/new expressions and condition lowering on the Python path. A refreshed
complete fitness wall and terminal r11 review remain required.

[VERIFIED] Agy's r10 overlap blocker was disproved by traversal order and a
direct oracle: once the outer power expression is selected, the analyzer
returns without visiting its descendants, so transparent wrappers around an
inner power cannot produce overlapping replacement spans.

[VERIFIED] The complete post-r10 Node 22 `pnpm fitness:kern-5` wall exited zero
after the closure normalization and browser-spine importer correction. The
terminal line was `KERN 5 current fitness wall passed.` This is the ninth
authoritative complete wall for the prerequisite.

[VERIFIED] First terminal review r11a
`review-1784445656679-kd9r62-kern-5-r2-m4-3b-power-prerequisi` completed with
all six requested engines. Codex reproduced one real collision blocker:
runtime-no-op TypeScript wrappers around assignment, destructuring, increment,
or `for...of` targets could hide a write to `__kern_pow_int`, and unconditional
TSX parsing hid legacy angle-bracket assertions. It also proved that raw
substring call detection treated inert comments and literals as helper calls.

[VERIFIED] The CLI receives the generated source kind explicitly from the
target or artifact extension, unwraps all admitted type-only assignment-target
wrappers, and collects real helper calls plus collisions in one AST traversal.
Direct and end-to-end RED oracles cover assignments, destructuring, loops,
TSX, comments, strings, and regex literals. The browser-safe core detector now
lexes executable code, ignores comments/strings/regex/template raw text, and
still observes calls inside template interpolations. Focused core, CLI, and
browser import-graph suites pass. A refreshed complete fitness wall and
terminal r12 review remain required.

[VERIFIED] The remaining r11 important notes are non-blocking. The unchecked
acceptance row correctly reflects the pending r12 proof. The nested-record guard
duplication predates this prerequisite. The three write collectors operate at
different contracts (whole generated artifact, admitted closure rewrite, and
Python emission), and the CLI call/collision work is now consolidated. The
claimed array-mutation quadratic walk is disproved: direct-child subtrees are
disjoint, so the sum of their iterative walks is linear in the root tree size.

[VERIFIED] Follow-up live-roster role review r11b
`review-1784447007966-tya80l-kern-5-r2-m4-3b-power-prerequisi` completed with
Claude, Codex, and agy, the exact current usable roster. Codex reproduced one
blocking availability regression: the first normalizer used the recursive
TypeScript transformer/printer and exhausted the host stack on a valid
1,200-operand block-closure chain on both native targets. It also reproduced
recursive template scanning at 5,000 nested interpolations and lexical false
positives for regex literals after control headers and receiver-qualified
helper methods.

[VERIFIED] The normalizer now walks immediate TypeScript children with an
explicit worklist and removes runtime-no-op wrappers, type arguments, and
comments through source-span edits. It neither recursively transforms nor
prints expressions. A 1,200-operand block closure passes through both native
targets; the separate direct KERN expression oracle retains its 10,001-operand
proof because the TypeScript parser itself cannot admit a closure that deep.

[VERIFIED] The browser-safe helper scanner now represents nested templates and
interpolations with explicit frames, tracks control-header parentheses, and
distinguishes direct identifier calls from receiver properties. Direct RED
oracles cover 5,000 nested interpolations, regex after `if`, property calls,
and a keyword-named property followed by division and then a real helper call.
The CLI receives the known TS/TSX source kind rather than depending on internal
parse diagnostics. The speculative JSX lexing concern does not reach generated
TSX injection: CLI TSX outputs use the AST detector, and no production TSX
consumer calls the core lexical detector. Focused core, CLI, canonicalizer,
build, and lint gates pass. A refreshed full fitness wall and terminal r12
review remain required.

[VERIFIED] The restarted complete Node 22 `pnpm fitness:kern-5` wall passed on
the r11b remediation tree. The authoritative terminal line was
`KERN 5 current fitness wall passed.` This is the tenth complete wall for the
prerequisite. Terminal r12 review remains required before publication.

[VERIFIED] Terminal live-roster role review r12
`review-1784449923343-zju7gx-kern-5-r2-m4-3b-power-prerequisi` completed with
Claude, Codex, and agy. Claude's overall backstop was clean. Codex and agy
reproduced two blockers: type-argument spans assumed the closing `>` was
adjacent to the final type node, and generated-output helper analysis still
used recursive user-controlled AST traversal. They also identified overlapping
comment edits and quadratic whole-string reconstruction in the normalizer.

[VERIFIED] Type-argument removal now locates the actual closing token with a
trivia-skipping TypeScript scanner, including spaced, commented, and nested
generic arguments. Comment edits use exact scanner token spans, skip structural
removals with a monotonic cursor, merge two sorted edit streams, and construct
the result once. Adjacent-comment RED oracles prove that valid operator bytes
cannot be dropped. A 930,025-byte expression containing 30,000 commented
generic calls normalized completely in 64 ms on the local Node 22 gate.

[VERIFIED] Generated-output call/collision analysis, binding-pattern search,
and assignment-target search now use explicit worklists. A 5,000-term direct
oracle and a 3,000-term end-to-end raw-handler oracle pass without recursive
overflow. The shared closure call collector also normalizes TypeScript-only
syntax before the narrower regex-safety parser consumes each call and uses an
explicit worklist. Focused core and CLI tests, lint, canonicalizer receipt,
46/46 canonicalizer tests, and all golden/profile/hostile fixtures pass.

[VERIFIED] The eleventh complete Node 22 `pnpm fitness:kern-5` wall passed on
the exact post-r12 remediation tree. Its authoritative terminal line was
`KERN 5 current fitness wall passed.` Targeted independent confirmation of the
r12 fixes remains required because this remediation changed the reviewed tree.

[VERIFIED] Live-roster role review r13
`review-1784452599258-fhi3p2-kern-5-r2-m4-3b-power-prerequisi` completed with
Claude, Codex, and agy. Claude's overall lens and agy's correctness lens were
clean. Codex reproduced one blocker: the context-free comment scanner treated
`/*` and `//` sequences inside valid regular-expression literals as comments,
corrupting accepted block closures on both native targets.

[VERIFIED] RED oracles reproduce the corruption for `/[/*]/`, `/[//]/`, and
`/a\\/*b/` in a numeric power operand and through lib/FastAPI compilation. The
normalizer now collects regular-expression spans from the parsed TypeScript AST
and skips each complete span during its linear comment scan. All RED oracles,
lint, the complete core and CLI suites, and the refreshed 46/46 canonicalizer
gate pass. A targeted independent confirmation and final exact-tree fitness
wall remain required.

[VERIFIED] Live-roster role review r14
`review-1784453159936-q5qmq1-kern-5-r2-m4-3b-power-prerequisi` reproduced one
remaining blocker class: raw template-literal text after an interpolation was
scanned as executable code, so `/*safe*/` and `//safe` bytes were removed and
lib/FastAPI output silently diverged. It also identified two real non-blocking
false negatives in the browser-safe helper scanner: Unicode identifiers and a
division after an object literal could make a real helper call look like regex
text.

[VERIFIED] The normalizer now protects AST-identified template head, middle,
tail, and no-substitution literal spans while continuing to scan and normalize
the expressions inside `${...}`. Direct and cross-target RED oracles preserve
block markers, line markers, multiple interpolations, and raw template text,
while a real comment inside an interpolation is still removed.

[VERIFIED] The browser-safe scanner recognizes ECMAScript `ID_Start` and
`ID_Continue` code points and tracks whether a brace opened in a common
expression position, preventing both Unicode-identifier and object-literal
division false negatives. The trailing generic-comma claim was disproved by a
passing oracle without an implementation change. The claimed lexical `**`
detector does not exist on the closure path, which selects power nodes from the
TypeScript AST, and the CLI TSX target list exactly matches the shared output
extension mapping. Lint, complete core and CLI suites, and the refreshed 46/46
canonicalizer gate pass after the r14 remediation. Targeted confirmation and a
final exact-tree fitness wall remain required.

[VERIFIED] Live-roster role review r15
`review-1784454309453-65hsct-kern-5-r2-m4-3b-power-prerequisi` completed 3/3
with no consensus-verified finding. Codex reproduced one important residual
false negative: an object literal after an operator such as `&&` was outside
the first expression-brace prefix list. Claude also confirmed that the primary
TSX source-kind list duplicated the canonical target-extension policy and that
TypeScript parser stack exhaustion could escape `parseClosureBlockAst`.

[VERIFIED] Brace classification now uses the scanner's expression-start state
with explicit statement-block exclusions, including arrow and control bodies.
RED oracles prove helper detection after assignment and operator-position
object literals while a regex after a real statement block remains inert.
Primary TS/TSX parsing now derives from one extracted target-extension owner,
and a 3,000-operand closure that exceeds TypeScript's own parser stack returns
the documented fail-closed `null` verdict instead of leaking `RangeError`.
Lint, complete core and CLI suites, and the refreshed 46/46 canonicalizer gate
pass. A final targeted confirmation and exact-tree fitness wall remain required.

[VERIFIED] Live-roster role review r16
`review-1784454800779-sn6ik6-kern-5-r2-m4-3b-r14` completed with five usable
engines; Codex timed out after its automatic retry. The review had no
consensus-verified finding, but source checks reproduced two direct analyzer
defects: a 3,000-term non-power expression overflowed the recursive closure AST
walk, and stopping at a selected outer power expression skipped written-name
collection in its descendants.

[VERIFIED] RED oracles reproduce both defects. The analyzer now uses an ordered
explicit worklist, scans descendants of selected power expressions for every
binding/write, and suppresses only overlapping nested rewrite spans. The same
walk preserves authored expression order. A declared `for...of` target was
already validated by the lowerer's declaration pre-pass; a new direct oracle
locks that behavior alongside the existing bare-target oracle.

[VERIFIED] The remaining r16 candidates are non-findings or non-blocking
micro-optimizations. Empty preambles are explicit no-ops in both injectors; the
array mutation pass walks disjoint child subtrees once; an output without a
checked-power call receives no helper and therefore has no helper-shadow
collision; and per-output TypeScript parsing is required to bind helper calls
and collisions to the artifact that receives the helper. Shared-preamble
reconstruction and unconditional normalization of accepted call expressions
are bounded performance observations, not correctness failures.

[VERIFIED] Subsequent exact-roster role review r17 (run label r16)
`review-1784455588146-we1vpq-kern-5-r2-m4-3b-power-prerequisi` completed with
Claude and agy clean. Codex reproduced one blocking availability gap: the CLI
generated-output analyzer called the TypeScript parser without guarding its
own stack exhaustion, so a deeply parenthesized raw handler sharing an output
with structured power leaked a host `RangeError`.

[VERIFIED] The generated-output parser boundary now converts host parser
failure into the stable fail-closed diagnostic `Generated TypeScript helper
safety analysis failed closed.` A 5,000-level direct RED oracle and a
1,000-level end-to-end raw-handler-plus-power oracle pass. Lint and the complete
CLI suite pass after the r17 remediation. Final targeted confirmation and the
exact-tree fitness wall remain required.

[VERIFIED] Exact-roster role review r18
`review-1784456502181-3a8c37-kern-5-r2-m4-3b-power-prerequisi` completed with
agy clean and Claude reporting no blocker. Codex was requested but exhausted
its provider usage limit on both attempts, a loud routing shortfall rather than
a code verdict. Claude's three important candidates were checked against the
current tree. SFC preambles already insert immediately after the TypeScript
script opening tag and existing direct plus end-to-end tests prove they precede
all generated call sites. The CLI owns generated TSX through its source-kind
aware AST analyzer; the core lexical detector is limited to the non-JSX
differential harness.

[VERIFIED] Two defensive gaps from r18 were nevertheless reproducible. The
exported core power detector had no explicit TSX contract, and TypeScript's
error-recovery parser could hide a reserved-helper write after malformed TSX
without throwing. The core API now accepts an explicit TSX source kind and
fails closed on any reserved-name mention. The CLI parser boundary now rejects
non-empty parse diagnostics as well as thrown parser failures. Direct RED
oracles reproduce both paths; their focused tests and the complete core and CLI
suites pass. A terminal independent confirmation and exact final fitness wall
remain required.

[VERIFIED] Terminal exact-roster confirmation r19
`review-1784457382075-5l49mj-kern-5-r2-m4-3b-power-prerequisi` reports zero
verified, needs-check, speculative, or nit findings. Claude overall and agy
correctness both completed cleanly. Codex security was explicitly requested
and exhausted the same provider usage limit on both attempts, so the run is a
documented 2/3 routing shortfall rather than a silently reduced panel. The two
available independent identities found no unresolved correctness item on the
post-r18 tree.

[VERIFIED] The twelfth complete Node 22 `pnpm fitness:kern-5` wall ran after
the r18 remediation and terminal r19 confirmation. It passed repo consistency,
lint, production build, every workspace and infrastructure suite, 432/432
cross-target fixtures, 109/109 class fixtures, native KERN coverage, app and
drift behavior, browser budgets, KIR and runtime containment proofs, source
runner convergence, and the final 46/46 canonicalizer gate. It exited zero
with `KERN 5 current fitness wall passed.`

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
- [x] Eleven complete Node 22 `pnpm fitness:kern-5` walls passed through the
      complete post-r12 remediation tree.
- [x] Automatic high-risk role-lens Agon review completed with the complete live
      roster; both real findings are fixed and both non-findings are disproved.
- [x] The post-r8 review-remediation Node 22 `pnpm fitness:kern-5` wall passes.
- [x] Terminal live-roster r12 review completed and every reproduced blocker is
      covered by a direct or end-to-end regression.
- [x] The post-r12 remediation tree passes a fresh complete fitness wall.
- [x] Targeted post-r15 confirmation completed; both reproduced r16 analyzer
      defects have direct regressions and fixes.
- [x] The exact final post-r18 tree passes a complete Node 22 fitness wall.
- [x] Terminal post-r18 confirmation finds no unresolved correctness item;
      Codex was requested but unavailable due its provider usage limit.
- [x] This prerequisite lands as a separate KERN-signed commit before the
      canonicalizer implementation resumes.

## Stop conditions

Stop and redesign if this requires a public runtime ABI change, host-owned raw
power semantics in native output, fractional/negative exponent emulation,
unbounded Python integer construction, or weakening the existing finite
portable-scalar and negative-zero boundaries.

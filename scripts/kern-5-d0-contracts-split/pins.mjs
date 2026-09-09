export const BASE_COMMIT = '2c6f4abde44a4febe216488b9777046e16b3e13d';

export const EXPECTED_LINKED_TS_NAMES = Object.freeze([
  'contracts.ts',
  'expression.ts',
  'index.ts',
  'link.ts',
  'link-support.ts',
  'statements.ts',
  'walkers.ts',
]);

// Every budget below must clear both the D.0 landing estimate and the spec's slice-D headroom
// projection (Implementation Plan, "Slice D headroom after D.0") while staying under
// FILE_LINE_CEILING. statements.ts is budgeted for its ~415-line slice-D projection
// (compileTry/compileCatch/compileFinally), matching the headroom contracts.ts and link.ts already
// carry for their own post-D.0 growth — not just its own ~285-line D.0 landing size.
export const LINE_BUDGETS = Object.freeze({
  'contracts.ts': 420,
  'expression.ts': 400,
  'index.ts': 60,
  'link-support.ts': 200,
  'link.ts': 420,
  // Raised by slice D, which lands compileThrow, compileTry, compileCatch, compileFinally, the
  // payload gate and the clause partition here (kern-5-d spec, Blast Radius).
  'statements.ts': 440,
  'walkers.ts': 220,
});

// index.ts moves 43 -> 45 (D0-TD8), matching the Split table's own Now/After columns
// (Implementation Plan, "index.ts | edit | ... | 43 | 45"): this pin never carried the plan's own
// projected growth. pnpm lint is a required gate and the four-name re-source edit has no
// biome-formatter-conformant 43-line rendering; the invariant this line count guards
// (byte-equivalent export surface) is separately and exactly pinned by INV-3's 39/18-name lists.
export const BASE_LINE_COUNTS = Object.freeze({
  'contracts.ts': 535,
  'expression.ts': 358,
  'index.ts': 45,
  'link.ts': 735,
});

export const FILE_LINE_CEILING = 500;

// INV-2. link.ts sheds ./expression.js entirely: every one of its thirteen expression-module call
// sites sits inside a function that moves to statements.ts. link.ts does keep an edge to
// walkers.ts: helperIsAsync/callScope/selectHandler and the two linkVerifiedKernKirProgram{,OrThrow}
// exports stay in link.ts (Implementation Plan's own file->contents assignment) and need
// linkedStatementsInvokeCapability plus the LinkedKernKirClosureWalk type and its
// createLinkedKirClosureWalk() default-parameter factory, all three of which move to walkers.ts —
// this edge is forced by that assignment, not a deviation from it; INV-2's written edge map missed
// it (D0-TD7). link-support.ts also gained an edge to walkers.ts (D0-TD10): ModuleContext.closureWalk
// imports LinkedKernKirClosureWalk as a type instead of re-declaring its shape inline; the scanner
// matches the specifier regardless of the `import type` keyword, so the edge is real here too.
export const EXPECTED_IMPORT_EDGES = Object.freeze({
  'contracts.ts': Object.freeze([]),
  'expression.ts': Object.freeze(['contracts.js']),
  'index.ts': Object.freeze(['contracts.js', 'expression.js', 'link.js', 'walkers.js']),
  'link-support.ts': Object.freeze(['contracts.js', 'walkers.js']),
  'link.ts': Object.freeze(['contracts.js', 'link-support.js', 'statements.js', 'walkers.js']),
  'statements.ts': Object.freeze(['contracts.js', 'expression.js', 'link-support.js']),
  'walkers.ts': Object.freeze(['contracts.js']),
});

export const DIST_RUNTIME_EXPORTS = Object.freeze([
  'KERN_LINKED_KIR_PROGRAM_FORMAT',
  'LINKED_KIR_BINARY_OPERATORS',
  'LINKED_KIR_CROSS_CALL_TYPES',
  'LINKED_KIR_CROSS_CALL_TYPE_NAMES',
  'LINKED_KIR_DEFAULT_CALL_POLICY',
  'LINKED_KIR_UNARY_OPERATORS',
  'authenticateLinkedKernKirProjectionOrThrow',
  'containsAsyncCall',
  'createLinkedKirClosureWalk',
  'linkVerifiedKernKirProgram',
  'linkVerifiedKernKirProgramOrThrow',
  'linkedKirBinaryOperator',
  'linkedKirCrossCallType',
  'linkedKirUnaryOperator',
  'linkedProgramAsyncHelpers',
  'linkedProgramHelpers',
  'linkedStatementsCallDepth',
  'linkedStatementsInvokeCapability',
]);

export const SOURCE_EXPORTS = Object.freeze([
  'KERN_LINKED_KIR_PROGRAM_FORMAT',
  'KernKirLinkCode',
  'LINKED_KIR_BINARY_OPERATORS',
  'LINKED_KIR_CROSS_CALL_TYPES',
  'LINKED_KIR_CROSS_CALL_TYPE_NAMES',
  'LINKED_KIR_DEFAULT_CALL_POLICY',
  'LINKED_KIR_UNARY_OPERATORS',
  'LinkKernKirProgramResult',
  'LinkedKernKirBinaryOperator',
  'LinkedKernKirBinaryOperatorContract',
  'LinkedKernKirCallPolicy',
  'LinkedKernKirCallScope',
  'LinkedKernKirClosureWalk',
  'LinkedKernKirCrossCallType',
  'LinkedKernKirCrossCallTypeContract',
  'LinkedKernKirEntry',
  'LinkedKernKirEntryHandler',
  'LinkedKernKirExpression',
  'LinkedKernKirHandler',
  'LinkedKernKirHelper',
  'LinkedKernKirParameterType',
  'LinkedKernKirProgram',
  'LinkedKernKirStatement',
  'LinkedKernKirStaticType',
  'LinkedKernKirTypeScope',
  'LinkedKernKirUnaryOperator',
  'LinkedKernKirUnaryOperatorContract',
  'authenticateLinkedKernKirProjectionOrThrow',
  'containsAsyncCall',
  'createLinkedKirClosureWalk',
  'linkVerifiedKernKirProgram',
  'linkVerifiedKernKirProgramOrThrow',
  'linkedKirBinaryOperator',
  'linkedKirCrossCallType',
  'linkedKirUnaryOperator',
  'linkedProgramAsyncHelpers',
  'linkedProgramHelpers',
  'linkedStatementsCallDepth',
  'linkedStatementsInvokeCapability',
]);

export const WALKER_RESOURCED_EXPORTS = Object.freeze([
  'LinkedKernKirClosureWalk',
  'createLinkedKirClosureWalk',
  'linkedStatementsCallDepth',
  'linkedStatementsInvokeCapability',
]);

export const BASE_STATEMENT_KINDS = Object.freeze([
  'assign',
  'break',
  'capability',
  'continue',
  'for',
  'if',
  'let',
  'print',
  'return',
  'while',
]);

export const BASE_EXPRESSION_KINDS = Object.freeze([
  'binary',
  'identifier',
  'json-call',
  'list',
  'literal',
  'member',
  'record',
  'unary',
  'user-call',
]);

export const BASE_DIAGNOSTIC_CODES = Object.freeze([
  'capability-error',
  'execution-cancelled',
  'execution-timeout',
  'handler-entry-ambiguous',
  'handler-entry-not-found',
  'handler-entry-unsupported',
  'handler-link-error',
  'invalid-handler-arguments',
  'invalid-handler-result',
  'projection-authentication-error',
  'runtime-limit-exceeded',
  'unsupported-runtime-input',
]);

export const THIRTEENTH_DIAGNOSTIC_CODE = 'uncaught-throw';

export const EXPECTED_DIAGNOSTIC_CODES = Object.freeze(
  [...BASE_DIAGNOSTIC_CODES, THIRTEENTH_DIAGNOSTIC_CODE].sort(),
);

export const RESERVED_LABELS = Object.freeze([
  'KIR_ABRUPT_FINALLY_UNSUPPORTED',
  'KIR_CATCH_AFTER_FINALLY',
  'KIR_CATCH_WITHOUT_TRY',
  'KIR_DUPLICATE_CATCH',
  'KIR_DUPLICATE_FINALLY',
  'KIR_LOOP_JUMP_CROSSES_TRY',
  'KIR_TRY_REQUIRES_CATCH',
  'KIR_TRY_REQUIRES_CATCH_OR_FINALLY',
]);

export const RESERVED_LABELS_FORMAT = 'kern.kir.reserved-link-labels.v1';

export const BASE_KIR_TOKENS = Object.freeze([
  'KIR_ASSIGN_OP_UNSUPPORTED',
  'KIR_ASSIGN_TARGET_NOT_IDENTIFIER',
  'KIR_ASSIGN_TARGET_NOT_LET',
  'KIR_ASSIGN_TO_LOOP_COUNTER',
  'KIR_ASSIGN_TYPE_MISMATCH',
  'KIR_ASSIGN_UNDECLARED',
  'KIR_ASYNC_CALL_EXPRESSION_POSITION',
  'KIR_BINARY_OPERAND_TYPE',
  'KIR_BINARY_OPERATORS',
  'KIR_BINARY_OP_UNSUPPORTED',
  'KIR_BREAK_OUTSIDE_LOOP',
  'KIR_CALL_ARGUMENT_TAG',
  'KIR_CALL_ARGUMENT_TYPE',
  'KIR_CALL_ARITY',
  'KIR_CALL_CALLEE_CAPABILITY',
  'KIR_CALL_CALLEE_UNRESOLVED',
  'KIR_CALL_DEPTH_EXCEEDED',
  'KIR_CALL_RECURSION',
  'KIR_CALL_RETURN_TAG',
  'KIR_CALL_SIGNATURE_TYPE',
  'KIR_CONTINUE_OUTSIDE_LOOP',
  'KIR_CROSS_CALL_TYPES',
  'KIR_CROSS_CALL_TYPE_NAMES',
  'KIR_DEFAULT_CALL_POLICY',
  'KIR_FOR_BOUND_NOT_INTEGER',
  'KIR_FOR_ZERO_STEP',
  'KIR_IF_COND_NOT_BOOLEAN',
  'KIR_JUMP_WITHOUT_LOOP_FRAME',
  'KIR_LOOP_ZERO_STEP',
  'KIR_PROGRAM_FORMAT',
  'KIR_RUNTIME_FORMAT',
  'KIR_RUNTIME_OWNER',
  'KIR_TYPE_ADMISSION',
  'KIR_UNARY_OPERAND_TYPE',
  'KIR_UNARY_OPERATORS',
  'KIR_UNARY_OP_UNSUPPORTED',
  'KIR_VOID_HANDLER_NO_CALL_FORM',
  'KIR_VOID_HANDLER_VALUE_RETURN',
  'KIR_VOID_RETURN_TYPE',
  'KIR_WHILE_COND_NOT_BOOLEAN',
]);

export const JAVASCRIPT_FAULT_SITES = Object.freeze({
  'packages/core/src/compiler/kir-js-esm/emitter.ts': 24,
  'packages/core/src/compiler/kir-js-esm/target-base.ts': 6,
  'packages/core/src/compiler/kir-js-esm/target-execution.ts': 4,
  'packages/core/src/compiler/kir-js-esm/target-json.ts': 5,
});

export const JAVASCRIPT_FAULT_CODES = Object.freeze([
  'capability-error',
  'execution-cancelled',
  'execution-timeout',
  'handler-entry-not-found',
  'handler-entry-unsupported',
  'handler-link-error',
  'invalid-handler-arguments',
  'invalid-handler-result',
  'runtime-limit-exceeded',
  'unsupported-runtime-input',
]);

export const PYTHON_FAULT_SITES = Object.freeze({
  'packages/core/src/compiler/kir-python/emitter.ts': 21,
  'packages/core/src/compiler/kir-python/target-base.ts': 7,
  'packages/core/src/compiler/kir-python/target-execution.ts': 6,
  'packages/core/src/compiler/kir-python/target-json.ts': 6,
});

// The Python kernel never raises `handler-link-error`; the asymmetry is itself pinned so a slice
// that closes it has to move a row rather than widen the fault surface quietly.
export const PYTHON_FAULT_CODES = Object.freeze([
  'capability-error',
  'execution-cancelled',
  'execution-timeout',
  'handler-entry-not-found',
  'handler-entry-unsupported',
  'invalid-handler-arguments',
  'invalid-handler-result',
  'runtime-limit-exceeded',
  'unsupported-runtime-input',
]);

export const RUNTIME_FAULT_SITES = Object.freeze({
  'packages/core/src/kir-runtime/deadline.ts': 1,
  'packages/core/src/kir-runtime/envelope.ts': 1,
  'packages/core/src/kir-runtime/execute.ts': 11,
  // 22, not 20: `fix(kern5): fail closed when a jump has no enclosing loop frame` (e1d94060, an
  // ancestor of this tip landed after this pin was first authored) adds two `KIR_JUMP_WITHOUT_LOOP_FRAME`
  // KernKirFault sites.
  'packages/core/src/kir-runtime/expression.ts': 22,
  'packages/core/src/kir-runtime/inspect.ts': 12,
  'packages/core/src/kir-runtime/json.ts': 3,
  'packages/core/src/kir-runtime/linked-kir-program/contracts.ts': 1,
  'packages/core/src/kir-runtime/linked-kir-program/expression.ts': 2,
  // link.ts's one direct site is the projection-authentication-error throw; the other of the two
  // pre-split sites was always inside `fault()`, which the split moves to link-support.ts (D0-TD7).
  'packages/core/src/kir-runtime/linked-kir-program/link-support.ts': 1,
  'packages/core/src/kir-runtime/linked-kir-program/link.ts': 1,
});

// `instanceof KernKirFault` is a classifier, not a catcher: inspect.ts and execute.ts re-throw,
// envelope.ts and the two compiler entries convert at their own boundary.
export const FAULT_CLASSIFIER_SITES = Object.freeze({
  'packages/core/src/compiler/kir-js-esm/index.ts': 1,
  'packages/core/src/compiler/kir-js-esm/request.ts': 1,
  'packages/core/src/compiler/kir-python/index.ts': 1,
  'packages/core/src/compiler/kir-python/request.ts': 1,
  'packages/core/src/kir-runtime/envelope.ts': 1,
  'packages/core/src/kir-runtime/execute.ts': 2,
  'packages/core/src/kir-runtime/inspect.ts': 2,
  'packages/core/src/kir-runtime/linked-kir-program/link.ts': 1,
});

export const FAULT_CENSUS_TOTALS = Object.freeze({ javascript: 39, python: 40, runtime: 55 });

export const FAULT_MODEL_RULE =
  '__Fault / _Fault / KernKirFault denote VM-invariant collapse only: no site is reachable by a ' +
  'user catch, and a capability slice must consciously extend this census to change that.';

export const PREDECESSOR_INVENTORY = Object.freeze({
  count: 354,
  digest: '78ab887dbbf137326046a27fcabe4da3cc0adead7586005ce4b5987773a21ecb',
});

export const SUCCESSOR_INVENTORY_COUNT = 357;

export const ADDED_DIST_PATHS = Object.freeze([
  'kir-runtime/linked-kir-program/link-support.js',
  'kir-runtime/linked-kir-program/statements.js',
  'kir-runtime/linked-kir-program/walkers.js',
]);

export const TRANSITION_CLAIM = 'kern.kir-runtime.linked-kir-program.split.v1';

// Re-pinned past STEP-0-a's 2c6f4abd reading: e1d94060 (ancestor of this tip, landed after that
// reading) recompiles kir-runtime/expression.ts, moving the live compiled-core digest again.
export const BASE_COMPILED_CORE_DIGEST =
  '101269453b409ac45693d861c7e917bf4e3bd01fdb8ac7702f4838926413f397';

export const M4145_HISTORICAL_COUNT = 317;

// live(354) - M4.145-historical(305) = 49, not the 50 the spec estimated. After the split it is 52.
export const BASE_OMITTED_PATHS = Object.freeze([
  'compiler-kir-js-esm.js',
  'compiler-kir-python.js',
  'compiler/kir-js-esm/contracts.js',
  'compiler/kir-js-esm/emitter.js',
  'compiler/kir-js-esm/index.js',
  'compiler/kir-js-esm/request.js',
  'compiler/kir-js-esm/target-base.js',
  'compiler/kir-js-esm/target-execution.js',
  'compiler/kir-js-esm/target-hash.js',
  'compiler/kir-js-esm/target-json.js',
  'compiler/kir-python/contracts.js',
  'compiler/kir-python/emitter.js',
  'compiler/kir-python/index.js',
  'compiler/kir-python/request.js',
  'compiler/kir-python/target-base.js',
  'compiler/kir-python/target-execution.js',
  'compiler/kir-python/target-json.js',
  'each-collection-reference.js',
  'frontend-projection.js',
  'frontend-projection/assets.js',
  'frontend-projection/contracts.js',
  'frontend-projection/integrity.js',
  'frontend-projection/verified-brand.js',
  'ir/semantics/internal-effect-machine-deferred-binding.js',
  'ir/semantics/internal-effect-machine-text-splice.js',
  'ir/semantics/internal-text-code-point-cache.js',
  'ir/semantics/runner-call-cache.js',
  'kir-runtime/capability.js',
  'kir-runtime/contracts.js',
  'kir-runtime/deadline.js',
  'kir-runtime/digest.js',
  'kir-runtime/envelope.js',
  'kir-runtime/execute.js',
  'kir-runtime/expression.js',
  'kir-runtime/inspect.js',
  'kir-runtime/json.js',
  'kir-runtime/linked-kir-program/contracts.js',
  'kir-runtime/linked-kir-program/expression.js',
  'kir-runtime/linked-kir-program/index.js',
  'kir-runtime/linked-kir-program/link.js',
  'kir-structural/branch-path-value.js',
  'kir-structural/each-collection-reference.js',
  'kir-structural/runtime-inflate.js',
  'kir-v1/canonical.js',
  'kir-v1/types.js',
  'mutable-node-type-registry-snapshot.js',
  'parser-hint-snapshot.js',
  'runtime-envelope/kir-handler.js',
  'runtime-kir.js',
]);

export const BASE_OMITTED_PATH_COUNT = 49;

export const C_PY_1_TRANSITION_SHA256 =
  '357b74f7b14ba5390422b50d215de64fe4defa75be2052a75d99c71a9af317ed';

export const M4145_CHAIN_INPUT_COUNT = 317;

export const M4145_HISTORICAL_PATH_COUNT = 305;

export const RC_V1_AMENDMENT_COUNT = 3;

export const RC_V1_CONSUMED_CHAIN_LENGTH = 2;

export const ALPHA_RECEIPT_BINDING_COUNT = 125;

export const JAVASCRIPT_KERNEL_SHA256 =
  'b53251fd8a09f58226881b8f32547183e4b8300bab462d1373039426d3b057e6';
export const PYTHON_KERNEL_SHA256 =
  'f79a39633f58475124eafdec3c62a9fd042ffa50b1de637509d0f66e0f0cd18e';
export const F5_POLICY_SHA256 =
  '0f62f6c964af7265357ac0ef3f3a8a6aa15ffa2a2800e09ae5877bad90dbd942';

export const EVIDENCE_LEAF = 'test:kern-5-d0-contracts-split';

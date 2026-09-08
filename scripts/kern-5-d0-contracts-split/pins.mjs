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

export const LINE_BUDGETS = Object.freeze({
  'contracts.ts': 420,
  'expression.ts': 400,
  'index.ts': 60,
  'link-support.ts': 200,
  'link.ts': 420,
  'statements.ts': 340,
  'walkers.ts': 220,
});

export const BASE_LINE_COUNTS = Object.freeze({
  'contracts.ts': 535,
  'expression.ts': 358,
  'index.ts': 43,
  'link.ts': 735,
});

export const FILE_LINE_CEILING = 500;

// walkers.ts -> contracts.ts, link.ts -> {statements.ts, link-support.ts}, statements.ts ->
// link-support.ts, contracts.ts -> nothing inside the directory (INV-2).
export const EXPECTED_IMPORT_EDGES = Object.freeze({
  'contracts.ts': Object.freeze([]),
  'expression.ts': Object.freeze(['contracts.js']),
  'index.ts': Object.freeze(['contracts.js', 'expression.js', 'link.js', 'walkers.js']),
  'link-support.ts': Object.freeze(['contracts.js']),
  'link.ts': Object.freeze(['contracts.js', 'expression.js', 'link-support.js', 'statements.js']),
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
  'packages/core/src/kir-runtime/expression.ts': 20,
  'packages/core/src/kir-runtime/inspect.ts': 12,
  'packages/core/src/kir-runtime/json.ts': 3,
  'packages/core/src/kir-runtime/linked-kir-program/contracts.ts': 1,
  'packages/core/src/kir-runtime/linked-kir-program/expression.ts': 2,
  'packages/core/src/kir-runtime/linked-kir-program/link.ts': 2,
});

export const FAULT_CENSUS_TOTALS = Object.freeze({ javascript: 39, python: 40, runtime: 53 });

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

export const BASE_COMPILED_CORE_DIGEST =
  '4b1db71b0e8f36466c2d1c195e98f702263623a46b81dae03ccf4895bea1c17b';

export const M4145_HISTORICAL_COUNT = 317;

export const BASE_OMITTED_PATH_COUNT = 50;

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

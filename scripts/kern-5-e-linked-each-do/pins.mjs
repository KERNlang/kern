export const SPEC_PATH = '.Codex/specs/kern-5-e-linked-each-do/spec.md';

export const BASE_COMMIT = '2d216756';

export const FILE_LINE_CEILING = 500;

// 450, not 500: E.0 exists to buy headroom, and a 460-line landing would spend it the moment E1 or
// E2 touches the file. Every row below is the post-E.0 measured size plus room for its slice-E work.
export const EXTRACTION_LINE_BUDGET = 450;

export const LINE_BUDGETS = Object.freeze({
  'packages/core/src/compiler/kir-js-esm/emitter.ts': 220,
  'packages/core/src/compiler/kir-js-esm/statement-source.ts': 380,
  'packages/core/src/kir-runtime/expression.ts': 300,
  'packages/core/src/kir-runtime/linked-kir-program/loop-statements.ts': 200,
  'packages/core/src/kir-runtime/linked-kir-program/statements.ts': 430,
  'packages/core/src/kir-runtime/statement-walker.ts': 300,
});

export const EXTRACTED_MODULES = Object.freeze([
  'packages/core/src/compiler/kir-js-esm/statement-source.ts',
  'packages/core/src/kir-runtime/linked-kir-program/loop-statements.ts',
  'packages/core/src/kir-runtime/statement-walker.ts',
]);

export const BYTE_IDENTICAL_MODULES = Object.freeze(['packages/core/src/compiler/kir-python/emitter.ts']);

export const JAVASCRIPT_KERNEL_SHA256 = 'b53251fd8a09f58226881b8f32547183e4b8300bab462d1373039426d3b057e6';
export const PYTHON_KERNEL_SHA256 = 'f79a39633f58475124eafdec3c62a9fd042ffa50b1de637509d0f66e0f0cd18e';

export const EMITTED_DIGESTS_FORMAT = 'kern.kern-5-e.emitted-digests.v1';

// The three dist modules E.0 adds. The compiled-core inventory is authenticated by digest at the
// head of the canonicalizer chain, so a new module is a chain stage, never a silent count bump.
export const E0_ADDED_DIST_PATHS = Object.freeze([
  'compiler/kir-js-esm/statement-source.js',
  'kir-runtime/linked-kir-program/loop-statements.js',
  'kir-runtime/statement-walker.js',
]);

export const E0_INVENTORY_COUNT = 360;

export const STATEMENT_KINDS_AFTER_E = Object.freeze([
  'assign',
  'break',
  'capability',
  'continue',
  'do',
  'each',
  'for',
  'if',
  'let',
  'print',
  'return',
  'throw',
  'try',
  'while',
]);

// Spent means "a projectable fixture reaches this gate". `KIR_DO_PROPAGATION_UNSUPPORTED` is not
// spent: `do value="f(1)?"` never projects (probe 2026-09-09), so a linker branch carrying that
// label would be dead code behind a single-cause label nobody can reach.
export const DO_LABELS = Object.freeze([
  'KIR_DO_EXPRESSION_NOT_USER_CALL',
  'KIR_DO_JSON_INTRINSIC_UNSUPPORTED',
  'KIR_DO_MEMBER_CALL_UNSUPPORTED',
]);

// `KIR_EACH_TYPE_ANNOTATION_UNSUPPORTED` is likewise reserved, not spent: `each … type=…` never
// projects, in any type spelling (probe 2026-09-09).
export const EACH_LABELS = Object.freeze([
  'KIR_ASSIGN_TO_EACH_BINDING',
  'KIR_EACH_AWAIT_UNSUPPORTED',
  'KIR_EACH_ENTRIES_UNSUPPORTED',
  'KIR_EACH_ENTRY_MODE_UNSUPPORTED',
  'KIR_EACH_PAIR_MODE_UNSUPPORTED',
  'KIR_EACH_RECORD_FIELD_UNSUPPORTED',
  'KIR_EACH_SOURCE_NOT_LIST',
  'KIR_EACH_SOURCE_NOT_PARAMETER',
]);

export const RESERVED_UNREACHABLE_LABELS = Object.freeze([
  'KIR_DO_PROPAGATION_UNSUPPORTED',
  'KIR_EACH_TYPE_ANNOTATION_UNSUPPORTED',
]);

// Fixtures F5 refuses. Each one is asserted as a projection wall, and no link label may be credited
// to it.
export const F5_WALLED_POSITIONS = Object.freeze([
  'each-source-call',
  'each-source-list-literal',
  'each-type-annotation',
]);

// Reserved by the deferred `with` design and still unspent after slice F: neither gate is reachable
// from a projectable source, so a label that appears in source is a label whose contract nobody wrote.
export const RESERVED_WITH_LABELS = Object.freeze(['KIR_WITH_ACQUIRE_UNSUPPORTED', 'KIR_WITH_PROPAGATION_UNSUPPORTED']);

export const REUSED_LABELS = Object.freeze([
  'KIR_ASYNC_CALL_EXPRESSION_POSITION',
  'KIR_LOOP_JUMP_CROSSES_TRY',
  'KIR_VOID_HANDLER_NO_CALL_FORM',
]);

export const PYTHON_DEFERRAL_LABEL_KINDS = Object.freeze(['do', 'each']);

// `each` fails closed when its source value is not a list, once per leg: a `__Fault` in the emitted
// cursor loop and a `KernKirFault` in the walk. `do` adds none — it discards a value it never
// inspects. Both deltas land in files the d0 census already names, so no new fault-bearing file
// appears.
export const JAVASCRIPT_FAULT_SITE_DELTA = Object.freeze({
  'packages/core/src/compiler/kir-js-esm/statement-source.ts': 1,
});

export const RUNTIME_FAULT_SITE_DELTA = Object.freeze({
  'packages/core/src/kir-runtime/statement-walker.ts': 1,
});

export const EVIDENCE_LEAF = 'test:kern-5-e-linked-each-do';

export const PREDECESSOR_LEAF = 'test:kern-5-d-linked-try';

export const COMMIT_TAGS = Object.freeze(['E0', 'E1', 'E2', 'E3']);

// E2 is the slice's largest commit and therefore the one an abort would cut. The criterion is a
// measured comparison, not a judgement: if E2 alone claims more rows than E0+E1+E3 together, `each`
// is too large to land in one commit and its own labels return to unspent.
export const GATED_COMMIT_TAG = 'E2';

import {
  BASE_KIR_TOKENS,
  BASE_STATEMENT_KINDS,
  F5_POLICY_SHA256,
  JAVASCRIPT_KERNEL_SHA256,
  PYTHON_KERNEL_SHA256,
  RESERVED_LABELS,
} from '../kern-5-d0-contracts-split/pins.mjs';

export { BASE_KIR_TOKENS, BASE_STATEMENT_KINDS, F5_POLICY_SHA256, RESERVED_LABELS };

export const BASE_COMMIT = '071e5df9';

export const SPEC_PATH = '.Codex/specs/kern-5-d-linked-try/spec.md';

export const EVIDENCE_LEAF = 'test:kern-5-d-linked-try';

export const PREDECESSOR_LEAF = 'test:kern-5-d0-contracts-split';

export const FILE_LINE_CEILING = 500;

// Both kernels stay byte-frozen: `__UserThrow` and `__throwLabel` are emitted per module from
// `specializedSource`, never added to one of the four TARGET_* sources the digest is taken over.
export const FROZEN_KERNEL_DIGESTS = Object.freeze({
  javascript: JAVASCRIPT_KERNEL_SHA256,
  python: PYTHON_KERNEL_SHA256,
});

export const TARGET_STATEMENT_KINDS = Object.freeze([...BASE_STATEMENT_KINDS, 'throw', 'try'].sort());

export const NEW_STATEMENT_KINDS = Object.freeze(['throw', 'try']);

// D adds zero expression-union members: the payload rides the `record` kind that already carries a
// runtime arm and a Python lowering.
export const BASE_EXPRESSION_KIND_COUNT = 9;

export const THIRTEEN_DIAGNOSTIC_CODES = 13;

export const UNCAUGHT_THROW_CODE = 'uncaught-throw';

// Emitted, never registry members -- D.0's oracle deepEquals `labels` against the pinned eight, and
// `KIR_JUMP_WITHOUT_LOOP_FRAME` is rt12's own precedent for a label that was never reserved.
export const NEW_EMITTED_LABELS = Object.freeze([
  'KIR_FINALLY_WITHOUT_TRY',
  'KIR_THROW_PAYLOAD_SHAPE',
  'KIR_TRY_BODY_AFTER_CLAUSE',
  'KIR_TRY_FAMILY_IN_HELPER',
]);

// D-7d. `KIR_TRY_REQUIRES_CATCH` is spent by D2 and then *unspent again* by D5, because
// `try{}finally{}` becomes legal and the refusal it named stops being emitted. The key is deleted
// rather than nulled: D.0 asserts a spentBy entry may never resolve to null.
export const SPENT_LABELS_WITH_FINALLY = Object.freeze([
  'KIR_ABRUPT_FINALLY_UNSUPPORTED',
  'KIR_CATCH_AFTER_FINALLY',
  'KIR_CATCH_WITHOUT_TRY',
  'KIR_DUPLICATE_CATCH',
  'KIR_DUPLICATE_FINALLY',
  'KIR_LOOP_JUMP_CROSSES_TRY',
  'KIR_TRY_REQUIRES_CATCH_OR_FINALLY',
]);

export const SPENT_LABELS_WITHOUT_FINALLY = Object.freeze([
  'KIR_CATCH_WITHOUT_TRY',
  'KIR_DUPLICATE_CATCH',
  'KIR_TRY_REQUIRES_CATCH',
]);

export const SPENDING_SLICE = 'kern-5-d';

// The label registry set never grows; only `spentBy` moves. Retired-by-D5 labels are the ones the
// finally commit hands back.
export const UNSPENT_AFTER_FINALLY = Object.freeze(
  RESERVED_LABELS.filter((label) => !SPENT_LABELS_WITH_FINALLY.includes(label)),
);

// Recounted, not derived from the spec's own arithmetic: the spec's "39 + 8 = 48" is wrong twice
// over (D.0 already corrected the base to 40, and eleven labels arrive, not eight). The list is
// pinned explicitly so the count is a consequence rather than a claim.
export const TARGET_KIR_TOKENS_WITH_FINALLY = Object.freeze(
  [...BASE_KIR_TOKENS, ...NEW_EMITTED_LABELS, ...SPENT_LABELS_WITH_FINALLY].sort(),
);

export const TARGET_KIR_TOKENS_WITHOUT_FINALLY = Object.freeze(
  [
    ...BASE_KIR_TOKENS,
    ...NEW_EMITTED_LABELS.filter((label) => label !== 'KIR_FINALLY_WITHOUT_TRY'),
    ...SPENT_LABELS_WITHOUT_FINALLY,
  ].sort(),
);

// D.0's own budget row is 420, not the 340 the spec's Corrections Log reports: the raise landed with
// D.0's implementation. D still raises it, by twenty, for `compileTry`/`compileCatch`/`compileFinally`
// plus the payload gate and the clause partition.
export const LINE_BUDGETS = Object.freeze({
  // 481 at base against a 500 doctrine ceiling: the two `blockSource` arms plus the conditional
  // `__UserThrow`/`__throwLabel` prelude do not fit, so D owes this file an extraction the spec
  // never scheduled. The budget is set at the ceiling so the breach lands here.
  'packages/core/src/compiler/kir-js-esm/emitter.ts': 500,
  'packages/core/src/kir-runtime/execute.ts': 300,
  'packages/core/src/kir-runtime/expression.ts': 470,
  'packages/core/src/kir-runtime/linked-kir-program/contracts.ts': 420,
  'packages/core/src/kir-runtime/linked-kir-program/link-support.ts': 200,
  'packages/core/src/kir-runtime/linked-kir-program/link.ts': 420,
  'packages/core/src/kir-runtime/linked-kir-program/statements.ts': 440,
  'packages/core/src/kir-runtime/linked-kir-program/walkers.ts': 220,
});

export const BASE_LINE_COUNTS = Object.freeze({
  'packages/core/src/compiler/kir-js-esm/emitter.ts': 481,
  'packages/core/src/kir-runtime/execute.ts': 248,
  'packages/core/src/kir-runtime/expression.ts': 406,
  'packages/core/src/kir-runtime/linked-kir-program/contracts.ts': 366,
  'packages/core/src/kir-runtime/linked-kir-program/link-support.ts': 140,
  'packages/core/src/kir-runtime/linked-kir-program/link.ts': 353,
  'packages/core/src/kir-runtime/linked-kir-program/statements.ts': 285,
  'packages/core/src/kir-runtime/linked-kir-program/walkers.ts': 171,
});

// QD-2's headroom row. 406 measured today, ~54 estimated arms, so 470 leaves slack without opening
// a second inventory transition; 500 is the doctrine ceiling the same file must also clear.
export const RT1_EVALUATOR_HEADROOM = 470;

export const CHECK_ABORT_SITES = 2;

// D-2j, ruled. The spec's own row claims both new runtime sites carry `uncaught-throw`, which
// contradicts D-2c: on RT-1 an uncaught throw is a walk *completion*, so `expression.ts` raises no
// fault for it. The delta the oracle pins is therefore: `expression.ts` +1 (callHelper's `'threw'`
// fail-closed arm, D-2f(i)), `execute.ts` +2 (the uncaught-throw conversion at the entry walk, and
// the popped-helper-frame fail-closed arm, D-2f(ii)).
export const RUNTIME_FAULT_SITE_DELTA = Object.freeze({
  'packages/core/src/kir-runtime/execute.ts': 2,
  'packages/core/src/kir-runtime/expression.ts': 1,
});

export const JAVASCRIPT_FAULT_SITE_DELTA = Object.freeze({
  'packages/core/src/compiler/kir-js-esm/emitter.ts': 1,
});

export const PYTHON_FAULT_SITE_DELTA = Object.freeze({});

export const USER_THROW_CLASS = '__UserThrow';

export const THROW_LABEL_HELPER = '__throwLabel';

export const CLAMP_MESSAGE_UNITS = 256;

export const CLAMP_CODE_UNITS = 64;

// Digests the licensed cascade MUST move, pinned at their base value so a cascade that forgot one
// fails here rather than in a neighbour suite.
export const CASCADE_BASE_DIGESTS = Object.freeze({
  'scripts/kern-5-parity-ledger/parity-ledger.json':
    '76e61c71032bd74601c75651cb15528b46bcd22dddd20133352de2a05989e0ec',
  'scripts/kern-5-rt2-boolean-if/k0-golden.json':
    'ea64e2ef7bc824bf62d632533488bda484c81aa783fb04d7940af9f249b2ac87',
  'scripts/kern-5-rt3-binary-expression/k0-golden.json':
    'd871bd4cd495d6c85b1621ee13b042a8651d714ff26204b3c505b5719ee3f291',
  'scripts/kern-5-rt4-user-fn-call/probe-matrix.json':
    '91d6ec600e8f4dd2df7113ffb37125d5bedf4a9ebb83a395f9ddb0f17d4f0e9c',
  'scripts/kern-5-rt9-linked-assign/k0-golden.json':
    '41ca43d8a5aa73f18f323dd86c9f647ee923f2b5b22f8b3cec7124c5864f39aa',
});

// Digests no D commit may move. Each one is a whole leg D does not touch.
export const FROZEN_NEIGHBOUR_DIGESTS = Object.freeze({
  'scripts/kern-5-rt10-cross-call-integer/k0-golden.json':
    '6deab8ccfd16aacc79543fad945b62e62a71027bc1c2673b764125fa9158f4cf',
  'scripts/kern-5-rt10-pre-linked-arithmetic/k0-golden.json':
    '87efee4df8ce4fbde5d954d74e859f3e4f889598e0f35fedca8d56705515f718',
  'scripts/kern-5-rt6-void-fallthrough/k0-golden.json':
    '429de5ebbb5e606acfd48764b506d38b6abc4c5c6270bca883b34aa027306e81',
});

export const FROZEN_PYTHON_DIRECTORY_FILES = 7;

export const COMPILED_CORE_COUNT = 357;

export const RC_V1_AMENDMENT_COUNT = 3;

export const ALPHA_RECEIPT_BINDING_COUNT = 125;

export const LEDGER_NODE_KINDS = Object.freeze(['break', 'continue', 'throw', 'try', 'while']);

// D-2h refuses the try family in a helper at link, so a `helper-body` deferral row would go RED for
// the linker's reason instead of the deferral's. The omission gets its own oracle row.
export const TRY_ROW_POSITION_NAMES = Object.freeze(['for-body', 'handler-top-level', 'if-else', 'if-then']);

export const OMITTED_ROW_POSITION = 'helper-body';

export const CONTRACT_WALL_SCRIPTS = Object.freeze([
  'check-rule-coverage.mjs',
  'check-runtime-contract-v1.mjs',
  'check-runtime-envelope.mjs',
]);

export const COMMIT_TAGS = Object.freeze(['D1', 'D2', 'D3', 'D4', 'D5']);

export const GATED_COMMIT_TAG = 'D5';

export const SPEC_PATH = '.Codex/specs/kern-5-f-linked-with/spec.md';

export const BASE_COMMIT = '2dd26302';

export const FILE_LINE_CEILING = 450;

// QF-3. `with` is expanded at link, so only the linker files may grow at all; the three budgets that
// are not linker files are pinned at their base size and are also asserted byte-identical below.
export const LINE_BUDGETS = Object.freeze({
  'packages/core/src/compiler/kir-js-esm/statement-source.ts': 380,
  'packages/core/src/kir-runtime/expression.ts': 300,
  'packages/core/src/kir-runtime/linked-kir-program/contracts.ts': 420,
  'packages/core/src/kir-runtime/linked-kir-program/link-support.ts': 200,
  'packages/core/src/kir-runtime/linked-kir-program/link.ts': 400,
  'packages/core/src/kir-runtime/linked-kir-program/statements.ts': 430,
  'packages/core/src/kir-runtime/statement-walker.ts': 320,
});

// The expansion's whole point: no leg, no lowering table and not even the union learns a new kind,
// so every one of these files must be byte-identical to base. A diff here means `with` reached a
// consumer instead of dissolving in the linker.
export const BYTE_IDENTICAL_MODULES = Object.freeze([
  'packages/core/src/compiler/kir-js-esm/statement-source.ts',
  'packages/core/src/compiler/kir-python/emitter.ts',
  'packages/core/src/compiler/kir-python/request.ts',
  'packages/core/src/kir-runtime/linked-kir-program/contracts.ts',
  'packages/core/src/kir-runtime/statement-walker.ts',
]);

// F5 is frozen: `with` already projects with every property the linker reads, so a diff here means
// the slice bought its admission by moving the frontend wall instead of writing a linker contract.
export const FROZEN_F5_PATHS = Object.freeze([
  'packages/core/src/schema.ts',
  'packages/core/src/kir-structural/catalog.generated.ts',
  'packages/core/src/kir-structural',
]);

export const JAVASCRIPT_KERNEL_SHA256 = 'b53251fd8a09f58226881b8f32547183e4b8300bab462d1373039426d3b057e6';
export const PYTHON_KERNEL_SHA256 = 'f79a39633f58475124eafdec3c62a9fd042ffa50b1de637509d0f66e0f0cd18e';

export const PROBE_MATRIX_FORMAT = 'kern.kern-5-f.probe-matrix.v1';
export const BEHAVIOR_TABLE_FORMAT = 'kern.kern-5-f.behavior-table.v1';
export const COMMIT_ROWS_FORMAT = 'kern.oracle.f-linked-with.commit-rows.v1';

// Unchanged by F. `with` dissolves into `let` and `try` at link, so it never becomes a fifteenth
// member and no consumer of the union has to learn it.
export const STATEMENT_KINDS_AFTER_F = Object.freeze([
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

export const STILL_OUTSIDE_AFTER_F = Object.freeze(['set']);

// Reserved by slice E, spent by F: each one now has exactly one declaration site, in statements.ts.
export const SPENT_WITH_LABELS = Object.freeze([
  'KIR_WITH_CLEANUP_REQUIRED',
  'KIR_WITH_CLEANUP_UNSUPPORTED',
  'KIR_WITH_PROTOCOL_UNSUPPORTED',
]);

export const NEW_WITH_LABELS = Object.freeze([
  'KIR_ASSIGN_TO_WITH_BINDING',
  'KIR_WITH_ASYNC_MISMATCH',
  'KIR_WITH_IN_HELPER',
]);

export const DECLARED_WITH_LABELS = Object.freeze([...SPENT_WITH_LABELS, ...NEW_WITH_LABELS].sort());

export const LABEL_DECLARATION_SITE = 'packages/core/src/kir-runtime/linked-kir-program/statements.ts';

// Neither gate is reachable from a projectable source — `?` never projects, and the `let` rule
// admits every acquire `with` must admit — so a source file that spells either label carries dead
// code behind a single-cause name.
export const UNSPENT_WITH_LABELS = Object.freeze([
  'KIR_WITH_ACQUIRE_UNSUPPORTED',
  'KIR_WITH_PROPAGATION_UNSUPPORTED',
]);

export const REUSED_LABELS = Object.freeze([
  'KIR_ASYNC_CALL_EXPRESSION_POSITION',
  'KIR_LOOP_JUMP_CROSSES_TRY',
  'KIR_VOID_HANDLER_NO_CALL_FORM',
  'KIR_VOID_HANDLER_VALUE_RETURN',
]);

// `with`'s allowedChildren carry no `catch`, no `finally` and no `capability`, so a `try` family
// clause and a capability declaration inside a with body never reach the linker. Measured 2026-09-10.
export const F5_WALLED_POSITIONS = Object.freeze([
  'wall-capability-in-with',
  'wall-try-in-with',
  'wall-with-catch-child',
  'wall-with-cleanup-propagate',
  'wall-with-extra-prop',
  'wall-with-no-name',
  'wall-with-no-value',
  'wall-with-value-propagate',
]);

// Unmoved. `with` adds no linked kind, so it adds no deferral row: its Python refusal is the `try`
// row's and the `do` row's, already carried since slice D and slice E.
export const LEDGER_ROW_COUNT_AFTER_F = 7;

export const LEDGER_KINDS_AFTER_F = Object.freeze([
  'break',
  'continue',
  'do',
  'each',
  'throw',
  'try',
  'while',
]);

// QF-2: both counts are E's, re-pinned unchanged. `with` reuses the statement boundary and the
// finally-bearing try frame, so it introduces no third checkpoint and no new loop head.
export const CHECK_ABORT_SITES = Object.freeze({
  'packages/core/src/kir-runtime/expression.ts': 0,
  'packages/core/src/kir-runtime/statement-walker.ts': 2,
});

export const EVIDENCE_LEAF = 'test:kern-5-f-linked-with';

export const PREDECESSOR_LEAF = 'test:kern-5-e-linked-each-do';

export const COMMIT_TAGS = Object.freeze(['F0', 'F1', 'F2']);

// F1 is the only commit that turns a refusal into an admission, so it is the one an abort would cut.
export const GATED_COMMIT_TAG = 'F1';

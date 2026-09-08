const LINKED_CONTRACTS = 'packages/core/src/kir-runtime/linked-kir-program/contracts.ts';
const LINKED_LINK = 'packages/core/src/kir-runtime/linked-kir-program/link.ts';
const LINKED_SUPPORT = 'packages/core/src/kir-runtime/linked-kir-program/link-support.ts';
const RUNTIME_CONTRACTS = 'packages/core/src/kir-runtime/contracts.ts';

const STATEMENT_UNION = 'export type LinkedKernKirStatement =';
const EXPRESSION_UNION = 'export type LinkedKernKirExpression =';
const UNARY_OPERATOR = 'export type LinkedKernKirUnaryOperator =';
const NEXT_EXPORT = '\nexport ';

// `reads` is the file the prior-slice test names today; `readsAfter` is the file it must name once
// D.0 lands. They differ for exactly one row, which is the only forced prior-slice re-point.
export const SCRAPE_TABLE = Object.freeze([
  Object.freeze({
    id: 'parity-ledger/statement-union',
    test: 'scripts/kern-5-parity-ledger/ledger-support.mjs',
    reads: LINKED_CONTRACTS,
    readsAfter: LINKED_CONTRACTS,
    start: STATEMENT_UNION,
    end: NEXT_EXPORT,
    family: 1,
  }),
  Object.freeze({
    id: 'parity-ledger/expression-union',
    test: 'scripts/kern-5-parity-ledger/ledger-support.mjs',
    reads: LINKED_CONTRACTS,
    readsAfter: LINKED_CONTRACTS,
    start: EXPRESSION_UNION,
    end: NEXT_EXPORT,
    family: 1,
  }),
  Object.freeze({
    id: 'rt2-boolean-if/statement-union',
    test: 'scripts/kern-5-rt2-boolean-if/k0-golden.test.mjs',
    reads: LINKED_CONTRACTS,
    readsAfter: LINKED_CONTRACTS,
    start: STATEMENT_UNION,
    end: NEXT_EXPORT,
    family: 1,
  }),
  Object.freeze({
    id: 'rt9-linked-assign/statement-union',
    test: 'scripts/kern-5-rt9-linked-assign/k0-golden.test.mjs',
    reads: LINKED_CONTRACTS,
    readsAfter: LINKED_CONTRACTS,
    start: STATEMENT_UNION,
    end: NEXT_EXPORT,
    family: 1,
  }),
  Object.freeze({
    id: 'rt3-binary-expression/expression-union',
    test: 'scripts/kern-5-rt3-binary-expression/k0-golden.test.mjs',
    reads: LINKED_CONTRACTS,
    readsAfter: LINKED_CONTRACTS,
    start: EXPRESSION_UNION,
    end: NEXT_EXPORT,
    family: 1,
  }),
  Object.freeze({
    id: 'rt4-user-fn-call/expression-union',
    test: 'scripts/kern-5-rt4-user-fn-call/probe-matrix.test.mjs',
    reads: LINKED_CONTRACTS,
    readsAfter: LINKED_CONTRACTS,
    start: EXPRESSION_UNION,
    end: NEXT_EXPORT,
    family: 1,
  }),
  Object.freeze({
    id: 'rt10-pre-linked-arithmetic/expression-union',
    test: 'scripts/kern-5-rt10-pre-linked-arithmetic/k0-golden.test.mjs',
    reads: LINKED_CONTRACTS,
    readsAfter: LINKED_CONTRACTS,
    start: EXPRESSION_UNION,
    end: NEXT_EXPORT,
    family: 1,
  }),
  Object.freeze({
    id: 'rt10-pre-linked-arithmetic/unary-operator',
    test: 'scripts/kern-5-rt10-pre-linked-arithmetic/k0-golden.test.mjs',
    reads: LINKED_CONTRACTS,
    readsAfter: LINKED_CONTRACTS,
    start: UNARY_OPERATOR,
    end: ';',
    family: 1,
  }),
  Object.freeze({
    id: 'rt10-cross-call-integer/expression-union',
    test: 'scripts/kern-5-rt10-cross-call-integer/k0-golden.test.mjs',
    reads: LINKED_CONTRACTS,
    readsAfter: LINKED_CONTRACTS,
    start: EXPRESSION_UNION,
    end: NEXT_EXPORT,
    family: 1,
  }),
  Object.freeze({
    id: 'rt10-for/compatibility',
    test: 'scripts/kern-5-rt10-for/compatibility.test.mjs',
    reads: LINKED_CONTRACTS,
    readsAfter: LINKED_CONTRACTS,
    start: STATEMENT_UNION,
    end: 'function expressionVariantUnhandled',
    family: 2,
  }),
  Object.freeze({
    id: 'rt10-for/walker-coverage',
    test: 'scripts/kern-5-rt10-for/walker-coverage.test.mjs',
    reads: LINKED_CONTRACTS,
    readsAfter: LINKED_CONTRACTS,
    start: STATEMENT_UNION,
    end: 'function expressionVariantUnhandled',
    family: 2,
  }),
  Object.freeze({
    id: 'rt11-linked-while/compatibility',
    test: 'scripts/kern-5-rt11-linked-while/compatibility.test.mjs',
    reads: LINKED_CONTRACTS,
    readsAfter: LINKED_CONTRACTS,
    start: STATEMENT_UNION,
    end: 'function expressionVariantUnhandled',
    family: 2,
  }),
  Object.freeze({
    id: 'rt11-linked-while/walker-coverage',
    test: 'scripts/kern-5-rt11-linked-while/walker-coverage.test.mjs',
    reads: LINKED_CONTRACTS,
    readsAfter: LINKED_CONTRACTS,
    start: STATEMENT_UNION,
    end: 'function expressionVariantUnhandled',
    family: 2,
  }),
  Object.freeze({
    id: 'rt12-linked-jumps/compatibility',
    test: 'scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs',
    reads: LINKED_CONTRACTS,
    readsAfter: LINKED_CONTRACTS,
    start: STATEMENT_UNION,
    end: 'function statementSubBlocks',
    family: 2,
  }),
  Object.freeze({
    id: 'rt12-linked-jumps/walker-coverage',
    test: 'scripts/kern-5-rt12-linked-jumps/walker-coverage.test.mjs',
    reads: LINKED_CONTRACTS,
    readsAfter: LINKED_CONTRACTS,
    start: STATEMENT_UNION,
    end: 'function statementSubBlocks',
    family: 2,
  }),
  Object.freeze({
    id: 'rt10-for/limits',
    test: 'scripts/kern-5-rt10-for/compatibility.test.mjs',
    reads: RUNTIME_CONTRACTS,
    readsAfter: RUNTIME_CONTRACTS,
    start: 'export interface KernKirLimits',
    end: 'export interface KernKirRequest',
    family: 3,
  }),
  Object.freeze({
    id: 'rt11-linked-while/limits',
    test: 'scripts/kern-5-rt11-linked-while/compatibility.test.mjs',
    reads: RUNTIME_CONTRACTS,
    readsAfter: RUNTIME_CONTRACTS,
    start: 'export interface KernKirLimits',
    end: 'export interface KernKirRequest',
    family: 3,
  }),
  Object.freeze({
    id: 'rt12-linked-jumps/limits',
    test: 'scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs',
    reads: RUNTIME_CONTRACTS,
    readsAfter: RUNTIME_CONTRACTS,
    start: 'export interface KernKirLimits',
    end: 'export interface KernKirRequest',
    family: 3,
  }),
  Object.freeze({
    id: 'rt10-for/diagnostic-codes',
    test: 'scripts/kern-5-rt10-for/compatibility.test.mjs',
    reads: RUNTIME_CONTRACTS,
    readsAfter: RUNTIME_CONTRACTS,
    start: 'export type KernKirDiagnosticCode =',
    end: 'export interface KernKirDiagnostic ',
    family: 3,
  }),
  Object.freeze({
    id: 'rt11-linked-while/diagnostic-codes',
    test: 'scripts/kern-5-rt11-linked-while/compatibility.test.mjs',
    reads: RUNTIME_CONTRACTS,
    readsAfter: RUNTIME_CONTRACTS,
    start: 'export type KernKirDiagnosticCode =',
    end: 'export interface KernKirDiagnostic ',
    family: 3,
  }),
  Object.freeze({
    id: 'rt12-linked-jumps/diagnostic-codes',
    test: 'scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs',
    reads: RUNTIME_CONTRACTS,
    readsAfter: RUNTIME_CONTRACTS,
    start: 'export type KernKirDiagnosticCode =',
    end: 'export interface KernKirDiagnostic ',
    family: 3,
  }),
  Object.freeze({
    id: 'rt12-linked-jumps/leaf-pair',
    test: 'scripts/kern-5-rt12-linked-jumps/walker-coverage.test.mjs',
    reads: LINKED_LINK,
    readsAfter: LINKED_SUPPORT,
    start: 'function containsReturn',
    end: 'function assertLeaf',
    family: 4,
  }),
]);

export const SCRAPED_FILES = Object.freeze([...new Set(SCRAPE_TABLE.map((row) => row.reads))].sort());

export const CONTRACTS_SCRAPE_TESTS = Object.freeze(
  [...new Set(SCRAPE_TABLE.filter((row) => row.reads === LINKED_CONTRACTS).map((row) => row.test))].sort(),
);

// INV-1: these stay in contracts.ts, in this order, so every Family-1 anchor precedes every
// Family-2 end marker and no scrape can silently unbound itself.
export const CONTRACTS_MARKER_ORDER = Object.freeze([
  UNARY_OPERATOR,
  EXPRESSION_UNION,
  STATEMENT_UNION,
  'function statementSubBlocks',
  'function statementSubExpressions',
  'function expressionVariantUnhandled',
]);

// Declaration forms, exactly as they read at column zero in the base sources. A file that holds a
// declaration still holds this substring once the split prefixes it with `export`, so the same
// string serves both the "moved here" row and the "left there" row.
export const WALKER_MARKERS = Object.freeze([
  'type CapabilityClosure =',
  'interface LinkedKernKirClosureWalk {',
  'function createLinkedKirClosureWalk(',
  'function expressionInvokesCapability(',
  'function statementsInvokeCapability(',
  'function linkedStatementsInvokeCapability(',
  'function expressionCallDepth(',
  'function calleeDepth(',
  'function statementsCallDepth(',
  'function linkedStatementsCallDepth(',
]);

export const LINK_SUPPORT_MARKERS = Object.freeze([
  'function fault(',
  'function nodeKind(',
  'function propertyText(',
  'function propertyBool(',
  'function propertySet(',
  'function containsReturn(',
  'function assertLeaf(',
  'interface LinkScope {',
  'interface ModuleContext {',
  'function branchScope(',
  'function bindName(',
  'function assignTargetName(',
]);

export const STATEMENTS_MARKERS = Object.freeze([
  'const ASYNC_POSITION_LABEL =',
  'function assertAsyncCallPosition(',
  'function compileStatement(',
  'function compileBranch(',
  'function compileIf(',
  'const LOOP_STEP_ONE:',
  'function loopBound(',
  'function compileFor(',
  'function compileWhile(',
  'function compileBlock(',
]);

export const LINK_RETAINED_MARKERS = Object.freeze([
  'function authenticateLinkedKernKirProjectionOrThrow(',
  'function parameterType(',
  'function handlerReturnType(',
  'function moduleFunctions(',
  'function resolveHelper(',
  'function helperIsAsync(',
  'function callScope(',
  'function compileHandler(',
  'function selectHandler(',
  'function linkVerifiedKernKirProgramOrThrow(',
  'function linkVerifiedKernKirProgram(',
]);

export const SETTLED_SCRAPES = Object.freeze(SCRAPE_TABLE.filter((row) => row.reads === row.readsAfter));

export const REPOINTED_SCRAPES = Object.freeze(SCRAPE_TABLE.filter((row) => row.reads !== row.readsAfter));

import type { CompletionKind } from '../src/ir/semantics/trace.js';
import type { IRNode } from '../src/types.js';

interface FailureAcceptanceCase {
  readonly kind: 'preflight-failure';
  readonly nodes: readonly IRNode[];
}

interface ProviderFailureAcceptanceCase {
  readonly kind: 'provider-failure-tombstone';
  readonly mode: 'async' | 'cancel' | 'sync';
  readonly nodes: readonly IRNode[];
}

interface SuccessAcceptanceCase {
  readonly kind: 'success';
  readonly nodes: readonly IRNode[];
  readonly completion: CompletionKind;
  readonly errorKind?: string;
  readonly providerCalls: number;
  readonly stdout: readonly string[];
  readonly tombstone?: boolean;
  readonly value?: unknown;
}

export type M313AcceptanceCase = FailureAcceptanceCase | ProviderFailureAcceptanceCase | SuccessAcceptanceCase;

const cap = (namespace = 'storage', operation = 'get'): IRNode => ({
  type: 'capability',
  props: { namespace, operation },
});
const llm = (): IRNode => cap('llm', 'complete');
const print = (value: string): IRNode => ({ type: 'print', props: { value } });
const ret = (value = '7'): IRNode => ({ type: 'return', props: { value } });
const throwError = (): IRNode => ({ type: 'throw', props: { value: 'new Error("boom")' } });
const catchNode = (children: IRNode[]): IRNode => ({ type: 'catch', props: { name: 'error' }, children });
const finallyNode = (children: IRNode[]): IRNode => ({ type: 'finally', children });
const tryNode = (children: IRNode[]): IRNode => ({ type: 'try', children });
const success = (
  nodes: readonly IRNode[],
  stdout: readonly string[],
  options: Partial<Omit<SuccessAcceptanceCase, 'kind' | 'nodes' | 'stdout'>> = {},
): SuccessAcceptanceCase => ({
  kind: 'success',
  nodes,
  completion: options.completion ?? 'normal',
  providerCalls: options.providerCalls ?? 0,
  stdout,
  ...options,
});
const preflight = (children: IRNode[]): FailureAcceptanceCase => ({
  kind: 'preflight-failure',
  nodes: [tryNode([cap(), ...children])],
});
const returnWithCatch = (placement: IRNode[]): FailureAcceptanceCase =>
  preflight([...placement, catchNode([print('"caught"')])]);
const abruptFinally = (abrupt: IRNode): FailureAcceptanceCase => preflight([finallyNode([abrupt])]);
const providerFailure = (mode: 'async' | 'cancel' | 'sync'): ProviderFailureAcceptanceCase => ({
  kind: 'provider-failure-tombstone',
  mode,
  nodes: [tryNode([throwError(), catchNode([llm()])])],
});

const selectedReturnBranch: IRNode = {
  type: 'branch',
  props: { on: '"selected"' },
  children: [
    {
      type: 'path',
      props: { value: 'selected' },
      __quotedProps: ['value'],
      children: [ret()],
    },
  ],
};

export const M3_13_ACCEPTANCE_CASES: Readonly<Record<string, M313AcceptanceCase>> = Object.freeze({
  'preflight-body-before-capability': preflight([
    { type: 'lambda', props: { name: 'unsupported' } },
    finallyNode([print('"cleanup"')]),
  ]),
  'preflight-catch-before-capability': preflight([catchNode([{ type: 'lambda', props: { name: 'unsupported' } }])]),
  'preflight-finally-before-capability': preflight([finallyNode([{ type: 'lambda', props: { name: 'unsupported' } }])]),
  'catch-binding-replaces-throw-and-tombstones': success(
    [tryNode([throwError(), catchNode([print('error.message')])])],
    ['boom'],
    { tombstone: true },
  ),
  'finally-preserves-normal': success(
    [tryNode([print('"work"'), finallyNode([print('"cleanup"')])])],
    ['work', 'cleanup'],
  ),
  'finally-preserves-return': success([tryNode([ret(), finallyNode([print('"cleanup"')])])], ['cleanup'], {
    completion: 'return',
    value: 7,
  }),
  'finally-preserves-uncaught-throw': success(
    [tryNode([throwError(), finallyNode([print('"cleanup"')])])],
    ['cleanup'],
    { completion: 'throw', errorKind: 'Error' },
  ),
  'finally-preserves-caught-throw': success(
    [tryNode([throwError(), catchNode([print('"caught"')]), finallyNode([print('"cleanup"')])])],
    ['caught', 'cleanup'],
  ),
  'abrupt-finally-return-rejects': abruptFinally(ret('9')),
  'abrupt-finally-throw-rejects': abruptFinally(throwError()),
  'abrupt-finally-break-rejects': abruptFinally({ type: 'break' }),
  'abrupt-finally-continue-rejects': abruptFinally({ type: 'continue' }),
  'capabilities-in-body-catch-finally': success(
    [
      tryNode([
        llm(),
        throwError(),
        catchNode([llm(), print('error.message')]),
        finallyNode([llm(), print('"cleanup"')]),
      ]),
    ],
    ['boom', 'cleanup'],
    { providerCalls: 3, tombstone: true },
  ),
  'try-inside-counted-for': success(
    [
      {
        type: 'for',
        props: { name: 'index', from: '0', to: '1' },
        children: [cap(), tryNode([print('index'), finallyNode([print('"cleanup"')])])],
      },
    ],
    ['0', 'cleanup'],
    { providerCalls: 1 },
  ),
  'try-inside-array-each': success(
    [
      {
        type: 'each',
        props: { in: 'items', name: 'item' },
        children: [cap(), tryNode([print('item'), finallyNode([print('"cleanup"')])])],
      },
    ],
    ['1', 'cleanup'],
    { providerCalls: 1 },
  ),
  'try-inside-while': success(
    [
      {
        type: 'while',
        props: { cond: 'true' },
        children: [cap(), tryNode([print('"work"'), { type: 'break' }, finallyNode([print('"cleanup"')])])],
      },
    ],
    ['work', 'cleanup'],
    { providerCalls: 1 },
  ),
  'loop-inside-try-body': success(
    [
      tryNode([
        { type: 'for', props: { name: 'index', from: '0', to: '1' }, children: [print('index')] },
        finallyNode([print('"cleanup"')]),
      ]),
    ],
    ['0', 'cleanup'],
  ),
  'loop-inside-try-catch': success(
    [
      tryNode([
        throwError(),
        catchNode([{ type: 'for', props: { name: 'index', from: '0', to: '1' }, children: [print('index')] }]),
        finallyNode([print('"cleanup"')]),
      ]),
    ],
    ['0', 'cleanup'],
    { tombstone: true },
  ),
  'loop-inside-try-finally': success(
    [
      tryNode([
        print('"work"'),
        finallyNode([{ type: 'each', props: { in: 'items', name: 'item' }, children: [print('item')] }]),
      ]),
    ],
    ['work', '1'],
  ),
  'break-through-finally': success(
    [
      {
        type: 'while',
        props: { cond: 'true' },
        children: [tryNode([{ type: 'break' }, finallyNode([print('"cleanup"')])])],
      },
    ],
    ['cleanup'],
  ),
  'continue-through-finally': success(
    [
      {
        type: 'for',
        props: { name: 'index', from: '0', to: '2' },
        children: [tryNode([{ type: 'continue' }, finallyNode([print('"cleanup"')])])],
      },
    ],
    ['cleanup', 'cleanup'],
  ),
  'nested-try-in-body': success(
    [tryNode([tryNode([print('"work"'), finallyNode([print('"inner"')])]), finallyNode([print('"outer"')])])],
    ['work', 'inner', 'outer'],
  ),
  'nested-try-in-catch': success(
    [
      tryNode([
        throwError(),
        catchNode([tryNode([print('"work"'), finallyNode([print('"inner"')])])]),
        finallyNode([print('"outer"')]),
      ]),
    ],
    ['work', 'inner', 'outer'],
    { tombstone: true },
  ),
  'nested-caught-try-in-finally': success(
    [
      tryNode([
        print('"work"'),
        finallyNode([tryNode([throwError(), catchNode([print('"caught"')]), finallyNode([print('"inner"')])])]),
      ]),
    ],
    ['work', 'caught', 'inner'],
    { tombstone: true },
  ),
  'return-with-catch-direct-rejects': returnWithCatch([ret()]),
  'return-with-catch-if-rejects': returnWithCatch([{ type: 'if', props: { cond: 'true' }, children: [ret()] }]),
  'return-with-catch-else-rejects': returnWithCatch([
    { type: 'if', props: { cond: 'false' }, children: [print('"unselected"')] },
    { type: 'else', children: [ret()] },
  ]),
  'return-with-catch-branch-rejects': returnWithCatch([selectedReturnBranch]),
  'return-with-catch-for-rejects': returnWithCatch([
    { type: 'for', props: { name: 'index', from: '0', to: '1' }, children: [ret()] },
  ]),
  'return-with-catch-each-rejects': returnWithCatch([
    { type: 'each', props: { in: 'items', name: 'item' }, children: [ret()] },
  ]),
  'return-with-catch-while-rejects': returnWithCatch([{ type: 'while', props: { cond: 'false' }, children: [ret()] }]),
  'return-with-catch-nested-try-rejects': returnWithCatch([tryNode([ret(), finallyNode([])])]),
  'finally-loop-consumes-break': success(
    [
      tryNode([
        print('"work"'),
        finallyNode([
          { type: 'for', props: { name: 'index', from: '0', to: '2' }, children: [{ type: 'break' }] },
          print('"cleanup"'),
        ]),
      ]),
    ],
    ['work', 'cleanup'],
  ),
  'provider-failure-tombstones-sync-catch': providerFailure('sync'),
  'provider-failure-tombstones-async-catch': providerFailure('async'),
  'scheduler-cancellation-tombstones-async-catch': providerFailure('cancel'),
});

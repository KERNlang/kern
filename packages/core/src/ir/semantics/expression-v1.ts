/** Registry-facing semantic contract adapter for `expression-v1`. */

import type { IRNode } from '../../types.js';
import { runExpressionV1, expressionV1Preconditions as runtimePreconditions } from './expression-v1-runtime.js';
import { type NodeContract, type NodeFixture, registerContract, type SemanticEnv } from './index.js';
import { evalPortableValue } from './portable-scalar.js';

function expressionV1Preconditions(ir: IRNode, env: SemanticEnv): boolean {
  return runtimePreconditions(ir, env, evalPortableValue);
}

function expressionV1Effects(ir: IRNode, env: SemanticEnv) {
  return runExpressionV1(ir, env, evalPortableValue);
}

function expressionV1Completion() {
  return { kind: 'normal' as const };
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([
  {
    description: 'expression-v1: number scalar',
    ir: { type: 'expression-v1', props: { name: 'n', expr: '42' } },
    expected: { events: [{ op: 'assign', target: 'n', value: 42 }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: string scalar',
    ir: { type: 'expression-v1', props: { name: 's', expr: '"hello"' } },
    expected: { events: [{ op: 'assign', target: 's', value: 'hello' }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: boolean scalar',
    ir: { type: 'expression-v1', props: { name: 'b', expr: 'true' } },
    expected: { events: [{ op: 'assign', target: 'b', value: true }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: null scalar',
    ir: { type: 'expression-v1', props: { name: 'nl', expr: 'null' } },
    expected: { events: [{ op: 'assign', target: 'nl', value: null }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: equality',
    ir: { type: 'expression-v1', props: { name: 'eq', expr: 'x === y' } },
    env: {
      bindings: new Map([
        ['x', 1],
        ['y', 1],
      ]),
    },
    expected: { events: [{ op: 'assign', target: 'eq', value: true }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: truthiness basic',
    ir: { type: 'expression-v1', props: { name: 'truth', expr: '!x' } },
    env: { bindings: new Map([['x', '']]) },
    expected: { events: [{ op: 'assign', target: 'truth', value: true }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: template literal string coercion',
    ir: { type: 'expression-v1', props: { name: 'res', expr: '`n=${n}`' } },
    env: { bindings: new Map([['n', 100]]) },
    expected: { events: [{ op: 'assign', target: 'res', value: 'n=100' }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: String coercion constructor call',
    ir: { type: 'expression-v1', props: { name: 'res', expr: 'String(n)' } },
    env: { bindings: new Map([['n', 100]]) },
    expected: { events: [{ op: 'assign', target: 'res', value: '100' }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: String coercion canonicalizes null',
    ir: { type: 'expression-v1', props: { name: 'res', expr: 'String(n)' } },
    env: { bindings: new Map([['n', null]]) },
    expected: { events: [{ op: 'assign', target: 'res', value: 'null' }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: String coercion canonicalizes boolean',
    ir: { type: 'expression-v1', props: { name: 'res', expr: 'String(flag)' } },
    env: { bindings: new Map([['flag', false]]) },
    expected: { events: [{ op: 'assign', target: 'res', value: 'false' }], completion: { kind: 'normal' } },
  },
  {
    description: 'expression-v1: ExprObject expression prop',
    ir: { type: 'expression-v1', props: { name: 'res', expr: { __expr: true, code: 'n + 1' } } },
    env: { bindings: new Map([['n', 41]]) },
    expected: { events: [{ op: 'assign', target: 'res', value: 42 }], completion: { kind: 'normal' } },
  },
]);

export const expressionV1Contract: NodeContract = {
  nodeType: 'expression-v1',
  preconditions: expressionV1Preconditions,
  effects: expressionV1Effects,
  completion: expressionV1Completion,
  forbiddenRewrites: [],
  fixtures: FIXTURES,
};

let registered = false;

export function registerExpressionV1Contract(): void {
  if (registered) return;
  registerContract(expressionV1Contract);
  registered = true;
}

export function _resetExpressionV1ContractForTest(): void {
  registered = false;
}

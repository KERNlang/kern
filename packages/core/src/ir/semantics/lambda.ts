/**
 * `lambda` runtime semantics — executable contract for single-expression closures.
 *
 * Scope:
 *   - expression-bodied lambdas only
 *   - normal by-reference capture for outer non-loop bindings
 *   - fresh per-iteration capture for callback loop parameters (the canonical
 *     KERN behavior matching TS callback invocation scope)
 *
 * Multi-statement/block closures are intentionally out of scope for this
 * contract. Fixtures use this node as a semantics wrapper: production emitters
 * see only normal KERN body statements after fixture lowering.
 */

import { type NodeContract, type NodeFixture, registerContract, type SemanticEnv } from './index.js';
import { checkLambdaPreconditions } from './lambda-preconditions.js';
import { evaluateLambdaCompletion, evaluateLambdaEffects } from './lambda-runtime.js';

const FORBIDDEN_REWRITES: readonly string[] = Object.freeze([
  'convert by-reference outer captures into by-value snapshots',
  'reuse callback loop binding across closure instances (Python late-binding closure bug)',
  'rewrite single-expression lambda body into multi-statement closure',
  'evaluate lambda body before invocation',
]);

function envBinding(name: string, value: unknown): Partial<SemanticEnv> {
  return { bindings: new Map([[name, value]]) };
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([
  {
    description: 'lambda: List.map transforms each item with a single-expression callback',
    ir: { type: 'lambda', props: { expr: 'List.map(xs, x => x * 2)' } },
    env: envBinding('xs', [1, 2, 3]),
    expected: { events: [{ op: 'stdout', text: '2,4,6' }], completion: { kind: 'normal' } },
  },
  {
    description: 'lambda: List.filter keeps items whose callback returns truthy',
    ir: { type: 'lambda', props: { expr: 'List.filter(xs, x => x > 1)' } },
    env: envBinding('xs', [1, 2, 3]),
    expected: { events: [{ op: 'stdout', text: '2,3' }], completion: { kind: 'normal' } },
  },
  {
    description: 'lambda: closure reads the current outer binding by reference',
    ir: {
      type: 'lambda',
      props: { expr: '[fn()]' },
      children: [
        { type: 'let', props: { name: 'outer', kind: 'let', value: '1' } },
        { type: 'let', props: { name: 'fn', value: '() => outer' } },
        { type: 'assign', props: { target: 'outer', value: '2' } },
      ],
    },
    expected: { events: [{ op: 'stdout', text: '2' }], completion: { kind: 'normal' } },
  },
  {
    description: 'lambda: two closures capture and read different outer bindings',
    ir: {
      type: 'lambda',
      props: { expr: '[readA(), readB()]' },
      children: [
        { type: 'let', props: { name: 'a', kind: 'let', value: '1' } },
        { type: 'let', props: { name: 'b', kind: 'let', value: '2' } },
        { type: 'let', props: { name: 'readA', value: '() => a' } },
        { type: 'let', props: { name: 'readB', value: '() => b' } },
        { type: 'assign', props: { target: 'a', value: '10' } },
        { type: 'assign', props: { target: 'b', value: '20' } },
      ],
    },
    expected: { events: [{ op: 'stdout', text: '10,20' }], completion: { kind: 'normal' } },
  },
  {
    description: 'lambda: closures produced in a callback loop capture fresh per-iteration bindings',
    ir: {
      type: 'lambda',
      props: { expr: 'List.map(List.map(xs, x => () => x), f => f())' },
    },
    env: envBinding('xs', [1, 2, 3]),
    expected: { events: [{ op: 'stdout', text: '1,2,3' }], completion: { kind: 'normal' } },
  },
]);

export const lambdaContract: NodeContract = {
  nodeType: 'lambda',
  preconditions: checkLambdaPreconditions,
  effects: evaluateLambdaEffects,
  completion: evaluateLambdaCompletion,
  forbiddenRewrites: FORBIDDEN_REWRITES,
  fixtures: FIXTURES,
};

let registered = false;

/** Idempotent registration. Test cleanup that clears the registry must re-call. */
export function registerLambdaContract(): void {
  if (registered) return;
  registerContract(lambdaContract);
  registered = true;
}

/** Reset registration flag — only for test cleanup that clears the registry. */
export function _resetLambdaContractForTest(): void {
  registered = false;
}

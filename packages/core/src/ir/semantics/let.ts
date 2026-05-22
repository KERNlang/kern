/**
 * `let` runtime semantics.
 *
 * Operational semantics:
 *   1. Evaluate the required initializer exactly once in the current block.
 *   2. If initializer evaluation completes abruptly, propagate that completion
 *      and create no binding. The executable Phase 1 domain accepts only
 *      portable scalar expressions, so fixtures exercise the normal path.
 *   3. Create a binding local to the current block and emit one observable
 *      assignment trace event: `{op:"assign", target:name, value}`.
 *   4. Complete normally.
 *
 * Portability domain:
 *   - `name` is a cross-target identifier, not already bound in the current
 *     semantic environment, and not a known JS/Python/KERN builtin name.
 *   - `value` is required and evaluates to a portable scalar: string, finite
 *     number, boolean, or null.
 *   - Expressions are the shared portable-scalar subset (see
 *     `./portable-scalar.ts`): literals, identifiers resolving to portable
 *     scalars, arithmetic over numbers, comparisons over same-typed scalars,
 *     boolean/nullish operators over portable truthiness, and conditionals.
 *
 * Exclusions:
 *   Bare declarations, destructuring, same-block redeclaration, builtin
 *   shadowing, TDZ/use-before-declare, and block-scope leaks are outside this
 *   contract because TS and Python disagree on at least one observable edge.
 */

import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import { type NodeContract, type NodeFixture, registerContract, type SemanticEnv } from './index.js';
import { evalPortableValue, isPortableBindingName } from './portable-scalar.js';
import type { Trace } from './trace.js';

interface LetProps {
  name?: string;
  kind?: unknown;
  value?: unknown;
}

function asLetProps(ir: IRNode): LetProps {
  return (ir.props ?? {}) as LetProps;
}

function letPreconditions(ir: IRNode, env: SemanticEnv): boolean {
  const props = asLetProps(ir);
  if (!isPortableBindingName(props.name)) return false;
  if (env.bindings.has(props.name)) return false;
  if (!Object.hasOwn(ir.props ?? {}, 'value') || props.value === '') return false;
  if (props.kind !== undefined && props.kind !== '' && props.kind !== 'let' && props.kind !== 'const') return false;
  try {
    evalPortableValue(parseExpression(String(props.value)), env);
    return true;
  } catch {
    return false;
  }
}

function letEffects(ir: IRNode, env: SemanticEnv): Trace {
  const props = asLetProps(ir);
  const name = props.name as string;
  const value = evalPortableValue(parseExpression(String(props.value)), env);
  env.bindings.set(name, value);
  return { events: [{ op: 'assign', target: name, value }], completion: { kind: 'normal' } };
}

function letCompletion(ir: IRNode, env: SemanticEnv) {
  return letEffects(ir, env).completion;
}

const FORBIDDEN_REWRITES: readonly string[] = Object.freeze([
  'hoist the declaration',
  'collapse block-scoped let to var/global',
  'widen block scope to function scope',
  'silently convert let to const',
]);

function fixture(
  description: string,
  ir: IRNode,
  expectedEvents: Trace['events'],
  env?: Partial<SemanticEnv>,
): NodeFixture {
  return {
    description,
    ir,
    env,
    expected: { events: expectedEvents, completion: { kind: 'normal' } },
  };
}

const FIXTURES: readonly NodeFixture[] = Object.freeze([
  fixture(
    'let: string initializer creates one block-local binding',
    { type: 'let', props: { name: 'label', value: '"paid"' } },
    [{ op: 'assign', target: 'label', value: 'paid' }],
  ),
  fixture(
    'let: numeric expression reads an existing portable binding once',
    { type: 'let', props: { name: 'total', value: 'base + 2' } },
    [{ op: 'assign', target: 'total', value: 5 }],
    { bindings: new Map([['base', 3]]) },
  ),
  fixture('let: boolean initializer is portable', { type: 'let', props: { name: 'flag', value: 'true' } }, [
    { op: 'assign', target: 'flag', value: true },
  ]),
  fixture('let: null initializer is portable', { type: 'let', props: { name: 'missing', value: 'null' } }, [
    { op: 'assign', target: 'missing', value: null },
  ]),
  fixture(
    'let: a later declaration may reference an earlier binding in the same block',
    {
      type: '__block',
      props: { __semanticContract: 'let' },
      children: [
        { type: 'let', props: { name: 'first', value: '1' } },
        { type: 'let', props: { name: 'second', value: 'first + 1' } },
      ],
    },
    [
      { op: 'assign', target: 'first', value: 1 },
      { op: 'assign', target: 'second', value: 2 },
    ],
  ),
]);

export const letContract: NodeContract = {
  nodeType: 'let',
  preconditions: letPreconditions,
  effects: letEffects,
  completion: letCompletion,
  forbiddenRewrites: FORBIDDEN_REWRITES,
  fixtures: FIXTURES,
};

let registered = false;

/** Idempotent registration. Test cleanup that clears the registry must re-call. */
export function registerLetContract(): void {
  if (registered) return;
  registerContract(letContract);
  registered = true;
}

/** Reset registration flag — only for test cleanup that clears the registry. */
export function _resetLetContractForTest(): void {
  registered = false;
}

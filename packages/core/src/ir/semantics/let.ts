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
 *   - Expressions are deliberately small: literals, identifiers resolving to
 *     portable scalars, arithmetic over numbers, comparisons over same-typed
 *     scalars, boolean/nullish operators over portable truthiness, and
 *     conditional expressions.
 *
 * Exclusions:
 *   Bare declarations, destructuring, same-block redeclaration, builtin
 *   shadowing, TDZ/use-before-declare, and block-scope leaks are outside this
 *   contract because TS and Python disagree on at least one observable edge.
 */

import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { type NodeContract, type NodeFixture, registerContract, type SemanticEnv } from './index.js';
import type { Trace } from './trace.js';

type PortableScalar = string | number | boolean | null;

interface LetProps {
  name?: string;
  kind?: unknown;
  value?: unknown;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const RESERVED_NAMES = new Set([
  'Array',
  'Boolean',
  'JSON',
  'List',
  'Map',
  'Math',
  'None',
  'Number',
  'Object',
  'Set',
  'String',
  'True',
  'False',
  'bool',
  'class',
  'const',
  'def',
  'dict',
  'else',
  'false',
  'for',
  'function',
  'if',
  'int',
  'len',
  'let',
  'list',
  'null',
  'print',
  'return',
  'str',
  'true',
  'undefined',
  'var',
  'while',
]);

function asLetProps(ir: IRNode): LetProps {
  return (ir.props ?? {}) as LetProps;
}

function isPortableScalar(value: unknown): value is PortableScalar {
  if (value === null) return true;
  if (typeof value === 'string') return true;
  if (typeof value === 'boolean') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

function assertPortableScalar(value: unknown, label: string): PortableScalar {
  if (isPortableScalar(value)) return value;
  throw new Error(`let: ${label} must evaluate to a portable scalar`);
}

function portableTruthy(value: PortableScalar): boolean {
  if (value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value.length > 0;
}

function sameType(a: PortableScalar, b: PortableScalar): boolean {
  if (a === null || b === null) return a === b;
  return typeof a === typeof b;
}

function evalPortableValue(node: ValueIR, env: SemanticEnv): PortableScalar {
  switch (node.kind) {
    case 'numLit':
      if (node.bigint || !Number.isFinite(node.value)) throw new Error('let: number literal must be finite');
      return node.value;
    case 'strLit':
      return node.value;
    case 'boolLit':
      return node.value;
    case 'nullLit':
      return null;
    case 'ident': {
      if (!env.bindings.has(node.name)) throw new Error(`let: binding "${node.name}" not found`);
      return assertPortableScalar(env.bindings.get(node.name), `binding "${node.name}"`);
    }
    case 'unary': {
      const value = evalPortableValue(node.argument, env);
      if (node.op === '!') return !portableTruthy(value);
      if (node.op === '-' || node.op === '+') {
        if (typeof value !== 'number') throw new Error(`let: unary ${node.op} requires a number`);
        const out = node.op === '-' ? -value : value;
        return assertPortableScalar(out, `unary ${node.op}`);
      }
      throw new Error(`let: unsupported unary op "${node.op}"`);
    }
    case 'binary':
      return evalPortableBinary(node, env);
    case 'conditional':
      return portableTruthy(evalPortableValue(node.test, env))
        ? evalPortableValue(node.consequent, env)
        : evalPortableValue(node.alternate, env);
    case 'typeAssert':
    case 'nonNull':
      return evalPortableValue(node.expression, env);
    default:
      throw new Error(`let: expression kind "${node.kind}" is outside the portable scalar domain`);
  }
}

function evalPortableBinary(node: Extract<ValueIR, { kind: 'binary' }>, env: SemanticEnv): PortableScalar {
  if (node.op === '&&') {
    const left = evalPortableValue(node.left, env);
    return portableTruthy(left) ? evalPortableValue(node.right, env) : left;
  }
  if (node.op === '||') {
    const left = evalPortableValue(node.left, env);
    return portableTruthy(left) ? left : evalPortableValue(node.right, env);
  }
  if (node.op === '??') {
    const left = evalPortableValue(node.left, env);
    return left === null ? evalPortableValue(node.right, env) : left;
  }

  const left = evalPortableValue(node.left, env);
  const right = evalPortableValue(node.right, env);
  switch (node.op) {
    case '+':
      if (typeof left === 'number' && typeof right === 'number') return assertPortableScalar(left + right, '+');
      if (typeof left === 'string' && typeof right === 'string') return left + right;
      throw new Error('let: + requires two numbers or two strings');
    case '-':
    case '*':
    case '/':
    case '%':
      return evalNumberBinary(node.op, left, right);
    case '===':
    case '==':
      if (!sameType(left, right)) throw new Error('let: equality operands must have the same portable type');
      return left === right;
    case '!==':
    case '!=':
      if (!sameType(left, right)) throw new Error('let: equality operands must have the same portable type');
      return left !== right;
    case '<':
    case '<=':
    case '>':
    case '>=':
      if (
        !sameType(left, right) ||
        !(
          (typeof left === 'number' && typeof right === 'number') ||
          (typeof left === 'string' && typeof right === 'string')
        )
      ) {
        throw new Error(`let: ${node.op} requires same-typed number or string operands`);
      }
      return evalOrderedComparison(node.op, left, right);
    default:
      throw new Error(`let: unsupported binary op "${node.op}"`);
  }
}

function evalNumberBinary(op: string, left: PortableScalar, right: PortableScalar): PortableScalar {
  if (typeof left !== 'number' || typeof right !== 'number') throw new Error(`let: ${op} requires numbers`);
  if (op === '-') return assertPortableScalar(left - right, op);
  if (op === '*') return assertPortableScalar(left * right, op);
  if (op === '/') return assertPortableScalar(left / right, op);
  return assertPortableScalar(left % right, op);
}

function evalOrderedComparison(op: string, left: string | number, right: string | number): boolean {
  if (op === '<') return left < right;
  if (op === '<=') return left <= right;
  if (op === '>') return left > right;
  return left >= right;
}

function letPreconditions(ir: IRNode, env: SemanticEnv): boolean {
  const props = asLetProps(ir);
  if (typeof props.name !== 'string' || !IDENT_RE.test(props.name)) return false;
  if (RESERVED_NAMES.has(props.name) || props.name.startsWith('__k') || props.name.startsWith('_kern')) return false;
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

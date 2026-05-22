/**
 * Portable-scalar expression evaluator — the cross-target-safe core shared by
 * the body-statement binding contracts (`let`, `assign`, and the `while`
 * condition).
 *
 * The portable scalar domain is the subset of values TS and Python agree on
 * observably: string, finite number, boolean, null. Expressions are kept
 * deliberately small — literals, identifiers resolving to portable scalars,
 * arithmetic over numbers, comparisons over same-typed scalars, boolean /
 * nullish operators over portable truthiness, and conditional expressions.
 * Same-type guards (`sameType`) keep the evaluator out of the divergent
 * corners (Python `bool == int`, mixed-type ordering, etc.); out-of-domain
 * inputs throw, and callers translate that throw into a precondition failure.
 *
 * Extracted from the `let` contract so `assign` and `while` reuse one
 * evaluator instead of forking subtly different copies. There is intentionally
 * no shared evaluator for the collection contracts (`for` / `lambda` keep their
 * own minimal local `evalValue`) — this module is scoped to scalar bindings.
 */

import type { ValueIR } from '../../value-ir.js';
import type { SemanticEnv } from './index.js';

export type PortableScalar = string | number | boolean | null;

export const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const RESERVED_NAMES = new Set([
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

/** True when `name` is a syntactically valid, non-reserved, non-internal binding name. */
export function isPortableBindingName(name: unknown): name is string {
  if (typeof name !== 'string' || !IDENT_RE.test(name)) return false;
  if (RESERVED_NAMES.has(name)) return false;
  return !name.startsWith('__k') && !name.startsWith('_kern');
}

export function isPortableScalar(value: unknown): value is PortableScalar {
  if (value === null) return true;
  if (typeof value === 'string') return true;
  if (typeof value === 'boolean') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

export function assertPortableScalar(value: unknown, label: string): PortableScalar {
  if (isPortableScalar(value)) return value;
  throw new Error(`portable: ${label} must evaluate to a portable scalar`);
}

export function portableTruthy(value: PortableScalar): boolean {
  if (value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value.length > 0;
}

export function sameType(a: PortableScalar, b: PortableScalar): boolean {
  if (a === null || b === null) return a === b;
  return typeof a === typeof b;
}

export function evalPortableValue(node: ValueIR, env: SemanticEnv): PortableScalar {
  switch (node.kind) {
    case 'numLit':
      if (node.bigint || !Number.isFinite(node.value)) throw new Error('portable: number literal must be finite');
      return node.value;
    case 'strLit':
      return node.value;
    case 'boolLit':
      return node.value;
    case 'nullLit':
      return null;
    case 'ident': {
      if (!env.bindings.has(node.name)) throw new Error(`portable: binding "${node.name}" not found`);
      return assertPortableScalar(env.bindings.get(node.name), `binding "${node.name}"`);
    }
    case 'unary': {
      const value = evalPortableValue(node.argument, env);
      if (node.op === '!') return !portableTruthy(value);
      if (node.op === '-' || node.op === '+') {
        if (typeof value !== 'number') throw new Error(`portable: unary ${node.op} requires a number`);
        const out = node.op === '-' ? -value : value;
        return assertPortableScalar(out, `unary ${node.op}`);
      }
      throw new Error(`portable: unsupported unary op "${node.op}"`);
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
      throw new Error(`portable: expression kind "${node.kind}" is outside the portable scalar domain`);
  }
}

export function evalPortableBinary(node: Extract<ValueIR, { kind: 'binary' }>, env: SemanticEnv): PortableScalar {
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
      throw new Error('portable: + requires two numbers or two strings');
    case '-':
    case '*':
    case '/':
    case '%':
      return evalNumberBinary(node.op, left, right);
    case '===':
    case '==':
      if (!sameType(left, right)) throw new Error('portable: equality operands must have the same portable type');
      return left === right;
    case '!==':
    case '!=':
      if (!sameType(left, right)) throw new Error('portable: equality operands must have the same portable type');
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
        throw new Error(`portable: ${node.op} requires same-typed number or string operands`);
      }
      return evalOrderedComparison(node.op, left, right);
    default:
      throw new Error(`portable: unsupported binary op "${node.op}"`);
  }
}

export function evalNumberBinary(op: string, left: PortableScalar, right: PortableScalar): PortableScalar {
  if (typeof left !== 'number' || typeof right !== 'number') throw new Error(`portable: ${op} requires numbers`);
  if (op === '-') return assertPortableScalar(left - right, op);
  if (op === '*') return assertPortableScalar(left * right, op);
  if (op === '/') return assertPortableScalar(left / right, op);
  return assertPortableScalar(left % right, op);
}

export function evalOrderedComparison(op: string, left: string | number, right: string | number): boolean {
  if (op === '<') return left < right;
  if (op === '<=') return left <= right;
  if (op === '>') return left > right;
  return left >= right;
}

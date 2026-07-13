import {
  assertPortableDecimalLiteral,
  DECIMAL_DIV_ZERO_FAILCLOSE,
  DECIMAL_MOD_ZERO_FAILCLOSE,
  DECIMAL_POW_ZERO_NEGATIVE_EXP_FAILCLOSE,
  DECIMAL_SCALE_FAILCLOSE,
  type KDecimalCtor,
  type KDecimalValue,
  kDecimalDiv,
  kDecimalMod,
  kDecimalPowInt,
  kernDecimalStr,
  makeKDecimal,
} from '../../decimal/contract.js';
import {
  assertNonZeroDecimalDivisor,
  assertPortableDecimalPow,
  DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE,
  type DecimalProbeAccessor,
} from '../../decimal/probe-gates.js';
import type { ValueIR } from '../../value-ir.js';
import { getBinding, hasBinding, type SemanticEnv } from './index.js';
import { isDecimalValue, type PortableScalar } from './portable-scalar-domain.js';

const VALUE_METHODS = new Set(['of', 'add', 'mul', 'sub', 'neg', 'abs', 'div', 'mod', 'pow']);
const COMPARATOR_METHODS = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'cmp']);

const ACCESSOR: DecimalProbeAccessor<ValueIR> = {
  callKind: 'call',
  receiverName(node) {
    return node.kind === 'call' && node.callee.kind === 'member' && node.callee.object.kind === 'ident'
      ? node.callee.object.name
      : null;
  },
  methodName(node) {
    return node.kind === 'call' && node.callee.kind === 'member' ? node.callee.property : null;
  },
  argNode(node, index) {
    return node.kind === 'call' ? (node.args[index] ?? null) : null;
  },
  argKind(node) {
    return node.kind;
  },
  argLiteralValue(node) {
    return node.kind === 'strLit' ? node.value : null;
  },
};

function freshDecimalEvalEnv(): SemanticEnv {
  return { bindings: new Map(), seed: 0, now: 0 };
}

function unwrapTransparent(node: ValueIR): ValueIR {
  let current = node;
  while (current.kind === 'nonNull' || current.kind === 'typeAssert') current = current.expression;
  return current;
}

export function isDecimalNamespaceCall(node: ValueIR): node is Extract<ValueIR, { kind: 'call' }> {
  return (
    node.kind === 'call' &&
    node.callee.kind === 'member' &&
    node.callee.object.kind === 'ident' &&
    node.callee.object.name === 'Decimal'
  );
}

export function decimalNamespaceMethod(node: ValueIR): string | null {
  const inner = unwrapTransparent(node);
  return isDecimalNamespaceCall(inner) ? (inner.callee as Extract<ValueIR, { kind: 'member' }>).property : null;
}

export function isCanonicalDecimalLiteralFailure(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(DECIMAL_SCALE_FAILCLOSE);
}

export function isRunnerNativeDecimalFailClose(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.startsWith(DECIMAL_SCALE_FAILCLOSE) ||
    error.message.startsWith(DECIMAL_DIV_ZERO_FAILCLOSE) ||
    error.message.startsWith(DECIMAL_MOD_ZERO_FAILCLOSE) ||
    error.message.startsWith(DECIMAL_POW_ZERO_NEGATIVE_EXP_FAILCLOSE) ||
    error.message.startsWith(DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE)
  );
}

function evalDecimalNode(node: ValueIR, env: SemanticEnv, KDecimal: KDecimalCtor): KDecimalValue {
  const inner = unwrapTransparent(node);
  if (inner.kind === 'ident') {
    const bound = getBinding(env, inner.name);
    if (!isDecimalValue(bound)) {
      throw new Error(`portable-decimal: binding "${inner.name}" is not a Decimal value`);
    }
    return new KDecimal(bound.canonical);
  }
  if (!isDecimalNamespaceCall(inner)) {
    throw new Error('portable-decimal: expected a Decimal.<method>(...) namespace call');
  }
  const method = (inner.callee as Extract<ValueIR, { kind: 'member' }>).property;
  if (!VALUE_METHODS.has(method)) {
    throw new Error(`portable-decimal: Decimal.${method} does not produce a Decimal value`);
  }
  if (method === 'of') {
    if (inner.args.length !== 1) throw new Error('portable-decimal: Decimal.of expects exactly 1 argument');
    const arg = inner.args[0];
    if (arg.kind !== 'strLit') throw new Error('portable-decimal: Decimal.of requires a string literal argument');
    assertPortableDecimalLiteral(arg.value);
    return new KDecimal(arg.value);
  }
  if (method === 'neg' || method === 'abs') {
    if (inner.args.length !== 1) {
      throw new Error(`portable-decimal: Decimal.${method} expects exactly 1 argument`);
    }
    const operand = evalDecimalNode(inner.args[0], env, KDecimal);
    return method === 'neg' ? operand.neg() : operand.abs();
  }
  if (inner.args.length !== 2) {
    throw new Error(`portable-decimal: Decimal.${method} expects exactly 2 arguments`);
  }
  if (method === 'div' || method === 'mod') {
    assertNonZeroDecimalDivisor(method, inner.args[1], ACCESSOR);
  } else if (method === 'pow') {
    assertPortableDecimalPow(inner.args[0], inner.args[1], ACCESSOR);
  }
  const left = evalDecimalNode(inner.args[0], env, KDecimal);
  const right = evalDecimalNode(inner.args[1], env, KDecimal);
  switch (method) {
    case 'add':
      return left.plus(right);
    case 'sub':
      return left.minus(right);
    case 'mul':
      return left.times(right);
    case 'div':
      return kDecimalDiv(left, right);
    case 'mod':
      return kDecimalMod(left, right);
    case 'pow':
      return kDecimalPowInt(KDecimal, left, right);
    default:
      throw new Error(`portable-decimal: unsupported Decimal value method "${method}"`);
  }
}

export function evalRunnerNativeDecimalScalarCall(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
): PortableScalar | undefined {
  if (hasBinding(env, 'Decimal')) return undefined;
  const method = decimalNamespaceMethod(node);
  if (method === null || !COMPARATOR_METHODS.has(method)) return undefined;
  if (node.args.length !== 2) {
    throw new Error(`portable-decimal: Decimal.${method} expects exactly 2 arguments`);
  }
  const KDecimal = makeKDecimal();
  const left = evalDecimalNode(node.args[0], env, KDecimal);
  const right = evalDecimalNode(node.args[1], env, KDecimal);
  switch (method) {
    case 'eq':
      return left.eq(right);
    case 'ne':
      return !left.eq(right);
    case 'lt':
      return left.lt(right);
    case 'lte':
      return left.lte(right);
    case 'gt':
      return left.gt(right);
    case 'gte':
      return left.gte(right);
    case 'cmp':
      return left.cmp(right);
    default:
      throw new Error(`portable-decimal: unsupported Decimal scalar method "${method}"`);
  }
}

export function isDecimalExpression(node: ValueIR): boolean {
  const inner = unwrapTransparent(node);
  const isOperand = (operand: ValueIR): boolean => {
    const unwrapped = unwrapTransparent(operand);
    return unwrapped.kind === 'ident' || isDecimalExpression(unwrapped);
  };
  if (!isDecimalNamespaceCall(inner)) return false;
  const method = (inner.callee as Extract<ValueIR, { kind: 'member' }>).property;
  if (VALUE_METHODS.has(method)) {
    if (method === 'of') return inner.args.length === 1 && inner.args[0].kind === 'strLit';
    if (method === 'neg' || method === 'abs') return inner.args.length === 1 && isOperand(inner.args[0]);
    return inner.args.length === 2 && isOperand(inner.args[0]) && isOperand(inner.args[1]);
  }
  return (
    COMPARATOR_METHODS.has(method) && inner.args.length === 2 && isOperand(inner.args[0]) && isOperand(inner.args[1])
  );
}

export function isDecimalValueExpression(node: ValueIR): boolean {
  const method = decimalNamespaceMethod(node);
  return method !== null && VALUE_METHODS.has(method) && isDecimalExpression(node);
}

export function evalDecimalExpression(node: ValueIR, env: SemanticEnv = freshDecimalEvalEnv()): string {
  const KDecimal = makeKDecimal();
  return kernDecimalStr(evalDecimalNode(node, env, KDecimal));
}

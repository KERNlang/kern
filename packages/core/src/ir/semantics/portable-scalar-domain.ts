import type { ValueIR } from '../../value-ir.js';
import { isCaughtErrorValue } from './caught-error.js';
import { isIntProvenanced, type RunnerClassInstanceValue, type SemanticEnv } from './index.js';

export type PortableScalar = string | number | boolean | null;

export const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const RESERVED_NAMES = new Set([
  'Array', 'Boolean', 'JSON', 'List', 'Map', 'Math', 'None', 'Number', 'Object', 'Set', 'String',
  'True', 'False', 'bool', 'class', 'const', 'def', 'dict', 'else', 'false', 'for', 'function', 'if',
  'int', 'len', 'let', 'list', 'null', 'print', 'return', 'str', 'true', 'undefined', 'var', 'while',
]);

export function isPortableBindingName(name: unknown): name is string {
  if (typeof name !== 'string' || !IDENT_RE.test(name)) return false;
  if (RESERVED_NAMES.has(name)) return false;
  return !name.startsWith('__k') && !name.startsWith('_kern');
}

export function isPortableScalar(value: unknown): value is PortableScalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

export const DECIMAL_VALUE_TAG: unique symbol = Symbol('kern.decimalValue');

export interface DecimalValue {
  readonly [DECIMAL_VALUE_TAG]: true;
  readonly canonical: string;
}

export function makeDecimalValue(canonical: string): DecimalValue {
  return Object.freeze({ [DECIMAL_VALUE_TAG]: true as const, canonical });
}

export function isDecimalValue(value: unknown): value is DecimalValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [DECIMAL_VALUE_TAG]?: unknown })[DECIMAL_VALUE_TAG] === true &&
    typeof (value as { canonical?: unknown }).canonical === 'string'
  );
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

export type PortableRecord = Readonly<Record<string, PortableScalar | RunnerPortableArrayValue>>;
export type RunnerPortableArrayValue = ReadonlyArray<PortableScalar | RunnerPortableArrayValue>;
export type RunnerPortableValue = PortableScalar | PortableRecord | RunnerPortableArrayValue;
export type RunnerFunctionValue = RunnerPortableValue | RunnerClassInstanceValue;

export interface EvalRecordLiteralOptions {
  readonly captureFreshArrayBindings?: boolean;
}

export function isRunnerClassInstanceValue(value: unknown): value is RunnerClassInstanceValue {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as Partial<RunnerClassInstanceValue>).__kernRunnerClassInstance === true &&
    typeof (value as Partial<RunnerClassInstanceValue>).className === 'string' &&
    Boolean((value as Partial<RunnerClassInstanceValue>).fields) &&
    typeof (value as Partial<RunnerClassInstanceValue>).fields === 'object'
  );
}

export function isPortableRecordValue(value: unknown): value is PortableRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (isDecimalValue(value) || isCaughtErrorValue(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value as Record<string, unknown>).every(
    (field) => isPortableScalar(field) || isRunnerPortableArrayValue(field),
  );
}

export function isRunnerPortableArrayValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): value is RunnerPortableArrayValue {
  if (!Array.isArray(value) || seen.has(value)) return false;
  seen.add(value);
  try {
    return value.every((item) => isPortableScalar(item) || isRunnerPortableArrayValue(item, seen));
  } finally {
    seen.delete(value);
  }
}

export function assertRunnerPortableValue(value: unknown, label: string): RunnerPortableValue {
  if (isPortableScalar(value) || isPortableRecordValue(value) || isRunnerPortableArrayValue(value)) return value;
  throw new Error(`portable: ${label} must evaluate to a portable scalar, record, or array`);
}

export function assertArithmeticResultNotFloatCollapsed(
  left: number,
  right: number,
  result: PortableScalar,
  op: string,
): PortableScalar {
  if (typeof result !== 'number' || !Number.isInteger(result)) return result;
  if (op === '/' || !Number.isInteger(left) || !Number.isInteger(right)) {
    throw new Error(`portable: ${op} result is integer-valued (float/int divergence)`);
  }
  return result;
}

export function isSafeIntegerLiteralIndex(node: ValueIR): boolean {
  if (node.kind !== 'numLit' || node.bigint || !/^[0-9]+$/.test(node.raw)) return false;
  const value = Number(node.raw);
  return Number.isSafeInteger(value) && String(value) === node.raw && node.value === value;
}

export function isIntProvenancedExpr(node: ValueIR, env: SemanticEnv): boolean {
  if (isSafeIntegerLiteralIndex(node)) return true;
  if (node.kind === 'ident') return isIntProvenanced(env, node.name);
  if (node.kind === 'binary' && (node.op === '+' || node.op === '-')) {
    return isIntProvenancedExpr(node.left, env) && isIntProvenancedExpr(node.right, env);
  }
  return false;
}

import type { ValueIR } from '../../value-ir.js';
import { isCaughtErrorValue } from './caught-error.js';
import { isDecimalValue } from './semantic-atomic-ownership.js';

export {
  DECIMAL_VALUE_TAG,
  type DecimalValue,
  isDecimalValue,
  isInspectableDecimalValue,
  isOwnedDecimalValue,
  makeDecimalValue,
} from './semantic-atomic-ownership.js';

import {
  isIntProvenanced,
  isOwnedSemanticComposite,
  type RunnerClassInstanceValue,
  type SemanticEnv,
} from './semantic-env.js';

export type PortableScalar = string | number | boolean | null;

export const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const RESERVED_NAMES = new Set([
  'Array',
  'Boolean',
  'JSON',
  'KernInternal',
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

// Records are deliberately one level deep; only scalar/array fields belong to
// the frozen runner domain. Nested records remain outside this machine slice.
export type PortableRecord = Readonly<Record<string, PortableScalar | RunnerPortableArrayValue>>;
export type RunnerPortableArrayValue = ReadonlyArray<PortableScalar | RunnerPortableArrayValue>;
export type RunnerPortableValue = PortableScalar | PortableRecord | RunnerPortableArrayValue;
export type RunnerFunctionValue = RunnerPortableValue | RunnerClassInstanceValue;

const FORBIDDEN_PORTABLE_RECORD_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

export function isPortableRecordKey(key: string): boolean {
  return !FORBIDDEN_PORTABLE_RECORD_KEYS.has(key);
}

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

/**
 * Descriptor-only portable-value check for untrusted direct-envelope input.
 * `seen` is deliberately graph-global: the wire normalizer rejects shared
 * references as well as cycles, so preflight must reject both before effects.
 */
export function isInspectableRunnerPortableValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): value is RunnerPortableValue {
  return isInspectableRunnerPortableValueInner(value, seen, false);
}

export function isOwnedInspectableRunnerPortableValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): value is RunnerPortableValue {
  return isInspectableRunnerPortableValueInner(value, seen, true);
}

function isInspectableRunnerPortableValueInner(value: unknown, seen: WeakSet<object>, requireOwned: boolean): boolean {
  if (isPortableScalar(value)) return true;
  // Decimal is an owned root evaluator atom, not a RunnerPortableValue member;
  // nested Decimal admission is a later contract expansion, not transport parity.
  if (typeof value !== 'object' || value === null || seen.has(value)) return false;
  if (requireOwned && !isOwnedSemanticComposite(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return isInspectablePortableArray(value, seen, requireOwned);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (
      !isPortableRecordKey(key) ||
      descriptor.get ||
      descriptor.set ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      !(isPortableScalar(descriptor.value) || isInspectablePortableArrayValue(descriptor.value, seen, requireOwned))
    ) {
      return false;
    }
  }
  return true;
}

function isInspectablePortableArrayValue(value: unknown, seen: WeakSet<object>, requireOwned: boolean): boolean {
  if (isPortableScalar(value)) return true;
  if (!Array.isArray(value) || seen.has(value)) return false;
  if (requireOwned && !isOwnedSemanticComposite(value)) return false;
  seen.add(value);
  return isInspectablePortableArray(value, seen, requireOwned);
}

function isInspectablePortableArray(value: unknown[], seen: WeakSet<object>, requireOwned: boolean): boolean {
  if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const length = descriptors.length?.value;
  const keys = Object.keys(descriptors);
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) {
    return false;
  }
  for (const key of keys) {
    if (key === 'length') continue;
    const index = Number(key);
    const descriptor = descriptors[key];
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= length ||
      String(index) !== key ||
      !descriptor ||
      descriptor.get ||
      descriptor.set ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      !(isPortableScalar(descriptor.value) || isInspectablePortableArrayValue(descriptor.value, seen, requireOwned))
    ) {
      return false;
    }
  }
  return true;
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
  const stack: ValueIR[] = [node];
  while (stack.length > 0) {
    const current = stack.pop() as ValueIR;
    if (isSafeIntegerLiteralIndex(current)) continue;
    if (current.kind === 'ident') {
      if (!isIntProvenanced(env, current.name)) return false;
      continue;
    }
    if (current.kind === 'binary' && (current.op === '+' || current.op === '-' || current.op === '**')) {
      stack.push(current.right, current.left);
      continue;
    }
    return false;
  }
  return true;
}

import { isParenthesized, isValueIR, type ValueIR } from '../../value-ir.js';
import {
  captureFreshArrayBinding,
  capturesFreshArrayAcrossRepeatableLoop,
  getBinding,
  hasBinding,
  isCapturedArrayBinding,
  isFreshArrayBinding,
  type SemanticEnv,
} from './index.js';
import { evalArrayLiteralValue } from './portable-array.js';
import type { EvalPortableValue } from './portable-eval-types.js';
import {
  type EvalRecordLiteralOptions,
  isDecimalValue,
  isPortableRecordValue,
  isPortableScalar,
  isRunnerClassInstanceValue,
  isRunnerPortableArrayValue,
  type PortableRecord,
  type PortableScalar,
  type RunnerPortableArrayValue,
} from './portable-scalar-domain.js';
import { isCaughtErrorValue } from './caught-error.js';

const RESERVED_RECORD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function isRecordLiteralExpression(node: ValueIR): node is Extract<ValueIR, { kind: 'objectLit' }> {
  return node.kind === 'objectLit';
}

export type PortableRecordEntry = { key: string; rawKey?: string; value: ValueIR };

export function assertPortableRecordEntry(
  entry: PortableRecordEntry | { kind: 'spread'; argument: ValueIR },
  out: Record<string, unknown>,
): PortableRecordEntry {
  if ('kind' in entry) throw new Error('portable-record: object spreads are outside the portable record domain');
  if (entry.rawKey !== undefined) {
    throw new Error('portable-record: numeric record keys are outside the portable record domain');
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key)) {
    throw new Error('portable-record: record keys must be identifier-like strings');
  }
  if (RESERVED_RECORD_KEYS.has(entry.key)) {
    throw new Error(`portable-record: reserved key "${entry.key}" is outside the portable record domain`);
  }
  if (Object.hasOwn(out, entry.key)) {
    throw new Error(`portable-record: duplicate key "${entry.key}" is outside the portable record domain`);
  }
  return entry;
}

export function evalRecordArrayFieldValue(
  value: ValueIR,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
  options: EvalRecordLiteralOptions = {},
): RunnerPortableArrayValue | undefined {
  if (value.kind === 'arrayLit') {
    return evalArrayLiteralValue(value, env, evaluate, { allowFiniteNumericLiterals: true });
  }
  if (
    value.kind === 'member' &&
    !value.optional &&
    value.object.kind === 'ident' &&
    hasBinding(env, value.object.name)
  ) {
    const record = getBinding(env, value.object.name);
    if (isPortableRecordValue(record) && isRunnerPortableArrayValue(record[value.property])) {
      throw new Error(
        `portable-record: record array field "${value.object.name}.${value.property}" cannot be captured by another record field`,
      );
    }
  }
  if (value.kind !== 'ident') return undefined;
  if (isCapturedArrayBinding(env, value.name)) {
    throw new Error(`fresh array binding "${value.name}" was already captured by a record field`);
  }
  if (!isFreshArrayBinding(env, value.name)) {
    const binding = hasBinding(env, value.name) ? getBinding(env, value.name) : undefined;
    if (isRunnerPortableArrayValue(binding)) {
      throw new Error(`stale array binding "${value.name}" cannot be captured by a record field`);
    }
    return undefined;
  }
  if (capturesFreshArrayAcrossRepeatableLoop(env, value.name)) {
    throw new Error(`fresh array binding "${value.name}" cannot be captured inside a repeatable loop body`);
  }
  const binding = getBinding(env, value.name);
  if (!isRunnerPortableArrayValue(binding)) {
    throw new Error(`portable-record: fresh binding "${value.name}" must be an array`);
  }
  if (options.captureFreshArrayBindings === true) captureFreshArrayBinding(env, value.name);
  return binding;
}

export function evalRecordArrayFieldReferenceValue(
  value: ValueIR,
  env: SemanticEnv,
): RunnerPortableArrayValue | undefined {
  if (
    value.kind !== 'member' ||
    value.optional ||
    !isValueIR(value.object) ||
    value.object.kind !== 'ident' ||
    isParenthesized(value.object)
  ) {
    return undefined;
  }
  const recordName = value.object.name;
  if (!hasBinding(env, recordName)) throw new Error(`portable: binding "${recordName}" not found`);
  const record = getBinding(env, recordName);
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return undefined;
  if (isDecimalValue(record) || isCaughtErrorValue(record) || isRunnerClassInstanceValue(record)) return undefined;
  const proto = Object.getPrototypeOf(record);
  if (proto !== Object.prototype && proto !== null) return undefined;
  if (Object.getOwnPropertySymbols(record).length > 0) {
    throw new Error(`portable: record "${recordName}" is outside the portable scalar domain`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(record, value.property);
  if (!descriptor) throw new Error(`portable: record "${recordName}" has no field "${value.property}"`);
  if (!descriptor.enumerable || descriptor.get || descriptor.set || !('value' in descriptor)) {
    throw new Error(`portable: record "${recordName}" field "${value.property}" is outside the portable scalar domain`);
  }
  return isRunnerPortableArrayValue(descriptor.value) ? descriptor.value : undefined;
}

export function assertSingleUseFreshArrayRecordSources(node: ValueIR, env: SemanticEnv): void {
  if (node.kind !== 'objectLit') return;
  const sources = new Set<string>();
  for (const rawEntry of node.entries) {
    if ('kind' in rawEntry) continue;
    const value = rawEntry.value;
    if (value.kind !== 'ident' || !isFreshArrayBinding(env, value.name)) continue;
    if (sources.has(value.name)) throw new Error(`fresh array binding "${value.name}" can be captured only once`);
    sources.add(value.name);
  }
}

export function evalRecordLiteralValue(
  node: ValueIR,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
  options: EvalRecordLiteralOptions = {},
): PortableRecord {
  if (node.kind !== 'objectLit') throw new Error('portable-record: expected an object literal expression');
  assertSingleUseFreshArrayRecordSources(node, env);
  const out: Record<string, PortableScalar | RunnerPortableArrayValue> = Object.create(null);
  for (const rawEntry of node.entries) {
    const entry = assertPortableRecordEntry(rawEntry, out);
    out[entry.key] = evalRecordArrayFieldValue(entry.value, env, evaluate, options) ?? evaluate(entry.value, env);
  }
  return Object.freeze(out);
}

export const PORTABLE_RECORD_FIELD_MISSING: unique symbol = Symbol('portableRecordFieldMissing');

export interface PortableNestedArrayField {
  readonly recordName: string;
  readonly fieldName: string;
  readonly value: RunnerPortableArrayValue;
}

function recordDescriptor(obj: unknown, recordName: string, property: string): PropertyDescriptor | undefined {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  if (isDecimalValue(obj) || isCaughtErrorValue(obj) || isRunnerClassInstanceValue(obj)) return undefined;
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) return undefined;
  if (Object.getOwnPropertySymbols(obj).length > 0) {
    throw new Error(`portable: record "${recordName}" is outside the portable scalar domain`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(obj, property);
  if (!descriptor) throw new Error(`portable: record "${recordName}" has no field "${property}"`);
  if (!descriptor.enumerable || descriptor.get || descriptor.set || !('value' in descriptor)) {
    throw new Error(`portable: record "${recordName}" field "${property}" is outside the portable scalar domain`);
  }
  return descriptor;
}

function portableRecordArrayField(
  obj: unknown,
  recordName: string,
  property: string,
): PortableNestedArrayField | typeof PORTABLE_RECORD_FIELD_MISSING {
  const descriptor = recordDescriptor(obj, recordName, property);
  if (!descriptor) return PORTABLE_RECORD_FIELD_MISSING;
  if (!isRunnerPortableArrayValue(descriptor.value)) {
    throw new Error(`portable: record "${recordName}" field "${property}" must be an array for nested access`);
  }
  return { recordName, fieldName: property, value: descriptor.value };
}

export function portableNestedArrayField(
  node: Extract<ValueIR, { kind: 'member' }>,
  env: SemanticEnv,
): PortableNestedArrayField | typeof PORTABLE_RECORD_FIELD_MISSING {
  if (!isValueIR(node.object) || node.object.kind !== 'member' || node.object.optional) {
    return PORTABLE_RECORD_FIELD_MISSING;
  }
  const inner = node.object;
  if (!isValueIR(inner.object) || inner.object.kind !== 'ident' || isParenthesized(inner.object)) {
    return PORTABLE_RECORD_FIELD_MISSING;
  }
  const recordName = inner.object.name;
  if (!hasBinding(env, recordName)) throw new Error(`portable: binding "${recordName}" not found`);
  return portableRecordArrayField(getBinding(env, recordName), recordName, inner.property);
}

export function portableNestedIndexArrayField(
  node: Extract<ValueIR, { kind: 'index' }>,
  env: SemanticEnv,
): PortableNestedArrayField | typeof PORTABLE_RECORD_FIELD_MISSING {
  if (!isValueIR(node.object) || node.object.kind !== 'member' || node.object.optional) {
    return PORTABLE_RECORD_FIELD_MISSING;
  }
  const inner = node.object;
  if (!isValueIR(inner.object) || inner.object.kind !== 'ident' || isParenthesized(inner.object)) {
    return PORTABLE_RECORD_FIELD_MISSING;
  }
  const recordName = inner.object.name;
  if (!hasBinding(env, recordName)) throw new Error(`portable: binding "${recordName}" not found`);
  return portableRecordArrayField(getBinding(env, recordName), recordName, inner.property);
}

export function portableRecordScalarField(
  obj: unknown,
  recordName: string,
  property: string,
): PortableScalar | typeof PORTABLE_RECORD_FIELD_MISSING {
  const descriptor = recordDescriptor(obj, recordName, property);
  if (!descriptor) return PORTABLE_RECORD_FIELD_MISSING;
  if (!isPortableScalar(descriptor.value)) {
    throw new Error(`portable: field "${recordName}.${property}" must evaluate to a portable scalar`);
  }
  return descriptor.value;
}

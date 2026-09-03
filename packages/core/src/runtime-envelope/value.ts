import { isPortableDecimalLiteral } from '../decimal/probe-gates.js';
import { isDecimalValue, isPortableRecordKey } from '../ir/semantics/portable-scalar-domain.js';
import {
  INTERNAL_RUNTIME_ENVELOPE_LIMIT_KEYS,
  InternalRuntimeEnvelopeError,
  type InternalRuntimeEnvelopeLimits,
  type InternalRuntimeSlot,
  type InternalRuntimeValue,
} from './types.js';

const textEncoder = new TextEncoder();

function compareCodePoints(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex) ?? 0;
    const rightPoint = right.codePointAt(rightIndex) ?? 0;
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return left.length - right.length;
}

function fail(code: InternalRuntimeEnvelopeError['code'], message: string): never {
  throw new InternalRuntimeEnvelopeError(code, message);
}

export function validateInternalRuntimeLimits(limits: InternalRuntimeEnvelopeLimits): void {
  const keys = INTERNAL_RUNTIME_ENVELOPE_LIMIT_KEYS;
  if (!limits || typeof limits !== 'object' || Array.isArray(limits))
    fail('invalid-limits', 'limits must be an object');
  const actual = Object.keys(limits).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    fail('invalid-limits', `limits must contain exactly ${keys.join(',')}`);
  }
  for (const key of keys) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value <= 0) fail('invalid-limits', `${key} must be a positive safe integer`);
  }
}

function text(value: string, limits: InternalRuntimeEnvelopeLimits, path: string): string {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('invalid-value', `${path} contains malformed Unicode`);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) fail('invalid-value', `${path} contains malformed Unicode`);
  }
  if (textEncoder.encode(value).length > limits.maxStringBytes) {
    fail('limit-exceeded', `${path} exceeds maxStringBytes`);
  }
  return value;
}

function decimal(value: string, path: string): InternalRuntimeValue {
  if (!isPortableDecimalLiteral(value)) {
    fail('invalid-value', `${path} is not canonical decimal text`);
  }
  return { tag: 'decimal', value };
}

function normalize(
  value: unknown,
  limits: InternalRuntimeEnvelopeLimits,
  path: string,
  depth: number,
  seen: WeakSet<object>,
): InternalRuntimeValue {
  if (depth > limits.maxDepth) fail('limit-exceeded', `${path} exceeds maxDepth`);
  if (value === null) return { tag: 'null' };
  if (typeof value === 'boolean') return { tag: 'boolean', value };
  if (typeof value === 'string') return { tag: 'text', value: text(value, limits, path) };
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail('invalid-value', `${path} is not a portable number`);
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) fail('invalid-value', `${path} is not a safe integer`);
      return { tag: 'integer', value: String(value) };
    }
    return decimal(String(value), path);
  }
  if (isDecimalValue(value)) return decimal(value.canonical, path);
  if (typeof value !== 'object') fail('invalid-value', `${path} is outside the portable value domain`);
  if (seen.has(value)) fail('invalid-value', `${path} contains a cycle or shared reference`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > limits.maxCollectionLength) fail('limit-exceeded', `${path} exceeds maxCollectionLength`);
    if (Object.getOwnPropertySymbols(value).length > 0) fail('invalid-value', `${path} contains symbol keys`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).filter((key) => key !== 'length');
    if (keys.length !== value.length) fail('invalid-value', `${path} must contain only dense array indexes`);
    const items = Array.from({ length: value.length }, (_, index) => {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
        fail('invalid-value', `${path}[${index}] is not inspectable plain data`);
      }
      return normalize(descriptor.value, limits, `${path}[${index}]`, depth + 1, seen);
    });
    return {
      tag: 'list',
      value: items,
    };
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    fail('invalid-value', `${path} must be a plain record`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort(compareCodePoints);
  if (keys.length > limits.maxCollectionLength) fail('limit-exceeded', `${path} exceeds maxCollectionLength`);
  if (Object.getOwnPropertySymbols(value).length > 0) fail('invalid-value', `${path} contains symbol keys`);
  const entries = keys.map((key) => {
    if (!isPortableRecordKey(key)) fail('invalid-value', `${path} contains forbidden key ${key}`);
    text(key, limits, `${path}.key`);
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail('invalid-value', `${path}.${key} is not inspectable plain data`);
    }
    return {
      key,
      value: normalize(descriptor.value, limits, `${path}.${key}`, depth + 1, seen),
    };
  });
  return { tag: 'record', value: entries };
}

export function normalizeInternalRuntimeValue(
  value: unknown,
  limits: InternalRuntimeEnvelopeLimits,
  path = '$',
): InternalRuntimeValue {
  validateInternalRuntimeLimits(limits);
  return normalize(value, limits, path, 0, new WeakSet());
}

export function normalizeInternalRuntimeValues(
  values: readonly unknown[],
  limits: InternalRuntimeEnvelopeLimits,
  path: string,
): readonly InternalRuntimeValue[] {
  validateInternalRuntimeLimits(limits);
  const seen = new WeakSet<object>();
  return values.map((value, index) => normalize(value, limits, `${path}[${index}]`, 0, seen));
}

export function normalizeInternalRuntimeSlot(
  value: unknown,
  limits: InternalRuntimeEnvelopeLimits,
  path: string,
): InternalRuntimeSlot {
  return value === undefined
    ? { presence: 'absent' }
    : { presence: 'value', value: normalizeInternalRuntimeValue(value, limits, path) };
}

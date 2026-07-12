import {
  CANONICAL_VALUE_FORMAT,
  type CanonicalMapEntry,
  type CanonicalRecordEntry,
  type CanonicalScalarValue,
  type CanonicalValue,
  CanonicalValueDecodeError,
  type CanonicalValueEnvelope,
  type CanonicalValueLimits,
} from './types.js';

type UnknownRecord = Record<string, unknown>;
const LIMIT_KEYS = [
  'maxBytes',
  'maxDepth',
  'maxNodes',
  'maxStringBytes',
  'maxCollectionLength',
  'maxRecordFields',
  'maxMapEntries',
  'maxIntegerDigits',
  'maxFractionDigits',
  'maxDecimalChars',
] as const;
const textEncoder = new TextEncoder();

function fail(code: ConstructorParameters<typeof CanonicalValueDecodeError>[0], path: string, message: string): never {
  throw new CanonicalValueDecodeError(code, path, message);
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (char) => char.codePointAt(0) ?? 0);
  const b = Array.from(right, (char) => char.codePointAt(0) ?? 0);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) if (left[index] !== right[index]) return left[index] - right[index];
  return left.length - right.length;
}

function object(value: unknown, path: string): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail('invalid-shape', path, 'expected object');
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail('invalid-shape', path, 'expected plain object');
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === 'symbol')) fail('invalid-shape', path, 'symbol fields are forbidden');
    const snapshot: UnknownRecord = Object.create(null) as UnknownRecord;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
        fail('invalid-shape', `${path}.${String(key)}`, 'accessor or hidden fields are forbidden');
      snapshot[String(key)] = descriptor.value;
    }
    return snapshot;
  } catch (error) {
    if (error instanceof CanonicalValueDecodeError) throw error;
    fail('invalid-shape', path, 'expected inspectable plain object');
  }
}

function exact(value: unknown, keys: readonly string[], path: string): UnknownRecord {
  const record = object(value, path);
  const actual = Object.keys(record).sort(compareCodePoints);
  const expected = [...keys].sort(compareCodePoints);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('invalid-shape', path, `expected fields ${expected.join(',')}; received ${actual.join(',')}`);
  }
  return record;
}

function array(
  value: unknown,
  path: string,
  maxLength: number,
  limitCode: 'limit-collection' | 'limit-record' | 'limit-map',
  label: string,
): unknown[] {
  if (!Array.isArray(value)) fail('invalid-shape', path, 'expected array');
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('invalid-shape', path, 'expected plain array');
    const keys = Reflect.ownKeys(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || !('value' in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)) {
      fail('invalid-shape', path, 'array length must be a data property');
    }
    const length = lengthDescriptor.value as number;
    if (length > maxLength) fail(limitCode, path, `${label} exceeds its configured entry ceiling`);
    if (keys.length !== length + 1) fail('invalid-shape', path, 'sparse arrays are forbidden');
    const snapshot = new Array<unknown>(length);
    for (const key of keys) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length) {
        fail('invalid-shape', path, 'array has hidden, symbolic, or non-index fields');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        fail('invalid-shape', `${path}[${key}]`, 'array accessors or hidden elements are forbidden');
      }
      snapshot[Number(key)] = descriptor.value;
    }
    return snapshot;
  } catch (error) {
    if (error instanceof CanonicalValueDecodeError) throw error;
    fail('invalid-shape', path, 'expected inspectable plain array');
  }
}

function text(value: unknown, path: string, limits: CanonicalValueLimits): string {
  if (typeof value !== 'string') fail('invalid-value', path, 'expected text');
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('invalid-value', path, 'unpaired high surrogate');
      byteLength += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) fail('invalid-value', path, 'unpaired low surrogate');
    else if (code <= 0x7f) byteLength += 1;
    else if (code <= 0x7ff) byteLength += 2;
    else byteLength += 3;
  }
  if (byteLength > limits.maxStringBytes) {
    fail('limit-string', path, `text exceeds maxStringBytes ${limits.maxStringBytes}`);
  }
  return value;
}

export function validateCanonicalValueLimits(value: unknown): CanonicalValueLimits {
  const record = exact(value, LIMIT_KEYS, 'limits');
  for (const key of LIMIT_KEYS) {
    if (!Number.isSafeInteger(record[key]) || (record[key] as number) < 1) {
      fail('invalid-limits', `limits.${key}`, 'expected positive safe integer');
    }
  }
  return record as unknown as CanonicalValueLimits;
}

interface State {
  nodes: number;
}

function visit(
  value: unknown,
  limits: CanonicalValueLimits,
  state: State,
  path: string,
  depth: number,
): CanonicalValue {
  if (depth > limits.maxDepth) fail('limit-depth', path, `value exceeds maxDepth ${limits.maxDepth}`);
  state.nodes += 1;
  if (state.nodes > limits.maxNodes) fail('limit-nodes', path, `value exceeds maxNodes ${limits.maxNodes}`);
  const record = object(value, path);
  const tag = text(record.tag, `${path}.tag`, limits);
  if (tag === 'null') {
    exact(record, ['tag'], path);
    return { tag };
  }
  exact(record, ['tag', 'value'], path);
  if (tag === 'bool') {
    if (typeof record.value !== 'boolean') fail('invalid-value', `${path}.value`, 'expected boolean');
    return { tag, value: record.value };
  }
  if (tag === 'text') return { tag, value: text(record.value, `${path}.value`, limits) };
  if (tag === 'int') return { tag, value: integer(record.value, `${path}.value`, limits) };
  if (tag === 'decimal') return { tag, value: decimal(record.value, `${path}.value`, limits) };
  if (tag === 'list') {
    const items = array(record.value, `${path}.value`, limits.maxCollectionLength, 'limit-collection', 'list');
    return { tag, value: items.map((item, index) => visit(item, limits, state, `${path}.value[${index}]`, depth + 1)) };
  }
  if (tag === 'record') return { tag, value: recordEntries(record.value, limits, state, `${path}.value`, depth) };
  if (tag === 'map') return { tag, value: mapEntries(record.value, limits, state, `${path}.value`, depth) };
  if (tag === 'error') {
    const error = exact(record.value, ['code', 'message', 'details'], `${path}.value`);
    const code = text(error.code, `${path}.value.code`, limits);
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(code))
      fail('invalid-value', `${path}.value.code`, 'expected portable error code');
    return {
      tag,
      value: {
        code,
        message: text(error.message, `${path}.value.message`, limits),
        details:
          error.details === null ? null : visit(error.details, limits, state, `${path}.value.details`, depth + 1),
      },
    };
  }
  fail('invalid-value', `${path}.tag`, `unknown canonical value tag ${tag}`);
}

function integer(value: unknown, path: string, limits: CanonicalValueLimits): string {
  const result = text(value, path, limits);
  if (!/^(?:0|-?[1-9][0-9]*)$/u.test(result)) fail('invalid-value', path, 'expected canonical integer text');
  if (result.replace('-', '').length > limits.maxIntegerDigits)
    fail('limit-integer', path, 'integer exceeds maxIntegerDigits');
  return result;
}

function decimal(value: unknown, path: string, limits: CanonicalValueLimits): string {
  const result = text(value, path, limits);
  const match = /^-?(0|[1-9][0-9]*)\.([0-9]+)$/u.exec(result);
  if (!match) fail('invalid-value', path, 'expected canonical non-exponent decimal text');
  if (result.startsWith('-') && match[1] === '0' && /^0+$/u.test(match[2])) {
    fail('invalid-value', path, 'negative-zero decimal is forbidden');
  }
  if (
    match[1].length > limits.maxIntegerDigits ||
    match[2].length > limits.maxFractionDigits ||
    result.length > limits.maxDecimalChars
  ) {
    fail('limit-decimal', path, 'decimal exceeds configured digit limits');
  }
  return result;
}

function recordEntries(
  value: unknown,
  limits: CanonicalValueLimits,
  state: State,
  path: string,
  depth: number,
): CanonicalRecordEntry[] {
  const items = array(value, path, limits.maxRecordFields, 'limit-record', 'record');
  let previous: string | undefined;
  return items.map((item, index) => {
    const entryPath = `${path}[${index}]`;
    const entry = exact(item, ['key', 'value'], entryPath);
    const key = text(entry.key, `${entryPath}.key`, limits);
    if (previous !== undefined && compareCodePoints(previous, key) >= 0) {
      fail(
        previous === key ? 'duplicate-key' : 'invalid-order',
        entryPath,
        'record keys must be unique and code-point sorted',
      );
    }
    previous = key;
    return { key, value: visit(entry.value, limits, state, `${entryPath}.value`, depth + 1) };
  });
}

function scalar(
  value: unknown,
  limits: CanonicalValueLimits,
  state: State,
  path: string,
  depth: number,
): CanonicalScalarValue {
  const result = visit(value, limits, state, path, depth);
  if (!['null', 'bool', 'text', 'int', 'decimal'].includes(result.tag))
    fail('invalid-value', path, 'map key must be scalar');
  return result as CanonicalScalarValue;
}

function scalarBytes(value: CanonicalScalarValue): Uint8Array {
  const normalized = value.tag === 'null' ? { tag: value.tag } : { tag: value.tag, value: value.value };
  return textEncoder.encode(JSON.stringify(normalized));
}

function mapEntries(
  value: unknown,
  limits: CanonicalValueLimits,
  state: State,
  path: string,
  depth: number,
): CanonicalMapEntry[] {
  const items = array(value, path, limits.maxMapEntries, 'limit-map', 'map');
  let previous: Uint8Array | undefined;
  return items.map((item, index) => {
    const entryPath = `${path}[${index}]`;
    const entry = exact(item, ['key', 'value'], entryPath);
    const key = scalar(entry.key, limits, state, `${entryPath}.key`, depth + 1);
    const bytes = scalarBytes(key);
    if (previous !== undefined && compareBytes(previous, bytes) >= 0) {
      fail(
        compareBytes(previous, bytes) === 0 ? 'duplicate-key' : 'invalid-order',
        entryPath,
        'map keys must be unique and canonical-byte sorted',
      );
    }
    previous = bytes;
    return { key, value: visit(entry.value, limits, state, `${entryPath}.value`, depth + 1) };
  });
}

export function validateCanonicalValueEnvelope(value: unknown, limitsInput: unknown): CanonicalValueEnvelope {
  const limits = validateCanonicalValueLimits(limitsInput);
  const envelope = exact(value, ['format', 'value'], '$');
  const format = text(envelope.format, '$.format', limits);
  if (format !== CANONICAL_VALUE_FORMAT) fail('unsupported-version', '$.format', 'unsupported canonical value format');
  return { format: CANONICAL_VALUE_FORMAT, value: visit(envelope.value, limits, { nodes: 0 }, '$.value', 1) };
}

export { compareCodePoints };

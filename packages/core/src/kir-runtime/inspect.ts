import type { CanonicalValue } from '../canonical-value/types.js';
import type { StructuralKirNode } from '../kir-structural/types.js';
import {
  KERN_KIR_RUNTIME_FORMAT,
  KernKirFault,
  type KernKirLimits,
  type KernKirRequest,
  type KernKirSlot,
  type KernKirValue,
} from './contracts.js';
import { canonicalJson } from './digest.js';

type UnknownRecord = Record<string, unknown>;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const INTEGER = /^(?:0|-?[1-9][0-9]*)$/u;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)\.[0-9]+$/u;
const LIMIT_KEYS = [
  'maxBytes',
  'maxCollectionLength',
  'maxDepth',
  'maxDiagnostics',
  'maxEvents',
  'maxSteps',
  'maxStringBytes',
] as const;

function bitLength(magnitude: bigint): number {
  if (magnitude === 0n) return 0;
  const hex = magnitude.toString(16);
  return (hex.length - 1) * 4 + (32 - Math.clz32(Number.parseInt(hex[0], 16)));
}

// A conservative rational under log10(2): the floor is never above the true digit count.
function decimalDigitsFloor(magnitude: bigint): number {
  const bits = bitLength(magnitude);
  return bits <= 1 ? 0 : Number((BigInt(bits - 1) * 30102n) / 100000n);
}

export class RuntimeMeter {
  readonly limits: KernKirLimits;
  private readonly checkInterruption: () => void;
  private steps = 0;

  constructor(limits: KernKirLimits, checkInterruption: () => void = () => {}) {
    this.limits = limits;
    this.checkInterruption = checkInterruption;
  }

  check(): void {
    this.checkInterruption();
  }

  step(amount = 1): void {
    this.check();
    this.steps += amount;
    if (!Number.isSafeInteger(this.steps) || this.steps > this.limits.maxSteps) {
      throw new KernKirFault('runtime-limit-exceeded', 'execution', 'runtime step limit exceeded');
    }
  }

  text(value: string, label: string): string {
    this.check();
    if (utf8Bytes(value, this.checkInterruption) > this.limits.maxStringBytes) {
      throw new KernKirFault('runtime-limit-exceeded', 'execution', `${label} exceeds string limit`);
    }
    return value;
  }

  // The lower bound on decimal digits comes from the binary size, so a result that cannot fit is
  // refused before the quadratic base-10 conversion runs: conversion cost is bounded by the limit
  // rather than by the operand magnitude. The byte count includes the sign, here and in `text`.
  integerText(value: bigint, label: string): string {
    this.check();
    const sign = value < 0n ? 1 : 0;
    if (decimalDigitsFloor(sign === 1 ? -value : value) + sign >= this.limits.maxStringBytes + 1) {
      throw new KernKirFault('runtime-limit-exceeded', 'execution', `${label} exceeds string limit`);
    }
    return this.text(String(value), label);
  }

  collection(length: number, label: string): void {
    this.check();
    if (length > this.limits.maxCollectionLength) {
      throw new KernKirFault('runtime-limit-exceeded', 'execution', `${label} exceeds collection limit`);
    }
  }
}

function fail(message: string): never {
  throw new KernKirFault('invalid-handler-arguments', 'link', message);
}

export function plainRecord(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label}: expected plain object`);
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(`${label}: expected plain object`);
    const snapshot: UnknownRecord = Object.create(null) as UnknownRecord;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') fail(`${label}: symbol fields are forbidden`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        fail(`${label}.${key}: hidden or accessor field is forbidden`);
      }
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch (error) {
    if (error instanceof KernKirFault) throw error;
    fail(`${label}: object is not safely inspectable`);
  }
}

export function exact(record: UnknownRecord, keys: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label}: expected exact fields ${expected.join(',')}`);
  }
}

export function denseArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${label}: expected dense plain array`);
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(`${label}: expected dense plain array`);
    if (Object.keys(value).length !== value.length) fail(`${label}: sparse or extended array is forbidden`);
    return Array.from(value, (_item, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        fail(`${label}[${index}]: accessor is forbidden`);
      }
      return descriptor.value;
    });
  } catch (error) {
    if (error instanceof KernKirFault) throw error;
    fail(`${label}: array is not safely inspectable`);
  }
}

export function requiredText(value: unknown, label: string, meter?: RuntimeMeter): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label}: expected non-empty text`);
  return meter?.text(value, label) ?? value;
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail(`${label}: expected positive safe integer`);
  return value as number;
}

function inspectLimits(value: unknown): KernKirLimits {
  const record = plainRecord(value, 'request.limits');
  exact(record, LIMIT_KEYS, 'request.limits');
  return Object.freeze({
    maxBytes: positive(record.maxBytes, 'request.limits.maxBytes'),
    maxCollectionLength: positive(record.maxCollectionLength, 'request.limits.maxCollectionLength'),
    maxDepth: positive(record.maxDepth, 'request.limits.maxDepth'),
    maxDiagnostics: positive(record.maxDiagnostics, 'request.limits.maxDiagnostics'),
    maxEvents: positive(record.maxEvents, 'request.limits.maxEvents'),
    maxSteps: positive(record.maxSteps, 'request.limits.maxSteps'),
    maxStringBytes: positive(record.maxStringBytes, 'request.limits.maxStringBytes'),
  });
}

export function inspectPortableValue(value: unknown, meter: RuntimeMeter, label: string, depth = 1): KernKirValue {
  meter.step();
  if (depth > meter.limits.maxDepth) {
    throw new KernKirFault('runtime-limit-exceeded', 'execution', `${label} exceeds depth limit`);
  }
  const record = plainRecord(value, label);
  if (typeof record.tag !== 'string') fail(`${label}.tag: expected text`);
  switch (record.tag) {
    case 'null':
      exact(record, ['tag'], label);
      return Object.freeze({ tag: 'null' });
    case 'boolean':
      exact(record, ['tag', 'value'], label);
      if (typeof record.value !== 'boolean') fail(`${label}.value: expected boolean`);
      return Object.freeze({ tag: 'boolean', value: record.value });
    case 'text':
      exact(record, ['tag', 'value'], label);
      if (typeof record.value !== 'string') fail(`${label}.value: expected text`);
      return Object.freeze({ tag: 'text', value: meter.text(record.value, `${label}.value`) });
    case 'integer':
    case 'decimal': {
      exact(record, ['tag', 'value'], label);
      if (typeof record.value !== 'string' || !(record.tag === 'integer' ? INTEGER : DECIMAL).test(record.value)) {
        fail(`${label}.value: expected canonical ${record.tag}`);
      }
      meter.text(record.value, `${label}.value`);
      return Object.freeze({ tag: record.tag, value: record.value });
    }
    case 'list': {
      exact(record, ['tag', 'value'], label);
      const items = denseArray(record.value, `${label}.value`);
      meter.collection(items.length, `${label}.value`);
      return Object.freeze({
        tag: 'list',
        value: Object.freeze(
          items.map((item, index) => inspectPortableValue(item, meter, `${label}.value[${index}]`, depth + 1)),
        ),
      });
    }
    case 'record': {
      exact(record, ['tag', 'value'], label);
      const entries = denseArray(record.value, `${label}.value`);
      meter.collection(entries.length, `${label}.value`);
      let previous: string | undefined;
      const inspected = entries.map((entry, index) => {
        const item = plainRecord(entry, `${label}.value[${index}]`);
        exact(item, ['key', 'value'], `${label}.value[${index}]`);
        const key = requiredText(item.key, `${label}.value[${index}].key`, meter);
        if (previous !== undefined && compareCodePoints(previous, key) >= 0)
          fail(`${label}.value: record keys must be unique and sorted`);
        previous = key;
        return Object.freeze({ key, value: inspectPortableValue(item.value, meter, `${label}.${key}`, depth + 1) });
      });
      return Object.freeze({ tag: 'record', value: Object.freeze(inspected) });
    }
    default:
      fail(`${label}.tag: unsupported portable value`);
  }
}

export function inspectSlot(value: unknown, meter: RuntimeMeter, label: string): KernKirSlot {
  const record = plainRecord(value, label);
  if (record.presence === 'absent') {
    exact(record, ['presence'], label);
    return Object.freeze({ presence: 'absent' });
  }
  if (record.presence === 'value') {
    exact(record, ['presence', 'value'], label);
    return Object.freeze({ presence: 'value', value: inspectPortableValue(record.value, meter, `${label}.value`) });
  }
  fail(`${label}.presence: expected absent or value`);
}

export function inspectRequest(
  value: unknown,
  checkInterruption: () => void = () => {},
): { request: KernKirRequest; meter: RuntimeMeter } {
  const record = plainRecord(value, 'request');
  exact(record, ['format', 'requestId', 'entry', 'arguments', 'control', 'limits'], 'request');
  if (record.format !== KERN_KIR_RUNTIME_FORMAT) fail('request.format: unsupported format');
  const limits = inspectLimits(record.limits);
  const meter = new RuntimeMeter(limits, checkInterruption);
  const requestId = requiredText(record.requestId, 'request.requestId', meter);
  const entry = plainRecord(record.entry, 'request.entry');
  exact(entry, ['moduleId', 'handlerName'], 'request.entry');
  const moduleId = requiredText(entry.moduleId, 'request.entry.moduleId', meter);
  const handlerName = requiredText(entry.handlerName, 'request.entry.handlerName', meter);
  if (!moduleId.endsWith('.kern') || !IDENTIFIER.test(handlerName)) fail('request.entry: invalid entry identity');
  const control = plainRecord(record.control, 'request.control');
  exact(control, ['preCancelled', 'timeoutMs'], 'request.control');
  if (typeof control.preCancelled !== 'boolean') fail('request.control.preCancelled: expected boolean');
  if (
    control.timeoutMs !== null &&
    (!Number.isSafeInteger(control.timeoutMs) ||
      (control.timeoutMs as number) < 1 ||
      (control.timeoutMs as number) > 2_147_483_647)
  ) {
    fail('request.control.timeoutMs: expected null or positive timer delay');
  }
  const argumentsRecord = plainRecord(record.arguments, 'request.arguments');
  const names = Object.keys(argumentsRecord).sort();
  meter.collection(names.length, 'request.arguments');
  const inspectedArguments: Record<string, KernKirValue> = Object.create(null) as Record<string, KernKirValue>;
  for (const name of names) {
    if (!IDENTIFIER.test(name)) fail(`request.arguments.${name}: invalid argument name`);
    meter.text(name, `request.arguments.${name}`);
    inspectedArguments[name] = inspectPortableValue(argumentsRecord[name], meter, `request.arguments.${name}`);
  }
  const request = Object.freeze({
    format: KERN_KIR_RUNTIME_FORMAT,
    requestId,
    entry: Object.freeze({ moduleId, handlerName }),
    arguments: Object.freeze(inspectedArguments),
    control: Object.freeze({ preCancelled: control.preCancelled, timeoutMs: control.timeoutMs as number | null }),
    limits,
  });
  if (utf8Bytes(canonicalJson(request)) > limits.maxBytes) {
    throw new KernKirFault('runtime-limit-exceeded', 'execution', 'request exceeds byte limit');
  }
  return { request, meter };
}

export function canonicalRecord(
  value: CanonicalValue,
  keys: readonly string[],
  label: string,
): Map<string, CanonicalValue> {
  const record = plainRecord(value, label);
  exact(record, ['tag', 'value'], label);
  if (record.tag !== 'record') throw new KernKirFault('handler-entry-unsupported', 'link', `${label}: expected record`);
  const entries = denseArray(record.value, `${label}.value`);
  if (entries.length !== keys.length)
    throw new KernKirFault('handler-entry-unsupported', 'link', `${label}: unexpected fields`);
  const result = new Map<string, CanonicalValue>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = plainRecord(entries[index], `${label}.value[${index}]`);
    exact(entry, ['key', 'value'], `${label}.value[${index}]`);
    if (entry.key !== keys[index])
      throw new KernKirFault('handler-entry-unsupported', 'link', `${label}: unexpected fields`);
    result.set(entry.key, entry.value as CanonicalValue);
  }
  return result;
}

export function nodeProperties(node: StructuralKirNode, label: string): Map<string, CanonicalValue> {
  const record = plainRecord(node, label);
  exact(record, ['kind', 'properties', 'children'], label);
  if (typeof record.kind !== 'string') throw new KernKirFault('handler-entry-unsupported', 'link', `${label}.kind`);
  const entries = denseArray(record.properties, `${label}.properties`);
  const result = new Map<string, CanonicalValue>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = plainRecord(entries[index], `${label}.properties[${index}]`);
    exact(entry, ['key', 'value'], `${label}.properties[${index}]`);
    if (typeof entry.key !== 'string' || result.has(entry.key)) {
      throw new KernKirFault('handler-entry-unsupported', 'link', `${label}: invalid properties`);
    }
    result.set(entry.key, entry.value as CanonicalValue);
  }
  return result;
}

export function nodeChildren(node: StructuralKirNode, label: string): readonly StructuralKirNode[] {
  const record = plainRecord(node, label);
  return denseArray(record.children, `${label}.children`) as readonly StructuralKirNode[];
}

export function utf8Bytes(value: string, check: () => void = () => {}): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    if ((index & 1023) === 0) check();
    const unit = value.charCodeAt(index);
    if (unit <= 0x7f) bytes += 1;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!Number.isFinite(low) || low < 0xdc00 || low > 0xdfff) fail('text contains malformed UTF-16');
      index += 1;
      bytes += 4;
    } else {
      if (unit >= 0xdc00 && unit <= 0xdfff) fail('text contains malformed UTF-16');
      bytes += 3;
    }
  }
  return bytes;
}

export function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) as number);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) as number);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] < rightPoints[index] ? -1 : 1;
  }
  return leftPoints.length < rightPoints.length ? -1 : leftPoints.length > rightPoints.length ? 1 : 0;
}

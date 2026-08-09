/** @internal Canonical parser-hint evidence captured before synchronous parsing. */

import { types as nodeTypes } from 'node:util';

import type { ParserHintsConfig } from './runtime-state.js';

const MAP_PROTOTYPE = Map.prototype;
const MAP_ENTRIES = Map.prototype.entries;
const MAP_ITERATOR = Map.prototype[Symbol.iterator];
const MAP_GET = Map.prototype.get;
const MAP_KEYS = Map.prototype.keys;
const MAP_SIZE = Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get;
const MAP_ITERATOR_PROTOTYPE = Object.getPrototypeOf(MAP_KEYS.call(new Map()));
const MAP_ITERATOR_NEXT = MAP_ITERATOR_PROTOTYPE.next as () => IteratorResult<unknown>;
const ARRAY_SORT = Array.prototype.sort;
const STRING_CHAR_CODE_AT = String.prototype.charCodeAt;

if (!MAP_SIZE) throw new TypeError('parser hint snapshot: Map size getter is missing');

export interface ParserHintSnapshotEntry {
  readonly type: string;
  readonly positionalArgs: readonly string[];
  readonly bareWord?: string;
}

export interface ParserHintSnapshotLimits {
  readonly maxNameBytes: number;
  readonly maxNameCodePoints: number;
  readonly maxRegistryEntries: number;
}

function fail(detail: string): never {
  throw new TypeError(`parser hint snapshot: ${detail}`);
}

function validateName(value: unknown, label: string, limits: ParserHintSnapshotLimits): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
  let bytes = 0;
  let codePoints = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = STRING_CHAR_CODE_AT.call(value, index);
    let scalar = code;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = STRING_CHAR_CODE_AT.call(value, index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail(`${label} must use well-formed UTF-16`);
      scalar = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) fail(`${label} must use well-formed UTF-16`);
    codePoints += 1;
    bytes += scalar <= 0x7f ? 1 : scalar <= 0x7ff ? 2 : scalar <= 0xffff ? 3 : 4;
    if (codePoints > limits.maxNameCodePoints) fail(`${label} exceeds the code-point limit`);
    if (bytes > limits.maxNameBytes) fail(`${label} exceeds the UTF-8 byte limit`);
  }
  return value;
}

function positionalNames(value: unknown, label: string, limits: ParserHintSnapshotLimits): readonly string[] {
  if (!Array.isArray(value) || nodeTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${label} must be a non-proxied native array`);
  }
  if (value.length > limits.maxRegistryEntries) fail(`${label} exceeds the argument limit`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== value.length + 1 ||
    keys.at(-1) !== 'length' ||
    keys.slice(0, -1).some((key, index) => key !== String(index))
  )
    fail(`${label} must contain only dense indexed data properties`);
  const names: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor)) fail(`${label} entries must be data properties`);
    names.push(validateName(descriptor.value, `${label} entry ${index}`, limits));
  }
  return Object.freeze(names);
}

function canonicalEntry(
  type: unknown,
  value: unknown,
  index: number,
  limits: ParserHintSnapshotLimits,
): ParserHintSnapshotEntry {
  const canonicalType = validateName(type, `parserHints entry ${index} type`, limits);
  if (
    value === null ||
    typeof value !== 'object' ||
    nodeTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail(`parserHints entry ${index} must be non-proxied plain data`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const allowed = new Set<PropertyKey>(['bareWord', 'multilineBlock', 'positionalArgs']);
  if (keys.some((key) => !allowed.has(key) || !('value' in descriptors[key as keyof typeof descriptors]))) {
    fail(`parserHints entry ${index} must contain only data properties for parser hints`);
  }
  const bareWordValue = descriptors.bareWord?.value;
  const multilineValue = descriptors.multilineBlock?.value;
  const bareWord =
    bareWordValue === undefined
      ? undefined
      : validateName(bareWordValue, `parserHints entry ${index}.bareWord`, limits);
  if (multilineValue !== undefined) {
    validateName(multilineValue, `parserHints entry ${index}.multilineBlock`, limits);
  }
  const positionalArgs =
    descriptors.positionalArgs === undefined
      ? (Object.freeze([]) as readonly string[])
      : positionalNames(descriptors.positionalArgs.value, `parserHints entry ${index}.positionalArgs`, limits);
  return Object.freeze({
    ...(bareWord === undefined ? {} : { bareWord }),
    positionalArgs,
    type: canonicalType,
  });
}

export function captureParserHintSnapshot(
  value: unknown,
  limits: ParserHintSnapshotLimits,
): readonly ParserHintSnapshotEntry[] {
  if (
    value === null ||
    typeof value !== 'object' ||
    nodeTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== MAP_PROTOTYPE ||
    Map.prototype.get !== MAP_GET ||
    Map.prototype.keys !== MAP_KEYS ||
    Map.prototype.entries !== MAP_ENTRIES ||
    Map.prototype[Symbol.iterator] !== MAP_ITERATOR ||
    Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get !== MAP_SIZE ||
    Object.getPrototypeOf(MAP_KEYS.call(value)) !== MAP_ITERATOR_PROTOTYPE ||
    MAP_ITERATOR_PROTOTYPE.next !== MAP_ITERATOR_NEXT ||
    Object.hasOwn(value, 'get') ||
    Object.hasOwn(value, 'keys') ||
    Object.hasOwn(value, 'entries') ||
    Object.hasOwn(value, Symbol.iterator)
  )
    fail('parserHints must be a non-proxied native Map with unmodified methods');
  const size = MAP_SIZE!.call(value) as number;
  if (size > limits.maxRegistryEntries) fail('parserHints exceeds the entry limit');
  const iterator = MAP_ENTRIES.call(value);
  const entries: ParserHintSnapshotEntry[] = [];
  let totalArguments = 0;
  while (true) {
    const step = MAP_ITERATOR_NEXT.call(iterator);
    if (step.done) break;
    const pair = step.value as [unknown, ParserHintsConfig];
    if (!Array.isArray(pair) || pair.length !== 2) fail(`parserHints entry ${entries.length} is invalid`);
    const entry = canonicalEntry(pair[0], pair[1], entries.length, limits);
    totalArguments += entry.positionalArgs.length;
    if (totalArguments > limits.maxRegistryEntries) fail('parserHints exceeds the aggregate argument limit');
    entries.push(entry);
  }
  if (entries.length !== size) fail('parserHints size changed during capture');
  ARRAY_SORT.call(entries, (left, right) => (left.type < right.type ? -1 : left.type > right.type ? 1 : 0));
  return Object.freeze(entries);
}

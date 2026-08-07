/** @internal Fused mutable node-type registry capture and parser evidence. */

import { types as nodeTypes } from 'node:util';

import { parseWithDiagnostics, tokenizeLine } from './parser.js';
import type { ParseOptions } from './parser-core.js';
import { KernRuntime, type ParserHintsConfig } from './runtime-state.js';
import type { ParseResult } from './types.js';

// Stable parser safety invariants mirrored from KernRuntime's built-in multiline set.
const DEFAULT_MULTILINE_BLOCK_TYPES = ['logic', 'handler', 'cleanup', 'body', 'doc', 'render'] as const;

const SET_PROTOTYPE = Set.prototype;
const SET_HAS = Set.prototype.has;
const SET_VALUES = Set.prototype.values;
const SET_ITERATOR = Set.prototype[Symbol.iterator];
const SET_SIZE = Object.getOwnPropertyDescriptor(Set.prototype, 'size')?.get;
const SET_ITERATOR_PROTOTYPE = Object.getPrototypeOf(SET_VALUES.call(new Set()));
const SET_ITERATOR_NEXT = SET_ITERATOR_PROTOTYPE.next as () => IteratorResult<unknown>;
const MAP_PROTOTYPE = Map.prototype;
const MAP_HAS = Map.prototype.has;
const MAP_KEYS = Map.prototype.keys;
const MAP_ENTRIES = Map.prototype.entries;
const MAP_ITERATOR = Map.prototype[Symbol.iterator];
const MAP_GET = Map.prototype.get;
const MAP_SIZE = Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get;
const MAP_ITERATOR_PROTOTYPE = Object.getPrototypeOf(MAP_KEYS.call(new Map()));
const MAP_ITERATOR_NEXT = MAP_ITERATOR_PROTOTYPE.next as () => IteratorResult<unknown>;
const ARRAY_SORT = Array.prototype.sort;
const ARRAY_ITERATOR = Array.prototype[Symbol.iterator];
const ARRAY_ITERATOR_PROTOTYPE = Object.getPrototypeOf(ARRAY_ITERATOR.call([]));
const ARRAY_ITERATOR_NEXT = ARRAY_ITERATOR_PROTOTYPE.next as () => IteratorResult<unknown>;
const STRING_CHAR_CODE_AT = String.prototype.charCodeAt;
const RUNTIME_PROTOTYPE = KernRuntime.prototype;
const RUNTIME_IS_TEMPLATE_NODE = KernRuntime.prototype.isTemplateNode;

if (!SET_SIZE || !MAP_SIZE)
  throw new TypeError('mutable node-type registry snapshot: collection size getters are missing');

interface RuntimeSnapshotIdentity {
  readonly instance: number;
  epoch: number;
}

export interface MutableNodeTypeRegistrySnapshotEvidence {
  readonly format: 'kern.frontend.mutable-node-type-registry-snapshot.1';
  readonly runtimeInstance: number;
  readonly parseEpoch: number;
  readonly evolvedTypes: readonly string[];
  readonly multilineTypes: readonly string[];
  readonly templateTypes: readonly string[];
}

export interface MutableNodeTypeRegistrySnapshotLimits {
  readonly maxNameBytes: number;
  readonly maxNameCodePoints: number;
  readonly maxRegistryEntries: number;
}

export interface MutableNodeTypeRegistryParseEvidence {
  readonly parseResult: ParseResult;
  readonly snapshot: MutableNodeTypeRegistrySnapshotEvidence;
}

export interface ConsumedMutableNodeTypeRegistryParseEvidence extends MutableNodeTypeRegistryParseEvidence {
  readonly source: string;
}

const runtimeIdentities = new WeakMap<KernRuntime, RuntimeSnapshotIdentity>();
const parseEvidenceBindings = new WeakMap<
  MutableNodeTypeRegistryParseEvidence,
  { readonly runtime: KernRuntime; readonly source: string }
>();
let nextRuntimeInstance = 1;

function fail(detail: string): never {
  throw new TypeError(`mutable node-type registry snapshot: ${detail}`);
}

function assertSnapshotLimits(value: MutableNodeTypeRegistrySnapshotLimits): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    nodeTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail('limits must be a non-proxied plain object');
  const keys = Object.keys(value).sort();
  const expected = ['maxNameBytes', 'maxNameCodePoints', 'maxRegistryEntries'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail(`limits must contain exactly ${expected.join(',')}`);
  }
  for (const key of expected) {
    if (
      !Number.isSafeInteger(value[key as keyof MutableNodeTypeRegistrySnapshotLimits]) ||
      value[key as keyof MutableNodeTypeRegistrySnapshotLimits] <= 0
    ) {
      fail(`${key} must be a positive safe integer`);
    }
  }
  if (value.maxNameBytes < value.maxNameCodePoints) fail('name byte limit cannot be below the code-point limit');
}

function assertNativeRuntime(value: KernRuntime): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    nodeTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== RUNTIME_PROTOTYPE ||
    KernRuntime.prototype.isTemplateNode !== RUNTIME_IS_TEMPLATE_NODE ||
    Array.prototype[Symbol.iterator] !== ARRAY_ITERATOR ||
    Object.getPrototypeOf(ARRAY_ITERATOR.call([])) !== ARRAY_ITERATOR_PROTOTYPE ||
    ARRAY_ITERATOR_PROTOTYPE.next !== ARRAY_ITERATOR_NEXT ||
    Object.hasOwn(value, 'isTemplateNode')
  )
    fail('runtime must be a non-proxied KernRuntime with unmodified parser methods');
}

function assertNativeSet(value: unknown, label: string): asserts value is Set<string> {
  if (
    value === null ||
    typeof value !== 'object' ||
    nodeTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== SET_PROTOTYPE ||
    Set.prototype.has !== SET_HAS ||
    Set.prototype.values !== SET_VALUES ||
    Set.prototype[Symbol.iterator] !== SET_ITERATOR ||
    Object.getOwnPropertyDescriptor(Set.prototype, 'size')?.get !== SET_SIZE ||
    Object.getPrototypeOf(SET_VALUES.call(value)) !== SET_ITERATOR_PROTOTYPE ||
    SET_ITERATOR_PROTOTYPE.next !== SET_ITERATOR_NEXT ||
    Object.hasOwn(value, 'has') ||
    Object.hasOwn(value, 'values') ||
    Object.hasOwn(value, Symbol.iterator)
  )
    fail(`${label} must be a non-proxied native Set with unmodified membership and iterator methods`);
}

function assertNativeMap(value: unknown, label: string): asserts value is Map<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    nodeTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== MAP_PROTOTYPE ||
    Map.prototype.has !== MAP_HAS ||
    Map.prototype.keys !== MAP_KEYS ||
    Map.prototype.entries !== MAP_ENTRIES ||
    Map.prototype[Symbol.iterator] !== MAP_ITERATOR ||
    Map.prototype.get !== MAP_GET ||
    Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get !== MAP_SIZE ||
    Object.getPrototypeOf(MAP_KEYS.call(value)) !== MAP_ITERATOR_PROTOTYPE ||
    MAP_ITERATOR_PROTOTYPE.next !== MAP_ITERATOR_NEXT ||
    Object.hasOwn(value, 'has') ||
    Object.hasOwn(value, 'keys') ||
    Object.hasOwn(value, 'entries') ||
    Object.hasOwn(value, 'get') ||
    Object.hasOwn(value, Symbol.iterator)
  )
    fail(`${label} must be a non-proxied native Map with unmodified membership and iterator methods`);
}

function assertPlainParserHints(value: unknown, label: string): asserts value is ParserHintsConfig {
  if (
    value === null ||
    typeof value !== 'object' ||
    nodeTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail(`${label} must be non-proxied plain data`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const allowed = new Set<PropertyKey>(['bareWord', 'multilineBlock', 'positionalArgs']);
  if (
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !allowed.has(key) || !descriptor || !('value' in descriptor);
    })
  ) {
    fail(`${label} must contain only data properties for parser hints`);
  }
  for (const key of ['bareWord', 'multilineBlock'] as const) {
    const field = descriptors[key]?.value;
    if (field !== undefined && typeof field !== 'string') fail(`${label}.${key} must be a string`);
  }
  const positionalArgs = descriptors.positionalArgs?.value;
  if (positionalArgs === undefined) return;
  if (
    !Array.isArray(positionalArgs) ||
    nodeTypes.isProxy(positionalArgs) ||
    Object.getPrototypeOf(positionalArgs) !== Array.prototype
  )
    fail(`${label}.positionalArgs must be a non-proxied native array`);
  for (let index = 0; index < positionalArgs.length; index += 1) {
    if (typeof positionalArgs[index] !== 'string') fail(`${label}.positionalArgs entries must be strings`);
  }
}

function assertNativeParserHints(value: unknown): asserts value is Map<string, ParserHintsConfig> {
  assertNativeMap(value, 'parserHints');
  const iterator = MAP_ENTRIES.call(value);
  let index = 0;
  while (true) {
    const step = MAP_ITERATOR_NEXT.call(iterator);
    if (step.done) break;
    const entry = step.value as [unknown, unknown];
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') fail(`parserHints entry ${index} has an invalid key`);
    assertPlainParserHints(entry[1], `parserHints entry ${index}`);
    index += 1;
  }
  if (index !== MAP_SIZE!.call(value)) fail('parserHints size changed during capture');
}

function validateName(value: unknown, label: string, limits: MutableNodeTypeRegistrySnapshotLimits): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} names must be non-empty strings`);
  let bytes = 0;
  let codePoints = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = STRING_CHAR_CODE_AT.call(value, index);
    let scalar = code;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = STRING_CHAR_CODE_AT.call(value, index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail(`${label} names must use well-formed UTF-16`);
      scalar = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) fail(`${label} names must use well-formed UTF-16`);
    codePoints += 1;
    bytes += scalar <= 0x7f ? 1 : scalar <= 0x7ff ? 2 : scalar <= 0xffff ? 3 : 4;
    if (codePoints > limits.maxNameCodePoints) fail(`${label} name exceeds the code-point limit`);
    if (bytes > limits.maxNameBytes) fail(`${label} name exceeds the UTF-8 byte limit`);
  }
  return value;
}

function canonicalSetNames(
  values: Set<string>,
  label: string,
  limits: MutableNodeTypeRegistrySnapshotLimits,
): readonly string[] {
  const size = SET_SIZE!.call(values) as number;
  if (size > limits.maxRegistryEntries) fail(`${label} registry exceeds the entry limit`);
  const iterator = SET_VALUES.call(values);
  const names: string[] = [];
  while (true) {
    const step = SET_ITERATOR_NEXT.call(iterator);
    if (step.done) break;
    names.push(validateName(step.value, label, limits));
  }
  if (names.length !== size) fail(`${label} registry size changed during capture`);
  ARRAY_SORT.call(names, (left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.freeze(names);
}

function canonicalMapKeys(
  values: Map<string, unknown>,
  label: string,
  limits: MutableNodeTypeRegistrySnapshotLimits,
): readonly string[] {
  const size = MAP_SIZE!.call(values) as number;
  if (size > limits.maxRegistryEntries) fail(`${label} registry exceeds the entry limit`);
  const iterator = MAP_KEYS.call(values);
  const names: string[] = [];
  while (true) {
    const step = MAP_ITERATOR_NEXT.call(iterator);
    if (step.done) break;
    names.push(validateName(step.value, label, limits));
  }
  if (names.length !== size) fail(`${label} registry size changed during capture`);
  ARRAY_SORT.call(names, (left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.freeze(names);
}

function nextIdentity(runtime: KernRuntime): RuntimeSnapshotIdentity {
  let identity = runtimeIdentities.get(runtime);
  if (!identity) {
    if (!Number.isSafeInteger(nextRuntimeInstance)) fail('runtime instance space is exhausted');
    identity = { instance: nextRuntimeInstance, epoch: 0 };
    nextRuntimeInstance += 1;
    runtimeIdentities.set(runtime, identity);
  }
  if (identity.epoch >= Number.MAX_SAFE_INTEGER) fail('parse epoch space is exhausted');
  identity.epoch += 1;
  return identity;
}

function captureSnapshot(
  runtime: KernRuntime,
  limits: MutableNodeTypeRegistrySnapshotLimits,
): MutableNodeTypeRegistrySnapshotEvidence {
  assertSnapshotLimits(limits);
  assertNativeRuntime(runtime);
  const dynamicNodeTypes = runtime.dynamicNodeTypes;
  const multilineBlockTypes = runtime.multilineBlockTypes;
  const templateRegistry = runtime.templateRegistry;
  const parserHints = runtime.parserHints;
  assertNativeSet(dynamicNodeTypes, 'dynamicNodeTypes');
  assertNativeSet(multilineBlockTypes, 'multilineBlockTypes');
  assertNativeMap(templateRegistry, 'templateRegistry');
  assertNativeParserHints(parserHints);

  const evolvedTypes = canonicalSetNames(dynamicNodeTypes, 'evolved type', limits);
  const multilineTypes = canonicalSetNames(multilineBlockTypes, 'multiline type', limits);
  const templateTypes = canonicalMapKeys(templateRegistry, 'template type', limits);
  for (const required of DEFAULT_MULTILINE_BLOCK_TYPES) {
    if (!SET_HAS.call(multilineBlockTypes, required)) fail(`default multiline type ${required} is missing`);
  }
  const identity = nextIdentity(runtime);
  return Object.freeze({
    format: 'kern.frontend.mutable-node-type-registry-snapshot.1',
    runtimeInstance: identity.instance,
    parseEpoch: identity.epoch,
    evolvedTypes,
    multilineTypes,
    templateTypes,
  });
}

/**
 * Capture registry membership and immediately execute the synchronous parser.
 * No caller-controlled callback occurs between these two operations.
 */
export function parseWithMutableNodeTypeRegistrySnapshot(
  source: string,
  runtime: KernRuntime,
  limits: MutableNodeTypeRegistrySnapshotLimits,
  options?: ParseOptions,
): MutableNodeTypeRegistryParseEvidence {
  const snapshot = captureSnapshot(runtime, limits);
  const parseResult = parseWithDiagnostics(source, runtime, options);
  const evidence = Object.freeze({ parseResult, snapshot });
  parseEvidenceBindings.set(evidence, { runtime, source });
  return evidence;
}

function isInlineCommentStart(source: string, tokens: ReturnType<typeof tokenizeLine>, index: number): boolean {
  const token = tokens[index];
  const precededByWhitespace = token.pos === 0 || source[token.pos - 1] === ' ' || source[token.pos - 1] === '\t';
  if (!precededByWhitespace) return false;
  if (token.kind === 'unknown' && token.value === '#') return true;
  const next = tokens[index + 1];
  return (
    token.kind === 'unknown' &&
    token.value === '/' &&
    next?.kind === 'unknown' &&
    next.value === '/' &&
    next.pos === token.pos + 1
  );
}

function assertGenericPropertyAdmissionSourceSafety(source: string): void {
  if (source.includes('\r') || source.includes('\n')) {
    fail('generic property admission safety requires one LF-free source line');
  }
  const tokens = tokenizeLine(source);
  const typeIndex = tokens.findIndex((token) => token.kind !== 'whitespace');
  if (typeIndex < 0 || tokens[typeIndex].kind !== 'identifier') return;
  for (let index = typeIndex + 1; index < tokens.length; index += 1) {
    if (isInlineCommentStart(source, tokens, index)) return;
    const token = tokens[index];
    if (token.kind === 'identifier' && token.value === '__proto__' && tokens[index + 1]?.kind === 'equals') {
      fail('reserved generic property key __proto__ is outside the safe source profile');
    }
  }
}

/**
 * Reject the frozen bootstrap parser's unsafe `__proto__=` spelling before
 * capturing M4.162 evidence. This entry is intentionally limited to the
 * single-line M4.164 generic-property admission source profile.
 */
export function parseWithGenericPropertyAdmissionSafety(
  source: string,
  runtime: KernRuntime,
  limits: MutableNodeTypeRegistrySnapshotLimits,
  options?: ParseOptions,
): MutableNodeTypeRegistryParseEvidence {
  assertGenericPropertyAdmissionSourceSafety(source);
  return parseWithMutableNodeTypeRegistrySnapshot(source, runtime, limits, options);
}

/** Consume exactly one fused parse result; structural copies and replay fail closed. */
export function consumeMutableNodeTypeRegistryParseEvidence(
  evidence: MutableNodeTypeRegistryParseEvidence,
): ConsumedMutableNodeTypeRegistryParseEvidence {
  const binding = parseEvidenceBindings.get(evidence);
  if (!binding) fail('fused parse evidence is forged, stale, or already consumed');
  const identity = runtimeIdentities.get(binding.runtime);
  if (
    !identity ||
    identity.instance !== evidence.snapshot.runtimeInstance ||
    identity.epoch !== evidence.snapshot.parseEpoch
  ) {
    fail('fused parse evidence is stale for its runtime epoch');
  }
  parseEvidenceBindings.delete(evidence);
  return Object.freeze({ parseResult: evidence.parseResult, snapshot: evidence.snapshot, source: binding.source });
}

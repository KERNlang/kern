import {
  type CanonicalRecordEntry,
  type CanonicalValue,
  CanonicalValueDecodeError,
  type CanonicalValueLimits,
} from '../canonical-value/types.js';
import { compareCodePoints, validateCanonicalValueLimits } from '../canonical-value/validate.js';
import type { PortableHandlerTypePosition } from '../portable-handler-type.js';
import type { IRNode } from '../types.js';
import { projectBranchPathValue, validateBranchPathValue } from './branch-path-value.js';
import { STRUCTURAL_KIR_NODE_CATALOG } from './catalog.generated.js';
import { projectEachCollectionReference, validateEachCollectionReference } from './each-collection-reference.js';
import { projectExpressionText, validateExpressionValue } from './expression.js';
import { projectHandlerType, validateHandlerType } from './handler-type.js';
import {
  StructuralKirError,
  type StructuralKirNode,
  type StructuralNodeContract,
  type StructuralPropertyContract,
} from './types.js';

type UnknownRecord = Record<string, unknown>;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const IMPORT_PATH = /^(@[A-Za-z0-9_-]+\/)?[A-Za-z0-9_./~+-]+$/u;
const NODE_FIELDS = ['__quotedProps', 'children', 'loc', 'props', 'type'];

function fail(code: ConstructorParameters<typeof StructuralKirError>[0], path: string, message: string): never {
  throw new StructuralKirError(code, path, message);
}

function object(value: unknown, path: string): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail('invalid-artifact', path, 'expected plain object');
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail('invalid-artifact', path, 'expected plain object');
    const snapshot: UnknownRecord = Object.create(null) as UnknownRecord;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') fail('invalid-artifact', path, 'symbol fields are forbidden');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        fail('invalid-artifact', `${path}.${key}`, 'accessor or hidden field is forbidden');
      }
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch (error) {
    if (error instanceof StructuralKirError) throw error;
    fail('invalid-artifact', path, 'object is not safely inspectable');
  }
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail('invalid-artifact', path, 'expected plain array');
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('invalid-artifact', path, 'expected plain array');
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(length)) fail('invalid-artifact', path, 'invalid array length');
    const keys = Reflect.ownKeys(value);
    if (keys.length !== (length as number) + 1) fail('invalid-artifact', path, 'sparse or extended array is forbidden');
    const snapshot = new Array<unknown>(length as number);
    for (const key of keys) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= (length as number)) {
        fail('invalid-artifact', path, 'array contains a non-index field');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        fail('invalid-artifact', `${path}[${key}]`, 'array accessor is forbidden');
      }
      snapshot[Number(key)] = descriptor.value;
    }
    return snapshot;
  } catch (error) {
    if (error instanceof StructuralKirError) throw error;
    fail('invalid-artifact', path, 'array is not safely inspectable');
  }
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') fail('invalid-property', path, 'expected text');
  return value;
}

function normalizeImportPath(value: unknown, path: string): string {
  const source = text(value, path);
  if (
    source.length === 0 ||
    source.startsWith('/') ||
    /^[A-Za-z]:/u.test(source) ||
    source.includes('\\') ||
    source.includes('//') ||
    source.endsWith('/') ||
    !IMPORT_PATH.test(source)
  ) {
    fail('invalid-import-path', path, 'expected normalized portable import path');
  }
  const body = source.startsWith('./') ? source.slice(2) : source;
  const segments = body.split('/');
  const firstNonParent = segments.findIndex((segment) => segment !== '..');
  if (
    segments.some((segment) => segment === '.' || segment === '') ||
    (firstNonParent >= 0 && segments.slice(firstNonParent).includes('..'))
  ) {
    fail('invalid-import-path', path, 'import path is not segment-normalized');
  }
  return source;
}

function expressionSource(value: unknown, path: string): string {
  if (typeof value === 'string') return value;
  const expression = object(value, path);
  const keys = Object.keys(expression).sort(compareCodePoints);
  if (keys.length !== 2 || keys[0] !== '__expr' || keys[1] !== 'code' || expression.__expr !== true) {
    fail('invalid-property', path, 'expected expression text or exact expression object');
  }
  return text(expression.code, `${path}.code`);
}

function numberValue(value: unknown, path: string): CanonicalValue {
  if (typeof value === 'number' && Object.is(value, -0)) {
    fail('invalid-property', path, 'negative zero is outside the numeric property contract');
  }
  const source = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : text(value, path);
  if (/^(?:0|-?[1-9][0-9]*)$/u.test(source)) return { tag: 'int', value: source };
  if (/^-?(?:0|[1-9][0-9]*)\.[0-9]+$/u.test(source) && !/^-0\.0+$/u.test(source)) {
    return { tag: 'decimal', value: source };
  }
  fail('invalid-property', path, 'expected canonical integer or decimal text');
}

function includedValue(value: unknown, contract: StructuralPropertyContract, path: string): CanonicalValue {
  if (contract.schemaKind === 'identifier') {
    const result = text(value, path);
    if (!IDENTIFIER.test(result)) fail('invalid-property', path, 'invalid KERN identifier');
    return { tag: 'text', value: result };
  }
  if (contract.schemaKind === 'string') return { tag: 'text', value: text(value, path) };
  if (contract.schemaKind === 'boolean') {
    if (value === true || value === false) return { tag: 'bool', value };
    if (value === 'true' || value === 'false') return { tag: 'bool', value: value === 'true' };
    fail('invalid-property', path, 'expected portable boolean');
  }
  if (contract.schemaKind === 'number') return numberValue(value, path);
  fail('invalid-property', path, `unsupported included schema kind ${contract.schemaKind}`);
}

function handlerTypePosition(
  kind: string,
  name: string,
  parentKind: string | undefined,
): PortableHandlerTypePosition | undefined {
  if (kind === 'fn' && name === 'returns') return 'return';
  if (kind === 'param' && name === 'type' && parentKind === 'fn') return 'parameter';
  return undefined;
}

function projectProperty(
  value: unknown,
  contract: StructuralPropertyContract,
  path: string,
  kind: string,
  name: string,
  parentKind: string | undefined,
  quoted: boolean,
): CanonicalValue {
  if (contract.disposition.startsWith('excluded-')) {
    fail('excluded-host-payload', path, `${contract.disposition}: ${contract.reasonId}`);
  }
  if (contract.values !== null && !contract.values.includes(String(value))) {
    fail('invalid-property', path, `value is outside enum ${contract.values.join(',')}`);
  }
  if (contract.disposition === 'included-value') return includedValue(value, contract, path);
  if (contract.disposition === 'lowered-import-path') return { tag: 'text', value: normalizeImportPath(value, path) };
  if (contract.disposition === 'lowered-expression') return projectExpressionText(expressionSource(value, path), path);
  if (contract.disposition === 'lowered-branch-path-value') return projectBranchPathValue(value, quoted, path);
  if (contract.disposition === 'lowered-each-collection-reference') return projectEachCollectionReference(value, path);
  if (contract.disposition === 'lowered-type') {
    const position = handlerTypePosition(kind, name, parentKind);
    if (position === undefined) fail('excluded-host-payload', path, 'type is outside a structured handler signature');
    return projectHandlerType(value, position, path);
  }
  fail('invalid-property', path, `unknown property disposition ${String(contract.disposition)}`);
}

function canonicalizesToOmission(kind: string, name: string, value: unknown): boolean {
  return kind === 'fn' && name === 'params' && typeof value === 'string' && value.trim() === '';
}

function nodeContract(kind: string, path: string): StructuralNodeContract {
  const contract = STRUCTURAL_KIR_NODE_CATALOG.get(kind);
  if (contract === undefined || contract.schemaStatus !== 'bound' || contract.disposition !== 'structural-candidate') {
    fail('unknown-node-kind', path, `node kind ${kind} is not admitted by the structural constitution`);
  }
  return contract;
}

function assertNodeParent(
  contract: StructuralNodeContract,
  kind: string,
  parentKind: string | undefined,
  path: string,
): void {
  const allowed = contract.runnerSyntheticAllowedParents;
  if (allowed !== undefined && (parentKind === undefined || !allowed.includes(parentKind))) {
    fail('invalid-child', path, `${kind} is not allowed below ${parentKind ?? 'the structural root'}`);
  }
}

function childAllowed(contract: StructuralNodeContract, parentKind: string, childKind: string): boolean {
  const childContract = STRUCTURAL_KIR_NODE_CATALOG.get(childKind);
  if (childContract?.runnerSyntheticAllowedParents?.includes(parentKind)) return true;
  return contract.allowedChildren === null || contract.allowedChildren.includes(childKind);
}

function assertRequired(
  properties: Readonly<Record<string, unknown>>,
  contract: StructuralNodeContract,
  path: string,
): void {
  for (const [name, property] of Object.entries(contract.properties)) {
    if (!property.required || Object.hasOwn(properties, name)) continue;
    if (property.disposition.startsWith('excluded-')) {
      fail(
        'excluded-host-payload',
        `${path}.${name}`,
        `required ${property.disposition} property cannot be represented`,
      );
    }
    fail('missing-property', `${path}.${name}`, 'required property is missing');
  }
}

interface ProjectState {
  nodes: number;
  readonly limits: CanonicalValueLimits;
}

function projectNode(
  input: unknown,
  path: string,
  depth: number,
  state: ProjectState,
  parentKind?: string,
): StructuralKirNode {
  if (depth > state.limits.maxDepth) {
    throw new CanonicalValueDecodeError(
      'limit-depth',
      path,
      `structural node exceeds maxDepth ${state.limits.maxDepth}`,
    );
  }
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes) {
    throw new CanonicalValueDecodeError(
      'limit-nodes',
      path,
      `structural nodes exceed maxNodes ${state.limits.maxNodes}`,
    );
  }
  const node = object(input, path);
  for (const key of Object.keys(node))
    if (!NODE_FIELDS.includes(key)) fail('invalid-artifact', `${path}.${key}`, 'unknown IR node field');
  const kind = text(node.type, `${path}.type`);
  const contract = nodeContract(kind, `${path}.type`);
  assertNodeParent(contract, kind, parentKind, `${path}.type`);
  const rawProperties =
    node.props === undefined ? (Object.create(null) as UnknownRecord) : object(node.props, `${path}.props`);
  const quotedProperties = new Set<string>();
  if (node.__quotedProps !== undefined) {
    for (const [index, value] of array(node.__quotedProps, `${path}.__quotedProps`).entries()) {
      const name = text(value, `${path}.__quotedProps[${index}]`);
      if (quotedProperties.has(name) || !Object.hasOwn(rawProperties, name)) {
        fail('invalid-artifact', `${path}.__quotedProps[${index}]`, 'quoted property metadata is stale or duplicated');
      }
      if (kind === 'path' && contract.properties[name]?.disposition !== 'lowered-branch-path-value') {
        fail('invalid-artifact', `${path}.__quotedProps[${index}]`, 'path quote metadata is reserved for value');
      }
      quotedProperties.add(name);
    }
  }
  assertRequired(rawProperties, contract, `${path}.props`);
  const properties: CanonicalRecordEntry[] = [];
  for (const name of Object.keys(rawProperties).sort(compareCodePoints)) {
    const propertyContract = contract.properties[name];
    if (propertyContract === undefined) fail('unknown-property', `${path}.props.${name}`, `unknown ${kind} property`);
    if (canonicalizesToOmission(kind, name, rawProperties[name])) continue;
    properties.push({
      key: name,
      value: projectProperty(
        rawProperties[name],
        propertyContract,
        `${path}.props.${name}`,
        kind,
        name,
        parentKind,
        quotedProperties.has(name),
      ),
    });
  }
  const rawChildren = node.children === undefined ? [] : array(node.children, `${path}.children`);
  const children = rawChildren.map((child, index) =>
    projectNode(child, `${path}.children[${index}]`, depth + 1, state, kind),
  );
  children.forEach((child, index) => {
    if (!childAllowed(contract, kind, child.kind)) {
      fail('invalid-child', `${path}.children[${index}]`, `${child.kind} is not allowed below ${kind}`);
    }
  });
  return { kind, properties, children };
}

export function projectStructuralNode(input: IRNode, limitsInput: CanonicalValueLimits): StructuralKirNode {
  const limits = validateCanonicalValueLimits(limitsInput);
  try {
    return projectNode(input, '$.root', 1, { nodes: 0, limits });
  } catch (error) {
    if (error instanceof StructuralKirError || error instanceof CanonicalValueDecodeError) throw error;
    if (error instanceof RangeError)
      throw new CanonicalValueDecodeError('limit-depth', '$.root', 'structural node exceeds host-safe depth');
    fail('invalid-artifact', '$.root', 'IR node is not safely inspectable');
  }
}

function canonicalRecord(value: CanonicalValue, keys: readonly string[], path: string): Map<string, CanonicalValue> {
  if (
    value.tag !== 'record' ||
    value.value.length !== keys.length ||
    value.value.some((entry, index) => entry.key !== keys[index])
  ) {
    fail('invalid-artifact', path, `expected canonical fields ${keys.join(',')}`);
  }
  return new Map(value.value.map((entry) => [entry.key, entry.value]));
}

function canonicalField(record: Map<string, CanonicalValue>, name: string): CanonicalValue {
  const value = record.get(name);
  if (value === undefined) fail('invalid-artifact', `$.${name}`, `missing canonical field ${name}`);
  return value;
}

function canonicalText(value: CanonicalValue, path: string): string {
  if (value.tag !== 'text') fail('invalid-artifact', path, 'expected text');
  return value.value;
}

function validateProperty(
  value: CanonicalValue,
  contract: StructuralPropertyContract,
  path: string,
  kind: string,
  name: string,
  parentKind: string | undefined,
): void {
  if (contract.disposition.startsWith('excluded-'))
    fail('excluded-host-payload', path, `${contract.disposition} is forbidden`);
  if (contract.disposition === 'lowered-expression') {
    validateExpressionValue(value, path);
    return;
  }
  if (contract.disposition === 'lowered-branch-path-value') {
    validateBranchPathValue(value, path);
    return;
  }
  if (contract.disposition === 'lowered-each-collection-reference') {
    validateEachCollectionReference(value, path);
    return;
  }
  if (contract.disposition === 'lowered-import-path') {
    const source = canonicalText(value, path);
    if (normalizeImportPath(source, path) !== source) fail('invalid-import-path', path, 'import path is not canonical');
    return;
  }
  if (contract.disposition === 'lowered-type') {
    const position = handlerTypePosition(kind, name, parentKind);
    if (position === undefined) fail('excluded-host-payload', path, 'type is outside a structured handler signature');
    validateHandlerType(value, position, path);
    return;
  }
  if (contract.schemaKind === 'boolean') {
    if (value.tag !== 'bool') fail('invalid-property', path, 'expected boolean');
    return;
  }
  if (contract.schemaKind === 'number') {
    if (value.tag !== 'int' && value.tag !== 'decimal') fail('invalid-property', path, 'expected number');
    return;
  }
  const source = canonicalText(value, path);
  if (contract.schemaKind === 'identifier' && !IDENTIFIER.test(source))
    fail('invalid-property', path, 'invalid identifier');
  if (contract.values !== null && !contract.values.includes(source))
    fail('invalid-property', path, 'value is outside enum');
}

export function validateStructuralNode(value: CanonicalValue, path = '$.root', parentKind?: string): StructuralKirNode {
  const node = canonicalRecord(value, ['children', 'kind', 'properties'], path);
  const kind = canonicalText(canonicalField(node, 'kind'), `${path}.kind`);
  const contract = nodeContract(kind, `${path}.kind`);
  assertNodeParent(contract, kind, parentKind, `${path}.kind`);
  const propertyValue = canonicalField(node, 'properties');
  if (propertyValue.tag !== 'record') fail('invalid-artifact', `${path}.properties`, 'expected property record');
  const present = Object.fromEntries(propertyValue.value.map((entry) => [entry.key, true]));
  assertRequired(present, contract, `${path}.properties`);
  propertyValue.value.forEach((entry) => {
    const propertyContract = contract.properties[entry.key];
    if (propertyContract === undefined)
      fail('unknown-property', `${path}.properties.${entry.key}`, `unknown ${kind} property`);
    validateProperty(entry.value, propertyContract, `${path}.properties.${entry.key}`, kind, entry.key, parentKind);
  });
  const childValue = canonicalField(node, 'children');
  if (childValue.tag !== 'list') fail('invalid-artifact', `${path}.children`, 'expected child list');
  const children = childValue.value.map((child, index) =>
    validateStructuralNode(child, `${path}.children[${index}]`, kind),
  );
  children.forEach((child, index) => {
    if (!childAllowed(contract, kind, child.kind))
      fail('invalid-child', `${path}.children[${index}]`, `${child.kind} is not allowed below ${kind}`);
  });
  return { kind, properties: propertyValue.value, children };
}

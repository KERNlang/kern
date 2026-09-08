import type { CanonicalValue } from '../../canonical-value/types.js';
import type { StructuralKirNode } from '../../kir-structural/types.js';
import { type KernKirDiagnosticCode, KernKirFault } from '../contracts.js';
import { canonicalRecord, exact, nodeChildren, plainRecord, type RuntimeMeter, requiredText } from '../inspect.js';
import {
  type LinkedKernKirCallPolicy,
  type LinkedKernKirCallScope,
  type LinkedKernKirCrossCallType,
  type LinkedKernKirHandler,
  type LinkedKernKirStatement,
  type LinkedKernKirStaticType,
  statementSubBlocks,
} from './contracts.js';
import type { LinkedKernKirClosureWalk } from './walkers.js';
export function fault(code: KernKirDiagnosticCode, message: string): never {
  throw new KernKirFault(code, 'link', message);
}

export function nodeKind(node: StructuralKirNode, label: string): string {
  const record = plainRecord(node, label);
  exact(record, ['kind', 'properties', 'children'], label);
  if (typeof record.kind !== 'string') fault('handler-entry-unsupported', `${label}.kind`);
  return record.kind;
}

export function propertyText(
  properties: ReadonlyMap<string, CanonicalValue>,
  key: string,
  label: string,
  meter: RuntimeMeter,
): string {
  const value = properties.get(key);
  if (value === undefined) fault('handler-entry-unsupported', `${label}.${key}: missing property`);
  const record = plainRecord(value, `${label}.${key}`);
  exact(record, ['tag', 'value'], `${label}.${key}`);
  if (record.tag !== 'text') fault('handler-entry-unsupported', `${label}.${key}: expected text`);
  return requiredText(record.value, `${label}.${key}`, meter);
}

export function propertyBool(properties: ReadonlyMap<string, CanonicalValue>, key: string, label: string): boolean {
  const value = properties.get(key);
  if (value === undefined) fault('handler-entry-unsupported', `${label}.${key}: missing property`);
  const record = plainRecord(value, `${label}.${key}`);
  exact(record, ['tag', 'value'], `${label}.${key}`);
  if (record.tag !== 'bool' || typeof record.value !== 'boolean') {
    fault('handler-entry-unsupported', `${label}.${key}: expected boolean`);
  }
  return record.value;
}

export function propertySet(
  properties: ReadonlyMap<string, CanonicalValue>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const keys = [...properties.keys()];
  if (
    required.some((key) => !properties.has(key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    fault('handler-entry-unsupported', `${label}: unsupported property set`);
  }
}

export function containsReturn(statements: readonly LinkedKernKirStatement[]): boolean {
  return statements.some(
    (statement) => statement.kind === 'return' || statementSubBlocks(statement).some(containsReturn),
  );
}

export function assertLeaf(node: StructuralKirNode, label: string): void {
  if (nodeChildren(node, label).length !== 0) fault('handler-entry-unsupported', `${label}: statement must be a leaf`);
}

export interface LinkScope {
  readonly assignable: Set<string>;
  readonly bindings: Set<string>;
  readonly calls: LinkedKernKirCallScope | undefined;
  readonly counters: Set<string>;
  readonly crossCallTypes: Map<string, LinkedKernKirCrossCallType>;
  readonly loopDepth: number;
  readonly types: Map<string, LinkedKernKirStaticType>;
}

export interface ModuleContext {
  readonly closureWalk: LinkedKernKirClosureWalk;
  readonly linked: Map<string, LinkedKernKirHandler>;
  readonly linking: Set<string>;
  readonly meter: RuntimeMeter;
  readonly policy: LinkedKernKirCallPolicy;
  readonly rootNodes: readonly StructuralKirNode[];
  functions: ReadonlyMap<string, StructuralKirNode | 'ambiguous'> | undefined;
}

export function branchScope(scope: LinkScope): LinkScope {
  return {
    assignable: new Set(scope.assignable),
    bindings: new Set(scope.bindings),
    calls: scope.calls,
    counters: new Set(scope.counters),
    crossCallTypes: new Map(scope.crossCallTypes),
    loopDepth: scope.loopDepth,
    types: new Map(scope.types),
  };
}

export function bindName(
  scope: LinkScope,
  name: string,
  type: LinkedKernKirStaticType | undefined,
  crossCall: LinkedKernKirCrossCallType | undefined,
): void {
  scope.bindings.add(name);
  if (type === undefined) scope.types.delete(name);
  else scope.types.set(name, type);
  if (crossCall === undefined) scope.crossCallTypes.delete(name);
  else scope.crossCallTypes.set(name, crossCall);
}

export function assignTargetName(value: CanonicalValue | undefined, label: string, meter: RuntimeMeter): string {
  if (value === undefined) fault('handler-entry-unsupported', `${label}: missing target`);
  const target = canonicalRecord(value, ['fields', 'kind'], label);
  if (propertyText(target, 'kind', label, meter) !== 'identifier') {
    fault('handler-entry-unsupported', `${label}: KIR_ASSIGN_TARGET_NOT_IDENTIFIER`);
  }
  const fields = target.get('fields');
  if (fields === undefined) fault('handler-entry-unsupported', `${label}.fields: missing record`);
  const named = canonicalRecord(fields, ['name'], `${label}.fields`);
  return propertyText(named, 'name', `${label}.fields`, meter);
}

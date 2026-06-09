import type { IRNode } from '../types.js';
import type { KernInstanceValue, KernValue } from './index.js';

export type CoreShapeDiagnosticCode =
  | 'shape-extends-cycle'
  | 'shape-extends-unknown'
  | 'shape-field-conflict'
  | 'shape-field-duplicate'
  | 'shape-field-missing'
  | 'shape-field-type'
  | 'shape-generic-unsupported'
  | 'shape-indexer-key-unsupported'
  | 'shape-interface-not-found'
  | 'shape-object-expected'
  | 'shape-type-reference-unknown'
  | 'shape-type-unsupported'
  | 'shape-unexpected-field'
  | 'shape-value-cycle';

export interface CoreShapeDiagnostic {
  readonly code: CoreShapeDiagnosticCode;
  readonly message: string;
  readonly interfaceName?: string;
  readonly fieldName?: string;
  readonly path?: string;
  readonly expected?: string;
  readonly actual?: string;
}

export interface CoreShapeFieldFact {
  readonly name: string;
  readonly type?: string;
  readonly optional: boolean;
  readonly inheritedFrom?: string;
}

export interface CoreShapeIndexerFact {
  readonly keyName: string;
  readonly keyType: string;
  readonly type: string;
  readonly readonly: boolean;
}

export interface CoreShapeInterfaceFact {
  readonly name: string;
  readonly extends: readonly string[];
  readonly fields: readonly CoreShapeFieldFact[];
  readonly indexers: readonly CoreShapeIndexerFact[];
  readonly generic: boolean;
  readonly validatorAvailable: boolean;
  readonly unsupportedReasons: readonly string[];
}

export interface CoreShapeFacts {
  readonly interfaces: readonly CoreShapeInterfaceFact[];
  readonly extendsEdges: readonly {
    readonly from: string;
    readonly to: string;
    readonly resolved: boolean;
  }[];
  readonly validationDiagnostics: readonly CoreShapeDiagnostic[];
}

export interface CoreShapeValidationResult {
  readonly passed: boolean;
  readonly interfaceName: string;
  readonly diagnostics: readonly CoreShapeDiagnostic[];
}

interface ShapeInterface {
  readonly name: string;
  readonly extendsNames: readonly string[];
  readonly fields: readonly ShapeField[];
  readonly indexers: readonly ShapeIndexer[];
  readonly generic: boolean;
}

interface ShapeField {
  readonly name: string;
  readonly type?: string;
  readonly optional: boolean;
  readonly inheritedFrom?: string;
}

interface ShapeIndexer {
  readonly keyName: string;
  readonly keyType: string;
  readonly type: string;
  readonly readonly: boolean;
}

interface ShapeRegistry {
  readonly interfaces: ReadonlyMap<string, ShapeInterface>;
  readonly diagnostics: readonly CoreShapeDiagnostic[];
}

interface ResolvedShape {
  readonly fields: readonly ShapeField[];
  readonly indexers: readonly ShapeIndexer[];
  readonly diagnostics: readonly CoreShapeDiagnostic[];
}

/**
 * Validate a runtime record or class instance against a declared interface shape.
 * V1 supports primitives, arrays, nested interfaces, extends, and indexers.
 * Class instances are checked against initialized fields only; getters and
 * methods are not invoked during validation.
 */
export function validateCoreShape(
  value: KernValue,
  interfaceName: string,
  rootOrNodes: IRNode | readonly IRNode[],
): CoreShapeValidationResult {
  const registry = collectShapeRegistry(rootOrNodes);
  const diagnostics: CoreShapeDiagnostic[] = [];
  const shape = registry.interfaces.get(interfaceName);
  if (!shape) {
    diagnostics.push({
      code: 'shape-interface-not-found',
      message: `KERN core shape '${interfaceName}' is not declared.`,
      interfaceName,
    });
    return { passed: false, interfaceName, diagnostics };
  }
  diagnostics.push(...validateAgainstInterface(value, shape, registry, interfaceName, [], new WeakMap()));
  return { passed: diagnostics.length === 0, interfaceName, diagnostics };
}

export function assertCoreShape(
  value: KernValue,
  interfaceName: string,
  rootOrNodes: IRNode | readonly IRNode[],
): void {
  const result = validateCoreShape(value, interfaceName, rootOrNodes);
  if (result.passed) return;
  throw new Error(
    `KERN core shape validation failed for ${interfaceName}:\n${result.diagnostics
      .map((diagnostic) => diagnostic.message)
      .join('\n')}`,
  );
}

/**
 * Collect review/substrate facts for declared interface shapes without
 * changing runtime behavior. The facts include effective inherited fields and
 * indexers plus diagnostics for unsupported v1 contracts.
 */
export function collectCoreShapeFacts(rootOrNodes: IRNode | readonly IRNode[]): CoreShapeFacts {
  const registry = collectShapeRegistry(rootOrNodes);
  const resolvedByName = new Map<string, ResolvedShape>();
  const resolvedShape = (shape: ShapeInterface): ResolvedShape => {
    const cached = resolvedByName.get(shape.name);
    if (cached) return cached;
    const resolved = resolveShape(shape, registry, []);
    resolvedByName.set(shape.name, resolved);
    return resolved;
  };
  const interfaces = Array.from(registry.interfaces.values()).map((shape) => {
    const resolved = resolvedShape(shape);
    const unsupportedReasons = shapeUnsupportedReasons(shape, resolved, registry);
    return {
      name: shape.name,
      extends: [...shape.extendsNames],
      fields: resolved.fields.map((field) => ({ ...field })),
      indexers: resolved.indexers.map((indexer) => ({ ...indexer })),
      generic: shape.generic,
      validatorAvailable: unsupportedReasons.length === 0,
      unsupportedReasons,
    };
  });
  return {
    interfaces,
    extendsEdges: Array.from(registry.interfaces.values()).flatMap((shape) =>
      shape.extendsNames.map((base) => ({
        from: shape.name,
        to: base,
        resolved: registry.interfaces.has(base) && !extendsEdgeParticipatesInCycle(shape.name, base, registry),
      })),
    ),
    validationDiagnostics: dedupeDiagnostics([
      ...registry.diagnostics,
      ...Array.from(registry.interfaces.values()).flatMap((shape) => resolvedShape(shape).diagnostics),
    ]),
  };
}

function collectShapeRegistry(rootOrNodes: IRNode | readonly IRNode[]): ShapeRegistry {
  const diagnostics: CoreShapeDiagnostic[] = [];
  const interfaces = new Map<string, ShapeInterface>();
  for (const node of interfaceNodes(rootOrNodes)) {
    if (node.type !== 'interface') continue;
    const name = stringProp(node.props?.name);
    if (!name) continue;
    const shape: ShapeInterface = {
      name,
      extendsNames: splitExtends(node.props?.extends),
      fields: (node.children ?? []).filter((child) => child.type === 'field').map((field) => shapeField(field)),
      indexers: (node.children ?? [])
        .filter((child) => child.type === 'indexer')
        .map((indexer) => shapeIndexer(indexer)),
      generic: !!stringProp(node.props?.generics),
    };
    if (shape.generic) {
      diagnostics.push({
        code: 'shape-generic-unsupported',
        message: `KERN core shape '${shape.name}' uses generics, which are not executable shape contracts in v1.`,
        interfaceName: shape.name,
      });
    }
    interfaces.set(name, shape);
  }
  return { interfaces, diagnostics };
}

function validateAgainstInterface(
  value: KernValue,
  shape: ShapeInterface,
  registry: ShapeRegistry,
  path: string,
  stack: readonly string[],
  visited: WeakMap<Record<string, KernValue>, Set<string>>,
): CoreShapeDiagnostic[] {
  const diagnostics: CoreShapeDiagnostic[] = [];
  if (shape.generic) {
    diagnostics.push({
      code: 'shape-generic-unsupported',
      message: `KERN core shape '${shape.name}' uses generics, which are not executable shape contracts in v1.`,
      interfaceName: shape.name,
      path,
    });
  }
  const object = recordEntries(value);
  if (!object) {
    return [
      {
        code: 'shape-object-expected',
        message: `KERN core shape '${shape.name}' expected a record or instance at ${path}.`,
        interfaceName: shape.name,
        path,
        expected: shape.name,
        actual: value.kind,
      },
    ];
  }
  const activeForValue = visited.get(object) ?? new Set<string>();
  if (activeForValue.has(shape.name)) {
    return [
      {
        code: 'shape-value-cycle',
        message: `KERN core shape '${shape.name}' encountered a recursive value at ${path}.`,
        interfaceName: shape.name,
        path,
      },
    ];
  }
  activeForValue.add(shape.name);
  visited.set(object, activeForValue);
  const resolved = resolveShape(shape, registry, stack);
  diagnostics.push(...resolved.diagnostics);

  try {
    const declaredFieldNames = new Set(resolved.fields.map((field) => field.name));
    for (const field of resolved.fields) {
      if (!Object.hasOwn(object, field.name)) {
        if (!field.optional) {
          diagnostics.push({
            code: 'shape-field-missing',
            message: `KERN core shape '${shape.name}' missing required field ${fieldPath(path, field.name)}.`,
            interfaceName: shape.name,
            fieldName: field.name,
            path: fieldPath(path, field.name),
            expected: field.type,
          });
        }
        continue;
      }
      diagnostics.push(
        ...validateType(
          object[field.name] ?? kUndefinedValue(),
          field.type,
          registry,
          fieldPath(path, field.name),
          stack,
          visited,
        ),
      );
    }

    for (const [key, entry] of Object.entries(object)) {
      if (declaredFieldNames.has(key)) continue;
      const matchingIndexers = resolved.indexers.filter((candidate) => keyMatchesIndexer(key, candidate));
      if (matchingIndexers.length === 0) {
        diagnostics.push({
          code: 'shape-unexpected-field',
          message: `KERN core shape '${shape.name}' does not declare field ${fieldPath(path, key)}.`,
          interfaceName: shape.name,
          fieldName: key,
          path: fieldPath(path, key),
        });
        continue;
      }
      for (const indexer of matchingIndexers) {
        diagnostics.push(...validateType(entry, indexer.type, registry, fieldPath(path, key), stack, visited));
      }
    }
  } finally {
    activeForValue.delete(shape.name);
    if (activeForValue.size === 0) visited.delete(object);
  }

  return diagnostics;
}

function validateType(
  value: KernValue,
  rawType: string | undefined,
  registry: ShapeRegistry,
  path: string,
  stack: readonly string[],
  visited: WeakMap<Record<string, KernValue>, Set<string>>,
): CoreShapeDiagnostic[] {
  const type = normalizeType(rawType);
  if (!type || type === 'any' || type === 'unknown') return [];
  if (type.endsWith('[]')) return validateArrayType(value, type.slice(0, -2), registry, path, stack, visited);
  const arrayMatch = /^Array<(.+)>$/.exec(type);
  if (arrayMatch) return validateArrayType(value, arrayMatch[1] ?? '', registry, path, stack, visited);
  if (isPrimitiveType(type)) {
    if (value.kind === type) return [];
    return [
      {
        code: 'shape-field-type',
        message: `KERN core shape expected ${path} to be ${type}, got ${value.kind}.`,
        path,
        expected: type,
        actual: value.kind,
      },
    ];
  }
  if (isSimpleIdentifier(type)) {
    const nested = registry.interfaces.get(type);
    if (!nested) {
      return [
        {
          code: 'shape-type-reference-unknown',
          message: `KERN core shape field ${path} references unknown interface '${type}'.`,
          path,
          expected: type,
        },
      ];
    }
    return validateAgainstInterface(value, nested, registry, path, stack, visited);
  }
  return [
    {
      code: 'shape-type-unsupported',
      message: `KERN core shape field ${path} uses unsupported v1 type '${type}'.`,
      path,
      expected: type,
      actual: value.kind,
    },
  ];
}

function validateArrayType(
  value: KernValue,
  itemType: string,
  registry: ShapeRegistry,
  path: string,
  stack: readonly string[],
  visited: WeakMap<Record<string, KernValue>, Set<string>>,
): CoreShapeDiagnostic[] {
  if (value.kind !== 'array') {
    return [
      {
        code: 'shape-field-type',
        message: `KERN core shape expected ${path} to be array, got ${value.kind}.`,
        path,
        expected: `${itemType}[]`,
        actual: value.kind,
      },
    ];
  }
  return value.items.flatMap((item, index) =>
    validateType(item, itemType, registry, `${path}[${index}]`, stack, visited),
  );
}

function resolveShape(shape: ShapeInterface, registry: ShapeRegistry, stack: readonly string[]): ResolvedShape {
  const diagnostics: CoreShapeDiagnostic[] = [];
  if (stack.includes(shape.name)) {
    return {
      fields: [],
      indexers: [],
      diagnostics: [
        {
          code: 'shape-extends-cycle',
          message: `KERN core shape inheritance cycle: ${[...stack, shape.name].join(' -> ')}.`,
          interfaceName: shape.name,
        },
      ],
    };
  }
  const fields = new Map<string, ShapeField>();
  const indexers: ShapeIndexer[] = [];
  for (const baseName of shape.extendsNames) {
    const base = registry.interfaces.get(baseName);
    if (!base) {
      diagnostics.push({
        code: 'shape-extends-unknown',
        message: `KERN core shape '${shape.name}' extends unknown interface '${baseName}'.`,
        interfaceName: shape.name,
        expected: baseName,
      });
      continue;
    }
    const resolved = resolveShape(base, registry, [...stack, shape.name]);
    diagnostics.push(...resolved.diagnostics);
    for (const field of resolved.fields) {
      const inheritedField = { ...field, inheritedFrom: field.inheritedFrom ?? base.name };
      const existing = fields.get(field.name);
      if (existing && !sameShapeField(existing, inheritedField)) {
        diagnostics.push({
          code: 'shape-field-conflict',
          message: `KERN core shape '${shape.name}' has conflicting inherited field '${field.name}'.`,
          interfaceName: shape.name,
          fieldName: field.name,
          expected: existing.type,
          actual: field.type,
        });
        continue;
      }
      fields.set(field.name, inheritedField);
    }
    indexers.push(...resolved.indexers);
  }
  const ownFieldNames = new Set<string>();
  for (const field of shape.fields) {
    if (ownFieldNames.has(field.name)) {
      diagnostics.push({
        code: 'shape-field-duplicate',
        message: `KERN core shape '${shape.name}' declares duplicate field '${field.name}'.`,
        interfaceName: shape.name,
        fieldName: field.name,
        expected: field.type,
        actual: field.type,
      });
      continue;
    }
    ownFieldNames.add(field.name);
    const existing = fields.get(field.name);
    if (existing && (existing.type !== field.type || existing.optional !== field.optional)) {
      diagnostics.push({
        code: 'shape-field-conflict',
        message: `KERN core shape '${shape.name}' conflicts with inherited field '${field.name}'.`,
        interfaceName: shape.name,
        fieldName: field.name,
        expected: existing.type,
        actual: field.type,
      });
    }
    fields.set(field.name, field);
  }
  indexers.push(...shape.indexers);
  diagnostics.push(...indexers.flatMap((indexer) => validateIndexerShape(shape.name, indexer)));
  return { fields: Array.from(fields.values()), indexers, diagnostics };
}

function validateIndexerShape(interfaceName: string, indexer: ShapeIndexer): CoreShapeDiagnostic[] {
  if (indexer.keyType === 'string' || indexer.keyType === 'number') return [];
  return [
    {
      code: 'shape-indexer-key-unsupported',
      message: `KERN core shape '${interfaceName}' indexer key type '${indexer.keyType}' is not supported in v1.`,
      interfaceName,
      expected: 'string|number',
      actual: indexer.keyType,
    },
  ];
}

function shapeUnsupportedReasons(
  shape: ShapeInterface,
  resolved: ResolvedShape,
  registry: ShapeRegistry,
): readonly string[] {
  const reasons = new Set<string>();
  if (shape.generic) reasons.add('generic-interface');
  for (const diagnostic of resolved.diagnostics) reasons.add(diagnostic.code);
  for (const field of resolved.fields) {
    for (const issue of unsupportedTypeReasons(field.type, registry)) reasons.add(issue);
  }
  for (const indexer of resolved.indexers) {
    if (indexer.keyType !== 'string' && indexer.keyType !== 'number') reasons.add('shape-indexer-key-unsupported');
    for (const issue of unsupportedTypeReasons(indexer.type, registry)) reasons.add(issue);
  }
  return [...reasons].sort();
}

function unsupportedTypeReasons(rawType: string | undefined, registry: ShapeRegistry): string[] {
  const type = normalizeType(rawType);
  if (!type || type === 'any' || type === 'unknown' || isPrimitiveType(type)) return [];
  if (type.endsWith('[]')) return unsupportedTypeReasons(type.slice(0, -2), registry);
  const arrayMatch = /^Array<(.+)>$/.exec(type);
  if (arrayMatch) return unsupportedTypeReasons(arrayMatch[1], registry);
  if (isSimpleIdentifier(type)) return registry.interfaces.has(type) ? [] : [`unknown-type:${type}`];
  return [`unsupported-type:${type}`];
}

function interfaceNodes(rootOrNodes: IRNode | readonly IRNode[]): readonly IRNode[] {
  const found: IRNode[] = [];
  for (const node of topLevelNodes(rootOrNodes)) visitInterfaceNodes(node, found);
  return found;
}

function topLevelNodes(rootOrNodes: IRNode | readonly IRNode[]): readonly IRNode[] {
  return isIRNodeArray(rootOrNodes) ? rootOrNodes : [rootOrNodes];
}

function visitInterfaceNodes(node: IRNode, found: IRNode[]): void {
  if (node.type === 'interface') found.push(node);
  for (const child of node.children ?? []) visitInterfaceNodes(child, found);
}

function isIRNodeArray(value: IRNode | readonly IRNode[]): value is readonly IRNode[] {
  return Array.isArray(value);
}

function shapeField(node: IRNode): ShapeField {
  return {
    name: stringProp(node.props?.name) ?? '',
    type: stringProp(node.props?.type),
    optional: trueFlag(node.props?.optional),
  };
}

function shapeIndexer(node: IRNode): ShapeIndexer {
  return {
    keyName: stringProp(node.props?.keyName) ?? 'key',
    keyType: normalizeType(stringProp(node.props?.keyType)) ?? '',
    type: normalizeType(stringProp(node.props?.type)) ?? '',
    readonly: trueFlag(node.props?.readonly),
  };
}

function recordEntries(value: KernValue): Record<string, KernValue> | undefined {
  if (value.kind === 'record') return value.entries;
  if (value.kind === 'instance') return instanceEntries(value);
  return undefined;
}

function instanceEntries(value: KernInstanceValue): Record<string, KernValue> {
  return value.fields;
}

function sameShapeField(left: ShapeField, right: ShapeField): boolean {
  return left.type === right.type && left.optional === right.optional;
}

function keyMatchesIndexer(key: string, indexer: ShapeIndexer): boolean {
  if (indexer.keyType === 'string') return true;
  return indexer.keyType === 'number' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(key);
}

function fieldPath(path: string, field: string): string {
  return `${path}.${field}`;
}

function isPrimitiveType(type: string): type is KernValue['kind'] {
  return type === 'string' || type === 'number' || type === 'boolean' || type === 'null' || type === 'undefined';
}

function isSimpleIdentifier(type: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(type);
}

function normalizeType(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function splitExtends(value: unknown): string[] {
  const raw = stringProp(value);
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function extendsEdgeParticipatesInCycle(from: string, to: string, registry: ShapeRegistry): boolean {
  return reachesInterface(to, from, registry, new Set<string>());
}

function reachesInterface(current: string, target: string, registry: ShapeRegistry, seen: Set<string>): boolean {
  if (current === target) return true;
  if (seen.has(current)) return false;
  seen.add(current);
  const shape = registry.interfaces.get(current);
  if (!shape) return false;
  return shape.extendsNames.some((base) => reachesInterface(base, target, registry, seen));
}

function dedupeDiagnostics(diagnostics: readonly CoreShapeDiagnostic[]): CoreShapeDiagnostic[] {
  const seen = new Set<string>();
  const unique: CoreShapeDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.code,
      diagnostic.interfaceName,
      diagnostic.fieldName,
      diagnostic.path,
      diagnostic.expected,
      diagnostic.actual,
      diagnostic.message,
    ].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(diagnostic);
  }
  return unique;
}

function stringProp(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function trueFlag(value: unknown): boolean {
  return value === true || value === 'true';
}

function kUndefinedValue(): KernValue {
  return { kind: 'undefined' };
}

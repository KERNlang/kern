import {
  type CoreShapeDiagnostic,
  type CoreShapeValidationResult,
  collectShapeRegistry,
  dedupeDiagnostics,
  interfaceDuplicateDiagnostics,
  isPrimitiveType,
  isSimpleIdentifier,
  normalizeType,
  resolveShape,
  type ShapeIndexer,
  type ShapeInterface,
  type ShapeRegistry,
} from '../core-shape-facts.js';
import type { IRNode } from '../types.js';
import type { KernInstanceValue, KernValue } from './index.js';

export {
  type CoreShapeDiagnostic,
  type CoreShapeDiagnosticCode,
  type CoreShapeFacts,
  type CoreShapeFieldFact,
  type CoreShapeIndexerFact,
  type CoreShapeInterfaceFact,
  type CoreShapeValidationResult,
  collectCoreShapeFacts,
} from '../core-shape-facts.js';

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
  diagnostics.push(...interfaceDuplicateDiagnostics(registry, interfaceName));
  if (!shape) {
    diagnostics.push({
      code: 'shape-interface-not-found',
      message: `KERN core shape '${interfaceName}' is not declared.`,
      interfaceName,
    });
    return { passed: false, interfaceName, diagnostics };
  }
  diagnostics.push(...validateAgainstInterface(value, shape, registry, interfaceName, [], new WeakMap()));
  const uniqueDiagnostics = dedupeDiagnostics(diagnostics);
  return { passed: uniqueDiagnostics.length === 0, interfaceName, diagnostics: uniqueDiagnostics };
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
      const value = object[field.name] ?? kUndefinedValue();
      if (field.optional && value.kind === 'undefined') continue;
      diagnostics.push(...validateType(value, field.type, registry, fieldPath(path, field.name), stack, visited));
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
    return [
      ...interfaceDuplicateDiagnostics(registry, type),
      ...validateAgainstInterface(value, nested, registry, path, stack, visited),
    ];
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

function recordEntries(value: KernValue): Record<string, KernValue> | undefined {
  if (value.kind === 'record') return value.entries;
  if (value.kind === 'instance') return instanceEntries(value);
  return undefined;
}

function instanceEntries(value: KernInstanceValue): Record<string, KernValue> {
  return value.fields;
}

function keyMatchesIndexer(key: string, indexer: ShapeIndexer): boolean {
  if (indexer.keyType === 'string') return true;
  return indexer.keyType === 'number' && /^-?(?:0|[1-9]\d*)$/.test(key);
}

function fieldPath(path: string, field: string): string {
  return `${path}.${field}`;
}

function kUndefinedValue(): KernValue {
  return { kind: 'undefined' };
}

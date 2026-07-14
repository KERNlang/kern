import {
  isInspectableDecimalValue,
  isInspectableRunnerPortableValue,
  isOwnedDecimalValue,
  isOwnedInspectableRunnerPortableValue,
} from './portable-scalar-domain.js';
import {
  isOwnedEmptyExactSemanticArray,
  isOwnedExactSemanticMap,
  isOwnedExactSemanticSet,
  isOwnedSemanticComposite,
  isOwnedSemanticEnvironment,
  type SemanticEnv,
} from './semantic-env.js';

const MAP_ENTRIES = Map.prototype.entries;
const MAP_VALUES = Map.prototype.values;
const MAP_SIZE_GETTER = Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get;
const MAP_ITERATOR = Map.prototype[Symbol.iterator];

function hasStableMapPrototype(): boolean {
  const entries = Object.getOwnPropertyDescriptor(Map.prototype, 'entries');
  const values = Object.getOwnPropertyDescriptor(Map.prototype, 'values');
  const size = Object.getOwnPropertyDescriptor(Map.prototype, 'size');
  const iterator = Object.getOwnPropertyDescriptor(Map.prototype, Symbol.iterator);
  return (
    entries?.value === MAP_ENTRIES &&
    entries.get === undefined &&
    entries.set === undefined &&
    values?.value === MAP_VALUES &&
    values.get === undefined &&
    values.set === undefined &&
    size?.get === MAP_SIZE_GETTER &&
    size?.set === undefined &&
    iterator?.value === MAP_ITERATOR &&
    iterator.get === undefined &&
    iterator.set === undefined
  );
}

function mapEntries(value: Map<unknown, unknown>): IterableIterator<[unknown, unknown]> {
  return Reflect.apply(MAP_ENTRIES, value, []) as IterableIterator<[unknown, unknown]>;
}

function mapValues(value: Map<unknown, unknown>): IterableIterator<unknown> {
  return Reflect.apply(MAP_VALUES, value, []) as IterableIterator<unknown>;
}

function mapSize(value: Map<unknown, unknown>): number {
  if (!MAP_SIZE_GETTER) return Number.NaN;
  return Reflect.apply(MAP_SIZE_GETTER, value, []) as number;
}

function isEmptyPlainMap(value: unknown): boolean {
  return (
    value === undefined ||
    (value instanceof Map && Object.getPrototypeOf(value) === Map.prototype && mapSize(value) === 0)
  );
}

function hasBoundedBindingValue(value: unknown, seen: WeakSet<object>): boolean {
  if (isInspectableDecimalValue(value)) return true;
  if (typeof value === 'object' && value !== null && value instanceof Map) {
    if (seen.has(value)) return false;
    seen.add(value);
    if (Object.getPrototypeOf(value) !== Map.prototype || Reflect.ownKeys(value).length > 0) return false;
    for (const [key, item] of mapEntries(value)) {
      if (typeof key !== 'string' || !hasBoundedBindingValue(item, seen)) return false;
    }
    return true;
  }
  return isInspectableRunnerPortableValue(value, seen);
}

function hasOwnedBindingValue(value: unknown, seen: WeakSet<object>): boolean {
  if (isOwnedDecimalValue(value)) return isInspectableDecimalValue(value);
  if (typeof value !== 'object' || value === null) return isOwnedInspectableRunnerPortableValue(value, seen);
  if (!isOwnedSemanticComposite(value)) return false;
  if (value instanceof Map) {
    if (seen.has(value)) return false;
    seen.add(value);
    if (Object.getPrototypeOf(value) !== Map.prototype || Reflect.ownKeys(value).length > 0) return false;
    for (const [key, item] of mapEntries(value)) {
      if (typeof key !== 'string' || !hasOwnedBindingValue(item, seen)) return false;
    }
    return true;
  }
  return isOwnedInspectableRunnerPortableValue(value, seen);
}

function hasOwnedMachineMetadata(env: SemanticEnv): boolean {
  if (!isOwnedExactSemanticMap(env.bindings)) return false;
  if (env.runnerFunctions !== undefined && !isOwnedExactSemanticMap(env.runnerFunctions)) return false;
  if (env.runnerClasses !== undefined && !isOwnedExactSemanticMap(env.runnerClasses)) return false;
  if (env.runnerCallCache !== undefined && !isOwnedExactSemanticMap(env.runnerCallCache)) return false;
  if (
    !isOwnedExactSemanticSet(env.intProvenance) ||
    !isOwnedExactSemanticSet(env.freshArrayBindings) ||
    !isOwnedExactSemanticSet(env.pushBuiltFreshArrayBindings) ||
    !isOwnedExactSemanticSet(env.capturedArrayBindings) ||
    !isOwnedExactSemanticMap(env.recordArrayFields) ||
    !isOwnedEmptyExactSemanticArray(env.runnerCallStack)
  ) {
    return false;
  }
  for (const fields of mapValues(env.recordArrayFields)) {
    if (fields !== null && !isOwnedExactSemanticSet(fields)) return false;
  }
  return true;
}

export function hasBoundedRootEnvironment(env: SemanticEnv): boolean {
  if (!hasStableMapPrototype()) return false;
  if (
    env.parent !== undefined ||
    !isEmptyPlainMap(env.runnerFunctions) ||
    !isEmptyPlainMap(env.runnerClasses) ||
    env.runnerThis !== undefined ||
    env.runnerSuperClass !== undefined ||
    env.runnerProtectedClassInstances !== undefined ||
    !(env.bindings instanceof Map) ||
    Object.getPrototypeOf(env.bindings) !== Map.prototype
  ) {
    return false;
  }
  try {
    const seen = new WeakSet<object>();
    for (const [name, value] of mapEntries(env.bindings)) {
      if (typeof name !== 'string' || !hasBoundedBindingValue(value, seen)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function hasOwnedDirectRootEnvironment(env: SemanticEnv): boolean {
  if (!hasStableMapPrototype()) return false;
  if (!isOwnedSemanticEnvironment(env) || !hasOwnedMachineMetadata(env)) return false;
  if (
    env.parent !== undefined ||
    (env.runnerFunctions !== undefined && mapSize(env.runnerFunctions) !== 0) ||
    (env.runnerClasses !== undefined && mapSize(env.runnerClasses) !== 0) ||
    env.runnerThis !== undefined ||
    env.runnerSuperClass !== undefined ||
    env.runnerProtectedClassInstances !== undefined
  ) {
    return false;
  }
  try {
    const seen = new WeakSet<object>();
    for (const [name, value] of mapEntries(env.bindings)) {
      if (typeof name !== 'string' || !hasOwnedBindingValue(value, seen)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

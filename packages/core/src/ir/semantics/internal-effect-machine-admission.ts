import { CAUGHT_ERROR_TAG } from './caught-error.js';
import {
  isInspectableDecimalValue,
  isInspectableRunnerPortableValue,
  isOwnedDecimalValue,
  isOwnedInspectableRunnerPortableValue,
  isPortableRecordKey,
} from './portable-scalar-domain.js';
import {
  isOwnedEmptyExactSemanticArray,
  isOwnedExactSemanticMap,
  isOwnedExactSemanticSet,
  isOwnedSemanticComposite,
  isOwnedSemanticEnvironment,
  type SemanticEnv,
} from './semantic-env.js';
import { exactSemanticEnvironmentParent, isExactSemanticEnvironment } from './semantic-env-ownership.js';
import { UNAVAILABLE_CAUGHT_ERROR } from './try-runtime.js';

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
  if (value === UNAVAILABLE_CAUGHT_ERROR) return true;
  const caughtTag = Object.getOwnPropertyDescriptor(value, CAUGHT_ERROR_TAG);
  const caughtKind = Object.getOwnPropertyDescriptor(value, 'kind');
  const caughtMessage = Object.getOwnPropertyDescriptor(value, 'message');
  if (
    caughtTag &&
    'value' in caughtTag &&
    caughtTag.value === true &&
    caughtKind &&
    'value' in caughtKind &&
    typeof caughtKind.value === 'string' &&
    caughtMessage &&
    'value' in caughtMessage &&
    typeof caughtMessage.value === 'string'
  ) {
    return true;
  }
  const classMarker = Object.getOwnPropertyDescriptor(value, '__kernRunnerClassInstance');
  const className = Object.getOwnPropertyDescriptor(value, 'className');
  const classFields = Object.getOwnPropertyDescriptor(value, 'fields');
  if (
    classMarker &&
    'value' in classMarker &&
    classMarker.value === true &&
    className &&
    'value' in className &&
    typeof className.value === 'string' &&
    classFields &&
    'value' in classFields &&
    typeof classFields.value === 'object' &&
    classFields.value !== null
  ) {
    return (
      isOwnedSemanticComposite(classFields.value) && isOwnedInspectableRunnerPortableValue(classFields.value, seen)
    );
  }
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

function hasOwnedRuntimeArray(value: unknown[], seen: WeakSet<object>): boolean {
  if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const length = descriptors.length?.value;
  const keys = Object.keys(descriptors);
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) {
    return false;
  }
  for (const key of keys) {
    if (key === 'length') continue;
    const index = Number(key);
    const descriptor = descriptors[key];
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= length ||
      String(index) !== key ||
      !descriptor ||
      descriptor.get ||
      descriptor.set ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      !hasOwnedRuntimeBindingValue(descriptor.value, seen)
    ) {
      return false;
    }
  }
  return true;
}

function hasOwnedRuntimeRecord(value: object, seen: WeakSet<object>): boolean {
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (
      !isPortableRecordKey(key) ||
      descriptor.get ||
      descriptor.set ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      !hasOwnedRuntimeBindingValue(descriptor.value, seen)
    ) {
      return false;
    }
  }
  return true;
}

/** Runtime state may contain machine-created aliases and normalized capability graphs. */
function hasOwnedRuntimeBindingValue(value: unknown, seen: WeakSet<object>): boolean {
  if (isOwnedDecimalValue(value)) return isInspectableDecimalValue(value);
  if (typeof value !== 'object' || value === null) return isOwnedInspectableRunnerPortableValue(value);
  if (!isOwnedSemanticComposite(value) || seen.has(value)) return false;
  if (value === UNAVAILABLE_CAUGHT_ERROR) return true;
  const caughtTag = Object.getOwnPropertyDescriptor(value, CAUGHT_ERROR_TAG);
  const caughtKind = Object.getOwnPropertyDescriptor(value, 'kind');
  const caughtMessage = Object.getOwnPropertyDescriptor(value, 'message');
  if (
    caughtTag &&
    'value' in caughtTag &&
    caughtTag.value === true &&
    caughtKind &&
    'value' in caughtKind &&
    typeof caughtKind.value === 'string' &&
    caughtMessage &&
    'value' in caughtMessage &&
    typeof caughtMessage.value === 'string'
  ) {
    return true;
  }
  const classMarker = Object.getOwnPropertyDescriptor(value, '__kernRunnerClassInstance');
  const className = Object.getOwnPropertyDescriptor(value, 'className');
  const classFields = Object.getOwnPropertyDescriptor(value, 'fields');
  if (
    classMarker &&
    'value' in classMarker &&
    classMarker.value === true &&
    className &&
    'value' in className &&
    typeof className.value === 'string' &&
    classFields &&
    'value' in classFields &&
    typeof classFields.value === 'object' &&
    classFields.value !== null
  ) {
    seen.add(value);
    try {
      return hasOwnedRuntimeBindingValue(classFields.value, seen);
    } finally {
      seen.delete(value);
    }
  }
  seen.add(value);
  try {
    if (value instanceof Map) {
      if (Object.getPrototypeOf(value) !== Map.prototype || Reflect.ownKeys(value).length > 0) return false;
      for (const [key, item] of mapEntries(value)) {
        if (typeof key !== 'string' || !hasOwnedRuntimeBindingValue(item, seen)) return false;
      }
      return true;
    }
    if (Array.isArray(value)) return hasOwnedRuntimeArray(value, seen);
    return hasOwnedRuntimeRecord(value, seen);
  } finally {
    seen.delete(value);
  }
}

function hasOwnedMachineMetadata(env: SemanticEnv): boolean {
  if (!isExactSemanticEnvironment(env)) return false;
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
  if (Object.getPrototypeOf(env) !== Object.prototype) return false;
  const ownDataValue = (key: keyof SemanticEnv): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(env, key);
    if (!descriptor) return undefined;
    if (descriptor.get !== undefined || descriptor.set !== undefined || !('value' in descriptor)) {
      throw new Error('environment field must be an own data property');
    }
    return descriptor.value;
  };
  try {
    const parent = ownDataValue('parent');
    const runnerFunctions = ownDataValue('runnerFunctions');
    const runnerClasses = ownDataValue('runnerClasses');
    const runnerThis = ownDataValue('runnerThis');
    const runnerSuperClass = ownDataValue('runnerSuperClass');
    const runnerProtectedClassInstances = ownDataValue('runnerProtectedClassInstances');
    const bindings = ownDataValue('bindings');
    if (
      parent !== undefined ||
      !isEmptyPlainMap(runnerFunctions) ||
      !isEmptyPlainMap(runnerClasses) ||
      runnerThis !== undefined ||
      runnerSuperClass !== undefined ||
      runnerProtectedClassInstances !== undefined ||
      !(bindings instanceof Map) ||
      Object.getPrototypeOf(bindings) !== Map.prototype
    ) {
      return false;
    }
    const seen = new WeakSet<object>();
    for (const [name, value] of mapEntries(bindings)) {
      if (typeof name !== 'string' || !hasBoundedBindingValue(value, seen)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

const COHERENT_CHAIN_FIELDS = [
  'runnerFunctions',
  'runnerClasses',
  'runnerCallStack',
  'runnerCallCache',
  'runnerThis',
  'runnerSuperClass',
  'runnerProtectedClassInstances',
  'capabilities',
  'capabilityContext',
  'seed',
  'now',
] as const satisfies readonly (keyof SemanticEnv)[];

function hasCoherentParentFields(child: SemanticEnv, parent: SemanticEnv): boolean {
  return COHERENT_CHAIN_FIELDS.every((key) => Object.is(child[key], parent[key]));
}

function hasOwnedEnvironmentFrame(
  env: SemanticEnv,
  allowRunnerFunctions: boolean,
  allowRunnerClasses: boolean,
  allowRuntimeState: boolean,
): boolean {
  if (!isOwnedSemanticEnvironment(env) || !hasOwnedMachineMetadata(env)) return false;
  if (
    (!allowRunnerFunctions && env.runnerFunctions !== undefined && mapSize(env.runnerFunctions) !== 0) ||
    (!allowRunnerClasses && env.runnerClasses !== undefined && mapSize(env.runnerClasses) !== 0) ||
    env.runnerThis !== undefined ||
    env.runnerSuperClass !== undefined ||
    env.runnerProtectedClassInstances !== undefined
  ) {
    return false;
  }
  try {
    const seen = new WeakSet<object>();
    for (const [name, value] of mapEntries(env.bindings)) {
      if (
        typeof name !== 'string' ||
        !(allowRuntimeState ? hasOwnedRuntimeBindingValue(value, new WeakSet()) : hasOwnedBindingValue(value, seen))
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function hasOwnedDirectEnvironment(
  env: SemanticEnv,
  allowRunnerFunctions = false,
  allowRunnerClasses = false,
): boolean {
  if (!hasStableMapPrototype()) return false;
  return hasOwnedEnvironmentChain(env, allowRunnerFunctions, allowRunnerClasses, false);
}

export function hasStableOwnedEnvironmentChain(
  env: SemanticEnv,
  allowRunnerFunctions = false,
  allowRunnerClasses = false,
): boolean {
  return hasOwnedEnvironmentChain(env, allowRunnerFunctions, allowRunnerClasses, true);
}

function hasOwnedEnvironmentChain(
  env: SemanticEnv,
  allowRunnerFunctions: boolean,
  allowRunnerClasses: boolean,
  allowRuntimeState: boolean,
): boolean {
  if (typeof env !== 'object' || env === null) return false;
  const seen = new WeakSet<SemanticEnv>();
  let current: SemanticEnv | undefined = env;
  while (current) {
    if (
      seen.has(current) ||
      !hasOwnedEnvironmentFrame(current, allowRunnerFunctions, allowRunnerClasses, allowRuntimeState)
    ) {
      return false;
    }
    seen.add(current);
    const recordedParent = exactSemanticEnvironmentParent(current);
    if (!Object.is(current.parent, recordedParent)) return false;
    if (
      recordedParent &&
      (!isExactSemanticEnvironment(recordedParent) || !hasCoherentParentFields(current, recordedParent))
    ) {
      return false;
    }
    current = recordedParent;
  }
  return true;
}

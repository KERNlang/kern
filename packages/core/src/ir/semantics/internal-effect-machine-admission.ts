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

function isEmptyPlainMap(value: unknown): boolean {
  return (
    value === undefined || (value instanceof Map && Object.getPrototypeOf(value) === Map.prototype && value.size === 0)
  );
}

function hasBoundedBindingValue(value: unknown, seen: WeakSet<object>): boolean {
  if (isInspectableDecimalValue(value)) return true;
  if (typeof value === 'object' && value !== null && value instanceof Map) {
    if (seen.has(value)) return false;
    seen.add(value);
    if (Object.getPrototypeOf(value) !== Map.prototype || Reflect.ownKeys(value).length > 0) return false;
    for (const [key, item] of value) {
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
    for (const [key, item] of value) {
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
  for (const fields of env.recordArrayFields.values()) {
    if (fields !== null && !isOwnedExactSemanticSet(fields)) return false;
  }
  return true;
}

export function hasBoundedRootEnvironment(env: SemanticEnv): boolean {
  if (
    env.parent !== undefined ||
    !isEmptyPlainMap(env.runnerFunctions) ||
    !isEmptyPlainMap(env.runnerClasses) ||
    env.runnerThis !== undefined ||
    !(env.bindings instanceof Map) ||
    Object.getPrototypeOf(env.bindings) !== Map.prototype
  ) {
    return false;
  }
  try {
    const seen = new WeakSet<object>();
    for (const [name, value] of env.bindings) {
      if (typeof name !== 'string' || !hasBoundedBindingValue(value, seen)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function hasOwnedDirectRootEnvironment(env: SemanticEnv): boolean {
  if (!isOwnedSemanticEnvironment(env) || !hasOwnedMachineMetadata(env)) return false;
  if (
    env.parent !== undefined ||
    (env.runnerFunctions?.size ?? 0) !== 0 ||
    (env.runnerClasses?.size ?? 0) !== 0 ||
    env.runnerThis !== undefined
  ) {
    return false;
  }
  try {
    const seen = new WeakSet<object>();
    for (const [name, value] of env.bindings) {
      if (typeof name !== 'string' || !hasOwnedBindingValue(value, seen)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

import type { RunnerClassBinding, RunnerModuleScope } from './semantic-env.js';

interface RootScopeOwnership {
  readonly classes: RunnerModuleScope['classes'];
  readonly classEntries: ReadonlyMap<string, RunnerClassBinding>;
}

interface DataDescriptorSnapshot {
  readonly configurable: boolean;
  readonly enumerable: boolean;
  readonly value: unknown;
  readonly writable: boolean;
}

interface ObjectDescriptorSnapshot {
  readonly descriptors: ReadonlyMap<PropertyKey, DataDescriptorSnapshot>;
  readonly object: object;
  readonly prototype: object | null;
}

const rootScopes = new WeakMap<RunnerModuleScope['functions'], RootScopeOwnership>();
const linkerOwnedClassBindings = new WeakMap<RunnerClassBinding, readonly ObjectDescriptorSnapshot[]>();

function snapshotOwnedMetadata(binding: RunnerClassBinding): readonly ObjectDescriptorSnapshot[] {
  const snapshots: ObjectDescriptorSnapshot[] = [];
  const seen = new WeakSet<object>();
  const visit = (object: object): void => {
    if (seen.has(object) || object instanceof Map || object instanceof Set) return;
    seen.add(object);
    const current = Object.getOwnPropertyDescriptors(object);
    const descriptors = new Map<PropertyKey, DataDescriptorSnapshot>();
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = current[key as keyof typeof current];
      if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined || !('value' in descriptor)) {
        throw new Error('runner machine class metadata must contain only own data properties');
      }
      descriptors.set(key, {
        configurable: descriptor.configurable ?? false,
        enumerable: descriptor.enumerable ?? false,
        value: descriptor.value,
        writable: descriptor.writable ?? false,
      });
      const nested = descriptor.value;
      const skipsScopeGraph = object === binding && (key === 'module' || key === 'methods' || key === 'getters');
      if (!skipsScopeGraph && typeof nested === 'object' && nested !== null) visit(nested);
    }
    snapshots.push({ descriptors, object, prototype: Object.getPrototypeOf(object) });
  };
  visit(binding);
  return snapshots;
}

function metadataMatchesSnapshot(snapshots: readonly ObjectDescriptorSnapshot[]): boolean {
  for (const snapshot of snapshots) {
    if (Object.getPrototypeOf(snapshot.object) !== snapshot.prototype) return false;
    const current = Object.getOwnPropertyDescriptors(snapshot.object);
    const keys = Reflect.ownKeys(current);
    if (keys.length !== snapshot.descriptors.size) return false;
    for (const [key, expected] of snapshot.descriptors) {
      const descriptor = current[key as keyof typeof current];
      if (
        !descriptor ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        !('value' in descriptor) ||
        descriptor.configurable !== expected.configurable ||
        descriptor.enumerable !== expected.enumerable ||
        descriptor.writable !== expected.writable ||
        !Object.is(descriptor.value, expected.value)
      ) {
        return false;
      }
    }
  }
  return true;
}

/** Mark a linker-created class binding before it becomes visible to machine admission. */
export function markRunnerMachineClassBinding(binding: RunnerClassBinding): void {
  linkerOwnedClassBindings.set(binding, snapshotOwnedMetadata(binding));
}

/** Caller-supplied class records never satisfy this private linker fact. */
export function isRunnerMachineClassBinding(binding: RunnerClassBinding): boolean {
  const snapshot = linkerOwnedClassBindings.get(binding);
  return snapshot !== undefined && metadataMatchesSnapshot(snapshot);
}

/** Mark the linker-created root scope as eligible for private machine admission. */
export function markRunnerMachineRootScope(scope: RunnerModuleScope): void {
  rootScopes.set(scope.functions, { classes: scope.classes, classEntries: new Map(scope.classes) });
}

/** Raw caller-supplied function maps never satisfy this private ownership fact. */
export function isRunnerMachineRootScope(scope: RunnerModuleScope): boolean {
  return runnerMachineRootScope(scope.functions, scope.classes) !== undefined;
}

/** Resolve the exact linker-owned root scope, accepting an omitted empty class view. */
export function runnerMachineRootScope(
  functions: RunnerModuleScope['functions'],
  classes: RunnerModuleScope['classes'] | undefined,
): RunnerModuleScope | undefined {
  const owned = rootScopes.get(functions);
  if (!owned || (classes !== undefined && classes !== owned.classes)) return undefined;
  if (owned.classes.size !== owned.classEntries.size) return undefined;
  for (const [name, binding] of owned.classEntries) {
    if (owned.classes.get(name) !== binding) return undefined;
  }
  return { classes: owned.classes, functions };
}

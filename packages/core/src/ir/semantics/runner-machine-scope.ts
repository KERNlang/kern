import type { RunnerClassBinding, RunnerFunctionBinding, RunnerModuleScope } from './semantic-env.js';

interface RootScopeOwnership {
  readonly classes: RunnerModuleScope['classes'];
  readonly functionMetadata: ReadonlyMap<RunnerFunctionBinding, readonly ObjectDescriptorSnapshot[]>;
  readonly root: RunnerModuleScope;
  readonly scopes: readonly ScopeOwnership[];
}

interface ScopeOwnership {
  readonly classEntries: ReadonlyMap<string, RunnerClassBinding>;
  readonly functionEntries: ReadonlyMap<string, RunnerFunctionBinding>;
  readonly scope: RunnerModuleScope;
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

interface ClassBindingOwnership {
  readonly getterEntries: ReadonlyMap<string, unknown>;
  readonly methodEntries: ReadonlyMap<string, unknown>;
  readonly objects: readonly ObjectDescriptorSnapshot[];
}

const rootScopes = new WeakMap<RunnerModuleScope['functions'], RootScopeOwnership>();
const linkerOwnedClassBindings = new WeakMap<RunnerClassBinding, ClassBindingOwnership>();

function snapshotOwnedObjectGraph(
  root: object,
  skipNested: (object: object, key: PropertyKey) => boolean,
): readonly ObjectDescriptorSnapshot[] {
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
      if (!skipNested(object, key) && typeof nested === 'object' && nested !== null) visit(nested);
    }
    snapshots.push({ descriptors, object, prototype: Object.getPrototypeOf(object) });
  };
  visit(root);
  return snapshots;
}

function snapshotOwnedMetadata(binding: RunnerClassBinding): readonly ObjectDescriptorSnapshot[] {
  const snapshots = [
    ...snapshotOwnedObjectGraph(
      binding,
      (object, key) => object === binding && (key === 'module' || key === 'methods' || key === 'getters'),
    ),
  ];
  const seen = new Set(snapshots.map((snapshot) => snapshot.object));
  for (const member of binding.methods.values()) visit(member);
  for (const member of binding.getters.values()) visit(member);
  return snapshots;

  function visit(member: object): void {
    for (const snapshot of snapshotOwnedObjectGraph(member, () => false)) {
      if (!seen.has(snapshot.object)) {
        seen.add(snapshot.object);
        snapshots.push(snapshot);
      }
    }
  }
}

function snapshotOwnedFunctionMetadata(binding: RunnerFunctionBinding): readonly ObjectDescriptorSnapshot[] {
  return snapshotOwnedObjectGraph(binding, (object, key) => object === binding && key === 'module');
}

function mapMatchesSnapshot(current: ReadonlyMap<string, unknown>, expected: ReadonlyMap<string, unknown>): boolean {
  if (current.size !== expected.size) return false;
  for (const [key, value] of expected) if (current.get(key) !== value) return false;
  return true;
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
  linkerOwnedClassBindings.set(binding, {
    getterEntries: new Map(binding.getters),
    methodEntries: new Map(binding.methods),
    objects: snapshotOwnedMetadata(binding),
  });
}

/** Caller-supplied class records never satisfy this private linker fact. */
export function isRunnerMachineClassBinding(binding: RunnerClassBinding): boolean {
  const ownership = linkerOwnedClassBindings.get(binding);
  return (
    ownership !== undefined &&
    mapMatchesSnapshot(binding.methods, ownership.methodEntries) &&
    mapMatchesSnapshot(binding.getters, ownership.getterEntries) &&
    metadataMatchesSnapshot(ownership.objects)
  );
}

function scopeGraph(root: RunnerModuleScope): readonly RunnerModuleScope[] {
  const scopes: RunnerModuleScope[] = [];
  const seen = new Set<RunnerModuleScope>();
  const pending = [root];
  while (pending.length > 0) {
    const scope = pending.pop();
    if (!scope || seen.has(scope)) continue;
    seen.add(scope);
    scopes.push(scope);
    for (const binding of [...scope.functions.values(), ...scope.classes.values()]) {
      if (binding.module && !seen.has(binding.module)) pending.push(binding.module);
    }
  }
  return scopes;
}

function scopeOwnershipMatches(owned: ScopeOwnership, graphScopes: ReadonlySet<RunnerModuleScope>): boolean {
  const { scope } = owned;
  if (
    !mapMatchesSnapshot(scope.functions, owned.functionEntries) ||
    !mapMatchesSnapshot(scope.classes, owned.classEntries)
  ) {
    return false;
  }
  for (const binding of scope.functions.values()) {
    const defining = binding.module;
    if (!defining || !graphScopes.has(defining)) return false;
    if (defining.functions.get(binding.name) !== binding) return false;
  }
  for (const binding of scope.classes.values()) {
    if (!isRunnerMachineClassBinding(binding)) return false;
    const defining = binding.module;
    if (!defining || !graphScopes.has(defining)) return false;
    if (defining.classes.get(binding.name) !== binding) return false;
  }
  return true;
}

function rootScopeOwnership(
  functions: RunnerModuleScope['functions'],
  classes: RunnerModuleScope['classes'] | undefined,
): RootScopeOwnership | undefined {
  const owned = rootScopes.get(functions);
  if (!owned || (classes !== undefined && classes !== owned.classes)) return undefined;
  const graphScopes = new Set(owned.scopes.map((entry) => entry.scope));
  for (const [binding, metadata] of owned.functionMetadata) {
    if (!metadataMatchesSnapshot(metadata)) return undefined;
    if (!graphScopes.has(binding.module as RunnerModuleScope)) return undefined;
  }
  if (!owned.scopes.every((entry) => scopeOwnershipMatches(entry, graphScopes))) return undefined;
  return owned;
}

/** Mark the linker-created root scope as eligible for private machine admission. */
export function markRunnerMachineRootScope(scope: RunnerModuleScope): void {
  const scopes = scopeGraph(scope);
  const functions = new Set(scopes.flatMap((candidate) => [...candidate.functions.values()]));
  rootScopes.set(scope.functions, {
    classes: scope.classes,
    functionMetadata: new Map([...functions].map((binding) => [binding, snapshotOwnedFunctionMetadata(binding)])),
    root: scope,
    scopes: scopes.map((candidate) => ({
      classEntries: new Map(candidate.classes),
      functionEntries: new Map(candidate.functions),
      scope: candidate,
    })),
  });
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
  const owned = rootScopeOwnership(functions, classes);
  return owned ? owned.root : undefined;
}

export interface RunnerMachineScopeGraph {
  readonly root: RunnerModuleScope;
  readonly scopes: readonly RunnerModuleScope[];
}

export function sameRunnerMachineScopeGraph(
  left: RunnerMachineScopeGraph | undefined,
  right: RunnerMachineScopeGraph | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.root !== right.root || left.scopes.length !== right.scopes.length) return false;
  const rightScopes = new Set(right.scopes);
  return left.scopes.every((scope) => rightScopes.has(scope));
}

/** Resolve the exact unchanged linker-created scope graph behind a root view. */
export function runnerMachineScopeGraph(
  functions: RunnerModuleScope['functions'],
  classes: RunnerModuleScope['classes'] | undefined,
): RunnerMachineScopeGraph | undefined {
  const owned = rootScopeOwnership(functions, classes);
  return owned ? { root: owned.root, scopes: owned.scopes.map((entry) => entry.scope) } : undefined;
}

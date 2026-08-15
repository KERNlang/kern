import { copyInternalEffectMachineState } from './internal-effect-machine-helper-state.js';
import { runnerMachineScopeGraph, sameRunnerMachineScopeGraph } from './runner-machine-scope.js';
import {
  assertExactSemanticBindings,
  assertExactSemanticCloneValue,
  cloneSemanticBindings,
  cloneSemanticBindingValue,
  cloneSemanticRecordArrayFields,
  copyExactSemanticMap,
  copyExactSemanticSet,
} from './semantic-clone.js';
import type { RunnerClassInstanceValue, SemanticEnv } from './semantic-env-ownership.js';
import {
  deriveInternalExecutionContext,
  exactSemanticEnvironmentParent,
  inheritInternalExecutionContext,
  internalExecutionTraceRetention,
  markChildSemanticEnvironment,
  markRootSemanticEnvironment,
  snapshotExactSemanticEnvironment,
} from './semantic-env-ownership.js';
import type { InternalReferenceTraceRetention } from './trace.js';

export type {
  RunnerClassBinding,
  RunnerClassFieldBinding,
  RunnerClassInstanceValue,
  RunnerClassMemberBinding,
  RunnerFunctionBinding,
  RunnerModuleScope,
  SemanticEnv,
} from './semantic-env-ownership.js';
export type { InternalReferenceTraceRetention } from './trace.js';
export function bindInternalReferenceTraceRetention(
  env: SemanticEnv,
  retention: InternalReferenceTraceRetention,
): SemanticEnv {
  const initialEnv = snapshotExactSemanticEnvironment(env);
  if (!initialEnv || exactSemanticEnvironmentParent(env) !== undefined) {
    throw new TypeError('portable: isolated legacy execution requires an exact root environment');
  }
  const initialScopeGraph = initialEnv.runnerFunctions
    ? runnerMachineScopeGraph(initialEnv.runnerFunctions, initialEnv.runnerClasses)
    : undefined;
  const policy = {
    allowedRunnerModules: new Set(initialScopeGraph?.scopes ?? []),
    requireCanonicalSourceDescriptors: true,
  };
  const memo = copyExactSemanticMap<object, unknown>();
  const bindings = cloneSemanticBindings(initialEnv.bindings, memo, ownSemanticComposite, policy);
  const runnerThis =
    initialEnv.runnerThis === undefined
      ? undefined
      : (cloneSemanticBindingValue(
          initialEnv.runnerThis,
          memo,
          ownSemanticComposite,
          policy,
        ) as RunnerClassInstanceValue);
  const seen = new WeakSet<object>();
  assertExactSemanticBindings(bindings, seen, policy);
  if (runnerThis !== undefined) assertExactSemanticCloneValue(runnerThis, seen, policy);
  const finalEnv = snapshotExactSemanticEnvironment(env);
  if (!finalEnv) throw new TypeError('portable: isolated legacy execution requires an exact root environment');
  const finalScopeGraph = finalEnv.runnerFunctions
    ? runnerMachineScopeGraph(finalEnv.runnerFunctions, finalEnv.runnerClasses)
    : undefined;
  if (!sameRunnerMachineScopeGraph(initialScopeGraph, finalScopeGraph)) {
    throw new TypeError('portable: isolated runner module graph changed during cloning');
  }
  const executionEnv = constructEnv(
    {
      ...finalEnv,
      bindings,
      runnerCallCache: new Map(),
      runnerCallStack: [],
      runnerThis,
    },
    undefined,
    true,
  );
  deriveInternalExecutionContext(env, executionEnv, retention);
  return executionEnv;
}
export function internalReferenceTraceRetentionForEnv(env: SemanticEnv): InternalReferenceTraceRetention {
  return internalExecutionTraceRetention(env) ?? 'full';
}
export function inheritInternalReferenceTraceRetention(source: SemanticEnv, target: SemanticEnv): SemanticEnv {
  inheritInternalExecutionContext(source, target);
  return target;
}
const ownedSemanticComposites = new WeakSet<object>();
const ownedSemanticEnvironments = new WeakSet<object>();
function ownSemanticComposite<T extends object>(value: T): T {
  ownedSemanticComposites.add(value);
  return value;
}
function ownSemanticValueGraph(value: unknown, seen: WeakSet<object> = new WeakSet()): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value) && prototype === Array.prototype) {
    ownSemanticComposite(value);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (key !== 'length' && descriptor && !descriptor.get && !descriptor.set && 'value' in descriptor) {
        ownSemanticValueGraph(descriptor.value, seen);
      }
    }
    return;
  }
  if (value instanceof Map && prototype === Map.prototype) {
    ownSemanticComposite(value);
    for (const [key, item] of value) {
      ownSemanticValueGraph(key, seen);
      ownSemanticValueGraph(item, seen);
    }
    return;
  }
  if (value instanceof Set && prototype === Set.prototype) {
    ownSemanticComposite(value);
    for (const item of value) ownSemanticValueGraph(item, seen);
    return;
  }
  if (prototype === Object.prototype || prototype === null) {
    ownSemanticComposite(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (descriptor && !descriptor.get && !descriptor.set && 'value' in descriptor) {
        ownSemanticValueGraph(descriptor.value, seen);
      }
    }
  }
}
function ownSemanticEnvironment<T extends SemanticEnv>(env: T): T {
  ownedSemanticEnvironments.add(env);
  return env;
}

export function isOwnedSemanticComposite(value: unknown): value is object {
  return typeof value === 'object' && value !== null && ownedSemanticComposites.has(value);
}
export function isOwnedSemanticEnvironment(value: unknown): value is SemanticEnv {
  return typeof value === 'object' && value !== null && ownedSemanticEnvironments.has(value);
}

export function isOwnedExactSemanticMap(value: unknown): value is Map<unknown, unknown> {
  return (
    isOwnedSemanticComposite(value) &&
    value instanceof Map &&
    Object.getPrototypeOf(value) === Map.prototype &&
    Reflect.ownKeys(value).length === 0
  );
}
export function isOwnedExactSemanticSet(value: unknown): value is Set<unknown> {
  return (
    isOwnedSemanticComposite(value) &&
    value instanceof Set &&
    Object.getPrototypeOf(value) === Set.prototype &&
    Reflect.ownKeys(value).length === 0
  );
}
export function isOwnedEmptyExactSemanticArray(value: unknown): value is unknown[] {
  if (!isOwnedSemanticComposite(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  return (
    keys.length === 1 &&
    keys[0] === 'length' &&
    length?.value === 0 &&
    length.writable === true &&
    length.enumerable === false &&
    length.configurable === false
  );
}
function ownPlainMap<T>(value: Map<string, T> | undefined): Map<string, T> | undefined {
  if (value instanceof Map && Object.getPrototypeOf(value) === Map.prototype) ownSemanticComposite(value);
  return value;
}

function constructEnv(
  overrides: Partial<SemanticEnv>,
  parent: SemanticEnv | undefined,
  bindingsAreOwned = false,
  preserveRuntimeReferences = false,
): SemanticEnv {
  const memo = copyExactSemanticMap<object, unknown>();
  const bindings = overrides.bindings
    ? bindingsAreOwned
      ? overrides.bindings
      : cloneSemanticBindings(overrides.bindings, memo, ownSemanticComposite)
    : ownSemanticComposite(new Map<string, unknown>());
  const env = ownSemanticEnvironment({
    bindings,
    intProvenance: ownSemanticComposite(copyExactSemanticSet(overrides.intProvenance)),
    freshArrayBindings: ownSemanticComposite(copyExactSemanticSet(overrides.freshArrayBindings)),
    pushBuiltFreshArrayBindings: overrides.pushBuiltFreshArrayBindings
      ? ownSemanticComposite(copyExactSemanticSet(overrides.pushBuiltFreshArrayBindings))
      : ownSemanticComposite(new Set()),
    capturedArrayBindings: ownSemanticComposite(copyExactSemanticSet(overrides.capturedArrayBindings)),
    recordArrayFields: overrides.recordArrayFields
      ? cloneSemanticRecordArrayFields(overrides.recordArrayFields, ownSemanticComposite)
      : ownSemanticComposite(new Map()),
    runnerFunctions: ownPlainMap(overrides.runnerFunctions),
    runnerClasses: ownPlainMap(overrides.runnerClasses),
    runnerCallStack: preserveRuntimeReferences
      ? overrides.runnerCallStack
      : ownSemanticComposite(overrides.runnerCallStack ? [...overrides.runnerCallStack] : []),
    runnerCallCache: ownPlainMap(overrides.runnerCallCache),
    runnerThis: overrides.runnerThis,
    runnerSuperClass: overrides.runnerSuperClass,
    runnerProtectedClassInstances: overrides.runnerProtectedClassInstances,
    capabilities: overrides.capabilities,
    capabilityContext: preserveRuntimeReferences
      ? overrides.capabilityContext
      : overrides.capabilityContext
        ? { ...overrides.capabilityContext }
        : {},
    intIndexCtx: overrides.intIndexCtx,
    parent,
    repeatableLoopBody: overrides.repeatableLoopBody ?? false,
    seed: overrides.seed ?? 0,
    now: overrides.now ?? 0,
  });
  if (parent) markChildSemanticEnvironment(env, parent);
  else markRootSemanticEnvironment(env);
  return env;
}

/** Build a fresh external root with deterministic defaults and cloned bindings. */
export function makeEnv(overrides: Partial<SemanticEnv> = {}): SemanticEnv {
  return constructEnv(overrides, undefined);
}

/** Build an execution frame and propagate private state from the active caller. */
export function makeExecutionFrame(source: SemanticEnv, overrides: Partial<SemanticEnv> = {}): SemanticEnv {
  const target = constructEnv(overrides, undefined);
  inheritInternalExecutionContext(source, target);
  copyInternalEffectMachineState(source, target);
  return target;
}

export function childEnv(parent: SemanticEnv): SemanticEnv {
  const child = constructEnv(
    {
      runnerFunctions: parent.runnerFunctions,
      runnerClasses: parent.runnerClasses,
      runnerCallStack: parent.runnerCallStack,
      runnerCallCache: parent.runnerCallCache,
      runnerThis: parent.runnerThis,
      runnerSuperClass: parent.runnerSuperClass,
      runnerProtectedClassInstances: parent.runnerProtectedClassInstances,
      capabilities: parent.capabilities,
      capabilityContext: parent.capabilityContext,
      seed: parent.seed,
      now: parent.now,
    },
    parent,
    false,
    true,
  );
  inheritInternalExecutionContext(parent, child);
  copyInternalEffectMachineState(parent, child);
  return child;
}

function declaringScope(env: SemanticEnv, name: string): SemanticEnv | undefined {
  for (let current: SemanticEnv | undefined = env; current; current = current.parent) {
    if (current.bindings.has(name)) return current;
  }
  return undefined;
}

export function hasBinding(env: SemanticEnv, name: string): boolean {
  return declaringScope(env, name) !== undefined;
}

export function hasOwnBinding(env: SemanticEnv, name: string): boolean {
  return env.bindings.has(name);
}

export function getBinding(env: SemanticEnv, name: string): unknown {
  return declaringScope(env, name)?.bindings.get(name);
}

export function defineBinding(env: SemanticEnv, name: string, value: unknown): void {
  ownSemanticValueGraph(value);
  env.bindings.set(name, value);
  clearBindingProvenance(env, name);
}

export function defineFreshArrayBinding(env: SemanticEnv, name: string, value: readonly unknown[]): void {
  ownSemanticValueGraph(value);
  env.bindings.set(name, value);
  env.intProvenance?.delete(name);
  (env.freshArrayBindings ??= ownSemanticComposite(new Set())).add(name);
  if (value.length === 0) (env.pushBuiltFreshArrayBindings ??= ownSemanticComposite(new Set())).add(name);
  else env.pushBuiltFreshArrayBindings?.delete(name);
  env.capturedArrayBindings?.delete(name);
  env.recordArrayFields?.set(name, null);
}

export function defineCapturedArrayBinding(env: SemanticEnv, name: string, value: readonly unknown[]): void {
  ownSemanticValueGraph(value);
  env.bindings.set(name, value);
  env.intProvenance?.delete(name);
  env.freshArrayBindings?.delete(name);
  env.pushBuiltFreshArrayBindings?.delete(name);
  (env.capturedArrayBindings ??= ownSemanticComposite(new Set())).add(name);
  env.recordArrayFields?.set(name, null);
}

export function defineArrayAliasBinding(
  env: SemanticEnv,
  targetName: string,
  sourceName: string,
  value: unknown,
): boolean {
  if (!Array.isArray(value)) return false;
  const sourceScope = declaringScope(env, sourceName);
  const aliasesCapturedArray = sourceScope?.capturedArrayBindings?.has(sourceName) ?? false;
  sourceScope?.freshArrayBindings?.delete(sourceName);
  sourceScope?.pushBuiltFreshArrayBindings?.delete(sourceName);
  if (aliasesCapturedArray) defineCapturedArrayBinding(env, targetName, value);
  else defineBinding(env, targetName, value);
  return true;
}

export function defineIntBinding(env: SemanticEnv, name: string, value: unknown): void {
  env.bindings.set(name, value);
  (env.intProvenance ??= ownSemanticComposite(new Set())).add(name);
  env.freshArrayBindings?.delete(name);
  env.pushBuiltFreshArrayBindings?.delete(name);
  env.capturedArrayBindings?.delete(name);
  env.recordArrayFields?.set(name, null);
}

export function defineRecordBinding(env: SemanticEnv, name: string, value: unknown, arrayFields: Set<string>): void {
  ownSemanticValueGraph(value);
  env.bindings.set(name, value);
  env.intProvenance?.delete(name);
  env.freshArrayBindings?.delete(name);
  env.pushBuiltFreshArrayBindings?.delete(name);
  env.capturedArrayBindings?.delete(name);
  (env.recordArrayFields ??= ownSemanticComposite(new Map())).set(name, ownSemanticComposite(new Set(arrayFields)));
}

export function assignBinding(env: SemanticEnv, name: string, value: unknown): void {
  const scope = declaringScope(env, name) ?? env;
  ownSemanticValueGraph(value);
  scope.bindings.set(name, value);
  clearBindingProvenance(scope, name);
}

export function assignOwnedExactScalarMapBinding(
  env: SemanticEnv,
  name: string,
  value: ReadonlyMap<string, string | number | boolean | null>,
): void {
  const scope = declaringScope(env, name) ?? env;
  if (scope.bindings.get(name) !== value || !isOwnedExactSemanticMap(value)) {
    throw new Error(`portable: Map.set requires the exact owned map binding "${name}"`);
  }
  // The effect-machine Map.set path admits only string keys and portable
  // scalar values. The exact map identity is already machine-owned, so a
  // whole-graph ownership walk here would rescan its growing prefix.
  scope.bindings.set(name, value);
  clearBindingProvenance(scope, name);
}

export function assignPushBuiltFreshArrayBinding(env: SemanticEnv, name: string, value: readonly unknown[]): void {
  // The freshness-preserving push path only appends portable scalars to an
  // already-owned array. Own the newly materialized array without rescanning
  // its entire prefix on every push.
  ownSemanticComposite(value);
  const scope = declaringScope(env, name) ?? env;
  scope.bindings.set(name, value);
  scope.intProvenance?.delete(name);
  (scope.freshArrayBindings ??= ownSemanticComposite(new Set())).add(name);
  (scope.pushBuiltFreshArrayBindings ??= ownSemanticComposite(new Set())).add(name);
  scope.capturedArrayBindings?.delete(name);
  scope.recordArrayFields?.set(name, null);
}

export function isIntProvenanced(env: SemanticEnv, name: string): boolean {
  return declaringScope(env, name)?.intProvenance?.has(name) ?? false;
}

export function isFreshArrayBinding(env: SemanticEnv, name: string): boolean {
  return declaringScope(env, name)?.freshArrayBindings?.has(name) ?? false;
}

export function isPushBuiltFreshArrayBinding(env: SemanticEnv, name: string): boolean {
  return declaringScope(env, name)?.pushBuiltFreshArrayBindings?.has(name) ?? false;
}

export function isCapturedArrayBinding(env: SemanticEnv, name: string): boolean {
  return declaringScope(env, name)?.capturedArrayBindings?.has(name) ?? false;
}

export function recordArrayFieldsForBinding(env: SemanticEnv, name: string): ReadonlySet<string> | undefined {
  return declaringScope(env, name)?.recordArrayFields?.get(name) ?? undefined;
}

export function captureFreshArrayBinding(env: SemanticEnv, name: string): void {
  const scope = declaringScope(env, name);
  if (!scope?.freshArrayBindings?.has(name)) return;
  scope.freshArrayBindings.delete(name);
  scope.pushBuiltFreshArrayBindings?.delete(name);
  (scope.capturedArrayBindings ??= ownSemanticComposite(new Set())).add(name);
}

export function invalidateFreshArrayBinding(env: SemanticEnv, name: string): void {
  const scope = declaringScope(env, name);
  scope?.freshArrayBindings?.delete(name);
  scope?.pushBuiltFreshArrayBindings?.delete(name);
}

export function markRepeatableLoopBody(env: SemanticEnv): void {
  env.repeatableLoopBody = true;
}

export function capturesFreshArrayAcrossRepeatableLoop(env: SemanticEnv, name: string): boolean {
  let crossedRepeatableLoop = false;
  for (let current: SemanticEnv | undefined = env; current; current = current.parent) {
    if (current.bindings.has(name)) return crossedRepeatableLoop;
    if (current.repeatableLoopBody === true) crossedRepeatableLoop = true;
  }
  return false;
}

export function deleteOwnBinding(env: SemanticEnv, name: string): void {
  env.bindings.delete(name);
  env.freshArrayBindings?.delete(name);
  env.pushBuiltFreshArrayBindings?.delete(name);
  env.capturedArrayBindings?.delete(name);
  env.recordArrayFields?.delete(name);
}

function clearBindingProvenance(env: SemanticEnv, name: string): void {
  env.intProvenance?.delete(name);
  env.freshArrayBindings?.delete(name);
  env.pushBuiltFreshArrayBindings?.delete(name);
  env.capturedArrayBindings?.delete(name);
  env.recordArrayFields?.set(name, null);
}

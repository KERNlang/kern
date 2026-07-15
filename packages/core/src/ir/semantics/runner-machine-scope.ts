import type { RunnerClassBinding, RunnerModuleScope } from './semantic-env.js';

interface RootScopeOwnership {
  readonly classes: RunnerModuleScope['classes'];
  readonly classEntries: ReadonlyMap<string, RunnerModuleScope['classes'] extends Map<string, infer T> ? T : never>;
}

const rootScopes = new WeakMap<RunnerModuleScope['functions'], RootScopeOwnership>();
const linkerOwnedClassBindings = new WeakSet<RunnerClassBinding>();

/** Mark a linker-created class binding before it becomes visible to machine admission. */
export function markRunnerMachineClassBinding(binding: RunnerClassBinding): void {
  linkerOwnedClassBindings.add(binding);
}

/** Caller-supplied class records never satisfy this private linker fact. */
export function isRunnerMachineClassBinding(binding: RunnerClassBinding): boolean {
  return linkerOwnedClassBindings.has(binding);
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

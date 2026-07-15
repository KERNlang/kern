import type { RunnerModuleScope } from './semantic-env.js';

const rootClassMaps = new WeakMap<RunnerModuleScope['functions'], RunnerModuleScope['classes']>();

/** Mark the linker-created root scope as eligible for private machine admission. */
export function markRunnerMachineRootScope(scope: RunnerModuleScope): void {
  rootClassMaps.set(scope.functions, scope.classes);
}

/** Raw caller-supplied function maps never satisfy this private ownership fact. */
export function isRunnerMachineRootScope(scope: RunnerModuleScope): boolean {
  return rootClassMaps.get(scope.functions) === scope.classes;
}

/** Resolve the exact linker-owned root scope, accepting an omitted empty class view. */
export function runnerMachineRootScope(
  functions: RunnerModuleScope['functions'],
  classes: RunnerModuleScope['classes'] | undefined,
): RunnerModuleScope | undefined {
  const rootClasses = rootClassMaps.get(functions);
  if (!rootClasses || (classes !== undefined && classes !== rootClasses)) return undefined;
  return { classes: rootClasses, functions };
}

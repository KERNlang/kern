import { markRunnerMachineClassBinding, markRunnerMachineRootScope } from '../src/ir/semantics/runner-machine-scope.js';
import {
  makeEnv,
  type RunnerClassBinding,
  type RunnerClassMemberBinding,
  type RunnerModuleScope,
  type SemanticEnv,
} from '../src/ir/semantics/semantic-env.js';
import type { IRNode } from '../src/types.js';

export function classMember(
  ownerClass: string,
  name: string,
  params: readonly string[],
  body: readonly IRNode[],
): RunnerClassMemberBinding {
  return { body, name, ownerClass, params };
}

export function preSuperEnv(
  bindings: readonly Omit<RunnerClassBinding, 'module'>[],
  capabilities?: SemanticEnv['capabilities'],
): SemanticEnv {
  const functions: RunnerModuleScope['functions'] = new Map();
  const classes: RunnerModuleScope['classes'] = new Map();
  const scope: RunnerModuleScope = { classes, functions };
  for (const binding of bindings) {
    const cls: RunnerClassBinding = { ...binding, module: scope };
    markRunnerMachineClassBinding(cls);
    classes.set(cls.name, cls);
  }
  markRunnerMachineRootScope(scope);
  return makeEnv({
    capabilities,
    runnerCallCache: new Map(),
    runnerCallStack: [],
    runnerClasses: classes,
    runnerFunctions: functions,
  });
}

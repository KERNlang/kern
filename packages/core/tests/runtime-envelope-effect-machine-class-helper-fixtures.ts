import { markRunnerMachineClassBinding, markRunnerMachineRootScope } from '../src/ir/semantics/runner-machine-scope.js';
import {
  makeEnv,
  type RunnerClassBinding,
  type RunnerClassMemberBinding,
  type RunnerFunctionBinding,
  type RunnerModuleScope,
  type SemanticEnv,
} from '../src/ir/semantics/semantic-env.js';
import type { IRNode } from '../src/types.js';

export function member(
  ownerClass: string,
  name: string,
  body: readonly IRNode[],
  params: readonly string[] = [],
): RunnerClassMemberBinding {
  return { body, name, ownerClass, params };
}

interface ClassHelperEnvOptions {
  readonly capabilities?: SemanticEnv['capabilities'];
  readonly classes: readonly Omit<RunnerClassBinding, 'module'>[];
  readonly helpers: readonly Omit<RunnerFunctionBinding, 'module'>[];
}

export function classHelperEnv(options: ClassHelperEnvOptions): SemanticEnv {
  const functions: RunnerModuleScope['functions'] = new Map();
  const classes: RunnerModuleScope['classes'] = new Map();
  const scope: RunnerModuleScope = { classes, functions };
  for (const helper of options.helpers) functions.set(helper.name, { ...helper, module: scope });
  for (const raw of options.classes) {
    const cls: RunnerClassBinding = { ...raw, module: scope };
    markRunnerMachineClassBinding(cls);
    classes.set(cls.name, cls);
  }
  markRunnerMachineRootScope(scope);
  return makeEnv({
    capabilities: options.capabilities,
    runnerCallCache: new Map(),
    runnerCallStack: [],
    runnerClasses: classes,
    runnerFunctions: functions,
  });
}

export function helper(
  name: string,
  params: readonly string[],
  body: readonly IRNode[],
  returns: unknown = 'number',
): Omit<RunnerFunctionBinding, 'module'> {
  return { body, name, params, returns };
}

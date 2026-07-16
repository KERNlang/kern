import type { IRNode } from '../../types.js';
import { hasOwnedDirectEnvironment } from './internal-effect-machine-admission.js';
import {
  internalMachineClassGraphHasClasses,
  internalMachineClassGraphRequiresIterationBudget,
} from './internal-effect-machine-class-graph.js';
import {
  internalMachineHelperGraphHasReachableFunctions,
  internalMachineHelperGraphRequiresIterationBudget,
} from './internal-effect-machine-helper-graph.js';
import {
  assertInternalEffectMachineHelperStructureSupported,
  assertInternalEffectMachineRootStructureSupported,
  assertInternalEffectMachineStructureSupported,
  isInternalEffectMachineDirectEligible,
} from './internal-effect-machine-structure.js';
import { lambdaRequiresIterationBudget } from './lambda-preflight.js';
import type { SemanticEnv } from './semantic-env.js';

function requiresIterationBudget(nodes: readonly IRNode[], env: SemanticEnv): boolean {
  const pending = [...nodes];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (
      node.type === 'each' ||
      node.type === 'for' ||
      node.type === 'while' ||
      (node.type === 'lambda' && lambdaRequiresIterationBudget(node))
    ) {
      return true;
    }
    for (const child of node.children ?? []) pending.push(child);
  }
  return (
    internalMachineHelperGraphRequiresIterationBudget(nodes, env) ||
    internalMachineClassGraphRequiresIterationBudget(env)
  );
}

export function sourceRunnerMachineAdmission(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  iterationBudget: number | undefined,
): boolean {
  if (!hasOwnedDirectEnvironment(env, true, true)) return false;
  if (requiresIterationBudget(nodes, env) && iterationBudget === undefined) return false;
  if (!isInternalEffectMachineDirectEligible(nodes, env)) return false;
  if (internalMachineHelperGraphHasReachableFunctions(nodes, env)) {
    try {
      assertInternalEffectMachineHelperStructureSupported(nodes, env);
    } catch {
      return false;
    }
    assertInternalEffectMachineRootStructureSupported(nodes, env);
  } else if (internalMachineClassGraphHasClasses(env)) {
    try {
      assertInternalEffectMachineStructureSupported(nodes, env);
    } catch {
      return false;
    }
  } else assertInternalEffectMachineStructureSupported(nodes, env);
  return true;
}

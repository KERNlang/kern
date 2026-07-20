import type { IRNode } from '../../types.js';
import { isInternalEffectMachineEach } from './each-runtime.js';
import { hasBoundedRootEnvironment, hasOwnedDirectEnvironment } from './internal-effect-machine-admission.js';
import { internalMachineClassGraphClaims } from './internal-effect-machine-class-graph.js';
import { internalMachineHelperGraphClaims } from './internal-effect-machine-helper-graph.js';
import { hasNoBody, isUnifiedNodeType } from './internal-effect-machine-types.js';
import type { SemanticEnv } from './semantic-env.js';

function rootSequenceClaimsMachine(nodes: readonly IRNode[]): boolean {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (['branch', 'for', 'lambda', 'try', 'while'].includes(node.type)) continue;
    if (node.type === 'each') {
      if (!isInternalEffectMachineEach(node)) return false;
    } else if (node.type === 'if') {
      if (nodes[index + 1]?.type === 'else') index += 1;
    } else if (
      node.type === 'break' ||
      node.type === 'continue' ||
      node.type === 'else' ||
      !isUnifiedNodeType(node.type) ||
      !hasNoBody(node)
    ) {
      return false;
    }
  }
  return true;
}

export const isInternalEffectMachineEligible = (nodes: readonly IRNode[], env: SemanticEnv): boolean =>
  rootSequenceClaimsMachine(nodes) &&
  (hasBoundedRootEnvironment(env) ||
    (hasOwnedDirectEnvironment(env, true, true) &&
      internalMachineHelperGraphClaims(nodes, env) &&
      internalMachineClassGraphClaims(nodes, env)));

export const isInternalEffectMachineDirectEligible = (nodes: readonly IRNode[], env: SemanticEnv): boolean =>
  hasOwnedDirectEnvironment(env, true, true) &&
  internalMachineHelperGraphClaims(nodes, env) &&
  internalMachineClassGraphClaims(nodes, env) &&
  rootSequenceClaimsMachine(nodes);

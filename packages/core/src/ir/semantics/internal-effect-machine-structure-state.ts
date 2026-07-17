import type { IRNode } from '../../types.js';
import { assertInternalMachineClassGraph } from './internal-effect-machine-class-graph.js';
import { assertInternalMachineHelperGraph } from './internal-effect-machine-helper-graph.js';
import {
  bindInternalEffectMachineState,
  internalEffectMachineStateForEnv,
} from './internal-effect-machine-helper-state.js';
import type { SemanticEnv } from './semantic-env.js';

export function withInternalEffectMachineStructureState<T>(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  advance: () => T,
): T {
  if (internalEffectMachineStateForEnv(env)) return advance();
  const classes = assertInternalMachineClassGraph(env).classes;
  const helperGraph = assertInternalMachineHelperGraph(nodes, env, classes);
  const restore = bindInternalEffectMachineState(env, {
    classRegistry: classes,
    helperRegistry: helperGraph.functions,
    resumableHelperNames: helperGraph.resumableHelperNames,
    remainingIterations: undefined,
  });
  try {
    return advance();
  } finally {
    restore();
  }
}

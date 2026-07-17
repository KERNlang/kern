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
  const classGraph = assertInternalMachineClassGraph(env);
  const classes = classGraph.classes;
  const helperGraph = assertInternalMachineHelperGraph(nodes, env, classGraph);
  const restore = bindInternalEffectMachineState(env, {
    classRegistry: classes,
    helperRegistry: helperGraph.functions,
    moduleGraph: classGraph.moduleGraph,
    resumableHelpers: helperGraph.resumableHelpers,
    resumableHelperNames: helperGraph.resumableHelperNames,
    remainingIterations: undefined,
  });
  try {
    return advance();
  } finally {
    restore();
  }
}

import type { IRNode } from '../../types.js';
import { assertInternalMachineHelperGraph } from './internal-effect-machine-helper-graph.js';
import { internalEffectMachineStateForEnv } from './internal-effect-machine-helper-state.js';
import { makeExecutionFrame, type SemanticEnv } from './semantic-env.js';
import type { CompletionKind } from './trace.js';

type HelperBodyAnalyzer = (
  nodes: readonly IRNode[],
  loopDepth: number,
  env: SemanticEnv,
  unstableBindings: Set<string>,
  evaluateControls: boolean,
) => Set<CompletionKind>;

export function assertInternalMachineHelperPreflight(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  analyze: HelperBodyAnalyzer,
): void {
  const activeState = internalEffectMachineStateForEnv(env);
  const moduleGraph = activeState?.moduleGraph;
  const graph = assertInternalMachineHelperGraph(
    nodes,
    env,
    moduleGraph ? { classes: moduleGraph.root.classes, moduleGraph, requiresIterationBudget: false } : undefined,
  );
  for (const fn of graph.reachableFunctions) {
    const scope = fn.module;
    if (!scope) throw new Error(`machine helper: "${fn.name}" has no defining module`);
    const callEnv = makeExecutionFrame(env, {
      bindings: new Map(fn.params.map((name) => [name, null])),
      runnerCallCache: new Map(),
      runnerCallStack: [fn.name],
      runnerClasses: scope.classes,
      runnerFunctions: scope.functions,
      seed: env.seed,
      now: env.now,
    });
    const completions = analyze(fn.body, 0, callEnv, new Set(fn.params), true);
    if (completions.size !== 1 || !completions.has('return')) {
      throw new Error(`machine helper: "${fn.name}" must return a portable value on every path`);
    }
  }
}

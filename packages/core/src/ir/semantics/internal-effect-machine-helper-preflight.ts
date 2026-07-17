import type { IRNode } from '../../types.js';
import { assertInternalMachineHelperGraph } from './internal-effect-machine-helper-graph.js';
import { copyInternalEffectMachineState } from './internal-effect-machine-helper-state.js';
import { makeEnv, type SemanticEnv } from './semantic-env.js';
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
  const graph = assertInternalMachineHelperGraph(nodes, env);
  for (const fn of graph.functions.values()) {
    const callEnv = makeEnv({
      bindings: new Map(fn.params.map((name) => [name, null])),
      runnerCallCache: new Map(),
      runnerCallStack: [fn.name],
      runnerClasses: env.runnerClasses,
      runnerFunctions: env.runnerFunctions,
      seed: env.seed,
      now: env.now,
    });
    copyInternalEffectMachineState(env, callEnv);
    const completions = analyze(fn.body, 0, callEnv, new Set(fn.params), true);
    if (completions.size !== 1 || !completions.has('return')) {
      throw new Error(`machine helper: "${fn.name}" must return a portable value on every path`);
    }
  }
}

import { type AsyncReferenceRunnerOptions, asyncReferenceRunSequence } from '../ir/semantics/async-reference-runner.js';
import type { SemanticEnv } from '../ir/semantics/index.js';
import {
  INTERNAL_EFFECT_MACHINE_FORMAT,
  isInternalEffectMachineEligible,
  runInternalEffectMachineAsync,
  runInternalEffectMachineSync,
} from '../ir/semantics/internal-effect-machine.js';
import { referenceRunSequence } from '../ir/semantics/reference-runner.js';
import type { Trace } from '../ir/semantics/trace.js';
import type { IRNode } from '../types.js';

export type { AsyncReferenceRunnerOptions } from '../ir/semantics/async-reference-runner.js';

export type InternalRuntimeEngineDisposition = typeof INTERNAL_EFFECT_MACHINE_FORMAT | 'legacy';

export function selectInternalRuntimeEngine(
  nodes: readonly IRNode[],
  env: SemanticEnv,
): InternalRuntimeEngineDisposition {
  return isInternalEffectMachineEligible(nodes, env) ? INTERNAL_EFFECT_MACHINE_FORMAT : 'legacy';
}

export function runInternalRuntimeEngineSync(nodes: readonly IRNode[], env: SemanticEnv): Trace {
  return selectInternalRuntimeEngine(nodes, env) === INTERNAL_EFFECT_MACHINE_FORMAT
    ? runInternalEffectMachineSync(nodes, env)
    : referenceRunSequence(nodes, env);
}

export async function runInternalRuntimeEngineAsync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: AsyncReferenceRunnerOptions,
): Promise<Trace> {
  return selectInternalRuntimeEngine(nodes, env) === INTERNAL_EFFECT_MACHINE_FORMAT
    ? runInternalEffectMachineAsync(nodes, env, options)
    : asyncReferenceRunSequence(nodes, env, options);
}

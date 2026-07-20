import {
  INTERNAL_EFFECT_MACHINE_FORMAT,
  type InternalEffectMachineAsyncOptions,
  InternalEffectMachineError,
  runInternalEffectMachineAsync,
  runInternalEffectMachineSync,
} from '../ir/semantics/internal-effect-machine.js';
import { isInternalEffectMachineDirectEligible } from '../ir/semantics/internal-effect-machine-structure.js';
import type { SemanticEnv } from '../ir/semantics/semantic-env.js';
import type { Trace } from '../ir/semantics/trace.js';
import type { IRNode } from '../types.js';

export const INTERNAL_RUNTIME_ENGINE_UNSUPPORTED = 'unsupported' as const;

export type InternalRuntimeEngineDisposition =
  | typeof INTERNAL_EFFECT_MACHINE_FORMAT
  | typeof INTERNAL_RUNTIME_ENGINE_UNSUPPORTED;

export interface InternalRuntimeAsyncOptions extends Omit<InternalEffectMachineAsyncOptions, 'iterationBudget'> {}

export type InternalRuntimeEngineOptions = InternalRuntimeAsyncOptions & { readonly iterationBudget?: number };

export function selectInternalRuntimeEngine(
  nodes: readonly IRNode[],
  env: SemanticEnv,
): InternalRuntimeEngineDisposition {
  return isInternalEffectMachineDirectEligible(nodes, env)
    ? INTERNAL_EFFECT_MACHINE_FORMAT
    : INTERNAL_RUNTIME_ENGINE_UNSUPPORTED;
}

export function assertInternalRuntimeEngineSupported(nodes: readonly IRNode[], env: SemanticEnv): void {
  if (selectInternalRuntimeEngine(nodes, env) === INTERNAL_EFFECT_MACHINE_FORMAT) return;
  throw new InternalEffectMachineError(
    'input is outside the direct internal runtime envelope corpus',
    nodes[0] ?? { type: '__block' },
  );
}

export function runInternalRuntimeEngineSync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  iterationBudget?: number,
): Trace {
  // execute.ts owns direct admission before scheduler installation.
  return runInternalEffectMachineSync(nodes, env, { iterationBudget });
}

export async function runInternalRuntimeEngineAsync(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  options: InternalRuntimeEngineOptions,
): Promise<Trace> {
  // execute.ts owns direct admission before scheduler installation.
  return runInternalEffectMachineAsync(nodes, env, options);
}

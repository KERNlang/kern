import type { InternalEffectMachineState } from './internal-effect-machine-types.js';
import type { SemanticEnv } from './semantic-env.js';

const machineStates = new WeakMap<SemanticEnv, InternalEffectMachineState>();

export function internalEffectMachineStateForEnv(env: SemanticEnv): InternalEffectMachineState | undefined {
  return machineStates.get(env);
}

export function copyInternalEffectMachineState(source: SemanticEnv, target: SemanticEnv): void {
  const state = internalEffectMachineStateForEnv(source);
  if (state !== undefined) bindInternalEffectMachineState(target, state);
}

export function bindInternalEffectMachineState(env: SemanticEnv, state: InternalEffectMachineState): () => void {
  const hadPrevious = machineStates.has(env);
  const previous = machineStates.get(env);
  machineStates.set(env, state);
  return () => {
    if (hadPrevious) machineStates.set(env, previous!);
    else machineStates.delete(env);
  };
}

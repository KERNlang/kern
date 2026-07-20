import type { InternalEffectMachineState } from './internal-effect-machine-types.js';
import type { SemanticEnv } from './semantic-env.js';

const machineState = Symbol('internalEffectMachineState');

type StateEnvironment = SemanticEnv & { [machineState]?: InternalEffectMachineState };

export function internalEffectMachineStateForEnv(env: SemanticEnv): InternalEffectMachineState | undefined {
  return (env as StateEnvironment)[machineState];
}

export function copyInternalEffectMachineState(source: SemanticEnv, target: SemanticEnv): void {
  const state = internalEffectMachineStateForEnv(source);
  if (state !== undefined) bindInternalEffectMachineState(target, state);
}

export function bindInternalEffectMachineState(env: SemanticEnv, state: InternalEffectMachineState): () => void {
  const target = env as StateEnvironment;
  const previous = Object.getOwnPropertyDescriptor(target, machineState);
  Object.defineProperty(target, machineState, {
    configurable: true,
    enumerable: false,
    value: state,
    writable: false,
  });
  return () => {
    if (previous) Object.defineProperty(target, machineState, previous);
    else Reflect.deleteProperty(target, machineState);
  };
}
